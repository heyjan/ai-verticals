#!/usr/bin/env python3
"""City-targeted Xing scraper.

Xing is Germany's homegrown LinkedIn-equivalent and exposes a public
HTML job-search page that does not require authentication. We paginate
`https://www.xing.com/jobs/search?keywords=<kw>&location=<city>&page=N`
and parse cards directly from the HTML. Each job detail page embeds a
JSON-LD JobPosting block we can read without an extra API.

Output matches the LinkedIn/Glassdoor schema so `scrapers.merge` can
ingest it the same way (just add `--xing <file>`).
"""

import argparse
import html
import json
import random
import re
import time
from datetime import datetime
from pathlib import Path

from bs4 import BeautifulSoup
from curl_cffi import requests as curl_requests

from ._cities import COUNTRYWIDE, KEYWORDS, TARGET_CITIES
from ._progress import ProgressLog

BASE_URL = "https://www.xing.com"
SEARCH_URL = f"{BASE_URL}/jobs/search"
RESULTS_PER_PAGE = 19  # observed; not used for pagination math, just for empty heuristics
MAX_PAGES = 30  # ~570 jobs/kw cap; deeper pages are rarely fresh

# Xing "since" filter (the `sincePeriod` query param). Bounds the search to
# listings whose freshness/activity falls inside the window — the daily cron
# uses 24h so it only sees the day's churn, exactly like LinkedIn's f_TPR.
# Only LAST_24_HOURS is confirmed; the longer tokens (LAST_3_DAYS/7/30) return
# empty, so their real enum names are unknown and deliberately omitted.
TIME_WINDOWS: dict[str, str | None] = {
    "24h": "LAST_24_HOURS",  # past 24 hours — daily cron
    "any": None,             # no time filter (omit sincePeriod)
}
DEFAULT_SINCE = "any"


RATE_LIMIT_BACKOFFS = (30.0, 60.0, 120.0)


def new_session() -> curl_requests.Session:
    session = curl_requests.Session(impersonate="chrome")
    session.headers.update({"Accept-Language": "de-DE,de;q=0.9,en;q=0.8"})
    return session


def _get_with_backoff(
    session: curl_requests.Session, url: str, params: dict | None = None,
) -> object | None:
    """GET with 429 retry/backoff — same shape as the LinkedIn helper."""
    resp = None
    for attempt, wait in enumerate((0.0,) + RATE_LIMIT_BACKOFFS):
        if wait > 0:
            print(f"      429 rate-limited; sleeping {wait:.0f}s before retry {attempt}", flush=True)
            time.sleep(wait)
        try:
            resp = session.get(url, params=params, timeout=15)
        except Exception as e:
            print(f"      request error: {e}", flush=True)
            return None
        if resp.status_code != 429:
            return resp
    return resp


JOB_ID_RE = re.compile(r"-(\d+)$")


def parse_card(article) -> dict | None:
    link = article.find("a", href=True)
    if not link:
        return None
    href = link["href"]
    if not href.startswith("/jobs/"):
        return None
    m = JOB_ID_RE.search(href)
    if not m:
        return None
    job_id = m.group(1)

    title_el = article.find("h2", attrs={"data-testid": "job-teaser-list-title"})
    title = title_el.get_text(strip=True) if title_el else (link.get("aria-label") or "").strip()

    # Company sits in a <p> right after the title with a stable testid prefix.
    company = ""
    body_copies = article.find_all("p", attrs={"data-xds": "BodyCopy"})
    if body_copies:
        company = body_copies[0].get_text(strip=True)

    # Location is in a multi-location container; take the visible text and
    # strip the "+ N weitere" overflow note.
    location_el = article.find("div", class_=re.compile("multi-location-display"))
    location = ""
    if location_el:
        loc_p = location_el.find("p")
        if loc_p:
            # Drop the overflow <b> indicator if present.
            for b in loc_p.find_all("b"):
                b.extract()
            location = loc_p.get_text(" ", strip=True)

    # Markers (Full-time / Part-time / salary range / Remote) are siblings.
    markers = [m.get_text(strip=True) for m in article.find_all("span", attrs={"data-xds": "Marker"})]
    employment_type = next((m for m in markers if any(k in m.lower() for k in ("full-time", "part-time", "voll", "teil"))), "")
    salary = next((m for m in markers if "€" in m or "EUR" in m.upper()), "")

    return {
        "job_id": job_id,
        "url": f"{BASE_URL}{href}",
        "title": title,
        "company": company,
        "location": location,
        "city": location,
        "employment_type": employment_type,
        "salary": salary,
    }


_JSON_LD_RE = re.compile(
    r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
    re.DOTALL,
)


def _strip_html(text: str) -> str:
    # JSON-LD bodies are HTML-escaped; unescape then strip tags via BS4.
    if not text:
        return ""
    cleaned = BeautifulSoup(html.unescape(text), "lxml").get_text(" ", strip=True)
    # JSON-LD descriptions keep the source's literal newlines/indentation as
    # text nodes; collapse runs of whitespace to single spaces.
    return re.sub(r"\s+", " ", cleaned).strip()


