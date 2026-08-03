/**
 * The engine.
 *
 * Takes a purchase scenario and returns every dollar it costs, itemized, with
 * a citation and a plain-English basis on every single line.
 *
 * Two totals come out of this, and the difference between them is the entire
 * reason the project exists:
 *
 *   lenderMonthlyTotal, what underwriting counts and what a mortgage
 *                        calculator shows you.
 *   trueMonthlyTotal, what actually leaves your bank account.
 */

import { balanceAfter, monthLtvReaches, monthlyPayment, totalInterest } from "./amortization.ts";
import { conformingLimitFor, CONFORMING_BASELINE } from "./data/ca-loan-limits.ts";
import {
  CA_HOMEOWNERS_EXEMPTION,
  DEFAULT_CLOSING_COST_RATE,
  DEFAULT_MAINTENANCE_RATE,
  IMPOUND_MONTHS_INSURANCE,
  IMPOUND_MONTHS_TAXES,
  countyTaxRate,
  estimateInsuranceAnnual,
  hasCountySpecificTaxRate,
} from "./data/ca-property.ts";
import {
  DTI_CEILINGS,
  FHA_UPFRONT_MIP_RATE,
  PMI_AUTO_TERMINATION_LTV,
  PMI_REQUEST_CANCELLATION_LTV,
  VA_UTILITY_PER_SQFT,
  fhaAnnualMipRate,
  fhaMipDurationMonths,
  pmiAnnualRate,
  vaFundingFeeRate,
  vaResidualIncomeRequired,
} from "./data/programs.ts";
import type {
  CashToClose,
  LineItem,
  LoanFacts,
  MortgageInsuranceResult,
  Qualification,
  ScenarioInput,
  ScenarioResult,
} from "./types.ts";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number, places = 2) => `${(n * 100).toFixed(places)}%`;

// ---------------------------------------------------------------------------
// Loan shape
// ---------------------------------------------------------------------------

export function deriveLoanFacts(input: ScenarioInput): LoanFacts {
  const price = input.purchasePrice;

  const downPaymentAmount =
    input.downPayment.kind === "percent" ? price * input.downPayment.value : Math.min(input.downPayment.value, price);
  const downPaymentPercent = price > 0 ? downPaymentAmount / price : 0;
  const baseLoanAmount = Math.max(price - downPaymentAmount, 0);

  // Upfront program fees, which may be financed into the balance or paid in cash.
  let financedUpfrontFee = 0;
  let upfrontFeePaidInCash = 0;

  if (input.loanType === "va" && input.va) {
    const feeRate = vaFundingFeeRate(downPaymentPercent, input.va.firstUse, input.va.disabilityExempt);
    const fee = baseLoanAmount * feeRate;
    if (input.va.financeFundingFee) financedUpfrontFee = fee;
    else upfrontFeePaidInCash = fee;
  }

  if (input.loanType === "fha") {
    const fee = baseLoanAmount * FHA_UPFRONT_MIP_RATE;
    // Financing UFMIP is the overwhelming default; paying cash is opt-in.
    if (input.fha?.financeUpfrontMip === false) upfrontFeePaidInCash = fee;
    else financedUpfrontFee = fee;
  }

  const conformingLimit = conformingLimitFor(input.county);

  return {
    basePrice: price,
    downPaymentAmount,
    downPaymentPercent,
    baseLoanAmount,
    totalLoanAmount: baseLoanAmount + financedUpfrontFee,
    financedUpfrontFee,
    upfrontFeePaidInCash,
    // LTV is measured on the base loan against purchase price, financed upfront
    // fees don't count against you for mortgage insurance pricing.
    ltv: price > 0 ? baseLoanAmount / price : 0,
    conformingLimit,
    exceedsConformingLimit: baseLoanAmount > conformingLimit,
  };
}

// ---------------------------------------------------------------------------
// Mortgage insurance
// ---------------------------------------------------------------------------

