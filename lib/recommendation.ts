/**
 * The answer to the question the page is named after.
 *
 * "Should you buy it?" used to be answered by the rent-versus-buy model alone,
 * under a subheading that opened by refusing to answer: "Not a yes or no: that
 * depends on assumptions nobody can pin down." That is true of the INVESTMENT
 * question and false of the question a reader is actually asking, which has
 * three parts and only one of them is assumption-heavy:
 *
 *   1. Will a lender give you this loan?        Not an assumption. Arithmetic.
 *   2. Do you have the cash to close?           Not an assumption. Arithmetic.
 *   3. Does owning beat renting for you?        Assumption-heavy, genuinely.
 *
 * Two of the three have hard answers, and they are the two that stop most
 * purchases. Hedging all three because the third is uncertain hands the reader
 * a shrug where a number belongs.
 *
 * So this returns a clear answer, then everything that qualifies it. The
 * caveats are not softened and are not optional: they travel with the verdict
 * as data, so the UI cannot render the answer without them.
 *
 * DELIBERATELY NOT MODELLED, because the honest version of a clear answer is
 * clear about its own edges: whether you want to live there, whether you will
 * still have the job, whether the specific house is sound, and what a competing
 * offer will do to the price. Those decide more purchases than anything here.
 */

import type { ScenarioInput, ScenarioResult } from "./types.ts";
import type { DecisionThresholds } from "./rent-vs-buy.ts";
import { savingsRace } from "./rent-vs-buy.ts";

/**
 * `no` means a gate fails that money cannot quickly fix.
 * `not-yet` means it fails on cash, which is a matter of time and is dated.
 * `conditional` means it works only if something specific is true.
 * `yes` means every gate clears on the reader's own numbers.
 */
export type Answer = "yes" | "conditional" | "not-yet" | "no";

export interface Recommendation {
  answer: Answer;
  /** One sentence. The actual answer, with the binding number in it. */
  headline: string;
  /** Why, most binding first. */
  because: string[];
  /** What would have to change. Empty when the answer is yes. */
  conditions: string[];
  /** What this answer cannot see. Never empty, never optional. */
  caveats: string[];
}

export interface SavingsPosition {
  currentSavings: number;
  monthlySavings: number;
  savingsReturn: number;
  /** Current rent and its growth, so the deposit timeline accounts for rent rising. */
  currentRent: number;
  rentGrowth: number;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number, places = 1) => `${(n * 100).toFixed(places)}%`;

