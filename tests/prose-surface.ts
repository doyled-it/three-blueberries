/**
 * Every user-visible sentence the engine produces, for one county, collected.
 *
 * WHY THIS EXISTS. Three audits have now found the same class of defect: a
 * sentence that was true when it was written and went false when the data
 * underneath it moved. "The milder of the two declines on record" was correct
 * for San Diego and wrong in 34 counties. "The record runs from 1984" was wrong
 * in 11. "N consecutive monthly declines" described a series with no monthly
 * rows. Every one of those shipped green, because the tests asserted the WORDING
 * against itself rather than against the data.
 *
 * Registering claims by hand would just move the problem: somebody adds a
 * sentence and forgets to register it. So this walks the engine instead and
 * collects what it ACTUALLY RENDERS. A new sentence is covered the moment it
 * exists, whether or not anyone remembers it.
 *
 * `tests/prose.test.ts` runs the checks over what this returns. Anything a
 * reader can see should be reachable from here; if you add a panel and its
 * strings are not in this list, add them, because unlisted prose is unchecked
 * prose.
 */

import { evaluateScenario } from "../lib/mortgage.ts";
import { maxAffordablePrice } from "../lib/affordability.ts";
import { bridgeScenario } from "../lib/scenario-bridge.ts";
import { recommend } from "../lib/recommendation.ts";
import { compareRentVsBuy, decide, assumptionSets, RENT_VS_BUY_CAVEAT } from "../lib/rent-vs-buy.ts";
import { crashPresets, currentStatus, historicalContext, evaluateWaiting } from "../lib/history.ts";
import { compareToCohort, refinanceOpportunity } from "../lib/cohort.ts";
import { crashSignals, leadingIndicators, worstTimeToBuy } from "../lib/signals.ts";
import { buyingPowerCaveat, buyingPowerVerdict } from "../lib/buying-power.ts";
import { payTrap, WHERE_IT_WORKS_CAVEAT } from "../lib/where-it-works.ts";
import { countyScope } from "../lib/county-scope.ts";
import { fairPlanRisk } from "../lib/insurance.ts";
import { countyTaxRate } from "../lib/data/ca-property.ts";
import type { CaCounty } from "../lib/data/ca-loan-limits.ts";
import type { LoanType, ScenarioInput } from "../lib/types.ts";

/** One rendered string, plus enough context to find it when it fails. */
export interface ProseItem {
  /** Where it came from, e.g. "signals.readings[supply].reading". */
  path: string;
  text: string;
}

export interface SurfaceOptions {
  loanType?: LoanType;
  purchasePrice?: number;
}

function scenarioFor(county: CaCounty, options: SurfaceOptions = {}): ScenarioInput {
  const loanType = options.loanType ?? "conventional";
  return {
    purchasePrice: options.purchasePrice ?? 750_000,
    downPayment: loanType === "va" ? { kind: "amount", value: 0 } : { kind: "percent", value: 0.2 },
    loanType,
    termYears: 30,
    interestRate: 0.0666,
    creditScore: 740,
    county,
    claimHomeownersExemption: true,
    hoaMonthly: 0,
    melloRoosAnnual: 0,
    squareFeet: 1500,
    va: { firstUse: true, disabilityExempt: false, financeFundingFee: true },
    fha: { financeUpfrontMip: true },
    household: { grossAnnualIncomes: [180_000], monthlyDebts: 500, size: 2 },
  };
}

/**
 * Collect every sentence a reader of this county's page could see.
 *
 * Deliberately runs the real engine end to end rather than reading source, so
 * the strings tested are the strings rendered, template interpolation and all.
 */
