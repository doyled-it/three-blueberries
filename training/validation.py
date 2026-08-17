"""Purged walk-forward validation.

Standard k-fold cross-validation is invalid here for two separate reasons, and
both have to be handled or the model will report skill it does not have:

1. **Time order.** Shuffling rows lets the model train on 2012 and test on 2008.
   Folds must move forward in time only.

2. **Target overlap (the one people miss).** An observation at quarter *t* has its
   answer at *t + horizon*. If the test period starts at *T*, then a training row
   just before *T* with a 24-month horizon has a target that resolves deep inside
   the test window. Its label literally contains test-period information. Those
   rows must be *purged*.

Purging is what separates an honest walk-forward from a flattering one. With a
36-month horizon it removes three years of the most recent, and most relevant,
training data from every fold, which is exactly why naive implementations skip it.

The panel is QUARTERLY. Horizons are still labelled in months (12/24/36) because
that is how a reader thinks, so every purge converts months to quarters with
``horizon // Q`` before doing period arithmetic. Adding a raw month count to a
quarterly Period would embargo four times too much and silently gut the training
set.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

import pandas as pd

Q = 3  # months per quarter; a horizon of h months resolves h // Q quarters ahead


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
    fold_quarters: int = 8,
    min_train: int = 150,
) -> Iterator[Fold]:
    """Expanding-window folds with the target-overlap purge applied.

    ``horizon`` is in months; the panel is quarterly, so the purge embargoes
    ``horizon // Q`` quarters. ``fold_quarters`` sizes each test window (8 = two
    years). ``min_train`` is lower than the monthly pipeline's because quarterly
    data has roughly a quarter of the rows.
    """
    hq = horizon // Q
    periods = frame["period"]
    last = periods.max()
    start = pd.Period(first_test, freq="Q")

    while start <= last:
        end = start + fold_quarters

        # PURGE: a training row's target must have fully resolved before the
        # test window opens. periods are quarterly, so the horizon is too.
        train_mask = (periods + hq) < start
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
    validation_quarters: int = 12,
) -> tuple[pd.Index, pd.Index]:
    """Split a training set into fit/validation for hyperparameter selection.

    Applies the same quarterly purge, so tuning cannot leak either. Returns empty
    indices when the training window is too short to split safely.
    """
    hq = horizon // Q
    sub = frame.loc[train_index]
    if sub.empty:
        return pd.Index([]), pd.Index([])

    cutoff = sub["period"].max() - validation_quarters
    fit_mask = (sub["period"] + hq) < cutoff
    val_mask = sub["period"] >= cutoff

    fit_index = sub.index[fit_mask]
    val_index = sub.index[val_mask]
    if len(fit_index) < 100 or len(val_index) < 20:
        return pd.Index([]), pd.Index([])
    return fit_index, val_index
