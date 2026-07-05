#!/usr/bin/env python3
"""City-targeted Glassdoor scraper.

Uses CloakBrowser (stealth Chromium) to bypass Glassdoor's Cloudflare
Managed Challenge. Each city gets a fresh browser context with a random
desktop User-Agent so the request stream looks like 60+ different users
rather than one persistent session.

Usage:
    python -m scrapers.glassdoor_cities --cities Berlin --max-per-city 50
    python -m scrapers.glassdoor_cities --existing-json data/glassdoor_jobs_20260510_231012.json
"""

import json
import os
import time
import random
import argparse
import csv
from pathlib import Path
from datetime import datetime

from cloakbrowser import launch

from ._cities import COUNTRYWIDE, KEYWORDS, TARGET_CITIES
from ._progress import ProgressLog

# Rotating identity pool — 30 (brand, brand_version) tuples driving
# CloakBrowser's --fingerprint-brand and --fingerprint-brand-version
# flags. Setting these via flags (not via new_context's user_agent kwarg)
# is critical: cloakbrowser keeps UA string AND Sec-CH-UA-* Client Hints
# in sync from those flags. Overriding user_agent alone produced a UA/CH
# mismatch that Cloudflare flagged on every run.
BRAND_FINGERPRINTS = [
    ("Chrome", "146.0.7680.177"),
    ("Chrome", "146.0.7680.139"),
    ("Chrome", "146.0.7680.94"),
    ("Chrome", "146.0.7680.61"),
    ("Chrome", "146.0.7680.32"),
    ("Chrome", "145.0.7503.119"),
    ("Chrome", "145.0.7503.94"),
    ("Chrome", "145.0.7503.71"),
    ("Chrome", "145.0.7503.41"),
    ("Chrome", "145.0.7503.16"),
    ("Chrome", "144.0.6900.117"),
    ("Chrome", "144.0.6900.88"),
    ("Chrome", "144.0.6900.59"),
    ("Chrome", "144.0.6900.31"),
    ("Chrome", "144.0.6900.13"),
    ("Chrome", "143.0.6717.140"),
    ("Chrome", "143.0.6717.92"),
    ("Chrome", "143.0.6717.51"),
    ("Chrome", "143.0.6717.27"),
    ("Chrome", "142.0.6604.130"),
    ("Chrome", "142.0.6604.84"),
    ("Chrome", "142.0.6604.51"),
    ("Edge",   "146.0.2700.94"),
    ("Edge",   "146.0.2700.74"),
    ("Edge",   "146.0.2700.52"),
    ("Edge",   "145.0.2614.117"),
    ("Edge",   "145.0.2614.79"),
    ("Edge",   "144.0.2532.94"),
    ("Edge",   "144.0.2532.56"),
    ("Edge",   "143.0.2454.85"),
]

assert len(BRAND_FINGERPRINTS) == 30, (
    f"BRAND_FINGERPRINTS must have 30 entries (got {len(BRAND_FINGERPRINTS)})"
)


