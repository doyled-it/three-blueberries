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
import { DEFAULT_COUNTY, historyFor } from "./data/history.ts";
import type { CaCounty } from "./data/ca-loan-limits.ts";

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

  /**
   * Monthly mortgage insurance, kept separate because it behaves differently
   * from every other carrying cost: it does not grow with property values, and
   * on a conventional loan it stops entirely once the balance reaches 78% of the
   * original price. Folding it into the carrying scalar charged it for thirty
   * years and escalated it 2% a year, which on a 10%-down loan overcharged by
   * about $85,000 and drew a chart crossing that does not exist.
   */
  monthlyMortgageInsurance?: number;
  /** Month at which mortgage insurance stops. Null or undefined means never (FHA). */
  mortgageInsuranceEndsMonth?: number | null;

  /** What you pay in rent today. */
  monthlyRent: number;

  /**
   * Rent you would collect from the property, from a roommate, a granny flat or
   * a unit. Offsets the cost of owning directly, and it is the lever people most
   * often actually control.
   */
  monthlyRentalIncome?: number;

  /** Annual assumptions, as decimals. */
  homeAppreciation: number;
  rentGrowth: number;
  investmentReturn: number;
  /** Property tax grows at the Prop 13 cap, not at appreciation. */
  propertyTaxGrowth: number;
  /** Agent commissions and transfer costs on the way out. */
  sellingCostRate: number;

  /**
   * Combined marginal tax rate, for the mortgage interest deduction. Set to 0 to
   * exclude it.
   *
   * This is a real and large subsidy that most rent-versus-buy comparisons skip,
   * including earlier versions of this one. Interest on the first $750,000 of
   * acquisition debt is deductible, and for a California earner in the 32%
   * federal bracket the combined marginal rate is around 40%. On an $800,000 loan
   * that is roughly $20,000 a year, which is worth several hundred thousand
   * dollars of purchase price.
   *
   * Worth saying plainly: this is the tax code paying people to own rather than
   * rent. It is one of the reasons renting can feel like losing a rigged game.
   */
  marginalTaxRate?: number;

  /**
   * Other itemisable deductions, chiefly state income tax and property tax under
   * the SALT cap. Only the amount by which interest plus these exceeds the
   * standard deduction produces any benefit.
   */
  otherItemizedDeductions?: number;
  /** Standard deduction to clear. Defaults to the 2026 single-filer figure. */
  standardDeduction?: number;

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
    /** Tax, insurance, HOA, Mello-Roos and maintenance. Gross of relief, and MI is its own line. */
    carryingAndMaintenance: number;
    /** Mortgage insurance paid in year one, zero once it has terminated. */
    mortgageInsurance: number;
    /** Paid once, at the start, and gone. A renter never pays it. */
    closingCosts: number;
    /** Mortgage interest relief, reported separately rather than netted into a bucket. */
    taxRelief: number;
    /** Owner money that built no equity. Equals years[0].buyMoneyBurned. */
    burned: number;
    rentPaid: number;
    /** Positive means the owner burned more than the renter did. */
    burnedMoreThanRent: number;
  };
  verdict: string;
}

/** Interest is deductible on acquisition debt up to this amount. */
export const DEDUCTIBLE_DEBT_LIMIT = 750_000;

/**
 * A combined federal plus California marginal rate for a high earner. 32%
 * federal on income above roughly $200k, plus about 9.3% California.
 */
export const DEFAULT_MARGINAL_TAX_RATE = 0.4;

/**
 * 2026 federal standard deduction, single filer.
 *
 * Itemising only pays for the amount ABOVE this. Granting full marginal relief on
 * every interest dollar overstated the subsidy for anyone whose deductions do not
 * clear the threshold, which is most households at moderate loan sizes. High
 * earners in California usually clear it on state and property tax alone, but the
 * model must not assume that.
 */
