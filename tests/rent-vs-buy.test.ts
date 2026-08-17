import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  ASSUMPTION_SETS,
  DEFAULT_MARGINAL_TAX_RATE,
  RENT_VS_BUY_CAVEAT,
  breakevenByPrice,
  buyZone,
  compareRentVsBuy,
  decide,
  rateSensitivity,
  requiredRate,
  maxPriceForHoldPeriod,
  savingsRace,
  LONG_RUN_WAGE_GROWTH,
  assumptionSets,
  statutoryRentCap,
  AB_1482,
  RENT_CAP_REGIONS,
  rentCapRegionFor,
} from "../lib/rent-vs-buy.ts";
import { CA_COUNTIES } from "../lib/data/ca-loan-limits.ts";

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

test("rising rent slows the deposit race, and never speeds it up", () => {
  // The reader flagged that rent was held stagnant. It eats saving capacity: a
  // renter whose rent outruns wages has less each month to put aside. The race
  // must move monotonically the WRONG way as rent growth rises, never the right.
  const base = {
    targetPrice: 700_000,
    downPaymentPercent: 0.2,
    closingCostRate: 0.03,
    currentSavings: 20_000,
    monthlySavings: 900,
    savingsReturn: 0.05,
    homeAppreciation: 0.04,
    currentRent: 3_200,
  } as const;

  const years = (rentGrowth: number) => {
    const r = savingsRace({ ...base, rentGrowth });
    return r.yearsToAfford ?? 99;
  };

  const slow = years(0.02);
  const fast = years(0.07);
  assert.ok(fast >= slow, `rent at 7% (${fast}y) must not close the gap faster than rent at 2% (${slow}y)`);
  assert.ok(fast > slow, "over a long enough race the drag should actually show");
});

test("rent moving with wages leaves the saver treading water, not sinking", () => {
  // When rent grows at the wage rate the rent term cancels and the saving rate
  // grows at wages. So a modelled-rent race at ~3.5% must not be dramatically
  // worse than one that ignores rent (which also ignores wage growth).
  const base = {
    targetPrice: 800_000,
    downPaymentPercent: 0.2,
    closingCostRate: 0.03,
    currentSavings: 50_000,
    monthlySavings: 2_500,
    savingsReturn: 0.06,
    homeAppreciation: 0.045,
  } as const;

  const withRent = savingsRace({ ...base, currentRent: 2_800, rentGrowth: LONG_RUN_WAGE_GROWTH });
  const ignored = savingsRace(base);
  // Rent-at-wages is never SLOWER than the flat-savings model, because the flat
  // model gives the saver no raise at all.
  assert.ok((withRent.yearsToAfford ?? 99) <= (ignored.yearsToAfford ?? 99));
});