class CityGlassdoorScraper:
    BASE_URL = "https://www.glassdoor.de"
    SEARCH_URL = f"{BASE_URL}/job-search-next/bff/jobSearchResultsQuery"
    LOCATION_URL = f"{BASE_URL}/findPopularLocationAjax.htm"
    RESULTS_PER_PAGE = 30

    def __init__(self, delay_range=(2.5, 5.0)):
        self.delay_range = delay_range
        self.city_id_cache: dict[str, dict] = {}
        self.browser = None
        self.context = None
        self.page = None
        self.user_agent: str | None = None

    def _open_browser(self):
        self._close_browser()
        # Rotate identity via `--fingerprint=<seed>` only. Don't override
        # brand or brand_version — cloakbrowser's binary is Chrome 146,
        # and forcing a different UA/Client-Hints version creates a
        # mismatch with the actual TLS handshake that Cloudflare detects.
        # The seed alone deterministically rotates GPU, canvas, WebGL,
        # audio, fonts, and screen dimensions — 89000+ unique identities.
        fingerprint_seed = random.randint(10000, 99999)
        self.user_agent = f"seed={fingerprint_seed}"  # for log only

        # GLASSDOOR_PROXY_URL is mandatory in practice: Cloudflare scores
        # this server's datacenter IP too low to clear the managed
        # challenge regardless of browser stealth. Set to a residential
        # SOCKS5/HTTP proxy in .env. Empty/unset → direct (will 403).
        proxy_url = os.environ.get("GLASSDOOR_PROXY_URL", "").strip()
        launch_kwargs = {
            "humanize": True,
            "args": [f"--fingerprint={fingerprint_seed}"],
        }
        if proxy_url:
            # geoip=True auto-aligns timezone/locale to the proxy exit IP
            # and injects --fingerprint-webrtc-ip to prevent WebRTC leaks.
            launch_kwargs["proxy"] = proxy_url
            launch_kwargs["geoip"] = True
        self.browser = launch(**launch_kwargs)
        self.context = self.browser.new_context(
            locale="de-DE",
            timezone_id="Europe/Berlin",
            viewport={"width": 1920, "height": 1080},
        )
        self.page = self.context.new_page()

    def _close_browser(self):
        for obj_attr in ("context", "browser"):
            obj = getattr(self, obj_attr, None)
            if obj is not None:
                try:
                    obj.close()
                except Exception:
                    pass
            setattr(self, obj_attr, None)
        self.page = None

    # Cloudflare challenge / mid-flight page titles. Match in lowercase.
    # German + English forms cover glassdoor.de's localized challenges.
    CHALLENGE_TITLE_TOKENS = (
        "just a moment", "nur einen moment", "einen moment",
        "security", "sicherheits",
        "attention required", "ddos",
        "checking your browser",
    )

    def _on_challenge_page(self) -> bool:
        title = (self.page.title() or "").lower()
        return any(tok in title for tok in self.CHALLENGE_TITLE_TOKENS)

    def init_session(self):
        """Open a fresh browser and load the homepage so CloakBrowser
        passes any Cloudflare challenge and banks clearance cookies. A
        fresh browser per call also rotates the User-Agent.

        Cloudflare's Managed Challenge serves the JS challenge first and
        only swaps in the real content once the JS resolves and a
        `cf_clearance` cookie is granted. We poll the title for up to
        45s waiting for that swap.
        """
        self._open_browser()
        ua_tail = self.user_agent.split(" ")[-1] if self.user_agent else "?"
        proxy_indicator = "via proxy" if os.environ.get("GLASSDOOR_PROXY_URL", "").strip() else "DIRECT (likely 403)"
        print(f"Initializing browser session (UA tail: {ua_tail}, {proxy_indicator})")
        self.page.goto(
            self.BASE_URL,
            wait_until="load",
            timeout=60_000,
        )

        # With a residential proxy, cloakbrowser auto-resolves Cloudflare's
        # managed challenge in ~5-10s. Just wait — calling
        # `turnstile.reset()` or clicking the iframe interrupts the
        # auto-resolve and the challenge never completes.
        deadline = time.monotonic() + 45.0
        while self._on_challenge_page() and time.monotonic() < deadline:
            time.sleep(1.5)
            try:
                self.page.wait_for_load_state("networkidle", timeout=2_000)
            except Exception:
                pass

        title = self.page.title()
        url = self.page.url
        cookies = self.context.cookies()
        cookie_names = [c["name"] for c in cookies]
        cf_cleared = any(c["name"] == "cf_clearance" for c in cookies)

        if self._on_challenge_page() or not cf_cleared:
            body_sample = (self.page.content() or "")[:300]
            raise RuntimeError(
                f"Cloudflare challenge not cleared. title={title!r} "
                f"url={url!r} cf_clearance={cf_cleared} "
                f"cookies={cookie_names} body_head={body_sample!r}"
            )

        print(f"Session initialized. title={title!r} cookies={cookie_names}")

    def _browser_fetch(self, url: str, *, method: str = "GET", body: dict | None = None,
                       extra_headers: dict | None = None, timeout_ms: int = 20_000) -> dict:
        """Run fetch() inside the page so the request carries the real
        browser's UA, Client Hints, Sec-Fetch-*, cookies (incl.
        cf_clearance), and TLS fingerprint. Returns {status, body_text}.
        Glassdoor's BFF rejects requests from page.request.* because the
        Sec-Fetch-Site / Sec-Fetch-Mode headers don't match an in-page
        XHR, even though the cookies are shared.
        """
        js_args = {
            "url": url,
            "method": method,
            "body": json.dumps(body) if body is not None else None,
            "extraHeaders": extra_headers or {},
            "timeoutMs": timeout_ms,
        }
        return self.page.evaluate(
            """async ({url, method, body, extraHeaders, timeoutMs}) => {
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), timeoutMs);
                try {
                    const r = await fetch(url, {
                        method,
                        body,
                        credentials: 'include',
                        headers: {
                            'Accept': '*/*',
                            ...(body ? {'Content-Type': 'application/json'} : {}),
                            ...extraHeaders,
                        },
                        signal: ctrl.signal,
                    });
                    const text = await r.text();
                    return {status: r.status, body: text};
                } finally {
                    clearTimeout(t);
                }
            }""",
            js_args,
        )

    def lookup_city_id(self, city_name: str) -> dict | None:
        """Look up the Glassdoor location id via autocomplete.

        Returns None on timeout / network error rather than raising —
        Glassdoor's anti-bot throttle starts dropping connections, and a
        single timed-out city should not crash the whole scrape.
        """
        if city_name in self.city_id_cache:
            return self.city_id_cache[city_name]

        from urllib.parse import urlencode
        qs = urlencode({"term": city_name, "maxLocationsToReturn": 5})
        try:
            resp = self._browser_fetch(f"{self.LOCATION_URL}?{qs}")
        except Exception as e:
            print(f"  Location lookup network error for '{city_name}': {e}")
            return None

        if resp["status"] != 200:
            print(f"  Location lookup failed for '{city_name}': HTTP {resp['status']}")
            return None

        try:
            results = json.loads(resp["body"])
        except Exception as e:
            print(f"  Location lookup parse error for '{city_name}': {e}")
            return None

        # Country-wide sweep: pick the "N" (nation) result for Deutschland.
        if city_name == COUNTRYWIDE:
            for r in results:
                if r.get("locationType") == "N" and (
                    r.get("countryName") == "Deutschland"
                    or "deutschland" in (r.get("label", "") or "").lower()
                ):
                    info = {
                        "locationId": r["locationId"],
                        "locationType": "COUNTRY",
                        "label": r["label"],
                    }
                    self.city_id_cache[city_name] = info
                    return info
            # Fallback to any nation result.
            for r in results:
                if r.get("locationType") == "N":
                    info = {
                        "locationId": r["locationId"],
                        "locationType": "COUNTRY",
                        "label": r["label"],
                    }
                    self.city_id_cache[city_name] = info
                    return info
            print(f"  No nation match for '{city_name}'")
            return None

        # Find best match: prefer locationType "C" (city) in Germany
        for r in results:
            if (
                r.get("locationType") == "C"
                and r.get("countryName") == "Deutschland"
                and city_name.lower() in r.get("label", "").lower()
            ):
                info = {
                    "locationId": r["locationId"],
                    "locationType": "CITY",
                    "label": r["label"],
                }
                self.city_id_cache[city_name] = info
                return info

        # Fallback: first German city result
        for r in results:
            if r.get("locationType") == "C" and r.get("countryName") == "Deutschland":
                info = {
                    "locationId": r["locationId"],
                    "locationType": "CITY",
                    "label": r["label"],
                }
                self.city_id_cache[city_name] = info
                return info

        print(f"  No city match found for '{city_name}'")
        return None

    def _build_param_url(
        self, city_id: int, city_name: str, keyword: str, location_type: str = "CITY",
    ) -> str:
        loc_len = len(city_name)
        kw_start = loc_len + 1
        kw_end = kw_start + len(keyword)
        # IC = inside city, IN = inside nation — Glassdoor's URL grammar.
        prefix = "IN" if location_type == "COUNTRY" else "IC"
        return f"IL.0,{loc_len}_{prefix}{city_id}_KO{kw_start},{kw_end}"

    def _search_page(
        self, keyword: str, city_name: str, city_id: int,
        page: int, cursor: str | None = None, location_type: str = "CITY",
    ) -> dict:
        param_url = self._build_param_url(city_id, city_name, keyword, location_type)
        seo_slug = city_name.lower().replace(" ", "-").replace("ü", "ue").replace("ö", "oe").replace("ä", "ae")

        payload = {
            "keyword": keyword,
            "location": city_name,
            "locationId": city_id,
            "locationType": location_type,
            "numJobsToShow": self.RESULTS_PER_PAGE,
            "pageNumber": page,
            "pageCursor": cursor,
            "pageType": "SERP",
            "seoUrl": True,
            "filterParams": [],
            "parameterUrlInput": param_url,
            "seoFriendlyUrlInput": f"{seo_slug}-{keyword.lower().replace(' ', '-')}-jobs",
            "includeIndeedJobAttributes": True,
            "excludeJobListingIds": [],
        }

        for attempt in range(3):
            try:
                resp = self._browser_fetch(
                    self.SEARCH_URL,
                    method="POST",
                    body=payload,
                    timeout_ms=15_000,
                )
            except Exception as e:
                if attempt < 2:
                    wait = (attempt + 1) * 5 + random.uniform(1, 3)
                    print(f"    Network error, retrying in {wait:.0f}s: {e}")
                    time.sleep(wait)
                    continue
                raise
            if resp["status"] == 200:
                return json.loads(resp["body"])
            if resp["status"] in (502, 503, 429, 403) and attempt < 2:
                wait = (attempt + 1) * 5 + random.uniform(1, 3)
                print(f"    HTTP {resp['status']}, retrying in {wait:.0f}s...")
                time.sleep(wait)
                continue
            raise RuntimeError(f"Search failed: HTTP {resp['status']}")

    def search_city_keyword(
        self, keyword: str, city_name: str, city_id: int, max_jobs: int = 500,
        location_type: str = "CITY",
    ) -> list[dict]:
        jobs: list[dict] = []
        cursor: str | None = None
        page = 1

        while len(jobs) < max_jobs:
            try:
                data = self._search_page(keyword, city_name, city_id, page, cursor, location_type)
            except Exception as e:
                print(f"    Error on page {page}: {e}")
                try:
                    # Re-warm the session with a fresh browser/UA, then retry the page once.
                    self.init_session()
                    time.sleep(random.uniform(3, 6))
                    data = self._search_page(keyword, city_name, city_id, page, cursor, location_type)
                except Exception:
                    print(f"    Retry failed, stopping.")
                    break

            job_listings = (data.get("data") or {}).get("jobListings") or {}
            listings = job_listings.get("jobListings") or []
            if not listings:
                break

            jobs.extend(listings)

            cursors = job_listings.get("paginationCursors") or []
            next_cursor = None
            for c in cursors:
                if c.get("pageNumber", 0) == page + 1:
                    next_cursor = c.get("cursor")
                    break
            if not next_cursor:
                break

            cursor = next_cursor
            page += 1
            time.sleep(random.uniform(*self.delay_range))

        return jobs[:max_jobs]

    def scrape_city(
        self, city_name: str, existing_ids: set[str],
        max_per_city: int = 200,
    ) -> dict:
        """Scrape all keywords for one location. Caller is expected to
        have called init_session() to open a fresh browser for this
        city (giving it a fresh UA + cookies)."""
        city_info = self.lookup_city_id(city_name)
        if not city_info:
            return {"city": city_name, "error": "location lookup failed", "jobs": []}

        city_id = city_info["locationId"]
        location_type = city_info.get("locationType", "CITY")
        label = "DEUTSCHLAND" if city_name == COUNTRYWIDE else f"CITY: {city_name}"
        print(f"\n{'='*60}")
        print(f"{label} (Glassdoor ID: {city_id}, type: {location_type})")
        print(f"{'='*60}")

        seen_ids: set[str] = set()
        all_jobs: list[dict] = []

        for kw in KEYWORDS:
            remaining = max_per_city - len(all_jobs)
            if remaining <= 0:
                break

            print(f"  [{kw}] searching in {city_name}...")
            time.sleep(random.uniform(1.5, 3.0))

            try:
                jobs = self.search_city_keyword(
                    kw, city_name, city_id,
                    max_jobs=remaining + 100,
                    location_type=location_type,
                )
            except Exception as e:
                print(f"  Error searching '{kw}' in {city_name}: {e}")
                continue

            new = 0
            for job in jobs:
                listing_id = str(
                    job.get("jobview", {}).get("job", {}).get("listingId", "")
                )
                if listing_id and listing_id not in seen_ids:
                    seen_ids.add(listing_id)
                    all_jobs.append(job)
                    new += 1
                    if len(all_jobs) >= max_per_city:
                        break

            print(f"    → {len(jobs)} results, {new} new unique")

        # Compare against existing data
        new_ids = seen_ids - existing_ids
        duplicate_ids = seen_ids & existing_ids

        stats = {
            "city": city_name,
            "glassdoor_id": city_id,
            "total_unique": len(seen_ids),
            "new_vs_existing": len(new_ids),
            "duplicates": len(duplicate_ids),
        }

        print(f"\n  RESULT for {city_name}:")
        print(f"    Total unique listings: {stats['total_unique']}")
        print(f"    NEW (not in existing):  {stats['new_vs_existing']}")
        print(f"    Duplicates:             {stats['duplicates']}")

        return {"stats": stats, "jobs": all_jobs}

    def close(self):
        self._close_browser()


