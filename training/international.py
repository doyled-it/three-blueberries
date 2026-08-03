"""International housing panel: 19 countries, quarterly, with credit.

Two things are different from the US-metro panel, and both matter:

**Independent events.** Japan 1991, Finland/Sweden/Norway 1991-93, Asia 1997,
Spain/Ireland/US 2008, and assorted national cycles in between. These are driven
by different central banks, different credit regimes, and different timing,
unlike 20 US metros that all broke in the same quarter for the same reason.

**Credit.** The literature's top-ranked predictor, and the one the US panel
lacked entirely. Jorda, Schularick & Taylor's "Leveraged Bubbles" finds that
credit is what separates a dangerous housing boom from a harmless one: the
interaction of price momentum with credit growth, not either alone. That
interaction is an explicit feature here (`mom_x_credit`), because it is a
theoretical prediction rather than something a model should have to discover.

Everything obeys the same causality rule as the other feature modules: expanding
or trailing windows only, and cross-sectional features use same-quarter
information across countries, which a forecaster standing at that quarter has.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
PANEL_PATH = REPO_ROOT / "data" / "international.json"

# Quarterly data, so horizons are in quarters: 1, 2, 3 and 5 years.
HORIZONS_Q = (4, 8, 12, 20)
DRAWDOWN_THRESHOLD = -0.15  # real terms, so a deeper bar than the 10% nominal one

FEATURES_INTL: list[tuple[str, str]] = [
    # --- price dynamics -----------------------------------------------------
    ("mom4", "1-year real price growth"),
    ("mom12", "3-year real price growth"),
    ("mom20", "5-year real price growth"),
    ("accel", "Growth acceleration"),
    ("price_z", "Real price vs own history"),
    ("dev_from_trend", "Deviation from long-run trend"),
    ("drawdown_from_peak", "Distance below own peak"),
    ("quarters_since_peak", "Quarters since peak"),
    ("vol", "Price volatility"),
    # --- CREDIT: the literature's headline variable -------------------------
    ("hh_credit", "Household credit / GDP"),
    ("hh_credit_chg4", "1-year change in household credit"),
    ("hh_credit_chg12", "3-year change in household credit"),
    ("hh_credit_gap", "Household credit vs its trend"),
    ("priv_credit_chg12", "3-year change in private credit"),
    # --- rates --------------------------------------------------------------
    ("long_rate", "Long-term rate"),
    ("short_rate", "Short-term rate"),
    ("term_spread", "Term spread (long minus short)"),
    ("real_rate", "Real long rate"),
    ("rate_chg4", "1-year change in long rate"),
    # --- macro --------------------------------------------------------------
    ("unemployment", "Unemployment rate"),
    ("unemp_chg4", "1-year change in unemployment"),
    ("inflation", "Inflation rate"),
    # --- global cycle -------------------------------------------------------
    ("global_mom12", "Global 3-year price growth"),
    ("mom_vs_global", "Growth relative to global"),
    ("mom_rank", "Growth rank across countries"),
    # --- the leveraged-bubble interactions ----------------------------------
    ("mom_x_credit", "Price growth x credit growth"),
    ("valuation_x_credit", "Overvaluation x credit growth"),
    ("mom_x_valuation", "Price growth x overvaluation"),
]

FEATURE_KEYS_INTL = [k for k, _ in FEATURES_INTL]


def _quarterly(rows: list, name: str) -> pd.Series:
    """Monthly or quarterly rows -> a quarterly series indexed by period."""
    s = pd.Series(
        {pd.Period(month, freq="M"): value for month, value in rows},
        dtype="float64",
        name=name,
    ).sort_index()
    return s.groupby(s.index.asfreq("Q")).mean()


def build_international(path: Path = PANEL_PATH) -> pd.DataFrame:
    raw = json.loads(path.read_text())
    blocks: list[pd.DataFrame] = []

    for code, entry in raw["countries"].items():
        series = entry["series"]
        price = _quarterly(series["realPrice"], "price")
        df = pd.DataFrame({"price": price})

        for key in ("householdCredit", "privateCredit", "longRate", "shortRate", "unemployment", "cpi"):
            df[key] = _quarterly(series[key], key).reindex(df.index).ffill() if key in series else np.nan

        log_price = np.log(df["price"])

        df["mom4"] = log_price - log_price.shift(4)
        df["mom12"] = log_price - log_price.shift(12)
        df["mom20"] = log_price - log_price.shift(20)
        df["accel"] = df["mom4"] - df["mom4"].shift(4)

        mean = log_price.expanding(min_periods=20).mean()
        std = log_price.expanding(min_periods=20).std().replace(0, np.nan)
        df["price_z"] = (log_price - mean) / std
        df["dev_from_trend"] = log_price - log_price.rolling(40, min_periods=20).mean()

        peak = df["price"].expanding().max()
        df["drawdown_from_peak"] = df["price"] / peak - 1.0
        at_peak = pd.Series(np.arange(len(df)), index=df.index).where(df["price"] >= peak).ffill()
        df["quarters_since_peak"] = np.arange(len(df)) - at_peak
        df["vol"] = log_price.diff().rolling(12, min_periods=8).std()

        # --- credit ---------------------------------------------------------
        hh = df["householdCredit"]
        df["hh_credit"] = hh
        df["hh_credit_chg4"] = hh - hh.shift(4)
        df["hh_credit_chg12"] = hh - hh.shift(12)
        df["hh_credit_gap"] = hh - hh.rolling(40, min_periods=20).mean()
        df["priv_credit_chg12"] = df["privateCredit"] - df["privateCredit"].shift(12)

        # --- rates -----------------------------------------------------------
        df["long_rate"] = df["longRate"]
        df["short_rate"] = df["shortRate"]
        df["term_spread"] = df["longRate"] - df["shortRate"]
        df["real_rate"] = df["longRate"] - df["cpi"]
        df["rate_chg4"] = df["longRate"] - df["longRate"].shift(4)

        df["unemp_chg4"] = df["unemployment"] - df["unemployment"].shift(4)
        df["inflation"] = df["cpi"]

        # --- targets ----------------------------------------------------------
        for h in HORIZONS_Q:
            df[f"fwd_ret_{h}"] = np.log(df["price"].shift(-h) / df["price"])
            forward_min = df["price"].shift(-1).rolling(h, min_periods=h).min().shift(-(h - 1))
            df[f"drawdown_{h}"] = ((forward_min / df["price"] - 1.0) <= DRAWDOWN_THRESHOLD).astype("float64")
            df.loc[forward_min.isna(), f"drawdown_{h}"] = np.nan

        df["country"] = code
        df["country_name"] = entry["name"]
        df["quarter"] = df.index.astype(str)
        blocks.append(df.iloc[20:])

    frame = pd.concat(blocks).reset_index(names="period")

    # --- the global cycle ----------------------------------------------------
    global_mom = frame.groupby("period")["mom12"].transform("median")
    frame["global_mom12"] = global_mom
    frame["mom_vs_global"] = frame["mom12"] - global_mom
    frame["mom_rank"] = frame.groupby("period")["mom12"].rank(pct=True)

    # --- leveraged-bubble interactions --------------------------------------
    frame["mom_x_credit"] = frame["mom12"] * frame["hh_credit_chg12"]
    frame["valuation_x_credit"] = frame["price_z"] * frame["hh_credit_chg12"]
    frame["mom_x_valuation"] = frame["mom12"] * frame["price_z"]

    return frame.sort_values(["period", "country"]).reset_index(drop=True)


def horizon_frame_intl(frame: pd.DataFrame, horizon: int, require_credit: bool = True) -> pd.DataFrame:
    keys = FEATURE_KEYS_INTL if require_credit else [k for k in FEATURE_KEYS_INTL if "credit" not in k]
    cols = ["period", "quarter", "country", "country_name", *keys, f"fwd_ret_{horizon}", f"drawdown_{horizon}"]
    out = frame[cols].dropna().copy()
    out = out.rename(columns={f"fwd_ret_{horizon}": "target", f"drawdown_{horizon}": "drawdown"})
    return out.reset_index(drop=True)


def episode_summary(frame: pd.DataFrame) -> pd.DataFrame:
    """Distinct 15%+ real drawdowns per country, with their trough quarter."""
    records = []
    for code, block in frame.groupby("country"):
        block = block.sort_values("period")
        peak = block["price"].expanding().max()
        dd = block["price"] / peak - 1
        in_dd = dd <= DRAWDOWN_THRESHOLD
        if not in_dd.any():
            continue
        group = (in_dd != in_dd.shift()).cumsum()
        for _, episode in block[in_dd].groupby(group[in_dd]):
            trough = episode.loc[episode["price"].idxmin()]
            records.append(
                {
                    "country": code,
                    "country_name": episode["country_name"].iloc[0],
                    "trough": str(trough["period"]),
                    "depth": float(episode["price"].min() / peak.loc[episode.index].max() - 1),
                }
            )
    return pd.DataFrame(records)
