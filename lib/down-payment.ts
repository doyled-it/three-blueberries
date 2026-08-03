/**
 * How much to put down, and which account to take it from.
 *
 * The instinct is that a bigger deposit is always better. It usually is not, and
 * the reason is arithmetic rather than preference.
 *
 * A dollar of deposit saves you the mortgage rate. A dollar left invested earns
 * the market. Once the interest deduction is counted, the mortgage rate is not
 * 6.66%, it is 6.66% times (1 minus your marginal rate), which for a California
 * high earner is about 4%. So the question is whether you would rather earn a
 * guaranteed 4% or an expected 7 to 10%.
 *
 * Which means the deposit is usually set by what the lender requires, not by what
 * is optimal. Put down the least that gets you approved and avoids mortgage
 * insurance, and keep the rest working. Every dollar past that point is a
 * deliberate choice to earn 4% instead of 7%.
 *
 * The exception that swallows the rule: this only holds if the money genuinely
 * stays invested. For someone who would spend it, a deposit is forced saving and
 * the calculation flips.
 */

import { DEFAULT_MARGINAL_TAX_RATE } from "./rent-vs-buy.ts";

// ---------------------------------------------------------------------------
// What it costs to raise the cash
// ---------------------------------------------------------------------------

export type AccountKind = "taxable" | "roth-contributions" | "roth-earnings" | "traditional-retirement" | "cash";

export interface Account {
  kind: AccountKind;
  label: string;
  balance: number;
  /** Share of the balance that is unrealised gain. Ignored where not relevant. */
  gainShare?: number;
}

export interface LiquidationCost {
  account: Account;
  /** Cash you actually receive after tax and penalty. */
  netProceeds: number;
  taxPaid: number;
  penaltyPaid: number;
  /** Cents lost per dollar withdrawn. */
  frictionRate: number;
  note: string;
}

/**
 * 2026 rates for a single California filer at roughly $205k.
 *
 * Long-term capital gains sit in the 15% federal bracket well past this income.
 * The 3.8% net investment income tax applies above $200k of modified AGI, so it
 * does apply here. California taxes capital gains as ordinary income.
 */
export const TAX = {
  federalMarginal: 0.32,
  stateMarginal: 0.093,
  longTermCapitalGains: 0.15,
  netInvestmentIncome: 0.038,
  earlyWithdrawalPenalty: 0.1,
  /** Penalty-free withdrawal of IRA earnings for a first home, lifetime limit. */
  firstHomeIraExemption: 10_000,
} as const;

export function liquidationCost(account: Account): LiquidationCost {
  const gainShare = account.gainShare ?? 0;
  const gain = account.balance * gainShare;

  switch (account.kind) {
    case "cash":
      return {
        account,
        netProceeds: account.balance,
        taxPaid: 0,
        penaltyPaid: 0,
        frictionRate: 0,
        note: "No cost to deploy.",
      };

    case "taxable": {
      const rate = TAX.longTermCapitalGains + TAX.netInvestmentIncome + TAX.stateMarginal;
      const tax = gain * rate;
      return {
        account,
        netProceeds: account.balance - tax,
        taxPaid: tax,
        penaltyPaid: 0,
        frictionRate: account.balance > 0 ? tax / account.balance : 0,
        note: `Long-term gains taxed at about ${(rate * 100) | 0}%: 15% federal, 3.8% net investment income, 9.3% California. Only the gain is taxed, not the whole balance.`,
      };
    }

    case "roth-contributions":
      return {
        account,
        netProceeds: account.balance,
        taxPaid: 0,
        penaltyPaid: 0,
        frictionRate: 0,
        note: "Roth contributions come out tax free and penalty free at any age. This is the cheapest money you own after cash.",
      };

    case "roth-earnings": {
      const exempt = Math.min(account.balance, TAX.firstHomeIraExemption);
      const taxedPortion = account.balance - exempt;
      const rate = TAX.federalMarginal + TAX.stateMarginal;
      const tax = taxedPortion * rate;
      const penalty = taxedPortion * TAX.earlyWithdrawalPenalty;
      return {
        account,
        netProceeds: account.balance - tax - penalty,
        taxPaid: tax,
        penaltyPaid: penalty,
        frictionRate: account.balance > 0 ? (tax + penalty) / account.balance : 0,
        note: `The first ${TAX.firstHomeIraExemption.toLocaleString("en-US")} of earnings is penalty free for a first home, if the account is at least five years old. Everything beyond that is taxed and penalised.`,
      };
    }

    case "traditional-retirement": {
      const rate = TAX.federalMarginal + TAX.stateMarginal;
      const tax = account.balance * rate;
      const penalty = account.balance * TAX.earlyWithdrawalPenalty;
      return {
        account,
        netProceeds: account.balance - tax - penalty,
        taxPaid: tax,
        penaltyPaid: penalty,
        frictionRate: (tax + penalty) / Math.max(account.balance, 1),
        note: "Taxed as ordinary income AND penalised 10% before 59 and a half. Roughly half of every dollar disappears. There is almost no purchase that justifies this.",
      };
    }
  }
}

