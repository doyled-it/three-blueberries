/**
 * Forty years of San Diego housing history, and what it can and cannot tell you
 * about waiting for a crash.
 *
 * The central lesson buried in this data: **price is not payment**. A buyer at
 * the 2021 peak paid about the same monthly as a buyer at the 2006 peak, because
 * rates were 2.84% instead of 6.24%. Prices and rates move against each other
 * often enough that "wait for prices to fall" and "wait for it to get cheaper"
 * are different bets.
 *
 * The second lesson: San Diego has had exactly two declines over 10% in 39 years.
 * That's not a sample you can forecast from. Everything here is history, not
 * prediction, and the UI says so.
 */

import { monthlyPayment } from "./amortization.ts";
import { HISTORY_LATEST_INDEX, SD_HISTORY, type HistoryRow } from "./data/history.ts";

export interface MonthPoint {
  month: string;
  index: number;
  /** Annual rate as a decimal. */
  rate: number;
  /** Index scaled into dollars against the anchor price. */
  price: number;
  /** P&I on a standard 20%-down 30-year loan at that month's price and rate. */
  payment: number;
}

/**
 * The Case-Shiller index is unitless, so we anchor it to a real dollar figure at
 * the most recent reading. Everything else scales from there, which lets you read
 * "what would this same house have cost in 2009" directly in dollars.
 *
 * The anchor is the California Association of Realtors median price for an
 * existing single-family home in San Diego County, June 2026, `car-median-price`
 * in the source registry.
 *
 * Two things follow from that and both matter. The dollars on the chart are a
 * repeat-sales index scaled by a median, so they describe ONE representative
 * house through time, not the median listing in each year. And every ratio the
 * panel reports (buying power lost, years of income, the purchasing ratio, the
 * best and worst months) divides the anchor out, so it is unaffected by this
 * number. Only the dollar axis and "the last month the math worked" move.
 */
export const DEFAULT_ANCHOR_PRICE = 1_085_000;

export function buildSeries(anchorPrice = DEFAULT_ANCHOR_PRICE, downPercent = 0.2): MonthPoint[] {
  return SD_HISTORY.map((row: HistoryRow) => {
    const [month, index, ratePercent] = row;
    const rate = ratePercent / 100;
    const price = (anchorPrice * index) / HISTORY_LATEST_INDEX;
    return { month, index, rate, price, payment: monthlyPayment(price * (1 - downPercent), rate, 30) };
  });
}

const monthsBetween = (a: string, b: string): number => {
  const [ay, am] = a.split("-").map(Number) as [number, number];
  const [by, bm] = b.split("-").map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am);
};

export interface Drawdown {
  peakMonth: string;
  peakIndex: number;
  troughMonth: string;
  troughIndex: number;
  /** Negative percent, e.g. -42.2 */
  depthPercent: number;
  monthsPeakToTrough: number;
  /** Month the index regained its prior peak, or null if it never has. */
  recoveredMonth: string | null;
  monthsTroughToRecovery: number | null;
  /** How long you'd have been underwater buying the peak. */
  monthsUnderwater: number | null;
}

/**
 * Every peak-to-trough decline of at least `minDepthPercent`, measured on the
 * repeat-sales index. Uses running-peak logic so overlapping dips collapse into
 * the single real drawdown rather than being double counted.
 */
export function findDrawdowns(minDepthPercent = 10): Drawdown[] {
  const rows = SD_HISTORY;
  const out: Drawdown[] = [];

  let peakIdx = 0;
  let troughIdx: number | null = null;

  const close = () => {
    if (troughIdx === null) return;
    const peak = rows[peakIdx]!;
    const trough = rows[troughIdx]!;
    const depth = ((trough[1] - peak[1]) / peak[1]) * 100;
    if (depth <= -minDepthPercent) {
      const recovered = rows.slice(troughIdx).find((r) => r[1] >= peak[1]) ?? null;
      out.push({
        peakMonth: peak[0],
        peakIndex: peak[1],
        troughMonth: trough[0],
        troughIndex: trough[1],
        depthPercent: depth,
        monthsPeakToTrough: monthsBetween(peak[0], trough[0]),
        recoveredMonth: recovered ? recovered[0] : null,
        monthsTroughToRecovery: recovered ? monthsBetween(trough[0], recovered[0]) : null,
        monthsUnderwater: recovered ? monthsBetween(peak[0], recovered[0]) : null,
      });
    }
    troughIdx = null;
  };

  for (let i = 1; i < rows.length; i++) {
    if (rows[i]![1] >= rows[peakIdx]![1]) {
      close();
      peakIdx = i;
    } else if (troughIdx === null || rows[i]![1] < rows[troughIdx]![1]) {
      troughIdx = i;
    }
  }
  close();

  return out;
}

