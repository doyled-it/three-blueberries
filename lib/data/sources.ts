/**
 * The citation registry.
 *
 * Every number this app shows you traces back to an entry here. If a figure
 * can't cite something, it doesn't ship, and if a figure is an estimate rather
 * than a published rule, it says so in `kind` and the UI labels it that way.
 *
 * This is the whole point of the project: mortgage calculators hand you a
 * number and hide the assumptions. We show the assumptions.
 */

export type SourceKind =
  /** Written into law or regulation. Not a matter of opinion. */
  | "statutory"
  /** Published by the agency/GSE that sets it. Exact, but can change. */
  | "published"
  /** A real observed market average. Directionally right, varies by deal. */
  | "survey"
  /** Our own reasonable default. Explicitly a guess until you override it. */
  | "estimate";

export interface Source {
  id: string;
  title: string;
  publisher: string;
  url: string;
  /** When the underlying figure was published or last verified by us. */
  asOf: string;
  kind: SourceKind;
  /** Anything a reader needs to know to not be misled by this source. */
  caveat?: string;
}

export const SOURCES = {
  "fhfa-limits-2026": {
    id: "fhfa-limits-2026",
    title: "2026 Conforming Loan Limit Values, full county list",
    publisher: "Federal Housing Finance Agency",
    url: "https://www.fhfa.gov/data/conforming-loan-limit",
    asOf: "2026-01-01",
    kind: "published",
  },

  "freddie-pmms": {
    id: "freddie-pmms",
    title: "30-Year Fixed Rate Mortgage Average in the United States (MORTGAGE30US)",
    publisher: "Freddie Mac Primary Mortgage Market Survey, via FRED",
    url: "https://fred.stlouisfed.org/series/MORTGAGE30US",
    asOf: "weekly",
    kind: "survey",
    caveat:
      "A national weekly average for a well-qualified borrower with 20% down. Your actual quoted rate depends on credit, LTV, loan type, points paid, and the lender. Treat it as the middle of a range, not a promise.",
  },

  "hud-ml-2023-05": {
    id: "hud-ml-2023-05",
    title: "Mortgagee Letter 2023-05: Reduction of Annual Mortgage Insurance Premium Rates",
    publisher: "U.S. Department of Housing and Urban Development",
    url: "https://www.hud.gov/sites/dfiles/OCHCO/documents/2023-05hsgml.pdf",
    asOf: "2023-03-20",
    kind: "published",
    caveat:
      "The rate table is still in force. The loan-size threshold in the letter was the conforming limit at the time; it tracks the current-year conforming baseline.",
  },

  "va-funding-fee": {
    id: "va-funding-fee",
    title: "VA funding fee and loan closing costs",
    publisher: "U.S. Department of Veterans Affairs",
    url: "https://www.va.gov/housing-assistance/home-loans/funding-fee-and-closing-costs/",
    asOf: "2026-01-01",
    kind: "statutory",
  },

  "va-residual-income": {
    id: "va-residual-income",
    title: "VA Lender's Handbook M26-7, Chapter 4: residual income requirements by region and family size",
    publisher: "U.S. Department of Veterans Affairs",
    url: "https://www.benefits.va.gov/warms/pam26_7.asp",
    asOf: "2026-01-01",
    kind: "published",
    caveat: "California is in the West region, which carries the highest residual income minimums in the country.",
  },

  "fannie-b3-6-02": {
    id: "fannie-b3-6-02",
    title: "Selling Guide B3-6-02: Debt-to-Income Ratios",
    publisher: "Fannie Mae",
    url: "https://selling-guide.fanniemae.com/sel/b3-6-02/debt-income-ratios",
    asOf: "2026-01-01",
    kind: "published",
    caveat:
      "50% is the ceiling for loans run through Desktop Underwriter. Manually underwritten loans cap at 36%, or 45% with reserves and a strong credit profile. Hitting the ceiling is not the same as being comfortable.",
  },

  "prop-13": {
    id: "prop-13",
    title: "Proposition 13 (California Constitution, Article XIII A)",
    publisher: "California State Board of Equalization",
    url: "https://www.boe.ca.gov/proptaxes/decline-in-value/",
    asOf: "1978-06-06",
    kind: "statutory",
    caveat:
      "Sets the 1% base rate and caps assessed-value growth at 2% per year. It does NOT cap the voter-approved bonds and direct assessments stacked on top, which is why nobody actually pays 1%.",
  },

  "ca-homeowners-exemption": {
    id: "ca-homeowners-exemption",
    title: "Homeowners' Exemption",
    publisher: "California State Board of Equalization",
    url: "https://www.boe.ca.gov/proptaxes/homeowners_exemption.htm",
    asOf: "2026-01-01",
    kind: "statutory",
    caveat:
      "$7,000 off assessed value for an owner-occupied home. You must file for it. It is worth about $70-80/year.",
  },

  "ca-supplemental-tax": {
    id: "ca-supplemental-tax",
    title: "Supplemental Assessments",
    publisher: "California State Board of Equalization",
    url: "https://www.boe.ca.gov/proptaxes/faqs/supplemental.htm",
    asOf: "2026-01-01",
    kind: "statutory",
    caveat:
      "The bill nobody warns you about. When you buy, the county reassesses to your purchase price and bills you the difference from the seller's old assessment, prorated. Your lender's impound account does not cover it. It arrives months after closing as a bill you pay out of pocket.",
  },

  "ca-county-tax-rates": {
    id: "ca-county-tax-rates",
    title: "County effective property tax rates, California",
    publisher: "Compiled from county auditor-controller tax rate books",
    url: "https://www.boe.ca.gov/proptaxes/",
    asOf: "2026-01-01",
    kind: "estimate",
    caveat:
      "The 1% base is statutory and exact. The add-on is a county-level typical value; your actual rate depends on your specific tax rate area (TRA) and can swing meaningfully within one county. Check your county assessor's parcel lookup for the real number before you trust a payment.",
  },

  "mello-roos": {
    id: "mello-roos",
    title: "Mello-Roos Community Facilities Districts",
    publisher: "California State Treasurer / county auditor-controllers",
    url: "https://www.treasurer.ca.gov/cdiac/",
    asOf: "2026-01-01",
    kind: "estimate",
    caveat:
      "A CFD special tax on top of your property tax, common in developments built after ~1982. Ranges from a few hundred to over $10,000/year and is invisible on most listing sites. It is per-parcel. The only reliable number comes from the title report or the county auditor.",
  },

  "pmi-rate-bands": {
    id: "pmi-rate-bands",
    title: "Representative private mortgage insurance rate bands by LTV and credit score",
    publisher: "Compiled from mortgage insurer rate cards; range cross-checked against Urban Institute",
    url: "https://www.urban.org/policy-centers/housing-finance-policy-center",
    asOf: "2026-01-01",
    kind: "estimate",
    caveat:
      "PMI is priced by the individual insurer your lender uses, and the card is not public. These bands sit inside the observed 0.46%-1.50% market range and are right to within roughly a tenth of a point, but only a real quote is real.",
  },

  "pmi-cancellation": {
    id: "pmi-cancellation",
    title: "Homeowners Protection Act of 1998 (PMI cancellation and automatic termination)",
    publisher: "U.S. Congress / Consumer Financial Protection Bureau",
    url: "https://www.consumerfinance.gov/ask-cfpb/when-can-i-remove-private-mortgage-insurance-pmi-from-my-loan-en-202/",
    asOf: "1999-07-29",
    kind: "statutory",
    caveat:
      "Automatic termination at 78% LTV of ORIGINAL value, on the amortization schedule, not on what your house is worth now. You can request cancellation at 80%. Neither applies to FHA loans.",
  },

  "ca-insurance-market": {
    id: "ca-insurance-market",
    title: "California homeowners insurance cost and availability, 2026",
    publisher: "Market surveys; California Department of Insurance / California FAIR Plan",
    url: "https://www.insurance.ca.gov/",
    asOf: "2026-01-01",
    kind: "survey",
    caveat:
      "California's market is in crisis. A standard HO-3 in a non-wildfire ZIP runs roughly $1,400-$2,400/year, but a brush-adjacent property can quote $5,000-$25,000+, and FAIR Plan policies average around $3,000-$3,200 with high-risk ZIPs far above that. This is the single most volatile line in your payment. Get a real quote before you write an offer.",
  },

  "ca-closing-costs": {
    id: "ca-closing-costs",
    title: "Buyer closing costs in California",
    publisher: "Market surveys of escrow, title, and lender fees",
    url: "https://www.consumerfinance.gov/owning-a-home/loan-estimate/",
    asOf: "2026-01-01",
    kind: "survey",
    caveat:
      "Buyer closing costs typically run 2%-5% of purchase price, and escrow fees are customarily split with the seller in most of California. Everything here is negotiable and varies by county custom. Your Loan Estimate is the number that counts.",
  },

  "maintenance-reserve": {
    id: "maintenance-reserve",
    title: "Annual home maintenance reserve, 1% of value rule of thumb",
    publisher: "Common financial-planning guidance",
    url: "https://www.consumerfinance.gov/owning-a-home/",
    asOf: "2026-01-01",
    kind: "estimate",
    caveat:
      "No lender counts this and no calculator shows it, but the roof still ages. 1%/year is the usual rule; older homes run higher, newer builds lower in early years. We show it separately so it never gets confused with what you're required to pay.",
  },

  "irs-rev-proc-2025-32": {
    id: "irs-rev-proc-2025-32",
    title: "Rev. Proc. 2025-32: 2026 inflation-adjusted amounts, standard deduction",
    publisher: "Internal Revenue Service",
    url: "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf",
    asOf: "2025-10-09",
    kind: "published",
    caveat:
      "$16,100 single, $32,200 married filing jointly for 2026. This is the floor itemising has to clear, so a household with two incomes needs twice as much deductible interest before the mortgage deduction is worth anything at all.",
  },

  "obbba-salt-cap": {
    id: "obbba-salt-cap",
    title: "One Big Beautiful Bill Act sec. 70120: state and local tax deduction cap",
    publisher: "Public Law 119-21, via the IRS",
    url: "https://www.irs.gov/newsroom/one-big-beautiful-bill-act-provisions",
    asOf: "2025-07-04",
    kind: "statutory",
    caveat:
      "$40,000 for 2025 rising 1% a year, so $40,400 in 2026, and it reverts to $10,000 after 2029. Above $505,000 of modified AGI the raise is clawed back at 30 cents on the dollar down to a $10,000 floor, which two California salaries reach without feeling wealthy.",
  },

  "ab-1482-cpi": {
    id: "ab-1482-cpi",
    title: "Tenant Protection Act (AB 1482) rent cap, regional CPI for August 2026 through July 2027",
    publisher: "California Civil Code 1947.12, on BLS and DIR cost-of-living indexes",
    url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1947.12",
    asOf: "2026-08-01",
    kind: "statutory",
    caveat:
      "The formula is statutory; the CPI component is not one number. The statute uses the index for the region the property is in, so the ceiling is 8.7% in Los Angeles and Orange, 8.8% in the five Bay Area counties BLS indexes, 8.2% in San Diego, 8.1% in the Inland Empire, and 8.6% everywhere else on the California CPI. It resets every August. And it is a ceiling, not a forecast: single-family homes and condos not corporately owned can be exempt, and anything built in the last 15 years is exempt outright.",
  },

  "cshpi-sdxrsa": {
    id: "cshpi-sdxrsa",
    title: "S&P CoreLogic Case-Shiller CA-San Diego Home Price Index (SDXRSA)",
    publisher: "S&P Dow Jones Indices, via FRED",
    url: "https://fred.stlouisfed.org/series/SDXRSA",
    asOf: "monthly",
    kind: "published",
    caveat:
      "A repeat-sales index, not a median. It tracks what the SAME houses resold for, which is the right way to measure price change and the wrong way to read a level. Anchoring it to a current price gives you the history of one representative house, not the history of the median listing.",
  },

  "car-median-price": {
    id: "car-median-price",
    title: "Median price of existing single-family homes, San Diego County",
    publisher: "California Association of Realtors",
    url: "https://www.car.org/marketdata/data/countysalesactivity",
    asOf: "2026-01-01",
    kind: "survey",
    caveat:
      "A median of what sold, so it moves with the mix of what sold, not only with prices. Used here only as the anchor that puts the Case-Shiller index into dollars. Every ratio on that panel is anchor-invariant; only the dollar axis moves if this is wrong.",
  },
} as const satisfies Record<string, Source>;

export type SourceId = keyof typeof SOURCES;

export function source(id: SourceId): Source {
  return SOURCES[id];
}

export function sourcesFor(ids: readonly SourceId[]): Source[] {
  return ids.map((id) => SOURCES[id]);
}
