/**
 * "Is a crash coming, and is now the worst time in history to buy?"
 *
 * ────────────────────────────────────────────────────────────────────────────
 * READ THIS FIRST. It governs how everything below may be presented.
 *
 * A California county has had two or three price declines over 10% in fifty
 * years. Two or three. Any model fitted to that is fitted to noise, and the
 * correlations computed here use overlapping forward windows, which inflates the
 * apparent sample size by roughly the window length. A reported n in the
 * hundreds is really closer to twenty independent observations.
 *
 * So: this module describes what conditions looked like before things happened.
 * It does NOT predict. Every number it produces ships with that caveat attached,
 * and `crashSignals()` returns the caveats as data so the UI cannot drop them.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { monthlyPayment } from "./amortization.ts";
import { DEFAULT_COUNTY, historyFor } from "./data/history.ts";
import type { CaCounty } from "./data/ca-loan-limits.ts";
import {
  CA_MEDIAN_INCOME,
  MORTGAGE_DELINQUENCY,
  NEW_HOME_SUPPLY,
  CA_UNEMPLOYMENT,
  SIGNALS_INCOME_LAST_YEAR,
  type SignalRow,
} from "./data/signals.ts";
import { DEFAULT_ANCHOR_PRICE, findDrawdowns } from "./history.ts";

const LONG_MONTHS = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2023-12" is a database key. Anything a reader sees says "December 2023". */
export function longMonth(month: string): string {
  const [year, m] = month.split("-");
  return LONG_MONTHS[Number(m)] ? `${LONG_MONTHS[Number(m)]} ${year}` : month;
}

/** Most recent observation at or before `month`. Series have different frequencies. */
function asOf(series: readonly SignalRow[], month: string): number | null {
  let best: SignalRow | null = null;
  for (const row of series) {
    if (row[0] <= month && (!best || row[0] > best[0])) best = row;
  }
  return best ? best[1] : null;
}

/**
 * The income series runs 1984 to 2024. Carry the NEAREST end outward rather than
 * always the last value: dividing a 1975 house price by a 2024 income produced a
 * 3% burden and made 1975 the best time to buy in history, which is an artefact.
 *
 * Past the end, holding income flat overstates the burden slightly, which is the
 * conservative direction.
 */
const incomeForYear = (year: string): number => {
  const exact = CA_MEDIAN_INCOME.find((r) => r[0].startsWith(year));
  if (exact) return exact[1];
  // Past the END of the series only. Holding income flat overstates the burden
  // slightly, which is the conservative direction.
  return CA_MEDIAN_INCOME[CA_MEDIAN_INCOME.length - 1]![1];
};

/**
 * The first year median income is actually measured.
 *
 * The price series now reaches back to 1975 but the income series starts in
 * 1984, and every figure on these panels is a RATIO of the two. Backfilling
 * income made a 1975 house look like 13% of income and crowned it the best time
 * to buy in history, which is an artefact of the backfill and nothing else. So
 * the affordability panels start where the income data starts. The price and
 * payment charts still show the full record, because those need no income.
 */
const INCOME_STARTS = CA_MEDIAN_INCOME[0]![0].slice(0, 4);

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
 * 20%-down typical home, as a share of income, for every period on record.
 *
 * This is the honest way to ask "is now the worst time ever", price alone
 * ignores rates, and rates alone ignore price.
 */
