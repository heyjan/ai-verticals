#!/usr/bin/env python3
"""City-targeted Glassdoor scraper.

Searches AI jobs per city instead of country-wide "Deutschland".
Discovers Glassdoor city IDs via autocomplete, then runs BFF queries
scoped to each city. Logs how many new entries each city yields
compared to the existing generic scrape data.

Usage:
    python scrape_glassdoor_cities.py --existing-json data/glassdoor_jobs_20260510_231012.json
    python scrape_glassdoor_cities.py --cities ulm stuttgart münchen --max-per-city 200
"""

import json
import time
import random
import argparse
import csv
from pathlib import Path
from datetime import datetime
from collections import defaultdict

from curl_cffi import requests as curl_requests

from ._progress import ProgressLog


KEYWORDS = [
    "artificial intelligence",
    "AI",
    "Data & AI",
    "Künstliche Intelligenz",
    "NLP natural language processing",
    "computer vision",
    "data scientist AI",
    "generative AI LLM",
]

# Sentinel for the country-wide search. The scraper looks up the
# Glassdoor "Nation" location id (locationType "N") instead of a city.
COUNTRYWIDE = "Deutschland"

# Single flat list — same shape as the LinkedIn scraper so a merged
# dataset has consistent geographic coverage across both sources.
TARGET_CITIES = [
    COUNTRYWIDE,
    # Top metro areas
    "Berlin", "Hamburg", "München", "Köln", "Frankfurt am Main",
    "Stuttgart", "Düsseldorf", "Leipzig", "Dortmund", "Essen",
    "Bremen", "Dresden", "Hannover",
    # Bavaria / Baden-Württemberg tech hubs
    "Ulm", "Augsburg", "Böblingen", "Karlsruhe", "Heidelberg", "Mannheim",
    "Darmstadt", "Freiburg", "Heilbronn", "Nürnberg", "Erlangen",
    "Herzogenaurach", "Ditzingen", "Renningen", "Immenstaad", "Kitzingen",
    "Ingolstadt", "Regensburg", "Sindelfingen", "Friedrichshafen",
    "Ottobrunn", "Tübingen", "Konstanz", "Würzburg",
    # Rhein/Ruhr + central
    "Wiesbaden", "Mörfelden-Walldorf", "Mainz", "Bonn", "Aachen",
    "Bochum", "Duisburg", "Saarbrücken", "Koblenz", "Göttingen",
    "Bielefeld", "Münster", "Paderborn",
    # North + East
    "Wolfsburg", "Braunschweig", "Kiel", "Lübeck", "Rostock", "Potsdam",
    "Erfurt", "Jena", "Magdeburg", "Halle", "Chemnitz",
]


class CityGlassdoorScraper:
    BASE_URL = "https://www.glassdoor.de"
    SEARCH_URL = f"{BASE_URL}/job-search-next/bff/jobSearchResultsQuery"
    LOCATION_URL = f"{BASE_URL}/findPopularLocationAjax.htm"
    RESULTS_PER_PAGE = 30

    def __init__(self, delay_range=(2.5, 5.0)):
        self.delay_range = delay_range
        self.session = curl_requests.Session(impersonate="chrome")
        self.session.headers.update({
            "Origin": self.BASE_URL,
            "Referer": f"{self.BASE_URL}/",
            "Accept": "*/*",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
        })
        self.city_id_cache: dict[str, dict] = {}

    def init_session(self):
        print("Initializing session (visiting homepage)...")
        resp = self.session.get(self.BASE_URL, timeout=15)
        if resp.status_code != 200:
            raise RuntimeError(f"Failed to init session: HTTP {resp.status_code}")
        print(f"Session initialized. Cookies: {list(self.session.cookies.keys())}")

    def lookup_city_id(self, city_name: str) -> dict | None:
        """Look up the Glassdoor location id for a city or for the
        Deutschland-wide sentinel via autocomplete.

        Returns None on timeout / network error rather than raising —
        Glassdoor's anti-bot throttle starts dropping connections rather
        than returning errors, and a single timed-out city should not
        crash the whole scrape.
        """
        if city_name in self.city_id_cache:
            return self.city_id_cache[city_name]

        try:
            resp = self.session.get(
                self.LOCATION_URL,
                params={"term": city_name, "maxLocationsToReturn": 5},
                timeout=20,
            )
        except Exception as e:
            print(f"  Location lookup network error for '{city_name}': {e}")
            return None

        if resp.status_code != 200:
            print(f"  Location lookup failed for '{city_name}': HTTP {resp.status_code}")
            return None

        try:
            results = resp.json()
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
            resp = self.session.post(self.SEARCH_URL, json=payload, timeout=15)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (502, 503, 429) and attempt < 2:
                wait = (attempt + 1) * 5 + random.uniform(1, 3)
                print(f"    HTTP {resp.status_code}, retrying in {wait:.0f}s...")
                time.sleep(wait)
                continue
            raise RuntimeError(f"Search failed: HTTP {resp.status_code}")

    def search_city_keyword(
        self, keyword: str, city_name: str, city_id: int, max_jobs: int = 500,
        location_type: str = "CITY",
    ) -> list[dict]:
        jobs = []
        cursor = None
        page = 1

        while len(jobs) < max_jobs:
            try:
                data = self._search_page(keyword, city_name, city_id, page, cursor, location_type)
            except Exception as e:
                print(f"    Error on page {page}: {e}")
                try:
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
        """Scrape all keywords for one location (city or the country
        sentinel). Returns stats + new jobs."""
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
        description="City-targeted Glassdoor AI job scraper"
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
        "--max-per-city", type=int, default=200,
        help="Max jobs per city (default: 200)",
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
    scraper.init_session()

    all_jobs: list[dict] = []
    all_stats: list[dict] = []
    global_seen: set[str] = set()

    for idx, city in enumerate(cities, start=1):
        progress.city_start(city, idx, len(cities))
        try:
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

    progress.finished({"jobs": len(all_jobs), "cities": len(cities)})

    if all_jobs:
        save_results(all_jobs, all_stats, output_dir, run_ts)
        print(f"\nDone! Collected {len(all_jobs)} unique jobs across {len(cities)} cities.")
    else:
        print("\nNo jobs collected.")


if __name__ == "__main__":
    main()
