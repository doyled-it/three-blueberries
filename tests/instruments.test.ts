import { test } from "node:test";
import assert from "node:assert/strict";

import { INSTRUMENTS, WATCHLIST_DISCIPLINE, WATCHLIST_PREAMBLE, byLevel } from "../lib/instruments.ts";

test("every watchlist entry is falsifiable", () => {
  // The discipline this file promises: if an entry has no tripwire it has
  // become a vibe with footnotes, and it should be deleted rather than shipped.
  for (const i of INSTRUMENTS) {
    assert.ok(i.tripwire.length > 60, `${i.id} has no real tripwire`);
    assert.ok(i.unknown.length > 40, `${i.id} does not admit what it doesn't know`);
    assert.ok(i.rhyme.length > 80, `${i.id} needs a stated structural analogy, not a vibe`);
  }
});

test("every claim carries a source", () => {
  for (const i of INSTRUMENTS) {
    assert.ok(i.sources.length > 0, `${i.id} has no source`);
    for (const s of i.sources) {
      assert.match(s.url, /^https:\/\//, `${i.id} source is not a real link`);
      assert.ok(s.label.length > 8);
    }
  }
});

test("the watchlist is not one-sided — it ships a counterweight", () => {
  const context = byLevel("context");
  assert.ok(context.length > 0, "an all-bearish watchlist is advocacy, not analysis");
  assert.match(context[0]!.rhyme, /There isn't one/i);
});

test("the preamble states why this cannot be a model", () => {
  assert.match(WATCHLIST_PREAMBLE, /cannot be learned/i);
  assert.match(WATCHLIST_PREAMBLE, /judgment/i);
  assert.match(WATCHLIST_DISCIPLINE, /falsifiable/i);
});

test("ids are unique and levels are valid", () => {
  const ids = INSTRUMENTS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const i of INSTRUMENTS) {
    assert.ok(["rhymes-hard", "watch", "context"].includes(i.level));
  }
});

test("DSCR is flagged as the closest structural rhyme", () => {
  const dscr = INSTRUMENTS.find((i) => i.id === "dscr")!;
  assert.equal(dscr.level, "rhymes-hard");
  assert.match(dscr.rhyme, /does not ask whether the borrower can pay/i);
});

test("every entry leads with a jargon-free metaphor", () => {
  const jargon = /securitis|amortis|tranche|LTV|DSCR|basis point|collateralis/i;
  for (const i of INSTRUMENTS) {
    assert.ok(i.gist.length > 30 && i.gist.length < 190, `${i.id} gist is the wrong length`);
    assert.ok(!jargon.test(i.gist), `${i.id} gist uses jargon — the whole point is that it doesn't`);
    assert.ok(/[.!]$/.test(i.gist), `${i.id} gist should be a sentence`);
  }
});

test("the DSCR metaphor lands the actual mechanism", () => {
  const dscr = INSTRUMENTS.find((i) => i.id === "dscr")!;
  assert.match(dscr.gist, /house has a job/i);
});
