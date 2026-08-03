"""Trains the forecaster, compares model families, and emits lib/data/model.ts.

    uv run python -m training.train

Reports, for every horizon and every model family, out-of-sample performance on
identical purged walk-forward folds, plus the diagnostics that actually decide
whether the thing is useful:

  * skill against "predict the average" and "assume the trend continues"
  * performance conditional on the market currently RISING (the hard case) versus
    already FALLING (where predicting more decline is just reading a thermometer)
  * what it would have said in 2004-2006, the one call anyone cares about
  * how much of its directional accuracy is just "housing usually goes up"

The browser never sees a model. This writes coefficients, metrics and the current
forecast into a TypeScript file; inference client-side is a dot product.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.preprocessing import StandardScaler

from training.features import FEATURE_KEYS, FEATURES, HORIZONS, horizon_frame, latest_features, load_panel
from training.validation import walk_forward

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "lib" / "data" / "model.ts"

TARGET_METRO = "SDXRSA"
PRE_CRASH = ("2004-01", "2006-06")


def build_regressors() -> dict[str, object]:
    return {
        "ridge": Ridge(alpha=50.0),
        "gradient_boosting": HistGradientBoostingRegressor(
            max_depth=3,
            max_iter=300,
            learning_rate=0.05,
            min_samples_leaf=40,
            l2_regularization=1.0,
            random_state=0,
        ),
        "random_forest": RandomForestRegressor(
            n_estimators=300,
            max_depth=8,
            min_samples_leaf=25,
            n_jobs=-1,
            random_state=0,
        ),
    }


@dataclass
class Predictions:
    actual: list[float] = field(default_factory=list)
    predicted: dict[str, list[float]] = field(default_factory=dict)
    baseline_mean: list[float] = field(default_factory=list)
    baseline_momentum: list[float] = field(default_factory=list)
    month: list[str] = field(default_factory=list)
    metro: list[str] = field(default_factory=list)
    drawdown_actual: list[float] = field(default_factory=list)
    drawdown_prob: dict[str, list[float]] = field(default_factory=dict)


def r2(actual: np.ndarray, predicted: np.ndarray) -> float:
    ss_res = float(np.sum((actual - predicted) ** 2))
    ss_tot = float(np.sum((actual - actual.mean()) ** 2))
    return 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan")


def skill(actual: np.ndarray, predicted: np.ndarray, baseline: np.ndarray) -> float:
    ss_model = float(np.sum((actual - predicted) ** 2))
    ss_base = float(np.sum((actual - baseline) ** 2))
    return 1.0 - ss_model / ss_base if ss_base > 0 else float("nan")


def evaluate_horizon(panel, horizon: int) -> dict:
    frame = horizon_frame(panel, horizon)
    preds = Predictions()
    regressors = build_regressors()
    for name in regressors:
        preds.predicted[name] = []
    preds.drawdown_prob["logistic"] = []
    preds.drawdown_prob["gradient_boosting"] = []

    folds = list(walk_forward(frame, horizon))
    print(f"\n{'=' * 74}\n{horizon}-MONTH HORIZON, {len(frame):,} rows, {len(folds)} walk-forward folds\n{'=' * 74}")

    for fold in folds:
        train = frame.loc[fold.train_index]
        test = frame.loc[fold.test_index]

        scaler = StandardScaler().fit(train[FEATURE_KEYS].to_numpy())
        x_train = scaler.transform(train[FEATURE_KEYS].to_numpy())
        x_test = scaler.transform(test[FEATURE_KEYS].to_numpy())
        y_train = train["target"].to_numpy()

        for name, model in build_regressors().items():
            model.fit(x_train, y_train)
            preds.predicted[name].extend(model.predict(x_test).tolist())

        # Classifier head: probability of a 10%+ fall inside the horizon.
        d_train = train["drawdown"].to_numpy()
        if len(np.unique(d_train)) > 1:
            logit = LogisticRegression(C=0.05, max_iter=2000).fit(x_train, d_train)
            preds.drawdown_prob["logistic"].extend(logit.predict_proba(x_test)[:, 1].tolist())

            gbc = HistGradientBoostingClassifier(
                max_depth=3, max_iter=250, learning_rate=0.05, min_samples_leaf=40, random_state=0
            ).fit(x_train, d_train)
            preds.drawdown_prob["gradient_boosting"].extend(gbc.predict_proba(x_test)[:, 1].tolist())
        else:
            base = float(d_train.mean())
            preds.drawdown_prob["logistic"].extend([base] * len(test))
            preds.drawdown_prob["gradient_boosting"].extend([base] * len(test))

        preds.actual.extend(test["target"].tolist())
        preds.baseline_mean.extend([float(y_train.mean())] * len(test))
        preds.baseline_momentum.extend(test["mom12"].tolist())
        preds.month.extend(test["month"].tolist())
        preds.metro.extend(test["metro"].tolist())
        preds.drawdown_actual.extend(test["drawdown"].tolist())

    actual = np.array(preds.actual)
    mean_base = np.array(preds.baseline_mean)
    mom_base = np.array(preds.baseline_momentum)
    months = np.array(preds.month)
    rising = mom_base > 0.02

    up_rate = float((actual > 0).mean())

    print(f"\n  Baselines            R²        RMSE")
    print(f"    predict the mean   {r2(actual, mean_base):+.3f}    {np.sqrt(np.mean((actual - mean_base) ** 2)) * 100:5.1f}%")
    print(f"    trend continues    {r2(actual, mom_base):+.3f}    {np.sqrt(np.mean((actual - mom_base) ** 2)) * 100:5.1f}%")

    print(f"\n  Model                R²      vs mean   vs momentum   RMSE     dir.acc")
    results = {}
    for name in build_regressors():
        p = np.array(preds.predicted[name])
        results[name] = {
            "r2": r2(actual, p),
            "skill_vs_mean": skill(actual, p, mean_base),
            "skill_vs_momentum": skill(actual, p, mom_base),
            "rmse": float(np.sqrt(np.mean((actual - p) ** 2))),
            "directional_accuracy": float((np.sign(p) == np.sign(actual)).mean()),
            "r2_rising": r2(actual[rising], p[rising]),
            "r2_falling": r2(actual[~rising], p[~rising]),
        }
        r = results[name]
        print(
            f"    {name:<18} {r['r2']:+.3f}   {r['skill_vs_mean']:+.3f}     {r['skill_vs_momentum']:+.3f}"
            f"      {r['rmse'] * 100:5.1f}%   {r['directional_accuracy'] * 100:5.1f}%"
        )

    print(f"\n  Conditional on market state (the honesty check):")
    print(f"    {'model':<18} {'R² while RISING':>16}   {'R² while FALLING':>17}")
    for name, r in results.items():
        print(f"    {name:<18} {r['r2_rising']:+16.3f}   {r['r2_falling']:+17.3f}")
    print(f"    n = {int(rising.sum()):,} rising / {int((~rising).sum()):,} falling")

    print(f"\n  Is the direction call informative?")
    print(f"    prices rose in {up_rate * 100:.1f}% of windows, so 'always say up' scores {up_rate * 100:.1f}%")
    for name, r in results.items():
        edge = r["directional_accuracy"] - up_rate
        print(f"    {name:<18} {r['directional_accuracy'] * 100:5.1f}%  ->  edge of {edge * 100:+.1f} points")

    # --- Could it have called 2008? -----------------------------------------
    pre = (months >= PRE_CRASH[0]) & (months <= PRE_CRASH[1])
    pre_crash = {}
    if pre.sum() > 30:
        print(f"\n  Could it have called 2008?  (judged only on {PRE_CRASH[0]}..{PRE_CRASH[1]}, n={int(pre.sum()):,})")
        print(f"    actual outcome     {actual[pre].mean() * 100:+.1f}%")
        for name in build_regressors():
            p = np.array(preds.predicted[name])[pre]
            share_neg = float((p < 0).mean())
            pre_crash[name] = {"predicted": float(p.mean()), "flagged_negative": share_neg}
            print(f"    {name:<18} predicted {p.mean() * 100:+.1f}%   flagged negative on {share_neg * 100:4.0f}% of rows")

    # --- Classifier ----------------------------------------------------------
    d_actual = np.array(preds.drawdown_actual)
    classifiers = {}
    print(f"\n  Crash probability head  (base rate {d_actual.mean() * 100:.1f}%)")
    for name, probs in preds.drawdown_prob.items():
        p = np.array(probs)
        auc = float(roc_auc_score(d_actual, p)) if len(np.unique(d_actual)) > 1 else float("nan")
        brier = float(brier_score_loss(d_actual, p))
        pre_prob = float(p[pre].mean()) if pre.sum() > 30 else float("nan")
        pre_hit = float(d_actual[pre].mean()) if pre.sum() > 30 else float("nan")
        classifiers[name] = {"auc": auc, "brier": brier, "pre_crash_prob": pre_prob, "pre_crash_actual": pre_hit}
        print(f"    {name:<18} AUC {auc:.3f}   Brier {brier:.4f}   2004-06: said {pre_prob * 100:.0f}%, actual {pre_hit * 100:.0f}%")

    return {
        "horizon": horizon,
        "observations": len(frame),
        "test_predictions": len(actual),
        "folds": len(folds),
        "up_rate": up_rate,
        "drawdown_base_rate": float(d_actual.mean()),
        "models": results,
        "classifiers": classifiers,
        "pre_crash": pre_crash,
        "frame": frame,
    }


def fit_final(frame: pd.DataFrame, metro_row: pd.Series) -> dict:
    """Refit on everything and score the current San Diego feature vector."""
    scaler = StandardScaler().fit(frame[FEATURE_KEYS].to_numpy())
    x = scaler.transform(frame[FEATURE_KEYS].to_numpy())
    y = frame["target"].to_numpy()
    d = frame["drawdown"].to_numpy()

    ridge = Ridge(alpha=50.0).fit(x, y)
    logit = LogisticRegression(C=0.05, max_iter=2000).fit(x, d)
    gbr = HistGradientBoostingRegressor(
        max_depth=3, max_iter=300, learning_rate=0.05, min_samples_leaf=40, l2_regularization=1.0, random_state=0
    ).fit(x, y)
    gbc = HistGradientBoostingClassifier(
        max_depth=3, max_iter=250, learning_rate=0.05, min_samples_leaf=40, random_state=0
    ).fit(x, d)

    current = scaler.transform(metro_row[FEATURE_KEYS].to_numpy(dtype="float64").reshape(1, -1))

    return {
        "coefficients": ridge.coef_.tolist(),
        "intercept": float(ridge.intercept_),
        "classifier_coefficients": logit.coef_[0].tolist(),
        "classifier_intercept": float(logit.intercept_[0]),
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
        "current": {
            "ridge": float(ridge.predict(current)[0]),
            "gradient_boosting": float(gbr.predict(current)[0]),
            "crash_probability_logistic": float(logit.predict_proba(current)[0, 1]),
            "crash_probability_gbm": float(gbc.predict_proba(current)[0, 1]),
        },
        "current_features": {k: float(metro_row[k]) for k in FEATURE_KEYS},
    }


def main() -> None:
    panel = load_panel()
    print(f"Panel: {len(panel.frame):,} metro-months across {len(panel.metros)} metros (retrieved {panel.retrieved})")

    sd_row = latest_features(panel, TARGET_METRO)
    print(f"Scoring {panel.metros[TARGET_METRO]} as of {sd_row['month']}")

    payload = {}
    for horizon in HORIZONS:
        evaluation = evaluate_horizon(panel, horizon)
        frame = evaluation.pop("frame")
        evaluation["final"] = fit_final(frame, sd_row)
        payload[horizon] = evaluation

    emit(payload, panel, sd_row)


def emit(payload: dict, panel, sd_row: pd.Series) -> None:
    def clean(obj):
        if isinstance(obj, dict):
            return {k: clean(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [clean(v) for v in obj]
        if isinstance(obj, float) and (np.isnan(obj) or np.isinf(obj)):
            return None
        if isinstance(obj, (np.floating, np.integer)):
            return clean(float(obj))
        return obj

    body = f"""// GENERATED FILE. Do not edit by hand.
