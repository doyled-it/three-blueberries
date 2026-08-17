import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { CA_COUNTIES, conformingLimitFor, type CaCounty } from "../lib/data/ca-loan-limits.ts";
import {
  CA_FHA_LIMITS,
  FHA_NATIONAL_CEILING,
  FHA_NATIONAL_FLOOR,
  fhaLimitFor,
} from "../lib/data/ca-fha-limits.ts";
import { countyTaxRate, hasCountySpecificTaxRate, DEFAULT_COUNTY_TAX_RATE } from "../lib/data/ca-property.ts";
import { statutoryRentCap } from "../lib/data/ca-rent-cap.ts";
import { countyScope } from "../lib/county-scope.ts";
import { BUYING_POWER_CAVEAT, buyingPowerCaveat, buyingPowerVerdict } from "../lib/buying-power.ts";
import { crashSignals, leadingIndicators } from "../lib/signals.ts";
import { crashPresets, findDrawdowns } from "../lib/history.ts";
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
  assert.match(metro.note, /chain-linked|seam/);

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

// ---------------------------------------------------------------------------
// No county may be shown another county's numbers or another county's prose.
//
// An audit that executed the code rather than reading it found the same class of
// bug in six separate panels: a string written when San Diego was the only
// county, still printed to all 58. These pin the ones that were fixed.
// ---------------------------------------------------------------------------

test("no signal reading names a year that is not this county's own peak or trough", () => {
  for (const county of CA_COUNTIES) {
    const { readings, peakMonth, troughMonth } = crashSignals(county);
    const peakYear = peakMonth.slice(0, 4);
    const troughYear = troughMonth.slice(0, 4);
    for (const r of readings) {
      for (const year of r.reading.match(/\b(19|20)\d{2}\b/g) ?? []) {
        assert.ok(
          year === peakYear || year === troughYear || year === "1990" || year === "2008",
          `${county}/${r.key} names ${year}; its peak is ${peakYear} and its trough is ${troughYear}`
        );
      }
    }
  }
});

test("the overlapping-window caveat quotes a sample size the indicators produce", () => {
  for (const county of CA_COUNTIES) {
    const { caveats } = crashSignals(county);
    const quoted = caveats.find((c) => /overlapping/i.test(c));
    assert.ok(quoted, `${county} lost its overlapping-window caveat`);
    const n = leadingIndicators(24, county)[0]!.observations;
    assert.match(quoted!, new RegExp(`\\b${n}\\b`), `${county} quotes an n no indicator produces`);
  }
});

test("crash presets and the history panel are the same county's", () => {
  for (const county of CA_COUNTIES) {
    const presets = crashPresets(county);
    const worst = Math.min(...findDrawdowns(10, county).map((d) => d.depthPercent));
    const severe = presets.find((p) => p.id === "severe") ?? presets.find((p) => p.id === "mild")!;
    assert.equal(
      severe.depthPercent,
      Math.round(Math.abs(worst)),
      `${county}'s worst preset is not its worst decline`
    );
  }
});

test("the buying-power caveat states the county's own start year", () => {
  for (const county of CA_COUNTIES) {
    const caveat = buyingPowerCaveat(county);
    const start = buyingPowerVerdict(county).first.month.slice(0, 4);
    assert.match(caveat, new RegExp(`The record starts in ${start}`), `${county} caveat has the wrong start year`);
  }
});

test("REGRESSION: the caveat never claims the anchor is free of consequences", () => {
  const caveat = buyingPowerCaveat();
  assert.ok(
    !/anchor moves the dollar axis and nothing else/i.test(caveat),
    "only the price line is anchored, so the anchor moves every dollar figure and the last-affordable date"
  );
  assert.match(caveat, /the anchor moves the GAP/);
});

test("VA borrowers are judged on residual income, not on the 41% guideline", () => {
  // 45.2% DTI, but residual income clears comfortably. VA approves this.
  const result = evaluateScenario({
    ...input("San Diego"),
    loanType: "va",
    purchasePrice: 900_000,
    downPayment: { kind: "amount", value: 0 },
    va: { firstUse: true, disabilityExempt: false, financeFundingFee: true },
    household: { grossAnnualIncomes: [200_000], monthlyDebts: 600, size: 3 },
    squareFeet: 1500,
  });
  assert.ok(result.qualification.backEndDti > 0.41, "the setup needs to exceed the guideline");
  assert.ok(result.qualification.residualIncome!.passes, "and clear residual income");
  assert.ok(result.qualification.passesDti, "so the engine must not fail it");
  assert.ok(result.qualification.dtiIsGuideline);
  // And it must not demand more income than the household already earns.
  assert.ok(
    result.qualification.incomeRequiredAnnual < 200_000,
    `asked for ${result.qualification.incomeRequiredAnnual} from a household earning 200,000`
  );
});

test("an FHA loan is never called a jumbo", () => {
  for (const county of ["San Diego", "Fresno", "Los Angeles"] as const) {
    const result = evaluateScenario({
      ...input(county),
      loanType: "fha",
      purchasePrice: 900_000,
      downPayment: { kind: "percent", value: 0.035 },
      fha: { financeUpfrontMip: true },
    });
    for (const w of result.warnings) {
      // The only permitted use of the word is the disclaimer itself.
      if (!/jumbo/i.test(w)) continue;
      assert.match(w, /not a jumbo/i, `${county}: FHA loan warned about being a jumbo`);
    }
  }
});

// ---------------------------------------------------------------------------
// FHA's limits are HUD's, not FHFA's
// ---------------------------------------------------------------------------