export function computeMortgageInsurance(input: ScenarioInput, loan: LoanFacts): MortgageInsuranceResult | null {
  if (input.loanType === "va") return null;

  if (input.loanType === "fha") {
    const rate = fhaAnnualMipRate({
      baseLoanAmount: loan.baseLoanAmount,
      ltv: loan.ltv,
      termYears: input.termYears,
      conformingBaseline: CONFORMING_BASELINE,
    });
    const durationMonths = fhaMipDurationMonths(loan.ltv);
    return {
      monthly: (loan.totalLoanAmount * rate) / 12,
      annualRate: rate,
      endsAfterMonths: durationMonths,
      explanation:
        durationMonths === null
          ? `FHA annual MIP of ${pct(rate)} for the life of the loan. Because you put down less than 10%, there is no equity level that removes it. The only way out is refinancing off FHA entirely.`
          : `FHA annual MIP of ${pct(rate)}, payable for 11 years because you put down 10% or more.`,
      sourceIds: ["hud-ml-2023-05"],
    };
  }

  // Conventional and jumbo
  const rate = pmiAnnualRate(loan.ltv, input.creditScore);
  if (rate === 0) return null;

  const endsAfterMonths = monthLtvReaches({
    principal: loan.totalLoanAmount,
    originalValue: input.purchasePrice,
    annualRate: input.interestRate,
    termYears: input.termYears,
    targetLtv: PMI_AUTO_TERMINATION_LTV,
  });

  const requestAt = monthLtvReaches({
    principal: loan.totalLoanAmount,
    originalValue: input.purchasePrice,
    annualRate: input.interestRate,
    termYears: input.termYears,
    targetLtv: PMI_REQUEST_CANCELLATION_LTV,
  });

  const years = (m: number) => (m / 12).toFixed(1);

  return {
    monthly: (loan.totalLoanAmount * rate) / 12,
    annualRate: rate,
    endsAfterMonths,
    explanation:
      `PMI at an estimated ${pct(rate)}/year, based on ${pct(loan.ltv, 1)} LTV and a ${input.creditScore} credit score. ` +
      (requestAt !== null
        ? `You can request cancellation at 80% LTV around month ${requestAt} (${years(requestAt)} years). `
        : "") +
      (endsAfterMonths !== null
        ? `It terminates automatically at 78% LTV around month ${endsAfterMonths} (${years(endsAfterMonths)} years) on the original schedule, appreciation does not count.`
        : "It does not reach the 78% automatic termination point within the loan term."),
    sourceIds: ["pmi-rate-bands", "pmi-cancellation"],
  };
}

// ---------------------------------------------------------------------------
// Recurring cost lines
// ---------------------------------------------------------------------------

