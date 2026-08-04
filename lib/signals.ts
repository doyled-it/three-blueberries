/**
 * "Is a crash coming, and is now the worst time in history to buy?"
 *
 * ────────────────────────────────────────────────────────────────────────────
 * READ THIS FIRST. It governs how everything below may be presented.
 *
 * San Diego has had TWO price declines over 10% in 39 years. Two. Any model
 * fitted to two events is fitted to noise, and the correlations computed here
 * use overlapping forward windows, which inflates the apparent sample size by
 * roughly the window length. A reported n of 449 is really something closer to
 * 19 independent observations.
 *
 * So: this module describes what conditions looked like before things happened.
 * It does NOT predict. Every number it produces ships with that caveat attached,
 * and `crashSignals()` returns the caveats as data so the UI cannot drop them.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { monthlyPayment } from "./amortization.ts";
import { HISTORY_LATEST_INDEX, HISTORY_STEP_MONTHS, SD_HISTORY } from "./data/history.ts";
import {
  CA_MEDIAN_INCOME,
  MORTGAGE_DELINQUENCY,
  NEW_HOME_SUPPLY,
  SD_UNEMPLOYMENT,
  SIGNALS_INCOME_LAST_YEAR,
  type SignalRow,
} from "./data/signals.ts";
import { DEFAULT_ANCHOR_PRICE } from "./history.ts";

/** Most recent observation at or before `month`. Series have different frequencies. */
function asOf(series: readonly SignalRow[], month: string): number | null {
  let best: SignalRow | null = null;
  for (const row of series) {
    if (row[0] <= month && (!best || row[0] > best[0])) best = row;
  }
  return best ? best[1] : null;
}

const incomeForYear = (year: string): number => {
  const exact = CA_MEDIAN_INCOME.find((r) => r[0].startsWith(year));
  if (exact) return exact[1];
  // Past the end of the series, carry the last value forward. Conservative:
  // incomes kept rising, so holding them flat overstates the burden slightly.
  return CA_MEDIAN_INCOME[CA_MEDIAN_INCOME.length - 1]![1];
};

export interface BurdenPoint {
  month: string;
  price: number;
  rate: number;
  income: number;
  payment: number;
  /** Annual P&I as a share of median household income. */
  paymentToIncome: number;
  /** Price as a multiple of median household income. */
  priceToIncome: number;
}

/**
 * The affordability burden series: what a median household would spend on a
 * 20%-down median home, as a share of income, every month since 1987.
 *
 * This is the honest way to ask "is now the worst time ever", price alone
 * ignores rates, and rates alone ignore price.
 */
export function burdenSeries(anchorPrice = DEFAULT_ANCHOR_PRICE, downPercent = 0.2): BurdenPoint[] {
  return SD_HISTORY.map(([month, index, ratePercent]) => {
    const rate = ratePercent / 100;
    const price = (anchorPrice * index) / HISTORY_LATEST_INDEX;
    const income = incomeForYear(month.slice(0, 4));
    const payment = monthlyPayment(price * (1 - downPercent), rate, 30);
    return {
      month,
      price,
      rate,
      income,
      payment,
      paymentToIncome: (payment * 12) / income,
      priceToIncome: price / income,
    };
  });
}

export interface WorstTimeVerdict {
  latest: BurdenPoint;
  /** 1 = the single worst month on record. */
  rank: number;
  totalMonths: number;
  /** Share of months in history that were CHEAPER than now. */
  percentileWorseThan: number;
  worstEver: BurdenPoint;
  bestEver: BurdenPoint;
  medianPaymentToIncome: number;
  /** Plain-English answer to "is this the worst time in history to buy?" */
  answer: string;
}

export function worstTimeToBuy(anchorPrice = DEFAULT_ANCHOR_PRICE): WorstTimeVerdict {
  const series = burdenSeries(anchorPrice);
  const latest = series[series.length - 1]!;
  const sorted = [...series].sort((a, b) => b.paymentToIncome - a.paymentToIncome);
  const rank = sorted.findIndex((p) => p.month === latest.month) + 1;
  const worstEver = sorted[0]!;
  const bestEver = sorted[sorted.length - 1]!;
  const median = sorted[Math.floor(sorted.length / 2)]!.paymentToIncome;

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  const answer =
    rank === 1
      ? `Yes. At ${pct(latest.paymentToIncome)} of median household income, this is the most expensive quarter to buy in the ${series.length} quarters on record.`
      : `No, but it is close. Buying today costs ${pct(latest.paymentToIncome)} of median household income, which is worse than ${(((series.length - rank) / series.length) * 100).toFixed(0)}% of all quarters since ${series[0]!.month.slice(0, 4)}. The actual worst was ${worstEver.month}, at ${pct(worstEver.paymentToIncome)}, when rates hit ${pct(worstEver.rate)}. The median quarter in this record was ${pct(median)}, roughly half what you'd pay now.`;

  return {
    latest,
    rank,
    totalMonths: series.length,
    percentileWorseThan: (series.length - rank) / series.length,
    worstEver,
    bestEver,
    medianPaymentToIncome: median,
    answer,
  };
}

