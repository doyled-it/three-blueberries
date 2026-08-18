/**
 * The engine, run backwards.
 *
 * "How much do I need to make to buy a $900,000 house" is answered directly by
 * evaluateScenario, it falls out of the DTI ceiling. The harder and more useful
 * question is the other one: given what I actually make, what can I actually buy?
 *
 * That one can't be solved in closed form. Price feeds back into property tax,
 * insurance, PMI band, and whether the loan crosses into jumbo, so we search.
 */

import { evaluateScenario } from "./mortgage.ts";
import type { ScenarioInput, ScenarioResult } from "./types.ts";

export interface AffordabilityResult {
  /** The most expensive house that still clears every constraint. */
  maxPurchasePrice: number;
  /** The full evaluated scenario at that price. */
  scenario: ScenarioResult;
  /** Which constraint stopped you from affording more. */
  bindingConstraint: "dti" | "residual-income" | "fha-limit" | "none";
  /** Cash you need on hand at that price. */
  cashRequired: number;
  /**
   * The down payment as a share of the MAX price, not of the price on the form.
   * The search holds the deposit fixed and raises the price, so the deposit
   * quietly thins: $180,000 is 20% of $900,000 and 14% of $1.3M, and at 14% the
   * answer carries PMI that the form's scenario did not. The panel says so now.
   */
  downPercent: number;
  /**
   * Warnings from the scenario AT THE MAX PRICE, which are not the same as the
   * warnings for the price on the form. These used to be computed and discarded,
   * so the known jumbo limitation, the FHA MIP-for-life rule and the county tax
   * fallback were all invisible on the one number people screenshot.
   */
  warnings: readonly string[];
}

function passes(result: ScenarioResult): boolean {
  if (!result.qualification.passesDti) return false;
  if (result.qualification.residualIncome && !result.qualification.residualIncome.passes) return false;
  // FHA's county limit is a HARD stop, not a warning. Over it the loan is not an
  // FHA loan at all, so a search that only tested income would happily report a
  // price the program cannot finance: a Fresno household on $200,000 was told
  // $882,000 when FHA caps their loan at $541,287, about $561,000 of house.
  //
  // The conforming limit is deliberately NOT treated this way. Exceeding it
  // makes a loan a jumbo, which is a worse rate and stricter underwriting, not
  // an impossibility.
  if (result.input.loanType === "fha" && result.loan.exceedsFhaLimit) return false;
  return true;
}

/**
 * Binary search for the highest purchase price that still qualifies.
 *
 * Every constraint is monotonic in price. A more expensive house is never easier
 * to afford, so bisection is safe. Over the default $50k-$10M range at $500
 * tolerance that is log2(9,950,000/500), about 15 steps, not the 25 this comment
 * used to claim.
 *
 * KNOWN LIMITATION, and it is now stated in the UI rather than only here: the
 * search uses the conforming rate at every price, so an answer above the county
 * conforming limit is quoted at a rate the borrower could not actually get.
 */
