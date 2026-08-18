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
  waitingPath,
  findDrawdowns,
  historicalContext,
} from "../../lib/history.ts";
import {
  compareToCohort,
  refinanceOpportunity,
  earliestCohortMonth,
  latestCohortMonth,
  BEST_REFI,
  REFI_WINDOW,
} from "../../lib/cohort.ts";
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
import { buyingPowerCaveat, buyingPowerSeries, buyingPowerVerdict } from "../../lib/buying-power.ts";
import { DEFAULT_ANCHOR_PRICE } from "../../lib/history.ts";
import { historyFor } from "../../lib/data/history.ts";
import { countyTaxRate } from "../../lib/data/ca-property.ts";
import { countyScope } from "../../lib/county-scope.ts";
import { WHERE_IT_WORKS_CAVEAT, allStandings, countyStanding, payTrap } from "../../lib/where-it-works.ts";
import {
  assumptionSets,
  RATE_SOLVER_CEILING,
  RENT_VS_BUY_CAVEAT,
  breakevenByPrice,
  buyMinusRentAt,
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
import { recommend } from "../../lib/recommendation.ts";
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
import { applyScenarioFromUrl, writeScenarioToUrl } from "./permalink.ts";
import type { CaCounty } from "../../lib/data/ca-loan-limits.ts";
import type { Confidence, LineItem, LoanType, ScenarioInput, ScenarioResult } from "../../lib/types.ts";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const pct = (n: number, places = 2) => (n * 100).toFixed(places) + "%";

/**
 * Escape a string before it goes into innerHTML. The county select coerces any
 * crafted URL value back to "" (a <select> only returns a real option), so the
 * report is not actually injectable today, but interpolating a form-derived
 * string into markup should never depend on that coercion holding.
 */
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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
      ? `Rate feed unreachable; showing the last value from ${data.asOf}. Enter your own quote.`
      : `Freddie Mac weekly average as of ${data.asOf}. <a href="${data.source.url}" target="_blank" rel="noopener">Source</a>. National average for a well-qualified borrower. Your quote will differ.`;
    render();
  } catch {
    note.textContent = "Rate feed unavailable. The default below is a placeholder; enter your own quote.";
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
    rateIsUserSupplied: $<HTMLInputElement>("interestRate").dataset["touched"] === "1",
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

// Which formula on the methodology page explains each line, so the reader can
// go from a number straight to the algebra behind it.
const FORMULA_ANCHOR: Record<string, string> = {
  principalAndInterest: "the-mortgage-payment",
  propertyTax: "property-tax-under-proposition-13",
  melloRoos: "property-tax-under-proposition-13",
  homeownersInsurance: "the-rest-and-the-discipline-behind-it",
  maintenanceReserve: "the-two-totals",
};

function formulaAnchorFor(line: LineItem): string | null {
  if (line.key === "mortgageInsurance") {
    return /FHA/i.test(line.label) ? "fha-mortgage-insurance" : "conventional-pmi";
  }
  return FORMULA_ANCHOR[line.key] ?? null;
}

function renderLine(line: LineItem, isTrueCostOnly: boolean): string {
  const sources = line.sourceIds
    .map((id) => {
      const s = SOURCES[id];
      return `<a href="${s.url}" target="_blank" rel="noopener">${s.publisher}</a>`;
    })
    .join(", ");
  const anchor = formulaAnchorFor(line);

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
          ${anchor ? `<a class="line__formula" href="/how-its-calculated/#${anchor}">see the formula →</a>` : ""}
          <span class="line__annual">${money(line.annual)}/year</span>
        </p>
      </div>
    </details>`;
}

const LOAN_LABEL: Record<string, string> = { conventional: "Conventional", fha: "FHA", va: "VA" };

/**
 * The scenario, recapped for print. On paper the live form is noise: read-only
 * inputs, placeholder warnings, empty fields. A report wants the facts it was run
 * on, stated once and compactly. This is hidden on screen and shown only in the
 * print stylesheet, and it is rebuilt on every render so it can never disagree
 * with the numbers below it.
 */
function renderPrintReport(input: ScenarioInput, result: ScenarioResult): void {
  const el = document.getElementById("printReport");
  if (!el) return;

  const price = input.purchasePrice;
  const downAmount = input.downPayment.kind === "amount" ? input.downPayment.value : input.downPayment.value * price;
  const downPct = price > 0 ? downAmount / price : 0;
  const income = input.household.grossAnnualIncomes.reduce((a, b) => a + b, 0);
  // Everything below goes into innerHTML. Numbers are formatted by money()/pct()
  // and safe; the form-derived strings are escaped.
  const loan = escapeHtml(LOAN_LABEL[input.loanType] ?? input.loanType);
  const county = escapeHtml(input.county);
  const today = escapeHtml(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }));

  const facts: [string, string][] = [
    ["Purchase price", money(price)],
    ["Down payment", `${money(downAmount)} · ${pct(downPct, 1)}`],
    ["Loan", `${loan} · ${input.termYears} years · ${pct(input.interestRate, 2)}`],
    ["County", county],
    ["Household income", `${money(income)}/yr`],
  ];
  if (input.hoaMonthly > 0) facts.push(["HOA dues", `${money(input.hoaMonthly)}/mo`]);
  if (input.melloRoosAnnual > 0) facts.push(["Mello-Roos", `${money(input.melloRoosAnnual)}/yr`]);

  el.innerHTML = `
    <div class="print-report__head">
      <p class="print-report__kicker">Three Blueberries · cost report</p>
      <h2 class="print-report__title">What this house actually costs</h2>
      <p class="print-report__meta">${money(price)} home in ${county} County · generated ${today}</p>
    </div>
    <dl class="print-report__facts">
      ${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}
    </dl>
    <div class="print-report__totals">
      <div><span>Lender total</span><strong>${money(result.lenderMonthlyTotal)}/mo</strong><small>what a mortgage calculator shows you</small></div>
      <div class="print-report__true"><span>True monthly cost</span><strong>${money(result.trueMonthlyTotal)}/mo</strong><small>what actually leaves your account</small></div>
    </div>`;
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

  // Empty-state cards used to render a literal ", " as their value, which is the
  // separator from an earlier template left behind by an edit.
  const NOT_AVAILABLE = "&mdash;".replace("&mdash;", "—");

  $("qualification").innerHTML = `
    <div class="stat">
      <span class="stat__label">Income needed for this house</span>
      <span class="stat__value">${money(q.incomeRequiredAnnual)}<span class="stat__unit">/year</span></span>
      <span class="stat__note">${
        q.dtiIsGuideline
          ? `To clear VA's residual income test, what VA actually underwrites. The ${pct(q.dtiCeiling, 0)} DTI figure is a guideline with no cap behind it.`
          : `To stay at or under a ${pct(q.dtiCeiling, 0)} debt-to-income ratio.`
      }</span>
    </div>
    <div class="stat">
      <span class="stat__label">Most house you can buy</span>
      <span class="stat__value">${afford.maxPurchasePrice > 0 ? money(afford.maxPurchasePrice) : NOT_AVAILABLE}</span>
      <span class="stat__note">${
        afford.maxPurchasePrice > 0
          ? `On ${money(haveIncome)}/year, ${
              afford.bindingConstraint === "none"
                ? "nothing here binds: this is the top of the search range, not a limit you hit"
                : `limited by ${
                    afford.bindingConstraint === "residual-income"
                      ? "VA residual income"
                      : afford.bindingConstraint === "fha-limit"
                        ? `FHA's loan limit for this county, not your income`
                        : "debt-to-income"
                  }`
            }. Needs ${money(afford.cashRequired)} cash` +
            (afford.downPercent < 0.2 && input.loanType === "conventional"
              ? `, and at that price your deposit is only ${pct(afford.downPercent, 1)} down, so the answer carries PMI.`
              : ".")
          : "This household clears the ceiling at no price with these inputs."
      }</span>
    </div>
    <div class="stat">
      <span class="stat__label">Cash to close</span>
      <span class="stat__value">${money(result.cashToClose.total)}</span>
      <span class="stat__note">${money(result.cashToClose.downPayment)} down, plus closing costs and impounds.</span>
    </div>
    <div class="stat ${q.dtiIsGuideline ? "" : q.passesDti ? "stat--pass" : "stat--fail"}">
      <span class="stat__label">Your debt-to-income</span>
      <span class="stat__value">${Number.isFinite(q.backEndDti) ? pct(q.backEndDti, 1) : NOT_AVAILABLE}</span>
      <span class="stat__note">${
        q.dtiIsGuideline
          ? `VA's guideline is ${pct(q.dtiCeiling, 0)}, and it is not a ceiling. The card below is the test that decides.`
          : `${q.passesDti ? "Within" : "Above"} the ${pct(q.dtiCeiling, 0)} ceiling for this program.`
      }</span>
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

  // The max-price answer has warnings of its own, and they are not the warnings
  // for the price on the form. They used to be computed and discarded, so the
  // jumbo-rate limitation was invisible on the one number people screenshot.
  const seen = new Set(result.warnings);
  const affordOnly = afford.maxPurchasePrice > 0 ? afford.warnings.filter((w) => !seen.has(w)) : [];
  $("warnings").innerHTML = [
    ...result.warnings.map((w) => `<li>${w}</li>`),
    ...affordOnly.map((w) => `<li><strong>On the ${money(afford.maxPurchasePrice)} answer above:</strong> ${w}</li>`),
  ].join("");

  renderPrintReport(input, result);
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
  renderPresets(input.county);
  renderWaiting(input);
}

// ---------------------------------------------------------------------------
// "How is anyone affording this?"
// ---------------------------------------------------------------------------

const SERIES_PRICE = "#3987e5";

/**
 * Axis labels for a dollar series that may live in the hundreds.
 *
 * `$${Math.round(n/1000)}k` collapses $500 to "$1k", identical to the $1,000
 * gridline above it, so in 15 low-priced counties two gridlines carried the
 * same label and the $500 line read as $1,000: a 2x error on the payment axis.
 * Keep a decimal below $10k so adjacent gridlines never share a label.
 */
const moneyAxis = (n: number): string =>
  n >= 10_000 ? `$${Math.round(n / 1000)}k` : n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;
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
  // The county HAS to be threaded through here. Without it compareToCohort falls
  // back to DEFAULT_COUNTY and every reader was priced off San Diego's index
  // under a note naming their own county.
  const shared = {
    county: input.county,
    currentPrice: input.purchasePrice,
    currentRate: input.interestRate,
    downPercent: 0.2,
    propertyTaxRate: input.propertyTaxRate ?? countyTaxRate(input.county),
  };

  // Rural counties are annual and several start in the 1990s, so the cohort
  // range is the county's own record, not a hardcoded 1990.
  const firstYear = Math.max(COHORT_FIRST_YEAR, Number(earliestCohortMonth(input.county).slice(0, 4)));
  const lastYear = Math.min(
    Number(BEST_REFI.month.slice(0, 4)) + 4,
    Number(latestCohortMonth(input.county).slice(0, 4))
  );
  const years: number[] = [];
  for (let y = firstYear; y <= lastYear; y++) years.push(y);

  // Clamp the slider to that range before reading it, so a county whose record
  // starts in 1993 cannot be asked about 1990 and answer with an empty panel.
  const slider = $<HTMLInputElement>("cohortYear");
  slider.min = String(firstYear);
  slider.max = String(lastYear);
  const year = Math.min(lastYear, Math.max(firstYear, Number(slider.value)));
  slider.value = String(year);
  $("cohortYearOut").textContent = String(year);

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

  // A 2020 or 2021 buyer bought INSIDE the cheap window, so telling them they
  // were too late to catch it is backwards. Three cases, not two.
  const boughtInWindow = purchaseMonth >= REFI_WINDOW.from && purchaseMonth <= REFI_WINDOW.to;
  const refiNote = c.refinancedMonth
    ? ` and refinanced their remaining balance to ${pct(c.effectiveRate)} in ${longMonth(c.refinancedMonth)}. The cheapest month on record`
    : boughtInWindow
      ? ` at ${pct(c.rateThen)}, straight into the cheap-money window, so they never needed to refinance`
      : ` at ${pct(c.rateThen)}, after the ${REFI_WINDOW.from.slice(0, 4)}-${REFI_WINDOW.to.slice(0, 4)} refinance window had closed`;

  $("cohort").innerHTML = `
    <div class="stat stat--wide">
      <span class="stat__label">The same house, two entry points</span>
      <span class="stat__value">${money(c.totalAdvantage)}<span class="stat__unit">/month cheaper for them</span></span>
      <span class="stat__note">
        They paid ${money(c.priceThen)} in ${year}${refiNote}.
        You'd pay ${money(c.yourPayment.total)}/mo for principal, interest and tax. They pay ${money(c.theirPayment.total)}.
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
        The house cost ${money(c.equityGained)} less, and they've spent ${c.yearsHeld.toFixed(0)} years paying it down.
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
    `A second income moves this more than anything you can control. Most buyers have one: 61% are married couples.`,
    `Prop 13 is why the gap is permanent. Their assessed value can rise at most 2% a year whatever the house is worth; yours resets to what you pay, the day you pay it.`,
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
 * The history follows the county now, so this explains RESOLUTION rather than
 * apologising: quarterly for a county inside a metro, annual for a rural one,
 * and where the chained index has its seam.
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
      <h4>What the same house cost <span class="chart-sub">shaded: every decline over 10% on record</span></h4>
      ${renderChart({
        points: pricePoints,
        color: SERIES_PRICE,
        format: compact,
        bands,
        markers: [
          // The peak is whatever this county's worst decline started from. It is
          // 1981 in some counties and 2006 in others, so it cannot be labelled
          // "2006 peak".
          { month: worst.peakMonth, label: `${worst.peakMonth.slice(0, 4)} peak` },
          { month: worst.troughMonth, label: `${worst.depthPercent.toFixed(0)}%` },
        ],
        // NOT "scaled to today's dollars". buildSeries applies no CPI term, so
        // this is nominal: the dollars of each year, indexed to a typical home
        // today. Claiming real dollars overstated the rise about threefold to a
        // screen-reader user, in the one description a sighted reader cannot see.
        description: `${ctx.place} home prices from ${longMonth(series[0]!.month)} to ${longMonth(series[series.length - 1]!.month)}, in the dollars of each year, indexed to a ${money(anchorPrice)} home today.`,
      })}
    </div>
    <div class="chart-block">
      <h4>What it cost you per month <span class="chart-sub">20% down, 30-year fixed, at that month's rate</span></h4>
      ${renderChart({
        points: paymentPoints,
        color: SERIES_PAYMENT,
        format: moneyAxis,
        bands,
        // Both of these used to be hardcoded months. A quarterly series has no
        // 2021-08 and an annual one has no 2023-10, so they marked nothing; and
        // "worst ever" was asserted rather than found.
        markers: [
          { month: ctx.extremes.cheapest.month, label: `cheapest to own` },
          { month: ctx.extremes.priciest.month, label: `dearest to own` },
        ],
        description: `Monthly principal and interest on the same ${ctx.place} home, at each month's rate.`,
      })}
    </div>
    <div class="stats">
      <div class="stat">
        <span class="stat__label">Declines over 10% on record</span>
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
              ? `, and ${(worst.monthsUnderwater / 12).toFixed(1)} years back to even if you bought the peak`
              : ""
          }.
        </span>
      </div>
      <div class="stat ${status.consecutiveDeclines >= 3 ? "stat--pass" : ""}">
        <span class="stat__label">Right now</span>
        <span class="stat__value">${status.percentOffRecentPeak.toFixed(1)}%<span class="stat__unit"> off peak</span></span>
        <span class="stat__note">
          ${
            status.consecutiveDeclines === 0
              ? `No consecutive ${status.periodLabel} declines`
              : `${status.consecutiveDeclines} consecutive ${status.periodLabel} ${status.consecutiveDeclines === 1 ? "decline" : "declines"}`
          }
          through ${longMonth(status.month)}.
          ${
            status.percentOffRecentPeak > -1
              ? `Nothing is falling here yet.`
              : `Real, but small.`
          }
          The ${worst.peakMonth.slice(0, 4)} crash fell ${Math.abs(worst.depthPercent).toFixed(0)}%.
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


