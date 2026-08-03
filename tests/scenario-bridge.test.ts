import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateScenario } from "../lib/mortgage.ts";
import { bridgeScenario } from "../lib/scenario-bridge.ts";
import { atPrice, compareRentVsBuy, decide, maxPriceForHoldPeriod } from "../lib/rent-vs-buy.ts";
import { STANDARD_DEDUCTION_2026, saltCap } from "../lib/data/federal-tax.ts";
import type { LoanType, ScenarioInput } from "../lib/types.ts";

/**
 * These tests exist because 206 green tests once coexisted with a page that
 * declared the same house a pass and a fail in two cards a few inches apart.
 * Everything was pinned except the join between the itemised panel and the
 * sweeps, which is where all four of the contradictions actually lived.
 */

const MARKET = {
  monthlyRent: 2_750,
  homeAppreciation: 0.054,
  rentGrowth: 0.035,
  investmentReturn: 0.07,
};

function input(overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
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
    household: { grossAnnualIncomes: [205_000], monthlyDebts: 0, size: 1 },
    ...overrides,
  } as ScenarioInput;
}

/** Every loan type, and deposits either side of every mortgage-insurance band. */
const CASES: Array<{ label: string; input: ScenarioInput }> = [
  { label: "conventional 20% down", input: input() },
  { label: "conventional 3.5% down", input: input({ downPayment: { kind: "amount", value: 31_500 } }) },
  { label: "conventional 10% down", input: input({ downPayment: { kind: "amount", value: 90_000 } }) },
  {
    label: "FHA 3.5% down, MI for life",
    input: input({
      loanType: "fha" as LoanType,
      downPayment: { kind: "amount", value: 31_500 },
      fha: { financeUpfrontMip: true },
    }),
  },
  {
    label: "VA zero down, financed funding fee",
    input: input({
      loanType: "va" as LoanType,
      downPayment: { kind: "amount", value: 0 },
      va: { firstUse: true, disabilityExempt: false, financeFundingFee: true },
    }),
  },
  {
    label: "with HOA and Mello-Roos",
    input: input({ hoaMonthly: 450, melloRoosAnnual: 3_600 }),
  },
];

for (const c of CASES) {
  test(`REGRESSION: the sweep and the itemised panel agree at the user's own price, ${c.label}`, () => {
    const result = evaluateScenario(c.input);
    const bridge = bridgeScenario(c.input, result, MARKET);

    const itemised = compareRentVsBuy(bridge.itemised);
    const swept = atPrice(
      bridge.base,
      bridge.costs,
      c.input.purchasePrice,
      bridge.downPercent,
      bridge.closingCostRate
    );

    assert.equal(
      swept.breakevenYear,
      itemised.breakevenYear,
      `breakeven disagrees: sweep ${swept.breakevenYear}, panel ${itemised.breakevenYear}`
    );
    for (const y of [1, 5, 10, 30]) {
      const a = itemised.years[y - 1]!;
      const b = swept.years[y - 1]!;
      assert.ok(
        Math.abs(a.buyNetWorth - b.buyNetWorth) < 1,
        `year ${y} net worth disagrees by ${Math.round(a.buyNetWorth - b.buyNetWorth)}`
      );
      assert.ok(
        Math.abs(a.buyMoneyBurned - b.buyMoneyBurned) < 1,
        `year ${y} burn disagrees by ${Math.round(a.buyMoneyBurned - b.buyMoneyBurned)}`
      );
    }
  });
}

test("REGRESSION: the sweep amortizes the financed VA funding fee, like the panel does", () => {
  const va = CASES.find((c) => c.label.startsWith("VA"))!.input;
  const result = evaluateScenario(va);
  const bridge = bridgeScenario(va, result, MARKET);

  assert.ok(result.loan.financedUpfrontFee > 0, "the fixture must actually finance a fee");
  assert.ok((bridge.costs.financedFeeRate ?? 0) > 0, "the sweep must know about it");
  assert.equal(bridge.itemised.loanAmount, result.loan.totalLoanAmount);
});

test("REGRESSION: the sweep uses the real closing costs, not a flat 2.5%", () => {
  const scenario = input();
  const result = evaluateScenario(scenario);
  const bridge = bridgeScenario(scenario, result, MARKET);

  // Impound seeding pushes real cash-to-close above the flat rate the sweeps
  // used to assume, and that gap is worth years of breakeven on its own.
  assert.ok(bridge.closingCostRate > 0.025, `expected more than 2.5%, got ${bridge.closingCostRate}`);
  assert.equal(bridge.itemised.closingCosts, result.cashToClose.total - result.loan.downPaymentAmount);
});

