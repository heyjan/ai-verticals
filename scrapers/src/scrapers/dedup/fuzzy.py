#!/usr/bin/env python3
"""Fuzzy-only duplicate logic — the fallback when no ML model is present.

`is_duplicate` is the original rule (token_sort/token_set on title +
company, with a city guard). It stays as a safety net so the merge step
keeps working before a model is trained, or if scikit-learn / the model
artifact is unavailable. `merge_duplicate` and `canonicalize_company_names`
are model-independent and used by the pipeline regardless of matcher.
"""

import re

from rapidfuzz import fuzz

from .text import clean_title, normalize, normalize_company

# Distinguishing-token guard ------------------------------------------------
# token_sort is character-level, so titles that differ only by a role-defining
# word can still score in the low-80s (e.g. "Software Developer" vs "AI
# Software Engineer" → 81). To stop those marginal merges we additionally
# require the two titles to *share enough significant words*: below
# MARGINAL_BAND, the significant-token Jaccard must clear JACCARD_MIN. Above
# the band the titles are near-identical and the word check is skipped.
MARGINAL_BAND = 90
JACCARD_MIN = 0.45
# Glue words with no role signal — dropped before the Jaccard so they don't
# inflate the overlap of two otherwise-different titles.
_STOPWORDS = {
    "and", "or", "for", "the", "of", "fur", "und", "der", "die", "das", "in",
    "im", "mit", "zur", "zum", "bei", "at", "de", "en", "m", "w", "d", "x", "f",
}


def _significant_tokens(title: str) -> set[str]:
    """Role-bearing words of a title: gender/seniority stripped, glue removed."""
    return {t for t in clean_title(title).split() if len(t) > 1 and t not in _STOPWORDS}


def _titles_distinct(title_a: str, title_b: str) -> bool:
    """True when two titles share too few significant words to be the same role."""
    ta, tb = _significant_tokens(title_a), _significant_tokens(title_b)
    if not ta or not tb:
        return False  # nothing to compare on — defer to the fuzzy score
    return len(ta & tb) / len(ta | tb) < JACCARD_MIN


def is_duplicate(
    a: dict, b: dict, title_threshold: int = 80, company_threshold: int = 75
) -> bool:
    """Fuzzy duplicate test on title + company, guarded by city."""
    norm_title_a = normalize(a["title"])
    norm_title_b = normalize(b["title"])
    norm_comp_a = normalize_company(a["company"])
    norm_comp_b = normalize_company(b["company"])
    norm_city_a = normalize(a.get("city", ""))
    norm_city_b = normalize(b.get("city", ""))

    if norm_title_a == norm_title_b and norm_comp_a == norm_comp_b:
        return True

    title_score = fuzz.token_sort_ratio(norm_title_a, norm_title_b)
    company_score = fuzz.token_sort_ratio(norm_comp_a, norm_comp_b)
    if title_score < title_threshold or company_score < company_threshold:
        return False

    if norm_city_a and norm_city_b:
        if fuzz.ratio(norm_city_a, norm_city_b) < 60:
            return False

    # Marginal fuzzy score → demand real word overlap, not just char similarity.
    if title_score < MARGINAL_BAND and _titles_distinct(a["title"], b["title"]):
        return False
    return True


def merge_duplicate(existing: dict, new: dict) -> dict:
    """Merge two duplicate records, preferring the more-complete value."""
    merged = dict(existing)
    sources = set(existing["source"].split("+")) | set(new["source"].split("+"))
    merged["source"] = "+".join(sorted(sources))

    for field in ("description", "salary", "job_level", "posted_ago",
                  "date_posted", "contract_type", "sector", "location"):
        old_val = existing.get(field, "")
        new_val = new.get(field, "")
        if not old_val and new_val:
            merged[field] = new_val
        elif old_val and new_val and len(new_val) > len(old_val):
            merged[field] = new_val
    return merged


def canonicalize_company_names(jobs: list[dict]) -> tuple[list[dict], dict[str, str]]:
    """Collapse prefix-variant company names to a single brand form.

    Pairs of names where one is a token-prefix of the other (after suffix-
    stripping normalization) collapse to the shorter form, e.g. 'CHECK24
    Travel' → 'CHECK24'. The full-token-prefix requirement avoids merging
    unrelated companies that merely share a first word.
    """
    by_first_token: dict[str, set[str]] = {}
    for job in jobs:
        name = job.get("company", "")
        tokens = normalize_company(name).split()
        if not tokens or not name:
            continue
        by_first_token.setdefault(tokens[0], set()).add(name)

    rename: dict[str, str] = {}
    for names in by_first_token.values():
        if len(names) < 2:
            continue
        norms = [(name, normalize_company(name).split()) for name in names]
        for a, na in norms:
            if len(na) == 1 and len(na[0]) < 2:
                continue
            for b, nb in norms:
                if a == b or len(na) >= len(nb):
                    continue
                if nb[: len(na)] == na:
                    rename[b] = rename.get(a, a)

    if not rename:
        return jobs, {}

    def resolve(name: str) -> str:
        seen = {name}
        while name in rename:
            name = rename[name]
            if name in seen:
                break
            seen.add(name)
        return name

    resolved = {orig: resolve(orig) for orig in rename}
    out: list[dict] = []
    for job in jobs:
        target = resolved.get(job.get("company", ""))
        if target and target != job["company"]:
            new = dict(job)
            new["company"] = target
            out.append(new)
        else:
            out.append(job)
    return out, resolved
