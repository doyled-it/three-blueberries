import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { CA_COUNTIES, conformingLimitFor, type CaCounty } from "../lib/data/ca-loan-limits.ts";
import { countyTaxRate, hasCountySpecificTaxRate, DEFAULT_COUNTY_TAX_RATE } from "../lib/data/ca-property.ts";
import { statutoryRentCap } from "../lib/data/ca-rent-cap.ts";
import { METRO_CORRELATION, countyScopeNote } from "../lib/county-scope.ts";
import { evaluateScenario } from "../lib/mortgage.ts";
import { maxAffordablePrice } from "../lib/affordability.ts";
import { bridgeScenario } from "../lib/scenario-bridge.ts";
import { compareRentVsBuy, decide, maxPriceForHoldPeriod } from "../lib/rent-vs-buy.ts";
import type { ScenarioInput } from "../lib/types.ts";

/**
 * The county selector is at the top of the form, so every one of the 58 has to
 * work, not just the one this was built against. The failure mode is silent:
 * a hardcoded San Diego constant produces a plausible number for Fresno rather
 * than an error, and nothing looks wrong.
 */

const MARKET = { monthlyRent: 2_400, homeAppreciation: 0.0543, rentGrowth: 0.035, investmentReturn: 0.1 };

function input(county: CaCounty): ScenarioInput {
  return {
    purchasePrice: 750_000,
    downPayment: { kind: "amount", value: 100_000 },
    loanType: "conventional",
    termYears: 30,
    interestRate: 0.0666,
    creditScore: 740,
    county,
    claimHomeownersExemption: true,
    hoaMonthly: 0,
    melloRoosAnnual: 0,
    household: { grossAnnualIncomes: [180_000], monthlyDebts: 500, size: 2 },
  } as ScenarioInput;
}

test("every California county produces a complete, finite scenario", () => {
  assert.equal(CA_COUNTIES.length, 58, "California has 58 counties");

  for (const county of CA_COUNTIES) {
    const scenario = input(county);
    const result = evaluateScenario(scenario);

    for (const [label, value] of [
      ["lender total", result.lenderMonthlyTotal],
      ["true total", result.trueMonthlyTotal],
      ["cash to close", result.cashToClose.total],
      ["conforming limit", conformingLimitFor(county)],
      ["affordability", maxAffordablePrice(scenario).maxPurchasePrice],
    ] as const) {
      assert.ok(Number.isFinite(value) && value >= 0, `${county}: ${label} is ${value}`);
    }
    assert.ok(result.lines.length > 0, `${county}: no line items`);
    assert.ok(result.trueMonthlyTotal >= result.lenderMonthlyTotal, `${county}: true total below lender total`);
  }
});

test("every county runs the whole rent-versus-buy surface without a hole in it", () => {
  for (const county of CA_COUNTIES) {
    const scenario = input(county);
    const bridge = bridgeScenario(scenario, evaluateScenario(scenario), MARKET);
    const r = compareRentVsBuy(bridge.itemised);

    assert.equal(r.years.length, 30, `${county}: short series`);
    for (const y of r.years) {
      assert.ok(Number.isFinite(y.buyNetWorth) && Number.isFinite(y.rentNetWorth), `${county}: year ${y.year} is NaN`);
    }
    const ceiling = maxPriceForHoldPeriod(bridge.base, bridge.costs, 10, bridge.downPercent, bridge.closingCostRate);
    assert.ok(ceiling === null || Number.isFinite(ceiling), `${county}: ceiling is ${ceiling}`);

    const d = decide({
      base: bridge.base,
      costs: bridge.costs,
      price: scenario.purchasePrice,
      holdYears: 10,
      downPercent: bridge.downPercent,
      closingCostRate: bridge.closingCostRate,
    });
    assert.ok(d.verdict.length > 0, `${county}: empty verdict`);
    assert.equal(d.levers.length, 4, `${county}: missing a lever`);
  }
});

test("the property tax rate follows the county, and says so when it is a guess", () => {
  const specific = CA_COUNTIES.filter(hasCountySpecificTaxRate);
  assert.ok(specific.length >= 20, "we should have real rates for the populous counties");
  assert.ok(specific.includes("San Diego") && specific.includes("Los Angeles"));

  // Distinct rates, not one rate wearing 58 hats.
  const rates = new Set(specific.map(countyTaxRate));
  assert.ok(rates.size >= 5, "county rates should actually differ");

  for (const county of CA_COUNTIES) {
    const rate = countyTaxRate(county);
    assert.ok(rate >= 0.01 && rate <= 0.02, `${county}: ${rate} is not a plausible California ad valorem rate`);
    if (!hasCountySpecificTaxRate(county)) assert.equal(rate, DEFAULT_COUNTY_TAX_RATE);
  }
});

