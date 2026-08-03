# CLAUDE.md — Three Blueberries

Context for any future session working on this project. Read this first.

---

## 1. What this is

A California home-buying calculator that refuses to lie by omission.

The name is the boomer-housing meme: a house for a firm handshake and three blueberries.
The premise is that every mortgage calculator on the internet is a lead-capture form built
by someone who wants to sell you a loan, and all of them leave things out — Mello-Roos,
the supplemental tax bill, what insurance actually costs in California now, the fact that
FHA mortgage insurance never goes away, the difference between what a lender counts and
what actually leaves your bank account.

**Deliverable:** an Eleventy static site with a TypeScript engine that runs entirely in the
browser, plus a thin Cloudflare Worker for live rate data. Deployed to Cloudflare Workers
with static assets.

**Owner intends to publish** on Cloudflare (Workers + static assets), non-commercial, no ads,
no lead capture, no email gate. That last part is the entire point — do not add one.

---

## 2. THE GOLDEN RULE: research before writing

**Never write a financial constant from memory.** Every number in `lib/data/` was verified
against a primary source before it was written down, and carries a citation in
`lib/data/sources.ts`.

This is inherited from the Codex Galdr project and it matters more here, not less — a wrong
rune is embarrassing, a wrong MIP duration changes whether someone can afford a house.

Workflow for any new constant:

1. Find the agency that actually sets it. FHFA for conforming limits, HUD for FHA MIP,
   VA for funding fees and residual income, the county assessor for tax rates.
2. Prefer a machine-readable primary file over a blog summary. The loan limits come from
   FHFA's own CSV via `npm run data:loan-limits`, not from a mortgage broker's article.
3. Add a `Source` entry with a real `asOf` date and an honest `kind`.
4. Only then write the number.

### Honesty discipline (critical)

Every `Source` has a `kind`, and every `LineItem` has a `Confidence`. Use them accurately:

- **`statutory`** — written into law. The 1% Prop 13 base, the VA funding fee schedule,
  the $7,000 homeowners' exemption, PMI auto-termination at 78% LTV.
- **`published`** — an agency's published schedule. FHA MIP rates, conforming limits.
- **`survey` / `market`** — a real observed average that moves. Freddie Mac's PMMS, California
  insurance costs.
- **`estimate`** — our default standing in until the user supplies the real number. PMI rate
  bands, county tax add-ons, closing costs, maintenance reserve.

When something is an estimate, say so **in the UI**, not just in a comment. The
`LineItem.warning` field exists for this. The insurance line and the Mello-Roos line both
carry loud warnings on purpose — those are the two numbers most likely to be catastrophically
wrong for a specific buyer.

**Prefer an honest "we don't know, go look it up" over a confident fabrication.** If a county
has no specific tax rate on file, the engine says so rather than quietly using the fallback.

---

## 3. Layout

```
lib/                    the engine — pure TypeScript, no DOM, no I/O
  types.ts              ScenarioInput -> ScenarioResult, LineItem, Confidence
  amortization.ts       payment / balance / schedule / LTV milestones
  mortgage.ts           evaluateScenario() — the heart
  affordability.ts      the engine run backwards (binary search on price)
  data/
    sources.ts          THE CITATION REGISTRY — every number traces here
    ca-loan-limits.ts   GENERATED from FHFA. Do not hand-edit.
    programs.ts         VA funding fee, FHA MIP, PMI bands, DTI ceilings, residual income
    ca-property.ts      Prop 13, county tax rates, insurance + closing cost defaults
src/
  client/app.ts         browser wiring; bundled by esbuild to src/assets/js/
  index.njk             the form + result panels
  _includes/base.njk
  assets/css/main.css
worker/index.ts         /api/rates (FRED, KV-cached) + static asset passthrough
tests/                  node --test, TypeScript run natively via type stripping
scripts/
  fetch-loan-limits.mjs regenerates ca-loan-limits.ts from FHFA's CSV
  build-client.mjs      esbuild bundle
  demo.ts               prints worked scenarios to the terminal — use it to eyeball output
```

### Commands

```
npm run dev        eleventy serve on :8080 (no /api — the rate fetch falls back)
npm test           44 tests, no watch mode needed, runs in ~100ms
npm run typecheck  app tsconfig + separate worker tsconfig
npm run build      bundle client, build site
node scripts/demo.ts   print full worked scenarios — the fastest sanity check
```

