"""Does a richer feature set or a sequence-aware model actually help?

    uv run python -m training.experiment

Tests, on identical purged walk-forward folds:

    v1 features        the original 12
    v2 features        30 features: accelerations, volatility, drawdown-from-peak,
                       cross-metro ranks, spreads, momentum x valuation interactions
    v2 + lags          v2 plus 6/12/24-month lagged copies of the key series,
                       a tabular stand-in for what a small recurrent net sees
    longer horizons    36, 48 and 60 months, in case the signal needs more room

Also reports the thing that actually bounds all of this: how many INDEPENDENT
housing downturns exist in the panel. Twenty metros is not twenty experiments if
they all crashed in the same year for the same reason.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import StandardScaler

from training.features import FEATURE_KEYS as FEATURE_KEYS_V1
from training.features import horizon_frame, load_panel
from training.features_v2 import FEATURE_KEYS_V2, add_lags, build_panel_v2, horizon_frame_v2
from training.validation import walk_forward

warnings.filterwarnings("ignore")

REPO_ROOT = Path(__file__).resolve().parent.parent
PANEL_PATH = REPO_ROOT / "data" / "panel.json"

LAG_KEYS = ["mom12", "real_price_z", "burden_z", "supply", "delinquency", "unemployment"]


def skill(actual, predicted, baseline) -> float:
    ss_m = float(np.sum((actual - predicted) ** 2))
    ss_b = float(np.sum((actual - baseline) ** 2))
    return 1.0 - ss_m / ss_b if ss_b > 0 else float("nan")


def run(frame: pd.DataFrame, keys: list[str], horizon: int, label: str) -> dict:
    actual, pred_ridge, pred_gbm, base_mean, base_mom, probs, dd_actual, months = [], [], [], [], [], [], [], []

    for fold in walk_forward(frame, horizon):
        train = frame.loc[fold.train_index]
        test = frame.loc[fold.test_index]

        scaler = StandardScaler().fit(train[keys].to_numpy())
        x_tr, x_te = scaler.transform(train[keys].to_numpy()), scaler.transform(test[keys].to_numpy())
        y_tr = train["target"].to_numpy()

        pred_ridge.extend(Ridge(alpha=50.0).fit(x_tr, y_tr).predict(x_te).tolist())
        gbm = HistGradientBoostingRegressor(
            max_depth=3, max_iter=300, learning_rate=0.05, min_samples_leaf=40, l2_regularization=1.0, random_state=0
        ).fit(x_tr, y_tr)
        pred_gbm.extend(gbm.predict(x_te).tolist())

        d_tr = train["drawdown"].to_numpy()
        if len(np.unique(d_tr)) > 1:
            clf = HistGradientBoostingClassifier(
                max_depth=3, max_iter=250, learning_rate=0.05, min_samples_leaf=40, random_state=0
            ).fit(x_tr, d_tr)
            probs.extend(clf.predict_proba(x_te)[:, 1].tolist())
        else:
            probs.extend([float(d_tr.mean())] * len(test))

        actual.extend(test["target"].tolist())
        base_mean.extend([float(y_tr.mean())] * len(test))
        base_mom.extend(test["mom12"].tolist())
        dd_actual.extend(test["drawdown"].tolist())
        months.extend(test["month"].tolist())

    a = np.array(actual)
    bm, bmom = np.array(base_mean), np.array(base_mom)
    up_rate = float((a > 0).mean())
    dd = np.array(dd_actual)
    m = np.array(months)
    pre = (m >= "2004-01") & (m <= "2006-06")

    out = {"label": label, "horizon": horizon, "n": len(a), "up_rate": up_rate}
    for name, p in (("ridge", np.array(pred_ridge)), ("gbm", np.array(pred_gbm))):
        out[name] = {
            "skill_vs_mean": skill(a, p, bm),
            "skill_vs_momentum": skill(a, p, bmom),
            "dir_edge": float((np.sign(p) == np.sign(a)).mean()) - up_rate,
            "pre_crash_pred": float(p[pre].mean()) if pre.sum() > 30 else None,
        }
    pr = np.array(probs)
    out["auc"] = float(roc_auc_score(dd, pr)) if len(np.unique(dd)) > 1 else None
    out["pre_crash_prob"] = float(pr[pre].mean()) if pre.sum() > 30 else None
    out["pre_crash_actual"] = float(dd[pre].mean()) if pre.sum() > 30 else None
    return out


def count_independent_episodes(raw: dict) -> None:
    """How many genuinely distinct downturns are in this panel?"""
    troughs = []
    for metro_id, meta in raw["metros"].items():
        rows = sorted(meta["series"])
        prices = pd.Series([v for _, v in rows], index=[m for m, _ in rows])
        peak = prices.expanding().max()
        dd = prices / peak - 1
        in_dd = dd <= -0.10
        if not in_dd.any():
            continue
        # Bottom of each contiguous episode.
        group = (in_dd != in_dd.shift()).cumsum()
        for _, block in prices[in_dd].groupby(group[in_dd]):
            troughs.append((metro_id, block.idxmin()))

    years = sorted({t[1][:4] for t in troughs})
    by_year: dict[str, int] = {}
    for _, month in troughs:
        by_year[month[:4]] = by_year.get(month[:4], 0) + 1

    print("\n" + "=" * 78)
    print("HOW MANY INDEPENDENT DOWNTURNS ARE ACTUALLY IN HERE?")
    print("=" * 78)
    print(f"  {len(troughs)} metro-level episodes of a 10%+ decline across {len(raw['metros'])} metros.")
    print(f"  Trough years: {', '.join(years)}")
    print("  Concentration by trough year:")
    for year in sorted(by_year, key=lambda y: -by_year[y])[:8]:
        share = by_year[year] / len(troughs)
        bar = "#" * int(share * 50)
        print(f"    {year}  {by_year[year]:3d}  {bar} {share * 100:.0f}%")
    biggest = max(by_year.values()) / len(troughs)
    print(f"\n  {biggest * 100:.0f}% of every downturn in this panel bottoms in a single year.")
    print("  Twenty metros is not twenty experiments. They are mostly one event, observed twenty times.")


def main() -> None:
    raw = json.loads(PANEL_PATH.read_text())
    count_independent_episodes(raw)

    panel_v1 = load_panel()
    frame_v2_all = build_panel_v2(raw, horizons=(24, 36, 48, 60))

    print("\n" + "=" * 78)
    print("DOES A RICHER FEATURE SET HELP?  (24-month horizon)")
    print("=" * 78)
    print(f"  {'setup':<22} {'features':>9} {'vs mean':>9} {'vs mom':>8} {'dir edge':>9} {'AUC':>6}  pre-2008 call")

    results = []
    v1 = run(horizon_frame(panel_v1, 24), FEATURE_KEYS_V1, 24, "v1 (original 12)")
    results.append(v1)

    f24 = horizon_frame_v2(frame_v2_all, 24)
    v2 = run(f24, FEATURE_KEYS_V2, 24, "v2 (30 features)")
    results.append(v2)

    lagged, lag_cols = add_lags(f24, LAG_KEYS)
    v2l = run(lagged, FEATURE_KEYS_V2 + lag_cols, 24, "v2 + lags (sequence)")
    results.append(v2l)

    for r in results:
        g = r["gbm"]
        n_feat = {"v1 (original 12)": len(FEATURE_KEYS_V1), "v2 (30 features)": len(FEATURE_KEYS_V2)}.get(
            r["label"], len(FEATURE_KEYS_V2) + len(lag_cols)
        )
        print(
            f"  {r['label']:<22} {n_feat:>9} {g['skill_vs_mean']:>9.3f} {g['skill_vs_momentum']:>8.3f} "
            f"{g['dir_edge'] * 100:>8.1f}p {r['auc']:>6.3f}  predicted {g['pre_crash_pred'] * 100:+.0f}%, "
            f"crash prob {r['pre_crash_prob'] * 100:.0f}% vs actual {r['pre_crash_actual'] * 100:.0f}%"
        )

    print("\n" + "=" * 78)
    print("DO LONGER HORIZONS HELP?  (v2 features, gradient boosting)")
    print("=" * 78)
    print(f"  {'horizon':<10} {'n':>7} {'vs mean':>9} {'vs mom':>8} {'dir edge':>9} {'AUC':>7}  base rate")
    for h in (24, 36, 48, 60):
        fh = horizon_frame_v2(frame_v2_all, h)
        r = run(fh, FEATURE_KEYS_V2, h, f"{h}mo")
        g = r["gbm"]
        base = r["pre_crash_actual"]
        print(
            f"  {h:<10} {r['n']:>7,} {g['skill_vs_mean']:>9.3f} {g['skill_vs_momentum']:>8.3f} "
            f"{g['dir_edge'] * 100:>8.1f}p {r['auc']:>7.3f}  {base * 100 if base else 0:.0f}%"
        )

    print("\n" + "=" * 78)
    print("VERDICT")
    print("=" * 78)
    best = max(results, key=lambda r: r["gbm"]["skill_vs_momentum"])
    gain = best["gbm"]["skill_vs_momentum"] - v1["gbm"]["skill_vs_momentum"]
    print(f"  Best setup: {best['label']}")
    print(f"  Improvement over v1 against the momentum baseline: {gain:+.3f}")
    if best["gbm"]["skill_vs_momentum"] > 0 and best["gbm"]["dir_edge"] > 0:
        print("  -> Richer features fixed it. Worth pursuing a sequence model next.")
    else:
        print("  -> Still cannot beat 'assume the trend continues', and still cannot")
        print("     call the turn. More features did not fix it, which points at the")
        print("     sample size rather than the feature set.")


if __name__ == "__main__":
    main()