// ---------------------------------------------------------------------------
// The signal dashboard
// ---------------------------------------------------------------------------

export interface SignalReading {
  key: string;
  label: string;
  now: number | null;
  unit: string;
  /** What this read at the 2006 peak. */
  at2006Peak: number | null;
  /** What this read at the 2009 trough. */
  at2009Trough: number | null;
  /** "bearish" = leaning toward prices falling; "bullish" = leaning against. */
  lean: "bearish" | "bullish" | "neutral";
  reading: string;
  caveat?: string;
}

/**
 * The 2006 peak and the 2009 trough, found in the data rather than written down.
 *
 * They used to be two hardcoded month strings. That survived exactly as long as
 * the series was monthly: moving to FHFA's quarterly index deleted both months
 * from the record, and `at()` started returning undefined for the comparison
 * every reading on this panel is built around. Deriving them also means a data
 * revision moves the anchor instead of silently mismatching it.
 */
function extremeBetween(
  series: readonly { month: string; index: number }[],
  from: string,
  to: string,
  pick: "max" | "min"
): string {
  const window = series.filter((p) => p.month >= from && p.month <= to);
  if (window.length === 0) throw new Error(`No history between ${from} and ${to}`);
  const best = window.reduce((a, b) =>
    pick === "max" ? (b.index > a.index ? b : a) : b.index < a.index ? b : a
  );
  return best.month;
}

const INDEX_SERIES = SD_HISTORY.map(([month, index]) => ({ month, index }));

/** Highest reading of the bubble, searched across the years it could have been in. */
export const PEAK_2006 = extremeBetween(INDEX_SERIES, "2005-01", "2007-12", "max");
/** Lowest reading of the bust that followed it. */
export const TROUGH_2009 = extremeBetween(INDEX_SERIES, "2009-01", "2012-12", "min");

