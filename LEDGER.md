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

0. **Agents (crypto auto-trading) — paper since 2026-09-20 18:23 UTC
   (#211, `23d2fdd`).** Two review rounds from Davies landed (history,
   09-20 19:21 and 09-21 01:57 UTC). What the record says after the first
   night: 0 errors, 437 / 437 cron runs, ~90 observations an hour, Jev
   answering on every entry (no `provider: none`); positions: momentum
   BTC / ETH / SOL on both venues, rotation ETH + SOL on both, trend-1h
   ETH; trend-4h flat on both (no close above the prior 55-bar high yet —
   not a fault). Open:
   (a) **Every Revolut X quote before the region fix was one of the
   venue's two books at random** (UK / EEA: the client kept whichever
   ticker row came last, and the region-less candles are the EEA book's),
   so pre-fix marks, `agent_basis` rows and paper fills are not all this
   account's book; nothing is re-priced. Fixed in `_shared/revx.ts`
   (`REVX_REGION = "UK"`, `quotesForRegion`, `region=` on every public
   call; the probe reports the rows). **Verified 12:01 UTC**: the probe
   (fired through pg_net) shows `requested: UK` and one UK row per
   symbol — BTC 1.3 bps, SOL 4.2 bps wide; `agent_basis` since the fix:
   p95 3.0 bps, max 6.1, widest Revolut X spread 12.9 bps (before it:
   p95 5.2, max 68).
   (b) **Thin-book guard, not built.** The stop's mark is the execution
   venue's mid and a Revolut X stop hits the bid — the backtests' fill on
   the right book. If the UK book ever goes as wide as the EEA one did
   (SOL 1.8 % at 01:35 UTC), a trail stop could sell into it. A spread
   ceiling on marketable orders (skip an entry for a minute; rest a stop
   at the signal venue's bid) is the guard; decide once the region-correct
   record shows whether the UK book ever does that.
   (c) The phone shows five columns per detail table (`ag-ph`); the rest
   need a wider screen. A retired strategy (`agent_strategies.retired_at`,
   `0038`) is hidden by the dashboard and skipped by the tick; its records
   stay. Un-retiring is a migration. (e) **AVAX (`0039`) and SUI
   (`0040`) on trend-4h, paper, both venues.** Watch their first entries
   (Kraken's AVAXUSD / SUIUSD candles feeding the signal, a fill on each
   venue, the $20 slot) and whether the paper record looks like the
   backtest — AVAX +12 % a year on the seeded parameters (9–10 trades)
   but NEGATIVE on the second walk-forward window (§3.8); SUI +14.5 % on
   the chosen parameters and −10.5 % on the seeded ones, with a 42 bps
   round trip. The bar is now two windows plus a $100k-a-day book
   (§4.15); a coin one venue lacks may run on the other alone (§4.16,
   Davies 09-21). Watches: POL (clears both windows, book too thin), LINK /
   HBAR / PEPE (three of four). Nothing joins momentum-1d or the rotation
   basket; the BTC-regime filter (§3.9) is the next rule candidate, to be
   re-tested on a non-bear window first. (d) Live is still three switches, all Davies'
   (`agent_strategies.mode`, `agent_risk.live_confirmed_at`, the gate),
   and the first live order needs his confirmation in the conversation.
   (f) **Pre-live review: the server half is SHIPPED (this commit) —
   every blocker B1–B7 and should-fixes S1, S3, S4, S5, S6, S8, S9, S10,
   S12, S16, each pinned; reference §4.17 is the itemised record, §3.10
   the portfolio study's verdicts.** Migration `0041` (unique index on
   `agent_orders (decision_id, requotes)`) applies on this push; the
   agents function redeploys. STILL TO DO: the page — S11 (a paused row
   holding a position gets an alert), S13 (dashboard refresh: newest
   response wins), S14 (mask sizes under hide-values), S15 (alert when a
   live row exists and `live_confirmed_at` is null) and the sweep fixture
   (`app-sweep.mjs` ~279–354: retired dislocation still modelled, no
   `todayUsd` / `dayStart`, three symbols on trend-4h); S2 — `runRotation`
   in `backtest.ts` gets the 8 % floor and the two-bar cooldown the live
   rotation rows run, then §3.4 / §3.3a's rotation line are re-run and
   rewritten (until then they describe a rule the loop does not run); S7 —
   the Kraken key's nonce window is Davies' setting at Kraken, before any
   Kraken live row; the review's doc gaps for retention of
   `agent_decisions` / `agent_orders` (unbounded; ~150 + ~25 rows a day).
   (g) **Davies, 16:0x UTC: finish, make live-ready, then present the
   final set — strategies, coins, mechanics, edge, expected returns — in
   the conversation; on his confirm, live at once.** Going live is a
   migration: `agent_strategies.mode = 'live'` on the chosen rows and
   `agent_risk.live_confirmed_at`, written only AFTER his confirm, then
   the first live order watched (its read-back verifies Revolut X's
   settlement field names, B4). The portfolio study's verdicts (both
   windows, shipped set on $400: −5.4 % in the bear year, +38.8 % in the
   bull year; which members clear the bar in each) are the evidence for
   the brief. Open before any Kraken live row: GBP → USD; nonce window.
   Kraken holds £75 GBP, not USD (probe 09-20 19:08 UTC); a live Kraken
   order needs the GBP → USD conversion first, and that waits for his
   word. **Usage rule**: no main-model polling and no scheduled check-ins;
   he asks when he wants a look.

1. **Cloudflare's edge still serves five cached copies of the old
   exposure, for up to seven days.** (Related, 2026-09-21: the same
   not-found fallback also inherited the assets' one-year `immutable`
   header and poisoned browsers' copies of new chunks during a deploy —
   fixed in `_headers` and with `404.html`; see that day's entry.) The ORIGIN is fixed — every path
   not in `dist/` now returns the app's HTML shell, confirmed on paths
   never requested before and on cache-busted requests to the five.
   But `/LEDGER.md`, `/handover.md`, `/src/app.jsx`, `/package.json`
   and `/supabase/functions/auth/index.ts` were cached at the edge with
   `s-maxage=604800` while they were still real files, and
   `cf-cache-status: HIT` says they are still being served from there.
   They were cached BY THIS SESSION'S OWN VERIFICATION FETCHES — no
   other path shows a cache entry at all.
   Nothing can evict them from here: `*.pages.dev` has no zone to purge
   and Cloudflare ignores a client's `no-cache`. They expire on their
   own within seven days of 2026-09-18 08:50 UTC. Re-check with a plain
   `curl https://daviesportfolios.pages.dev/LEDGER.md | head -1` — the
   app's `<!DOCTYPE html>` means clear.

2. **Rotate both app passwords and `APP_AUTH_SECRET`.** The site
   stopped publishing the repository on 2026-09-18 (see history), but
   `supabase/functions/*` sources — including `auth` — were readable by
   anyone for months before that. Nothing suggests they were: five
   failed logins in the auth table's whole history, none in 30 days.
   Rotating is cheap insurance, and it is Davies' to do: change
   `APP_ADMIN_PWD`, `APP_RO_PWD` and `APP_AUTH_SECRET` in the Supabase
   dashboard's Edge Function secrets. Changing the secret invalidates
   every issued token, so every device re-prompts once.

3. ~~Check the `RECORDED` provenance rule has walked left across the
   24H window.~~ **Confirmed 2026-09-18.** The browser sweep now serves
   recorded rows shaped like the real feed (recording starts 30 days
   back) and asserts the pair that carries the evidence: 24H draws NO
   handover rule — the window is wholly recorded — while 3M still draws
   one, because its window opens before recording began. The 3M half is
   what proves data reached the panel at all; run against an empty feed,
   3M fails and 24H passes vacuously.
4. **The AH-trust fix has not been exercised, because nothing has moved
   fast enough.** Measured 2026-09-18 over every recorded sample: the
   largest single five-minute step in THIRTY days of after-hours is
   1.77 % (2DG.SG, 09-16), and overnight it is 0.79 %. `ahQuoteTolerance`
   doubles the biggest step and floors at 3 %, so it has sat on its
   floor the whole time — the scaling engaged once, at 3.54 %, and never
   mattered. The fix is dormant, not wrong, and the field test this item
   was waiting for has simply not occurred. Nothing to do but leave it;
   the BE case is pinned with its real numbers, with a control (same gap,
   quiet tape, still rejected) and now a third pin for WHY the lookback
   is a bar count — see the history entry.
5. **Decide what `Model:` carries in this ledger's source headers.** The
   protocol wants the exact model in every header. This session runs
   under an operator rule that forbids putting a model identifier into
   anything pushed to a repository, so its headers say
   `not recorded (session policy)`. A session without that rule should
   write the real model. Davies decides whether to backfill.
6. ~~Issue #207~~ **Closed 2026-09-18.** Was (`edge-functions failed on main`, opened 2026-08-18)
   is stale — that workflow has been green on every push since. Close it
   or leave it for the next real failure to bump. Still open and
   still stale, re-checked 2026-09-18.

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

### [2026-09-21 16:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The review's seven blockers and ten of its should-fixes shipped, with
309 Deno pins (was 291).** What changed for a reader of the record: a
`pending` live order the venue does not list is never again marked
rejected — it stays pending, reported every turn with the venue's
balance beside the record, for a person to settle; a cancel whose
read-back fails leaves its row open; the book is read page by page; a
filled Revolut X order whose reply lacks the settlement fields is refused
(the probe now reports the field names both venues return, and the first
live order's read-back is the test); re-quotes pass the risk gate; an
allowed decision whose order never reached the book is placed on a later
turn (`0041` makes the order insert the claim on the attempt); the lease
is released by its holder only, renewed at half, and a turn past 70 % of
it opens no new bar decision. The state's drawdown word and the bar
rule's ATR clause now read the trailed high (the per-minute stop always
did); a symbol with no quote has no mark rather than a mark of 0; a stop
claims one second into its minute; open buys are exposure; the model's
exit-advice branch is gone; today's P&L is one arithmetic in the tick and
on the page. Reference §4.17 lists each with its pin; §3.10 records the
portfolio study's verdicts (no shipped member clears the bar on both
windows; the set made −5.4 % in the bear year and +38.8 % in the bull
year on $400; the Kraken twins are 0.92–1.00 correlated with their
Revolut X rows and earn less; the stops are not on a plateau; POL is a
Kraken-only candidate by liquidity; the regime filter clears both windows
on LINK, NEAR, SUI, ALGO). Remaining: item 0 (f).

