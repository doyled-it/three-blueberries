/**
 * Amortization primitives. Pure arithmetic, no opinions, no rounding until the
 * very end, every other module builds on these.
 */

export interface AmortizationPeriod {
  month: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

/**
 * The standard fixed-rate payment formula:
 *
 *   M = P * r(1+r)^n / ((1+r)^n - 1)
 *
 * where r is the monthly rate and n the number of payments. Handles the 0%
 * degenerate case, which the formula divides by zero on.
 */
export function monthlyPayment(principal: number, annualRate: number, termYears: number): number {
  const n = Math.round(termYears * 12);
  if (n <= 0) return 0;
  if (principal <= 0) return 0;

  const r = annualRate / 12;
  if (r === 0) return principal / n;

  const growth = Math.pow(1 + r, n);
  return (principal * (r * growth)) / (growth - 1);
}

/**
 * Remaining balance after `month` payments, computed in closed form rather than
 * by looping, so it stays exact for any point in a 360-month schedule.
 *
 *   B_k = P(1+r)^k - M((1+r)^k - 1)/r
 */
export function balanceAfter(principal: number, annualRate: number, termYears: number, month: number): number {
  const n = Math.round(termYears * 12);
  const k = Math.min(Math.max(Math.round(month), 0), n);
  if (k === 0) return principal;

  const r = annualRate / 12;
  const payment = monthlyPayment(principal, annualRate, termYears);

  if (r === 0) return Math.max(principal - payment * k, 0);

  const growth = Math.pow(1 + r, k);
  return Math.max(principal * growth - payment * ((growth - 1) / r), 0);
}

/** Full month-by-month schedule. Useful for charts and for auditing the math. */
export function schedule(principal: number, annualRate: number, termYears: number): AmortizationPeriod[] {
  const n = Math.round(termYears * 12);
  const payment = monthlyPayment(principal, annualRate, termYears);
  const r = annualRate / 12;

  const out: AmortizationPeriod[] = [];
  let balance = principal;

  for (let month = 1; month <= n; month++) {
    const interest = balance * r;
    // Final payment absorbs any floating-point drift so the loan closes at zero.
    const principalPaid = month === n ? balance : payment - interest;
    balance = Math.max(balance - principalPaid, 0);
    out.push({ month, payment: interest + principalPaid, interest, principal: principalPaid, balance });
  }

  return out;
}

/** Total interest paid over the full term. The number nobody wants to look at. */
export function totalInterest(principal: number, annualRate: number, termYears: number): number {
  const n = Math.round(termYears * 12);
  return monthlyPayment(principal, annualRate, termYears) * n - principal;
}

/**
 * First month at which the loan balance falls to `targetLtv` of the ORIGINAL
 * value, which is the standard the Homeowners Protection Act uses for PMI
 * termination. Appreciation does not count here; only the amortization schedule
 * does. Returns null if the loan never gets there within its term.
 */
export function monthLtvReaches(args: {
  principal: number;
  originalValue: number;
  annualRate: number;
  termYears: number;
  targetLtv: number;
}): number | null {
  const { principal, originalValue, annualRate, termYears, targetLtv } = args;
  if (originalValue <= 0) return null;
  if (principal / originalValue <= targetLtv) return 0;

  const n = Math.round(termYears * 12);
  for (let month = 1; month <= n; month++) {
    if (balanceAfter(principal, annualRate, termYears, month) / originalValue <= targetLtv) {
      return month;
    }
  }
  return null;
}