export function recommend(
  input: ScenarioInput,
  result: ScenarioResult,
  decision: DecisionThresholds,
  holdYears: number,
  savings: SavingsPosition,
  homeAppreciation: number
): Recommendation {
  const q = result.qualification;
  const cashShort = result.cashToClose.total - savings.currentSavings;
  const because: string[] = [];
  const conditions: string[] = [];

  // --- gate 1: will a lender lend? -----------------------------------------
  // Hardest gate, and the only one with no workaround inside the purchase.
  if (!q.passesDti) {
    const test = q.dtiIsGuideline ? "VA's residual income test" : `a ${pct(q.dtiCeiling, 0)} debt-to-income ceiling`;
    because.push(
      `A lender will not write this loan. ${input.county} County, ${money(input.purchasePrice)}, and your income ` +
        `puts you at ${pct(q.backEndDti)} against ${test}.`
    );
    conditions.push(
      `Income of ${money(q.incomeRequiredAnnual)}/year instead of ` +
        `${money(input.household.grossAnnualIncomes.reduce((a, b) => a + b, 0))}, or less monthly debt, or a cheaper house.`
    );
    if (q.residualIncome && !q.residualIncome.passes) {
      because.push(
        `VA's residual income test is the one that decides, and this misses it by ` +
          `${money(q.residualIncome.required - q.residualIncome.available)}/month.`
      );
    }
    return {
      answer: "no",
      headline: `No, not this house at this price on this income. ${money(q.incomeRequiredAnnual)}/year would do it.`,
      because,
      conditions,
      caveats: caveatsFor(input, result),
    };
  }

  because.push(
    `The loan works. ${pct(q.backEndDti)} debt-to-income against ` +
      (q.dtiIsGuideline
        ? `VA's ${pct(q.dtiCeiling, 0)} guideline, and residual income clears by ` +
          `${money((q.residualIncome?.available ?? 0) - (q.residualIncome?.required ?? 0))}/month.`
        : `a ${pct(q.dtiCeiling, 0)} ceiling.`)
  );

  // --- gate 2: is the cash there? ------------------------------------------
  // A dated answer, because "save more" is not advice, it is a timeline.
  if (cashShort > 0) {
    const race = savingsRace({
      targetPrice: input.purchasePrice,
      downPaymentPercent: result.loan.downPaymentPercent,
      closingCostRate: result.cashToClose.estimatedClosingCosts / input.purchasePrice,
      currentSavings: savings.currentSavings,
      monthlySavings: savings.monthlySavings,
      savingsReturn: savings.savingsReturn,
      homeAppreciation,
      currentRent: savings.currentRent,
      rentGrowth: savings.rentGrowth,
    });

    because.push(
      `The cash is not there yet. Closing needs ${money(result.cashToClose.total)} and you have ` +
        `${money(savings.currentSavings)}, a gap of ${money(cashShort)}.`
    );
    const rentNote =
      savings.rentGrowth > 0
        ? ` And this counts your ${money(savings.currentRent)} rent rising ${pct(savings.rentGrowth)} a year, which eats into ` +
          `what you can put aside.`
        : "";
    conditions.push(
      race.yearsToAfford === null
        ? `At ${money(savings.monthlySavings)}/month against ${pct(homeAppreciation)} appreciation you do not close ` +
          `this gap within thirty years. The deposit target is growing by ${money(race.targetGrowsBy)}/year and your ` +
          `savings by ${money(race.savingsGrowBy)}.${rentNote}`
        : `About ${race.yearsToAfford} year${race.yearsToAfford === 1 ? "" : "s"} of saving at ` +
          `${money(savings.monthlySavings)}/month, by which point the house is ${money(race.priceThen ?? 0)} and needs ` +
          `${money(race.cashNeededThen ?? 0)} down.${rentNote}`
    );

    return {
      answer: race.yearsToAfford === null ? "no" : "not-yet",
      headline:
        race.yearsToAfford === null
          ? `Not this house. You qualify for the loan, but the deposit is moving away from you faster than you are ` +
            `saving.`
          : `Not yet, and the gap is ${money(cashShort)}. On your current saving that is about ` +
            `${race.yearsToAfford} year${race.yearsToAfford === 1 ? "" : "s"} away.`,
      because,
      conditions,
      caveats: caveatsFor(input, result),
    };
  }

  because.push(
    `The cash is there. ${money(result.cashToClose.total)} to close against ${money(savings.currentSavings)} saved.`
  );

  // --- gate 3: does owning beat renting over YOUR horizon? -----------------
  // The genuinely assumption-heavy one, so it is the only gate whose answer is
  // hedged, and the hedge names the assumption rather than gesturing at it.
  if (decision.breakevenYear === null) {
    because.push(
      `Against renting it never catches up. Over thirty years, on these assumptions, renting and investing the ` +
        `difference stays ahead.`
    );
    conditions.push(
      decision.priceNeeded !== null
        ? `A price around ${money(decision.priceNeeded)} instead of ${money(input.purchasePrice)}.`
        : `No price in the search range makes this work against your rent.`
    );
    return {
      answer: "conditional",
      headline:
        `You can buy it, but on these assumptions you should not: renting and investing the difference stays ahead ` +
        `for the whole thirty years.`,
      because,
      conditions,
      caveats: caveatsFor(input, result),
    };
  }

  if (decision.breakevenYear > holdYears) {
    because.push(
      `Against renting it takes ${decision.breakevenYear} years to come out ahead, and you said you expect to stay ` +
        `${holdYears}.`
    );
    conditions.push(`Staying ${decision.breakevenYear} years instead of ${holdYears}.`);
    if (decision.priceNeeded !== null && decision.priceNeeded < input.purchasePrice) {
      conditions.push(`Or a price around ${money(decision.priceNeeded)}, which breaks even inside your ${holdYears}.`);
    }
    return {
      answer: "conditional",
      headline:
        `Yes, if you stay ${decision.breakevenYear} years. At the ${holdYears} you expect, renting comes out ahead.`,
      because,
      conditions,
      caveats: caveatsFor(input, result),
    };
  }

  because.push(
    `Against renting it comes out ahead in year ${decision.breakevenYear}, inside the ${holdYears} you expect to stay.`
  );

  return {
    answer: "yes",
    headline:
      `Yes. You qualify, the cash is there, and it beats renting by year ${decision.breakevenYear} of the ` +
      `${holdYears} you plan to stay.`,
    because,
    conditions,
    caveats: caveatsFor(input, result),
  };
}

/**
 * What the answer cannot see, plus the specific risks on THIS scenario.
 *
 * Never empty. A clear answer earns the right to be clear by being explicit
 * about its edges, and the first three here decide more purchases than anything
 * the engine models.
 */
function caveatsFor(input: ScenarioInput, result: ScenarioResult): string[] {
  const caveats = [
    `This cannot see whether you want to live there, whether the house is sound, or whether you will still have the ` +
      `income in five years. Those decide more purchases than the arithmetic does.`,
    `The rent-versus-buy half turns on appreciation, investment return and rent growth, none of which anyone knows. ` +
      `Move those sliders and watch how far the answer travels before you trust it.`,
  ];

  // Scenario-specific risks that do not flip the answer but change what you are
  // agreeing to. Each one is already a warning elsewhere; repeating the
  // load-bearing ones here means the verdict is not read in isolation.
  const mi = result.lines.find((l) => l.key === "mortgageInsurance");
  if (input.loanType === "fha" && result.loan.downPaymentPercent < 0.1) {
    caveats.push(
      `FHA mortgage insurance at ${money(mi?.monthly ?? 0)}/month never comes off this loan. Under 10% down it runs ` +
        `for the life of it, and the only exit is refinancing out of FHA entirely.`
    );
  }
  if (result.trueMonthlyTotal > result.lenderMonthlyTotal) {
    caveats.push(
      `The lender is underwriting ${money(result.lenderMonthlyTotal)}/month. What actually leaves your account is ` +
        `${money(result.trueMonthlyTotal)}, because maintenance is real and nobody counts it.`
    );
  }
  if (input.melloRoosAnnual === 0) {
    caveats.push(
      `You have entered no Mello-Roos. If this is new construction that is probably wrong, and it is the most ` +
        `invisible cost in California. Check the title report, not the listing.`
    );
  }

  return caveats;
}
