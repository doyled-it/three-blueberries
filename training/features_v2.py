"""Richer, more time-aware features — testing whether the first attempt was underpowered.

The v1 feature set was mostly levels and simple trailing returns. Three hypotheses
this module exists to test:

1. **The deltas were too small / too short.** Add accelerations, longer lookbacks,
   and changes-of-changes.
2. **Missing compound and rolling structure.** Add rolling volatility, drawdown
   from a running peak, months-since-peak, spreads against long-run averages, and
   interactions between momentum and extremeness.
3. **Missing cross-sectional context.** A metro up 12% while the nation is up 12%
   is a different animal from one up 12% while the nation is flat. Add
   cross-metro ranks and a national cycle aggregate.

The last one is the most promising a priori: bubbles are relative, and v1 had no
way to see that.

Everything here obeys the same rule as v1: expanding or trailing windows only.
Cross-sectional features use only the current month across metros, which is
information genuinely available at that time.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from training.features import HORIZONS, DRAWDOWN_THRESHOLD, MIN_HISTORY_MONTHS, _annuity_factor, _national_frame

TREND_WINDOW = 120

FEATURES_V2: list[tuple[str, str]] = [
    # --- momentum and its derivatives -------------------------------------
    ("mom3", "3-month momentum"),
    ("mom12", "12-month momentum"),
    ("mom24", "24-month momentum"),
    ("mom36", "36-month momentum"),
    ("accel12", "Momentum acceleration"),
    ("mom_slowdown", "Short vs long momentum gap"),
    # --- valuation ----------------------------------------------------------
    ("real_price_z", "Real price vs own history"),
    ("dev_from_trend", "Deviation from 10-year trend"),
    ("burden_z", "Payment burden vs own history"),
    ("burden_chg12", "12-month change in payment burden"),
    # --- risk / path shape --------------------------------------------------
    ("vol12", "12-month price volatility"),
    ("vol36", "36-month price volatility"),
    ("drawdown_from_peak", "Distance below own running peak"),
    ("months_since_peak", "Months since own peak"),
    # --- cross-sectional context -------------------------------------------
    ("mom12_rank", "Momentum rank vs other metros"),
    ("valuation_rank", "Valuation rank vs other metros"),
    ("national_mom12", "National cycle momentum"),
    ("mom12_vs_national", "Momentum relative to national"),
    # --- macro --------------------------------------------------------------
    ("rate", "Mortgage rate level"),
    ("rate_chg12", "12-month change in rates"),
    ("rate_spread", "Rate vs its 10-year average"),
    ("supply", "Months' supply of new homes"),
    ("supply_chg12", "12-month change in supply"),
    ("delinquency", "Mortgage delinquency"),
    ("delinquency_chg12", "12-month change in delinquency"),
    ("unemployment", "Unemployment rate"),
    ("unemp_chg12", "12-month change in unemployment"),
    # --- interactions: the thing a linear model cannot express --------------
    ("mom_x_valuation", "Momentum x overvaluation"),
    ("mom_x_burden", "Momentum x payment burden"),
    ("valuation_sq", "Overvaluation, squared"),
]

FEATURE_KEYS_V2 = [k for k, _ in FEATURES_V2]


def build_panel_v2(raw: dict, horizons=HORIZONS) -> pd.DataFrame:
    national = _national_frame(raw["national"])
    blocks: list[pd.DataFrame] = []

    for metro_id, meta in raw["metros"].items():
        rows = meta["series"]
        idx = pd.PeriodIndex([pd.Period(m, freq="M") for m, _ in rows], freq="M")
        price = pd.Series([v for _, v in rows], index=idx, dtype="float64").sort_index()

        df = pd.DataFrame({"price": price}).join(national, how="left")
        df = df.dropna(subset=["price", "cpi", "rate"])

        log_price = np.log(df["price"])
        log_real = np.log(df["price"] / df["cpi"])
        burden = np.log((df["price"] / df["cpi"]) * _annuity_factor(df["rate"]))
        monthly_ret = log_price.diff()

        df["mom3"] = log_price - log_price.shift(3)
        df["mom12"] = log_price - log_price.shift(12)
        df["mom24"] = log_price - log_price.shift(24)
        df["mom36"] = log_price - log_price.shift(36)
        df["accel12"] = df["mom12"] - df["mom12"].shift(12)
        df["mom_slowdown"] = df["mom3"] * 4 - df["mom12"]

        real_mean = log_real.expanding(min_periods=60).mean()
        real_std = log_real.expanding(min_periods=60).std().replace(0, np.nan)
        df["real_price_z"] = (log_real - real_mean) / real_std
        df["dev_from_trend"] = log_real - log_real.rolling(TREND_WINDOW, min_periods=60).mean()

        burden_mean = burden.expanding(min_periods=60).mean()
        burden_std = burden.expanding(min_periods=60).std().replace(0, np.nan)
        df["burden_z"] = (burden - burden_mean) / burden_std
        df["burden_chg12"] = df["burden_z"] - df["burden_z"].shift(12)

        df["vol12"] = monthly_ret.rolling(12, min_periods=12).std()
        df["vol36"] = monthly_ret.rolling(36, min_periods=24).std()

        running_peak = df["price"].expanding().max()
        df["drawdown_from_peak"] = df["price"] / running_peak - 1.0
        peak_month = (
            pd.Series(np.arange(len(df)), index=df.index)
            .where(df["price"] >= running_peak)
            .ffill()
        )
        df["months_since_peak"] = np.arange(len(df)) - peak_month

        df["rate_spread"] = df["rate"] - df["rate"].rolling(120, min_periods=60).mean()
        df["rate_chg12"] = df["rate"] - df["rate"].shift(12)
        df["supply_chg12"] = df["supply"] - df["supply"].shift(12)
        df["delinquency_chg12"] = df["delinquency"] - df["delinquency"].shift(12)
        df["unemp_chg12"] = df["unemployment"] - df["unemployment"].shift(12)

        for h in horizons:
            df[f"fwd_ret_{h}"] = np.log(df["price"].shift(-h) / df["price"])
            forward_min = df["price"].shift(-1).rolling(h, min_periods=h).min().shift(-(h - 1))
            df[f"drawdown_{h}"] = ((forward_min / df["price"] - 1.0) <= DRAWDOWN_THRESHOLD).astype("float64")
            df.loc[forward_min.isna(), f"drawdown_{h}"] = np.nan

        df["metro"] = metro_id
        df["metro_name"] = meta["name"]
        df["month"] = df.index.astype(str)
        blocks.append(df.iloc[MIN_HISTORY_MONTHS:])

    frame = pd.concat(blocks).reset_index(names="period")

    # --- cross-sectional features: within-month, across metros --------------
    # Uses only same-month information across the panel, which a forecaster
    # standing at that month genuinely has.
    frame["mom12_rank"] = frame.groupby("period")["mom12"].rank(pct=True)
    frame["valuation_rank"] = frame.groupby("period")["real_price_z"].rank(pct=True)
    national_mom = frame.groupby("period")["mom12"].transform("median")
    frame["national_mom12"] = national_mom
    frame["mom12_vs_national"] = frame["mom12"] - national_mom

    # --- interactions ---------------------------------------------------------
    frame["mom_x_valuation"] = frame["mom12"] * frame["real_price_z"]
    frame["mom_x_burden"] = frame["mom12"] * frame["burden_z"]
    frame["valuation_sq"] = frame["real_price_z"] ** 2

    frame = frame.dropna(subset=FEATURE_KEYS_V2)
    return frame.sort_values(["period", "metro"]).reset_index(drop=True)


def horizon_frame_v2(frame: pd.DataFrame, horizon: int) -> pd.DataFrame:
    cols = ["period", "month", "metro", "metro_name", *FEATURE_KEYS_V2, f"fwd_ret_{horizon}", f"drawdown_{horizon}"]
    out = frame[cols].dropna().copy()
    out = out.rename(columns={f"fwd_ret_{horizon}": "target", f"drawdown_{horizon}": "drawdown"})
    return out.reset_index(drop=True)


def add_lags(frame: pd.DataFrame, keys: list[str], lags=(6, 12, 24)) -> tuple[pd.DataFrame, list[str]]:
    """Lagged copies of selected features — a tabular stand-in for a sequence model.

    Gradient boosting over a lagged window can represent most of what a small
    recurrent net would learn from this much data, without the sample size a
    recurrent net needs to avoid memorising.
    """
    out = frame.copy().sort_values(["metro", "period"])
    added: list[str] = []
    for key in keys:
        for lag in lags:
            name = f"{key}_lag{lag}"
            out[name] = out.groupby("metro")[key].shift(lag)
            added.append(name)
    out = out.dropna(subset=added)
    return out.sort_values(["period", "metro"]).reset_index(drop=True), added
