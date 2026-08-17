/**
 * Decades of California housing history, per county, and what it can and cannot
 * tell you about waiting for a crash.
 *
 * The central lesson buried in this data: **price is not payment**. In San Diego
 * a buyer at the 2021 peak paid about the same monthly as a buyer at the 2006
 * peak, because rates were 2.84% instead of 6.24%. Prices and rates move against
 * each other often enough that "wait for prices to fall" and "wait for it to get
 * cheaper" are different bets. Those two figures are San Diego's, so the UI copy
 * derives the equivalent pair from whichever county is selected rather than
 * printing these.
 *
 * The second lesson: a California county has had between one and three declines
 * over 10% in its record. That is not a sample you can forecast from. Everything
 * here is history, not prediction, and the UI says so.
 */

import { monthlyPayment } from "./amortization.ts";
import { DEFAULT_COUNTY, historyFor, type CountyHistory, type HistoryRow } from "./data/history.ts";
import type { CaCounty } from "./data/ca-loan-limits.ts";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** n rows span n-1 steps, not n. Counting rows overstated every record by a period. */
const yearsOfData = (rowCount: number, stepMonths: number): number =>
  Math.round(((rowCount - 1) * stepMonths) / 12);

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
 * The FHFA index is unitless, so we anchor it to a real dollar figure at
 * the most recent reading. Everything else scales from there, which lets you read
 * "what would this same house have cost in 2009" directly in dollars.
 *
 * The anchor is now per county: Zillow's typical single-family value there,
 * `zillow-zhvi` in the source registry. It used to be one hand-typed San Diego
 * median, which is part of why every county was shown San Diego's history.
 *
 * Two things follow and both matter. The dollars on the chart are a repeat-sales
 * index scaled by a typical value, so they describe ONE representative house
 * through time, not the median listing in each year. And every ratio the panel
 * reports divides the anchor out, so it is unaffected by this number. Only the
 * dollar axis and "the last month the math worked" move.
 */
export const DEFAULT_ANCHOR_PRICE = historyFor(DEFAULT_COUNTY).anchorPrice;

/**
 * Everything below reads ONE county's history. It used to read a module-level
 * San Diego constant, which is why every county in the selector was shown San
 * Diego's past. `historyFor` returns the series, its frequency, what it actually
 * measures, and the dollar anchor, so a caller never has to know whether this
 * county has a metro series or only an annual one.
 */
export function contextFor(county: CaCounty = DEFAULT_COUNTY): CountyHistory {
  return historyFor(county);
}

