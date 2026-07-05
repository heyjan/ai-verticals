#!/usr/bin/env python3
"""Train the dedup model from labeled pairs + a corpus, persist the artifact.

The labeled pairs (`judge_pairs.json` + `judge_labels.json`, produced by the
benchmark) store only titles/cities; descriptions are reconstructed from the
corpus by matching (title, city) within the shared company block. The corpus
also provides the TF-IDF / IDF fit.

Usage (inside the scrapers image, with data mounted):
    python -m scrapers.dedup.train \
        --corpus data/processed/merged-latest.json \
        --pairs  data/processed/judge_pairs.json \
        --labels data/processed/judge_labels.json \
        --out    data/models/dedup_model.joblib
"""

import argparse
import json
from collections import defaultdict
from pathlib import Path

from .model import DedupModel


def _reconstruct(corpus: list[dict], pairs: list[dict]) -> tuple[list[tuple[dict, dict]], list[int], int]:
    """Attach descriptions to each labeled pair via (title, city) lookup,
    disambiguated by the company shared between the two sides."""
    bykey: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for j in corpus:
        bykey[(j.get("title", "").strip(), (j.get("city") or "").strip())].append(j)

    out_pairs: list[tuple[dict, dict]] = []
    out_labels: list[int] = []
    matched = 0
    for p in pairs:
        Sa = bykey.get((p["a"], p["city_a"]), [])
        Sb = bykey.get((p["b"], p["city_b"]), [])
        if Sa and Sb:
            shared = {r["company"] for r in Sa} & {r["company"] for r in Sb}
            if shared:
                c = next(iter(shared))
                ra = next(r for r in Sa if r["company"] == c)
                rb = (next((r for r in Sb if r["company"] == c and r is not ra), None)
                      or next(r for r in Sb if r["company"] == c))
            else:
                ra, rb = Sa[0], Sb[0]
            matched += 1
        else:
            # Fall back to title-only record (no description) so the pair is
            # still usable; desc features will read empty.
            ra = {"title": p["a"], "description": ""}
            rb = {"title": p["b"], "description": ""}
        out_pairs.append((
            {"title": ra.get("title", p["a"]), "description": ra.get("description", "")},
            {"title": rb.get("title", p["b"]), "description": rb.get("description", "")},
        ))
        out_labels.append(int(p["label"]))
    return out_pairs, out_labels, matched


def main() -> None:
    ap = argparse.ArgumentParser(description="Train the dedup model")
    ap.add_argument("--corpus", required=True, help="Jobs JSON for TF-IDF fit + description lookup")
    ap.add_argument("--pairs", required=True, help="judge_pairs.json")
    ap.add_argument("--labels", required=True, help="judge_labels.json (id -> 0/1)")
    ap.add_argument("--out", default="data/models/dedup_model.joblib")
    ap.add_argument("--precision", type=float, default=0.80, help="Target precision for the threshold")
    ap.add_argument("--desc-words", type=int, default=100, help="Description truncation (words)")
    args = ap.parse_args()

    corpus = json.loads(Path(args.corpus).read_text(encoding="utf-8"))
    raw_pairs = json.loads(Path(args.pairs).read_text(encoding="utf-8"))
    labels = json.loads(Path(args.labels).read_text(encoding="utf-8"))
    for p in raw_pairs:
        p["label"] = labels[str(p["id"])]

    pairs, ys, matched = _reconstruct(corpus, raw_pairs)
    print(f"corpus={len(corpus)} jobs | labeled pairs={len(pairs)} "
          f"(descriptions recovered for {matched}) | positives={sum(ys)}")

    model, metrics = DedupModel.train(
        corpus, pairs, ys, precision_target=args.precision, desc_words=args.desc_words
    )
    print(f"threshold={metrics['threshold']:.3f}  "
          f"CV precision={metrics['precision']*100:.1f}%  recall={metrics['recall']*100:.1f}%  "
          f"[{metrics['policy']}]")

    print("feature importances:")
    for name, val in metrics["importances"]:
        print(f"  {name:<16} {val:.3f}")

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    model.save(args.out)
    print(f"saved model → {args.out}")


if __name__ == "__main__":
    main()
