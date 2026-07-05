#!/usr/bin/env python3
"""City-targeted LinkedIn scraper.

Searches AI jobs per city instead of country-wide "Germany".
Uses the guest API with city-specific location strings.
Logs how many new entries each city yields compared to existing data.

Usage:
    python scrape_linkedin_cities.py --existing-json data/linkedin_jobs_20260511_031120.json
    python scrape_linkedin_cities.py --cities Ulm Stuttgart München --max-per-city 200
"""

import json
import time
import random
import argparse
from pathlib import Path
from datetime import datetime

from curl_cffi import requests as curl_requests
from bs4 import BeautifulSoup

from ._cities import COUNTRYWIDE, KEYWORDS, SEARCH_DISTANCE_MILES, TARGET_CITIES
from ._progress import ProgressLog


SEARCH_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
DETAIL_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}"
RESULTS_PER_PAGE = 10
MAX_START = 999

# LinkedIn "Date posted" filter (the f_TPR query param). The value is
# `r<seconds-ago>` — the same encoding the web UI's dropdown sends. A tight
# window cuts result pages dramatically vs. all-time and avoids re-fetching
# stale postings. Selected via --since; see TIME_WINDOWS below.
TIME_WINDOWS: dict[str, str | None] = {
    "24h": "r86400",     # past 24 hours  — daily cron
    "3days": "r259200",  # past 3 days
    "week": "r604800",   # past 7 days    — initial backfill
    "month": "r2592000", # past 30 days
    "any": None,         # no time filter (omit f_TPR)
}
DEFAULT_SINCE = "week"


def new_session() -> curl_requests.Session:
    session = curl_requests.Session(impersonate="chrome")
    session.headers.update({
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
    })
    return session


def parse_card(card) -> dict | None:
    urn_el = card.find("div", {"data-entity-urn": True})
    if not urn_el:
        return None

    urn = urn_el["data-entity-urn"]
    job_id = urn.split(":")[-1] if urn else ""

    title_el = card.find("h3", class_="base-search-card__title")
    company_el = card.find("h4", class_="base-search-card__subtitle")
    location_el = card.find("span", class_="job-search-card__location")
    date_el = card.find("time")
    link_el = card.find("a", class_="base-card__full-link")
    salary_el = card.find("span", class_="job-search-card__salary-info")

    return {
        "job_id": job_id,
        "title": title_el.text.strip() if title_el else "",
        "company": company_el.text.strip() if company_el else "",
        "location": location_el.text.strip() if location_el else "",
        "date_posted": date_el["datetime"] if date_el and date_el.has_attr("datetime") else "",
        "posted_ago": date_el.text.strip() if date_el else "",
        "salary": salary_el.text.strip() if salary_el else "",
        "url": link_el["href"].split("?")[0] if link_el else "",
    }


RATE_LIMIT_BACKOFFS = (30.0, 60.0, 120.0)


def _get_with_backoff(
    session: curl_requests.Session, url: str, params: dict | None = None,
) -> object | None:
    """GET that retries on HTTP 429 with progressively longer sleeps.

    LinkedIn's guest API tolerates short bursts but returns 429 with a
    792-byte body when its sliding rate limit is exceeded. Treating that
    as an 'empty page' (the prior behaviour) aborted the current keyword
    after two consecutive 429s, then immediately moved to the next
    keyword and tripped the same limit. The backoff lets the limit
    window slide; usually one 30s wait is enough.
    """
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
    return resp  # final 429 — caller decides


def fetch_detail(session: curl_requests.Session, job_id: str) -> dict:
    url = DETAIL_URL.format(job_id=job_id)
    resp = _get_with_backoff(session, url)
    if resp is None or resp.status_code != 200:
        return {}

    soup = BeautifulSoup(resp.text, "lxml")

    desc_el = soup.find("div", class_="description__text")
    description = desc_el.get_text(" ", strip=True) if desc_el else ""

    LABEL_MAP = {
        "seniority level": "seniority_level",
        "karrierestufe": "seniority_level",
        "employment type": "employment_type",
        "beschäftigungsverhältnis": "employment_type",
        "job function": "job_function",
        "tätigkeitsbereich": "job_function",
        "industries": "industries",
        "branchen": "industries",
    }
    criteria = {}
    for item in soup.find_all("li", class_="description__job-criteria-item"):
        label = item.find("h3")
        value = item.find("span")
        if label and value:
            raw = label.text.strip().lower()
            key = LABEL_MAP.get(raw, raw.replace(" ", "_"))
            criteria[key] = value.text.strip()

    return {
        "description": description,
        "seniority_level": criteria.get("seniority_level", ""),
        "employment_type": criteria.get("employment_type", ""),
        "job_function": criteria.get("job_function", ""),
        "industries": criteria.get("industries", ""),
    }


