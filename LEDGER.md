# Ledger

The live handover record for this repository, under the ledger protocol
in `.ledger/SKILL.md`. Read this file first on any resume; it is kept
small on purpose. The deep record — the full decision log and the raw
session transcripts — is `handover.md`, which is this ledger's ARCHIVE
and is opened only when a closed item is reopened or audited.

## What remains right now

**The full plan is `docs/improvement-plan.md`** — 28 items in four
tiers, written 2026-09-05 from a whole-repository review, with cost,
risk and a verification step on each. It is a PROPOSAL: nothing in it
has been executed, and nothing should be until Davies confirms. This
list stays the short version; the plan is the reasoning behind it.

1. **THE LIVE SITE PUBLISHES THE WHOLE REPOSITORY, AND STILL DOES.**
   Re-measured 2026-09-05: `handover.md`, `LEDGER.md`, all of `src/`,
   `supabase/functions/*` and the migration carrying purchase records
   all return 200 to an unauthenticated fetch, with
   `Access-Control-Allow-Origin: *`.

   The earlier diagnosis in this ledger was WRONG, and that is why two
   fixes failed. `wrangler.jsonc`'s `assets.directory` is a **Workers**
   key; this is a **Pages** project and ignores it (wrangler is not even
   a dependency). The root serves because NO build output directory is
   configured anywhere and the Pages default is the repository root.
   Same reason `.assetsignore` (a Workers mechanism) and `_redirects`
   (cannot beat a real static asset) both did nothing.

   It is fixable IN-REPO after all, without the dashboard: point Vite's
   `outDir` at `../dist`, move the committed bundle there, and add
   `"pages_build_output_dir": "./dist"` to `wrangler.jsonc`. Verify on
   the branch PREVIEW first — app loads with the branch's asset hash,
   and `/handover.md` returns 404 — then merge. Plan item 1 has the
   steps. Afterwards, rotate both app passwords and the token-signing
   secret: the Edge sources were public. No sign anyone found it — five
   failed logins in the auth table's whole history, none in 30 days.

2. **After a full day of `price_snapshots` recording, check the
   `RECORDED` provenance rule has walked left across the 24H window** on
   the Investment Performance panel. The table has been filling since
   2026-08-19; nothing has confirmed the panel draws the recorded
   stretch at the width it should.
3. **Re-check the AH-trust fix against a live fast mover.** `5ddd1ac`
   made `ahQuoteTolerance` scale with the tape after BE read an em dash
   on the heat map. It was verified against Friday's frozen after-hours
   data only — the market was shut. The first real test is the Sunday
   20:00 ET overnight reopen, on a name actually moving.
4. **Decide what `Model:` carries in this ledger's source headers.** The
   protocol wants the exact model in every header. This session runs
   under an operator rule that forbids putting a model identifier into
   anything pushed to a repository, so its headers say
   `not recorded (session policy)`. A session without that rule should
   write the real model. Davies decides whether to backfill.
5. **Issue #207** (`edge-functions failed on main`, opened 2026-08-18)
   is stale — that workflow has been green on every push since. Close it
   or leave it for the next real failure to bump.
6. **Top Movers still only reads TODAY.** The last open item of the
   2026-09-17 batch: Davies asked for the window to open up beyond the
   day, "with design sense and the best visual and interaction effect".
   Nothing has been built. The bundle headroom was freed for it on
   purpose — 12.4 kB under the 122 kB budget as of the four-hour-grid
   commit.

Nothing else is in flight. `main` is clean and pushed.

## Machine and platform setup

A rebuilt container loses every line below. Run them before working.

    git config user.name "daviesluo"
    git config user.email daviesluo@gmail.com
    git config core.hooksPath hooks
    git config --local ledger.path LEDGER.md
    npm ci

Facts a fresh session would otherwise rediscover:

- **Node 22** (`.nvmrc`). npm 10.x.
- **The Edge Function tests run under `npx deno`**, currently Deno 2.9.6
  here: `npx deno test --allow-env supabase/functions/`. `AGENTS.md` says
  to prefer Deno 1.x to match Supabase's runtime; the npx path is what
  actually works in this container and what every gate run below used.