### [2026-09-21 16:13 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Both Opus agents delivered before the 5-hour limit stopped them; their
reports are now in the repo** (`docs/agents/reviews/`), with the study's
script and raw output. Review verdict: seven blockers before live, all in
`tick.ts` and the venue clients — a filled live order whose reply was lost
was marked rejected (a real position nobody protects); a cancel whose
read-back failed was settled as "nothing filled"; the fills query was
unpaged (truncates at 1,000 rows, ~mid-November at today's rate);
Revolut X's settlement fields are unverified and a missing fee reads as
0; re-quotes bypassed the risk gate (global pause included); a decision
whose order failed to place spent its bar; the lease release was
unconditional. Sixteen should-fixes, the largest: the bar rule's ATR
clause and the state's drawdown word read the entry price, not the high
(the per-minute stop was right); the rotation backtest runs neither the
floor stop nor the cooldown the live rows run. Portfolio study: the
shipped set on $400 made −5.4 % (DD 25 %) in the bear year and +38.8 %
(DD 12 %) in the bull year against −47 % / +178 % for holding; which
members clear the bar differs by window (SOL/AVAX trend in A; BTC/ETH
trend, momentum, SUI in B); the regime filter clears both windows on
LINK, NEAR, SUI, ALGO. Fixes for the blockers and most should-fixes are
written (see item 0 f) and being tested; this entry exists so the work
survives a handover mid-way.
- Davies: finish, make live-ready, present the final set here, live on
  his confirm. The session's own quota is near its end; the ledger is
  the handover.

### [2026-09-21 15:06 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The chunk fix verified, live and in CI.** `check` run 747 on `fdf58bb`
green (the sweep's recovery pass included). Live at 15:03 UTC: the shell
references the branch's `app-ebe715df.js`; every lazy chunk it imports is
200 `application/javascript`, `cache-control: public, max-age=14400,
must-revalidate` with an ETag — that 14400 is Pages' own default for an
asset (the 14:57 entry said 0; 0 is HTML's), and it is harmless because a
chunk's name is its hash; a chunk that does not exist is **404,
`cache-control: no-store`**; `/404.html` is a 308 to `/404`, Pages'
clean-URL redirect, which serves the shell with `max-age=0`. The holdings
chunk whose first probe timed out answers in full. No open issues.
- **Policy from Davies (round 5)**: a coin one venue lacks may run on the
  other alone; the venues' symbol lists need not match. Written as
  reference §4.16 and into CLAUDE.md — same bar, on that venue's costs
  and book (Kraken: 80 bps a round trip in fees, so a larger edge).
- Two Opus agents running, reports to scratch: an independent pre-live
  review of every strategy and agents-page / mode file, and the portfolio
  study (`backtest_portfolio.ts` → `portfolio.json`: best strategy set,
  parameter and stop stability on both windows, the regime filter on the
  middle window across 27 coins, Kraken-only candidates, sizing). Each
  lands in its own commit with the reference, README and this ledger.

### [2026-09-21 14:57 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Production's sub-pages were dead for forty minutes while every gate
was green.** Davies: "除了主页显示正常以外所有的子页面都打不开了，errors框里一大堆报错".
`ops_errors` had it exactly: 12 `promise.unhandled` and 10 `render.crash`
between 13:41 and 14:23 UTC, all "'text/html' is not a valid JavaScript
MIME type for module script …/assets/ticker_chart_modal-510f18a2.js" or
"Failed to fetch dynamically imported module". That chunk exists and is
served correctly now. Proven by one request: a chunk that does NOT exist
comes back from Pages as the HTML shell, **status 200, with
`cache-control: public, max-age=31536000, immutable`** — the `/assets/*`
rule in `_headers` applied to the fallback too. `ticker_chart_modal-
510f18a2.js` was born in e96be8f (13:36); a browser that asked for it
before the deploy had propagated cached HTML under its name for a year,
the new service worker precached the same HTML at install, and every
sub-page died while the home page (already loaded) worked. The edge did
not cache the fallback (`cf-cache-status: MISS`), so it was per browser.
- **Fixed at the source**: the immutable rule is gone from `_headers`
  (Pages' default `max-age=0, must-revalidate` + ETag: a 304 per asset for
  a client without the worker, nothing for one with it, and a bad copy is
  revalidated away on the next load); `dist/404.html` is built beside
  `index.html`, so a missing chunk is a 404 the worker refuses to precache.
- **Fixed in the app**: `src/chunk_recovery.js` — a page chunk that fails
  to load refreshes the browser's copy (`cache: 'reload'`), unregisters
  every service worker, deletes every cache, reports `chunk.load`, reloads
  once per five minutes; `lazyPage` wraps the five page chunks; each page
  has its own `LazyBoundary` showing its frame with the words instead of
  a whole-app RENDER ERROR; the warm-up imports swallow their failures.
- **Gated**: the sweep's recovery pass injects production's exact bad
  response for the holdings chunk and requires one reload, no crash
  screen, the page opening after, and `chunk.load` not `render.crash`;
  `healthcheck.yml` (every 10 min) fetches the live shell, requires every
  chunk it imports to be JavaScript, and requires a chunk that does not
  exist to be a 404 without an immutable header. Skill: the sweep's own
  server cannot see the CDN; a header rule applies to a path's error
  responses too.
- Davies' device heals on its next load of the new shell (new chunk
  names); anyone still holding the poisoned copies is healed by the
  recovery on the first click.

### [2026-09-21 14:10 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The top twenty by market cap, tested; the bar tightened; SUI joins.**
Davies asked why only four coins had been tested and for the whole top
twenty (ex-stablecoins) to be run, the good ones added, and rule ideas of
mine tested too, delegating the volume to Opus subagents. Two ran in
parallel on disjoint files. What came back:
- **27 coins** (the 16 of the top 24 that trade on Revolut X, Kraken and
  Coinbase — ZEC and XMR are not on Revolut X, TRX has no history and a
  $5k book, five are exchange tokens — plus the next tier), three years
  of hours each, spreads as 20-minute medians on the UK book and Kraken
  (reference §3.8, `universe20.json` and two basket files). Eight cleared
  §3.7's bar on the last third (SOL, UNI, AVAX, SUI, ICP, POL, BNB on 111
  days, AAVE); with the middle third held out only SUI and POL cleared;
  all eight survive a doubled spread. Momentum-1d: 21 of 27 negative, only
  short histories clear. The like-for-like 13-coin basket is worse than
  the 4-coin one on every variant.
- **The bar is now two windows and a $100k-a-day book** (§4.15).
  **SUI joins trend-4h by `0040`** (capital 80 → 100); POL waits on
  liquidity; UNI / ICP / AAVE / BNB fail the second window. **AVAX, added
  this morning under the one-window bar, fails the second window** and
  stays in paper because the record is the test — said in §3.7 and §3.8
  so its record is read honestly.
- **Two backtester defects found by the subagent and fixed**: the 1-hour
  check read the basket's truncated daily bars (a young basket member let
  entries through on other coins), and a symbol outside the basket
  crashed the run. Every symbol now keeps its own series and the basket
  its own aligned copy; the shipped numbers are unchanged (re-run to
  scratch and compared).
- **Five rule ideas** (§3.9, the other subagent): none adopted; the
  BTC-regime filter is the written-down candidate (see the 13:09 entry).
- The stray dot beside "Revolut X" was an ellipsis (fixed, pinned). The
  friend's second message was answered as a discussion, not a report,
  with a Chinese explanation of each of his points.
- **`main` was red on `check` from 13:33 to the fix-up after 14:14 UTC**:
  knip lists the backtester as an entry by name, and the ideas study
  script landed without being listed, so knip reported it as an unused
  file. Added to `knip.json`. A new script under `supabase/functions/`
  that nothing imports needs its knip entry in the same commit.

### [2026-09-21 13:09 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies' third pass: the total off every scoreboard, the dot beside the
name, the eyebrows gone, the flash found, and a wider universe.** He asked
for TOTAL G/L off the agents and strategy scoreboards and the venue cards
(unrealised and realised in its place), a Today column in the strategies
table with the Status column gone and the running light moved to the left
of the name in colour, the small-caps line above every menu page's title
removed (HOLDINGS, TRANSACTIONS, AGENTS · CRYPTO, AGENTS · ROTATION…), the
Agents page's "flash of the home page" fixed, and more coins tested and
added if good. Done: `NameCell` with `strategyStatus().tone` (green /
amber / grey), the phone scoreboard two by two, no `modal-eyebrow` on the
four menu pages (dialogs keep theirs).
- **The flash.** Two causes, both in the app, neither in the agents data.
  All five lazy modals shared ONE `React.Suspense` with `fallback={null}`:
  a boundary that suspends hides everything inside it, so any first render
  or re-suspension blanked the open modal and the home page showed through.
  Each modal now has its own boundary, and the four menu pages fall back
  to `ModalFrame` — the page's own backdrop, title and close with
  "Loading…" — so a click before the chunk arrives shows the page's chrome.
  And the detail's one-second countdown lived in `Detail`'s state, so the
  whole detail (SVG chart, four tables) re-rendered every second over a
  `backdrop-filter` backdrop; `Countdown` now owns its clock. Pinned in the
  sweep: the agents chunk held back 700 ms, the menu clicked at once, the
  frame must be up and then replaced in the same modal. Sweep 192 checks;
  gates all green; screenshots at both widths reviewed.
- **A wider universe (reference §3.7, `universe.json`).** Candidates: the
  Revolut X UK pairs under 10 bps with volume — DOGE, LINK, ADA, AVAX
  (XRP is in the basket). A bar written before the numbers: positive out
  of sample on Revolut X costs, drawdown < 35 %, at least half the 27-point
  grid positive out of sample (the plateau the backtester now reports),
  positive on Kraken costs. **AVAX clears all four** (+40 % chosen / +12 %
  seeded, DD 12 %, 85 % plateau, Kraken +37 % / +9 %, in a −65 % year) and
  joins trend-4h on both venues by `0039`, paper, capital 60 → 80 for the
  fourth $20 slot; `KRAKEN_ALTNAME` / `KRAKEN_PAIR_ID` / `KRAKEN_ASSET`
  learn AVAX (pinned). LINK clears three (Kraken −1.5 %) and is a watch;
  DOGE is a fitted spike (chosen params ranked 26/27 out of sample); ADA
  fails; momentum-1d lost 31–47 % on every alt in the bear year (no coin
  added); the 8-coin rotation basket is worse than the 4-coin one (−24 %
  / 46 % DD against −14 % / 32 %). §4.15: a coin joins a rule by a bar
  written first, never by a result alone.
