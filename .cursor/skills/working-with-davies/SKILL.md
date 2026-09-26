---
name: working-with-davies
description: How the owner of daviesportfolios works, what he means by done, and the mistakes past sessions already paid for. Load at the start of every session on this repo — before chart maths, Investment Performance / vs-S&P, the lot ledger, Trading 212, earnings, heatmap/tactics/top-movers numbers, or anything that puts a number on screen. Also load before pushing, whenever he says a number is 不对, asks for verification, or brings back a review from another AI.
---

# Working with Davies on daviesportfolios

`.claude/CLAUDE.md` has the mechanical rules (git identity, gates,
README, Edge Function deploys, container caveats). This is the part
that is not mechanical: what he actually asks for, what he accepts as
an answer, and the mistakes that have already cost a round trip.

Distilled from the Claude Code sessions archived in `docs/handover.md` (67 turns,
2026-07-20 → 2026-08-18). Prefer this skill over re-reading that file
unless you need a specific measurement or the exact wording of a
request. The transcript contains live balances; the repo is private.

## Language

He writes in Chinese. Reply in Chinese — EVERY reply, including the ones
that answer a stop-hook message, a background-agent report or a CI
notice, which are exactly the turns where English slipped out twice
(2026-09-22: "怎么又忘记了"). It includes the one-line progress notes
between tool calls, and it survives a context compaction: the resume
summary is written in English and the replies after it drifted into
English with it, a third time (2026-09-23: "这个会话怎么又变成英语了"),
and a fourth the same day ("怎么会话又变成英文了"), which is why the rule
now also opens `CLAUDE.md`: that file is loaded whole on every turn, and
this one is cut short at a compaction. The first line after any resume
is written in Chinese. Code, comments,
commit messages, everything committed to the repo, and every word the
website shows stay in English — a Chinese fund name in the holding list
counts as the website.

## What "done" means to him

**Push it.** "直接改好直接推main" — fix it and push to main, don't come
back for permission. He is not looking for a plan or a set of options;
he is looking for the thing to be fixed. Ask only when two readings of
his request lead to genuinely different work, and then ask once, with
the consequences of each spelled out. Cursor included: push `main`
directly, do not open a PR. Open one only when he explicitly wants
Codex (`@codex` only reviews PRs).

**All gates green, every time.** `npm test`, `npm run typecheck`,
`npm run build`, plus `npm run lint`, `npx knip` and `npx size-limit`
(all three are hard CI gates) — in `src/`, the web app's npm project —
plus `npx --yes deno@1.46.3 test --allow-env supabase/functions/` (Deno
1.x, as CI) when an Edge Function changed. `sh bin/gates.sh` runs every one of them in CI's
order, from anywhere in the repository. Green means green — he will
notice a red main.

**The docs are part of the change**, not a follow-up: a file, function,
migration or feature that comes or goes updates its one-line row in
`docs/map.md` (and `docs/guide.md` when a user sees it) in the same
commit; a test fails on a file with no row. The README
is the one-page public front he uses in interviews (2026-09-22). He had
it cut from 275 KB to 10 KB on 2026-09-23 and asked for it to read as if
he wrote it himself: first person, plain words, clear logic, no AI feel.
Keep it one page; detail goes to `docs/map.md`. No figure from the real
book goes into any of them — no balance, position value, share count,
lot price or dollar P&L; say what the engineering does in neutral words.

**Usage is a budget he watches.** Never spend the main model on
polling: no scheduled PR re-checks, no "quiet hold" wake-ups on
Fable/Opus-class sessions. If a check is genuinely needed, run it in a
cheap subagent (Opus 5 at most) and wake the main session only when
there is real work to do. He said it in so many words on 2026-09-20
after four re-checks found nothing: "以后千万不要用fable模型跑这个复查".

**A pin test for every bug fixed.** A fix without a test that fails on
the old code is not finished.

**An open PR's description is maintained, not written once.** Every
push that changes the diff rewrites the summary in the same step, and
hands him the Cloudflare preview link so he can check it on a real
machine. He reads a PR description as the current state of the branch:
while it still describes work that has since landed on `main`, that
work reads as unreviewed and outstanding. Take landed work out of the
summary AND out of the branch — rebase onto `main` rather than merging
`main` in, or `main`'s commits show up in the PR's own commit list.
CLAUDE.md's "Pull requests" section has the mechanics, including how
the preview alias is derived and how to verify it.

**Finish the remaining work without being asked again.** When the
Supabase connector is on, or he says "把你还没做的全做完", do the rest
of the list — migrations, Edge deploy, docs, tests — in the same
pass. Don't stop at a design and wait.

## What he accepts as evidence

