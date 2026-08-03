/**
 * Does owning actually beat renting, or does it just feel like it should?
 *
 * The usual argument for buying is "rent is throwing money away." That argument
 * is mostly wrong, and being honest about why is the point of this module.
 *
 * In year one of a 30-year loan almost every dollar of the payment is interest,
 * which is thrown away exactly as thoroughly as rent is. Add property tax,
 * insurance and maintenance, none of which build any equity either, and the
 * genuinely wasted portion of an owner's payment is usually LARGER than a
 * renter's entire rent. Only the principal portion is saving, and early on that
 * is a rounding error.
 *
 * So the comparison that means something is net worth. Both paths, side by side,
 * with the renter investing the money the buyer sank into a down payment. Where
 * the lines cross is the answer, and it moves a lot with assumptions we cannot
 * know, which is why every one of them is exposed as an input.
 */

import { balanceAfter, monthlyPayment } from "./amortization.ts";

export interface RentVsBuyInput {
  purchasePrice: number;
  downPaymentAmount: number;
  /** Cash spent at closing that does not become equity. */
  closingCosts: number;
  loanAmount: number;
  interestRate: number;
  termYears: number;

  /** Monthly ownership costs that build no equity: tax, insurance, MI, HOA, CFD. */
  monthlyCarryingCosts: number;
  /** Monthly maintenance reserve. */
  monthlyMaintenance: number;

  /** What you pay in rent today. */
  monthlyRent: number;

  /** Annual assumptions, as decimals. */
  homeAppreciation: number;
  rentGrowth: number;
  investmentReturn: number;
  /** Property tax grows at the Prop 13 cap, not at appreciation. */
  propertyTaxGrowth: number;
  /** Agent commissions and transfer costs on the way out. */
  sellingCostRate: number;

  years?: number;
}

export interface YearPoint {
  year: number;
  /** What the house is worth. */
  homeValue: number;
  loanBalance: number;
  equity: number;
  /** Net worth if you sold at the end of this year, after selling costs. */
  buyNetWorth: number;
  /** The renter's portfolio, having invested the down payment plus any monthly difference. */
  rentNetWorth: number;
  /** Cumulative money that bought nothing: interest, tax, insurance, maintenance, fees. */
  buyMoneyBurned: number;
  /** Cumulative rent paid. */
  rentMoneyBurned: number;
  monthlyOwnCost: number;
  monthlyRentCost: number;
}

export interface RentVsBuyResult {
  years: YearPoint[];
  /** First year owning is worth more than renting. Null if it never is. */
  breakevenYear: number | null;
  /** Year one, where the "rent is throwing money away" claim gets tested. */
  firstYear: {
    interestPaid: number;
    principalPaid: number;
    carryingAndMaintenance: number;
    /** Owner money that built no equity. */
    burned: number;
    rentPaid: number;
    /** Positive means the owner burned more than the renter did. */
    burnedMoreThanRent: number;
  };
  verdict: string;
}

const DEFAULTS = {
  homeAppreciation: 0.035,
  rentGrowth: 0.035,
  investmentReturn: 0.07,
  propertyTaxGrowth: 0.02,
  sellingCostRate: 0.06,
  years: 30,
};

