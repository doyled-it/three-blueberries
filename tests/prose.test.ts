/**
 * The prose lint: every sentence the engine renders, checked against the data
 * that sentence is about, in all 58 counties.
 *
 * WHY. Three audits found the same defect class about ninety times: prose that
 * was true when written and went false when the data moved. The tests were green
 * throughout, because they asserted the wording against itself:
 *
 *     assert.match(preset.basis, /milder/i)      // passed for months
 *                                                // while wrong in 34 counties
 *
 * These checks are different in kind. They take what the engine actually renders
 * (see `prose-surface.ts`, which runs the engine rather than reading source) and
 * ask whether each claim is TRUE for the county it was rendered for. A sentence
 * is covered the moment it exists, so nobody has to remember to register it.
 *
 * Each check below corresponds to a defect that really shipped. Adding one is
 * cheap and the right response to finding a new failure mode.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { proseFor, type ProseItem } from "./prose-surface.ts";
import { CA_COUNTIES, type CaCounty } from "../lib/data/ca-loan-limits.ts";
import { historyFor, COUNTY_INCOME_YEAR } from "../lib/data/history.ts";
import { findDrawdowns, currentStatus, buildSeries, paymentExtremes } from "../lib/history.ts";
import { peakOfBubble, troughOfBust, worstTimeToBuy } from "../lib/signals.ts";
import { CA_MEDIAN_INCOME, SIGNALS_INCOME_LAST_YEAR } from "../lib/data/signals.ts";
import { buyingPowerVerdict } from "../lib/buying-power.ts";
import { FHA_LIMIT_YEAR, fhaLimitFor } from "../lib/data/ca-fha-limits.ts";

/**
 * Years a sentence may name without deriving them from the county.
 *
 * These are FIXED FACTS about the world or the programs, not facts about a
 * county's market, so they are the same in Modoc as in San Diego. Anything not
 * on this list has to be justified by the county's own data.
 */
const UNIVERSAL_YEARS = new Set([
  "1978", // Proposition 13
  "1982", // Mello-Roos Community Facilities Act
  "1990", // the early-90s recession, named as a national event
  "1991", // the FHFA expanded-data splice, and Japan
  "1998", // Homeowners Protection Act
  "2008", // the financial crisis, named as a national event
  "2009", // the crisis trough, named as a national event ("in 2009 lenders
          // went back to 20% down"). The per-county trough year is checked
          // separately in BOUNDARY_CLAIMS, since it is 2009 in only 4 counties.
  "2020", // AB 1482 and the pandemic refinance window
  "2021", // the end of the cheap-money window
  String(FHA_LIMIT_YEAR),
  String(COUNTY_INCOME_YEAR),
  SIGNALS_INCOME_LAST_YEAR,
  // The income series runs 1984 to 2024 and both ends are quoted by name. Read
  // from the data rather than written down, so a data refresh moves it.
  CA_MEDIAN_INCOME[0]![0].slice(0, 4),
]);

/** Years this specific county's own data justifies naming. */
function yearsTheDataSupports(county: CaCounty): Set<string> {
  const years = new Set(UNIVERSAL_YEARS);
  const { rows, spliceMonth } = historyFor(county);

  const add = (month: string | null | undefined) => {
    if (month) years.add(month.slice(0, 4));
  };

  add(rows[0]![0]);
  add(rows[rows.length - 1]![0]);
  add(spliceMonth);
  add(peakOfBubble(county));
  add(troughOfBust(county));
  add(currentStatus(36, county).recentPeakMonth);

  for (const drop of findDrawdowns(10, county)) {
    add(drop.peakMonth);
    add(drop.troughMonth);
    add(drop.recoveredMonth);
  }

  // The buying-power and cohort panels quote their own start years, and the
  // rent-vs-buy sets quote decade and twenty-year windows off the latest row.
  const latest = Number(rows[rows.length - 1]![0].slice(0, 4));
  for (const back of [10, 20]) years.add(String(latest - back));

  // A panel may name a month IT COMPUTED. These are not free passes: each is
  // the specific figure the sentence is about, so if the panel names a
  // different year than the one it derived, the check still fires.
  const worst = worstTimeToBuy(county);
  add(worst.worstEver.month);
  add(worst.bestEver.month);
  add(worst.latest.month);

  // The "price is not payment" caveat contrasts the dearest month to BUY with
  // the dearest month to OWN, and names both. They are usually different years,
  // which is the entire point of the sentence.
  const extremes = paymentExtremes(county);
  add(extremes.cheapest.month);
  add(extremes.priciest.month);
  add(extremes.latest.month);
  add(buildSeries(county).reduce((a, b) => (b.price > a.price ? b : a)).month);

  const power = buyingPowerVerdict(county);
  add(power.first.month);
  add(power.latest.month);
  add(power.best.month);
  add(power.worst.month);
  add(power.lastAffordableMonth);

  return years;
}