export function buildSeries(
  county: CaCounty = DEFAULT_COUNTY,
  anchorPrice?: number,
  downPercent = 0.2
): MonthPoint[] {
  const history = historyFor(county);
  const anchor = anchorPrice ?? history.anchorPrice;
  const latestIndex = history.rows[history.rows.length - 1]![1];
  return history.rows.map((row: HistoryRow) => {
    const [month, index, ratePercent] = row;
    const rate = ratePercent / 100;
    const price = (anchor * index) / latestIndex;
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
  /**
   * True when the "trough" is simply the newest reading, so the decline has not
   * been shown to have bottomed. Sierra's most recent decline reported
   * "bottoming 2025-12" for a fall that is still going, which is a
   * completed-crash claim about an ongoing one.
   */
  inProgress: boolean;
}

/**
 * Every peak-to-trough decline of at least `minDepthPercent`, measured on the
 * repeat-sales index. Uses running-peak logic so overlapping dips collapse into
 * the single real drawdown rather than being double counted.
 */
export function findDrawdowns(minDepthPercent = 10, county: CaCounty = DEFAULT_COUNTY): Drawdown[] {
  const rows = historyFor(county).rows;
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
      const inProgress = troughIdx === rows.length - 1;
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
        inProgress,
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
  /**
   * Consecutive PERIODS of decline ending at the latest reading. A period is a
   * quarter or a year depending on the county, never a month. The UI called
   * these "consecutive monthly declines" on a series that has no monthly rows.
   */
  consecutiveDeclines: number;
  /** "quarterly" or "annual", so callers can name the period they are counting. */
  periodLabel: "quarterly" | "annual";
  /** Singular period noun: "quarter" or "year". */
  periodNoun: "quarter" | "year";
  /** Latest 12 months, oldest first, for a sparkline. */
  trailing12: ReadonlyArray<{ month: string; index: number; changePercent: number }>;
}

export function currentStatus(lookbackMonths = 36, county: CaCounty = DEFAULT_COUNTY): CurrentStatus {
  const { rows, stepMonths } = historyFor(county);
  const latest = rows[rows.length - 1]!;
  // Rows are quarters or years, never months, so a window expressed in MONTHS
  // has to be converted. Slicing `lookbackMonths` rows made this a nine-year
  // lookback on a quarterly series and a 36-YEAR one on an annual county.
  const lookbackRows = Math.max(1, Math.round(lookbackMonths / stepMonths));
  const window = rows.slice(Math.max(0, rows.length - lookbackRows));

  let peak = window[0]!;
  for (const r of window) if (r[1] > peak[1]) peak = r;

  let consecutiveDeclines = 0;
  for (let i = rows.length - 1; i > 0; i--) {
    if (rows[i]![1] < rows[i - 1]![1]) consecutiveDeclines++;
    else break;
  }

  const trailingRows = Math.max(2, Math.round(12 / stepMonths));
  const trailing12 = rows.slice(-trailingRows).map((r, i, arr) => {
    const prevIndex = i === 0 ? rows[rows.length - trailingRows - 1]?.[1] : arr[i - 1]![1];
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
    periodLabel: stepMonths === 12 ? "annual" : "quarterly",
    periodNoun: stepMonths === 12 ? "year" : "quarter",
    trailing12,
  };
}

/** The cheapest and most expensive months to have bought, measured by payment. */
export function paymentExtremes(county: CaCounty = DEFAULT_COUNTY, anchorPrice?: number, downPercent = 0.2) {
  const series = buildSeries(county, anchorPrice, downPercent);
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
    verdict = `Waiting saves ${Math.round(monthlySaving).toLocaleString("en-US")}/month, but you'd pay ${Math.round(rentPaid).toLocaleString("en-US")} in rent first, about ${(breakevenMonths / 12).toFixed(1)} years just to break even on it. A long time to be right about timing.`;
  } else {
    verdict = `Waiting saves ${Math.round(monthlySaving).toLocaleString("en-US")}/month and repays the rent you spent waiting in about ${Math.round(breakevenMonths ?? 0)} months. Worth it on these assumptions, if the crash arrives on your schedule and you still have your job when it does.`;
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
 * The default is deliberately the SHALLOWEST real decline rather than an average
 * of them. Averaging a 12.5% event and a 41.9% event produces a ~27% "typical
 * crash" that has never once occurred, and dressing up a two-item sample as a
 * central tendency is exactly the kind of false precision this project exists to
 * avoid. The worst case is offered as its own preset so the severe tail is one
 * click away rather than baked into the default.
 *
 * Everything here is per county and NOTHING may be hardcoded from San Diego's
 * record. Three separate strings used to be: "the milder of the two declines"
 * (17 counties have one decline, 16 have three), "the 2008 crash was 42%" (24
 * counties fell further than the 50% this preset offers), and "74 months, twice
 * as long as 2006-09" (San Diego's own figures are 63 months and 1.6x). All of
 * them are derived now.
 */
export function crashPresets(county: CaCounty = DEFAULT_COUNTY): CrashPreset[] {
  const { rows, place } = historyFor(county);
  const drops = findDrawdowns(10, county);
  const rateAtTroughOf = (d: (typeof drops)[number]) => {
    const row = rows.find((r) => r[0] === d.troughMonth);
    return row ? row[2] / 100 : 0.05;
  };

  const sorted = [...drops].sort((a, b) => b.depthPercent - a.depthPercent);
  const mild = sorted[0]!;
  const severe = sorted[sorted.length - 1]!;
  const n = sorted.length;

  // A decline whose trough is the newest reading has not been shown to have
  // bottomed. Say "still falling" rather than announcing a bottom that has not
  // happened.
  const bottomPhrase = (d: Drawdown) =>
    d.inProgress ? `and still falling as of ${d.troughMonth}` : `bottoming ${d.troughMonth}`;

  // The longest decline on record, which is what "long stagnation" should be
  // anchored to. Not always the deepest one.
  const longest = [...drops].sort((a, b) => b.monthsPeakToTrough - a.monthsPeakToTrough)[0]!;
  const shortest = [...drops].sort((a, b) => a.monthsPeakToTrough - b.monthsPeakToTrough)[0]!;
  const stretchFactor = shortest.monthsPeakToTrough > 0 ? longest.monthsPeakToTrough / shortest.monthsPeakToTrough : 1;

  const worstDepth = Math.abs(severe.depthPercent);
  // "Worse than" has to actually be worse than this county's own record. In
  // Merced the record is 65.7%, so a flat 50% would have been the mild case.
  const tailDepth = Math.max(50, Math.ceil((worstDepth + 8) / 5) * 5);

  const declineCount =
    n === 1 ? "the only decline over 10% in the record" : n === 2 ? "the milder of the two declines on record" : `the shallowest of the ${n} declines on record`;

  const real: CrashPreset[] =
    n === 1
      ? [
          {
            id: "mild",
            label: `Repeat of ${mild.peakMonth.slice(0, 4)}`,
            depthPercent: Math.round(worstDepth),
            monthsToBottom: mild.monthsPeakToTrough,
            rateAtBottom: rateAtTroughOf(mild),
            basis: `The only decline over 10% in ${place}'s record: ${worstDepth.toFixed(1)}% over ${mild.monthsPeakToTrough} months, ${bottomPhrase(mild)}. Rates ${mild.inProgress ? "there" : "at that trough"} averaged ${(rateAtTroughOf(mild) * 100).toFixed(2)}%. One event is not a distribution, so treat this as an anecdote with a date on it.`,
          },
        ]
      : [
          {
            id: "mild",
            label: `Repeat of ${mild.peakMonth.slice(0, 4)}`,
            depthPercent: Math.round(Math.abs(mild.depthPercent)),
            monthsToBottom: mild.monthsPeakToTrough,
            rateAtBottom: rateAtTroughOf(mild),
            basis: `In ${place}, ${declineCount}: ${Math.abs(mild.depthPercent).toFixed(1)}% over ${mild.monthsPeakToTrough} months, ${bottomPhrase(mild)}. Rates ${mild.inProgress ? "there" : "at that trough"} averaged ${(rateAtTroughOf(mild) * 100).toFixed(2)}%.`,
          },
          {
            id: "severe",
            label: `Repeat of ${severe.peakMonth.slice(0, 4)}`,
            depthPercent: Math.round(worstDepth),
            monthsToBottom: severe.monthsPeakToTrough,
            rateAtBottom: rateAtTroughOf(severe),
            basis: `${place}'s worst decline on record: ${worstDepth.toFixed(1)}% over ${severe.monthsPeakToTrough} months, ${bottomPhrase(severe)}. Rates had fallen to ${(rateAtTroughOf(severe) * 100).toFixed(2)}% by then. The crash and the rate relief arrived together.`,
          },
        ];

  return [
    ...real,
    {
      id: "soft",
      label: "No crash, rates ease",
      depthPercent: 0,
      monthsToBottom: 18,
      rateAtBottom: 0.055,
      basis:
        "Prices flat, rates easing toward 5.5%. The consensus 2026 forecast, and the most common outcome by far: California housing spends most years not crashing.",
    },
    {
      id: "stagflation",
      label: "Prices fall, rates rise",
      depthPercent: 20,
      monthsToBottom: 36,
      rateAtBottom: 0.095,
      basis:
        "The scenario that breaks the 'just wait' thesis: a real decline with no rate relief. Rare, but it is what the early 1980s looked like, and it turns a 20% discount into almost nothing.",
    },
    {
      id: "recession",
      label: "Recession, overvalued market",
      depthPercent: 20,
      monthsToBottom: 30,
      rateAtBottom: 0.05,
      basis:
        "Moody's has framed the recession case for 'significantly overvalued' metros as a decline of 15-20% with rates falling. Coastal California screens as overvalued on price-to-income, so this is the mainstream bear case, not a fringe one.",
    },
    {
      id: "worse-than-2008",
      label: `Worse than ${severe.peakMonth.slice(0, 4)}`,
      depthPercent: tailDepth,
      monthsToBottom: 48,
      rateAtBottom: 0.04,
      basis: `Beyond anything in ${place}'s record, whose worst was ${worstDepth.toFixed(1)}% from the ${severe.peakMonth.slice(0, 4)} peak. Here because you asked for the tail, not because the data points here: it needs a shock bigger than the subprime collapse, and delinquency is nowhere near where it sat going into that.`,
    },
    {
      id: "japan",
      label: "Long stagnation",
      depthPercent: 15,
      monthsToBottom: Math.min(120, longest.monthsPeakToTrough),
      rateAtBottom: 0.045,
      basis:
        `Not a crash, a grind: prices drift down while rates ease, the way Japan after 1991 and California through the 1990s did. ` +
        (n > 1
          ? `${place}'s ${longest.peakMonth.slice(0, 4)} decline took ${longest.monthsPeakToTrough} months to bottom, ${stretchFactor.toFixed(1)}x as long as its ${shortest.peakMonth.slice(0, 4)} one.`
          : `${place}'s ${longest.peakMonth.slice(0, 4)} decline took ${longest.monthsPeakToTrough} months to bottom.`),
    },
  ];
}

/** The preset the UI opens on. See crashPresets() for why it's the mild one. */
export function defaultCrashPreset(county: CaCounty = DEFAULT_COUNTY): CrashPreset {
  return crashPresets(county)[0]!;
}

/**
 * What the historical record actually supports, stated as bounded claims rather
 * than a forecast. Rendered directly into the UI so the caveats travel with the
 * numbers.
 */
export function historicalContext(county: CaCounty = DEFAULT_COUNTY) {
  const { rows, stepMonths, place } = historyFor(county);
  const drops = findDrawdowns(10, county);
  const worst = drops.reduce((a, b) => (b.depthPercent < a.depthPercent ? b : a), drops[0]!);
  const status = currentStatus(36, county);
  const extremes = paymentExtremes(county);

  // "Price is not payment" used to quote San Diego's 2.84% and 6.24% at every
  // county. Derive it instead: the month with the highest PRICE against the
  // month with the highest PAYMENT. When those are different months, the point
  // makes itself.
  const series = buildSeries(county);
  let dearestPrice = series[0]!;
  for (const p of series) if (p.price > dearestPrice.price) dearestPrice = p;
  const dearestPayment = extremes.priciest;
  const priceNotPayment =
    dearestPrice.month === dearestPayment.month
      ? `Price is not payment. The rate decides as much as the sticker does, and a decline that arrives with rate cuts is worth far less than the same decline at today's rate.`
      : `Price is not payment. ${place}'s dearest month to BUY was ${dearestPrice.month.slice(0, 4)} at ` +
        `${money(dearestPrice.price)}, but its dearest month to OWN was ${dearestPayment.month.slice(0, 4)}: the same ` +
        `house at ${money(dearestPayment.price)} and ${(dearestPayment.rate * 100).toFixed(2)}%, not ` +
        `${(dearestPrice.rate * 100).toFixed(2)}%. And if a recession cracks prices, rate cuts are what stop the crack.`;

  const declineCaveat =
    drops.length === 1
      ? `One decline over 10% in ${yearsOfData(rows.length, stepMonths)} years is an anecdote, not a sample. Anyone who claims to know what happens next is selling something.`
      : `${drops.length} declines over 10% in ${yearsOfData(rows.length, stepMonths)} years is not a sample you can forecast from. Anyone who claims to know what happens next is selling something.`;

  return {
    place,
    // n rows span n-1 steps. Counting the row count overstated every record by
    // one period, so "50 years" was really 49 and change.
    yearsOfData: yearsOfData(rows.length, stepMonths),
    declines: drops,
    worst,
    status,
    extremes,
    caveats: [
      declineCaveat,
      priceNotPayment,
      "You have to still have a job at the bottom. California unemployment roughly doubled last time; the people who bought the dip were the ones whose income held.",
      "Credit tightens exactly when prices fall. In 2009 private lenders went back to 20% down; FHA at 3.5% and VA at zero stayed open.",
      "In California, buying lower is permanent: Prop 13 locks your assessed value to your price and caps growth at 2%/year, so a cheaper entry keeps paying you back for as long as you own.",
    ],
  };
}
