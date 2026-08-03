import type { SourceId } from "./data/sources.ts";
import type { CaCounty } from "./data/ca-loan-limits.ts";

export type LoanType = "conventional" | "fha" | "va" | "jumbo";

/**
 * How much we trust a given line item.
 * - `statutory`  : fixed by law (the 1% Prop 13 base, the VA funding fee)
 * - `published`  : an agency's published schedule (FHA MIP, conforming limits)
 * - `market`     : a real observed average that moves (rates, insurance)
 * - `estimated`  : our default, standing in until you supply the real number
 * - `user`       : you typed this in, so it's as good as your information
 */
export type Confidence = "statutory" | "published" | "market" | "estimated" | "user";

/**
 * One line of your payment, with its receipts attached.
 *
 * `basis` is a plain-English sentence explaining how the number was reached.
 * If we can't write that sentence, we shouldn't be showing the number.
 */
export interface LineItem {
  key: string;
  label: string;
  monthly: number;
  annual: number;
  basis: string;
  confidence: Confidence;
  sourceIds: readonly SourceId[];
  /** Set when this line deserves a warning rather than just a citation. */
  warning?: string;
}

export type DownPayment = { kind: "percent"; value: number } | { kind: "amount"; value: number };

export interface VaOptions {
  /** First time using a VA loan? Subsequent use costs more with under 5% down. */
  firstUse: boolean;
  /** A service-connected disability rating of any level waives the funding fee entirely. */
  disabilityExempt: boolean;
  /** Roll the funding fee into the loan (the default) or pay it in cash at close. */
  financeFundingFee: boolean;
}

export interface FhaOptions {
  /** Roll the 1.75% upfront premium into the loan (the default) or pay cash. */
  financeUpfrontMip: boolean;
}

export interface Household {
  /** One entry per earner. Two incomes is just a two-element array. */
  grossAnnualIncomes: readonly number[];
  /** Minimum monthly payments on everything else: cars, students loans, cards. */
  monthlyDebts: number;
  /** Everyone the income supports. Used for the VA residual income test. */
  size: number;
}

export interface ScenarioInput {
  purchasePrice: number;
  downPayment: DownPayment;
  loanType: LoanType;
  termYears: number;
  /** Annual rate as a decimal: 6.66% is 0.0666. */
  interestRate: number;
  creditScore: number;
  county: CaCounty;

  /** Annual property tax rate as a decimal. Omit to use the county default. */
  propertyTaxRate?: number;
  /** Filed the homeowners' exemption? $7,000 off assessed value. */
  claimHomeownersExemption: boolean;

  /** Annual homeowners insurance premium. Omit to use a county-risk estimate. */
  insuranceAnnual?: number;
  hoaMonthly: number;
  /** Mello-Roos / CFD special tax, annual. Check the title report. */
  melloRoosAnnual: number;

  /** Maintenance reserve as a fraction of purchase price per year. Default 1%. */
  maintenanceRate?: number;
  /** Living area. Only needed for the VA residual income test. */
  squareFeet?: number;

  va?: VaOptions;
  fha?: FhaOptions;
  household: Household;
}

export interface LoanFacts {
  basePrice: number;
  downPaymentAmount: number;
  downPaymentPercent: number;
  /** Loan before any financed upfront fee. */
  baseLoanAmount: number;
  /** What you actually amortize, including financed UFMIP or VA funding fee. */
  totalLoanAmount: number;
  /** Financed upfront fee rolled into the balance (0 for conventional). */
  financedUpfrontFee: number;
  /** Upfront fee paid in cash at closing instead of financed. */
  upfrontFeePaidInCash: number;
  ltv: number;
  conformingLimit: number;
  exceedsConformingLimit: boolean;
}

export interface MortgageInsuranceResult {
  monthly: number;
  annualRate: number;
  /** How long you pay it. `null` means for the life of the loan. */
  endsAfterMonths: number | null;
  explanation: string;
  sourceIds: readonly SourceId[];
}

export interface CashToClose {
  downPayment: number;
  upfrontFeeInCash: number;
  estimatedClosingCosts: number;
  estimatedPrepaidsAndImpounds: number;
  total: number;
  lines: LineItem[];
}

export interface Qualification {
  /** Gross monthly income across all earners. */
  grossMonthlyIncome: number;
  /** What underwriting counts as your housing payment. */
  housingPayment: number;
  /** Housing payment plus all other monthly debt. */
  totalObligations: number;
  frontEndDti: number;
  backEndDti: number;
  dtiCeiling: number;
  passesDti: boolean;
  /** Gross annual household income needed to clear the DTI ceiling. */
  incomeRequiredAnnual: number;
  /** VA only: the residual income test, which is the one VA actually cares about. */
  residualIncome?: {
    available: number;
    required: number;
    passes: boolean;
    explanation: string;
  };
  notes: string[];
}

export interface ScenarioResult {
  input: ScenarioInput;
  loan: LoanFacts;
  /** Every recurring line, itemized and sourced. */
  lines: LineItem[];
  /** What the lender requires each month: PITI + MI + HOA + Mello-Roos. */
  lenderMonthlyTotal: number;
  /** What leaving your bank account actually looks like, maintenance included. */
  trueMonthlyTotal: number;
  cashToClose: CashToClose;
  qualification: Qualification;
  /** Things that will surprise you if nobody says them out loud. */
  warnings: string[];
}
