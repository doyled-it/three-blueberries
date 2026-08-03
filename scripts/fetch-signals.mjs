/**
 * Regenerates lib/data/signals.ts from FRED.
 *
 *   npm run data:signals
 *
 * The economic series behind the "is a crash coming" panel. All from FRED's
 * public CSV endpoint, no API key.
 *
 *   MEHOINUSCAA646N  California median household income, NOMINAL, annual
 *   MSACSR           Months' supply of NEW houses, national, monthly
 *   DRSFRMACBS       Delinquency rate, single-family residential mortgages, quarterly
 *   LAUMT064174000000003A  San Diego-Carlsbad MSA unemployment rate, annual
 *
 * Caveats that must travel with this data (see lib/signals.ts):
 *   - MSACSR covers NEW construction only. Existing-home supply is a different,
 *     much shorter series and currently reads far lower. Do not present MSACSR as
 *     "the housing market's inventory."
 *   - Income is statewide California, not San Diego specifically, and annual.
 *   - Delinquency and supply are national; only unemployment is San Diego.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "lib", "data", "signals.ts");

const SERIES = {
  income: "MEHOINUSCAA646N",
  newHomeSupply: "MSACSR",
  delinquency: "DRSFRMACBS",
  sdUnemployment: "LAUMT064174000000003A",
};

async function fetchSeries(id) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  if (!res.ok) throw new Error(`FRED returned ${res.status} for ${id}`);
  return (await res.text())
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(","))
    .filter(([, v]) => v && v !== ".")
    .map(([date, v]) => [date.slice(0, 7), Number(v)]);
}

const [income, supply, delinquency, unemployment] = await Promise.all(
  [SERIES.income, SERIES.newHomeSupply, SERIES.delinquency, SERIES.sdUnemployment].map(fetchSeries)
);

// Trim to the era the price index covers.
const since = (rows, from) => rows.filter(([m]) => m >= from);

const fmt = (rows) => rows.map(([m, v]) => `  [${JSON.stringify(m)}, ${v}],`).join("\n");

const body = `// GENERATED FILE. Do not edit by hand.
// Regenerate with: npm run data:signals
//
// Sources (all FRED, public CSV endpoint, no API key):
//   ${SERIES.income}  California median household income, nominal, annual
//     https://fred.stlouisfed.org/series/${SERIES.income}
//   ${SERIES.newHomeSupply}           Monthly supply of NEW houses, national
//     https://fred.stlouisfed.org/series/${SERIES.newHomeSupply}
//   ${SERIES.delinquency}       Delinquency rate on single-family residential mortgages, national
//     https://fred.stlouisfed.org/series/${SERIES.delinquency}
//   ${SERIES.sdUnemployment}  San Diego-Carlsbad MSA unemployment rate
//
// Retrieved: ${new Date().toISOString().slice(0, 10)}
//
// READ THE CAVEATS IN lib/signals.ts BEFORE PUTTING ANY OF THIS ON SCREEN.
// In particular MSACSR is NEW CONSTRUCTION ONLY and reads far higher than the
// resale market it is routinely confused with.

export type SignalRow = readonly [string, number];

/** California median household income, nominal dollars, annual. */
export const CA_MEDIAN_INCOME: readonly SignalRow[] = [
${fmt(income)}
];

/** Months' supply of NEW houses, national, monthly. Not the resale market. */
export const NEW_HOME_SUPPLY: readonly SignalRow[] = [
${fmt(since(supply, "1987-01"))}
];

/** Delinquency rate on single-family residential mortgages, national, quarterly, percent. */
export const MORTGAGE_DELINQUENCY: readonly SignalRow[] = [
${fmt(delinquency)}
];

/** San Diego-Carlsbad MSA unemployment rate, annual, percent. */
export const SD_UNEMPLOYMENT: readonly SignalRow[] = [
${fmt(unemployment)}
];

export const SIGNALS_INCOME_LAST_YEAR = ${JSON.stringify(income[income.length - 1][0].slice(0, 4))};
`;

await fs.writeFile(OUT, body, "utf8");
console.log(`Wrote signals.ts:`);
console.log(`  income ${income.length} rows (to ${income[income.length - 1][0]})`);
console.log(
  `  supply ${since(supply, "1987-01").length} rows (to ${supply[supply.length - 1][0]} = ${supply[supply.length - 1][1]})`
);
console.log(
  `  delinquency ${delinquency.length} rows (to ${delinquency[delinquency.length - 1][0]} = ${delinquency[delinquency.length - 1][1]}%)`
);
console.log(
  `  SD unemployment ${unemployment.length} rows (to ${unemployment[unemployment.length - 1][0]} = ${unemployment[unemployment.length - 1][1]}%)`
);