test("every county has an FHA limit inside HUD's published floor and ceiling", () => {
  assert.equal(Object.keys(CA_FHA_LIMITS).length, 58);
  for (const county of CA_COUNTIES) {
    const entry = CA_FHA_LIMITS[county];
    assert.ok(entry, `${county} has no FHA limit`);
    assert.ok(
      entry.limit >= FHA_NATIONAL_FLOOR && entry.limit <= FHA_NATIONAL_CEILING,
      `${county}: $${entry.limit} is outside HUD's published band`
    );
    // 'Standard' means the county is AT the floor. Anything else is a misparse.
    if (!entry.highCost) assert.equal(entry.limit, FHA_NATIONAL_FLOOR, `${county} is typed Standard`);
  }
});

// The engine used to check FHA loans against the conforming table. In 30
// counties FHA's limit is LOWER, and in Stanislaus it is lower by $287,650, so
// that overstated what FHA will insure by more than a quarter of a million.
test("REGRESSION: the FHA limit is never read off the conforming table", () => {
  const differs = CA_COUNTIES.filter((c) => fhaLimitFor(c) !== conformingLimitFor(c));
  assert.ok(differs.length > 25, `expected the two tables to diverge widely, got ${differs.length}`);
  assert.equal(fhaLimitFor("Stanislaus"), 545_100);
  assert.equal(conformingLimitFor("Stanislaus"), 832_750);

  // A loan that clears conforming and fails FHA must say so, and must not say
  // "jumbo" while doing it.
  const result = evaluateScenario({
    ...input("Stanislaus"),
    loanType: "fha",
    purchasePrice: 800_000,
    downPayment: { kind: "percent", value: 0.035 },
    fha: { financeUpfrontMip: true },
  });
  assert.ok(result.loan.exceedsFhaLimit);
  assert.ok(!result.loan.exceedsConformingLimit, "this loan is under the conforming limit");
  const warning = result.warnings.find((w) => /FHA's \$545,100 limit/.test(w));
  assert.ok(warning, "must warn that the loan is over FHA's own county limit");
  assert.ok(!/jumbo/i.test(warning!) || /not a jumbo/i.test(warning!));
});

test("an FHA loan under its county limit gets no limit warning at all", () => {
  const result = evaluateScenario({
    ...input("Los Angeles"),
    loanType: "fha",
    purchasePrice: 900_000,
    downPayment: { kind: "percent", value: 0.035 },
    fha: { financeUpfrontMip: true },
  });
  assert.equal(fhaLimitFor("Los Angeles"), FHA_NATIONAL_CEILING);
  assert.ok(!result.loan.exceedsFhaLimit);
  assert.ok(!result.warnings.some((w) => /limit/i.test(w) && /FHA/.test(w)));
});

// The search only ever tested income, so an FHA borrower with plenty of it was
// told they could buy a house FHA will not finance. Fresno on $200,000 reported
// $882,000 against a limit that tops out around $561,000 of house.
test("REGRESSION: the affordability search treats the FHA limit as a hard stop", () => {
  const base: ScenarioInput = {
    ...input("Fresno"),
    loanType: "fha",
    downPayment: { kind: "percent", value: 0.035 },
    fha: { financeUpfrontMip: true },
    household: { grossAnnualIncomes: [200_000], monthlyDebts: 400, size: 2 },
  };

  const afford = maxAffordablePrice(base);
  assert.ok(!afford.scenario.loan.exceedsFhaLimit, "the answer must be financeable with an FHA loan");
  assert.equal(afford.bindingConstraint, "fha-limit");
  assert.ok(
    afford.maxPurchasePrice < 600_000,
    `FHA caps Fresno around $561k of house, got $${afford.maxPurchasePrice}`
  );
  assert.ok(
    afford.warnings.some((w) => /capped by FHA's/.test(w)),
    "must say the cap is the program's, not the household's"
  );

  // The same household on a conventional loan is limited by income instead, and
  // can go considerably higher. That contrast is the point.
  const conventional = maxAffordablePrice({ ...base, loanType: "conventional" });
  assert.equal(conventional.bindingConstraint, "dti");
  assert.ok(conventional.maxPurchasePrice > afford.maxPurchasePrice);
});

test("every county's FHA affordability answer is actually financeable", () => {
  for (const county of CA_COUNTIES) {
    const afford = maxAffordablePrice({
      ...input(county),
      loanType: "fha",
      downPayment: { kind: "percent", value: 0.035 },
      fha: { financeUpfrontMip: true },
      household: { grossAnnualIncomes: [400_000], monthlyDebts: 0, size: 1 },
    });
    assert.ok(
      afford.scenario.loan.baseLoanAmount <= fhaLimitFor(county),
      `${county}: search returned a $${afford.maxPurchasePrice} answer whose loan exceeds FHA's $${fhaLimitFor(county)}`
    );
  }
});

test("every county's FHA note describes that county's actual situation", () => {
  for (const county of CA_COUNTIES) {
    const result = evaluateScenario({
      ...input(county),
      loanType: "fha",
      purchasePrice: 500_000,
      downPayment: { kind: "percent", value: 0.035 },
      fha: { financeUpfrontMip: true },
    });
    const note = result.qualification.notes.find((n) => /FHA caps your loan/.test(n));
    assert.ok(note, `${county} has no FHA limit note`);

    const limit = fhaLimitFor(county);
    const conforming = conformingLimitFor(county);

    // It must not claim a difference from conforming that does not exist, and
    // must not claim they match when they do not.
    if (limit === conforming) assert.match(note!, /happens to match the conforming limit/);
    else assert.match(note!, /SEPARATE limit/);

    // The 115%-of-median explanation is only true between the two bounds.
    if (limit >= FHA_NATIONAL_CEILING) assert.match(note!, /national ceiling/);
    else if (limit <= FHA_NATIONAL_FLOOR) assert.match(note!, /national floor/);
    else assert.match(note!, /115% of the county's median/);
  }
});