- **The app sweep is now a normal gate**: `npm run verify:browser`.
  Playwright is a devDependency, so `npm ci` brings it. Chromium is
  preinstalled at `/opt/pw-browsers` in this container — do NOT run
  `playwright install` here; point the sweep at it instead:

        PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run verify:browser

  CI runs `npx playwright install chromium` and needs no such variable.
  `scraps/verify-perf-matrix.mjs` is still by hand and still needs the
  throwaway-package-dir setup — it has 18 failures across 60 cases on
  `main` and cannot gate anything until those are understood.

- **The container clock has been wrong before.** On 2026-09-05 it read
  91 minutes behind the database, and that alone produced a false outage
  report. On anything time-gated, take the time and the WEEKDAY from the
  database (`select now()`), not from `date`.
- **Gates, all of which must pass before a push:** `npm run typecheck`,
  `npm run lint`, `npm test` — **check the exit code, not the summary
  line** — `npm run build` followed by
  `rm -f assets/*.map sw.js.map workbox-*.js.map`, `npx size-limit`,
  `npx knip`, and `npx deno test --allow-env supabase/functions/` when an
  Edge Function changed.

## History, newest first

Closed operations move verbatim into `handover.md`, whose Part 2
(decision log) and Part 3 (transcripts) are this ledger's archive.
Everything before 2026-09-05 lives there already.

### [2026-09-18 01:20 UTC] Platform: Claude Code | Model: not recorded (session policy)

**3M draws on a four-hour London grid.** Davies asked for the T212
shape: six points a day at 01 / 05 / 09 / 13 / 17 London plus one
pinned to the actual US close. Done, and the blocker written down in
the 22:55 entry below turned out to be the wrong frame.

That entry said the grid had to come from the benchmark, so 3M would
need a 24 h benchmark (ES=F) and would stop being a comparison against
the cash index. It does not. The grid is now an EXPLICIT list of
instants — `fourHourSlots` in `market_hours.js` — and BOTH lines are
read at those instants by "last print at or before", the same rule
`closeOn` already applied to the book. `^GSPC` stays the benchmark; it
simply reads flat at 01 / 05 / 09 London, which is not a drawing
artifact but the truth about an index whose market is shut, and it is
the difference the panel exists to show: the book moved overnight and
the S&P did not.

What made the grid worth having on THIS book is that it is not one
venue. 05:00 London is Hong Kong and the mainland trading; 09:00 is the
London open; 13:00 is London's afternoon and US pre-market; 17:00 is
mid-afternoon in New York. `ytd.test.js` pins that closed-form: 10
NVDA + 100 0700.HK, and the value walks 6120 / 6376 / 6632 / 6632 /
6672 / 6732 across the six slots — moving where Hong Kong is open and
the US is shut, flat at 12:00 UTC where both are, moving again once New
York opens. On the old daily grid that whole day is ONE number.

**The sixth slot is pinned, not written down as 21:00.** 21:00 London
is the close only while the UK and the US are in the same DST regime.
For the ~3 weeks from the second Sunday in March and the ~1 week from
the last Sunday in October, the US closes at 20:00 London, and a fixed
21:00 would fold an hour of after-hours into the "close" point.
`usCloseUtcMs` asks `usMarketHoursUtc` per day; all four regimes are
pinned by test.

Weekends emit nothing. The x axis is index-based, so six flat points a
day for two days in seven would spend a quarter of the chart's width
saying nothing — and 1W / 1M have never had weekend points either,
their grids being Yahoo bars.

Everything downstream moved with it: `RANGES['3M']` to 60m bars (a grid
finer than the bars would sample one daily close six times AND read it
twenty hours early), the MA fetch to 6mo/60m, both cache TTLs to an
hour, and `crosshairFormatFor('3M')` to date+time — six points a day
under a bare date would label six consecutive points identically.
`RANGE_BUCKET_SECONDS['3M']` and the 35 d - 100 d prune band were
already at four hours and needed nothing.

