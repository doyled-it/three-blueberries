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
  bindingConstraint: "dti" | "residual-income" | "none";
  /** Cash you need on hand at that price. */
  cashRequired: number;
}

function passes(result: ScenarioResult): boolean {
  if (!result.qualification.passesDti) return false;
  if (result.qualification.residualIncome && !result.qualification.residualIncome.passes) return false;
  return true;
}

/**
 * Binary search for the highest purchase price that still qualifies.
 *
 * Every constraint is monotonic in price. A more expensive house is never
 * easier to afford, so bisection is safe and converges in about 25 steps.
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
      bindingConstraint: atFloor.qualification.passesDti ? "residual-income" : "dti",
      cashRequired: atFloor.cashToClose.total,
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
  let bindingConstraint: AffordabilityResult["bindingConstraint"] = "dti";
  if (justAbove.qualification.passesDti && justAbove.qualification.residualIncome?.passes === false) {
    bindingConstraint = "residual-income";
  }

  return { maxPurchasePrice: price, scenario, bindingConstraint, cashRequired: scenario.cashToClose.total };
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