- The friend's second message (parameter sensitivity, fitting to the
  out-of-sample set, "more art than science", backtests being expensive)
  answered in the chat with the plateau numbers; nothing in the repo
  claims more than the table says.
- **Five rule ideas tested against the shipped trend rule** (reference
  §3.9, `backtest_ideas.ts`, `ideas.json`; an Opus subagent wrote and ran
  it, its baseline reproducing §3.7's table exactly). A BTC-regime filter
  on entries is the only idea that clears the bar on a coin the baseline
  does not (LINK), and it does so by holding less in a bear year; a bare
  Donchian, a 4-hour pullback, a stale-trend exit and weekly bars fail or
  change nothing. Nothing adopted; the filter is the written-down
  candidate, to be re-tested on a non-bear window (middle third held out)
  before any paper twin.
- **The small white dot beside "Revolut X" in the table** was the first
  dot of an ellipsis: at 10 % the venue column was a pixel or two
  narrower than the badge and the table's `text-overflow` drew "…"
  clipped to one dot. The column is 12 % again, the venue cell may never
  ellipsise, and the sweep now measures every venue cell's overflow.
- **Verified after the push (13:14 UTC):** `0039` applied at 13:10:39
  (both trend-4h rows carry AVAX/USD, capital 80); the function
  redeployed at 13:11:36; AVAX observations from 13:12 on both rows
  (trend up, volatility extreme, inside range). The tick at 13:11 ran the
  OLD function against the NEW row for one minute and logged "no Kraken
  altname for AVAX/USD" twice — the gap between a migration applying and
  the function redeploying, harmless and self-healed, and the reason a
  migration that adds a symbol lands in the same push as the code that
  knows it. All three workflows green; 68 / 68 cron runs since 12:03, no
  other error.

### [2026-09-21 12:04 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The push verified, and the day's paper record.** Migration `0038`
applied at 02:07:24 UTC on its second cut: `dislocation-1m` is paused
with `retired_at` set, the seven others untouched; the `migrations`
workflow was red for seven minutes (02:00–02:07) on the first cut's
delete, and the fix-up's three runs are green. The `agents` function
redeployed twice (02:00, 02:07); Cloudflare serves the new bundle
(`app-7702741b.js`). The probe at 12:01 UTC reads the UK book only
(above). To 12:03 UTC: 1,060 / 1,060 cron runs, ~98 observations an
hour, one error in 24 h (03:04, a Kraken candles timeout on ETH, caught
by the per-pair guard, nothing lost), 22 orders (20 fills, 2 Kraken
re-quotes), fees $0.65, Jev on every entry. Entries after the region
fix: trend-4h ETH on both venues 04:00 (P 0.94 / 0.95); trend-1h BTC
09:00 (P 0.95) while its SOL entry was **vetoed** (P 0.59 < 0.6, caution
1.00) — the first veto in the record; trend-4h BTC and SOL on both venues
12:00 (SOL at P 0.61 / 0.62, caution 1.00, the threshold's edge). Every
strategy now holds something except the retired one.

### [2026-09-21 01:57 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies' second pass, the first night of paper, and the venue's two
books.** He asked for: no "of deployed value" on the share bar; the venue
card's head on TWO lines (the first pass had merged them — read the wrong
way, now in the skill); the basis table off the overview and the
dislocation rule gone if it was not worth keeping; the strategy table
without the P&L and last-decision columns, the venue badge naming the
venue only, "in" dropped from NEXT, return split into UNREALISED G/L (on
cost) and REALISED G/L (on capital) in the scoreboard's "+$1,521 (+0.86%)"
shape; the scoreboard, the detail's head and the venue cards redesigned
with today's change (UTC day) beside the total; the detail opening as a
modal over the list and closed by ✕ back to the same scroll, no back
button, no backtest section, no caps / Jev strip; every pair preloaded; a
phone design verified with screenshots. All done: `scoreboardView` /
`strategyScoreboard` / `glText` on the client, `dayPnl` per strategy and
venue on the server (`todayUsd`, `dayStart`), the detail a second stacked
`Modal`, phone rows as cards (`useMediaQuery`), the detail's tables down
to five columns at phone width (`ag-ph`), `prefetchAgentsDashboard`
warming every strategy × symbol chart 200 ms apart; six helpers only the
removed sections used are gone with their tests, and three stacked layers
of stale column widths with them. Screenshots at 1400 and 390 reviewed
(`SWEEP_SHOTS`). Gates: typecheck, lint, vitest 900, build, size-limit,
knip, Deno 290, sweep 184.
- **Why the table's return % differed from the detail's unrealised %**:
  the table divided (unrealised + realised) by capital, the tile divided
  unrealised by cost. Now each column says its base.
- **Faster rules, tested and rejected** (reference §3.6,
  `docs/agents/backtests/frequency.json`): a year of 15-minute candles,
  the loop's own fills and stops, walk-forward. The trend rule's best
  in-sample parameters lose on every coin at 15 minutes (OOS −21 / −4 /
  −15 %), the RSI(2) pullback loses 60–70 % (600 round trips is the fee
  bill), and the 60-minute fits all lose in sample, so their positive OOS
  rows are selection noise. Below an hour the round-trip cost is the
  whole result; Jev's speed is not the constraint.
- **Dislocation retired (`0038`: `retired_at` set and the row paused,
  hidden from the page and never ticked; its records stay under their
  foreign keys).** The file's first cut deleted the row; the migrations
  workflow refused it on `agent_decisions_strategy_id_fkey` and `main`
  was red from 02:00 UTC until the fix-up commit that follows — the
  file's own claim that nothing references a strategy row was wrong,
  and the FK was right. It fired once, 01:26 UTC: lifted an ask "29.5 bps under
  Kraken", stopped at the bid 50 bps lower a minute later, −68 bps
  all-in. Chasing that found the real fault: **Revolut X publishes two
  books per pair (UK / EEA), the client kept whichever ticker row came
  last, and the region-less public candles are the EEA book's.** The
  trade's prices were EEA — a UK account cannot lift them. Measured at
  01:48 UTC: UK SOL 0.1 bps wide, EEA 45; UK ETH 0.0, EEA 63. Fixed in
  this push's third commit, "Read the account's book, not whichever row
  came last" (`REVX_REGION`, `quotesForRegion`, `region=` on every public
  call, the probe reporting the rows; Deno pins);
  reference §2.2 / §3.5 / §4.14; skill: a fact in the reference that the
  code did not implement.
- **First night of paper (to 01:40 UTC):** 72 decisions (13 acted, none
  with provider none), 15 orders (13 fills, 2 Kraken re-quotes), fees
  $0.44, 0 errors, 437 / 437 cron runs. trend-1h ETH entered at 01:00
  (P = 0.95); trend-4h flat on both venues — no close above the prior
  55-bar high yet; not a fault.

### [2026-09-20 19:21 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies' first look at the live page, and the Kraken pounds.** He asked
for: no HOW IT WORKS, no notes beside section titles, no description
paragraph on a detail; the strategy name once (the sub-line repeated the
rulebook and ran into the venue badge); the venue card's head on one line;
"WHAT THE RULE SEES" explained (it is the words the rule reads on the
forming bar — written down only when they CHANGE, which is why "seen 33
min ago" read wrongly; now "unchanged for 33 min" / "changed 40 s ago",
title LIVE STATE); the countdown to the next decision at the top of a
detail, to the second; the held positions designed (tiles under the
realised figure); Kraken's "funded —" explained; the page opening without
a wait (the app now fetches the dashboard and one chart per strategy after
first paint; the modal paints the cached copy and refreshes); no
scrollbars (hidden; the strategy table is a fixed layout that fits the
modal). All done; sweep 180 checks.
- **Kraken holds £75 GBP, not USD** — the probe (fired read-only through
  pg_net so the cron secret never left the database) reports `ZGBP
  75.0000`; the app's "$100.47" is its USD-equivalent view. The card now
  names every balance in its own currency (`KRAKEN_ASSET` maps ZGBP / ZEUR
  / USDC / USDT). Reference §2b and item 0 corrected: a live Kraken order
  needs USD, so the GBP → USD conversion is the account's first real order
  and waits for his word; paper is unaffected.
- The two rollout check-ins were deleted on his word; he asks when he
  wants a look. First 45 minutes: 26 decisions, 10 orders (8 fills, 2
  Kraken bids re-quoted once and filled), basis every fifth minute, max
  touch |basis| 2.6 bps, 0 errors, 45 / 45 cron runs.

### [2026-09-20 18:28 UTC] Platform: Claude Code | Model: not recorded (session policy)

**First ticks watched; one flaw found and fixed.** Four minutes after
the merge: 23 decisions on the first tick (Jev answered every entry via
OpenRouter in 250–440 ms, vetoed BTC momentum at P = 0.15, agreed on ETH
and SOL at ≈ 0.92; rotation ranked SOL 1, ETH 2), eight paper orders —
Revolut X marketable at the ask, filled next minute at the 9 bps taker
fee; Kraken post-only at the bid, ETH filled at 40 bps, SOL still
resting — the basis stored on the fifth minute (all four symbols within
1.1 bps), the lease taken and released each turn, zero `ops_errors`.
The flaw: `agent_observations` grew by 25 rows a minute because jsonb
hands keys back in its own order and the change check compared plain
strings; states are now compared canonically (`canon`, pinned). Pushed
to `main` directly; the function redeploys on push.

### [2026-09-20 18:23 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR #211 merged on Davies' word; paper trading begins.** Merge commit
`23d2fdd` (merge, not squash: eight logical commits kept). The three
post-merge workflows (`migrations`, `edge-functions`, `check`) started at
18:23 UTC; their outcome and the first ticks are the next entry. Item 0
now lists what to watch and in what order.

