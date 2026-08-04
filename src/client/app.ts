/**
 * The browser side.
 *
 * Everything runs locally: your income never leaves the page. The only network
 * call is for the current mortgage rate.
 */

import { evaluateScenario } from "../../lib/mortgage.ts";
import { maxAffordablePrice } from "../../lib/affordability.ts";
import { CA_COUNTIES } from "../../lib/data/ca-loan-limits.ts";
import {
  caretAfterFormat,
  countDigits,
  formatThousands,
  parseNumeric,
  parseOptionalNumeric,
} from "../../lib/parse-input.ts";
import { SOURCES } from "../../lib/data/sources.ts";
import {
  buildSeries,
  crashPresets,
  currentStatus,
  evaluateWaiting,
  findDrawdowns,
  historicalContext,
} from "../../lib/history.ts";
import { compareToCohort, refinanceOpportunity, BEST_REFI } from "../../lib/cohort.ts";
import {
  crashSignals,
  leadingIndicators,
  longMonth,
  peakOfBubble,
  troughOfBust,
  worstTimeToBuy,
} from "../../lib/signals.ts";
import { MODEL_META, horizonReports, learnedWeights, verdict } from "../../lib/forecast.ts";
import { INSTRUMENTS, WATCHLIST_DISCIPLINE, WATCHLIST_PREAMBLE } from "../../lib/instruments.ts";
import { BUYING_POWER_CAVEAT, buyingPowerSeries, buyingPowerVerdict } from "../../lib/buying-power.ts";
import { DEFAULT_ANCHOR_PRICE } from "../../lib/history.ts";
import { countyTaxRate } from "../../lib/data/ca-property.ts";
import { countyScope } from "../../lib/county-scope.ts";
import { WHERE_IT_WORKS_CAVEAT, allStandings, countyStanding, payTrap } from "../../lib/where-it-works.ts";
import {
  ASSUMPTION_SETS,
  RATE_SOLVER_CEILING,
  RENT_VS_BUY_CAVEAT,
  breakevenByPrice,
  buyZone,
  compareRentVsBuy,
  decide,
  maxPriceForHoldPeriod,
  rateSensitivity,
  requiredRate,
  rentCapRegionFor,
  savingsRace,
  statutoryRentCap,
} from "../../lib/rent-vs-buy.ts";
import { bridgeScenario } from "../../lib/scenario-bridge.ts";
import {
  attachChartHover,
  attachStackHover,
  renderChart,
  attachMultiHover,
  renderMultiLine,
  renderStackedColumns,
  type ChartPoint,
  type StackColumn,
} from "./chart.ts";
import { attachToc, buildToc, renderToc } from "./toc.ts";
import type { CaCounty } from "../../lib/data/ca-loan-limits.ts";
import type { Confidence, LineItem, LoanType, ScenarioInput } from "../../lib/types.ts";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const pct = (n: number, places = 2) => (n * 100).toFixed(places) + "%";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  statutory: "set by law",
  published: "published schedule",
  market: "live market",
  estimated: "our estimate",
  user: "you entered this",
};

// ---------------------------------------------------------------------------
// Live rates
// ---------------------------------------------------------------------------

async function loadRate(): Promise<void> {
  const note = $("rate-note");
  try {
    const res = await fetch("/api/rates");
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as {
      thirtyYear: number;
      fifteenYear: number | null;
      asOf: string;
      stale: boolean;
      source: { title: string; url: string; publisher: string };
    };

    const input = $<HTMLInputElement>("interestRate");
    if (!input.dataset["touched"]) {
      const term = Number($<HTMLSelectElement>("termYears").value);
      const rate = term <= 15 && data.fifteenYear ? data.fifteenYear : data.thirtyYear;
      input.value = (rate * 100).toFixed(3);
    }

    note.innerHTML = data.stale
      ? `Could not reach the rate feed, showing the last known value from ${data.asOf}. Enter your own quote.`
      : `Freddie Mac weekly average as of ${data.asOf}. <a href="${data.source.url}" target="_blank" rel="noopener">Source</a>. This is a national average for a well-qualified borrower. Your quote will differ.`;
    render();
  } catch {
    note.textContent = "Rate feed unavailable. The default below is a placeholder, enter your own quote.";
  }
}

// ---------------------------------------------------------------------------
// Reading the form
// ---------------------------------------------------------------------------

const num = (id: string, fallback = 0): number => parseNumeric($<HTMLInputElement>(id).value, fallback);

const optionalNum = (id: string): number | undefined => parseOptionalNumeric($<HTMLInputElement>(id).value);