test("REGRESSION: a county without a rate on file says so rather than quietly guessing", () => {
  // The whole point of the project. An unflagged fallback is a fabrication.
  const guessed = CA_COUNTIES.find((c) => !hasCountySpecificTaxRate(c))!;
  const warnings = evaluateScenario(input(guessed)).warnings.join(" ");
  assert.match(warnings, new RegExp(guessed), `no warning names ${guessed}`);
  assert.match(warnings, /statewide fallback/i);

  const known = evaluateScenario(input("San Diego")).warnings.join(" ");
  assert.ok(!/statewide fallback/i.test(known), "San Diego has a rate, so it must not claim otherwise");
});

test("REGRESSION: the rent cap follows the county, since it is a regional figure", () => {
  // The cap was San Diego's 8.2% for everybody. It is 8.8% in Alameda, and
  // stating a statutory ceiling wrongly is worse than not stating one.
  const caps = new Set(CA_COUNTIES.map(statutoryRentCap));
  assert.ok(caps.size >= 4, "at least four distinct regional caps should exist");
  assert.notEqual(statutoryRentCap("Alameda"), statutoryRentCap("San Diego"));
});

test("the county scope note appears for every county except the one the data is from", () => {
  assert.equal(countyScopeNote("San Diego"), null, "no note is needed when the data is yours");
  for (const county of CA_COUNTIES.filter((c) => c !== "San Diego")) {
    const note = countyScopeNote(county)!;
    assert.ok(note, `${county} has no scope note`);
    assert.ok(note.includes(county), `${county}'s note does not name it`);
    assert.match(note, /San Diego/, `${county}'s note does not say whose data this is`);
  }
});

test("REGRESSION: the quoted metro correlations are the measured ones", () => {
  // They are stated on the page as a reason to trust the shape of San Diego's
  // history elsewhere in California. Recompute them from the panel rather than
  // trusting a number somebody typed once.
  const panel = JSON.parse(fs.readFileSync(new URL("../data/panel.json", import.meta.url), "utf8")) as {
    metros: Record<string, { name: string; series: [string, number][] }>;
  };

  const yearOnYear = (series: [string, number][]) => {
    const byMonth = new Map(series);
    const out = new Map<string, number>();
    for (const [month, value] of series) {
      const [y, m] = month.split("-");
      const previous = byMonth.get(`${Number(y) - 1}-${m}`);
      if (previous) out.set(month, value / previous - 1);
    }
    return out;
  };

  const pearson = (a: Map<string, number>, b: Map<string, number>) => {
    const months = [...a.keys()].filter((m) => b.has(m));
    const xs = months.map((m) => a.get(m)!);
    const ys = months.map((m) => b.get(m)!);
    const mean = (v: number[]) => v.reduce((s, n) => s + n, 0) / v.length;
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i]! - mx) * (ys[i]! - my);
      dx += (xs[i]! - mx) ** 2;
      dy += (ys[i]! - my) ** 2;
    }
    return { r: num / Math.sqrt(dx * dy), n: months.length };
  };

  const sd = yearOnYear(panel.metros["SDXRSA"]!.series);
  const la = pearson(sd, yearOnYear(panel.metros["LXXRSA"]!.series));
  const sf = pearson(sd, yearOnYear(panel.metros["SFXRSA"]!.series));

  assert.ok(
    Math.abs(la.r - METRO_CORRELATION.losAngeles) < 0.01,
    `Los Angeles measures ${la.r.toFixed(3)}, the page says ${METRO_CORRELATION.losAngeles}`
  );
  assert.ok(
    Math.abs(sf.r - METRO_CORRELATION.sanFrancisco) < 0.01,
    `San Francisco measures ${sf.r.toFixed(3)}, the page says ${METRO_CORRELATION.sanFrancisco}`
  );
  assert.ok(
    Math.abs(la.n - METRO_CORRELATION.observations) <= 12,
    `${la.n} observations, the page says ${METRO_CORRELATION.observations}`
  );

  // And the California claim needs the contrast: these are not just "housing
  // correlates with housing".
  const elsewhere = ["SEXRSA", "NYXRSA", "CHXRSA", "PHXRSA"].map((k) => pearson(sd, yearOnYear(panel.metros[k]!.series)).r);
  assert.ok(
    Math.max(...elsewhere) < la.r - 0.15,
    "the California metros must be meaningfully closer than out-of-state ones"
  );
});
