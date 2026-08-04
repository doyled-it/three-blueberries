import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { CA_COUNTIES, conformingLimitFor, type CaCounty } from "../lib/data/ca-loan-limits.ts";
import { countyTaxRate, hasCountySpecificTaxRate, DEFAULT_COUNTY_TAX_RATE } from "../lib/data/ca-property.ts";
import { statutoryRentCap } from "../lib/data/ca-rent-cap.ts";
import { countyScope } from "../lib/county-scope.ts";
import { BUYING_POWER_CAVEAT, buyingPowerVerdict } from "../lib/buying-power.ts";
import { countyStanding, payTrap } from "../lib/where-it-works.ts";
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

test("every county gets its own price history, at the finest resolution that exists", () => {
  // The whole point of the selector. Every county used to be shown San Diego's
  // past with a note apologising for it.
  const places = new Set<string>();
  for (const county of CA_COUNTIES) {
    const scope = countyScope(county);
    assert.ok(scope.note.includes(county), `${county}'s note does not name it`);
    assert.ok([3, 12].includes(scope.stepMonths), `${county}: odd step ${scope.stepMonths}`);
    assert.ok(scope.place.length > 0, `${county} has no place name`);
    places.add(scope.place);
  }
  // Not one series wearing 58 hats.
  assert.ok(places.size >= 40, `only ${places.size} distinct series across 58 counties`);
  assert.ok(!countyScope("Fresno").note.includes("San Diego"), "Fresno must not be told about San Diego");
});

test("a metro county gets quarterly data and a rural one gets annual", () => {
  const metro = countyScope("San Diego");
  assert.equal(metro.stepMonths, 3);
  assert.match(metro.note, /quarterly/);
  assert.ok(metro.spliceMonth, "a metro series is chained, and the note should say so");
  assert.match(metro.note, /seam/);

  const rural = countyScope("Sierra");
  assert.equal(rural.stepMonths, 12);
  assert.match(rural.note, /annual/);
  assert.match(rural.note, /not inside a metropolitan area/);
});

test("REGRESSION: the buying-power verdict knows which way the number went", () => {
  // It only knew how to say "gone". Buying power is down 23% in San Diego and UP
  // 27% in Fresno, so half the state was being told "-27% of buying power gone".
  const falling = buyingPowerVerdict("San Diego");
  assert.ok(falling.powerLost > 0);
  assert.match(falling.headline, /buying power gone/);

  const rising = buyingPowerVerdict("Fresno");
  assert.ok(rising.powerLost < 0, "Fresno incomes have kept up with Fresno prices");
  assert.ok(!/gone/.test(rising.headline), `printed a loss for a county that gained: ${rising.headline}`);
  assert.match(rising.headline, /MORE/);
  assert.ok(!/-\d/.test(rising.headline), "no negative percentages in prose");
});

test("every county produces a complete, finite buying-power verdict", () => {
  for (const county of CA_COUNTIES) {
    const v = buyingPowerVerdict(county);
    assert.ok(Number.isFinite(v.powerLost), `${county}: powerLost is ${v.powerLost}`);
    assert.ok(v.headline.length > 80, `${county}: headline too short`);
    assert.ok(v.latest.yearsOfIncome > 0 && v.latest.yearsOfIncome < 40, `${county}: implausible years of income`);
    // The place name has to appear, or the reader cannot tell whose market it is.
    const { place } = countyScope(county);
    assert.ok(v.headline.includes(place), `${county}: headline does not name ${place}`);
  }
});

test("the pay trap is measured, not asserted", () => {
  // This is the sharpest claim on the site, so it is computed from the data
  // every time rather than written into prose that could drift from it.
  const trap = payTrap();
  assert.ok(trap.payVsMultiple > 0.5, `expected a strong positive, got ${trap.payVsMultiple}`);
  assert.ok(trap.payVsPrice > trap.payVsMultiple, "prices should track pay even harder than the multiple does");
  assert.ok(trap.bestPaying.medianIncome > trap.worstPaying.medianIncome * 1.5);
  assert.ok(
    trap.bestPaying.medianMultiple > trap.worstPaying.medianMultiple,
    "the better-paying counties must be the LESS affordable ones, which is the whole point"
  );
  assert.ok(trap.headline.includes(trap.bestPaying.medianMultiple.toFixed(1)));
});

test("every county has a local standing built from its own income", () => {
  for (const county of CA_COUNTIES) {
    const s = countyStanding(county);
    assert.ok(s.income > 30_000 && s.income < 250_000, `${county}: implausible income ${s.income}`);
    assert.ok(s.homeValue > 100_000 && s.homeValue < 5_000_000, `${county}: implausible value ${s.homeValue}`);
    assert.ok(s.yearsOfIncome > 1 && s.yearsOfIncome < 30, `${county}: ${s.yearsOfIncome}x is implausible`);
  }
  // Incomes must actually differ per county, or this is a statewide figure wearing a hat.
  assert.ok(new Set(CA_COUNTIES.map((c) => countyStanding(c).income)).size > 40);
});

test("REGRESSION: the statewide-income panel says it is statewide", () => {
  // buyingPowerSeries measures a STATEWIDE income against a LOCAL price, which
  // answers "could a typical Californian buy here", not "can the locals afford
  // it". Copy that blurred the two claimed incomes had kept up with prices in
  // Fresno, which this data cannot support.
  assert.match(BUYING_POWER_CAVEAT, /STATEWIDE/);
  const rising = buyingPowerVerdict("Fresno");
  assert.ok(!/incomes here have kept up/.test(rising.headline), "that claim needs local income, which that panel lacks");
  assert.match(rising.blueberries, /STATEWIDE/);
});
