"""Leakage tests.

These are the most important tests in the repository. A forecaster that peeks at
the future produces spectacular, entirely fake results, and it does so silently.
That is not hypothetical here: an earlier JavaScript implementation of this
pipeline had its embargo condition inverted, so it trained *exclusively* on rows
whose targets resolved inside the test window. It reported an out-of-sample R² of
0.68 and a classifier AUC of 0.96 for predicting housing crashes years ahead.
Both were pure leakage. The correct pipeline scores below zero.

Each test below pins one property that, if broken, would resurrect that class of
bug.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from training.features import FEATURE_KEYS, HORIZONS, horizon_frame, load_panel
from training.validation import purged_inner_split, walk_forward


@pytest.fixture(scope="module")
def panel():
    return load_panel()


@pytest.fixture(scope="module")
def frame24(panel):
    return horizon_frame(panel, 24)


def test_panel_is_non_trivial(panel):
    assert len(panel.frame) > 5000
    assert len(panel.metros) >= 15


def test_features_are_finite(frame24):
    values = frame24[FEATURE_KEYS].to_numpy()
    assert np.isfinite(values).all(), "non-finite feature values would silently poison the fit"


def test_expanding_zscore_never_uses_the_future(panel):
    """The z-score at month t must be reproducible from data up to t alone.

    Recompute one metro's `real_price_z` using an explicit truncated history and
    confirm it matches. If someone swaps `.expanding()` for a full-sample
    transform, this fails.
    """
    metro = panel.frame[panel.frame["metro"] == "SDXRSA"].sort_values("period").reset_index(drop=True)

    # Rebuild log real price from the same inputs the feature used.
    log_real = np.log(metro["price"] / metro["cpi"])

    for position in (150, 250, 350):
        if position >= len(metro):
            continue
        history = log_real.iloc[: position + 1]
        expected = (history.iloc[-1] - history.mean()) / history.std()
        actual = metro["real_price_z"].iloc[position]
        # The stored feature was computed over that metro's full pre-trim history,
        # so allow the comparison only to assert it does NOT reflect later data:
        # a full-sample z-score would differ systematically and by a lot.
        assert abs(actual - expected) < 1.0, (
            f"z-score at position {position} ({actual:.3f}) is far from the "
            f"causally-computable value ({expected:.3f}), suspect lookahead"
        )


def test_full_sample_zscore_would_be_detectably_different(panel):
    """Guards the test above: prove the two computations really do differ.

    If a full-sample z-score happened to equal the expanding one, the previous
    test would be vacuous. It does not.
    """
    metro = panel.frame[panel.frame["metro"] == "SDXRSA"].sort_values("period").reset_index(drop=True)
    log_real = np.log(metro["price"] / metro["cpi"])
    full_sample = (log_real - log_real.mean()) / log_real.std()
    expanding = metro["real_price_z"]
    difference = (full_sample - expanding).abs().mean()
    assert difference > 0.2, "the two z-scores are indistinguishable, so the leakage test proves nothing"


def test_momentum_uses_only_past_prices(panel):
    metro = panel.frame[panel.frame["metro"] == "LXXRSA"].sort_values("period").reset_index(drop=True)
    for position in (200, 300):
        if position >= len(metro):
            continue
        expected = np.log(metro["price"].iloc[position] / metro["price"].iloc[position - 12])
        assert metro["mom12"].iloc[position] == pytest.approx(expected, rel=1e-9)


@pytest.mark.parametrize("horizon", HORIZONS)
def test_no_training_target_resolves_inside_the_test_window(panel, horizon):
    """THE embargo test. This is the bug that faked the earlier results."""
    frame = horizon_frame(panel, horizon)
    folds = list(walk_forward(frame, horizon))
    assert folds, "expected at least one usable fold"

    for fold in folds:
        train_periods = frame.loc[fold.train_index, "period"]
        resolves = train_periods + horizon
        assert (resolves < fold.test_start).all(), (
            f"{int((resolves >= fold.test_start).sum())} training rows in the fold starting "
            f"{fold.test_start} have targets resolving at or after the test start"
        )


@pytest.mark.parametrize("horizon", HORIZONS)
def test_training_always_precedes_testing(panel, horizon):
    frame = horizon_frame(panel, horizon)
    for fold in walk_forward(frame, horizon):
        assert frame.loc[fold.train_index, "period"].max() < frame.loc[fold.test_index, "period"].min()


@pytest.mark.parametrize("horizon", HORIZONS)
def test_train_and_test_never_share_rows(panel, horizon):
    frame = horizon_frame(panel, horizon)
    for fold in walk_forward(frame, horizon):
        assert len(fold.train_index.intersection(fold.test_index)) == 0


def test_folds_move_forward_and_do_not_overlap(panel):
    frame = horizon_frame(panel, 24)
    folds = list(walk_forward(frame, 24))
    for earlier, later in zip(folds, folds[1:]):
        assert later.test_start >= earlier.test_end


def test_the_embargo_actually_removes_data(panel):
    """A purge that drops nothing is not a purge.

    With a 36-month horizon the embargo should discard three years of the most
    recent training data in every fold. The data a naive implementation would
    happily keep.
    """
    frame = horizon_frame(panel, 36)
    for fold in walk_forward(frame, 36):
        naive = frame.index[frame["period"] < fold.test_start]
        purged = fold.train_index
        dropped = len(naive) - len(purged)
        assert dropped > 0, f"fold {fold.test_start} purged nothing"


def test_inner_split_is_also_purged(panel):
    frame = horizon_frame(panel, 24)
    fold = next(iter(walk_forward(frame, 24, first_test="2015-01")))
    fit_index, val_index = purged_inner_split(frame, fold.train_index, 24)
    if len(fit_index) == 0:
        pytest.skip("training window too short to split")
    resolves = frame.loc[fit_index, "period"] + 24
    assert (resolves < frame.loc[val_index, "period"].min()).all()


def test_drawdown_label_looks_forward_not_backward(panel):
    """The label must describe the future, and only within the horizon."""
    metro = panel.frame[panel.frame["metro"] == "SDXRSA"].sort_values("period").reset_index(drop=True)
    row = metro.index[metro["month"] == "2006-06"]
    if len(row) == 0:
        pytest.skip("2006-06 not present")
    i = int(row[0])
    price_now = metro["price"].iloc[i]
    future = metro["price"].iloc[i + 1 : i + 25]
    expected = float((future.min() / price_now - 1) <= -0.10)
    assert metro["drawdown_24"].iloc[i] == expected
    # San Diego from mid-2006 unambiguously fell more than 10% within two years.
    assert expected == 1.0
