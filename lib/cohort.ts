/**
 * "How is anyone affording this?"
 *
 * The answer is almost never that they out-earn you. It's that they entered the
 * market at a different point, and California's tax structure makes that entry
 * point permanent. This module quantifies the gap between what you'd pay for a
 * house today and what the person already living in it pays.
 *
 * Every number here is derived from the same historical series as lib/history.ts,
 * so the comparison is against what actually happened, not a vibe.
 */

import { balanceAfter, monthlyPayment } from "./amortization.ts";
import { PROP_13_MAX_ANNUAL_GROWTH } from "./data/ca-property.ts";
import { DEFAULT_COUNTY, historyFor, type HistoryRow } from "./data/history.ts";
import type { CaCounty } from "./data/ca-loan-limits.ts";

export interface CohortInput {
  /** Today's price for the house in question. */
  currentPrice: number;
  /** Today's rate, as a decimal. */
  currentRate: number;
  downPercent: number;
  propertyTaxRate: number;
  /** The month an earlier buyer purchased, e.g. "2019-06". */
  purchaseMonth: string;
  /** Whose price history to scale back along. Defaults to the site default. */
  county?: CaCounty;
  /**
   * If the earlier buyer refinanced, the rate they refinanced into. Most people
   * who owned through 2020-2021 did, which is a large part of the gap.
   */
  refinancedRate?: number;
  /** The month they refinanced. Required for refinancedRate to be applied correctly. */
  refinanceMonth?: string;
}

export interface CohortComparison {
  purchaseMonth: string;
  /** What the same house cost back then, per the repeat-sales index. */
  priceThen: number;
  /** The prevailing 30-year rate that month. */
  rateThen: number;
  /** The rate they're actually paying now, after any refinance. */
  effectiveRate: number;
  /** The month they refinanced, if they did. */
  refinancedMonth: string | null;
  /** Their Prop 13 assessed value today: purchase price grown 2%/year. */
  assessedValueNow: number;
  /** What you'd be assessed at: today's purchase price. */
  yourAssessedValue: number;

  theirPayment: { principalAndInterest: number; propertyTax: number; total: number };
  yourPayment: { principalAndInterest: number; propertyTax: number; total: number };

  /** Total monthly advantage they hold on the identical house. */
  totalAdvantage: number;
  /** How much of the gap is the interest rate. */
  rateAdvantage: number;
  /** How much of the gap is Prop 13's frozen assessment. */
  prop13Advantage: number;
  /** How much is simply having borrowed against a smaller price. */
  priceAdvantage: number;
  /** Appreciation they've captured since buying. */
  equityGained: number;
  yearsHeld: number;
}

const monthsBetween = (a: string, b: string): number => {
  const [ay, am] = a.split("-").map(Number) as [number, number];
  const [by, bm] = b.split("-").map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am);
};

/**
 * The reading for a month, snapped to the nearest one WITHIN ONE STEP.
 *
 * A county's series is quarterly or annual, so most months have no row of their
 * own. Requiring an exact match made "what did someone who bought in January
 * 2015 pay" return null, and a caller should not have to know what frequency
 * their county happens to be published at.
 *
 * Anything further away than one step still returns null, deliberately.
 * Clamping an out-of-range month to the nearest end would answer "what did a
 * 1902 buyer pay" with 1975's number, which is the confident fabrication this
 * project exists to avoid.
 */
const rowFor = (month: string, county: CaCounty): HistoryRow | null => {
  const { rows, stepMonths } = historyFor(county);
  let best: HistoryRow | null = null;
  let bestGap = Infinity;
  for (const row of rows) {
    const gap = Math.abs(monthsBetween(row[0], month));
    if (gap < bestGap) {
      best = row;
      bestGap = gap;
    }
  }
  return bestGap <= stepMonths ? best : null;
};

const indexFor = (month: string, county: CaCounty): number | null => rowFor(month, county)?.[1] ?? null;

const rateFor = (month: string, county: CaCounty): number | null => {
  const row = rowFor(month, county);
  return row ? row[2] / 100 : null;
};

export const earliestCohortMonth = (county: CaCounty = DEFAULT_COUNTY): string => historyFor(county).rows[0]![0];
export const latestCohortMonth = (county: CaCounty = DEFAULT_COUNTY): string => {
  const { rows } = historyFor(county);
  return rows[rows.length - 1]![0];
};

/**
 * The refinance window: the stretch of historically cheap money that anyone who
 * already owned a home could refinance into. Derived from the data rather than
 * asserted, we take the actual cheapest reading in the window.
 *
 * The RATE is national, so this is the same fact in every county and is read off
 * the default county's series rather than recomputed per county.
 */
export const REFI_WINDOW = { from: "2020-06", to: "2021-12" } as const;

export const BEST_REFI = (() => {
  const rows = historyFor(DEFAULT_COUNTY).rows;
  const window = rows.filter((r) => r[0] >= REFI_WINDOW.from && r[0] <= REFI_WINDOW.to);
  const best = window.reduce((a, b) => (b[2] < a[2] ? b : a), window[0]!);
  return { month: best[0], rate: best[2] / 100 };
})();

