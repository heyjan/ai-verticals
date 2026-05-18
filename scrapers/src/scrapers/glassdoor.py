#!/usr/bin/env python3
"""Glassdoor Germany AI job scraper using the internal BFF API."""

import json
import time
import random
import argparse
import csv
from pathlib import Path
from datetime import datetime

from curl_cffi import requests as curl_requests


class GlassdoorScraper:
    BASE_URL = "https://www.glassdoor.de"
    SEARCH_URL = f"{BASE_URL}/job-search-next/bff/jobSearchResultsQuery"
    RESULTS_PER_PAGE = 30

    def __init__(self, delay_range=(2.0, 4.0)):
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

    def init_session(self):
        """Visit homepage to acquire Cloudflare and session cookies."""
        print("Initializing session (visiting homepage)...")
        resp = self.session.get(self.BASE_URL, timeout=15)
        if resp.status_code != 200:
            raise RuntimeError(f"Failed to init session: HTTP {resp.status_code}")
        print(f"Session initialized. Cookies: {list(self.session.cookies.keys())}")

    def _search_page(self, keyword: str, page: int, cursor: str | None = None) -> dict:
        payload = {
            "keyword": keyword,
            "locationId": 96,
            "locationType": "COUNTRY",
            "numJobsToShow": self.RESULTS_PER_PAGE,
            "pageNumber": page,
            "pageCursor": cursor,
            "pageType": "SERP",
            "seoUrl": True,
            "filterParams": [],
            "parameterUrlInput": "IL.0,11_IN96_KO12,35",
            "seoFriendlyUrlInput": "deutschland-artificial-intelligence-jobs",
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
            raise RuntimeError(
                f"Search failed: HTTP {resp.status_code} — {resp.text[:200]}"
            )

    def search_jobs(self, keyword: str, max_jobs: int = 1000) -> list[dict]:
        """Paginate through search results for a single keyword."""
        jobs = []
        cursor = None
        page = 1

        while len(jobs) < max_jobs:
            print(f"  [{keyword}] page {page} — {len(jobs)} jobs so far")
            try:
                data = self._search_page(keyword, page, cursor)
            except Exception as e:
                print(f"  Error on page {page}: {e}")
                print("  Re-initializing session and retrying...")
                try:
                    self.init_session()
                    time.sleep(random.uniform(3, 6))
                    data = self._search_page(keyword, page, cursor)
                except Exception:
                    print(f"  Retry failed, stopping this keyword.")
                    break

            job_listings = (data.get("data") or {}).get("jobListings") or {}
            listings = job_listings.get("jobListings") or []
            if not listings:
                print(f"  No more listings on page {page}")
                break

            jobs.extend(listings)

            cursors = job_listings.get("paginationCursors") or []
            next_cursor = None
            for c in cursors:
                if c.get("pageNumber", 0) == page + 1:
                    next_cursor = c.get("cursor")
                    break
            if not next_cursor and cursors:
                next_cursor = cursors[-1].get("cursor")

            if not next_cursor:
                print(f"  No next page cursor after page {page}")
                break

            cursor = next_cursor
            page += 1
            time.sleep(random.uniform(*self.delay_range))

        return jobs[:max_jobs]

    def scrape_all(self, keywords: list[str], max_total: int = 1000) -> list[dict]:
        """Scrape across multiple keywords, deduplicating by listing ID.

        Each keyword is paginated fully (up to max_total remaining) before
        moving on. This avoids the earlier bug where per_keyword was capped
        too low.
        """
        self.init_session()
        seen_ids: set[str] = set()
        all_jobs: list[dict] = []

        for kw in keywords:
            remaining = max_total - len(all_jobs)
            if remaining <= 0:
                break

            print(f"\nSearching: '{kw}' (need {remaining} more unique jobs)")
            jobs = self.search_jobs(kw, max_jobs=remaining + 200)

            new = 0
            for job in jobs:
                listing_id = (
                    job.get("jobview", {}).get("job", {}).get("listingId")
                )
                if listing_id and listing_id not in seen_ids:
                    seen_ids.add(listing_id)
                    all_jobs.append(job)
                    new += 1
                    if len(all_jobs) >= max_total:
                        break
            print(f"  Got {len(jobs)} results, {new} new unique jobs (total: {len(all_jobs)})")

            if len(all_jobs) >= max_total:
                break
            time.sleep(random.uniform(3.0, 6.0))

        return all_jobs[:max_total]


def flatten_job(job: dict) -> dict:
    """Extract a flat dict of useful fields from the nested API response."""
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


def save_results(jobs: list[dict], output_dir: Path):
    """Save raw JSON and a flattened CSV."""
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    json_path = output_dir / f"glassdoor_jobs_{timestamp}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(jobs, f, ensure_ascii=False, indent=2)
    print(f"\nRaw JSON saved: {json_path} ({len(jobs)} jobs)")

    flat = [flatten_job(j) for j in jobs]
    csv_path = output_dir / f"glassdoor_jobs_{timestamp}.csv"
    if flat:
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=flat[0].keys())
            writer.writeheader()
            writer.writerows(flat)
        print(f"CSV saved:      {csv_path}")

    return json_path, csv_path


def main():
    parser = argparse.ArgumentParser(description="Scrape AI jobs from Glassdoor Germany")
    parser.add_argument(
        "--max-jobs", type=int, default=1000,
        help="Maximum number of jobs to collect (default: 1000)",
    )
    parser.add_argument(
        "--output-dir", type=str, default="data/raw",
        help="Output directory for results (default: data/raw)",
    )
    parser.add_argument(
        "--delay-min", type=float, default=2.0,
        help="Minimum delay between requests in seconds (default: 2.0)",
    )
    parser.add_argument(
        "--delay-max", type=float, default=4.0,
        help="Maximum delay between requests in seconds (default: 4.0)",
    )
    args = parser.parse_args()

    keywords = [
        "artificial intelligence",
        "AI",
        "Data & AI",
        "Künstliche Intelligenz",
        "NLP natural language processing",
        "computer vision",
        "data scientist AI",
        "generative AI LLM",
    ]

    scraper = GlassdoorScraper(delay_range=(args.delay_min, args.delay_max))
    jobs = scraper.scrape_all(keywords, max_total=args.max_jobs)

    if jobs:
        save_results(jobs, Path(args.output_dir))
        print(f"\nDone! Collected {len(jobs)} unique jobs.")
    else:
        print("\nNo jobs collected. Glassdoor may have blocked the session.")
        print("Try again with longer delays (--delay-min 4 --delay-max 8)")


if __name__ == "__main__":
    main()
