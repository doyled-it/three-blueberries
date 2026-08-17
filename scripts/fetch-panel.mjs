/**
 * Builds the training panel: 20 metros from FHFA's all-transactions house price
 * index, joined to national controls, all on a QUARTERLY cadence.
 *
 *   npm run data:panel
 *
 * Writes data/panel.json, used ONLY at training time and never shipped to the
 * browser. The client only ever receives the learned coefficients.
 *
 * Why FHFA and not Case-Shiller. Case-Shiller is monthly and covers more metros,
 * but S&P prohibits redistributing the index values, and FRED states explicitly
 * that API access is not that permission. FHFA's index is a US government work
 * with no such restriction, so it can live in a public repo. It is published
 * quarterly, which is why every window in training/ counts quarters.
 *
 * Why 20 metros instead of just San Diego: San Diego has two price declines over
 * 10% in its recorded history. You cannot fit a model to two events. Pooling
 * metros raises the number of drawdown episodes to something you can estimate on.
 *
 * What pooling does NOT fix: 2008 hit every metro at once, so the episodes are
 * heavily correlated. The effective number of independent housing cycles in this
 * panel is closer to three or four than to twenty, and the training script's
 * validation is built around that fact.
 *
 * The FHFA metro series use the CBSA code, except divided metros (Los Angeles,
 * New York, San Francisco, Chicago, Detroit, Miami, Boston, Seattle, Washington,
 * Dallas) which FHFA reports at the Metropolitan Division level. The codes below
 * were each confirmed against FRED before being written down.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "data", "panel.json");

// slug id -> { name, code }. The slug is the stable internal identifier used by
// train.py (TARGET_METRO) and the leakage tests; the code builds the FRED id
// `ATNHPIUS<code>Q`. Metropolitan Division codes are marked.
const METROS = {
  SanDiego: { name: "San Diego", code: "41740" },
  LosAngeles: { name: "Los Angeles", code: "31084" }, // MetroDiv
  SanFrancisco: { name: "San Francisco", code: "41884" }, // MetroDiv
  Seattle: { name: "Seattle", code: "42644" }, // MetroDiv
  Phoenix: { name: "Phoenix", code: "38060" },
  Miami: { name: "Miami", code: "33124" }, // MetroDiv
  Tampa: { name: "Tampa", code: "45300" },
  Denver: { name: "Denver", code: "19740" },
  Portland: { name: "Portland", code: "38900" },
  LasVegas: { name: "Las Vegas", code: "29820" },
  Washington: { name: "Washington DC", code: "47894" }, // MetroDiv
  NewYork: { name: "New York", code: "35614" }, // MetroDiv
  Boston: { name: "Boston", code: "14454" }, // MetroDiv
  Chicago: { name: "Chicago", code: "16984" }, // MetroDiv
  Dallas: { name: "Dallas", code: "19124" }, // MetroDiv
  Atlanta: { name: "Atlanta", code: "12060" },
  Charlotte: { name: "Charlotte", code: "16740" },
  Cleveland: { name: "Cleveland", code: "17460" },
  Detroit: { name: "Detroit", code: "19804" }, // MetroDiv
  Minneapolis: { name: "Minneapolis", code: "33460" },
};

const NATIONAL = {
  rate: "MORTGAGE30US",
  supply: "MSACSR",
  delinquency: "DRSFRMACBS",
  unemployment: "UNRATE",
  cpi: "CPIAUCSL",
};

/** Fetch a FRED series as raw [YYYY-MM-DD, value] rows, missing values dropped. */
async function fetchSeries(id) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  if (!res.ok) throw new Error(`FRED returned ${res.status} for ${id}`);
  return (await res.text())
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => l.split(","))
    .filter(([, v]) => v && v !== ".")
    .map(([date, v]) => [date, Number(v)]);
}

/** "1975-10-01" -> "1975Q4". */
function toQuarter(dateStr) {
  const year = dateStr.slice(0, 4);
  const month = Number(dateStr.slice(5, 7));
  return `${year}Q${Math.floor((month - 1) / 3) + 1}`;
}

/**
 * Collapse raw [date, value] rows to one value per quarter by averaging within
 * the quarter. FHFA metro series are already one-per-quarter, so this is a
 * pass-through for them; the weekly rate and monthly macro series are genuinely
 * averaged. Averaging, not sampling, so a quarter's rate is its lived average.
 */
function quarterlyMean(rows) {
  const buckets = new Map();
  for (const [date, v] of rows) {
    const q = toQuarter(date);
    if (!buckets.has(q)) buckets.set(q, []);
    buckets.get(q).push(v);
  }
  return [...buckets.entries()]
    .map(([q, vs]) => [q, Number((vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(4))])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

console.log(`Fetching ${Object.keys(METROS).length} FHFA metros and ${Object.keys(NATIONAL).length} national series...`);

const metroEntries = await Promise.all(
  Object.entries(METROS).map(async ([id, { name, code }]) => {
    const raw = await fetchSeries(`ATNHPIUS${code}Q`);
    if (raw.length < 80) throw new Error(`${name} (${code}) returned only ${raw.length} quarters; refusing to write a thin panel`);
    return [id, { name, series: quarterlyMean(raw) }];
  })
);
const nationalEntries = await Promise.all(
  Object.entries(NATIONAL).map(async ([key, id]) => [key, quarterlyMean(await fetchSeries(id))])
);

if (metroEntries.length !== Object.keys(METROS).length) {
  throw new Error(`expected ${Object.keys(METROS).length} metros, got ${metroEntries.length}`);
}

const national = Object.fromEntries(nationalEntries);

const panel = {
  generatedFrom: "https://fred.stlouisfed.org/ (FHFA All-Transactions House Price Index)",
  retrieved: new Date().toISOString().slice(0, 10),
  metros: Object.fromEntries(metroEntries),
  national,
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(panel), "utf8");

const totalObs = metroEntries.reduce((sum, [, m]) => sum + m.series.length, 0);
const bytes = (await fs.stat(OUT)).size;
console.log(
  `Wrote ${path.relative(root, OUT)}, ${metroEntries.length} metros, ${totalObs} metro-quarters, ${(bytes / 1024).toFixed(0)}KB`
);
for (const [key, series] of Object.entries(national)) {
  console.log(`  ${key.padEnd(13)} ${series.length} rows, ${series[0][0]} -> ${series[series.length - 1][0]}`);
}
