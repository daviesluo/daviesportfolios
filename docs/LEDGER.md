# Ledger

The live handover record for this repository, under the ledger protocol
in `.agents/skills/ledger/SKILL.md`. Read this file first on any resume; it is kept
small on purpose. The deep record — the full decision log and the raw
session transcripts — is `docs/handover.md`, which is this ledger's ARCHIVE
and is opened only when a closed item is reopened or audited.

## What remains right now

This list was rewritten on 2026-09-26 to hold only what is open. The list as it stood before, every closed item in
it, and every history section from 2026-09-22 to 2026-09-24 are in `docs/handover.md` Part 2, under "LEDGER.md,
archived 2026-09-26", word for word; an item number quoted in an older history section (`item 000000000000` and the
like) refers to that list.

**The full plan is `docs/improvement-plan.md`** — 28 items in four
tiers, written 2026-09-05 from a whole-repository review, with cost,
risk and a verification step on each. It is a PROPOSAL: nothing in it
has been executed, and nothing should be until Davies confirms. This
list stays the short version; the plan is the reasoning behind it.

1. **fp5 reviewed (2026-09-26): nothing to put money on; what is worth running, in order**
   (`docs/agents/reviews/2026-09-26-fp5-review.md`; the three branches stay unmerged). 1. RW-E — frozen, judged
   with RW on 10-09 (item 2). 2. PR6, USD stablecoins at par on Revolut X, with PR5's frozen simulator: FAILED
   2026-09-26 (reference §3.35, `reviews/2026-09-26-pr6-study.md`: +$37 but stress −$8, 3.9 %/yr); closed.
   3. Funding crowding (the frozen UZERO / USOFR signals) as a BTC spot trade at Revolut X costs: FAILED 2026-09-26,
   both rules (reference §3.34, `reviews/2026-09-26-fund-crowding-study.md`); closed. 4. DRAW-X, DRAWBASE on four
   unseen leagues: FAILED 2026-09-26, −$1,188.82 on 495 trades, every league losing (reference §3.36,
   `reviews/2026-09-26-draw-x-study.md`); DRAWBASE closed. 5. Four weeks of Revolut X's UK order book for a queue
   model (RECORDING since 2026-09-26, `0057`, one book at a time from `0058`; pre-register the queue model before
   reading it; four weeks run to ~10-24). 6. PR5's live path after its dry-run (Davies' go). Each needs its own
   pre-registration, under the review's rules for a round (a power check first, at most ten hypotheses, nulls with
   replacement or by circular shift, fills at the resting limit, fees from each market's schedule).

