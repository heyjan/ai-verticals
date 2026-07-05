#!/usr/bin/env python3
"""Text normalization helpers shared across the dedup pipeline.

Kept dependency-free (stdlib only) so any module — feature extraction,
the fuzzy fallback, the merge step — can import it without pulling in
rapidfuzz or scikit-learn.
"""

import re
import unicodedata

# Company-suffix tokens stripped before comparison so "ACME GmbH" and
# "ACME AG" block together.
_COMPANY_SUFFIXES = (
    "gmbh", "ag", "se", "inc", "ltd", "co kg", "mbh", "e v", "kg", "ohg",
    "ug", "corp", "corporation", "llc", "group", "holding", "deutschland",
    "germany", "europe", "eu",
)

# Gender markers — (m/w/d), (w/m/x), "all genders", and *in / :in star forms.
_GENDER = re.compile(
    r"\(?\s*[mwfdx](?:\s*[/|]\s*[mwfdx]){1,2}\s*\)?"
    r"|\(\s*all\s+genders?\s*\)"
    r"|\b[a-zäöü]+[*:/]innen?\b",
    re.IGNORECASE,
)
# Leading seniority qualifier in parens, e.g. "(Junior) ", "(Senior) ".
_SENIORITY_PAREN = re.compile(r"\((junior|senior|lead|principal)\)", re.IGNORECASE)


def normalize(text: str) -> str:
    """Lowercase, strip accents, drop punctuation, collapse whitespace."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_company(name: str) -> str:
    """Normalize a company name and strip legal-form suffixes (GmbH, AG…)."""
    n = normalize(name)
    for suffix in _COMPANY_SUFFIXES:
        n = re.sub(rf"\b{suffix}\b", "", n)
    return re.sub(r"\s+", " ", n).strip()


def extract_city(location: str) -> str:
    """Pull the city from a location string (first comma-separated part)."""
    if not location:
        return ""
    return location.split(",")[0].strip()


def clean_title(title: str) -> str:
    """Strip gender/seniority noise from a title, then normalize().

    Used as a second title view alongside the raw normalized title — the
    benchmark showed gender-stripped token_set is the single strongest
    learned feature for separating true dups from role-distinct titles.
    """
    t = _GENDER.sub(" ", title or "")
    t = _SENIORITY_PAREN.sub(" ", t)
    return normalize(t)


def truncate_words(text: str, n: int) -> str:
    """First `n` whitespace tokens of `text` (empty string if falsy).

    Descriptions run ~460 words; the benchmark found the first ~100 words
    carry the discriminating signal and that the long tail only adds noise.
    """
    return " ".join((text or "").split()[:n])
