/**
 * Regenerates lib/data/history.ts.
 *
 *   npm run data:history
 *
 * Two series, joined by quarter:
 *
 *   FHFA House Price Index, expanded-data, San Diego-Chula Vista-Carlsbad MSA
 *     https://www.fhfa.gov/data/hpi/datasets
 *   Freddie Mac 30-Year Fixed Rate Mortgage Average (MORTGAGE30US) via FRED
 *     https://fred.stlouisfed.org/series/MORTGAGE30US
 *
 * WHY FHFA AND NOT CASE-SHILLER, which this used to use:
 *
 * S&P prohibits reproduction of the Case-Shiller indexes without prior written
 * permission, and FRED states plainly that serving a series through their API is
 * not that permission. This repository is public, so committing those values was
 * redistribution we had not asked for. FHFA's HPI is a US government work with no
 * such restriction, and it is pulled from FHFA directly rather than through FRED.
 *
 * WHAT IT COSTS AND WHAT IT BUYS:
 *
 * Costs: FHFA publishes MSA-level data QUARTERLY, not monthly, and lags about a
 * quarter behind. The series is coarser and slightly less current.
 *
 * It also starts in 1991 rather than 1987, so four years come off the front.
 *
 * Buys: no permission needed, ever, by anyone who forks this.
 *
 * Both are repeat-sales indexes, so the like-for-like reading is unchanged: this
 * tracks what the SAME homes resold for, not a median that moves with the mix.
 * And on the numbers that matter it agrees with what it replaced, which is the
 * test a source swap has to pass. See FLAVOR below for why.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "lib", "data", "history.ts");

const FHFA_MASTER = "https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv";
const SAN_DIEGO_MSA = "41740";
/**
 * FHFA publishes three flavours and the choice matters more than it looks.
 *
 *   all-transactions  1975+, the longest, but it counts refinance APPRAISALS.
 *                     Appraisals lag a turning market, so it smooths exactly the
 *                     events this site is about: it puts the 2008 crash at -35%
 *                     and its bottom in 2011.
 *   purchase-only     1991+, real sales only, but conforming loans only. -38%.
 *   expanded-data     1991+, FHFA's conforming data combined with county recorder
 *                     and CoreLogic records, so it sees the jumbo and cash sales
 *                     the others miss.
 *
 * Expanded-data measures the crash at -41.9% bottoming in 2009 Q1. Case-Shiller,
 * which this replaced, measured -42% bottoming in 2009. That agreement is the
 * whole reason to pick it: swapping the source should change who owns the data,
 * not what the data says. Buying twelve extra years of history at the price of
 * understating the last crash by seven points would be a bad trade on a site
 * whose entire premise is that the number is right.
 */
const FLAVOR = "expanded-data";
/** Seasonally adjusted, matching the Case-Shiller series this replaced. */
const INDEX_COLUMN = "index_sa";

const RATE_SERIES = "MORTGAGE30US";

/** A quarter is stamped with its LAST month, so month arithmetic stays true. */
const QUARTER_END_MONTH = { 1: "03", 2: "06", 3: "09", 4: "12" };

async function fetchText(url, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label} returned ${res.status}`);
  return res.text();
}

/** Minimal CSV row splitter: FHFA quotes place names that contain commas. */
function splitCsvLine(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

async function fetchPriceIndex() {
  const text = await fetchText(FHFA_MASTER, "FHFA");
  const lines = text.trim().split("\n");
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const col = Object.fromEntries(header.map((h, i) => [h, i]));

  for (const required of ["hpi_flavor", "frequency", "place_id", "yr", "period", INDEX_COLUMN]) {
    if (col[required] === undefined) {
      throw new Error(`FHFA changed their columns: no "${required}". Fix the parser, do not guess.`);
    }
  }

  const rows = [];
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line);
    if (f[col["place_id"]] !== SAN_DIEGO_MSA) continue;
    if (f[col["hpi_flavor"]] !== FLAVOR) continue;
    if (f[col["frequency"]] !== "quarterly") continue;
    const value = Number(f[col[INDEX_COLUMN]]);
    if (!Number.isFinite(value)) continue;
    const quarter = Number(f[col["period"]]);
    const month = QUARTER_END_MONTH[quarter];
    if (!month) throw new Error(`Unexpected period "${f[col["period"]]}" for a quarterly row`);
    rows.push({ month: `${f[col["yr"]]}-${month}`, value });
  }

  rows.sort((a, b) => a.month.localeCompare(b.month));
  return rows;
}

async function fetchRates() {
  const text = await fetchText(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${RATE_SERIES}`,
    "FRED"
  );
  return text
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(","))
    .filter(([, v]) => v && v !== ".")
    .map(([date, v]) => ({ date, value: Number(v) }));
}

