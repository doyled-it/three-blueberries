/**
 * AB 1482 rent caps, by the region the property is actually in.
 *
 * The Tenant Protection Act caps an annual increase at 5% plus the change in
 * the cost of living, never above 10%. The cost-of-living figure is NOT one
 * number for the state: Civil Code 1947.12 uses the CPI for the region the
 * property sits in, and falls back to the California CPI where the Bureau of
 * Labor Statistics publishes no regional index.
 *
 * BLS publishes four California metropolitan indexes, which is why there are
 * exactly four named regions here and one fallback covering the other 48
 * counties. Hardcoding San Diego's figure told a reader in Riverside that their
 * ceiling was 8.2% when it is 8.1%, and a reader in Alameda 8.2% when it is 8.8%.
 *
 * The figures below are the April 2026 readings, which govern increases taking
 * effect 1 August 2026 through 31 July 2027. They change every August. Reverify
 * each May.
 *
 * TWO THINGS THAT MATTER MORE THAN THE NUMBER ITSELF:
 *
 * It is a CEILING, not a forecast. Most sitting tenants see far less, so using
 * it as an assumed rent growth rate wildly overstates what actually happens.
 *
 * The exemptions are broad. Single-family homes and condos not owned by a
 * corporation are exempt if the lease said so, and anything built in the last
 * 15 years is exempt outright. Plenty of renters are not covered at all.
 */

import type { CaCounty } from "./ca-loan-limits.ts";

export const AB_1482 = {
  base: 0.05,
  hardCeiling: 0.1,
} as const;

export interface RentCapRegion {
  id: string;
  label: string;
  /** The BLS index the statute points at, or the statewide CPI. */
  indexName: string;
  /** April-to-April change, as a decimal. */
  cpi: number;
  counties: readonly CaCounty[];
}

/**
 * The four counties-to-region mappings BLS publishes an index for. Everything
 * not listed falls to the statewide California CPI, which is calculated by the
 * Department of Industrial Relations rather than BLS.
 */
export const RENT_CAP_REGIONS: readonly RentCapRegion[] = [
  {
    id: "los-angeles",
    label: "Los Angeles and Orange",
    indexName: "CPI-U, Los Angeles-Long Beach-Anaheim",
    cpi: 0.037,
    counties: ["Los Angeles", "Orange"],
  },
  {
    id: "inland-empire",
    label: "Inland Empire",
    indexName: "CPI-U, Riverside-San Bernardino-Ontario",
    cpi: 0.031,
    counties: ["Riverside", "San Bernardino"],
  },
  {
    id: "san-diego",
    label: "San Diego",
    indexName: "CPI-U, San Diego-Carlsbad",
    cpi: 0.032,
    counties: ["San Diego"],
  },
  {
    id: "bay-area",
    label: "Bay Area",
    indexName: "CPI-U, San Francisco-Oakland-Hayward",
    cpi: 0.038,
    counties: ["Alameda", "Contra Costa", "Marin", "San Francisco", "San Mateo"],
  },
];

/** Used where BLS publishes no regional index, which is most of the state. */
export const STATEWIDE_RENT_CAP_REGION: RentCapRegion = {
  id: "statewide",
  label: "the rest of California",
  indexName: "California CPI, Department of Industrial Relations",
  cpi: 0.036,
  counties: [],
};

export function rentCapRegionFor(county: CaCounty): RentCapRegion {
  return RENT_CAP_REGIONS.find((r) => r.counties.includes(county)) ?? STATEWIDE_RENT_CAP_REGION;
}

/** The maximum a covered rent can be raised in a year, for this county. */
export function statutoryRentCap(county: CaCounty): number {
  const region = rentCapRegionFor(county);
  return Math.min(AB_1482.base + region.cpi, AB_1482.hardCeiling);
}
