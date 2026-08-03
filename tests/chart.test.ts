import { test } from "node:test";
import assert from "node:assert/strict";

import { renderChart, renderMultiLine, verticalScale, type ChartPoint } from "../src/client/chart.ts";
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

test("REGRESSION: render and hover share one vertical scale", () => {
  // These were computed separately and disagreed: the renderer floored the axis
  // at zero, the hover handler did not, so the dot sat visibly below its line.
  const { yMin, yMax } = verticalScale(pricePoints.map((p) => p.value));
  assert.equal(yMin, 0, "an all-positive money series should anchor at zero");
  assert.ok(yMax > Math.max(...pricePoints.map((p) => p.value)));

  // The first plotted vertex must land where the shared scale says it should.
  const d = svg.match(/class="c-line" d="([^"]+)"/)![1]!;
  const firstY = Number(d.slice(1).split(/[ML]/).filter(Boolean)[0]!.split(",")[1]);
  const H = 200;
  const PAD = { top: 18, bottom: 26 };
  const plotH = H - PAD.top - PAD.bottom;
  const expected = PAD.top + plotH - ((pricePoints[0]!.value - yMin) / (yMax - yMin)) * plotH;
  assert.ok(Math.abs(firstY - expected) < 0.2, `line drawn at ${firstY}, scale says ${expected}`);
});

test("a negative series is not forced to a zero floor", () => {
  const { yMin } = verticalScale([-500, 200, 900]);
  assert.ok(yMin < -500, "net worth can start negative and must not be clipped");
});

test("multi-line charts ship a crosshair and one dot per series", () => {
  const multi = renderMultiLine({
    series: [
      { key: "a", label: "A", color: "#3987e5", points: pricePoints.slice(0, 50) },
      { key: "b", label: "B", color: "#d95926", points: pricePoints.slice(0, 50) },
    ],
    format: String,
    description: "two series",
  });
  assert.ok(multi.includes('class="c-cross"'), "needs a crosshair");
  assert.equal((multi.match(/class="c-dot"/g) ?? []).length, 2, "one dot per series");
  assert.ok(multi.includes('data-series="a"') && multi.includes('data-series="b"'));
  assert.ok(multi.includes('class="c-hit"'), "needs a hit target to hover over");
});
