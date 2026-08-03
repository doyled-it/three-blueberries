/**
 * Regenerates lib/data/history.ts from FRED.
 *
 *   npm run data:history
 *
 * Two series, joined by month:
 *   SDXRSA       S&P CoreLogic Case-Shiller San Diego home price index
 *   MORTGAGE30US Freddie Mac 30-year fixed average (weekly, averaged to monthly)
 *
 * Uses FRED's public fredgraph CSV endpoint, which needs no API key — so this
 * stays runnable by anyone who clones the repo.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "lib", "data", "history.ts");

const SERIES = {
  price: "SDXRSA",
  rate: "MORTGAGE30US",
};

async function fetchSeries(id) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED returned ${res.status} for ${id}`);
  const text = await res.text();
  return text
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(","))
    .filter(([, v]) => v && v !== ".")
    .map(([date, v]) => ({ date, value: Number(v) }));
}

const [priceRows, rateRows] = await Promise.all([fetchSeries(SERIES.price), fetchSeries(SERIES.rate)]);

// Average the weekly rate readings within each month so both series are monthly.
const rateBuckets = new Map();
for (const r of rateRows) {
  const ym = r.date.slice(0, 7);
  if (!rateBuckets.has(ym)) rateBuckets.set(ym, []);
  rateBuckets.get(ym).push(r.value);
}

const rows = [];
for (const p of priceRows) {
  const ym = p.date.slice(0, 7);
  const bucket = rateBuckets.get(ym);
  if (!bucket) continue;
  const rate = bucket.reduce((a, b) => a + b, 0) / bucket.length;
  rows.push([ym, Number(p.value.toFixed(2)), Number(rate.toFixed(3))]);
}

if (rows.length < 400) {
  throw new Error(`Only ${rows.length} joined months — expected 400+. Refusing to write a truncated history.`);
}

const first = rows[0];
const latest = rows[rows.length - 1];

const body = `// GENERATED FILE — do not edit by hand.
// Regenerate with: npm run data:history
//
// Sources (both public, no API key needed):
//   S&P CoreLogic Case-Shiller San Diego Home Price Index (SDXRSA)
//     https://fred.stlouisfed.org/series/SDXRSA
//   Freddie Mac 30-Year Fixed Rate Mortgage Average (MORTGAGE30US)
//     https://fred.stlouisfed.org/series/MORTGAGE30US
// Retrieved: ${new Date().toISOString().slice(0, 10)}
//
// The price index is a repeat-sales index, not a median. It tracks what the SAME
// homes resell for, which is why it can be compared across decades without a
// change in the mix of what sold distorting it.
//
// Rows are [month, priceIndex, avg30YearRatePercent]. Weekly rate readings are
// averaged within each month so the two series line up.

/** [YYYY-MM, Case-Shiller San Diego index, average 30-year fixed rate as a percent] */
export type HistoryRow = readonly [string, number, number];

export const HISTORY_FIRST_MONTH = ${JSON.stringify(first[0])};
export const HISTORY_LATEST_MONTH = ${JSON.stringify(latest[0])};
export const HISTORY_LATEST_INDEX = ${latest[1]};
export const HISTORY_LATEST_RATE = ${latest[2]};

export const SD_HISTORY: readonly HistoryRow[] = [
${rows.map((r) => `  [${JSON.stringify(r[0])}, ${r[1]}, ${r[2]}],`).join("\n")}
];
`;

await fs.writeFile(OUT, body, "utf8");
console.log(`Wrote ${rows.length} months (${first[0]} to ${latest[0]}) to ${path.relative(root, OUT)}`);
console.log(`  latest index ${latest[1]}, latest rate ${latest[2]}%`);