export function proseFor(county: CaCounty, options: SurfaceOptions = {}): ProseItem[] {
  const out: ProseItem[] = [];
  const push = (path: string, text: string | null | undefined) => {
    if (typeof text === "string" && text.trim()) out.push({ path, text });
  };

  const input = scenarioFor(county, options);
  const result = evaluateScenario(input);

  // --- the payment breakdown ---
  for (const line of result.lines) {
    push(`lines[${line.key}].basis`, line.basis);
    push(`lines[${line.key}].warning`, line.warning);
  }
  for (const line of result.cashToClose.lines) {
    push(`cashToClose[${line.key}].basis`, line.basis);
    push(`cashToClose[${line.key}].warning`, line.warning);
  }
  result.warnings.forEach((w, i) => push(`warnings[${i}]`, w));

  // --- qualification ---
  result.qualification.notes.forEach((n, i) => push(`qualification.notes[${i}]`, n));
  push("qualification.residualIncome.explanation", result.qualification.residualIncome?.explanation);

  const afford = maxAffordablePrice(input);
  afford.warnings.forEach((w, i) => push(`affordability.warnings[${i}]`, w));

  // --- insurance ---
  const risk = fairPlanRisk(county);
  push("insurance.fairPlan.warning", risk?.warning);
  push("insurance.fairPlan.level", risk?.level);

  // --- rent versus buy ---
  const bridge = bridgeScenario(input, result, {
    monthlyRent: 2_400,
    homeAppreciation: 0.0543,
    rentGrowth: 0.035,
    investmentReturn: 0.1,
  });
  const rvb = compareRentVsBuy(bridge.itemised);
  push("rentVsBuy.verdict", rvb.verdict);
  push("rentVsBuy.caveat", RENT_VS_BUY_CAVEAT);
  for (const set of assumptionSets(county)) push(`assumptionSets[${set.id}].basis`, set.basis);

  const d = decide({
    base: bridge.base,
    costs: bridge.costs,
    price: input.purchasePrice,
    holdYears: 10,
    downPercent: bridge.downPercent,
    closingCostRate: bridge.closingCostRate,
  });
  push("decide.verdict", d.verdict);
  for (const lever of d.levers) {
    push(`decide.levers[${lever.key}].note`, lever.note);
    push(`decide.levers[${lever.key}].needed`, lever.needed);
  }

  // The recommendation, which is the panel's actual answer.
  const rec = recommend(input, result, d, 10, {
    currentSavings: 250_000,
    monthlySavings: 2_000,
    savingsReturn: 0.07,
    currentRent: 2_400,
    rentGrowth: 0.035,
  }, 0.0543);
  push("recommendation.headline", rec.headline);
  rec.because.forEach((b, i) => push(`recommendation.because[${i}]`, b));
  rec.conditions.forEach((c, i) => push(`recommendation.conditions[${i}]`, c));
  rec.caveats.forEach((c, i) => push(`recommendation.caveats[${i}]`, c));

  // --- history and the waiting question ---
  const ctx = historicalContext(county);
  ctx.caveats.forEach((c, i) => push(`historicalContext.caveats[${i}]`, c));
  for (const preset of crashPresets(county)) {
    push(`crashPresets[${preset.id}].label`, preset.label);
    push(`crashPresets[${preset.id}].basis`, preset.basis);
  }
  const status = currentStatus(36, county);
  push("currentStatus.periodLabel", status.periodLabel);

  const waiting = evaluateWaiting({
    priceNow: input.purchasePrice,
    rateNow: input.interestRate,
    downPercent: 0.2,
    crashDepthPercent: 20,
    monthsToBottom: 36,
    rateAtBottom: 0.055,
    monthlyRent: 2_400,
    monthlySavings: 1_000,
    propertyTaxRate: countyTaxRate(county),
  });
  push("evaluateWaiting.verdict", waiting.verdict);

  // --- the cohort panel ---
  const purchaseMonth = "2015-06";
  const refi = refinanceOpportunity(purchaseMonth);
  const cohort = compareToCohort({
    county,
    currentPrice: input.purchasePrice,
    currentRate: input.interestRate,
    downPercent: 0.2,
    propertyTaxRate: countyTaxRate(county),
    purchaseMonth,
    refinancedRate: refi?.rate,
    refinanceMonth: refi?.month,
  });
  // The cohort panel has no prose of its own; the browser composes its sentence
  // from these figures. Nothing to collect, so nothing is claimed here.
  void cohort;

  // --- crash signals and the correlations ---
  const signals = crashSignals(county);
  for (const reading of signals.readings) {
    push(`signals.readings[${reading.key}].reading`, reading.reading);
    push(`signals.readings[${reading.key}].caveat`, reading.caveat);
    push(`signals.readings[${reading.key}].label`, reading.label);
  }
  push("signals.summary", signals.summary);
  signals.caveats.forEach((c, i) => push(`signals.caveats[${i}]`, c));
  for (const corr of leadingIndicators(24, county)) push(`leadingIndicators[${corr.key}].label`, corr.label);
  push("worstTimeToBuy.answer", worstTimeToBuy(county).answer);

  // --- the thesis panels ---
  const power = buyingPowerVerdict(county);
  push("buyingPower.headline", power.headline);
  push("buyingPower.blueberries", power.blueberries);
  push("buyingPower.caveat", buyingPowerCaveat(county));

  // payTrap is statewide rather than per county, but it renders on every
  // county's page, so it is checked on every county's page.
  push("payTrap.headline", payTrap().headline);
  push("whereItWorks.caveat", WHERE_IT_WORKS_CAVEAT);

  // --- what the county selector does and does not change ---
  push("countyScope.note", countyScope(county).note);

  return out;
}
