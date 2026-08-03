"""Does international data plus credit fix the forecaster?

    uv run python -m training.experiment_intl

The two changes being tested together:
  1. 19 countries of genuinely independent housing cycles instead of 20 US metros
     that all broke in the same quarter.
  2. Credit, the variable the literature ranks first and the US panel lacked.

Same validation discipline as everything else: purged walk-forward, embargo
applied, baselines reported, and an explicit out-of-sample test on the events
that matter (Japan 1991, the Nordic crises, Spain/Ireland 2008).
"""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import StandardScaler

from training.international import (
    DRAWDOWN_THRESHOLD,
    FEATURE_KEYS_INTL,
    FEATURES_INTL,
    build_international,
    episode_summary,
    horizon_frame_intl,
)

warnings.filterwarnings("ignore")


def walk_forward_q(frame: pd.DataFrame, horizon: int, first_test="1990Q1", fold_quarters=12, min_train=200):
    periods = frame["period"]
    last = periods.max()
    start = pd.Period(first_test, freq="Q")
    while start <= last:
        end = start + fold_quarters
        train = frame.index[(periods + horizon) < start]
        test = frame.index[(periods >= start) & (periods < end)]
        if len(train) >= min_train and len(test) > 0:
            yield train, test, start
        start = end


def skill(a, p, b):
    ssm = float(np.sum((a - p) ** 2))
    ssb = float(np.sum((a - b) ** 2))
    return 1.0 - ssm / ssb if ssb > 0 else float("nan")


def run(frame: pd.DataFrame, keys: list[str], horizon: int):
    actual, ridge_p, gbm_p, base_mean, base_mom, probs, dd, quarters, countries = [], [], [], [], [], [], [], [], []

    for train_idx, test_idx, _ in walk_forward_q(frame, horizon):
        train, test = frame.loc[train_idx], frame.loc[test_idx]
        scaler = StandardScaler().fit(train[keys].to_numpy())
        x_tr, x_te = scaler.transform(train[keys].to_numpy()), scaler.transform(test[keys].to_numpy())
        y_tr = train["target"].to_numpy()

        ridge_p.extend(Ridge(alpha=25.0).fit(x_tr, y_tr).predict(x_te).tolist())
        gbm_p.extend(
            HistGradientBoostingRegressor(
                max_depth=3, max_iter=250, learning_rate=0.05, min_samples_leaf=25, l2_regularization=1.0, random_state=0
            )
            .fit(x_tr, y_tr)
            .predict(x_te)
            .tolist()
        )

        d_tr = train["drawdown"].to_numpy()
        if len(np.unique(d_tr)) > 1:
            probs.extend(
                HistGradientBoostingClassifier(
                    max_depth=3, max_iter=200, learning_rate=0.05, min_samples_leaf=25, random_state=0
                )
                .fit(x_tr, d_tr)
                .predict_proba(x_te)[:, 1]
                .tolist()
            )
        else:
            probs.extend([float(d_tr.mean())] * len(test))

        actual.extend(test["target"].tolist())
        base_mean.extend([float(y_tr.mean())] * len(test))
        base_mom.extend(test["mom4"].tolist())
        dd.extend(test["drawdown"].tolist())
        quarters.extend(test["quarter"].tolist())
        countries.extend(test["country"].tolist())

    a, bm, bmo = np.array(actual), np.array(base_mean), np.array(base_mom)
    p_gbm, p_ridge, pr = np.array(gbm_p), np.array(ridge_p), np.array(probs)
    ddv, q, cn = np.array(dd), np.array(quarters), np.array(countries)
    up = float((a > 0).mean())

    return {
        "n": len(a),
        "up_rate": up,
        "base_rate": float(ddv.mean()),
        "ridge": {
            "skill_mean": skill(a, p_ridge, bm),
            "skill_mom": skill(a, p_ridge, bmo),
            "dir_edge": float((np.sign(p_ridge) == np.sign(a)).mean()) - up,
        },
        "gbm": {
            "skill_mean": skill(a, p_gbm, bm),
            "skill_mom": skill(a, p_gbm, bmo),
            "dir_edge": float((np.sign(p_gbm) == np.sign(a)).mean()) - up,
        },
        "auc": float(roc_auc_score(ddv, pr)) if len(np.unique(ddv)) > 1 else None,
        "_arrays": (a, p_gbm, pr, ddv, q, cn),
    }