export function burdenSeries(
  county: CaCounty = DEFAULT_COUNTY,
  anchorPrice?: number,
  downPercent = 0.2
): BurdenPoint[] {
  const { rows, anchorPrice: countyAnchor } = historyFor(county);
  const anchor = anchorPrice ?? countyAnchor;
  const latestIndex = rows[rows.length - 1]![1];
  return rows
    .filter(([month]) => month.slice(0, 4) >= INCOME_STARTS)
    .map(([month, index, ratePercent]) => {
      const rate = ratePercent / 100;
      const price = (anchor * index) / latestIndex;
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

export function worstTimeToBuy(county: CaCounty = DEFAULT_COUNTY, anchorPrice?: number): WorstTimeVerdict {
  const series = burdenSeries(county, anchorPrice);
  const latest = series[series.length - 1]!;
  const sorted = [...series].sort((a, b) => b.paymentToIncome - a.paymentToIncome);
  const rank = sorted.findIndex((p) => p.month === latest.month) + 1;
  const worstEver = sorted[0]!;
  const bestEver = sorted[sorted.length - 1]!;
  const median = sorted[Math.floor(sorted.length / 2)]!.paymentToIncome;

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  // The record is quarterly or annual, never monthly, and a raw "2023-12" in
  // prose is a database key rather than a date somebody reads.
  const answer =
    rank === 1
      ? `Yes. At ${pct(latest.paymentToIncome)} of median household income, this is the most expensive it has been in the ${series.length} readings on record.`
      : `No, but it is close. Buying today costs ${pct(latest.paymentToIncome)} of median household income, worse ` +
        `than ${(((series.length - rank) / series.length) * 100).toFixed(0)}% of the record since ` +
        `${series[0]!.month.slice(0, 4)}. The worst was ${longMonth(worstEver.month)} at ` +
        `${pct(worstEver.paymentToIncome)}, when rates hit ${pct(worstEver.rate)}. The typical reading here is ` +
        `${pct(median)}.`;

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
  /**
   * What this read at the county's OWN bubble peak. The month is in
   * `peakMonth`: it is 2006 in 40 counties and something else in the other 18,
   * so nothing may label this column "2006".
   */
  at2006Peak: number | null;
  /** What this read at the county's own bust trough. See `troughMonth`. */
  at2009Trough: number | null;
  /** "bearish" = leaning toward prices falling; "bullish" = leaning against. */
  lean: "bearish" | "bullish" | "neutral";
  reading: string;
  caveat?: string;
}

/**
 * The bubble peak and the bust trough, found in each county's data rather than
 * written down as two month strings.
 *
 * Hardcoding them survived only as long as one county and one frequency. A
 * quarterly series has no "2009-05" in it at all, and Fresno did not peak in the
 * same month as San Diego. Deriving also means a data revision moves the anchor
 * instead of silently mismatching it.
 */
function extremeBetween(
  series: readonly { month: string; index: number }[],
  from: string,
  to: string,
  pick: "max" | "min"
): string {
  const window = series.filter((p) => p.month >= from && p.month <= to);
  if (window.length === 0) throw new Error(`No history between ${from} and ${to}`);
  return window.reduce((a, b) => (pick === "max" ? (b.index > a.index ? b : a) : b.index < a.index ? b : a)).month;
}

/** Highest reading of the bubble in this county, searched across the years it could be in. */
export function peakOfBubble(county: CaCounty = DEFAULT_COUNTY): string {
  return extremeBetween(
    historyFor(county).rows.map(([month, index]) => ({ month, index })),
    "2005-01",
    "2007-12",
    "max"
  );
}

/** Lowest reading of the bust that followed it. */
export function troughOfBust(county: CaCounty = DEFAULT_COUNTY): string {
  return extremeBetween(
    historyFor(county).rows.map(([month, index]) => ({ month, index })),
    "2008-01",
    "2013-12",
    "min"
  );
}

export function crashSignals(
  county: CaCounty = DEFAULT_COUNTY,
  anchorPrice?: number
): {
  readings: SignalReading[];
  /** The county's own bubble peak, for labelling the comparison column. */
  peakMonth: string;
  /** The county's own bust trough. Not 2009 in 54 of 58 counties. */
  troughMonth: string;
  summary: string;
  caveats: string[];
} {
  const series = burdenSeries(county, anchorPrice);
  const latest = series[series.length - 1]!;
  const at = (month: string) => series.find((p) => p.month === month);
  const PEAK_2006 = peakOfBubble(county);
  const TROUGH_2009 = troughOfBust(county);
  const peakYear = PEAK_2006.slice(0, 4);
  const troughYear = TROUGH_2009.slice(0, 4);

  // How many declines this county actually has. "Both declines on record" is
  // wrong in the 17 counties with one and the 16 with three.
  const declineCount = findDrawdowns(10, county).length;
  const declinePhrase =
    declineCount === 1
      ? "the one decline on record"
      : declineCount === 2
        ? "both declines on record"
        : `all ${declineCount} declines on record`;

  const nowMonth = latest.month;
  const supplyNow = asOf(NEW_HOME_SUPPLY, nowMonth);
  const delinqNow = asOf(MORTGAGE_DELINQUENCY, nowMonth);
  const unempNow = asOf(CA_UNEMPLOYMENT, nowMonth);

  const readings: SignalReading[] = [
    {
      key: "paymentToIncome",
      label: "Payment vs income",
      now: latest.paymentToIncome * 100,
      unit: "% of income",
      at2006Peak: (at(PEAK_2006)?.paymentToIncome ?? 0) * 100,
      at2009Trough: (at(TROUGH_2009)?.paymentToIncome ?? 0) * 100,
      lean: "bearish",
      // "About what it cost at the 2006 peak" was hardcoded prose printed over
      // per-county numbers that contradicted it, and "both declines" is wrong in
      // the 17 counties with one and the 16 with three.
      reading: (() => {
        const then = (at(PEAK_2006)?.paymentToIncome ?? 0) * 100;
        const now = latest.paymentToIncome * 100;
        const gap = then > 0 ? now / then - 1 : 0;
        const versus =
          Math.abs(gap) < 0.05
            ? `About what it cost at the ${peakYear} peak`
            : gap > 0
              ? `${(gap * 100).toFixed(0)}% MORE than it cost at the ${peakYear} peak`
              : `${(-gap * 100).toFixed(0)}% less than it cost at the ${peakYear} peak`;
        return (
          `${versus}, relative to income. This stretched has preceded ${declinePhrase}, and also persisted for years ` +
          `before ${declineCount === 1 ? "it" : "any of them"} broke.`
        );
      })(),
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
        const peak = at(PEAK_2006)?.priceToIncome;
        const trough = at(TROUGH_2009)?.priceToIncome;
        const head =
          peak === undefined
            ? ""
            : latest.priceToIncome >= peak
              ? `Above the ${peakYear} peak multiple of ${peak.toFixed(1)}x. `
              : `Below the ${peakYear} peak multiple of ${peak.toFixed(1)}x. `;
        if (!trough) return head || `No comparison available for this county.`;
        const fall = 1 - trough / latest.priceToIncome;
        // A trough multiple ABOVE today's prints a negative "decline", which is
        // a rise. Say which it is.
        return (
          head +
          (fall >= 0
            ? `The ${troughYear} trough took it back to ${trough.toFixed(1)}x, which is what a ${(fall * 100).toFixed(0)}% ` +
              `decline looks like from here.`
            : `The ${troughYear} trough was ${trough.toFixed(1)}x, HIGHER than today, so getting back there would mean ` +
              `prices rising ${(-fall * 100).toFixed(0)}% relative to income, not falling.`)
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
      // Both halves of this used to be asserted. "Above the 2006 peak and near
      // 2009 levels" is false against the card's own numbers in most counties,
      // and "the strongest historical link" is wrong in four.
      reading: (() => {
        const peak = asOf(NEW_HOME_SUPPLY, PEAK_2006);
        const trough = asOf(NEW_HOME_SUPPLY, TROUGH_2009);
        const vs = (label: string, then: number | null) =>
          then === null || supplyNow === null
            ? null
            : supplyNow > then * 1.05
              ? `above ${label}`
              : supplyNow < then * 0.95
                ? `below ${label}`
                : `about level with ${label}`;
        const parts = [vs(`its ${peakYear} peak reading`, peak), vs(`${troughYear}`, trough)].filter(Boolean);
        const strongest = leadingIndicators(24, county, anchorPrice).reduce((a, b) =>
          Math.abs(b.r) > Math.abs(a.r) ? b : a
        );
        return (
          (parts.length ? `Currently ${parts.join(" and ")}. ` : "") +
          (strongest.key === "supply"
            ? `Of everything here, this has the strongest historical link to what prices did next in ${county} County.`
            : `In ${county} County the strongest historical link is ${strongest.label.toLowerCase()}, not this one.`)
        );
      })(),
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
      // "Near historic lows" was asserted while 21% of the record sits lower and
      // the peak-year reading was lower still. Derive the percentile.
      reading: (() => {
        const lower = delinqNow === null ? 0 : MORTGAGE_DELINQUENCY.filter((r) => r[1] < delinqNow).length;
        const share = MORTGAGE_DELINQUENCY.length ? lower / MORTGAGE_DELINQUENCY.length : 0;
        const peak = asOf(MORTGAGE_DELINQUENCY, PEAK_2006);
        return (
          `Lower than ${((1 - share) * 100).toFixed(0)}% of the record` +
          (peak !== null && delinqNow !== null && peak < delinqNow
            ? `, though the ${peakYear} peak itself read lower still at ${peak.toFixed(2)}%. `
            : `. `) +
          `Still the strongest argument that this isn't 2008: a crash needs forced sellers, and borrowers locked into ` +
          `cheap fixed rates aren't defaulting, so the distressed supply that drove the last collapse doesn't exist.`
        );
      })(),
    },
    {
      key: "unemployment",
      label: "California unemployment",
      now: unempNow,
      unit: "%",
      at2006Peak: asOf(CA_UNEMPLOYMENT, PEAK_2006),
      at2009Trough: asOf(CA_UNEMPLOYMENT, TROUGH_2009),
      // "Low" and bullish while sitting ABOVE the peak-year reading in 51
      // counties is not a read, it is a label. Derive the lean too.
      lean: (() => {
        const peak = asOf(CA_UNEMPLOYMENT, PEAK_2006);
        return peak !== null && unempNow !== null && unempNow > peak * 1.1 ? "neutral" : "bullish";
      })(),
      reading: (() => {
        const peak = asOf(CA_UNEMPLOYMENT, PEAK_2006);
        const head =
          peak === null || unempNow === null
            ? ""
            : unempNow > peak * 1.1
              ? `At ${unempNow.toFixed(1)}%, higher than the ${peak.toFixed(1)}% California carried into the ${peakYear} peak. `
              : `At ${unempNow.toFixed(1)}%, at or below the ${peak.toFixed(1)}% California carried into the ${peakYear} peak. `;
        return (
          head +
          `Job losses turn a slowdown into a cascade: people sell because they must. It also decides whether you could ` +
          `buy a dip, because you have to still be employed at the bottom. This series is STATEWIDE California, not ` +
          `${county} County.`
        );
      })(),
    },
  ];

  const summary =
    `Valuation says stretched; credit says stable. ${declinePhrase[0]!.toUpperCase()}${declinePhrase.slice(1)} needed ` +
    `stretched valuations AND a trigger: a recession in 1990, a credit collapse in 2008. Today the valuation is here ` +
    `and the trigger isn't, which argues for a grind rather than a break. A recession would supply the missing trigger.`;

  return {
    readings,
    peakMonth: PEAK_2006,
    troughMonth: TROUGH_2009,
    summary,
    caveats: [
      `${declineCount === 1 ? "One decline" : `${declineCount} declines`} over 10% in ${county} County's whole record is the entire sample. Any "formula" fitted to it is fitted to noise, including the correlations quoted here.`,
      // The n was quoted as 449, a monthly-series figure no indicator produces
      // now that the series is quarterly or annual. Derive both numbers.
      (() => {
        const c = leadingIndicators(24, county, anchorPrice)[0];
        return c
          ? `Forward correlations use overlapping 24-month windows, inflating the apparent sample size. Treat the reported n of ${c.observations} as closer to ${c.effectiveObservations} real observations.`
          : "Forward correlations use overlapping windows, which inflates the apparent sample size.";
      })(),
      "Supply and delinquency are national, and unemployment is STATEWIDE California, not your county. Income is statewide California too, annual, ending " +
        SIGNALS_INCOME_LAST_YEAR +
        ", carried forward after that, which OVERSTATES the burden since incomes kept rising.",
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
  /** observations / windowMonths, the honest sample size. */
  effectiveObservations: number;
  strength: "strong" | "moderate" | "weak";
}

/**
 * Correlate each indicator against the NEXT 24 months of price change.
 *
 * Reported alongside `effectiveObservations` precisely so nobody quotes the
 * inflated n. See the module header.
 */
export function leadingIndicators(
  windowMonths = 24,
  county: CaCounty = DEFAULT_COUNTY,
  anchorPrice?: number
): Correlation[] {
  const series = burdenSeries(county, anchorPrice);

  const samples: Array<{ change: number; values: Record<string, number | null> }> = [];
  // The window is in MONTHS; the series is in quarters or years. Indexing the
  // array by windowMonths treated a 24-month horizon as 24 quarters, six years,
  // which silently changed which indicator looked strongest.
  const windowRows = Math.max(1, Math.round(windowMonths / historyFor(county).stepMonths));

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
        unemployment: asOf(CA_UNEMPLOYMENT, now.month),
        rate: now.rate,
      },
    });
  }

  const labels: Record<string, string> = {
    paymentToIncome: "Payment vs income",
    priceToIncome: "Price vs income",
    supply: "New-home months' supply",
    delinquency: "Mortgage delinquency",
    unemployment: "California unemployment",
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
      // Non-overlapping windows, the honest sample size. n counts ROWS, so it
      // divides by the window in rows rather than in months.
      effectiveObservations: Math.round(n / windowRows),
      strength: Math.abs(r) > 0.5 ? "strong" : Math.abs(r) > 0.3 ? "moderate" : "weak",
    };
  });
}