function readInput(): ScenarioInput {
  const loanType = $<HTMLSelectElement>("loanType").value as LoanType;
  const income2 = optionalNum("income2");
  const taxRatePercent = optionalNum("propertyTaxRate");

  return {
    purchasePrice: num("purchasePrice", 900_000),
    // People know what they have, not what fraction of a price it is.
    downPayment: { kind: "amount", value: num("downPaymentAmount", 0) },
    loanType,
    termYears: Number($<HTMLSelectElement>("termYears").value),
    interestRate: num("interestRate", 6.66) / 100,
    creditScore: num("creditScore", 740),
    county: $<HTMLSelectElement>("county").value as CaCounty,
    claimHomeownersExemption: $<HTMLInputElement>("homeownersExemption").checked,
    propertyTaxRate: taxRatePercent === undefined ? undefined : taxRatePercent / 100,
    insuranceAnnual: optionalNum("insuranceAnnual"),
    hoaMonthly: num("hoaMonthly", 0),
    melloRoosAnnual: num("melloRoosAnnual", 0),
    squareFeet: optionalNum("squareFeet"),
    va:
      loanType === "va"
        ? {
            firstUse: $<HTMLInputElement>("vaFirstUse").checked,
            disabilityExempt: $<HTMLInputElement>("vaDisabilityExempt").checked,
            financeFundingFee: true,
          }
        : undefined,
    fha: loanType === "fha" ? { financeUpfrontMip: true } : undefined,
    household: {
      grossAnnualIncomes: income2 ? [num("income1", 0), income2] : [num("income1", 0)],
      monthlyDebts: num("monthlyDebts", 0),
      size: num("householdSize", 1),
    },
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderLine(line: LineItem, isTrueCostOnly: boolean): string {
  const sources = line.sourceIds
    .map((id) => {
      const s = SOURCES[id];
      return `<a href="${s.url}" target="_blank" rel="noopener">${s.publisher}</a>`;
    })
    .join(", ");

  return `
    <details class="line${isTrueCostOnly ? " line--extra" : ""}">
      <summary>
        <span class="line__label">${line.label}</span>
        <span class="line__amount">${money(line.monthly)}<span class="line__per">/mo</span></span>
      </summary>
      <div class="line__detail">
        <p class="line__basis">${line.basis}</p>
        ${line.warning ? `<p class="line__warning">${line.warning}</p>` : ""}
        <p class="line__meta">
          <span class="badge badge--${line.confidence}">${CONFIDENCE_LABEL[line.confidence]}</span>
          ${sources ? `<span class="line__sources">${sources}</span>` : ""}
          <span class="line__annual">${money(line.annual)}/year</span>
        </p>
      </div>
    </details>`;
}

function render(): void {
  const input = readInput();

  // Program-specific fields only appear when they apply.
  $("va-fields").hidden = input.loanType !== "va";

  const downAmount = input.downPayment.kind === "amount" ? input.downPayment.value : 0;
  $("downPaymentPercentOut").textContent =
    input.purchasePrice > 0
      ? `${pct(Math.min(downAmount / input.purchasePrice, 1), 1)} of the price`
      : "enter a price first";

  // A price of zero produces a table of $0 lines that looks like a broken app
  // rather than an empty one. Say what's missing instead.
  if (!(input.purchasePrice > 0)) {
    $("breakdown").innerHTML = `<p class="empty">Enter a purchase price to see the breakdown.</p>`;
    $("qualification").innerHTML = `<p class="empty">Enter a purchase price to see what you'd need to earn.</p>`;
    $("notes").innerHTML = "";
    $("warnings").innerHTML = "";
    return;
  }

  const result = evaluateScenario(input);

  const lenderLines = result.lines.filter((l) => l.key !== "maintenanceReserve");
  const extraLines = result.lines.filter((l) => l.key === "maintenanceReserve");

  $("breakdown").innerHTML =
    lenderLines.map((l) => renderLine(l, false)).join("") +
    `<div class="subtotal">
       <span>Lender total, <em>what a mortgage calculator shows you</em></span>
       <strong>${money(result.lenderMonthlyTotal)}/mo</strong>
     </div>` +
    extraLines.map((l) => renderLine(l, true)).join("") +
    `<div class="total">
       <span>True monthly cost, <em>what actually leaves your account</em></span>
       <strong>${money(result.trueMonthlyTotal)}/mo</strong>
     </div>`;

  // --- Qualification --------------------------------------------------------
  const q = result.qualification;
  const haveIncome = input.household.grossAnnualIncomes.reduce((a, b) => a + b, 0);
  const afford = maxAffordablePrice(input);

  $("qualification").innerHTML = `
    <div class="stat">
      <span class="stat__label">Income needed for this house</span>
      <span class="stat__value">${money(q.incomeRequiredAnnual)}<span class="stat__unit">/year</span></span>
      <span class="stat__note">To stay at or under a ${pct(q.dtiCeiling, 0)} debt-to-income ratio.</span>
    </div>
    <div class="stat">
      <span class="stat__label">Most house you can buy</span>
      <span class="stat__value">${afford.maxPurchasePrice > 0 ? money(afford.maxPurchasePrice) : ", "}</span>
      <span class="stat__note">${
        afford.maxPurchasePrice > 0
          ? `On ${money(haveIncome)}/year, limited by ${afford.bindingConstraint === "residual-income" ? "VA residual income" : "debt-to-income"}. Needs ${money(afford.cashRequired)} cash.`
          : "This household does not clear the ceiling at any price with these inputs."
      }</span>
    </div>
    <div class="stat">
      <span class="stat__label">Cash to close</span>
      <span class="stat__value">${money(result.cashToClose.total)}</span>
      <span class="stat__note">${money(result.cashToClose.downPayment)} down, plus closing costs and impound seeding.</span>
    </div>
    <div class="stat ${q.passesDti ? "stat--pass" : "stat--fail"}">
      <span class="stat__label">Your debt-to-income</span>
      <span class="stat__value">${Number.isFinite(q.backEndDti) ? pct(q.backEndDti, 1) : ", "}</span>
      <span class="stat__note">${q.passesDti ? "Within" : "Above"} the ${pct(q.dtiCeiling, 0)} ceiling for this program.</span>
    </div>
    ${
      q.residualIncome
        ? `<div class="stat stat--wide ${q.residualIncome.passes ? "stat--pass" : "stat--fail"}">
             <span class="stat__label">VA residual income</span>
             <span class="stat__value">${money(q.residualIncome.available)}<span class="stat__unit"> of ${money(q.residualIncome.required)} required</span></span>
             <span class="stat__note">${q.residualIncome.explanation}</span>
           </div>`
        : ""
    }`;

  $("notes").innerHTML = q.notes.map((n) => `<li>${n}</li>`).join("");
  $("warnings").innerHTML = result.warnings.map((w) => `<li>${w}</li>`).join("");

  renderRentVsBuy(input);
  // The thesis panel is a claim about the median San Diego home, so it must use
  // the project's own anchor. Passing the form's price made it a market-level
  // claim derived from a demo default, and the one-shot guard froze it there.
  renderBuyingPower(input.county);
  renderCohort(input);
  renderCountyScope(input.county);
  // The history panel is about YOUR house: what this same house would have cost
  // in 2009. The crash signals are about the market, and every one of them is
  // read against the 2006 peak and the 2009 bottom, so they have to stand on the
  // same anchor those readings do. Feeding them the form's price reported the
  // burden of one buyer's house as the condition of the whole market.
  renderHistory(input.county, input.purchasePrice);
  // The crash signals are a MARKET claim, read against this county's own bubble
  // peak and bust trough, so they take the county's typical price rather than
  // this buyer's. Feeding them the form price reported one house's burden as the
  // condition of a whole market.
  renderSignals(input.county);
  renderInstruments();
  renderForecast();
  renderPresets();
  renderWaiting(input);
}

// ---------------------------------------------------------------------------
// "How is anyone affording this?"
// ---------------------------------------------------------------------------

const SERIES_PRICE = "#3987e5";
const SERIES_PAYMENT = "#d95926";

/**
 * The bars show what each cohort PAYS, not how far ahead of you they are.
 *
 * Plotting the advantage meant a taller bar signalled a cheaper payment, which
 * reads exactly backwards. Now the tallest bar is the most expensive, your own
 * payment is drawn across as a reference, and the advantage is the gap between a
 * bar and that line, visible without having to be explained.
 */
const COHORT_SERIES = [
  { key: "pi", label: "Their principal and interest", color: "#3987e5" },
  { key: "tax", label: "Their property tax", color: "#199e70" },
];

const COHORT_FIRST_YEAR = 1990;

function renderCohort(input: ScenarioInput): void {
  const year = Number($<HTMLInputElement>("cohortYear").value);
  $("cohortYearOut").textContent = String(year);

  const shared = {
    currentPrice: input.purchasePrice,
    currentRate: input.interestRate,
    downPercent: 0.2,
    propertyTaxRate: input.propertyTaxRate ?? countyTaxRate(input.county),
  };

  const lastYear = Number(BEST_REFI.month.slice(0, 4)) + 4;
  const years: number[] = [];
  for (let y = COHORT_FIRST_YEAR; y <= lastYear; y++) years.push(y);

  const columns: StackColumn[] = [];
  let yourPayment = 0;
  for (const y of years) {
    const month = `${y}-06`;
    const refi = refinanceOpportunity(month);
    const c = compareToCohort({
      ...shared,
      purchaseMonth: month,
      refinancedRate: refi?.rate,
      refinanceMonth: refi?.month,
    });
    if (!c) continue;
    columns.push({
      label: String(y),
      active: y === year,
      values: {
        pi: Math.max(c.theirPayment.principalAndInterest, 0),
        tax: Math.max(c.theirPayment.propertyTax, 0),
      },
    });
    yourPayment = c.yourPayment.total;
  }

  $("cohortChart").innerHTML = renderStackedColumns({
    columns,
    series: COHORT_SERIES,
    format: (n) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`),
    referenceLine: { value: yourPayment, label: `you would pay ${money(yourPayment)}`, color: SERIES_PAYMENT },
    description:
      "What each purchase-year cohort pays monthly for the same house today, principal and interest plus property tax, against what you would pay.",
  });

  const fig = $("cohortChart").querySelector<HTMLElement>("[data-stack]");
  if (fig) {
    attachStackHover(fig, columns, COHORT_SERIES, money, {
      onSelect: (i) => {
        $<HTMLInputElement>("cohortYear").value = String(years[i]);
        renderCohort(readInput());
      },
      compare: {
        value: yourPayment,
        less: "less than you would pay",
        more: "more than you would pay",
        same: "the same as you would pay",
      },
      prefix: "for a house they bought in",
    });
  }

  const purchaseMonth = `${year}-06`;
  const refi = refinanceOpportunity(purchaseMonth);
  const c = compareToCohort({
    ...shared,
    purchaseMonth,
    refinancedRate: refi?.rate,
    refinanceMonth: refi?.month,
  });

  if (!c) {
    $("cohort").innerHTML = `<p class="empty">No price data for ${year}.</p>`;
    return;
  }

  const refiNote = c.refinancedMonth
    ? ` and refinanced their remaining balance to ${pct(c.effectiveRate)} in ${longMonth(c.refinancedMonth)}. The cheapest month on record`
    : ` at ${pct(c.rateThen)}, too late to catch the 2020-21 refinance window`;

  $("cohort").innerHTML = `
    <div class="stat stat--wide">
      <span class="stat__label">The same house, two entry points</span>
      <span class="stat__value">${money(c.totalAdvantage)}<span class="stat__unit">/month cheaper for them</span></span>
      <span class="stat__note">
        They paid ${money(c.priceThen)} in ${year}${refiNote}.
        You'd pay ${money(c.yourPayment.total)}/mo for principal, interest and tax. They pay ${money(c.theirPayment.total)}/mo.
      </span>
    </div>
    <div class="stat">
      <span class="stat__label">From the interest rate</span>
      <span class="stat__value">${money(c.rateAdvantage)}<span class="stat__unit">/mo</span></span>
      <span class="stat__note">Their ${pct(c.effectiveRate)} against your ${pct(input.interestRate)} on the same loan size.</span>
    </div>
    <div class="stat">
      <span class="stat__label">From owing less</span>
      <span class="stat__value">${money(c.priceAdvantage)}<span class="stat__unit">/mo</span></span>
      <span class="stat__note">
        The house cost ${money(c.equityGained)} less, and they've spent ${c.yearsHeld.toFixed(0)} years paying the balance down.
      </span>
    </div>
    <div class="stat">
      <span class="stat__label">From Prop 13</span>
      <span class="stat__value">${money(c.prop13Advantage)}<span class="stat__unit">/mo</span></span>
      <span class="stat__note">
        They're assessed at ${money(c.assessedValueNow)}, their ${year} price grown 2%/year. You'd be assessed at
        ${money(c.yourAssessedValue)}. This gap never closes; it widens.
      </span>
    </div>`;

  $("cohortNotes").innerHTML = [
    `After ${c.yearsHeld.toFixed(0)} years they've captured ${money(c.equityGained)} in appreciation, which becomes the down payment on the next house. This is how repeat buyers outbid you. The median repeat buyer is 62 and arrives with equity, not salary.`,
    `A second income moves this more than anything you can control. Most buyers have one: 61% of buyers are married couples.`,
    `Prop 13 is why the gap is permanent rather than temporary. Their assessed value can rise at most 2% a year no matter what the house is worth; yours resets to what you pay, on the day you pay it.`,
  ]
    .map((n) => `<li>${n}</li>`)
    .join("");
}

// ---------------------------------------------------------------------------
// "Should you wait for the crash?"
// ---------------------------------------------------------------------------

/**
 * Say whose history this is, when it is not the reader's.
 *
 * The calculator follows the county selector everywhere it can. The history
 * cannot: Case-Shiller indexes three California metros, not 58 counties. A
 * buyer in Fresno reading "the last month the math worked was March 2013"
 * deserves to know whose math, on the panel, not in a footnote.
 */
function renderCountyScope(county: CaCounty): void {
  const { note } = countyScope(county);
  for (const el of document.querySelectorAll<HTMLElement>("[data-county-scope]")) {
    el.textContent = note;
    el.hidden = false;
  }
}

let lastHistoryAnchor: string | null = null;

function renderHistory(county: CaCounty, anchorPrice: number): void {
  // Keyed on the anchor rather than a one-shot flag, so editing the price
  // actually redraws instead of leaving a stale chart on screen.
  const key = `${county}:${anchorPrice}`;
  if (lastHistoryAnchor === key) return;
  lastHistoryAnchor = key;

  const series = buildSeries(county, anchorPrice, 0.2);
  const drops = findDrawdowns(10, county);
  const status = currentStatus(36, county);
  const ctx = historicalContext(county);

  const pricePoints: ChartPoint[] = series.map((p) => ({ month: p.month, value: p.price }));
  const paymentPoints: ChartPoint[] = series.map((p) => ({ month: p.month, value: p.payment }));

  const bands = drops.map((d) => ({ fromMonth: d.peakMonth, toMonth: d.troughMonth }));
  const worst = ctx.worst;

  const compact = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`);
  const label = (p: ChartPoint) => {
    const [y, m] = p.month.split("-");
    return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m)]} ${y}`;
  };

  $("history").innerHTML = `
    <div class="chart-block">
      <h4>What the same house cost <span class="chart-sub">shaded: the two declines over 10% since 1987</span></h4>
      ${renderChart({
        points: pricePoints,
        color: SERIES_PRICE,
        format: compact,
        bands,
        markers: [
          { month: worst.peakMonth, label: "2006 peak" },
          { month: worst.troughMonth, label: `${worst.depthPercent.toFixed(0)}%` },
        ],
        description: `San Diego home prices from ${series[0]!.month} to ${series[series.length - 1]!.month}, scaled to today's dollars.`,
      })}
    </div>
    <div class="chart-block">
      <h4>What it cost you per month <span class="chart-sub">20% down, 30-year fixed, at that month's rate</span></h4>
      ${renderChart({
        points: paymentPoints,
        color: SERIES_PAYMENT,
        format: (n) => `$${Math.round(n / 1000)}k`,
        bands,
        markers: [
          { month: "2021-08", label: "2021: cheap money" },
          { month: "2023-10", label: "worst ever" },
        ],
        description: `Monthly principal and interest on the same San Diego home, at each month's prevailing rate.`,
      })}
    </div>
    <div class="stats">
      <div class="stat">
        <span class="stat__label">Declines over 10% since 1987</span>
        <span class="stat__value">${ctx.declines.length}<span class="stat__unit"> in ${ctx.yearsOfData} years</span></span>
        <span class="stat__note">${ctx.declines
          .map((d) => `${d.peakMonth.slice(0, 4)}–${d.troughMonth.slice(0, 4)}: ${d.depthPercent.toFixed(0)}%`)
          .join(" · ")}</span>
      </div>
      <div class="stat">
        <span class="stat__label">The worst one</span>
        <span class="stat__value">${worst.depthPercent.toFixed(0)}%</span>
        <span class="stat__note">
          Took ${(worst.monthsPeakToTrough / 12).toFixed(1)} years to bottom out${
            worst.monthsUnderwater
              ? `, and ${(worst.monthsUnderwater / 12).toFixed(1)} years to get back to even if you bought the peak`
              : ""
          }.
        </span>
      </div>
      <div class="stat ${status.consecutiveDeclines >= 3 ? "stat--pass" : ""}">
        <span class="stat__label">Right now</span>
        <span class="stat__value">${status.percentOffRecentPeak.toFixed(1)}%<span class="stat__unit"> off peak</span></span>
        <span class="stat__note">
          ${status.consecutiveDeclines} consecutive monthly ${status.consecutiveDeclines === 1 ? "decline" : "declines"}
          through ${longMonth(status.month)}. Real, but small. The 2006 crash fell ${Math.abs(worst.depthPercent).toFixed(0)}%.
        </span>
      </div>
    </div>`;

  for (const [i, points] of [pricePoints, paymentPoints].entries()) {
    const fig = $("history").querySelectorAll<HTMLElement>("[data-chart]")[i];
    if (fig) attachChartHover(fig, points, i === 0 ? compact : (n) => money(n), label);
  }

  $("waitingCaveats").innerHTML = ctx.caveats.map((c) => `<li>${c}</li>`).join("");
}

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];


function renderRentVsBuy(input: ScenarioInput): void {
  const result = evaluateScenario(input);

  const rent = num("currentRent", 2750);
  const appreciation = Number($<HTMLInputElement>("appreciation").value) / 1000;
  const investReturn = Number($<HTMLInputElement>("investReturn").value) / 1000;
  const rentGrowth = Number($<HTMLInputElement>("rentGrowth").value) / 1000;
  // Income the buyer has ruled out is not income. Reading the checkbox here,
  // rather than only at the decision panel, is what stops the ceiling card and
  // the verdict beside it from modelling two different houses.
  const excludeRental = $<HTMLInputElement>("excludeRental").checked;
  const rentalIncome = excludeRental ? 0 : num("rentalIncome", 0);

  $("appreciationOut").textContent = pct(appreciation, 1);
  $("investReturnOut").textContent = pct(investReturn, 1);
  $("rentGrowthOut").textContent = pct(rentGrowth, 1);

  // One derivation feeds the itemised comparison and every price sweep, so a
  // cost cannot reach one and miss the other. See lib/scenario-bridge.ts.
  const bridge = bridgeScenario(input, result, {
    monthlyRent: rent,
    homeAppreciation: appreciation,
    rentGrowth,
    investmentReturn: investReturn,
    monthlyRentalIncome: rentalIncome,
  });
  const { base: sweepBase, costs: scaling, downPercent, closingCostRate } = bridge;

  const priceToRent = rent > 0 ? input.purchasePrice / (rent * 12) : Infinity;
  const ratioVerdict =
    priceToRent < 15
      ? { label: "buying territory", cls: "stat--pass" }
      : priceToRent < 20
        ? { label: "genuinely a toss-up", cls: "" }
        : { label: "renting territory", cls: "stat--fail" };

  $("rentRatio").innerHTML = `
    <div class="stat stat--wide ${ratioVerdict.cls}">
      <span class="stat__label">Price to rent</span>
      <span class="stat__value">${Number.isFinite(priceToRent) ? priceToRent.toFixed(1) + "x" : "n/a"}<span class="stat__unit"> ${ratioVerdict.label}</span></span>
      <span class="stat__note">
        The purchase price divided by a year of your rent. Under 15 favours buying, over 20 favours renting, and it is
        the single strongest predictor of which way this comes out. Yours: ${money(input.purchasePrice)} against
        ${money(rent)}/month.
      </span>
    </div>`;

  const r = compareRentVsBuy(bridge.itemised);

  const f = r.firstYear;
  $("burnCompare").innerHTML = `
    <div class="stat stat--fail">
      <span class="stat__label">Owning, money that buys nothing</span>
      <span class="stat__value">${money(f.burned)}</span>
      <span class="stat__note">
        ${money(f.closingCosts)} closing costs, ${money(f.interestPaid)} interest,
        ${money(f.carryingAndMaintenance)} tax, insurance and upkeep${f.mortgageInsurance > 0 ? `, ${money(f.mortgageInsurance)} mortgage insurance` : ""},
        less ${money(f.taxRelief)} of mortgage interest relief. None of it is equity.
      </span>
    </div>
    <div class="stat">
      <span class="stat__label">Renting, money that buys nothing</span>
      <span class="stat__value">${money(f.rentPaid)}</span>
      <span class="stat__note">All of it. That is the honest comparison, and it is ${money(Math.abs(f.burnedMoreThanRent))} ${f.burnedMoreThanRent > 0 ? "less" : "more"} than owning burns.</span>
    </div>
    <div class="stat stat--pass">
      <span class="stat__label">Owning, actual saving</span>
      <span class="stat__value">${money(f.principalPaid)}</span>
      <span class="stat__note">The principal portion in year one. This is the only part of a mortgage payment that is not spent.</span>
    </div>`;

  $("rentBuyChart").innerHTML = renderMultiLine({
    series: [
      {
        key: "buy",
        label: "Net worth if you buy",
        color: SERIES_PRICE,
        points: r.years.map((y) => ({ month: `${2026 + y.year}-01`, value: y.buyNetWorth })),
      },
      {
        key: "rent",
        label: "Net worth if you rent and invest the difference",
        color: SERIES_PAYMENT,
        points: r.years.map((y) => ({ month: `${2026 + y.year}-01`, value: y.rentNetWorth })),
      },
    ],
    format: (n) => (Math.abs(n) >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`),
    shadeGap: true,
    markers: r.breakevenYear
      ? [{ seriesKey: "buy", month: `${2026 + r.breakevenYear}-01`, label: `buying wins, year ${r.breakevenYear}` }]
      : [],
    description: "Net worth over 30 years if you buy, against renting and investing the difference.",
  });

  const rvbFig = $("rentBuyChart").querySelector<HTMLElement>("[data-multi]");
  if (rvbFig) {
    attachMultiHover(
      rvbFig,
      [
        {
          key: "buy",
          label: "Buy",
          color: SERIES_PRICE,
          points: r.years.map((y) => ({ month: `${2026 + y.year}-01`, value: y.buyNetWorth })),
        },
        {
          key: "rent",
          label: "Rent and invest",
          color: SERIES_PAYMENT,
          points: r.years.map((y) => ({ month: `${2026 + y.year}-01`, value: y.rentNetWorth })),
        },
      ],
      money,
      (m) => `Year ${Number(m.split("-")[0]) - 2026}`
    );
  }

  $("rentBuyVerdict").textContent = r.verdict;
  $("rentBuyVerdict").className =
    `verdict ${r.breakevenYear && r.breakevenYear <= 10 ? "verdict--yes" : "verdict--no"}`;
  $("rentBuyCaveat").textContent = RENT_VS_BUY_CAVEAT;

  if (!$("assumptionSets").hasChildNodes()) {
    // The page used to open on 5.4% / 7.0% / 3.5%, which is long-run housing
    // paired with a conservative equity number and matches no named set. That is
    // precisely the mismatched-period rigging the paragraph above warns about,
    // in the default state, so it opens on a named set instead.
    const opening = ASSUMPTION_SETS[0]!;
    $("assumptionSets").innerHTML = ASSUMPTION_SETS.map(
      (a) =>
        `<button type="button" class="preset${a.id === opening.id ? " preset--on" : ""}" data-assumptions="${a.id}">${a.label}</button>`
    ).join("");
    $("assumptionBasis").textContent = opening.basis;
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-assumptions]")) {
      button.addEventListener("click", () => {
        const set = ASSUMPTION_SETS.find((a) => a.id === button.dataset["assumptions"])!;
        $<HTMLInputElement>("appreciation").value = String(Math.round(set.homeAppreciation * 1000));
        $<HTMLInputElement>("investReturn").value = String(Math.round(set.investmentReturn * 1000));
        $<HTMLInputElement>("rentGrowth").value = String(Math.round(set.rentGrowth * 1000));
        for (const b of document.querySelectorAll(".preset[data-assumptions]")) b.classList.remove("preset--on");
        button.classList.add("preset--on");
        $("assumptionBasis").textContent = set.basis;
        renderRentVsBuy(readInput());
      });
    }
  }

  // --- how long would you have to stay? ---
  const holdYears = Number($<HTMLInputElement>("holdYears").value);
  $("holdYearsOut").textContent = `${holdYears} year${holdYears === 1 ? "" : "s"}`;

  const maxPrice = maxPriceForHoldPeriod(sweepBase, scaling, holdYears, downPercent, closingCostRate);
  // The same comparison the panel above ran. It used to be a second, separately
  // written call, which is exactly how the two drifted apart.
  const thisHouse = r;
  const worksForYou = thisHouse.breakevenYear !== null && thisHouse.breakevenYear <= holdYears;

  $("holdVerdict").innerHTML = `
    <div class="stat ${maxPrice ? "stat--pass" : "stat--fail"}">
      <span class="stat__label">Staying ${holdYears} years, pay at most</span>
      <span class="stat__value">${maxPrice ? money(maxPrice) : "nothing"}</span>
      <span class="stat__note">${
        maxPrice
          ? `A price-to-rent of ${(maxPrice / (rent * 12)).toFixed(1)}x. Above that, renting wins over your horizon.`
          : "At this rent and these assumptions, no price breaks even inside your horizon."
      }</span>
    </div>
    <div class="stat ${worksForYou ? "stat--pass" : "stat--fail"}">
      <span class="stat__label">This house at ${money(input.purchasePrice)}</span>
      <span class="stat__value">${thisHouse.breakevenYear ? `${thisHouse.breakevenYear} yr` : "never"}</span>
      <span class="stat__note">${
        thisHouse.breakevenYear
          ? worksForYou
            ? `Breaks even inside your ${holdYears} years. Selling earlier loses money against renting.`
            : `Breaks even in year ${thisHouse.breakevenYear}, which is longer than you plan to stay.`
          : "Never catches up within 30 years at this price and rent."
      }</span>
    </div>
    <div class="stat">
      <span class="stat__label">Rate is the biggest lever</span>
      <span class="stat__value">${money(maxPriceForHoldPeriod({ ...sweepBase, interestRate: 0.045 }, scaling, holdYears, downPercent, closingCostRate) ?? 0)}</span>
      <span class="stat__note">What you could pay at 4.5% instead of ${pct(input.interestRate)}, same horizon. Rates move your budget more than anything else here.</span>
    </div>`;

  const prices: number[] = [];
  for (let p = 300_000; p <= 1_600_000; p += 50_000) prices.push(p);
  const curve = breakevenByPrice(sweepBase, scaling, prices, downPercent, closingCostRate);
  const CAP_YEARS = 31;

  $("breakevenChart").innerHTML = renderMultiLine({
    series: [
      {
        key: "hold",
        label: "Years you must stay before owning wins",
        color: SERIES_PRICE,
        points: curve.map((c, i) => ({ month: String(i), value: c.breakevenYear ?? CAP_YEARS })),
      },
      {
        key: "horizon",
        label: `Your horizon (${holdYears} years)`,
        color: SERIES_PAYMENT,
        points: curve.map((c, i) => ({ month: String(i), value: holdYears })),
      },
    ],
    format: (n) => (n >= CAP_YEARS ? "never" : `${Math.round(n)}y`),
    xTicks: curve.map((c, i) => ({ index: i, label: `$${Math.round(c.value / 1000)}k` })).filter((_, i) => i % 5 === 0),
    description: "Years you must own before buying beats renting, by purchase price.",
    height: 210,
  });

  // --- the buy zone: what the rate actually decides ---
  const rates: number[] = [];
  for (let rate = 0.03; rate <= 0.1001; rate += 0.0025) rates.push(rate);
  const zone = buyZone(sweepBase, scaling, rates, holdYears, downPercent, closingCostRate);
  const sensitivity = rateSensitivity(sweepBase, scaling, holdYears, downPercent, closingCostRate);

  // Use the exact ceiling at the actual rate. Reading it off the nearest sampled
  // point on the curve produced a figure that disagreed with the stat card above.
  const ceilingHere = maxPrice;

  $("buyZoneChart").innerHTML = renderMultiLine({
    series: [
      {
        key: "zone",
        label: "Most you can justify paying",
        color: SERIES_PRICE,
        points: zone.map((z, i) => ({ month: String(i), value: z.maxPrice ?? 0 })),
      },
      {
        key: "yours",
        label: `This house (${money(input.purchasePrice)})`,
        color: SERIES_PAYMENT,
        points: zone.map((_, i) => ({ month: String(i), value: input.purchasePrice })),
      },
    ],
    format: (n) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`),
    shadeGap: true,
    xTicks: zone.map((z, i) => ({ index: i, label: pct(z.rate, 1) })).filter((_, i) => i % 4 === 0),
    description:
      "The most you can justify paying for a home at each interest rate, against the price you are considering.",
    height: 220,
  });

  const zoneFig = $("buyZoneChart").querySelector<HTMLElement>("[data-multi]");
  if (zoneFig) {
    attachMultiHover(
      zoneFig,
      [
        {
          key: "zone",
          label: "Ceiling",
          color: SERIES_PRICE,
          points: zone.map((z, i) => ({ month: String(i), value: z.maxPrice ?? 0 })),
        },
        {
          key: "yours",
          label: "This house",
          color: SERIES_PAYMENT,
          points: zone.map((_, i) => ({ month: String(i), value: input.purchasePrice })),
        },
      ],
      money,
      (label) => `At ${pct(zone[Number(label)]?.rate ?? 0, 2)}`
    );
  }

  // The ceiling DESCENDS as the rate rises, so the threshold is the LAST rate
  // whose ceiling still clears the price, not the first. Searching forward
  // returned the cheapest rate on the axis and reported it as the requirement.
  // Read the threshold from the exact solver, not off the 0.25% sampling grid.
  // The grid version disagreed with the lever card by up to a tenth of a point.
  const exactThreshold = requiredRate(sweepBase, scaling, input.purchasePrice, holdYears, downPercent, closingCostRate);
  const at45 = maxPriceForHoldPeriod({ ...sweepBase, interestRate: 0.045 }, scaling, holdYears, downPercent, closingCostRate);
  // requiredRate returns the HIGHEST rate that still works, so null is the only
  // failure. Testing it against 10% as though it were a threshold put the
  // strongest possible pass, a house that works even at 15%, in the same branch
  // as the houses that work at no rate at all, and printed the failure sentence
  // for both. It fired on every price under about $735,000 on the defaults.
  const rateClause =
    exactThreshold === null
      ? `${money(input.purchasePrice)} does not work at any rate, not even a free loan. `
      : exactThreshold >= RATE_SOLVER_CEILING
        ? `${money(input.purchasePrice)} works at any rate you could realistically be quoted. `
        : exactThreshold >= input.interestRate
          ? `${money(input.purchasePrice)} works at today's ${pct(input.interestRate)}, with room up to ${pct(exactThreshold, 2)}. `
          : `${money(input.purchasePrice)} needs a rate at or under ${pct(exactThreshold, 2)}, against ${pct(input.interestRate)} today. `;
  $("buyZoneNote").textContent =
    `Below the blue line, buying beats renting over ${holdYears} years. Above it, renting wins. ` +
    rateClause +
    (ceilingHere ? `At today's rate your ceiling is ${money(ceilingHere)}. ` : "") +
    `The curve is convex, so a single per-point figure misleads: the next half point down is worth about ` +
    `${money(Math.abs(sensitivity.perQuarterPoint))}, but getting all the way to 4.5% is worth ` +
    `${at45 && ceilingHere ? money(at45 - ceilingHere) : "considerably more"}. Rates are also the only input here you can change after you buy.`;

  // --- the decision ---
  const decision = decide({
    base: sweepBase,
    costs: scaling,
    price: input.purchasePrice,
    holdYears,
    downPercent,
    closingCostRate,
    excludeRentalIncome: excludeRental,
  });

  $("decisionVerdict").textContent = decision.verdict;
  $("decisionVerdict").className = `verdict ${decision.worthIt ? "verdict--yes" : "verdict--no"}`;

  $("decisionLevers").innerHTML = decision.levers
    .map((l) => {
      const done = l.note === "Already there." || l.note === "Not needed.";
      const state = done ? "lever--met" : l.reachable ? "lever--close" : "lever--far";
      return `
      <div class="lever ${state}">
        <span class="lever__label">${l.label}</span>
        <div class="lever__values">
          <span class="lever__now">${l.current}</span>
          <span class="lever__arrow">${done ? "" : "needs"}</span>
          <span class="lever__need">${done ? "met" : l.needed}</span>
        </div>
        <p class="lever__note">${l.note}</p>
      </div>`;
    })
    .join("");

  // The cap turns on the CPI region the property is in, not on the state, so it
  // has to follow the county selector like everything else in this panel.
  const capRegion = rentCapRegionFor(input.county);
  $("rentCapNote").textContent =
    `Where the blue line sits below the orange one, buying wins over your horizon. California caps annual rent ` +
    `increases at ${pct(statutoryRentCap(input.county), 1)} in ${input.county} County under AB 1482 ` +
    `(5% plus the CPI for ${capRegion.label}, never above 10%), but that is a ceiling, not a forecast: most ` +
    `sitting tenants see far less, and single-family homes, condos not owned by a corporation, and anything built ` +
    `in the last 15 years are exempt entirely.`;

  // --- the savings treadmill ---
  const race = savingsRace({
    targetPrice: input.purchasePrice,
    downPaymentPercent: downPercent,
    closingCostRate,
    currentSavings: num("currentSavings", 0),
    monthlySavings: num("monthlySavings", 0),
    savingsReturn: 0.045,
    homeAppreciation: appreciation,
  });

  $("savingsRace").innerHTML = `
    <div class="stat">
      <span class="stat__label">Cash needed today</span>
      <span class="stat__value">${money(race.cashNeededToday)}</span>
      <span class="stat__note">Down payment plus closing costs on ${money(input.purchasePrice)}.</span>
    </div>
    <div class="stat ${race.losingGround ? "stat--fail" : "stat--pass"}">
      <span class="stat__label">Time to get there</span>
      <span class="stat__value">${race.yearsToAfford ? race.yearsToAfford + " yr" : "never"}</span>
      <span class="stat__note">${
        race.priceThen ? `The house costs ${money(race.priceThen)} by then.` : "The target moves faster than you save."
      }</span>
    </div>
    <div class="stat ${race.losingGround ? "stat--fail" : "stat--pass"}">
      <span class="stat__label">The race</span>
      <span class="stat__value">${money(race.savingsGrowBy - race.targetGrowsBy)}<span class="stat__unit">/yr ${race.losingGround ? "behind" : "ahead"}</span></span>
      <span class="stat__note">Your savings grow ${money(race.savingsGrowBy)}/yr. The deposit you need grows ${money(race.targetGrowsBy)}/yr.</span>
    </div>`;

  $("savingsVerdict").textContent = race.verdict;
  $("savingsVerdict").className = `verdict ${race.losingGround ? "verdict--no" : "verdict--yes"}`;
}

let buyingPowerWired = false;
/** The buying-power toggle re-renders, so it has to know which county it is on. */
let lastBuyingPowerCounty: CaCounty | null = null;

function renderBuyingPower(county: CaCounty): void {
  lastBuyingPowerCounty = county;
  // Over 39 years a nominal chart is dominated by inflation, which makes both
  // lines look like they exploded and hides what actually changed. Real dollars
  // are the default. The ratio and "last month it worked" are inflation-neutral,
  // so no headline figure moves either way.
  const inTodaysDollars = $<HTMLInputElement>("realDollars").checked;

  const series = buyingPowerSeries(county, undefined, inTodaysDollars);
  const v = buyingPowerVerdict(county);
  const compact = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`);
  const unit = inTodaysDollars ? " in today's money" : " in the money of the day";

  $("buyingPowerChart").innerHTML = renderMultiLine({
    series: [
      {
        key: "price",
        label: `What the same house cost${unit}`,
        color: SERIES_PRICE,
        points: series.map((p) => ({ month: p.month, value: p.homePrice })),
      },
      {
        key: "afford",
        label: `What a median income could buy${unit}`,
        color: SERIES_PAYMENT,
        points: series.map((p) => ({ month: p.month, value: p.affordablePrice })),
      },
    ],
    format: compact,
    shadeGap: true,
    markers: v.lastAffordableMonth
      ? [{ seriesKey: "price", month: v.lastAffordableMonth, label: "last month it worked" }]
      : [],
    description:
      "What one San Diego house cost through time, against what a median California household could afford, 1987 to today.",
  });

  if (!buyingPowerWired) {
    buyingPowerWired = true;
    $<HTMLInputElement>("realDollars").addEventListener("change", () => renderBuyingPower(lastBuyingPowerCounty!));
  }

  const bpFig = $("buyingPowerChart").querySelector<HTMLElement>("[data-multi]");
  if (bpFig) {
    attachMultiHover(
      bpFig,
      [
        {
          key: "price",
          label: "The same house",
          color: SERIES_PRICE,
          points: series.map((p) => ({ month: p.month, value: p.homePrice })),
        },
        {
          key: "afford",
          label: "A median income buys",
          color: SERIES_PAYMENT,
          points: series.map((p) => ({ month: p.month, value: p.affordablePrice })),
        },
      ],
      money,
      (m) => `${MONTH_NAMES[Number(m.split("-")[1])]} ${m.split("-")[0]}`
    );
  }

  $("buyingPowerHeadline").textContent = v.headline;

  $("buyingPower").innerHTML = `
    <div class="stat stat--wide">
      <span class="stat__label">The last month the math worked</span>
      <span class="stat__value">${v.lastAffordableMonth ? longMonth(v.lastAffordableMonth) : "never"}</span>
      <span class="stat__note">${v.blueberries}</span>
    </div>
    <div class="stat">
      <span class="stat__label">Years of income per home</span>
      <span class="stat__value">${v.latest.yearsOfIncome.toFixed(1)}<span class="stat__unit"> today</span></span>
      <span class="stat__note">It was ${v.first.yearsOfIncome.toFixed(1)} in ${v.first.month.slice(0, 4)}.</span>
    </div>
    <div class="stat">
      <span class="stat__label">Buying power lost</span>
      <span class="stat__value">${(v.powerLost * 100).toFixed(0)}%</span>
      <span class="stat__note">Since ${v.first.month.slice(0, 4)}, holding the effort fixed at 30% of income.</span>
    </div>
    <div class="stat">
      <span class="stat__label">Best it ever got</span>
      <span class="stat__value">${v.best.purchasingRatio.toFixed(2)}x<span class="stat__unit"> in ${longMonth(v.best.month)}</span></span>
      <span class="stat__note">Worst was ${v.worst.purchasingRatio.toFixed(2)}x in ${longMonth(v.worst.month)}. Today: ${v.latest.purchasingRatio.toFixed(2)}x.</span>
    </div>`;

  $("buyingPowerCaveat").textContent = BUYING_POWER_CAVEAT;
  renderWhereItWorks(county);
}

/**
 * The sharper version of the thesis, and the one the data actually supports.
 *
 * "Housing outran wages" is true in 24 counties and false in 34, which sounds
 * like a weaker claim until you see WHICH counties. Affordability did not leave
 * California, it relocated to where the work is not, and the counties that pay
 * best are the least affordable of all.
 */
function renderWhereItWorks(county: CaCounty): void {
  const trap = payTrap();
  const here = countyStanding(county);
  const standings = allStandings();
  const rank = standings.findIndex((s) => s.county === county) + 1;

  $("payTrapHeadline").textContent = trap.headline;
  $("payTrapHeadline").className = "verdict verdict--no";

  $("payTrap").innerHTML = `
    <div class="stat stat--wide ${here.yearsOfIncome >= 7 ? "stat--fail" : here.yearsOfIncome < 5 ? "stat--pass" : ""}">
      <span class="stat__label">${county} County, on its own income</span>
      <span class="stat__value">${here.yearsOfIncome.toFixed(1)}x<span class="stat__unit"> years of local pay</span></span>
      <span class="stat__note">
        A typical single-family home here is ${money(here.homeValue)}. The households who already live and work here
        earn a median of ${money(here.income)}. That makes it the ${rank}${ordinal(rank)} least affordable of the 58
        counties, measured against what people there actually earn.
      </span>
    </div>
    <div class="stat stat--fail">
      <span class="stat__label">Priced out of their own county</span>
      <span class="stat__value">${trap.pricedOut.length}<span class="stat__unit"> of 58</span></span>
      <span class="stat__note">Counties where a local median household would need 7 years of gross income or more.</span>
    </div>
    <div class="stat stat--pass">
      <span class="stat__label">Where it still works</span>
      <span class="stat__value">${trap.workable.length}<span class="stat__unit"> of 58</span></span>
      <span class="stat__note">
        Under 5 years of local income: ${trap.workable.map((s) => s.county).join(", ")}. Look at that list and then
        at the one above it. That is the whole finding.
      </span>
    </div>
    <div class="stat stat--fail">
      <span class="stat__label">Better pay, worse housing</span>
      <span class="stat__value">r = +${trap.payVsMultiple.toFixed(2)}</span>
      <span class="stat__note">
        Correlation between what a county pays and how many years of that pay a house costs. Prices track pay at
        +${trap.payVsPrice.toFixed(2)}, which is why the raise does not reach the house.
      </span>
    </div>`;

  // A ladder rather than a chart: the ranking IS the point, and 58 rows of one
  // number read better as a list than as 58 bars nobody can label.
  const worst = standings.slice(0, 5);
  const best = standings.slice(-5).reverse();
  const row = (s: (typeof standings)[number]) => `
    <div class="corr__row${s.county === county ? " corr__row--you" : ""}">
      <span class="corr__label">${s.county}</span>
      <span class="corr__bar"><i style="width:${(s.yearsOfIncome / standings[0]!.yearsOfIncome) * 100}%"></i></span>
      <span class="corr__r">${s.yearsOfIncome.toFixed(1)}x</span>
      <span class="corr__n">${money(s.income)} local median income</span>
    </div>`;
  const gap = `<div class="corr__row corr__row--gap"><span class="corr__label">…${standings.length - 10} more</span></div>`;
  $("countyLadder").innerHTML =
    worst.map(row).join("") + gap + best.map(row).join("") + (rank > 5 && rank <= 53 ? row(here) : "");

  $("whereItWorksCaveat").textContent = WHERE_IT_WORKS_CAVEAT;
}

const ordinal = (n: number): string => {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
};

let lastSignalsCounty: CaCounty | null = null;

function renderSignals(county: CaCounty): void {
  // Keyed on the county, like renderHistory. A one-shot flag froze these figures
  // at first paint while the charts above them redrew on every keystroke, and it
  // would now also mean changing county never changed the panel.
  if (lastSignalsCounty === county) return;
  lastSignalsCounty = county;

  const verdict = worstTimeToBuy(county);
  $("worstTime").textContent = verdict.answer;
  $("worstTime").className = `verdict ${verdict.rank === 1 ? "verdict--no" : "verdict--yes"}`;

  const { readings, summary, caveats } = crashSignals(county);
  const fmt = (v: number | null, unit: string) =>
    v === null ? ", " : unit.startsWith("x") ? `${v.toFixed(1)}x` : `${v.toFixed(1)}${unit.startsWith("%") ? "%" : ""}`;

  $("signals").innerHTML = readings
    .map(
      (r) => `
      <div class="signal signal--${r.lean}">
        <div class="signal__head">
          <span class="signal__label">${r.label}</span>
          <span class="signal__lean">${r.lean === "bearish" ? "points down" : r.lean === "bullish" ? "points up" : "neutral"}</span>
        </div>
        <span class="signal__value">${fmt(r.now, r.unit)}<span class="signal__unit">${r.unit.replace(/^[x%]\s*/, " ")}</span></span>
        <div class="signal__compare">
          <span><em>2006 peak</em> ${fmt(r.at2006Peak, r.unit)}</span>
          <span><em>2009 bottom</em> ${fmt(r.at2009Trough, r.unit)}</span>
        </div>
        <p class="signal__reading">${r.reading}</p>
        ${r.caveat ? `<p class="line__warning">${r.caveat}</p>` : ""}
      </div>`
    )
    .join("");

  $("signalSummary").textContent = summary;
  $("signalSummary").className = "verdict";

  const inds = leadingIndicators(24, county).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  const maxAbs = Math.max(...inds.map((i) => Math.abs(i.r)));
  $("correlations").innerHTML = `
    <p class="field-note">
      Pearson correlation between each indicator and the following 24 months of price change. Negative means a
      higher reading preceded weaker prices.
    </p>
    <div class="corr">
      ${inds
        .map(
          (i) => `
        <div class="corr__row">
          <span class="corr__label">${i.label}</span>
          <span class="corr__bar"><i style="width:${(Math.abs(i.r) / maxAbs) * 100}%"></i></span>
          <span class="corr__r">${i.r >= 0 ? "+" : ""}${i.r.toFixed(2)}</span>
          <span class="corr__n">${i.strength}, effective n=${i.effectiveObservations}</span>
        </div>`
        )
        .join("")}
    </div>`;

  $("signalCaveats").innerHTML = caveats.map((c) => `<li>${c}</li>`).join("");
}

let instrumentsRendered = false;

const LEVEL_LABEL: Record<string, string> = {
  "rhymes-hard": "rhymes hard with 2008",
  watch: "worth watching",
  context: "counterweight",
};

function renderInstruments(): void {
  if (instrumentsRendered) return;
  instrumentsRendered = true;

  $("watchPreamble").textContent = WATCHLIST_PREAMBLE;
  $("watchDiscipline").textContent = WATCHLIST_DISCIPLINE;

  $("instruments").innerHTML = INSTRUMENTS.map(
    (i) => `
      <details class="instrument instrument--${i.level}">
        <summary>
          <span class="instrument__name">${i.name}</span>
          <span class="instrument__level">${LEVEL_LABEL[i.level]}</span>
        </summary>
        <span class="instrument__gist">${i.gist}</span>
        <div class="instrument__body">
          <p class="instrument__what"><strong>What it is.</strong> ${i.what}</p>
          <p class="instrument__rhyme"><strong>The rhyme.</strong> ${i.rhyme}</p>
          <p class="instrument__reading"><strong>Where it stands.</strong> ${i.reading}</p>
          <p class="instrument__trip"><strong>What would make it dangerous.</strong> ${i.tripwire}</p>
          <p class="instrument__unknown"><strong>What we don't know.</strong> ${i.unknown}</p>
          <p class="line__meta">
            ${i.sources.map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${s.label}</a>`).join(" · ")}
          </p>
        </div>
      </details>`
  ).join("");
}

let forecastRendered = false;

function renderForecast(): void {
  if (forecastRendered) return;
  forecastRendered = true;

  const v = verdict(24);
  const reports = horizonReports();
  const r24 = reports.find((r) => r.horizon === 24)!;

  $("forecastVerdict").innerHTML = `
    <p class="verdict ${v.trustworthy ? "verdict--yes" : "verdict--no"}">${v.headline}</p>
    <ul class="warnings">${v.failures.map((f) => `<li>${f}</li>`).join("")}</ul>
    <p class="field-note">
      Trained ${MODEL_META.trained} on ${MODEL_META.observations.toLocaleString("en-US")} metro-months across
      ${MODEL_META.metros} metros; San Diego scored as of ${MODEL_META.scoredMonth}. Checks were fixed before
      looking at results: ${v.criteria.join("; ")}.
    </p>`;

  $("forecastCurrent").innerHTML = reports
    .map(
      (r) => `
      <div class="stat stat--fail">
        <span class="stat__label">${r.horizon}-month call: do not act on this</span>
        <span class="stat__value">${(r.current.gradientBoosting * 100).toFixed(1)}%<span class="stat__unit"> price change</span></span>
        <span class="stat__note">
          Crash probability ${(r.current.crashProbabilityGbm * 100).toFixed(0)}%.
          Same model, judged on 2004-2006, said ${(r.classifier.preCrashProbability * 100).toFixed(0)}% right before prices fell.
        </span>
      </div>`
    )
    .join("");

  const weights = learnedWeights(24);
  const maxW = Math.max(...weights.map((w) => Math.abs(w.weight)));
  $("forecastWeights").innerHTML = `
    <p class="field-note">
      What the 24-month ridge model learned to weight, per standard deviation of each indicator. These describe
      the model, not the housing market. A model this poorly validated has no authority to tell you what matters.
    </p>
    <div class="corr">
      ${weights
        .map(
          (w) => `
        <div class="corr__row">
          <span class="corr__label">${w.label}</span>
          <span class="corr__bar"><i style="width:${(Math.abs(w.weight) / maxW) * 100}%;background:${w.weight < 0 ? "var(--bad)" : "var(--good)"}"></i></span>
          <span class="corr__r">${w.weight >= 0 ? "+" : ""}${w.weight.toFixed(3)}</span>
          <span class="corr__n">${w.weight < 0 ? "pushes forecast down" : "pushes forecast up"}</span>
        </div>`
        )
        .join("")}
    </div>`;

  $("forecastScores").innerHTML = `
    <p class="field-note">Out-of-sample scores, purged walk-forward. Negative skill means the naive baseline wins.</p>
    <div class="scores">
      <div class="scores__row scores__row--head">
        <span>Horizon</span><span>Best model</span><span>vs "average"</span><span>vs "trend continues"</span>
        <span>Direction edge</span><span>Crash AUC</span>
      </div>
      ${reports
        .map(
          (r) => `
        <div class="scores__row">
          <span>${r.horizon}mo</span>
          <span>${r.best.family.replace(/_/g, " ")}</span>
          <span class="${r.best.skillVsMean > 0 ? "ok" : "bad"}">${r.best.skillVsMean.toFixed(2)}</span>
          <span class="${r.best.skillVsMomentum > 0 ? "ok" : "bad"}">${r.best.skillVsMomentum.toFixed(2)}</span>
          <span class="${r.best.directionalEdge > 0 ? "ok" : "bad"}">${(r.best.directionalEdge * 100).toFixed(1)} pts</span>
          <span class="${(r.classifier.auc ?? 0) > 0.5 ? "ok" : "bad"}">${r.classifier.auc?.toFixed(2) ?? ", "}</span>
        </div>`
        )
        .join("")}
    </div>`;
}

let presetsRendered = false;

function applyPreset(id: string): void {
  const preset = crashPresets().find((p) => p.id === id);
  if (!preset) return;
  $<HTMLInputElement>("crashDepth").value = String(preset.depthPercent);
  $<HTMLInputElement>("crashMonths").value = String(Math.min(preset.monthsToBottom, 84));
  $<HTMLInputElement>("crashRate").value = String(Math.round(preset.rateAtBottom * 10000));
  $("presetBasis").textContent = preset.basis;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
    b.classList.toggle("preset--on", b.dataset["preset"] === id);
  }
  renderWaiting(readInput());
}

