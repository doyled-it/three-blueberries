/**
 * What the county selector changes, said out loud.
 *
 * This module used to exist to apologise: every county was shown San Diego's
 * price history with a note explaining how well San Diego transfers. That was
 * papering over a limitation rather than fixing it. The history is now the
 * reader's own county, so the note's job changed. It says what RESOLUTION they
 * are getting and why, because that is the honest remaining caveat.
 *
 * FHFA publishes 28 California metros quarterly and all 58 counties annually.
 * A county inside a metro gets the quarterly series, which starts in the 1970s.
 * The rural remainder gets its own annual series. Nobody gets somebody else's
 * market any more.
 */

import { historyFor } from "./data/history.ts";
import type { CaCounty } from "./data/ca-loan-limits.ts";

export interface CountyScope {
  county: CaCounty;
  /** What the price series actually measures. */
  place: string;
  /** 3 for a metro series, 12 for a county one. */
  stepMonths: number;
  /** Where the chained older index gives way to the accurate newer one. */
  spliceMonth: string | null;
  note: string;
}

const YEAR = (month: string) => month.slice(0, 4);

export function countyScope(county: CaCounty): CountyScope {
  const { rows, stepMonths, place, spliceMonth } = historyFor(county);
  const from = YEAR(rows[0]![0]);

  const resolution =
    stepMonths === 3
      ? `The price history below is the FHFA index for ${place}, quarterly, from ${from}. ` +
        `${county} County is part of that metro, so this is your market rather than somebody else's.`
      : `The price history below is the FHFA index for ${county} County itself, annual, from ${from}. ` +
        `${county} is not inside a metropolitan area, and FHFA publishes quarterly data only for metros, ` +
        `so this is the finest resolution that exists for where you are buying.`;

  const seam = spliceMonth
    ? ` One seam worth knowing about: readings before ${spliceMonth} come from FHFA's longer all-transactions ` +
      `index, chain-linked on, because the more accurate expanded-data series only starts then. The two ` +
      `disagree by a couple of points a year, so treat the earliest stretch as the shape of what happened ` +
      `rather than as a precise measurement.`
    : "";

  return { county, place, stepMonths, spliceMonth, note: resolution + seam };
}