// Regenerate with: npm run data:panel && npm run train
//
// Trained by training/train.py (scikit-learn) on a panel of {len(panel.metros)} Case-Shiller
// metros, {len(panel.frame):,} metro-months. Validated with purged walk-forward folds:
// training rows whose target resolves inside the test window are dropped, so no
// fold can see its own answer.
//
// Scored for {panel.metros[TARGET_METRO]} as of {sd_row["month"]}.
// Trained: {pd.Timestamp.today().date()}
//
// READ THE VALIDATION NUMBERS BEFORE TRUSTING THE FORECAST. In particular check
// `preCrash`, which reports what each model would have said going into 2008, and
// `upRate`, which is the accuracy of simply always predicting "prices rise".

export interface FeatureSpec {{
  key: string;
  label: string;
}}

export const MODEL_FEATURES: readonly FeatureSpec[] = {json.dumps([{"key": k, "label": l} for k, l in FEATURES], indent=2)};

export const MODEL_TRAINED = {json.dumps(str(pd.Timestamp.today().date()))};
export const MODEL_METROS = {len(panel.metros)};
export const MODEL_OBSERVATIONS = {len(panel.frame)};
export const MODEL_SCORED_MONTH = {json.dumps(str(sd_row["month"]))};
export const DRAWDOWN_THRESHOLD = -0.1;

export const MODELS = {json.dumps(clean(payload), indent=2)} as const;

export const MODEL_HORIZONS = {json.dumps(list(HORIZONS))};
"""
    OUT_PATH.write_text(body)
    print(f"\nWrote {OUT_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