2. **RW (Polymarket reward quotes, paper) and RW-E: the verdict on or after 2026-10-09 00:05 UTC.** RW runs by itself
   since 2026-09-24 19:30 UTC: fourteen days, 2026-09-25 00:00 → 10-09 00:00 UTC (`agents/pmrw.ts`, `0053`, cron
   `agents-pmrw-every-minute` and `agents-pmrw-select`; spec `reviews/2026-09-24-polymarket-rw-paper-spec.md`;
   reference §3.33 and §4 item 36). RW-E, RW without the markets that end on the day they are quoted, is judged with
   it on 09-27 → 10-08 (`reviews/2026-09-26-polymarket-rw-end-prereg.md`, frozen): `agents/pmrw_e.ts` replays RW's
   stored minutes every minute (`0056`, every five until `0060`) in two arms, `rw` (whose days must equal
   `pm_rw_days` to under a cent) and `e`, into `pm_rw_e_days`; RW-E is a TESTING row of its own with RW's page
   (`rweArmSummary`), which warns only when that check fails.
   - **Daily health:** `pm_rw_state.last_error` empty and `last_minute` within ~3 min; today's `pm_rw_selection`
     present by ~00:05 UTC; `pm_rw_days` gains a row a day; `net._http_response` has no 546 (CPU) or 5xx for
     `action=pmrw-select`; the page shows no "fills and total differ" warning; `pm_rw_e_state.last_error` empty, its
     `diverged` list read, and the rw arm's check under $0.01. Do NOT change `agents/pmrw.ts`'s rule (the spec is
     frozen); a bug fix is allowed only as a recorded deviation (spec, reference, ledger) with a pin that fails on the
     old code. Do not read the fills market by market before the verdict: a narrower variant (stop quoting once a
     temperature bucket is decided) needs its own pre-registration, frozen before anyone has.
   - **The verdict**, once `pm_rw_days` has the row for 2026-10-08, written up as
     `docs/agents/reviews/2026-10-09-polymarket-rw-paper-result.md`, reference §3.x and this ledger:
     a. The bar, exactly as the spec words it, from `pm_rw_days` (the fourteen run rows, 09-25 … 10-08): each day's
        total is the change from the row before (09-25 against 0; the warm-up row counts nowhere); (1) total > 0;
        (2) stress total > 0; (3) ≥ 100 fills; (4) no market over 50 % of the total and the total without the best
        market > 0 (per market from the last row's `detail.perMarket`); (5) Python `random.Random(20261009)`, 2,000
        draws of fourteen `choice`s of the day totals, sums sorted, the one at index 100 > 0; (6) the total on the run's
        capital (the largest daily `capital`) × 365 / 14 > 4 %. Commit the script with its output.
     b. The engine ran the rule: replay the stored `pm_rw_minutes` rows with the stored `pm_rw_prints` through the
        frozen rule (`stepRw`, or `rw_test.py`'s `run_market`) and reproduce `pm_rw_fills` and the rewards.
     c. No print was missed: pull every quoted market's prints for the run again from `/v2/trades` (cache-busted, as
        `pmPrints` does) and compare with `pm_rw_prints`; any print the engine did not see is a deviation — recompute
        with the full prints and report both.
     d. RW-E by its own pre-registration's bar, from `pm_rw_e_days` (arm `e`), after the check that arm `rw`
        equals `pm_rw_days` on every day.
     e. A migration unschedules `agents-pmrw-every-minute`, `agents-pmrw-select` and `agents-pmrw-e` (the tables
        stay); the page rows stay as a record until Davies says otherwise.
     f. Report to Davies in Chinese. Only an account that quotes can show what Polymarket actually pays.
   - **Only if RW (or RW-E) passes, and only on Davies' word: design, not build, a live test.** It runs only in
     `eu-west-1` (refuse unless `SB_REGION` is `eu-west-1`); it opens a position only while his attestation that he is
     in Ireland is current (an expiring timestamp he sets in conversation), and otherwise reduces or closes only; never
     a VPN, a proxy or anyone else's account; `_shared/polymarket.ts` stays GET-only until the design is agreed. The
     design says: order signing (the CLOB's EIP-712 orders and L2 headers), a dry-run first, caps, the kill switch,
     reconciliation by order id, and reading the account's actual reward payouts to compare with the formula.
     The fp4 study's §0 found that Polymarket's Terms of Use bar residents of the UK and Ireland from trading; Davies
     read it on 2026-09-24 and said the plan continues. The key was exposed to another tool: keep the wallet empty or
     small; revoking that tool's Supabase token is his.

3. **`trend-4h-live` is LIVE on Revolut X at $100** (BTC/ETH/SOL/AVAX, four $25 slots; `0054_go_live.sql` applied
   2026-09-24 22:51:15 UTC, armed 22:53:09 UTC; capital 50 → 100 and `max_exposure_usd` 15 → 25 on 2026-09-25
   02:42 UTC, both on Davies' word). Its first live buy was SOL at the 2026-09-25 12:00 UTC bar, read back and
   still held on 09-26. The paper `trend-4h` is its same-venue control. Davies: no confirmation of his
   for any trade after the go-live ("上线后的买卖不需要找我确认，如果真的需要你帮忙盯着就行"); a session watches when asked
   and reports, never asks. **When asked to look (read-only):** after a 4h close + 3 min (00:03, 04:03 … 20:03 UTC)
   the live row's four decisions beside `trend-4h`'s (same `rule_action` per coin), `agent_orders` where
   `mode = 'live'`, `ops_errors` and the tick's cron runs; five minutes after a live order, its read-back (the fee
   fields or `feeDerived`, `filled_base` in whole `base_step`s (D11), `fromAccount` (D12), the coin's balance
   against the book); after a sell, the book flat and the account under one step. Report a live order, a fill, an
   order `pending` over 2 minutes, a missing decision, a live-row error or a failed tick. The cap is one slot; a
   later change is one statement (`update public.agent_risk set max_exposure_usd = … where id = 1;`), and Davies is
   told when it runs. The 30 and 75 steps written for the $50 book are not the next raises. **Never trade by hand in
   that account.** Rows, caps and the order path: `.claude/CLAUDE.md`'s Agents section, `docs/agents/go-live.md`,
   reference §3.31 and §4 items 32–34.

4. **PR5 (GBP stablecoin quotes): paper and dry-run; NO-GO for live until its four-week review on 2026-10-21.** The
   paper test runs since 2026-09-23 15:09 UTC (`agents/quotes.ts`, `0051`, reference §4 item 31) and is decided by
   the spec's six conditions (`reviews/2026-09-23-pr5-paper-test-spec.md`); plan with ~$0.42 a day, the rate since
   the books tightened in the week of 2026-08-24. Its live path runs in DRY-RUN since 2026-09-24 02:40 UTC on PR5's
   own sub-account (`agents/quotes_live.ts`, `0052`, reference §4 item 35), and since 2026-09-26 the Agents page
   reads it: a dry-run line on PR5's page, and a LIVE row from its first real order.
   - Watch the dry-run against the paper engine with §4 item 35's L1–L5: L3 empty, L4 only guard or governor minutes.
   - After the review, on Davies' word only, in that conversation: `update public.agent_quote_live_config set
     dry_run = false, live_confirmed_at = now() where id = 1;`, and confirm the first live order there. Optional,
     for the asks: `POST ?action=quotes-convert {"book":"USDT-GBP","gbp":12.5}` previews the conversion; `"send": true`
     sends it, only while live and armed.
   - Never trade by hand in PR5's sub-account (key `_2`): its executor books fills and inventory from that account.

5. **Davies' to decide or to do; nothing waits on them:**
   - Rotate `APP_ADMIN_PWD`, `APP_RO_PWD` and `APP_AUTH_SECRET` (Supabase dashboard, Edge Function secrets), as
     cheap insurance: the site served the repository, `auth`'s source included, until 2026-09-18, and nothing
     suggests anyone read it (five failed logins in the auth table's whole history). Changing the secret re-prompts
     every device once.
   - The Kraken balance moves to Revolut X (his decision, 2026-09-22; reference §4.23). When he says it is done, fire
     the read-only `?action=probe` through pg_net with the Vault `cron_secret` and check that the Revolut X balance
     the key sees includes it. The Kraken key stays in use as the signal.
   - Binance: switch off "Enable Spot & Margin Trading" and universal transfer; Deribit: `trade:read_write`; until a
     use is decided. Neither account is funded, and nothing trades on either.
   - The venue survey's §10 questions (`docs/agents/venue-survey.md`): US state and SSN/ITIN, HKID, stay small or
     scale, an always-on host, a long/short study.
   - Whether this ledger's `Model:` headers are backfilled. A session under an operator rule that forbids model
     identifiers in pushed files writes `not recorded (session policy)`; any other writes the real model.
   - The DecisionFC review is paused: do not resume it without him.
   - A clone made before `main`'s history was rewritten (2026-09-24) must be re-cloned or reset to `origin/main`;
     `docs/commit-map-2026-09-24.md` maps the old hashes. Every clone runs `sh bin/setup.sh` once, or the ledger hook
     is off there.

## Machine and platform setup

A rebuilt container loses every line below. Run them before working.

    git config user.name "daviesluo"
    git config user.email daviesluo@gmail.com
    sh bin/setup.sh

  `bin/setup.sh` sets `core.hooksPath bin/hooks` (the ledger hook moved
  from `hooks/` on 2026-09-23: a clone still pointing at `hooks` runs NO
  hook, and git says nothing, until it re-runs this), `ledger.path
  docs/LEDGER.md` (this file left the root the same day; a clone still
  set to `LEDGER.md` is stopped at its next commit with "the ledger does
  not exist", which is the cue to re-run it), and `npm ci` in `src/` (the
  web app's npm project moved there on 2026-09-23; a root `node_modules`
  left from before is dead weight and can go). It leaves the identity alone because the repo is meant
  to go public and a stranger's setup must not commit as Davies.
  `sh bin/gates.sh` runs every CI gate in CI's order and warns when the
  hook is off.

Facts a fresh session would otherwise rediscover:

- **Node 22** (`src/.nvmrc`). npm 10.x. Every npm command runs in `src/`.
- **The Edge Function checks run on Deno 1.46.3 through npx**
  (`npx --yes deno@1.46.3 test --allow-env supabase/functions/`), the
  version CI's `setup-deno` `v1.x` resolves to; this container has no
  `deno` of its own. A bare `npx deno` fetches Deno 2, which CI never runs
  — and which `bin/gates.sh` used until 2026-09-23 03:06 UTC.
- **The app sweep is now a normal gate**: `npm run verify:browser`.
  Playwright is a devDependency, so `npm ci` brings it. Chromium is
  preinstalled at `/opt/pw-browsers` in this container — do NOT run
  `playwright install` here; point the sweep at it instead:

        cd src && PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run verify:browser

  CI runs `npx playwright install chromium` and needs no such variable.
  The performance matrix is a gate too since 2026-09-23:
  `npm run verify:perf` (same Chromium variable). Its clock is pinned;
  `PERF_MATRIX_CLOCK=<instant>` moves it, and an instant its fixture
  cannot serve is refused with the reason.

- **Cursor cloud containers (2026-09-24):** the git identity comes preset as
  "Cursor Agent" (set it as above), and `core.hooksPath` points at Cursor's
  own dispatcher in `~/.cursor/agent-hooks/<id>/`, which runs the hook in the
  folder named by its `.cursor-original-hooks-path` file and then Cursor's
  secret scanner. That file named `.git/hooks`, so the ledger hook was OFF.
  Point it at the repo's hooks rather than replacing the dispatcher:

        for f in ~/.cursor/agent-hooks/*/.cursor-original-hooks-path; do printf '%s\n' "$PWD/bin/hooks" > "$f"; done
        git config --local ledger.path docs/LEDGER.md

  `bin/gates.sh` then warns that the hook is off; it is not (the dispatcher
  runs it). There is no `/opt/pw-browsers`; the browser gates run on the
  system Chrome with
  `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/google-chrome-stable`.
  Its git token deletes remote branches (`git push origin :refs/heads/<b>`),
  which Claude Code's proxy refuses. There is no Supabase PAT or CLI on the
  machine, and the Supabase connector lists, reads and deploys Edge
  Functions but cannot delete one.
- **Cursor rotation (2026-09-24):** Davies may switch the model inside one Cursor session (Opus 5.5 and Grok 4.7).
  The model about to be switched away from cannot know it, so every turn ends in a state the other can pick up:
  small COMPLETE commits, each with its ledger line, pushed, and nothing half-edited in the tree. A model that finds
  itself newly active (or is told "切换了") runs `git status` and `git log -5`, re-reads the what-remains list and
  the newest history section, and shows Davies anything uncommitted it did not write rather than discarding it. Its
  first job is to read the other model's latest code commit adversarially; each history header names the model.
- **The container clock has been wrong before.** On 2026-09-05 it read
  91 minutes behind the database, and that alone produced a false outage
  report. On anything time-gated, take the time and the WEEKDAY from the
  database (`select now()`), not from `date`.
- **Gates, all of which must pass before a push:** `sh bin/gates.sh`
  runs them in CI's order — typecheck, lint, vitest (**check the exit
  code, not the summary line**), build, both browser tests, size-limit,
  knip (twice: the web app, then the Edge Functions through
  `bin/knip-edge.sh`), the npm audit, `deno check` and `deno test`. Commit the `dist/`
  the build writes with any `src/` change; the source maps it also
  writes are gitignored.

## History, newest first

Closed operations move verbatim into `docs/handover.md`, whose Part 2
(decision log) and Part 3 (transcripts) are this ledger's archive.
Everything before 2026-09-25 lives there already: the 2026-09-05 →
2026-09-21 sections under Part 2's "LEDGER.md history, archived
2026-09-22", and the 2026-09-22 → 2026-09-24 sections, with the
what-remains list as it stood before its 2026-09-26 rewrite, under
"LEDGER.md, archived 2026-09-26"; both oldest first.

### [2026-09-26 20:15 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies (two screenshots, Saturday ~20:50 BST): why the 24H futures chart says OPEN at 20:50 and why the S&P one has a line at 20:55; is "no stablecoin book left in the UK" true; would Binance or Bitget do; why the live row keeps Jev's gate.**
- The 24H chart put "OPEN" on the first point of any window that began after the regular open: on Saturday the trailing 24 hours of futures hold Friday 20:50–21:55 BST only, and the open (14:30 BST) was outside. The perf chart had its own copy of the ticker modal's open scan; both now call `findRegularOpenIdx`, which also requires the bar before the open bar to be earlier than the open (or the first bar to be stamped at it), so a window that starts after the open draws no OPEN, and neither does the futures' Sunday reopen. Pinned in `chart_geometry.test.js` (the old scan returns 0 where −1 is right) and by the sweep's new `markers/24H-ext`, whose fixture session starts at 14:00 UTC with nothing before it: run against the old bundle it FAILS ("OPEN" drawn), against the new it passes. The 20:55 line on the S&P chart is the time axis's gridline under its one label: of that window the cash index traded only Friday 20:50–21:00 BST, three points. Not changed. `docs/guide.md` says what the markers mean and what a weekend 24H holds.
- "No stablecoin book left in the UK" is true: Revolut X's public pair list (455 pairs, both regions, read 2026-09-26) has no stablecoin base but USDC and USDT, and no USDT/USDC book (its USDC-quoted books are all coins); the UK side has USDC/GBP, USDT/GBP, USDC/USD and USDT/USD. The gold tokens PAXG and XAUT were closed in §3.29.
- Binance was already answered: §3.29's ZF, PR5's mechanism on Binance's zero-fee stablecoin books, fails (pooled +$88.74, 2.6 %/yr, stress −$51.03; EURI's books lost $439), and its zero-fee USD fiat books exclude UK residents. Bitget: a read-only feasibility study is running in this session (access for a UK and Irish resident, fees, its stablecoin books' spreads from the public API); nothing registered, nothing committed.
- Jev on the live row stays on: since v2 (`0047`) `trend-4h-live` has had one entry signal (SOL, the 09-25 08:00 bar), P = 0.58, entered; the gate has vetoed nothing. On trend-4h the v2 gate passed its bar (§4.21: worst window unchanged), and the paper control carries the same gate.

**Davies, next: take RW-E's section off the pages, name it "Reward quotes (no same-day)" and run it every minute; drop "· venue" from every strategy name and tag each strategy page with its venue beside PAPER.**
- RW-E's row is "Reward quotes (no same-day)", the bracket on a line of its own, and its replay runs every minute from `0060` (Davies: "every min"; a run replays only what RW decided since the last, under the `pmrw-e` lease). The RW-E section is gone from RW's page and from RW-E's; RW-E's page keeps one line, shown only when the replay's copy of RW stops equalling RW's closed days (`rweCheckWarn`). `RWE_STALE_MINUTES` is RW's five plus three (it was 15 for the five-minute cadence). The sweep reads the two-line name, "every minute", and both pages without the section.
- No strategy's name says its venue from `0061` ("Trend 4h", "Trend 1h", "Momentum 30d" on Revolut X and on Binance; the live row "Trend 4h · live", shown without " · live"); the migration fails if any name still carries one. Every strategy and test page's head reads PAPER or LIVE, then the venue's tag in its colours (`VenueBadge`). The sweep finds each row by name AND venue and checks the tag on the four pages it opens; `.claude/CLAUDE.md` quotes the live row's new name.

### [2026-09-26 17:53 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies: fix PR5's live path being off the page and RW's same-day loss where they can be fixed, run the plans worth running, then slim the ledger.**
- RW's same-day loss is fixed beside RW, not in it (its test is frozen): RW-E runs as a replay of RW's stored minutes every five minutes (`agents/pmrw_e.ts`, migration `0056`, cron `agents-pmrw-e`), from RW's start, in two arms — RW itself, whose closed days must equal `pm_rw_days` to under a cent, and RW-E. RW's page shows both since 27 Sep, with today's markets left out and the check. One deviation from the pre-registration's method, recorded in reference §4 item 36: a minute is applied from what the engine recorded of it (decision and fills), not by re-running `stepRw` on the stored inputs, which cannot say which prints were public when the engine decided or which day's selection a midnight minute used; a market RW-E holds differently from RW runs through `stepRw` and is named in `diverged`. Pinned in `pmrw_e.test.ts` against the engine itself: the rw arm is RW to the last bit, and the e arm equals the engine run with the same-day market removed from the selection (the test fails when the exclusion is removed).
- PR5's live executor is on the page (before it leaves dry-run, as the review asked): the dashboard reads `agent_quote_live_*` (`quotesLiveSummary`: each rung's live fills by the executor's own `rungBook` and `markedGbp`, in USD at the paper books' last GBP/USD; TODAY is its loss stop's own figure). From its first real order it is a row of LIVE (`quotesLiveRow`), in LIVE's scoreboard and Revolut X card, the page opens on LIVE, and a pending live order of its shows on both tabs (its loss stop on LIVE). In dry-run its page says so with the orders it would have sent today. Pinned in `index.test.ts` against hand-worked numbers and in `agents.test.js`; the sweep's `pr5-live` scenario checks LIVE's row and totals and that TESTING's do not move.
- The stablecoin books are recorded (plan 5 of the fp5 review): `agents/books.ts`, migration `0057`, cron `agents-books-every-minute` — the top five levels a side of USDC-USD, USDT-USD, USDC-GBP and USDT-GBP from the keyless public book, stored when they change, pruned after 35 days (reference §4 item 37). Its queue model is pre-registered before anyone reads the table.
- The recorder's first version lost three books of four to 429 every minute (18:16–18:20 UTC): it sent all four at once at :00, where the tick also reads the public bucket (about a token a second). The tick and PR5 reported no error in those minutes. From `0058` it reads 40 s into the minute, one book every 1.25 s in an order that turns each minute, stops at the first 429, and its cron call has 58 s. Each row now says when its book was read to the instant, and how long and how often it was seen unchanged (`seen_until`, `reads`). Pinned in `books.test.ts`; the old code puts four requests in flight where the pin allows one.
- PR6 and DRAW-X pre-registered and frozen as their agents wrote them (`reviews/2026-09-26-pr6-revx-usd-par-prereg.md`, `reviews/2026-09-26-draw-x-prereg.md`). PR6: PR5's frozen simulator at par on USDC-USD and USDT-USD, on the part of the UK tape the venue's candles confirm (from 2025-11-27 and 2025-12-17), a whole-day circular-shift null, and 8 %/yr on the quotes' capital over the window AND its last three months; its power check says that last condition decides it and that the counts make a pass unlikely. DRAW-X: DRAWBASE's code with two fixes (kickoff is `startTime`; a match not played at its listed kickoff is dropped) on La Liga, the Bundesliga, Ligue 1 and Serie A, 1,554 matches; it sees only an edge of about five points or more, in at least three leagues (its condition 7, kept at review). A fail of either closes the idea; a pass is a paper test.
- FUND pre-registered and frozen (`reviews/2026-09-26-fund-crowding-prereg.md`): fp5's UZERO / USOFR funding signals, word for word, as a BTC spot long for 48 h at Revolut X's cost, on 2024-01 → 2026-09 (the test: the shift null there, Holm across the two) and 2019-09 → 2022-12 (a replication by sign; its null test has too little power at 3.9 % a day — decided at review, from the power check alone, before any return). It can see an edge the size 2023 showed, not one merely worth money.
- The research plans, judged: PR6 (USD stablecoins at par), funding crowding (UZERO / USOFR as a spot trade) and DRAW-X (DRAWBASE on four unseen leagues) are worth one test each; each is pre-registered first and frozen on `main` before any outcome is computed. The order-book recorder is next. PR5's live path stays gated by its own review on 10-21 and Davies' word (item 4).
- FUND ran and FAILS, both rules (reference §3.34, `reviews/2026-09-26-fund-crowding-study.md`, `backtests/fund/`, reproduced byte for byte on `main`: `fund.json` sha256 `3964e667…`, 19 pins pass). In 2024-01 → 2026-09 neither beats the shift null (UZERO p 0.226, USOFR 0.779) and both lose in the second half; 2019–22 replicates by sign. The excess over the null per held day fell from +56 bp (2019–22) to +42 (2023) to +11 (2024–26) for UZERO, and +39 → +13 → −6 for USOFR. Funding crowding as a spot trade is closed at this account's cost; no paper row.
- PR6 ran and FAILS (reference §3.35, `reviews/2026-09-26-pr6-study.md`, `backtests/pr6/`, reproduced byte for byte on `main`: `pr6.json` sha256 `a9cefc21…`). PR5's rule at par on USDC-USD and USDT-USD makes +$37.14 on 8,341 round trips, beats its shift null and is positive in 10 of 11 months, but the stress arm loses $8.41 and it earns 3.86 %/yr (1.84 % in the last three months) against the 8 % bar: 5.1 % of positions wait a day for a print back through par and are stopped, taking 45 % of what the exits at par made. The UK hourly candles its power check read are kept in `inputs/candles/` (the venue drops them after a year). No paper test.
- DRAW-X ran and FAILS, seven conditions of nine (reference §3.36, `reviews/2026-09-26-draw-x-study.md`, `backtests/polymarket/drawx/`, reproduced byte for byte on `main`: `drawx.json` sha256 `44724d0e…`, and its self-check reproduces DRAWBASE's own result). DRAWBASE's rule on La Liga, the Bundesliga, Ligue 1 and Serie A lost $1,188.82 on 495 trades, −24.5 % a dollar, in every league and both halves: the draws it buys are mostly those of matches with a clear favourite, and they came 15.2 % of the time at an average 19.9¢. DRAWBASE is closed; so are FUND and PR6, and of the fp5 plans only RW-E (item 2), the book record and PR5's live path remain.
- PR7 (PR5's rule on USDC/EUR, Davies: "这个也测试下") is not possible from this account: the pair is on Revolut X's EEA side only. The UK book answers 400 "Couldn't find currency pair USDC/EUR" (checked again by the session; the EEA book answers 200), and the UK tape held no print in 366 days. There is no other EUR or stablecoin-against-currency book on the UK side, so PR5's mechanism has no untried book here (reference §4 item 14). The census stayed in the session scratchpad; nothing was pre-registered.
- RW-E is a TESTING row of its own with RW's page (Davies: "两个testing策略"), and one-trip P&L on the quote pages prints to four places like the prices beside it (Davies: a $1.72 round trip that made +$0.0023 read "$0"). The dashboard's `rwe` is RW's own `rwSummary` run on the replay's `e` arm (`rweArmSummary`), with RW's fills less the market-days RW-E leaves out; pinned against the engine run without those market-days, figure for figure, and the pin fails with the filter removed ($0.40 of realised). The first build kept only the first test's Polymarket card, so the card said $296 while TESTING's scoreboard added RW-E's $235: `venueRows` now sums every test on a test-only venue (pinned; fails on the old loop). On paper the replay is RW-E's own book: each market is decided on its own, so where RW-E quotes its decisions are RW's, and where its inventory differs it runs the rule itself; a separately fetched engine would read the same public data a few seconds apart and only add noise to the comparison.
- Jev on the two paper rows goes to shadow, on Davies' word ("这个听你的吧", after the session recommended it): migration `0059` sets `params.jevGate: false` on `trend-1h`, `momentum-1d` and their Binance twins. The model is still asked on every entry and recorded, and each reason says whether it would have vetoed; the rulebook enters. The v2 gate failed its bar on these rows (reference §4.21) and so did each row's own wording (§4.28); the shadow record is what a later test of the gate, or a v3, starts from. The live row and its control keep the gate.
- The ledger is slimmed, on Davies' word ("LEDGER.md 已经 3,600 多行，按规矩应该保持很短"): 3,659 lines to about 340. The what-remains list as it stood and the 152 history sections of 2026-09-22 → 09-24 moved word for word to `docs/handover.md` Part 2, under "LEDGER.md, archived 2026-09-26", oldest first. A script checked that every moved section and the whole old list arrived intact, and that nothing else in the handover changed. The list was rewritten to what is open: fp5's runs, RW and RW-E's verdict, the live row, PR5, and Davies' own decisions. One old item closed on the way: every maker probe filled since `0050` (ids 12–16, 09-25 and 09-26) carries a `fill_minute` whose volume is above zero.

### [2026-09-26 16:15 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies: verify what Cursor shipped (the live row, the page, the testing strategies) and review the fp5 research.**
- RW's page could show a split that disagreed with its own total for a minute. A run upserts the fills of the minutes it decides, and the row of a day it closes, before it saves the state that counts them; the dashboard read all of them at once, so a read between the two paired a new fill with the old state (seen on production: $0.081). The dashboard now reads `pm_rw_state` first, and `rwSummary` keeps only fills at or before `lastDecided` and days before `dayOf`. Pinned in `pmrw_view.test.ts` (fails on the old code: a mismatch of $0.20 and a day row that is not closed).
- The two `momentum-1d` rows wore an amber dot ("last reading … ago") for about half of every day while deciding on time at 00:00. The dashboard took each row's last decision from the 120 newest overall, which by midday are the hourly and 4-hour rows' alone (at 16:12 they reached back only to 04:00); a daily row's state changes a few times a day, so the observation clock did not cover it (24 green minutes in 12 hours). Each row's newest decision is now its own query on `(strategy_id, ts)` (`newestDecisions`), as the tick already reads observations one pair at a time; pinned in `index.test.ts` with that day's shape.
- The UI and PR5 fixes since `9f3e8a6` were reviewed adversarially (all gates green on `main`, 333 sweep checks, screenshots of LIVE, TESTING, a strategy page and both test pages at 1400 and 390 px read by eye). PR5's executor fix and `0055` hold (replay byte for byte with and without the minute table). One defect was live for any browser that writes a decimal comma: `dropDot00` read "-$0,50" as a signed zero and printed a loss under a dollar as "$0,50". It now treats either mark as a fraction and drops ",00" too; pinned in `agents.test.js` (the old code printed "$0,50").
- The tabs split by row while a row's dollars add every book it has: a live row paused or relabelled once flat would have moved to TESTING with its real realised dollars and fees summed into the paper totals, LIVE reading "Nothing is live", and a pending live order's banner (LIVE only) hidden. A row that has traded real money now stays on LIVE (`tradedLive`: a live-book line with fills), and once nothing on LIVE can buy or holds anything the tab says "Real money · stopped"; a pending live order's banner shows on both tabs. And "not trading yet" was printed for an unarmed row that holds coins, which its floor and its rule's exit still sell: it now reads "Real money · selling what it holds", as a winding-down row does (the sweep's unarmed fixture holds ETH, so its check moved with it). Pinned in `agents.test.js`; three of its cases fail on the old code. Not changed, being Davies' own choices on the page: TESTING's unrealised base (strategies' cost plus the tests' deployed), RW's rewards inside REALIZED, the WORST CASE and Costs labels. Left as notes: TESTING's TODAY sums three definitions (PR5 counts exited trips only), rows can miss their scoreboard by a cent outside RW (`splitCents` is RW's alone), and the page never reads `agent_quote_live_*`, so PR5's live trading would show nowhere on LIVE — that must be built before PR5 leaves dry-run.
- RW-E pre-registered (`reviews/2026-09-26-polymarket-rw-end-prereg.md`, reference §4 item 36, G2): the run so far put all of RW's stress loss in the 15 markets that end on the day they are chosen (rewards $147.84, fills −$128.53, stress −$77.61; the other 15 together +$60.86 of stress), which is RW's failing condition today. Frozen before any minute of 09-27 exists; judged with RW's verdict by exact replay of the stored tables.
- fp5 reviewed: the three branches (`cursor/revolut-x-search-d133`, `cursor/binance-fp5-search-7bc0`, `cursor/polymarket-fp5-b50c`) read end to end, key results re-run from their inputs, and the claims that decide a verdict checked in their code (a resting bid booked at the aggressor's print in Revolut X passes 78–80; a null drawn without replacement in Binance's `common.py`; a 0.07 fallback fee rate in Polymarket's early input scripts). Nothing is worth money; `docs/agents/reviews/2026-09-26-fp5-review.md` keeps the causes and the order of what is worth running, and the new top item lists it.
- The working-with-davies skill (and its two Cursor copies) gains the lesson both dashboard bugs share: a row's own newest record is its own query, never a window over every row; and a record's state is read before the records it counts.

### [2026-09-26 05:29 UTC] Platform: Cursor | Model: Grok 4.7

**Davies: the phone subpage is still not the screen.** Three screenshots at 06:13, iPhone 16 Pro, 1206×2622.
- The backdrop was still `position: absolute`. iOS 26 clips that the same way it clips `position: fixed`: the strip around the floating toolbar stays the page behind, and a layer taller than the screen shoves the title off. Measured on the transaction-history shot, the title's ink is 30 device pixels against 59 for "Holding list" — the header had shrunk and `overflow: hidden` kept the bottoms of the letters. `flex-shrink` on that header is 1 by default, and `overflow: hidden` lets it shrink below its text.
- The top modal is now ordinary flow (`position: relative`), as tall as the screen, portaled to `body`, and the board (`#root`) is not in the document while it is open. A modal under it stays absolute in the same rectangle. The header does not shrink. The body scrolls, with padding for the strip the toolbar covers.
- The sweep requires `position: relative`, the board `display: none`, the header `flex-shrink: 0`, and the title at least 16px inside the frame. Absolute fails that. Headless Chrome has no toolbar; the phone is the check.

### [2026-09-26 03:31 UTC] Platform: Cursor | Model: Grok 4.7

**Davies: the phone subpage still left a blank band under it, and the title still left the top.**
- Anchoring a fixed layer and giving it a hair of transparency did not cover the strip under the toolbar. iOS 26 clips `position: fixed` above that toolbar, and fixing the body to lock the scroll is what shoves the title off the top. A phone subpage is now ordinary flow, one large viewport tall, the way the homepage already fills that strip. On a phone the body is not `position: fixed`. The last row can scroll clear of the toolbar.
- The sweep requires the backdrop to be absolute, the body not fixed, the box to cover the screen and the title to sit in the top of it. A fixed layer fails that. Headless Chrome has no toolbar; the phone is the check.

### [2026-09-25 22:13 UTC] Platform: Cursor | Model: Grok 4.7

**Davies: in agents mode, a number that is already a whole number is written as an integer, without .00.**
- Agents dollars, percents, basis points, fill shares and two-decimal chart prices drop a trailing .00. A size of 20.129 still reads 20.13; 1.20 and 21.50% stay. A value that rounds to zero reads 0, not -0.00. The homepage formatters are unchanged.
- The pin is `fmtUsd(100) === '$100'`, `fmtPctSigned(25, 2) === '+25%'` and `rwShareText(20) === '20'`. The old printers returned `$100.00`, `+25.00%` and `20.00`.

### [2026-09-25 21:16 UTC] Platform: Cursor | Model: Grok 4.7

**Davies: a phone subpage still left a blank band under it and the title slid off the top; REALIZED and its fees stay on one line; Reward quotes fill shares print to two places.**
- On an iPhone 16 Pro the modal stopped about 62px short of the screen and the page behind showed through. Transaction history's title was off the top. `100lvh` is taller than the visible screen: iOS 26 clips that overflow, the title moves off the top, and the last row cannot scroll back because the clipped part is the scroller. The backdrop is anchored to all four edges. A hair of transparency lets a fixed layer paint under the toolbar, and a paint-only shadow covers the band that remains. The header stays; the body scrolls. Headless Chrome has no toolbar, so the pin is `bottom: 0` with the title inside the frame. The `100lvh` rule set `bottom: auto` and fails that pin.
- REALIZED G/L stays the same size and tracking as the other scoreboard titles. `(incl. fees …)` stays on that same line, smaller. Only the fees shrink when the column is narrow. The sweep requires the fees to start at the title's right edge and still overlap it.
- A fill's shares on Reward quotes print to two decimal places. A size of 20.129 reads 20.13.

### [2026-09-25 20:42 UTC] Platform: Cursor | Model: Grok 4.7

**Davies: every agents page refreshes itself every minute, and each strategy page has the list's refresh button beside close.**
- The minute is one clock on the agents modal, so it keeps running on the list, a strategy, Stablecoin quotes and Reward quotes. A hidden tab does not call out; coming back after a minute does, at once.
- The open chart refetches with that answer. A click does too: the same refresh button sits to the left of ✕ on those pages.
- The sweep clicks it on a strategy page and reads another dashboard request and another chart request, then moves a minute and reads one more dashboard request.

### [2026-09-25 20:33 UTC] Platform: Cursor | Model: Grok 4.7

**Davies: phone subpages fill the screen, a narrow venue slice shows only the percent, Stablecoin quotes drops "% of deployed", strategy headings drop the small base, and REALIZED's title matches the other cells.**
- A phone subpage is the backdrop, `100lvh`, stretched to its edges. `100dvh` centered in the fixed layer stopped above the browser toolbar, so the home page showed through and the safe-area padding sat empty while the last row was clipped. The scroller, not the frame, clears the home indicator. Headless Chrome has no toolbar, so the sweep stretches the backdrop past the viewport and requires the modal to meet it.
- The share bar measures the slice. The full label shows when it fits; otherwise the percent alone. A 12% cutoff still painted the middle of "Polymarket". Squeezing Revolut X to 48px must read "89%".
- Stablecoin quotes' unrealised cell no longer says "% of deployed". The scoreboard still folds what that test has deployed (`scoreDeployed`).
- LIVE and TESTING table headings are the column name alone. The "% of …" line under Today, Unrealised and Realised is gone. Phone cards are not that heading.
- REALIZED G/L stays the same size and tracking as the other scoreboard titles. The fees are smaller and in parentheses, `(incl. fees …)`, and wrap under the title when the column cannot hold both. The old rule shrank the whole title to fit the fees on one line.
- Reward quotes' realised split, rewards then orders, each on its own line, is the section below.

### [2026-09-25 20:03 UTC] Platform: Cursor | Model: Grok 4.7

**Davies: Reward quotes' realised split is two lines, rewards then orders.**
- Under REALIZED G/L, rewards and orders each take their own line. One running line had been wrapping through the amount.

### [2026-09-25 19:31 UTC] Platform: Cursor | Model: Grok 4.7

**Davies: Deployed beside Venue, Polymarket's funded label on one line, the history button only when it adds a row, and DAYS names WORST CASE.**
- LIVE STRATEGIES and TESTING STRATEGIES gain a Deployed column immediately right of Venue. It is the scoreboard's deployed figure (`valueUsd`), and the rows add up to that cell. The phone cards show the same amount.
- "funded (Paper)" stays one line on every venue card. The label had been allowed to shrink to its longest word, so Polymarket's card broke it in two.
- Load full history sits under the orders table only when the chart says the log would add a row for that coin (`ordersMore`, against the newest 300). A pair whose window already holds them does not show the button. The chart read is what the `agents` deploy publishes.
- Reward quotes' DAYS column Stress is WORST CASE, the same name as the tile above it.

### [2026-09-25 19:05 UTC] Platform: Cursor | Model: Grok 4.7

**Davies: the scoreboard's last cell painted past the frame, and the two test pages needed a quieter reading.**
- REALIZED's fees stay on the title's line. The cell shrinks that line to the column (the strategy page had been missing the class the tab already used), so the words stay inside the border on LIVE, TESTING and a strategy page, desktop and phone. The browser sweep measures the label against the frame.
- Reward quotes STATUS drops the small lines. The tiles are WORST CASE, TOP SHARE, QUOTING TODAY, POSITIONS STILL HELD. DAYS leads with Costs, then fills and stress, and ends rewards then total; the UTC day still open is the first row, that day's change (the scoreboard's today), not the running total. FILLS puts shares before price, both the same width. Both test pages end "as of … · refreshes every minute".
- A venue slice too narrow for its name shows the percent alone. A read-only viewer's chart title is PERFORMANCE VS S&P 500 (PERFORMANCE VS S&P FUT while the benchmark is the futures).

### [2026-09-25 02:42 UTC] Platform: Cursor | Model: Grok 4.7

**trend-4h-live's funded capital is $100, and the one-slot cap moved with the slot.** Davies, in this conversation:
the only live Revolut X row should be funded at $100, and that account should hold exactly $100. `slotUsdOf` is
`capital_usd / symbols`, so $100 on four coins is a $25 entry, which does not fit under 15. The same path that armed
the row (one `update` each, no migration file, no order): `agent_strategies.capital_usd` 50 → 100 on `trend-4h-live`,
`agent_risk.max_exposure_usd` 15 → 25. `live_confirmed_at` stayed 22:53:09.568, `global_pause` false, live orders 0.
The probe (`only=revx`, request 33657) answered 200 and the USD row's available equalled 100 (`usd_available_eq_100`
true); the amount was not read out. The ticks at 02:43:00 and 02:44:01 were both HTTP 200, 7 strategies, `errors` empty, and `ops_errors` since the update is 0. The 30 and 75 cap steps were written for the $50 book and are not the next raises.