export interface CurrentStatus {
  month: string;
  index: number;
  rate: number;
  /** Highest index in the trailing window, and how far off it we are now. */
  recentPeakMonth: string;
  recentPeakIndex: number;
  percentOffRecentPeak: number;
  /** Consecutive months of decline ending at the latest reading. */
  consecutiveDeclines: number;
  /** Latest 12 months, oldest first, for a sparkline. */
  trailing12: ReadonlyArray<{ month: string; index: number; changePercent: number }>;
}

export function currentStatus(lookbackMonths = 36): CurrentStatus {
  const rows = SD_HISTORY;
  const latest = rows[rows.length - 1]!;
  const window = rows.slice(Math.max(0, rows.length - lookbackMonths));

  let peak = window[0]!;
  for (const r of window) if (r[1] > peak[1]) peak = r;

  let consecutiveDeclines = 0;
  for (let i = rows.length - 1; i > 0; i--) {
    if (rows[i]![1] < rows[i - 1]![1]) consecutiveDeclines++;
    else break;
  }

  const trailing12 = rows.slice(-12).map((r, i, arr) => {
    const prevIndex = i === 0 ? rows[rows.length - 13]?.[1] : arr[i - 1]![1];
    return {
      month: r[0],
      index: r[1],
      changePercent: prevIndex ? ((r[1] - prevIndex) / prevIndex) * 100 : 0,
    };
  });

  return {
    month: latest[0],
    index: latest[1],
    rate: latest[2] / 100,
    recentPeakMonth: peak[0],
    recentPeakIndex: peak[1],
    percentOffRecentPeak: ((latest[1] - peak[1]) / peak[1]) * 100,
    consecutiveDeclines,
    trailing12,
  };
}

/** The cheapest and most expensive months to have bought, measured by payment. */
export function paymentExtremes(anchorPrice = DEFAULT_ANCHOR_PRICE, downPercent = 0.2) {
  const series = buildSeries(anchorPrice, downPercent);
  let cheapest = series[0]!;
  let priciest = series[0]!;
  for (const p of series) {
    if (p.payment < cheapest.payment) cheapest = p;
    if (p.payment > priciest.payment) priciest = p;
  }
  return { cheapest, priciest, latest: series[series.length - 1]! };
}

// ---------------------------------------------------------------------------
// The actual question: is waiting worth it?
// ---------------------------------------------------------------------------

export interface WaitScenarioInput {
  /** What the house costs today. */
  priceNow: number;
  /** Today's rate, as a decimal. */
  rateNow: number;
  downPercent: number;
  /** How far prices fall, as a positive percent. 20 means a 20% drop. */
  crashDepthPercent: number;
  /** How many months until the bottom. */
  monthsToBottom: number;
  /** The rate you expect at the bottom, as a decimal. */
  rateAtBottom: number;
  /** What you pay in rent each month while you wait. */
  monthlyRent: number;
  /** Extra you'd save each month while renting, added to the down payment. */
  monthlySavings: number;
  /** Effective property tax rate, for the Prop 13 comparison. */
  propertyTaxRate: number;
}

export interface WaitScenarioResult {
  buyNow: {
    price: number;
    down: number;
    loan: number;
    principalAndInterest: number;
    propertyTax: number;
    total: number;
  };
  buyLater: {
    price: number;
    down: number;
    loan: number;
    principalAndInterest: number;
    propertyTax: number;
    total: number;
  };
  /** Positive means waiting is cheaper each month. */
  monthlySaving: number;
  /** Permanent annual property tax advantage from a lower Prop 13 basis. */
  propTaxSavingAnnual: number;
  /** Total rent paid while waiting. */
  rentPaidWhileWaiting: number;
  /** Equity you'd have built by then if you bought now instead. */
  equityBuiltIfBuyingNow: number;
  /** Paper loss if you buy now and prices fall as specified. */
  paperLossIfBuyingNow: number;
  /** Months of the monthly saving needed to repay the rent you spent waiting. */
  breakevenMonths: number | null;
  verdict: string;
}

/**
 * Compare buying today against waiting for a specified downturn.
 *
 * Deliberately includes the costs of waiting that "just wait for the crash"
 * arguments leave out: the rent you pay in the meantime, and the principal you
 * would have been paying down. And the benefit nobody counts: in California, a
 * lower purchase price locks a lower Prop 13 assessed value for as long as you
 * own the house.
 */
