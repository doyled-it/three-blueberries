/**
 * California property tax and insurance defaults.
 *
 * READ THIS BEFORE TRUSTING A NUMBER OUT OF THIS FILE.
 *
 * Property tax: the 1% base rate is statutory and exact (Prop 13). Everything
 * stacked on top is voter-approved: school bonds, infrastructure levies, transit
 * measures. Those vary by tax rate area (TRA), which is finer-grained than a
 * county. Two houses a mile apart in the same county can differ. The per-county
 * numbers below are typical values, not your value. Your county assessor's parcel
 * lookup has the real one and it takes two minutes to check.
 *
 * Mello-Roos is deliberately NOT in these rates. It is a separate special tax
 * modeled as its own line so it never silently inflates the ad valorem rate.
 *
 * Insurance: a statewide placeholder in a market that has stopped behaving like
 * a market. Wildfire exposure is a ZIP- and parcel-level question, not a county
 * one. This number exists so the calculator has something to run with, not
 * because we know what you'll pay.
 */

import type { CaCounty } from "./ca-loan-limits.ts";

/** Statutory Prop 13 base rate. This part is not an estimate. */
export const PROP_13_BASE_RATE = 0.01;

/** Maximum annual growth in assessed value under Prop 13, absent a sale or new construction. */
export const PROP_13_MAX_ANNUAL_GROWTH = 0.02;

/** Homeowners' Exemption: reduction in assessed value for an owner-occupied home. You must file for it. */
export const CA_HOMEOWNERS_EXEMPTION = 7000;

/**
 * Typical total ad valorem rate by county: the 1% base plus that county's usual
 * voter-approved add-ons. Excludes Mello-Roos and other direct assessments.
 *
 * Counties not listed fall back to DEFAULT_COUNTY_TAX_RATE.
 */
const COUNTY_TAX_RATES: Partial<Record<CaCounty, number>> = {
  Alameda: 0.012,
  "Contra Costa": 0.0115,
  Fresno: 0.0113,
  Kern: 0.0112,
  "Los Angeles": 0.012,
  Marin: 0.0112,
  Orange: 0.0108,
  Placer: 0.0112,
  Riverside: 0.0115,
  Sacramento: 0.0115,
  "San Bernardino": 0.011,
  "San Diego": 0.0115,
  "San Francisco": 0.0118,
  "San Joaquin": 0.0115,
  "San Luis Obispo": 0.0108,
  "San Mateo": 0.0112,
  "Santa Barbara": 0.0107,
  "Santa Clara": 0.012,
  "Santa Cruz": 0.0112,
  Solano: 0.0112,
  Sonoma: 0.0112,
  Stanislaus: 0.0113,
  Tulare: 0.011,
  Ventura: 0.0112,
};

/** Used for counties without a specific entry. Close to the statewide low end. */
export const DEFAULT_COUNTY_TAX_RATE = 0.011;

export function countyTaxRate(county: CaCounty): number {
  return COUNTY_TAX_RATES[county] ?? DEFAULT_COUNTY_TAX_RATE;
}

/** True when we have a county-specific figure rather than the statewide fallback. */
export function hasCountySpecificTaxRate(county: CaCounty): boolean {
  return COUNTY_TAX_RATES[county] !== undefined;
}

/**
 * Placeholder annual homeowners insurance premium.
 *
 * Sits at the middle of the roughly $1,400-$2,400 range for a standard HO-3 in
 * a non-wildfire California ZIP. It is wrong for anything brush-adjacent, where
 * quotes run $5,000-$25,000+, and wrong for a FAIR Plan policy, which averages
 * around $3,000-$3,200 statewide and far more in the worst ZIPs.
 *
 * Scaled gently with home value because dwelling coverage tracks rebuild cost,
 * but rebuild cost is not purchase price and land isn't insured. Override it
 * with a real quote the moment you have one.
 */
export const DEFAULT_INSURANCE_BASE = 1900;
export const DEFAULT_INSURANCE_REFERENCE_PRICE = 800_000;

export function estimateInsuranceAnnual(purchasePrice: number): number {
  const scale = Math.sqrt(Math.max(purchasePrice, 100_000) / DEFAULT_INSURANCE_REFERENCE_PRICE);
  return Math.round(DEFAULT_INSURANCE_BASE * scale);
}

/**
 * Buyer closing costs as a fraction of purchase price, excluding the down
 * payment and any financed upfront loan fee. California buyers typically land
 * between 2% and 5%; escrow is customarily split with the seller in most of the
 * state. We default to the low-middle because the biggest single item, points,
 * is optional.
 */
export const DEFAULT_CLOSING_COST_RATE = 0.025;

/** Months of taxes and insurance a lender typically collects up front to seed the impound account. */
export const IMPOUND_MONTHS_TAXES = 6;
export const IMPOUND_MONTHS_INSURANCE = 3;

/** Default annual maintenance reserve as a fraction of purchase price. */
export const DEFAULT_MAINTENANCE_RATE = 0.01;