This is the single biggest thing. **Reasoning is not evidence.** Several
rounds were lost to confident, wrong diagnoses stated before anything
was measured (a service-worker cache; network blocking; both wrong).
What works:

1. **Closed-form arithmetic.** Build a fixture whose right answer you
   can compute by hand, then compare what the app renders against the
   arithmetic — not against another part of the app.
2. **Counterfactual runs.** Revert the fix, re-run the harness, show it
   fails. A harness that passes both before and after proves nothing. He
   responded well to "the same fixture reads +247% with the carry
   removed".
3. **Browser harnesses against the production bundle.** Playwright +
   `page.route` interception, serving the built `index.html`. Read
   values back out of the DOM — including inverting the SVG y-axis from
   the printed tick labels to recover a line in dollars. Several bugs
   were only visible this way. "真机测试" and "大量真机测试" mean this,
   not a unit test that the mock already agrees with.
4. **A matrix, not one case.** Ranges × scenarios × data states. Two
   panels × five ranges × (no samples / two samples / a full day) is
   the shape of check he wants, not "I opened 1D and it drew a line".

Harnesses from past sessions worth rebuilding: a flat-book test (a
portfolio that doesn't move must draw a flat line and read 0.00% on
every range), a shape comparison (two charts of the same quantity must
have the same point count and the same normalised shape), a preload
test (the panel must paint within ~120 ms of opening, never an empty
state), and a weekend/Monday fixture (the previous close is three days
back). Weekend 1D having fewer points because S&P futures start Sunday
23:00 UK is expected, not a bug.

**Watch your own fixtures.** More than once a "bug" turned out to be a
mock whose snapshot values described a different portfolio than its
mock ledger. If a result looks wild, check the fixture is internally
consistent before believing it.

## What he counts as a bug

**Two numbers for the same thing on one screen.** This is his most
consistent complaint and it is always worth treating as a defect, even
when each number is defensible on its own:

- The vs-S&P chart's 24H PORTFOLIO will not equal the scoreboard's
  DAY CHANGE, and its S&P line will not equal the Market Conditions
  card — those were the previous-close reading, and he dropped it.
  Don't "fix" 24H back onto yesterday's close.
- The Investment chart's Value must equal the scoreboard's PORTFOLIO.
- With deposits flat, the Investment value line and the vs-S&P
  portfolio line must have the same shape and the same reading.
- Heatmap tile, tactics chip, and Top Movers row for one ticker must
  show the same % (they share `pctIsFlat` / `displayTicker`).
- Heatmap % and the ticker-modal % must agree in premarket / after
  hours when that listing is actually trading. A Stuttgart name
  (`2DG.SG`) trading in Europe is not "0% because US RTH hasn't
  opened".

The structural lesson, in his words: the Investment chart's value
"就是现成的vs 500图中portfolio的数据". Don't write a second
implementation of a quantity that already exists — call the same
function on the same grid. Two independent reconstructions drift, and
did.

**A number that is not what a person would mean.** Money paid in is not
a gain. A reconstruction is not a record. A holding whose price is
unknown is not a holding worth zero. A first-open refresh that takes
20 s while the next in-page refresh takes 2 s is the same bug every
time you reopen the tab.

## Domain rules already settled

Changing any of these means re-opening a decision he has already made.

### Charts — vs-S&P and Investment Performance

- Every range rebases both lines to 0% at the window's first point,
  including the shortest range. That button is labelled **24H**
  (internal key still `1D`; the ticker modal still says 1D). There is
  no DAY / 24H toggle and no previous-close reading on this panel — a
  trailing 24 h is the only 1-day view. He first asked for a literal
  trailing 24 h, then for both, then dropped the DAY reading. Don't
  put the toggle back.
- No previous-close basis is forced on any range, 24H included: every
  window is anchored at its own first point, so the basis at that point
  equals the value there and the reading is the window's move
  (`perf_chart.jsx` explains why — forcing `prevCloseBasis` on 24H once
  read +14.81 % where the Investment view of the same window read
  +16.00 %). Don't bring it back to "make it match the scoreboard".
- 1W is a real trailing week, not "since last Monday" or a coarse
  bucket that erases the series.
- 1D is one point per five minutes over the window. Extended-hours on
  or off, the time window and the benchmark (cash index vs futures)
  stay in lockstep — the title and legend both flip to FUTURES when
  the toggle is on.
- Investment Performance lives in the same panel slot, as the second
  of two tabs (VS S&P 500 | INVESTMENT — the heading is the switch). Value
  is the vs-S&P portfolio series in dollars; Net deposit is money paid
  in (steps, not spikes). The legend shows each line's move over the
  window as a %, not a "gain" figure. Axes, grid and crosshair match
  the other chart.
