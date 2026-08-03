/**
 * Regenerates lib/data/ca-loan-limits.ts from the FHFA's published county file.
 *
 * The FHFA publishes one authoritative flat file per year listing the conforming
 * loan limit for every county in the country. We pull the California rows out of
 * it rather than hand-copying numbers off a mortgage broker's blog.
 *
 *   npm run data:loan-limits
 *
 * If FHFA changes the URL (they rename it every year), update YEAR/SOURCE_URL.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const YEAR = 2026;
const SOURCE_URL = `https://www.fhfa.gov/document/FullCountyLoanLimitList${YEAR}_HERA-BASED_FINAL_FLAT.csv`;
const LANDING_PAGE = "https://www.fhfa.gov/data/conforming-loan-limit";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "lib", "data", "ca-loan-limits.ts");

const QUOTE = '"';

/** Minimal RFC 4180 parser. The FHFA file has quoted headers containing newlines. */
function parseCsv(s) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === QUOTE) {
        if (s[i + 1] === QUOTE) {
          field += QUOTE;
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === QUOTE) {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** "SAN LUIS OBISPO" -> "San Luis Obispo" */
function titleCase(s) {
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (m) => m.toUpperCase())
    .replace(/\bDe\b/g, "de");
}

const res = await fetch(SOURCE_URL);
if (!res.ok) {
  throw new Error(`FHFA returned ${res.status} for ${SOURCE_URL}. Check the URL. They rename this file yearly.`);
}
const rows = parseCsv(await res.text());
const header = rows[0].map((h) => h.replace(/\s+/g, " ").trim());
const idx = (name) => {
  const i = header.indexOf(name);
  if (i === -1) throw new Error(`Column "${name}" not found. Header is: ${header.join(" | ")}`);
  return i;
};

const iState = idx("State");
const iCounty = idx("County Name");
const iOne = idx("One-Unit Limit");

const counties = rows
  .slice(1)
  .filter((r) => r[iState] === "CA")
  .map((r) => ({
    name: titleCase(r[iCounty].replace(/\s+County$/i, "").trim()),
    oneUnit: Number(String(r[iOne]).replace(/[$,]/g, "")),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

if (counties.length !== 58) {
  throw new Error(`Expected 58 California counties, got ${counties.length}. Refusing to write a bad data file.`);
}

const baseline = Math.min(...counties.map((c) => c.oneUnit));
const ceiling = Math.max(...counties.map((c) => c.oneUnit));

const body = `// GENERATED FILE. Do not edit by hand.
// Regenerate with: npm run data:loan-limits
//
// Source: FHFA ${YEAR} conforming loan limits, one-unit properties.
//   ${LANDING_PAGE}
//   ${SOURCE_URL}
// Retrieved: ${new Date().toISOString().slice(0, 10)}
//
// A loan above the county limit is a jumbo: different underwriting, usually a
// larger down payment, and a rate that no longer tracks the conforming market.

export const LOAN_LIMIT_YEAR = ${YEAR};

/** The nationwide baseline. Every CA county is at least this. */
export const CONFORMING_BASELINE = ${baseline};

/** The statutory high-cost ceiling (150% of baseline). */
export const CONFORMING_CEILING = ${ceiling};

export const CA_COUNTY_LOAN_LIMITS = {
${counties.map((c) => `  ${JSON.stringify(c.name)}: ${c.oneUnit},`).join("\n")}
} as const;

export type CaCounty = keyof typeof CA_COUNTY_LOAN_LIMITS;

export const CA_COUNTIES = Object.keys(CA_COUNTY_LOAN_LIMITS) as CaCounty[];

/** Conforming ceiling for a county. Above this, you are shopping jumbo. */
export function conformingLimitFor(county: CaCounty): number {
  return CA_COUNTY_LOAN_LIMITS[county];
}
`;

await fs.writeFile(OUT, body, "utf8");
console.log(`Wrote ${counties.length} CA counties to ${path.relative(root, OUT)}`);
console.log(`  baseline ${baseline.toLocaleString("en-US")} / ceiling ${ceiling.toLocaleString("en-US")}`);
