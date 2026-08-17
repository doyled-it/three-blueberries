# CLAUDE.md: Three Blueberries

Context for any future session working on this project. Read this first.

---

## 1. What this is

A California home-buying calculator that refuses to lie by omission.

The name is the boomer-housing meme: a house for a firm handshake and three blueberries.
The premise is that every mortgage calculator on the internet is a lead-capture form built
by someone who wants to sell you a loan, and all of them leave things out, Mello-Roos,
the supplemental tax bill, what insurance actually costs in California now, the fact that
FHA mortgage insurance never goes away, the difference between what a lender counts and
what actually leaves your bank account.

**Deliverable:** an Eleventy static site with a TypeScript engine that runs entirely in the
browser, plus a thin Cloudflare Worker for live rate data. Deployed to Cloudflare Workers
with static assets.

**Owner intends to publish** on Cloudflare (Workers + static assets), non-commercial, no ads,
no lead capture, no email gate. That last part is the entire point. Do not add one.

---

## 2. THE GOLDEN RULE: research before writing

**Never write a financial constant from memory.** Every number in `lib/data/` was verified
against a primary source before it was written down, and carries a citation in
`lib/data/sources.ts`.

This is inherited from the Codex Galdr project and it matters more here, not less. A wrong
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

- **`statutory`**, written into law. The 1% Prop 13 base, the VA funding fee schedule,
  the $7,000 homeowners' exemption, PMI auto-termination at 78% LTV.
- **`published`**, an agency's published schedule. FHA MIP rates, conforming limits.
- **`survey` / `market`**, a real observed average that moves. Freddie Mac's PMMS, California
  insurance costs.
- **`estimate`**, our default standing in until the user supplies the real number. PMI rate
  bands, county tax add-ons, closing costs, maintenance reserve.

When something is an estimate, say so **in the UI**, not just in a comment. The
`LineItem.warning` field exists for this. The insurance line and the Mello-Roos line both
carry loud warnings on purpose. Those are the two numbers most likely to be catastrophically
wrong for a specific buyer.

**Prefer an honest "we don't know, go look it up" over a confident fabrication.** If a county
has no specific tax rate on file, the engine says so rather than quietly using the fallback.

---

## 3. Layout

```
lib/                    the engine, pure TypeScript, no DOM, no I/O
  types.ts              ScenarioInput -> ScenarioResult, LineItem, Confidence
  amortization.ts       payment / balance / schedule / LTV milestones
  mortgage.ts           evaluateScenario(), the heart
  affordability.ts      the engine run backwards (binary search on price)
  recommendation.ts     the "should you buy it" answer: three gates, one verdict
  scenario-bridge.ts    THE ONLY join between a scenario and rent-vs-buy. See below.
  data/
    sources.ts          THE CITATION REGISTRY, every number traces here
    ca-loan-limits.ts   GENERATED from FHFA. Do not hand-edit.
    programs.ts         VA funding fee, FHA MIP, PMI bands, DTI ceilings, residual income
    ca-property.ts      Prop 13, county tax rates, insurance + closing cost defaults
    ca-rent-cap.ts      AB 1482 by CPI region, because the cap is not one number
    ca-insurance.ts     GENERATED. FAIR Plan premium and penetration by county
    ca-fha-limits.ts    GENERATED from HUD CHUMS. NOT the conforming limits, see below
    federal-tax.ts      standard deduction by filing status, SALT cap and its phase-out
  county-scope.ts       what the county selector does NOT change, said out loud
  insurance.ts          the county FAIR Plan reality check on the premium line
src/
  client/app.ts         browser wiring; bundled by esbuild to src/assets/js/
  index.njk             the form + result panels
  _includes/base.njk
  assets/css/main.css
  assets/fonts/         Fraunces + IBM Plex Mono, self-hosted. See below.
worker/index.ts         /api/rates (FRED, KV-cached) + static asset passthrough
tests/                  node --test, TypeScript run natively via type stripping
scripts/
  fetch-loan-limits.mjs regenerates ca-loan-limits.ts from FHFA's CSV
  fetch_fair_plan.py    regenerates ca-insurance.ts from FAIR Plan PDFs + DOF E-5
  fetch_fha_limits.py   regenerates ca-fha-limits.ts from HUD's CHUMS master file
  fetch_fonts.py        downloads the two typefaces so nothing is loaded from Google
  fetch_history.py      regenerates history.ts: 58 counties from FHFA + Zillow + Census
  build-client.mjs      esbuild bundle
  make-favicon.py       draws the icon PNGs and .ico
  make-og-image.py      draws the social card, from the same berry geometry
  demo.ts               prints worked scenarios to the terminal. Use it to eyeball output
```