Node 26 runs the TypeScript tests directly via type stripping. There is no test build step
and no test framework dependency. Keep it that way.

The worker needs its own tsconfig because `@cloudflare/workers-types` conflicts with `DOM`.

---

## 4. The central design idea

The engine returns **two totals**, and the gap between them is the whole product:

- `lenderMonthlyTotal` — P&I + tax + insurance + MI + HOA + Mello-Roos. What underwriting
  counts, and what every other calculator shows you.
- `trueMonthlyTotal` — the above plus the maintenance reserve. What actually leaves your account.

`LENDER_COUNTED_KEYS` in `mortgage.ts` is what draws that line. Anything added to the model
must be deliberately placed on one side of it. A lender does not count maintenance, so it
must never silently inflate a DTI calculation.

Every `LineItem` carries a `basis` — a plain-English sentence explaining how the number was
reached. **If you can't write that sentence, don't ship the number.** The UI renders it in a
`<details>` under every line.

---

## 5. Hard-won decisions

- **Mello-Roos is modeled as its own line, never folded into the tax rate.** County rates in
  `ca-property.ts` are ad valorem only. Folding CFD into the rate would double-count and
  would hide the single most invisible cost in California new construction.
- **LTV is measured on the base loan against purchase price**, before any financed UFMIP or
  VA funding fee. That's how mortgage insurance is actually priced; rolling the fee in does
  not push you into a worse MI band.
- **PMI termination is computed on the original amortization schedule**, not on appreciation.
  That's what the Homeowners Protection Act actually says, and buyers routinely believe otherwise.
- **FHA MIP duration turns on the down payment, not on equity.** Under 10% down means life of
  loan with no equity exit. This gets a `warning`, not just a note.
- **VA gets the residual income test, not just DTI.** California is in the West region, which
  has the highest minimums in the country. VA's 41% DTI is a guideline, not a cap — a VA
  borrower can be approved well past it if residual income clears.
- **The affordability search is a binary search**, because price feeds back into tax, insurance,
  PMI band, and the jumbo threshold. There's no closed form.
- **Known limitation:** the affordability search does not apply a jumbo rate premium when the
  answer crosses the conforming limit. The scenario warns about jumbo status, but the rate
  used is still the conforming one. Fix this before trusting max-price answers near the limit.
- **The supplemental tax bill warning fires on every scenario.** It is not modeled numerically
  because that requires the seller's old assessed value, which we don't have. Do not fake it.

---

## 6. Data sources and refresh

| What                   | Source                               | Refresh                                              |
| ---------------------- | ------------------------------------ | ---------------------------------------------------- |
| Conforming loan limits | FHFA county CSV                      | `npm run data:loan-limits`, annually each November   |
| Mortgage rates         | FRED `MORTGAGE30US` / `MORTGAGE15US` | live, KV-cached 12h                                  |
| FHA MIP                | HUD Mortgagee Letter 2023-05         | still in force; threshold tracks conforming baseline |
| VA funding fee         | va.gov                               | check annually                                       |
| VA residual income     | VA Lender's Handbook M26-7 ch.4      | rarely changes                                       |
| County tax rates       | hand-curated estimates               | flagged `estimate`; users should override            |
| Insurance              | market survey                        | flagged `estimate`; volatile, warn loudly            |

FHFA renames their CSV every year. `scripts/fetch-loan-limits.mjs` has `YEAR` at the top and
refuses to write the file if it doesn't find exactly 58 California counties.

