/**
 * The learned forecaster — and the case against believing it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * This module exists because the honest result of building a housing forecaster
 * is a negative one, and a negative result is worth shipping properly.
 *
 * A model was trained: ridge, gradient boosting and random forest, on a panel of
 * 20 Case-Shiller metros, at 12/24/36-month horizons, validated with purged
 * walk-forward folds. It produces a current number for San Diego. That number is
 * NOT a forecast anyone should act on, and this module's job is to make it
 * impossible to display it as one.
 *
 * `verdict()` returns `trustworthy: false` and the specific evidence for that.
 * The UI leads with the evidence. If a future version of this model ever earns
 * `trustworthy: true`, the criteria are written down below rather than left to
 * whoever is feeling optimistic that day.
 * ────────────────────────────────────────────────────────────────────────────
 */

import {
  DRAWDOWN_THRESHOLD,
  MODELS,
  MODEL_FEATURES,
  MODEL_HORIZONS,
  MODEL_METROS,
  MODEL_OBSERVATIONS,
  MODEL_SCORED_MONTH,
  MODEL_TRAINED,
} from "./data/model.ts";

export type ModelFamily = "ridge" | "gradient_boosting" | "random_forest";

export interface HorizonReport {
  horizon: number;
  observations: number;
  testPredictions: number;
  folds: number;
  /** Share of historical windows in which prices rose. The bar to beat. */
  upRate: number;
  drawdownBaseRate: number;
  best: {
    family: ModelFamily;
    r2: number;
    skillVsMean: number;
    skillVsMomentum: number;
    directionalAccuracy: number;
    /** Directional accuracy minus the accuracy of always saying "up". */
    directionalEdge: number;
    r2Rising: number;
    r2Falling: number;
  };
  /** What the models said going into 2008, judged on 2004-01..2006-06 only. */
  preCrash: { family: ModelFamily; predicted: number; flaggedNegative: number }[];
  classifier: { auc: number | null; brier: number; preCrashProbability: number; preCrashActual: number };
  current: {
    ridge: number;
    gradientBoosting: number;
    crashProbabilityLogistic: number;
    crashProbabilityGbm: number;
  };
}

const raw = MODELS as unknown as Record<string, any>;

function report(horizon: number): HorizonReport {
  const h = raw[String(horizon)];
  const families: ModelFamily[] = ["ridge", "gradient_boosting", "random_forest"];

  // "Best" means best out-of-sample skill against the only baseline available in
  // real time: the training-period mean. R² against the test mean is an unfair
  // standard, because you cannot know the test mean in advance.
  const best = families.reduce((a, b) => (h.models[b].skill_vs_mean > h.models[a].skill_vs_mean ? b : a));
  const m = h.models[best];

  const clf = h.classifiers.gradient_boosting ?? h.classifiers.logistic;

  return {
    horizon,
    observations: h.observations,
    testPredictions: h.test_predictions,
    folds: h.folds,
    upRate: h.up_rate,
    drawdownBaseRate: h.drawdown_base_rate,
    best: {
      family: best,
      r2: m.r2,
      skillVsMean: m.skill_vs_mean,
      skillVsMomentum: m.skill_vs_momentum,
      directionalAccuracy: m.directional_accuracy,
      directionalEdge: m.directional_accuracy - h.up_rate,
      r2Rising: m.r2_rising,
      r2Falling: m.r2_falling,
    },
    preCrash: families
      .filter((f) => h.pre_crash?.[f])
      .map((f) => ({
        family: f,
        predicted: h.pre_crash[f].predicted,
        flaggedNegative: h.pre_crash[f].flagged_negative,
      })),
    classifier: {
      auc: clf.auc,
      brier: clf.brier,
      preCrashProbability: clf.pre_crash_prob,
      preCrashActual: clf.pre_crash_actual,
    },
    current: {
      ridge: h.final.current.ridge,
      gradientBoosting: h.final.current.gradient_boosting,
      crashProbabilityLogistic: h.final.current.crash_probability_logistic,
      crashProbabilityGbm: h.final.current.crash_probability_gbm,
    },
  };
}