- On 1W / 1M / 3M / YTD, overlay 5-minute snapshots onto the vs-S&P
  timestamp grid. Do not concatenate them: index spacing gives every
  point equal width, so a day of 5-minute samples stretched "today"
  across half the chart. 24H is already on that 5-minute grid.
- Both panels are in the preload path. Opening either must not cold-
  fetch. A panel that paints "Insufficient data" and then fills in is
  not preloaded.

### Pricing history

- A missing bar carries the series' **first known close backwards**.
  Never interpolate from lot cost — that invents a move the stock never
  made (CN funds and `.PVT` were the exhibits).
- A holding with no price history at all counts **flat**, in both value
  and basis. Dropping it removes it from the portfolio entirely.
- A holding with no lots is "owned, date unknown", not "not owned".
  Don't back-fill `2025-01-01` — that turns an in-year buy into a
  pre-year lot and wrecks YTD. Today, or unknown and out of YTD.

### Provenance

- Recorded 5-minute snapshots progressively replace the derived
  history; the derived stretch is drawn faded with a dotted rule at
  the handover and a `~` on the crosshair. He asked for this
  explicitly. Sampling is the `snapshot-record` Edge Function on
  pg_cron, 24/7 every 5 minutes — not "leave the tab open". Only the
  24H window keeps 5-minute density; the daily prune coarsens older
  rows (30 min / 1 h / 4 h / 1 day) the same way overnight-points
  thins, without a 30-day wipe that would erase the 1M / 3M / YTD
  replacement series. The admin tab is a US-RTH backup writer only.
- Never record a snapshot while an FX pair is missing — `fxRateToUSD`
  falls back to 1:1 and a CNY position lands at seven times its size,
  permanently, in a table. A one-sample jump that reverts the same day
  with no deposit is this bug, not a real deposit.
- Deposits are steps, not spikes.

### Migrations

- `migrations.yml` runs `supabase db push` on every push to main that
  touches `supabase/migrations/**`. Pushing the file IS applying it.
- Never apply the same SQL out of band as well. The MCP connector
  records a version under its own timestamp name; the dashboard SQL
  Editor records nothing. Either one desyncs
  `supabase_migrations.schema_migrations`, and then *every later push*
  fails outright with "Remote migration versions not found in local
  migrations directory". This has already happened — it cost a day of
  red main and a migration that never reached prod, while I told him
  twice to paste the SQL in by hand.
- Read `supabase/migrations/README.md` before touching migration state.
- If a workflow run is the thing that applies your change, go and read
  the run. Pushing is not the same as landing.

### Trading 212

- The positions endpoint has no dates; `/equity/history/orders` does.
  Real fills beat the synthetic lot. Never re-date a lot to today on
  every sync — that made the whole book look bought this morning and
  dumped the deposit line.
- The API key is already in Supabase secrets and is reused as-is. It
  already has Portfolio, History: orders, and History: transactions.
  Do not tell him to regenerate it. A 403 on history is not a
  missing-scope prompt.
- History items are nested `{ fill, order }` (fill.id / fill.price /
  fill.quantity / fill.filledAt, order.instrument.ticker / order.side).
  ISA pages also arrive as `{ order }` with no fill (cancelled / never
  filled have nothing to fill). A flat ticker/filledQuantity shaper
  parsed every page to 0 rows and still advanced the cursor, walking
  the history into the void. Don't advance the cursor when the
  envelope itself is unknown. Do advance when every item is a
  recognised order envelope that simply didn't produce a storeable
  fill — freezing that parked the ISA walk and blocked cash history.
- T212's public account-summary API does not expose the app's `Net
  deposits` field, and the transactions endpoint mixes T212 Card cash
  activity into deposit/withdraw rows. Investment Performance therefore
  uses actual fills: quantity × fill price on `filledAt`, with sell
  proceeds subtracted. Card top-ups/spending never move Deposited.
  Fills are read from `t212_orders` but NEVER written over the user's
  lots/sells; a same-ticker other-broker ledger stays intact. When an
  old machine ledger is shorter than `h.shares`, stand in the missing
  slice at board AC before every chart window. Native→USD deposit FX is
  frozen once; Portfolio value keeps live FX.

- **He holds the same ticker at Trading 212 and elsewhere.** SPCX,
  RKLB and HOOD all are. A board position LARGER than the broker's is
  the other platform's shares — never stale data to be corrected. On a
  ticker's first sync keep `max(0, board − broker)` and add the broker's
  slice on top; from then on the `t212Shares` tag means only that
  slice's delta moves. Taking the broker as the whole position deleted
  71 / 11.5 / 30 shares from a live book, and bought nothing: a
  sold-out holding still comes back whole under the conservative rule.