### [2026-09-25 00:30 UTC] Platform: Cursor | Model: Grok 4.7

**Davies: Reward quotes' realised was overflowing, and the bar section was the wrong shape.** Also drop the strategy count on both scoreboards, put the fees on the realised title's line, drop Polymarket's empty maker/taker, and make Reward quotes' unrealised percent the same base as the other rows.
- Realised's rewards and orders wrap inside the cell. The fees sit on the same line as REALIZED G/L. The funded cell no longer counts strategies.
- The section is STATUS: stress, the best market's share, markets quoting today, positions still open. The progress bar, the "day n of 14" line, TOTAL and FILLS are gone. Not titled "market conditions" — that name is the home page's cards, and this block is the test's own standing.
- A fill row is one print (side, price, shares). It has no profit of its own: profit is known when a trade closes, and that number is the Orders column on QUOTES and the orders half of realised. 100 was never a cap on fills. It is one line of the fourteen-day pass bar ("at least 100 fills", spec § "The bar"). The engine records every fill.
- Reward quotes' unrealised percent is of inventory cost (long Yes: shares × average price; short Yes: shares × (1 − that price)), so the cell matches the column's "% of cost". The scoreboard still folds what the test has deployed (`scoreDeployed`). Polymarket's card drops "maker/taker —" because that venue has no fee schedule on the page.

