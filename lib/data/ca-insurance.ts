/**
 * GENERATED FILE. Do not hand-edit. Run `npm run data:insurance`.
 *
 * California FAIR Plan owner-occupied single-family residential policies and
 * written premium by county, as of 2026-06-30, aggregated from the FAIR Plan's own
 * per-ZIP quarterly reports at https://www.cfpnet.com/key-statistics-data/
 *
 * `detachedUnits` is the Department of Finance E-5 count of single detached
 * housing units in the county as of 2026-01-01, so `share` compares detached
 * houses with detached houses.
 *
 * THIS IS NOT THE PRICE OF A NORMAL POLICY. The FAIR Plan is the insurer of
 * last resort: fire-only cover, usually needing a separate DIC policy on top
 * for everything else a homeowners policy does. It is what you pay when the
 * admitted market will not write you, which is why the share matters as much
 * as the premium.
 */

import type { CaCounty } from "./ca-loan-limits.ts";

export interface FairPlanCounty {
  /** Owner-occupied single-family policies in force. */
  policies: number;
  /** Mean annual written premium per policy, dollars. */
  averagePremium: number;
  /** Mean premium in the county's high-wildfire-risk ZIP codes, null if it has none. */
  highRiskPremium: number | null;
  /** Single detached housing units in the county. */
  detachedUnits: number;
  /** Policies divided by detached units. */
  share: number;
}

export const FAIR_PLAN_AS_OF = "2026-06-30";
export const FAIR_PLAN_UNITS_AS_OF = "2026-01-01";
/** Mean owner-occupied single-family FAIR Plan premium across the state. */
export const FAIR_PLAN_STATEWIDE_AVERAGE = 3000;

