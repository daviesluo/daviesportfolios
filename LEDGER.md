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

0a. **THREE STUDIES STOPPED MID-FLIGHT ON A USAGE LIMIT (2026-09-22
   16:55). Resume them in this order.** All three briefs are reproducible
   from this list; nothing depends on the stopped sessions' memory.

   **J — the Jev study: RAN, output committed, UNVERIFIED.**
   `supabase/functions/agents/backtest_jev.ts`,
   `docs/agents/backtests/jev.json`,
   `docs/agents/reviews/2026-09-22-jev-veto-study.md`. It claims
   `rule ∧ Jev` turns window A from **+8.0 % to −2.5 %**. **Step one is to
   verify that**, the way §4.20's findings were verified: re-derive the
   sleeve from raw candles, check the study's arm against `run`
   cell-for-cell, and confirm the veto resolution rule
   (`surfaceFromRecord`) does what the report says. Step two is to run
   `--replay live`, which ASKS the model instead of replaying twelve
   recorded answers — that needs a Jev transport, reachable through
   `pg_net` from inside Postgres the way the probe was (the secret never
   leaves the database). Step three: if the finding holds, `go-live.md`
   §4 and §7 and reference §4.21 all need rewriting, and the live
   recommendation itself has to be re-asked — a rulebook whose bear year
   is −2.5 % is not the row that brief recommends.

   **S — SUI's seat: script written, NOT run.**
   `supabase/functions/agents/backtest_sui.ts` exists and typechecks; no
   output file. The question (Davies, 2026-09-22): SUI clears §4.15 on
   window A alone, and the four-window ranking rule is structurally blind
   to it because SUI does not exist in C or D, so `drop·SUI` reports a
   delta of exactly 0.00 — an identity, not a measurement. Judge it on the
   windows it HAS, on the span where all five coins exist, and on rolling
   six-month folds; measure whether its contribution is drawdown damping
   (it lowers return in both windows it is in and raises ret/DD in A).
   Answer "keep in paper" and "keep in LIVE" separately. **Also check
   whether §3.8's admission of SUI reproduces under the shipped stop
   rule** — AVAX's verdict turned out to be stale in the other direction
   today, and SUI's may be stale in this one.

   **K — the last untested Kraken avenue: NOT started, nothing produced.**
   84 coins clear the cost-and-book screens and could not be tested for
   lack of history (17 Kraken-cheaper: PENDLE, STRK, AIOZ, JTO, MOG, EUL,
   KTA, SWELL, TRAC, BLUR, PROMPT, KAITO, W, TURBO, PROVE, PONKE, RLS; 67
   Kraken-only). Kraken's public OHLC gives only the 720 most recent bars;
   the history is in the free quarterly OHLCVT bundle, which
   `backtest_windows.ts` already used to build window C — follow that
   precedent. **Disk is a fixed per-session allowance**: fetch
   selectively, unpack only the 240-minute files, delete as you go. Run
   §4.15's four tests on SEEDED parameters, state the null before
   reporting passes, and run the six-month folds too. **Second half of the
   same task**: should the Kraken balance move to Revolut X? Nothing in
   the design needs a funded Kraken account — candles and the basis are
   public — but confirm that in `_shared/kraken.ts` and `tick.ts` rather
   than assuming, and say what reversing would cost. Davies asked; no
   money moves without his word.

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
   (b) **Thin-book guard — BUILT 2026-09-22.** A long's stop is judged at
   the BID (`exitMark`), never the mid, and an ENTRY is refused when the
   book is wider than 50 bps (`WIDE_SPREAD_BPS`; `bookBps` on the decision
   row). An EXIT is never refused by it: a position that cannot get out is
   the worse failure. Measured the same day on the live UK book — BTC 1.6,
   ETH 3.2, SOL 4.2, AVAX 9.1, SUI 25.7 bps — so only SUI is within
   hailing distance of the ceiling.
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
   agents function redeploys. STILL TO DO (nothing blocking a Revolut X
   live start): S2's answer is in §3.4 and may change what goes live; the
   review's remaining item is S7's venue half —
   the Kraken key's nonce window is Davies' setting at Kraken, before any
   Kraken live row; the review's doc gaps for retention of
   `agent_decisions` / `agent_orders` (unbounded; ~150 + ~25 rows a day).
   (g) **Live is waiting on Davies' word, and only that.** The brief is
   `docs/agents/go-live.md` (rows, coins, mechanics, edge, both windows'
   returns, fees, caps, what can go wrong). Recommendation in it:
   **`trend-4h` on Revolut X live, everything else paper** — the rulebook
   with the most evidence, the tightest drawdowns, a trade count 20 bps
   survives, on the venue that holds USD; rotation is negative out of
   sample on both venues and its own stops make it worse, momentum
   carries 33–56 % drawdowns, trend-1h is on a plateau on no coin, and
   every Kraken row is blocked by GBP → USD and the nonce window anyway.
   The headline fact he must weigh: **of 21 shipped members not one
   clears the two-window bar**. When he says go, the switch is ONE
   migration, **drafted, dry-run and committed at
   `docs/agents/0047_go_live.sql.draft`** — deliberately NOT under
   `supabase/migrations/`, because a file there is applied by
   `migrations.yml` on the next push, so MOVING it is the act of going
   live. It adds `trend-4h-live` as a new row (rather than flipping
   `trend-4h`, which would strand three paper positions and cost the live
   row its same-venue control), sets `live_confirmed_at`, and raises
   `max_exposure_usd` $100 → $150 for the mark-to-market reason in §4.19.
   **The pre-live verification is done (2026-09-22, §4.19 and go-live §9)
   and found one real defect, now fixed: a position did not carry the mode
   it was opened in.** One box is left and it is Davies': run the
   read-only `probe` — **run 14:05 UTC and green**. **But the switch is no
   longer only his word**: the Jev study (item J below) may have turned the
   bear year negative, and that is the window the recommendation rests on.
   Verify it before going live. Then watch the first live order: its read-back is what verifies
   Revolut X's settlement field names (B4), and the page raises a banner
   if it is left pending.
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
Everything before 2026-09-22 lives there already — the 2026-09-05 →
2026-09-21 sections under Part 2's "LEDGER.md history, archived
2026-09-22", oldest first.

### [2026-09-22 19:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Archived 62 history sections (2329 lines, 2026-09-05 → 2026-09-21)
verbatim into `handover.md` Part 2**, oldest first, each checked
character-for-character against the original before this file was cut.
Nothing was deleted. The ledger had reached 3,300 lines, and every
session on every platform pays for it on every wake. The what-remains
list above is unchanged and is the whole briefing; open the archive only
to reopen or audit a closed item.

