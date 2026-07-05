#!/usr/bin/env python3
"""Merge and deduplicate LinkedIn + Glassdoor + Xing job datasets.

Source-specific parsing and run orchestration live here; all dedup logic
(normalization, matching, clustering, the ML model) lives in the `dedup`
package. The matcher is resolved at runtime — ML model if trained, fuzzy
rule otherwise — see dedup.build_match_fn.
"""

import json
import argparse
from pathlib import Path
from datetime import datetime

from .dedup import (
    DEFAULT_MODEL_PATH,
    build_match_fn,
    canonicalize_company_names,
    deduplicate,
    extract_city,
    merge_duplicate,
)


def parse_linkedin(job: dict) -> dict:
    """Parse LinkedIn job — supports both our scraper and third-party formats."""
    # Our scraper uses "job_id", third-party uses "id"
    source_id = str(job.get("job_id") or job.get("id", ""))
    salary = (job.get("salary") or "").strip()
    return {
        "source": "linkedin",
        "source_id": source_id,
        "title": (job.get("title") or "").strip(),
        "company": (job.get("company") or job.get("companyName") or "").strip(),
        "location": (job.get("location") or "").strip(),
        "city": extract_city(job.get("location") or ""),
        "description": (job.get("description") or "").strip(),
        "salary": salary,
        "job_level": (job.get("seniority_level") or job.get("experienceLevel") or "").strip(),
        "posted_ago": (job.get("posted_ago") or job.get("publishedAt") or "").strip(),
        # Absolute posting date from the card's <time datetime="YYYY-MM-DD">.
        # Unlike posted_ago ("2 days ago") this is a fixed date, which makes
        # verifying scrape freshness / coverage in the DB straightforward.
        "date_posted": (job.get("date_posted") or "").strip(),
        "contract_type": (job.get("employment_type") or job.get("contractType") or "").strip(),
        "sector": (job.get("industries") or job.get("sector") or "").strip(),
        "url": (job.get("url") or job.get("jobUrl") or "").strip(),
    }


def parse_glassdoor(job: dict) -> dict:
    h = job.get("jobview", {}).get("header", {})
    j = job.get("jobview", {}).get("job", {})

    pay = h.get("payPeriodAdjustedPay") or {}
    period = h.get("payPeriod", "")
    currency = h.get("payCurrency", "")
    if pay:
        salary = f"{pay.get('p10', '')}-{pay.get('p90', '')} {currency} ({period.lower()})"
    else:
        salary = ""

    age = h.get("ageInDays")
    if age is not None:
        posted_ago = f"{age} days ago"
    else:
        posted_ago = ""

    return {
        "source": "glassdoor",
        "source_id": str(j.get("listingId", "")),
        "title": (h.get("jobTitleText") or "").strip(),
        "company": (h.get("employerNameFromSearch") or "").strip(),
        "location": (h.get("locationName") or "").strip(),
        "city": extract_city(h.get("locationName") or ""),
        "description": " ".join(j.get("descriptionFragmentsText") or []).strip(),
        "salary": salary,
        "job_level": "",
        "posted_ago": posted_ago,
        # Glassdoor exposes only a relative age (ageInDays), no absolute
        # date — leave blank so the DB's posted_date stays LinkedIn-clean.
        "date_posted": "",
        "contract_type": "",
        "sector": "",
        "url": h.get("seoJobLink") or "",
    }


def parse_xing(job: dict) -> dict:
    """Parse a Xing scraper record into the unified schema."""
    return {
        "source": "xing",
        "source_id": str(job.get("job_id") or ""),
        "title": (job.get("title") or "").strip(),
        "company": (job.get("company") or "").strip(),
        "location": (job.get("location") or "").strip(),
        "city": extract_city(job.get("city") or job.get("location") or ""),
        "description": (job.get("description") or "").strip(),
        "salary": (job.get("salary") or "").strip(),
        "job_level": "",
        "posted_ago": (job.get("date_posted") or "").strip(),
        # Xing's JSON-LD datePosted is ISO 8601 — a real date, kept here
        # too so it can populate the DB's posted_date alongside LinkedIn's.
        "date_posted": (job.get("date_posted") or "").strip(),
        "contract_type": (job.get("employment_type") or "").strip(),
        "sector": (job.get("industries") or "").strip(),
        "url": (job.get("url") or "").strip(),
    }


