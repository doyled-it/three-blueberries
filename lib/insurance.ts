/**
 * What insurance costs, and what it costs when nobody will sell you any.
 *
 * The premium line on this page is a statewide estimate, and it stays one,
 * because no agency publishes an admitted-market county average. The Department
 * of Insurance runs an interactive quote tool rather than a dataset, and the
 * aggregators that do publish city tables will not say where their numbers came
 * from. Inventing a county multiplier to make the line look precise would be
 * the exact failure this project exists to avoid.
 *
 * What IS published, quarterly, by the body that writes the policies, is the
 * FAIR Plan's own book. So the county-specific fact we can state is not "your
 * premium will be X". It is: this is how many of your neighbours could not get
 * a normal policy at all, and this is what they pay instead. On a California
 * house that is the more decision-relevant number anyway. A $2,000 estimate and
 * a $7,655 reality are the difference between affording a house and not.
 */

import { FAIR_PLAN_AS_OF, FAIR_PLAN_BY_COUNTY, FAIR_PLAN_STATEWIDE_AVERAGE } from "./data/ca-insurance.ts";
import type { CaCounty } from "./data/ca-loan-limits.ts";

/**
 * Share of a county's detached homes on the FAIR Plan, banded.
 *
 * `severe` is one in five. At that level the admitted market has effectively
 * withdrawn from large parts of the county and the estimate on this page is
 * more likely wrong than right.
 */
export type FairPlanLevel = "low" | "elevated" | "severe";

export const FAIR_PLAN_SEVERE_SHARE = 0.2;
export const FAIR_PLAN_ELEVATED_SHARE = 0.05;

export interface FairPlanRisk {
  county: CaCounty;
  /** Fraction of detached homes in the county on the FAIR Plan. */
  share: number;
  level: FairPlanLevel;
  policies: number;
  /** Mean annual FAIR Plan premium in this county, owner-occupied single family. */
  averagePremium: number;
  /** Mean in the county's high-wildfire-risk ZIPs. Null if it has none. */
  highRiskPremium: number | null;
  /** How much dearer than the statewide FAIR Plan mean, as a multiple. */
  versusStatewide: number;
  asOf: string;
  /** One sentence for the UI, sized to how bad it is. */
  warning: string;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${(n * 100).toFixed(n < 0.01 ? 1 : 0)}%`;

/**
 * Plain "1 in 4" style, which lands harder than a percentage.
 *
 * Keeps a decimal below 1 in 3, because rounding 47.7% to "1 in 2" overstates
 * it, and a figure this alarming has to be exactly right to be worth saying.
 */
function oneIn(share: number): string {
  const ratio = 1 / share;
  return `1 in ${ratio < 3 ? ratio.toFixed(1) : Math.round(ratio)}`;
}

export function fairPlanRisk(county: CaCounty): FairPlanRisk {
  const row = FAIR_PLAN_BY_COUNTY[county];
  const level: FairPlanLevel =
    row.share >= FAIR_PLAN_SEVERE_SHARE ? "severe" : row.share >= FAIR_PLAN_ELEVATED_SHARE ? "elevated" : "low";

  const high =
    row.highRiskPremium !== null && row.highRiskPremium > row.averagePremium
      ? ` In its high-wildfire-risk ZIPs, ${money(row.highRiskPremium)}.`
      : "";

  const warning =
    level === "severe"
      ? `${pct(row.share)} of detached homes in ${county} County are on the FAIR Plan, the state's insurer of last ` +
        `resort: fire cover only, ${money(row.averagePremium)}/year, before the separate policy for everything ` +
        `else.${high} The figure above assumes a normal policy, and ${oneIn(row.share)} homes here could not get one.`
      : level === "elevated"
        ? `${pct(row.share)} of detached homes in ${county} County are on the FAIR Plan, the insurer of last resort: ` +
          `fire cover only, ${money(row.averagePremium)}/year.${high} Whether you land there is your ZIP and your brush ` +
          `clearance, not the county average.`
        : `Only ${pct(row.share)} of detached homes in ${county} County are on the FAIR Plan, so the admitted market ` +
          `mostly still writes here. That county figure hides its worst ZIPs: the FAIR Plan average is ` +
          `${money(row.averagePremium)}/year for fire cover alone.${high}`;

  return {
    county,
    share: row.share,
    level,
    policies: row.policies,
    averagePremium: row.averagePremium,
    highRiskPremium: row.highRiskPremium,
    versusStatewide: row.averagePremium / FAIR_PLAN_STATEWIDE_AVERAGE,
    asOf: FAIR_PLAN_AS_OF,
    warning,
  };
}

/** Counties ranked by how far the admitted market has withdrawn. */
export function worstFairPlanCounties(limit = 5): FairPlanRisk[] {
  return (Object.keys(FAIR_PLAN_BY_COUNTY) as CaCounty[])
    .map(fairPlanRisk)
    .sort((a, b) => b.share - a.share)
    .slice(0, limit);
}
