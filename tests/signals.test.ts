import { test } from "node:test";
import assert from "node:assert/strict";

import { burdenSeries, crashSignals, leadingIndicators, worstTimeToBuy } from "../lib/signals.ts";
import { crashPresets, findDrawdowns } from "../lib/history.ts";
import { CA_MEDIAN_INCOME, NEW_HOME_SUPPLY } from "../lib/data/signals.ts";
import { CA_COUNTIES } from "../lib/data/ca-loan-limits.ts";

test("the burden series is complete and plausible", () => {
  const s = burdenSeries();
  // The affordability panels start where the INCOME series starts, in 1984, not
  // where the price series starts, in 1975. Every figure here is a ratio of the
  // two, and backfilled income produced artefacts rather than findings.
  assert.ok(s.length > 150, `expected the full income-era record, got ${s.length}`);
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
  const peak2021 = at("2021-09");
  const late2023 = at("2023-12");

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
    // The deflation factor is the window in ROWS: 8 on a quarterly series, 24 on
    // the monthly one this used to be. Hardcoding 20 hardcoded the frequency.
    assert.ok(
      c.effectiveObservations < c.observations / 4,
      `effective n must deflate the overlapping windows: ${c.effectiveObservations} of ${c.observations}`
    );
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
  // The count is per county now: 17 have one decline, 25 two, 16 three. It used
  // to say "two or three" to everybody.
  assert.ok(
    caveats.some((c) => /(One decline|\d+ declines) over 10%/.test(c)),
    "the small-sample problem must be stated, with this county's actual count"
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
  assert.match(worst.basis, /Beyond anything in .+'s record/i);
  assert.match(worst.basis, /because you asked for the tail, not because .*data points here/i);
});

// A flat 50% used to be the tail preset for every county. Merced's own record is
// 65.7%, so the "worse than" button offered a milder crash than the one that
// already happened there.
test("the tail preset is worse than the county's own worst, in every county", () => {
  for (const county of CA_COUNTIES) {
    const tail = crashPresets(county).find((p) => p.id === "worse-than-2008")!;
    const worst = Math.abs(findDrawdowns(10, county)[0] ? Math.min(...findDrawdowns(10, county).map((d) => d.depthPercent)) : 0);
    assert.ok(tail.depthPercent > worst, `${county}: tail ${tail.depthPercent}% is not worse than its record ${worst.toFixed(1)}%`);
  }
});

// "The milder of the two declines on record" was hardcoded. 17 counties have one
// decline and 16 have three, and in the one-decline counties the mild and severe
// presets were the same event with contradictory descriptions.
test("preset copy never claims a decline count the county does not have", () => {
  for (const county of CA_COUNTIES) {
    const n = findDrawdowns(10, county).length;
    const presets = crashPresets(county);
    const real = presets.filter((p) => p.id === "mild" || p.id === "severe");
    assert.equal(real.length, n === 1 ? 1 : 2, `${county} has ${n} declines but ${real.length} real presets`);
    if (n === 1) {
      assert.match(real[0]!.basis, /only decline over 10%/i);
    } else if (n === 2) {
      assert.match(presets.find((p) => p.id === "mild")!.basis, /milder of the two/i);
    } else {
      assert.match(presets.find((p) => p.id === "mild")!.basis, new RegExp(`shallowest of the ${n} declines`, "i"));
    }
  }
});

test("the recession scenario cites a real published forecast rather than a round number", () => {
  const r = crashPresets().find((p) => p.id === "recession")!;
  assert.match(r.basis, /Moody's/);
  assert.ok(r.depthPercent >= 15 && r.depthPercent <= 20, "should sit in the published 15-20% band");
});

// The basis used to quote "74 months, twice as long as 2006-09". San Diego's own
// drawdown finder says 63 months and 1.6x, and no county produces 74.
test("long stagnation quotes the county's own longest decline, not a remembered one", () => {
  for (const county of CA_COUNTIES) {
    const japan = crashPresets(county).find((p) => p.id === "japan")!;
    const drops = findDrawdowns(10, county);
    const longest = Math.max(...drops.map((d) => d.monthsPeakToTrough));
    assert.equal(japan.monthsToBottom, Math.min(120, longest), `${county} stagnation duration is not its longest decline`);
    assert.match(japan.basis, new RegExp(`${Math.min(120, longest)} months to bottom`));
  }
});

// The sliders are widened at render time to reach whatever the presets contain,
// so the assertion is that presets stay physically sane, not that they fit the
// HTML defaults. A preset the slider cannot reach used to be silently clamped.
test("every preset in every county is a physically possible scenario", () => {
  for (const county of CA_COUNTIES) {
    for (const p of crashPresets(county)) {
      assert.ok(p.depthPercent >= 0 && p.depthPercent < 100, `${county}/${p.id} depth ${p.depthPercent}`);
      // Merced's 1980 decline was 15.5% in a single quarter, so 3 is a real answer.
      assert.ok(p.monthsToBottom >= 3 && p.monthsToBottom <= 240, `${county}/${p.id} duration ${p.monthsToBottom}`);
      assert.ok(p.rateAtBottom >= 0.02 && p.rateAtBottom <= 0.2, `${county}/${p.id} rate ${p.rateAtBottom}`);
    }
  }
});

test("the underlying data files are present and current", () => {
  assert.ok(CA_MEDIAN_INCOME.length > 35);
  assert.ok(NEW_HOME_SUPPLY.length > 400);
  assert.ok(NEW_HOME_SUPPLY[NEW_HOME_SUPPLY.length - 1]![0] >= "2026-01");
});

test("REGRESSION: the 2009 trough multiple is derived, not written into the prose", () => {
  // It used to read "took it back to ~6x", which was true at one anchor price
  // and printed directly above a card showing a different number at any other.
  for (const anchor of [600_000, 1_085_000, 1_800_000]) {
    const reading = crashSignals("San Diego", anchor).readings.find((r) => r.key === "priceToIncome")!;
    const trough = reading.at2009Trough!;
    assert.ok(
      reading.reading.includes(`${trough.toFixed(1)}x`),
      `prose says "${reading.reading}" but the card shows ${trough.toFixed(1)}x`
    );
  }
});

test("the decline implied by the 2009 trough is the same whatever the anchor", () => {
  // Every ratio on this panel divides the anchor out. If one of them stops
  // doing that, the panel has started making a claim about one buyer's house.
  const decline = (anchor: number) => {
    const r = crashSignals("San Diego", anchor).readings.find((x) => x.key === "priceToIncome")!;
    return 1 - r.at2009Trough! / r.now!;
  };
  assert.ok(Math.abs(decline(600_000) - decline(1_800_000)) < 1e-9);
});