- **A skipped fill must not park the walk.** One page item the shaper
  can't read is not an unreadable page. Freezing on that held both
  account cursors still for the whole life of the feature — ISA stored
  nothing at all — and because the walk never latches `complete`, the
  top-up pass that fetches today's fills never ran either. Freeze only
  when NOTHING on the page parsed.
- **A negative fill quantity is a sale, not a broken row.** Live pages
  carry them. `order.side` is the authority when stated; the sign
  decides only when it isn't.
- **Fills are shown, never merged.** The lot editor lists the broker's
  fills for the ticker, ticks the ones the ledger already has, and
  folds the rest in only when he clicks. Every data loss in this repo
  came from a sync deciding it knew better.

- **Only `VUAA.L` / `SAEM.L` may take the broker's quote as
  `lastPrice`.** Their Yahoo feed lags 15-20 min; every other holding's
  is live. Letting it widen with the sync made
  `applyTrading212NightPrice` compare the broker's quote against itself,
  and the whole extended-hours board read 0.00 %.
- **A probe that mocks the thing you're debugging proves nothing.** The
  first attempt at that bug returned an empty `holdings` map, so the
  overlay had nothing to overwrite and it couldn't reproduce.

### Labels and other surfaces

- `displayTicker('2DG.SG')` (and `.F` / `.DE` / bare `2DG`) is `SIVE`
  on the heatmap, tactics board, and Top Movers. Only the ticker-detail
  modal keeps the listing code.
- Upcoming earnings: current holdings only (sold / deleted names
  drop). Append the fiscal quarter (`RKLB FY26Q2`) — fiscal year ≠
  calendar year, don't infer it from the date. An announcement stays
  on the list until midnight of that calendar day, even after the
  print.
- Quantity inputs: typing `.5` becomes `0.5`. Don't eat the leading
  dot.
- Heatmap layout: never produce skinny vertical strips. Do **not**
  treat "three tiles" as a reason to force a horizontal stack — he
  reverted that. Fix the strip in front of you, not a general layout
  theory.

### Ledger edits

- `portfolioUserFingerprint` includes `sells` (date/shares/price/ts)
  and `closed`. A closed holding whose sells change must dirty the
  fingerprint or the debounced save is a silent no-op.
- Adding a ticker that already exists is append-a-lot, not wipe-lots-
  and-replace-with-today, unless the user explicitly picks Replace.
- `addHolding`'s `buyDate` is a real argument. Grep every call site
  when the signature moves.
- Confirm dialogs: Cancel / Esc / overlay click abort and write
  nothing. Cancel is not the destructive branch of a three-way choice.
- `replace` restates the position through `netPosition` (or clears
  lots *and* sells and `closed`). Don't leave the board showing the
  typed shares while the ledger still has old sells.

- **Saving the lot editor recomputes `shares` from the rows.** On this
  book that is destructive by default: 16 of 26 holdings carry lots
  short of their board count, so Save on RKLB would drop it from 160 to
  30. The editor warns when the rows don't account for the board's
  shares. Don't remove that warning; don't add a code path that saves
  a ledger without it.

### Security / Edge

- `prices` / `chart` / `fundamentals` are token-gated like `data`.
  CORS `Access-Control-Allow-Origin` is not a security boundary — it
  does not constrain curl. He accepted that disagreement with another
  AI's review. Don't "fix" CORS as if it were the control plane.
- A new API key is verified READ-ONLY before anything depends on it,
  from where the secret lives (a deployed probe action fired with the
  Vault `cron_secret`), and the record goes in the reference doc: which
  account the key sees, the key's form, a signed call with a query,
  each transport's answer shape. Kraken's `AddOrder validate=true`
  proves trading permission without an order; Revolut X has no dry run,
  so its first live order is the test and needs his confirmation. The
  2026-09-20 probes found the sub-account isolation and the Kraken
  account's currencies (USDC / GBP, not USD) before a line of the loop
  could act on either.
- Don't refactor `app.jsx` into hooks, and don't stop committing the
  hashed bundle, unless he asks. Both were offered as P2 cleanups and
  explicitly deferred.

### Cold start and preload

- The first refresh after opening the page must be in the same 2–3 s
  band as an in-page refresh. In-memory proxy backoff that resets on
  reload is not a fix. CN-fund proxy fallback is backgrounded; the
  rest of the board must not wait on it.
- Extended-hours MC cards must not sit at `0` and then populate.
  Prefetch both ext-states' 1D caches so toggling the switch is a
  cache hit.

## How he iterates

He pastes a screenshot, says "数据出问题了" / "还是一样" / "还是不对",
and expects a new measurement, not a restatement of the last answer.
"最新版main还是一样" means the fix did not land where he is looking —
check the deployed bundle / service worker, not just that CI was
green. Don't explain why the old number was defensible.