export function compareRentVsBuy(input: RentVsBuyInput): RentVsBuyResult {
  const years = input.years ?? DEFAULTS.years;
  const pi = monthlyPayment(input.loanAmount, input.interestRate, input.termYears);

  const points: YearPoint[] = [];

  let homeValue = input.purchasePrice;
  // The renter keeps the cash the buyer spent on the down payment and closing.
  let portfolio = input.downPaymentAmount + input.closingCosts;
  let rent = input.monthlyRent;
  let carrying = input.monthlyCarryingCosts;
  const maintenanceRate = input.monthlyMaintenance / input.purchasePrice;

  let buyBurned = input.closingCosts;
  let rentBurned = 0;

  const monthlyReturn = Math.pow(1 + input.investmentReturn, 1 / 12) - 1;

  for (let year = 1; year <= years; year++) {
    const startBalance = balanceAfter(input.loanAmount, input.interestRate, input.termYears, (year - 1) * 12);
    const endBalance = balanceAfter(input.loanAmount, input.interestRate, input.termYears, year * 12);

    const principalPaid = Math.max(startBalance - endBalance, 0);
    const paymentsMade = pi * 12;
    const interestPaid = Math.max(paymentsMade - principalPaid, 0);

    // Maintenance scales with the value of the thing being maintained.
    const maintenance = homeValue * maintenanceRate * 12;
    const carryingAnnual = carrying * 12;

    for (let m = 0; m < 12; m++) {
      const ownMonthly = pi + carrying + homeValue * maintenanceRate;
      const difference = ownMonthly - rent;
      // If owning costs more, the renter banks the difference. If renting costs
      // more, the renter has to draw the difference out of the portfolio.
      portfolio = portfolio * (1 + monthlyReturn) + difference;
      rentBurned += rent;
    }

    buyBurned += interestPaid + carryingAnnual + maintenance;

    homeValue *= 1 + input.homeAppreciation;
    rent *= 1 + input.rentGrowth;
    // Only the tax portion of carrying costs is capped by Prop 13; treating all
    // of it that way is generous to owning, and stated as such in the UI.
    carrying *= 1 + input.propertyTaxGrowth;

    const equity = homeValue - endBalance;
    const buyNetWorth = homeValue * (1 - input.sellingCostRate) - endBalance;

    points.push({
      year,
      homeValue,
      loanBalance: endBalance,
      equity,
      buyNetWorth,
      rentNetWorth: portfolio,
      buyMoneyBurned: buyBurned,
      rentMoneyBurned: rentBurned,
      monthlyOwnCost: pi + carrying + homeValue * maintenanceRate,
      monthlyRentCost: rent,
    });
  }

  const breakeven = points.find((p) => p.buyNetWorth >= p.rentNetWorth);

  // Year-one detail: the honest test of "rent is throwing money away".
  const firstYearBalance = balanceAfter(input.loanAmount, input.interestRate, input.termYears, 12);
  const principal1 = Math.max(input.loanAmount - firstYearBalance, 0);
  const interest1 = Math.max(pi * 12 - principal1, 0);
  const carry1 = (input.monthlyCarryingCosts + input.monthlyMaintenance) * 12;
  const burned1 = interest1 + carry1;
  const rent1 = input.monthlyRent * 12;

  let verdict: string;
  if (!breakeven) {
    verdict =
      `On these assumptions owning never catches up within ${years} years. That is what happens when the ` +
      `investment return you are giving up is larger than the appreciation you are buying. Change either number and the answer moves.`;
  } else if (breakeven.year <= 5) {
    verdict =
      `Owning pulls ahead in year ${breakeven.year}. That is fast, and it is mostly because rent is assumed to ` +
      `keep rising while your principal and interest never do.`;
  } else {
    verdict =
      `Owning pulls ahead in year ${breakeven.year}. Before then renting leaves you wealthier, because the down payment ` +
      `is earning more in the market than it is earning in the house. If you might move before year ${breakeven.year}, renting wins.`;
  }

  return {
    years: points,
    breakevenYear: breakeven ? breakeven.year : null,
    firstYear: {
      interestPaid: interest1,
      principalPaid: principal1,
      carryingAndMaintenance: carry1,
      burned: burned1,
      rentPaid: rent1,
      burnedMoreThanRent: burned1 - rent1,
    },
    verdict,
  };
}

// ---------------------------------------------------------------------------
// The treadmill: are you saving faster than the target is moving?
// ---------------------------------------------------------------------------

export interface SavingsRaceInput {
  targetPrice: number;
  downPaymentPercent: number;
  closingCostRate: number;
  currentSavings: number;
  monthlySavings: number;
  savingsReturn: number;
  homeAppreciation: number;
  maxYears?: number;
}

