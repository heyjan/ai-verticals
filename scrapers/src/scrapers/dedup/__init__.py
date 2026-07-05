#!/usr/bin/env python3
"""Deduplication package for the merge pipeline.

Public API:
    deduplicate(jobs, match_fn, merge_fn)   — blocking + clustering
    merge_duplicate, canonicalize_company_names
    build_match_fn(model_path)              — ML matcher, fuzzy fallback
    normalize, normalize_company, extract_city

The matcher is resolved at runtime: if a trained model artifact exists and
scikit-learn loads, the ML `DedupModel.is_match` is used; otherwise the
fuzzy `is_duplicate` rule, so the merge step never hard-depends on the
model being present.
"""

from collections.abc import Callable
from pathlib import Path

from .cluster import deduplicate
from .fuzzy import canonicalize_company_names, is_duplicate, merge_duplicate
from .text import extract_city, normalize, normalize_company

DEFAULT_MODEL_PATH = "data/models/dedup_model.joblib"

__all__ = [
    "deduplicate",
    "merge_duplicate",
    "canonicalize_company_names",
    "is_duplicate",
    "build_match_fn",
    "normalize",
    "normalize_company",
    "extract_city",
    "DEFAULT_MODEL_PATH",
]


def build_match_fn(model_path: str | None = DEFAULT_MODEL_PATH) -> tuple[Callable[[dict, dict], bool], str]:
    """Return (match_fn, description).

    The fuzzy rule is the high-precision backbone — it catches the easy,
    unambiguous duplicates (exact/near-exact titles, cross-source matches).
    When a trained model is present it is layered on as a *recall booster*:
    a pair is a duplicate if the fuzzy rule says so OR the model recovers it
    from the hard residual (the near-dups token_sort misses). The model was
    trained only on that residual, so it must augment — not replace — fuzzy,
    or the obvious duplicates go unmerged. Falls back to fuzzy-only on any
    model problem (missing file, no scikit-learn, load/version error)."""
    if model_path and Path(model_path).exists():
        try:
            from .model import DedupModel
            model = DedupModel.load(model_path)

            def match(a: dict, b: dict) -> bool:
                return is_duplicate(a, b) or model.is_match(a, b)

            return match, f"fuzzy + ML recovery ({model_path}, threshold={model.threshold:.3f})"
        except Exception as e:  # missing sklearn, version skew, corrupt file…
            print(f"[dedup] ML model unavailable ({e}); using fuzzy fallback")
    else:
        print(f"[dedup] no model at {model_path}; using fuzzy fallback")
    return is_duplicate, "fuzzy is_duplicate (fallback)"
