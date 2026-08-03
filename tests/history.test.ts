import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSeries,
  crashPresets,
  currentStatus,
  defaultCrashPreset,
  evaluateWaiting,
  findDrawdowns,
  historicalContext,
  paymentExtremes,
} from "../lib/history.ts";
import { BEST_REFI, REFI_WINDOW, compareToCohort, incomeLadder, refinanceOpportunity } from "../lib/cohort.ts";
import {
  AFFORDABILITY_EFFORT,
  BUYING_POWER_CAVEAT,
  affordablePriceAt,
  buyingPowerSeries,
  buyingPowerVerdict,
} from "../lib/buying-power.ts";
import { DEFAULT_ANCHOR_PRICE } from "../lib/history.ts";
import { monthlyPayment } from "../lib/amortization.ts";
import { SD_HISTORY, HISTORY_LATEST_INDEX, HISTORY_LATEST_MONTH, HISTORY_LATEST_RATE } from "../lib/data/history.ts";

test("the history series is well formed and monotonic in time", () => {
  assert.ok(SD_HISTORY.length > 400, "expected 400+ months of data");
  for (let i = 1; i < SD_HISTORY.length; i++) {
    assert.ok(SD_HISTORY[i]![0] > SD_HISTORY[i - 1]![0], `months out of order near ${SD_HISTORY[i]![0]}`);
  }
  for (const [month, index, rate] of SD_HISTORY) {
    assert.match(month, /^\d{4}-\d{2}$/);
    assert.ok(index > 0 && index < 10_000, `implausible index ${index} at ${month}`);
    assert.ok(rate > 0 && rate < 25, `implausible rate ${rate} at ${month}`);
  }
});

test("the 2006 crash is found with the right shape", () => {
  const drops = findDrawdowns(10);
  const big = drops.find((d) => d.peakMonth.startsWith("2006"));
  assert.ok(big, "expected a drawdown peaking in 2006");
  // Case-Shiller San Diego fell about 42% from its 2006 peak to a 2009 trough.
  assert.ok(big.depthPercent < -40 && big.depthPercent > -45, `unexpected depth ${big.depthPercent}`);
  assert.equal(big.troughMonth.slice(0, 4), "2009");
  assert.ok(big.monthsPeakToTrough > 30 && big.monthsPeakToTrough < 45);
  assert.ok(big.recoveredMonth, "the 2006 peak was eventually recovered");
  // Buying that peak meant more than a decade underwater.
  assert.ok(big.monthsUnderwater! > 120, `expected 10+ years underwater, got ${big.monthsUnderwater}`);
});

test("San Diego has crashed rarely. The sample is too small to forecast from", () => {
  const drops = findDrawdowns(10);
  assert.ok(drops.length <= 3, `expected at most 3 major declines in 39 years, got ${drops.length}`);
  assert.ok(drops.length >= 2, "expected at least the 1990s and 2000s declines");
});

test("drawdowns never overlap and always run peak before trough", () => {
  const drops = findDrawdowns(10);
  for (const d of drops) {
    assert.ok(d.peakMonth < d.troughMonth, `${d.peakMonth} should precede ${d.troughMonth}`);
    assert.ok(d.depthPercent < 0);
  }
  for (let i = 1; i < drops.length; i++) {
    assert.ok(drops[i]!.peakMonth > drops[i - 1]!.troughMonth, "drawdowns should not overlap");
  }
});

test("price is not payment: the 2021 peak cost about what the 2006 peak cost", () => {
  const series = buildSeries();
  const at = (m: string) => series.find((p) => p.month === m)!;
  const peak2006 = at("2006-06");
  const peak2021 = at("2021-08");

  // 2021 prices were far higher...
  assert.ok(peak2021.price > peak2006.price * 1.3, "2021 prices should be much higher than 2006");
  // ...but the payment was within 15%, because the rate was ~2.8% vs ~6.3%.
  const ratio = peak2021.payment / peak2006.payment;
  assert.ok(ratio > 0.85 && ratio < 1.15, `expected comparable payments, got ratio ${ratio.toFixed(2)}`);
});

