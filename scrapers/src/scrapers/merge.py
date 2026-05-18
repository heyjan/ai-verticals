#!/usr/bin/env python3
"""Merge and deduplicate LinkedIn + Glassdoor job datasets."""

import json
import re
import unicodedata
import argparse
from pathlib import Path
from datetime import datetime

from rapidfuzz import fuzz


def normalize(text: str) -> str:
    """Lowercase, strip accents, collapse whitespace, remove punctuation."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text


def normalize_company(name: str) -> str:
    """Normalize company name for comparison — strip suffixes like GmbH, AG, etc."""
    n = normalize(name)
    for suffix in ("gmbh", "ag", "se", "inc", "ltd", "co kg", "mbh", "e v",
                   "kg", "ohg", "ug", "corp", "corporation", "llc", "group",
                   "holding", "deutschland", "germany", "europe", "eu"):
        n = re.sub(rf"\b{suffix}\b", "", n)
    return re.sub(r"\s+", " ", n).strip()


def extract_city(location: str) -> str:
    """Pull the city from a location string (first component before comma)."""
    if not location:
        return ""
    return location.split(",")[0].strip()


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
        "contract_type": "",
        "sector": "",
        "url": h.get("seoJobLink") or "",
    }


def is_duplicate(a: dict, b: dict, title_threshold: int = 80, company_threshold: int = 75) -> bool:
    """Determine if two jobs are duplicates using fuzzy matching on title + company + city."""
    norm_title_a = normalize(a["title"])
    norm_title_b = normalize(b["title"])
    norm_comp_a = normalize_company(a["company"])
    norm_comp_b = normalize_company(b["company"])
    norm_city_a = normalize(a["city"])
    norm_city_b = normalize(b["city"])

    # Exact match on normalized title + company
    if norm_title_a == norm_title_b and norm_comp_a == norm_comp_b:
        return True

    title_score = fuzz.token_sort_ratio(norm_title_a, norm_title_b)
    company_score = fuzz.token_sort_ratio(norm_comp_a, norm_comp_b)

    if title_score < title_threshold or company_score < company_threshold:
        return False

    # If title and company match closely, check city doesn't contradict
    if norm_city_a and norm_city_b:
        city_score = fuzz.ratio(norm_city_a, norm_city_b)
        if city_score < 60:
            return False

    return True


def merge_duplicate(existing: dict, new: dict) -> dict:
    """Merge two duplicate records, preferring the one with more data."""
    merged = dict(existing)
    merged["source"] = f"{existing['source']}+{new['source']}"

    # For each field, prefer the non-empty / longer value
    for field in ("description", "salary", "job_level", "posted_ago",
                  "contract_type", "sector", "location"):
        old_val = existing.get(field, "")
        new_val = new.get(field, "")
        if not old_val and new_val:
            merged[field] = new_val
        elif old_val and new_val and len(new_val) > len(old_val):
            merged[field] = new_val

    return merged


def deduplicate(jobs: list[dict]) -> list[dict]:
    """Deduplicate using blocking on normalized company + fuzzy title matching."""
    # Build blocks by normalized company name for O(n*k) instead of O(n^2)
    blocks: dict[str, list[int]] = {}
    unique: list[dict] = []

    for job in jobs:
        comp_key = normalize_company(job["company"])
        matched = False

        if comp_key in blocks:
            for idx in blocks[comp_key]:
                if is_duplicate(unique[idx], job):
                    unique[idx] = merge_duplicate(unique[idx], job)
                    matched = True
                    break

        if not matched:
            idx = len(unique)
            unique.append(job)
            blocks.setdefault(comp_key, []).append(idx)

    return unique


def main():
    parser = argparse.ArgumentParser(description="Merge LinkedIn + Glassdoor job datasets")
    parser.add_argument("--linkedin", type=str, required=True, help="Path to LinkedIn JSON")
    parser.add_argument("--glassdoor", type=str, required=True, help="Path to Glassdoor JSON")
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
    args = parser.parse_args()

    print("Loading datasets...")
    with open(args.linkedin, encoding="utf-8") as f:
        li_raw = json.load(f)
    with open(args.glassdoor, encoding="utf-8") as f:
        gd_raw = json.load(f)

    print(f"  LinkedIn:  {len(li_raw)} jobs")
    print(f"  Glassdoor: {len(gd_raw)} jobs")

    print("\nParsing into unified format...")
    all_jobs = []
    all_jobs.extend(parse_linkedin(j) for j in li_raw)
    all_jobs.extend(parse_glassdoor(j) for j in gd_raw)
    print(f"  Combined:  {len(all_jobs)} jobs before dedup")

    print("\nDeduplicating (fuzzy company + title + city matching)...")
    unique = deduplicate(all_jobs)

    cross_dupes = sum(1 for j in unique if "+" in j["source"])
    print(f"  Unique:    {len(unique)} jobs")
    print(f"  Cross-source duplicates merged: {cross_dupes}")
    print(f"  Removed:   {len(all_jobs) - len(unique)} duplicates")

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
