import { test } from "node:test";
import assert from "node:assert/strict";

import {
  caretAfterFormat,
  countDigits,
  formatThousands,
  parseNumeric,
  parseOptionalNumeric,
} from "../lib/parse-input.ts";

test("commas, dollar signs, and spaces are all tolerated", () => {
  assert.equal(parseNumeric("1,200,000", 0), 1_200_000);
  assert.equal(parseNumeric("$1,200,000", 0), 1_200_000);
  assert.equal(parseNumeric(" 1 200 000 ", 0), 1_200_000);
  assert.equal(parseNumeric("900000", 0), 900_000);
});

test("REGRESSION: an empty field falls back instead of becoming zero", () => {
  // Number("") === 0, and 0 is finite. Checking finiteness before emptiness
  // once turned a $1.2M house into a $0 house on every line of the page.
  assert.equal(parseNumeric("", 900_000), 900_000);
  assert.equal(parseNumeric("   ", 900_000), 900_000);
  assert.equal(parseNumeric("$", 900_000), 900_000);
  assert.equal(parseNumeric(",,,", 900_000), 900_000);
});

test("an explicit zero is preserved and not mistaken for an empty field", () => {
  assert.equal(parseNumeric("0", 900_000), 0);
  assert.equal(parseOptionalNumeric("0"), 0);
});

test("garbage falls back rather than producing NaN", () => {
  assert.equal(parseNumeric("abc", 42), 42);
  assert.equal(parseNumeric("1.2.3", 42), 42);
});

test("decimals survive, since rates and percentages need them", () => {
  assert.equal(parseNumeric("6.66", 0), 6.66);
  assert.equal(parseNumeric("1.125", 0), 1.125);
});

test("optional fields report absence rather than a fallback", () => {
  assert.equal(parseOptionalNumeric(""), undefined);
  assert.equal(parseOptionalNumeric("none"), undefined);
  assert.equal(parseOptionalNumeric("2,400"), 2400);
});

test("thousands formatting handles partial and empty input", () => {
  assert.equal(formatThousands(""), "");
  assert.equal(formatThousands("1"), "1");
  assert.equal(formatThousands("1200"), "1,200");
  assert.equal(formatThousands("1200000"), "1,200,000");
  // Already-formatted input reformats to itself, so typing stays stable.
  assert.equal(formatThousands("1,200,000"), "1,200,000");
});

test("caret lands after the same digit it was after before reformatting", () => {
  // "1200|000" -> "1,200,000": 4 digits were left of the caret.
  assert.equal(caretAfterFormat("1,200,000", 4), 5);
  // Caret at the very start stays at the start.
  assert.equal(caretAfterFormat("1,200,000", 0), 0);
  // Caret past the end clamps to the end.
  assert.equal(caretAfterFormat("1,200,000", 99), 9);
  // One digit in, before the first comma.
  assert.equal(caretAfterFormat("1,200,000", 1), 1);
});

test("digit counting ignores separators", () => {
  assert.equal(countDigits("1,200,000"), 7);
  assert.equal(countDigits("$0"), 1);
  assert.equal(countDigits(""), 0);
});