### [2026-09-20 18:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The independent review round: two P0s and five P1s on the money path
fixed, the backtests re-run with the loop's own fills, the dislocation
"edge" withdrawn as a stale-print artefact.** An Opus subagent reviewed
PR #211 (code, strategy, design) and found: XRP had no Kraken pair
mapping, which broke every Kraken batch call and with it four strategies,
the dislocation rule and the basis record; a live order that filled on
arrival was recorded with no size and no fee; the order-count cap refused
exits; a Kraken stop was a post-only sell at the bid (always rejected); a
resting exit blocked the stop for the bar rules; a stop was tried once per
bar; partial fills were invisible; no single-flight guard on the tick; the
backtests priced a guaranteed maker fill the loop never places and ran
none of the stops; the dislocation study read closes while the rule reads
the touch. All fixed and pinned (`tick.test.ts` 29, `kraken.test.ts` 11,
Edge suite 287):

- Kraken maps XRP (`XRPUSD` / `XXRPZUSD`), batch calls drop unknown
  symbols, `placeLimit` honours `marketable` (IOC, no post-only).
- A placement reply never settles an order: the row stays `new` and the
  venue's own view settles it next turn. Partial fills count as positions;
  a cancel after a partial fill is a fill of that part.
- `riskGate`: the order-count cap, like the loss limit, stops new risk
  only. Stops are evaluated before the in-flight guard, claim the MINUTE,
  cancel a resting order they outrank (Revolut X) or leave a resting ask
  to work (Kraken, priced at the ask). One pair's throw is caught per
  pair. `agent_locks` lease (55 s) — one tick at a time. Observations
  looked up per pair. `chart` / `log` answer `notReady`; the fee tier is
  cached an hour.
- **Execution model, decided and pinned:** Revolut X takes the touch on
  every order (9 bps, the backtests' fill; a resting bid on a breakout
  fills when the breakout fails); Kraken rests post-only. After any exit a
  rule waits two bars — without it momentum made 155 trades a year in the
  re-run, 45 with it.
- **Backtests re-run** (reference §3.3a; the backtester now writes
  `summary.json` itself, XRP at its measured spread): trend-4h OOS on
  Revolut X BTC −16.5 % / ETH −1.0 % / SOL +17.3 % with stops (−19.3 /
  −3.9 / +27.0 without); momentum-1d −17.0 / +10.4 / −29.2; trend-1h −9.3
  / −6.9 / +14.1; rotation −14.4 % (no bear filter −47.4 %). Buy-and-hold
  −28 / −40 / −50 %.
- **Dislocation** (reference §3.5): 60–73 % of the study's "cheap"
  Revolut X minutes had zero volume and the reference's forward return
  after them is ≈ 0 — the +8 bps was a stale last-trade print catching
  up. The seed stays, paper, reading the touch basis, as a measurement
  with no return claimed; the page's backtest note says so.
