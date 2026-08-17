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
import { CA_MEDIAN_INCOME } from "./data/signals.ts";
import type { CaCounty } from "./data/ca-loan-limits.ts";

/**
 * Long-run nominal growth in California median household income, derived from the
 * income series rather than guessed: $25,290 in 1984 to $100,600 in 2024 is
 * 3.51% a year. It sits right on top of the 3.5% default rent growth, which is
 * the whole reason the deposit race is a genuine race rather than a rout: when
 * rent and wages move together the saver treads water, and it is only when rent
 * pulls ahead that the ground moves.
 */
export const LONG_RUN_WAGE_GROWTH = (() => {
  const first = CA_MEDIAN_INCOME[0]!;
  const last = CA_MEDIAN_INCOME[CA_MEDIAN_INCOME.length - 1]!;
  const years = Number(last[0].slice(0, 4)) - Number(first[0].slice(0, 4));
  return Math.pow(last[1] / first[1], 1 / years) - 1;
})();

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
  /**
   * The window in which owning leads, because owning does not always STAY ahead.
   * When the investment return you give up is larger than the appreciation you
   * buy, the renter's invested capital eventually outcompounds the house: owning
   * pulls ahead in the middle years, then renting reclaims the lead in the long
   * run. `start` is the first year owning leads (== breakevenYear); `end` is the
   * first year AFTER that renting is back ahead, or null if owning holds the lead
   * through the whole series. So a null `start` means owning never leads, and a
   * non-null `start` with a non-null `end` means owning leads only in between.
   */
  buyWindow: { start: number | null; end: number | null };
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
  // Where does owning's lead END? The first year, after it pulls ahead, that
  // renting is back in front. Null means owning never gives the lead back within
  // the series. This is the whole reason "buying wins at year 6" was misleading:
  // it wins at year 6 and loses it again at year 14.
  const reclaim = breakeven
    ? (points.find((p) => p.year > breakeven.year && p.rentNetWorth > p.buyNetWorth)?.year ?? null)
    : null;
  const buyWindow = { start: breakeven ? breakeven.year : null, end: reclaim };

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
  } else if (reclaim) {
    // Owning wins only a window, then renting reclaims the lead. This is the
    // case the old copy could not describe: it announced the year owning pulled
    // ahead and never mentioned that owning gives the lead back.
    verdict =
      `Owning is only ahead between year ${breakeven.year} and year ${reclaim - 1}. Sell earlier and you never caught up; ` +
      `hold past year ${reclaim - 1} and renting is ahead again, because the money you did not sink into the house ` +
      `compounds faster in the market than the house appreciates. This is a window, not a finish line.`;
  } else if (breakeven.year <= 5) {
    verdict =
      `Owning pulls ahead in year ${breakeven.year} and stays ahead. That is fast, and it is mostly because rent is ` +
      `assumed to keep rising while your principal and interest never do.`;
  } else {
    verdict =
      `Owning pulls ahead in year ${breakeven.year} and stays ahead through year ${years}. Before then renting leaves ` +
      `you wealthier, because the down payment is earning more in the market than it is earning in the house. If you ` +
      `might move before year ${breakeven.year}, renting wins.`;
  }

  return {
    years: points,
    breakevenYear: breakeven ? breakeven.year : null,
    buyWindow,
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
  /**
   * What the saver pays in rent now, and how fast it rises. The deposit race
   * used to hold `monthlySavings` fixed for up to thirty years, which silently
   * assumed rent never moved. Rising rent eats saving capacity: every extra
   * dollar to the landlord is a dollar that does not reach the deposit. Omit
   * both and the drag is not modelled (the old behaviour), which OVERSTATES how
   * fast a renter closes the gap.
   */
  currentRent?: number;
  rentGrowth?: number;
  /** Nominal income growth. Defaults to the long-run California figure. */
  wageGrowth?: number;
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

  // How the monthly saving rate itself moves.
  //
  // If non-rent spending tracks wages, next year's saving capacity works out to
  //   savings*(1 + wage) + rent*(wage - rent_growth)
  // which is exact, not a fudge: income and non-rent spending both scale with
  // wages and cancel, leaving the rent term as the only mover. When rent grows
  // faster than wages that term is negative and the saving rate falls; when it
  // grows slower the saver gets a raise. Rent moving with wages (the default,
  // both near 3.5%) leaves the rate growing at wages, which is the honest
  // "treads water in real terms" case.
  const rentGrowth = input.rentGrowth ?? 0;
  const wageGrowth = input.wageGrowth ?? LONG_RUN_WAGE_GROWTH;
  let monthlySavings = input.monthlySavings;
  let rent = input.currentRent ?? 0;

  for (let year = 1; year <= maxYears; year++) {
    for (let m = 0; m < 12; m++) {
      saved = saved * (1 + monthlyReturn) + monthlySavings;
    }
    price *= 1 + input.homeAppreciation;
    // Only advance the saving rate when rent is being modelled at all. Without a
    // rent figure this is the old fixed-rate behaviour.
    if (input.currentRent !== undefined) {
      monthlySavings = monthlySavings * (1 + wageGrowth) + (rent / 12) * (wageGrowth - rentGrowth);
      monthlySavings = Math.max(0, monthlySavings);
      rent *= 1 + rentGrowth;
    }
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
  // The saving side is credited with the same rent drag the loop uses, so the
  // headline "losing ground" verdict agrees with the year-by-year path.
  const rentDragAnnual =
    input.currentRent !== undefined ? input.monthlySavings * 12 * wageGrowth + input.currentRent * (wageGrowth - rentGrowth) : 0;
  const savingsGrowBy = input.monthlySavings * 12 + input.currentSavings * input.savingsReturn + rentDragAnnual;
  const losingGround = targetGrowsBy > savingsGrowBy;

  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

  let verdict: string;
  if (losingGround) {
    // "No amount of discipline fixes it" was wrong on this function's own terms:
    // savingsGrowBy is monthlySavings * 12 plus the return, so saving more IS the
    // lever, and the number below says exactly how much more.
    verdict =
      `The target is moving away from you. You would have to put away another ` +
      `${money((targetGrowsBy - savingsGrowBy) / 12)} a month just to stop losing ground, before saving anything ` +
      `toward the deposit itself. That is the treadmill: the price of standing still.`;
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

  // Owning has to be ahead AT the hold year, not merely to have crossed once by
  // then. A cheaper house sinks less capital, so owning's position at any fixed
  // year improves monotonically as price falls: a single crossing, safe to
  // bisect.
  const worksAt = (price: number): boolean =>
    buyWinsAtHold(base, costs, price, holdYears, downPercent, closingCostRate);

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
  /** Is owning ahead AT the hold year? Not "did it ever cross by then". */
  worthIt: boolean;
  breakevenYear: number | null;
  /** The window owning leads. `end` null means it holds the lead to year 30. */
  buyWindow: { start: number | null; end: number | null };
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

function scenarioAtPrice(
  base: SweepBase,
  costs: ScalingCosts,
  price: number,
  downPercent: number,
  closingCostRate: number,
  extra: Partial<RentVsBuyInput> = {}
): RentVsBuyResult {
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
  });
}

function breakevenAt(
  base: SweepBase,
  costs: ScalingCosts,
  price: number,
  downPercent: number,
  closingCostRate: number,
  extra: Partial<RentVsBuyInput> = {}
) {
  return scenarioAtPrice(base, costs, price, downPercent, closingCostRate, extra).breakevenYear;
}

/**
 * Net worth if you buy vs if you rent, AT a given hold year. Positive means
 * owning is ahead if you sell then.
 *
 * This is the honest decision, and it is NOT the same as "did owning ever pull
 * ahead by this year". Owning can lead in a middle window and trail at the
 * endpoint, so a threshold test on the first breakeven called a 30-year hold a
 * win when the buyer would in fact end $2.5M behind. Always ask about the
 * endpoint the reader actually names.
 */
export function buyMinusRentAt(result: RentVsBuyResult, holdYears: number): number {
  const point = result.years.find((p) => p.year === holdYears) ?? result.years[result.years.length - 1];
  return point ? point.buyNetWorth - point.rentNetWorth : 0;
}

/** Is owning ahead if you sell after exactly `holdYears`? */
function buyWinsAtHold(
  base: SweepBase,
  costs: ScalingCosts,
  price: number,
  holdYears: number,
  downPercent: number,
  closingCostRate: number,
  extra: Partial<RentVsBuyInput> = {}
): boolean {
  const result = scenarioAtPrice(base, costs, price, downPercent, closingCostRate, extra);
  return buyMinusRentAt(result, holdYears) >= 0;
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
  const works = (rate: number) =>
    buyWinsAtHold({ ...base, interestRate: rate }, costs, price, holdYears, downPercent, closingCostRate);
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
  const works = (income: number) =>
    buyWinsAtHold(base, costs, price, holdYears, downPercent, closingCostRate, { monthlyRentalIncome: income });
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

  const scenario = scenarioAtPrice(base, costs, price, downPercent, closingCostRate);
  const breakevenYear = scenario.breakevenYear;
  const window = scenario.buyWindow;
  // Worth it means owning is ahead AT the hold year the reader named, not that
  // it crossed once by then. With a window that closes, holding to year 30
  // lands the buyer behind even though breakeven was year 6.
  const worthIt = buyMinusRentAt(scenario, holdYears) >= 0;
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
      // The "years" lever is a WINDOW, not a threshold, whenever owning's lead
      // closes. Staying longer helps you into the window and then hurts you back
      // out of it, so "you need to stay N years" is only true when the lead
      // never closes.
      needed:
        window.start === null
          ? "never breaks even"
          : window.end === null
            ? `${window.start}+`
            : `${window.start}–${window.end - 1}`,
      reachable: window.start !== null && window.start <= 30,
      note:
        window.start === null
          ? "Staying longer does not fix it. This runs the full 30 years and buying never catches renting, so the binding constraint is the price against the rent, not how long you are willing to stay."
          : worthIt
            ? "Already there."
            : window.end !== null && holdYears >= window.end
              ? `Owning only leads between year ${window.start} and year ${window.end - 1}. You plan to stay ${holdYears}, past the point renting pulls back ahead, so staying is the problem, not the fix.`
              : `${window.start - holdYears} more years than you planned, and only up to year ${window.end === null ? 30 : window.end - 1}.`,
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
    verdict =
      window.end !== null
        ? `On these assumptions this works only if you sell on time. Owning is ahead at year ${holdYears}, but its lead ` +
          `closes at year ${window.end}: hold past then and renting is ahead again, because the money you did not sink ` +
          `into the house compounds faster than the house appreciates.`
        : `On these assumptions this works. Owning is ahead at year ${holdYears} and stays ahead, having pulled ` +
          `level in year ${breakevenYear}.`;
  } else if (closest.length === 0) {
    verdict =
      `Nothing here is close. At ${priceToRent.toFixed(1)}x price to rent, no single change of a plausible size makes ` +
      `this house beat renting over ${holdYears} years. That is not a reason to feel bad, it is a reason to keep renting and keep investing.`;
  } else {
    verdict =
      `Not yet, but it is not hopeless. Some of the levers below are reachable; the rest would have to move ` +
      `further than is realistic.`;
  }

  return {
    worthIt,
    breakevenYear,
    buyWindow: window,
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
        `${county} County housing since ${startYear} ran ${pct(longRun)} a year, against roughly 10% long-run on US ` +
        `equities. Both over decades.`,
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
              ? `Housing barely moved here while stocks ran, which is the whole argument for renting and investing the difference.`
              : `Housing went backwards here while stocks ran.`),
    },
    {
      id: "cautious",
      label: "Cautious",
      homeAppreciation: twenty,
      investmentReturn: 0.07,
      rentGrowth: 0.023,
      basis:
        `${county}'s last twenty years, a full crash included, at ${pct(twenty)}, against a deliberately conservative 7% ` +
        `on equities. The 2.3% rent growth is an ASSUMPTION, not a measurement: there is no county rent series here, ` +
        `so override it with what your own rent has done.`,
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
  "The softest number on the page: nudge appreciation, investment return or rent growth and the answer moves by " +
  "years, so read the sliders, not the verdict. It credits the mortgage interest deduction on the first $750,000 of " +
  "debt, and escalates insurance and upkeep at Prop 13's 2% cap, which is generous: California insurance is rising " +
  "far faster, so if anything it understates the cost of owning. And it cannot price security of tenure, which is " +
  "the thing renting never buys you.";