def search_page(
    session: curl_requests.Session, keyword: str, start: int, city: str,
    time_posted_range: str | None,
) -> list[dict]:
    # Country-wide sweep: drop the city prefix and search Germany as a whole.
    location = "Germany" if city == COUNTRYWIDE else f"{city}, Germany"
    params = {
        "keywords": keyword,
        "location": location,
        "start": start,
        "sortBy": "R",
    }
    # Time window (f_TPR). None == "any time" → omit the param entirely.
    if time_posted_range:
        params["f_TPR"] = time_posted_range
    # Per-city searches use a radius so neighbouring towns aren't missed
    # (e.g. Neu-Ulm around Ulm). The nation-wide sweep needs no radius.
    if city != COUNTRYWIDE:
        params["distance"] = SEARCH_DISTANCE_MILES
    resp = _get_with_backoff(session, SEARCH_URL, params=params)
    if resp is None or resp.status_code != 200:
        return []

    soup = BeautifulSoup(resp.text, "lxml")
    cards = soup.find_all("li")
    jobs = []
    for card in cards:
        parsed = parse_card(card)
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
    time_posted_range: str | None,
) -> dict:
    """Scrape all keywords for one city. Returns stats + new jobs."""
    print(f"\n{'='*60}")
    print(f"CITY: {city}")
    print(f"{'='*60}")

    seen_ids: set[str] = set()
    all_jobs: list[dict] = []

    for kw in KEYWORDS:
        remaining = max_per_city - len(all_jobs)
        if remaining <= 0:
            break

        print(f"  [{kw}] searching in {city}...")
        start = 0
        consecutive_empty = 0
        kw_new = 0

        while start <= MAX_START and len(all_jobs) < max_per_city:
            try:
                page_jobs = search_page(session, kw, start, city, time_posted_range)
            except Exception as e:
                print(f"    Error at start={start}: {e}")
                break

            if not page_jobs:
                consecutive_empty += 1
                if consecutive_empty >= 2:
                    break
                start += RESULTS_PER_PAGE
                time.sleep(random.uniform(*delay_range))
                continue

            consecutive_empty = 0
            page_new = 0
            for job in page_jobs:
                if job["job_id"] in seen_ids:
                    continue
                seen_ids.add(job["job_id"])

                if fetch_descriptions:
                    time.sleep(random.uniform(delay_range[0] * 0.5, delay_range[1] * 0.5))
                    detail = fetch_detail(session, job["job_id"])
                    job.update(detail)

                all_jobs.append(job)
                page_new += 1
                kw_new += 1
                if len(all_jobs) >= max_per_city:
                    break

            if page_new == 0:
                consecutive_empty += 1
                if consecutive_empty >= 2:
                    break

            start += RESULTS_PER_PAGE
            time.sleep(random.uniform(*delay_range))

        print(f"    → {kw_new} new unique jobs")

    new_ids = seen_ids - existing_ids
    duplicate_ids = seen_ids & existing_ids

    stats = {
        "city": city,
        "total_unique": len(seen_ids),
        "new_vs_existing": len(new_ids),
        "duplicates": len(duplicate_ids),
    }

    print(f"\n  RESULT for {city}:")
    print(f"    Total unique listings: {stats['total_unique']}")
    print(f"    NEW (not in existing):  {stats['new_vs_existing']}")
    print(f"    Duplicates:             {stats['duplicates']}")

    return {"stats": stats, "jobs": all_jobs}