He will send another AI's review. Take it seriously, apply what you
agree with, and disagree in writing with the reason when you don't
(the CORS example). Then pin-test the findings you take, and pin-test
  that your own diff did not eat `buyDate` / remap Cancel / bypass
  `netPosition`. He has already said
  "以后你犯的这种问题和错误一定不能再出现".

Do not "fix" something he did not point at. A heatmap layout change
was reverted wholesale because it addressed a different problem than
the one in the screenshot.

## Mistakes that have already happened here

Read these as a checklist before pushing.

- **A store that never reached the disk passed every test.** The chart
  store's `ytd` and `maCache` object stores were never created: idb-keyval
  makes a store only when its database is new, and all three stores shared
  one database. From May to September the vs-S&P chart's bars and the
  moving-average history lived in memory only, so every reload said
  "Computing…" and then drew a flat line. Every unit test passed, because
  the tests ran without IndexedDB. A cache is proven by reading it back
  after a real reload in the browser sweep, not by a test that mocks the
  storage.
- **Rewiring a callback and dropping an argument.** A 5-argument call
  landed on a 4-parameter handler and `buyDate` vanished.
- **Not asking where the default path lands.** Cancel and Esc were
  mapped to Replace.
- **Bypassing the shared helper.** A `replace` path recomputed totals
  itself instead of going through `netPosition`.
- **Reusing a class so two controls answer to one selector.** The Top
  Movers window row borrowed the chart's `.perf-range-btn` to inherit
  its look. A `:visible:text-is("1M")` click then hit whichever came
  first in the DOM: the chart on desktop, the SIDEBAR on a phone. The
  sweep was fully green on desktop and failed four checks on phone.
  Share the CSS rule, never the class — and a green desktop run is not
  a green run.
- **A CSS class collision restyling another component.** Investment
  legend rules reused `perf-` names, sat later in the cascade, and
  silently changed the vs-S&P legend's dots. Prefix new component
  styles.
- **Two implementations of one number.** The most expensive class of
  bug in this repo.
- **"Fixing" something he asked for.** See the heatmap revert.
- **Hook order.** `InvestmentChart` has an early return for the
  insufficient-data state; every ref and effect must sit above it.
  This app has shipped React error #310 once already.
- **Diagnosing from theory.** Service-worker cache and "network
  blocked" were both confidently wrong. Measure.
- **Stopping at "the panel will load when opened".** If he said
  preload, the empty state on first open is the bug.

- **Inferring a global rule from one sentence about two tickers.** He
  said GOOG and PLTR are both held in his two T212 accounts. That
  became "T212 is authoritative for every ticker", which deleted the
  non-T212 half of three other positions. Ask what a statement covers
  before generalising it into a sync rule.
- **Shipping a rule that wasn't needed for the bug it was justified
  by.** The overwrite was defended as the only way to bring PLTR back.
  It wasn't — the conservative rule restores PLTR identically. Check
  that the risky half of a change is actually load-bearing.

- **Shipping a client change ahead of the server that has to accept
  it.** A Cloudflare preview always talks to the PRODUCTION Edge
  Functions — there is no preview backend. The branch started sending
  `X-App-Token` to `prices` / `chart` / `fundamentals` before those
  functions listed it in `Access-Control-Allow-Headers`, so the
  browser's preflight killed all three. Order it: allow-list first (it
  requires nothing of anyone), client sends second, enforcement last.
- **Three quiet fallbacks made one bug look like three.** He reported a
  scoreboard that disagreed with production, market conditions that
  would not load, and YTD history that disagreed with the shorter
  ranges. One missing header. Every one of those callers catches its
  own failure and degrades silently, so nothing said "blocked" — when
  several surfaces go wrong at once, look for the shared dependency
  before debugging any of them.
- **Deploying only what the workflow watches.** `edge-functions.yml`
  matched `<fn>/index.ts`, so a change to `fundamentals/_shared.ts`
  shipped everywhere except `fundamentals`. Green CI is not a deploy —
  check the thing actually serving the request.
- **Sweeping the restated constants and missing the derived one.**
  Moving 1W to 15-minute bars updated the five places that SAY how long
  a 1W bar is, and left `maBarsFor`'s own `{'1W': 13}` bars-a-day
  literal behind, so a line labelled "MA 5" covered two and a half
  days. Restated constants are greppable; derived ones are not. After a
  cadence change, hunt for what is COMPUTED from the cadence, and
  prefer deriving it from the one source over adding a sixth copy.
- **Probing a resource to prove it is exposed — on a CDN a request is
  a write.** Fetching `/handover.md` five times to measure the leak
  cached the real file at Cloudflare's edge for seven days, so it kept
  being served after the origin was fixed. Every path never fetched was
  clean. Measure with a cache-busting query string, or on a sibling
  nobody has touched.