### [2026-09-22 18:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The real model was asked about every state it can ever see on an
entry, five times each, and the Jev question is answered.** The entry
state has only 90 possible values (5 coins × trend_strength ×
volatility × momentum; the rest is fixed on an entry). `POST
?action=jev` asked OpenRouter's `typesafe/jev-1.13-20260917` all 90 ×
5 = 450 calls, $0.0126, requests 26655/26656, zero no-answers, zero echo
failures:

| strength | vol | momentum | P(healthy) mean [min–max] | vetoed at 0.6 |
|---|---|---|---|---|
| weak | any | positive | 0.07–0.13 | **100 %** |
| moderate/strong | low/normal | positive | 0.94–0.97 | 0 % |
| moderate | high | positive | **0.600** [0.55–0.62] | 7/25 |
| strong | high | positive | **0.598** [0.56–0.64] | 12/25 |
| any | any | unknown | 0.04–0.21 | 100 % |

Caution never reaches 1.75 on an entry. **Two findings, both
structural:** (1) **the weak-trend veto is not the model's judgment — it
is the question's own prose**: `healthy_trend` tells the model to say yes
only when trend_strength is moderate or strong, the rulebook never reads
strength, and the model complies every time. That clause is an
untested rule hiding in a prompt, and it is what costs the bear year most
of its return in the earlier study (`weak-veto-only`: A +8.03 % → +0.63 %).
(2) **the high-volatility veto is a coin flip AT the threshold**: those
states' mean P sits on 0.600, and the same state on the same coin flips
between calls (strong|high ETH: 0.58 0.58 0.61 0.63 0.64). Whether real
money buys a high-volatility breakout would be decided by one call's
noise. The earlier study's bracket (`highvol-vetoed` / `highvol-passed`)
is therefore the honest answer and its "central" arm is not; its
assumed 0.15 for the weak states is confirmed (measured 0.07–0.13).

**Re-pricing with these answers is running** (Monte Carlo over the
coin-flip states; three configurations — rule with the model in shadow,
rule ∧ model as it runs, rule + the weak-trend clause as code — each
against its random-veto null). Nothing about the live row changes until
it lands and is checked. `docs/agents/backtests/jev_answers.json` will
hold the raw replies; `net._http_response` prunes them after ~6 h, and
re-measuring costs $0.013.

**A shadow switch, built and NOT switched on.** `params.jevGate: false`
on a strategy row keeps asking the model and recording its answer but
takes away its vote: the entry is the rulebook's — what every backtest
prices — and the decision's reason says what the gate WOULD have done
("model in shadow — would veto (P=0.59 < 0.6)"), so the counterfactual
stays one query away. Two of the three configurations the go-live
decision is choosing between need it; the default keeps today's
behaviour on every row, so nothing in production changes. Pinned in
`strategy.test.ts` and `tick.test.ts`; counterfactual checked (ignore the
switch in the tick and the new test fails).

### [2026-09-22 18:25 UTC] Platform: Claude Code | Model: not recorded (session policy)

**I broke the tick for two hours and the tests could not see it.** `8e03297`
(16:20) made `selectAll` throw on a query with no `order=` — and
`tick.ts`'s count of today's orders had none. Every tick from then on
wrote the basis (section 1), then threw in section 3, before the book,
the protective stops, the observations and the decisions: **122 errors,
no decision after 15:00:03, and `trend-4h`'s three paper positions with
no floor for two hours.** Found at 18:16 on a fresh read of production,
not by any gate. Paper, so nothing real was exposed; live, it would have
been real coins with no stop — the exact failure this morning's work was
about.

**Why every test was green**: the guard lived only in the real client
(`db.ts`); the tick tests' in-memory stub had its own `selectAll` that
paged without it. The stub was looser than production — the same lesson
the CHECK-constraint bug taught six hours earlier, paid for twice in one
day. **Fixed at the root, not just at the caller**: the guard is now one
exported function, `assertPagedOrder`, called by the real client AND by
the stub, and the caller has its order. Counterfactual: drop that one
`order=` again and **55 of 60 tick tests fail**; restored, 60 of 60.
338 Edge tests green.

**What to do differently, and it goes in the skill**: after a deploy
that touches the tick, read production — decisions and `ops_errors`, not
the basis, which is written before most of the loop runs and so reads
"alive" through a crash.

**Recovered 18:19, verified from production, not from the badge.** The fix
deployed (every step green, Deploy included — the concurrency group
cancelled the hung `944c36d` run). Last `selectAll` error 18:18:02; the
first tick after it wrote decisions for every pair at 18:19:03–04, the
first since 15:00. All holds: `trend-4h` still long BTC/ETH/SOL with no
exit condition, so **no paper position crossed its floor while the stops
were down** — the outage cost `trend-1h` two or three hourly decisions
(only the last closed bar is ever claimed), and nothing else.

**`POST ?action=jev`** added to the agents function: a read-only
measurement of the model the entry gate reads. The state the loop can
show the model on an entry has only 90 possible values, so asking the
REAL model about every one, several times, turns the Jev study's replay
from an inference over twelve recorded answers into an exact lookup.
Operator-only, one transport per request, capped at 500 calls (~$0.01),
every state validated against the closed vocabulary (`STATE_VOCAB`,
`parseState`), and each reply read by `jevViewOf` — extracted from the
tick, so the measurement reads the model exactly as the gate does.
Places nothing, writes nothing. Pinned in `index.test.ts`.

**The standing rules caught up with the day.** `CLAUDE.md`'s agents
section still said FOUR rows and described `trend-4h-kraken` as running;
it now says three, why the twin went, that Kraken is signal-only, that a
row's label is not its book, where the go-live draft is, that the model's
veto is unpriced, and that a test double must be as strict as what it
stands in for. The same six lessons went into `working-with-davies` and
both Cursor copies, which are verified still identical.

### [2026-09-22 16:55 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Stopped on a usage limit, deliberately and with everything landed.**
Three studies were running; all three were stopped and their work
committed. **Read the next section's items J, S and K before doing
anything else** — one of them may have overturned the live case.

**The Jev study RAN and its headline is the biggest number of the day,
and I have NOT verified it.** `backtest_jev.ts` →
`docs/agents/backtests/jev.json` → `reviews/2026-09-22-jev-veto-study.md`.
It says the live sleeve's four windows move from

