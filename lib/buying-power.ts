/**
 * Three blueberries: what a median income can actually buy.
 *
 * This is the thesis of the whole project, and it is deliberately NOT "houses
 * got expensive." Prices rising is unremarkable, wages rise too, and a 1987
 * dollar is not a 2026 dollar. The claim that means something is *relative*:
 * the same job buys less house than it used to.
 *
 * So rather than plot prices, this plots two lines that share a unit:
 *
 *   1. What the median home actually cost.
 *   2. What the median household could have afforded that month, derived from
 *      their income, the prevailing mortgage rate, and a fixed 30% share of
 *      gross income spent on housing.
 *
 * Holding the *effort* constant at 30% of income and letting the affordable
 * price float is what isolates buying power. Where the two lines cross is the
 * moment a median household stopped being able to buy a median home, and the
 * gap between them afterwards is the size of the problem in dollars.
 */

import { monthlyPayment } from "./amortization.ts";
import { HISTORY_LATEST_INDEX, SD_HISTORY } from "./data/history.ts";
import { CA_MEDIAN_INCOME, SIGNALS_INCOME_LAST_YEAR } from "./data/signals.ts";
import { DEFAULT_ANCHOR_PRICE } from "./history.ts";

/** The share of gross income a household is assumed to put toward principal and interest. */
export const AFFORDABILITY_EFFORT = 0.3;
export const ASSUMED_DOWN_PAYMENT = 0.2;

export interface BuyingPowerPoint {
  month: string;
  /** What the median home cost that month. */
  medianPrice: number;
  /** What a median household could buy at 30% of income and that month's rate. */
  affordablePrice: number;
  income: number;
  rate: number;
  /** affordablePrice / medianPrice. Above 1 means the median household could buy more than the median home. */
  purchasingRatio: number;
  /** Years of gross income the median home costs. */
  yearsOfIncome: number;
  /** How much short of the median home a median income falls. Negative means they can afford it. */
  shortfall: number;
}

const incomeForYear = (year: string): number => {
  const exact = CA_MEDIAN_INCOME.find((r) => r[0].startsWith(year));
  if (exact) return exact[1];
  return CA_MEDIAN_INCOME[CA_MEDIAN_INCOME.length - 1]![1];
};

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

export function buyingPowerSeries(anchorPrice = DEFAULT_ANCHOR_PRICE): BuyingPowerPoint[] {
  return SD_HISTORY.map(([month, index, ratePercent]) => {
    const rate = ratePercent / 100;
    const medianPrice = (anchorPrice * index) / HISTORY_LATEST_INDEX;
    const income = incomeForYear(month.slice(0, 4));
    const budget = (income / 12) * AFFORDABILITY_EFFORT;
    const affordablePrice = affordablePriceAt(budget, rate);

    return {
      month,
      medianPrice,
      affordablePrice,
      income,
      rate,
      purchasingRatio: affordablePrice / medianPrice,
      yearsOfIncome: medianPrice / income,
      shortfall: medianPrice - affordablePrice,
    };
  });
}

export interface BuyingPowerVerdict {
  first: BuyingPowerPoint;
  latest: BuyingPowerPoint;
  best: BuyingPowerPoint;
  worst: BuyingPowerPoint;
  /** The last month a median household could afford the median home. */
  lastAffordableMonth: string | null;
  /** How much buying power has been lost since the start of the record, as a fraction. */
  powerLost: number;
  /** Extra income needed today to restore the starting ratio. */
  incomeNeededToday: number;
  headline: string;
  blueberries: string;
}

export function buyingPowerVerdict(anchorPrice = DEFAULT_ANCHOR_PRICE): BuyingPowerVerdict {
  const series = buyingPowerSeries(anchorPrice);
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
    headline:
      `In ${first.month.slice(0, 4)} the median California household could afford ${first.purchasingRatio.toFixed(2)}x the median San Diego home. ` +
      `Today it is ${latest.purchasingRatio.toFixed(2)}x. That is ${pct(powerLost)} of housing buying power gone, not because prices rose, ` +
      `but because they rose ${(latest.yearsOfIncome / first.yearsOfIncome).toFixed(1)} times faster than incomes did.`,
    blueberries:
      `The median home costs ${latest.yearsOfIncome.toFixed(1)} years of median household income today. In ${first.month.slice(0, 4)} it cost ` +
      `${first.yearsOfIncome.toFixed(1)} years. To buy the same house on the same terms your parents did, ` +
      `a household would need to earn ${money(incomeNeededToday)} instead of ${money(latest.income)}.`,
  };
}

/** Income series ends before the price series; the UI should say so. */
export const BUYING_POWER_CAVEAT =
  `Income is California median household income, annual, and the series ends in ${SIGNALS_INCOME_LAST_YEAR}, ` +
  `later months carry the last value forward, which if anything understates the gap. ` +
  `The affordable-price line assumes ${AFFORDABILITY_EFFORT * 100}% of gross income toward principal and interest, ` +
  `${ASSUMED_DOWN_PAYMENT * 100}% down, 30-year fixed at that month's prevailing rate. It excludes tax, insurance and everything else, ` +
  `so it is the most generous possible reading of what a household could carry.`;