export interface SavingsRaceResult {
  /** Years until savings cover the cash needed. Null if the target outruns you. */
  yearsToAfford: number | null;
  /** The cash target today. */
  cashNeededToday: number;
  /** What the cash target becomes at that point, if prices keep rising. */
  cashNeededThen: number | null;
  priceThen: number | null;
  /** Annual growth of the target versus annual growth of your savings, in dollars. */
  targetGrowsBy: number;
  savingsGrowBy: number;
  /** True when the deposit target rises faster than you can save. */
  losingGround: boolean;
  path: Array<{ year: number; saved: number; needed: number }>;
  verdict: string;
}

/**
 * The feeling of running to stand still, quantified.
 *
 * Saving for a deposit is a race against a target that moves, because the target
 * is a percentage of a price that is itself rising. If prices climb faster than
 * you save, the gap widens no matter how disciplined you are.
 */
export function savingsRace(input: SavingsRaceInput): SavingsRaceResult {
  const maxYears = input.maxYears ?? 30;
  const cashRate = input.downPaymentPercent + input.closingCostRate;

  const cashNeededToday = input.targetPrice * cashRate;
  const monthlyReturn = Math.pow(1 + input.savingsReturn, 1 / 12) - 1;

  const path: Array<{ year: number; saved: number; needed: number }> = [];
  let saved = input.currentSavings;
  let price = input.targetPrice;
  let yearsToAfford: number | null = null;
  let cashNeededThen: number | null = null;
  let priceThen: number | null = null;

  for (let year = 1; year <= maxYears; year++) {
    for (let m = 0; m < 12; m++) {
      saved = saved * (1 + monthlyReturn) + input.monthlySavings;
    }
    price *= 1 + input.homeAppreciation;
    const needed = price * cashRate;
    path.push({ year, saved, needed });

    if (yearsToAfford === null && saved >= needed) {
      yearsToAfford = year;
      cashNeededThen = needed;
      priceThen = price;
    }
  }

  // First-year rates of change, which is what determines whether you gain ground.
  const targetGrowsBy = cashNeededToday * input.homeAppreciation;
  const savingsGrowBy = input.monthlySavings * 12 + input.currentSavings * input.savingsReturn;
  const losingGround = targetGrowsBy > savingsGrowBy;

  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

  let verdict: string;
  if (losingGround) {
    verdict =
      `The target is moving away from you. The cash you need grows by about ${money(targetGrowsBy)} a year at this ` +
      `appreciation rate, while your savings grow by about ${money(savingsGrowBy)}. This is the treadmill, and no amount ` +
      `of discipline fixes it. Only a bigger gap between saving and prices does.`;
  } else if (yearsToAfford === null) {
    verdict = `You are gaining ground, but not fast enough to reach the target inside ${maxYears} years.`;
  } else {
    verdict =
      `You reach the deposit in about ${yearsToAfford} year${yearsToAfford === 1 ? "" : "s"}, by which point the house ` +
      `costs ${money(priceThen ?? 0)} and the cash needed has grown to ${money(cashNeededThen ?? 0)}. ` +
      `You are gaining on it by roughly ${money(savingsGrowBy - targetGrowsBy)} a year.`;
  }

  return {
    yearsToAfford,
    cashNeededToday,
    cashNeededThen,
    priceThen,
    targetGrowsBy,
    savingsGrowBy,
    losingGround,
    path,
    verdict,
  };
}

export const RENT_VS_BUY_DEFAULTS = DEFAULTS;

export const RENT_VS_BUY_CAVEAT =
  "This is the most assumption-heavy thing on the page, and small changes to appreciation or investment return swing " +
  "the answer by years. It ignores the mortgage interest deduction, which helps owning if you itemise, and it ignores " +
  "tax on investment gains, which helps owning too. It also cannot price security of tenure: nobody can raise your " +
  "fixed payment or decline to renew you.";