test("payment extremes bracket today's payment sensibly", () => {
  const { cheapest, priciest, latest } = paymentExtremes();
  assert.ok(cheapest.payment < latest.payment);
  assert.ok(priciest.payment >= latest.payment);
  // The 2023 rate spike produced the worst payment in the series.
  assert.ok(priciest.month >= "2023-01", `expected the payment peak in the 2023+ era, got ${priciest.month}`);
});

test("current status reports the trailing window and decline streak", () => {
  const s = currentStatus();
  assert.equal(s.month, HISTORY_LATEST_MONTH);
  assert.equal(s.index, HISTORY_LATEST_INDEX);
  assert.equal(s.trailing12.length, 12);
  assert.ok(s.percentOffRecentPeak <= 0, "cannot be above the recent peak by definition");
  assert.ok(s.consecutiveDeclines >= 0);
});

// --- The waiting question --------------------------------------------------

const waitBase = {
  priceNow: 1_200_000,
  rateNow: 0.0666,
  downPercent: 0.2,
  monthlyRent: 3_290,
  monthlySavings: 0,
  propertyTaxRate: 0.0115,
};

test("a price crash with no rate relief still helps, but rent eats into it", () => {
  const r = evaluateWaiting({ ...waitBase, crashDepthPercent: 25, monthsToBottom: 36, rateAtBottom: 0.0666 });
  assert.ok(r.monthlySaving > 0);
  assert.ok(r.rentPaidWhileWaiting > 100_000);
  assert.ok(r.breakevenMonths !== null && r.breakevenMonths > 0);
});

test("a big enough rate rise turns a price crash into a losing wait", () => {
  // The trap: prices fall 20% but rates rise to 10%. You wait three years, pay
  // rent the whole time, and end up with a bigger payment than if you'd bought.
  const r = evaluateWaiting({ ...waitBase, crashDepthPercent: 20, monthsToBottom: 36, rateAtBottom: 0.1 });
  assert.ok(r.monthlySaving < 0, `expected waiting to lose, saved ${r.monthlySaving}`);
  assert.equal(r.breakevenMonths, null);
  assert.match(r.verdict, /Waiting loses/);
});

test("Prop 13 pushes the break-even rate higher than payment math alone suggests", () => {
  // At a 20% crash, a naive read of P&I says 9% rates roughly cancel 6.66%.
  // They nearly do, but the permanently lower assessed value tips it back to
  // favouring the wait. This is a real California-specific effect and the
  // reason this model tracks tax separately from principal and interest.
  const at9 = evaluateWaiting({ ...waitBase, crashDepthPercent: 20, monthsToBottom: 36, rateAtBottom: 0.09 });

  const piDelta = at9.buyNow.principalAndInterest - at9.buyLater.principalAndInterest;
  const taxDelta = at9.buyNow.propertyTax - at9.buyLater.propertyTax;

  assert.ok(Math.abs(piDelta) < 100, `P&I should roughly cancel, differed by ${piDelta}`);
  assert.ok(taxDelta > 200, `the Prop 13 saving should be the deciding factor, got ${taxDelta}`);
  assert.ok(at9.monthlySaving > 0, "so waiting still edges ahead at 9%");
});

test("falling rates alone can beat a price crash", () => {
  const crashOnly = evaluateWaiting({ ...waitBase, crashDepthPercent: 15, monthsToBottom: 24, rateAtBottom: 0.0666 });
  const ratesOnly = evaluateWaiting({ ...waitBase, crashDepthPercent: 0, monthsToBottom: 24, rateAtBottom: 0.045 });
  assert.ok(ratesOnly.monthlySaving > crashOnly.monthlySaving, "a 2-point rate drop should beat a 15% price drop");
});

