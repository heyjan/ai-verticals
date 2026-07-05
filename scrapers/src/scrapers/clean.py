#!/usr/bin/env python3
"""
Check jobs for AI/KI relevance based on title and description keywords.
Removes irrelevant jobs from the dataset and optionally re-seeds the DB.

Usage:
    python clean_dataset.py --input data/merged_jobs_20260511_214111.json
    python clean_dataset.py --input data/merged_jobs_20260511_214111.json --apply
"""

import argparse
import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

AI_KEYWORDS = [
    # Core AI/ML terms
    r'\bai\b',
    r'\bki\b',
    r'\bartificial intelligence\b',
    r'\bkünstliche intelligenz\b',
    r'\bmachine learning\b',
    r'\bmaschinenlernen\b',
    r'\bdeep learning\b',
    r'\breinforcement learning\b',
    r'\btransfer learning\b',
    r'\bfederated learning\b',

    # Models & architectures
    r'\bneural net',
    r'\btransformer\b',
    r'\bllm\b',
    r'\blarge language model',
    r'\bgenerative ai\b',
    r'\bgenai\b',
    r'\bgen ai\b',
    r'\bgpt\b',
    r'\bchatgpt\b',
    r'\bopenai\b',
    r'\bdiffusion model',
    r'\bfoundation model',

    # NLP / CV
    r'\bnlp\b',
    r'\bnatural language processing\b',
    r'\bcomputer vision\b',
    r'\bimage recognition\b',
    r'\bobject detection\b',
    r'\bspeech recognition\b',
    r'\btext mining\b',
    r'\bsentiment analysis\b',

    # Data Science & ML Engineering
    r'\bdata scien',
    r'\bml engineer',
    r'\bml ops\b',
    r'\bmlops\b',
    r'\bai engineer',
    r'\bai research',
    r'\bai develop',
    r'\bki[-\s]?entwickl',
    r'\bai[-\s]?architect',
    r'\bai[-\s]?consult',
    r'\bai[-\s]?strateg',
    r'\bai[-\s]?solution',
    r'\bai[-\s]?product',
    r'\bai[-\s]?project',
    r'\bai[-\s]?platform',
    r'\bai[-\s]?system',
    r'\bai[-\s]?manager',
    r'\bai[-\s]?lead',
    r'\bai[-\s]?head',

    # Frameworks & tools
    r'\btensorflow\b',
    r'\bpytorch\b',
    r'\bscikit[- ]learn\b',
    r'\bkeras\b',
    r'\bhugging\s?face\b',
    r'\blangchain\b',
    r'\blanggraph\b',
    r'\bvector\s?database\b',
    r'\bvector\s?store\b',
    r'\brag\b',
    r'\bretrieval.augmented',
    r'\bembedding[s]?\b',
    r'\bfine[- ]?tun',
    r'\bprompt engineer',

    # Techniques
    r'\bpredictive\s+(analytics|model)',
    r'\banomaly detection\b',
    r'\brecommend(ation|er)\s+system',
    r'\bclassif(ication|ier)\b',
    r'\bclustering\b',
    r'\bregression\b',
    r'\bfeature engineer',

    # Robotics / Automation (AI-adjacent)
    r'\brobotics?\b',
    r'\bautonomous\b',
    r'\bautomation\b',
    r'\bchatbot\b',
    r'\bconversational ai\b',

    # Annotation / Training data
    r'\bdata annotation\b',
    r'\bdata labeling\b',
    r'\btraining data\b',
    r'\bannotator\b',
]

COMPILED_PATTERNS = [re.compile(p, re.IGNORECASE) for p in AI_KEYWORDS]


# Tech keywords that are specific enough to keep a job even when the
# title is generic. A job titled "Software Engineer" whose description
# mentions "PyTorch" is almost certainly AI/ML-adjacent; one that merely
# says "we use AI to power our product" is not.
STRONG_DESC_KEYWORDS = [
    r'\bmachine learning\b', r'\bmaschinenlernen\b',
    r'\bdeep learning\b', r'\breinforcement learning\b', r'\bfederated learning\b',
    r'\bllm\b', r'\blarge language model', r'\bgenerative ai\b', r'\bgenai\b',
    r'\btensorflow\b', r'\bpytorch\b', r'\bscikit[- ]learn\b', r'\bkeras\b',
    r'\bhugging\s?face\b', r'\blangchain\b', r'\blanggraph\b', r'\bllama\.?index',
    r'\bvector\s?database\b', r'\bvector\s?store\b', r'\bembedding[s]?\b',
    r'\bfine[- ]?tun', r'\bprompt engineer',
    r'\bcomputer vision\b', r'\bimage recognition\b', r'\bobject detection\b',
    r'\bnatural language processing\b',
    r'\bdiffusion model', r'\bfoundation model',
    r'\bdata scien', r'\bml[- ]?engineer', r'\bml[- ]?ops\b', r'\bmlops\b',
    r'\bai[- ]?(engineer|architect|researcher|scientist|consultant|specialist|lead|developer)',
]
COMPILED_STRONG_DESC = [re.compile(p, re.IGNORECASE) for p in STRONG_DESC_KEYWORDS]


