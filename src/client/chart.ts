/**
 * A small, dependency-free line chart.
 *
 * Deliberately NOT a dual-axis chart. Price and payment are different measures
 * on different scales, so they get two stacked charts sharing an x-axis rather
 * than two y-scales on one plot, which is the single most misleading thing a
 * chart of this data could do, since the whole point is that the two series
 * diverge.
 *
 * Single series per chart, so no legend: the title names the series.
 */

export interface ChartPoint {
  /** "YYYY-MM" */
  month: string;
  value: number;
}

export interface ChartBand {
  fromMonth: string;
  toMonth: string;
  label?: string;
}

export interface ChartMarker {
  month: string;
  label: string;
}

export interface ChartOptions {
  points: ChartPoint[];
  color: string;
  /** Formats a value for the axis and tooltip. */
  format: (n: number) => string;
  bands?: ChartBand[];
  markers?: ChartMarker[];
  height?: number;
  /** Accessible description of what the chart shows. */
  description: string;
}

const W = 1000;
const PAD = { top: 18, right: 16, bottom: 26, left: 62 };

const monthIndex = (points: ChartPoint[], month: string) => points.findIndex((p) => p.month === month);

/**
 * The vertical scale for a set of values.
 *
 * This exists as one function on purpose. Rendering and hover-testing used to
 * compute the scale separately, and they disagreed: the renderer floored the
 * axis at zero while the hover handler did not, so the dot tracked a different
 * scale than the line was drawn on and sat visibly below it.
 */
export function verticalScale(values: number[]): { yMin: number; yMax: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return {
    // Money charts read better anchored at zero when nothing is negative.
    yMin: min > 0 ? 0 : min - span * 0.05,
    yMax: max + span * 0.08,
  };
}

/** Nice round tick values across a range. */
function ticks(min: number, max: number, count = 4): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const rawStep = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}

