export * from "./types.ts";
export * from "./amortization.ts";
export * from "./mortgage.ts";
export * from "./affordability.ts";
export { SOURCES, source, sourcesFor } from "./data/sources.ts";
export type { Source, SourceId, SourceKind } from "./data/sources.ts";
export {
  CA_COUNTIES,
  CA_COUNTY_LOAN_LIMITS,
  CONFORMING_BASELINE,
  CONFORMING_CEILING,
  LOAN_LIMIT_YEAR,
  conformingLimitFor,
} from "./data/ca-loan-limits.ts";
export type { CaCounty } from "./data/ca-loan-limits.ts";
export { countyTaxRate, estimateInsuranceAnnual } from "./data/ca-property.ts";
export { DTI_CEILINGS, vaFundingFeeRate, vaResidualIncomeRequired } from "./data/programs.ts";
