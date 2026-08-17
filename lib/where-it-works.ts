/**
 * Where in California the arithmetic still works, and what that costs you.
 *
 * The thesis panel says housing outran wages. Made county by county, that turns
 * out to be true in 24 counties and FALSE in 34, which sounds like it weakens
 * the argument. It does the opposite, once you look at which counties are which.
 *
 * The five counties where a median income buys most easily are Lassen (3.1x),
 * Modoc (3.8x), Siskiyou and Trinity (4.9x) and Sierra (5.0x). The five where it
 * buys least are San Francisco (12.5x), Orange and Marin (11.9x), and Santa
 * Barbara and Santa Cruz (11.8x). This list is derived; it used to name Santa
 * Clara and San Mateo, which are not in the worst five, and omit the two that
 * are. Recheck it against `allStandings()` after any data refresh rather than
 * trusting these names.
 *
 * So affordability did not disappear from California. It relocated to where the
 * work is not. And the sharpest way to see that is to correlate what a county
 * PAYS against how many years of that pay a house there costs: the better a
 * county pays, the worse its housing multiple, at r = +0.71. Prices track pay at
 * r = +0.91, which means a raise does not get you in, it gets bid away.
 *
 * That is a harder claim than "housing got expensive", and it is the one the
 * data actually supports:
 *
 *   the ten best-paying counties   ~$120,000 median income  ->  ~10.6x housing
 *   the ten worst-paying counties   ~$59,000 median income  ->   ~5.7x housing
 *
 * Everything here is a snapshot, not a time series. It says nothing about
 * whether jobs are moving, only about where they are now and what housing costs
 * next to them. Do not let the copy imply a trend this cannot see.
 */

import { COUNTY_ANCHOR, COUNTY_INCOME, COUNTY_INCOME_YEAR } from "./data/history.ts";
import { CA_COUNTIES, type CaCounty } from "./data/ca-loan-limits.ts";

export interface CountyStanding {
  county: CaCounty;
  /** Zillow typical single-family value. */
  homeValue: number;
  /** Census SAIPE median household income for the people who live there. */
  income: number;
  /** Years of local median income one local median house costs. */
  yearsOfIncome: number;
}

/** Under this many years of local income, a median household can realistically buy. */
export const WORKABLE_MULTIPLE = 5;
/** At or above this, the local median household is priced out of its own county. */
export const PRICED_OUT_MULTIPLE = 7;

export function countyStanding(county: CaCounty): CountyStanding {
  const homeValue = COUNTY_ANCHOR[county];
  const income = COUNTY_INCOME[county];
  return { county, homeValue, income, yearsOfIncome: homeValue / income };
}

export function allStandings(): CountyStanding[] {
  return CA_COUNTIES.map(countyStanding).sort((a, b) => b.yearsOfIncome - a.yearsOfIncome);
}

function pearson(xs: number[], ys: number[]): number {
  const mean = (v: number[]) => v.reduce((s, n) => s + n, 0) / v.length;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    dx += (xs[i]! - mx) ** 2;
    dy += (ys[i]! - my) ** 2;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

export interface PayTrap {
  /** Correlation between what a county pays and how many years of pay a house costs. */
  payVsMultiple: number;
  /** Correlation between what a county pays and what a house there costs. */
  payVsPrice: number;
  bestPaying: { medianIncome: number; medianMultiple: number; counties: CaCounty[] };
  worstPaying: { medianIncome: number; medianMultiple: number; counties: CaCounty[] };
  pricedOut: CountyStanding[];
  workable: CountyStanding[];
  headline: string;
}

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function payTrap(sampleSize = 10): PayTrap {
  const standings = allStandings();
  const byPay = [...standings].sort((a, b) => b.income - a.income);
  const top = byPay.slice(0, sampleSize);
  const bottom = byPay.slice(-sampleSize);

  const summarise = (group: CountyStanding[]) => ({
    medianIncome: median(group.map((s) => s.income)),
    medianMultiple: median(group.map((s) => s.yearsOfIncome)),
    counties: group.map((s) => s.county),
  });

  const bestPaying = summarise(top);
  const worstPaying = summarise(bottom);

  return {
    payVsMultiple: pearson(
      standings.map((s) => s.income),
      standings.map((s) => s.yearsOfIncome)
    ),
    payVsPrice: pearson(
      standings.map((s) => s.income),
      standings.map((s) => s.homeValue)
    ),
    bestPaying,
    worstPaying,
    pricedOut: standings.filter((s) => s.yearsOfIncome >= PRICED_OUT_MULTIPLE),
    workable: standings.filter((s) => s.yearsOfIncome < WORKABLE_MULTIPLE),
    headline:
      `California's ten best-paying counties pay a median ${money(bestPaying.medianIncome)}, where a house costs ` +
      `${bestPaying.medianMultiple.toFixed(1)} years of it; the ten worst-paying pay ${money(worstPaying.medianIncome)}, ` +
      `where it costs ${worstPaying.medianMultiple.toFixed(1)}. Across all 58, the better the pay, the worse the ` +
      `multiple. Earning more does not get you in; it gets bid away.`,
  };
}

export const WHERE_IT_WORKS_CAVEAT =
  `Home values are Zillow's typical single-family value today; incomes are each county's own Census median from ` +
  `${COUNTY_INCOME_YEAR}, the most recent SAIPE year, not a statewide figure. Because the values are current and the ` +
  `incomes a year or two old, every multiple runs slightly HIGH. It is a snapshot, not a trend: it cannot see jobs ` +
  `arriving or leaving, and it says nothing about whether you would want to live in any of these places, which is ` +
  `the question it most obviously invites and the one arithmetic is worst at.`;