### Commands

```
npm run dev        eleventy serve on :8080 (no /api. The rate fetch falls back)
npm test           304 tests, no watch mode needed, under a second
npm run typecheck  app tsconfig + separate worker tsconfig
npm run build      bundle client, build site
node scripts/demo.ts   print full worked scenarios. The fastest sanity check
```

Node 26 runs the TypeScript tests directly via type stripping. There is no TypeScript build
step and no test framework dependency. Keep it that way.

`pretest` does run `npm run build` first, because `tests/metadata.test.ts` asserts on the
BUILT `_site/` output rather than on the templates. That is deliberate: a Nunjucks variable
that silently resolves to an empty string produces a valid-looking template and a broken
`og:image`, and only the built file catches it.

The worker needs its own tsconfig because `@cloudflare/workers-types` conflicts with `DOM`.

---

## 4. The central design idea

The engine returns **two totals**, and the gap between them is the whole product:

- `lenderMonthlyTotal`: P&I + tax + insurance + MI + HOA + Mello-Roos. What underwriting
  counts, and what every other calculator shows you.
- `trueMonthlyTotal`, the above plus the maintenance reserve. What actually leaves your account.

`LENDER_COUNTED_KEYS` in `mortgage.ts` is what draws that line. Anything added to the model
must be deliberately placed on one side of it. A lender does not count maintenance, so it
must never silently inflate a DTI calculation.

Every `LineItem` carries a `basis`. A plain-English sentence explaining how the number was
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
- **VA gets the residual income test, not just DTI, and residual income GOVERNS.** California is
  in the West region, which has the highest minimums in the country. VA's 41% DTI is a guideline
  with no cap behind it. For a long time the engine reported the residual test and then enforced
  41% as a gate anyway, so a borrower at 45.2% DTI with $4,091 residual against a $990 requirement
  was failed and told they needed more income than they earn. `Qualification.passesDti` is now the
  loan's ACTUAL qualifying test and `dtiIsGuideline` says when the ratio is advisory.
- **The affordability search is a binary search**, because price feeds back into tax, insurance,
  PMI band, and the jumbo threshold. There's no closed form.
- **Known limitation:** the affordability search does not apply a jumbo rate premium when the
  answer crosses the conforming limit, so an answer above the limit is an upper bound. This is now
  SAID ON THE PAGE rather than only here: `maxAffordablePrice` returns `warnings`, and the browser
  renders them. It used to compute them and throw them away, which made the limitation invisible on
  the one number people screenshot.
- **An FHA loan is never a jumbo, and the conforming limit is not its limit.** FHA sets its own
  county limits, in `lib/data/ca-fha-limits.ts`, generated from HUD's CHUMS master file. Both
  agencies set a county at 115% of area median sale price capped at 150% of the conforming
  baseline, but FHFA floors at the baseline and FHA floors at 65% of it, so below the ceiling the
  two diverge hard: **Stanislaus is $832,750 conforming and $545,100 FHA.** `LoanFacts` carries
  both `conformingLimit` and `fhaLimit` on every scenario so the FHA branch can never reach for
  the wrong one again.
- **The supplemental tax bill warning fires on every scenario.** It is not modeled numerically
  because that requires the seller's old assessed value, which we don't have. Do not fake it.

### The history follows the county now

`lib/data/history.ts` is GENERATED by `scripts/fetch_history.py` and holds a price series
for **every one of the 58 counties**, not one San Diego series shown to everybody.

- 37 counties sit inside one of FHFA's 28 California metros and get a **quarterly** series.
- The other 21 get their own **annual** county series. Nobody gets somebody else's market.
- `historyFor(county)` returns the rows, the step in months, what the series measures, the
  splice month, and the dollar anchor. Callers never need to know the frequency.

**Why FHFA and not Case-Shiller.** Case-Shiller publishes three California metros. Permission
from S&P would not have fixed this, because the other 55 counties are not in it. FHFA is a US
government work, so it can also be committed to a public repo without asking anyone.