def load_existing_ids(json_path: str) -> set[str]:
    if not json_path or not Path(json_path).exists():
        return set()
    with open(json_path, encoding="utf-8") as f:
        jobs = json.load(f)
    ids = set()
    for j in jobs:
        jid = j.get("job_id", "")
        if jid:
            ids.add(str(jid))
    print(f"Loaded {len(ids)} existing job IDs from {json_path}")
    return ids


def save_partial(
    all_jobs: list[dict],
    city_stats: list[dict],
    output_dir: Path,
    timestamp: str,
) -> None:
    """Atomic per-city snapshot so a killed run keeps the work done so far.

    Final `save_results` still writes the canonical `linkedin_cities_<ts>.json`
    at run end; this writes a separate `_partial_` file overwritten after every
    city. merge.py can fall back to the partial when the final isn't present.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    partial = output_dir / f"linkedin_cities_partial_{timestamp}.json"
    tmp = partial.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(all_jobs, f, ensure_ascii=False)
    tmp.replace(partial)
    # city_stats are already mirrored in the progress jsonl; no need to dup


def save_results(
    all_jobs: list[dict],
    city_stats: list[dict],
    output_dir: Path,
    timestamp: str | None = None,
):
    output_dir.mkdir(parents=True, exist_ok=True)
    if timestamp is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    json_path = output_dir / f"linkedin_cities_{timestamp}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(all_jobs, f, ensure_ascii=False, indent=2)
    print(f"\nJSON saved: {json_path} ({len(all_jobs)} jobs)")

    log_path = output_dir / f"linkedin_cities_log_{timestamp}.json"
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(city_stats, f, ensure_ascii=False, indent=2)
    print(f"City log:   {log_path}")

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

    return json_path, log_path


def main():
    parser = argparse.ArgumentParser(
        description="City-targeted LinkedIn AI job scraper"
    )
    parser.add_argument(
        "--existing-json", type=str, default=None,
        help="Path to existing LinkedIn JSON for dedup comparison (optional)",
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
        "--delay-min", type=float, default=8.0,
        help="Min delay between requests (default: 8.0)",
    )
    parser.add_argument(
        "--delay-max", type=float, default=15.0,
        help="Max delay between requests (default: 15.0)",
    )
    parser.add_argument(
        "--no-descriptions", action="store_true",
        help="Skip fetching full job descriptions (much faster)",
    )
    parser.add_argument(
        "--since", choices=list(TIME_WINDOWS), default=DEFAULT_SINCE,
        help=(
            "Date-posted window (LinkedIn f_TPR). 24h = daily cron, "
            f"week = initial backfill (default: {DEFAULT_SINCE})"
        ),
    )
    args = parser.parse_args()

    time_posted_range = TIME_WINDOWS[args.since]
    print(f"Date-posted window: --since {args.since} (f_TPR={time_posted_range or 'none'})")

    existing_ids = load_existing_ids(args.existing_json)

    cities = args.cities if args.cities else TARGET_CITIES
    print(f"\nWill scrape {len(cities)} cities: {', '.join(cities)}")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    run_ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    progress = ProgressLog(output_dir, "linkedin", run_ts)
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
                time_posted_range=time_posted_range,
            )
        except Exception as e:
            all_stats.append({"city": city, "error": str(e)})
            progress.city_error(city, idx, len(cities), str(e))
            continue

        if "error" in result:
            all_stats.append({"city": city, "error": result["error"]})
            progress.city_error(city, idx, len(cities), result["error"])
            continue

        for job in result["jobs"]:
            jid = str(job.get("job_id", ""))
            if jid and jid not in global_seen:
                global_seen.add(jid)
                all_jobs.append(job)

        all_stats.append(result["stats"])
        progress.city_done(city, idx, len(cities), result["stats"])
        save_partial(all_jobs, all_stats, output_dir, run_ts)
        time.sleep(random.uniform(5.0, 10.0))

    progress.finished({"jobs": len(all_jobs), "cities": len(cities)})

    if all_jobs:
        save_results(all_jobs, all_stats, output_dir, run_ts)
        print(f"\nDone! Collected {len(all_jobs)} unique jobs across {len(cities)} cities.")
    else:
        print("\nNo jobs collected.")


if __name__ == "__main__":
    main()
