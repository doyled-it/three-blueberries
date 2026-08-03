/**
 * The instrument watchlist: what the next one might be built out of.
 *
 * WHY THIS IS A WATCHLIST AND NOT MODEL FEATURES
 *
 * A new instrument has no history, so it cannot be learned. By the time
 * CDO-squared had enough observations to train on, it was 2009 and the question
 * was settled expensively. Everything here is by construction a thing nobody has
 * watched break, which is exactly why a model says nothing and a human has to.
 *
 * It is also the lesson of the experiment in training/experiment_financial.py:
 * aggregate leverage and credit-spread indicators did not lead 2008, they
 * confirmed it about 21 months late. The people who saw it coming were reading
 * structures, not indices.
 *
 * So this file is editorial on purpose, labeled as judgment in the UI, kept
 * apart from anything computed. Each entry leads with a plain metaphor, because
 * the mechanics are genuinely complicated and a reader deserves the shape of the
 * thing before the detail. Each one must also name what would prove it wrong.
 */

export type WatchLevel = "rhymes-hard" | "watch" | "context";

export interface Instrument {
  id: string;
  name: string;
  /** The metaphor. One sentence, no jargon. The shape of the thing. */
  gist: string;
  /** What it actually is, in plain terms. */
  what: string;
  /** The structural analogy to 2008, stated precisely rather than by vibe. */
  rhyme: string;
  /** Where it stands now, with sourced numbers. */
  reading: string;
  /** The specific thing that would turn this from interesting into dangerous. */
  tripwire: string;
  /** What we don't know, said out loud. */
  unknown: string;
  level: WatchLevel;
  sources: { label: string; url: string }[];
}

