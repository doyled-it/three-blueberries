/**
 * The instrument watchlist: what the next one might be built out of.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A WATCHLIST AND NOT MODEL FEATURES
 *
 * A new financial instrument has no history, so it cannot be learned. By the
 * time CDO-squared had enough observations to train on, it was 2009 and the
 * question was settled. Anything in this file is, by construction, a thing we
 * have never seen break — which is exactly why a model can say nothing useful
 * about it and a human has to.
 *
 * This is also the lesson of the previous experiment. Aggregate financial
 * indicators — leverage, credit spreads, financial conditions — were tested and
 * they did not lead 2008; they confirmed it, roughly 21 months late. The people
 * who saw it coming were not reading indices. They were reading loan tapes and
 * noticing that a specific instrument had a specific structural flaw.
 *
 * So this file is deliberately editorial: sourced claims, structural analogies,
 * and named tripwires. It is labeled as judgment in the UI, kept separate from
 * anything computed, and every entry has to say what would prove it wrong.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type WatchLevel = "rhymes-hard" | "watch" | "context";

export interface Instrument {
  id: string;
  name: string;
  /** Plain-English: what the thing actually is. */
  what: string;
  /** The structural analogy to 2008, stated precisely rather than by vibe. */
  rhyme: string;
  /** Where it stands now, with the number and its source. */
  reading: string;
  /** The specific thing that would turn this from interesting into dangerous. */
  tripwire: string;
  /** What we do not know, said out loud. */
  unknown: string;
  level: WatchLevel;
  sources: { label: string; url: string }[];
}