test("REGRESSION: mortgage insurance reaches the rent-vs-buy panel", () => {
  const fha = CASES.find((c) => c.label.startsWith("FHA"))!.input;
  const result = evaluateScenario(fha);
  const bridge = bridgeScenario(fha, result, MARKET);

  assert.ok((bridge.itemised.monthlyMortgageInsurance ?? 0) > 0, "FHA at 3.5% down pays MI");
  assert.equal(bridge.itemised.mortgageInsuranceEndsMonth, null, "under 10% down it never terminates");

  // And leaving it out flatters buying, which is the direction that matters.
  const withMi = compareRentVsBuy(bridge.itemised);
  const withoutMi = compareRentVsBuy({ ...bridge.itemised, monthlyMortgageInsurance: 0 });
  assert.ok(
    (withoutMi.breakevenYear ?? 99) < (withMi.breakevenYear ?? 99),
    "omitting MI must make buying look better, which is why it mattered"
  );
});

test("VA has no mortgage insurance at any deposit", () => {
  const va = CASES.find((c) => c.label.startsWith("VA"))!.input;
  const bridge = bridgeScenario(va, evaluateScenario(va), MARKET);
  assert.equal(bridge.itemised.monthlyMortgageInsurance, 0);
  assert.equal(bridge.costs.mortgageInsuranceRate, 0);
});

test("REGRESSION: two incomes get the joint standard deduction, not the single one", () => {
  // The SALT bucket was built by summing both incomes, which models a joint
  // return, while the floor it was measured against stayed the single figure.
  // That is one formula filing two different ways, and it overstates relief.
  const single = input({ household: { grossAnnualIncomes: [180_000], monthlyDebts: 0, size: 1 } });
  const joint = input({ household: { grossAnnualIncomes: [90_000, 90_000], monthlyDebts: 0, size: 2 } });

  const a = bridgeScenario(single, evaluateScenario(single), MARKET);
  const b = bridgeScenario(joint, evaluateScenario(joint), MARKET);

  assert.equal(a.base.standardDeduction, STANDARD_DEDUCTION_2026.single);
  assert.equal(b.base.standardDeduction, STANDARD_DEDUCTION_2026.marriedFilingJointly);

  const reliefSingle = compareRentVsBuy(a.itemised).firstYear.taxRelief;
  const reliefJoint = compareRentVsBuy(b.itemised).firstYear.taxRelief;
  assert.ok(reliefJoint < reliefSingle, "the higher floor must reduce the subsidy, not raise it");
});

test("the SALT cap phases out above $505,000, so a big household income is not free deduction", () => {
  assert.equal(saltCap(400_000), 40_400);
  assert.equal(saltCap(505_000), 40_400);
  assert.ok(saltCap(600_000) < 40_400);
  assert.equal(saltCap(2_000_000), 10_000, "it floors at the pre-2025 cap, it does not go to zero");

  const rich = input({ household: { grossAnnualIncomes: [400_000, 300_000], monthlyDebts: 0, size: 2 } });
  const bridge = bridgeScenario(rich, evaluateScenario(rich), MARKET);
  assert.ok((bridge.base.otherItemizedDeductions ?? 0) <= saltCap(700_000));
});

test("REGRESSION: second-unit income reaches the sweeps, not only the verdict", () => {
  // It used to be attached inside the decide() call alone, so the ceiling card,
  // the levers and every chart modelled $0 while the verdict beside them counted it.
  const scenario = input();
  const result = evaluateScenario(scenario);

  const without = bridgeScenario(scenario, result, MARKET);
  const with2k = bridgeScenario(scenario, result, { ...MARKET, monthlyRentalIncome: 2_000 });

  assert.equal(without.base.monthlyRentalIncome, 0);
  assert.equal(with2k.base.monthlyRentalIncome, 2_000);

  const ceilingWithout = maxPriceForHoldPeriod(
    without.base,
    without.costs,
    10,
    without.downPercent,
    without.closingCostRate
  );
  const ceilingWith = maxPriceForHoldPeriod(with2k.base, with2k.costs, 10, with2k.downPercent, with2k.closingCostRate);
  assert.ok(
    (ceilingWith ?? 0) > (ceilingWithout ?? 0),
    "income you actually collect must raise what you can justify paying"
  );

  // And the decision panel has to agree with the ceiling card beside it.
  const d = decide({
    base: with2k.base,
    costs: with2k.costs,
    price: scenario.purchasePrice,
    holdYears: 10,
    downPercent: with2k.downPercent,
    closingCostRate: with2k.closingCostRate,
  });
  assert.equal(d.priceNeeded, ceilingWith);
});
