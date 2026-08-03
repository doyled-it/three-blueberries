import { evaluateScenario } from "../lib/mortgage.ts";
import { maxAffordablePrice } from "../lib/affordability.ts";
import type { ScenarioInput } from "../lib/types.ts";

const m = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

const base: ScenarioInput = {
  purchasePrice: 900_000,
  downPayment: { kind: "percent", value: 0.1 },
  loanType: "conventional",
  termYears: 30,
  interestRate: 0.0666,
  creditScore: 740,
  county: "San Diego",
  claimHomeownersExemption: true,
  hoaMonthly: 0,
  melloRoosAnnual: 0,
  household: { grossAnnualIncomes: [180_000, 95_000], monthlyDebts: 750, size: 2 },
};

function show(label: string, input: ScenarioInput) {
  const r = evaluateScenario(input);
  console.log("\n" + "=".repeat(78));
  console.log(label);
  console.log("=".repeat(78));
  console.log(
    `${m(input.purchasePrice)} | ${(r.loan.downPaymentPercent * 100).toFixed(1)}% down (${m(r.loan.downPaymentAmount)}) | ` +
      `loan ${m(r.loan.totalLoanAmount)} | LTV ${(r.loan.ltv * 100).toFixed(1)}%`
  );
  console.log("");
  for (const l of r.lines) {
    const tag = l.key === "maintenanceReserve" ? "  (not counted by lender)" : "";
    console.log(`  ${l.label.padEnd(36)} ${m(l.monthly).padStart(10)}/mo${tag}`);
  }
  console.log("  " + "-".repeat(60));
  console.log(`  ${"LENDER TOTAL (what a calculator shows)".padEnd(36)} ${m(r.lenderMonthlyTotal).padStart(10)}/mo`);
  console.log(`  ${"TRUE TOTAL (what you actually pay)".padEnd(36)} ${m(r.trueMonthlyTotal).padStart(10)}/mo`);
  console.log("");
  console.log(`  Cash to close: ${m(r.cashToClose.total)}`);
  console.log(
    `  Income needed: ${m(r.qualification.incomeRequiredAnnual)}/yr  |  you have ${m(
      input.household.grossAnnualIncomes.reduce((a, b) => a + b, 0)
    )}/yr  |  DTI ${(r.qualification.backEndDti * 100).toFixed(1)}% vs ${(r.qualification.dtiCeiling * 100).toFixed(0)}% ceiling  |  ${
      r.qualification.passesDti ? "PASSES" : "FAILS"
    }`
  );
  if (r.qualification.residualIncome) {
    const ri = r.qualification.residualIncome;
    console.log(
      `  VA residual: ${m(ri.available)} available vs ${m(ri.required)} required — ${ri.passes ? "PASSES" : "FAILS"}`
    );
  }
  console.log("");
  for (const w of r.warnings) console.log(`  ! ${w}\n`);
}

show("CONVENTIONAL — 10% down, 740 score, San Diego", base);

show("VA — 0% down, first use, no disability exemption", {
  ...base,
  loanType: "va",
  downPayment: { kind: "percent", value: 0 },
  va: { firstUse: true, disabilityExempt: false, financeFundingFee: true },
  squareFeet: 1650,
  household: { ...base.household, size: 3 },
});

show("FHA — 3.5% down, 680 score", {
  ...base,
  loanType: "fha",
  downPayment: { kind: "percent", value: 0.035 },
  creditScore: 680,
});

const afford = maxAffordablePrice(base);
console.log("\n" + "=".repeat(78));
console.log("AFFORDABILITY — what can this household actually buy?");
console.log("=".repeat(78));
console.log(`  Max purchase price: ${m(afford.maxPurchasePrice)}`);
console.log(`  Binding constraint: ${afford.bindingConstraint}`);
console.log(`  Cash required:      ${m(afford.cashRequired)}`);
console.log(
  `  Monthly at that price: ${m(afford.scenario.trueMonthlyTotal)} true / ${m(afford.scenario.lenderMonthlyTotal)} lender`
);
