import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assessReadiness,
  compareDownPayments,
  effectiveMortgageRate,
  liquidationCost,
  raiseCash,
  type Account,
} from "../lib/down-payment.ts";

const ACCOUNTS: Account[] = [
  { kind: "taxable", label: "Brokerage", balance: 201_062, gainShare: 0.45 },
  { kind: "roth-contributions", label: "Roth contributions", balance: 35_000 },
  { kind: "roth-earnings", label: "Roth earnings", balance: 20_939 },
  { kind: "traditional-retirement", label: "403(b)", balance: 255_657 },
];

test("the deduction makes mortgage debt much cheaper than its headline rate", () => {
  const effective = effectiveMortgageRate(0.0666, 0.4);
  assert.ok(Math.abs(effective - 0.03996) < 1e-6, "6.66% at a 40% marginal rate is about 4%");
  assert.ok(effective < 0.0666, "the deduction must reduce it");
});

test("REGRESSION: raiding a traditional retirement account destroys about half the money", () => {
  // The single most expensive mistake available in this decision.
  const cost = liquidationCost(ACCOUNTS[3]!);
  assert.ok(cost.frictionRate > 0.45, `expected catastrophic friction, got ${cost.frictionRate}`);
  assert.ok(cost.penaltyPaid > 0, "the 10% early withdrawal penalty must be charged");
  assert.match(cost.note, /almost no purchase that justifies this/i);
});

test("Roth contributions are the cheapest money after cash", () => {
  const cost = liquidationCost(ACCOUNTS[1]!);
  assert.equal(cost.frictionRate, 0);
  assert.equal(cost.netProceeds, 35_000);
});

test("taxable accounts are taxed on the gain only, not the balance", () => {
  const small = liquidationCost({ kind: "taxable", label: "a", balance: 100_000, gainShare: 0.1 });
  const large = liquidationCost({ kind: "taxable", label: "b", balance: 100_000, gainShare: 0.9 });
  assert.ok(large.taxPaid > small.taxPaid * 5, "more embedded gain must mean more tax");
  assert.ok(small.frictionRate < 0.05, "a low-gain position is nearly free to sell");
});

test("cash is raised cheapest first, and the friction cliff is visible", () => {
  const easy = raiseCash(ACCOUNTS, 200_000);
  const hard = raiseCash(ACCOUNTS, 300_000);
  assert.equal(easy.shortfall, 0);
  // Crossing into retirement money should raise the friction sharply.
  assert.ok(hard.totalFriction > easy.totalFriction * 2, "the cliff must show up in the numbers");
  assert.ok(easy.drawn[0]!.account.kind === "roth-contributions", "cheapest source drawn first");
});

test("a bigger deposit loses when the effective rate is below the expected return", () => {
  const options = compareDownPayments({
    price: 1_000_000,
    interestRate: 0.0666,
    investmentReturn: 0.07,
    minimumPercent: 0,
  });
  const big = options.find((o) => o.percent === 0.5)!;
  assert.ok(big.advantage < 0, "putting half down should lose against investing");
  assert.ok(big.investmentForgone > big.afterTaxInterestSaved);
});

test("a bigger deposit wins when the expected return is low enough", () => {
  const options = compareDownPayments({
    price: 1_000_000,
    interestRate: 0.0666,
    investmentReturn: 0.02,
    minimumPercent: 0,
  });
  const big = options.find((o) => o.percent === 0.5)!;
  assert.ok(big.advantage > 0, "if the market returns 2%, paying down 6.66% debt wins");
});

// --- the four gates --------------------------------------------------------

const READY = {
  cashNeeded: 200_000,
  cashAvailableWithoutPenalty: 240_000,
  passesDti: true,
  dti: 0.34,
  dtiCeiling: 0.45,
  price: 650_000,
  ceilingAtThisRate: 830_000,
  breakevenYear: 7,
  holdYears: 10,
};

test("all four gates passing produces a clean yes", () => {
  const r = assessReadiness(READY);
  assert.equal(r.ready, true);
  assert.equal(r.blocker, null);
  assert.match(r.verdict, /worth buying/i);
  assert.equal(r.gates.length, 4);
});

test("the first failing gate is named as the blocker, in fixability order", () => {
  const broke = assessReadiness({ ...READY, cashAvailableWithoutPenalty: 50_000, price: 2_000_000 });
  assert.equal(broke.ready, false);
  // Cash comes first because it is the most fixable, and only one thing should
  // be presented as the thing to work on.
  assert.equal(broke.blocker!.key, "cash");
  assert.match(broke.blocker!.fix, /Do not raid a traditional retirement account/i);
});

test("a price above the ceiling fails even when everything else is fine", () => {
  const r = assessReadiness({ ...READY, price: 1_200_000 });
  assert.equal(r.ready, false);
  assert.equal(r.blocker!.key, "price");
});

test("a horizon shorter than breakeven fails", () => {
  const r = assessReadiness({ ...READY, holdYears: 3 });
  assert.equal(r.ready, false);
  assert.equal(r.blocker!.key, "horizon");
  assert.match(r.blocker!.fix, /Selling before the crossover/i);
});

test("every gate explains itself and what to do about it", () => {
  const r = assessReadiness({ ...READY, passesDti: false, dti: 0.52 });
  for (const g of r.gates) {
    assert.ok(g.detail.length > 15, `${g.key} needs a detail line`);
    assert.ok(g.fix.length > 3, `${g.key} needs a fix line`);
  }
});

test("REGRESSION: no phantom PMI credit when the lender already requires 20%", () => {
  // Crediting "avoided" mortgage insurance to every option, including the
  // baseline, invented a saving on a loan that never owed any.
  const options = compareDownPayments({
    price: 1_000_000,
    interestRate: 0.0666,
    investmentReturn: 0.07,
    minimumPercent: 0.2,
    options: [0.2, 0.3, 0.5],
  });
  const baseline = options[0]!;
  assert.equal(baseline.afterTaxInterestSaved, 0, "the baseline cannot save anything relative to itself");
  assert.equal(baseline.advantage, 0);
  for (const o of options) {
    assert.equal(o.requiresPmi, false, "20% or more never owes PMI");
  }
});

test("the baseline option always has zero advantage, by definition", () => {
  for (const minimumPercent of [0, 0.035, 0.05, 0.2]) {
    const options = compareDownPayments({
      price: 800_000,
      interestRate: 0.0666,
      investmentReturn: 0.07,
      minimumPercent,
      options: [minimumPercent, 0.5],
    });
    assert.equal(options[0]!.advantage, 0, `baseline at ${minimumPercent} must be the reference point`);
  }
});

test("crossing the 20% threshold from a low deposit does credit avoided PMI", () => {
  const options = compareDownPayments({
    price: 1_000_000,
    interestRate: 0.0666,
    investmentReturn: 0.07,
    minimumPercent: 0,
    options: [0, 0.1, 0.2],
  });
  const low = options[1]!;
  const crossed = options[2]!;
  assert.equal(low.requiresPmi, true);
  assert.equal(crossed.requiresPmi, false);
  // The 20% option should get credit for the insurance a 0%-down loan would owe.
  const interestOnly = 200_000 * 0.0666 * 0.6;
  assert.ok(crossed.afterTaxInterestSaved > interestOnly, "PMI avoided must be counted on top of interest saved");
});
