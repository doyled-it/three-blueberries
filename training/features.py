"""Feature engineering for the housing forecaster.

The panel is QUARTERLY: FHFA's metro house price index is published quarterly,
so a "12-month" feature is four quarters, a 24-month horizon is eight, and every
window below counts quarters. The feature and horizon names stay in months
because that is how a reader thinks about them; the arithmetic is in quarters.

The single most important property of this module is that **no feature may see
the future**. Every rolling statistic uses an expanding or trailing window ending
at the observation's own quarter.

This matters more than it sounds. A full-sample z-score of price would encode
"2008 was the peak" into 2005's features, and the resulting model would look
extraordinary and be worthless. Pandas makes that mistake a one-character
difference (`.expanding()` vs `.transform('mean')`), so every window here is
written explicitly and tested in training/tests/test_features.py.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
PANEL_PATH = REPO_ROOT / "data" / "panel.json"

# Horizons are labelled in MONTHS (how a reader thinks) but the data is
# quarterly, so a horizon of h months is h // 3 quarters ahead.
HORIZONS = (12, 24, 36)
Q = 3  # months per quarter, so a shift of n quarters is n = months // Q
DRAWDOWN_THRESHOLD = -0.10

# Minimum history before a metro contributes rows, and the trend window, both in
# QUARTERS. A decade of trend is 40 quarters; the expanding z-scores need 20.
MIN_HISTORY_QUARTERS = 40
TREND_WINDOW = 40
Z_MIN_PERIODS = 20

FEATURES: list[tuple[str, str]] = [
    ("mom3", "3-month momentum"),
    ("mom12", "12-month momentum"),
    ("mom24", "24-month momentum"),
    ("real_price_z", "Real price vs own history"),
    ("dev_from_trend", "Deviation from 10-year trend"),
    ("burden_z", "Payment burden vs own history"),
    ("rate", "Mortgage rate level"),
    ("rate_chg12", "12-month change in rates"),
    ("supply", "Months' supply of new homes"),
    ("delinquency", "Mortgage delinquency"),
    ("unemployment", "Unemployment rate"),
    ("unemp_chg12", "12-month change in unemployment"),
]

FEATURE_KEYS = [key for key, _ in FEATURES]


@dataclass(frozen=True)
class Panel:
    frame: pd.DataFrame
    metros: dict[str, str]
    retrieved: str


def _annuity_factor(rate_percent: pd.Series) -> pd.Series:
    """Monthly payment per dollar borrowed, 30-year fixed."""
    r = rate_percent / 100.0 / 12.0
    n = 360
    growth = (1.0 + r) ** n
    return np.where(r == 0, 1.0 / n, (r * growth) / (growth - 1.0))


def _national_frame(national: dict[str, list]) -> pd.DataFrame:
    """National series joined onto a QUARTERLY index, forward-filled.

    The panel already resamples every national series to quarters, so this just
    aligns them. Forward-fill is not lookahead: a value published for Q1 is the
    most recent *known* value during Q2.
    """
    series = {}
    for key, rows in national.items():
        s = pd.Series(
            {pd.Period(month, freq="Q"): value for month, value in rows},
            name=key,
            dtype="float64",
        ).sort_index()
        series[key] = s

    idx = pd.period_range(
        min(s.index.min() for s in series.values()),
        max(s.index.max() for s in series.values()),
        freq="Q",
    )
    frame = pd.DataFrame(index=idx)
    for key, s in series.items():
        frame[key] = s.reindex(idx).ffill()
    return frame


def load_panel(path: Path = PANEL_PATH) -> Panel:
    raw = json.loads(path.read_text())
    national = _national_frame(raw["national"])

    blocks: list[pd.DataFrame] = []
    metros: dict[str, str] = {}

    for metro_id, meta in raw["metros"].items():
        metros[metro_id] = meta["name"]
        rows = meta["series"]
        idx = pd.PeriodIndex([pd.Period(m, freq="Q") for m, _ in rows], freq="Q")
        price = pd.Series([v for _, v in rows], index=idx, dtype="float64").sort_index()

        df = pd.DataFrame({"price": price})
        df = df.join(national, how="left")
        df = df.dropna(subset=["price", "cpi", "rate"])

        log_real = np.log(df["price"] / df["cpi"])
        burden = np.log((df["price"] / df["cpi"]) * _annuity_factor(df["rate"]))

        # --- momentum: trailing log returns -------------------------------
        df["mom3"] = np.log(df["price"] / df["price"].shift(1))  # 1 quarter
        df["mom12"] = np.log(df["price"] / df["price"].shift(4))  # 4 quarters
        df["mom24"] = np.log(df["price"] / df["price"].shift(8))  # 8 quarters

        # --- EXPANDING statistics: strictly data up to and including t -----
        real_mean = log_real.expanding(min_periods=Z_MIN_PERIODS).mean()
        real_std = log_real.expanding(min_periods=Z_MIN_PERIODS).std()
        df["real_price_z"] = (log_real - real_mean) / real_std.replace(0, np.nan)

        burden_mean = burden.expanding(min_periods=Z_MIN_PERIODS).mean()
        burden_std = burden.expanding(min_periods=Z_MIN_PERIODS).std()
        df["burden_z"] = (burden - burden_mean) / burden_std.replace(0, np.nan)

        # --- trailing trend ------------------------------------------------
        df["dev_from_trend"] = log_real - log_real.rolling(TREND_WINDOW, min_periods=Z_MIN_PERIODS).mean()

        # --- national levels and changes ------------------------------------
        df["rate_chg12"] = df["rate"] - df["rate"].shift(4)
        df["unemp_chg12"] = df["unemployment"] - df["unemployment"].shift(4)

        # --- targets ---------------------------------------------------------
        for h in HORIZONS:
            hq = h // Q  # horizon in quarters
            df[f"fwd_ret_{h}"] = np.log(df["price"].shift(-hq) / df["price"])
            # Worst point reached at any time inside the horizon, not just the end.
            forward_min = df["price"].shift(-1).rolling(hq, min_periods=hq).min().shift(-(hq - 1))
            df[f"drawdown_{h}"] = ((forward_min / df["price"] - 1.0) <= DRAWDOWN_THRESHOLD).astype("float64")
            df.loc[forward_min.isna(), f"drawdown_{h}"] = np.nan

        df["metro"] = metro_id
        df["metro_name"] = meta["name"]
        df["month"] = df.index.astype(str)
        df["order"] = np.arange(len(df))
        df = df.iloc[MIN_HISTORY_QUARTERS:]
        blocks.append(df)

    frame = pd.concat(blocks).reset_index(names="period")
    frame = frame.dropna(subset=FEATURE_KEYS)
    frame = frame.sort_values(["period", "metro"]).reset_index(drop=True)
    return Panel(frame=frame, metros=metros, retrieved=raw.get("retrieved", "unknown"))


def horizon_frame(panel: Panel, horizon: int) -> pd.DataFrame:
    """Rows usable for a given horizon: features plus a realized target."""
    cols = ["period", "month", "metro", "metro_name", *FEATURE_KEYS, f"fwd_ret_{horizon}", f"drawdown_{horizon}"]
    df = panel.frame[cols].dropna().copy()
    df = df.rename(columns={f"fwd_ret_{horizon}": "target", f"drawdown_{horizon}": "drawdown"})
    return df.reset_index(drop=True)


def latest_features(panel: Panel, metro: str) -> pd.Series:
    """The most recent fully-formed feature vector for one metro."""
    rows = panel.frame[panel.frame["metro"] == metro].dropna(subset=FEATURE_KEYS)
    if rows.empty:
        raise ValueError(f"no usable rows for metro {metro}")
    return rows.iloc[-1]
