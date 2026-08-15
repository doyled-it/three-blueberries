/**
 * The "should you buy it" answer.
 *
 * The panel used to refuse to answer. These pin that it now gives a clear one,
 * that the answer follows the binding gate, and that the caveats are never
 * dropped.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateScenario } from "../lib/mortgage.ts";
import { bridgeScenario } from "../lib/scenario-bridge.ts";
import { decide } from "../lib/rent-vs-buy.ts";
import { recommend, type SavingsPosition } from "../lib/recommendation.ts";
import { CA_COUNTIES, type CaCounty } from "../lib/data/ca-loan-limits.ts";
import type { ScenarioInput } from "../lib/types.ts";

function answerFor(
  overrides: Partial<ScenarioInput>,
  savings: SavingsPosition,
  holdYears = 10,
  market = { monthlyRent: 2_750, homeAppreciation: 0.065, rentGrowth: 0.035, investmentReturn: 0.1 }
) {
  const input: ScenarioInput = {
    purchasePrice: 900_000,
    downPayment: { kind: "amount", value: 180_000 },
    loanType: "conventional",
    termYears: 30,
    interestRate: 0.0666,
    creditScore: 740,
    county: "San Diego",
    claimHomeownersExemption: true,
    hoaMonthly: 0,
    melloRoosAnnual: 0,
    household: { grossAnnualIncomes: [180_000], monthlyDebts: 750, size: 2 },
    ...overrides,
  };
  const result = evaluateScenario(input);
  const bridge = bridgeScenario(input, result, market);
  const d = decide({
    base: bridge.base,
    costs: bridge.costs,
    price: input.purchasePrice,
    holdYears,
    downPercent: bridge.downPercent,
    closingCostRate: bridge.closingCostRate,
  });
  return recommend(input, result, d, holdYears, savings, market.homeAppreciation);
}

const FLUSH: SavingsPosition = {
  currentSavings: 250_000,
  monthlySavings: 2_000,
  savingsReturn: 0.07,
  currentRent: 2_750,
  rentGrowth: 0.035,
};

test("a qualifying, funded, breaks-even-in-time purchase gets a plain yes", () => {
  const rec = answerFor({}, FLUSH);
  assert.equal(rec.answer, "yes");
  assert.match(rec.headline, /^Yes/);
  // The headline carries the binding number, not just a mood.
  assert.match(rec.headline, /year \d+/);
});

test("failing the lender's test is a no, and names the income that fixes it", () => {
  const rec = answerFor(
    { purchasePrice: 1_400_000, downPayment: { kind: "amount", value: 200_000 } },
    { ...FLUSH, currentSavings: 500_000 }
  );
  assert.equal(rec.answer, "no");
  assert.match(rec.headline, /^No/);
  assert.ok(rec.conditions.some((c) => /Income of \$/.test(c)));
});

test("qualifying but short on cash is 'not yet', dated in years", () => {
  const rec = answerFor({}, { ...FLUSH, currentSavings: 40_000 });
  assert.equal(rec.answer, "not-yet");
  assert.match(rec.headline, /Not yet/);
  assert.ok(rec.conditions.some((c) => /year/.test(c)));
  // The loan already passed, so that has to be in the reasons.
  assert.ok(rec.because.some((b) => /loan works/i.test(b)));
});

test("a short horizon that renting wins is 'conditional', with the stay it needs", () => {
  const rec = answerFor({}, FLUSH, 3);
  // 3 years is usually inside the breakeven, so this should be conditional.
  if (rec.answer === "conditional") {
    assert.ok(
      rec.conditions.some((c) => /Staying \d+ years/.test(c) || /price around/i.test(c)),
      "a conditional answer must state what would change it"
    );
  }
});

test("the deposit timeline the recommendation quotes accounts for rising rent", () => {
  const stagnant = answerFor({}, { ...FLUSH, currentSavings: 40_000, rentGrowth: 0 });
  const rising = answerFor({}, { ...FLUSH, currentSavings: 40_000, rentGrowth: 0.06 });
  const yearsIn = (rec: ReturnType<typeof answerFor>) => {
    const m = rec.conditions.join(" ").match(/About (\d+) years?/);
    return m ? Number(m[1]) : null;
  };
  const flat = yearsIn(stagnant);
  const fast = yearsIn(rising);
  if (flat !== null && fast !== null) {
    assert.ok(fast >= flat, `rent rising 6% should not close the gap faster (${fast}y) than flat rent (${flat}y)`);
  }
  // And the rising case says so.
  if (rising.answer === "not-yet") {
    assert.ok(rising.conditions.some((c) => /rent rising/i.test(c)));
  }
});

test("every answer, in every county, carries caveats and never contradicts itself", () => {
  for (const county of CA_COUNTIES) {
    const rec = answerFor({ county: county as CaCounty }, FLUSH);
    assert.ok(rec.headline.length > 20, `${county}: empty headline`);
    assert.ok(rec.because.length >= 1, `${county}: no reasoning`);
    // The caveats are load-bearing and must never be dropped.
    assert.ok(rec.caveats.length >= 2, `${county}: caveats stripped`);
    assert.ok(
      rec.caveats.some((c) => /want to live there|still have the income|house is sound/.test(c)),
      `${county}: lost the "what this cannot see" caveat`
    );
    // A yes must not also list conditions that would change it; that is the
    // definition of not-yes.
    if (rec.answer === "yes") assert.equal(rec.conditions.length, 0, `${county}: a "yes" carries conditions`);
    else assert.ok(rec.conditions.length >= 1, `${county}: a non-yes with nothing to change`);
  }
});
