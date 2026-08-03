import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateScenario } from "../lib/mortgage.ts";
import { CONFORMING_BASELINE, conformingLimitFor } from "../lib/data/ca-loan-limits.ts";
import type { ScenarioInput } from "../lib/types.ts";

/** A realistic San Diego baseline. Individual tests override what they care about. */
function scenario(overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    purchasePrice: 900_000,
    downPayment: { kind: "percent", value: 0.2 },
    loanType: "conventional",
    termYears: 30,
    interestRate: 0.0666,
    creditScore: 760,
    county: "San Diego",
    claimHomeownersExemption: true,
    hoaMonthly: 0,
    melloRoosAnnual: 0,
    household: { grossAnnualIncomes: [250_000], monthlyDebts: 600, size: 2 },
    ...overrides,
  };
}

const lineFor = (result: ReturnType<typeof evaluateScenario>, key: string) => result.lines.find((l) => l.key === key)!;

test("every line item carries a basis and at least a citation or user provenance", () => {
  const result = evaluateScenario(scenario());
  for (const line of result.lines) {
    assert.ok(line.basis.length > 0, `${line.key} has no basis`);
    assert.ok(
      line.sourceIds.length > 0 || line.confidence === "user",
      `${line.key} has neither a source nor user provenance`
    );
  }
});

test("the true monthly total exceeds the lender total by exactly the maintenance reserve", () => {
  const result = evaluateScenario(scenario());
  const maintenance = lineFor(result, "maintenanceReserve").monthly;
  assert.ok(maintenance > 0);
  assert.ok(Math.abs(result.trueMonthlyTotal - result.lenderMonthlyTotal - maintenance) < 0.01);
});

test("20% down on a conventional loan carries no mortgage insurance", () => {
  const result = evaluateScenario(scenario());
  assert.equal(
    result.lines.find((l) => l.key === "mortgageInsurance"),
    undefined
  );
});

test("PMI appears below 20% down and is priced worse for a lower credit score", () => {
  const strong = evaluateScenario(scenario({ downPayment: { kind: "percent", value: 0.05 }, creditScore: 780 }));
  const weak = evaluateScenario(scenario({ downPayment: { kind: "percent", value: 0.05 }, creditScore: 650 }));

  const strongPmi = lineFor(strong, "mortgageInsurance");
  const weakPmi = lineFor(weak, "mortgageInsurance");

  assert.ok(strongPmi.monthly > 0);
  assert.ok(weakPmi.monthly > strongPmi.monthly * 2, "a 650 score should cost multiples of a 780 score");
});

test("PMI terminates on schedule rather than running for the life of the loan", () => {
  const result = evaluateScenario(scenario({ downPayment: { kind: "percent", value: 0.1 } }));
  const pmi = lineFor(result, "mortgageInsurance");
  assert.match(pmi.basis, /terminates automatically at 78% LTV/);
});

test("property tax is assessed on the purchase price, not the seller's old basis", () => {
  // Without the flat exemption in the way, tax should scale exactly with price.
  const cheap = evaluateScenario(scenario({ purchasePrice: 600_000, claimHomeownersExemption: false }));
  const dear = evaluateScenario(scenario({ purchasePrice: 1_200_000, claimHomeownersExemption: false }));
  const ratio = lineFor(dear, "propertyTax").annual / lineFor(cheap, "propertyTax").annual;
  assert.ok(Math.abs(ratio - 2) < 1e-9, "doubling the price should exactly double the tax bill");
});

test("the exemption is a flat subtraction, so it helps a cheap house slightly more", () => {
  const cheap = evaluateScenario(scenario({ purchasePrice: 600_000 }));
  const dear = evaluateScenario(scenario({ purchasePrice: 1_200_000 }));
  const ratio = lineFor(dear, "propertyTax").annual / lineFor(cheap, "propertyTax").annual;
  // Slightly above 2: the $7,000 exemption is a larger share of the smaller bill.
  assert.ok(ratio > 2 && ratio < 2.02, `expected just over 2x, got ${ratio}`);
});

