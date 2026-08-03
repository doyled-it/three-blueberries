/**
 * Builds the training panel: 20 Case-Shiller metros joined to national controls.
 *
 *   npm run data:panel
 *
 * Writes data/panel.json, which is used ONLY at training time and never shipped
 * to the browser. The client only ever receives the learned coefficients.
 *
 * Why 20 metros instead of just San Diego: San Diego has two price declines over
 * 10% in 39 years. You cannot fit a model to two events. Pooling metros raises
 * the number of drawdown episodes to something you can actually estimate on.
 *
 * What pooling does NOT fix: 2008 hit every metro at once, so the episodes are
 * heavily correlated. The effective number of independent housing cycles in this
 * panel is closer to three or four than to thirty, and the training script's
 * validation is built around that fact.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "data", "panel.json");

const METROS = {
  SDXRSA: "San Diego",
  LXXRSA: "Los Angeles",
  SFXRSA: "San Francisco",
  SEXRSA: "Seattle",
  PHXRSA: "Phoenix",
  MIXRSA: "Miami",
  TPXRSA: "Tampa",
  DNXRSA: "Denver",
  POXRSA: "Portland",
  LVXRSA: "Las Vegas",
  WDXRSA: "Washington DC",
  NYXRSA: "New York",
  BOXRSA: "Boston",
  CHXRSA: "Chicago",
  DAXRSA: "Dallas",
  ATXRSA: "Atlanta",
  CRXRSA: "Charlotte",
  CEXRSA: "Cleveland",
  DEXRSA: "Detroit",
  MNXRSA: "Minneapolis",
};

const NATIONAL = {
  rate: "MORTGAGE30US",
  supply: "MSACSR",
  delinquency: "DRSFRMACBS",
  unemployment: "UNRATE",
  cpi: "CPIAUCSL",
};

async function fetchSeries(id) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  if (!res.ok) throw new Error(`FRED returned ${res.status} for ${id}`);
  return (await res.text())
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => l.split(","))
    .filter(([, v]) => v && v !== ".")
    .map(([date, v]) => [date.slice(0, 7), Number(v)]);
}

console.log(`Fetching ${Object.keys(METROS).length} metros and ${Object.keys(NATIONAL).length} national series...`);

const metroEntries = await Promise.all(
  Object.entries(METROS).map(async ([id, name]) => [id, { name, series: await fetchSeries(id) }])
);
const nationalEntries = await Promise.all(
  Object.entries(NATIONAL).map(async ([key, id]) => [key, await fetchSeries(id)])
);

// The weekly rate series needs collapsing to monthly averages.
const rateRaw = Object.fromEntries(nationalEntries).rate;
const buckets = new Map();
for (const [month, v] of rateRaw) {
  if (!buckets.has(month)) buckets.set(month, []);
  buckets.get(month).push(v);
}
const rateMonthly = [...buckets.entries()]
  .map(([m, vs]) => [m, Number((vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(4))])
  .sort((a, b) => a[0].localeCompare(b[0]));

const national = Object.fromEntries(nationalEntries);
national.rate = rateMonthly;

const panel = {
  generatedFrom: "https://fred.stlouisfed.org/",
  retrieved: new Date().toISOString().slice(0, 10),
  metros: Object.fromEntries(metroEntries),
  national,
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(panel), "utf8");

const totalObs = metroEntries.reduce((sum, [, m]) => sum + m.series.length, 0);
const bytes = (await fs.stat(OUT)).size;
console.log(
  `Wrote ${path.relative(root, OUT)} — ${metroEntries.length} metros, ${totalObs} metro-months, ${(bytes / 1024).toFixed(0)}KB`
);
for (const [key, series] of Object.entries(national)) {
  console.log(`  ${key.padEnd(13)} ${series.length} rows, ${series[0][0]} -> ${series[series.length - 1][0]}`);
}
