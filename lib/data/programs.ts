/**
 * Loan program rules: what each program charges you for insurance, what it
 * charges you up front, and how much debt it will let you carry.
 *
 * Every table here cites its source. Where a table is an industry estimate
 * rather than a published schedule (PMI), it is labeled as such loudly.
 */

import type { LoanType } from "../types.ts";
import type { SourceId } from "./sources.ts";

// ---------------------------------------------------------------------------
// VA funding fee, purchase loans
// Source: va-funding-fee (statutory)
// ---------------------------------------------------------------------------

/**
 * The one-time fee that funds the VA loan program. Note the cliff: at zero down,
 * subsequent use costs 3.30% against first use's 2.15%, half as much again. Put
 * 5% down and both collapse to 1.50%, so for a repeat borrower that deposit
 * more than halves the fee.
 *
 * ("More than doubles" was the old wording. It is 1.53x, not 2x. The comparison
 * that really doubles is subsequent-use zero-down against subsequent-use at 5%
 * down, which is a statement about the deposit, not about repeat use.)
 *
 * A service-connected disability rating at ANY level waives this entirely,
 * which is frequently worth five figures.
 */
export const VA_FUNDING_FEE = {
  firstUse: [
    { minDownPercent: 0.1, rate: 0.0125 },
    { minDownPercent: 0.05, rate: 0.015 },
    { minDownPercent: 0, rate: 0.0215 },
  ],
  subsequentUse: [
    { minDownPercent: 0.1, rate: 0.0125 },
    { minDownPercent: 0.05, rate: 0.015 },
    { minDownPercent: 0, rate: 0.033 },
  ],
} as const;