export function renderChart(opts: ChartOptions): string {
  const { points, color, format, bands = [], markers = [], description } = opts;
  const H = opts.height ?? 200;
  if (points.length === 0) return "";

  const { yMin, yMax } = verticalScale(points.map((p) => p.value));

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (i / Math.max(points.length - 1, 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");

  // Recessive grid + value axis.
  const grid = ticks(yMin, yMax)
    .map(
      (t) =>
        `<line class="c-grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>` +
        `<text class="c-axis" x="${PAD.left - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${format(t)}</text>`
    )
    .join("");

  // Decade ticks along the bottom.
  const years = points
    .map((p, i) => ({ year: p.month.slice(0, 4), i }))
    .filter((p) => Number(p.year) % 5 === 0 && p.i > 0 && points[p.i - 1]!.month.slice(0, 4) !== p.year);
  const xAxis = years
    .map((p) => `<text class="c-axis" x="${x(p.i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${p.year}</text>`)
    .join("");

  // Shaded periods (the historical declines).
  const bandEls = bands
    .map((b) => {
      const a = monthIndex(points, b.fromMonth);
      const z = monthIndex(points, b.toMonth);
      if (a < 0 || z < 0) return "";
      return `<rect class="c-band" x="${x(a).toFixed(1)}" y="${PAD.top}" width="${(x(z) - x(a)).toFixed(1)}" height="${plotH}"/>`;
    })
    .join("");

  // Direct labels on the handful of points that carry the story.
  const markerEls = markers
    .map((mk) => {
      const i = monthIndex(points, mk.month);
      if (i < 0) return "";
      const px = x(i);
      const py = y(points[i]!.value);
      const anchor = px > W * 0.75 ? "end" : px < W * 0.2 ? "start" : "middle";
      return (
        `<circle class="c-marker" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.5" style="stroke:${color}"/>` +
        `<text class="c-marker-label" x="${px.toFixed(1)}" y="${(py - 12).toFixed(1)}" text-anchor="${anchor}">${mk.label}</text>`
      );
    })
    .join("");

  return `
<figure class="chart" data-chart>
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${description}">
    ${bandEls}
    ${grid}
    ${xAxis}
    <line class="c-cross" x1="0" x2="0" y1="${PAD.top}" y2="${PAD.top + plotH}" style="display:none"/>
    <path class="c-line" d="${line}" style="stroke:${color}"/>
    ${markerEls}
    <rect class="c-hit" x="${PAD.left}" y="${PAD.top}" width="${plotW}" height="${plotH}" fill="transparent"/>
    <circle class="c-dot" r="5" style="display:none;stroke:${color}"/>
  </svg>
  <div class="c-tip" hidden></div>
</figure>`;
}

// ---------------------------------------------------------------------------
// Multi-series line
// ---------------------------------------------------------------------------

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  points: ChartPoint[];
}

/**
 * Two or more series on ONE shared axis.
 *
 * Legitimate here, and only here, because the series share a unit (dollars).
 * That is the entire reason this comparison works: "what it costs" and "what you
 * can afford" are directly comparable, and the gap between them is the finding.
 * Two measures on different scales would still need two charts.
 */
export function renderMultiLine(opts: {
  series: LineSeries[];
  format: (n: number) => string;
  markers?: Array<ChartMarker & { seriesKey: string }>;
  height?: number;
  description: string;
  /** Shade the vertical gap between the first two series. */
  shadeGap?: boolean;
  /** Override the time-derived x axis, for charts plotted against something else. */
  xTicks?: Array<{ index: number; label: string }>;
}): string {
  const { series, format, markers = [], description, shadeGap = false, xTicks } = opts;
  const H = opts.height ?? 240;
  if (!series.length || !series[0]!.points.length) return "";

  const { yMin, yMax } = verticalScale(series.flatMap((s) => s.points.map((p) => p.value)));

  const n = series[0]!.points.length;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / Math.max(n - 1, 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const grid = ticks(yMin, yMax)
    .map(
      (t) =>
        `<line class="c-grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>` +
        `<text class="c-axis" x="${PAD.left - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${format(t)}</text>`
    )
    .join("");

  const xAxis = xTicks
    ? xTicks
        .map(
          (t) => `<text class="c-axis" x="${x(t.index).toFixed(1)}" y="${H - 8}" text-anchor="middle">${t.label}</text>`
        )
        .join("")
    : series[0]!.points
        .map((p, i) => ({ year: p.month.slice(0, 4), i }))
        .filter((p) => Number(p.year) % 5 === 0 && p.i > 0 && series[0]!.points[p.i - 1]!.month.slice(0, 4) !== p.year)
        .map((p) => `<text class="c-axis" x="${x(p.i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${p.year}</text>`)
        .join("");

  // The gap between cost and capacity is the story, so fill it.
  let gapFill = "";
  if (shadeGap && series.length >= 2) {
    const a = series[0]!.points;
    const b = series[1]!.points;
    const top = a.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
    const bottom = b
      .map((p, i) => ({ i, v: p.value }))
      .reverse()
      .map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`)
      .join(" ");
    gapFill = `<polygon class="c-gap" points="${top} ${bottom}"/>`;
  }

  const lines = series
    .map(
      (s) =>
        `<path class="c-line" d="${s.points
          .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
          .join("")}" style="stroke:${s.color}"/>`
    )
    .join("");

  const markerEls = markers
    .map((mk) => {
      const s = series.find((ss) => ss.key === mk.seriesKey);
      if (!s) return "";
      const i = s.points.findIndex((p) => p.month === mk.month);
      if (i < 0) return "";
      const px = x(i);
      const py = y(s.points[i]!.value);
      const anchor = px > W * 0.72 ? "end" : px < W * 0.18 ? "start" : "middle";
      return (
        `<circle class="c-marker" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.5" style="stroke:${s.color}"/>` +
        `<text class="c-marker-label" x="${px.toFixed(1)}" y="${(py - 12).toFixed(1)}" text-anchor="${anchor}">${mk.label}</text>`
      );
    })
    .join("");

  // Two or more series always get a legend; identity is never colour alone.
  const legend = series
    .map((s) => `<span class="c-key"><i style="background:${s.color}"></i>${s.label}</span>`)
    .join("");

  const dots = series
    .map((s) => `<circle class="c-dot" data-series="${s.key}" r="5" style="display:none;stroke:${s.color}"/>`)
    .join("");

  return `
<figure class="chart" data-multi>
  <div class="c-legend">${legend}</div>
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${description}">
    ${gapFill}
    ${grid}
    ${xAxis}
    <line class="c-cross" x1="0" x2="0" y1="${PAD.top}" y2="${PAD.top + plotH}" style="display:none"/>
    ${lines}
    ${markerEls}
    <rect class="c-hit" x="${PAD.left}" y="${PAD.top}" width="${plotW}" height="${plotH}" fill="transparent"/>
    ${dots}
  </svg>
  <div class="c-tip" hidden></div>
</figure>`;
}

/**
 * Crosshair and one dot per series, all reading the same shared scale so the
 * dots sit exactly on their lines.
 */
export function attachMultiHover(
  figure: HTMLElement,
  series: LineSeries[],
  format: (n: number) => string,
  labelFor: (month: string) => string
): void {
  const svg = figure.querySelector("svg")!;
  const hit = figure.querySelector<SVGRectElement>(".c-hit")!;
  const cross = figure.querySelector<SVGLineElement>(".c-cross")!;
  const tip = figure.querySelector<HTMLElement>(".c-tip")!;
  const dots = new Map(
    series.map((s) => [s.key, figure.querySelector<SVGCircleElement>(`.c-dot[data-series="${s.key}"]`)!])
  );

  const { yMin, yMax } = verticalScale(series.flatMap((s) => s.points.map((p) => p.value)));
  const H = Number(svg.getAttribute("viewBox")!.split(" ")[3]);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const n = series[0]?.points.length ?? 0;

  const show = (clientX: number) => {
    const box = svg.getBoundingClientRect();
    const relative = ((clientX - box.left) / box.width) * W;
    const ratio = Math.min(Math.max((relative - PAD.left) / plotW, 0), 1);
    const i = Math.round(ratio * (n - 1));
    if (!series[0]?.points[i]) return;

    const px = PAD.left + (i / Math.max(n - 1, 1)) * plotW;
    cross.setAttribute("x1", String(px));
    cross.setAttribute("x2", String(px));
    cross.style.display = "";

    const rows: string[] = [];
    for (const s of series) {
      const point = s.points[i];
      const dot = dots.get(s.key);
      if (!point || !dot) continue;
      const py = PAD.top + plotH - ((point.value - yMin) / (yMax - yMin)) * plotH;
      dot.setAttribute("cx", String(px));
      dot.setAttribute("cy", String(py));
      dot.style.display = "";
      rows.push(`<span><i style="background:${s.color}"></i>${s.label}: ${format(point.value)}</span>`);
    }

    tip.hidden = false;
    tip.innerHTML = `<strong>${labelFor(series[0]!.points[i]!.month)}</strong>${rows.join("")}`;
    tip.style.left = `${(px / W) * 100}%`;
  };

  const hide = () => {
    cross.style.display = "none";
    for (const dot of dots.values()) dot.style.display = "none";
    tip.hidden = true;
  };

  hit.addEventListener("pointermove", (e) => show((e as PointerEvent).clientX));
  hit.addEventListener("pointerleave", hide);
  figure.addEventListener("pointerleave", hide);
}

// ---------------------------------------------------------------------------
// Stacked columns
// ---------------------------------------------------------------------------

export interface StackSeries {
  key: string;
  label: string;
  color: string;
}

export interface StackColumn {
  /** X-axis label, e.g. a purchase year. */
  label: string;
  /** One value per series, keyed by StackSeries.key. */
  values: Record<string, number>;
  /** Marks the currently selected column. */
  active?: boolean;
}

/**
 * Part-to-whole across an ordered dimension: each column is one purchase-year
 * cohort, each segment a component of their monthly advantage.
 *
 * Segments carry a 2px surface gap so adjacent fills never touch. That gap is
 * what keeps the boundary readable for someone who can't separate the hues.
 */
export function renderStackedColumns(opts: {
  columns: StackColumn[];
  series: StackSeries[];
  format: (n: number) => string;
  height?: number;
  description: string;
  /** A horizontal marker, so every column can be read against one value. */
  referenceLine?: { value: number; label: string; color: string };
}): string {
  const { columns, series, format, description, referenceLine } = opts;
  const H = opts.height ?? 230;
  if (columns.length === 0) return "";

  const totals = columns.map((c) => series.reduce((sum, s) => sum + (c.values[s.key] ?? 0), 0));
  const yMax = Math.max(...totals, referenceLine?.value ?? 0) * 1.1 || 1;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / columns.length;
  const barW = Math.max(slot * 0.68, 2);

  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  const grid = ticks(0, yMax)
    .map(
      (t) =>
        `<line class="c-grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>` +
        `<text class="c-axis" x="${PAD.left - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${format(t)}</text>`
    )
    .join("");

  const bars = columns
    .map((col, i) => {
      const cx = PAD.left + slot * i + (slot - barW) / 2;
      let cursor = 0;
      const segments = series
        .map((s) => {
          const v = col.values[s.key] ?? 0;
          if (v <= 0) return "";
          const top = y(cursor + v);
          const bottom = y(cursor);
          cursor += v;
          // 2px surface gap between stacked segments.
          const h = Math.max(bottom - top - 2, 0.5);
          return `<rect class="c-seg" x="${cx.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" style="fill:${s.color}"/>`;
        })
        .join("");
      const highlight = col.active
        ? `<rect class="c-col-active" x="${(cx - 3).toFixed(1)}" y="${PAD.top}" width="${(barW + 6).toFixed(1)}" height="${plotH}" rx="3"/>`
        : "";
      return `<g class="c-col" data-col="${i}">${highlight}${segments}</g>`;
    })
    .join("");

  // Label every 5th column so the axis doesn't collide with itself.
  const xAxis = columns
    .map((col, i) => {
      if (i % 5 !== 0 && !col.active) return "";
      const cx = PAD.left + slot * i + slot / 2;
      return `<text class="c-axis${col.active ? " c-axis--active" : ""}" x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${col.label}</text>`;
    })
    .join("");

  // A legend is mandatory at 3 series, and identity is never color alone.
  const legend = series
    .map((s) => `<span class="c-key"><i style="background:${s.color}"></i>${s.label}</span>`)
    .join("");

  return `
<figure class="chart" data-stack>
  <div class="c-legend">${legend}</div>
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${description}">
    ${grid}
    ${bars}
    ${
      referenceLine
        ? `<line class="c-ref" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(referenceLine.value).toFixed(1)}" y2="${y(referenceLine.value).toFixed(1)}" style="stroke:${referenceLine.color}"/>` +
          `<text class="c-ref-label" x="${W - PAD.right}" y="${(y(referenceLine.value) - 7).toFixed(1)}" text-anchor="end" style="fill:${referenceLine.color}">${referenceLine.label}</text>`
        : ""
    }
    ${xAxis}
  </svg>
  <div class="c-tip" hidden></div>
