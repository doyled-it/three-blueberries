"""Purged walk-forward validation.

Standard k-fold cross-validation is invalid here for two separate reasons, and
both have to be handled or the model will report skill it does not have:

1. **Time order.** Shuffling rows lets the model train on 2012 and test on 2008.
   Folds must move forward in time only.

2. **Target overlap (the one people miss).** An observation at month *t* has its
   answer at *t + horizon*. If the test period starts at *T*, then a training row
   at *T - 6* with a 24-month horizon has a target that resolves deep inside the
   test window. Its label literally contains test-period information. Those rows
   must be *purged*.

Purging is what separates an honest walk-forward from a flattering one. With a
36-month horizon it removes three years of the most recent — and most relevant —
training data from every fold, which is exactly why naive implementations skip it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

import pandas as pd


@dataclass(frozen=True)
class Fold:
    train_index: pd.Index
    test_index: pd.Index
    test_start: pd.Period
    test_end: pd.Period


def walk_forward(
    frame: pd.DataFrame,
    horizon: int,
    first_test: str = "2003-01",
    fold_months: int = 24,
    min_train: int = 300,
) -> Iterator[Fold]:
    """Expanding-window folds with the target-overlap purge applied."""
    periods = frame["period"]
    last = periods.max()
    start = pd.Period(first_test, freq="M")

    while start <= last:
        end = start + fold_months

        # PURGE: a training row's target must have fully resolved before the
        # test window opens.
        train_mask = (periods + horizon) < start
        test_mask = (periods >= start) & (periods < end)

        train_index = frame.index[train_mask]
        test_index = frame.index[test_mask]

        if len(train_index) >= min_train and len(test_index) > 0:
            yield Fold(train_index=train_index, test_index=test_index, test_start=start, test_end=end)

        start = end


def purged_inner_split(
    frame: pd.DataFrame,
    train_index: pd.Index,
    horizon: int,
    validation_months: int = 36,
) -> tuple[pd.Index, pd.Index]:
    """Split a training set into fit/validation for hyperparameter selection.

    Applies the same purge, so tuning cannot leak either. Returns empty indices
    when the training window is too short to split safely.
    """
    sub = frame.loc[train_index]
    if sub.empty:
        return pd.Index([]), pd.Index([])

    cutoff = sub["period"].max() - validation_months
    fit_mask = (sub["period"] + horizon) < cutoff
    val_mask = sub["period"] >= cutoff

    fit_index = sub.index[fit_mask]
    val_index = sub.index[val_mask]
    if len(fit_index) < 200 or len(val_index) < 50:
        return pd.Index([]), pd.Index([])
    return fit_index, val_index