### [2026-09-25 00:08 UTC] Platform: Cursor | Model: Grok 4.7

**PR5's per-minute record is writing, and the deploy did not cross the 00:00 close.** The bar that closes at 00:00 is
`bar_start` 2026-09-24 20:00. At 00:00:04 the live row wrote four holds on it, the same as the paper row. `agents`
deployed at 00:05:30 UTC (edge-functions run 36075843621, "Deployed Functions: agents"). After that: quotes turns at
00:06 and 00:07 both `recorded: 2`, `errors: []`; `agent_quote_minutes` starts at 2026-09-25 00:05 (two books, X and
fair present, 22 hourly closes); `agent_quote_state.last_error` null and `last_minute` 00:06; the dry-run
`last_error` null at 00:07:26; ticks at 00:06:01 and 00:07:00 are `strategies: 7`, `errors: []`, four
`trend-4h-live` skips; `ops_errors` since 00:04 is 0; live orders 0. No new 4h decision was due. This is a mid-test
change: minutes before 00:05 are not backfilled.

### [2026-09-25 00:04 UTC] Platform: Cursor | Model: Grok 4.7

**Davies: quieter scoreboards, and the live-trading box goes.** His words, in order: drop the DEPLOYED bar (the percent is enough) and the "% of funded" badges on every scoreboard, keep "incl. fees"; on Reward quotes drop the unrealised rewards/orders lines, stop REALIZED from stretching the bar, drop TOTAL and FILLS in the warm-up, put days above the markets table and rename that table; delete the live-trading hint box. Then: drop the green edge on LIVE's scoreboard, drop the "% of funded" badges on both pages' venue cards, and call every row a strategy.
- Scoreboards keep the percent beside the figure and the fees line on realised. The funded count is one number of strategies (the two paper rows included). Venue cards no longer print a percent base, and "1 test" / "N strategies, M tests" is gone from the cards and the TESTING tab line.
- Reward quotes: unrealised is the figure alone; realised's rewards and orders sit on one line. The markets table is titled QUOTES, not "Limited orders" — the rows are markets being quoted (bid, ask, share, held), and "limited orders" would read as an order type. Days sit above it. Warm-up tiles are STRESS and BEST MARKET (`rwBarTileKeys`).
- The "Live trading is on" box and the "Live trading is not on yet" banner are gone. The LIVE tab still says "Real money · trading" or "Real money · not trading yet". Other banners stay.
- No strategy row, rule or live state was written. The two paper rows still count in TESTING's totals.