- **Page** (from the review's design pass): status and return right
  after the name and the money detail hidden under 760 px; an error card
  in words with Try again and the envelope folded away; banners for a
  global pause and a venue fault; the explainer says every minute, five
  rulebooks, model on entries only; the basis "Now" column wears no P&L
  colour; venue chips no longer repeat the cards; the held position under
  the realised figure; strategy names are real buttons. Sweep 170 checks.
- **Not done here:** production still runs the probe-only `agents` (see
  item 0); the friend's Rust engine question is answered in the
  conversation, not in the repo.

### [2026-09-20 13:41 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The loop observes every minute and enters on closed bars; the friend's
three ideas tested, one earned a paper seed; the preview's 404 fixed; the
detail page draws the trades.** Davies asked for the smallest decision
interval that still makes sense, a study of "breakout trade, double bottom
and illiquidity events", a fix for the preview's `unknown action
'dashboard'`, a price chart with the buy/sell points and a fills list per
strategy, a refined design throughout, and proof that the agents' book is
isolated from the rest of the site. He also closed the PR re-checks: no
main-model polling from now on.

- **Cadence** (tick v3, `tick.ts`): pg_cron every minute. Each turn:
  both venues' quotes (basis stored every fifth minute), order management
  with re-quotes (a resting order the touch has left by ≥ 5 bps after
  3 minutes is cancelled and re-quoted, five times at most; nothing rests
  past an hour), protective stops against the live mark (ATR trail from
  the high since entry, floor under cost — no model call, marketable on
  Revolut X), and the categorical state on the FORMING bar written to
  `agent_observations` when it changes. Entries still wait for a closed
  bar. Revolut X's public client now waits out a 429 (the loop makes six
  public calls a turn against a one-token-a-second bucket).
- **Patterns** (reference §3.5, `patterns_bt.py` in scratch): volume
  confirmation worsens the trend rule on every symbol; the squeeze
  breakout is one good BTC window and losses elsewhere; the double bottom
  is quiet on BTC and negative on ETH/SOL. None adopted.
- **Illiquidity events** (reference §3.5): 30 days of 1-minute Revolut X
  vs Coinbase closes. After a ≥ 10 bps cheap print the next 5–60 minutes
  average +14–22 bps on BTC/ETH; a RESTING bid loses on every setting
  (adverse selection); lifting the ask and resting the exit at the
  reference is +8.1 bps a trade on BTC and +4.3 on ETH at 15 bps (win 81 %),
  weaker in the second half of the sample, negative on SOL/XRP (their
  spreads). Seeded as `dislocation-1m`, PAPER, Revolut X, BTC + ETH,
  `entryBps: 15`; the rule (`ruleDecisionDislocation`) sells at the bid on
  a 40 bps loss or after 30 minutes and cancels a resting exit first.
  Pinned in `tick.test.ts` (23) and `strategy.test.ts`.
- **Preview 404**: production's `agents` was the probe-only build. The
  repo build is deployed (flattened imports, MCP); `runDashboard` answers
  `{ notReady: true }` while the tables are missing (they arrive with 0037
  on merge), and the page renders that state instead of an error.
- **Page**: `?action=chart` serves one strategy × symbol (cached candles
  over the rule's window, fills, orders, decisions, latest observation);
  the detail draws the close line with buy/sell marks, resting orders and
  average cost, a crosshair and tooltip, symbol tabs, the fills list and
  the live state pills; the strategy table's running dot follows the
  observations. Agents data lives only in `agent_*` tables and the modal;
  nothing else on the site reads it.
- **Paper exposure**: `agent_risk.paper_exposure_usd` (default 300) so the
  paper twins do not crowd each other out of the $100 live cap.
- **Client** (`src/agents_chart.js` new, `agents.{js,jsx}`): the chart's
  geometry is pure and pinned (34 cases in `agents.test.js`); a strategy
  is "running" when any of its observations is under 3 minutes old, else
  by a per-rulebook decision clock (`DECISION_STALE_MS`); the dislocation
  detail shows the 1-minute study with both halves beside the headline.
  The browser sweep is 154 checks (28 on Agents per viewport), all green
  on the rebuilt bundle. Production `agents` deployed from this branch
  by MCP (flattened imports) so the preview answers `notReady`.

### [2026-09-20 07:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Two venues made complementary by measurement; the arbitrage question
answered with data; capital utilisation addressed by a rotation rule;
Codex's three P1s fixed; the page shows the book by venue.** Davies
deposited £75 in Kraken and asked for complementary strategies, possibly
different coins, cross-venue coordination and "arbitrage", a page that
shows which venue every position and trade is on, and most of the money
active most of the time. Another AI's advice (Kraken as signal source,
Revolut X as free execution, cross-venue arbitrage) was checked, not taken.

- **Measured** (reference §2c): at the touch, every 4 s for 10 minutes,
  |basis| p50 0.3–0.9 bps and max 1.8–3.1 bps on the majors (8 bps on
  AVAX); the books cross on BTC/ETH one sample in seven, by under 1 bp. At
  1- and 5-minute closes over 12–60 h the basis never reached 80 bps and
  reached 40 once (SOL). Kraken leads Revolut X by seconds (lag-1
  correlation 0.2–0.3 at 1 min, ≈ 0 at 4 s). Kraken's fee is 40–80 bps a
  side. **No arbitrage exists at any cadence this system can run**; the
  basis is now recorded every tick (`agent_basis`) and shown on the page.
  What the lead does license: `signal_venue` — the Revolut X strategies
  read Kraken's candles and fill on Revolut X's free maker side.
- **Rotation** (reference §3.4): top two of BTC/ETH/SOL/XRP by 30-day
  return above their 100-day average, walk-forward on both venues' costs.
  The bear filter saved 33 points in the bear year for 14 points of the
  three-year return; with it off the rule is always invested and lost 45 %
  out of sample (buy-and-hold −47 %). So "most of the money active most of
  the time" is true in a bull market and false by design in a bear; the
  `bearFilter` switch exists and is his. XRP joined the universe (Revolut X
  3.6 bps / $3.5M a day, Kraken 1.1 bps). `trend-1h` kept up with the
  4-hour rule on Revolut X costs at three times the trade count and is
  seeded paper-only for feedback speed.
- **Codex P1s** (PR #211 review): a live order is written as `pending`
  before the venue is called and reconciled by client id next turn
  (`Venue.activeOrders`); a decision is the tick's claim on a bar
  (unique index on strategy, symbol, `bar_start`; a 409 means another
  tick got there); `dayPnl` counts only today — realised since the day
  began plus the change in unrealised from the day's open; and the daily
  loss limit blocks new risk only, never an exit. All pinned in
  `tick.test.ts` (16) and `strategy.test.ts`.
- **Page**: venue badges on every strategy row, position and order
  (blue Revolut X, violet Kraken, "← Kraken signals" when the candles
  come from the other venue), a share bar and one card per account
  (funded, deployed, allotted, P&L, fees), a countdown to each strategy's
  next bar close, the 24 h basis table with the fee verdict, the rotation
  backtest with its variants. Sweep checks for each.
- **Kraken funding**: the £75 is GBP; the strategies trade USD. GBP/USD
  on Kraken is 0.5 bps wide, $3.4M a day, 0.20 % fee (≈ $0.20). The
  conversion is the account's first real order and is not placed without
  his word.

### [2026-09-20 04:30 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Agents built, on the PR branch, paper only; Kraken added as a second
venue; both key pairs verified read-only.** Davies answered the four
questions (private key is `REVOLUT_X_PRIVATE_KEY`; the key was made under
Revolut X's Sub-accounts feature; no IP allowlist; paper first) and mid-way
added a Kraken Pro key pair (`KRAKEN_PRO_API_KEY` / `KRAKEN_PRO_PRIVATE_KEY`,
trading permission, unfunded) asking whether Kraken is better in some
respects and whether the two can coexist.

- **Probes** (`GET agents?action=probe`, read-only, fired from the database
  with the Vault `cron_secret` at 03:49 and 04:08 UTC): the Revolut X key's
  signed `/balances` shows exactly one USD row — the sub-account, nothing of
  the main account; the private key is bare PKCS#8 base64; a signed call
  WITH a query string returned 200, so the "query without ?" signing is
  right. Kraken: secret decodes to 64 bytes; `Balance` shows an empty account
  whose currencies are USDC and GBP; `TradeVolume` puts this account at
  0.40 % maker / 0.80 % taker; `OpenOrders` works; **`AddOrder validate=true`
  returned the order description and no txid** — trading permission proven
  without an order. Jev answered on both transports in 460–690 ms for
  $0.000018 a call; the `score` answer is the expected level index on a
  0…(levels−1) scale. Full record: `docs/agents/reference.md` §6.
- **Kraken verdict** (reference §2b): its book is 100× tighter and orders of
  magnitude deeper, its history is complete (quarterly CSV bundle) and
  `validate=true` is a real dry run — but at this account's tier a maker
  round trip costs 80 bps against ~0 on Revolut X. The same rules priced on
  Kraken lose 8–14 points a year out of sample (§3.3, `backtest.ts` now
  prices both venues). So: Revolut X for live money, Kraken for data and for
  paper twins that measure what the deeper book gives back. A venue
  interface (`_shared/venue.ts`) with two adapters; every strategy row names
  its venue and its paper fills pay that venue's maker fee.
- **Built:** `tick.ts` (candles → settle → decide → order, per venue),
  `index.ts` (tick / dashboard / log / probe; cron bearer or app token, ro
  may read), `db.ts`, `kraken.ts` (documented signing vector pinned),
  `revx.ts` (keyless public market data + venue adapter), migration 0037
  (venue/kind columns, per-venue caps, four paper strategies, the cron),
  `edge-functions.yml` PUBLIC_FNS += agents, the Agents page
  (`src/agents.{js,jsx}`, ☰ menu item, styles, prefetched chunk), sweep
  checks for it, README, CLAUDE.md. Gates: typecheck, lint, vitest 864,
  deno 256, build (main bundle 110.7 kB of 122), knip, browser sweep 116
  checks — all green.
- **Not done, by design:** nothing live. `live_confirmed_at` is null, every
  strategy is `paper`, and the tick refuses a live order on either switch.
  The prod `agents` function is at the probe-only build (v4, deployed by
  MCP for the probes); the repo version deploys on merge.

### [2026-09-20 03:15 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Research for the agents feature: TypeSafe Jev 1.13 and Revolut X,
verified, measured, recorded.** Davies wants an "Agents" page behind the
☰ menu — strategies trading crypto on a Revolut X sub-account he has
funded, decisions by "TypeSafe: Jev 1.13" through OpenRouter with
TypeSafe direct as fallback; the model is too new for any training set,
so he asked for the research first and the build in a fresh PR after.

**Jev exists and is not what the request assumed.** Listed on OpenRouter
2026-09-18 with modality `text->decisions` (confirmed from the endpoints
JSON, it is absent from the chat-model list because it is not one). It
is a System One model: state + typed questions in, typed answers with
probabilities out; it cannot generate text. $0.042 per million input
tokens, output free — a 1,000-token call is $0.000042, one a minute is
$0.06 a day. 70–500 ms. Native `POST api.typesafe.ai/v1/systemone`;
OpenRouter `POST /api/alpha/decisions` with `typesafe/jev-1.13` and a
stricter `noul.criteria` (both keys required). Full wire format, limits,
confidence semantics and the official SDK's types are in the reference.

**The vendor's own jaggedness page decides the architecture.** Jev
cannot reason about numbers, cannot judge proximity between values,
reads dates as text, and "should not be used for tasks code can compute
exactly". Handing it candles and asking whether the market goes up is
exactly the documented failure. So: code computes everything, Jev
classifies a short categorical state, a deterministic risk layer it
cannot override decides what is allowed. It is a decision node inside a
rulebook, not the edge.

**Revolut X, measured on the public endpoints tonight.** 0 % maker /
0.09 % taker, flat. Spreads BTC 1.5 bps, ETH 2.1, SOL 3.1; every other
pair 6–12 bps and thin — the universe is those three. Candles in
MINUTES (my first probe sent milliseconds and got 400s), capped at 1,000
per call, history back to Aug/Sep 2023 for all three. Ed25519 signing
works natively in Deno 2.9.6. Rate limits are token buckets per endpoint: the place-order endpoint
has a 10/s bucket AND a 1,000-per-day bucket (verbatim from its own
table, re-checked after Davies brought a source describing the general
1,000-per-MINUTE rule — both are on the page, for different endpoints;
the day bucket refills continuously, so it is a sustained cap, not a
midnight lock). Min notional $0.10. No sandbox. **An API key maps to the whole user
account** — the docs describe no sub-account scoping, so his "$100
sub-account" is either a separate login (fine) or a sub-portfolio the
same key can trade across (then isolation is our caps' job). And a key
alone cannot sign: the Ed25519 PRIVATE key must be in secrets too.
Both are questions for him, not assumptions.

**Two years of real hourly data, net of those costs.** Pulled BTC/ETH/SOL
from Coinbase Exchange (reachable, keyless; api.binance.com is 451
geo-blocked, the Vision mirror is not). One taker round trip an hour
burns ~75 % of the account a month before any edge. Simple long/flat
rules: everything on 1h bars that trades > 0.3×/day is deeply negative
after fees (SMA 10/50 BTC +16 % gross → −28 % taker); slow trend rules
on 4h/1d keep almost all their gross and cut drawdown (SMA 20/100 4h
BTC +54 % net vs +26 % hold; 30-day momentum ETH +127 % vs +2 %; SOL
stayed mostly flat through −25 %). One window, in-sample parameters —
recorded as evidence of the COST STRUCTURE, not a forecast. Script under
`scraps/agents-baseline-backtest.py`. Three of my own mistakes on the
way, all caught before anything was written down: the first draft
mis-scaled Jev's daily cost by 1,000×; the Donchian rule compared the
close to a high that included itself and never fired; and the stateful
rules shared one position dict across the gross / maker / taker passes,
so a later pass inherited an earlier pass's final position and printed
a maker return above gross. The saved script builds a fresh rule per
pass and asserts gross ≥ maker ≥ taker on every row.

Nothing built. Reference at `docs/agents/reference.md`, pointer section
in CLAUDE.md. Next session: get the four answers, then the PR — schema
and migration, `agents-tick` Edge Function on the 5-minute cron, Revolut
X and Jev clients with pinned tests, paper mode, the Agents modal.

### [2026-09-20 01:33 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The foreign ext-hours gate had no weekend, so a shut exchange read as
open and the board showed a stale Friday move as an after-hours number.**
Davies, with the toggle on: SIVE has no after-market, shouldn't it be 0 %?

He was right, and the screenshots are stronger evidence than they look.
The clock in them says 13:01 BST, and the database says it is now Sunday
02:26 London — so they were taken on SATURDAY. Every European venue was
shut. Measured in `price_snapshots`: `2DG.SG` last moved at 21:05 London
on the Friday and sat at 2.804 for the 28 hours after, so the +6.13 % on
the tile was Friday's move, three quarters of a day stale.

`lseIsOpen` and `euroExchangeIsOpen` both read only the hour and minute.
Both carried the same comment arguing the weekend guard was unnecessary
— "Yahoo returns no new bars then, so the dayPct stays at the previous
trading day's close, so a 'Saturday show 0' guard is redundant". The
stale pct IS the failure. At 14:01 CET on a Saturday the gate said the
venue was open, `foreignSuppress` stayed false, and `computeMetrics`
handed the board `dayPct` untouched. `usMarketPhase` has handled weekends
all along; only the two foreign gates skipped it.

Each gate now reads the weekday through `Intl` in its OWN zone — for a
viewer in Asia the local date can already be Saturday while London is
still trading Friday, so the viewer's clock is the wrong one to ask. An
unrecognised weekday name falls through as a weekday, so a locale
surprise can only leave the gate as permissive as it was before.

Holidays are still not modelled, deliberately: they need a per-venue
calendar, and marking a real trading day shut is the more expensive error
— it blanks a row that is genuinely moving.

**Neither gate had a single test.** That is how a conclusion reached in a
comment survived: nothing ever asked it a question. Now pinned twice —
`market_hours.test.js` at the gate, and `utils.metrics.test.js` on what
the board actually shows, for BOTH toggle states (with the toggle off the
weekend must NOT blank the row, since off means "the last completed
session"). Counterfactual run: without the weekday check three of them go
red. `foreignSessionIsOpen` also drives the chart modal's 1D anchor, and
the fix keeps the two in agreement — over a weekend the modal now anchors
at the regular close and reads 0 too, which is what the board says.

Gates on the pushed tree: typecheck 0, lint 0 errors, 855 vitest, knip
clean, bundle 110.56 kB of 122, verify:browser 98 checks. No Edge Function
touched, no migration.

### [2026-09-19 01:30 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Both heat-map layout rewrites reverted. The board is back to the
binary-split treemap as it stood at `afe3f98`**, the commit that finished
the iOS top ramp. Davies, after seeing the second one: 还是不满意 — revert
to how it was before I touched it, 原来那样挺好的.

`src/heatmap.jsx`, `src/heatmap.test.js` and `README.md` are checked out
from `afe3f98` and are byte-identical to it. `dist/` is a fresh build of
that source: same 357,740 bytes, the only textual difference the build
stamp (`2026.9.18.1850` -> `2026.9.19.0126`), which is what drives the
service-worker update prompt and should be new so devices actually pick
the revert up. The vitest count is back to 848 — the ten treemap pins went
with the code they pinned.

**The two entries below stay: they record what happened, not what is in
the tree.** Neither rewrite was wrong in the way it was measured — the
first cut the repeated rectangles, the second cut the worst aspect ratio
from 21.2:1 to 5.4:1 and laid clean edge-to-edge seams. He liked both
less than what they replaced. That is the whole lesson and it is now in
`working-with-davies`: taste is not a bug report, one attempt is fair,
and if the second misses, STOP and offer the revert instead of shipping a
third. The two engineering notes that came out of those rewrites
(veto-with-no-comparison, judging-a-cut-by-its-own-halves) were pulled
from the skill in the same commit — they described machinery that no
longer exists, and a lesson pointing at absent code sends the next
session hunting.

Nothing is left open on the heat map. If it is ever revisited, the thing
to establish FIRST is a picture of the target he agrees with; both
attempts here were built from a description and measured against numbers
he never asked for.

Gates on the pushed tree: typecheck 0, lint 0 errors, 848 vitest, knip
clean, bundle 110.52 kB of 122, verify:browser 98 checks. No Edge
Function touched.

### [2026-09-19 01:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The fix for the boring grid overshot into a mess, and the real ask was
about SEAMS.** Davies on the pushed board: 太乱了 — he wants the effect of
the lower half of the ORIGINAL screenshot, 多元但还是整齐.

Measuring his screenshot says exactly what was wrong. MSTR's bottom edge
sat at y=1005, ORCL / RKLB / PLTR's at 1075: two seams 70 px apart, each
crossing only part of the board. The eye follows a line and finds a step
in it. That is what an off-centre cut buys you — it does break the
repetition, and it leaves every region ending on a coordinate of its own.
The old layout looked orderly because its top-level cuts happened to
produce bands that ran the full width.

So the layout is bands by construction. Each pass lays ONE band across
the full width (or full height) of the space left; the leftover is a
rectangle and the next band fills it the same way, so every seam runs
edge to edge inside its own region. Variety moved into the band: how many
holdings share it, hence its thickness and its tile widths. The count is
scored against a shape the band is asked for — tile width over band
thickness, 0.62 to 1.75 along a golden-ratio walk — so consecutive bands
never come out the same. On his book that is two, then three, then a
column of three.

**Two guards, and both were learned the hard way in this session.** A
count is refused if it puts a tile under the label size, past 3:1, OR
leaves a strip too thin for another band. That third one is the same
lesson as yesterday's veto-with-no-comparison, one level up: judging a
cut only by its own two halves and never by what it leaves behind is how
the CN fund ended in a 13 x 246 splinter. And the count that takes
everything remaining is NOT exempt from the guards — left competing on
score it won on the fixture's five-holding book and swept the lot into
one band. It reaches the layout only as the last-resort fallback.

The tail hands over to the ORIGINAL binary split, below 90 px of short
side or 6 holdings left: a band can only span the full width, so a 1 %
tail becomes a row of slivers, while a nested corner can still give the
same holdings squarish tiles. That corner is the part of the old board
he liked, kept as it was.

Measured over eight book shapes at eight canvas sizes, against what was
pushed at 20:00: worst aspect ratio anywhere 21.2:1 -> 5.4:1 (the 21.2
was a 275 x 13 sliver at 532 x 612 — a latent defect in yesterday's push
that only shows at intermediate widths, which is why the size set now
covers the real range instead of two points). Tiles too small to label
19 -> 17. Longest run of look-alike tiles among the top eight 3.44 ->
3.93, against 4.68 for the original rule — slightly more repetition than
the messy version, which is the trade he asked for.

**A metric that disagrees with the eye is worth saying out loud.** I
built a "mis-aligned step" count and it rated the bands WORSE than both
predecessors. It counts pairs, so whichever layout packs more small tiles
into one corner loses; and its window was 2-28 px while the seams he
objected to were 70 px apart. Rebuilt per-edge it still did not separate
them. The decision rests on the rendered comparison at both breakpoints
plus aspect ratio and label coverage, which do measure cleanly — not on
that number.

Gates on the pushed tree: typecheck 0, lint 0 errors, 858 vitest, knip
clean, bundle 111.08 kB of 122, verify:browser 98 checks. Counterfactual
run: the original split fails four of the new pins. No Edge Function
touched.

### [2026-09-18 20:00 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The heat map's top half was a grid because the split rule always cut
down the middle.** Davies: the eight repeated shapes at the top are
boring, the varied bottom half is fine, stop drawing the top like that.

The cause is one line. `treemap` took the first index whose running
total crossed half the value — and for a run of near-equal holdings
that index IS the exact middle, every time. The halving then repeated
all the way down. Measured on a 338x612 canvas: the eight largest all
landed within 15 % of 110x170 px, three to a row. Only the uneven tail
below them had enough spread in its values to draw anything else, which
is exactly why the bottom looked better than the top.

The cut point is a free choice — area is set by value and nothing here
touches that — so it now comes from every index inside a balanced band
(0.22-0.78), scored against a per-branch target: a golden-ratio
low-discrepancy sequence over the recursion tree (left `2s+1`, right
`2s+2`, so siblings differ), pushed away from the middle because a
near-half cut is precisely the cut that draws a grid.

**The lesson worth keeping is about the guards, not the rule.** I first
wrote both as vetoes — too small, rejected; too elongated, rejected —
and the browser sweep went red on a check I had not touched: the CN
fund had lost its label. The cut that would have given it a readable
141x34 strip was refused for being 4.15:1, and the fallback stranded
the same holding in a 275x18 band with no room for a label at all. A
veto with no comparison is how a guard makes the thing worse. So size
stayed a veto (27x25 px, the render gate plus the component's 3 px
gutter — below it a holding shows neither ticker nor %) and elongation
became a price the chooser weighs against the variety it buys. A child
holding exactly two nodes also gets looked at one step ahead: a pair
has no freedom left, so pairing a dominant holding with a small one
always splinters the small one, and by the time the recursion arrives
the alternative is gone.

Measured over seven differently-shaped books at five canvas sizes,
before vs after: longest run of look-alike tiles among the top eight
5.31 -> 3.97, worst aspect ratio anywhere 4.39:1 -> 3.96:1, tiles too
small to carry a label 4/605 -> 1/605. Better on all three — the
rectangle the old rule kept repeating was not a good one.

Verified by rendering both rules side by side in real Chromium at both
canvas sizes and looking at them, not only by the metric. Six pin tests
added; the counterfactual is run, and the old rule fails exactly two of
them (8 look-alikes, a 19 px-wide tile).

Gates, all green on the pushed tree: typecheck 0, lint 0 errors,
856 vitest, knip clean, bundle 111.02 kB of 122, `verify:browser` 98
checks. No Edge Function touched, so no deno run.

### [2026-09-18 19:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The seam was not gone, and the ramp itself was putting it there.**
Davies pushed back on my "the hard line is gone" — correctly. He sent a
pulled-down screenshot; measuring the left gutter's luminance row by
row reads 102 CSS px of flat 17 (which is exactly `#0c1310`) and then a
step straight to 0.

That is the ramp. `background-attachment: fixed` is not fixed to the
viewport on iOS during the rubber-band — Safari slides it with the
content — so a pull-down dragged the ramp's pure-black head down into
the middle of the screen, where it met the revealed canvas colour as a
hard edge. The fix for a seam had manufactured a second one.

Now a real `position: fixed` layer (`body::before`, `z-index: -1`),
which does not move, plus `overscroll-behavior: none` so the
rubber-band stops revealing the canvas at all. Re-measured on the
rendered board: first rows exactly `0,0,0` across the width, largest
step between adjacent rows **1**/255, settling to `#0c1310`. Better
than the background version on both counts.

**On the blur he decided: leave the spacing alone.** Measured the band
first so the choice was informed — the same title renders at peak edge
contrast 76 inside it and 213 once pulled clear, so it costs about 65 %
of edge definition, and it covers roughly the first 80 CSS px of the
web view. Clearing it would have meant 80px of top padding, about 9 %
of the screen. He would rather have the pixels. Nothing more to do:
two independent sources confirm there is no CSS or meta switch, and
`env(safe-area-inset-*)` does not grow to account for it.

**Timing note worth having.** His screenshots were stamped 19:38 BST
and the ramp commit landed 19:35:20 BST, so they sat right on the edge
of the deploy AND of the service worker's update prompt
(`registerType: 'prompt'` serves the cached `index.html` until the
banner is tapped). Two of the three shots could not be attributed to a
build with confidence. When a change can only be judged from a photo
of a phone, the version it is running has to be established first.

### [2026-09-18 18:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The opaque status bar fixed the scrim and bought a seam; the seam is
now gone too.** Davies reported it straight away: a hard horizontal
line under the clock. Predictable in hindsight — the system's bar is
pure `#000`, the page's first pixel was the radial glow's `#14201b`,
and I had named that cost without doing anything about it.

The page now starts black as well and climbs out over 96px, so the two
meet at the same colour and there is nothing to see. The stops
approximate an ease-out rather than a straight ramp: a linear fade ends
on a corner, and the corner is itself a faint line. The full-screen
mobile modal gets the same treatment — `#0f1815` against `#000` is a
softer line than the board's, but it is still a line.

**Getting to EXACTLY black took one more step, and it is the kind of
thing only measuring finds.** With the ramp in, the page's first row
rendered `#090909`, not `#000`: the header carries a 3 % cream sheen
down its first 64px, which in standalone starts on row zero. Three per
cent is invisible anywhere else; against a bar that is pixel-off on an
OLED it is an edge. Dropped in standalone only — the ramp is already
giving that band a tone, in the opposite direction.

Verified by rendering, not by eye: drove the real board in the sweep's
harness with the standalone declaration applied, screenshotted the top
150px at phone width and read the pixels back. First row `0,0,0` across
the width; largest step between adjacent rows 2/255, so no banding. The
`@media (display-mode: standalone)` rule itself cannot be emulated from
here — its presence in the shipped CSS is checked by grep, and the
injected declaration is byte-identical to it.

Still true, and still worth repeating: no gate in this repo can check
any of this, and I cannot run iOS 26. Reverting is `black-translucent`
back in `src/index.html` plus deleting the two standalone blocks in
`styles.css`.

### [2026-09-18 18:35 UTC] Platform: Claude Code | Model: not recorded (session policy)

**iOS status bar is opaque now — SHIPPED UNVERIFIED, and Davies is
checking it on the phone.** He picked this over living with the haze
after I put the trade-off to him.

`apple-mobile-web-app-status-bar-style` goes from `black-translucent`
to `black`, so the system owns that band and there is nothing of ours
under the iOS 26 scrim to dim. `.app` then takes
`env(safe-area-inset-top)` exactly inside
`@media (display-mode: standalone)` rather than `max(8px, env - 8px)`:
with an opaque bar the inset reads 0 because the system already
reserved the space, and the old expression would have stacked our 8px
on top of it and pushed the header down. Net movement should be about
8px, not 16.

Two things I could not do from here, both worth stating: I cannot run
iOS 26, and I could not find any CSS or meta that disables the effect
(Safari 26 ignores `theme-color` and derives edge colours itself; the
only fix in circulation is dropping `black-translucent`). So this is a
change to the app's chrome that no gate in this repo can check.

**Reverting is two edits**: `black` back to `black-translucent` in
`src/index.html`, and delete the `@media (display-mode: standalone)`
block in `styles.css`. Rebuild and commit `dist/`.

Cost he accepted: the band is system black rather than the app's dark
green gradient.

### [2026-09-18 18:20 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Top Movers' longer windows now measure the HOLDING period, and 3M is
back because of it.** Davies: a stock bought yesterday must show one
day of move on the 1W and 1M lists, not a week or a month of the share
price. He had deleted 3M once already for exactly this — many positions
are a month or so old, so a quarter window credited them with a quarter
they were not in for.

Not implemented twice. `computeAt` already applies the rule per lot for
the performance chart: a lot bought BEFORE the window opens carries the
window-start close as its basis, one bought inside it carries its own
cost. So `holdingMoveOver` builds a one-holding portfolio and asks
`computeAt`, then reads `(value - basis)`. Sales, FX, a missing price
history and a ticker with no series at all are handled there already.
FX comes from `player.fx` — the rate `metrics.js` resolved — so the
panel cannot disagree with the scoreboard about a GBP position.

Pinned closed-form at both levels. Same stock, 110 at the window's
open and 120 now: held throughout it reads +9.09 %; bought two days ago
at 115 it reads +4.35 %, not +9.09 %; a mixed holding (10 from before,
5 added inside) reads 110/1690. At the panel, three tickers all opening
the month at 100 render `+50.00% / +7.14% / +5.00%` — the middle one is
the discriminator, since measuring the stock would print +50.00 % there
too.

**TODAY deliberately stays out of it.** A day change is measured
against yesterday's close for every holding regardless of when it was
bought — that is what the heat map, the scoreboard and the tactics
chips all show, and re-basing it on cost would put two numbers for one
ticker on one screen. Worth flagging to him as a judgement call.

**Source exposure, the remaining half.** With the repo no longer
published, what a link still hands out is the minified bundle —
unavoidable for any web app. Checked rather than assumed: `dist/` holds
14 files and no `src/`; sourcemap requests are blocked; the only
secret-shaped string in the bundle decodes to the Supabase **anon**
key, `role: anon`, which is public by design and RLS-gated; and the
data is genuinely gated — `data?action=board` returns 401 with no
token AND with a forged one. Added `robots.txt` plus `X-Robots-Tag` on
every path, which is the standard way to keep a link out of search
indexes and out of the crawlers that feed AI assistants. Stated in the
README as what it is: a directive, not access control.

**The iOS 26 top-of-screen haze is NOT fixable from CSS, and I did not
guess at it.** Searched rather than invented: Safari 26 ignores
`theme-color` and derives edge colours itself, there is no property
that controls the standalone status-bar treatment, and the only fix the
community has found is dropping `apple-mobile-web-app-status-bar-style:
black-translucent` — which hands the band to the system and moves
content down by the status-bar height, i.e. exactly the top spacing he
asked to preserve. Put to him as a choice rather than shipped blind: I
cannot verify an iOS 26 change from this container, and an unverified
fix to the deploy chrome is how the Pages exposure survived two
attempts.

### [2026-09-18 08:55 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Merged, and production's ORIGIN is fixed — but the edge is still
serving five cached copies of the old exposure, and this session put
them there.**

After the merge, a plain fetch of production showed `/LEDGER.md`,
`/handover.md`, `/src/app.jsx`, `/package.json` and
`/supabase/functions/auth/index.ts` still returning their real
contents, while `/supabase/migrations/0029_price_snapshots.sql` —
requested for the first time in that same command — came back as the
app's shell. That asymmetry is the whole diagnosis: the difference
between those paths is not what they are, it is that I had fetched the
first five repeatedly while verifying, and each fetch cached the real
file at the edge with `public, s-maxage=604800`.

Confirmed three ways: `cf-cache-status: HIT` with a climbing `age`;
the same five paths with a `?cb=` query string (a different cache key)
all return the shell; and six paths never fetched this session
— `/src/metrics.js`, `/supabase/functions/data/index.ts`, `/README.md`
and others — return the shell with no cache entry at all.

Nothing here can evict them. `*.pages.dev` is not a zone this account
can purge, a new deployment does not invalidate paths that are no
longer part of any deployment, and Cloudflare ignores `Cache-Control:
no-cache` and `Pragma: no-cache` from a client. They expire on their
own inside seven days.

**The lesson is not about Cloudflare.** Probing a resource to prove it
is exposed is itself a request, and on a CDN a request is a write. The
check extended the exposure it was measuring. Where the same check can
be made against a path nobody has touched — as `?cb=` or an unfetched
sibling does here — use that instead.

Scope, stated plainly: five paths, at whichever colo this container's
proxy egresses through, for up to a week. `auth/index.ts` was already
public for months, which is why rotating the secrets is the item above
it and not a new one.

### [2026-09-18 08:40 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Verified on the preview, and it works. The live site will stop
publishing the repository when this merges.**

Proof, preview against production, same paths, same minute:

  path                               preview (dist/)   production (main)
  /LEDGER.md                         html shell        the ledger's text
  /handover.md                       html shell        the archive's text
  /src/app.jsx                       html shell        the source
  /package.json                      html shell        the file
  /supabase/functions/auth/index.ts  html shell        the function's source

`/` serves the branch's own bundle (`app-8bc6414d.js`, against main's
`app-d32e096f.js`), every asset returns the right MIME type, and all
five security headers are present and identical to production — so
`_headers` is being read out of `dist/`, which is where it now lands.