test("omitting rent reproduces the old fixed-rate behaviour exactly", () => {
  // So the change is additive: a caller that does not pass rent is unaffected.
  const base = {
    targetPrice: 900_000,
    downPaymentPercent: 0.2,
    closingCostRate: 0.03,
    currentSavings: 40_000,
    monthlySavings: 2_000,
    savingsReturn: 0.07,
    homeAppreciation: 0.05,
  } as const;
  const a = savingsRace(base);
  const b = savingsRace({ ...base, currentRent: undefined, rentGrowth: 0.05 });
  assert.equal(a.yearsToAfford, b.yearsToAfford);
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

test("the max price peaks at a middle horizon, then FALLS, because the lead closes", () => {
  // The honest shape. maxPriceForHoldPeriod asks "the most I can pay and still be
  // ahead AT year N". A longer hold helps at first (rent compounds against you),
  // but once the invested down payment outcompounds the house, a longer hold
  // HURTS: the price you can justify falls. The old test asserted this rose
  // monotonically, which was the first-crossing bug in test form.
  const short = maxPriceForHoldPeriod(SWEEP, COSTS, 3, 0.2)!;
  const medium = maxPriceForHoldPeriod(SWEEP, COSTS, 10, 0.2)!;
  const long = maxPriceForHoldPeriod(SWEEP, COSTS, 30, 0.2)!;
  assert.ok(medium > short, "reaching the window lets you pay more than a 3-year flip");
  assert.ok(long < medium, "past the peak a longer hold LOWERS the price you can justify");
});

test("the interest rate moves the budget more than the horizon does", () => {
  const cheap = maxPriceForHoldPeriod({ ...SWEEP, interestRate: 0.03 }, COSTS, 10, 0.2)!;
  const dear = maxPriceForHoldPeriod({ ...SWEEP, interestRate: 0.08 }, COSTS, 10, 0.2)!;
  assert.ok(cheap > dear * 2, "3% versus 8% should more than double what you can justify paying");
});

test("faster rent growth justifies paying more", () => {
  const slow = maxPriceForHoldPeriod({ ...SWEEP, rentGrowth: 0.023 }, COSTS, 10, 0.2)!;
  const atCap = maxPriceForHoldPeriod({ ...SWEEP, rentGrowth: statutoryRentCap("San Diego") }, COSTS, 10, 0.2)!;
  assert.ok(atCap > slow, "if rent will run away from you, owning is worth more");
});

test("California's rent cap is a formula, not a guess", () => {
  // 5% plus REGIONAL CPI, never above 10%. The region is the point: a figure
  // that is right in San Diego is wrong everywhere the statute names separately.
  assert.ok(Math.abs(statutoryRentCap("San Diego") - 0.082) < 1e-9, "San Diego 2026-27 should be 8.2%");
  assert.ok(Math.abs(statutoryRentCap("Los Angeles") - 0.087) < 1e-9, "LA and Orange should be 8.7%");
  assert.ok(Math.abs(statutoryRentCap("Riverside") - 0.081) < 1e-9, "the Inland Empire should be 8.1%");
  assert.ok(Math.abs(statutoryRentCap("Alameda") - 0.088) < 1e-9, "the Bay Area should be 8.8%");
  assert.ok(Math.abs(statutoryRentCap("Fresno") - 0.086) < 1e-9, "counties with no BLS index take the state CPI");

  // The hard ceiling and the base still bound it, whatever the CPI does.
  for (const county of CA_COUNTIES) {
    const cap = statutoryRentCap(county);
    assert.ok(cap >= AB_1482.base && cap <= AB_1482.hardCeiling, `${county} is outside 5% to 10%`);
  }
});

test("REGRESSION: every county resolves to exactly one rent-cap region", () => {
  // A county listed in two regions, or a region naming a county that does not
  // exist, would silently hand somebody the wrong statutory ceiling.
  const named = RENT_CAP_REGIONS.flatMap((r) => r.counties);
  assert.equal(new Set(named).size, named.length, "a county appears in two regions");
  for (const county of named) {
    assert.ok(CA_COUNTIES.includes(county), `${county} is not a California county`);
  }
  for (const county of CA_COUNTIES) {
    const region = rentCapRegionFor(county);
    assert.ok(region.cpi > 0 && region.cpi < 0.2, `${county} has an implausible CPI`);
  }
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

// --- the buy zone ----------------------------------------------------------

test("the affordability ceiling falls monotonically as rates rise", () => {
  const rates = [0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09];
  const zone = buyZone(SWEEP, COSTS, rates, 10, 0.2);
  for (let i = 1; i < zone.length; i++) {
    const prev = zone[i - 1]!.maxPrice ?? 0;
    const here = zone[i]!.maxPrice ?? 0;
    assert.ok(here <= prev, `ceiling should not rise with the rate (at ${rates[i]})`);
  }
});

test("REGRESSION: the rate moves the ceiling by a large, checkable amount", () => {
  // The headline claim of the buy-zone chart. If this stops being true the copy
  // is wrong, not just the number.
  const cheap = buyZone(SWEEP, COSTS, [0.03], 10, 0.2)[0]!.maxPrice!;
  const dear = buyZone(SWEEP, COSTS, [0.08], 10, 0.2)[0]!.maxPrice!;
  assert.ok(cheap > dear * 2, "3% versus 8% should more than double the ceiling");

  const s = rateSensitivity(SWEEP, COSTS, 10, 0.2);
  assert.ok(s.perQuarterPoint > 20_000, "half a point should be worth real money in house");
});

test("a house above the ceiling at every modelled rate is reported as such", () => {
  const zone = buyZone(SWEEP, COSTS, [0.03, 0.05, 0.08], 10, 0.2);
  assert.ok(
    zone.every((z) => (z.maxPrice ?? 0) < 5_000_000),
    "the ceiling should never be absurd"
  );
  assert.ok(zone[0]!.priceToRent !== null && zone[0]!.priceToRent > zone[2]!.priceToRent!);
});

// --- ruling out a lever ----------------------------------------------------

test("a lever the owner has ruled out is not offered as a path to yes", () => {
  const counted = decide({ ...DECIDE_BASE, price: 1_200_000, holdYears: 10 });
  const excluded = decide({ ...DECIDE_BASE, price: 1_200_000, holdYears: 10, excludeRentalIncome: true });

  const countedLever = counted.levers.find((l) => l.key === "income")!;
  const excludedLever = excluded.levers.find((l) => l.key === "income")!;

  assert.ok(countedLever.reachable, "normally this is the reachable lever at this price");
  assert.equal(excludedLever.reachable, false, "once ruled out it must not count");
  assert.equal(excludedLever.needed, "ruled out");
  assert.match(excludedLever.note, /ruled this out/i);
});

test("ruling out the last reachable lever changes the verdict, not just a label", () => {
  const counted = decide({ ...DECIDE_BASE, price: 1_200_000, holdYears: 10 });
  const excluded = decide({ ...DECIDE_BASE, price: 1_200_000, holdYears: 10, excludeRentalIncome: true });
  assert.match(counted.verdict, /not hopeless/i);
  assert.match(excluded.verdict, /nothing here is close|keep renting/i);
});

test("the second-unit lever distinguishes an existing unit from buying a house to let", () => {
  const d = decide({ ...DECIDE_BASE, price: 1_200_000, holdYears: 10, excludeRentalIncome: true });
  const lever = d.levers.find((l) => l.key === "income")!;
  assert.match(lever.note, /adds a home to the rental stock/i);
  assert.match(lever.note, /Buying a single-family house to let does not/i);
});

test("REGRESSION: the rate threshold is the highest rate that works, not the lowest", () => {
  // The ceiling descends as the rate rises, so searching a rate-ascending array
  // forward returns the cheapest rate on the axis. The UI reported "needs 3.00%"
  // for a house that actually worked up to 4.00%.
  const rates: number[] = [];
  for (let r = 0.03; r <= 0.1001; r += 0.0025) rates.push(r);
  const zone = buyZone(
    { ...SWEEP, homeAppreciation: 0.07, rentGrowth: 0.05, investmentReturn: 0.1 },
    COSTS,
    rates,
    10,
    0.2
  );

  const price = 1_200_000;
  const forward = zone.find((z) => (z.maxPrice ?? 0) >= price)!;
  const backward = [...zone].reverse().find((z) => (z.maxPrice ?? 0) >= price)!;

  assert.ok(backward.rate > forward.rate, "the two searches must differ, or this test proves nothing");
  // Everything at or below the threshold works; the next step up does not.
  const above = zone.find((z) => z.rate > backward.rate + 0.001);
  assert.ok((above?.maxPrice ?? 0) < price, "the step above the threshold must fail");
});

test("the ceiling reported for a rate matches an exact recomputation", () => {
  const exact = maxPriceForHoldPeriod(SWEEP, COSTS, 10, 0.2);
  const sampled = buyZone(SWEEP, COSTS, [SWEEP.interestRate], 10, 0.2)[0]!.maxPrice;
  assert.equal(exact, sampled, "the same rate must produce the same ceiling from either path");
});

// --- matched assumptions ---------------------------------------------------

test("every assumption set draws both returns from the same period", () => {
  // Every county's sets, not just the default one's, since they are computed
  // from each county's own record now.
  for (const set of CA_COUNTIES.flatMap((c) => assumptionSets(c))) {
    assert.ok(set.basis.length > 60, `${set.id} must say where its numbers come from`);
    assert.ok(set.investmentReturn > set.homeAppreciation, "equities have outrun housing in every period measured");
    // Appreciation can be NEGATIVE. Butte's last twenty years run at -1.4%, and
    // pretending otherwise is how the slider came to clamp it silently to zero.
    assert.ok(set.homeAppreciation > -0.05 && set.homeAppreciation < 0.12, `${set.id}: ${set.homeAppreciation}`);
    assert.ok(set.investmentReturn > 0 && set.investmentReturn < 0.2);
  }
});

test("REGRESSION: mixing periods flatters buying, matching them does not", () => {
  // The trap the presets exist to close. San Diego's 7% decade next to a
  // century-long 10% equity average is not a comparison, it is a thumb on
  // the scale.
  const mixed = maxPriceForHoldPeriod({ ...SWEEP, homeAppreciation: 0.0701, investmentReturn: 0.1 }, COSTS, 10, 0.2)!;
  const lastDecade = ASSUMPTION_SETS.find((a) => a.id === "last-decade")!;
  const matched = maxPriceForHoldPeriod(
    { ...SWEEP, homeAppreciation: lastDecade.homeAppreciation, investmentReturn: lastDecade.investmentReturn },
    COSTS,
    10,
    0.2
  )!;
  assert.ok(mixed > matched, "the mismatched pairing must produce the more generous ceiling");
});

test("the answer is stable once the periods are matched, which is the real finding", () => {
  const ceilings = ASSUMPTION_SETS.map(
    (set) =>
      maxPriceForHoldPeriod(
        {
          ...SWEEP,
          homeAppreciation: set.homeAppreciation,
          investmentReturn: set.investmentReturn,
          rentGrowth: set.rentGrowth,
        },
        COSTS,
        10,
        0.2
      ) ?? 0
  );
  const low = Math.min(...ceilings);
  const high = Math.max(...ceilings);
  assert.ok(low > 200_000, "every matched set should still support buying something");
  assert.ok(high < low * 1.8, `matched sets should agree within a narrow band, got ${low} to ${high}`);
});

// --- the mortgage interest deduction ---------------------------------------

test("the deduction is modelled and materially favours owning", () => {
  const without = scenario({ marginalTaxRate: 0 });
  const withIt = scenario({ marginalTaxRate: DEFAULT_MARGINAL_TAX_RATE });
  assert.ok(withIt.firstYear.burned < without.firstYear.burned, "relief must reduce money that buys nothing");
  const relief = without.firstYear.burned - withIt.firstYear.burned;
  assert.ok(relief > 10_000, `year-one relief on a large loan should be five figures, got ${relief}`);
});

test("only interest on the first $750,000 of debt is deductible", () => {
  // With realistic SALT the standard deduction is already cleared, so the
  // interest is fully marginal and the debt limit is the only thing biting.
  const other = { marginalTaxRate: DEFAULT_MARGINAL_TAX_RATE, otherItemizedDeductions: 25_000 };
  const reliefShare = (loan: number) => {
    const gross = scenario({ loanAmount: loan, marginalTaxRate: 0 });
    const net = scenario({ loanAmount: loan, ...other });
    return (gross.firstYear.burned - net.firstYear.burned) / gross.firstYear.interestPaid;
  };
  assert.ok(reliefShare(700_000) > reliefShare(1_400_000), "the $750k cap must bite on the larger loan");
  assert.ok(Math.abs(reliefShare(700_000) - DEFAULT_MARGINAL_TAX_RATE) < 0.02);
});

test("REGRESSION: the deduction only counts above the standard deduction", () => {
  // Granting full marginal relief on every interest dollar overstated the
  // subsidy for anyone whose deductions do not clear the threshold.
  const noOther = scenario({ loanAmount: 200_000, marginalTaxRate: DEFAULT_MARGINAL_TAX_RATE });
  const withSalt = scenario({
    loanAmount: 200_000,
    marginalTaxRate: DEFAULT_MARGINAL_TAX_RATE,
    otherItemizedDeductions: 25_000,
  });
  assert.ok(
    withSalt.firstYear.taxRelief > noOther.firstYear.taxRelief,
    "a household that already itemises gets more from the same interest"
  );

  // A small loan with no other deductions should get little or nothing.
  const tiny = scenario({ loanAmount: 100_000, marginalTaxRate: DEFAULT_MARGINAL_TAX_RATE });
  assert.ok(tiny.firstYear.taxRelief < 1_000, `expected almost no relief, got ${tiny.firstYear.taxRelief}`);
});

test("REGRESSION: tax relief is reported separately, not netted into the carrying bucket", () => {
  // It used to be subtracted from a figure the UI labelled "tax, insurance and
  // upkeep", which made that line disagree with the itemised payment panel by
  // an order of magnitude.
  const r = scenario({ marginalTaxRate: DEFAULT_MARGINAL_TAX_RATE, otherItemizedDeductions: 25_000 });
  assert.ok(r.firstYear.taxRelief > 0, "relief must be reported");
  const gross = (r.firstYear.carryingAndMaintenance / 12) * 12;
  assert.ok(gross > 20_000, "the carrying bucket must be gross of relief");
  const f = r.firstYear;
  assert.ok(
    Math.abs(
      f.burned - (f.closingCosts + f.interestPaid + f.carryingAndMaintenance + f.mortgageInsurance - f.taxRelief)
    ) < 1,
    "burned must reconcile as closing plus interest plus carrying plus MI minus relief"
  );
});

test("REGRESSION: year one burned agrees with the cumulative series it sits beside", () => {
  // firstYear.burned had no mortgage insurance term and no closing costs, while
  // years[0].buyMoneyBurned charged both, so one result object reported two
  // different year-one figures and the panel showed whichever it happened to read.
  const r = scenario({
    marginalTaxRate: DEFAULT_MARGINAL_TAX_RATE,
    otherItemizedDeductions: 25_000,
    monthlyMortgageInsurance: 420,
    mortgageInsuranceEndsMonth: null,
  });
  assert.ok(r.firstYear.mortgageInsurance > 0, "the MI must be reported");
  assert.ok(
    Math.abs(r.firstYear.burned - r.years[0]!.buyMoneyBurned) < 1,
    `year one burn disagrees: ${r.firstYear.burned} against ${r.years[0]!.buyMoneyBurned}`
  );
});

test("REGRESSION: the deduction moves the buy ceiling by hundreds of thousands", () => {
  // Leaving it out was not a rounding error, it changed the recommendation.
  const base = { ...SWEEP, marginalTaxRate: 0 };
  const withTax = { ...SWEEP, marginalTaxRate: DEFAULT_MARGINAL_TAX_RATE };
  const without = maxPriceForHoldPeriod(base, COSTS, 10, 0.2)!;
  const withIt = maxPriceForHoldPeriod(withTax, COSTS, 10, 0.2)!;
  assert.ok(withIt > without + 150_000, `expected a large shift, got ${without} to ${withIt}`);
});

test("the relief shrinks over the life of the loan as interest does", () => {
  const r = scenario({ marginalTaxRate: DEFAULT_MARGINAL_TAX_RATE });
  // Owning cost rises over time partly because the deduction fades.
  const early = r.years[1]!.monthlyOwnCost;
  const late = r.years[24]!.monthlyOwnCost;
  assert.ok(late > early, "the subsidy is front-loaded and must decay");
});

test("the caveat no longer claims to ignore the deduction", () => {
  assert.match(RENT_VS_BUY_CAVEAT, /includes the mortgage interest deduction/i);
  assert.match(RENT_VS_BUY_CAVEAT, /750,000/);
});

// --- audit regressions -----------------------------------------------------

test("REGRESSION: ruling out rental income changes the numbers, not just the label", () => {
  // The checkbox used to be decorative. It greyed out the lever while every
  // figure behind the verdict still counted income the user said they would
  // never collect.
  const base = { ...SWEEP, monthlyRentalIncome: 3_000 };
  const counted = decide({ base, costs: COSTS, price: 1_600_000, holdYears: 10, downPercent: 0.2 });
  const excluded = decide({
    base,
    costs: COSTS,
    price: 1_600_000,
    holdYears: 10,
    downPercent: 0.2,
    excludeRentalIncome: true,
  });

  assert.ok(
    (excluded.priceNeeded ?? 0) < (counted.priceNeeded ?? 0),
    "removing the income must lower the price you can justify"
  );
});

test("REGRESSION: the price sweep charges mortgage insurance, like the itemised panel does", () => {
  // The sweep had no mortgage-insurance term at all, so a low-deposit or FHA
  // buyer could be passed by one panel and failed by another on the same screen.
  const noMi = { ...COSTS };
  const withMi = { ...COSTS, mortgageInsuranceRate: 0.006, mortgageInsuranceEndsMonth: 111 };
  const a = maxPriceForHoldPeriod(SWEEP, noMi, 10, 0.1)!;
  const b = maxPriceForHoldPeriod(SWEEP, withMi, 10, 0.1)!;
  assert.ok(b < a, "charging mortgage insurance must lower the ceiling");
});

test("REGRESSION: mortgage insurance terminates and does not escalate", () => {
  const forever = scenario({
    monthlyMortgageInsurance: 400,
    mortgageInsuranceEndsMonth: null,
    marginalTaxRate: 0,
  });
  const ends = scenario({
    monthlyMortgageInsurance: 400,
    mortgageInsuranceEndsMonth: 111,
    marginalTaxRate: 0,
  });
  // buyNetWorth is value minus balance, so mortgage insurance cannot touch it.
  // It shows up in the GAP, because it changes what the renter has left to invest.
  const gap = (r: ReturnType<typeof compareRentVsBuy>) => r.years[29]!.buyNetWorth - r.years[29]!.rentNetWorth;
  assert.ok(gap(ends) > gap(forever), "terminating MI must close the gap against renting");
  // Once it has ended the owner's monthly cost must not include it.
  const before = ends.years[8]!.monthlyOwnCost;
  const after = ends.years[10]!.monthlyOwnCost;
  assert.ok(after < before + 200, "cost should drop, or at least not carry MI, after termination");
});

// ---------------------------------------------------------------------------
// The sliders and the named sets have to be able to express each other.
// ---------------------------------------------------------------------------

const markup = fs.readFileSync(new URL("../src/index.njk", import.meta.url), "utf8");

const slider = (id: string) => {
  const tag = markup.match(new RegExp(`<input id="${id}"[^>]*>`))![0];
  const attr = (name: string) => Number(tag.match(new RegExp(`${name}="(-?\\d+)"`))![1]);
  return { min: attr("min"), max: attr("max"), value: attr("value") };
};

test("REGRESSION: every named assumption set fits on its slider, in every county", () => {
  // "Last decade" sets a 14.7% return against a slider that stopped at 12.0%,
  // so choosing it silently ran 12% while the caption underneath said 14.7%,
  // and the verdict flipped from never to year six on a number nobody typed.
  const bounds = {
    appreciation: slider("appreciation"),
    investReturn: slider("investReturn"),
    rentGrowth: slider("rentGrowth"),
  };
  // Not just the default county's: the sets are computed per county now, and
  // Butte's twenty-year appreciation is NEGATIVE, which a slider flooring at
  // zero would have clamped to 0% while the caption said -1.4%.
  const everySet = CA_COUNTIES.flatMap((c) => assumptionSets(c));
  for (const set of everySet) {
    const values = {
      appreciation: Math.round(set.homeAppreciation * 1000),
      investReturn: Math.round(set.investmentReturn * 1000),
      rentGrowth: Math.round(set.rentGrowth * 1000),
    };
    for (const key of ["appreciation", "investReturn", "rentGrowth"] as const) {
      const b = bounds[key];
      assert.ok(
        values[key] >= b.min && values[key] <= b.max,
        `${set.id} ${key} of ${values[key] / 10}% is outside the slider (${b.min / 10}% to ${b.max / 10}%)`
      );
    }
  }
});

test("REGRESSION: the page opens on a named set, not an unsourced hybrid", () => {
  // Appreciation from one period and investment return from another is the
  // exact mismatch the copy above the sliders warns about.
  const opening = {
    homeAppreciation: slider("appreciation").value / 1000,
    investmentReturn: slider("investReturn").value / 1000,
    rentGrowth: slider("rentGrowth").value / 1000,
  };
  const match = ASSUMPTION_SETS.find(
    (s) =>
      Math.abs(s.homeAppreciation - opening.homeAppreciation) < 0.001 &&
      Math.abs(s.investmentReturn - opening.investmentReturn) < 0.001 &&
      Math.abs(s.rentGrowth - opening.rentGrowth) < 0.001
  );
  assert.ok(
    match,
    `the shipped defaults (${opening.homeAppreciation}/${opening.investmentReturn}/${opening.rentGrowth}) match no named set`
  );
});
