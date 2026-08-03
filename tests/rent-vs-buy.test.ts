import { test } from "node:test";
import assert from "node:assert/strict";

import {
  breakevenByPrice,
  compareRentVsBuy,
  decide,
  requiredRate,
  maxPriceForHoldPeriod,
  savingsRace,
  statutoryRentCap,
} from "../lib/rent-vs-buy.ts";

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

// --- the decision surface --------------------------------------------------

const COSTS = { carryingRate: 0.0115, maintenanceRate: 0.01, fixedMonthly: 190 };
const SWEEP = {
  interestRate: 0.0666,
  termYears: 30,
  monthlyRent: 2_995,
  homeAppreciation: 0.0543,
  rentGrowth: 0.023,
  investmentReturn: 0.07,
  propertyTaxGrowth: 0.02,
  sellingCostRate: 0.06,
};

test("REGRESSION: a price sweep scales carrying costs with the price", () => {
  // Holding tax and maintenance fixed while sweeping price charges a $400k house
  // the taxes of a $1.2M one, which makes every price look equally hopeless and
  // hides the crossover entirely.
  const curve = breakevenByPrice(SWEEP, COSTS, [400_000, 1_200_000], 0.2);
  assert.ok(curve[0]!.breakevenYear !== null, "a cheap house must break even at some point");
  assert.equal(curve[1]!.breakevenYear, null, "an expensive one at this rent should not");
});

test("the required holding period lengthens monotonically with price", () => {
  const prices = [400_000, 500_000, 600_000, 700_000, 800_000];
  const curve = breakevenByPrice(SWEEP, COSTS, prices, 0.2);
  const years = curve.map((c) => c.breakevenYear ?? 999);
  for (let i = 1; i < years.length; i++) {
    assert.ok(years[i]! >= years[i - 1]!, `breakeven should not shorten as price rises (at ${prices[i]})`);
  }
});

test("the max price you should pay rises as your horizon lengthens, then plateaus", () => {
  const short = maxPriceForHoldPeriod(SWEEP, COSTS, 3, 0.2)!;
  const medium = maxPriceForHoldPeriod(SWEEP, COSTS, 10, 0.2)!;
  const long = maxPriceForHoldPeriod(SWEEP, COSTS, 30, 0.2)!;
  assert.ok(medium > short, "staying longer should let you pay more");
  assert.ok(long >= medium);
  // Past roughly 15 years the constraint is price-to-rent, not patience.
  assert.ok(long < medium * 1.3, "holding period has sharply diminishing returns");
});

test("the interest rate moves the budget more than the horizon does", () => {
  const cheap = maxPriceForHoldPeriod({ ...SWEEP, interestRate: 0.03 }, COSTS, 10, 0.2)!;
  const dear = maxPriceForHoldPeriod({ ...SWEEP, interestRate: 0.08 }, COSTS, 10, 0.2)!;
  assert.ok(cheap > dear * 2, "3% versus 8% should more than double what you can justify paying");
});

test("faster rent growth justifies paying more", () => {
  const slow = maxPriceForHoldPeriod({ ...SWEEP, rentGrowth: 0.023 }, COSTS, 10, 0.2)!;
  const atCap = maxPriceForHoldPeriod({ ...SWEEP, rentGrowth: statutoryRentCap() }, COSTS, 10, 0.2)!;
  assert.ok(atCap > slow, "if rent will run away from you, owning is worth more");
});

test("California's rent cap is a formula, not a guess", () => {
  // 5% plus regional CPI, never above 10%.
  assert.ok(Math.abs(statutoryRentCap(0.032) - 0.082) < 1e-9, "San Diego 2026-27 should be 8.2%");
  assert.equal(statutoryRentCap(0.09), 0.1, "the hard ceiling is 10%");
  assert.equal(statutoryRentCap(0), 0.05, "the floor is the 5% base");
});

test("selling before breakeven means you lost against renting", () => {
  const r = scenario({ purchasePrice: 600_000, downPaymentAmount: 120_000, loanAmount: 480_000, monthlyRent: 2_995 });
  if (r.breakevenYear === null || r.breakevenYear < 2) return;
  const before = r.years[r.breakevenYear - 2]!;
  assert.ok(before.buyNetWorth < before.rentNetWorth, "the year before breakeven, renting is still ahead");
});

