import { test } from "node:test";
import assert from "node:assert/strict";

import { burdenSeries, crashSignals, leadingIndicators, worstTimeToBuy } from "../lib/signals.ts";
import { crashPresets } from "../lib/history.ts";
import { CA_MEDIAN_INCOME, NEW_HOME_SUPPLY } from "../lib/data/signals.ts";

test("the burden series is complete and plausible", () => {
  const s = burdenSeries();
  assert.ok(s.length > 400);
  for (const p of s) {
    assert.ok(
      p.paymentToIncome > 0.1 && p.paymentToIncome < 2,
      `implausible burden ${p.paymentToIncome} at ${p.month}`
    );
    assert.ok(p.priceToIncome > 1 && p.priceToIncome < 30, `implausible multiple ${p.priceToIncome} at ${p.month}`);
    assert.ok(p.income > 0 && p.payment > 0);
  }
});

test("burden combines price AND rate, not either alone", () => {
  const s = burdenSeries();
  const at = (m: string) => s.find((p) => p.month === m)!;
  const peak2021 = at("2021-08");
  const late2023 = at("2023-10");

  // 2023 prices were higher than 2021's but not hugely so...
  assert.ok(late2023.price > peak2021.price);
  assert.ok(late2023.price < peak2021.price * 1.3);
  // ...yet the burden was far worse, because the rate had tripled.
  assert.ok(late2023.paymentToIncome > peak2021.paymentToIncome * 1.5, "the rate should dominate here");
});

test("the worst month on record is the 2023 rate spike, not a price peak", () => {
  const v = worstTimeToBuy();
  assert.equal(v.worstEver.month.slice(0, 4), "2023");
  assert.ok(v.worstEver.rate > 0.07, "the worst month coincided with 7%+ rates");
});

test("today is not the worst ever, and the answer says so plainly", () => {
  const v = worstTimeToBuy();
  assert.ok(v.rank > 1, "if this ever becomes rank 1 the copy must change");
  assert.match(v.answer, /^No/);
  // But it is genuinely bad: top decile.
  assert.ok(v.percentileWorseThan > 0.8, `expected top-quintile burden, got ${v.percentileWorseThan}`);
});

test("the best time to buy in the record was the post-crash bottom", () => {
  const v = worstTimeToBuy();
  const year = Number(v.bestEver.month.slice(0, 4));
  assert.ok(year >= 2009 && year <= 2015, `expected the post-crash window, got ${v.bestEver.month}`);
  // Buying then cost roughly half what it costs now.
  assert.ok(v.bestEver.paymentToIncome < v.latest.paymentToIncome * 0.6);
});

test("signal readings carry both a 2006 and a 2009 comparison", () => {
  const { readings } = crashSignals();
  assert.ok(readings.length >= 5);
  for (const r of readings) {
    assert.ok(r.now !== null, `${r.key} has no current reading`);
    assert.ok(r.at2006Peak !== null, `${r.key} missing its 2006 comparison`);
    assert.ok(r.at2009Trough !== null, `${r.key} missing its 2009 comparison`);
    assert.ok(r.reading.length > 40, `${r.key} needs a real interpretation`);
  }
});

test("the dashboard is not one-sided. It carries both bearish and bullish reads", () => {
  const { readings } = crashSignals();
  assert.ok(
    readings.some((r) => r.lean === "bearish"),
    "valuation signals are stretched and should say so"
  );
  assert.ok(
    readings.some((r) => r.lean === "bullish"),
    "credit and employment argue against a crash and must not be omitted"
  );
});

test("REGRESSION: the new-home supply signal ships its new-construction caveat", () => {
  // 9.3 months reads like 2008 only because it counts NEW homes. Existing-home
  // supply is far lower. Presenting this number bare would be misleading.
  const supply = crashSignals().readings.find((r) => r.key === "supply")!;
  assert.ok(supply.caveat, "the supply reading must carry a caveat");
  assert.match(supply.caveat, /NEW CONSTRUCTION ONLY/);
  assert.match(supply.caveat, /existing-home supply/i);
});