- **Reading a status code as evidence that a path is blocked.**
  Cloudflare Pages does not 404 an unmatched path — it serves
  `index.html` with a **200**. So a repo being published and a repo
  being blocked return the same code, and `curl -o /dev/null -w
  '%{http_code}'` cannot tell them apart. A whole verification pass was
  wasted concluding a working fix had failed. Compare CONTENT: fetch the
  path and look at the first line.
- **Trusting a conclusion written in a comment over a test.** Both
  foreign-exchange gates argued, in prose, that a weekend guard was
  redundant "because Yahoo returns no new bars then, so the pct stays
  at the previous close". The stale pct was the bug. Neither function
  had a single test, so nothing ever asked the comment a question, and
  it survived until he spotted a Saturday tile reading Friday's +6.13%.
  A comment that reasons its way OUT of a guard is the exact place to
  put a test instead.
- **Iterating on a LOOK he has already rejected twice.** He asked for
  the heat map's repeated top-row rectangles to stop being boring. Two
  redesigns went out — an off-centre split, then full-width bands — each
  measured, rendered, gated and pushed, and each one he liked less than
  what it replaced. The third answer was his: revert to the layout from
  before any of it. Both rewrites were reverted whole (2026-09-19).
  Taste is not a bug report. One attempt is fair; if the second misses,
  STOP and offer the revert rather than shipping a third — and when a
  change is purely about how something looks, get a picture of the
  target agreed before rewriting the algorithm behind it. An
  aspect-ratio number improving is not him liking it more.
- **Running the browser sweep against a stale bundle.** It serves the
  COMMITTED bundle in `dist/`, so without `npm run build` first
  it tests the previous commit. Cost most of an hour chasing a "3M is
  still drawing daily bars" that had already been fixed. Build, then
  sweep — every time.
- **Check the ledger entry LANDED before committing.** A python heredoc
  with a syntax error does not run at all, and one with a stale anchor
  stops at the assertion; both left a commit on `main` with no ledger
  line on 2026-09-21 (twice). Write the ledger first, then `grep` for
  the header you just wrote, and only then stage.
- **`git add -A` with an agent writing in the same tree.** A study
  script a background agent was still building was swept into an
  unrelated UI commit (2026-09-21) and turned `main` red: the snapshot
  was a half-written object literal, and the Edge workflow's
  `deno check` caught what the main `check` workflow does not look at.
  While anything else is writing into the working tree, stage the paths
  the commit is about and nothing else, and read `git status` before
  committing rather than after.
- **A python heredoc that edits several files stops at the first bad
  anchor.** Twice on 2026-09-21 a docs script asserted on a README
  phrase that had already changed, and the LEDGER edit after it never
  ran — so a commit landed without its ledger line and the hook allowed
  it, being only one behind. Put the ledger edit FIRST, or run each file
  in its own call.