function buildLines(input: ScenarioInput, loan: LoanFacts, mi: MortgageInsuranceResult | null): LineItem[] {
  const lines: LineItem[] = [];

  // --- Principal & interest -------------------------------------------------
  const pi = monthlyPayment(loan.totalLoanAmount, input.interestRate, input.termYears);
  const lifetimeInterest = totalInterest(loan.totalLoanAmount, input.interestRate, input.termYears);
  lines.push({
    key: "principalAndInterest",
    label: "Principal & interest",
    monthly: pi,
    annual: pi * 12,
    basis:
      `${money(loan.totalLoanAmount)} borrowed at ${pct(input.interestRate, 3)} over ${input.termYears} years. ` +
      `Total interest across the full term: ${money(lifetimeInterest)}.`,
    confidence: "market",
    sourceIds: ["freddie-pmms"],
  });

  // --- Property tax ---------------------------------------------------------
  const rate = input.propertyTaxRate ?? countyTaxRate(input.county);
  const usingCountyDefault = input.propertyTaxRate === undefined;
  const exemption = input.claimHomeownersExemption ? CA_HOMEOWNERS_EXEMPTION : 0;
  // Prop 13: buying resets the assessed value to the purchase price.
  const taxableValue = Math.max(input.purchasePrice - exemption, 0);
  const taxAnnual = taxableValue * rate;

  lines.push({
    key: "propertyTax",
    label: "Property tax",
    monthly: taxAnnual / 12,
    annual: taxAnnual,
    basis:
      `Prop 13 reassesses to your purchase price when you buy, so the assessed value is ${money(input.purchasePrice)}` +
      (exemption ? ` less the ${money(exemption)} homeowners' exemption` : "") +
      `, taxed at ${pct(rate)}. That rate is the 1% statutory base plus ${pct(rate - 0.01)} in voter-approved bonds and local assessments.`,
    confidence: usingCountyDefault ? "estimated" : "user",
    sourceIds: ["prop-13", "ca-county-tax-rates", ...(exemption ? (["ca-homeowners-exemption"] as const) : [])],
    warning: usingCountyDefault
      ? `Typical rate for ${input.county} County, not your rate. Rates vary by tax rate area within a county. Check your county assessor's parcel lookup.`
      : undefined,
  });

  // --- Homeowners insurance -------------------------------------------------
  const insuranceAnnual = input.insuranceAnnual ?? estimateInsuranceAnnual(input.purchasePrice);
  const insuranceEstimated = input.insuranceAnnual === undefined;
  lines.push({
    key: "homeownersInsurance",
    label: "Homeowners insurance",
    monthly: insuranceAnnual / 12,
    annual: insuranceAnnual,
    basis: insuranceEstimated
      ? `Placeholder for a standard HO-3 policy in a non-wildfire California ZIP, scaled to a ${money(input.purchasePrice)} home.`
      : `Your quoted annual premium of ${money(insuranceAnnual)}.`,
    confidence: insuranceEstimated ? "estimated" : "user",
    sourceIds: ["ca-insurance-market"],
    warning: insuranceEstimated
      ? "The least reliable number on this page. California's market is in crisis: brush-adjacent homes quote $5,000-$25,000+, and FAIR Plan policies average around $3,000-$3,200. Get a real quote before you write an offer."
      : undefined,
  });

  // --- Mortgage insurance ---------------------------------------------------
  if (mi) {
    lines.push({
      key: "mortgageInsurance",
      label: input.loanType === "fha" ? "FHA mortgage insurance (MIP)" : "Mortgage insurance (PMI)",
      monthly: mi.monthly,
      annual: mi.monthly * 12,
      basis: mi.explanation,
      confidence: input.loanType === "fha" ? "published" : "estimated",
      sourceIds: mi.sourceIds,
      warning:
        input.loanType === "fha" && mi.endsAfterMonths === null
          ? "This never goes away, over 30 years it's the largest avoidable cost of an FHA loan."
          : undefined,
    });
  } else if (input.loanType === "va") {
    lines.push({
      key: "mortgageInsurance",
      label: "Mortgage insurance",
      monthly: 0,
      annual: 0,
      basis:
        "VA carries no monthly mortgage insurance at any down payment, including zero. The benefit's biggest advantage.",
      confidence: "statutory",
      sourceIds: ["va-funding-fee"],
    });
  }

  // --- HOA ------------------------------------------------------------------
  if (input.hoaMonthly > 0) {
    lines.push({
      key: "hoa",
      label: "HOA dues",
      monthly: input.hoaMonthly,
      annual: input.hoaMonthly * 12,
      basis: "As entered. Lenders count HOA dues fully against your DTI.",
      confidence: "user",
      sourceIds: ["fannie-b3-6-02"],
    });
  }

  // --- Mello-Roos -----------------------------------------------------------
  lines.push({
    key: "melloRoos",
    label: "Mello-Roos / special assessments",
    monthly: input.melloRoosAnnual / 12,
    annual: input.melloRoosAnnual,
    basis:
      input.melloRoosAnnual > 0
        ? `${money(input.melloRoosAnnual)}/year in CFD special tax, as entered.`
        : "Entered as zero. Verify it, CFDs don't show on listing sites and are common in anything built after ~1982.",
    confidence: "user",
    sourceIds: ["mello-roos"],
    warning:
      input.melloRoosAnnual === 0
        ? "Unverified. Mello-Roos runs from a few hundred to $10,000+/year and is invisible on Zillow. The title report has the real number."
        : undefined,
  });

  // --- Maintenance reserve (true cost only, never counted by a lender) -------
  const maintenanceRate = input.maintenanceRate ?? DEFAULT_MAINTENANCE_RATE;
  const maintenanceAnnual = input.purchasePrice * maintenanceRate;
  lines.push({
    key: "maintenanceReserve",
    label: "Maintenance reserve",
    monthly: maintenanceAnnual / 12,
    annual: maintenanceAnnual,
    basis: `${pct(maintenanceRate, 1)} of purchase price per year, the standard planning rule. No lender counts this and no calculator shows it, but the roof still ages.`,
    confidence: "estimated",
    sourceIds: ["maintenance-reserve"],
  });

  return lines;
}

/** Lines a lender counts toward your housing payment. Maintenance is deliberately excluded. */
const LENDER_COUNTED_KEYS = new Set([
  "principalAndInterest",
  "propertyTax",
  "homeownersInsurance",
  "mortgageInsurance",
  "hoa",
  "melloRoos",
]);

// ---------------------------------------------------------------------------
// Cash to close
// ---------------------------------------------------------------------------