| | A (bear) | B | C | D (sideways) | worst |
|---|---|---|---|---|---|
| `rule` (every published table) | **+8.0 %** | +20.1 % | +55.6 % | −7.8 % | −7.8 % (D) |
| `rule ∧ Jev` (what runs) | **−2.5 %** | +15.8 % | +52.4 % | −1.5 % | −2.5 % (A) |

i.e. **the bear year that the whole go-live case rests on becomes
NEGATIVE**, while the sideways year improves 6.4 points. Historical veto
share 47.8 % against the live record's 20 %.

**Two caveats that are the study's own and matter as much as the
number.** (1) **The default arm does not call the model.** It replays
Jev's TWELVE recorded answers from `agent_decisions` onto historical
states by a pre-registered rule; `--replay live` is the arm that asks the
real model and has not been run. (2) The two recorded high-volatility
cells sit at **0.59 and 0.61** — one hundredth either side of
`enterMin`, and the model is repeatable only to about ±0.01 — so the
`highvol-vetoed` / `highvol-passed` arms BRACKET the answer rather than
give it, and their worst windows are −6.6 % and −3.3 %.

**I have not checked a single one of those figures.** Twice today a
reported number turned out to be the opposite of the record (AVAX's bar
verdict, and my own claim that the winding-down fix worked). **Verifying
this one is the first thing the next session does**, before it is
repeated to Davies as fact or acted on.

`0046` applied cleanly: 3 strategy rows left (`momentum-1d`, `trend-1h`,
`trend-4h`), orders 15 → 12, decisions 247 → 197, observations
1209 → 883, probes untouched, `live_confirmed_at` still null. All three
workflows green on `8e03297`.

**If `edge-functions` shows RED on `944c36d`, it is a false alarm — do
not chase it.** Both gating steps passed (Deno typecheck ✓, Deno test ✓)
and the run then hung on "Install Supabase CLI", a GitHub infrastructure
step, with `updated_at` frozen at 15:39:32. That commit changes **no
deployed Edge Function source** — only two study scripts and docs — so
there was nothing for it to deploy, and `8e03297`, which did change
`tick.ts` and `index.ts`, deployed successfully before it. Production is
current. Re-run the job if you want a green badge; there is nothing to
fix.

**The maker question, asked and answered for now**: the live row ships as
a TAKER (marketable, 9 bps) — that is what `tick.ts` does and what every
backtest assumes. Maker is not a rival version, it is an open question
`0042` measures, and the probe has **3 observations**: all sells, filled
in 1–3 minutes, spread saved 1.6–3.4 bps, adverse at 60 min −31.1 / +3.6
/ +82.7 bps (positive = against the fill). Mean +18.4 bps against a 9 bps
saving, on n = 3, which is noise. It needs 30–100 probes: 2–4 months.

### [2026-09-22 16:20 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`0046` deletes `trend-4h-kraken`** on Davies' word ("这三点按照你的建议
处理"): 3 orders, 50 decisions, 326 observations, 0 probes, 0 backtests.
Paper records only, nothing stranded at a venue. Dry-run first, as every
delete here is now. **Kraken is a SIGNAL venue only from here** — every
rule still reads its candles — and the browser sweep was moved to that
shape: three rows, the book on `trend-4h` where production keeps it, and
a venue card with ZERO execution rows, which is what the page must handle
now. 208 checks green, so it does.

**The audit's reasoned-but-unreproduced list was worked through** ("这里面
你认为该修的也都修了"). Five of seven fixed:

- **The lease renewed exactly once**, bounding a turn at about half a
  lease plus a lease; past that the lock expired under a turn still
  placing orders and the next cron minute ran beside it. It renews
  whenever the lease is half gone now.
- **A fresh order with a null `decision_id` is refused.** `0041`'s index
  is partial, so such an order carries no claim and two turns would both
  place it. A re-quote is left alone on purpose — it replaces a row the
  same turn already settled, and `MAX_REQUOTES` bounds it.
- **The day's open was yesterday's OPEN for the first minutes of every
  UTC day**, before the venue publishes today's daily candle: a whole
  day of move counted as today's, every night, which inflates `dayPnl`
  and can spend the $5 limit on a move that already happened. Yesterday's
  CLOSE is where today opened.
- **A partial fill is stamped when it first filled**, so the
  realised/unrealised split stops changing retroactively.
- **Every paged read orders by a unique column last**, and `selectAll`
  now REFUSES an unordered query: LIMIT/OFFSET is stable only under a
  total order, and a fill read twice is a position counted twice.

Two recorded rather than fixed, with the reason: the exposure bucket
reads `rows[0].venue`, which misbills only if a strategy's `venue`
changes and no migration does that; and the re-quote decision id, above.

### [2026-09-22 15:35 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`trend-4h-kraken` makes no decision of its own — 50 of 50 paired
decisions match `trend-4h` exactly, 0 differ**, on `final_action` and
`rule_action` alike, because both rows carry `signal_venue = 'kraken'`
and the same rulebook, parameters and coins. It can differ ONLY through
the fill path, **nothing reads that path** (no Kraken `probeSummary`
anywhere; `agent_maker_probes` is 3 rows, all revx), and the path is a
SIMULATION whose accuracy has now been measured keylessly in 18 minutes:
a resting order at Kraken's touch is reached 79 % within a minute and
91 % within five, against the loop's candle model's 82 % and 92 % —
accurate to 1.01–1.04×, repeatable from two public endpoints any
afternoon. Meanwhile it pays **4.44× the fee for identical fills**
($0.1600 against $0.0360; Kraken's PRICE was 1.27 bps better, the fee is
the whole difference at +29.70 bps a side). Davies' read was right.
**Recommendation: delete it, add nothing.** Draft at
`supabase/migrations/0046_delete_kraken_twin.sql`, dry-run clean (0 probes,
3 orders, 50 decisions, 326 observations, 0 backtests; 3 rows left).

**Nothing Kraken-native clears the bar either.** Eighteen coins chosen by
a cost-and-book screen BEFORE any backtest: with a search, 2 two-window
passes against 1.39 by chance; **on seeded parameters, 2 against 3.33 —
fewer than chance**. Six six-month folds with nothing chosen: the live
five are positive in 39 of 60 on Revolut X's costs, the 18
Kraken-advantaged coins in **49 of 216 (22.7 %)**, best-of-18 3 of 6. A
free fee schedule moves them 1.8 points. The problem is the coins, not
the venue. Market making is dead by arithmetic (median spread 14.76 bps
against 80 bps a round trip). The fee tier is 30.4× the turnover away and
worth +0.73 points.

