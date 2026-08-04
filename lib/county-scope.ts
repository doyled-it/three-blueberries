/**
 * What the county selector does and does not change.
 *
 * The calculator is county-aware everywhere it can be: the conforming loan
 * limit, the property tax rate, the AB 1482 rent ceiling, and everything
 * downstream of those. The history is not. Case-Shiller publishes repeat-sales
 * indexes for three California metros, not 58 counties, and this site is built
 * on San Diego's.
 *
 * That is a real limitation and it should be stated where a reader can act on
 * it, not buried in a comment. A buyer in Fresno reading "the last month the
 * math worked was March 2013" deserves to know whose math.
 *
 * The correlations below are measured, not asserted. See the test, which
 * recomputes them from data/panel.json and fails if they drift. That panel is
 * still Case-Shiller, which is fine for measuring how closely two metros move
 * together, and is a separate question from what the site itself plots.
 */

import type { CaCounty } from "./data/ca-loan-limits.ts";

/**
 * Pearson correlation of year-over-year Case-Shiller change against San Diego,
 * 461 monthly observations from January 1988 to the present.
 *
 * The California metros move together closely enough that the SHAPE of the San
 * Diego history is informative statewide. They are not identical, and the
 * levels differ a lot more than the changes do, which is why the note says the
 * shape rather than the number.
 */
export const METRO_CORRELATION = {
  losAngeles: 0.94,
  sanFrancisco: 0.89,
  /** For contrast: the best-correlated non-California metro in the panel. */
  bestNonCalifornia: 0.72,
  observations: 461,
  from: "1988-01",
} as const;

/** Counties inside the Case-Shiller Los Angeles index. */
const LA_METRO: readonly CaCounty[] = ["Los Angeles", "Orange"];

/** Counties inside the Case-Shiller San Francisco index. */
const SF_METRO: readonly CaCounty[] = ["Alameda", "Contra Costa", "Marin", "San Francisco", "San Mateo"];

/**
 * The sentence to show above every panel built on San Diego history, or null
 * when the reader has actually selected San Diego and there is nothing to say.
 */
export function countyScopeNote(county: CaCounty): string | null {
  if (county === "San Diego") return null;

  const shared =
    `Your price, rate, property tax rate and rent ceiling are ${county} County's. ` +
    `The price history on this panel is San Diego's, because Case-Shiller publishes a repeat-sales index ` +
    `for three California metros rather than for 58 counties.`;

  if (LA_METRO.includes(county)) {
    return (
      `${shared} Los Angeles and San Diego have moved together closely: their year-on-year changes correlate at ` +
      `${METRO_CORRELATION.losAngeles} across ${METRO_CORRELATION.observations} months. The shape transfers well. ` +
      `The levels do not, so read the percentages and ignore the dollar amounts.`
    );
  }

  if (SF_METRO.includes(county)) {
    return (
      `${shared} The Bay Area and San Diego correlate at ${METRO_CORRELATION.sanFrancisco} on year-on-year change ` +
      `across ${METRO_CORRELATION.observations} months, so the shape mostly transfers. The Bay Area's 2006 peak and ` +
      `its recovery were both sharper, and its price levels are far higher, so read the percentages, not the dollars.`
    );
  }

  return (
    `${shared} There is no index for ${county} at all, so nothing here is a measurement of your market. ` +
    `Inland and rural California fell harder in 2008 than the coast did and recovered later. Treat this panel as ` +
    `an argument about how housing behaves, not as your county's record.`
  );
}