export const STANDARD_DEDUCTION_SINGLE = 16_100;

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
  const mi = input.monthlyMortgageInsurance ?? 0;
  const miEnds = input.mortgageInsuranceEndsMonth;
  const maintenanceRate = input.monthlyMaintenance / input.purchasePrice;

  let buyBurned = input.closingCosts;
  let rentBurned = 0;

  const monthlyReturn = Math.pow(1 + input.investmentReturn, 1 / 12) - 1;
  const taxRate = input.marginalTaxRate ?? 0;
  const otherItemized = input.otherItemizedDeductions ?? 0;
  const standardDeduction = input.standardDeduction ?? STANDARD_DEDUCTION_SINGLE;
  // Only interest on the first $750,000 of acquisition debt is deductible.
  const deductibleShare =
    input.loanAmount > 0 ? Math.min(input.loanAmount, DEDUCTIBLE_DEBT_LIMIT) / input.loanAmount : 0;

  for (let year = 1; year <= years; year++) {
    const startBalance = balanceAfter(input.loanAmount, input.interestRate, input.termYears, (year - 1) * 12);
    const endBalance = balanceAfter(input.loanAmount, input.interestRate, input.termYears, year * 12);

    const principalPaid = Math.max(startBalance - endBalance, 0);
    const paymentsMade = pi * 12;
    const interestPaid = Math.max(paymentsMade - principalPaid, 0);

    // Maintenance scales with the value of the thing being maintained.
    const maintenance = homeValue * maintenanceRate * 12;
    const carryingAnnual = carrying * 12;

    // Only the portion of itemised deductions ABOVE the standard deduction is
    // worth anything, and the interest is the marginal piece.
    const deductibleInterest = interestPaid * deductibleShare;
    const itemizedTotal = deductibleInterest + otherItemized;
    const benefitBase = Math.max(0, Math.min(deductibleInterest, itemizedTotal - standardDeduction));
    const taxRelief = benefitBase * taxRate;
    const monthlyRelief = taxRelief / 12;

    for (let m = 0; m < 12; m++) {
      const monthIndex = (year - 1) * 12 + m + 1;
      const miThisMonth = miEnds === null || miEnds === undefined ? mi : monthIndex <= miEnds ? mi : 0;
      const ownMonthly =
        pi + carrying + miThisMonth + homeValue * maintenanceRate - (input.monthlyRentalIncome ?? 0) - monthlyRelief;
      const difference = ownMonthly - rent;
      // If owning costs more, the renter banks the difference. If renting costs
      // more, the renter has to draw the difference out of the portfolio.
      portfolio = portfolio * (1 + monthlyReturn) + difference;
      rentBurned += rent;
    }

    const miAnnual =
      mi * (miEnds === null || miEnds === undefined ? 12 : Math.max(0, Math.min(12, miEnds - (year - 1) * 12)));
    buyBurned += interestPaid + carryingAnnual + miAnnual + maintenance - taxRelief;

    homeValue *= 1 + input.homeAppreciation;
    rent *= 1 + input.rentGrowth;
    // Property tax is Prop 13 capped and insurance broadly tracks it. Mortgage
    // insurance is deliberately NOT escalated: it is a fixed percentage of the
    // original balance and it terminates.
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
      monthlyOwnCost:
        pi +
        carrying +
        (miEnds === null || miEnds === undefined || year * 12 <= miEnds ? mi : 0) +
        homeValue * maintenanceRate -
        (input.monthlyRentalIncome ?? 0) -
        monthlyRelief,
      monthlyRentCost: rent,
    });
  }

  const breakeven = points.find((p) => p.buyNetWorth >= p.rentNetWorth);

  // Year-one detail: the honest test of "rent is throwing money away".
  const firstYearBalance = balanceAfter(input.loanAmount, input.interestRate, input.termYears, 12);
  const principal1 = Math.max(input.loanAmount - firstYearBalance, 0);
  const interest1 = Math.max(pi * 12 - principal1, 0);
  const deductibleInterest1 = interest1 * deductibleShare;
  const relief1 =
    Math.max(0, Math.min(deductibleInterest1, deductibleInterest1 + otherItemized - standardDeduction)) * taxRate;
  // Carrying stays GROSS of relief. Netting it here made the figure the UI
  // labels "tax, insurance and upkeep" disagree with the itemised payment panel
  // by an order of magnitude, and double-counted the relief in `burned`.
  //
  // Mortgage insurance is in it, and rental income is NOT. The month loop and
  // buyMoneyBurned both charge MI, so leaving it out here put two different
  // year-one burns in one result object. Rental income is income, not a lower
  // cost: netting it in made "money that buys nothing" quietly disagree with
  // the cumulative series that does not net it.
  const miYearOne = mi * (miEnds === null || miEnds === undefined ? 12 : Math.max(0, Math.min(12, miEnds)));
  const carry1 = (input.monthlyCarryingCosts + input.monthlyMaintenance) * 12;
  // Closing costs are the purest example of money that buys nothing: a renter
  // never pays them and they are gone the day you sign. Including them is also
  // what makes this equal years[0].buyMoneyBurned, which is asserted in tests.
  const burned1 = interest1 + carry1 + miYearOne + input.closingCosts - relief1;
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
      mortgageInsurance: miYearOne,
      closingCosts: input.closingCosts,
      taxRelief: relief1,
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
    // "No amount of discipline fixes it" was wrong on this function's own terms:
    // savingsGrowBy is monthlySavings * 12 plus the return, so saving more IS the
    // lever, and the number below says exactly how much more.
    verdict =
      `The target is moving away from you. The cash you need grows by about ${money(targetGrowsBy)} a year at this ` +
      `appreciation rate, while your savings grow by about ${money(savingsGrowBy)}. You would have to put away another ` +
      `${money((targetGrowsBy - savingsGrowBy) / 12)} a month just to stop losing ground, before saving anything toward ` +
      `the deposit itself. That is the treadmill: the price of standing still.`;
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