**Two corrections to the reference.** §3.19's "the two cost schedules do
not overlap by 26.2 bps" is true over the 27 coins in `COSTS` and FALSE
over the book: across all 245 bases both venues list they overlap on 71,
26 with a real Kraken book, and the worst Revolut X round trip among
booked coins is PONKE at 409 bps. Verdict unchanged — the overlap is all
in the illiquid tail — but the sentence would fall over the first
measurement. And §3.14's "exactly zero times in 952 cells" is about
Revolut X's FEES at Kraken's SPREAD; against the real UK book Kraken wins
28 of 36 cells on the coins where it is cheaper. Same verdict, different
reason. Reference §4.22.

**One finding that is not about Kraken**: in the same fold test, Revolut X
RESTED at 0 % maker beat Revolut X taking the touch, 40 of 60 against
39 of 60, at 1.87–11.91 bps a round trip against 19.87–29.91. That is
`0042`'s question and the same ~18 bps the whole Kraken argument turns
on, on the venue already traded. No backtest can settle it — the probe is
the instrument and it is already running.

### [2026-09-22 15:10 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Jev has been vetoing one entry in five and nobody had counted it.**
Every published figure is the RULEBOOK's; the account runs `rule ∧ Jev`.
`agent_decisions`, all of it: 15 entry signals, 12 taken, **3 vetoed —
20 %** (`trend-1h` 2 of 5, `momentum-1d` 1 of 4, `trend-4h` 0 of 3).
**Two of the three were P(healthy) = 0.59 against a threshold of 0.60**,
so `enterMin` binds at its boundary — and it is a seeded parameter never
varied and never backtested that gates every entry the live row will
make. My own §9.1 line said "0 refused by the risk gate", which was true
and was not the layer doing the refusing. Now go-live §9.6 and §4.21.

**I told Davies something false about AVAX this morning and the record
had told me.** I said it cleared one walk-forward window and that §4.15
would not admit it today. That is the `trail` regime — the intra-bar
stop the loop STOPPED RUNNING on 09-21. Under the rule `tick.ts` runs,
recomputed by me from `tape.json`: **AVAX clears A, B and C, and is the
only coin of 27 clearing BOTH walk-forward windows**; SUI clears A alone.
`reference.md` §4.15 and `go-live.md` §3 both carried the stale version,
and §3's was the sentence that document calls its most important — it
said the re-run had not happened when it had, the same day.

**But it is not a qualification either, and the audit that found it
overstated it.** Across the 93 coin-window cells priced under the shipped
rule, 26 clear the bar: a per-window pass rate of **0.280**. Twenty-three
coins have both A and B priced, so chance gives 0.280² × 23 = **1.80**
coins clearing both, P(at least one) = 0.85. **One passer is fewer than
chance gives.** So the conclusion (keep AVAX) is unchanged and BOTH the
reason I gave and the reason the audit gave were wrong. The real reason
is §4.15's own: a member's record is not the argument. AVAX is the row's
largest concentration in both directions — ~95 % of the sideways year's
loss and ~57 % of the strong bull's gain — and the sleeve is steadier
holding it.

Also corrected: the set study's "four evaluations" are two on the window
that decides, because window D is bit-identical across the tape arms (its
own fidelity block proves it). The optimistic null is wrong by orders of
magnitude — the whole study's 15 of 98 goes from P = 0.0011 to P = 0.993.
It cuts in the incumbent's favour, so no verdict moves, but that column
is unusable rather than evidence.

### [2026-09-22 14:40 UTC] Platform: Claude Code | Model: not recorded (session policy)

**An independent audit found that there was no working way to stop a live
row that still held coins.** Three mechanisms, each independently broken,
each reproduced against the real code, and together they meant that on the
day a real position went wrong every lever the operator has been told to
pull either did nothing or made it worse.

1. **`live_confirmed_at = null` refused EXITS.** The check in `place()`
   tested the row's mode and the confirmation and never the SIDE, and it
   sits after `riskGate` has already allowed the exit. That switch is the
   first sentence of the emergency procedure in `go-live.md`. Pulling it
   would have left real coins with no floor and no rule exit, writing a
   decision row and an `ops_errors` row a minute per symbol while the
   record said the exit was allowed. Side-aware now; `global_pause` stays
   the one switch that outranks an exit.
2. **A paused row's exit order violated the schema, so the whole
   `windingDown` fix was INERT in production.** `agent_orders_mode_check`
   is `in ('paper','live')`; the tick wrote `mode: s.mode`, which is
   `'paused'` for exactly the rows `0038` and `0043` retired. The decision
   landed (no check on that table), the ORDER was refused by Postgres, the
   error carried no `409|duplicate|unique` so it was swallowed into
   `report.errors`, and the page went on telling the owner the floor was
   running. **My own tests certified it**, because the in-memory stub does
   not enforce CHECK constraints. The stub enforces the mode check now, and
   reverting the fix turns those three tests red.
3. **A live row demoted to `mode = 'paper'` read itself flat** — offered
   as an undo — so its real coins lost their exits while it started buying
   on paper beside them.

One root: **a row's `mode` LABEL and the book it is trading are different
things.** `bookMode(s, sym)` resolves the book — real coins outrank the
label, else the row's mode, a paused row falling back to paper — and the
order, the decision, the probe, the exposure bucket and the caps all follow
the BOOK. `riskGate` keeps the LABEL, because "may this rulebook take new
risk" is what it asks. `offBook()` generalises `windingDown` from "retired"
to "holds a book it does not trade".

**Two more holes left a real position unprotected.** An order that could
not be read back or cancelled blocked its pair's stop every minute,
indefinitely — and an unreadable filled order is exactly what B4 produces
if the settlement field names are wrong, so the first live order could both
fail to settle AND disarm the stop on the coin it just bought. A `pending`
row, which is what a venue timeout produces, did the same. A buy is not the
exit: the stop steps past it, says so, and sells what is held; only a SELL
in flight still stands it down.

**The dashboard had not been given this morning's fix** — `index.ts` still
keyed on strategy and symbol with no mode and billed `byMode` from the row's
label, so a row that ever changed mode drew one position out of two books
and the whole blend landed under "live realised". It resolves the book the
same way the tick does now.

Four smaller fixes: a `filled` reply reporting `filled_size: 0` is a problem
rather than a fill of the whole order at fee zero (absent is still absent —
that distinction cost a test); `positionFromFills` sorts to a total order,
buy-first at a tie; `stepDecimals` reads an exponential step; a paused row is
refused before `askJev` is paid. **`0045` makes `agent_maker_probes`
cascade** — a THIRD child of `agent_strategies` that `0044` did not delete,
which survived on luck because the only three probe rows belonged to a row
that stayed. Orders and decisions stay explicit: a forgotten one should fail
loudly, which is what happened.

