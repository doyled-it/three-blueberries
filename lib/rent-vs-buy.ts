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
      const ownMonthly = pi + carrying + homeValue * maintenanceRate - (input.monthlyRentalIncome ?? 0);
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
      monthlyOwnCost: pi + carrying + homeValue * maintenanceRate - (input.monthlyRentalIncome ?? 0),
      monthlyRentCost: rent,
    });
  }

  const breakeven = points.find((p) => p.buyNetWorth >= p.rentNetWorth);

  // Year-one detail: the honest test of "rent is throwing money away".
  const firstYearBalance = balanceAfter(input.loanAmount, input.interestRate, input.termYears, 12);
  const principal1 = Math.max(input.loanAmount - firstYearBalance, 0);
  const interest1 = Math.max(pi * 12 - principal1, 0);
  const carry1 = (input.monthlyCarryingCosts + input.monthlyMaintenance - (input.monthlyRentalIncome ?? 0)) * 12;
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

// ---------------------------------------------------------------------------
// California's rent cap
// ---------------------------------------------------------------------------

/**
 * AB 1482, the Tenant Protection Act: annual increases are capped at 5% plus
 * regional CPI, never above 10%. San Diego's ceiling for August 2026 through
 * July 2027 is 8.2%.
 *
 * Two things matter about this and both cut against over-relying on it.
 *
 * It is a CEILING, not a forecast. Most rents rise far slower than the cap, so
 * using 8.2% as an assumed growth rate wildly overstates what a sitting tenant
 * actually faces.
 *
 * And the exemptions are broad: single-family homes and condos not owned by a
 * corporation are exempt if the lease said so, and anything built in the last
 * 15 years is exempt outright. Plenty of renters are not covered at all.
 */
export const AB_1482 = {
  base: 0.05,
  hardCeiling: 0.1,
  /** San Diego regional CPI component for the 2026-27 year. */
  sanDiegoCpi: 0.032,
  sanDiegoCap: 0.082,
} as const;

export function statutoryRentCap(regionalCpi: number = AB_1482.sanDiegoCpi): number {
  return Math.min(AB_1482.base + regionalCpi, AB_1482.hardCeiling);
}

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
}

type SweepBase = Omit<
  RentVsBuyInput,
  "purchasePrice" | "downPaymentAmount" | "loanAmount" | "closingCosts" | "monthlyCarryingCosts" | "monthlyMaintenance"
>;

function atPrice(
  base: SweepBase,
  costs: ScalingCosts,
  price: number,
  downPercent: number,
  closingCostRate: number,
  years?: number
) {
  const down = price * downPercent;
  return compareRentVsBuy({
    ...base,
    purchasePrice: price,
    downPaymentAmount: down,
    loanAmount: price - down,
    closingCosts: price * closingCostRate,
    monthlyCarryingCosts: (price * costs.carryingRate) / 12 + costs.fixedMonthly,
    monthlyMaintenance: (price * costs.maintenanceRate) / 12,
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
  return compareRentVsBuy({
    ...base,
    ...extra,
    purchasePrice: price,
    downPaymentAmount: down,
    loanAmount: price - down,
    closingCosts: price * closingCostRate,
    monthlyCarryingCosts: (price * costs.carryingRate) / 12 + costs.fixedMonthly,
    monthlyMaintenance: (price * costs.maintenanceRate) / 12,
  }).breakevenYear;
}

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
  let high = 0.15;
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
  const { base, costs, price, holdYears, downPercent, excludeRentalIncome = false } = args;
  const closingCostRate = args.closingCostRate ?? 0.025;

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
      needed: rateNeeded === null ? "no rate works" : pct(rateNeeded),
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
          ? "Staying longer does not fix it. Past about 15 years the constraint is price to rent, not patience."
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
 */
export function rateSensitivity(
  base: SweepBase,
  costs: ScalingCosts,
  holdYears: number,
  downPercent: number,
  step = 0.005
): { perQuarterPoint: number; atCurrent: number | null; atLower: number | null } {
  const atCurrent = maxPriceForHoldPeriod(base, costs, holdYears, downPercent);
  const atLower = maxPriceForHoldPeriod(
    { ...base, interestRate: base.interestRate - step },
    costs,
    holdYears,
    downPercent
  );
  return {
    perQuarterPoint: atCurrent !== null && atLower !== null ? atLower - atCurrent : 0,
    atCurrent,
    atLower,
  };
}

export const RENT_VS_BUY_DEFAULTS = DEFAULTS;

export const RENT_VS_BUY_CAVEAT =
  "This is the most assumption-heavy thing on the page, and small changes to appreciation or investment return swing " +
  "the answer by years. It ignores the mortgage interest deduction, which helps owning if you itemise, and it ignores " +
  "tax on investment gains, which helps owning too. It also cannot price security of tenure: nobody can raise your " +
  "fixed payment or decline to renew you.";