// ---------------------------------------------------------------------------
// California's rent cap
// ---------------------------------------------------------------------------

// AB 1482 lives in lib/data/ca-rent-cap.ts, because the cap is not one number:
// it turns on the CPI region the property sits in, and a figure that is right
// in San Diego is wrong by seven tenths of a point in Alameda.
export { AB_1482, RENT_CAP_REGIONS, rentCapRegionFor, statutoryRentCap } from "./data/ca-rent-cap.ts";

// ---------------------------------------------------------------------------
// The decision surface: how long must you stay?
// ---------------------------------------------------------------------------

export interface BreakevenPoint {
  /** The variable being swept. */
  value: number;
  priceToRent: number;
  /** Years you must hold before owning beats renting. Null means never, within the horizon. */
  breakevenYear: number | null;
}

/**
 * Breakeven holding period across a range of purchase prices, holding rent and
 * everything else fixed.
 *
 * This is the question that actually matters: not "should I buy" in the abstract,
 * but "how long would I have to stay for this to have been worth it, and am I
 * going to be here that long." Selling before the crossover means you would have
 * been wealthier renting, because transaction costs and front-loaded interest
 * have not been earned back yet.
 */
/**
 * Costs that scale with the price of the house, expressed as annual rates.
 *
 * A price sweep has to recompute these per price. Holding them fixed charges a
 * $500k house the property tax of a $1.2M one, which makes every price look
 * equally bad and hides the actual crossover.
 */
export interface ScalingCosts {
  /** Property tax plus anything else proportional to value, annual. */
  carryingRate: number;
  /** Maintenance reserve, annual. */
  maintenanceRate: number;
  /** Costs that do NOT scale, such as an insurance floor or HOA, monthly. */
  fixedMonthly: number;
  /**
   * Annual mortgage insurance as a share of the loan, and when it stops.
   *
   * The price sweeps used to omit mortgage insurance entirely while the itemised
   * panel included it, so the same house could be declared a pass by one and a
   * fail by the other on the same screen. Worst at low deposits and on FHA,
   * where it is life-of-loan.
   */
  mortgageInsuranceRate?: number;
  mortgageInsuranceEndsMonth?: number | null;
  /**
   * Up-front fees rolled into the balance, as a share of the base loan.
   *
   * A VA funding fee or FHA UFMIP is financed, so you amortize more than the
   * price minus the deposit. The sweeps used price minus deposit while the
   * itemised panel used the real balance, which is $21,500 on a $1M VA purchase.
   */
  financedFeeRate?: number;
}

export type SweepBase = Omit<
  RentVsBuyInput,
  "purchasePrice" | "downPaymentAmount" | "loanAmount" | "closingCosts" | "monthlyCarryingCosts" | "monthlyMaintenance"