**Evidence.** All gates green, plus the browser sweep, which now
asserts the grid: 3M draws **261 points where it drew 3**, at both
breakpoints and on both views, while every percentage it reports is
byte-identical to before (vs-S&P +20.09 % / +4.00 %, Investment
+27.30 % / +6.00 %, reconcile exact). Same window, same numbers, 87x
the resolution. The counterfactual came free — the sweep was run once
against a stale bundle and the new check failed with "3 points".

Two things learned while getting there, both worth not re-deriving:

- The sweep's intraday fixture served ONE session of bars whatever
  window was asked for, so 1W / 1M / 3M were all drawn from three
  bars. 3M now gets 61 sessions, starting exactly where the daily
  fixture started, so its span and its lots are unchanged and every
  existing assertion still measures what it measured.
- The sweep's `reconcile` identity, `(1 + value%) / (1 + deposited%)
  == 1 + portfolio%`, is exact only when nothing was bought inside the
  window OR the deposit line's level equals the book's value at the
  window start. Widening the fixture's other windows put a lot inside
  them and broke it by 3.6 points, which looked like a chart bug and is
  not: the app reports `V1 / (V0 + C)` and the identity assumes
  `D0 == V0`. Left alone; a future session widening that fixture should
  expect it.

Known and deliberate: a date-only bar (a CN fund's once-a-day NAV) is
treated by `resampleToSlots` as that day's CLOSE, so it cannot be read
at the 01:00 slot hours before it is published. `closeOn` itself still
has the older version of that leak on 1W / 1M, where it has always
been; not touched here.

### [2026-09-17 23:10 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The recorder's own density had to follow 1W too.** Same sweep as the
entry below, other half: `RANGE_BUCKET_SECONDS['1W']` was still reading
recorded rows at 30-minute buckets, and `prune_price_snapshots`'s
26 h - 8 d band was still coarsening stored rows to 30 minutes. A
recorded point and a fetched point are the same kind of thing on one
line, so a coarser read draws the left half of a 1W chart at half the
resolution of the right half and the seam is visible. Both now 15 min
(`0036_price_snapshot_15m_band.sql`; that band roughly doubles, ~330
rows to ~660, against a 400-day retention).

Checked the other bands rather than assuming: 1D reads 5 min, 1M 1 h,
YTD 1 day, and 3M reads 4 h, which is already the slot grid it is about
to sample on. Only 1W was out. The test now derives the bucket from
`RANGES[k].interval` for the three minute-interval ranges, so this
cannot drift again either; 3M is pinned separately because its bucket
tracks its SAMPLING cadence (4 h), not its bar interval (60 m).

Rows already coarsened to 30 minutes are gone for good — the seam heals
as the eight-day window rolls forward, not retroactively.

### [2026-09-17 23:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Correction to the entry below: the 15-minute switch broke the 1W MA
overlay, and the drift test written with it did not catch that.** That
test pinned the five places that say how long a 1W BAR is. The MA
window is a sixth number of the same kind and it was not in the set:
`maBarsFor` held its own `{'1W': 13}` bars-a-day literal, correct for
30-minute bars, so after the switch a line labelled "MA 5" covered
5 x 13 = 65 fifteen-minute bars — two and a half days, half of what it
said.

Fixed by deleting the literal rather than editing it. `barsPerSession`
derives bars-a-day from `RANGES[rangeKey].interval` (ceil(390 / N): a
390-minute session, rounded up because Yahoo emits the remainder as a
short final bar — 7 at 60m, 13 at 30m, 26 at 15m), so the MA window is
now a function of the chart's own cadence and cannot disagree with it.
1W's MA is 130 bars. Counterfactual: restoring the old literal map
fails both the new pin and the new derived-window test.

The general lesson, which is the reason this is written down: a
cadence change has to be swept for every number DERIVED from the
cadence, not just for the places that restate it. Restating is easy to
grep; deriving is not.

### [2026-09-17 22:55 UTC] Platform: Claude Code | Model: not recorded (session policy)

**1W is 15-minute bars.** Davies said 1W and 3M looked sparse beside the
other ranges, and the arithmetic agrees: at 60m a trailing week holds
about 35 points (7 bars a session x 5 sessions) against 1M's ~154. 15m
gives ~130. Yahoo serves 15m back 60 days, inside the month 1W already
fetches; the cost is roughly 3.7x the bars per ticker, which is why
every 1W cache TTL drops to 15 minutes in step.

Five places encode "how long is a 1W bar", for five different consumers,
and they were ALREADY out of step: `RANGES` said 60m while
`maFetchParamsFor` used 30m, so the MA overlay was computed over bars
the chart never drew and "MA20" covered twice the span it appeared to.
All five now say 15m — `RANGES`, `maFetchParamsFor`,
`NIGHT_BAR_INTERVAL_MS` (the recorded-overnight downsample, which has to
match or the splice changes resolution mid-night),
`ticker_chart_helpers.modalTtl` and `cache.RANGE_TTL_MS` — and a test
asserts they agree so the next change cannot drift one of them again.

**3M is NOT done, and the reason is worth writing down.** He wants the
T212 shape: six points a day at 01 / 05 / 09 / 13 / 17 / 21 London, with
the last pinned to the actual US close (21:00 London in both DST regimes
EXCEPT the two weeks a year when the UK and US switch on different
dates, when the close falls at 20:00 London).

The blocker is not the bucketing, it is the GRID. The portfolio line is
sampled at the benchmark's timestamps, and 3M's benchmark is `^GSPC` at
1d — so there are no intraday timestamps to sample at, and changing
`recordedBarDate`'s 3M bucketing alone adds nothing. `^GSPC` cannot
supply them either: its intraday bars only exist 14:30-21:00 London, so
of the six slots it covers two. The only series that spans 24 h is ES=F,
which the app already uses as the benchmark for ext-on 1D / 1W.

So 3M means switching that range's benchmark to futures. And the
portfolio side has its own artefact: individual US stocks have no
overnight tape, so at 01 / 05 / 09 London `closeOn` carries the previous
close forward and the line is a staircase — EXCEPT across the last ~30
days, where `price_snapshots` (24/7 since 2026-08-19) fill it in. The
window heals itself as recording accumulates; in about two months the
whole 3M span is real.

### [2026-09-17 22:20 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Plan item 8 — the browser sweep is a CI gate.** `scraps/verify-app-sweep.mjs`
is now `test/browser/app-sweep.mjs`, run by `npm run verify:browser`, and
`check.yml` runs it on every PR and every push to main, after the build.

It could not gate before because it was only true for four hours a day.
That is now PROVEN rather than suspected: the clock is pinned in both
places that read one — the fixture's bar dates in Node, and the page's
own `Date` via `page.clock.setFixedTime` — and moving the pinned instant
from 23:00 UTC (19:00 ET, after-hours) to 17:00 UTC (13:00 ET, mid
session) reproduces EXACTLY the four `heatmap/ext` failures that used to
appear and disappear on their own. So they were never a bug: the app is
right that an after-hours print cannot exist mid-session, and the
harness had simply assumed after-hours.

Two things the move exposed, both of which had kept this script
hand-run:

- The Chromium path was hardcoded to this container
  (`/opt/pw-browsers/chromium-1194/...`). Now Playwright resolves its
  own, with `PLAYWRIGHT_CHROMIUM_PATH` as the override this container
  uses.
- `ROOT` defaulted to an absolute path and the traversal guard compares
  with `startsWith`, so passing a relative root (`.`, which is what an
  npm script passes) rejected every request and the page never loaded.
  ROOT is resolved absolutely now, and the sweep runs from any cwd.

Also: pinning the clock broke the chunk-prefetch check, because
Playwright's clock takes over the Performance timeline and
`performance.getEntriesByType('resource')` reads empty. Rewired to
record requests from OUTSIDE the page (`page.on('request')`), which no
clock can affect.

Playwright is a devDependency now. knip stays green.

### [2026-09-17 21:40 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Plan item 24 — the modal cluster is out of the main bundle.** The four
panels nobody can reach without a click (ticker chart, holdings list,
sectors list, transaction history) are `React.lazy` chunks now.

Measured: main bundle 121.03 kB gzipped → **109.07 kB**, so headroom
against the 122 kB budget goes from 0.97 kB to 12.93 kB. The chart modal
alone is 8.25 kB of it; the other three are 1.7–2.2 kB each.

They are lazy but NOT lazily fetched. A `setTimeout(…, 0)` after first
paint warms all four, so the split buys a smaller critical path without
buying a modal that has to download itself when you click it — which is
the same defect as a panel that paints an empty state and fills in
after. `Suspense fallback` is `null` deliberately: the only way to reach
it is a click in the first moments of a cold load, and a blank frame
beats a spinner that flashes for 50 ms.

The sweep now asserts this rather than trusting it: before any modal is
opened, all four chunk names must already appear in
`performance.getEntriesByType('resource')`. Counterfactual — disabling
the prefetch turns that check red at both breakpoints, naming all four.

`auth` redeployed for real at 20:48:03 UTC (v24), checked against the
project's function list rather than against a green workflow.

Sweep is 84 checks, still ALL GREEN at both breakpoints. Note that it
only passes after 20:00 UTC — see two entries below; that clock
dependence is still the blocker for using it as a CI gate.

### [2026-09-17 21:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

Three things, all measured rather than reasoned.

**The auth function's example password values are gone** from its header
comment. Davies has rotated both application passwords. Whether
`APP_AUTH_SECRET` was rotated too is NOT confirmed — he named the two
passwords only. Ask before assuming the token-signing key changed.

**Plan item 18 — the chart no longer re-values the book on every
render.** The per-bar build (merge overnight, fold recorded,
`buildTickerSeries`, then one `computeAt` per point) sat in PerfChart's
render body. Cached behind `seriesCacheRef`.

It is a REF, not a `useMemo`, and that is not a style choice: the
computation cannot run until after the loading / error guards, a
`useMemo` there is a hook after an early return, and eslint's
rules-of-hooks caught exactly that on the first attempt. The hook
(`useRef`) is now above every return; only the cache lookup is down
there, and a lookup is not a hook.

The first working version cached NOTHING, and only a test showed it: the
dep list held `todayMs` (`Date.now()`, so it differs every render) and
`spWindow` (rebuilt by `.filter()`, so its identity differs every
render). Measured 3 valuations → 15 across five renders, i.e. no saving
at all. Keying on a signature of `spWindow` (length, both ends,
right-edge close) and dropping `todayMs` gives 3 → 3. Counterfactual:
forcing a cache miss puts it back to 15.

**Plan item 22 — the ticker modal's 1D poll is gated.** It ran every 5
seconds for as long as the modal stayed open: no visibility gate, no
market gate. Now it stops while `document.hidden` (resuming on
`visibilitychange`) and stops in the overnight window for anything that
cannot print then. Crypto is exempt, and so is any US ticker with a T212
overnight session — `hasOvernightSession('NVDA')` is TRUE, which killed
the first version of the test: a plain US equity is supposed to keep
polling all night.

Gates: 47 files / 785 cases / exit 0, deno 208, typecheck and knip clean,
lint 0 errors, browser sweep ALL GREEN 82 checks at both breakpoints.
Bundle 121.03 kB against the 122 kB budget — 0.97 kB of headroom left,
which is the argument for plan item 24 before the next feature.

Still open from his list: the 1W / 3M density change (he has chosen the
3M cadence — six points a day at 01:00 / 05:00 / 09:00 / 13:00 / 17:00 /
21:00, mirroring the T212 app, which is a FOUR-HOUR grid and therefore
the recorded-snapshot tiers, not Yahoo bars, since Yahoo has no
overnight); the bundle split; the sweep as a CI gate (blocked on its
clock dependence, see the entry below); and the Top Movers window.

### [2026-09-17 20:15 UTC] Platform: Claude Code | Model: not recorded (session policy)

Two things the owner pointed at on screen.

**Heat-map tickers no longer break 3 + 1.** `SAEM` rendered as "SAE" over
a lone "M". The sizing read `max(8, min(11, floor(min(tw, th) / 3)))`,
which never looks at how many characters the label has; below about 25px
of tile width the 8px floor stopped it shrinking while the tile kept
narrowing, so the label overflowed and `word-break: break-all` wrapped it
wherever it ran out of room. Sizing is now width-and-label aware
(`fitTicker`, a pure exported helper), and the only legal break point is
a `<wbr>` at the label's midpoint, so anything that still cannot fit
splits balanced.

Measured, not predicted: sweeping tw 22→60 for a four-character label,
the OLD formula overflowed at 22, 23, 24 and 27 (at 27, floor(27/3) = 9
needs 23.04px of a 23px line). The new one fits on one line at every
width from 22 up — 22 being the width at which the ticker is drawn at
all — because it can reach 7px and 4 × 0.64 × 7 = 17.9 ≤ 18.

I could NOT reproduce his exact tile in the browser: the squarify layout
would not hand me a tile narrower than 25px however small I made the
holdings. The screenshot did give the size away, though — those tiles
print `+1%` rather than `+1.01%`, and only tiles under 36px wide round
the percentage. Hence the range sweep instead of one fixture tile.

**`Quotes` and `Build` are gone from the sidebar foot**, at his request —
he reads them as noise. Worth knowing before restoring them: `Quotes`
separated "the market is flat" from "the fetch silently returned almost
nothing", and `Build` answered "is this PWA on a stale service worker",
which this repo has paid for once. The build stamp still rides on every
ops-error report (`ops_error.js`), so that question stays answerable from
the table. `quoteCoverage` state and the `coverage` props are removed
with them; `yahoo_fetch`'s coverage return is untouched and still pinned.

**Correction to the entry below.** It records the sweep's four
`heatmap/ext` failures as the open AH-trust item (3 in the list above).
That attribution is WRONG. They are the harness's own clock dependence:
the app reads the real clock, and section 5's extended-hours assertions
only hold while the US session is actually in after-hours. The same
sweep, same build, ran 4-red at 16:31 UTC and ALL GREEN — 82 checks at
20:15 UTC, after the 20:00 UTC close. Forcing the fixture's
`session`-is-yesterday branch does NOT reproduce it, so it is the phase,
not the bar dates. The AH-trust item is untouched and still open.

This is the blocker for making the sweep a CI gate (plan item 8, which he
has now asked for): a gate that only passes after 20:00 UTC is not a
gate. The fixture needs a pinned clock before that work can land.

### [2026-09-17 16:31 UTC] Platform: Claude Code | Model: not recorded (session policy)

TOP MOVERS · TODAY now answers two questions instead of one. A `%` / `$`
switch in the panel's title row ranks the same names by percentage move
or by what they did to the BOOK in dollars, and the orders genuinely
differ — on the sweep fixture `%` reads BRIT > VUAA > ACME and `$` reads
BRIT > ACME > VUAA, because ACME's small percentage sits on six times
the position.

The dollar figure is `player.dayChange`, which `metrics.js` has always
computed (mv − prevMV in USD, from the same baseline the heat map and
the tactics chip use). Nothing here recomputes it. That was the whole
design constraint: a second valuation in this panel is the exact shape
of the most expensive bug class this repo has.

Membership is identical in both modes — `pctIsFlat`, the same predicate
that paints a neutral tile — so a ticker cannot rank here while reading
flat there. The one thing NOT shared is the sub-50¢ cut-off: it applies
to the dollar list only. Putting it in the shared gate (which is what I
wrote first) would have dropped a small holding that really moved 6 %
out of the PERCENTAGE list too, leaving a green heat-map tile with no
row beside it.

Each row carries a magnitude wash behind the text — no extra height —
scaled against the largest absolute move across BOTH columns. Per-column
scaling would draw a −$50 top loser as wide as a +$462 top winner.

Evidence, not reasoning:

- Counterfactual. Forcing the sort back to percentage-only fails exactly
  3 of the 9 new unit cases and leaves the other 18 green. A harness
  that passed both ways would have proved nothing.
- Browser sweep against the built bundle, both breakpoints, closed-form
  from the fixture: BRIT 100 × 0.10 × 1.25 GBPUSD = +$12.50, ACME
  6 × 2.00 = +$12.00, VUAA 3 × 1.00 × 1.25 = +$3.75 — the panel renders
  +$13 / +$12 / +$4 in that order and draws bars at 100 % / 96 % / 30 %,
  which is 12.5 / 12 / 3.75 over 12.5.
- Regression check for "does this break anything working": the SAME
  sweep run against a worktree of `main` fails the SAME 4 checks
  (`heatmap/ext` ACME / NOVA, both breakpoints — the open AH-trust item
  3 below, not this change) and no others. `verify-perf-matrix` reports
  18 failures across 60 cases on both trees, identical. Full unit suite
  46 files / 773 cases / exit 0.

Two sweep checks DID break and were fixed in the harness rather than the
app: it read `.view-tab.is-on:visible` first-match to decide which
performance view was selected, and TOP MOVERS now renders a `.view-tabs`
of its own ABOVE that panel in the sidebar. The failure text gave it
away — it reported the wrong tab name next to `legend=VALUE,DEPOSITED`,
the expected legend. Both tablists are now addressed by `aria-label`.

`dp.prefs` gains `moversMetric`. It is written back through a spread of
the existing bag, with a test pinning that toggling the metric cannot
drop `hideValues` — a new feature reaching through a shared key to
un-hide a hidden board is exactly the kind of breakage that gets found
in production.

Bundle 120.84 kB gzipped against the 122 kB budget (was 120.29).

### [2026-09-05 22:17 UTC] Platform: Claude Code | Model: not recorded (session policy)

Whole-repository review, recorded as `docs/improvement-plan.md` and NOT
executed — Davies asked for the plan before any of the work.

Two things the review changed about what this ledger already said.

The exposure diagnosis in item 1 was wrong. `assets.directory` in
`wrangler.jsonc` is a Cloudflare WORKERS key and a Pages project ignores
it; wrangler is not a dependency here and that file's `$schema` points
at a path that does not exist. Nothing in the repository was configuring
the upload at all — the Pages default is the repository root. Which
means `pages_build_output_dir` (the Pages key, absent) is an in-repo fix
after all, verifiable on a branch preview, and the dashboard is not
required. It also explains both failed attempts in one sentence rather
than two.

And the exposure is worse than "the position history is public": the
Edge Function sources are public too, including a header comment that
describes the app's own credential design. Rotation is part of the fix,
not a precaution.

Four findings were verified in the source rather than taken from the
review: the two ledger reconciliations in `ytd.js` and
`deposit_series.js` genuinely differ (run both on one synthetic holding
and the value line dates the whole position at the window start while
the deposited line keeps the real lots); the save path advances its
saved-fingerprint marker before awaiting the save, so a non-conflict
failure is never retried in that tab; the cross-tab reload lacks the
demo-book guard the mount path has; and the snapshot recorder is missing
from `PUBLIC_FNS` while its own header says it must be there. That last
one is latent, not live — `price_snapshots` had a row one minute old
when checked, so the CLI is still preserving the setting.

Measured baseline for the next session to compare against: 764 unit
cases and 208 Edge cases green, knip clean, 120.29 kB gzipped against
the 122 kB budget, six cron jobs with no failures in 24 h.

### [2026-09-05 10:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

Both in-repo attempts at stopping the repo-wide publication failed, and
the measurements are worth keeping so nobody repeats them.

`.assetsignore` (f010fed): ignored. The proof is that the platform
served `/.assetsignore` itself with a 200 — it treated the exclusion
list as one more asset. That mechanism belongs to Workers static
assets; this project deploys as Pages from the repo root, and the
`wrangler.jsonc` beside it is not what drives the upload.

`_redirects` 404 rules (e78431b): ignored for these paths. `_headers`
IS applied on this project, so the special files are parsed; a redirect
simply does not override an existing static asset on Pages.
`/handover.md` and `/src/app.jsx` both stayed 200 across fourteen polls
over seven minutes, with the deploy confirmed live (the site's own copy
of `LEDGER.md` already carried this sitting's newest entry). The site
itself stayed healthy throughout, which is the only good news here.

Both files removed in this commit. What remains is a dashboard change,
written out in item 1, and it needs Davies.

### [2026-09-05 09:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

The live site was publishing the whole repository, and had been for as
long as these files existed. `wrangler.jsonc` sets `assets.directory`
to `.`, so Cloudflare uploads the repo root and serves it. Measured
against production, not inferred: `/handover.md` returned 200 with the
real position history, `/supabase/migrations/0033_mark_other_platform_lots.sql`
returned the actual purchase records in its comments, and `/src/*`,
`/supabase/functions/*`, `/CLAUDE.md` and `/.env.example` were all
readable by anyone. `.git/` was not served. The app is password-gated;
the files sitting beside it were not.

Found while checking whether today's own additions (`hooks/`,
`.ledger/`) had become public — they had, which is how the older and
much worse exposure surfaced.

`.assetsignore` now names what must not ship. Written as a DENY-list
rather than an allow-list deliberately: a missed exclusion leaves one
file public and takes a minute to fix, a missed allow takes the live
site down. It is unverified at the time of writing — item 1 of what
remains is fetching the deploy and requiring 404.

### [2026-09-05 09:25 UTC] Platform: Claude Code | Model: not recorded (session policy)

Adopted the ledger protocol as this repository's working record, from
`https://github.com/daviesluo/ledger-skill` at `697b8b2`.

The package sits at `.ledger/`, which no tool scans, and the two
pointers it ships with were deleted per its README — copying it onto
`.claude/skills/ledger/` would have put the protocol where a pointer
belongs and a pointer would then have replaced it. Pointers written at
the three paths this repo's tools actually scan, each carrying the
protocol's own front matter and a corrected relative path.

`sh .ledger/bin/selftest.sh` passes 47 cases here, so the hook is known
good on this machine before anything depended on it. Installed at
`hooks/pre-commit` with `core.hooksPath`; there was no previous hook to
append to.

The split with `handover.md` is the one design decision worth recording.
That file is 35,138 lines, which is exactly what the protocol's economy
rule forbids in a file read on every resume. So it keeps its role as the
deep record and becomes the archive, and this ledger carries only what a
resuming session needs. `CLAUDE.md` and `AGENTS.md` were rewritten to
name one live record rather than two, because two handover documents
maintained in parallel is the failure this protocol exists to prevent,
not a stricter version of it.

### [2026-09-05 09:25 UTC] Platform: Claude Code | Model: not recorded (session policy)

State inherited into this ledger, so the first resume has a recorded
point to verify against: `main` at `5ddd1ac`, clean, pushed.

`5ddd1ac` fixed the AH-trust guard — `extPriceIsRealAh` accepted an
extended-hours quote only within a flat 3 % of the last bar, and BE ran
8.96 % across 2026-09-04's after-hours with a single 8.76 % five-minute
bar, so a real print was thrown out and the heat-map tile read an em
dash. Tolerance now scales off the stock's own recent bars, floored at
3 % and capped at 15 %. The pin fails on the flat threshold; a
quiet-tape control with the identical 3.16 % gap still fails, which is
what keeps the SFTBY protection intact.

Before it, `fed622e` stopped `snapshot-record` writing Yahoo's frozen
overnight quote when the T212 call came back empty, and migration `0035`
stripped the rows already written. PR #209 merged at `3f3aa11`; its
rollout was verified against production rather than assumed.

One correction belongs in the record because it was told to the owner
wrongly first: the overnight recorder writing nothing since Friday
03:55 ET is the weekend dead zone working as designed, not an outage.
cron fired 360/360, every HTTP response was 200, and `shouldRecord`
correctly returned false from Friday 20:00 ET. The wrong call came from
reading the container clock and not checking the weekday.