/** Cash available in the order it should be spent: cheapest friction first. */
export function raiseCash(
  accounts: Account[],
  target: number
): {
  drawn: Array<{ account: Account; gross: number; net: number }>;
  netRaised: number;
  totalFriction: number;
  shortfall: number;
} {
  const ordered = accounts
    .map((a) => ({ a, cost: liquidationCost(a) }))
    .sort((x, y) => x.cost.frictionRate - y.cost.frictionRate);

  const drawn: Array<{ account: Account; gross: number; net: number }> = [];
  let netRaised = 0;
  let totalFriction = 0;

  for (const { a, cost } of ordered) {
    if (netRaised >= target) break;
    const stillNeeded = target - netRaised;
    // Gross up, because friction comes out of what you withdraw.
    const grossNeeded = stillNeeded / Math.max(1 - cost.frictionRate, 0.01);
    const gross = Math.min(a.balance, grossNeeded);
    const net = gross * (1 - cost.frictionRate);
    if (gross <= 0) continue;
    drawn.push({ account: a, gross, net });
    netRaised += net;
    totalFriction += gross - net;
  }

  return { drawn, netRaised, totalFriction, shortfall: Math.max(target - netRaised, 0) };
}

// ---------------------------------------------------------------------------
// How much to put down
// ---------------------------------------------------------------------------

export interface DownPaymentOption {
  percent: number;
  amount: number;
  loanAmount: number;
  /** Annual interest saved by putting this much down rather than the minimum. */
  interestSaved: number;
  /** After the deduction, what that saving is really worth. */
  afterTaxInterestSaved: number;
  /** What the same money would have earned invested. */
  investmentForgone: number;
  /** Positive means the deposit beats investing. */
  advantage: number;
  requiresPmi: boolean;
}

/**
 * Compare deposit sizes on the only basis that matters: what the marginal dollar
 * earns in the house versus what it earns in the market.
 *
 * `deductible` should be false for the portion of debt above $750,000, where the
 * interest is not deductible and the comparison shifts toward a larger deposit.
 */
export function compareDownPayments(args: {
  price: number;
  interestRate: number;
  investmentReturn: number;
  marginalTaxRate?: number;
  /** Percentages to compare, as decimals. */
  options?: number[];
  /** Minimum the lender will accept, as a decimal. VA is 0. */
  minimumPercent?: number;
  pmiThreshold?: number;
  pmiAnnualRate?: number;
}): DownPaymentOption[] {
  const {
    price,
    interestRate,
    investmentReturn,
    marginalTaxRate = DEFAULT_MARGINAL_TAX_RATE,
    options = [0, 0.05, 0.1, 0.2, 0.35, 0.5, 1],
    minimumPercent = 0,
    pmiThreshold = 0.2,
    pmiAnnualRate = 0.005,
  } = args;

  const baseline = price * minimumPercent;

  return options
    .filter((p) => p >= minimumPercent)
    .map((percent) => {
      const amount = price * percent;
      const loanAmount = price - amount;
      const extraDown = amount - baseline;

      // Interest avoided on the extra deposit, in the first year.
      const interestSaved = extraDown * interestRate;
      const afterTaxInterestSaved = interestSaved * (1 - marginalTaxRate);

      // Plus any mortgage insurance avoided by crossing the threshold.
      const requiresPmi = percent < pmiThreshold && minimumPercent < pmiThreshold;
      const pmiAvoided = requiresPmi ? 0 : (price - baseline) * pmiAnnualRate;

      const investmentForgone = extraDown * investmentReturn;

      return {
        percent,
        amount,
        loanAmount,
        interestSaved,
        afterTaxInterestSaved: afterTaxInterestSaved + pmiAvoided,
        investmentForgone,
        advantage: afterTaxInterestSaved + pmiAvoided - investmentForgone,
        requiresPmi,
      };
    });
}