def main() -> None:
    frame = build_international()
    print(f"International panel: {len(frame):,} country-quarters, {frame['country'].nunique()} countries")
    print(f"Span: {frame['quarter'].min()} to {frame['quarter'].max()}")

    episodes = episode_summary(frame)
    print("\n" + "=" * 78)
    print(f"INDEPENDENT DOWNTURNS ({abs(DRAWDOWN_THRESHOLD) * 100:.0f}%+ REAL DECLINE)")
    print("=" * 78)
    by_year = episodes["trough"].str[:4].value_counts().sort_index()
    print(f"  {len(episodes)} episodes across {episodes['country'].nunique()} countries")
    print(f"  Trough years span {by_year.index.min()} to {by_year.index.max()}")
    worst_year_share = by_year.max() / len(episodes)
    print(f"  Most concentrated single year: {by_year.idxmax()} with {by_year.max()} ({worst_year_share * 100:.0f}%)")
    print("\n  Deepest episodes:")
    for _, r in episodes.nsmallest(10, "depth").iterrows():
        print(f"    {r['country_name']:<16} trough {r['trough']}  {r['depth'] * 100:6.1f}%")

    print("\n  US-metro panel for comparison: 60% of episodes bottomed in 2009-2012.")
    print(f"  International panel: {worst_year_share * 100:.0f}% in its worst year. That is the point.")

    print("\n" + "=" * 78)
    print("DOES IT FORECAST?  (purged walk-forward, quarterly)")
    print("=" * 78)
    print(f"  {'horizon':<10} {'n':>6} {'model':<8} {'vs mean':>9} {'vs mom':>8} {'dir edge':>10} {'AUC':>7}  base")

    results = {}
    for h in (4, 8, 12, 20):
        f = horizon_frame_intl(frame, h)
        if len(f) < 500:
            continue
        r = run(f, FEATURE_KEYS_INTL, h)
        results[h] = r
        for name in ("ridge", "gbm"):
            m = r[name]
            print(
                f"  {str(h) + 'q (' + str(h // 4) + 'y)':<10} {r['n']:>6,} {name:<8} {m['skill_mean']:>9.3f} "
                f"{m['skill_mom']:>8.3f} {m['dir_edge'] * 100:>9.1f}p "
                f"{r['auc'] if r['auc'] else float('nan'):>7.3f}  {r['base_rate'] * 100:.0f}%"
            )

    # --- Does credit actually carry weight? ---------------------------------
    print("\n" + "=" * 78)
    print("IS CREDIT DOING THE WORK?  (12-quarter horizon, with vs without credit)")
    print("=" * 78)
    f12 = horizon_frame_intl(frame, 12)
    with_credit = run(f12, FEATURE_KEYS_INTL, 12)
    no_credit_keys = [k for k in FEATURE_KEYS_INTL if "credit" not in k]
    # dict.fromkeys dedupes while preserving order, mom4 is already in the
    # no-credit key list, and a duplicated column makes test["mom4"] a DataFrame.
    cols = list(dict.fromkeys(["period", "quarter", "country", "target", "drawdown", "mom4", *no_credit_keys]))
    without = run(f12[cols], no_credit_keys, 12)
    print(f"  {'setup':<20} {'vs mean':>9} {'vs mom':>8} {'dir edge':>10} {'AUC':>8}")
    for label, r in (("with credit", with_credit), ("without credit", without)):
        print(
            f"  {label:<20} {r['gbm']['skill_mean']:>9.3f} {r['gbm']['skill_mom']:>8.3f} "
            f"{r['gbm']['dir_edge'] * 100:>9.1f}p {r['auc']:>8.3f}"
        )
    delta = with_credit["auc"] - without["auc"]
    print(f"\n  Credit's contribution to crash-detection AUC: {delta:+.3f}")

    # --- The real test: the crises it never saw in training -----------------
    print("\n" + "=" * 78)
    print("OUT-OF-SAMPLE ON THE CRISES THAT MATTER")
    print("=" * 78)
    a, p_gbm, pr, ddv, q, cn = results[12]["_arrays"]
    events = [
        ("Japan, pre-1991", "JP", "1988Q1", "1990Q4"),
        ("Finland, pre-crash", "FI", "1988Q1", "1989Q4"),
        ("Sweden, pre-crash", "SE", "1988Q1", "1990Q4"),
        ("Spain, pre-2008", "ES", "2005Q1", "2007Q2"),
        ("Ireland, pre-2008", "IE", "2005Q1", "2007Q2"),
        ("US, pre-2008", "US", "2005Q1", "2006Q4"),
    ]
    print(f"  {'event':<22} {'n':>4} {'predicted':>11} {'actual':>9} {'crash prob':>12} {'actually fell':>15}")
    for label, code, lo, hi in events:
        mask = (cn == code) & (q >= lo) & (q <= hi)
        if mask.sum() == 0:
            print(f"  {label:<22}, not in the out-of-sample window")
            continue
        print(
            f"  {label:<22} {int(mask.sum()):>4} {p_gbm[mask].mean() * 100:>10.1f}% {a[mask].mean() * 100:>8.1f}% "
            f"{pr[mask].mean() * 100:>11.0f}% {ddv[mask].mean() * 100:>14.0f}%"
        )

    print("\n" + "=" * 78)
    print("VERDICT")
    print("=" * 78)
    best_h = max(results, key=lambda h: results[h]["gbm"]["skill_mom"])
    best = results[best_h]["gbm"]
    print(f"  Best horizon: {best_h} quarters ({best_h // 4} years)")
    print(f"    skill vs momentum {best['skill_mom']:+.3f}   direction edge {best['dir_edge'] * 100:+.1f}pts")
    print(f"    crash-detection AUC {results[best_h]['auc']:.3f}")
    beats = best["skill_mom"] > 0 and best["dir_edge"] > 0 and (results[best_h]["auc"] or 0) > 0.5
    print(f"\n  {'PASSES the pre-registered checks.' if beats else 'Still fails at least one pre-registered check.'}")


if __name__ == "__main__":
    main()
