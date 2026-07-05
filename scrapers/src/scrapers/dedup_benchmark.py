#!/usr/bin/env python3
"""Benchmark RapidFuzz title scorers for the dedup module.

The dedup step (merge.py) blocks candidates by normalized company name and
then decides duplicates with a fuzzy *title* score. Today that score is
``token_sort_ratio``. token_sort needs roughly the same token *set* (just
reordered), so it under-scores German job titles where one side carries
extra noise — gender suffixes ``(m/w/d)``, seniority prefixes ``(Junior)``,
trailing location/qualifier clauses. This harness measures, on real data,
how three scorers and an optional title-cleaning step change the duplicate
decisions:

    token_sort_ratio   current — order-insensitive, set-sensitive
    token_set_ratio    ignores extra tokens on one side
    WRatio             RapidFuzz's robust weighted combination

For each it reports how many within-company pairs clear the threshold, then
surfaces the *disagreements* — pairs a candidate scorer would merge but
token_sort would not (recall the current rule misses) and pairs that look
over-merged (precision risk) — so the choice is made on evidence, not vibes.

Usage (inside the scrapers image, with src + data mounted):
    python -m scrapers.dedup_benchmark --input data/processed/merged_jobs_*.json
    python -m scrapers.dedup_benchmark --input data/processed/db_jobs.json --threshold 80
"""

import argparse
import json
from pathlib import Path

from rapidfuzz import fuzz

from .dedup.text import clean_title, extract_city, normalize, normalize_company

SCORERS = {
    "token_sort": fuzz.token_sort_ratio,
    "token_set": fuzz.token_set_ratio,
    "WRatio": fuzz.WRatio,
}


def load_jobs(path: Path) -> list[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    jobs = []
    for r in raw:
        title = (r.get("title") or "").strip()
        company = (r.get("company") or "").strip()
        loc = r.get("location") or r.get("city") or ""
        city = (r.get("city") or extract_city(loc) or "").strip()
        if title and company:
            jobs.append({"title": title, "company": company, "city": city})
    return jobs


def build_pairs(jobs: list[dict], max_block: int) -> list[tuple[dict, dict]]:
    """All intra-company candidate pairs (blocked by normalized company)."""
    blocks: dict[str, list[dict]] = {}
    for j in jobs:
        blocks.setdefault(normalize_company(j["company"]), []).append(j)
    pairs: list[tuple[dict, dict]] = []
    for members in blocks.values():
        if len(members) < 2:
            continue
        # Cap huge blocks (a few mega-employers) so one company can't
        # dominate the O(k^2) pair count and skew the aggregate stats.
        members = members[:max_block]
        for i in range(len(members)):
            for k in range(i + 1, len(members)):
                pairs.append((members[i], members[k]))
    return pairs


def city_ok(a: dict, b: dict) -> bool:
    """Mirror merge.py's guard: same-ish city when both are present."""
    ca, cb = normalize(a["city"]), normalize(b["city"])
    if ca and cb:
        return fuzz.ratio(ca, cb) >= 60
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description="Benchmark RapidFuzz title scorers for dedup")
    ap.add_argument("--input", required=True, help="Jobs JSON (merge schema or DB export)")
    ap.add_argument("--threshold", type=int, default=80, help="Title match threshold (default 80)")
    ap.add_argument("--max-block", type=int, default=300, help="Cap pairs per company block")
    ap.add_argument("--samples", type=int, default=25, help="Disagreement examples to print")
    ap.add_argument("--out", default="data/processed/dedup_benchmark.json", help="Full report path")
    args = ap.parse_args()

    jobs = load_jobs(Path(args.input))
    pairs = build_pairs(jobs, args.max_block)
    T = args.threshold
    print(f"Loaded {len(jobs)} jobs → {len(pairs)} intra-company candidate pairs")
    print(f"Threshold = {T}  (city guard mirrors merge.py: reject if both cities present and ratio<60)\n")

    # variant key -> (preprocess fn). "raw" = current normalize, "clean" = + strip noise.
    variants = {"raw": normalize, "clean": clean_title}

    # Score every pair under every (variant, scorer). Record merge decision.
    rows = []
    for a, b in pairs:
        guard = city_ok(a, b)
        rec = {"a": a, "b": b, "city_ok": guard, "scores": {}}
        for vk, pre in variants.items():
            ta, tb = pre(a["title"]), pre(b["title"])
            for sk, fn in SCORERS.items():
                rec["scores"][f"{vk}.{sk}"] = round(fn(ta, tb), 1)
        rows.append(rec)

    # Aggregate: pairs each (variant, scorer) would MERGE = score>=T and city_ok.
    combos = [f"{vk}.{sk}" for vk in variants for sk in SCORERS]
    merged = {c: sum(1 for r in rows if r["city_ok"] and r["scores"][c] >= T) for c in combos}

    print(f"{'variant.scorer':<22} {'pairs≥T & city_ok':>18}")
    print("-" * 42)
    base = "raw.token_sort"
    for c in combos:
        delta = merged[c] - merged[base]
        tag = "  (current)" if c == base else f"  ({delta:+d} vs current)"
        print(f"{c:<22} {merged[c]:>18}{tag}")

    # Recall candidates: a scorer merges but the CURRENT rule (raw.token_sort) does not.
    def recovered(combo: str) -> list[dict]:
        return [
            r for r in rows
            if r["city_ok"] and r["scores"][combo] >= T and r["scores"][base] < T
        ]

    print("\n=== Recall candidates (would merge under candidate, NOT under current) ===")
    for combo in ("raw.token_set", "raw.WRatio", "clean.token_set", "clean.token_sort"):
        rec = recovered(combo)
        print(f"  {combo:<18} +{len(rec)} new merges vs current")

    # Print a readable sample from the union of the two most promising combos
    union = {id(r): r for r in recovered("raw.token_set") + recovered("clean.token_set")}
    sample = sorted(union.values(), key=lambda r: -r["scores"]["clean.token_set"])[: args.samples]
    print(f"\n--- {len(sample)} highest-scoring recall examples (judge: real dup or over-merge?) ---")
    for r in sample:
        a, b = r["a"], r["b"]
        s = r["scores"]
        print(f"\n  A: {a['title']!r}  [{a['city']}]")
        print(f"  B: {b['title']!r}  [{b['city']}]")
        print(f"     sort raw={s['raw.token_sort']} clean={s['clean.token_sort']} | "
              f"set raw={s['raw.token_set']} clean={s['clean.token_set']} | "
              f"WRatio raw={s['raw.WRatio']}")

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    report = {
        "input": args.input,
        "threshold": T,
        "n_jobs": len(jobs),
        "n_pairs": len(pairs),
        "merged_counts": merged,
        "recall_candidates": {
            combo: [
                {"a": r["a"]["title"], "b": r["b"]["title"],
                 "city_a": r["a"]["city"], "city_b": r["b"]["city"], "scores": r["scores"]}
                for r in recovered(combo)
            ]
            for combo in ("raw.token_set", "raw.WRatio", "clean.token_set", "clean.token_sort")
        },
    }
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nFull report → {args.out}")


if __name__ == "__main__":
    main()