**The go-live draft is corrected and renumbered `0046`.** Its TO UNDO said
both of the false things above; the flip-in-place alternative is struck; the
row is written out in full instead of copied by `select` (dry-run verified
byte-identical to the paper row's params) and `on conflict do nothing` is
gone, so a re-run fails rather than quietly arming the live gate beside a row
of unknown shape. Reference §4.20.

### [2026-09-22 13:52 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The pre-live verification found the thing it exists to find.** A
position did not carry the mode it was opened in: `tick.ts` keyed the
book on `strategy_id|symbol` alone and read its exposure bucket off the
FIRST fill's mode. So a row flipped from paper to live would have
inherited its paper positions — the rulebook reads itself already long
(`ruleDecision` only holds or exits while `position.base > 0`), never
buys the coin for real, and the first exit or 8 % floor places a **real
sell at Revolut X for base the account never bought**, billed to the
paper cap. `trend-4h` is long BTC, ETH and SOL on paper at $13.33 a slot,
so this was one migration from happening. The mode is in the key now
(`posKey`), one resolver (`bookKey`) hands both the position and the fill
history to the row's current book — which also caught that the re-entry
cooldown read `byKey` under the old key, so the first patch broke two
existing tests and said so. A PAUSED row keeps `0043`'s behaviour and
still sees its book, or the stuck positions come back. Three pins in
`tick.test.ts` / `strategy.test.ts`, counterfactual checked (drop the
mode, the test goes red).

**Everything else verified, with numbers.** 1,440 / 1,440 minute ticks in
24 h; every HTTP reply in the retained 6-hour window a 200; 137 decisions
with **0** `provider: none` and 0 refused by the gate; 3 agent errors in
48 h, each a single occurrence and each explained, none in 11 hours.
**AVAX's and SUI's `min_order_size_quote` is finally measured** (§3.13's
fourth caveat, the assumption under every $20 slot on those two):
`/1.0/public/configuration/pairs` is PUBLIC and keyless — all five coins
`active`, minimum **$0.10**, so a $20 slot is 200× the floor; steps are
already honoured in code, worst rounding residue $0.0005. Live UK touch
the same minute: BTC 1.6 / ETH 3.2 / SOL 4.2 / AVAX 9.1 / **SUI 25.7**
bps, all inside the 50 bps refusal, and SUI's 25.7 + 9 bps a side is the
43.7 bps round trip §3.8 priced it at.

**Two cap facts.** The exposure cap is marked to market, not costed
(`base × mark`), so at $100 against a $100 row four slots up 6 % refuse
the fifth entry — it tightens exactly when the rulebook is working.
Raising it cannot loosen risk, because the rulebook does not pyramid: five
coins at a $20 per-order cap deploy at most $100 of capital whatever the
number says. The draft sets $150. `daily_loss_limit_usd` $5 is 5 % of the
row and blocks new entries only, never an exit.

**The draft migration is `docs/agents/0047_go_live.sql.draft`, and it is
deliberately NOT under `supabase/migrations/`** — a file there is applied
by `migrations.yml` on the next push, so moving it IS the act of going
live. It adds `trend-4h-live` as a NEW row rather than flipping
`trend-4h`: flipping in place is safe now but strands three paper
positions no rule would manage again, and keeping `trend-4h` paper gives
the live row a control on the same venue and rulebook — the only thing
that can measure a live Revolut X fill against the paper assumption of the
touch plus 9 bps (`trend-4h-kraken` measures Kraken's post-only fills, not
this). Dry-run inside a self-rolling-back transaction: 4 → 5 rows, caps as
intended, production untouched and re-checked afterwards.

**The probe is RUN and green** (14:05 UTC, fired through `pg_net` so the
operator secret goes from the vault into the header without leaving the
database — the same method as 09-21). Revolut X: key loads, balances 200,
the SIGNED pairs 200 with **all five coins active at $0.10**, the signed
call WITH a query 200 (the part most likely to be wrong), active orders
200, region UK with one ticker row per symbol. Kraken: secret 64 bytes,
**the account holds USD and no GBP — §4.18's conversion prerequisite is
confirmed done at the venue**, TradeVolume confirms 0.80 % / 0.40 % at
$0 of 30-day volume, `AddOrder validate=true` 200 with `txid: null`, so
the placement path is verified without an order. Jev answers on BOTH
transports and the two agree. **B4 stays open and no probe can close it**:
both order histories are empty, so the settlement field names are still
the client's assumption until the first live order's read-back. New
measurement kept: **Kraken's book is 3–5× tighter than Revolut X's** on
all five coins (SUI 4.94 bps against 23.7) — it does not move the venue
verdict, because fees decide it, but it says the fee schedule is the
whole of Kraken's disadvantage. Reference §4.19; checklist and order of
operations, `docs/agents/go-live.md` §9.

### [2026-09-22 12:00 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The retired rows are gone, history and all** — on the second attempt.
The first `0044` deleted decisions before orders and `migrations.yml`
refused it: `agent_orders` has TWO foreign keys, `strategy_id` to the
strategy AND `decision_id` to the decision that produced the order, and I
had only thought about the first. Nothing was applied (the CLI runs the
file in a transaction, verified afterwards — all 1,377 observations still
there). Fixed by ordering orders before decisions, and **dry-run first
this time**: the whole sequence inside a transaction that raises at the
end to roll itself back, which reported 1,377 / 11 / 35 / 4 and no
constraint violated. That check cost one minute and would have saved the
red build. (`0044`, Davies' word:
"retired 的 testing strategies 也都删了，不用留历史"). 4 strategy rows,
11 orders, 35 decisions, 1,371 observations, irreversibly. `0038` and
`0043` had retired them IN PLACE because a strategy row cannot be deleted
while `agent_decisions` references it; `0044` deletes the children first,
which is the step those two would not take. Three of the four were still
long in paper, so nothing is stranded at a venue. The migration is now
the only record of what went, and it says so. `agent_basis` and
`agent_candles` are untouched — no strategy id, venue measurements rather
than a rule's record — and every number those rows produced is still in
the reference (§3.4, §3.5, §3.14, §3.17).

**The maker-probe line is off the page**, also on his word. The probe
keeps collecting and `probeSummary` stays in the payload; only the
rendering went, with its tests and its two sweep assertions. Deleting the
retired rows takes the three winding-down banners with them — those were
a symptom of the rows existing, not a separate thing to remove. The
winding-down CODE stays: nothing exercises it today, but the next row
retired while holding something will need it, and its `riskGate` half (a
paused strategy may still EXIT) is a correctness fix either way.

**Paper, 38 hours in** — asked for and worth recording: `trend-1h` is the
only row to complete a round trip, +$0.1734 on $40 over three coins;
`trend-4h`, `momentum-1d` and `trend-4h-kraken` are each long three coins
and flat on realised. The Kraken twin paid **$0.16 in fees against the
Revolut X row's $0.036 for the identical three fills** — 4.4×, which is
§3.12's arithmetic showing up in the paper record on day two.

**AVAX and SUI have never traded.** They joined `trend-4h` at
2026-09-21 14:11 (`0039`/`0040`) and the row's three fills all predate
that — which is why those fills are $13.33 (40/3) rather than $20
(100/5). Both read trend up, momentum positive, position flat, breakout
NOT above range: the rule has not offered an entry. **So the paper record
carries zero evidence about the two coins Davies is asking about**, and
the answer to his question has to come from the backtests, not from the
live rows.

### [2026-09-22 03:22 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The four settled choices were re-asked with everything now available,
and nothing changes — with a margin behind each.** §3.19, the last of the
studies. Four windows, both tapes, and for the bear year a THIRD: Revolut
X's own book. 98 arms, 15 pass the worst-window test, **49 expected by
chance** once the arms' correlation is MEASURED (0.63–0.83) rather than
assumed. The bar for a change was set before the search: beat the
incumbent on the worst of four windows in all four evaluations.

- **Coins**: 3 of 25 pass, and **not one add candidate is admitted by
  §4.15's bar** — ATOM's UK book is a sixth of the floor, ICP fails
  window B in every condition.
- **Weights**: equal slots stands. Two arms beat it on the worst window;
  **0 of 6 beat it in the bear year on any of the three tapes**, and both
  look worst on the venue's own book. The arm §3.15 predicted would fail
  was priced instead of assumed — weighting by windows-cleared fails 0 of
  4 honestly AND 0 of 4 with look-ahead, while a return look-ahead is
  worth +1.68…+2.59. The lever works; the evidence for aiming it does not
  exist.
- **Mechanics**: window D re-orders every search nearly end to end (rank
  correlation down to −0.81) and changes no setting: 9 of 42 beat the
  shipped one on the worst window, **0 on every window**. Every winner
  buys D by giving back A or B. §3.17's finding from another direction.
- **Venue**: settled, and it is arithmetic rather than a backtest.
  Verified here from `COSTS`: **the worst Revolut X round trip is TON at
  53.8 bps, the best Kraken one is BTC at 80.0 — the two schedules do not
  overlap, by 26.2 bps.** Kraken at its best costs more than Revolut X at
  its worst. 3 of 372 cells favour Kraken; 0 of 50 on the venue's own
  book. **The question should stop being asked until a fee tier moves.**

**One finding that does NOT generalise, and the study said so itself.**
§3.16 found the tape disagreement had no direction. Against the venue's
own book it does: **Revolut X reads lower than Kraken on 21 of 25 coins,
p = 0.00091** (recomputed here from the raw counts, exact). So a per-coin
Kraken figure is mildly optimistic about the book the orders meet. It
does not carry to the live five, and the bear-year sleeve on the venue's
own book is **+10.39 %, ret/DD 0.98** — better than either published tape.
Note the study counted one observation per coin rather than per cell,
which is the pseudo-replication trap §3.16 caught itself in: it learned
from the study before it.

Verified here: re-run byte-identical; three `runSet` paths against `run`
at 844 cells each, zero; **3,456 cells against `tape.json`, zero differ**
(so the harness IS §3.16); §3.17's published row table typed back in at
worst |Δ| 0; the cost-schedule arithmetic recomputed independently.

**The agents feature has no open work item left except Davies' go-live
decision.**

### [2026-09-22 02:59 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The probe summary reached the payload and stopped there.** `0042` has
been collecting since 00:20 and `probeSummary` went into the dashboard at
01:12, but `src/agents.jsx` never referenced `makerProbes` — the number
that answers the maker-versus-taker question was computed, shipped to the
browser, and drawn nowhere. Found it by grepping my own work rather than
by being told, which is the only reason it did not sit there for a week.

`probeLine` now renders it under VENUES: fill rate, median wait, and the
adverse move with §3.13's 10–20 bps break-even read against it. **The rule
it enforces is that an unresolved probe says so** — *"no probe yet"* or
*"3 resting, none resolved yet"* — and never a 0 % fill rate or 0.0 bps.
A zero on no evidence is exactly what this page printed once about AVAX
while the loop was reading it every minute. Pinned four ways in
`agents.test.js` (none / waiting / measured-without-follow-up / the
break-even reading), and the browser sweep now asserts the unresolved
state renders **with no percentage and no bps in it at all** — 210 checks.

917 vitest, 327 Deno, lint and typecheck green.

### [2026-09-22 02:52 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The split nobody had modelled is worth −0.05 points, and the proxy
everyone would have reached for is worth −4.93.** §3.18. The loop decides
on Kraken's candles and fills on Revolut X, and no table here had ever
priced that; the study priced it on the venue's OWN book for window A,
which is possible because those candles turned out to be public.

- (b) published, Coinbase throughout: **+7.62 %** / 0.67
- (a) §3.16's Kraken arm: **+8.74 %** / 0.80
- **(c) what the loop actually does: +8.69 % / 0.78**

So **(c) − (a) = −0.05 points** and (c) − (b) = +1.07. The thing that was
never modelled is worth five hundredths; the thing §3.16 already measured
is worth twenty times more. 296 real fills: adverse cost **0.057 bps a
round trip**, 0.29 % of the cheapest round trip, no direction (141 vs 149,
p = 0.68). §2c's ≤ 3 bps was the right order of magnitude. **No verdict
moves**: 1 of 23 coin-windows flips on the bar (ICP, in no row), none of
the five live coins, leave-one-out unchanged, §3.11's ranking holds.

**Two things from it worth keeping, both about method.**

**The fidelity check caught a 19-point artefact.** The first split
trailed high-water on the FILL tape; `tick.ts` trails it on the SIGNAL
tape (verified here: `bars` is `signalFor(s, sym).bars`). High-water is
an input to a DECISION, not a price paid. That error manufactured AVAX
window A at +31.75 % against the correct +12.49 %, out of two tapes that
agree to 4 bps. A plausible split would have produced a large, clean,
fictitious result.

**A stop fires on the low, which is the price venues agree on least.**
Verified against all three tapes: SUI entered near 0.8757, floor 0.8056,
and on the 2026-09-20 00:00 bar Kraken's low is 0.8124 and Revolut X's
0.8100 — above it — while **Coinbase's is 0.8051**. Six basis points of
wick. The Coinbase-fill arms stop out and book +1.4 %; the arms filling
on Kraken or Revolut X hold to 1.01 and book +29–30 %. That is why
filling on Coinbase is not an acceptable proxy, and why **windows B, C
and D must be read off §3.16's Kraken arm**, which is already published.

Verified here: re-run byte-identical; `runSplit` vs `run` 2,600 cells and
903,928 curve points at zero; arms (a)/(b) reproduce `tape.json` on 2,520
cells per stop rule; the SUI wick and the `bars` provenance checked
independently in the repo and the raw tapes.

**Still running**: the coins / weights / mechanics / venue study.

### [2026-09-22 02:14 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The pre-live should-fix list is closed, and three of its four items had
been done for a day without the record saying so.** Went to fix S13, S14
and S15 and found each already shipped: `newestWins()` guards the
dashboard render AND the module cache, with `loading` set only on a
manual refresh or a cold open (S13); `sizeText(base, m)` masks every size
on the page, its own comment giving the reason — a size beside a mark IS
the value (S14); `agentsAlerts` raises `live-unconfirmed` whenever a row
is live and `live_confirmed_at` is null (S15). **A list that says a thing
is undone when it is done is the same failure as the reverse**, and this
one sat two lines from a go-live decision. §4.17 now says what is true.

**One alert had gone stale in the dangerous direction.** `paused-long`
told the reader that "no stop, trail or exit runs on a paused row" —
correct until 02:00 today, and the exact opposite afterwards. It now
reads `winding-down` at a `paused` tone when the payload carries the
`windingDown` flag, and **stays a fault when it does not**: the flag is
the evidence that the exits are running, and a page must not claim
protection it cannot see. Pinned both ways.

**The sweep fixture is refreshed to the post-`0043` payload**: four rows
instead of seven, `makerProbes` in it, and the three assertions that had
hard-coded seven rows corrected with it. That fixture had been modelling
a set that no longer exists since the retirement migration this morning.
208 browser checks green, 913 vitest, 327 Deno.

**Both studies still running** (the fill split; coins / weights /
mechanics / venue), each resumed with the Revolut X tape finding.

**What remains on the agents feature**: nothing from the pre-live review.
The open items are the two studies, and then Davies' go-live decision.

### [2026-09-22 02:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Revolut X's own candles are public, and the repository was wrong about
them twice.** A study agent found the endpoint while building the fill
study; verified here. `GET /1.0/public/candles/{SYM}?interval=240&region=UK`
— **no key**, 1,000 candles a call, paged with `until=<ms>`, `region=UK`
because §4.14. Pulled for all 27 coins: **2,257 four-hour bars each,
2025-09-11 → 2026-09-22, 376 days = 1.03 years**, no gaps but TON (2) and
ETC (1). So §2.3's "hourly available for the same [three-year] span" was
wrong, and §3.16's "needs a signed endpoint and is unreachable from a
harness" was wrong; `backtest.ts`'s header — one year of intraday — was
right the whole time. Both corrected in place.

**What the one year means**: the venue's own book covers walk-forward
window A (out of sample 2025-09-10 → 2026-09-20) with a day to spare, and
**none of B, C or D**. That turns §3.16's T4 from an argument into a
measurement — moving `signal_venue` to `revx` would delete three of the
four windows — and it lets the fill study price the bear year on the REAL
book instead of a proxy. Data is in the scratchpad (`revxuk/`, puller
`pull_revx_uk.py`), which does not survive the container; the endpoint and
the pull recipe are now in §2.3, which does.

**The thin-book guard is built** (ledger item 0b, open since the region
bug, and more pressing since the intra-bar trail went and the floor became
the only stop between bars). Two halves, opposite directions on purpose:

- **A long's stop is judged at the BID** (`exitMark`), not the mid. It was
  always checked on the mid and filled at the bid — half a spread of
  wishful thinking, 0.75 bps on BTC but 21 on SUI and unbounded if the
  book goes wide — which says a position is above its floor while the
  money available for it is below. The stop fires late, into a worse
  price, exactly when the book is worst.
- **An entry is refused above 50 bps of book** (`WIDE_SPREAD_BPS`), since
  every Revolut X entry crosses and pays the ask, so a wide book charges
  its width on top of the 9 bps. Measured UK book: 1.5–24 bps. The EEA
  book was once seen at 180. `bookBps` goes on the decision row so the
  refusal is auditable.
- **An exit is never refused by the guard.** A stop exists for exactly the
  minute the book is ugly.

Pinned: `exitMark`, `spreadBps`, and an end-to-end case that refuses the
entry on a blown-out book while the floor still fires on the same book.
327 passed.

**Both studies resumed** after a session limit cut them off at 02:00 UTC
(fill study; coins / weights / mechanics / venue), each told about the
Revolut X tape and its one-year span.

**Still open**: S13 (dashboard refresh race), S14 (unmasked sizes), S15
(the missing live-unconfirmed alert), the sweep fixture.

### [2026-09-22 01:33 UTC] Platform: Claude Code | Model: not recorded (session policy)

**I made S11 real, then fixed it — and it was worse than the review
said.** `0043` retired three rows that were still LONG (checked against
the live table: `momentum-1d-kraken` 0.126, `rotation-1d` 0.189,
`rotation-1w-kraken` 0.189 base). `0038` got away with the same move only
because `dislocation-1m` was flat. Under the old rule those positions had
no exit path at all, in two independent places:

1. the tick skipped a paused row entirely, so no floor and no rule exit
   ran and the page hid it; and
2. **`riskGate` refused a paused strategy's EXIT** — that test sat ABOVE
   the `action === "enter"` branch whose own comment reads "an exit
   reduces risk and is never refused here". The gate that exists to let
   positions out was the thing holding them in. It was pinned, twice, so
   it was a decision rather than a slip; the decision was wrong.

Fixed: the tick reads retired rows, derives the book, and keeps running
the exits of any still holding (`windingDown` in the report), refusing
every entry through one gate inside `decide()` so a later code path
cannot miss it; a retired row that is flat is skipped before any decision
work. `riskGate` moves the paused test inside the enter branch — the
GLOBAL pause still outranks an exit, because that one is a person's
emergency switch. The dashboard shows a winding-down row until it is
flat, and filters retired-and-flat rows BEFORE the aggregates are summed
so the page's totals keep the meaning they had. Pinned: three
winding-down cases in `tick.test.ts`, the corrected gate in
`strategy.test.ts`. 324 passed.

**The probes are readable now** (`probeSummary`, in the dashboard
payload): fill rate over resolved probes, median minutes to fill, and
`adverseBps` at +15 / +60 minutes, **signed so POSITIVE is against the
fill**. That median against §3.13's 10–20 bps band is the whole
maker-versus-taker answer. Pinned in `index.test.ts`.

**Two studies running**: the decide-here-fill-there split (§3.16 named it
and nobody has ever modelled it), and coins / weights / mechanics /
venue re-asked on four windows × both tapes.

**Still open from the pre-live review**: S13 (dashboard refresh race),
S14 (unmasked sizes), S15 (the missing live-unconfirmed alert), the sweep
fixture, and the thin-book guard (ledger item 0b) — the last one matters
more now that the floor is the only intra-bar stop.

### [2026-09-22 01:12 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Two studies land: the tape does not change what to run, and nothing
repairs the sideways year.** Both re-run here byte-identical; both were
interrupted by a server-side 529 after handing back, and both had already
written all three of their files.

**§3.16, the tape.** The gap between Kraken's tape (what `signal_venue`
makes the loop read) and Coinbase's (what every table is priced on) is
large — median **4.03 points**, p95 31.3, max 70.4 over 288 comparisons,
9.0 % sign flips, **5.9 % of §4.15 verdicts flip** — and it has **no
direction**: Kraken higher in 149 cells, Coinbase in 139, p = 0.596;
p = 0.690 per coin. Recomputed here from the raw cells, every figure
reproduced. The study caught the trap in its own data: cell level looks
tilted in window A at p = 0.0035, but that is pseudo-replication and at
one observation per coin it is p = 0.690. **The sleeve moves about a
point** (A +8.0 → +9.2, B +20.1 → +22.5, C +55.6 → +50.9, **D identical**
— D is Kraken bars on both arms by construction), so the recommendation
stands. **Per coin it moves up to thirty**: AVAX's bear year +34.1 % →
+12.6 %, SUI's +1.4 % → +29.1 %, and the coin most expensive to remove
swaps from AVAX to SUI. §3.15 survives both findings on Kraken's tape.
Its Coinbase arm was checked against `windows.json` **cell for cell,
4,464 cells, zero differ**, with the file's SHA-256 recorded and matching
— so the two studies are the same arithmetic and every difference is the
tape. **Decision: change neither `signal_venue` nor the arithmetic.**
Switching to `revx` deletes windows C and D outright (Revolut X history
starts ~2023-08), moves the decision onto a book 100–300× thinner and
re-opens §4.14's region trap. The labelling was what was wrong.