def main():
    parser = argparse.ArgumentParser(description="Merge LinkedIn + Glassdoor job datasets")
    parser.add_argument("--linkedin", type=str, default=None, help="Path to LinkedIn JSON (optional)")
    parser.add_argument("--glassdoor", type=str, default=None, help="Path to Glassdoor JSON (optional)")
    parser.add_argument("--xing", type=str, default=None, help="Path to Xing JSON (optional)")
    parser.add_argument(
        "--output-dir",
        type=str,
        default="data/processed",
        help="Output directory (default: data/processed)",
    )
    parser.add_argument(
        "--latest-name",
        type=str,
        default="merged-latest.json",
        help="Stable filename for the most recent merge (default: merged-latest.json)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=DEFAULT_MODEL_PATH,
        help=f"Dedup model artifact; falls back to fuzzy if absent (default: {DEFAULT_MODEL_PATH})",
    )
    args = parser.parse_args()

    if not any([args.linkedin, args.glassdoor, args.xing]):
        parser.error("at least one of --linkedin / --glassdoor / --xing is required")

    print("Loading datasets...")
    all_jobs: list[dict] = []

    if args.linkedin:
        with open(args.linkedin, encoding="utf-8") as f:
            li_raw = json.load(f)
        print(f"  LinkedIn:  {len(li_raw)} jobs")
        all_jobs.extend(parse_linkedin(j) for j in li_raw)
    if args.glassdoor:
        with open(args.glassdoor, encoding="utf-8") as f:
            gd_raw = json.load(f)
        print(f"  Glassdoor: {len(gd_raw)} jobs")
        all_jobs.extend(parse_glassdoor(j) for j in gd_raw)
    if args.xing:
        with open(args.xing, encoding="utf-8") as f:
            xg_raw = json.load(f)
        print(f"  Xing:      {len(xg_raw)} jobs")
        all_jobs.extend(parse_xing(j) for j in xg_raw)

    print(f"\nParsing into unified format...\n  Combined:  {len(all_jobs)} jobs before dedup")

    match_fn, matcher_desc = build_match_fn(args.model)
    print(f"\nDeduplicating (blocking on company; matcher: {matcher_desc})...")
    unique = deduplicate(all_jobs, match_fn, merge_duplicate)

    # Collapse prefix-variant company names ('CHECK24 Travel' → 'CHECK24'),
    # then re-dedupe so jobs that became exact duplicates after renaming get
    # merged. Important for cross-source dups where Xing/LinkedIn use the
    # short brand name and Glassdoor uses the full legal entity name.
    unique, renamed = canonicalize_company_names(unique)
    if renamed:
        unique = deduplicate(unique, match_fn, merge_duplicate)

    cross_dupes = sum(1 for j in unique if "+" in j["source"])
    print(f"  Unique:    {len(unique)} jobs")
    print(f"  Cross-source duplicates merged: {cross_dupes}")
    print(f"  Removed:   {len(all_jobs) - len(unique)} duplicates")
    if renamed:
        collapsed_into = sum(1 for src, dst in renamed.items() if src != dst)
        print(f"  Company-name variants collapsed: {collapsed_into}")

    # Save
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    out_path = output_dir / f"merged_jobs_{timestamp}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(unique, f, ensure_ascii=False, indent=2)
    print(f"\nSaved: {out_path}")

    # Update the stable "latest" pointer so downstream consumers (the db
    # import step, the dashboard seed) always read the most recent merge
    # without needing to know the timestamp.
    latest_path = output_dir / args.latest_name
    try:
        if latest_path.is_symlink() or latest_path.exists():
            latest_path.unlink()
        latest_path.symlink_to(out_path.name)
        print(f"Latest: {latest_path} -> {out_path.name}")
    except OSError:
        # Filesystem doesn't support symlinks (e.g. some Windows hosts) -
        # fall back to a copy.
        import shutil
        shutil.copyfile(out_path, latest_path)
        print(f"Latest: {latest_path} (copied)")

    # Summary stats
    sources = {}
    for j in unique:
        for s in j["source"].split("+"):
            sources[s] = sources.get(s, 0) + 1
    print("\nSource breakdown:")
    for s, count in sorted(sources.items()):
        print(f"  {s}: {count}")

    has_desc = sum(1 for j in unique if j["description"])
    has_salary = sum(1 for j in unique if j["salary"])
    has_level = sum(1 for j in unique if j["job_level"] and j["job_level"] != "Not Applicable")
    has_posted = sum(1 for j in unique if j["posted_ago"])
    print(f"\nField coverage ({len(unique)} total):")
    print(f"  description: {has_desc}")
    print(f"  salary:      {has_salary}")
    print(f"  job_level:   {has_level}")
    print(f"  posted_ago:  {has_posted}")


if __name__ == "__main__":
    main()
