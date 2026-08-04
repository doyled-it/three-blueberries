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

## Running it

```
npm install
npm test          # 243 tests, ~250ms, no framework
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
npm run data:history       # Case-Shiller San Diego + Freddie Mac rates
npm run data:panel         # 20 metros, for the forecaster
```

Each generator refuses to write its file if the parse does not reconcile against
the source. A silent partial parse is worse than a failed run.

See `CLAUDE.md` for the full design notes, the hard-won decisions, and the bugs
that must never come back.

## Licence

Not yet chosen. Non-commercial, no ads, no lead capture. That last part is the
entire point.
