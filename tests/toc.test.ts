import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const markup = fs.readFileSync(new URL("../src/index.njk", import.meta.url), "utf8");
const toc = fs.readFileSync(new URL("../src/client/toc.ts", import.meta.url), "utf8");

/** Every panel heading, in page order. */
const headings = [...markup.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, "").trim());

const slugify = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

test("every panel has a heading the contents can be built from", () => {
  const panels = markup.match(/<section class="panel/g) ?? [];
  assert.equal(panels.length, headings.length, "a panel without an h2 would be missing from the contents");
  assert.ok(headings.length >= 6);
});

test("REGRESSION: every heading has a short label, so the rail never shows a full question", () => {
  // The rail is 170px wide. A heading like "Why does everyone else seem to
  // manage?" has to be shortened, and a missing entry silently falls back to
  // the full question, which wraps to four lines.
  for (const heading of headings) {
    const slug = slugify(heading);
    assert.ok(toc.includes(`"${slug}"`), `no short label for "${heading}" (slug ${slug})`);
  }
});

test("short labels stay short enough for the rail", () => {
  const labels = [...toc.matchAll(/"[\w-]+": "([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(labels.length >= 6);
  for (const label of labels) {
    assert.ok(label.length <= 20, `"${label}" is too long for a 170px rail`);
  }
});

test("the contents is derived from the page, not duplicated", () => {
  assert.match(toc, /querySelectorAll<HTMLElement>\("section\.panel"\)/);
  assert.ok(!/const SECTIONS = \[/.test(toc), "a hardcoded section list would drift");
});

test("position tracking uses IntersectionObserver, not scroll arithmetic", () => {
  // Panels change height as the reader edits inputs, which desynchronises any
  // approach based on precomputed offsets.
  assert.match(toc, /new IntersectionObserver/);
  assert.ok(!/scrollY|offsetTop/.test(toc), "scroll maths would drift as panels resize");
});

test("the mobile bar is accessible: it is a button with expanded state", () => {
  assert.match(toc, /aria-expanded/);
  assert.match(toc, /aria-controls/);
  assert.match(toc, /aria-label="Sections"/);
  assert.match(toc, /aria-current/);
});

test("choosing a destination closes the mobile sheet", () => {
  assert.match(toc, /barList\.querySelectorAll\("a"\)/);
});