def flatten_job(job: dict) -> dict:
    jv = job.get("jobview", {})
    header = jv.get("header", {})
    jd = jv.get("job", {})
    overview = jv.get("overview", {})

    return {
        "listing_id": jd.get("listingId"),
        "title": header.get("jobTitleText"),
        "company": header.get("employerNameFromSearch"),
        "location": header.get("locationName"),
        "rating": header.get("rating"),
        "pay_low": header.get("payPercentile10"),
        "pay_median": header.get("payPercentile50"),
        "pay_high": header.get("payPercentile90"),
        "pay_currency": header.get("payCurrency"),
        "easy_apply": header.get("easyApply"),
        "industry": overview.get("industry"),
        "company_size": overview.get("size"),
        "job_source": jd.get("jobSource"),
        "description": jd.get("description", ""),
        "link": header.get("seoJobLink", ""),
    }


def load_existing_ids(json_path: str) -> set[str]:
    if not json_path or not Path(json_path).exists():
        return set()
    with open(json_path, encoding="utf-8") as f:
        jobs = json.load(f)
    ids = set()
    for j in jobs:
        lid = j.get("jobview", {}).get("job", {}).get("listingId")
        if lid:
            ids.add(str(lid))
    print(f"Loaded {len(ids)} existing listing IDs from {json_path}")
    return ids


