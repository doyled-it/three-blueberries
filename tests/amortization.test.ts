import { test } from "node:test";
import assert from "node:assert/strict";

import { balanceAfter, monthLtvReaches, monthlyPayment, schedule, totalInterest } from "../lib/amortization.ts";

const near = (actual: number, expected: number, tolerance: number, message?: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message ?? `expected ${actual} to be within ${tolerance} of ${expected}`
  );

test("monthly payment matches the textbook figure", () => {
  // $300,000 at 6.00% over 30 years is the canonical worked example: $1,798.65.
  near(monthlyPayment(300_000, 0.06, 30), 1798.65, 0.01);
});

test("monthly payment handles a zero interest rate without dividing by zero", () => {
  assert.equal(monthlyPayment(360_000, 0, 30), 1000);
});

test("monthly payment is zero for a zero-principal loan", () => {
  assert.equal(monthlyPayment(0, 0.065, 30), 0);
});

test("a 15-year term costs more monthly and far less in total interest", () => {
  const thirty = monthlyPayment(600_000, 0.0666, 30);
  const fifteen = monthlyPayment(600_000, 0.0666, 15);
  assert.ok(fifteen > thirty);
  assert.ok(totalInterest(600_000, 0.0666, 15) < totalInterest(600_000, 0.0666, 30) / 2);
});

test("balance is untouched at month zero and fully retired at term", () => {
  assert.equal(balanceAfter(500_000, 0.065, 30, 0), 500_000);
  near(balanceAfter(500_000, 0.065, 30, 360), 0, 0.01);
});

test("closed-form balance agrees with the iterated schedule", () => {
  const rows = schedule(742_000, 0.0666, 30);
  for (const month of [1, 12, 60, 180, 300, 359]) {
    near(
      balanceAfter(742_000, 0.0666, 30, month),
      rows[month - 1]!.balance,
      0.02,
      `balance diverged at month ${month}`
    );
  }
});

test("schedule pays the loan to exactly zero and interest falls monotonically", () => {
  const rows = schedule(400_000, 0.07, 30);
  assert.equal(rows.length, 360);
  near(rows.at(-1)!.balance, 0, 0.000001);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i]!.interest <= rows[i - 1]!.interest);
  }
});

test("total interest equals payments made less principal borrowed", () => {
  const rows = schedule(250_000, 0.055, 30);
  const summed = rows.reduce((sum, r) => sum + r.interest, 0);
  near(totalInterest(250_000, 0.055, 30), summed, 0.5);
});

test("LTV milestone is found on the original schedule, not on appreciation", () => {
  // 5% down: starts at 95% LTV and has to amortize down to 78%.
  const month = monthLtvReaches({
    principal: 760_000,
    originalValue: 800_000,
    annualRate: 0.0666,
    termYears: 30,
    targetLtv: 0.78,
  });
  assert.ok(month !== null);
  near(balanceAfter(760_000, 0.0666, 30, month!) / 800_000, 0.78, 0.001);
  // Sanity: at these rates it takes years, not months.
  assert.ok(month! > 60, `expected more than 5 years to reach 78% LTV, got ${month} months`);
});

test("a loan already below the target LTV reports month zero", () => {
  assert.equal(
    monthLtvReaches({ principal: 500_000, originalValue: 800_000, annualRate: 0.06, termYears: 30, targetLtv: 0.78 }),
    0
  );
});
