import { test } from "node:test";
import assert from "node:assert/strict";

import { renderChart, type ChartPoint } from "../src/client/chart.ts";
import { buildSeries } from "../lib/history.ts";

const series = buildSeries();
const pricePoints: ChartPoint[] = series.map((p) => ({ month: p.month, value: p.price }));

const svg = renderChart({
  points: pricePoints,
  color: "#3987e5",
  format: (n) => `$${Math.round(n / 1000)}k`,
  bands: [{ fromMonth: "2006-06", toMonth: "2009-05" }],
  markers: [
    { month: "2006-06", label: "2006 peak" },
    { month: "2009-05", label: "-42%" },
  ],
  description: "test chart",
});

test("the chart emits well-formed SVG with no NaN coordinates", () => {
  assert.ok(svg.includes("<svg"), "expected an svg element");
  assert.ok(svg.includes("viewBox="), "expected a viewBox");
  assert.ok(!/NaN|Infinity|undefined/.test(svg), "coordinates must all be finite");
  // Tags balance.
  const opens = (svg.match(/<(svg|figure|path|rect|circle|line|text)\b/g) ?? []).length;
  assert.ok(opens > 10, "expected a populated chart");
});

test("every plotted point lands inside the viewBox", () => {
  const d = svg.match(/class="c-line" d="([^"]+)"/)![1]!;
  const coords = d
    .slice(1)
    .split(/[ML]/)
    .filter(Boolean)
    .map((pair) => pair.split(",").map(Number) as [number, number]);

  assert.equal(coords.length, pricePoints.length, "one vertex per data point");
  for (const [x, y] of coords) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), `non-finite coordinate ${x},${y}`);
    assert.ok(x >= 0 && x <= 1000, `x out of viewBox: ${x}`);
    assert.ok(y >= 0 && y <= 200, `y out of viewBox: ${y}`);
  }
});

test("the line is monotonic left to right. No back-tracking", () => {
  const d = svg.match(/class="c-line" d="([^"]+)"/)![1]!;
  const xs = d
    .slice(1)
    .split(/[ML]/)
    .filter(Boolean)
    .map((pair) => Number(pair.split(",")[0]));
  for (let i = 1; i < xs.length; i++) {
    assert.ok(xs[i]! >= xs[i - 1]!, `x went backwards at index ${i}`);
  }
});

test("the highest-value point renders above the lowest-value point", () => {
  // SVG y grows downward, so a bigger value must produce a SMALLER y.
  const d = svg.match(/class="c-line" d="([^"]+)"/)![1]!;
  const coords = d
    .slice(1)
    .split(/[ML]/)
    .filter(Boolean)
    .map((pair) => pair.split(",").map(Number) as [number, number]);

  let maxIdx = 0;
  let minIdx = 0;
  pricePoints.forEach((p, i) => {
    if (p.value > pricePoints[maxIdx]!.value) maxIdx = i;
    if (p.value < pricePoints[minIdx]!.value) minIdx = i;
  });

  assert.ok(coords[maxIdx]![1] < coords[minIdx]![1], "peak should sit above the trough on screen");
});

test("bands and markers only render for months present in the data", () => {
  assert.ok(svg.includes('class="c-band"'), "expected the drawdown band");
  assert.equal((svg.match(/class="c-marker"/g) ?? []).length, 2, "expected both markers");

  const missing = renderChart({
    points: pricePoints,
    color: "#3987e5",
    format: String,
    bands: [{ fromMonth: "1802-01", toMonth: "1803-01" }],
    markers: [{ month: "1802-01", label: "nope" }],
    description: "test",
  });
  assert.ok(!missing.includes('class="c-band"'), "an unknown band should be skipped, not drawn wrong");
  assert.ok(!missing.includes('class="c-marker"'), "an unknown marker should be skipped");
});

test("an empty series renders nothing rather than a broken frame", () => {
  assert.equal(renderChart({ points: [], color: "#3987e5", format: String, description: "empty" }), "");
});

test("the chart carries an accessible label", () => {
  assert.ok(svg.includes('role="img"'));
  assert.ok(svg.includes('aria-label="test chart"'));
});

test("a single-series chart ships no legend. The title names it", () => {
  assert.ok(!/legend/i.test(svg), "single series charts must not render a legend box");
});

test("REGRESSION: the hover dot paints above the data line, the crosshair below it", () => {
  // SVG has no z-index. Paint order is document order, and the hover dot was
  // ambiguous enough here to read as sitting under the line.
  const order = ["c-cross", "c-line", "c-hit", "c-dot"];
  const positions = order.map((cls) => svg.indexOf(`class="${cls}"`));
  positions.forEach((pos, i) => assert.ok(pos > -1, `${order[i]} missing from the chart`));
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i]! > positions[i - 1]!, `${order[i]} must paint after ${order[i - 1]}`);
  }
});
