/**
 * Three blueberries: what a median income can actually buy.
 *
 * This is the thesis of the whole project, and it is deliberately NOT "houses
 * got expensive." Prices rising is unremarkable, wages rise too, and a 1984
 * dollar is not a 2026 dollar. The claim that means something is *relative*:
 * the same job buys less house than it used to.
 *
 * So rather than plot prices, this plots two lines that share a unit:
 *
 *   1. What the same house in this county actually cost.
 *   2. What the median household could have afforded then, derived from their
 *      income, the prevailing mortgage rate, and a fixed 30% share of gross
 *      income spent on housing.
 *
 * Holding the *effort* constant at 30% of income and letting the affordable
 * price float is what isolates buying power. Where the two lines cross is the
 * moment a median household stopped being able to buy that house, and the gap
 * between them afterwards is the size of the problem in dollars.
 */

import { monthlyPayment } from "./amortization.ts";
import { DEFAULT_COUNTY, historyFor } from "./data/history.ts";
import type { CaCounty } from "./data/ca-loan-limits.ts";
import { CA_MEDIAN_INCOME, CPI, CPI_LATEST, SIGNALS_INCOME_LAST_YEAR } from "./data/signals.ts";
import { DEFAULT_ANCHOR_PRICE } from "./history.ts";

/** The share of gross income a household is assumed to put toward principal and interest. */
export const AFFORDABILITY_EFFORT = 0.3;
export const ASSUMED_DOWN_PAYMENT = 0.2;

export interface BuyingPowerPoint {
  month: string;
  /** Multiplier that restates this month's dollars in today's money. */
  inflationFactor: number;
  /**
   * What the same house cost that month.
   *
   * NOT a median for that period. It is the FHFA repeat-sales index for this
   * county, which tracks what the same houses resold for, anchored to today's
   * typical value.
   * That makes it a like-for-like price series rather than a mix-shifting one,
   * and it is the reason the label everywhere says "the same house".
   */
  homePrice: number;
  /** What a median household could buy at 30% of income and that month's rate. */
  affordablePrice: number;
  income: number;
  rate: number;
  /** affordablePrice / homePrice. Above 1 means a median household could buy more than that house. */
  purchasingRatio: number;
  /** Years of gross income the house costs. */
  yearsOfIncome: number;
  /** How much short of the house a median income falls. Negative means they can afford it. */
  shortfall: number;
}

/**
 * Income for a calendar year, or the last measured year when the price series
 * runs past the income series.
 *
 * There is no backward carry and there must not be one: dividing a 1975 house
 * price by a 2024 income produced a 3% burden and made 1975 look like the best
 * time to buy in history. `INCOME_STARTS` below solves that by cutting the panel
 * to the years income is actually measured, so this function is only ever asked
 * about years at or past the START of the series.
 */