test("Prop 13 makes a lower purchase price a permanent advantage", () => {
  const r = evaluateWaiting({ ...waitBase, crashDepthPercent: 30, monthsToBottom: 36, rateAtBottom: 0.06 });
  // 30% off $1.2M is $360k of assessed value, at 1.15%.
  assert.ok(Math.abs(r.propTaxSavingAnnual - 360_000 * 0.0115) < 1);
  assert.ok(r.propTaxSavingAnnual > 4_000);
});

test("waiting accounts for the equity you would have built by buying now", () => {
  const r = evaluateWaiting({ ...waitBase, crashDepthPercent: 20, monthsToBottom: 48, rateAtBottom: 0.06 });
  assert.ok(r.equityBuiltIfBuyingNow > 0, "four years of payments builds real principal");
  assert.ok(r.equityBuiltIfBuyingNow < r.buyNow.loan, "cannot exceed the loan itself");
  assert.ok(r.paperLossIfBuyingNow > 0);
});

test("savings while renting reduce the loan you need later", () => {
  const without = evaluateWaiting({
    ...waitBase,
    crashDepthPercent: 20,
    monthsToBottom: 36,
    rateAtBottom: 0.06,
    monthlySavings: 0,
  });
  const withSaving = evaluateWaiting({
    ...waitBase,
    crashDepthPercent: 20,
    monthsToBottom: 36,
    rateAtBottom: 0.06,
    monthlySavings: 2_000,
  });
  assert.ok(withSaving.buyLater.loan < without.buyLater.loan);
  assert.ok(withSaving.monthlySaving > without.monthlySaving);
});

test("historical context ships its caveats alongside its numbers", () => {
  const ctx = historicalContext();
  assert.ok(ctx.yearsOfData >= 38);
  assert.ok(ctx.caveats.length >= 4);
  assert.ok(ctx.caveats.some((c) => /Price is not payment/i.test(c)));
  assert.ok(ctx.caveats.some((c) => /still have a job/i.test(c)));
  assert.ok(ctx.caveats.some((c) => /Prop 13/i.test(c)));
});

// --- Cohort comparison -----------------------------------------------------

test("an earlier buyer of the same house pays dramatically less", () => {
  const c = compareToCohort({
    currentPrice: 1_200_000,
    currentRate: 0.0666,
    downPercent: 0.2,
    propertyTaxRate: 0.0115,
    purchaseMonth: "2019-06",
    refinancedRate: 0.0275,
  });
  assert.ok(c);
  assert.ok(c.priceThen < 1_200_000, "the same house cost less in 2019");
  assert.ok(c.totalAdvantage > 3_000, `expected a large monthly gap, got ${c.totalAdvantage}`);
  assert.ok(c.rateAdvantage > 0 && c.prop13Advantage > 0 && c.priceAdvantage > 0);
});

test("the advantage decomposition adds up to the total", () => {
  const c = compareToCohort({
    currentPrice: 1_200_000,
    currentRate: 0.0666,
    downPercent: 0.2,
    propertyTaxRate: 0.0115,
    purchaseMonth: "2015-01",
  })!;
  const summed = c.rateAdvantage + c.priceAdvantage + c.prop13Advantage;
  assert.ok(Math.abs(summed - c.totalAdvantage) < 0.01, `decomposition ${summed} != total ${c.totalAdvantage}`);
});

test("Prop 13 keeps the earlier buyer's assessed value far below market", () => {
  const c = compareToCohort({
    currentPrice: 1_200_000,
    currentRate: 0.0666,
    downPercent: 0.2,
    propertyTaxRate: 0.0115,
    purchaseMonth: "2012-01",
  })!;
  assert.ok(c.assessedValueNow < 1_200_000, "their assessment lags the market");
  // 2% annual growth compounds slower than San Diego appreciated.
  assert.ok(c.assessedValueNow > c.priceThen, "but it does grow from their purchase price");
});