/**
 * Could someone who bought in `purchaseMonth` have refinanced into the cheap
 * window? Only if they already owned before it opened.
 */
export function refinanceOpportunity(purchaseMonth: string): { month: string; rate: number } | null {
  return purchaseMonth < REFI_WINDOW.from ? BEST_REFI : null;
}

/**
 * Compare your cost of buying a house today against the cost carried by someone
 * who bought the same house in `purchaseMonth`.
 *
 * The price for the earlier buyer is derived by scaling today's price back along
 * the repeat-sales index for THEIR county, which is exactly what that index is
 * for, since it tracks what the same homes resell for.
 */
export function compareToCohort(input: CohortInput): CohortComparison | null {
  const { currentPrice, currentRate, downPercent, propertyTaxRate, purchaseMonth, refinancedRate, refinanceMonth } =
    input;
  const county = input.county ?? DEFAULT_COUNTY;

  const thenIndex = indexFor(purchaseMonth, county);
  const thenRate = rateFor(purchaseMonth, county);
  if (thenIndex === null || thenRate === null) return null;

  const { rows } = historyFor(county);
  const latest = rows[rows.length - 1]!;
  const priceThen = (currentPrice * thenIndex) / latest[1];
  const effectiveRate = refinancedRate ?? thenRate;

  const monthsHeld = monthsBetween(purchaseMonth, latest[0]);
  const yearsHeld = monthsHeld / 12;

  // Prop 13: assessed value is the purchase price, growing at most 2% a year.
  const assessedValueNow = priceThen * Math.pow(1 + PROP_13_MAX_ANNUAL_GROWTH, yearsHeld);

  const theirLoan = priceThen * (1 - downPercent);

  // A refinance replaces the REMAINING BALANCE with a new loan, not the original
  // amount. Someone who bought in 2003 and refinanced in 2021 had already paid
  // down 18 years first, modelling it against the original loan would overstate
  // what they pay today by a wide margin.
  let theirPi: number;
  if (refinancedRate !== undefined && refinanceMonth !== undefined && refinanceMonth > purchaseMonth) {
    const monthsBeforeRefi = monthsBetween(purchaseMonth, refinanceMonth);
    const balanceAtRefi = balanceAfter(theirLoan, thenRate, 30, monthsBeforeRefi);
    theirPi = monthlyPayment(balanceAtRefi, refinancedRate, 30);
  } else {
    theirPi = monthlyPayment(theirLoan, effectiveRate, 30);
  }

  const theirTax = (assessedValueNow * propertyTaxRate) / 12;

  const yourLoan = currentPrice * (1 - downPercent);
  const yourPi = monthlyPayment(yourLoan, currentRate, 30);
  const yourTax = (currentPrice * propertyTaxRate) / 12;

  // Decompose the P&I gap into "rate" and "price" components by asking what your
  // loan would cost at their rate. The remainder is attributable to loan size.
  const yourLoanAtTheirRate = monthlyPayment(yourLoan, effectiveRate, 30);
  const rateAdvantage = yourPi - yourLoanAtTheirRate;
  // Everything left in the P&I gap: a smaller original price, plus the years of
  // principal they've already retired.
  const priceAdvantage = yourLoanAtTheirRate - theirPi;
  const prop13Advantage = yourTax - theirTax;

  return {
    purchaseMonth,
    priceThen,
    rateThen: thenRate,
    effectiveRate,
    refinancedMonth: refinancedRate !== undefined ? (refinanceMonth ?? null) : null,
    assessedValueNow,
    yourAssessedValue: currentPrice,
    theirPayment: { principalAndInterest: theirPi, propertyTax: theirTax, total: theirPi + theirTax },
    yourPayment: { principalAndInterest: yourPi, propertyTax: yourTax, total: yourPi + yourTax },
    totalAdvantage: yourPi + yourTax - (theirPi + theirTax),
    rateAdvantage,
    prop13Advantage,
    priceAdvantage,
    equityGained: currentPrice - priceThen,
    yearsHeld,
  };
}

/**
 * The other half of the answer: household composition.
 *
 * A second income moves the affordability ceiling more than any amount of
 * frugality or down payment saving does, and most buyers have one. Returns the
 * income needed to carry a given payment at a given DTI, for a range of
 * household shapes.
 */
export function incomeLadder(
  monthlyHousingPayment: number,
  monthlyDebts: number,
  dtiCeiling: number
): Array<{ label: string; earners: number; totalRequired: number; perEarner: number }> {
  const required = ((monthlyHousingPayment + monthlyDebts) / dtiCeiling) * 12;
  return [
    { label: "One earner", earners: 1, totalRequired: required, perEarner: required },
    { label: "Two earners, split evenly", earners: 2, totalRequired: required, perEarner: required / 2 },
    { label: "Two earners, 60/40 split", earners: 2, totalRequired: required, perEarner: required * 0.6 },
  ];
}
