/**
 * Financial-plumbing indicators: the "bets on bets on bets" layer.
 *
 *   npm run data:financial
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE DISTINCTION THAT MATTERS
 *
 * There are two kinds of 2008 indicator, and only one of them is worth modelling.
 *
 * INSTRUMENT-SPECIFIC, subprime origination share, private-label MBS issuance,
 * CDO and CDO-squared volume, the ABX index. These are the fingerprint of one
 * crisis. They have superb hindsight and no future: the ABX barely exists now,
 * CDO-squared issuance is a rounding error, and the next crisis will be built out
 * of some instrument nobody has named yet. A model that learns "CDO issuance high
 * -> crash" has learned it from exactly one event, and cannot fire again because
 * the instrument is gone. That is fitting N=1 and calling it a forecaster.
 *
 * STRUCTURAL, how leveraged the financial system is, how wide risk premia are,
 * how stressed funding markets are. These are instrument-agnostic. They were
 * elevated before 2008, before 1998, before the Nordic crises, and they will be
 * elevated before the next one, whatever it is built from.
 *
 * This file fetches the structural ones. The Chicago Fed's NFCI leverage
 * subindex is the closest honest proxy for what The Big Short is about: it
 * measures debt and equity leverage across the financial sector, weekly, back
 * to 1971, so it covers several crises rather than one.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * CAVEAT THAT MUST TRAVEL WITH THIS DATA: every series here is UNITED STATES
 * ONLY. Applying it to the 19-country panel treats US financial conditions as a
 * global proxy. That is defensible after about 1990, when US conditions
 * genuinely transmit worldwide, and it is weak for Japan 1991 and the Nordic
 * crises, which had domestic causes.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "data", "financial.json");
const CACHE = path.join(root, "data", ".fred-cache");

const SERIES = {
  /** Chicago Fed NFCI, leverage subindex, debt and equity leverage in the financial sector. */
  leverage: "NFCILEVERAGE",
  /** Overall national financial conditions. Positive = tighter than average. */
  conditions: "NFCI",
  /** Conditions adjusted for the state of the business cycle. */
  conditionsAdjusted: "ANFCI",
  /** Credit-market subindex. */
  credit: "NFCICREDIT",
  /** Risk subindex, volatility and funding risk. */
  risk: "NFCIRISK",
  /** Baa corporate over 10-year Treasury: the price of credit risk. */
  creditSpread: "BAA10Y",
  /** Household mortgage debt outstanding. The securitisation boom shows up here. */
  mortgageDebt: "HHMSDODNS",
  /** Financial-sector debt outstanding. */
  financialDebt: "DODFS",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchSeries(id, attempt = 0) {
  const cached = path.join(CACHE, `${id}.csv`);
  try {
    const hit = await fs.readFile(cached, "utf8");
    if (hit.length > 40) return parse(hit);
  } catch {
    /* not cached */
  }

  let res;
  try {
    res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  } catch {
    res = null;
  }
  if ((!res || !res.ok) && attempt < 5) {
    await sleep(1000 * Math.pow(2, attempt));
    return fetchSeries(id, attempt + 1);
  }
  if (!res || !res.ok) return null;

  const text = await res.text();
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(cached, text, "utf8");
  await sleep(250);
  return parse(text);
}

function parse(text) {
  return text
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => l.split(","))
    .filter(([, v]) => v && v !== ".")
    .map(([date, v]) => [date, Number(v)]);
}

/** Collapse daily/weekly readings to monthly averages. */
function toMonthly(rows) {
  const buckets = new Map();
  for (const [date, v] of rows) {
    const ym = date.slice(0, 7);
    if (!buckets.has(ym)) buckets.set(ym, []);
    buckets.get(ym).push(v);
  }
  return [...buckets.entries()]
    .map(([ym, vs]) => [ym, Number((vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(4))])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

const out = {};
for (const [key, id] of Object.entries(SERIES)) {
  const rows = await fetchSeries(id);
  if (!rows) {
    console.log(`  -- ${key} (${id}) unavailable`);
    continue;
  }
  out[key] = toMonthly(rows);
  console.log(
    `  ${key.padEnd(20)} ${id.padEnd(18)} ${out[key].length} months  ${out[key][0][0]} -> ${out[key].at(-1)[0]}`
  );
}

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(
  OUT,
  JSON.stringify({
    retrieved: new Date().toISOString().slice(0, 10),
    scope: "UNITED STATES ONLY, see scripts/fetch-financial.mjs for why that matters",
    series: out,
  }),
  "utf8"
);
console.log(`\nWrote ${path.relative(root, OUT)}`);