test("buying at the very latest month shows no advantage over yourself", () => {
  // Use the same rate the history series reports for that month, otherwise the
  // comparison is against a different rate and a gap is correct, not a bug.
  const c = compareToCohort({
    currentPrice: 1_200_000,
    currentRate: HISTORY_LATEST_RATE / 100,
    downPercent: 0.2,
    propertyTaxRate: 0.0115,
    purchaseMonth: HISTORY_LATEST_MONTH,
  })!;
  assert.ok(Math.abs(c.totalAdvantage) < 1, `expected ~0 advantage, got ${c.totalAdvantage}`);
  assert.ok(Math.abs(c.assessedValueNow - 1_200_000) < 1, "a same-month buyer has no Prop 13 lag");
});

test("an unknown month returns null rather than guessing", () => {
  assert.equal(
    compareToCohort({
      currentPrice: 1_200_000,
      currentRate: 0.0666,
      downPercent: 0.2,
      propertyTaxRate: 0.0115,
      purchaseMonth: "1902-01",
    }),
    null
  );
});

test("the income ladder shows what a second earner is worth", () => {
  const ladder = incomeLadder(8_773, 0, 0.45);
  assert.equal(ladder[0]!.perEarner, ladder[0]!.totalRequired);
  assert.ok(ladder[1]!.perEarner < ladder[0]!.perEarner / 1.9, "splitting evenly roughly halves the per-person bar");
});

// --- Refinance modelling ---------------------------------------------------

test("the refinance rate is derived from the data, never hardcoded", () => {
  // Whatever the cheapest month in the window is, BEST_REFI must equal it.
  const window = SD_HISTORY.filter((r) => r[0] >= REFI_WINDOW.from && r[0] <= REFI_WINDOW.to);
  const trueMin = window.reduce((a, b) => (b[2] < a[2] ? b : a));
  assert.equal(BEST_REFI.month, trueMin[0]);
  assert.ok(Math.abs(BEST_REFI.rate - trueMin[2] / 100) < 1e-12);
  // Sanity: it should be the all-time low, under 3%.
  assert.ok(BEST_REFI.rate < 0.03, `expected a sub-3% record low, got ${BEST_REFI.rate}`);
});

test("only owners who predate the window get to refinance into it", () => {
  assert.ok(refinanceOpportunity("2003-06"), "a 2003 buyer could refinance");
  assert.ok(refinanceOpportunity("2019-06"), "a 2019 buyer could refinance");
  assert.equal(refinanceOpportunity("2023-06"), null, "a 2023 buyer missed it entirely");
  assert.equal(refinanceOpportunity(HISTORY_LATEST_MONTH), null);
});

test("REGRESSION: a refinance applies to the remaining balance, not the original loan", () => {
  // A 2003 buyer had paid down ~17 years before refinancing in late 2020.
  // Modelling the refi against the ORIGINAL loan amount overstates their payment
  // badly, which understates how much cheaper their life actually is.
  const refi = refinanceOpportunity("2003-06")!;
  const shared = { currentPrice: 1_200_000, currentRate: 0.0666, downPercent: 0.2, propertyTaxRate: 0.0115 };

  const correct = compareToCohort({
    ...shared,
    purchaseMonth: "2003-06",
    refinancedRate: refi.rate,
    refinanceMonth: refi.month,
  })!;
  // Without a refinanceMonth the function falls back to the original-loan model.
  const naive = compareToCohort({ ...shared, purchaseMonth: "2003-06", refinancedRate: refi.rate })!;

  assert.ok(
    correct.theirPayment.principalAndInterest < naive.theirPayment.principalAndInterest,
    "amortizing to the refi date must produce a smaller payment than refinancing the full original loan"
  );
  assert.ok(correct.totalAdvantage > naive.totalAdvantage, "and therefore a larger advantage");
});