const YEAR_PATTERN = /\b(?:19|20)\d{2}\b/g;

const LOAN_TYPES = ["conventional", "fha", "va", "jumbo"] as const;

/**
 * Prose across every loan type, because some sentences only exist on one.
 *
 * The FHA county-limit note is a case in point: it renders only on FHA
 * scenarios, so a check that ran the default conventional scenario never saw
 * it, and a mutation swapping the FHA limit for the conforming one went
 * undetected. Both are valid dollar figures, so nothing else would have noticed.
 */
function allProse(county: CaCounty): Array<ProseItem & { loanType: string }> {
  return LOAN_TYPES.flatMap((loanType) =>
    proseFor(county, { loanType }).map((item) => ({ ...item, loanType }))
  );
}

test("no rendered sentence names a year the county's own data cannot justify", () => {
  const failures: string[] = [];

  for (const county of CA_COUNTIES) {
    const allowed = yearsTheDataSupports(county);
    for (const item of proseFor(county)) {
      for (const year of item.text.match(YEAR_PATTERN) ?? []) {
        if (allowed.has(year)) continue;
        failures.push(`${county} ${item.path}: names ${year}\n      "${excerpt(item.text, year)}"`);
      }
    }
  }

  assert.deepEqual(failures, [], `prose names years the data does not support:\n    ${failures.join("\n    ")}`);
});

/**
 * Counting words are the single most common way this breaks, because the count
 * was two in San Diego when the sentence was written. 17 counties have one
 * decline over 10% and 16 have three.
 */
test("no rendered sentence claims a count the county does not have", () => {
  const failures: string[] = [];

  for (const county of CA_COUNTIES) {
    const declines = findDrawdowns(10, county).length;
    for (const item of proseFor(county)) {
      const text = item.text;

      const claimsTwo = /\b(both|the two|two)\b[^.]{0,40}\bdeclines?\b/i.test(text);
      if (claimsTwo && declines !== 2) {
        failures.push(`${county} ${item.path}: says two declines, county has ${declines}`);
      }

      const claimsOnly = /\bthe only\b[^.]{0,40}\bdeclines?\b/i.test(text);
      if (claimsOnly && declines !== 1) {
        failures.push(`${county} ${item.path}: says the only decline, county has ${declines}`);
      }

      const explicit = /\b(?:all )?(\d+) declines\b/i.exec(text);
      if (explicit && Number(explicit[1]) !== declines) {
        failures.push(`${county} ${item.path}: says ${explicit[1]} declines, county has ${declines}`);
      }
    }
  }

  assert.deepEqual(failures, [], `prose miscounts declines:\n    ${failures.join("\n    ")}`);
});

/**
 * The series is quarterly in 37 counties and annual in the other 21. No county
 * has monthly rows, yet the history panel counted "consecutive monthly declines"
 * for years.
 */
test("no rendered sentence describes the series at a frequency it does not have", () => {
  const failures: string[] = [];

  for (const county of CA_COUNTIES) {
    const { stepMonths } = historyFor(county);
    const actual = stepMonths === 12 ? "annual" : "quarterly";

    for (const item of proseFor(county)) {
      for (const claimed of ["monthly", "quarterly", "annual"] as const) {
        if (claimed === actual) continue;
        // Narrow deliberately. A first draft matched any frequency word near
        // "data", which flagged countyScope's true statement that "FHFA
        // publishes quarterly data only for metros". A check that cries wolf
        // gets deleted, so this only matches the phrasing that actually broke:
        // COUNTING periods of this county's own series.
        const counting = new RegExp(
          `\\b(?:\\d+|no)\\s+(?:consecutive\\s+)?${claimed}\\s+(?:declines?|readings?|rows?)\\b`,
          "i"
        );
        if (counting.test(item.text)) {
          failures.push(`${county} ${item.path}: counts "${claimed}" periods of a ${actual} series`);
        }
      }
    }
  }

  assert.deepEqual(failures, [], `prose misstates the series frequency:\n    ${failures.join("\n    ")}`);
});