function renderPresets(): void {
  if (presetsRendered) return;
  presetsRendered = true;

  const presets = crashPresets();
  $("presets").innerHTML = presets
    .map((p) => `<button type="button" class="preset" data-preset="${p.id}">${p.label}</button>`)
    .join("");

  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
    b.addEventListener("click", () => applyPreset(b.dataset["preset"]!));
  }
  applyPreset(presets[0]!.id);
}

function renderWaiting(input: ScenarioInput): void {
  const depth = Number($<HTMLInputElement>("crashDepth").value);
  const months = Number($<HTMLInputElement>("crashMonths").value);
  const rateAtBottom = Number($<HTMLInputElement>("crashRate").value) / 10000;

  $("crashDepthOut").textContent = `${depth}%`;
  $("crashMonthsOut").textContent = `${months} months`;
  $("crashRateOut").textContent = pct(rateAtBottom);

  const r = evaluateWaiting({
    priceNow: input.purchasePrice,
    rateNow: input.interestRate,
    downPercent: 0.2,
    crashDepthPercent: depth,
    monthsToBottom: months,
    rateAtBottom,
    monthlyRent: num("waitRent", 0),
    monthlySavings: num("waitSavings", 0),
    propertyTaxRate: input.propertyTaxRate ?? countyTaxRate(input.county),
  });

  const better = r.monthlySaving > 0;

  $("waiting").innerHTML = `
    <div class="stat">
      <span class="stat__label">Buy today</span>
      <span class="stat__value">${money(r.buyNow.total)}<span class="stat__unit">/mo</span></span>
      <span class="stat__note">${money(r.buyNow.price)} at ${pct(input.interestRate)}, principal, interest and tax.</span>
    </div>
    <div class="stat">
      <span class="stat__label">Buy at the bottom</span>
      <span class="stat__value">${money(r.buyLater.total)}<span class="stat__unit">/mo</span></span>
      <span class="stat__note">${money(r.buyLater.price)} at ${pct(rateAtBottom)}, with ${money(r.buyLater.down)} down.</span>
    </div>
    <div class="stat ${better ? "stat--pass" : "stat--fail"}">
      <span class="stat__label">${better ? "Waiting saves" : "Waiting costs"}</span>
      <span class="stat__value">${money(Math.abs(r.monthlySaving))}<span class="stat__unit">/mo</span></span>
      <span class="stat__note">
        ${
          r.breakevenMonths !== null
            ? `Repays the ${money(r.rentPaidWhileWaiting)} of rent in ${Math.round(r.breakevenMonths)} months.`
            : `And you'd still have paid ${money(r.rentPaidWhileWaiting)} in rent to get there.`
        }
      </span>
    </div>
    <div class="stat">
      <span class="stat__label">Prop 13, permanently</span>
      <span class="stat__value">${money(r.propTaxSavingAnnual)}<span class="stat__unit">/year</span></span>
      <span class="stat__note">
        A lower purchase price locks a lower assessed value for as long as you own it. This is the part of waiting
        that keeps paying after the market recovers.
      </span>
    </div>
    <div class="stat stat--wide">
      <span class="stat__label">What you give up by waiting</span>
      <span class="stat__value">${money(r.rentPaidWhileWaiting + r.equityBuiltIfBuyingNow)}</span>
      <span class="stat__note">
        ${money(r.rentPaidWhileWaiting)} in rent, plus ${money(r.equityBuiltIfBuyingNow)} of principal you'd have paid
        down over those ${months} months. Against that: buying now and seeing a ${depth}% fall would put you
        ${money(r.paperLossIfBuyingNow)} underwater on paper.
      </span>
    </div>`;

  $("waitingVerdict").textContent = r.verdict;
  $("waitingVerdict").className = `verdict ${better ? "verdict--yes" : "verdict--no"}`;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * Live thousands separators on money fields.
 *
 * These fields are deliberately `type="text"`, not `type="number"`. A number
 * input reports `.value` as an empty string the moment its contents aren't a
 * bare number, so a browser will happily *display* "1,200,000" while handing
 * the script "". Owning the formatting ourselves keeps what you see and what
 * gets calculated the same thing.
 */
function attachMoneyFormatting(el: HTMLInputElement): void {
  el.addEventListener("input", () => {
    const caret = el.selectionStart ?? el.value.length;
    const digitsBeforeCaret = countDigits(el.value.slice(0, caret));

    const formatted = formatThousands(el.value);
    if (formatted === el.value) return;

    el.value = formatted;
    const position = caretAfterFormat(formatted, digitsBeforeCaret);
    el.setSelectionRange(position, position);
  });
}

function init(): void {
  // Built from the page's own headings, so it cannot drift when sections move.
  const toc = buildToc();
  document.body.insertAdjacentHTML("afterbegin", renderToc(toc));
  attachToc(toc);

  const countySelect = $<HTMLSelectElement>("county");
  countySelect.innerHTML = CA_COUNTIES.map(
    (c) => `<option value="${c}"${c === "San Diego" ? " selected" : ""}>${c}</option>`
  ).join("");

  for (const el of document.querySelectorAll<HTMLInputElement>("input.money")) {
    attachMoneyFormatting(el);
  }

  // The history panel's own controls re-render only the sections they affect.
  for (const id of ["appreciation", "investReturn", "rentGrowth", "holdYears", "rentalIncome", "excludeRental"]) {
    $<HTMLInputElement>(id).addEventListener("input", () => renderRentVsBuy(readInput()));
  }

  for (const id of ["cohortYear", "crashDepth", "crashMonths", "crashRate", "waitRent", "waitSavings"]) {
    $<HTMLInputElement>(id).addEventListener("input", () => {
      const current = readInput();
      if (id === "cohortYear") {
        renderCohort(current);
      } else {
        // Moving a slider means you're no longer on a named historical scenario.
        // Only the crash presets. The bare `.preset` selector also matched the
        // assumption-set buttons in the panel above, so dragging a crash slider
        // cleared a selection in a different section.
        for (const b of document.querySelectorAll(".preset[data-preset]")) b.classList.remove("preset--on");
        $("presetBasis").textContent = "Your own assumptions, not a historical scenario.";
        renderWaiting(current);
      }
    });
  }

  const form = $<HTMLFormElement>("scenario");
  form.addEventListener("input", (e) => {
    if ((e.target as HTMLElement).id === "interestRate") {
      $<HTMLInputElement>("interestRate").dataset["touched"] = "1";
    }
    render();
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  render();
  void loadRate();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