export function horizonReports(): HorizonReport[] {
  return MODEL_HORIZONS.map(report);
}

/**
 * Learned weights, as the user asked for: how much each indicator moves the
 * forecast, per standard deviation of that indicator.
 *
 * These come from the ridge model, because a linear coefficient is the only one
 * of the three that can be read as a weight at all. They describe what the model
 * learned; given the validation record below, they do NOT describe what actually
 * drives housing.
 */
export function learnedWeights(horizon = 24): { key: string; label: string; weight: number }[] {
  const h = raw[String(horizon)];
  return MODEL_FEATURES.map((f, i) => ({
    key: f.key,
    label: f.label,
    weight: h.final.coefficients[i] as number,
  })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}

export interface Verdict {
  trustworthy: boolean;
  /** Each failed criterion, stated concretely. */
  failures: string[];
  /** What the model would have to achieve to earn trust. */
  criteria: string[];
  headline: string;
}

/**
 * The criteria are fixed in advance so the answer cannot drift with mood:
 *
 *  1. Beat "assume the trend continues" out of sample.
 *  2. Beat "always predict prices rise" on direction.
 *  3. Have a crash classifier better than a coin flip (AUC > 0.5).
 *  4. Have flagged some risk before the one crash in the record.
 */
export function verdict(horizon = 24): Verdict {
  const r = report(horizon);
  const failures: string[] = [];
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  if (r.best.skillVsMomentum <= 0) {
    failures.push(
      `It cannot beat "assume the trend continues." Best model scores ${r.best.skillVsMomentum.toFixed(2)} against that baseline, where anything at or below zero means the naive answer is better.`
    );
  }
  if (r.best.directionalEdge <= 0) {
    failures.push(
      `Its direction calls are worse than a coin weighted to the obvious answer. Prices rose in ${pct(r.upRate)} of historical windows, so "always say up" scores ${pct(r.upRate)}; the model manages ${pct(r.best.directionalAccuracy)}.`
    );
  }
  if (r.classifier.auc !== null && r.classifier.auc <= 0.5) {
    failures.push(
      `The crash classifier has an AUC of ${r.classifier.auc.toFixed(2)}. Below 0.5 is worse than random — it ranks the safe periods as riskier than the dangerous ones.`
    );
  }
  if (r.classifier.preCrashProbability < r.classifier.preCrashActual) {
    failures.push(
      `Going into 2008 it assigned a ${pct(r.classifier.preCrashProbability)} chance of a ${Math.abs(DRAWDOWN_THRESHOLD * 100)}%+ decline, when ${pct(r.classifier.preCrashActual)} of those windows went on to have one.`
    );
  }

  const worstPreCrash = r.preCrash.length ? r.preCrash.reduce((a, b) => (b.predicted > a.predicted ? b : a)) : null;

  return {
    trustworthy: failures.length === 0,
    failures,
    criteria: [
      "Beat the momentum baseline out of sample",
      "Beat 'always predict up' on direction",
      "Crash classifier AUC above 0.5",
      "Assign elevated risk before the 2008 decline",
    ],
    headline:
      failures.length === 0
        ? "This model clears every pre-registered check. Treat it as weak evidence, not a prophecy."
        : `The model does not work, and the clearest demonstration is 2008: trained only on data available at the time, it went into the largest housing crash in modern history predicting ${worstPreCrash ? `${(worstPreCrash.predicted * 100).toFixed(0)}% growth` : "growth"} and a ${pct(r.classifier.preCrashProbability)} chance of a decline. Turning points are exactly what you would want a forecaster for, and they are exactly what it cannot see.`,
  };
}

export const MODEL_META = {
  trained: MODEL_TRAINED,
  metros: MODEL_METROS,
  observations: MODEL_OBSERVATIONS,
  scoredMonth: MODEL_SCORED_MONTH,
  drawdownThreshold: DRAWDOWN_THRESHOLD,
};
