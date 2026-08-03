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
import { crashSignals, leadingIndicators, worstTimeToBuy } from "../../lib/signals.ts";
import { MODEL_META, horizonReports, learnedWeights, verdict } from "../../lib/forecast.ts";
import { INSTRUMENTS, WATCHLIST_DISCIPLINE, WATCHLIST_PREAMBLE } from "../../lib/instruments.ts";
import { BUYING_POWER_CAVEAT, buyingPowerSeries, buyingPowerVerdict } from "../../lib/buying-power.ts";
import {
  RENT_VS_BUY_CAVEAT,
  breakevenByPrice,
  compareRentVsBuy,
  maxPriceForHoldPeriod,
  savingsRace,
  statutoryRentCap,
} from "../../lib/rent-vs-buy.ts";
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
    downPayment: { kind: "percent", value: num("downPaymentPercent", 20) / 100 },
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
       <span>Lender total <em>&mdash; what a mortgage calculator shows you</em></span>
       <strong>${money(result.lenderMonthlyTotal)}/mo</strong>
     </div>` +
    extraLines.map((l) => renderLine(l, true)).join("") +
    `<div class="total">
       <span>True monthly cost <em>&mdash; what actually leaves your account</em></span>
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
  renderBuyingPower(input.purchasePrice);
  renderCohort(input);
  renderHistory(input.purchasePrice);
  renderSignals(input.purchasePrice);
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

const COHORT_SERIES = [
  { key: "rate", label: "Their interest rate", color: "#3987e5" },
  { key: "size", label: "Owing less", color: "#d95926" },
  { key: "prop13", label: "Prop 13", color: "#199e70" },
];

const COHORT_FIRST_YEAR = 1990;

