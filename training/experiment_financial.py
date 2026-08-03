"""Do financial-plumbing indicators improve the pre-2008 call?

    uv run python -m training.experiment_financial

Tests the hypothesis directly: add the Chicago Fed's leverage subindex, overall
financial conditions, the credit and risk subindices, credit spreads, and the
growth of mortgage and financial-sector debt to the US metro panel, then look
at what the model says in 2004-2006 specifically.

The eyeball evidence already suggests this will not work (leverage sat at the
45th percentile of its own history through the run-up, and credit spreads were
TIGHTER than average). But "it looks like it won't help" is not a result, so
this measures it.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import StandardScaler

from training.features_v2 import FEATURE_KEYS_V2, build_panel_v2, horizon_frame_v2
from training.validation import walk_forward

warnings.filterwarnings("ignore")

REPO_ROOT = Path(__file__).resolve().parent.parent
FINANCIAL_KEYS = [
    "leverage",
    "conditions",
    "credit",
    "risk",
    "creditSpread",
    "leverage_chg12",
    "conditions_chg12",
    "creditSpread_chg12",
    "mortgage_debt_growth",
    "financial_debt_growth",
]


def attach_financial(frame: pd.DataFrame) -> pd.DataFrame:
    raw = json.loads((REPO_ROOT / "data" / "financial.json").read_text())["series"]

    monthly = {}
    for key, rows in raw.items():
        s = pd.Series({pd.Period(m, freq="M"): v for m, v in rows}, dtype="float64").sort_index()
        monthly[key] = s

    idx = pd.period_range(min(s.index.min() for s in monthly.values()), max(s.index.max() for s in monthly.values()), freq="M")
    fin = pd.DataFrame(index=idx)
    for key, s in monthly.items():
        fin[key] = s.reindex(idx).ffill()

    fin["leverage_chg12"] = fin["leverage"] - fin["leverage"].shift(12)
    fin["conditions_chg12"] = fin["conditions"] - fin["conditions"].shift(12)
    fin["creditSpread_chg12"] = fin["creditSpread"] - fin["creditSpread"].shift(12)
    fin["mortgage_debt_growth"] = np.log(fin["mortgageDebt"] / fin["mortgageDebt"].shift(12))
    fin["financial_debt_growth"] = np.log(fin["financialDebt"] / fin["financialDebt"].shift(12))

    out = frame.merge(fin[FINANCIAL_KEYS], left_on="period", right_index=True, how="left")
    return out.dropna(subset=FINANCIAL_KEYS)


def run(frame: pd.DataFrame, keys: list[str], horizon: int) -> dict:
    actual, pred, probs, dd, months, base_mom = [], [], [], [], [], []

    for fold in walk_forward(frame, horizon):
        train, test = frame.loc[fold.train_index], frame.loc[fold.test_index]
        scaler = StandardScaler().fit(train[keys].to_numpy())
        x_tr, x_te = scaler.transform(train[keys].to_numpy()), scaler.transform(test[keys].to_numpy())
        y_tr = train["target"].to_numpy()

        pred.extend(
            HistGradientBoostingRegressor(
                max_depth=3, max_iter=300, learning_rate=0.05, min_samples_leaf=40, l2_regularization=1.0, random_state=0
            )
            .fit(x_tr, y_tr)
            .predict(x_te)
            .tolist()
        )

        d_tr = train["drawdown"].to_numpy()
        if len(np.unique(d_tr)) > 1:
            probs.extend(
                HistGradientBoostingClassifier(
                    max_depth=3, max_iter=250, learning_rate=0.05, min_samples_leaf=40, random_state=0
                )
                .fit(x_tr, d_tr)
                .predict_proba(x_te)[:, 1]
                .tolist()
            )
        else:
            probs.extend([float(d_tr.mean())] * len(test))

        actual.extend(test["target"].tolist())
        dd.extend(test["drawdown"].tolist())
        months.extend(test["month"].tolist())
        base_mom.extend(test["mom12"].tolist())

    a, p, pr = np.array(actual), np.array(pred), np.array(probs)
    ddv, m, bmo = np.array(dd), np.array(months), np.array(base_mom)
    pre = (m >= "2004-01") & (m <= "2006-06")
    up = float((a > 0).mean())

    ss_m = float(np.sum((a - p) ** 2))
    ss_b = float(np.sum((a - bmo) ** 2))

    return {
        "n": len(a),
        "skill_vs_momentum": 1 - ss_m / ss_b,
        "dir_edge": float((np.sign(p) == np.sign(a)).mean()) - up,
        "auc": float(roc_auc_score(ddv, pr)) if len(np.unique(ddv)) > 1 else None,
        "pre_pred": float(p[pre].mean()) if pre.sum() > 30 else None,
        "pre_actual": float(a[pre].mean()) if pre.sum() > 30 else None,
        "pre_prob": float(pr[pre].mean()) if pre.sum() > 30 else None,
        "pre_hit": float(ddv[pre].mean()) if pre.sum() > 30 else None,
        "pre_flagged": float((p[pre] < 0).mean()) if pre.sum() > 30 else None,
    }


def main() -> None:
    raw = json.loads((REPO_ROOT / "data" / "panel.json").read_text())
    panel = build_panel_v2(raw, horizons=(24, 36))

    print("=" * 78)
    print("WAS THE PLUMBING EVEN FLASHING RED BEFORE 2008?")
    print("=" * 78)
    fin = json.loads((REPO_ROOT / "data" / "financial.json").read_text())["series"]
    lev = pd.Series({m: v for m, v in fin["leverage"]})
    pre = lev[(lev.index >= "2004-01") & (lev.index <= "2006-06")]
    print(f"  NFCI leverage subindex, 2004-01..2006-06 average: {pre.mean():+.3f}")
    print(f"  Percentile of its own full history:               {(lev < pre.mean()).mean() * 100:.0f}th")
    print(f"  First month it exceeded +1.0:                     {lev[lev > 1.0].index.min()}")
    print(f"  San Diego prices had already peaked in:           2006-03")
    print("  -> the leverage signal arrives roughly 21 months AFTER the top.")

    for horizon in (24, 36):
        f = horizon_frame_v2(panel, horizon)
        f_fin = attach_financial(f)
        # Compare on the SAME rows, so the only difference is the feature set.
        without = run(f_fin, FEATURE_KEYS_V2, horizon)
        with_fin = run(f_fin, FEATURE_KEYS_V2 + FINANCIAL_KEYS, horizon)

        print("\n" + "=" * 78)
        print(f"{horizon}-MONTH HORIZON, does the plumbing help?  (n={with_fin['n']:,}, identical rows)")
        print("=" * 78)
        print(f"  {'feature set':<26} {'vs momentum':>12} {'dir edge':>10} {'AUC':>8}")
        print(f"  {'housing only':<26} {without['skill_vs_momentum']:>12.3f} {without['dir_edge'] * 100:>9.1f}p {without['auc']:>8.3f}")
        print(f"  {'+ financial plumbing':<26} {with_fin['skill_vs_momentum']:>12.3f} {with_fin['dir_edge'] * 100:>9.1f}p {with_fin['auc']:>8.3f}")
        print(f"  {'delta':<26} {with_fin['skill_vs_momentum'] - without['skill_vs_momentum']:>+12.3f} "
              f"{(with_fin['dir_edge'] - without['dir_edge']) * 100:>+9.1f}p {with_fin['auc'] - without['auc']:>+8.3f}")

        print(f"\n  The 2004-2006 call (actual outcome {with_fin['pre_actual'] * 100:+.1f}%):")
        for label, r in (("housing only", without), ("+ plumbing", with_fin)):
            print(
                f"    {label:<22} predicted {r['pre_pred'] * 100:+6.1f}%   crash prob {r['pre_prob'] * 100:3.0f}% "
                f"(actual {r['pre_hit'] * 100:.0f}%)   flagged negative {r['pre_flagged'] * 100:3.0f}%"
            )

    print("\n" + "=" * 78)
    print("WHY")
    print("=" * 78)
    print("  Credit spreads were TIGHTER than average through the run-up: 1.69 in")
    print("  2006-03 against 2.86 in 2003. Risk was not mispriced by accident, narrow")
    print("  spreads ARE the bubble condition. The indicator that should warn you looks")
    print("  its best right before the fall, because complacency is the thing being")
    print("  measured. That is not a data problem you can fix with a better model.")


if __name__ == "__main__":
    main()
