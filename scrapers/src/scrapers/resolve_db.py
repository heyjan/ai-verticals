#!/usr/bin/env python3
"""Resolve a merged batch against the existing DB — fold reposts into rows.

merge.py deduplicates only *within* a batch, and the SQL upsert only collapses
exact `(source, source_id)`. So a repost of a job already in the database — a
fresh source_id, or the same role from a different source — lands as a brand
new duplicate row. This step closes that gap: it runs the production matcher of
the new batch against the current DB contents and splits the batch into

  * new    — jobs with no DB match → inserted normally by the importer
  * merges — jobs that match an existing row → emitted as an enrichment of that
             row (its primary-key `id` + the merged field values, `source`
             unioned), so the importer UPDATEs the row in place instead of
             inserting a duplicate.

It reuses the same `build_match_fn` matcher and `merge_duplicate` as merge.py,
so cross-DB dedup behaves identically to within-batch dedup.

Usage (scrapers image, data mounted):
    python -m scrapers.resolve_db \
        --new      data/processed/merged-latest.json \
        --existing data/processed/db_existing.json \
        --out      data/processed/import-resolved.json
"""

import argparse
import json
from collections import defaultdict
from pathlib import Path

from .dedup import DEFAULT_MODEL_PATH, build_match_fn, merge_duplicate
from .dedup.text import normalize_company

# Fields the importer will write onto the matched existing row. `source` is
# unioned by merge_duplicate; the rest follow its "prefer the more complete
# value" rule. title/company/city/url/category are intentionally left as the
# existing row's canonical values and not overwritten.
ENRICH_FIELDS = (
    "source", "description", "salary", "job_level", "posted_ago",
    "date_posted", "contract_type", "sector", "location",
)


def main() -> None:
    ap = argparse.ArgumentParser(description="Resolve a merged batch against the existing DB")
    ap.add_argument("--new", required=True, help="Merged batch JSON (the within-batch-deduped scrape)")
    ap.add_argument("--existing", required=True, help="JSON array of existing DB jobs (must include id)")
    ap.add_argument("--out", required=True, help="Where to write the {new, merges} resolution")
    ap.add_argument("--model", default=DEFAULT_MODEL_PATH, help="Dedup model artifact (fuzzy fallback if absent)")
    args = ap.parse_args()

    new = json.loads(Path(args.new).read_text(encoding="utf-8"))
    existing = json.loads(Path(args.existing).read_text(encoding="utf-8"))

    match_fn, desc = build_match_fn(args.model)
    print(f"new batch: {len(new)} | existing DB: {len(existing)} | matcher: {desc}")

    # Block existing rows by normalized company (same blocking as the merge).
    blocks: dict[str, list[dict]] = defaultdict(list)
    for e in existing:
        blocks[normalize_company(e.get("company", ""))].append(e)

    unmatched: list[dict] = []
    merged_by_id: dict[object, dict] = {}  # existing id -> accumulating merged record
    for nj in new:
        hit = None
        for e in blocks.get(normalize_company(nj.get("company", "")), ()):
            if match_fn(e, nj):
                hit = e
                break
        if hit is None:
            unmatched.append(nj)
            continue
        # Fold into the existing row (accumulate if several new jobs hit one row).
        base = merged_by_id.get(hit["id"], hit)
        merged_by_id[hit["id"]] = merge_duplicate(base, nj)

    merges = [{"id": eid, **{f: rec.get(f, "") for f in ENRICH_FIELDS}}
              for eid, rec in merged_by_id.items()]

    out = {"new": unmatched, "merges": merges}
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    folded = len(new) - len(unmatched)
    print(f"resolved -> {args.out}")
    print(f"  new (insert):              {len(unmatched)}")
    print(f"  folded into existing rows: {folded} new jobs into {len(merges)} rows")


if __name__ == "__main__":
    main()