/** A sentence containing a broken number is worse than no sentence. */
test("no rendered sentence contains a broken value", () => {
  const failures: string[] = [];
  const BROKEN = /\b(NaN|Infinity|undefined|null)\b|\[object Object\]|\$NaN|\$undefined/;

  for (const county of CA_COUNTIES) {
    for (const loanType of ["conventional", "fha", "va", "jumbo"] as const) {
      for (const item of proseFor(county, { loanType })) {
        if (BROKEN.test(item.text)) {
          failures.push(`${county}/${loanType} ${item.path}: "${item.text.slice(0, 120)}"`);
        }
      }
    }
  }

  assert.deepEqual(failures, [], `prose renders broken values:\n    ${failures.join("\n    ")}`);
});

/**
 * "-27% of buying power gone" was printed to half the state, because the copy
 * only knew how to say "gone". A minus sign inside a figure that a word has
 * already given a direction to is the signature of that mistake.
 */
test("no rendered sentence pairs a directional word with a contradicting sign", () => {
  const failures: string[] = [];
  const CONTRADICTIONS: Array<[RegExp, string]> = [
    [/-\d[\d.,]*%\s*(?:of\s+)?[a-z ]{0,24}\b(?:gone|lost|fall(?:en)?|decline|drop)\b/i, "a negative loss is a gain"],
    [/\b(?:gained|more|rose|up)\b[^.]{0,20}-\d[\d.,]*%/i, "a negative gain is a loss"],
    [/\bdeclines? (?:of|by) -\d/i, "a negative decline is a rise"],
  ];

  for (const county of CA_COUNTIES) {
    for (const item of proseFor(county)) {
      for (const [pattern, why] of CONTRADICTIONS) {
        if (pattern.test(item.text)) {
          failures.push(`${county} ${item.path}: ${why}\n      "${item.text.slice(0, 160)}"`);
        }
      }
    }
  }

  assert.deepEqual(failures, [], `prose contradicts its own sign:\n    ${failures.join("\n    ")}`);
});

/**
 * A sentence naming a county must name the RIGHT county. Every panel is
 * county-aware now, and the way that regressed before was a default parameter
 * quietly supplying San Diego.
 */
test("no rendered sentence names a county other than the one it was rendered for", () => {
  const failures: string[] = [];
  // Ambiguous as bare words, or appearing legitimately in program names and
  // metro labels that span counties.
  const SKIP = new Set(["Orange", "Lake", "Imperial", "Alpine", "Sierra", "Napa", "Marin"]);
  const candidates = CA_COUNTIES.filter((c) => !SKIP.has(c));

  for (const county of CA_COUNTIES) {
    const { place } = historyFor(county);
    for (const item of proseFor(county)) {
      for (const other of candidates) {
        if (other === county) continue;
        if (!new RegExp(`\\b${other}\\b`).test(item.text)) continue;
        // A metro series legitimately names the counties in its title.
        if (place.includes(other)) continue;
        failures.push(`${county} ${item.path}: names ${other}\n      "${excerpt(item.text, other)}"`);
      }
    }
  }

  assert.deepEqual(failures, [], `prose names the wrong county:\n    ${failures.join("\n    ")}`);
});

/**
 * Some claims name a year that is legitimate SOMEWHERE, so the year-level check
 * above cannot see them. "The record starts in 1984" is right in 47 counties and
 * wrong in the 11 whose price series begins later, and 1984 is a real year in
 * the data either way. Those need the claim checked against the specific figure
 * it is about.
 *
 * This is the pattern to copy when a new hardcoded claim slips through: name the
 * phrasing, name the figure it must equal.
 */