def save_results(
    all_jobs: list[dict],
    city_stats: list[dict],
    output_dir: Path,
    timestamp: str | None = None,
):
    output_dir.mkdir(parents=True, exist_ok=True)
    if timestamp is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # Raw JSON with all jobs
    json_path = output_dir / f"glassdoor_cities_{timestamp}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(all_jobs, f, ensure_ascii=False, indent=2)
    print(f"\nRaw JSON saved: {json_path} ({len(all_jobs)} jobs)")

    # Flattened CSV
    flat = [flatten_job(j) for j in all_jobs]
    csv_path = output_dir / f"glassdoor_cities_{timestamp}.csv"
    if flat:
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=flat[0].keys())
            writer.writeheader()
            writer.writerows(flat)
        print(f"CSV saved:      {csv_path}")

    # City comparison log
    log_path = output_dir / f"glassdoor_cities_log_{timestamp}.json"
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(city_stats, f, ensure_ascii=False, indent=2)
    print(f"City log saved: {log_path}")

    # Print summary table
    print(f"\n{'='*60}")
    print("CITY SCRAPE SUMMARY")
    print(f"{'='*60}")
    print(f"{'City':<25} {'Total':>7} {'New':>7} {'Dupes':>7}")
    print(f"{'-'*25} {'-'*7} {'-'*7} {'-'*7}")
    total_new = 0
    total_dupes = 0
    for s in city_stats:
        if "error" in s:
            print(f"{s['city']:<25} {'ERROR':>7}")
            continue
        print(f"{s['city']:<25} {s['total_unique']:>7} {s['new_vs_existing']:>7} {s['duplicates']:>7}")
        total_new += s["new_vs_existing"]
        total_dupes += s["duplicates"]
    print(f"{'-'*25} {'-'*7} {'-'*7} {'-'*7}")
    print(f"{'TOTAL':<25} {total_new + total_dupes:>7} {total_new:>7} {total_dupes:>7}")

    return json_path, csv_path, log_path