- **Reading "two lines" as one.** He asked for the venue card's head —
  the badge and "3 strategies · 0 live · maker/taker …" — 分成两行. The
  session merged them onto ONE line, and he had to say it again ("你怎么
  听反了"). His layout words are literal: 分成两行 is each item on its own
  line, 删了 is gone, not hidden or moved. When a layout instruction can
  be read two ways, the reading that moves things APART is his.
- **Explaining a discrepancy instead of removing it.** The strategies
  table's "return" was (unrealised + realised) / capital and the detail's
  "unrealised" was on cost, so one strategy showed two percentages and he
  asked why. The explanation was true and was not the fix; the fix was two
  columns that each say their base in their label. A figure shown in two
  places is the same figure, or its label says why it is not (2026-09-21).
- **A fact in the reference that the code did not implement.** §2.2 of
  the agents reference recorded, the day it was measured, that Revolut X
  publishes two books per pair (UK / EEA) and that an account trades its
  own. The venue client's `quotes()` kept whichever ticker row came last,
  so for a night the loop read the UK and the EEA book at random, and a
  paper rule lifted an EEA ask this UK account cannot trade (2026-09-21).
  A verified fact about a venue is a requirement on the client: write the
  pin and make the probe show it honoured the day the fact is written
  down, not the day it costs a trade.
- **The sweep's own server cannot see the CDN.** Every gate was green
  while production's sub-pages were dead for forty minutes (2026-09-21):
  Cloudflare Pages answers a chunk that does not exist yet with the HTML
  shell and a 200, `_headers` stamped the assets' one-year `immutable` on
  that fallback, and browsers that asked for a new chunk during a deploy's
  propagation cached HTML under its name — the service worker then
  precached the same HTML. The harness serves `dist/` cleanly and can
  never produce that response. Two rules follow: a header rule that
  applies to a path applies to the path's error responses too, so a
  long-lived cache header belongs only where the path can never be a
  fallback; and a production-only failure mode needs a production check
  (the health check now probes the live chunks and the not-found status)
  plus a harness pass that injects the bad response and asserts the app's
  recovery, not the browser's silence. He reported it as "all sub-pages
  broken, errors box full" — read the errors table first; it named the
  chunk and the MIME type, and that was the whole diagnosis.

- **A test double looser than the thing it stands in for — twice in one
  day** (2026-09-22). The in-memory db ignored `agent_orders_mode_check`,
  so three tests certified a paused row's exit that Postgres refused in
  production; hours later a guard was added to the real `selectAll` and
  not to the stub's, one production caller had no `order=`, and the tick
  threw on every run for three hours while 338 tests were green. Put a rule
  the double must honour in ONE function both call, and when you add a
  guard to a real client, grep every stub of that client in the same
  change.
- **A label is not the thing it labels.** A strategy row's `mode` was
  used as the identity of its positions, the bucket of its exposure, the
  mode written on its orders and the switch for its live gate. Flip the
  label and the row inherited paper coins it would sell for real; retire
  it and its exit order carried a value the schema rejects; demote it and
  its real coins lost their stop; clear the live confirmation and the
  exits died with the entries. Ask what a field IS before using it as
  four different things.
- **A verdict survives the rule it was computed under.** "AVAX clears one
  window and fails the bar" was the answer under the intra-bar stop the
  loop had stopped running the day before; under the running rule it
  cleared three. It was repeated to Davies as fact. When a rule changes,
  every verdict computed under the old one is stale until re-derived —
  mark them, don't quote them.
- **Count every layer that can refuse.** The pre-live report said "0
  refused by the risk gate" — true — while the decision model had vetoed
  one entry in five, and no backtest priced it. And a prompt is code: the
  model's question demanded a stronger trend than the rulebook ever
  checked, so part of its "judgment" was an untested rule written in
  prose.
- **A subagent's number is a claim until you recompute it.** "drop·AVAX
  passes all four evaluations" was 1 of 6; "AVAX is uniquely qualified"
  was one passer where chance gives 1.8. Both were one query from the
  record. Recompute before relaying, and say which numbers you checked.
- **A timestamp you estimated is not a timestamp.** Eight ledger headers
  on 2026-09-22 were stamped up to 76 minutes ahead of the clock, and one
  of them was then used as evidence — the tick outage was dated from it and
  understated by an hour. Read `date -u`, or the commit time, every time.
- **Read the table that would show the failure.** After the tick deploy
  that broke it, the basis kept updating — it is written before most of
  the loop runs — so "the loop is alive" read true through a crash.
  Decisions and `ops_errors` were the tables that could say otherwise.
- **A file a result pins is not yours to tidy.** Ten committed results
  record `agents/backtest.ts`'s SHA-256 as an input, and `sizing.json`
  records `backtest_jev.ts`'s. The `src/` reorganisation updated a path in
  one of backtest.ts's comments and broke that chain; it went back byte for
  byte (`1cfe454`). Before editing any study input, grep
  `docs/agents/backtests/` for its hash. Add a new file beside it instead.
- **A study's arguments are part of its output.** `backtest_xsmom.ts` copies
  `--prereg` into `xsmom.json`, and the agent that ran it passed a scratchpad
  path: the committed result could not be reproduced from the repository
  until it was re-run with repository paths (2026-09-23). Run a study from
  the repository root with repository paths, and diff the re-run against the
  original before committing — only path strings and the file's own hash may
  differ.
- **Check a rule's measured holding time before describing it.** The first
  draft of momentum-1d's own Jev question said the rule "usually holds for
  weeks"; `testingset.json` puts its median hold at about three days. A
  question the model is asked, a README line and a pre-registration are all
  claims; read the number that decides them first.
- **"Fewer files at the root" means the file leaves.** Re-pointing a root
  file, or folding a config into `package.json`, still leaves it in the
  listing he reads. He said so twice; the third round moved the npm project
  itself into `src/`.
- **One row's newest record from a window over every row.** The Agents
  page took each strategy's last decision from the 120 newest overall. By
  midday those were the hourly rows' alone, and both daily rows wore a
  "stale" dot for half of every day while deciding on time (2026-09-26);
  the tick's observation reads had already been fixed for the same reason.
  A row's own newest thing is its own query. And read a record's state
  before the records it counts: RW's engine writes fills before the state
  that includes them, so a parallel read paired two runs on one page.

## Third-party reviews

He runs another AI over the diffs and brings the findings back. They
have caught real bugs, including two fresh regressions in one pass.
Also disagree when they are wrong, with the reason. Say which findings
you accepted and which you didn't, and why.

## When he says it's still wrong

He is usually right, and usually about the data rather than the code
you were looking at. Don't re-explain the previous answer. Go and
measure something new — and prefer measuring the thing he pointed at
over the thing you think is responsible.

## What the 2026-08-18 rollback paid for

The thirty commits between `8d869fe` and `f5481d0` were rolled back
wholesale because they had been landed without evidence and had started
regressing working behaviour. What that audit turned up, in order of how
much it cost:

**Recording an ANSWER forces a second implementation.** The old
`snapshot-record` computed the portfolio's value and net deposit
server-side so it could store them — 843 lines of Deno TypeScript doing
what `computeAt` and the deposit walk already do in JavaScript, both
writing the same primary key. Measured in the live table over ~40 hours:
`deposit_usd` moved between 71,391 / 75,828 / 129,138 / 132,359 with no
money entering the account, and `value_usd` stepped between ~167k and
~182k inside one hour. Record INPUTS — prices — and let the one
valuation function turn them into a number. The divergence then isn't
avoided, it's unreachable.

**One pipeline, two renderings.** The Investment panel is a `view` prop
on `PerfChart`, sharing its fetch, its grid and its `computeAt` call —
not a sibling component with its own data path. He asked for this in as
many words ("valve就是现成的vs 500图中portfolio的数据") and the
previous attempt wrote `investmentPointAt` with a comment explaining it
was "deliberately NOT `computeAt`".

**Check the exit code, not the summary line.** `npm test` printed
"683 passed" and exited 1: a mock missing a newly-imported function threw
inside a passive effect, which vitest reports as an unhandled error, not
a failing assertion. Grepping the summary said green; CI said red.

**The board's share count is the truth; the lot ledger is often short.**
16 of 26 holdings have lots that don't add up to their board shares
(BMNR 7 vs 225, RKLB 30 vs 160). `lotsFor` already substitutes a
whole-position lot for the value line; anything else that reads lots
directly has to reconcile the residue too, or it silently under-reports.

**Ask the broker.** The T212 sync was allow-listed to two ETFs, so the
board carried PLTR as sold out while 55 shares sat in the account, and
GOOG at 24 against the broker's 22 — together the entire gap between the
scoreboard and his own tracker. On a ticker's FIRST sync take the
broker's number outright; assuming a board excess is another platform's
slice freezes whatever was there with no way back. What made the
original overwrite dangerous was that it also destroyed lots and sells —
so don't do that part.

**A stuck parser must name the field it wanted.** The order backfill
stalled reporting "50 items, 0 parsed (top-level keys: fill,order)" —
the right envelope, nothing stored, and no way to tell what the older
pages lacked. Every rejection now reports its own reason. Guessing at
another service's schema is the same mistake as diagnosing from theory.

**A database cannot be reverted by reverting a file.** `main` went back
to `8d869fe` except for `supabase/migrations/**`: those versions are
recorded in the remote `schema_migrations`, and deleting a file whose
version is recorded there breaks every later `supabase db push`. Say so
out loud rather than doing it silently — and never take the other
option.

**The board's share count outranks the lot ledger.** On this book the
ledger is routinely incomplete — 16 of 26 holdings carry lots that don't
add up to their board shares (BMNR 7 against 225, RKLB 30 against 160) —
while the board count is what the broker and the scoreboard agree on. Two
separate bugs came from believing the ledger instead: `migrate()`'s
sold-out heal zeroed PLTR on every load (its ledger is a complete 2024
round trip while 55 shares sat in the account), and the deposit line
under-counted by the whole un-lotted slice. The rule: the ledger supplies
DATES, the board supplies QUANTITY, and anything reading lots stands the
residue in rather than believing the shortfall. Never back-fill the
missing lots — that invents purchase dates that never happened.

## The record: `docs/LEDGER.md` live, `docs/handover.md` archived

`docs/LEDGER.md` is the LIVE record, under the ledger protocol in
`.agents/skills/ledger/SKILL.md`: what remains, the machine setup, then
history newest first, each section opening with a source header. **It is
maintained in real time and in the same commit as the work** — a
pre-commit hook refuses a commit whose ledger is two behind. Read it
first on any resume and work down the what-remains list.

`docs/handover.md` is its ARCHIVE, not a second live document — Part 1 the
state as it stood when the ledger took over, Part 2 an append-only
decision log, Part 3 the raw session transcripts. Open it when a closed
item is reopened or audited, and move closed operations into it so the
live ledger stays cheap to read on every wake. Part 3 is the raw 67-turn Claude Code session
(every message, tool call, and tool result; long outputs clipped at
3000 characters). Use it to recover a specific request or a closed-form
check. Do not copy balances out of it into new files, issues, or
public surfaces.