export function crashSignals(anchorPrice = DEFAULT_ANCHOR_PRICE): {
  readings: SignalReading[];
  summary: string;
  caveats: string[];
} {
  const series = burdenSeries(anchorPrice);
  const latest = series[series.length - 1]!;
  const at = (month: string) => series.find((p) => p.month === month);

  const nowMonth = latest.month;
  const supplyNow = asOf(NEW_HOME_SUPPLY, nowMonth);
  const delinqNow = asOf(MORTGAGE_DELINQUENCY, nowMonth);
  const unempNow = asOf(SD_UNEMPLOYMENT, nowMonth);

  const readings: SignalReading[] = [
    {
      key: "paymentToIncome",
      label: "Payment vs income",
      now: latest.paymentToIncome * 100,
      unit: "% of income",
      at2006Peak: (at(PEAK_2006)?.paymentToIncome ?? 0) * 100,
      at2009Trough: (at(TROUGH_2009)?.paymentToIncome ?? 0) * 100,
      lean: "bearish",
      reading:
        "About what it cost at the 2006 peak, relative to income. This stretched has preceded both declines on record, and also persisted for years before either broke.",
    },
    {
      key: "priceToIncome",
      label: "Price vs income",
      now: latest.priceToIncome,
      unit: "x income",
      at2006Peak: at(PEAK_2006)?.priceToIncome ?? null,
      at2009Trough: at(TROUGH_2009)?.priceToIncome ?? null,
      lean: "bearish",
      // Derived, not written down. The trough multiple was hardcoded as "~6x",
      // which was true at one anchor price and printed directly above a card
      // showing a different number at any other.
      reading: (() => {
        const trough = at(TROUGH_2009)?.priceToIncome;
        if (!trough) return "Near the 2006 peak multiple.";
        const fall = 1 - trough / latest.priceToIncome;
        return (
          `Near the 2006 peak multiple. The 2009 trough took it back to ${trough.toFixed(1)}x, ` +
          `which is what a ${(fall * 100).toFixed(0)}% decline looks like from here.`
        );
      })(),
    },
    {
      key: "supply",
      label: "New-home months' supply",
      now: supplyNow,
      unit: "months",
      at2006Peak: asOf(NEW_HOME_SUPPLY, PEAK_2006),
      at2009Trough: asOf(NEW_HOME_SUPPLY, TROUGH_2009),
      lean: "bearish",
      reading:
        "Above where it sat at the 2006 peak and near 2009 levels. Of everything here, this has the strongest historical link to what prices did next.",
      caveat:
        "NEW CONSTRUCTION ONLY. Builders carry far more spec inventory than in the 1990s, so eras aren't directly comparable. Existing-home supply. The market you actually shop, is around 4.6 months.",
    },
    {
      key: "delinquency",
      label: "Mortgage delinquency",
      now: delinqNow,
      unit: "%",
      at2006Peak: asOf(MORTGAGE_DELINQUENCY, PEAK_2006),
      at2009Trough: asOf(MORTGAGE_DELINQUENCY, TROUGH_2009),
      lean: "bullish",
      reading:
        "Near historic lows, and the strongest argument that this isn't 2008. A crash needs forced sellers; borrowers locked into cheap fixed rates aren't defaulting, so the distressed supply that drove the last collapse doesn't exist.",
    },
    {
      key: "unemployment",
      label: "San Diego unemployment",
      now: unempNow,
      unit: "%",
      at2006Peak: asOf(SD_UNEMPLOYMENT, PEAK_2006),
      at2009Trough: asOf(SD_UNEMPLOYMENT, TROUGH_2009),
      lean: "bullish",
      reading:
        "Low. Job losses turn a slowdown into a cascade, people sell because they must. It also decides whether you could buy a dip: you have to still be employed at the bottom.",
    },
  ];

  const summary =
    "Valuation says stretched; credit says stable. Both prior declines needed stretched valuations AND a trigger. A recession in 1990, a credit collapse in 2008. Today the valuation is here and the trigger isn't, which argues for a grind rather than a break. A recession would supply the missing trigger.";

  return {
    readings,
    summary,
    caveats: [
      `Two declines over 10% in 39 years is the entire sample. Any "formula" fitted to it is fitted to noise, including the correlations quoted here.`,
      "Forward correlations use overlapping 24-month windows, inflating the apparent sample size. Treat a reported n of 449 as closer to 19 real observations.",
      "Supply and delinquency are national; only unemployment is San Diego. Income is statewide California, annual, ending " +
        SIGNALS_INCOME_LAST_YEAR +
        ", carried forward after that, which slightly overstates the burden.",
      "Every indicator here is backward-looking. Markets turn on things that have not happened yet.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Does anything actually lead the market?
// ---------------------------------------------------------------------------

export interface Correlation {
  key: string;
  label: string;
  /** Pearson r against the following 24 months of price change. */
  r: number;
  /** Raw overlapping-window count. */
  observations: number;
  /** Non-overlapping windows: the honest sample size, not the overlapping count. */
  effectiveObservations: number;
  strength: "strong" | "moderate" | "weak";
}

/**
 * Correlate each indicator against the NEXT 24 months of price change.
 *
 * Reported alongside `effectiveObservations` precisely so nobody quotes the
 * inflated n. See the module header.
 */
export function leadingIndicators(windowMonths = 24, anchorPrice = DEFAULT_ANCHOR_PRICE): Correlation[] {
  const series = burdenSeries(anchorPrice);

  // The window is in MONTHS; the series is in quarters. Indexing the array by
  // windowMonths treated a 24-month horizon as 24 quarters, six years, which
  // silently changed which indicator looked strongest.
  const windowRows = Math.max(1, Math.round(windowMonths / HISTORY_STEP_MONTHS));

  const samples: Array<{ change: number; values: Record<string, number | null> }> = [];
  for (let i = 0; i + windowRows < series.length; i++) {
    const now = series[i]!;
    const later = series[i + windowRows]!;
    samples.push({
      change: (later.price - now.price) / now.price,
      values: {
        paymentToIncome: now.paymentToIncome,
        priceToIncome: now.priceToIncome,
        supply: asOf(NEW_HOME_SUPPLY, now.month),
        delinquency: asOf(MORTGAGE_DELINQUENCY, now.month),
        unemployment: asOf(SD_UNEMPLOYMENT, now.month),
        rate: now.rate,
      },
    });
  }

  const labels: Record<string, string> = {
    paymentToIncome: "Payment vs income",
    priceToIncome: "Price vs income",
    supply: "New-home months' supply",
    delinquency: "Mortgage delinquency",
    unemployment: "San Diego unemployment",
    rate: "Mortgage rate",
  };

  return Object.keys(labels).map((key) => {
    const pts = samples.filter((s) => s.values[key] !== null && Number.isFinite(s.values[key]!));
    const n = pts.length;
    const mx = pts.reduce((a, b) => a + b.values[key]!, 0) / n;
    const my = pts.reduce((a, b) => a + b.change, 0) / n;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (const p of pts) {
      const vx = p.values[key]! - mx;
      const vy = p.change - my;
      num += vx * vy;
      dx += vx * vx;
      dy += vy * vy;
    }
    const r = dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
    return {
      key,
      label: labels[key]!,
      r,
      observations: n,
      // Non-overlapping windows, which is the honest sample size. n counts ROWS
      // now, so it divides by the window in rows, not in months.
      effectiveObservations: Math.round(n / windowRows),
      strength: Math.abs(r) > 0.5 ? "strong" : Math.abs(r) > 0.3 ? "moderate" : "weak",
    };
  });
}