function computeCashToClose(input: ScenarioInput, loan: LoanFacts, lines: LineItem[]): CashToClose {
  const taxLine = lines.find((l) => l.key === "propertyTax")!;
  const insuranceLine = lines.find((l) => l.key === "homeownersInsurance")!;

  const closingCosts = input.purchasePrice * DEFAULT_CLOSING_COST_RATE;
  const impounds = taxLine.monthly * IMPOUND_MONTHS_TAXES + insuranceLine.monthly * IMPOUND_MONTHS_INSURANCE;

  const cashLines: LineItem[] = [
    {
      key: "downPayment",
      label: "Down payment",
      monthly: 0,
      annual: loan.downPaymentAmount,
      basis: `${pct(loan.downPaymentPercent, 1)} of ${money(input.purchasePrice)}.`,
      confidence: "user",
      sourceIds: [],
    },
    {
      key: "closingCosts",
      label: "Closing costs",
      monthly: 0,
      annual: closingCosts,
      basis: `Estimated at ${pct(DEFAULT_CLOSING_COST_RATE, 1)} of purchase price: lender fees, appraisal, title, and the buyer's share of escrow.`,
      confidence: "estimated",
      sourceIds: ["ca-closing-costs"],
      warning: "CA buyers typically land between 2% and 5%. Your Loan Estimate is the number that counts.",
    },
    {
      key: "prepaidsAndImpounds",
      label: "Prepaids & impound seeding",
      monthly: 0,
      annual: impounds,
      basis: `About ${IMPOUND_MONTHS_TAXES} months of property tax and ${IMPOUND_MONTHS_INSURANCE} months of insurance collected up front to open the escrow account.`,
      confidence: "estimated",
      sourceIds: ["ca-closing-costs"],
    },
  ];

  if (loan.upfrontFeePaidInCash > 0) {
    cashLines.push({
      key: "upfrontFee",
      label: input.loanType === "va" ? "VA funding fee (paid in cash)" : "FHA upfront MIP (paid in cash)",
      monthly: 0,
      annual: loan.upfrontFeePaidInCash,
      basis: "Paid at closing rather than financed into the loan.",
      confidence: "statutory",
      sourceIds: input.loanType === "va" ? ["va-funding-fee"] : ["hud-ml-2023-05"],
    });
  }

  const total = cashLines.reduce((sum, l) => sum + l.annual, 0);

  return {
    downPayment: loan.downPaymentAmount,
    upfrontFeeInCash: loan.upfrontFeePaidInCash,
    estimatedClosingCosts: closingCosts,
    estimatedPrepaidsAndImpounds: impounds,
    total,
    lines: cashLines,
  };
}

// ---------------------------------------------------------------------------
// Qualification
// ---------------------------------------------------------------------------

/**
 * Rough combined federal + California + FICA burden as a share of gross income.
 * Used only for the VA residual income test, which requires an after-tax figure.
 * A real underwriter uses your actual withholding; this is a planning estimate.
 */
function estimateTaxWithholdingRate(grossAnnualIncome: number): number {
  const brackets: ReadonlyArray<[number, number]> = [
    [60_000, 0.18],
    [100_000, 0.22],
    [150_000, 0.25],
    [250_000, 0.29],
    [400_000, 0.33],
  ];
  for (const [ceiling, rate] of brackets) {
    if (grossAnnualIncome < ceiling) return rate;
  }
  return 0.37;
}

