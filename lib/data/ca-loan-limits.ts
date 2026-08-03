// GENERATED FILE, do not edit by hand.
// Regenerate with: npm run data:loan-limits
//
// Source: FHFA 2026 conforming loan limits, one-unit properties.
//   https://www.fhfa.gov/data/conforming-loan-limit
//   https://www.fhfa.gov/document/FullCountyLoanLimitList2026_HERA-BASED_FINAL_FLAT.csv
// Retrieved: 2026-08-03
//
// A loan above the county limit is a jumbo: different underwriting, usually a
// larger down payment, and a rate that no longer tracks the conforming market.

export const LOAN_LIMIT_YEAR = 2026;

/** The nationwide baseline. Every CA county is at least this. */
export const CONFORMING_BASELINE = 832750;

/** The statutory high-cost ceiling (150% of baseline). */
export const CONFORMING_CEILING = 1249125;

export const CA_COUNTY_LOAN_LIMITS = {
  Alameda: 1249125,
  Alpine: 832750,
  Amador: 832750,
  Butte: 832750,
  Calaveras: 832750,
  Colusa: 832750,
  "Contra Costa": 1249125,
  "Del Norte": 832750,
  "El Dorado": 832750,
  Fresno: 832750,
  Glenn: 832750,
  Humboldt: 832750,
  Imperial: 832750,
  Inyo: 832750,
  Kern: 832750,
  Kings: 832750,
  Lake: 832750,
  Lassen: 832750,
  "Los Angeles": 1249125,
  Madera: 832750,
  Marin: 1249125,
  Mariposa: 832750,
  Mendocino: 832750,
  Merced: 832750,
  Modoc: 832750,
  Mono: 832750,
  Monterey: 994750,
  Napa: 1017750,
  Nevada: 832750,
  Orange: 1249125,
  Placer: 832750,
  Plumas: 832750,
  Riverside: 832750,
  Sacramento: 832750,
  "San Benito": 1249125,
  "San Bernardino": 832750,
  "San Diego": 1104000,
  "San Francisco": 1249125,
  "San Joaquin": 832750,
  "San Luis Obispo": 1000500,
  "San Mateo": 1249125,
  "Santa Barbara": 941850,
  "Santa Clara": 1249125,
  "Santa Cruz": 1249125,
  Shasta: 832750,
  Sierra: 832750,
  Siskiyou: 832750,
  Solano: 832750,
  Sonoma: 897000,
  Stanislaus: 832750,
  Sutter: 832750,
  Tehama: 832750,
  Trinity: 832750,
  Tulare: 832750,
  Tuolumne: 832750,
  Ventura: 1035000,
  Yolo: 832750,
  Yuba: 832750,
} as const;

export type CaCounty = keyof typeof CA_COUNTY_LOAN_LIMITS;

export const CA_COUNTIES = Object.keys(CA_COUNTY_LOAN_LIMITS) as CaCounty[];

/** Conforming ceiling for a county. Above this, you are shopping jumbo. */
export function conformingLimitFor(county: CaCounty): number {
  return CA_COUNTY_LOAN_LIMITS[county];
}
