import { test } from "node:test";
import assert from "node:assert/strict";

import { incomeRequiredFor, maxAffordablePrice, sweep } from "../lib/affordability.ts";
import { evaluateScenario } from "../lib/mortgage.ts";
import type { ScenarioInput } from "../lib/types.ts";

function scenario(overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    purchasePrice: 900_000,
    downPayment: { kind: "percent", value: 0.2 },
    loanType: "conventional",
    termYears: 30,
    interestRate: 0.0666,
    creditScore: 760,
    county: "San Diego",
    claimHomeownersExemption: true,
    hoaMonthly: 0,
    melloRoosAnnual: 0,
    household: { grossAnnualIncomes: [220_000], monthlyDebts: 500, size: 2 },
    ...overrides,
  };
}

test("the max affordable price actually qualifies, and a notch above it does not", () => {
  const { maxPurchasePrice } = maxAffordablePrice(scenario());
  assert.ok(maxPurchasePrice > 0);

  const at = evaluateScenario({ ...scenario(), purchasePrice: maxPurchasePrice });
  assert.equal(at.qualification.passesDti, true);

  const above = evaluateScenario({ ...scenario(), purchasePrice: maxPurchasePrice * 1.1 });
  assert.equal(above.qualification.passesDti, false);
});

test("more income buys more house", () => {
  const modest = maxAffordablePrice(
    scenario({ household: { grossAnnualIncomes: [150_000], monthlyDebts: 500, size: 2 } })
  );
  const better = maxAffordablePrice(
    scenario({ household: { grossAnnualIncomes: [300_000], monthlyDebts: 500, size: 2 } })
  );
  assert.ok(better.maxPurchasePrice > modest.maxPurchasePrice);
});

test("monthly debt payments eat directly into buying power", () => {
  const clean = maxAffordablePrice(
    scenario({ household: { grossAnnualIncomes: [220_000], monthlyDebts: 0, size: 2 } })
  );
  const carLoan = maxAffordablePrice(
    scenario({ household: { grossAnnualIncomes: [220_000], monthlyDebts: 900, size: 2 } })
  );
  assert.ok(clean.maxPurchasePrice > carLoan.maxPurchasePrice);
  // A $900/mo payment should cost well over $100k of purchasing power.
  assert.ok(clean.maxPurchasePrice - carLoan.maxPurchasePrice > 100_000);
});

test("a household that cannot afford anything is told so rather than given a number", () => {
  const result = maxAffordablePrice(
    scenario({ household: { grossAnnualIncomes: [20_000], monthlyDebts: 1500, size: 4 } })
  );
  assert.equal(result.maxPurchasePrice, 0);
});

test("required income and max price are consistent with each other", () => {
  const base = scenario();
  const { maxPurchasePrice } = maxAffordablePrice(base);
  const required = incomeRequiredFor({ ...base, purchasePrice: maxPurchasePrice });
  const actual = base.household.grossAnnualIncomes.reduce((a, b) => a + b, 0);
  // At the affordability boundary, required income should just about equal actual.
  assert.ok(required.annual <= actual * 1.01, `required ${required.annual} exceeded actual ${actual}`);
  assert.ok(required.annual > actual * 0.9, `required ${required.annual} far below actual ${actual}`);
});

test("VA affordability is bound by residual income or DTI, and reports which", () => {
  const result = maxAffordablePrice(
    scenario({
      loanType: "va",
      downPayment: { kind: "percent", value: 0 },
      va: { firstUse: true, disabilityExempt: true, financeFundingFee: true },
      squareFeet: 1800,
      household: { grossAnnualIncomes: [140_000], monthlyDebts: 400, size: 4 },
    })
  );
  assert.ok(result.maxPurchasePrice > 0);
  assert.ok(["dti", "residual-income"].includes(result.bindingConstraint));
});

test("a lower rate raises the payment ceiling", () => {
  const results = sweep(scenario(), "interestRate", [0.055, 0.0666, 0.08]);
  const payments = results.map((r) => r.result.lenderMonthlyTotal);
  assert.ok(payments[0]! < payments[1]!);
  assert.ok(payments[1]! < payments[2]!);
});

test("half a point of rate is worth real money every month", () => {
  const [low, high] = sweep(scenario(), "interestRate", [0.0616, 0.0666]).map((r) => r.result.lenderMonthlyTotal);
  assert.ok(high! - low! > 150, `expected a meaningful monthly delta, got ${high! - low!}`);
});