const [priceRows, rateRows] = await Promise.all([fetchPriceIndex(), fetchRates()]);

// Average every weekly rate reading inside the quarter, because the price index
// is itself an average of the transactions across that quarter. Pairing a
// quarter-average price with a single week's rate would be a mismatch.
const quarterOf = (isoDate) => {
  const [y, m] = isoDate.split("-");
  const end = QUARTER_END_MONTH[Math.floor((Number(m) - 1) / 3) + 1];
  return `${y}-${end}`;
};

const rateBuckets = new Map();
for (const r of rateRows) {
  const q = quarterOf(r.date);
  if (!rateBuckets.has(q)) rateBuckets.set(q, []);
  rateBuckets.get(q).push(r.value);
}

const rows = [];
for (const p of priceRows) {
  const bucket = rateBuckets.get(p.month);
  if (!bucket) continue;
  const rate = bucket.reduce((a, b) => a + b, 0) / bucket.length;
  rows.push([p.month, Number(p.value.toFixed(2)), Number(rate.toFixed(3))]);
}

// Guards. A truncated history is worse than a failed run, because every headline
// on the site is computed from it and a short series still renders a chart.
if (rows.length < 130) {
  throw new Error(`Only ${rows.length} joined quarters, expected 130+. Refusing to write a truncated history.`);
}
if (rows[0][0] > "1991-06") {
  throw new Error(`History starts at ${rows[0][0]}, later than the 1991 Q1 this flavour is published from.`);
}
for (let i = 1; i < rows.length; i++) {
  const [ay, am] = rows[i - 1][0].split("-").map(Number);
  const [by, bm] = rows[i][0].split("-").map(Number);
  if ((by - ay) * 12 + (bm - am) !== 3) {
    throw new Error(`Gap between ${rows[i - 1][0]} and ${rows[i][0]}; the series must be evenly quarterly.`);
  }
}

const latest = rows[rows.length - 1];

const body = `// GENERATED FILE, do not edit by hand.
// Regenerate with: npm run data:history
//
// Sources (both free of redistribution restrictions):
//   FHFA House Price Index, expanded-data, San Diego-Chula Vista-Carlsbad MSA
//     https://www.fhfa.gov/data/hpi/datasets
//     A US government work. Pulled from FHFA directly, not through a reseller.
//   Freddie Mac 30-Year Fixed Rate Mortgage Average (MORTGAGE30US) via FRED
//     https://fred.stlouisfed.org/series/MORTGAGE30US
// Retrieved: ${new Date().toISOString().slice(0, 10)}
//
// QUARTERLY, not monthly. FHFA publishes MSA-level data by quarter and lags about
// a quarter behind. Each row is stamped with the LAST month of its quarter, so
// arithmetic in months stays true even though the rows are three months apart.
//
// This replaced S&P CoreLogic Case-Shiller, which cannot be redistributed without
// S&P's written permission. The expanded-data flavour was chosen because it agrees
// with what it replaced: it puts the 2008 crash at -41.9% bottoming in 2009 Q1,
// against Case-Shiller's -42% bottoming in 2009. A source swap should change who
// owns the data, not what the data says.
//
// It is a repeat-sales index: it tracks what the SAME homes resold for, so it can
// be compared across decades without the mix of what sold distorting it.
// Expanded-data combines FHFA's conforming records with county recorder and
// CoreLogic data, so unlike the other FHFA flavours it sees jumbo and cash sales.
//
// Rows are [quarterEndMonth, priceIndex, avg30YearRatePercent]. Weekly rate
// readings are averaged across the whole quarter to match the index.

/** [YYYY-MM of the quarter end, FHFA San Diego HPI, average 30-year fixed rate as a percent] */
export type HistoryRow = readonly [string, number, number];

export const HISTORY_FIRST_MONTH = "${rows[0][0]}";
export const HISTORY_LATEST_MONTH = "${latest[0]}";
export const HISTORY_LATEST_INDEX = ${latest[1]};
export const HISTORY_LATEST_RATE = ${latest[2]};
/** Months between consecutive rows. Quarterly, so three. */
export const HISTORY_STEP_MONTHS = 3;

export const SD_HISTORY: readonly HistoryRow[] = [
${rows.map(([m, p, r]) => `  ["${m}", ${p}, ${r}],`).join("\n")}
];
`;

await fs.writeFile(OUT, body, "utf8");
console.log(`wrote ${path.relative(root, OUT)}`);
console.log(`  ${rows.length} quarters, ${rows[0][0]} to ${latest[0]}`);
console.log(`  index ${rows[0][1]} -> ${latest[1]}, rate ${rows[0][2]}% -> ${latest[2]}%`);
const peak = rows.reduce((a, b) => (b[2] > a[2] ? b : a));
console.log(`  highest rate on record: ${peak[2]}% in ${peak[0]}`);
