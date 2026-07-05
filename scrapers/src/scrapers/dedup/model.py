#!/usr/bin/env python3
"""The dedup classifier: feature extractor + gradient-boosting model + threshold.

`DedupModel` bundles everything needed to decide, for a candidate pair,
whether it is a duplicate: the fitted `FeatureExtractor`, a trained
`GradientBoostingClassifier`, and a probability threshold chosen to hit a
target precision. The whole bundle pickles to one file via joblib so
inference reproduces training exactly.

Why gradient boosting: the benchmark showed a *learned* weighted
combination of string features is the only non-LLM approach to reach ≥80%
precision on the hard residual; GB handles the feature interactions
(e.g. "high token_set is good *unless* lengths diverge") that a single
threshold or linear model cannot.
"""

from __future__ import annotations

import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_predict

from .features import DEFAULT_DESC_WORDS, FeatureExtractor, candidate


class DedupModel:
    def __init__(self, extractor: FeatureExtractor, clf, threshold: float,
                 desc_words: int = DEFAULT_DESC_WORDS):
        self.extractor = extractor
        self.clf = clf
        self.threshold = threshold
        self.desc_words = desc_words

    # --- inference -------------------------------------------------------
    def proba(self, a: dict, b: dict) -> float:
        x = np.array([self.extractor.pair_features(a, b)])
        return float(self.clf.predict_proba(x)[0, 1])

    def is_match(self, a: dict, b: dict) -> bool:
        """Candidate-gate first (cheap), then score. Within-block use only."""
        if not candidate(a, b):
            return False
        return self.proba(a, b) >= self.threshold

    # --- persistence -----------------------------------------------------
    def save(self, path: str) -> None:
        import joblib
        joblib.dump(self, path)

    @staticmethod
    def load(path: str) -> "DedupModel":
        import joblib
        return joblib.load(path)

    # --- training --------------------------------------------------------
    @classmethod
    def train(
        cls,
        corpus_jobs: list[dict],
        pairs: list[tuple[dict, dict]],
        labels: list[int],
        precision_target: float = 0.80,
        desc_words: int = DEFAULT_DESC_WORDS,
        random_state: int = 0,
    ) -> tuple["DedupModel", dict]:
        """Fit extractor on the corpus, train GB on labeled pairs, pick a
        precision-targeted threshold via cross-validated out-of-fold
        probabilities. Returns (model, metrics)."""
        ext = FeatureExtractor(desc_words).fit(
            [j.get("title", "") for j in corpus_jobs],
            [j.get("description", "") for j in corpus_jobs],
        )
        X = np.array([ext.pair_features(a, b) for a, b in pairs])
        y = np.array(labels)

        # Calibrated GB so predicted probabilities are comparable between the
        # cross-validated threshold search and the deployed model — without
        # calibration, an OOF-derived threshold doesn't transfer to a refit
        # model (a clear dup scored 0.80 against a 0.985 OOF threshold).
        # Sigmoid (Platt) calibration is the safe choice for few positives.
        def make_clf():
            base = GradientBoostingClassifier(
                n_estimators=200, max_depth=3, random_state=random_state
            )
            return CalibratedClassifierCV(base, cv=5, method="sigmoid")

        cv = StratifiedKFold(5, shuffle=True, random_state=random_state)
        oof = cross_val_predict(make_clf(), X, y, cv=cv, method="predict_proba")[:, 1]
        threshold, metrics = _pick_threshold(y, oof, precision_target)

        # Importances come from a plain GB fit (the calibrated wrapper hides
        # them); report-only, not used for prediction.
        from .features import FEATURE_NAMES
        plain = GradientBoostingClassifier(
            n_estimators=200, max_depth=3, random_state=random_state
        ).fit(X, y)
        metrics["importances"] = sorted(
            zip(FEATURE_NAMES, plain.feature_importances_.tolist()), key=lambda z: -z[1]
        )

        clf = make_clf().fit(X, y)  # final calibrated fit on all labeled data
        return cls(ext, clf, threshold, desc_words), metrics


def _pick_threshold(y: np.ndarray, scores: np.ndarray, target: float) -> tuple[float, dict]:
    """Smallest threshold reaching `target` precision (max recall); if
    unreachable, the threshold maximizing F1. Returns (threshold, metrics)."""
    best = None  # (recall, threshold, prec)
    f1_best = None  # (f1, threshold, prec, recall)
    for t in sorted(set(scores.tolist())):
        pred = scores >= t
        tp = int(((pred) & (y == 1)).sum())
        fp = int(((pred) & (y == 0)).sum())
        fn = int(((~pred) & (y == 1)).sum())
        if tp == 0:
            continue
        prec = tp / (tp + fp)
        rec = tp / (tp + fn)
        f1 = 2 * prec * rec / (prec + rec)
        if f1_best is None or f1 > f1_best[0]:
            f1_best = (f1, t, prec, rec)
        if prec >= target and (best is None or rec > best[0]):
            best = (rec, t, prec)
    if best is not None:
        rec, t, prec = best
        return float(t), {"threshold": float(t), "precision": prec, "recall": rec,
                          "policy": f"precision>={target}"}
    f1, t, prec, rec = f1_best
    return float(t), {"threshold": float(t), "precision": prec, "recall": rec,
                      "policy": "max_f1 (precision target unreachable)"}