/**
 * Move the three sliders onto an assumption set, widening them first.
 *
 * Butte's twenty-year appreciation is -1.4% and its last decade is 0.7%. A
 * slider that floors at 0 silently clamps both, which is the same class of bug
 * as the earlier 14.7%/12% clamp: the number the panel computes and the number
 * it uses stop being the same number, with nothing on screen to say so.
 */
function applyAssumptionSet(set: { id: string; homeAppreciation: number; investmentReturn: number; rentGrowth: number; basis: string }): void {
  const put = (id: string, value: number) => {
    const el = $<HTMLInputElement>(id);
    const scaled = Math.round(value * 1000);
    if (scaled < Number(el.min)) el.min = String(scaled);
    if (scaled > Number(el.max)) el.max = String(scaled);
    el.value = String(scaled);
  };
  put("appreciation", set.homeAppreciation);
  put("investReturn", set.investmentReturn);
  put("rentGrowth", set.rentGrowth);
  for (const b of document.querySelectorAll(".preset[data-assumptions]")) {
    b.classList.toggle("preset--on", (b as HTMLElement).dataset["assumptions"] === set.id);
  }
  $("assumptionBasis").textContent = set.basis;
}

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

  const r = compareRentVsBuy(bridge.itemised);

  const priceToRent = rent > 0 ? input.purchasePrice / (rent * 12) : Infinity;
  const ratioVerdict =
    priceToRent < 15
      ? { label: "buying territory", cls: "stat--pass", favours: "buy" }
      : priceToRent < 20
        ? { label: "genuinely a toss-up", cls: "", favours: "either" }
        : { label: "renting territory", cls: "stat--fail", favours: "rent" };

  // The heuristic and the model can disagree, and the page used to print both
  // verdicts inches apart without acknowledging it: "renting territory" beside
  // a chart saying buying wins in year six. Say which one to believe.
  //
  // "Ahead AT the hold year", not "crossed by then": owning can lead in a middle
  // window and trail at the endpoint, so the first crossing is the wrong test.
  const readerHoldYears = Number($<HTMLInputElement>("holdYears").value);
  const modelSaysBuy = buyMinusRentAt(r, readerHoldYears) >= 0;
  const disagrees =
    (ratioVerdict.favours === "rent" && modelSaysBuy) || (ratioVerdict.favours === "buy" && !modelSaysBuy);

  $("rentRatio").innerHTML = `
    <div class="stat stat--wide ${disagrees ? "" : ratioVerdict.cls}">
      <span class="stat__label">Price to rent</span>
      <span class="stat__value">${Number.isFinite(priceToRent) ? priceToRent.toFixed(1) + "x" : "n/a"}<span class="stat__unit"> ${ratioVerdict.label}</span></span>
      <span class="stat__note">
        The purchase price divided by a year of your rent. Under 15 favours buying, over 20 favours renting. Yours:
        ${money(input.purchasePrice)} against ${money(rent)}/month.
        ${
          disagrees
            ? `That is a rule of thumb, and it disagrees with the full comparison below, which ${
                modelSaysBuy
                  ? `has buying ahead at year ${readerHoldYears}`
                  : `has renting ahead at year ${readerHoldYears}`
              }. Believe the itemised one: the ratio ignores your rate, deposit, mortgage insurance and tax relief.`
            : `The full comparison below agrees, and it counts the rate, the deposit and the tax relief.`
        }
      </span>
    </div>`;

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
      <span class="stat__note">All of it. The honest comparison: ${money(Math.abs(f.burnedMoreThanRent))} ${f.burnedMoreThanRent > 0 ? "less" : "more"} than owning burns.</span>
    </div>
    <div class="stat stat--pass">
      <span class="stat__label">Owning, actual saving</span>
      <span class="stat__value">${money(f.principalPaid)}</span>
      <span class="stat__note">The principal portion in year one. The only part of a mortgage payment that is not spent.</span>
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
    // Mark the START of owning's lead and, when it closes, the year renting
    // reclaims it. A single "buying wins, year 6" marker hid that owning gives
    // the lead back at year 14.
    markers: [
      ...(r.buyWindow.start
        ? [{ seriesKey: "buy", month: `${2026 + r.buyWindow.start}-01`, label: `buying pulls ahead, year ${r.buyWindow.start}` }]
        : []),
      ...(r.buyWindow.end
        ? [{ seriesKey: "rent", month: `${2026 + r.buyWindow.end}-01`, label: `renting back ahead, year ${r.buyWindow.end}` }]
        : []),
    ],
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
  // Colour by who is ahead AT the reader's own horizon, not whether owning ever
  // crossed by then. A house whose lead closes at year 14 is not a win for a
  // 30-year hold, even though it broke even at year 6.
  const readerHold = Number($<HTMLInputElement>("holdYears").value);
  $("rentBuyVerdict").className = `verdict ${buyMinusRentAt(r, readerHold) >= 0 ? "verdict--yes" : "verdict--no"}`;
  $("rentBuyCaveat").textContent = RENT_VS_BUY_CAVEAT;

  if ($("assumptionSets").dataset["county"] !== input.county) {
    $("assumptionSets").dataset["county"] = input.county;
    // The page used to open on 5.4% / 7.0% / 3.5%, which is long-run housing
    // paired with a conservative equity number and matches no named set. That is
    // precisely the mismatched-period rigging the paragraph above warns about,
    // in the default state, so it opens on a named set instead.
    const sets = assumptionSets(input.county);
    const opening = sets[0]!;
    $("assumptionSets").innerHTML = sets.map(
      (a) =>
        `<button type="button" class="preset${a.id === opening.id ? " preset--on" : ""}" data-assumptions="${a.id}">${a.label}</button>`
    ).join("");
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-assumptions]")) {
      button.addEventListener("click", () => {
        const set = assumptionSets(readInput().county).find((a) => a.id === button.dataset["assumptions"])!;
        applyAssumptionSet(set);
        renderRentVsBuy(readInput());
      });
    }
    // Changing the county used to relabel these buttons and rewrite the basis
    // text, and leave the three sliders exactly where they were. San Diego's
    // 6.5% then sat under a button reading "Long run" for a Butte reader whose
    // long run is 3.3%.
    applyAssumptionSet(opening);
    renderRentVsBuy(input);
    return;
  }

  // --- how long would you have to stay? ---
  const holdYears = Number($<HTMLInputElement>("holdYears").value);
  $("holdYearsOut").textContent = `${holdYears} year${holdYears === 1 ? "" : "s"}`;

  const maxPrice = maxPriceForHoldPeriod(sweepBase, scaling, holdYears, downPercent, closingCostRate);
  // The same comparison the panel above ran. It used to be a second, separately
  // written call, which is exactly how the two drifted apart.
  const thisHouse = r;
  // Ahead AT the hold year, not "crossed by then". The window can close before
  // the reader's horizon.
  const worksForYou = buyMinusRentAt(thisHouse, holdYears) >= 0;
  const win = thisHouse.buyWindow;
  const windowLabel = win.start === null ? "never" : win.end === null ? `${win.start}+ yr` : `${win.start}–${win.end - 1} yr`;

  $("holdVerdict").innerHTML = `
    <div class="stat ${maxPrice ? "stat--pass" : "stat--fail"}">
      <span class="stat__label">Staying ${holdYears} years, pay at most</span>
      <span class="stat__value">${maxPrice ? money(maxPrice) : "nothing"}</span>
      <span class="stat__note">${
        maxPrice
          ? `A price-to-rent of ${(maxPrice / (rent * 12)).toFixed(1)}x. Above that, renting wins at your horizon.`
          : "At this rent and these assumptions, no price is ahead at your horizon."
      }</span>
    </div>
    <div class="stat ${worksForYou ? "stat--pass" : "stat--fail"}">
      <span class="stat__label">This house at ${money(input.purchasePrice)}</span>
      <span class="stat__value">${windowLabel}</span>
      <span class="stat__note">${
        win.start === null
          ? "Never catches up within 30 years at this price and rent."
          : win.end === null
            ? worksForYou
              ? `Owning leads from year ${win.start} on, and you plan to stay ${holdYears}. Selling earlier loses money against renting.`
              : `Owning does not pull ahead until year ${win.start}, longer than you plan to stay.`
            : worksForYou
              ? `Owning leads only between year ${win.start} and year ${win.end - 1}. You are inside that, but sell before year ${win.end} or renting pulls back ahead.`
              : `Owning leads only between year ${win.start} and year ${win.end - 1}, and your ${holdYears}-year hold is outside that window.`
      }</span>
    </div>
    <div class="stat">
      <span class="stat__label">Rate is the biggest lever</span>
      <span class="stat__value">${money(maxPriceForHoldPeriod({ ...sweepBase, interestRate: 0.045 }, scaling, holdYears, downPercent, closingCostRate) ?? 0)}</span>
      <span class="stat__note">What you could pay at 4.5% instead of ${pct(input.interestRate)}, same horizon.</span>
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
  const RATE_STEP = 0.005;
  const sensitivity = rateSensitivity(sweepBase, scaling, holdYears, downPercent, closingCostRate, RATE_STEP);

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
    `${at45 && ceilingHere ? money(at45 - ceilingHere) : "considerably more"}. Rates are the only input here you can change after you buy.`;

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

  // The actual answer to the question the panel asks, rendered ABOVE all of
  // this rather than under it. It combines the two hard gates (will a lender
  // lend, is the cash there) with this rent-versus-buy result, because a reader
  // asking "should I buy it" is asking about all three and only the third is
  // assumption-heavy.
  const rec = recommend(
    input,
    result,
    decision,
    holdYears,
    {
      currentSavings: num("currentSavings", 0),
      monthlySavings: num("monthlySavings", 0),
      savingsReturn: num("investReturn", 100) / 1000,
      currentRent: rent,
      rentGrowth,
    },
    appreciation
  );

  const ANSWER_CLASS: Record<typeof rec.answer, string> = {
    yes: "recommendation--yes",
    conditional: "recommendation--maybe",
    "not-yet": "recommendation--maybe",
    no: "recommendation--no",
  };
  const ANSWER_WORD: Record<typeof rec.answer, string> = {
    yes: "Yes",
    conditional: "Only if",
    "not-yet": "Not yet",
    no: "No",
  };

  $("recommendation").className = `recommendation ${ANSWER_CLASS[rec.answer]}`;
  $("recommendation").innerHTML = `
    <p class="recommendation__answer">
      <span class="recommendation__word">${ANSWER_WORD[rec.answer]}</span>
      ${rec.headline}
    </p>
    <ul class="recommendation__because">
      ${rec.because.map((b) => `<li>${b}</li>`).join("")}
    </ul>
    ${
      rec.conditions.length
        ? `<div class="recommendation__conditions">
             <h4>What would change it</h4>
             <ul>${rec.conditions.map((c) => `<li>${c}</li>`).join("")}</ul>
           </div>`
        : ""
    }
    <details class="recommendation__caveats">
      <summary>What this answer cannot see</summary>
      <ul>${rec.caveats.map((c) => `<li>${c}</li>`).join("")}</ul>
    </details>`;

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
    `sitting tenants see far less.`;
  // Both conditions matter and both were once dropped: a single-family home is
  // only exempt if it is NOT corporate-owned AND the lease gave the required
  // notice. Load-bearing, so it is demoted behind the expandable, not cut.
  $("rentCapExemptions").textContent =
    `The exemptions are broad but conditional. A single-family home or condo is exempt only if it is not owned by ` +
    `a corporation or REIT AND the lease carries the statutory exemption notice. New construction is exempt for ` +
    `its first 15 years, a rolling window, not a fixed build date.`;

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
  // Over four decades a nominal chart is dominated by inflation, which makes both
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
        label: `What a median CALIFORNIA income could buy${unit}`,
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
      `What one ${historyFor(county).place} house cost from ${longMonth(series[0]!.month)} to ` +
      `${longMonth(series[series.length - 1]!.month)}, against what a median California household could afford.`,
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
          label: "A median CA income buys",
          color: SERIES_PAYMENT,
          points: series.map((p) => ({ month: p.month, value: p.affordablePrice })),
        },
      ],
      money,
      (m) => `${MONTH_NAMES[Number(m.split("-")[1])]} ${m.split("-")[0]}`
    );
  }

  $("buyingPowerHeadline").textContent = v.headline;
  // Colour from the data, not baked into the template. In 34 counties buying
  // power went UP, and a hardcoded verdict--no painted every one of those
  // "120% MORE" headlines with the red failure border, always in the direction
  // of the thesis.
  $("buyingPowerHeadline").className = `verdict ${v.powerLost > 0 ? "verdict--no" : "verdict--yes"}`;

  // In 34 counties a median statewide income still clears the local price, so
  // the last affordable month is the current one. "The last month the math
  // worked: March 2026" reads as an obituary for something that is still alive.
  const stillWorks = v.lastAffordableMonth === v.latest.month;

  $("buyingPower").innerHTML = `
    <div class="stat stat--wide">
      <span class="stat__label">${stillWorks ? "The math still works here" : "The last month the math worked"}</span>
      <span class="stat__value">${
        stillWorks ? "today" : v.lastAffordableMonth ? longMonth(v.lastAffordableMonth) : "never"
      }</span>
      <span class="stat__note">${v.blueberries}</span>
    </div>
    <div class="stat">
      <span class="stat__label">Years of income per home</span>
      <span class="stat__value">${v.latest.yearsOfIncome.toFixed(1)}<span class="stat__unit"> today</span></span>
      <span class="stat__note">It was ${v.first.yearsOfIncome.toFixed(1)} in ${v.first.month.slice(0, 4)}.</span>
    </div>
    <div class="stat">
      <span class="stat__label">Buying power ${v.powerLost > 0 ? "lost" : "gained"}</span>
      <span class="stat__value">${(Math.abs(v.powerLost) * 100).toFixed(0)}%</span>
      <span class="stat__note">Since ${v.first.month.slice(0, 4)}, holding the effort fixed at 30% of income.</span>
    </div>
    <div class="stat">
      <span class="stat__label">Best it ever got</span>
      <span class="stat__value">${v.best.purchasingRatio.toFixed(2)}x<span class="stat__unit"> in ${longMonth(v.best.month)}</span></span>
      <span class="stat__note">Worst was ${v.worst.purchasingRatio.toFixed(2)}x in ${longMonth(v.worst.month)}. Today: ${v.latest.purchasingRatio.toFixed(2)}x.</span>
    </div>`;

  $("buyingPowerCaveat").textContent = buyingPowerCaveat(county);
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
        A typical single-family home here is ${money(here.homeValue)}. The people who live and work here
        earn a median of ${money(here.income)}. That makes it the ${rank}${ordinal(rank)} least affordable of the 58
        counties, measured against local pay.
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

  const { readings, summary, caveats, peakMonth, troughMonth } = crashSignals(county);
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
          <span><em>${peakMonth.slice(0, 4)} peak</em> ${fmt(r.at2006Peak, r.unit)}</span>
          <span><em>${troughMonth.slice(0, 4)} bottom</em> ${fmt(r.at2009Trough, r.unit)}</span>
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
      Trained ${MODEL_META.trained} on ${MODEL_META.observations.toLocaleString("en-US")} metro-quarters across
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
          Same model, judged on 2004-2006, said ${(r.classifier.preCrashProbability * 100).toFixed(0)}% right before
          ${(r.classifier.preCrashActual * 100).toFixed(0)}% of those windows went on to fall 10% or more.
          FHFA San Diego metro, not your county.
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

let presetCounty: CaCounty | null = null;

function applyPreset(id: string, county: CaCounty): void {
  const preset = crashPresets(county).find((p) => p.id === id);
  if (!preset) return;
  // Widen the sliders to reach the preset before setting them. Merced's worst
  // decline is 65.7% and the depth slider stopped at 50, so the preset button
  // and the slider under it disagreed by sixteen points.
  const depth = $<HTMLInputElement>("crashDepth");
  const months = $<HTMLInputElement>("crashMonths");
  const rate = $<HTMLInputElement>("crashRate");
  depth.max = String(Math.max(Number(depth.max), preset.depthPercent));
  months.max = String(Math.max(Number(months.max), preset.monthsToBottom));
  rate.max = String(Math.max(Number(rate.max), Math.round(preset.rateAtBottom * 10000)));
  rate.min = String(Math.min(Number(rate.min), Math.round(preset.rateAtBottom * 10000)));

  depth.value = String(preset.depthPercent);
  months.value = String(preset.monthsToBottom);
  rate.value = String(Math.round(preset.rateAtBottom * 10000));
  $("presetBasis").textContent = preset.basis;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
    b.classList.toggle("preset--on", b.dataset["preset"] === id);
  }
  renderWaiting(readInput());
}

function renderPresets(county: CaCounty): void {
  // Rebuild whenever the county changes: the labels, the depths and the basis
  // are all that county's own record.
  if (presetCounty === county) return;
  presetCounty = county;

  const presets = crashPresets(county);
  $("presets").innerHTML = presets
    .map((p) => `<button type="button" class="preset" data-preset="${p.id}">${p.label}</button>`)
    .join("");

  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
    b.addEventListener("click", () => applyPreset(b.dataset["preset"]!, county));
  }
  applyPreset(presets[0]!.id, county);
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
            ? `That ${money(r.rentPaidWhileWaiting)} of rent takes ${
                r.breakevenMonths >= 24
                  ? `${(r.breakevenMonths / 12).toFixed(1)} years`
                  : `${Math.round(r.breakevenMonths)} months`
              } of the saving to earn back.`
            : `And you'd still have paid ${money(r.rentPaidWhileWaiting)} in rent to get there.`
        }
      </span>
    </div>
    <div class="stat">
      <span class="stat__label">Prop 13, permanently</span>
      <span class="stat__value">${money(r.propTaxSavingAnnual)}<span class="stat__unit">/year</span></span>
      <span class="stat__note">
        A lower purchase price locks a lower assessed value for as long as you own it. The part of waiting
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

  // The cost of waiting over time: it falls while you burn rent, then climbs
  // once the lower payment starts paying you back, crossing zero at exactly the
  // break-even the card above quotes. Built from the same scalars, so it can't
  // disagree with the numbers beside it.
  const path = waitingPath(r, months);
  const points = path.map((p) => ({ month: String(p.month), value: p.value }));
  const end = path[path.length - 1]!.month;
  // Space the year ticks so a 23-year chart is not labelled every 12 months.
  const stepMonths = end > 180 ? 60 : end > 84 ? 24 : 12;
  const xTicks: Array<{ index: number; label: string }> = [];
  for (let m = 0; m <= end; m += stepMonths) xTicks.push({ index: m, label: m === 0 ? "now" : `${m / 12}yr` });
  const crossing = r.breakevenMonths !== null ? Math.round(months + r.breakevenMonths) : null;

  $("waitingChart").innerHTML = renderMultiLine({
    series: [{ key: "wait", label: "Cash position vs buying now", color: SERIES_PAYMENT, points }],
    format: (n) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${Math.round(n)}`),
    xTicks,
    markers: [
      { seriesKey: "wait", month: String(Math.round(months)), label: "you buy at the bottom" },
      ...(crossing !== null && crossing <= end
        ? [{ seriesKey: "wait", month: String(crossing), label: "waiting has paid off" }]
        : []),
    ],
    description:
      `The running cash position of waiting versus buying now, month by month. It drops while you pay rent, then ` +
      `climbs after you buy at the bottom` +
      (crossing !== null ? `, breaking even ${crossing} months from now.` : `, but never catches up on these numbers.`),
    height: 200,
  });

  const wf = $("waitingChart").querySelector<HTMLElement>("[data-multi]");
  if (wf) {
    attachMultiHover(
      wf,
      [{ key: "wait", label: "Ahead of buying now", color: SERIES_PAYMENT, points }],
      money,
      (m) => `${m} months from now`
    );
  }

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
  // This script ships on every page but only the calculator has a form to wire.
  // On a static page (the methodology page) there is nothing to do, and reaching
  // for #county would throw. Bail before that.
  if (!document.getElementById("scenario")) return;

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

  // The page used to ask for rent twice and default the two to different numbers
  // ($2,750 on the form, $3,290 here), and the higher one drove the waiting
  // verdict, which made waiting look worse than the reader's own figure implies.
  // Mirror the form's rent until they deliberately change this one.
  $<HTMLInputElement>("waitRent").addEventListener("input", () => {
    $<HTMLInputElement>("waitRent").dataset["touched"] = "1";
  });
  $<HTMLInputElement>("currentRent").addEventListener("input", () => {
    if ($<HTMLInputElement>("waitRent").dataset["touched"] !== "1") {
      $<HTMLInputElement>("waitRent").value = $<HTMLInputElement>("currentRent").value;
      renderWaiting(readInput());
    }
  });
  $<HTMLInputElement>("waitRent").value = $<HTMLInputElement>("currentRent").value;

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

  // A shared URL fills the form before the first render. If it set the rate,
  // mark it touched so the live feed does not overwrite the shared value.
  const fromLink = applyScenarioFromUrl();
  if (fromLink && new URLSearchParams(location.search).has("rate")) {
    $<HTMLInputElement>("interestRate").dataset["touched"] = "1";
  }

  const form = $<HTMLFormElement>("scenario");
  let urlTimer = 0;
  form.addEventListener("input", (e) => {
    if ((e.target as HTMLElement).id === "interestRate") {
      $<HTMLInputElement>("interestRate").dataset["touched"] = "1";
    }
    render();
    // Reflect the scenario into the URL, debounced so typing does not thrash it.
    clearTimeout(urlTimer);
    urlTimer = window.setTimeout(writeScenarioToUrl, 250);
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  // Copy the current scenario's link. The URL is already live, so this just
  // writes it fresh and hands it to the clipboard.
  const copyBtn = document.getElementById("copyLink");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      writeScenarioToUrl();
      try {
        await navigator.clipboard.writeText(location.href);
        const original = copyBtn.textContent;
        copyBtn.textContent = "Copied";
        window.setTimeout(() => (copyBtn.textContent = original), 1600);
      } catch {
        // Clipboard denied (rare): select the address bar as the fallback.
        copyBtn.textContent = "Copy the URL from your address bar";
      }
    });
  }

  const pdfBtn = document.getElementById("savePdf");
  if (pdfBtn) {
    // The report layout lives in the print stylesheet; the browser's own
    // print-to-PDF renders it. Nothing is generated server-side or fetched.
    pdfBtn.addEventListener("click", () => window.print());
  }

  // The caveats under the recommendation are load-bearing, so they must print.
  // A closed <details> cannot be forced open by CSS, so open them for print and
  // restore the reader's state afterward.
  const printDetails = () => document.querySelectorAll<HTMLDetailsElement>(".recommendation__caveats");
  let reopen: HTMLDetailsElement[] = [];
  window.addEventListener("beforeprint", () => {
    reopen = [];
    printDetails().forEach((d) => {
      if (!d.open) {
        d.open = true;
        reopen.push(d);
      }
    });
  });
  window.addEventListener("afterprint", () => {
    reopen.forEach((d) => (d.open = false));
    reopen = [];
  });

  render();
  void loadRate();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
