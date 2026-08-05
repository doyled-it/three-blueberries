/**
 * GENERATED FILE. Do not hand-edit. Run `npm run data:fha-limits`.
 *
 * FHA's own one-unit forward mortgage limit for every California county, CY2026,
 * from HUD's CHUMS master file. This is the same record behind HUD's lookup
 * tool at entp.hud.gov, not a summary of it.
 *
 * THESE ARE NOT THE CONFORMING LIMITS. Both agencies set a county at 115% of
 * its area median sale price and cap it at 150% of the conforming baseline, but
 * FHFA floors at the baseline while FHA floors at 65% of it. Below the ceiling
 * the two diverge by a lot: Stanislaus is $832,750 conforming and
 * $545,100 FHA.
 *
 * 28 counties sit at the national floor of $541,287,
 * 10 at the ceiling of $1,249,125, and 20 in between.
 *
 * `medianPrice` is HUD's own median sale price estimate for the county, which is
 * what the limit is calculated from. It is NOT a current market median and must
 * not be presented as one: HUD uses the highest year since 2008 and the
 * high-price county within a metro, so it runs ahead of what houses are selling
 * for today.
 */

import type { CaCounty } from "./ca-loan-limits.ts";

export const FHA_LIMIT_YEAR = 2026;
/** 65% of the conforming baseline. The lowest FHA will insure anywhere. */
export const FHA_NATIONAL_FLOOR = 541287;
/** 150% of the conforming baseline. The most FHA will insure anywhere. */
export const FHA_NATIONAL_CEILING = 1249125;

export interface FhaCountyLimit {
  /** One-unit forward mortgage limit. */
  limit: number;
  /** HUD's median sale price estimate, which the limit is 115% of. Not a market median. */
  medianPrice: number;
  /** False means the county is at the national floor. */
  highCost: boolean;
}

export const CA_FHA_LIMITS: Record<CaCounty, FhaCountyLimit> = {
  Alameda: { limit: 1249125, medianPrice: 1750000, highCost: true },
  Alpine: { limit: 736000, medianPrice: 640000, highCost: true },
  Amador: { limit: 541287, medianPrice: 385000, highCost: false },
  Butte: { limit: 541287, medianPrice: 288000, highCost: false },
  Calaveras: { limit: 541287, medianPrice: 385000, highCost: false },
  Colusa: { limit: 541287, medianPrice: 395000, highCost: false },
  "Contra Costa": { limit: 1249125, medianPrice: 1750000, highCost: true },
  "Del Norte": { limit: 541287, medianPrice: 295000, highCost: false },
  "El Dorado": { limit: 764750, medianPrice: 665000, highCost: true },
  Fresno: { limit: 541287, medianPrice: 430000, highCost: false },
  Glenn: { limit: 541287, medianPrice: 300000, highCost: false },
  Humboldt: { limit: 541287, medianPrice: 400000, highCost: false },
  Imperial: { limit: 541287, medianPrice: 355000, highCost: false },
  Inyo: { limit: 541287, medianPrice: 455000, highCost: false },
  Kern: { limit: 541287, medianPrice: 365000, highCost: false },
  Kings: { limit: 541287, medianPrice: 370000, highCost: false },
  Lake: { limit: 541287, medianPrice: 260000, highCost: false },
  Lassen: { limit: 541287, medianPrice: 200000, highCost: false },
  "Los Angeles": { limit: 1249125, medianPrice: 1300000, highCost: true },
  Madera: { limit: 541287, medianPrice: 430000, highCost: false },
  Marin: { limit: 1249125, medianPrice: 1750000, highCost: true },
  Mariposa: { limit: 541287, medianPrice: 330000, highCost: false },
  Mendocino: { limit: 546250, medianPrice: 459000, highCost: true },
  Merced: { limit: 541287, medianPrice: 420000, highCost: false },
  Modoc: { limit: 541287, medianPrice: 175000, highCost: false },
  Mono: { limit: 776250, medianPrice: 670000, highCost: true },
  Monterey: { limit: 994750, medianPrice: 865000, highCost: true },
  Napa: { limit: 1017750, medianPrice: 850000, highCost: true },
  Nevada: { limit: 649750, medianPrice: 565000, highCost: true },
  Orange: { limit: 1249125, medianPrice: 1300000, highCost: true },
  Placer: { limit: 764750, medianPrice: 665000, highCost: true },
  Plumas: { limit: 541287, medianPrice: 311000, highCost: false },
  Riverside: { limit: 690000, medianPrice: 600000, highCost: true },
  Sacramento: { limit: 764750, medianPrice: 665000, highCost: true },
  "San Benito": { limit: 1249125, medianPrice: 1820000, highCost: true },
  "San Bernardino": { limit: 690000, medianPrice: 600000, highCost: true },
  "San Diego": { limit: 1104000, medianPrice: 960000, highCost: true },
  "San Francisco": { limit: 1249125, medianPrice: 1750000, highCost: true },
  "San Joaquin": { limit: 678500, medianPrice: 589000, highCost: true },
  "San Luis Obispo": { limit: 1000500, medianPrice: 870000, highCost: true },
  "San Mateo": { limit: 1249125, medianPrice: 1750000, highCost: true },
  "Santa Barbara": { limit: 941850, medianPrice: 819000, highCost: true },
  "Santa Clara": { limit: 1249125, medianPrice: 1820000, highCost: true },
  "Santa Cruz": { limit: 1249125, medianPrice: 1100000, highCost: true },
  Shasta: { limit: 541287, medianPrice: 350000, highCost: false },
  Sierra: { limit: 541287, medianPrice: 220000, highCost: false },
  Siskiyou: { limit: 541287, medianPrice: 205000, highCost: false },
  Solano: { limit: 685400, medianPrice: 594000, highCost: true },
  Sonoma: { limit: 897000, medianPrice: 780000, highCost: true },
  Stanislaus: { limit: 545100, medianPrice: 474000, highCost: true },
  Sutter: { limit: 541287, medianPrice: 452000, highCost: false },
  Tehama: { limit: 541287, medianPrice: 295000, highCost: false },
  Trinity: { limit: 541287, medianPrice: 175000, highCost: false },
  Tulare: { limit: 541287, medianPrice: 371000, highCost: false },
  Tuolumne: { limit: 541287, medianPrice: 372000, highCost: false },
  Ventura: { limit: 1035000, medianPrice: 900000, highCost: true },
  Yolo: { limit: 764750, medianPrice: 665000, highCost: true },
  Yuba: { limit: 541287, medianPrice: 452000, highCost: false },
};

/** FHA's one-unit limit for a county. Never the conforming limit. */
export function fhaLimitFor(county: CaCounty): number {
  return CA_FHA_LIMITS[county].limit;
}
