#!/usr/bin/env python3
"""Blocking + single-pass clustering. The matcher is pluggable.

`deduplicate` blocks candidates by normalized company name (so the O(n^2)
comparison only runs within an employer) and folds each duplicate into the
record it matched. `match_fn(a, b) -> bool` is injected — the ML model's
`is_match` in production, or the fuzzy `is_duplicate` fallback — so this
clustering logic is independent of how a match is decided.
"""

from collections.abc import Callable

from .text import normalize_company

MatchFn = Callable[[dict, dict], bool]
MergeFn = Callable[[dict, dict], dict]


def deduplicate(jobs: list[dict], match_fn: MatchFn, merge_fn: MergeFn) -> list[dict]:
    """Collapse duplicate jobs. Blocks on normalized company; within a
    block, a new job is merged into the first existing record it matches."""
    blocks: dict[str, list[int]] = {}
    unique: list[dict] = []

    for job in jobs:
        key = normalize_company(job.get("company", ""))
        matched = False
        for idx in blocks.get(key, ()):
            if match_fn(unique[idx], job):
                unique[idx] = merge_fn(unique[idx], job)
                matched = True
                break
        if not matched:
            idx = len(unique)
            unique.append(job)
            blocks.setdefault(key, []).append(idx)

    return unique