def is_ai_relevant(title: str, description: str) -> tuple[bool, str]:
    """Two-tier AI relevance check:

    1. Title-match against AI_KEYWORDS — covers e.g. "AI Engineer",
       "ML Researcher", "Data Scientist", "KI Consultant". This is the
       primary signal because AI jobs almost always announce themselves
       in the title.
    2. As a salvage path, also accept jobs whose description contains a
       STRONG_DESC_KEYWORD (PyTorch, LLM, "machine learning", etc.) even
       if the title is generic. Generic "AI" mentions in description
       (boilerplate "we leverage AI") are intentionally rejected.

    Previous logic matched AI_KEYWORDS anywhere in title+description,
    which let through ~60% noise (real-estate, customer-service, etc.).
    """
    for pattern, keyword in zip(COMPILED_PATTERNS, AI_KEYWORDS):
        if pattern.search(title):
            return True, keyword
    for pattern, raw in zip(COMPILED_STRONG_DESC, STRONG_DESC_KEYWORDS):
        if pattern.search(description):
            return True, raw
    return False, ""


def main():
    parser = argparse.ArgumentParser(description="Check and clean AI relevance in job dataset")
    parser.add_argument("--input", type=str, required=True, help="Path to merged jobs JSON")
    parser.add_argument("--apply", action="store_true", help="Write cleaned dataset (without this flag, dry-run only)")
    parser.add_argument("--output-dir", type=str, default="data/processed", help="Output directory")
    parser.add_argument("--show-removed", type=int, default=20, help="Number of removed jobs to show as examples")
    args = parser.parse_args()

    with open(args.input, encoding="utf-8") as f:
        jobs = json.load(f)

    print(f"Loaded {len(jobs)} jobs from {args.input}\n")

    relevant = []
    removed = []
    keyword_hits = Counter()

    for job in jobs:
        title = job.get("title", "")
        desc = job.get("description", "")
        is_rel, matched = is_ai_relevant(title, desc)

        if is_rel:
            relevant.append(job)
            keyword_hits[matched] += 1
        else:
            removed.append(job)

    print(f"{'=' * 60}")
    print(f"  AI-relevant:     {len(relevant):>6}  ({len(relevant)/len(jobs)*100:.1f}%)")
    print(f"  Not relevant:    {len(removed):>6}  ({len(removed)/len(jobs)*100:.1f}%)")
    print(f"{'=' * 60}\n")

    # Source breakdown of removed
    removed_sources = Counter(j.get("source", "unknown") for j in removed)
    print("Removed jobs by source:")
    for source, count in removed_sources.most_common():
        print(f"  {source}: {count}")

    # Category breakdown of removed
    removed_categories = Counter(j.get("category", "?") for j in removed)
    print("\nRemoved jobs by category (if pre-classified):")
    for cat, count in removed_categories.most_common(10):
        print(f"  {cat}: {count}")

    # City breakdown of removed
    removed_cities = Counter(j.get("city", "?") for j in removed)
    print("\nTop cities losing jobs:")
    for city, count in removed_cities.most_common(10):
        total_city = sum(1 for j in jobs if j.get("city") == city)
        print(f"  {city}: -{count} (of {total_city})")

    # Top matched keywords
    print(f"\nTop keyword matches (keeping jobs):")
    for kw, count in keyword_hits.most_common(15):
        print(f"  {kw}: {count}")

    # Sample removed jobs
    print(f"\nSample removed jobs ({min(args.show_removed, len(removed))} of {len(removed)}):")
    print(f"{'-' * 60}")
    for job in removed[:args.show_removed]:
        sal = job.get("salary", "")
        sal_str = f" | {sal}" if sal else ""
        print(f"  {job.get('title', '?')}")
        print(f"    @ {job.get('company', '?')} — {job.get('city', '?')}{sal_str}")
        desc_preview = (job.get("description", "") or "")[:120].replace("\n", " ")
        if desc_preview:
            print(f"    desc: {desc_preview}...")
        print()

    if args.apply:
        output_dir = Path(args.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        out_path = output_dir / f"merged_jobs_{timestamp}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(relevant, f, ensure_ascii=False, indent=2)
        print(f"\nCleaned dataset saved: {out_path} ({len(relevant)} jobs)")

        removed_path = output_dir / f"removed_jobs_{timestamp}.json"
        with open(removed_path, "w", encoding="utf-8") as f:
            json.dump(removed, f, ensure_ascii=False, indent=2)
        print(f"Removed jobs saved:   {removed_path} ({len(removed)} jobs)")

        # Repoint merged-latest.json to the cleaned output so the import
        # step picks up the filtered set, not the raw merge.
        latest = output_dir / "merged-latest.json"
        if latest.exists() or latest.is_symlink():
            latest.unlink()
        latest.symlink_to(out_path.name)
        print(f"Latest: {latest} -> {out_path.name}")
    else:
        print("\nDry run — no files written. Use --apply to save cleaned dataset.")


if __name__ == "__main__":
    main()