Secrets are never in `wrangler.toml`. `npx wrangler secret put FRED_API_KEY`
(free key: https://fredaccount.stlouisfed.org/apikeys).

---

## 6a. The history modules

`lib/data/history.ts` is GENERATED (`npm run data:history`) — 473 months of Case-Shiller
San Diego (SDXRSA) joined to Freddie Mac's 30-year average, from FRED's public `fredgraph.csv`
endpoint, which needs no API key.

- `lib/history.ts` — drawdown detection, the payment-over-time series, and `evaluateWaiting()`,
  which answers "should I wait for a crash" including the costs waiting advocates leave out
  (rent paid, principal not paid down) and the benefit nobody counts (a permanently lower
  Prop 13 basis).
- `lib/cohort.ts` — `compareToCohort()` prices the same house at an earlier date via the
  repeat-sales index and decomposes the monthly gap into rate / loan-size / Prop 13. The
  decomposition is asserted to sum to the total in tests; keep it that way.

**Two findings from this data that must not be flattened in the UI:**

1. **Price is not payment.** A 2021 peak buyer paid about what a 2006 peak buyer paid, because
   the rate was 2.84% instead of 6.24%. Any "wait for prices to drop" framing that ignores rates
   is wrong.
2. **Prop 13 raises the break-even rate.** At a 20% crash, P&I at 9% roughly cancels 6.66% — but
   the permanently lower assessed value still tips the decision toward waiting. This surprised
   the model's author and there is a test pinning it (`Prop 13 pushes the break-even rate higher`).

### Charts

`src/client/chart.ts` is a dependency-free SVG line chart. **Never make this a dual-axis chart** —
price and payment get two stacked small multiples sharing an x-axis. That rule is the whole reason
the module exists; a dual axis would hide the divergence that is the point. Single series per chart
means no legend (the title names it). Palette is slots 1–2 of the dataviz reference palette
(`#3987e5` blue, `#d95926` orange), validated against this site's `#0f1620` surface — re-run
`validate_palette.js` if you change either.

`renderChart()` is a pure string function on purpose, so chart geometry is unit-testable without a
browser (`tests/chart.test.ts` asserts every vertex lands inside the viewBox, the line never
back-tracks, and the peak renders above the trough).

## 6b. The forecaster (a negative result, deliberately shipped)

Python, managed with **uv**. `pyproject.toml` + `.python-version` are committed;
never use system Python or pip-install into it.

```
npm run data:panel   # 20 Case-Shiller metros + national controls -> data/panel.json
npm run train        # uv run python -m training.train -> lib/data/model.ts
npm run train:test   # uv run pytest  (the leakage suite)
```

`training/` holds features, purged walk-forward validation, and the trainer
(ridge / gradient boosting / random forest, plus logistic + GBM classifiers for
"prices fall 10%+ within the horizon"). Training is offline; the browser receives
only coefficients and metrics, so there is no Python at runtime.

### THE BUG THAT MUST NEVER COME BACK

An earlier JavaScript trainer had its embargo condition **inverted**. It was
meant to drop training rows whose target resolved inside the test window; it
instead kept _only_ those rows. It reported out-of-sample R² of 0.68 and a crash
classifier AUC of 0.96. All of it was leakage. The correct pipeline scores
**below zero** on both.

`training/tests/test_leakage.py` pins this: every fold asserts
`(train_period + horizon) < test_start`, and a separate test asserts the purge
actually removes rows, because a purge that drops nothing is not a purge. Run it
before trusting any number the model produces.

### What the honest model says

It does not work, and `lib/forecast.ts` is built so it cannot be displayed as if
it does. `verdict()` checks four criteria fixed in advance and currently fails
all four: it loses to "assume the trend continues," its direction calls are worse
than always saying "up" (76.7% base rate), the crash classifier scores AUC below
0.5, and going into 2008 it predicted growth with a 0% chance of a decline.

The model's _current_ San Diego output is bearish (roughly −20% at 24 months, 74%
crash probability). **Do not promote that number.** It is rendered underneath its
own track record on purpose. If a future model earns `trustworthy: true` against
the pre-registered criteria, that changes — nothing else does.

## 7. Planned, not built

- **Visual design pass.** The current CSS is deliberately restrained scaffolding. The owner's
  reference is `codex.doyled-it.com` — hand-written CSS custom-property theme systems, dark
  and textured, `clamp()` typography, gradient rules, hover glows, no framework.
- **Listings.** Zillow's public API died in 2021; Bridge Interactive is ~$500/mo and requires
  MLS affiliation. The plan is RentCast's free tier — **50 calls/month**, which is the binding
  constraint. The KV cache in `worker/index.ts` exists to make that survivable: shared across
  all visitors, long TTLs, stale-rather-than-fail. Never put a metered API behind an uncached
  path.
- Amortization/equity chart, scenario comparison, shareable permalink state, CalHFA
  down-payment-assistance programs, earthquake insurance (CEA) as an optional line.

---

## 8. Tone

The owner swears, hates being marketed to, and wants the number that is true rather than the
number that is comfortable. Write UI copy accordingly: direct, specific, no hedging into
uselessness, no "consult a professional" boilerplate padding. Say the hard thing plainly —
"this never goes away," "the least reliable number on this page," "invisible on Zillow."

But never let attitude substitute for accuracy. The voice earns its keep only because the
numbers underneath it are sourced.