export const FAIR_PLAN_BY_COUNTY: Record<CaCounty, FairPlanCounty> = {
  Alameda: { policies: 9419, averagePremium: 3631, highRiskPremium: 5505, detachedUnits: 328705, share: 0.02865 },
  Alpine: { policies: 357, averagePremium: 4476, highRiskPremium: 4411, detachedUnits: 947, share: 0.37698 },
  Amador: { policies: 5357, averagePremium: 3693, highRiskPremium: 3786, detachedUnits: 15881, share: 0.33732 },
  Butte: { policies: 7886, averagePremium: 3281, highRiskPremium: 3510, detachedUnits: 58757, share: 0.13421 },
  Calaveras: { policies: 9273, averagePremium: 3634, highRiskPremium: 3629, detachedUnits: 24385, share: 0.38027 },
  Colusa: { policies: 56, averagePremium: 2922, highRiskPremium: 3920, detachedUnits: 6181, share: 0.00906 },
  "Contra Costa": { policies: 11390, averagePremium: 4173, highRiskPremium: 5649, detachedUnits: 289974, share: 0.03928 },
  "Del Norte": { policies: 540, averagePremium: 1406, highRiskPremium: 2199, detachedUnits: 7020, share: 0.07692 },
  "El Dorado": { policies: 24312, averagePremium: 4032, highRiskPremium: 4201, detachedUnits: 79186, share: 0.30702 },
  Fresno: { policies: 4704, averagePremium: 3858, highRiskPremium: 4657, detachedUnits: 242940, share: 0.01936 },
  Glenn: { policies: 47, averagePremium: 2303, highRiskPremium: 7911, detachedUnits: 7911, share: 0.00594 },
  Humboldt: { policies: 2417, averagePremium: 2024, highRiskPremium: 2410, detachedUnits: 42636, share: 0.05669 },
  Imperial: { policies: 467, averagePremium: 669, highRiskPremium: null, detachedUnits: 36938, share: 0.01264 },
  Inyo: { policies: 242, averagePremium: 3007, highRiskPremium: 5494, detachedUnits: 5718, share: 0.04232 },
  Kern: { policies: 8856, averagePremium: 2300, highRiskPremium: 3171, detachedUnits: 229091, share: 0.03866 },
  Kings: { policies: 97, averagePremium: 827, highRiskPremium: null, detachedUnits: 35658, share: 0.00272 },
  Lake: { policies: 4859, averagePremium: 3132, highRiskPremium: 3560, detachedUnits: 23617, share: 0.20574 },
  Lassen: { policies: 960, averagePremium: 3373, highRiskPremium: 3779, detachedUnits: 8803, share: 0.10905 },
  "Los Angeles": { policies: 109284, averagePremium: 2341, highRiskPremium: 4755, detachedUnits: 1773398, share: 0.06162 },
  Madera: { policies: 4589, averagePremium: 4105, highRiskPremium: 4204, detachedUnits: 44465, share: 0.1032 },
  Marin: { policies: 3699, averagePremium: 3567, highRiskPremium: 5401, detachedUnits: 68523, share: 0.05398 },
  Mariposa: { policies: 2499, averagePremium: 4297, highRiskPremium: 4288, detachedUnits: 6602, share: 0.37852 },
  Mendocino: { policies: 3666, averagePremium: 3583, highRiskPremium: 3647, detachedUnits: 29400, share: 0.12469 },
  Merced: { policies: 206, averagePremium: 1223, highRiskPremium: 1178, detachedUnits: 69171, share: 0.00298 },
  Modoc: { policies: 239, averagePremium: 2151, highRiskPremium: 2734, detachedUnits: 3604, share: 0.06632 },
  Mono: { policies: 1101, averagePremium: 3604, highRiskPremium: 4128, detachedUnits: 5310, share: 0.20734 },
  Monterey: { policies: 4168, averagePremium: 4857, highRiskPremium: 5136, detachedUnits: 93419, share: 0.04462 },
  Napa: { policies: 2203, averagePremium: 7655, highRiskPremium: 7585, detachedUnits: 38018, share: 0.05795 },
  Nevada: { policies: 19871, averagePremium: 4240, highRiskPremium: 4455, detachedUnits: 45385, share: 0.43783 },
  Orange: { policies: 19045, averagePremium: 2100, highRiskPremium: 3283, detachedUnits: 577382, share: 0.03299 },
  Placer: { policies: 16165, averagePremium: 4186, highRiskPremium: 4346, detachedUnits: 151233, share: 0.10689 },
  Plumas: { policies: 3327, averagePremium: 3821, highRiskPremium: 4020, detachedUnits: 11701, share: 0.28433 },
  Riverside: { policies: 53582, averagePremium: 1777, highRiskPremium: 2872, detachedUnits: 624421, share: 0.08581 },
  Sacramento: { policies: 1234, averagePremium: 1627, highRiskPremium: 3775, detachedUnits: 403270, share: 0.00306 },
  "San Benito": { policies: 299, averagePremium: 4480, highRiskPremium: 7831, detachedUnits: 17831, share: 0.01677 },
  "San Bernardino": { policies: 56870, averagePremium: 2241, highRiskPremium: 2972, detachedUnits: 541634, share: 0.105 },
  "San Diego": { policies: 48844, averagePremium: 2982, highRiskPremium: 3916, detachedUnits: 640159, share: 0.0763 },
  "San Francisco": { policies: 1239, averagePremium: 1191, highRiskPremium: null, detachedUnits: 66283, share: 0.01869 },
  "San Joaquin": { policies: 645, averagePremium: 1260, highRiskPremium: 4829, detachedUnits: 201774, share: 0.0032 },
  "San Luis Obispo": { policies: 3507, averagePremium: 4157, highRiskPremium: 5535, detachedUnits: 86788, share: 0.04041 },
  "San Mateo": { policies: 3017, averagePremium: 3247, highRiskPremium: 6106, detachedUnits: 159371, share: 0.01893 },
  "Santa Barbara": { policies: 5218, averagePremium: 6155, highRiskPremium: 7620, detachedUnits: 93281, share: 0.05594 },
  "Santa Clara": { policies: 5051, averagePremium: 4150, highRiskPremium: 6922, detachedUnits: 362057, share: 0.01395 },
  "Santa Cruz": { policies: 10970, averagePremium: 5108, highRiskPremium: 5390, detachedUnits: 67956, share: 0.16143 },
  Shasta: { policies: 5751, averagePremium: 3188, highRiskPremium: 3386, detachedUnits: 56507, share: 0.10178 },
  Sierra: { policies: 457, averagePremium: 3382, highRiskPremium: 3368, detachedUnits: 1929, share: 0.23691 },
  Siskiyou: { policies: 2598, averagePremium: 2841, highRiskPremium: 3165, detachedUnits: 16068, share: 0.16169 },
  Solano: { policies: 1045, averagePremium: 3386, highRiskPremium: 6345, detachedUnits: 121499, share: 0.0086 },
  Sonoma: { policies: 6617, averagePremium: 5170, highRiskPremium: 5553, detachedUnits: 140947, share: 0.04695 },
  Stanislaus: { policies: 458, averagePremium: 1376, highRiskPremium: 4056, detachedUnits: 141256, share: 0.00324 },
  Sutter: { policies: 77, averagePremium: 1329, highRiskPremium: null, detachedUnits: 25204, share: 0.00306 },
  Tehama: { policies: 1545, averagePremium: 3139, highRiskPremium: 3536, detachedUnits: 17871, share: 0.08645 },
  Trinity: { policies: 1196, averagePremium: 3477, highRiskPremium: 3528, detachedUnits: 5382, share: 0.22222 },
  Tulare: { policies: 2278, averagePremium: 2697, highRiskPremium: 3196, detachedUnits: 121850, share: 0.0187 },
  Tuolumne: { policies: 12046, averagePremium: 3200, highRiskPremium: 3254, detachedUnits: 25279, share: 0.47652 },
  Ventura: { policies: 12379, averagePremium: 3495, highRiskPremium: 4855, detachedUnits: 189693, share: 0.06526 },
  Yolo: { policies: 188, averagePremium: 3537, highRiskPremium: 6345, detachedUnits: 51003, share: 0.00369 },
  Yuba: { policies: 1338, averagePremium: 3924, highRiskPremium: 4005, detachedUnits: 23914, share: 0.05595 },
};