def main():
    parser = argparse.ArgumentParser(
        description="City-targeted Glassdoor AI job scraper (CloakBrowser)"
    )
    parser.add_argument(
        "--existing-json", type=str, default=None,
        help="Path to existing Glassdoor JSON for dedup comparison (optional)",
    )
    parser.add_argument(
        "--cities", type=str, nargs="*", default=None,
        help="Specific cities to scrape (default: all TARGET_CITIES)",
    )
    parser.add_argument(
        "--max-per-city", type=int, default=150,
        help="Max jobs per city (default: 150)",
    )
    parser.add_argument(
        "--output-dir", type=str, default="data/raw",
        help="Output directory (default: data/raw)",
    )
    parser.add_argument(
        "--delay-min", type=float, default=4.0,
        help="Min delay between requests (default: 4.0)",
    )
    parser.add_argument(
        "--delay-max", type=float, default=9.0,
        help="Max delay between requests (default: 9.0)",
    )
    args = parser.parse_args()

    existing_ids = load_existing_ids(args.existing_json)

    cities = args.cities if args.cities else TARGET_CITIES
    print(f"\nWill scrape {len(cities)} cities: {', '.join(cities)}")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    run_ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    progress = ProgressLog(output_dir, "glassdoor", run_ts)
    progress.start(cities, args.max_per_city)

    scraper = CityGlassdoorScraper(delay_range=(args.delay_min, args.delay_max))

    all_jobs: list[dict] = []
    all_stats: list[dict] = []
    global_seen: set[str] = set()

    try:
        for idx, city in enumerate(cities, start=1):
            progress.city_start(city, idx, len(cities))
            # Fresh browser + UA per city; previous context (if any) is
            # closed inside init_session().
            try:
                scraper.init_session()
                result = scraper.scrape_city(city, existing_ids, max_per_city=args.max_per_city)
            except Exception as e:
                all_stats.append({"city": city, "error": str(e)})
                progress.city_error(city, idx, len(cities), str(e))
                continue

            if "error" in result:
                all_stats.append({"city": city, "error": result["error"]})
                progress.city_error(city, idx, len(cities), result["error"])
                continue

            # Deduplicate across cities
            for job in result["jobs"]:
                lid = str(job.get("jobview", {}).get("job", {}).get("listingId", ""))
                if lid and lid not in global_seen:
                    global_seen.add(lid)
                    all_jobs.append(job)

            all_stats.append(result["stats"])
            progress.city_done(city, idx, len(cities), result["stats"])
            # Longer cool-down between cities to stay under Glassdoor's
            # per-IP request-rate threshold. (Default ~12s.)
            time.sleep(random.uniform(8.0, 15.0))
    finally:
        scraper.close()

    progress.finished({"jobs": len(all_jobs), "cities": len(cities)})

    if all_jobs:
        save_results(all_jobs, all_stats, output_dir, run_ts)
        print(f"\nDone! Collected {len(all_jobs)} unique jobs across {len(cities)} cities.")
    else:
        print("\nNo jobs collected.")


if __name__ == "__main__":
    main()