export function vaFundingFeeRate(downPercent: number, firstUse: boolean, disabilityExempt: boolean): number {
  if (disabilityExempt) return 0;
  const table = firstUse ? VA_FUNDING_FEE.firstUse : VA_FUNDING_FEE.subsequentUse;
  for (const tier of table) {
    if (downPercent >= tier.minDownPercent) return tier.rate;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// FHA mortgage insurance premium
// Source: hud-ml-2023-05 (published)
// ---------------------------------------------------------------------------

/** Charged once at closing, on the base loan amount. Usually financed. */
export const FHA_UPFRONT_MIP_RATE = 0.0175;

/**
 * Annual MIP, charged monthly. The rate depends on term, LTV, and whether the
 * loan is above the current conforming baseline.
 *
 * The duration rule is separate from the rate and is the part that hurts:
 * put less than 10% down and you pay MIP for the entire life of the loan.
 * There is no equity threshold that removes it. The only exit is refinancing
 * out of FHA entirely.
 */
export function fhaAnnualMipRate(args: {
  baseLoanAmount: number;
  ltv: number;
  termYears: number;
  conformingBaseline: number;
}): number {
  const { baseLoanAmount, ltv, termYears, conformingBaseline } = args;
  const large = baseLoanAmount > conformingBaseline;

  if (termYears > 15) {
    if (!large) return ltv > 0.95 ? 0.0055 : 0.005;
    return ltv > 0.95 ? 0.0075 : 0.007;
  }
  // 15-year and shorter
  if (!large) return ltv > 0.9 ? 0.004 : 0.0015;
  if (ltv > 0.9) return 0.0065;
  if (ltv > 0.78) return 0.004;
  return 0.0015;
}

/**
 * How long FHA MIP lasts, in months. `null` means the life of the loan.
 * Turns entirely on the down payment: 10% or more buys you an exit at 11 years.
 */
export function fhaMipDurationMonths(ltv: number): number | null {
  return ltv > 0.9 ? null : 11 * 12;
}

// ---------------------------------------------------------------------------
// FHA loan limits
// Source: hud-ml-2025-23 (published)
// ---------------------------------------------------------------------------

/**
 * FHA's national floor and ceiling for a one-unit property.
 *
 * FHA has its OWN county limits, and they are not the FHFA conforming limits
 * this project already ships. The engine used to check FHA loans against the
 * conforming limit and, when they exceeded it, call them "a jumbo". An FHA loan
 * is never a jumbo: over the FHA limit it is simply not an FHA loan, which is a
 * different and worse problem for the borrower.
 *
 * The per-county number sits somewhere between these two bounds and is derived
 * from HUD's area median sale price, which is not published as a clean
 * machine-readable file the way FHFA's is. So we state the bounds, which are
 * statutory (the ceiling is 150% of the national conforming limit under the
 * National Housing Act), and send the reader to HUD's own lookup for the exact
 * county figure rather than inventing one.
 */
export const FHA_LIMITS = {
  year: 2026,
  /** Low-cost areas. 65% of the national conforming limit. */
  floor: 541_287,
  /** High-cost areas, which is most of coastal California. 150% of it. */
  ceiling: 1_249_125,
  lookupUrl: "https://entp.hud.gov/idapp/html/hicostlook.cfm",
  sourceIds: ["hud-ml-2025-23"] as const,
} as const;

/**
 * What we can honestly say about an FHA loan of this size.
 *
 * `over` means it is above the national ceiling and therefore over the limit in
 * every county. `maybe` means it is in the band where the county's own figure
 * decides and we do not have it. `under` means it is below the floor and clears
 * everywhere.
 */
export function fhaLimitStatus(baseLoanAmount: number): "under" | "maybe" | "over" {
  if (baseLoanAmount > FHA_LIMITS.ceiling) return "over";
  if (baseLoanAmount > FHA_LIMITS.floor) return "maybe";
  return "under";
}

// ---------------------------------------------------------------------------
// Conventional PMI
// Source: pmi-rate-bands (ESTIMATE, insurer rate cards are not public)
// ---------------------------------------------------------------------------

/**
 * Representative annual PMI rates by LTV band and credit score.
 *
 * These are NOT a quote. Mortgage insurers price off proprietary rate cards
 * that lenders don't publish. The table spans 0.19% to 1.85%, which is WIDER
 * than the 0.46%-1.50% band the Urban Institute reports as typical: the cheap
 * end is a 760+ borrower a hair under 20% down, and the expensive end is a
 * sub-640 borrower at 97% LTV. Both tails are real and both sit outside what a
 * "typical" range describes, which is why this file used to claim containment it
 * did not have. Good to roughly a tenth of a point, which is enough to plan with
 * and not enough to sign with.
 *
 * The shape of the table is the real lesson: at 3% down with a 640 score you pay
 * 1.60%, against 0.19% for a 20%-adjacent borrower with a 760. Eight and a half
 * times the rate, for the same house.
 */
const PMI_BANDS: ReadonlyArray<{
  maxLtv: number;
  /** Descending credit floors, first match wins. */
  byScore: ReadonlyArray<{ minScore: number; rate: number }>;
}> = [
  {
    maxLtv: 0.85,
    byScore: [
      { minScore: 760, rate: 0.0019 },
      { minScore: 740, rate: 0.0022 },
      { minScore: 720, rate: 0.0025 },
      { minScore: 700, rate: 0.003 },
      { minScore: 680, rate: 0.0038 },
      { minScore: 660, rate: 0.0045 },
      { minScore: 640, rate: 0.0055 },
      { minScore: 0, rate: 0.0065 },
    ],
  },
  {
    maxLtv: 0.9,
    byScore: [
      { minScore: 760, rate: 0.0028 },
      { minScore: 740, rate: 0.0033 },
      { minScore: 720, rate: 0.004 },
      { minScore: 700, rate: 0.0048 },
      { minScore: 680, rate: 0.0062 },
      { minScore: 660, rate: 0.0075 },
      { minScore: 640, rate: 0.0092 },
      { minScore: 0, rate: 0.0108 },
    ],
  },
  {
    maxLtv: 0.95,
    byScore: [
      { minScore: 760, rate: 0.0041 },
      { minScore: 740, rate: 0.0047 },
      { minScore: 720, rate: 0.0058 },
      { minScore: 700, rate: 0.007 },
      { minScore: 680, rate: 0.0087 },
      { minScore: 660, rate: 0.0105 },
      { minScore: 640, rate: 0.0128 },
      { minScore: 0, rate: 0.015 },
    ],
  },
  {
    maxLtv: 1,
    byScore: [
      { minScore: 760, rate: 0.0055 },
      { minScore: 740, rate: 0.0063 },
      { minScore: 720, rate: 0.0075 },
      { minScore: 700, rate: 0.009 },
      { minScore: 680, rate: 0.011 },
      { minScore: 660, rate: 0.0132 },
      { minScore: 640, rate: 0.016 },
      { minScore: 0, rate: 0.0185 },
    ],
  },
];

/** Annual PMI rate, or 0 when LTV is at or below 80% and PMI doesn't apply. */
export function pmiAnnualRate(ltv: number, creditScore: number): number {
  if (ltv <= 0.8) return 0;
  const band = PMI_BANDS.find((b) => ltv <= b.maxLtv) ?? PMI_BANDS[PMI_BANDS.length - 1]!;
  const tier = band.byScore.find((t) => creditScore >= t.minScore) ?? band.byScore[band.byScore.length - 1]!;
  return tier.rate;
}

/**
 * LTV at which PMI terminates automatically, by law, on the original value and
 * the original amortization schedule. Source: pmi-cancellation (statutory).
 * You may request cancellation at 80%.
 */
export const PMI_AUTO_TERMINATION_LTV = 0.78;
export const PMI_REQUEST_CANCELLATION_LTV = 0.8;

// ---------------------------------------------------------------------------
// Debt-to-income ceilings
// Sources: fannie-b3-6-02, va-residual-income
// ---------------------------------------------------------------------------

/**
 * `typical` is what a lender will comfortably approve and what we use to answer
 * "how much do I need to make." `max` is the documented outer edge, reachable
 * with automated approval and compensating factors, but living there means
 * every dollar of your life is already spoken for.
 */
export const DTI_CEILINGS: Record<
  LoanType,
  { typical: number; max: number; sourceIds: readonly SourceId[]; note: string }
> = {
  conventional: {
    typical: 0.45,
    max: 0.5,
    sourceIds: ["fannie-b3-6-02"],
    note: "Desktop Underwriter allows up to 50%. Manual underwriting caps at 36%, or 45% with reserves and strong credit.",
  },
  jumbo: {
    typical: 0.4,
    max: 0.43,
    // NOT Fannie Mae. Jumbo loans are non-agency and Fannie does not buy them,
    // so its Selling Guide has nothing to say about their ratios. This entry
    // used to cite it anyway.
    sourceIds: ["jumbo-lender-overlays"],
    note: "Jumbo loans are held on the lender's own books, so they set their own rules. 43% is a common ceiling because it is Regulation Z's Qualified Mortgage threshold, and reserves of 6-12 months are typical. There is no published agency number here.",
  },
  fha: {
    typical: 0.45,
    max: 0.5699,
    // FHA's ratios are HUD's, from Handbook 4000.1. Fannie's Selling Guide does
    // not cover FHA loans.
    sourceIds: ["hud-4000-1-dti"],
    note: "FHA's manual ceiling is 43%, but automated approval with compensating factors reaches 56.99%. That is an underwriting limit, not a lifestyle recommendation.",
  },
  va: {
    typical: 0.41,
    max: 0.6,
    sourceIds: ["va-residual-income"],
    note: "41% is a guideline, not a cap. VA has no hard DTI limit. It cares about residual income instead, and will approve well past 41% if enough money is left over each month.",
  },
};

// ---------------------------------------------------------------------------
// VA residual income
// Source: va-residual-income (published)
// ---------------------------------------------------------------------------

/**
 * Minimum monthly income that must remain AFTER the mortgage, all other debts,
 * taxes, and a utility allowance. California is in the West region, which has
 * the highest minimums in the country.
 *
 * This test is why a VA borrower can be approved at a DTI that would sink a
 * conventional application, and why a VA borrower with a big family can be
 * denied at a DTI that looks fine on paper.
 */
export const VA_RESIDUAL_INCOME_WEST = {
  /** Loan amounts of $80,000 and above, effectively every California purchase. */
  large: { 1: 491, 2: 823, 3: 990, 4: 1117, 5: 1158, additional: 80 },
  small: { 1: 390, 2: 654, 3: 788, 4: 888, 5: 921, additional: 75 },
} as const;

export const VA_LARGE_LOAN_THRESHOLD = 80_000;

/** VA's fixed maintenance-and-utilities allowance. Not adjustable, not realistic, but it's the rule. */
export const VA_UTILITY_PER_SQFT = 0.14;

export function vaResidualIncomeRequired(familySize: number, loanAmount: number): number {
  const table = loanAmount >= VA_LARGE_LOAN_THRESHOLD ? VA_RESIDUAL_INCOME_WEST.large : VA_RESIDUAL_INCOME_WEST.small;
  const size = Math.max(1, Math.floor(familySize));
  if (size <= 5) {
    return table[size as 1 | 2 | 3 | 4 | 5];
  }
  return table[5] + (size - 5) * table.additional;
}