test("the decomposition still sums to the total when a refinance is modelled", () => {
  const refi = refinanceOpportunity("2012-06")!;
  const c = compareToCohort({
    currentPrice: 1_200_000,
    currentRate: 0.0666,
    downPercent: 0.2,
    propertyTaxRate: 0.0115,
    purchaseMonth: "2012-06",
    refinancedRate: refi.rate,
    refinanceMonth: refi.month,
  })!;
  const summed = c.rateAdvantage + c.priceAdvantage + c.prop13Advantage;
  assert.ok(Math.abs(summed - c.totalAdvantage) < 0.01, `decomposition ${summed} != total ${c.totalAdvantage}`);
  assert.equal(c.refinancedMonth, refi.month);
});

test("the advantage shrinks monotonically for more recent buyers", () => {
  const shared = { currentPrice: 1_200_000, currentRate: 0.0666, downPercent: 0.2, propertyTaxRate: 0.0115 };
  const advantages = [1995, 2003, 2012, 2019, 2023].map((y) => {
    const refi = refinanceOpportunity(`${y}-06`);
    return compareToCohort({
      ...shared,
      purchaseMonth: `${y}-06`,
      refinancedRate: refi?.rate,
      refinanceMonth: refi?.month,
    })!.totalAdvantage;
  });
  for (let i = 1; i < advantages.length; i++) {
    assert.ok(advantages[i]! < advantages[i - 1]!, `buying later should mean less advantage (index ${i})`);
  }
});

// --- Crash presets ---------------------------------------------------------

test("crash presets are derived from real drawdowns, not invented round numbers", () => {
  const presets = crashPresets();
  const drops = findDrawdowns(10);
  assert.ok(presets.length >= 3);

  for (const id of ["mild", "severe"]) {
    const p = presets.find((x) => x.id === id)!;
    const match = drops.find((d) => Math.round(Math.abs(d.depthPercent)) === p.depthPercent);
    assert.ok(match, `preset ${id} (${p.depthPercent}%) must correspond to a real decline`);
    assert.equal(p.monthsToBottom, match.monthsPeakToTrough);
  }
});

test("the default preset is the milder decline, not an average of the two", () => {
  const preset = defaultCrashPreset();
  const drops = findDrawdowns(10);
  const mildest = drops.reduce((a, b) => (b.depthPercent > a.depthPercent ? b : a));
  assert.equal(preset.depthPercent, Math.round(Math.abs(mildest.depthPercent)));
  // An average of -16.7 and -42.2 would be ~29. A crash that has never happened.
  assert.notEqual(preset.depthPercent, 29);
  assert.match(preset.basis, /milder/i);
});

test("every preset explains where its numbers came from", () => {
  for (const p of crashPresets()) {
    assert.ok(p.basis.length > 40, `preset ${p.id} needs a real explanation`);
    assert.ok(p.rateAtBottom > 0 && p.rateAtBottom < 0.2);
    assert.ok(p.monthsToBottom > 0);
  }
});

test("the severe preset reproduces the 2008 crash as it actually happened", () => {
  const severe = crashPresets().find((p) => p.id === "severe")!;
  assert.equal(severe.depthPercent, 42);
  // Rates had already fallen to the mid-4s by the 2009 trough. The crash and
  // the rate relief arrived together, which is the historically normal pattern.
  assert.ok(severe.rateAtBottom < 0.055, `expected sub-5.5% at the 2009 trough, got ${severe.rateAtBottom}`);
});

// --- Buying power: the thesis ----------------------------------------------

test("buying power holds effort constant and lets the affordable price float", () => {
  const s = buyingPowerSeries();
  for (const p of s) {
    // The affordable price must be exactly what a 30%-of-income payment buys.
    const budget = (p.income / 12) * AFFORDABILITY_EFFORT;
    const expected = affordablePriceAt(budget, p.rate);
    assert.ok(Math.abs(p.affordablePrice - expected) < 0.01, `mismatch at ${p.month}`);
  }
});