export const INSTRUMENTS: Instrument[] = [
  {
    id: "dscr",
    name: "DSCR and non-QM lending",
    what: "A DSCR loan is underwritten on whether the property's expected rent covers the mortgage payment. The borrower's own income is not verified, because it is not part of the test.",
    rhyme:
      "This is the closest structural echo of stated-income lending in the whole market — not because documentation is fraudulent, but because the loan deliberately does not ask whether the borrower can pay. It asks whether the asset can. In 2006 that assumption held until prices stopped rising; here it holds until rents stop rising. Both are correlated across every loan in the pool at once, which is precisely the property that makes a securitisation fail all together rather than one at a time.",
    reading:
      "Non-QM issuance is projected above $100B in 2026, up about 46% year over year, and DSCR loans are roughly 30% of it. DSCR volumes have grown 91-97% year over year in private lending.",
    tripwire:
      "Rent declines in investor-heavy metros, or a rise in DSCR delinquencies while employment is still strong. Falling rents with full employment would mean the collateral thesis is breaking on its own terms rather than because of a recession.",
    unknown:
      "Loan-level performance data for DSCR pools is thin and the vintages are young. Almost none of this paper has been through a downturn.",
    level: "rhymes-hard",
    sources: [
      {
        label: "National Mortgage News — DSCR boom masks rising risk",
        url: "https://www.nationalmortgagenews.com/opinion/dscr-boom-masks-rising-risk-in-non-qm-market",
      },
    ],
  },
  {
    id: "private-credit",
    name: "Private credit and the insurance loop",
    what: "Non-bank funds lending directly to companies, increasingly funded by life insurers who sell annuities to the public. Banks in turn lend to the funds.",
    rhyme:
      "The circularity is the point, and it is the same shape as 2008: banks lend roughly $1.4T to the non-banks that fund private credit; those funds lend to companies; insurers fund the funds; and about a fifth of the investments held by some asset-manager-affiliated insurers are loans to their own affiliated funds. A Federal Reserve staff note describes these structures as obscuring the true leverage of both parties. That is a bet on a bet on a bet with the same firm on more than one side of it. Add mark-to-model valuation and you have assets whose price is an opinion until somebody has to sell.",
    reading:
      "Estimated $1.5-2.0 trillion in assets at end-2024. Life insurers hold about $807B in private and illiquid investments, up from $685B a year earlier — roughly 20% of their $4T fixed-income books. The FSB published a dedicated vulnerabilities report in May 2026 and the Fed gave it a special feature box.",
    tripwire:
      "Forced selling that reveals marks were stale — most likely triggered by annuity surrenders or a redemption wave, not by credit losses themselves. Watch for insurers selling private assets at a discount to carrying value.",
    unknown:
      "This is mostly not a housing exposure. It matters to housing through the credit channel — if private credit seizes, financing for everything including construction and non-agency mortgages tightens at once. The link is real but indirect, and I have not seen it quantified well.",
    level: "rhymes-hard",
    sources: [
      {
        label: "FSB — Report on Vulnerabilities in Private Credit (May 2026)",
        url: "https://www.fsb.org/2026/05/report-on-vulnerabilities-in-private-credit/",
      },
      {
        label: "American Banker — Is private credit a $2 trillion insurance timebomb?",
        url: "https://www.americanbanker.com/news/is-private-credit-a-2-trillion-dollar-insurance-timebomb",
      },
    ],
  },
  {
    id: "nonbank-servicers",
    name: "Non-bank mortgage servicers",
    what: "Most mortgages are no longer serviced by banks. They are serviced by thinly capitalised non-banks funded by short-term warehouse credit lines.",
    rhyme:
      "Servicers must advance payments to bondholders when borrowers stop paying, whether or not they have the cash. That obligation scales with defaults exactly when their funding lines get pulled. It is the same maturity mismatch that killed Bear and Lehman, sitting in a less-watched part of the system — and unlike 2008, the federal government is now the counterparty on most of the underlying guarantees.",
    reading:
      "FSOC has issued repeated warnings on non-bank servicer liquidity risk and recommended new authority to manage it. As of Q3 2023, 37% of non-bank mortgage companies met FSOC's elevated-risk standard.",
    tripwire:
      "Rising delinquencies combined with any tightening in warehouse lending. Either alone is survivable; together they are the documented failure mode.",
    unknown:
      "Servicer-level liquidity is not publicly reported in a usable, timely way. The FSOC reports are periodic, so this is genuinely hard to monitor in real time.",
    level: "watch",
    sources: [
      { label: "FSOC — Report on Nonbank Mortgage Servicing", url: "https://www.fsoc.gov/" },
      {
        label: "Urban Institute — FSOC's framework for nonbank systemic risk",
        url: "https://www.urban.org/research/publication/fsocs-new-framework-addressing-nonbank-systemic-risk-works-well-mortgage",
      },
    ],
  },
  {
    id: "equity-extraction",
    name: "Home equity extraction, second liens and HEIs",
    what: "Products that convert paper home equity into spendable cash: HELOCs, second mortgages, and home equity investments, in which an investor buys a share of your home's future appreciation instead of lending you money.",
    rhyme:
      "Mortgage equity withdrawal was a major channel of the last bubble — it is how rising paper wealth became consumption and how households ended up owing more than the house was worth when prices turned. HEIs add something genuinely new: they are equity-like claims on individual homes, securitised into bonds. Nobody knows how they behave in a decline, because they have never seen one.",
    reading:
      "About $34.5 trillion of collective home equity. Home equity bond issuance passed $30B year to date in 2026. HEI-backed securitisations went from two deals in 2021 to six by 2024. A proposed Freddie Mac second-lien product is estimated to unlock up to $850B in originations.",
    tripwire:
      "Rapid growth in second-lien origination against flat or falling prices. Extraction during appreciation is ordinary; extraction while prices fall means households are borrowing against equity that is disappearing.",
    unknown:
      "HEI contracts are not clearly regulated as either loans or equity, and the CFPB has an open issue spotlight on exactly that ambiguity. Their behaviour in a downturn — including whether the homeowner or the investor absorbs the loss — is genuinely untested.",
    level: "watch",
    sources: [
      {
        label: "CFPB — Home Equity Contracts: Market Overview",
        url: "https://www.consumerfinance.gov/data-research/research-reports/issue-spotlight-home-equity-contracts-market-overview/",
      },
      {
        label: "National Mortgage News — growth in home equity securitization",
        url: "https://www.nationalmortgagenews.com/news/secondary-markets-see-growth-in-home-equity-securitization",
      },
    ],
  },
  {
    id: "investor-share",
    name: "Investor share of purchases",
    what: "The fraction of single-family homes bought by investors rather than owner-occupants.",
    rhyme:
      "Investors are the marginal seller in a downturn. An owner-occupant with a job usually stays put when prices fall; a levered investor whose cash flow inverts sells, and does so at the same time as every other investor because they all underwrote the same rent assumption. This concentrates and accelerates declines rather than causing them.",
    reading:
      "Investors bought roughly 30-34% of US single-family homes in 2025, the highest share in five years, and the share is expected to hold into 2026.",
    tripwire:
      "Investor share falling sharply while listings rise — that pattern means investors have flipped from buyers to sellers, which is what turns a soft market into a fast one.",
    unknown:
      "Definitions vary a lot between data providers, and 'investor' spans a retiree with one rental and an institution with fifty thousand. The headline number is noisier than it looks.",
    level: "watch",
    sources: [
      { label: "Redfin / CoreLogic investor purchase tracking", url: "https://www.redfin.com/news/data-center/" },
    ],
  },
  {
    id: "counterweight",
    name: "The counterweight: household balance sheets",
    what: "Aggregate household and business debt as a share of GDP, and mortgage delinquency.",
    rhyme:
      "There isn't one, and that is the point of including it. The 2008 mechanism required households to be over-levered and defaulting. Today household debt to GDP has been trending DOWN to levels last seen in the early 2000s, and mortgage delinquency is near record lows because most borrowers are locked into cheap fixed-rate loans they have every reason to keep paying.",
    reading:
      "The Fed's May 2026 Financial Stability Report describes vulnerabilities from business and household debt as moderate, with the debt-to-GDP ratio continuing to trend down.",
    tripwire:
      "A sustained rise in mortgage delinquency while unemployment is still low. That combination would mean the payment burden itself is breaking households, which is not currently happening.",
    unknown:
      "Aggregates hide distribution. A healthy median household balance sheet is compatible with severe stress in a leveraged minority — which is roughly what 2006 looked like in aggregate data.",
    level: "context",
    sources: [
      {
        label: "Federal Reserve — Financial Stability Report, May 2026",
        url: "https://www.federalreserve.gov/publications/2026-may-financial-stability-report-overview.htm",
      },
    ],
  },
];

export const WATCHLIST_PREAMBLE =
  "Everything else on this page is computed from data. This section is not — it is a judgment call about instruments that are too new to have a track record, which is exactly why no model can help. " +
  "A new instrument cannot be learned: by the time there is enough history to train on, the question has already been answered expensively. " +
  "It is here because the tested indicators demonstrably failed to lead the last one, and the people who did see it coming were reading structures rather than indices.";

export const WATCHLIST_DISCIPLINE =
  "Each entry names what would prove it dangerous and what we do not know. If an entry ever stops having a falsifiable tripwire, delete it — at that point it has become a vibe with footnotes.";

export function byLevel(level: WatchLevel): Instrument[] {
  return INSTRUMENTS.filter((i) => i.level === level);
}