test("the homeowners' exemption reduces the tax bill by a small, real amount", () => {
  const withExemption = evaluateScenario(scenario({ claimHomeownersExemption: true }));
  const without = evaluateScenario(scenario({ claimHomeownersExemption: false }));
  const saved = lineFor(without, "propertyTax").annual - lineFor(withExemption, "propertyTax").annual;
  assert.ok(saved > 60 && saved < 120, `expected roughly $70-80/year, got ${saved}`);
});

test("every scenario warns about the supplemental tax bill", () => {
  const result = evaluateScenario(scenario());
  assert.ok(result.warnings.some((w) => /supplemental property tax/i.test(w)));
});

test("a zero Mello-Roos entry is flagged as unverified rather than treated as fact", () => {
  const result = evaluateScenario(scenario());
  assert.match(lineFor(result, "melloRoos").warning ?? "", /invisible on Zillow/i);
});

// --- VA --------------------------------------------------------------------

test("VA at zero down carries no monthly mortgage insurance", () => {
  const result = evaluateScenario(
    scenario({
      loanType: "va",
      downPayment: { kind: "percent", value: 0 },
      va: { firstUse: true, disabilityExempt: false, financeFundingFee: true },
    })
  );
  assert.equal(lineFor(result, "mortgageInsurance").monthly, 0);
});

test("the VA funding fee is financed into the balance at the first-use zero-down rate", () => {
  const result = evaluateScenario(
    scenario({
      loanType: "va",
      downPayment: { kind: "percent", value: 0 },
      va: { firstUse: true, disabilityExempt: false, financeFundingFee: true },
    })
  );
  // 2.15% of the base loan, rolled in.
  assert.ok(Math.abs(result.loan.financedUpfrontFee - 900_000 * 0.0215) < 1);
  assert.ok(Math.abs(result.loan.totalLoanAmount - 900_000 * 1.0215) < 1);
});

test("a disability rating waives the funding fee entirely", () => {
  const exempt = evaluateScenario(
    scenario({
      loanType: "va",
      downPayment: { kind: "percent", value: 0 },
      va: { firstUse: true, disabilityExempt: true, financeFundingFee: true },
    })
  );
  assert.equal(exempt.loan.financedUpfrontFee, 0);
  assert.equal(exempt.loan.totalLoanAmount, 900_000);
});

test("subsequent VA use at zero down costs materially more than first use", () => {
  const first = evaluateScenario(
    scenario({
      loanType: "va",
      downPayment: { kind: "percent", value: 0 },
      va: { firstUse: true, disabilityExempt: false, financeFundingFee: true },
    })
  );
  const again = evaluateScenario(
    scenario({
      loanType: "va",
      downPayment: { kind: "percent", value: 0 },
      va: { firstUse: false, disabilityExempt: false, financeFundingFee: true },
    })
  );
  assert.ok(again.loan.financedUpfrontFee > first.loan.financedUpfrontFee * 1.5);
});

test("VA scenarios run the residual income test", () => {
  const result = evaluateScenario(
    scenario({
      loanType: "va",
      downPayment: { kind: "percent", value: 0 },
      va: { firstUse: true, disabilityExempt: false, financeFundingFee: true },
      squareFeet: 1800,
    })
  );
  const residual = result.qualification.residualIncome;
  assert.ok(residual);
  // West region, household of 2, loan well above $80k.
  assert.equal(residual.required, 823);
});

// --- FHA -------------------------------------------------------------------

test("FHA finances the 1.75% upfront premium by default", () => {
  const result = evaluateScenario(scenario({ loanType: "fha", downPayment: { kind: "percent", value: 0.035 } }));
  const base = 900_000 * 0.965;
  assert.ok(Math.abs(result.loan.financedUpfrontFee - base * 0.0175) < 1);
});

test("FHA under 10% down means MIP for the life of the loan", () => {
  const result = evaluateScenario(scenario({ loanType: "fha", downPayment: { kind: "percent", value: 0.035 } }));
  const mip = lineFor(result, "mortgageInsurance");
  assert.match(mip.basis, /life of the loan/i);
  assert.match(mip.warning ?? "", /never goes away/i);
});

test("FHA at 10% down escapes MIP after 11 years", () => {
  const result = evaluateScenario(scenario({ loanType: "fha", downPayment: { kind: "percent", value: 0.1 } }));
  assert.match(lineFor(result, "mortgageInsurance").basis, /11 years/);
});