**The 1991 splice.** Each metro series is expanded-data from 1991 with all-transactions chain
linked before it. Expanded-data is the accurate one (it puts the 2008 crash at -41.9% against
Case-Shiller's -42%) but starts in 1991; all-transactions reaches 1975 but counts refinance
appraisals and reads that crash as -35%. The seam is real and disclosed in the UI.

**Anchors are Zillow ZHVI single-family, per county.** FHFA publishes an index with no units.
The anchor used to be one hand-typed San Diego median.

**Affordability panels start in 1984, not 1975.** Every figure on them is a ratio of price to
income, and the income series starts in 1984. Backfilling income made a 1975 house look like
13% of income and crowned it the best time to buy in history, which was an artefact.

**The labour indicator is STATEWIDE.** It used to be the San Diego MSA unemployment series,
shown to every county as if it were theirs and fed into their correlations. Statewide California
is the widest claim that is true everywhere.

**Buying power has not fallen everywhere.** Down 23% in San Diego, UP 27% in Fresno. Any copy
about the thesis has to handle both directions; `buyingPowerVerdict` does, and a test pins it.

### Prose is data too, and it rots the same way

A multi-agent audit in August 2026 ran every panel by **executing the code** rather than reading
it, and turned up 91 findings. Almost none were arithmetic. They were sentences that were true
when they were written and became false when the data underneath moved, mostly at the point every
county got its own history. The pattern is worth internalising because it will happen again:

- **A number written into a string is a number nobody will ever update.** "The milder of the two
  declines on record" (17 counties have one, 16 have three), "the 2008 crash was 42%" (24 counties
  fell further), "74 months, twice as long as 2006-09" (San Diego's own figures are 63 and 1.6x),
  "n=449" (a monthly-series figure on a quarterly series). Every one of these is now derived.
- **The tests pinned the wording, so they passed.** `assert.match(basis, /milder/i)` went green for
  months while the sentence was wrong in 34 counties. A test that asserts prose must assert the
  prose against the DATA, not against itself. The new tests in `tests/counties.test.ts` sweep all
  58 and check that no reading names a year that is not that county's own peak or trough.
- **Errors that flatter the argument are the ones to hunt.** The audit tagged every finding with
  `flattersTheArgument`, and roughly half did. The buying-power caveat had the direction of its own
  bias backwards. The forecaster verdict quoted the WORST model's 2008 prediction rather than the
  best one. "The anchor moves the dollar axis and nothing else" told a sceptical reader not to
  interrogate the input that sets the panel's biggest stat. None of these were arithmetic mistakes
  and all of them shaded the same way.
- **A slider that cannot reach its own preset clamps silently.** Merced's worst decline is 65.7%
  and the depth slider stopped at 50. Butte's twenty-year appreciation is -1.4% and the slider
  floored at 0. Both produced a plausible wrong number rather than an error. Widen bounds at render
  time from whatever the data contains.
- **Two inputs for the same quantity will disagree.** The page asked for rent twice and defaulted
  them to $2,750 and $3,290, and the higher one drove the waiting verdict. Mirror one from the
  other unless the reader deliberately changes it.

### The prose lint: tests/prose.test.ts, and why it is the real fix

The three audits kept finding the same thing, so the fourth pass built a machine
for it. `tests/prose-surface.ts` RUNS THE ENGINE for a county and collects every
sentence it renders. `tests/prose.test.ts` then checks each string against the
DATA it is about, across all 58 counties: no sentence may name a year the
county's own history cannot justify, claim a decline count it does not have,
describe the quarterly/annual series as monthly, quote a dollar figure that
differs from the one it derived, or name the wrong county.

This is different in kind from `assert.match(basis, /milder/i)`, which passed for
months while wrong in 34 counties because it checked the wording against itself.
The lint checks wording against data, so a new sentence is covered the moment it
exists. When you add a panel, add its strings to `prose-surface.ts`; a coverage
test fails if the surface stops reaching a panel.

The browser layer (`src/client/app.ts`) needs a DOM and cannot be run this way,
so it gets a narrow STATIC lint in the same file: no hardcoded county name in
copy (with a tiny default-deny allowlist for the forecaster's genuine San Diego
disclosure), no `${...} monthly declines` on a quarterly series, no hardcoded
peak/trough year. Validate changes with the mutation script in scratchpad:
reintroduce a bug an audit found and confirm the lint goes red. It runs from a
GREEN baseline only, because a red baseline reports every mutation as caught.

### Should you buy it? `lib/recommendation.ts`

The panel used to refuse to answer ("Not a yes or no: that depends on
assumptions nobody can pin down"). That is true of the rent-versus-buy half and
FALSE of the two gates that stop most purchases: will a lender lend, and is the
cash there. Both are arithmetic. `recommend()` returns a clear `yes` /
`conditional` / `not-yet` / `no`, the binding number in the headline, the reasons
most-binding-first, what would change it, and caveats that are never dropped
(they travel as data, so the UI cannot render the answer without them). The one
genuinely uncertain gate, rent-versus-buy, is the only one whose answer is
hedged, and the hedge names the assumption rather than gesturing at it.

The deposit timeline it quotes models RENT RISING: saving capacity evolves as
`savings*(1+wage) + rent*(wage - rentGrowth)`, derived not fudged, so a renter
whose rent outruns wages closes the gap slower. `LONG_RUN_WAGE_GROWTH` is the
3.51% figure from the income series, which sits on top of the 3.5% default rent
growth, which is why the deposit race is a genuine race.

**Buying wins a WINDOW, not a finish line, and the whole decision surface asks
"ahead AT your hold year" not "did it ever cross".** When the investment return
you give up (10%) exceeds the appreciation you buy (6.5%), the renter's invested
capital eventually outcompounds the house: owning pulls ahead in the middle
years, then renting reclaims the lead. `breakevenYear` is only the FIRST
crossing, and reading it as the answer said a plain "yes" for a 30-year hold that
ends $2.5M behind. `compareRentVsBuy` returns `buyWindow: {start, end}`;
`buyMinusRentAt(result, holdYears)` is the honest test and every consumer routes
through it (`decide.worthIt`, `maxPriceForHoldPeriod`, `requiredRate`,
`requiredRentalIncome`, the recommendation's third gate, the chart markers, the
verdict colour). A consequence worth not un-learning: `maxPriceForHoldPeriod`
PEAKS around year 10 and then FALLS, because a longer hold lets the renter
compound further ahead. A test pins that it is not monotonic.

### The sharpest claim on the site: `lib/where-it-works.ts`

"Housing outran wages" is true in 24 counties and FALSE in 34. That sounds like it weakens the
thesis until you see which counties are which: the ones where a median income still buys are
Lassen, Modoc, Trinity, Siskiyou and Sierra. **Affordability did not leave California, it
relocated to where the work is not.**

Measured against each county's OWN income (Census SAIPE, not the statewide figure):

- pay vs housing multiple: **r = +0.71**. The better a county pays, the worse its multiple.
- pay vs home price: **r = +0.91**. Prices absorb pay almost completely.
- ten best-paying counties: ~$120,000 income, ~10.6x housing
- ten worst-paying: ~$59,000 income, ~5.7x housing

The raise does not get you in, it gets bid away. Every one of those figures is computed at
render time, never written into prose, and pinned by tests.

**Two panels, two different questions, do not blur them.** `buying-power.ts` measures STATEWIDE
income against local prices: "could a typical Californian buy here". `where-it-works.ts`
measures LOCAL income against local prices: "can the people who work here afford to live here".
Copy that blurred the two once claimed incomes had kept up with prices in Fresno, which the
statewide series cannot support. A test pins the distinction.

**It is a snapshot, not a trend.** It cannot see jobs arriving or leaving, and the caveat says
so. Do not let copy imply a direction this data cannot measure.

### Insurance: what we can and cannot say by county

**Do not synthesise a county premium.** No agency publishes an admitted-market county
average. The Department of Insurance runs an interactive quote tool rather than a dataset,
and the aggregators that do publish city tables will not say where their numbers came from.
A county multiplier invented to make the line look precise is exactly the failure this
project exists to avoid, so the premium itself stays a statewide estimate, flagged as one.

What IS published, quarterly, by the body that writes the policies, is the FAIR Plan's own
book: policy counts and written premium for all 1,662 California ZIPs, split by wildfire
risk band and policy category. So the county fact we state is not "your premium will be X",
it is "this many of your neighbours could not get a normal policy, and this is what they pay
instead". On a California house that is the more decision-relevant number: Tuolumne is at
48% of detached homes on the FAIR Plan, Sacramento at 0.3%, and the average premium runs
from $669 in Imperial to $7,655 in Napa.

`scripts/fetch_fair_plan.py` refuses to write unless the parse reconciles exactly to the
policy and premium totals printed on the source PDFs and finds all 58 counties. A silent
partial parse would understate the risk in precisely the counties where it matters most.

### All 58 counties, and the line between them

The county selector is at the top of the form, so everything reachable from it has to be
county-aware, and `tests/counties.test.ts` runs all 58 through the engine, the affordability
search and the whole rent-versus-buy surface.

**Follows the county:** the conforming loan limit (FHFA, all 58), the property tax rate (24
real ones, 34 on a statewide fallback that warns it is one), the AB 1482 rent ceiling (five CPI
regions, not one number), and everything downstream of those.

**Does not, and cannot:** the price history, the cohort panel, the crash signals, and the
thesis panel. Every one of them now uses the reader's own county.

`countyScope()` states the RESOLUTION on the page rather than apologising for showing the wrong
place: quarterly for a county inside a metro, annual for a rural one, and where the chained index
has its seam.

**When adding anything county-dependent, do not hardcode a San Diego constant as a fallback.**
Two panels had `?? 0.0115` where they meant `?? countyTaxRate(county)`, which is invisible: it
produces a plausible number for Fresno rather than an error.

### The bridge, and why it exists

`lib/scenario-bridge.ts` is the only code allowed to turn a `ScenarioResult` into rent-vs-buy
inputs. Everything downstream, the itemised comparison and every price sweep, comes out of one
`bridgeScenario()` call.

This is not tidiness. Two adversarial audits found the same class of bug four separate times:
the browser layer built the itemised path and the sweep path in two blocks of code, and they
drifted. Mortgage insurance was added to one and not the other. Closing costs were real on one
side and a flat 2.5% on the other. The financed VA funding fee was in one loan balance and not
the other. The page told you the same house passed and failed, in two cards inches apart, with
every test green, because the tests pinned the engine and nothing pinned the join.

`tests/scenario-bridge.test.ts` now asserts the two paths agree to the dollar across every loan
type and deposit band. **If you add a cost, add it to the bridge**, and the test fails until it
reaches both sides.

Two related rules the bridge enforces:

- **Scaling rates are derived as residuals of the real itemisation, not recomputed.** The
  homeowners' exemption is a fixed dollar credit, so it belongs in `fixedMonthly`. Deriving it
  makes the agreement exact rather than close.
- **`requiredRate()` returns the HIGHEST rate that still works, and `null` is the only failure.**
  It is not a threshold. Reading it as one put "works at any rate" and "works at no rate" in the
  same branch, and printed the failure sentence for both. A result at or above `RATE_SOLVER_CEILING`
  is saturation, not an answer; say so rather than printing "you need 14.97%".

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
| Insurance premium      | market survey                        | flagged `estimate`, STATEWIDE; volatile, warn loudly |
| FAIR Plan by county    | cfpnet.com quarterly ZIP reports     | `npm run data:insurance`, quarterly                  |
| FHA county limits      | HUD CHUMS `cy<YEAR>-forward-limits`  | `npm run data:fha-limits`, annually each December   |
| AB 1482 rent caps      | BLS regional CPI / DIR state CPI     | every May, effective each 1 August                   |

FHFA renames their CSV every year. `scripts/fetch-loan-limits.mjs` has `YEAR` at the top and
refuses to write the file if it doesn't find exactly 58 California counties.

Secrets are never in `wrangler.toml`. `npx wrangler secret put FRED_API_KEY`
(free key: https://fredaccount.stlouisfed.org/apikeys).

---

## 6a. The history modules

`lib/data/history.ts` is GENERATED (`npm run data:history`) and holds a price series for every
California county: metro quarterly where one exists, county annual otherwise, joined to Freddie
Mac's 30-year average. See section 5 for the sources and the 1991 splice.

- `lib/history.ts`, drawdown detection, the payment-over-time series, and `evaluateWaiting()`,
  which answers "should I wait for a crash" including the costs waiting advocates leave out
  (rent paid, principal not paid down) and the benefit nobody counts (a permanently lower
  Prop 13 basis).
- `lib/cohort.ts`, `compareToCohort()` prices the same house at an earlier date via the
  repeat-sales index and decomposes the monthly gap into rate / loan-size / Prop 13. The
  decomposition is asserted to sum to the total in tests; keep it that way.

**Two findings from this data that must not be flattened in the UI:**

1. **Price is not payment.** A 2021 peak buyer in San Diego paid about what a 2006 peak buyer
   paid, because the rate was 2.84% instead of 6.24%. Any "wait for prices to drop" framing that
   ignores rates is wrong. Those two figures are **San Diego's**, so the UI derives the equivalent
   pair from the selected county rather than printing them.
2. **Prop 13 raises the break-even rate.** At a 20% crash, P&I at 9% roughly cancels 6.66%, but
   the permanently lower assessed value still tips the decision toward waiting. This surprised
   the model's author and there is a test pinning it (`Prop 13 pushes the break-even rate higher`).

### No third-party requests, and that is load-bearing

The page fetches **nothing** from another origin. Fonts used to come from Google, which handed a
visitor's IP, user agent and referrer to an ad company on every view, under a footer promising
"nothing is sent anywhere". Both families are OFL, so they are committed under
`src/assets/fonts/` (latin subset only, 165 KB for all four files) and refreshed with
`npm run data:fonts`.

`tests/metadata.test.ts` asserts this against the BUILT output: no `<link rel=stylesheet|preload>`,
`<script src>`, `<img src>` or CSS `url()` may point at another origin. **Do not add an analytics
snippet, a CDN script, or a font link to get around a build problem.** The test will fail, and it
is meant to.

### Charts

`src/client/chart.ts` is a dependency-free SVG line chart. **Never make this a dual-axis chart**,
price and payment get two stacked small multiples sharing an x-axis. That rule is the whole reason
the module exists; a dual axis would hide the divergence that is the point. Single series per chart
means no legend (the title names it). Palette is slots 1–2 of the dataviz reference palette
(`#3987e5` blue, `#d95926` orange), validated against this site's `#0f1620` surface, re-run
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
the pre-registered criteria, that changes. Nothing else does.

## 7. Planned, not built

- **Visual design pass.** The current CSS is deliberately restrained scaffolding. The owner's
  reference is `codex.doyled-it.com`, hand-written CSS custom-property theme systems, dark
  and textured, `clamp()` typography, gradient rules, hover glows, no framework.
- **Listings.** Zillow's public API died in 2021; Bridge Interactive is ~$500/mo and requires
  MLS affiliation. The plan is RentCast's free tier, **50 calls/month**, which is the binding
  constraint. The KV cache in `worker/index.ts` exists to make that survivable: shared across
  all visitors, long TTLs, stale-rather-than-fail. Never put a metered API behind an uncached
  path.
- Amortization/equity chart, scenario comparison, shareable permalink state, CalHFA
  down-payment-assistance programs, earthquake insurance (CEA) as an optional line.

---

## 7a. Licensing

**AGPL-3.0-only**, in `LICENSE`, fetched verbatim from gnu.org. Chosen over GPL because
almost nobody distributes a web app: they run it on a server and hand you HTML, which plain
GPL says nothing about. AGPL section 13 is the clause that reaches a modified version running
as a website.

**The AGPL covers the code, not the data.** `lib/data/history.ts` and `data/panel.json`
contain S&P CoreLogic Case-Shiller index values, and S&P prohibits reproduction without prior
written permission; FRED states explicitly that API access is not that permission. Permission
has NOT been requested. If it needs solving, the FHFA House Price Index covers the same metros
as a US government work with no such restriction, and `scripts/fetch-history.mjs` is the only
file that would change. Everything else in `lib/data/` is a government work or published
public statistics. The README carries the table.

---

## 8. Tone

The owner swears, hates being marketed to, and wants the number that is true rather than the
number that is comfortable. Write UI copy accordingly: direct, specific, no hedging into
uselessness, no "consult a professional" boilerplate padding. Say the hard thing plainly,
"this never goes away," "the least reliable number on this page," "invisible on Zillow."

But never let attitude substitute for accuracy. The voice earns its keep only because the
numbers underneath it are sourced.