export function maxAffordablePrice(
  base: ScenarioInput,
  options: { floor?: number; ceiling?: number; tolerance?: number } = {}
): AffordabilityResult {
  const floor = options.floor ?? 50_000;
  const ceiling = options.ceiling ?? 10_000_000;
  const tolerance = options.tolerance ?? 500;

  const at = (price: number) => evaluateScenario({ ...base, purchasePrice: price });

  // If even the floor fails, there is no answer to give, report it honestly
  // rather than returning a price the household cannot carry.
  const atFloor = at(floor);
  if (!passes(atFloor)) {
    return {
      maxPurchasePrice: 0,
      scenario: atFloor,
      bindingConstraint: bindingFor(atFloor),
      cashRequired: atFloor.cashToClose.total,
      downPercent: atFloor.loan.downPaymentPercent,
      warnings: atFloor.warnings,
    };
  }

  let lo = floor;
  let hi = ceiling;

  // Only search below the ceiling if the ceiling itself fails.
  if (passes(at(hi))) {
    const result = at(hi);
    return {
      maxPurchasePrice: hi,
      scenario: result,
      bindingConstraint: "none",
      cashRequired: result.cashToClose.total,
      downPercent: result.loan.downPaymentPercent,
      warnings: withSearchCaveats(result),
    };
  }

  while (hi - lo > tolerance) {
    const mid = (lo + hi) / 2;
    if (passes(at(mid))) lo = mid;
    else hi = mid;
  }

  // Round down to a clean number, false precision here is worse than useless.
  const price = Math.floor(lo / 1000) * 1000;
  const scenario = at(price);

  // Identify what actually stopped us by probing just above the boundary.
  const justAbove = at(price + tolerance * 4);
  const bindingConstraint = bindingFor(justAbove);

  return {
    maxPurchasePrice: price,
    scenario,
    bindingConstraint,
    cashRequired: scenario.cashToClose.total,
    downPercent: scenario.loan.downPaymentPercent,
    warnings: withSearchCaveats(scenario),
  };
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Which test a failing scenario failed. Order matters: the FHA limit is checked
 * first because it is absolute, where the income tests are about this household
 * and could be fixed by earning more or owing less.
 */
function bindingFor(result: ScenarioResult): AffordabilityResult["bindingConstraint"] {
  if (result.input.loanType === "fha" && result.loan.exceedsFhaLimit) return "fha-limit";
  if (!result.qualification.passesDti) return "dti";
  if (result.qualification.residualIncome?.passes === false) return "residual-income";
  return "none";
}

/**
 * The scenario's own warnings, plus the two the SEARCH introduces and the
 * scenario cannot know about: the jumbo rate limitation, and the deposit
 * thinning below 20% because the price moved and the cash did not.
 */
function withSearchCaveats(scenario: ScenarioResult): readonly string[] {
  const out = [...scenario.warnings];
  const down = scenario.loan.downPaymentPercent;
  const downPayment = scenario.loan.downPaymentAmount;

  if (scenario.input.loanType === "fha" && scenario.loan.baseLoanAmount >= scenario.loan.fhaLimit - 1000) {
    out.push(
      `This answer is capped by FHA's ${money(scenario.loan.fhaLimit)} limit for ${scenario.input.county} County, not by what ` +
        `you earn. A conventional loan would go higher on the same income, at the cost of a bigger deposit.`
    );
  }

  if (scenario.loan.exceedsConformingLimit) {
    out.push(
      `This answer is above ${scenario.input.county} County's ${money(scenario.loan.conformingLimit)} conforming limit, and the search ` +
        `priced every step at the conforming rate. A real jumbo quote runs higher, so treat this as an upper bound. The honest max ` +
        `is at or below it.`
    );
  }

  if (scenario.input.loanType === "conventional" && down < 0.2 && down > 0) {
    out.push(
      `At this price your ${money(downPayment)} deposit is ${(down * 100).toFixed(1)}% down, not 20%. The search raises the price ` +
        `but not the cash, so the answer carries PMI that a 20%-down purchase would not.`
    );
  }

  return out;
}

/**
 * Gross annual household income needed to buy at a given price.
 * A thin wrapper, but it's the question people actually type into Google.
 */
export function incomeRequiredFor(input: ScenarioInput): { annual: number; monthly: number; scenario: ScenarioResult } {
  const scenario = evaluateScenario(input);
  return {
    annual: scenario.qualification.incomeRequiredAnnual,
    monthly: scenario.qualification.incomeRequiredAnnual / 12,
    scenario,
  };
}

/**
 * How the answer moves as one input moves, for showing the shape of a
 * tradeoff rather than a single number. Useful for "what if rates drop half a
 * point" and "what does another 5% down actually buy me."
 */
export function sweep<K extends keyof ScenarioInput>(
  base: ScenarioInput,
  key: K,
  values: ReadonlyArray<ScenarioInput[K]>
): Array<{ value: ScenarioInput[K]; result: ScenarioResult }> {
  return values.map((value) => ({ value, result: evaluateScenario({ ...base, [key]: value }) }));
}
