/**
 * Turning what someone typed into a number.
 *
 * This lives here rather than inline in the DOM code so it can be tested
 * without a browser. It exists because of a real bug: money fields were
 * `<input type="number">`, and a browser reports `.value` as an empty string
 * the moment the contents aren't a bare number. So the page displayed
 * "1,200,000" while handing the calculator "". `Number("")` is 0, and 0 is
 * finite, so the fallback never fired and a $1.2M house silently became a $0
 * house across every line on the page.
 *
 * Two lessons are encoded here: check for empty BEFORE checking finiteness,
 * and never trust a number input to hold formatted text.
 */

/** Strip everything people legitimately type around a number: $ , spaces, underscores. */
function strip(raw: string): string {
  return raw.replace(/[$,\s_]/g, "");
}

/**
 * Parse a required field. An empty or unparseable value yields `fallback`,
 * never zero-by-accident.
 */
export function parseNumeric(raw: string, fallback: number): number {
  const cleaned = strip(raw);
  if (cleaned === "") return fallback;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse an optional field. Empty or unparseable means "not provided". */
export function parseOptionalNumeric(raw: string): number | undefined {
  const cleaned = strip(raw);
  if (cleaned === "") return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Format the digits of a string with thousands separators, discarding anything
 * that isn't a digit. Used for live formatting as you type.
 */
export function formatThousands(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return "";
  return Number(digits).toLocaleString("en-US");
}

/**
 * Where the caret should land after reformatting, so that inserting a comma
 * doesn't yank the cursor to the end of the field.
 *
 * Anchors on "how many digits were to the left of the caret" rather than on a
 * raw character offset, since separators shift offsets around.
 */
export function caretAfterFormat(formatted: string, digitsBeforeCaret: number): number {
  if (digitsBeforeCaret <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i]!)) {
      seen++;
      if (seen === digitsBeforeCaret) return i + 1;
    }
  }
  return formatted.length;
}

export function countDigits(s: string): number {
  return (s.match(/\d/g) ?? []).length;
}
