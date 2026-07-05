#!/usr/bin/env python3
"""Pairwise feature extraction for the dedup classifier.

A `FeatureExtractor` is fit once on a corpus (to learn TF-IDF / IDF
weights for titles and descriptions) and then turns any title/description
pair into the fixed feature vector the model was trained on. The fitted
vectorizers are pickled together with the model so inference reproduces
training-time features exactly.

Feature design is the outcome of the dedup benchmark: fuzzy title scores
(raw + gender-stripped), TF-IDF title cosine (word + char), token-length
ratio, and a TF-IDF cosine over the first `desc_words` of the description
— the multi-field combination that was the only thing to reach ≥80%
precision on the labeled ground truth.
"""

import numpy as np
from rapidfuzz import fuzz
from sklearn.feature_extraction.text import TfidfVectorizer

from .text import clean_title, normalize, truncate_words

# Title TF-IDF candidate must clear this token_set to even be scored — a
# cheap gate that drops ~95% of within-company pairs before the model runs.
CANDIDATE_TOKEN_SET = 90
DEFAULT_DESC_WORDS = 100

FEATURE_NAMES = [
    "token_sort", "token_set", "wratio",
    "clean_sort", "clean_set",
    "title_word_cos", "title_char_cos",
    "tok_diff", "tok_ratio",
    "desc_cos", "desc_both",
]


def candidate(a: dict, b: dict) -> bool:
    """Cheap pre-filter: only score pairs whose titles overlap enough."""
    return fuzz.token_set_ratio(normalize(a["title"]), normalize(b["title"])) >= CANDIDATE_TOKEN_SET


def _cos(vec: TfidfVectorizer, x: str, y: str) -> float:
    if not x or not y:
        return 0.0
    m = vec.transform([x, y])
    a, b = m[0], m[1]
    na = np.sqrt(a.multiply(a).sum())
    nb = np.sqrt(b.multiply(b).sum())
    if na == 0 or nb == 0:
        return 0.0
    return float(a.multiply(b).sum() / (na * nb))


class FeatureExtractor:
    def __init__(self, desc_words: int = DEFAULT_DESC_WORDS):
        self.desc_words = desc_words
        self.title_word: TfidfVectorizer | None = None
        self.title_char: TfidfVectorizer | None = None
        self.desc: TfidfVectorizer | None = None

    def fit(self, titles: list[str], descriptions: list[str]) -> "FeatureExtractor":
        self.title_word = TfidfVectorizer(analyzer="word", lowercase=True).fit(titles)
        self.title_char = TfidfVectorizer(
            analyzer="char_wb", ngram_range=(2, 4), lowercase=True
        ).fit(titles)
        desc_corpus = [truncate_words(d, self.desc_words) for d in descriptions]
        self.desc = TfidfVectorizer(
            analyzer="word", ngram_range=(1, 2), min_df=2, lowercase=True
        ).fit(desc_corpus)
        return self

    def pair_features(self, a: dict, b: dict) -> list[float]:
        ta, tb = a.get("title", ""), b.get("title", "")
        na, nb = normalize(ta), normalize(tb)
        ca, cb = clean_title(ta), clean_title(tb)
        wa = na.split() or [""]
        wb = nb.split() or [""]
        da = truncate_words(a.get("description", ""), self.desc_words)
        db = truncate_words(b.get("description", ""), self.desc_words)
        desc_both = 1.0 if (da and db) else 0.0
        return [
            float(fuzz.token_sort_ratio(na, nb)),
            float(fuzz.token_set_ratio(na, nb)),
            float(fuzz.WRatio(na, nb)),
            float(fuzz.token_sort_ratio(ca, cb)),
            float(fuzz.token_set_ratio(ca, cb)),
            _cos(self.title_word, ta, tb) * 100,
            _cos(self.title_char, ta, tb) * 100,
            float(abs(len(wa) - len(wb))),
            min(len(wa), len(wb)) / max(len(wa), len(wb)),
            _cos(self.desc, da, db) * 100,
            desc_both,
        ]