>;

export function atPrice(
  base: SweepBase,
  costs: ScalingCosts,
  price: number,
  downPercent: number,
  closingCostRate: number,
  years?: number
) {
  const down = price * downPercent;
  const loan = (price - down) * (1 + (costs.financedFeeRate ?? 0));
  return compareRentVsBuy({
    ...base,
    purchasePrice: price,
    downPaymentAmount: down,
    loanAmount: loan,
    closingCosts: price * closingCostRate,
    monthlyCarryingCosts: (price * costs.carryingRate) / 12 + costs.fixedMonthly,
    monthlyMaintenance: (price * costs.maintenanceRate) / 12,
    // Mortgage insurance has to be charged here too. Omitting it let the price
    // sweep pass a house that the itemised panel failed, on the same screen.
    monthlyMortgageInsurance: ((costs.mortgageInsuranceRate ?? 0) * loan) / 12,
    mortgageInsuranceEndsMonth: costs.mortgageInsuranceEndsMonth ?? null,
    ...(years ? { years } : {}),
  });
}

export function breakevenByPrice(
  base: SweepBase,
  costs: ScalingCosts,
  prices: number[],
  downPercent: number,
  closingCostRate = 0.025
): BreakevenPoint[] {
  return prices.map((price) => ({
    value: price,
    priceToRent: price / (base.monthlyRent * 12),
    breakevenYear: atPrice(base, costs, price, downPercent, closingCostRate).breakevenYear,
  }));
}

/** The same sweep across interest rates, holding the price fixed. */
export function breakevenByRate(base: RentVsBuyInput, rates: number[]): BreakevenPoint[] {
  return rates.map((interestRate) => {
    const result = compareRentVsBuy({ ...base, interestRate });
    return {
      value: interestRate,
      priceToRent: base.purchasePrice / (base.monthlyRent * 12),
      breakevenYear: result.breakevenYear,
    };
  });
}

/**
 * The most you should pay, given how long you actually intend to stay.
 *
 * Binary search on price: the breakeven period lengthens monotonically as price
 * rises, so there is a single crossing.
 */