// --- the decision ----------------------------------------------------------

const DECIDE_BASE = { base: SWEEP, costs: COSTS, downPercent: 0.2 };

test("a cheap-enough house comes back as a clear yes with every lever met", () => {
  const d = decide({ ...DECIDE_BASE, price: 650_000, holdYears: 8 });
  assert.equal(d.worthIt, true);
  assert.ok(d.breakevenYear !== null && d.breakevenYear <= 8);
  assert.match(d.verdict, /this works/i);
  for (const lever of d.levers) {
    assert.ok(lever.reachable, `${lever.key} should be satisfied when the house already works`);
  }
});

test("an expensive house reports the exact threshold on every lever", () => {
  const d = decide({ ...DECIDE_BASE, price: 1_200_000, holdYears: 8 });
  assert.equal(d.worthIt, false);
  assert.ok(d.rateNeeded !== null && d.rateNeeded < SWEEP.interestRate, "should name a rate that would work");
  assert.ok(d.priceNeeded !== null && d.priceNeeded < 1_200_000, "should name a price that would work");
  assert.ok(d.rentalIncomeNeeded !== null && d.rentalIncomeNeeded > 0, "should name the rent that would tip it");
  assert.equal(d.levers.length, 4);
});

test("every lever states where it is now and what it would take", () => {
  const d = decide({ ...DECIDE_BASE, price: 1_200_000, holdYears: 8 });
  for (const lever of d.levers) {
    assert.ok(lever.current.length > 0);
    assert.ok(lever.needed.length > 0);
    assert.ok(lever.note.length > 15, `${lever.key} needs a real note`);
  }
});

test("REGRESSION: staying longer is honestly reported as not fixing an overpriced house", () => {
  // Patience is the lever people reach for first and it is usually the wrong one.
  const short = decide({ ...DECIDE_BASE, price: 1_200_000, holdYears: 8 });
  const long = decide({ ...DECIDE_BASE, price: 1_200_000, holdYears: 25 });
  assert.equal(short.worthIt, false);
  assert.equal(long.worthIt, false);
  const yearsLever = long.levers.find((l) => l.key === "years")!;
  assert.match(yearsLever.note, /does not fix it|price to rent/i);
});

test("rental income offsets the cost of owning and can tip the decision", () => {
  const without = decide({ ...DECIDE_BASE, price: 900_000, holdYears: 10 });
  const needed = without.rentalIncomeNeeded;
  if (needed === null || needed === 0) return;

  const withIncome = decide({
    ...DECIDE_BASE,
    base: { ...SWEEP, monthlyRentalIncome: needed },
    price: 900_000,
    holdYears: 10,
  });
  assert.equal(withIncome.worthIt, true, `collecting ${needed}/mo should tip a house that needs exactly that`);
});

test("the verdict says plainly when nothing is close", () => {
  const hopeless = decide({ ...DECIDE_BASE, price: 3_000_000, holdYears: 5 });
  assert.equal(hopeless.worthIt, false);
  assert.match(hopeless.verdict, /nothing here is close|keep renting/i);
});

test("required rate is the highest rate that still works, not just any rate", () => {
  const price = 900_000;
  const rate = requiredRate(SWEEP, COSTS, price, 10, 0.2);
  assert.ok(rate !== null);
  const justBelow = breakevenByPrice({ ...SWEEP, interestRate: rate - 0.004 }, COSTS, [price], 0.2)[0]!;
  const justAbove = breakevenByPrice({ ...SWEEP, interestRate: rate + 0.004 }, COSTS, [price], 0.2)[0]!;
  assert.ok(justBelow.breakevenYear !== null && justBelow.breakevenYear <= 10, "a lower rate must still work");
  assert.ok(
    justAbove.breakevenYear === null || justAbove.breakevenYear > 10,
    "a higher rate must stop working, or the threshold is not tight"
  );
});
