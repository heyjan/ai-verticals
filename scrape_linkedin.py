#!/usr/bin/env python3
"""LinkedIn Germany job scraper using the public guest API (no login required)."""

import json
import re
import time
import random
import argparse
from pathlib import Path
from datetime import datetime

from curl_cffi import requests as curl_requests
from bs4 import BeautifulSoup


SEARCH_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
DETAIL_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}"
RESULTS_PER_PAGE = 10
MAX_START = 999


def new_session() -> curl_requests.Session:
    session = curl_requests.Session(impersonate="chrome")
    session.headers.update({
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
    })
    return session


def parse_card(card) -> dict | None:
    """Extract job metadata from a search result card."""
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


def fetch_detail(session: curl_requests.Session, job_id: str) -> dict:
    """Fetch the full job detail page for description and criteria."""
    url = DETAIL_URL.format(job_id=job_id)
    try:
        resp = session.get(url, timeout=15)
        if resp.status_code != 200:
            return {}
    except Exception:
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


def search_page(session: curl_requests.Session, keyword: str, start: int,
                geo_id: str = "101282230") -> list[dict]:
    """Fetch one page of search results (10 jobs)."""
    params = {
        "keywords": keyword,
        "location": "Germany",
        "geoId": geo_id,
        "start": start,
        "sortBy": "R",
    }
    resp = session.get(SEARCH_URL, params=params, timeout=15)
    if resp.status_code != 200:
        return []

    soup = BeautifulSoup(resp.text, "lxml")
    cards = soup.find_all("li")
    jobs = []
    for card in cards:
        parsed = parse_card(card)
        if parsed:
            jobs.append(parsed)
    return jobs


def scrape_keyword(session: curl_requests.Session, keyword: str,
                   max_jobs: int, delay_range: tuple[float, float],
                   fetch_descriptions: bool, seen_ids: set[str]) -> list[dict]:
    """Scrape all pages for a single keyword, skipping already-seen job IDs."""
    jobs = []
    start = 0
    consecutive_empty = 0

    while start <= MAX_START and len(jobs) < max_jobs:
        print(f"  [{keyword}] start={start} — {len(jobs)} jobs so far")
        try:
            page_jobs = search_page(session, keyword, start)
        except Exception as e:
            print(f"    Error at start={start}: {e}")
            break

        if not page_jobs:
            consecutive_empty += 1
            if consecutive_empty >= 2:
                print(f"  No more results after start={start}")
                break
            start += RESULTS_PER_PAGE
            time.sleep(random.uniform(*delay_range))
            continue

        consecutive_empty = 0
        new_count = 0
        for job in page_jobs:
            if job["job_id"] in seen_ids:
                continue
            seen_ids.add(job["job_id"])

            if fetch_descriptions:
                time.sleep(random.uniform(delay_range[0] * 0.5, delay_range[1] * 0.5))
                detail = fetch_detail(session, job["job_id"])
                job.update(detail)

            jobs.append(job)
            new_count += 1
            if len(jobs) >= max_jobs:
                break

        if new_count == 0:
            consecutive_empty += 1
            if consecutive_empty >= 2:
                print(f"  All duplicates, stopping keyword")
                break

        start += RESULTS_PER_PAGE
        time.sleep(random.uniform(*delay_range))

    return jobs


def scrape_all(keywords: list[str], max_total: int,
               delay_range: tuple[float, float],
               fetch_descriptions: bool) -> list[dict]:
    """Scrape across multiple keywords with global deduplication."""
    session = new_session()
    seen_ids: set[str] = set()
    all_jobs: list[dict] = []

    for kw in keywords:
        remaining = max_total - len(all_jobs)
        if remaining <= 0:
            break

        print(f"\nSearching: '{kw}' (need {remaining} more unique jobs)")
        jobs = scrape_keyword(
            session, kw, max_jobs=remaining,
            delay_range=delay_range,
            fetch_descriptions=fetch_descriptions,
            seen_ids=seen_ids,
        )
        all_jobs.extend(jobs)
        print(f"  Got {len(jobs)} new unique jobs (total: {len(all_jobs)})")

        if len(all_jobs) >= max_total:
            break
        time.sleep(random.uniform(5.0, 10.0))

    return all_jobs


def main():
    parser = argparse.ArgumentParser(description="Scrape AI jobs from LinkedIn Germany")
    parser.add_argument(
        "--max-jobs", type=int, default=1000,
        help="Maximum number of jobs to collect (default: 1000)",
    )
    parser.add_argument(
        "--output-dir", type=str, default="data",
        help="Output directory (default: data)",
    )
    parser.add_argument(
        "--delay-min", type=float, default=4.0,
        help="Minimum delay between requests in seconds (default: 4.0)",
    )
    parser.add_argument(
        "--delay-max", type=float, default=8.0,
        help="Maximum delay between requests in seconds (default: 8.0)",
    )
    parser.add_argument(
        "--no-descriptions", action="store_true",
        help="Skip fetching full job descriptions (much faster)",
    )
    args = parser.parse_args()

    keywords = [
        "artificial intelligence",
        "AI engineer",
        "machine learning",
        "deep learning",
        "LLM",
        "NLP",
        "computer vision",
        "generative AI",
        "data scientist AI",
        "MLOps",
        "Künstliche Intelligenz",
        "AI researcher",
    ]

    jobs = scrape_all(
        keywords,
        max_total=args.max_jobs,
        delay_range=(args.delay_min, args.delay_max),
        fetch_descriptions=not args.no_descriptions,
    )

    if not jobs:
        print("\nNo jobs collected.")
        return

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    out_path = output_dir / f"linkedin_jobs_{timestamp}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(jobs, f, ensure_ascii=False, indent=2)
    print(f"\nSaved: {out_path} ({len(jobs)} jobs)")

    has_desc = sum(1 for j in jobs if j.get("description"))
    has_level = sum(1 for j in jobs if j.get("seniority_level"))
    has_salary = sum(1 for j in jobs if j.get("salary"))
    print(f"\nField coverage:")
    print(f"  description:    {has_desc}/{len(jobs)}")
    print(f"  seniority_level: {has_level}/{len(jobs)}")
    print(f"  salary:          {has_salary}/{len(jobs)}")


if __name__ == "__main__":
    main()
