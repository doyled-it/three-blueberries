# Three Blueberries

What a California house actually costs, itemised and sourced. No lead capture, no
email gate, no lender trying to sell you anything.

Named for the meme where boomers bought a house with a firm handshake and three
blueberries.

Live at **[blueberries.doyled-it.com](https://blueberries.doyled-it.com)**.

## The idea

Every mortgage calculator on the internet is a lead-capture form built by someone
who wants to sell you a loan, and all of them leave things out: Mello-Roos, the
supplemental tax bill, what insurance actually costs in California now, the fact
that FHA mortgage insurance never goes away, the difference between what a lender
counts and what actually leaves your bank account.

So the engine returns **two totals**, and the gap between them is the product:

- **Lender total.** Principal, interest, tax, insurance, mortgage insurance, HOA,
  Mello-Roos. What underwriting counts, and what every other calculator shows you.
- **True total.** All of that plus the maintenance reserve. What actually leaves
  your account.

Every line carries a plain-English sentence explaining how the number was reached
and a citation to the agency that sets it. Anything estimated says so, in the UI,
not in a comment.

Beyond the payment it answers the questions the calculators do not: can you
actually buy it, should you, what happens if you wait for a crash, why everyone
else seems to manage, and why it is this hard. It also ships a housing forecaster
that does not work, displayed underneath its own track record, on purpose.

Everything follows the county you pick, including fifty years of that county's own
price history. The sharpest thing it found: **the better a California county pays,
the less affordable its housing** (r = +0.71). Affordability did not leave the
state, it relocated to where the work is not.

## Running it

```
npm install
npm test          # 261 tests, under a second, no framework
npm run dev       # eleventy on :8080 (no /api, the rate fetch falls back)
npm run typecheck
npm run build
node scripts/demo.ts   # worked scenarios in the terminal, the fastest sanity check
```

Node 26 runs the TypeScript tests directly via type stripping. There is no test
build step and no test framework dependency.

The offline model training is Python, managed with [uv](https://docs.astral.sh/uv/):

```
uv run pytest -q   # the leakage suite
npm run train
```

## Deploying

A Cloudflare Worker with static assets, built by Workers Builds on every push to
`main`.

First-time setup, once:

```
npx wrangler login
npx wrangler kv namespace create CACHE     # paste the id into wrangler.toml
npx wrangler secret put FRED_API_KEY       # free: https://fredaccount.stlouisfed.org/apikeys
```

Without `FRED_API_KEY` the site still works; the rate field falls back to its last
known value and says so out loud rather than presenting a stale number as current.

Secrets never go in `wrangler.toml`.

## Data

Every constant traces to an entry in `lib/data/sources.ts` with a real `asOf`
date and an honest `kind`. Several data files are generated rather than typed:

```
npm run data:loan-limits   # FHFA conforming limits, annually each November
npm run data:insurance     # California FAIR Plan by county, quarterly
npm run data:history       # FHFA by county + Zillow anchors + Census income
npm run data:panel         # 20 metros, for the forecaster
```

Each generator refuses to write its file if the parse does not reconcile against
the source. A silent partial parse is worse than a failed run.

See `CLAUDE.md` for the full design notes, the hard-won decisions, and the bugs
that must never come back.

## Licence

**GNU Affero General Public License v3.0.** See [`LICENSE`](LICENSE).

Plain GPL would not have been enough. Almost nobody distributes a web app; they
run it on a server and hand you HTML, and plain GPL says nothing about that. AGPL
does: **if you run a modified version of this where other people can reach it,
you have to publish your changes under the same licence.**

So: fork it, learn from it, run it, sell nothing on it. But a version of this
with a lead-capture form bolted on has to ship its source too, and then everyone
can see the form.

### The data is not mine to license

The AGPL covers the code in this repository. It does not and cannot cover the
data files, which come from other people and carry their own terms:

| Data | Source | Terms |
| --- | --- | --- |
| Conforming loan limits | FHFA | US government work, public domain |
| Mortgage rates | Freddie Mac PMMS via FRED | free to use with attribution |
| FAIR Plan by county | California FAIR Plan | published public statistics |
| Housing units | California Dept of Finance | US state government work |
| House price history | FHFA (metro + county) | US government work, public domain |
| Price anchors | Zillow ZHVI | free, non-commercial, attribution |
| County incomes | Census SAIPE | US government work, public domain |
| **Forecaster panel** | **S&P Case-Shiller via FRED** | **see below** |

`data/panel.json` contains S&P CoreLogic Case-Shiller index values for 20 metros.
It is the offline training input for the forecaster and is not displayed. S&P's
terms state that reproduction in any form is prohibited without their prior
written permission, and FRED is explicit that making a series available through
their API is not that permission. Permission has not been requested.

The site itself no longer touches it. Everything shown to a reader comes from
FHFA, Zillow and the Census, none of which need anyone's permission. The same
move would work for the panel: FHFA covers those metros too, and the forecaster's
conclusion is that it does not work, which a coarser input would not change.
