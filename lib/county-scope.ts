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
 * A county inside a metro gets the quarterly series, most of which start in the
 * 1970s; four start later, so the start year is read off the data rather than
 * asserted here. The rural remainder gets its own annual series. Nobody gets
 * somebody else's market any more.
 *
 * Two counties' series stop early. Alpine ends in 2022 and Trinity in 2024,
 * because FHFA suppresses a county-year with too few transactions to publish.
 * The note says so: a reader whose "today" is four years old should know it.
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
      ? `The price history below is the FHFA index for ${place}, quarterly, from ${from}. ${county} County sits in ` +
        `that metro, so this is your market, not somebody else's.`
      : `The price history below is the FHFA index for ${county} County itself, annual, from ${from}. It is not in ` +
        `a metro, and FHFA publishes quarterly data only for metros, so this is the finest resolution there is.`;

  // A series that stops years ago is presented as current everywhere else on the
  // page. Say it here, where the resolution caveat already lives.
  const lastMonth = rows[rows.length - 1]![0];
  const staleness =
    lastMonth < "2025-06"
      ? ` It also STOPS in ${YEAR(lastMonth)}: FHFA suppresses county-years with too few sales, so everything ` +
        `downstream that says "today" means ${YEAR(lastMonth)} here.`
      : "";

  const seam = spliceMonth
    ? ` Readings before ${spliceMonth} are chain-linked from FHFA's older, coarser index, so treat the earliest ` +
      `stretch as the shape of what happened, not a precise measurement.`
    : "";

  return { county, place, stepMonths, spliceMonth, note: resolution + staleness + seam };
}