export const INSTRUMENTS: Instrument[] = [
  {
    id: "dscr",
    name: "DSCR and non-QM lending",
    gist: "A loan that checks whether the house has a job, not whether you do.",
    what: "The lender tests whether expected rent covers the payment. Your income is never verified, because it isn't part of the test.",
    rhyme:
      "This is the closest living relative of stated-income lending, not because anyone lies, but because the loan does not ask whether the borrower can pay. It asks whether the asset can. In 2006 that held until prices stopped rising; here it holds until rents do. Either way the assumption is identical across every loan in the pool, which is what makes a securitisation fail all at once instead of one loan at a time.",
    reading:
      "Non-QM issuance is projected above $100B in 2026, up ~46% year over year. DSCR is roughly 30% of it, and DSCR volumes have nearly doubled.",
    tripwire:
      "Rents falling in investor-heavy metros, or DSCR delinquencies rising while employment is still strong. That would mean the collateral thesis is breaking on its own terms.",
    unknown:
      "Loan-level performance data is thin and the vintages are young. Almost none of this paper has been through a downturn.",
    level: "rhymes-hard",
    sources: [
      {
        label: "National Mortgage News, DSCR boom masks rising risk",
        url: "https://www.nationalmortgagenews.com/opinion/dscr-boom-masks-rising-risk-in-non-qm-market",
      },
    ],
  },
  {
    id: "private-credit",
    name: "Private credit and the insurance loop",
    gist: "Everyone is holding everyone else's IOU, and each IOU is worth whatever its holder says, until someone has to sell.",
    what: "Non-bank funds lending directly to companies, funded increasingly by life insurers selling annuities to the public. Banks lend to the funds in turn.",
    rhyme:
      "The circularity is the whole thing, and it is the shape of 2008. Banks lend roughly $1.4T to the non-banks that fund private credit; those funds lend to companies; insurers fund the funds; and at some asset-manager-affiliated insurers about a fifth of investments are loans to their own affiliated funds. A Fed staff note says these structures obscure the true leverage of both parties. Add mark-to-model pricing and you have assets whose value is an opinion nobody has been forced to test.",
    reading:
      "Estimated $1.5-2.0T at end-2024. Life insurers hold ~$807B in private and illiquid assets, up from $685B a year earlier, about 20% of their fixed-income books.",
    tripwire:
      "Forced selling that reveals stale marks. Most likely from annuity surrenders or redemptions rather than credit losses. Watch for insurers selling private assets below carrying value.",
    unknown:
      "This is mostly not a housing exposure. It reaches housing through the credit channel: if private credit seizes, financing tightens everywhere at once. Real, but indirect and poorly quantified.",
    level: "rhymes-hard",
    sources: [
      {
        label: "FSB, Vulnerabilities in Private Credit (May 2026)",
        url: "https://www.fsb.org/2026/05/report-on-vulnerabilities-in-private-credit/",
      },
      {
        label: "American Banker, a $2 trillion insurance timebomb?",
        url: "https://www.americanbanker.com/news/is-private-credit-a-2-trillion-dollar-insurance-timebomb",
      },
    ],
  },
  {
    id: "nonbank-servicers",
    name: "Non-bank mortgage servicers",
    gist: "The middleman must keep paying your mortgage for you when you stop, with money he borrowed short-term, from lenders who leave first.",
    what: "Most mortgages are no longer serviced by banks but by thinly capitalised non-banks funded on short-term warehouse credit lines.",
    rhyme:
      "Servicers must advance payments to bondholders whether or not the borrower paid and whether or not they have the cash. That obligation grows with defaults at exactly the moment their funding gets pulled. It is the maturity mismatch that killed Bear and Lehman, relocated to a part of the system nobody watches, and this time the federal government guarantees most of what sits underneath.",
    reading:
      "FSOC has repeatedly warned on non-bank servicer liquidity and asked for new authority. As of Q3 2023, 37% of non-bank mortgage companies met its elevated-risk standard.",
    tripwire:
      "Rising delinquencies plus any tightening in warehouse lending. Either alone is survivable; together is the documented failure mode.",
    unknown:
      "Servicer liquidity isn't publicly reported in a timely, usable form. FSOC reports are periodic, so this is genuinely hard to watch in real time.",
    level: "watch",
    sources: [
      {
        label: "Urban Institute, FSOC and nonbank systemic risk",
        url: "https://www.urban.org/research/publication/fsocs-new-framework-addressing-nonbank-systemic-risk-works-well-mortgage",
      },
    ],
  },
  {
    id: "equity-extraction",
    name: "Second liens, HELOCs and equity investments",
    gist: "Spending the profit on your house before you've sold it, and now, selling a slice of the profit to a stranger.",
    what: "Products that turn paper equity into cash: HELOCs, second mortgages, and home equity investments, where an investor buys a share of your home's future value instead of lending you money.",
    rhyme:
      "Equity withdrawal was a main channel of the last bubble. It is how rising paper wealth became spending, and how households ended up owing more than the house was worth once prices turned. HEIs add something genuinely new: equity-like claims on individual homes, bundled into bonds. Nobody knows how they behave in a decline because none of them has seen one.",
    reading:
      "About $34.5T in collective home equity. Home equity bond issuance passed $30B year-to-date in 2026. HEI securitisations went from two deals in 2021 to six by 2024.",
    tripwire:
      "Second-lien origination growing while prices are flat or falling. That means households are borrowing against equity that is actively disappearing.",
    unknown:
      "HEIs aren't clearly regulated as loans or as equity, and the CFPB has an open spotlight on exactly that. Who absorbs the loss in a downturn is untested.",
    level: "watch",
    sources: [
      {
        label: "CFPB, Home Equity Contracts: Market Overview",
        url: "https://www.consumerfinance.gov/data-research/research-reports/issue-spotlight-home-equity-contracts-market-overview/",
      },
    ],
  },
  {
    id: "investor-share",
    name: "Investor share of purchases",
    gist: "A third of the buyers have no reason to stay if the numbers stop working.",
    what: "The share of single-family homes bought by investors rather than people who intend to live in them.",
    rhyme:
      "Investors are the marginal seller. An owner-occupant with a job usually sits tight when prices fall; a levered investor whose cash flow inverts sells, and does it at the same time as everyone else, because they all underwrote the same rent assumption. This doesn't cause declines. It concentrates and accelerates them.",
    reading:
      "Investors bought roughly 30-34% of US single-family homes in 2025, the highest share in five years, and it is expected to hold into 2026.",
    tripwire:
      "Investor share dropping sharply while listings climb. That pattern means they have flipped from buyers to sellers, which is what turns a soft market into a fast one.",
    unknown:
      "Definitions vary between providers, and 'investor' covers both a retiree with one rental and an institution with fifty thousand.",
    level: "watch",
    sources: [{ label: "Redfin, investor purchase tracking", url: "https://www.redfin.com/news/data-center/" }],
  },
  {
    id: "counterweight",
    name: "The counterweight: household balance sheets",
    gist: "The fuel is missing. 2008 needed households that couldn't pay; today most of them comfortably can.",
    what: "Household debt as a share of GDP, and mortgage delinquency.",
    rhyme:
      "There isn't one, which is why it's here. The 2008 mechanism required over-levered households defaulting in volume. Household debt to GDP has been trending down toward early-2000s levels, and delinquency sits near record lows because most borrowers hold cheap fixed-rate loans they have every reason to keep paying. No forced sellers, no cascade.",
    reading:
      "The Fed's May 2026 Financial Stability Report calls household and business debt vulnerabilities moderate, with debt-to-GDP still trending down.",
    tripwire:
      "Mortgage delinquency rising while unemployment stays low. That would mean the payment burden itself is breaking households, which is not happening now.",
    unknown:
      "Aggregates hide distribution. A healthy median balance sheet is perfectly compatible with severe stress in a leveraged minority, which is roughly what 2006 looked like in aggregate too.",
    level: "context",
    sources: [
      {
        label: "Federal Reserve, Financial Stability Report, May 2026",
        url: "https://www.federalreserve.gov/publications/2026-may-financial-stability-report-overview.htm",
      },
    ],
  },
];

export const WATCHLIST_PREAMBLE =
  "Everything else here is computed. This is judgment, about instruments too new to have a track record, which is exactly why no model can help. " +
  "A new instrument cannot be learned: by the time there's enough history to train on, the question has been answered expensively.";

export const WATCHLIST_DISCIPLINE =
  "Each entry names what would prove it dangerous and what we don't know. If an entry ever loses its falsifiable tripwire, delete it. It has become a vibe with footnotes.";

export function byLevel(level: WatchLevel): Instrument[] {
  return INSTRUMENTS.filter((i) => i.level === level);
}