/**
 * The effective cost of mortgage debt after the interest deduction.
 *
 * This single number decides the deposit question. If it is below what you expect
 * from the market, borrow more and invest the difference. If it is above, pay down.
 */
export function effectiveMortgageRate(interestRate: number, marginalTaxRate = DEFAULT_MARGINAL_TAX_RATE): number {
  return interestRate * (1 - marginalTaxRate);
}

// ---------------------------------------------------------------------------
// Readiness: four gates, not twenty levers
// ---------------------------------------------------------------------------

export interface Gate {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
  /** What to do about it if it failed. */
  fix: string;
}

export interface Readiness {
  gates: Gate[];
  ready: boolean;
  /** The first thing standing in the way, or null if nothing is. */
  blocker: Gate | null;
  verdict: string;
}

/**
 * The whole decision, reduced to four independent tests.
 *
 * Rate, price, deposit, horizon, rent, appreciation, returns, tax treatment: all
 * of it collapses into four questions with yes or no answers. They are ordered so
 * the first failure is the one to work on, because they are not equally fixable.
 * A cash shortfall is a matter of time. A price above your ceiling is a matter of
 * choosing a different house.
 *
 * Reducing it this way is the point. A decision with twenty levers is not a
 * decision, it is a mood.
 */
export function assessReadiness(args: {
  cashNeeded: number;
  cashAvailableWithoutPenalty: number;
  passesDti: boolean;
  dti: number;
  dtiCeiling: number;
  price: number;
  ceilingAtThisRate: number | null;
  breakevenYear: number | null;
  holdYears: number;
}): Readiness {
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  const gates: Gate[] = [
    {
      key: "cash",
      label: "You have the cash",
      passed: args.cashAvailableWithoutPenalty >= args.cashNeeded,
      detail: `${money(args.cashNeeded)} needed, ${money(args.cashAvailableWithoutPenalty)} reachable without touching retirement.`,
      fix:
        args.cashAvailableWithoutPenalty >= args.cashNeeded
          ? "Met."
          : `Short by ${money(args.cashNeeded - args.cashAvailableWithoutPenalty)}. Keep saving, or buy less house. Do not raid a traditional retirement account: roughly half of every dollar disappears to tax and the early withdrawal penalty.`,
    },
    {
      key: "qualify",
      label: "The lender says yes",
      passed: args.passesDti,
      detail: `Debt to income ${pct(args.dti)} against a ${pct(args.dtiCeiling)} ceiling.`,
      fix: args.passesDti
        ? "Met."
        : "Put more down, clear other debt, or lower the price. This gate is binary and no amount of wanting it moves it.",
    },
    {
      key: "price",
      label: "The price beats renting",
      passed: args.ceilingAtThisRate !== null && args.price <= args.ceilingAtThisRate,
      detail:
        args.ceilingAtThisRate === null
          ? "No price works at this rent and horizon."
          : `${money(args.price)} against a ceiling of ${money(args.ceilingAtThisRate)} at today's rate.`,
      fix:
        args.ceilingAtThisRate !== null && args.price <= args.ceilingAtThisRate
          ? "Met."
          : "Wait for a lower rate, find a cheaper place, or buy something with a second unit. This is the gate that usually fails, and it is the one that moves most with rates.",
    },
    {
      key: "horizon",
      label: "You will stay long enough",
      passed: args.breakevenYear !== null && args.breakevenYear <= args.holdYears,
      detail:
        args.breakevenYear === null
          ? "This never breaks even against renting."
          : `Breaks even in year ${args.breakevenYear}, and you expect to stay ${args.holdYears}.`,
      fix:
        args.breakevenYear !== null && args.breakevenYear <= args.holdYears
          ? "Met."
          : "Selling before the crossover costs you money against renting. Either commit to staying longer or do not buy this one.",
    },
  ];

  const blocker = gates.find((g) => !g.passed) ?? null;
  const ready = blocker === null;

  return {
    gates,
    ready,
    blocker,
    verdict: ready
      ? "All four gates pass. This is a house worth buying, on your numbers, today."
      : `One thing is in the way: ${blocker!.label.toLowerCase()}. ${blocker!.fix}`,
  };
}