export function evaluateWaiting(input: WaitScenarioInput): WaitScenarioResult {
  const {
    priceNow,
    rateNow,
    downPercent,
    crashDepthPercent,
    monthsToBottom,
    rateAtBottom,
    monthlyRent,
    monthlySavings,
    propertyTaxRate,
  } = input;

  const downNow = priceNow * downPercent;
  const loanNow = priceNow - downNow;
  const piNow = monthlyPayment(loanNow, rateNow, 30);
  const taxNow = (priceNow * propertyTaxRate) / 12;

  const priceLater = priceNow * (1 - crashDepthPercent / 100);
  // Down payment grows by whatever you saved while renting.
  const downLater = Math.min(priceLater * downPercent + monthlySavings * monthsToBottom, priceLater);
  const loanLater = Math.max(priceLater - downLater, 0);
  const piLater = monthlyPayment(loanLater, rateAtBottom, 30);
  const taxLater = (priceLater * propertyTaxRate) / 12;

  const totalNow = piNow + taxNow;
  const totalLater = piLater + taxLater;
  const monthlySaving = totalNow - totalLater;

  const rentPaid = monthlyRent * monthsToBottom;

  // Principal paid down over the waiting period had you bought now.
  const r = rateNow / 12;
  const growth = Math.pow(1 + r, monthsToBottom);
  const balanceThen = r === 0 ? loanNow - piNow * monthsToBottom : loanNow * growth - piNow * ((growth - 1) / r);
  const equityBuilt = Math.max(loanNow - balanceThen, 0);

  const paperLoss = priceNow - priceLater;

  const breakevenMonths = monthlySaving > 0 ? rentPaid / monthlySaving : null;

  let verdict: string;
  if (monthlySaving <= 0) {
    verdict =
      "Waiting loses. The rate you're assuming at the bottom cancels out the price drop, you'd pay the same or more per month for the same house, having paid rent the whole time. This is the trap: prices and rates usually move in opposite directions, because the thing that crashes prices is also the thing that makes the Fed cut rates.";
  } else if (breakevenMonths !== null && breakevenMonths > 84) {
    verdict = `Waiting saves ${Math.round(monthlySaving).toLocaleString("en-US")}/month, but you'd pay ${Math.round(rentPaid).toLocaleString("en-US")} in rent to get there, about ${(breakevenMonths / 12).toFixed(1)} years just to break even on that rent. That's a long time to be right about timing.`;
  } else {
    verdict = `Waiting saves ${Math.round(monthlySaving).toLocaleString("en-US")}/month and repays the rent you spent waiting in about ${Math.round(breakevenMonths ?? 0)} months. On these assumptions it's worth it, provided the crash actually arrives on your schedule, and you still have your job when it does.`;
  }

  return {
    buyNow: {
      price: priceNow,
      down: downNow,
      loan: loanNow,
      principalAndInterest: piNow,
      propertyTax: taxNow,
      total: totalNow,
    },
    buyLater: {
      price: priceLater,
      down: downLater,
      loan: loanLater,
      principalAndInterest: piLater,
      propertyTax: taxLater,
      total: totalLater,
    },
    monthlySaving,
    propTaxSavingAnnual: (priceNow - priceLater) * propertyTaxRate,
    rentPaidWhileWaiting: rentPaid,
    equityBuiltIfBuyingNow: equityBuilt,
    paperLossIfBuyingNow: paperLoss,
    breakevenMonths,
    verdict,
  };
}

export interface CrashPreset {
  id: string;
  label: string;
  depthPercent: number;
  monthsToBottom: number;
  rateAtBottom: number;
  basis: string;
}

/**
 * Scenario presets derived from what actually happened, not from a hunch.
 *
 * The default is deliberately the MILDER of the two real declines rather than
 * their average. Averaging a 16.7% event and a 42.2% event produces a ~29%
 * "typical crash" that has never once occurred, and dressing up a two-item
 * sample as a central tendency is exactly the kind of false precision this
 * project exists to avoid. The 2008 case is offered as its own preset so the
 * severe tail is one click away rather than baked into the default.
 */
