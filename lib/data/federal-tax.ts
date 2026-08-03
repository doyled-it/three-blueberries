/**
 * The federal tax parameters that decide whether a mortgage is subsidised.
 *
 * Every mortgage calculator that mentions the interest deduction assumes you get
 * full marginal relief on every dollar of interest. Almost nobody does. You only
 * benefit by the amount your itemised deductions exceed the standard deduction,
 * and the largest of those other deductions, state and local tax, is capped.
 *
 * These are 2026 figures. They move every year, and two of them are scheduled to
 * move sharply: the SALT cap reverts to $10,000 after 2029.
 */

/** 2026 federal standard deduction, by filing status. Rev. Proc. 2025-32. */
export const STANDARD_DEDUCTION_2026 = {
  single: 16_100,
  marriedFilingJointly: 32_200,
} as const;

/**
 * 2026 state and local tax deduction cap.
 *
 * The One Big Beautiful Bill Act replaced the flat $10,000 cap with $40,000 for
 * 2025, rising 1% a year through 2029 and reverting to $10,000 in 2030.
 */
export const SALT_CAP_2026 = 40_400;

/**
 * Above this modified AGI the raised cap is clawed back at 30 cents on the
 * dollar, down to a floor of $10,000. Two California incomes clear it easily,
 * and a household that trips it loses most of the deduction the calculator
 * would otherwise credit them with.
 */
export const SALT_PHASEOUT_START_2026 = 505_000;
export const SALT_PHASEOUT_RATE = 0.3;
export const SALT_FLOOR = 10_000;

/** The SALT cap actually available at a given income. */
export function saltCap(modifiedAgi: number): number {
  if (modifiedAgi <= SALT_PHASEOUT_START_2026) return SALT_CAP_2026;
  const clawback = (modifiedAgi - SALT_PHASEOUT_START_2026) * SALT_PHASEOUT_RATE;
  return Math.max(SALT_CAP_2026 - clawback, SALT_FLOOR);
}

/**
 * The standard deduction the household has to clear before itemising is worth
 * anything. Two earners filing jointly get double the floor, which is why a
 * two-income household often gets less mortgage subsidy than one, not more.
 */
export function standardDeductionFor(incomes: readonly number[]): number {
  const earners = incomes.filter((i) => i > 0).length;
  return earners >= 2 ? STANDARD_DEDUCTION_2026.marriedFilingJointly : STANDARD_DEDUCTION_2026.single;
}
