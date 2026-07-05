#!/usr/bin/env python3
"""Dry-run: dedup a NEW scraped batch against the EXISTING kept dataset.

merge.py only deduplicates *within* the batch being merged — it never
compares new postings against jobs already in the database. For per-source
backfills that is a real gap: a repost of a job we already kept comes back
with a fresh source_id and slips in as a brand-new row (the SQL upsert only
collapses on exact (source, source_id)).

This harness answers, without writing anything: of the new jobs, how many
are already in the DB according to the production ML matcher, and are those
matches accurate? Run it before importing a backfill to see what the merge
step would miss.

Usage (inside the scrapers image, data mounted):
    python -m scrapers.dedup_dbtest \
        --new      data/raw/linkedin_cities_YYYYMMDD_HHMMSS.json \
        --existing data/processed/db_salary_jobs.json
"""

import argparse
import json
from collections import defaultdict
from pathlib import Path

from rapidfuzz import fuzz

from .dedup import DEFAULT_MODEL_PATH, build_match_fn
from .dedup.text import normalize, normalize_company
from .merge import parse_linkedin

# Source-specific parsers, so --new can point at any raw scrape file.
PARSERS = {"linkedin": parse_linkedin}


def _short(s: str, n: int) -> str:
    s = (s or "").replace("\n", " ")
    return s[:n]


def main() -> None:
    ap = argparse.ArgumentParser(description="Dedup a new batch against the existing DB dataset (dry run)")
    ap.add_argument("--new", required=True, help="Raw scrape JSON (the unmerged backfill)")
    ap.add_argument("--existing", required=True, help="JSON array of existing DB jobs to compare against")
    ap.add_argument("--source", default="linkedin", choices=sorted(PARSERS), help="Parser for --new")
    ap.add_argument("--model", default=DEFAULT_MODEL_PATH, help="Dedup model artifact (fuzzy fallback if absent)")
    ap.add_argument("--show", type=int, default=40, help="How many matched pairs to print")
    ap.add_argument("--export-pairs", metavar="PATH",
                    help="Write the confirmed matches as labeled training pairs (label=1, "
                         "descriptions on both sides) for retraining the dedup model")
    args = ap.parse_args()

    parse = PARSERS[args.source]
    new_raw = json.loads(Path(args.new).read_text(encoding="utf-8"))
    new = [parse(j) for j in new_raw]
    existing = json.loads(Path(args.existing).read_text(encoding="utf-8"))

    print(f"new batch ({args.source}): {len(new)} jobs")
    print(f"existing DB set:         {len(existing)} jobs")

    match_fn, desc = build_match_fn(args.model)
    print(f"matcher: {desc}\n")

    # Block existing jobs by normalized company (same blocking the merge uses),
    # then test each new job against the existing jobs in its block.
    blocks: dict[str, list[dict]] = defaultdict(list)
    for j in existing:
        blocks[normalize_company(j.get("company", ""))].append(j)

    hits: list[tuple[dict, dict]] = []
    for nj in new:
        for ej in blocks.get(normalize_company(nj.get("company", "")), ()):
            if match_fn(ej, nj):
                hits.append((nj, ej))
                break

    n = len(hits)
    print(f"=== RESULT ===")
    print(f"new jobs already in DB (per matcher): {n} / {len(new)} ({100 * n / max(len(new), 1):.1f}%)")
    if n:
        exact = sum(1 for nj, ej in hits
                    if normalize(nj.get("title", "")) == normalize(ej.get("title", "")))
        high = sum(1 for nj, ej in hits
                   if normalize(nj.get("title", "")) != normalize(ej.get("title", ""))
                   and fuzz.token_sort_ratio(normalize(nj.get("title", "")),
                                             normalize(ej.get("title", ""))) >= 90)
        risky = n - exact - high
        print(f"  exact normalized title (unambiguous): {exact} ({100 * exact / n:.0f}%)")
        print(f"  fuzzy >=90 (near-certain):            {high} ({100 * high / n:.0f}%)")
        print(f"  fuzzy <90 (judgment calls):           {risky} ({100 * risky / n:.0f}%)")

    print(f"\n=== matched pairs (NEW vs EXISTING-in-DB), showing {min(n, args.show)} ===")
    # Show fuzzy judgment calls first — those are the ones worth eyeballing.
    def rank(pair):
        nj, ej = pair
        ta, tb = normalize(nj.get("title", "")), normalize(ej.get("title", ""))
        return 200 if ta == tb else fuzz.token_sort_ratio(ta, tb)

    for nj, ej in sorted(hits, key=rank)[: args.show]:
        ta, tb = normalize(nj.get("title", "")), normalize(ej.get("title", ""))
        tag = "EXACT" if ta == tb else f"~{fuzz.token_sort_ratio(ta, tb):.0f}"
        same_city = "same-city" if nj.get("city") == ej.get("city") else f"{nj.get('city')}!={ej.get('city')}"
        print(f"  [{tag:>5}] {same_city}")
        print(f"    NEW: {_short(nj.get('title',''), 50):<50} | {_short(nj.get('company',''),22):<22}")
        print(f"    DB : {_short(ej.get('title',''), 50):<50} | {_short(ej.get('company',''),22):<22} | salary={_short(ej.get('salary',''),22)} id={ej.get('source_id','')}")
        print()

    if args.export_pairs:
        # Each confirmed match is a positive (label=1) training pair with the
        # full title + description on both sides — no corpus reconstruction
        # needed (unlike judge_pairs). `score` lets a reviewer triage: EXACT /
        # >=90 are safe to keep; the few <90 judgment calls should be eyeballed
        # before folding in (e.g. the one borderline Developer↔AI-Engineer pair).
        def rec(j: dict) -> dict:
            return {k: j.get(k, "") for k in ("title", "company", "city", "description")}

        out = []
        for nj, ej in hits:
            ta, tb = normalize(nj.get("title", "")), normalize(ej.get("title", ""))
            out.append({
                "a": rec(nj), "b": rec(ej), "label": 1,
                "score": "exact" if ta == tb else round(fuzz.token_sort_ratio(ta, tb), 1),
                "db_source_id": ej.get("source_id", ""),
            })
        Path(args.export_pairs).write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"exported {len(out)} labeled pairs -> {args.export_pairs}")


if __name__ == "__main__":
    main()