def fetch_detail(session: curl_requests.Session, job_url: str) -> dict:
    resp = _get_with_backoff(session, job_url)
    if resp is None or resp.status_code != 200:
        return {}
    body = resp.text

    m = _JSON_LD_RE.search(body)
    if not m:
        return {}
    try:
        ld = json.loads(m.group(1))
    except Exception:
        return {}
    if isinstance(ld, list):
        ld = next((x for x in ld if isinstance(x, dict) and x.get("@type") == "JobPosting"), None)
    if not isinstance(ld, dict):
        return {}

    description = _strip_html(ld.get("description", ""))
    # Xing renders empty template fields (the intro/subtitle above the body)
    # as the literal text "null", which lands at the very start of the
    # description. Strip a leading run of standalone "null" tokens only —
    # leaving any later in the body intact, since a dev posting may
    # legitimately mention "null".
    description = re.sub(r"^(?:null\b\s*)+", "", description).lstrip()
    industries = ""
    industry = ld.get("industry")
    if isinstance(industry, str):
        industries = industry
    elif isinstance(industry, list):
        industries = ", ".join(str(x) for x in industry)

    return {
        "description": description,
        "date_posted": ld.get("datePosted", ""),
        "employment_type": ld.get("employmentType", ""),
        "industries": industries,
    }


def search_page(
    session: curl_requests.Session, keyword: str, page: int, city: str,
    radius: int = 0, since_period: str | None = None,
) -> list[dict]:
    location = "Deutschland" if city == COUNTRYWIDE else city
    params = {
        "keywords": keyword,
        "location": location,
        "page": page,
    }
    # `radius` (km) widens the search around a city to pull in its commuter
    # belt — e.g. radius=20 around Ulm also returns Neu-Ulm. Xing only
    # offers 20 or 50 km; 50 is too broad. Meaningless for the nation-wide
    # pass, so we skip it there.
    if radius and city != COUNTRYWIDE:
        params["radius"] = radius
    # `sincePeriod` bounds to the recent-activity window (daily cron: 24h).
    # Applies everywhere, including the nation-wide pass.
    if since_period:
        params["sincePeriod"] = since_period
    resp = _get_with_backoff(session, SEARCH_URL, params=params)
    if resp is None or resp.status_code != 200:
        return []
    soup = BeautifulSoup(resp.text, "lxml")
    articles = soup.find_all("article", attrs={"data-testid": "job-search-result"})
    jobs = []
    for art in articles:
        parsed = parse_card(art)
        if parsed:
            jobs.append(parsed)
    return jobs


def scrape_city(
    session: curl_requests.Session,
    city: str,
    existing_ids: set[str],
    max_per_city: int,
    delay_range: tuple[float, float],
    fetch_descriptions: bool,
    radius: int,
    since_period: str | None,
) -> dict:
    print(f"\n{'='*60}\nCITY: {city}\n{'='*60}", flush=True)

    seen_ids: set[str] = set()
    all_jobs: list[dict] = []

    for kw in KEYWORDS:
        if len(all_jobs) >= max_per_city:
            break
        print(f"  [{kw}] searching in {city}...", flush=True)
        kw_new = 0
        consecutive_empty = 0
        for page in range(1, MAX_PAGES + 1):
            if len(all_jobs) >= max_per_city:
                break
            try:
                page_jobs = search_page(session, kw, page, city, radius, since_period)
            except Exception as e:
                print(f"    Error on page {page}: {e}", flush=True)
                break

            if not page_jobs:
                consecutive_empty += 1
                if consecutive_empty >= 2:
                    break
                time.sleep(random.uniform(*delay_range))
                continue
            consecutive_empty = 0

            page_new = 0
            for job in page_jobs:
                jid = job["job_id"]
                if jid in seen_ids:
                    continue
                seen_ids.add(jid)

                if fetch_descriptions:
                    time.sleep(random.uniform(delay_range[0] * 0.5, delay_range[1] * 0.5))
                    detail = fetch_detail(session, job["url"])
                    # Detail's employment_type is more authoritative than the marker chip.
                    if detail.get("employment_type"):
                        job["employment_type"] = detail["employment_type"]
                    job.update({k: v for k, v in detail.items() if k != "employment_type"})

                all_jobs.append(job)
                page_new += 1
                kw_new += 1
                if len(all_jobs) >= max_per_city:
                    break

            if page_new == 0:
                consecutive_empty += 1
                if consecutive_empty >= 2:
                    break

            time.sleep(random.uniform(*delay_range))

        print(f"    → {kw_new} new unique jobs", flush=True)

    new_ids = seen_ids - existing_ids
    duplicate_ids = seen_ids & existing_ids

    stats = {
        "city": city,
        "total_unique": len(seen_ids),
        "new_vs_existing": len(new_ids),
        "duplicates": len(duplicate_ids),
    }
    print(f"\n  RESULT for {city}:\n    Total unique listings: {stats['total_unique']}\n    NEW: {stats['new_vs_existing']}\n    Duplicates: {stats['duplicates']}", flush=True)
    return {"stats": stats, "jobs": all_jobs}