</figure>`;
}

export function attachStackHover(
  figure: HTMLElement,
  columns: StackColumn[],
  series: StackSeries[],
  format: (n: number) => string,
  opts: {
    onSelect?: (index: number) => void;
    /** Reads each column against the reference line, in the reader's own terms. */
    compare?: { value: number; less: string; more: string; same: string };
    /** Names what a column is, e.g. "bought in" for a purchase year. */
    prefix?: string;
  } = {}
): void {
  const tip = figure.querySelector<HTMLElement>(".c-tip")!;
  const { onSelect, compare, prefix } = opts;

  for (const g of figure.querySelectorAll<SVGGElement>(".c-col")) {
    const i = Number(g.dataset["col"]);
    const col = columns[i];
    if (!col) continue;

    g.addEventListener("pointerenter", () => {
      const total = series.reduce((sum, s) => sum + (col.values[s.key] ?? 0), 0);
      const gap = compare ? compare.value - total : 0;
      // Under a dollar apart is a rounding artefact, not a difference worth a claim.
      const verdict = !compare
        ? ""
        : Math.abs(gap) < 1
          ? `<span class="c-tip__gap">${compare.same}</span>`
          : gap > 0
            ? `<span class="c-tip__gap">${format(gap)}/mo ${compare.less}</span>`
            : `<span class="c-tip__gap">${format(-gap)}/mo ${compare.more}</span>`;

      tip.hidden = false;
      tip.innerHTML =
        `<strong>${format(total)}/mo</strong><span>${prefix ? `${prefix} ` : ""}${col.label}</span>` +
        series
          .map((s) => `<span><i style="background:${s.color}"></i>${s.label}: ${format(col.values[s.key] ?? 0)}</span>`)
          .join("") +
        verdict;
      tip.style.left = `${((PAD.left + ((W - PAD.left - PAD.right) / columns.length) * (i + 0.5)) / W) * 100}%`;
    });

    if (onSelect) g.addEventListener("click", () => onSelect(i));
  }

  figure.addEventListener("pointerleave", () => {
    tip.hidden = true;
  });
}

/**
 * Wire the crosshair and tooltip. An HTML chart is interactive by default, so a
 * line chart ships hover unless there's a reason not to.
 */
export function attachChartHover(
  figure: HTMLElement,
  points: ChartPoint[],
  format: (n: number) => string,
  labelFor: (p: ChartPoint) => string
): void {
  const svg = figure.querySelector("svg")!;
  const hit = figure.querySelector<SVGRectElement>(".c-hit")!;
  const cross = figure.querySelector<SVGLineElement>(".c-cross")!;
  const dot = figure.querySelector<SVGCircleElement>(".c-dot")!;
  const tip = figure.querySelector<HTMLElement>(".c-tip")!;

  const plotW = W - PAD.left - PAD.right;
  const { yMin, yMax } = verticalScale(points.map((p) => p.value));
  const H = Number(svg.getAttribute("viewBox")!.split(" ")[3]);
  const plotH = H - PAD.top - PAD.bottom;

  const show = (clientX: number) => {
    const box = svg.getBoundingClientRect();
    const relative = ((clientX - box.left) / box.width) * W;
    const ratio = Math.min(Math.max((relative - PAD.left) / plotW, 0), 1);
    const i = Math.round(ratio * (points.length - 1));
    const point = points[i];
    if (!point) return;

    const px = PAD.left + (i / Math.max(points.length - 1, 1)) * plotW;
    const py = PAD.top + plotH - ((point.value - yMin) / (yMax - yMin)) * plotH;

    cross.setAttribute("x1", String(px));
    cross.setAttribute("x2", String(px));
    cross.style.display = "";
    dot.setAttribute("cx", String(px));
    dot.setAttribute("cy", String(py));
    dot.style.display = "";

    tip.hidden = false;
    tip.innerHTML = `<strong>${format(point.value)}</strong><span>${labelFor(point)}</span>`;
    tip.style.left = `${(px / W) * 100}%`;
  };

  const hide = () => {
    cross.style.display = "none";
    dot.style.display = "none";
    tip.hidden = true;
  };

  hit.addEventListener("pointermove", (e) => show((e as PointerEvent).clientX));
  hit.addEventListener("pointerleave", hide);
  figure.addEventListener("pointerleave", hide);
}