**§3.17, the TESTING set.** Nothing repairs the sideways year — **0 of 33
gate arms** under either stop rule — and the reason is one number:
Pearson(how much a gate refuses, Δ window C) = **−0.85**. Everything that
helps the sideways year helps by being out of the market, which is
exactly what costs the strong bull. A trend rule's worst regime is the
other side of the trade that makes it work. Migration `0043` retires
`momentum-1d-kraken`, `rotation-1d` and `rotation-1w-kraken` (0.90–1.00
correlated with a row that stays, worse in all four windows, two over the
35 % drawdown limit in the bear year), in place with `retired_at` —
`0038` already learned that DELETE is refused by the decisions foreign
key. **`trend-1h` is KEPT, reversing §3.14**: on four windows it is
positive in all of them under both stop rules and is the only row of
seven with half its grid positive in all four, and it is the best row in
the sideways year (+16.2 %, drawdown 5.6 %, plateau 96 %). Its return is
still not the argument — one row of seven clearing everything is what
chance gives (P = 0.29–0.71), and +5 bps a fill takes its bear window
from +3.8 % to +0.6 %. Kept as a measurement row. **Nothing added**:
every candidate priced is inside chance. Row capital $440 → $280, live
exposure exactly at its $100 cap, no cap moves.

**Pushing `0043` applies it.** It pauses three rows and touches no data.