def load_existing_ids(json_path: str | None) -> set[str]:
    if not json_path:
        return set()
    p = Path(json_path)
    if not p.exists():
        print(f"--existing-json not found: {p}")
        return set()
    with open(p, encoding="utf-8") as f:
        data = json.load(f)
    ids = set()
    for j in data:
        jid = j.get("job_id") or j.get("source_id")
        if jid:
            ids.add(str(jid))
    print(f"Loaded {len(ids)} existing job IDs from {json_path}")
    return ids


def save_partial(all_jobs: list[dict], output_dir: Path, timestamp: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    partial = output_dir / f"xing_cities_partial_{timestamp}.json"
    tmp = partial.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(all_jobs, f, ensure_ascii=False)
    tmp.replace(partial)


def save_results(
    all_jobs: list[dict], city_stats: list[dict], output_dir: Path, timestamp: str,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / f"xing_cities_{timestamp}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(all_jobs, f, ensure_ascii=False, indent=2)
    print(f"\nJSON saved: {json_path} ({len(all_jobs)} jobs)")
    log_path = output_dir / f"xing_cities_log_{timestamp}.json"
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(city_stats, f, ensure_ascii=False, indent=2)
    print(f"City log:   {log_path}")


def main():
    parser = argparse.ArgumentParser(description="Scrape AI jobs from Xing Germany per city")
    parser.add_argument("--cities", type=str, nargs="*", default=None,
                        help="Specific cities (default: all TARGET_CITIES)")
    parser.add_argument("--max-per-city", type=int, default=150,
                        help="Max jobs per city (default: 150)")
    parser.add_argument("--output-dir", type=str, default="data/raw",
                        help="Output directory (default: data/raw)")
    parser.add_argument("--existing-json", type=str, default=None,
                        help="Existing Xing JSON to compute NEW vs existing")
    parser.add_argument("--delay-min", type=float, default=2.0,
                        help="Min delay between requests (default: 2.0)")
    parser.add_argument("--delay-max", type=float, default=5.0,
                        help="Max delay between requests (default: 5.0)")
    parser.add_argument("--no-descriptions", action="store_true",
                        help="Skip detail fetches (no descriptions but much faster)")
    parser.add_argument("--radius", type=int, default=20, choices=(0, 20, 50),
                        help="Search radius in km around each city (Xing supports 20 or 50; "
                             "0 disables). Default: 20")
    parser.add_argument("--since", choices=list(TIME_WINDOWS), default=DEFAULT_SINCE,
                        help="Recent-activity window (Xing sincePeriod). 24h = daily cron; "
                             "any = no filter (full backfill). Default: any.")
    args = parser.parse_args()

    existing_ids = load_existing_ids(args.existing_json)
    cities = args.cities if args.cities else TARGET_CITIES
    print(f"\nWill scrape {len(cities)} cities (radius={args.radius}km, "
          f"--since {args.since}): {', '.join(cities)}", flush=True)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    run_ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    progress = ProgressLog(output_dir, "xing", run_ts)
    progress.start(cities, args.max_per_city)

    session = new_session()
    all_jobs: list[dict] = []
    all_stats: list[dict] = []
    global_seen: set[str] = set()

    for idx, city in enumerate(cities, start=1):
        progress.city_start(city, idx, len(cities))
        try:
            result = scrape_city(
                session, city, existing_ids,
                max_per_city=args.max_per_city,
                delay_range=(args.delay_min, args.delay_max),
                fetch_descriptions=not args.no_descriptions,
                radius=args.radius,
                since_period=TIME_WINDOWS[args.since],
            )
        except Exception as e:
            all_stats.append({"city": city, "error": str(e)})
            progress.city_error(city, idx, len(cities), str(e))
            continue

        for job in result["jobs"]:
            jid = str(job.get("job_id", ""))
            if jid and jid not in global_seen:
                global_seen.add(jid)
                all_jobs.append(job)

        all_stats.append(result["stats"])
        progress.city_done(city, idx, len(cities), result["stats"])
        save_partial(all_jobs, output_dir, run_ts)
        time.sleep(random.uniform(3.0, 6.0))

    progress.finished({"jobs": len(all_jobs), "cities": len(cities)})

    if all_jobs:
        save_results(all_jobs, all_stats, output_dir, run_ts)
        print(f"\nDone! Collected {len(all_jobs)} unique jobs across {len(cities)} cities.")
    else:
        print("\nNo jobs collected.")


if __name__ == "__main__":
    main()