const incomeForYear = (year: string): number => {
  const exact = CA_MEDIAN_INCOME.find((r) => r[0].startsWith(year));
  if (exact) return exact[1];
  // Past the END of the series only. Holding income flat overstates the burden,
  // because incomes kept rising. The caveat says so.
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

/**
 * Invert the mortgage payment formula: given a monthly budget and a rate, how
 * much house does that buy?
 *
 *   loan = M * ((1+r)^n - 1) / (r(1+r)^n)
 *
 * then gross the loan up by the down payment to get a purchase price.
 */
export function affordablePriceAt(
  monthlyBudget: number,
  annualRate: number,
  termYears = 30,
  downPercent = ASSUMED_DOWN_PAYMENT
): number {
  const n = Math.round(termYears * 12);
  const r = annualRate / 12;
  const loan = r === 0 ? monthlyBudget * n : (monthlyBudget * (Math.pow(1 + r, n) - 1)) / (r * Math.pow(1 + r, n));
  return loan / (1 - downPercent);
}

const cpiFor = (month: string): number => {
  const exact = CPI.find((r) => r[0] === month);
  if (exact) return exact[1];
  const before = CPI.filter((r) => r[0] <= month);
  return before.length ? before[before.length - 1]![1] : CPI[0]![1];
};

/**
 * Restate old dollars in today's money.
 *
 * Over four decades the nominal chart is dominated by inflation, which makes every
 * line look like it exploded and hides the thing that actually changed. The
 * RATIO between the two lines is inflation-neutral either way, so the headline
 * findings do not move. Only the shape of the chart and the axis do.
 */
export function inflationFactor(month: string): number {
  return CPI_LATEST / cpiFor(month);
}

export function buyingPowerSeries(
  county: CaCounty = DEFAULT_COUNTY,
  anchorPrice?: number,
  inTodaysDollars = false
): BuyingPowerPoint[] {
  const { rows, anchorPrice: countyAnchor } = historyFor(county);
  const anchor = anchorPrice ?? countyAnchor;
  const latestIndex = rows[rows.length - 1]![1];
  return rows
    .filter(([month]) => month.slice(0, 4) >= INCOME_STARTS)
    .map(([month, index, ratePercent]) => {
      const rate = ratePercent / 100;
      const factor = inTodaysDollars ? inflationFactor(month) : 1;
      const homePrice = ((anchor * index) / latestIndex) * factor;
      const income = incomeForYear(month.slice(0, 4));
      const budget = (income / 12) * AFFORDABILITY_EFFORT;
      const affordablePrice = affordablePriceAt(budget, rate) * factor;

      return {
        month,
        inflationFactor: factor,
        homePrice,
        affordablePrice,
        income: income * factor,
        rate,
        // Both sides carry the same factor, so these are unchanged either way.
        purchasingRatio: affordablePrice / homePrice,
        yearsOfIncome: homePrice / (income * factor),
        shortfall: homePrice - affordablePrice,
      };
    });
}

export interface BuyingPowerVerdict {
  first: BuyingPowerPoint;
  latest: BuyingPowerPoint;
  best: BuyingPowerPoint;
  worst: BuyingPowerPoint;
  /** The last month a median household could afford this house. */
  lastAffordableMonth: string | null;
  /** How much buying power has been lost since the start of the record, as a fraction. */
  powerLost: number;
  /** Extra income needed today to restore the starting ratio. */
  incomeNeededToday: number;
  headline: string;
  blueberries: string;
}

export function buyingPowerVerdict(county: CaCounty = DEFAULT_COUNTY, anchorPrice?: number): BuyingPowerVerdict {
  const { place } = historyFor(county);
  const series = buyingPowerSeries(county, anchorPrice);
  const first = series[0]!;
  const latest = series[series.length - 1]!;

  let best = series[0]!;
  let worst = series[0]!;
  for (const p of series) {
    if (p.purchasingRatio > best.purchasingRatio) best = p;
    if (p.purchasingRatio < worst.purchasingRatio) worst = p;
  }

  const affordable = series.filter((p) => p.purchasingRatio >= 1);
  const lastAffordableMonth = affordable.length ? affordable[affordable.length - 1]!.month : null;

  const powerLost = 1 - latest.purchasingRatio / first.purchasingRatio;
  // What income would restore the ratio the record opened with?
  const incomeNeededToday = (latest.income * first.purchasingRatio) / latest.purchasingRatio;

  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

  return {
    first,
    latest,
    best,
    worst,
    lastAffordableMonth,
    powerLost,
    incomeNeededToday,
    // Buying power has NOT fallen everywhere. It is down 23% in San Diego and up
    // 27% in Fresno, and a headline that only knows how to say "gone" printed
    // "-27% gone" for half the state. Which way it went is the finding.
    headline:
      powerLost > 0
        ? `In ${first.month.slice(0, 4)} the median California household could afford ` +
          `${first.purchasingRatio.toFixed(2)}x a typical ${place} house. Today it is ` +
          `${latest.purchasingRatio.toFixed(2)}x. That is ${pct(powerLost)} of housing buying power gone, not ` +
          `because prices rose, but because they rose ` +
          `${(latest.yearsOfIncome / first.yearsOfIncome).toFixed(1)} times faster than incomes did.`
        : `In ${first.month.slice(0, 4)} the median California household could afford ` +
          `${first.purchasingRatio.toFixed(2)}x a typical ${place} house. Today it is ` +
          `${latest.purchasingRatio.toFixed(2)}x, which is ${pct(-powerLost)} MORE. This is the part of ` +
          `California a typical statewide income can still reach. Whether the people who actually live here earn ` +
          `that, and whether you would want to, are the next two questions, and they are below.`,
    blueberries:
      powerLost > 0
        ? `That house costs ${latest.yearsOfIncome.toFixed(1)} years of STATEWIDE median household income today. In ` +
          `${first.month.slice(0, 4)} it cost ${first.yearsOfIncome.toFixed(1)} years. To buy the same house on ` +
          `the same terms your parents did, a household would need to earn ${money(incomeNeededToday)} instead ` +
          `of ${money(latest.income)}.`
        : `That house costs ${latest.yearsOfIncome.toFixed(1)} years of STATEWIDE median household income today, ` +
          `against ${first.yearsOfIncome.toFixed(1)} years in ${first.month.slice(0, 4)}. A typical California ` +
          `income goes further here now than it did then, which is the opposite of the national story. What the ` +
          `people who live here earn is a different number, and the panel below uses it.`,
  };
}

/**
 * Both branches must carry the STATEWIDE qualifier. The rising branch shouted it
 * and the falling branch dropped it, directly above a panel that uses LOCAL
 * income, which is exactly the blur `where-it-works.ts` exists to prevent.
 */

/**
 * What this panel is and is not, in the order a sceptical reader would ask.
 *
 * Two errors have been fixed here and both flattered the panel's own argument,
 * which is the one direction this project is not entitled to be wrong in.
 *
 * 1. It got the direction of its own bias backwards. Holding income flat after
 *    the series ends makes the affordable line too LOW, so it OVERSTATES the
 *    gap. It claimed the opposite.
 * 2. It said "the anchor moves the dollar axis and nothing else", which told a
 *    sceptical reader not to interrogate the one input that sets the panel's
 *    biggest stat tile. Only the price line is anchored; the affordable line is
 *    derived from income and rate alone. So the anchor moves the GAP between
 *    them, and with it "the last month the math worked", by years. Only the
 *    percentage change in buying power survives it.
 *
 * It is a function of county because the record does NOT start in 1984
 * everywhere: eleven counties' price series begin as late as 1993.
 */
export function buyingPowerCaveat(county: CaCounty = DEFAULT_COUNTY): string {
  const series = buyingPowerSeries(county);
  const startYear = series[0]!.month.slice(0, 4);
  const { spliceMonth } = historyFor(county);

  void spliceMonth;
  return (
    `The income here is STATEWIDE California median household income, so this answers "could a typical Californian ` +
    `buy here", not "can the people who live here afford it": the panel below answers that, using each county's own ` +
    `income. The price line is the FHFA index anchored to Zillow's current typical value, so it reads in dollars. ` +
    `Only that line is anchored, so the anchor moves the GAP and every dollar figure with it; the percentage change ` +
    `does not. The record starts in ${startYear}. Income ends in ${SIGNALS_INCOME_LAST_YEAR} and is held flat after ` +
    `that, which OVERSTATES the gap, since incomes kept rising. The affordable line is the most generous possible ` +
    `reading: ${AFFORDABILITY_EFFORT * 100}% of income, ${ASSUMED_DOWN_PAYMENT * 100}% down, and it excludes tax, ` +
    `insurance and everything else.`
  );
}

/** @deprecated Use buyingPowerCaveat(county). Kept so nothing renders undefined. */
export const BUYING_POWER_CAVEAT = buyingPowerCaveat(DEFAULT_COUNTY);