test("delinquency is flagged bullish, it is the strongest not-2008 argument", () => {
  const d = crashSignals().readings.find((r) => r.key === "delinquency")!;
  assert.equal(d.lean, "bullish");
  assert.ok(d.now! < d.at2009Trough! / 2, "delinquency should be far below crisis levels");
  assert.match(d.reading, /forced sellers/i);
});

test("correlations report an honest effective sample, not the inflated one", () => {
  const inds = leadingIndicators(24);
  for (const c of inds) {
    assert.ok(Math.abs(c.r) <= 1);
    assert.ok(c.effectiveObservations < c.observations / 20, "effective n must deflate the overlapping windows");
    assert.ok(c.effectiveObservations < 30, `an effective n of ${c.effectiveObservations} would be suspiciously large`);
  }
});

test("supply is the strongest single historical relationship", () => {
  const inds = leadingIndicators(24);
  const strongest = inds.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a));
  assert.equal(strongest.key, "supply");
  assert.ok(strongest.r < 0, "more supply preceded weaker prices");
});

test("the caveats travel with the numbers as data, not prose the UI can drop", () => {
  const { caveats, summary } = crashSignals();
  assert.ok(caveats.length >= 4);
  assert.ok(
    caveats.some((c) => /two declines/i.test(c)),
    "the N=2 problem must be stated"
  );
  assert.ok(
    caveats.some((c) => /overlapping/i.test(c)),
    "the overlapping-window problem must be stated"
  );
  assert.ok(summary.length > 100);
});

// --- Extreme presets -------------------------------------------------------

test("extreme scenarios exist and are ordered sensibly", () => {
  const presets = crashPresets();
  const ids = presets.map((p) => p.id);
  for (const id of ["recession", "worse-than-2008", "japan", "stagflation"]) {
    assert.ok(ids.includes(id), `missing the ${id} scenario`);
  }
  const worst = presets.find((p) => p.id === "worse-than-2008")!;
  assert.ok(worst.depthPercent > 42, "must exceed the actual 2006 crash to earn the name");
});

test("the beyond-historical scenario admits it is beyond historical", () => {
  const worst = crashPresets().find((p) => p.id === "worse-than-2008")!;
  assert.match(worst.basis, /Beyond anything in the San Diego record/i);
  assert.match(worst.basis, /because you asked for the tail, not because anything in the data points here/i);
});

test("the recession scenario cites a real published forecast rather than a round number", () => {
  const r = crashPresets().find((p) => p.id === "recession")!;
  assert.match(r.basis, /Moody's/);
  assert.ok(r.depthPercent >= 15 && r.depthPercent <= 20, "should sit in the published 15-20% band");
});

test("long stagnation is slower than either real crash, by design", () => {
  const japan = crashPresets().find((p) => p.id === "japan")!;
  assert.ok(japan.monthsToBottom >= 74, "must be at least as slow as the 1990-96 decline");
  assert.ok(japan.depthPercent < 42);
});

test("every preset fits the UI slider ranges", () => {
  for (const p of crashPresets()) {
    assert.ok(p.depthPercent >= 0 && p.depthPercent <= 50, `${p.id} depth ${p.depthPercent} is off-slider`);
    assert.ok(p.monthsToBottom >= 6 && p.monthsToBottom <= 84, `${p.id} duration ${p.monthsToBottom} is off-slider`);
    assert.ok(p.rateAtBottom >= 0.03 && p.rateAtBottom <= 0.11, `${p.id} rate ${p.rateAtBottom} is off-slider`);
  }
});

test("the underlying data files are present and current", () => {
  assert.ok(CA_MEDIAN_INCOME.length > 35);
  assert.ok(NEW_HOME_SUPPLY.length > 400);
  assert.ok(NEW_HOME_SUPPLY[NEW_HOME_SUPPLY.length - 1]![0] >= "2026-01");
});
