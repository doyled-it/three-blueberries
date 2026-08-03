/**
 * One place that turns an itemised scenario into rent-vs-buy inputs.
 *
 * This module exists because of a specific failure. The itemised payment panel
 * and the price sweeps were built from the same scenario by two separate blocks
 * of code in the browser layer, and they drifted: mortgage insurance was added
 * to one and not the other, closing costs were real on one side and a flat 2.5%
 * on the other, and the financed VA funding fee was in one loan balance and not
 * the other. The result was a page that told you a house passed and failed at
 * the same time, in two cards a few inches apart, with every test still green
 * because the tests pinned the engine and nothing pinned the wiring.
 *
 * So the wiring lives here, in one function, with a test that asserts the two
 * paths agree to the dollar at the user's own price. Add a cost to one and the
 * test fails until it is in both.
 *
 * The scaling rates are derived as RESIDUALS of the real itemisation rather than
 * recomputed from first principles. The homeowners' exemption, for instance, is
 * a fixed dollar credit against the tax bill, so it belongs in the fixed term,
 * and deriving it that way is what makes the agreement exact instead of close.
 */

import { computeMortgageInsurance } from "./mortgage.ts";
import { countyTaxRate } from "./data/ca-property.ts";
import { saltCap, standardDeductionFor } from "./data/federal-tax.ts";
import { DEFAULT_MARGINAL_TAX_RATE, type RentVsBuyInput, type ScalingCosts, type SweepBase } from "./rent-vs-buy.ts";
import type { ScenarioInput, ScenarioResult } from "./types.ts";

/** The lines a lender escrows or bills monthly, excluding mortgage insurance. */
const CARRYING_KEYS = ["propertyTax", "homeownersInsurance", "hoa", "melloRoos"];

/**
 * Estimated state income tax as a share of gross, for the SALT bucket.
 *
 * California's brackets top out at 13.3%, but nobody pays the top rate on every
 * dollar. 7% is roughly the effective state rate for a household in the low
 * $200,000s. It only matters here through the SALT cap, which most California
 * buyers hit on property tax alone.
 */
export const ASSUMED_STATE_TAX_SHARE = 0.07;

export interface MarketAssumptions {
  monthlyRent: number;
  homeAppreciation: number;
  rentGrowth: number;
  investmentReturn: number;
  /** Income from a second unit on the property. Zero when the buyer has ruled it out. */
  monthlyRentalIncome?: number;
  propertyTaxGrowth?: number;
  sellingCostRate?: number;
  marginalTaxRate?: number;
  years?: number;
}

export interface ScenarioBridge {
  /** Everything that does not depend on price, for the sweeps. */
  base: SweepBase;
  /** The price-dependent rates, for the sweeps. */
  costs: ScalingCosts;
  downPercent: number;
  closingCostRate: number;
  /** The same comparison run on the real itemised scenario, at the user's own price. */
  itemised: RentVsBuyInput;
}

export function bridgeScenario(
  input: ScenarioInput,
  result: ScenarioResult,
  market: MarketAssumptions
): ScenarioBridge {
  const price = input.purchasePrice;
  const down = result.loan.downPaymentAmount;
  const downPercent = price > 0 ? Math.min(down / price, 1) : 0;

  const carrying = result.lines
    .filter((l) => CARRYING_KEYS.includes(l.key))
    .reduce((sum, l) => sum + l.monthly, 0);
  const maintenance = result.lines.find((l) => l.key === "maintenanceReserve")?.monthly ?? 0;
  const mi = result.lines.find((l) => l.key === "mortgageInsurance")?.monthly ?? 0;

  const closingCosts = Math.max(result.cashToClose.total - down, 0);
  const closingCostRate = price > 0 ? closingCosts / price : 0;

  const baseLoan = result.loan.baseLoanAmount;
  const totalLoan = result.loan.totalLoanAmount;

  const carryingRate = input.propertyTaxRate ?? countyTaxRate(input.county);
  const incomes = input.household.grossAnnualIncomes;
  const grossIncome = incomes.reduce((a, b) => a + b, 0);

  const base: SweepBase = {
    interestRate: input.interestRate,
    termYears: input.termYears,
    monthlyRent: market.monthlyRent,
    homeAppreciation: market.homeAppreciation,
    rentGrowth: market.rentGrowth,
    investmentReturn: market.investmentReturn,
    monthlyRentalIncome: market.monthlyRentalIncome ?? 0,
    propertyTaxGrowth: market.propertyTaxGrowth ?? 0.02,
    sellingCostRate: market.sellingCostRate ?? 0.06,
    marginalTaxRate: market.marginalTaxRate ?? DEFAULT_MARGINAL_TAX_RATE,
    // State income tax plus property tax: the deductions already in play before
    // any mortgage interest counts. Capped, and the cap itself phases out.
    otherItemizedDeductions: Math.min(
      grossIncome * ASSUMED_STATE_TAX_SHARE + price * carryingRate,
      saltCap(grossIncome)
    ),
    // Two earners have to clear twice the floor before itemising is worth
    // anything, so a two-income household often gets LESS mortgage subsidy.
    standardDeduction: standardDeductionFor(incomes),
    ...(market.years ? { years: market.years } : {}),
  };

  const costs: ScalingCosts = {
    carryingRate,
    // Derived, not assumed: whatever the panel actually charges for upkeep.
    maintenanceRate: price > 0 ? (maintenance * 12) / price : (input.maintenanceRate ?? 0.01),
    // The residual: insurance, HOA, Mello-Roos, and the fixed dollar effect of
    // the homeowners' exemption on the tax line.
    fixedMonthly: carrying - (price * carryingRate) / 12,
    mortgageInsuranceRate: totalLoan > 0 ? (mi * 12) / totalLoan : 0,
    mortgageInsuranceEndsMonth: mortgageInsuranceEndsMonth(input, result),
    financedFeeRate: baseLoan > 0 ? result.loan.financedUpfrontFee / baseLoan : 0,
  };

  const itemised: RentVsBuyInput = {
    ...base,
    purchasePrice: price,
    downPaymentAmount: down,
    loanAmount: totalLoan,
    closingCosts,
    monthlyCarryingCosts: carrying,
    monthlyMaintenance: maintenance,
    monthlyMortgageInsurance: mi,
    mortgageInsuranceEndsMonth: costs.mortgageInsuranceEndsMonth,
  };

  return { base, costs, downPercent, closingCostRate, itemised };
}

/**
 * When mortgage insurance stops, in months from closing.
 *
 * VA has none at all. FHA under 10% down runs for the life of the loan, which is
 * `null`, not a large number, because the model has to keep charging it forever.
 */
export function mortgageInsuranceEndsMonth(input: ScenarioInput, result: ScenarioResult): number | null {
  if (input.loanType === "va") return 0;
  const mi = computeMortgageInsurance(input, result.loan);
  return mi ? mi.endsAfterMonths : 0;
}