**The acceptance criterion this item carried for two weeks was WRONG,
and it is the reason to read this entry.** It said to check that
`/handover.md` returns 404. Cloudflare Pages does not 404 an unmatched
path — it serves `index.html` with a 200. So the exposed and the fixed
states return the SAME status code, and a status-code check cannot tell
them apart. My first pass at verifying this ran exactly that check, saw
eleven 200s, and concluded the fix had failed. It had not. Compare
CONTENT.

The same mistake is in this ledger's earlier measurements of the
exposure: they were reported as "returns 200", which on its own proves
nothing. The exposure is real — confirmed above by reading what
production actually sends back — but it was being asserted on the wrong
evidence the whole time.

### [2026-09-18 08:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Item 1: built on a branch, NOT yet merged — the preview has to
confirm it first.** This is the third attempt at the root-publishing
problem and the first that addresses the cause, so it does not go
straight to `main`.

The change: Vite's `outDir` moves from `..` (the repo root) to
`../dist`, the committed bundle moves with it, and `wrangler.jsonc`
gains `"pages_build_output_dir": "./dist"`. The old `assets.directory`
key is deleted — it is a WORKERS key, this is a Pages project, and it
has never done anything; leaving it would preserve the misreading that
cost two previous fixes.

Everything that named the old paths moved too, and missing one of these
is how this lands broken: `package.json` (`prebuild`, `verify:browser`),
`.size-limit.json`, `.gitattributes`' linguist markers, `.gitignore`'s
note, and the CI bundle-freshness gate in `check.yml`, whose grep for
`^(assets/|index.html$|sw.js$)` would otherwise never match again — it
would stop failing on a stale bundle silently, which is worse than
failing loudly.