const BOUNDARY_CLAIMS: Array<{
  what: string;
  pattern: RegExp;
  actual: (county: CaCounty) => string;
}> = [
  {
    // "FHA caps your loan at $541,287 in Fresno County". The conforming limit
    // is also a valid dollar figure, so nothing else here would notice the
    // wrong one being quoted.
    what: "the FHA county loan limit",
    pattern: /\bFHA caps your loan at \$([\d,]+)\b/,
    actual: (county) => fhaLimitFor(county).toLocaleString("en-US"),
  },
  {
    what: "the year the affordability record starts",
    // "The record starts in 1984" / "the record runs from 1984"
    pattern: /\b(?:record|series|panel)\b[^.]{0,24}\b(?:starts?|begins?|runs?)\b[^.]{0,16}?\b((?:19|20)\d{2})\b/i,
    actual: (county) => buyingPowerVerdict(county).first.month.slice(0, 4),
  },
  {
    // "the 2009 trough took it back to 6.1x". It is not 2009 in 54 counties.
    what: "the year of the bust trough",
    pattern: /\bthe ((?:19|20)\d{2}) trough\b/i,
    actual: (county) => troughOfBust(county).slice(0, 4),
  },
  {
    // "20% MORE than it cost at the 2006 peak". It is not 2006 in 18 counties.
    what: "the year of the bubble peak",
    pattern: /\bat the ((?:19|20)\d{2}) peak\b/i,
    actual: (county) => peakOfBubble(county).slice(0, 4),
  },
  {
    what: "the year the price history starts",
    pattern: /\bFHFA index for [^.]{0,60}?,\s*(?:quarterly|annual),\s*from ((?:19|20)\d{2})\b/i,
    actual: (county) => historyFor(county).rows[0]![0].slice(0, 4),
  },
];

test("no rendered sentence hardcodes a figure that varies by county", () => {
  const failures: string[] = [];

  for (const county of CA_COUNTIES) {
    for (const item of allProse(county)) {
      for (const claim of BOUNDARY_CLAIMS) {
        const match = claim.pattern.exec(item.text);
        if (!match) continue;
        const expected = claim.actual(county);
        if (match[1] !== expected) {
          failures.push(
            `${county}/${item.loanType} ${item.path}: says ${claim.what} is ${match[1]}, it is ${expected}\n      "${excerpt(item.text, match[1]!)}"`
          );
        }
      }
    }
  }

  assert.deepEqual(failures, [], `prose hardcodes a boundary year:\n    ${failures.join("\n    ")}`);
});

/** Show the offending phrase rather than the whole paragraph. */
function excerpt(text: string, needle: string): string {
  const at = text.indexOf(needle);
  if (at < 0) return text.slice(0, 140);
  return `...${text.slice(Math.max(0, at - 60), at + needle.length + 60).trim()}...`;
}

test("the prose surface actually covers the panels", () => {
  // A collector that silently stopped returning anything would make every check
  // above pass while testing nothing.
  const items: ProseItem[] = proseFor("San Diego");
  assert.ok(items.length > 60, `only ${items.length} strings collected`);

  for (const panel of [
    "lines[",
    "warnings[",
    "qualification.notes[",
    "signals.readings[",
    "crashPresets[",
    "buyingPower.",
    "payTrap.",
    "countyScope.note",
    "rentVsBuy.",
    "recommendation.",
  ]) {
    assert.ok(
      items.some((i) => i.path.startsWith(panel)),
      `the surface no longer covers ${panel}`
    );
  }
});

// ---------------------------------------------------------------------------
// The browser layer, which the runtime surface cannot reach
// ---------------------------------------------------------------------------

/**
 * `src/client/app.ts` needs a DOM, so its strings cannot be collected by running
 * it. That is a real hole: "N consecutive monthly declines" lived there, on a
 * series with no monthly rows, and the runtime lint above would never see it.
 *
 * So the browser layer gets a static lint instead. Narrow on purpose. It looks
 * only for the specific shapes that have actually shipped as bugs, because a
 * broad source-text check produces false positives against code and dies of
 * neglect.
 */