function computeQualification(input: ScenarioInput, loan: LoanFacts, housingPayment: number): Qualification {
  const grossAnnual = input.household.grossAnnualIncomes.reduce((a, b) => a + b, 0);
  const grossMonthlyIncome = grossAnnual / 12;
  const totalObligations = housingPayment + input.household.monthlyDebts;

  const ceilingInfo = DTI_CEILINGS[input.loanType];
  const dtiCeiling = ceilingInfo.typical;

  const frontEndDti = grossMonthlyIncome > 0 ? housingPayment / grossMonthlyIncome : Infinity;
  const backEndDti = grossMonthlyIncome > 0 ? totalObligations / grossMonthlyIncome : Infinity;

  const incomeRequiredAnnual = (totalObligations / dtiCeiling) * 12;

  const notes: string[] = [ceilingInfo.note];
  if (input.household.grossAnnualIncomes.length > 1) {
    notes.push(
      `Both incomes count, and so does both people's debt. Two earners raise the ceiling; they don't halve the payment.`
    );
  }

  const qualification: Qualification = {
    grossMonthlyIncome,
    housingPayment,
    totalObligations,
    frontEndDti,
    backEndDti,
    dtiCeiling,
    passesDti: backEndDti <= dtiCeiling,
    incomeRequiredAnnual,
    notes,
  };

  // VA's real test is residual income, not DTI.
  if (input.loanType === "va") {
    const squareFeet = input.squareFeet ?? 1500;
    const utilityAllowance = squareFeet * VA_UTILITY_PER_SQFT;
    const taxes = grossMonthlyIncome * estimateTaxWithholdingRate(grossAnnual);
    const available = grossMonthlyIncome - taxes - housingPayment - input.household.monthlyDebts - utilityAllowance;
    const required = vaResidualIncomeRequired(input.household.size, loan.totalLoanAmount);

    qualification.residualIncome = {
      available,
      required,
      passes: available >= required,
      explanation:
        `VA requires ${money(required)}/month left over for a household of ${input.household.size} in the West region, ` +
        `the highest minimums in the country. After an estimated ${money(taxes)} in taxes, ${money(housingPayment)} in housing, ` +
        `${money(input.household.monthlyDebts)} in other debt, and VA's fixed ${money(utilityAllowance)} utility allowance ` +
        `(${squareFeet.toLocaleString("en-US")} sq ft at $${VA_UTILITY_PER_SQFT}/sq ft), you would have ${money(available)}.`,
    };
    notes.push(
      "VA weighs residual income above DTI. Clearing it can carry an approval well past 41%; failing it sinks one that looks fine."
    );
  }

  return qualification;
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

function buildWarnings(input: ScenarioInput, loan: LoanFacts, qualification: Qualification): string[] {
  const warnings: string[] = [];

  if (loan.exceedsConformingLimit && input.loanType !== "va") {
    warnings.push(
      `At ${money(loan.baseLoanAmount)}, this loan is above the ${money(loan.conformingLimit)} conforming limit for ${input.county} County, ` +
        `which makes it a jumbo. Expect stricter underwriting, a larger down payment requirement, cash reserves, and a rate that no longer ` +
        `tracks the conforming market. Putting ${money(loan.baseLoanAmount - loan.conformingLimit)} more down would bring it back under.`
    );
  }

  if (input.loanType === "va" && loan.exceedsConformingLimit) {
    warnings.push(
      `This is above ${input.county} County's conforming limit of ${money(loan.conformingLimit)}, but VA borrowers with full entitlement ` +
        `have had no loan limit since 2020. The limit still matters if your entitlement is partially used.`
    );
  }

  warnings.push(
    "Expect a supplemental property tax bill a few months after closing. When the county reassesses to your purchase price, it bills you " +
      "the difference from the seller's old assessment, prorated for the rest of the fiscal year. Your impound account does not cover it, " +
      "it arrives as a separate bill you pay out of pocket, and on a long-held California home it can be thousands."
  );

  if (!hasCountySpecificTaxRate(input.county) && input.propertyTaxRate === undefined) {
    warnings.push(
      `We don't have a specific tax rate on file for ${input.county} County, so this uses the statewide fallback. Look up your parcel's actual rate.`
    );
  }

  if (!qualification.passesDti) {
    warnings.push(
      `At ${pct(qualification.backEndDti, 1)}, your debt-to-income ratio is above the ${pct(qualification.dtiCeiling, 0)} ceiling this ` +
        `program typically approves. You would need ${money(qualification.incomeRequiredAnnual)}/year, or less monthly debt, or a cheaper house.`
    );
  }

  if (qualification.residualIncome && !qualification.residualIncome.passes) {
    warnings.push(
      `This fails VA's residual income test by ${money(qualification.residualIncome.required - qualification.residualIncome.available)}/month, ` +
        `which matters more to a VA underwriter than the DTI ratio does.`
    );
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function evaluateScenario(input: ScenarioInput): ScenarioResult {
  const loan = deriveLoanFacts(input);
  const mi = computeMortgageInsurance(input, loan);
  const lines = buildLines(input, loan, mi);

  const lenderMonthlyTotal = lines.filter((l) => LENDER_COUNTED_KEYS.has(l.key)).reduce((sum, l) => sum + l.monthly, 0);
  const trueMonthlyTotal = lines.reduce((sum, l) => sum + l.monthly, 0);

  const qualification = computeQualification(input, loan, lenderMonthlyTotal);
  const cashToClose = computeCashToClose(input, loan, lines);
  const warnings = buildWarnings(input, loan, qualification);

  return { input, loan, lines, lenderMonthlyTotal, trueMonthlyTotal, cashToClose, qualification, warnings };
}

/** Remaining balance at a given month, exposed for equity and payoff views. */
export { balanceAfter };
