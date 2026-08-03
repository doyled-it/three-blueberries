import { test } from "node:test";
import assert from "node:assert/strict";

import { compareRentVsBuy, savingsRace } from "../lib/rent-vs-buy.ts";

/** A $1.2M North Park house against $2,750 rent: a 36x price-to-rent ratio. */
function scenario(overrides: Partial<Parameters<typeof compareRentVsBuy>[0]> = {}) {
  return compareRentVsBuy({
    purchasePrice: 1_200_000,
    downPaymentAmount: 240_000,
    closingCosts: 30_000,
    loanAmount: 960_000,
    interestRate: 0.0666,
    termYears: 30,
    monthlyCarryingCosts: 1_340,
    monthlyMaintenance: 1_000,
    monthlyRent: 2_750,
    homeAppreciation: 0.0543,
    rentGrowth: 0.035,
    investmentReturn: 0.07,
    propertyTaxGrowth: 0.02,
    sellingCostRate: 0.06,
    ...overrides,
  });
}

test("year one exposes how little of a mortgage payment is saving", () => {
  const r = scenario();
  // Interest dwarfs principal at the start of a 30-year loan.
  assert.ok(r.firstYear.interestPaid > r.firstYear.principalPaid * 4);
  // And the owner's genuinely wasted money exceeds a full year of rent.
  assert.ok(r.firstYear.burned > r.firstYear.rentPaid);
  assert.ok(r.firstYear.burnedMoreThanRent > 0);
});

test("REGRESSION: 'rent is throwing money away' is false at a high price-to-rent ratio", () => {
  // At 36x, the money an owner burns on interest, tax, insurance and upkeep is
  // far larger than the renter's entire rent. This is the finding the panel exists
  // to show, so it gets pinned.
  const r = scenario();
  assert.ok(r.firstYear.burned > r.firstYear.rentPaid * 2, "owner should burn more than double the rent here");
});

test("price to rent drives the answer more than the interest rate does", () => {
  const cheapRatio = scenario({ monthlyRent: 6_000 });
  const dearRatio = scenario({ monthlyRent: 2_750 });
  assert.ok(cheapRatio.breakevenYear !== null, "at 16x, buying should win eventually");
  assert.equal(dearRatio.breakevenYear, null, "at 36x, buying should not catch up in 30 years");

  // Moving the rate across a wide band does not flip a 36x ratio.
  for (const interestRate of [0.04, 0.06, 0.08]) {
    assert.equal(scenario({ interestRate }).breakevenYear, null, `rate ${interestRate} should not rescue 36x`);
  }
});

test("the gap between appreciation and investment return decides it", () => {
  const housingWins = scenario({ homeAppreciation: 0.09, investmentReturn: 0.04 });
  const marketWins = scenario({ homeAppreciation: 0.02, investmentReturn: 0.09 });
  assert.ok(housingWins.breakevenYear !== null);
  assert.equal(marketWins.breakevenYear, null);
});

test("selling costs mean buying is never ahead on day one", () => {
  const r = scenario();
  assert.ok(r.years[0]!.buyNetWorth < r.years[0]!.rentNetWorth);
});

test("the owner's payment barely moves while rent compounds away", () => {
  const r = scenario();
  const first = r.years[0]!;
  const last = r.years[29]!;
  const ownGrowth = last.monthlyOwnCost / first.monthlyOwnCost;
  const rentGrowth = last.monthlyRentCost / first.monthlyRentCost;
  assert.ok(rentGrowth > ownGrowth * 1.5, "this is the strongest structural argument for owning");
});

test("net worth series is complete and finite", () => {
  const r = scenario();
  assert.equal(r.years.length, 30);
  for (const y of r.years) {
    assert.ok(Number.isFinite(y.buyNetWorth) && Number.isFinite(y.rentNetWorth));
    assert.ok(y.loanBalance >= 0);
  }
  assert.ok(r.years[29]!.loanBalance < 1, "the loan should be retired after 30 years");
});

// --- the savings treadmill -------------------------------------------------

test("saving slower than prices rise means losing ground, however disciplined", () => {
  const losing = savingsRace({
    targetPrice: 1_200_000,
    downPaymentPercent: 0.2,
    closingCostRate: 0.025,
    currentSavings: 40_000,
    monthlySavings: 400,
    savingsReturn: 0.045,
    homeAppreciation: 0.06,
  });
  assert.equal(losing.losingGround, true);
  assert.ok(losing.targetGrowsBy > losing.savingsGrowBy);
  assert.match(losing.verdict, /treadmill/i);
});

test("saving faster than prices rise reaches the target, and reports the moved goalposts", () => {
  const winning = savingsRace({
    targetPrice: 1_200_000,
    downPaymentPercent: 0.2,
    closingCostRate: 0.025,
    currentSavings: 40_000,
    monthlySavings: 5_000,
    savingsReturn: 0.045,
    homeAppreciation: 0.035,
  });
  assert.equal(winning.losingGround, false);
  assert.ok(winning.yearsToAfford !== null && winning.yearsToAfford < 15);
  // The target must be reported as it will be then, not as it is now.
  assert.ok(winning.cashNeededThen! > winning.cashNeededToday);
  assert.ok(winning.priceThen! > 1_200_000);
});

test("a zero-down loan still needs closing costs saved", () => {
  const race = savingsRace({
    targetPrice: 900_000,
    downPaymentPercent: 0,
    closingCostRate: 0.025,
    currentSavings: 0,
    monthlySavings: 1_000,
    savingsReturn: 0.045,
    homeAppreciation: 0.035,
  });
  assert.ok(race.cashNeededToday > 20_000, "VA at zero down is not zero cash");
});