export function crashPresets(): CrashPreset[] {
  const drops = findDrawdowns(10);
  const rateAtTroughOf = (d: (typeof drops)[number]) => {
    const row = SD_HISTORY.find((r) => r[0] === d.troughMonth);
    return row ? row[2] / 100 : 0.05;
  };

  const sorted = [...drops].sort((a, b) => b.depthPercent - a.depthPercent);
  const mild = sorted[0]!;
  const severe = sorted[sorted.length - 1]!;

  return [
    {
      id: "mild",
      label: `Repeat of ${mild.peakMonth.slice(0, 4)}`,
      depthPercent: Math.round(Math.abs(mild.depthPercent)),
      monthsToBottom: mild.monthsPeakToTrough,
      rateAtBottom: rateAtTroughOf(mild),
      basis: `The milder of the two declines on record: ${Math.abs(mild.depthPercent).toFixed(1)}% over ${mild.monthsPeakToTrough} months, bottoming ${mild.troughMonth}. Rates at that trough averaged ${(rateAtTroughOf(mild) * 100).toFixed(2)}%.`,
    },
    {
      id: "severe",
      label: `Repeat of ${severe.peakMonth.slice(0, 4)}`,
      depthPercent: Math.round(Math.abs(severe.depthPercent)),
      monthsToBottom: severe.monthsPeakToTrough,
      rateAtBottom: rateAtTroughOf(severe),
      basis: `The worst decline on record: ${Math.abs(severe.depthPercent).toFixed(1)}% over ${severe.monthsPeakToTrough} months, bottoming ${severe.troughMonth}. Rates had fallen to ${(rateAtTroughOf(severe) * 100).toFixed(2)}% by then. The crash and the rate relief arrived together.`,
    },
    {
      id: "soft",
      label: "No crash, rates ease",
      depthPercent: 0,
      monthsToBottom: 18,
      rateAtBottom: 0.055,
      basis:
        "Prices flat, rates drifting back toward 5.5%. This is the consensus 2026 forecast and by far the most common historical outcome, San Diego has spent 37 of the last 39 years not crashing.",
    },
    {
      id: "stagflation",
      label: "Prices fall, rates rise",
      depthPercent: 20,
      monthsToBottom: 36,
      rateAtBottom: 0.095,
      basis:
        "The scenario that breaks the 'just wait' thesis: a real price decline with no rate relief. Rare, but it is what the early 1980s looked like, and it turns a 20% discount into almost nothing.",
    },
    {
      id: "recession",
      label: "Recession, overvalued market",
      depthPercent: 20,
      monthsToBottom: 30,
      rateAtBottom: 0.05,
      basis:
        "Moody's Analytics has repeatedly framed the recession case for 'significantly overvalued' metros as a 15-20% peak-to-trough decline, with rates falling as the Fed responds. San Diego screens as overvalued on price-to-income, so this is the mainstream bear case rather than a fringe one.",
    },
    {
      id: "worse-than-2008",
      label: "Worse than 2008",
      depthPercent: 50,
      monthsToBottom: 48,
      rateAtBottom: 0.04,
      basis:
        "Beyond anything in the San Diego record. The 2006 crash was 42%. Included because you asked for the tail, not because anything in the data points here. It would require a shock larger than the subprime collapse, and today's mortgage delinquency rate is near a historic low rather than climbing.",
    },
    {
      id: "japan",
      label: "Long stagnation",
      depthPercent: 15,
      monthsToBottom: 84,
      rateAtBottom: 0.045,
      basis:
        "Not a crash, a grind. Prices drift down modestly over seven years while rates ease. Japan after 1991 and California through the 1990s both looked more like this than like 2008: the 1990-96 decline took 74 months to bottom, twice as long as 2006-09.",
    },
  ];
}

/** The preset the UI opens on. See crashPresets() for why it's the mild one. */
export function defaultCrashPreset(): CrashPreset {
  return crashPresets()[0]!;
}

/**
 * What the historical record actually supports, stated as bounded claims rather
 * than a forecast. Rendered directly into the UI so the caveats travel with the
 * numbers.
 */
export function historicalContext() {
  const drops = findDrawdowns(10);
  const worst = drops.reduce((a, b) => (b.depthPercent < a.depthPercent ? b : a), drops[0]!);
  const status = currentStatus();
  const extremes = paymentExtremes();

  return {
    yearsOfData: Math.round(SD_HISTORY.length / 12),
    declines: drops,
    worst,
    status,
    extremes,
    caveats: [
      "Two declines over 10% in 39 years isn't a sample you can forecast from. Anyone who says they know what happens next is selling something.",
      "Price is not payment. A 2021 peak buyer paid about what a 2006 peak buyer paid, because the rate was 2.84% not 6.24%. And if a recession cracks prices, rate cuts are what stop the cracking.",
      "You have to still have a job at the bottom. San Diego unemployment roughly doubled last time; the people who bought the dip were the ones whose income survived.",
      "Credit tightens exactly when prices fall. In 2009 private lenders went back to 20% down; FHA at 3.5% and VA at zero stayed open.",
      "In California, buying lower is permanent. Prop 13 locks your assessed value to your price and caps growth at 2%/year, so a cheaper entry keeps paying you back for as long as you own it.",
    ],
  };
}
