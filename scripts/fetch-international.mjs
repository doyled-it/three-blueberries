/**
 * Builds the international panel: 19 countries of housing cycles.
 *
 *   npm run data:international
 *
 * Why this exists: the 20-metro US panel contains roughly two independent
 * downturns. Every US metro crashed in 2008 for the same reason, so twenty
 * markets is not twenty experiments. Nineteen countries across 55 years gives
 * genuinely separate events — Japan 1991, the Nordic banking crises 1991-93,
 * Asia 1997, Spain and Ireland 2008, each with its own credit regime, its own
 * central bank, and its own timing.
 *
 * It also adds the variable the literature ranks first and the US panel lacked:
 * CREDIT. Jorda, Schularick & Taylor ("Leveraged Bubbles", 2015) study 140 years
 * across 17 countries and find that what separates a dangerous housing bubble
 * from a harmless one is whether it was financed by credit. We had mortgage
 * delinquency, which is coincident at best — a measure of damage already done,
 * not of risk building up.
 *
 * Series (all BIS or OECD, via FRED's public CSV endpoint, no API key):
 *   Q{CC}R628BIS       real residential property prices, quarterly
 *   Q{CC}HAM770A       credit to households, % of GDP
 *   Q{CC}PAM770A       credit to private non-financial sector, % of GDP
 *   IRLTLT01{CC}M156N  long-term government bond yield
 *   IR3TIB01{CC}M156N  3-month interbank rate
 *   LRHUTTTT{CC}M156S  harmonised unemployment rate
 *   CPALTT01{CC}M659N  CPI, year-over-year percent
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "data", "international.json");

const COUNTRIES = {
  US: "United States",
  GB: "United Kingdom",
  AU: "Australia",
  CA: "Canada",
  ES: "Spain",
  IE: "Ireland",
  JP: "Japan",
  NL: "Netherlands",
  SE: "Sweden",
  NZ: "New Zealand",
  NO: "Norway",
  FR: "France",
  DE: "Germany",
  IT: "Italy",
  CH: "Switzerland",
  KR: "South Korea",
  ZA: "South Africa",
  FI: "Finland",
  BE: "Belgium",
};

const SERIES = {
  realPrice: (c) => `Q${c}R628BIS`,
  householdCredit: (c) => `Q${c}HAM770A`,
  privateCredit: (c) => `Q${c}PAM770A`,
  longRate: (c) => `IRLTLT01${c}M156N`,
  shortRate: (c) => `IR3TIB01${c}M156N`,
  unemployment: (c) => `LRHUTTTT${c}M156S`,
  cpi: (c) => `CPALTT01${c}M659N`,
};

const CACHE_DIR = path.join(root, "data", ".fred-cache");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * FRED rate-limits bursts. 133 requests fired as fast as Node can manage gets
 * most of them dropped, and a dropped request is NOT the same as a missing
 * series — treating it as one silently shrinks the panel, which is exactly the
 * kind of quiet data loss that produces a confident wrong answer later.
 *
 * So: pace the requests, back off exponentially on failure, and cache to disk so
 * re-runs cost nothing and stay polite.
 */
async function fetchSeries(id, attempt = 0) {
  const cached = path.join(CACHE_DIR, `${id}.csv`);
  try {
    const hit = await fs.readFile(cached, "utf8");
    if (hit.length > 40) return parseCsv(hit);
  } catch {
    // not cached yet
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
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cached, text, "utf8");
  await sleep(250);
  return parseCsv(text);
}

function parseCsv(text) {
  const rows = text
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => l.split(","))
    .filter(([, v]) => v && v !== ".")
    .map(([date, v]) => [date.slice(0, 7), Number(v)]);
  return rows.length >= 20 ? rows : null;
}

console.log(`Fetching ${Object.keys(COUNTRIES).length} countries x ${Object.keys(SERIES).length} series...`);

const countries = {};
for (const [code, name] of Object.entries(COUNTRIES)) {
  const entry = { name, series: {} };
  const fetched = [];
  for (const [key, fn] of Object.entries(SERIES)) {
    fetched.push([key, await fetchSeries(fn(code))]);
  }
  for (const [key, rows] of fetched) if (rows) entry.series[key] = rows;

  if (!entry.series.realPrice) {
    console.log(`  skip ${name} — no price series`);
    continue;
  }
  countries[code] = entry;
  const have = Object.keys(entry.series).length;
  const span = `${entry.series.realPrice[0][0]}..${entry.series.realPrice.at(-1)[0]}`;
  console.log(`  ${name.padEnd(16)} ${have}/${Object.keys(SERIES).length} series  ${span}`);
}

const payload = {
  generatedFrom: "https://fred.stlouisfed.org/ (BIS and OECD source series)",
  retrieved: new Date().toISOString().slice(0, 10),
  note: "Quarterly real residential property prices with credit and macro controls. See scripts/fetch-international.mjs for provenance.",
  countries,
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(payload), "utf8");

const bytes = (await fs.stat(OUT)).size;
const quarters = Object.values(countries).reduce((n, c) => n + c.series.realPrice.length, 0);
console.log(
  `\nWrote ${path.relative(root, OUT)} — ${Object.keys(countries).length} countries, ${quarters} country-quarters, ${(bytes / 1024).toFixed(0)}KB`
);
