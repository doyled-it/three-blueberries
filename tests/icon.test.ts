import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const svg = fs.readFileSync(new URL("../src/assets/icons/berries.svg", import.meta.url), "utf8");

test("the icon is three circles, because the silhouette is what survives 16px", () => {
  const circles = svg.match(/<circle[^>]*r="1[0-9.]+"/g) ?? [];
  assert.equal(circles.length, 3, "three berries, no more, no fewer");
});

test("the icon carries an accessible name", () => {
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="Three blueberries"/);
  assert.match(svg, /<title>Three blueberries<\/title>/);
});

test("berries are separated by a stroke, so they stay countable when tiny", () => {
  assert.match(svg, /stroke="#0c0a12"/, "the gap is cut in the page colour");
  assert.match(svg, /stroke-width="2\.5"/);
});

test("every raster fallback exists", () => {
  for (const size of [16, 32, 48, 64, 128, 180, 192, 512]) {
    const path = new URL(`../src/assets/icons/icon-${size}.png`, import.meta.url);
    assert.ok(fs.existsSync(path), `missing icon-${size}.png`);
    assert.ok(fs.statSync(path).size > 200, `icon-${size}.png looks empty`);
  }
  assert.ok(fs.existsSync(new URL("../src/assets/icons/favicon.ico", import.meta.url)));
});

test("the three fills are distinct, so depth reads without detail", () => {
  const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map((m) => m[1]!.toLowerCase());
  const berryFills = fills.filter((f) => f.startsWith("#5") || f.startsWith("#7") || f.startsWith("#9"));
  assert.equal(new Set(berryFills).size, 3, "each berry needs its own tint");
});