test("FHA MIP steps up for loans above the conforming baseline", () => {
  const small = evaluateScenario(
    scenario({ purchasePrice: 600_000, loanType: "fha", downPayment: { kind: "percent", value: 0.035 } })
  );
  const large = evaluateScenario(
    scenario({
      purchasePrice: 1_050_000,
      county: "Los Angeles",
      loanType: "fha",
      downPayment: { kind: "percent", value: 0.035 },
    })
  );
  assert.ok(large.loan.baseLoanAmount > CONFORMING_BASELINE);
  const rateOf = (r: typeof small) => lineFor(r, "mortgageInsurance").annual / r.loan.totalLoanAmount;
  assert.ok(rateOf(large) > rateOf(small), "above-baseline FHA loans pay a higher annual MIP rate");
});

// --- Conforming limits -----------------------------------------------------

test("crossing the county conforming limit raises a jumbo warning", () => {
  const limit = conformingLimitFor("San Diego");
  const result = evaluateScenario(scenario({ purchasePrice: (limit + 200_000) / 0.8 }));
  assert.ok(result.loan.exceedsConformingLimit);
  assert.ok(result.warnings.some((w) => /jumbo/i.test(w)));
});

test("VA above the conforming limit is explained rather than treated as jumbo", () => {
  const limit = conformingLimitFor("San Diego");
  const result = evaluateScenario(
    scenario({
      purchasePrice: limit + 300_000,
      loanType: "va",
      downPayment: { kind: "percent", value: 0 },
      va: { firstUse: true, disabilityExempt: false, financeFundingFee: true },
    })
  );
  assert.ok(result.warnings.some((w) => /no loan limit since 2020/i.test(w)));
  assert.ok(!result.warnings.some((w) => /which makes it a jumbo/i.test(w)));
});

// --- Qualification ---------------------------------------------------------

test("required income round-trips through the DTI ceiling", () => {
  const result = evaluateScenario(scenario());
  const q = result.qualification;
  const impliedMonthly = q.incomeRequiredAnnual / 12;
  assert.ok(Math.abs(q.totalObligations / impliedMonthly - q.dtiCeiling) < 1e-9);
});

test("two incomes raise the ceiling without changing the payment", () => {
  const solo = evaluateScenario(scenario({ household: { grossAnnualIncomes: [150_000], monthlyDebts: 600, size: 2 } }));
  const dual = evaluateScenario(
    scenario({ household: { grossAnnualIncomes: [150_000, 100_000], monthlyDebts: 600, size: 2 } })
  );
  assert.ok(Math.abs(solo.lenderMonthlyTotal - dual.lenderMonthlyTotal) < 0.01);
  assert.ok(dual.qualification.backEndDti < solo.qualification.backEndDti);
  assert.equal(solo.qualification.incomeRequiredAnnual, dual.qualification.incomeRequiredAnnual);
});

test("an income that cannot carry the payment fails DTI and says so", () => {
  const result = evaluateScenario(
    scenario({ household: { grossAnnualIncomes: [70_000], monthlyDebts: 600, size: 2 } })
  );
  assert.equal(result.qualification.passesDti, false);
  assert.ok(result.warnings.some((w) => /debt-to-income ratio is above/i.test(w)));
});

test("cash to close covers down payment, closing costs, and impound seeding", () => {
  const result = evaluateScenario(scenario());
  const keys = result.cashToClose.lines.map((l) => l.key);
  assert.deepEqual(keys, ["downPayment", "closingCosts", "prepaidsAndImpounds"]);
  assert.ok(result.cashToClose.total > result.cashToClose.downPayment);
});

test("paying the VA funding fee in cash moves it out of the loan and into cash to close", () => {
  const result = evaluateScenario(
    scenario({
      loanType: "va",
      downPayment: { kind: "percent", value: 0 },
      va: { firstUse: true, disabilityExempt: false, financeFundingFee: false },
    })
  );
  assert.equal(result.loan.financedUpfrontFee, 0);
  assert.equal(result.loan.totalLoanAmount, 900_000);
  assert.ok(result.cashToClose.lines.some((l) => l.key === "upfrontFee"));
});