function renderCohort(input: ScenarioInput): void {
  const year = Number($<HTMLInputElement>("cohortYear").value);
  $("cohortYearOut").textContent = String(year);

  const shared = {
    currentPrice: input.purchasePrice,
    currentRate: input.interestRate,
    downPercent: 0.2,
    propertyTaxRate: input.propertyTaxRate ?? 0.0115,
  };

  const lastYear = Number(BEST_REFI.month.slice(0, 4)) + 4;
  const years: number[] = [];
  for (let y = COHORT_FIRST_YEAR; y <= lastYear; y++) years.push(y);

  const columns: StackColumn[] = [];
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
        rate: Math.max(c.rateAdvantage, 0),
        size: Math.max(c.priceAdvantage, 0),
        prop13: Math.max(c.prop13Advantage, 0),
      },
    });
  }

  $("cohortChart").innerHTML = renderStackedColumns({
    columns,
    series: COHORT_SERIES,
    format: (n) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`),
    description:
      "Monthly cost advantage held by earlier buyers of the same house, by purchase year, split into interest rate, loan size, and Prop 13.",
  });

  const fig = $("cohortChart").querySelector<HTMLElement>("[data-stack]");
  if (fig) {
    attachStackHover(fig, columns, COHORT_SERIES, money, (i) => {
      $<HTMLInputElement>("cohortYear").value = String(years[i]);
      renderCohort(readInput());
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
    ? ` and refinanced their remaining balance to ${pct(c.effectiveRate)} in ${c.refinancedMonth}. The cheapest month on record`
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

let historyRendered = false;

function renderHistory(anchorPrice: number): void {
  if (historyRendered) return;
  historyRendered = true;

  const series = buildSeries(anchorPrice, 0.2);
  const drops = findDrawdowns(10);
  const status = currentStatus();
  const ctx = historicalContext();

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
          through ${status.month}. Real, but small. The 2006 crash fell ${Math.abs(worst.depthPercent).toFixed(0)}%.
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

const CARRYING_KEYS = ["propertyTax", "homeownersInsurance", "mortgageInsurance", "hoa", "melloRoos"];

function renderRentVsBuy(input: ScenarioInput): void {
  const result = evaluateScenario(input);
  const carrying = result.lines.filter((l) => CARRYING_KEYS.includes(l.key)).reduce((sum, l) => sum + l.monthly, 0);
  const maintenance = result.lines.find((l) => l.key === "maintenanceReserve")?.monthly ?? 0;

  const rent = num("currentRent", 2750);
  const appreciation = Number($<HTMLInputElement>("appreciation").value) / 1000;
  const investReturn = Number($<HTMLInputElement>("investReturn").value) / 1000;
  const rentGrowth = Number($<HTMLInputElement>("rentGrowth").value) / 1000;

  $("appreciationOut").textContent = pct(appreciation, 1);
  $("investReturnOut").textContent = pct(investReturn, 1);
  $("rentGrowthOut").textContent = pct(rentGrowth, 1);

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

  const r = compareRentVsBuy({
    purchasePrice: input.purchasePrice,
    downPaymentAmount: result.loan.downPaymentAmount,
    closingCosts: Math.max(result.cashToClose.total - result.loan.downPaymentAmount, 0),
    loanAmount: result.loan.totalLoanAmount,
    interestRate: input.interestRate,
    termYears: input.termYears,
    monthlyCarryingCosts: carrying,
    monthlyMaintenance: maintenance,
    monthlyRent: rent,
    homeAppreciation: appreciation,
    rentGrowth,
    investmentReturn: investReturn,
    propertyTaxGrowth: 0.02,
    sellingCostRate: 0.06,
  });

  const f = r.firstYear;
  $("burnCompare").innerHTML = `
    <div class="stat stat--fail">
      <span class="stat__label">Owning, money that buys nothing</span>
      <span class="stat__value">${money(f.burned)}</span>
      <span class="stat__note">${money(f.interestPaid)} interest, ${money(f.carryingAndMaintenance)} tax, insurance and upkeep. None of it is equity.</span>
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

  // --- how long would you have to stay? ---
  const holdYears = Number($<HTMLInputElement>("holdYears").value);
  $("holdYearsOut").textContent = `${holdYears} year${holdYears === 1 ? "" : "s"}`;

  const downPercent = input.downPayment.kind === "percent" ? input.downPayment.value : 0.2;
  const sweepBase = {
    interestRate: input.interestRate,
    termYears: input.termYears,
    monthlyRent: rent,
    homeAppreciation: appreciation,
    rentGrowth,
    investmentReturn: investReturn,
    propertyTaxGrowth: 0.02,
    sellingCostRate: 0.06,
  };
  // Costs that scale with price have to be recomputed per price, or a cheap
  // house gets charged an expensive house's taxes.
  const scaling = {
    carryingRate: input.propertyTaxRate ?? 0.0115,
    maintenanceRate: input.maintenanceRate ?? 0.01,
    fixedMonthly: (input.insuranceAnnual ?? 2000) / 12 + input.hoaMonthly + input.melloRoosAnnual / 12,
  };

  const maxPrice = maxPriceForHoldPeriod(sweepBase, scaling, holdYears, Math.max(downPercent, 0.05));
  const thisHouse = compareRentVsBuy({
    purchasePrice: input.purchasePrice,
    downPaymentAmount: result.loan.downPaymentAmount,
    closingCosts: Math.max(result.cashToClose.total - result.loan.downPaymentAmount, 0),
    loanAmount: result.loan.totalLoanAmount,
    interestRate: input.interestRate,
    termYears: input.termYears,
    monthlyCarryingCosts: carrying,
    monthlyMaintenance: maintenance,
    monthlyRent: rent,
    homeAppreciation: appreciation,
    rentGrowth,
    investmentReturn: investReturn,
    propertyTaxGrowth: 0.02,
    sellingCostRate: 0.06,
  });
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
      <span class="stat__value">${money(maxPriceForHoldPeriod({ ...sweepBase, interestRate: 0.045 }, scaling, holdYears, Math.max(downPercent, 0.05)) ?? 0)}</span>
      <span class="stat__note">What you could pay at 4.5% instead of ${pct(input.interestRate)}, same horizon. Rates move your budget more than anything else here.</span>
    </div>`;

  const prices: number[] = [];
  for (let p = 300_000; p <= 1_600_000; p += 50_000) prices.push(p);
  const curve = breakevenByPrice(sweepBase, scaling, prices, Math.max(downPercent, 0.05));
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

  $("rentCapNote").textContent =
    `Where the blue line sits below the orange one, buying wins over your horizon. California caps annual rent ` +
    `increases at ${pct(statutoryRentCap(), 1)} for San Diego under AB 1482 (5% plus regional CPI, never above 10%), ` +
    `but that is a ceiling, not a forecast: most sitting tenants see far less, and single-family homes, condos not ` +
    `owned by a corporation, and anything built in the last 15 years are exempt entirely.`;

  // --- the savings treadmill ---
  const race = savingsRace({
    targetPrice: input.purchasePrice,
    downPaymentPercent: input.downPayment.kind === "percent" ? input.downPayment.value : 0.2,
    closingCostRate: 0.025,
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

let buyingPowerRendered = false;

function renderBuyingPower(anchorPrice: number): void {
  if (buyingPowerRendered) return;
  buyingPowerRendered = true;

  const series = buyingPowerSeries(anchorPrice);
  const v = buyingPowerVerdict(anchorPrice);
  const compact = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`);

  $("buyingPowerChart").innerHTML = renderMultiLine({
    series: [
      {
        key: "price",
        label: "What the median home cost",
        color: SERIES_PRICE,
        points: series.map((p) => ({ month: p.month, value: p.medianPrice })),
      },
      {
        key: "afford",
        label: "What a median income could buy",
        color: SERIES_PAYMENT,
        points: series.map((p) => ({ month: p.month, value: p.affordablePrice })),
      },
    ],
    format: compact,
    shadeGap: true,
    markers: v.lastAffordableMonth
      ? [{ seriesKey: "price", month: v.lastAffordableMonth, label: "last month it worked" }]
      : [],
    description: "Median San Diego home price against what a median California household could afford, 1987 to today.",
  });

  const bpFig = $("buyingPowerChart").querySelector<HTMLElement>("[data-multi]");
  if (bpFig) {
    attachMultiHover(
      bpFig,
      [
        {
          key: "price",
          label: "Median home",
          color: SERIES_PRICE,
          points: series.map((p) => ({ month: p.month, value: p.medianPrice })),
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
      <span class="stat__value">${v.lastAffordableMonth ?? "never"}</span>
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
      <span class="stat__value">${v.best.purchasingRatio.toFixed(2)}x<span class="stat__unit"> in ${v.best.month}</span></span>
      <span class="stat__note">Worst was ${v.worst.purchasingRatio.toFixed(2)}x in ${v.worst.month}. Today: ${v.latest.purchasingRatio.toFixed(2)}x.</span>
    </div>`;

  $("buyingPowerCaveat").textContent = BUYING_POWER_CAVEAT;
}

let signalsRendered = false;

function renderSignals(anchorPrice: number): void {
  if (signalsRendered) return;
  signalsRendered = true;

  const verdict = worstTimeToBuy(anchorPrice);
  $("worstTime").textContent = verdict.answer;
  $("worstTime").className = `verdict ${verdict.rank === 1 ? "verdict--no" : "verdict--yes"}`;

  const { readings, summary, caveats } = crashSignals(anchorPrice);
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

  const inds = leadingIndicators(24, anchorPrice).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
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
        <span class="stat__label">${r.horizon}-month call &mdash; do not act on this</span>
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
    propertyTaxRate: input.propertyTaxRate ?? 0.0115,
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
  const countySelect = $<HTMLSelectElement>("county");
  countySelect.innerHTML = CA_COUNTIES.map(
    (c) => `<option value="${c}"${c === "San Diego" ? " selected" : ""}>${c}</option>`
  ).join("");

  for (const el of document.querySelectorAll<HTMLInputElement>("input.money")) {
    attachMoneyFormatting(el);
  }

  // The history panel's own controls re-render only the sections they affect.
  for (const id of ["appreciation", "investReturn", "rentGrowth", "holdYears"]) {
    $<HTMLInputElement>(id).addEventListener("input", () => renderRentVsBuy(readInput()));
  }

  for (const id of ["cohortYear", "crashDepth", "crashMonths", "crashRate", "waitRent", "waitSavings"]) {
    $<HTMLInputElement>(id).addEventListener("input", () => {
      const current = readInput();
      if (id === "cohortYear") {
        renderCohort(current);
      } else {
        // Moving a slider means you're no longer on a named historical scenario.
        for (const b of document.querySelectorAll(".preset")) b.classList.remove("preset--on");
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