export function maxPriceForHoldPeriod(
  base: SweepBase,
  costs: ScalingCosts,
  holdYears: number,
  downPercent: number,
  closingCostRate = 0.025,
  bounds: { low?: number; high?: number } = {}
): number | null {
  const low0 = bounds.low ?? 100_000;
  const high0 = bounds.high ?? 5_000_000;

  const worksAt = (price: number): boolean => {
    const result = atPrice(base, costs, price, downPercent, closingCostRate, Math.max(holdYears, 1));
    return result.breakevenYear !== null && result.breakevenYear <= holdYears;
  };

  if (!worksAt(low0)) return null;
  if (worksAt(high0)) return high0;

  let low = low0;
  let high = high0;
  while (high - low > 5_000) {
    const mid = (low + high) / 2;
    if (worksAt(mid)) low = mid;
    else high = mid;
  }
  return Math.floor(low / 10_000) * 10_000;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export interface DecisionThresholds {
  /** Does buying this house, at this rate, over this horizon, beat renting? */
  worthIt: boolean;
  breakevenYear: number | null;
  priceToRent: number;

  /** The rate at which this price starts to work. Null if no rate rescues it. */
  rateNeeded: number | null;
  /** The price that works at today's rate. Null if nothing does. */
  priceNeeded: number | null;
  /** How long you would have to stay at this price and rate. Null means never. */
  yearsNeeded: number | null;
  /** Rental income per month that would tip it, at this price and rate. */
  rentalIncomeNeeded: number | null;

  /** How far each lever has to move, as a share of where it is now. Smaller is closer. */
  levers: Array<{ key: string; label: string; current: string; needed: string; reachable: boolean; note: string }>;
  verdict: string;
}

function breakevenAt(
  base: SweepBase,
  costs: ScalingCosts,
  price: number,
  downPercent: number,
  closingCostRate: number,
  extra: Partial<RentVsBuyInput> = {}
) {
  const down = price * downPercent;
  const loan = (price - down) * (1 + (costs.financedFeeRate ?? 0));
  return compareRentVsBuy({
    ...base,
    ...extra,
    purchasePrice: price,
    downPaymentAmount: down,
    loanAmount: loan,
    closingCosts: price * closingCostRate,
    monthlyCarryingCosts: (price * costs.carryingRate) / 12 + costs.fixedMonthly,
    monthlyMaintenance: (price * costs.maintenanceRate) / 12,
    monthlyMortgageInsurance: ((costs.mortgageInsuranceRate ?? 0) * loan) / 12,
    mortgageInsuranceEndsMonth: costs.mortgageInsuranceEndsMonth ?? null,
  }).breakevenYear;
}

/**
 * The top of the rate search.
 *
 * A result at or above this is saturated, not solved: it means the price works
 * at every rate the search covers. Callers have to say that rather than print
 * the bound as though it were an answer, because "you need 14.97%" reads as a
 * requirement when it is the opposite.
 */
export const RATE_SOLVER_CEILING = 0.15;

/** The rate at which a given price starts to break even inside the horizon. */
export function requiredRate(
  base: SweepBase,
  costs: ScalingCosts,
  price: number,
  holdYears: number,
  downPercent: number,
  closingCostRate = 0.025
): number | null {
  const works = (rate: number) => {
    const year = breakevenAt({ ...base, interestRate: rate }, costs, price, downPercent, closingCostRate);
    return year !== null && year <= holdYears;
  };
  // Lower rates are strictly better, so search for the highest rate that works.
  if (!works(0.001)) return null;
  let low = 0.001;
  let high = RATE_SOLVER_CEILING;
  while (high - low > 0.0005) {
    const mid = (low + high) / 2;
    if (works(mid)) low = mid;
    else high = mid;
  }
  return low;
}

/** Rental income per month that would make this house work as it stands. */
export function requiredRentalIncome(
  base: SweepBase,
  costs: ScalingCosts,
  price: number,
  holdYears: number,
  downPercent: number,
  closingCostRate = 0.025
): number | null {
  const works = (income: number) => {
    const year = breakevenAt(base, costs, price, downPercent, closingCostRate, { monthlyRentalIncome: income });
    return year !== null && year <= holdYears;
  };
  if (works(0)) return 0;
  if (!works(8000)) return null;
  let low = 0;
  let high = 8000;
  while (high - low > 25) {
    const mid = (low + high) / 2;
    if (works(mid)) high = mid;
    else low = mid;
  }
  return Math.ceil(high / 25) * 25;
}

/**
 * Everything that has to be true for buying this house to beat renting, stated
 * as thresholds rather than as a probability.
 *
 * The point is not to produce a yes or no. It is to say which single thing would
 * have to change, and by how much, so you can judge whether any of them are
 * plausible. Usually one of them is much closer than the others.
 */
export function decide(args: {
  base: SweepBase;
  costs: ScalingCosts;
  price: number;
  holdYears: number;
  downPercent: number;
  closingCostRate?: number;
  /**
   * Set when the owner will not let out part of the property. A lever somebody
   * has ruled out is not a path to yes, and counting it anyway produces advice
   * they will never take.
   */
  excludeRentalIncome?: boolean;
}): DecisionThresholds {
  const { costs, price, holdYears, downPercent, excludeRentalIncome = false } = args;
  const closingCostRate = args.closingCostRate ?? 0.025;

  // The flag has to reach the arithmetic, not merely the label. Previously it
  // only greyed out the lever while every number behind the verdict still
  // counted income the user had just said they would never collect.
  const base: SweepBase = excludeRentalIncome ? { ...args.base, monthlyRentalIncome: 0 } : args.base;

  const breakevenYear = breakevenAt(base, costs, price, downPercent, closingCostRate);
  const worthIt = breakevenYear !== null && breakevenYear <= holdYears;
  const priceToRent = price / (base.monthlyRent * 12);

  const rateNeeded = requiredRate(base, costs, price, holdYears, downPercent, closingCostRate);
  const priceNeeded = maxPriceForHoldPeriod(base, costs, holdYears, downPercent, closingCostRate);
  const rentalIncomeNeeded = requiredRentalIncome(base, costs, price, holdYears, downPercent, closingCostRate);

  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

  const levers: DecisionThresholds["levers"] = [
    {
      key: "rate",
      label: "Interest rate",
      current: pct(base.interestRate),
      // Saturation is not a requirement. Printing the solver's own bound as
      // "14.97%" reads as a demand for a rate nobody has been quoted since 1984.
      needed:
        rateNeeded === null
          ? "no rate works"
          : rateNeeded >= RATE_SOLVER_CEILING
            ? "any rate works"
            : pct(rateNeeded),
      // A rate you could plausibly refinance into within a few years.
      reachable: rateNeeded !== null && rateNeeded > base.interestRate - 0.025,
      note:
        rateNeeded === null
          ? "Even free money does not rescue this price against this rent."
          : rateNeeded >= base.interestRate
            ? "Already there."
            : `You would need rates ${((base.interestRate - rateNeeded) * 100).toFixed(2)} points lower. Refinancing is the one lever that works after you buy.`,
    },
    {
      key: "price",
      label: "Purchase price",
      current: money(price),
      needed: priceNeeded === null ? "no price works" : money(priceNeeded),
      reachable: priceNeeded !== null && priceNeeded >= price * 0.8,
      note:
        priceNeeded === null
          ? "Nothing works at this rent and horizon."
          : priceNeeded >= price
            ? "Already there."
            : `${money(price - priceNeeded)} less, which is ${(((price - priceNeeded) / price) * 100).toFixed(0)}% off. A smaller or less central place, or a real correction.`,
    },
    {
      key: "years",
      label: "Years you stay",
      current: `${holdYears}`,
      needed: breakevenYear === null ? "never breaks even" : `${breakevenYear}`,
      reachable: breakevenYear !== null && breakevenYear <= 30,
      note:
        breakevenYear === null
          ? "Staying longer does not fix it. This runs the full 30 years and buying never catches renting, so the binding constraint is the price against the rent, not how long you are willing to stay."
          : breakevenYear <= holdYears
            ? "Already there."
            : `${breakevenYear - holdYears} more years than you planned.`,
    },
    {
      key: "income",
      label: "Second unit income",
      current: money(base.monthlyRentalIncome ?? 0),
      needed: excludeRentalIncome
        ? "ruled out"
        : rentalIncomeNeeded === null
          ? "not enough on its own"
          : `${money(rentalIncomeNeeded)}/mo`,
      reachable: !excludeRentalIncome && rentalIncomeNeeded !== null && rentalIncomeNeeded <= 2500,
      note: excludeRentalIncome
        ? "You have ruled this out, so it is not counted as a path to yes. Worth noting the distinction it turns on: letting the second half of a duplex, or an ADU that already exists, adds a home to the rental stock. Buying a single-family house to let does not."
        : rentalIncomeNeeded === null
          ? "Even a large second income on the property does not close the gap."
          : rentalIncomeNeeded === 0
            ? "Not needed."
            : "The other half of a duplex, or an ADU. A unit that already exists houses someone either way.",
    },
  ];

  const closest = levers.filter((l) => l.reachable && l.needed !== "Already there.");

  let verdict: string;
  if (worthIt) {
    verdict = `On these assumptions this works. Owning beats renting by year ${breakevenYear}, inside the ${holdYears} years you expect to stay.`;
  } else if (closest.length === 0) {
    verdict =
      `Nothing here is close. At ${priceToRent.toFixed(1)}x price to rent, no single change of a plausible size makes ` +
      `this house beat renting over ${holdYears} years. That is not a reason to feel bad, it is a reason to keep renting and keep investing.`;
  } else {
    const names = closest.map((l) => l.label.toLowerCase()).join(", or ");
    verdict =
      `Not yet, but it is not hopeless. The reachable levers are ${names}. ` +
      `Everything else would have to move further than is realistic.`;
  }

  return {
    worthIt,
    breakevenYear,
    priceToRent,
    rateNeeded,
    priceNeeded,
    yearsNeeded: breakevenYear,
    rentalIncomeNeeded,
    levers,
    verdict,
  };
}

// ---------------------------------------------------------------------------
// The buy zone
// ---------------------------------------------------------------------------

export interface BuyZonePoint {
  rate: number;
  /** The most you can justify paying at this rate. Null if nothing works. */
  maxPrice: number | null;
  priceToRent: number | null;
}

/**
 * The affordability frontier: the most you can justify paying, at every rate.
 *
 * This is the clearest way to see what an interest rate actually does. It is not
 * that a high rate makes the payment bigger, though it does. It is that a high
 * rate moves the entire boundary between "buying beats renting" and "it doesn't",
 * because interest is money that builds no equity, exactly like rent. Above the
 * curve you are paying more to own than the house can return. Below it, you are
 * not.
 *
 * The curve is steep, which is the point. Rates are the only lever here that can
 * move by a factor of two in a couple of years, and they can be refinanced after
 * you buy, unlike the price.
 */
export function buyZone(
  base: SweepBase,
  costs: ScalingCosts,
  rates: number[],
  holdYears: number,
  downPercent: number,
  closingCostRate = 0.025
): BuyZonePoint[] {
  return rates.map((rate) => {
    const maxPrice = maxPriceForHoldPeriod(
      { ...base, interestRate: rate },
      costs,
      holdYears,
      downPercent,
      closingCostRate
    );
    return {
      rate,
      maxPrice,
      priceToRent: maxPrice === null ? null : maxPrice / (base.monthlyRent * 12),
    };
  });
}

/**
 * How much a rate move is worth, in dollars of house.
 *
 * Answers "what does waiting for a better rate actually buy me", which is the
 * only version of the timing question with a checkable answer.
 *
 * `closingCostRate` sits in slot five to match `maxPriceForHoldPeriod` and
 * `buyZone`. It used to be `step` there, and the browser passed the real closing
 * cost rate into it positionally, so the "next half point down" figure was
 * computed on a 3.1-point cut and came out roughly twelve times too big. Keep
 * the shared parameters in the same order across all three or that returns.
 */
export function rateSensitivity(
  base: SweepBase,
  costs: ScalingCosts,
  holdYears: number,
  downPercent: number,
  closingCostRate = 0.025,
  step = 0.005
): { perQuarterPoint: number; atCurrent: number | null; atLower: number | null; step: number } {
  const atCurrent = maxPriceForHoldPeriod(base, costs, holdYears, downPercent, closingCostRate);
  const atLower = maxPriceForHoldPeriod(
    { ...base, interestRate: base.interestRate - step },
    costs,
    holdYears,
    downPercent,
    closingCostRate
  );
  return {
    perQuarterPoint: atCurrent !== null && atLower !== null ? atLower - atCurrent : 0,
    atCurrent,
    atLower,
    step,
  };
}

// ---------------------------------------------------------------------------
// Matched assumption sets
// ---------------------------------------------------------------------------

export interface AssumptionSet {
  id: string;
  label: string;
  homeAppreciation: number;
  investmentReturn: number;
  rentGrowth: number;
  basis: string;
}

/**
 * Appreciation and investment return have to be drawn from the SAME period, or
 * the comparison is rigged without anyone intending it.
 *
 * The default trap: San Diego's last decade ran 7.0%, which looks like a strong
 * case for buying until you notice the equity number sitting next to it is a
 * century-long average. Over that same decade the S&P returned about 13% before
 * dividends. Matching the periods is the difference between an argument and a
 * comparison.
 *
 * What matching does NOT do is collapse the answer. This comment used to claim
 * "once they ARE matched, the answer barely moves", which was true of the three
 * hardcoded San Diego figures and is false now that each county supplies its own:
 * Butte's sets run 3.3%, 0.7% and -1.4% appreciation, which is a different
 * decision, not a narrow band. The sets exist so a reader can see how much the
 * answer depends on the period, not to demonstrate that it doesn't.
 */
/**
 * Annualised appreciation for a county over the last `years`, from its own
 * record, or over the whole record when `years` is null.
 *
 * These used to be three hardcoded San Diego figures shown to all 58 counties,
 * complete with a caption saying "San Diego ran 5.4%/yr" to somebody buying in
 * Fresno. The appreciation you should assume is your own county's, and now that
 * every county has a history there is no reason to guess with someone else's.
 */
function annualisedAppreciation(county: CaCounty, years: number | null): number {
  const { rows, stepMonths } = historyFor(county);
  const last = rows[rows.length - 1]!;
  const wantedRows = years === null ? rows.length : Math.round((years * 12) / stepMonths) + 1;
  const from = rows[Math.max(0, rows.length - wantedRows)]!;
  const spanYears = ((rows.length - 1 - rows.indexOf(from)) * stepMonths) / 12;
  if (spanYears <= 0 || from[1] <= 0) return 0;
  return Math.pow(last[1] / from[1], 1 / spanYears) - 1;
}

/**
 * The three assumption sets, computed for the reader's county.
 *
 * Appreciation and investment return must come from the SAME period or the
 * comparison is rigged without anyone meaning to rig it, which is why these
 * travel as sets rather than as three independent sliders.
 */
export function assumptionSets(county: CaCounty = DEFAULT_COUNTY): AssumptionSet[] {
  const { rows } = historyFor(county);
  const startYear = rows[0]![0].slice(0, 4);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  const longRun = annualisedAppreciation(county, null);
  const decade = annualisedAppreciation(county, 10);
  const twenty = annualisedAppreciation(county, 20);

  return [
    {
      id: "long-run",
      label: "Long run",
      homeAppreciation: longRun,
      investmentReturn: 0.1,
      rentGrowth: 0.035,
      basis:
        `${county} County housing since ${startYear} ran ${pct(longRun)} a year, against the long-run nominal ` +
        `total return on US equities of roughly 10%. Both measured over decades.`,
    },
    {
      id: "last-decade",
      label: "Last decade",
      homeAppreciation: decade,
      investmentReturn: 0.147,
      rentGrowth: 0.05,
      basis:
        `Both from the last ten years: ${county} housing at ${pct(decade)}, the S&P 500 at about 13.2% before ` +
        `dividends and roughly 14.7% with them. ` +
        // Butte ran 0.7% over the last decade, so "a strong decade for housing"
        // was printed under a number that was nothing of the kind.
        (decade >= 0.147
          ? `${county} housing beat equities over that stretch, which is unusual and worth not assuming repeats.`
          : decade >= 0.07
            ? `A strong decade for housing was a far stronger one for stocks.`
            : decade > 0
              ? `Housing barely moved here while stocks ran. That gap is the whole argument for renting and investing the difference.`
              : `Housing went backwards here while stocks ran.`),
    },
    {
      id: "cautious",
      label: "Cautious",
      homeAppreciation: twenty,
      investmentReturn: 0.07,
      rentGrowth: 0.023,
      basis:
        `${county}'s last twenty years, which include a full crash, at ${pct(twenty)}, against a deliberately ` +
        `conservative 7% on equities. The 2.3% rent growth is an ASSUMPTION, not a measurement: there is no ` +
        `county-level California rent series in this project, so all three sets pick a rate rather than derive one. ` +
        `Override it with what your own rent has actually done.`,
    },
  ];
}

/** The default county's sets, for anything that has no county to hand. */
export const ASSUMPTION_SETS: AssumptionSet[] = assumptionSets();

export function assumptionSet(id: string): AssumptionSet | undefined {
  return ASSUMPTION_SETS.find((a) => a.id === id);
}

export const RENT_VS_BUY_DEFAULTS = DEFAULTS;

export const RENT_VS_BUY_CAVEAT =
  "This is the most assumption-heavy thing on the page, and small changes to appreciation or investment return swing " +
  "the answer by years. It now includes the mortgage interest deduction, on the first $750,000 of debt at a 40% " +
  "combined marginal rate, counting only the part that clears the standard deduction, which for a high California " +
  "earner is most of it. It still ignores tax on investment gains, which helps owning further, though less if your " +
  "savings sit in retirement accounts, and it models California and federal tax as one blended rate rather than " +
  "separately. Insurance, tax and upkeep are escalated together at the Prop 13 2% cap for the whole 30 years, which " +
  "is right for the tax line and optimistic for the other two: California insurance has been moving far faster than " +
  "that, and every year it does is a year this understates the cost of owning. Rent growth is an assumption too, " +
  "with no California rent series behind it. " +
  "It cannot price security of tenure: nobody can raise a fixed payment or decline to renew you.";
