import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FAIR_PLAN_AS_OF,
  FAIR_PLAN_BY_COUNTY,
  FAIR_PLAN_STATEWIDE_AVERAGE,
} from "../lib/data/ca-insurance.ts";
import { FAIR_PLAN_SEVERE_SHARE, fairPlanRisk, worstFairPlanCounties } from "../lib/insurance.ts";
import { CA_COUNTIES, type CaCounty } from "../lib/data/ca-loan-limits.ts";
import { SOURCES } from "../lib/data/sources.ts";
import { evaluateScenario } from "../lib/mortgage.ts";
import type { ScenarioInput } from "../lib/types.ts";

function input(county: CaCounty, overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    purchasePrice: 750_000,
    downPayment: { kind: "amount", value: 150_000 },
    loanType: "conventional",
    termYears: 30,
    interestRate: 0.0666,
    creditScore: 740,
    county,
    claimHomeownersExemption: true,
    hoaMonthly: 0,
    melloRoosAnnual: 0,
    household: { grossAnnualIncomes: [180_000], monthlyDebts: 0, size: 2 },
    ...overrides,
  } as ScenarioInput;
}

test("the FAIR Plan table covers every county and is internally sane", () => {
  assert.equal(Object.keys(FAIR_PLAN_BY_COUNTY).length, 58);

  for (const county of CA_COUNTIES) {
    const row = FAIR_PLAN_BY_COUNTY[county];
    assert.ok(row, `${county} is missing`);
    assert.ok(row.policies > 0, `${county}: no policies at all is implausible`);
    assert.ok(row.detachedUnits > row.policies, `${county}: more FAIR Plan policies than detached homes`);
    assert.ok(row.share > 0 && row.share < 1, `${county}: share of ${row.share}`);
    assert.ok(
      Math.abs(row.share - row.policies / row.detachedUnits) < 1e-4,
      `${county}: the share does not match its own numerator and denominator`
    );
    // A California fire-only policy below $300 or above $20,000 on average would
    // mean the parse picked up the wrong column.
    assert.ok(row.averagePremium > 300 && row.averagePremium < 20_000, `${county}: $${row.averagePremium} average`);
    if (row.highRiskPremium !== null) {
      assert.ok(row.highRiskPremium > 300 && row.highRiskPremium < 30_000, `${county}: $${row.highRiskPremium} high`);
    }
  }
});

test("the spread across counties is the whole reason this data is here", () => {
  const premiums = CA_COUNTIES.map((c) => FAIR_PLAN_BY_COUNTY[c].averagePremium);
  const shares = CA_COUNTIES.map((c) => FAIR_PLAN_BY_COUNTY[c].share);

  // A statewide figure hides a tenfold range in price and a hundredfold range
  // in the odds of needing it.
  assert.ok(Math.max(...premiums) / Math.min(...premiums) > 5, "premiums should vary by more than 5x");
  assert.ok(Math.max(...shares) / Math.min(...shares) > 50, "penetration should vary by more than 50x");
  assert.ok(
    FAIR_PLAN_STATEWIDE_AVERAGE > Math.min(...premiums) && FAIR_PLAN_STATEWIDE_AVERAGE < Math.max(...premiums),
    "the statewide mean must sit inside the county range"
  );
});

test("the banding escalates with the share, and the worst counties are the wildfire ones", () => {
  for (const county of CA_COUNTIES) {
    const risk = fairPlanRisk(county);
    if (risk.share >= FAIR_PLAN_SEVERE_SHARE) assert.equal(risk.level, "severe", county);
  }

  const worst = worstFairPlanCounties(5).map((r) => r.county);
  // Sierra foothills and Gold Country. If a Central Valley or coastal urban
  // county ever tops this list, the parse has gone wrong.
  for (const county of worst) {
    assert.ok(
      ["Tuolumne", "Nevada", "Calaveras", "Mariposa", "Alpine", "Amador", "El Dorado", "Plumas", "Sierra"].includes(
        county
      ),
      `${county} at the top of the FAIR Plan list is suspicious`
    );
  }
  assert.ok(!worst.includes("Sacramento") && !worst.includes("San Francisco"));
});

test("every county warning names the county and quotes its own numbers", () => {
  for (const county of CA_COUNTIES) {
    const risk = fairPlanRisk(county);
    assert.ok(risk.warning.includes(county), `${county}'s warning does not name it`);
    assert.ok(
      risk.warning.includes(risk.averagePremium.toLocaleString("en-US")),
      `${county}'s warning does not quote its own premium`
    );
    assert.ok(risk.warning.includes("FAIR Plan"), `${county}: the reader has to know what this is`);
  }
});

test("REGRESSION: the insurance line carries the reader's county, not a statewide platitude", () => {
  // It used to say "FAIR Plan policies average around $3,000-$3,200" to
  // everybody, which is true statewide and wrong by a factor of two at both
  // ends of the state.
  for (const county of ["Napa", "Imperial", "Tuolumne"] as CaCounty[]) {
    const line = evaluateScenario(input(county)).lines.find((l) => l.key === "homeownersInsurance")!;
    assert.ok(line.warning, `${county}: no warning`);
    assert.ok(line.warning!.includes(county), `${county}: the warning does not name it`);
    assert.ok(line.basis.includes(county), `${county}: the basis does not name it`);
    assert.ok(line.sourceIds.includes("fair-plan-county"), `${county}: uncited`);
  }

  const napa = evaluateScenario(input("Napa")).lines.find((l) => l.key === "homeownersInsurance")!;
  const imperial = evaluateScenario(input("Imperial")).lines.find((l) => l.key === "homeownersInsurance")!;
  assert.notEqual(napa.warning, imperial.warning, "two very different counties must not read identically");
});

test("a real quote replaces the estimate, and only a severe county still gets a warning", () => {
  const quoted = evaluateScenario(input("Sacramento", { insuranceAnnual: 1_450 }));
  const line = quoted.lines.find((l) => l.key === "homeownersInsurance")!;
  assert.equal(line.confidence, "user");
  assert.equal(line.annual, 1_450);
  assert.equal(line.warning, undefined, "we should not lecture someone who has a real quote in a calm county");

  // Except where half the county cannot get a normal policy. That is worth
  // saying even to someone holding a quote, because quotes get non-renewed.
  const severe = evaluateScenario(input("Tuolumne", { insuranceAnnual: 1_450 }));
  const severeLine = severe.lines.find((l) => l.key === "homeownersInsurance")!;
  assert.ok(severeLine.warning, "a severe county still warns");
});

test("the generated data is cited, and the citation says what it is not", () => {
  const source = SOURCES["fair-plan-county"];
  assert.equal(source.publisher, "California FAIR Plan Association");
  assert.equal(source.asOf, FAIR_PLAN_AS_OF);
  // The single most misleading thing a reader could do with this number is take
  // it for the price of a normal policy, so the caveat has to say so.
  assert.match(source.caveat!, /NOT the price of a normal policy/);
  assert.ok(SOURCES["dof-e5"], "the denominator needs a citation too");
});