Local gates all green against the new layout: typecheck 0, lint 0, 844
tests, knip clean, size-limit reads `dist/assets/app-*.js` at 110.45 kB,
and the browser sweep serves `dist` instead of `.` — 98 checks.

**What the preview has to show before this merges:**

  /                                200, and its HTML references the
                                   asset hash committed on THIS branch
  /assets/app-<branch hash>.js     200
  /manifest.webmanifest, /sw.js    200
  /LEDGER.md                       404
  /handover.md                     404
  /src/app.jsx                     404
  /supabase/functions/auth/index.ts 404

The failure mode is loud, which is the one good thing about it: if
Pages ignores `pages_build_output_dir` it serves the repo root, and the
repo root no longer has an `index.html`, so the preview is simply dead
rather than quietly still publishing everything.

Afterwards, per the item's own plan: rotate both app passwords and
`APP_AUTH_SECRET` again. The Edge sources were readable for months.

### [2026-09-18 07:30 UTC] Platform: Claude Code | Model: not recorded (session policy)

Davies cleared items 1-3 of the what-remains list for verify-and-fix.
Items 2 and 3 are done; item 1 is next and goes on a branch.

**Item 2 — the RECORDED rule has walked left, and there is now a gate
saying so.** The sweep had been serving `{rows: []}` for
`action=price-snapshots`, so the whole provenance path — fetch,
`recordedFromMs`, `provenanceSplitIndex`, the faded stretch and the
dotted rule — had never run in an integration test. It now serves rows
shaped like the real feed, recording starting 30 days back, ending
before the fixture's current session so no drawn value can move.

The check is a PAIR and only the pair is evidence: 24H must draw no
handover rule, 3M must draw one. A window with nothing recorded also
draws no rule, so "no rule on 24H" passes vacuously — confirmed by
running the suite against an empty feed, where 24H still passed and 3M
failed. 98 checks now.

**Item 3 — the answer is that the test it was waiting for has not
happened.** Measured across every recorded sample rather than waiting
for one: the largest single five-minute step in THIRTY days of
after-hours is 1.77 % (2DG.SG, 09-16); overnight over seven days it is
0.79 %. `ahQuoteTolerance` doubles the biggest step and floors at 3 %,
so it has been pinned to its floor the entire time. The scaling engaged
exactly once, at 3.54 %, on a name whose quote never needed it. The fix
is dormant, which for a guard-loosening change is the right resting
state.

**And I broke it while checking it, which is the part worth recording.**
Reading the code I noticed `LOOKBACK = 12` is a bar COUNT while the
comment claims "the last hour" — true on `app.jsx`'s `1d`/`5m`
validation fetch, false on the chart modal's fallback path, which hands
it whatever range is on screen. I rewrote it as a wall-clock hour. The
BE pin went red immediately: the after-hours tape is SPARSE, BE's
8.76 % bar printed at 20:10 and its last AH bar at 23:59, so an hour
back from the last bar holds one bar, finds no step, falls to the 3 %
floor and calls a real print fake — the exact bug the fix was written
for.