**The next study, named by §3.16 and not done**: the loop decides on
Kraken and FILLS on Revolut X, and no table in this repository simulates
that split. §2c's ≤ 3 bps basis suggests it is small against 9 bps of
taker fee — suggests, not measures. Also unresolved: §2.3 says Revolut X
has three years of hourly history and `backtest.ts`'s header says one;
only a keyed probe settles it.

### [2026-09-22 00:19 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The maker question now has an instrument instead of an argument.**
Migration `0042` adds `agent_maker_probes`. Revolut X is 0 % maker and
the loop crosses the touch, so "rest everything and pay nothing" is the
standing question; §3.13 could not answer it because the backtest runs on
Coinbase candles with a synthetic bid and duly reports that a resting
order fills with a median delay of ZERO hours — the model's limit, not a
measurement. What it cannot see is the only thing that decides it: on a
breakout rule a resting bid fills exactly when the breakout fails, so the
fills you get are the bad half of the distribution.

The probe measures that on the real book at no cost and without resting
anything. Every marketable order writes down where a post-only order
would have sat (the same side's touch); turn 2b resolves it against the
execution venue's last closed minute — came back or not, and after how
many minutes — and then records the mark at +15 and +60. That last gap is
the adverse selection in bps, read against §3.13's 10–20 bps break-even
band. **A probe is never an order**: not in any position, book, exposure
or P&L; written last in `place()` so a probe that fails to insert cannot
cost an order; and it adds one public minute-candle call only on a symbol
the loop has just traded.

Two design notes worth keeping. The tick's read is a single
`watching=eq.true` over one partial index, NOT a compound predicate over
`state` and `follow_up` — the first version used PostgREST's `or=(…)`,
which the test stub rightly refused, and the simpler column is better
anyway. And the insert writes `state`, `watching` and `follow_up`
explicitly rather than leaning on column defaults: the starting state of
a probe is part of what the code means.

Pinned by `tick.test.ts`: `probeFilled`, `probeFollowUpDue`, and three
end-to-end cases (a marketable order opens a probe at the OTHER side's
touch and places nothing extra; a resting probe fills or expires against
the minute; a resolved probe collects m15 then m60 and stops being
watched). 320 passed / 0 failed.

**Pushing this migration applies it** — `migrations.yml` runs on push to
main. It creates one new table and touches nothing existing.

**Two studies running**: re-pricing the reference on Kraken's tape
(§3.14's problem), and the TESTING-set optimisation on all four windows.
The TESTING-row migration waits for the second one.