test("the browser layer hardcodes nothing that varies by county", () => {
  const sources = [
    ["src/client/app.ts", fs.readFileSync("src/client/app.ts", "utf8")],
    ["src/index.njk", fs.readFileSync("src/index.njk", "utf8")],
  ] as const;

  const BANNED: Array<{ what: string; pattern: RegExp }> = [
    {
      what: "a frequency word describing this series, which is quarterly or annual and never monthly",
      // Proximity, not adjacency. The original bug was written
      // `monthly ${n === 1 ? "decline" : "declines"}`, so the noun sits INSIDE
      // an interpolation and no adjacent-word pattern can see it. Two earlier
      // attempts missed it for exactly that reason.
      pattern: /\b(?:consecutive\s+)?monthly\b[\s\S]{0,120}?\b(?:declines?|readings?|rows?)\b/i,
    },
    {
      what: "a hardcoded peak or trough year, which differs in 18 and 54 counties respectively",
      pattern: /\b(?:19|20)\d{2}\s+(?:peak|trough|bottom)\b/i,
    },
    {
      what: "a hardcoded county name in user-visible copy",
      // Must be a SENTENCE, not a bare literal. `c === "San Diego"` selects the
      // default option in the county picker and is perfectly correct; the thing
      // being hunted is a county name embedded in prose. Requiring three words
      // of surrounding text separates the two.
      pattern: /["'`][^"'`]*\b(?:San Diego|Fresno|Los Angeles)\b[^"'`]*?(?:\s+\w+){3,}[^"'`]*["'`]/,
    },
    {
      what: "a hardcoded decline count, which is one in 17 counties and three in 16",
      pattern: /\b(?:both|two or three)\s+(?:prior\s+|real\s+)?declines\b/i,
    },
  ];

  /**
   * The only permitted hardcoded county mentions, each with the reason it is
   * correct. Default is deny: anything not listed here fails, so an exception
   * has to be argued for rather than assumed.
   *
   * A registry works HERE, where it would not work for prose generally,
   * because it is tiny and the lint fails when something is missing from it.
   * Nobody has to remember to add an entry; the test makes them.
   */
  const ALLOWED: Array<{ phrase: RegExp; because: string }> = [
    {
      phrase: /San Diego scored as of/,
      because: "the forecaster is trained on Case-Shiller and genuinely produces only a San Diego number",
    },
    {
      phrase: /produces a number for San Diego only, so it does not follow the county selector/,
      because: "the same fact, disclosed to the reader in the panel's own copy",
    },
  ];

  const failures: string[] = [];
  for (const [file, text] of sources) {
    // Strip comments: they explain why these mistakes are not being made, and
    // that explanation is the reason they stay unmade.
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\{#[\s\S]*?#\}/g, "");

    for (const { what, pattern } of BANNED) {
      const match = pattern.exec(code);
      if (!match) continue;
      if (ALLOWED.some((a) => a.phrase.test(match[0]))) continue;
      // Locate against the ORIGINAL text, since stripping comments shifted the
      // offsets and reported a line ~65 rows away from the real one.
      const at = text.indexOf(match[0]);
      const line = at < 0 ? "unknown" : text.slice(0, at).split("\n").length;
      failures.push(`${file}: ${what}\n      "${match[0].slice(0, 120)}" (line ${line})`);
    }
  }

  assert.deepEqual(failures, [], `the browser layer hardcodes county-specific facts:\n    ${failures.join("\n    ")}`);
});

// ---------------------------------------------------------------------------
// Two findings from the consistency audit, pinned against the source they live
// in. Both flattered the thesis: a chart described as inflation-adjusted when
// it is nominal, and a verdict hardcoded to the failure colour.
// ---------------------------------------------------------------------------

test("no chart claims to be inflation-adjusted, because buildSeries is nominal", () => {
  // Comments stripped first: the fix's own comment explains why this phrasing is
  // wrong, and that explanation is the reason it stays gone.
  const app = fs
    .readFileSync("src/client/app.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  // buildSeries applies no CPI term. Any description promising real dollars is
  // overstating the rise.
  assert.ok(
    !/scaled to today's dollars/.test(app),
    "a nominal series must not be described as scaled to today's dollars"
  );
});

test("the buying-power headline is not hardcoded to a verdict colour", () => {
  const njk = fs.readFileSync("src/index.njk", "utf8");
  const app = fs.readFileSync("src/client/app.ts", "utf8");
  // The template must not bake in a colour, because buying power rose in 34
  // counties and a static verdict--no painted those "MORE" headlines red.
  assert.ok(
    !/id="buyingPowerHeadline"[^>]*verdict--(?:no|yes)/.test(njk),
    "buyingPowerHeadline must not carry a hardcoded verdict class"
  );
  // And app.ts must set it from the sign of powerLost.
  assert.ok(
    /buyingPowerHeadline"\)\.className\s*=\s*`verdict \$\{v\.powerLost/.test(app),
    "the headline colour must be derived from v.powerLost"
  );
});