Reverted. The count is also right where the modal hands it coarser
bars: a coarser bar means a staler last bar, so the quote can
legitimately sit further from it, and a count window over coarser bars
widens in step. Both the reasoning and the counterfactual are now in
the function's comment and in a third test, because this is the second
time this file has had to defend a deliberate-looking-wrong constant.

### [2026-09-18 06:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Crypto joins the grid, and the grid learned about weekends.** Davies
set the rule flat: no 3M chart anywhere should record every hour around
the clock. Crypto was the last one doing it.

I had excluded crypto in the entry below for a real reason — the grid
skipped weekends, and a 24/7 tape would have lost two days in seven. The
answer was to fix the grid, not to exempt the instrument.
`fourHourSlots` takes `includeWeekends`; on a weekend day there is no US
close, so the sixth sample is 21:00 London, which is the hour the close
falls on in both matched DST regimes and keeps the step a clean four
hours right through Saturday and Sunday.

`tradesAllWeekdayHours` is gone, replaced by `tradingWeekOf` returning
`all` / `weekdays` / `session`. One classifier instead of a predicate
plus an exception, and it says what it means: the grid spans the days
the instrument trades.

After this, the full inventory — checked, not assumed:

  portfolio panel 3M    slot grid, weekdays
  crypto modal 3M       slot grid, every day
  futures / FX modal    slot grid, weekdays
  index / equity modal  hourly, but only across its OWN session

Nothing draws 24 hourly bars a day at 3M any more.

**The panel stays weekday-only even if the book holds crypto.** Its x
axis is index-based, so six points a day for two days in seven would
spend a quarter of the width on a stretch where only a crypto sliver
moves. It is already six-a-day, so it was never what he was objecting
to — but it is a judgement call and he should know it was made.

Pinned: the weekend grid's exact slots and its uniform four-hour step;
crypto's modal point count equals the weekend-inclusive grid while
ES=F's equals the weekday one, on the SAME nine days of bars.

### [2026-09-18 06:20 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The four-hour grid now follows the TAPE, not the panel.** Davies
pushed back on the entry below, correctly: with extended hours on, the
Market Conditions cards open futures and FX charts, those trade right
through the night, and at 60m their 3M was ~23 bars a day — denser than
the portfolio panel beside them and on entirely different instants.

The scoping rule I had ("grid on the panel, hourly bars in the modal")
was the wrong axis. The real question is whether the INSTRUMENT prints
through a weekday night, and `tradesAllWeekdayHours` (futures OR spot
FX) now answers it in one place. 3M for such a ticker is resampled onto
the same `fourHourSlots` grid the panel uses; an index, a listed equity
and a US stock keep hourly session bars, because on that grid they land
on two live prices a day and carry the previous close through the other
four.

**Crypto is deliberately NOT in the predicate**, though it trades the
most of all: the grid skips weekends — right for anything whose venue
shuts on Friday, wrong for a 24/7 tape, where it would drop two days in
seven of real movement.

Two things had to move with it or the overlay would have lied. The MA's
wider history is resampled onto the same grid (`computeMaSeries` unions
history and display BY DATE, so 60-minute history bars beside
six-a-day display bars would make "MA 20" cover a span that drifts from
20 days at the left edge to 23 at the right), and `maBarsFor` takes an
explicit `SLOTS_PER_DAY`. Also hoisted the Intl formatter out of
`usMarketHoursUtc` and gave `fourHourSlots` a 4-entry cache: the chart
asks for a 3-month grid while its MA asks for a 6-month one, and a
single-slot cache had them evicting each other ~1200 Intl lookups a
render.

Pinned by a modal render test that draws the SAME four weekdays of
hourly bars twice: ES=F comes out at exactly the grid's slot count,
^GSPC at exactly the bar count (96), BTC-USD likewise. Counterfactual
run — disabling the predicate turns 21 into 96 and the test fails.

### [2026-09-18 05:20 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Top Movers' window switch moved to the heading.** It was grouped with
the `%` / `$` switch on the right; Davies said the two crowded each
other. It now sits against the title, where the old `· TODAY` suffix
did — which is what it is: the panel's name, finished. The measure
switch stays at the far right. Checked at both breakpoints with real
screenshots.

**He also asked why 3M looks hourly rather than six points a day.
Because I scoped the grid to the portfolio panel and did not say so.**
`fourHourSlots` / `resampleToSlots` are wired ONLY in `perf_chart.jsx`;
the ticker modal's 3M just moved from daily to 60-minute bars, so it
draws Yahoo's session bars — hourly, and nothing overnight. The panel
IS on the six-slot grid (the sweep pins 261 points where it drew 3).

The reasoning, which stands but should have been stated when it was
made: the four-hour London grid is right for the BOOK, which is
multi-venue and moves around the clock, and wrong for a single US
instrument, which prints in only two of the six slots (17:00 London is
mid-session, plus the close; 13:00 London is pre-market and the fetch
is regular-hours only). On a slot grid a single US stock would be four
flat carry-forwards a day — a staircase where hourly session bars give
a clean, dense line. Left as it is, and Davies knows the choice now.

**Separately, and worth not re-deriving:** even on the panel, the
overnight slots only carry real movement where a holding's own venue
trades then or where `price_snapshots` has a print. Recording starts
2026-08-19 — 30 days as of today — against a 93-day window, so the
oldest 63 days of a 3M chart have no recorded overnight at all and
those slots carry the previous close forward. That stretch fills in on
its own as recording accumulates; it is not a bug and needs no fix.

### [2026-09-18 04:50 UTC] Platform: Claude Code | Model: not recorded (session policy)

Three reports from Davies, all three real.

**1W's points were unevenly spaced, and the cause was measurable.**
He said some gaps looked 15 minutes and some 20. Queried the live RPC
at the 900-second bucket the chart reads with, and the returned
timestamps gap 15, 15, 15, 25, 5, 15, 20, 15, 20 — at :05, :25, :50,
off Yahoo's :00/:15/:30/:45 grid entirely. The bucket guarantees at
most ONE row per fifteen minutes but hands it back at the moment it was
WRITTEN, so a recorder tick near a boundary (or a missed one) drifts.

`recordedBarDate` now floors the sample onto the range's bar grid for
the ranges that DRAW it as a bar — 1D 5 m, 1W 15 m, 1M 1 h. That is
not a rounding convenience: Yahoo stamps a bar by its START and carries
the price at its END, which is exactly what the last sample inside a
bucket is, so flooring is the honest label AND puts recorded bars on
the same instants Yahoo's occupy. Fed the real measured timestamps
through it: `5 20 15 20 15 5 25 ...` becomes `15` throughout. Pinned
with those same timestamps.

3M is deliberately exempt. Its chart SAMPLES with `closeOn` at the
four-hour slot grid, where a bar's date is read as "the price at this
moment" — flooring a 19:55 observation to a 16:00 key would make it
the 16:00 price, a four-hour lookahead.

**Caveat he should know**: rows already coarsened to 30 minutes by the
OLD prune band are still 30 minutes apart, so the recorded stretch of a
1W chart shows even 30-minute gaps in its older half until the 8-day
window rolls past them. Even, not ragged, and self-healing.

**The 3M crosshair showed a date and no time**, and the reason is the
same shape as every other bug this week: two copies of one rule. The
performance panel called `crosshairFormatFor`; the ticker modal had its
own inlined `rangeKey === '1W' || rangeKey === '1M'`. 3M went intraday
and only the panel noticed. The function moved to
`ticker_chart_helpers.js`, both charts call it, and a test derives the
expected answer from `RANGES[k].interval` so a future intraday range
drags the pill with it.

**Top Movers: three windows, in the title row.** He cut it to TODAY /
1W / 1M and asked for the window switch beside the `%` / `$` one rather
than in a range row at the foot. Done, same `view-tabs` idiom, one
shared arrow-key handler for both groups, and the heading goes back to
a plain name because the selected tab states the window. Checked at
both breakpoints with a real screenshot, not just a passing selector:
`TOP MOVERS` + `TODAY|1W|1M` + `%|$` fits the 380 px sidebar with room.

Gates: typecheck 0, lint 0 errors, 835 tests, knip clean, sweep ALL
GREEN 94 checks.

### [2026-09-18 02:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Top Movers opens past TODAY.** Last item of the 2026-09-17 batch.
A window row — TODAY / 1W / 1M / 3M / YTD — at the FOOT of the panel,
where the performance chart's range row sits. Below the lists, not
above: a second control strip stacked over the content pushes the
names, which are the point of the panel, down the screen on a phone.

The feature costs no network. The longer windows are priced from the
per-range history the performance panel ALREADY prefetches, anchored by
the same `buildTickerSeries(..., anchorAtWindowStart = true)` call the
chart makes — so "NVDA over 1M" means one thing in that sidebar, and
there is no second anchor rule to drift. TODAY still passes
`metrics.js`'s own `dayPct` / `dayChange` straight through rather than
recomputing them from prices: a second implementation of the day move
is what would put the heat map and this panel at odds.

The ranking itself moved OUT of the component into `movers.js`, pure
and pinned by 16 closed-form cases. Eligibility is unchanged and now
stated once: never cash, never a CN fund, and only names `pctIsFlat`
agrees actually moved.

The $ figure over a window is the price move valued on TODAY's holding
— deliberately not a P/L attribution. A position opened mid-window did
not earn the whole move, and the number that accounts for that is the
performance panel's, which walks the lot ledger. Written down in the
module and the README so it is a decision, not an oversight.

**The sweep caught a real one, and it is the kind worth remembering.**
The window buttons first reused `.perf-range-btn`, the chart's class,
to inherit its look. Both rows then answered to the same selector, so
`:visible:text-is("1M")` hit whichever came first in the DOM — the
chart on desktop, the SIDEBAR on a phone. Desktop stayed fully green;
phone failed four checks, and the numbers it printed (+$240 / +$100 /
+$63 instead of +$13 / +$12 / +$4) were the movers panel obediently
showing a YTD window nobody asked for. Fixed with its own
`.movers-range-btn`, sharing only the CSS rule, and a new sweep check
asserts picking a movers window leaves the chart's range alone.

Two controls that look alike must not BE alike to a selector. Nothing
in `npm test` could have found this: both panels render correctly in
isolation, and only a real layout at a real breakpoint puts them in an
order where one shadows the other.

Gates: typecheck 0, lint 0 errors, 831 tests, knip clean, bundle
110.19 kB of 122, sweep ALL GREEN at 94 checks.

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