test("the affordable-price inversion round-trips through the payment formula", () => {
  // Whatever price the inversion returns, financing it must cost the budget.
  const budget = 4000;
  for (const rate of [0.03, 0.0666, 0.09]) {
    const price = affordablePriceAt(budget, rate);
    const payment = monthlyPayment(price * 0.8, rate, 30);
    assert.ok(Math.abs(payment - budget) < 0.01, `round-trip failed at ${rate}`);
  }
});

test("REGRESSION: rates move buying power as much as prices do", () => {
  // The whole thesis depends on this being a two-variable problem. Same income,
  // different rate, very different house.
  const cheap = affordablePriceAt(4000, 0.03);
  const dear = affordablePriceAt(4000, 0.08);
  assert.ok(cheap > dear * 1.5, "a 5-point rate swing should move buying power by more than half");
});

test("the record identifies when a median income stopped buying a median home", () => {
  const v = buyingPowerVerdict();
  assert.ok(v.lastAffordableMonth, "there was a window when it worked");
  // It closed after the post-crash bottom and has not reopened.
  assert.ok(v.lastAffordableMonth! > "2009-01");
  assert.ok(v.latest.purchasingRatio < 1, "it has not reopened");
});

test("buying power today is far below where the record started", () => {
  const v = buyingPowerVerdict();
  assert.ok(v.powerLost > 0.25, `expected a large loss, got ${v.powerLost}`);
  assert.ok(v.latest.yearsOfIncome > v.first.yearsOfIncome * 1.5, "years-of-income should have risen sharply");
  assert.ok(v.incomeNeededToday > v.latest.income, "restoring the old ratio requires more income");
});

test("the thesis copy states the relative claim, not just 'houses are expensive'", () => {
  const v = buyingPowerVerdict();
  assert.match(v.headline, /faster than incomes/i);
  assert.match(v.blueberries, /years of median household income/i);
});

test("the buying-power caveat discloses the generous assumptions", () => {
  assert.match(BUYING_POWER_CAVEAT, /excludes tax, insurance/i);
  assert.match(BUYING_POWER_CAVEAT, /most generous possible reading/i);
});

test("REGRESSION: stating old dollars in today's money leaves the ratio untouched", () => {
  // The chart can be shown either way. If the inflation adjustment moved the
  // headline findings, one of the two views would be lying.
  const nominal = buyingPowerVerdict();
  const real = buyingPowerSeries(DEFAULT_ANCHOR_PRICE, true);
  const nominalSeries = buyingPowerSeries(DEFAULT_ANCHOR_PRICE, false);

  for (let i = 0; i < real.length; i += 37) {
    assert.ok(
      Math.abs(real[i]!.purchasingRatio - nominalSeries[i]!.purchasingRatio) < 1e-9,
      `ratio drifted at ${real[i]!.month}`
    );
    assert.ok(Math.abs(real[i]!.yearsOfIncome - nominalSeries[i]!.yearsOfIncome) < 1e-9);
  }
  assert.ok(nominal.lastAffordableMonth);
});

test("old dollars really were worth more, so the adjustment does something", () => {
  const real = buyingPowerSeries(DEFAULT_ANCHOR_PRICE, true);
  const nominal = buyingPowerSeries(DEFAULT_ANCHOR_PRICE, false);
  // 1987 prices should roughly triple when restated in today's money.
  const factor = real[0]!.medianPrice / nominal[0]!.medianPrice;
  assert.ok(factor > 2.5 && factor < 3.5, `expected roughly 3x, got ${factor.toFixed(2)}`);
  // And the latest month should be essentially unchanged.
  assert.ok(Math.abs(real.at(-1)!.medianPrice / nominal.at(-1)!.medianPrice - 1) < 0.02);
});
