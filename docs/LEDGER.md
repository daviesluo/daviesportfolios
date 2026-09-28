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

2. **RW (Polymarket reward quotes, paper), RW-E and RW-E's three variants: the verdicts on or after 2026-10-09 00:05 UTC.** RW runs by itself
   since 2026-09-24 19:30 UTC: fourteen days, 2026-09-25 00:00 → 10-09 00:00 UTC (`agents/pmrw.ts`, `0053`, the calls
   `pmrw` and `pmrw-select` of `edge-calls-every-minute` since `0063`; spec `reviews/2026-09-24-polymarket-rw-paper-spec.md`;
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
     d2. RW-X1–X3 by their pre-registration's bar (`reviews/2026-09-27-polymarket-rw-variants-prereg.md`: 09-28 →
        10-08, the change over the eleven days from the 09-27 row), from `pm_rw_x_days` (arms `x1`–`x3`), after its
        two checks: arm `rw` equals `pm_rw_days` and arm `e` equals `pm_rw_e_days`' `e` on every day, to under a cent.
     e. A migration re-schedules `edge-calls-every-minute` without its `pmrw`, `pmrw-select`, `pmrw-e` and `pmrw-x`
        rows (the list `0069` left, RW-C's four `pmrwc*` rows and every other row unchanged; the tables stay); the page
        rows stay as a record until Davies says otherwise.
     f. Report to Davies in Chinese. Only an account that quotes can show what Polymarket actually pays.
   - **RW-E's variants (Davies, 2026-09-27: study a/b/c, track the ones worth it as TESTING rows the way RW-E is).**
     Research done (history 18:20): (a) dropped; (b) a pause after a jump, (c) no weather, and both, go forward.
     **Pre-registered and frozen 2026-09-27 18:25 UTC** (`reviews/2026-09-27-polymarket-rw-variants-prereg.md`):
     RW-X1 "Reward quotes (no weather)", RW-X2 "Reward quotes (pause on jumps)" (15 ¢, 60 minutes), RW-X3 both; RW-E
     from 09-27 plus each rule from 2026-09-28 00:00 UTC, judged on 09-28 → 10-08 with RW's and RW-E's verdicts.
     **Tracked from `0064`**: `agents?action=pmrw-x` (`runPmrwX`, a row of `edge-calls-every-minute`) replays RW's
     stored minutes every minute from RW's start into `pm_rw_x_state` / `pm_rw_x_days`; TESTING rows after RW-E's
     (`rwxArmSummaries`), counted in TESTING's totals and the Polymarket card as RW and RW-E are. **x3 ("variant-4") is
     off the page since 2026-09-28** (Davies: it follows from variant-2 and -3; `RWX_OFF_PAGE`); the replay still runs
     it unchanged, so d2 reads x3 from `pm_rw_x_days` as before.
     **Daily health:** `pm_rw_x_state.last_error` empty, `last_minute` within ~3 min of RW's; in its state
     `checkMaxUsd` (arm `rw` against RW's days) and `checkEMaxUsd` (arm `e` against RW-E's, over `checkEDays` days)
     both under $0.01; each arm's `diverged` read. Do not read a market-level figure of 09-28 or later before 10-09.
     **The page shows each row's own record only (Davies, 2026-09-27):** RW-E's row from 09-27 00:00 and x1–x3's
     from 09-28 00:00 UTC, each against its accounts as that minute began (`base` in the replays' states, history
     20:28). **Verified 2026-09-28 00:03 UTC:** `pm_rw_x_state`'s arms `x1`–`x3` carry `base`, captured at 00:00, with
     both checks at $0.00 and no error (only the base's presence was read, not its contents). That a row's total is its
     running total less its own 09-27 row is pinned by `pmrw_view.test.ts`'s closed-form case.
   - **RW-C, RW's rule forward on 2026-10-09 → 10-23 UTC (RW-NEXT part 2; Davies approved the build 2026-09-27): ON
     `main` since 2026-09-28 04:39 UTC** (`3682b557` engine + `0069`, `17728e3c` page; history 00:38 and 05:12).
     `pmrw.ts` as a second instance (`RWC_INSTANCE`) into `pm_rwc_*` (RW's eleven tables, renamed), leases `pmrwc*`,
     warm-up 10-08 00:00 by constant; RW-E and x1–x3 replayed on its minutes with every "from" at 10-09 00:00
     (`pmrwc-e`, `pmrwc-x`). `0069_pm_rwc.sql` adds the tables and four rows of `edge-calls-every-minute`. **Its page row
     "Reward quotes confirmation" appears by itself at its warm-up, 10-08 00:00 UTC** (Davies, 2026-09-28: off the page
     until then; the dashboard reads nothing of it before), "starts 9 Oct 01:00 BST" until its first minute. RW-NEXT
     (item 5a.3) must be frozen before 10-08 00:00, citing those two commits. The four calls return "before its
     warm-up" / "before RW-C's first minute is decided" (no database read) until 10-08 00:00 / 10-09 00:02. **Check
     after 10-08 00:10 UTC** (RW-NEXT's
     slip rule turns on it): `pm_rwc_selection` holds rows for 10-08, `pm_rwc_state.last_minute` within ~3 min, no
     `last_error`; after 10-09 00:05, `pm_rwc_days` holds 10-08 with `detail->>'phase'` `warm-up`; after 10-10 00:05,
     both replays' `checkMaxUsd` (and the x replay's `checkEMaxUsd` over `checkEDays`) under $0.01, read as scalars.
     Nothing else of `pm_rwc_*` before its verdict (RW-NEXT's no-peek list). **Its verdict** on or after 2026-10-23
     00:05 UTC by the frozen RW-NEXT (the primary its part 1 names, from `pm_rwc_days` or the replays' day rows after
     the check), then a migration takes the four `pmrwc*` rows out of `edge-calls-every-minute`.
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
   still held on 09-26. The paper `trend-4h` is its same-venue control, at ten times its size since `0066` ($1,000,
   five $200 slots; `trend-1h` and `momentum-1d` $1,000 too since `0067`, three $333 slots; paper caps $5,000 and
   $100 a day of their own; the live row's $25 and $5 untouched), and the Binance twins are gone (`0065`). Davies: no confirmation of his
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

5. **Studies of 2026-09-26/27, this session: all done (WXSRC, VIEWS, the speed study, fp6, PMLATE, HARVEST); the view recorder running.** (Bitget reported the same evening: don't
   register, `venue-survey.md` §12.) (a) A fourth Binance-first
   search, fp6 (Davies: Binance still has no strategy of its own; his account supports futures, while the key's
   futures permission is off): phase 1 is access from primary sources (UK retail crypto derivatives are banned since
   2021-01-06), an idea table, a power check and at most ten pre-registered hypotheses, Holm-corrected, under the fp5
   review's rules; it stops for review and a freeze on `main` before any test runs, then phase 2 runs them as frozen.
   **Phase 1 is done and frozen on `main` by `d856fd2e`** (`reviews/2026-09-26-fp6-prereg-family.md` and its five
   files): H2 ETH spot against its quarterly, H3 spot/perp carry on the top-40 altcoins, H4 the live trend rule long
   and short on perpetuals through the house backtester, H5 short after "Binance Will Delist", H6 short a new perpetual
   for thirty days; Holm over the five. H1 (BTC/ETH perpetual carry) was withdrawn on its own counts: no settlement has
   paid above the 0.0100 % floor since 2025. **Access, before any result:** every one has a derivative leg; a
   UK-registered retail account may not be sold one (FCA PS20/10, COBS 22.6.5R), Binance told EU users it would stop
   serving them from 2026-07-01, and the account's registered country and investor category can only be read in its
   app. A pass says a rule would have paid, not that this account may run it: that is Davies' and Binance's.
   **Closed 2026-09-27: none of the five passes** (reference §3.38, `reviews/2026-09-27-fp6-study.md`). H5 (short after
   a delisting notice) and H6 (short new perpetuals) clear Holm but fail their own bars on one month's share; H2–H4 fail
   outright. At 1 s, H5 would have made +$1,142 against +$265.80: post hoc, a new pre-registration if ever pursued, and
   out of this account's reach while it cannot hold a derivative.
   (b) PMLATE (Davies, the same evening): turn RW's same-day loss around and be the informed taker — once a daily
   temperature market's result is effectively known from the station's observations, take the stale liquidity
   quoters still rest on the losing side. Not WX (a day-ahead forecast rule, failed): same-day observations. Phase 1
   measures the mechanism on RW's own stored minutes and prints, then latency (observation publication against how
   fast the stale side is taken today; our loop is a one-minute cron), resolution basis risk (METAR against Weather
   Underground's whole degrees), fees near 0.9–0.99, depth and capital lock, power, and pre-registers at most ten
   hypotheses under the fp5 rules; it stops for review and a freeze on `main`. Any live version opens positions only
   from Ireland under Davies' attestation (CLAUDE.md), and its order path does not exist. **Closed: its one hypothesis,
   USLATE (US stations only, frozen by `ad6ec6e3`), ran on 2026-03 → 08 and fails condition 6 of 7**
   (`reviews/2026-09-26-pmlate-uslate-study.md`): +$715.73 on 131 buckets over 55 dates, but one date is 57.6 % of it
   (NYC's low of 05-06, which resolved on a special report read in whole degrees). At a 1 s loop it is +$735.24 with
   the same date 56.1 %: AWC's delay binds, not the loop's. Nothing goes to paper.
   (c) A speed study (Davies: PMLATE's problem is speed — why once a minute, how fast can we go, would it help): the
   edge left at each reaction time on September's data (seen already), each keyless weather source's latency after
   the observation, measured live, and what each architecture could do — pg_cron every N seconds (1 s is the floor on
   pg_cron 1.6.4), a loop inside one Edge call (2 s CPU, 150–400 s wall), or an always-on worker holding Polymarket's
   WebSocket. Measurements only; a rule out of it is pre-registered, not priced. Davies, later the same evening:
   every speed assumption in a study is 1 s (pg_cron's floor), and below that the thing to study is an always-on
   Cloudflare Worker (his Cloudflare connector is on; read it, deploy nothing without his word). **Done 2026-09-27**
   (reference §3.39): the source binds, not the loop — for temperature, post counts and view counts; the venue binds
   PR5; nothing binds the crypto rows. The one-minute loop stays; no Worker. USLATE-FAST is frozen with it
   (`reviews/2026-09-27-speed-prereg-uslate-fast.md`) and runs only if Davies has its 1 s `tgftp` recorder built;
   the coordinator's advice is to wait for WXSRC (5e), which looks for a faster source than any keyless one.
   (d) YouTube view counts (Davies, 2026-09-26: `YOUTUBE_API_KEY` is in the secrets). First the probe's `youtube`
   part verifies the key read-only; then a recorder of what nobody can pull later — the view counter of each video
   with an open Polymarket view market (MrBeast, MrBeast Gaming) and those markets' books — every second around each
   market's deadline and once a minute otherwise, inside the key's 10,000 units a day. Record only, no orders; a rule
   out of it is pre-registered after 4–6 weeks of it. **The key works (probe 09-27 01:02 UTC, reference §6); the
   recorder is `0062` / `agents/views.ts` (reference §4 item 38), recording from its deploy on 2026-09-27.** The API's
   counter moves in batches (none in 30 s on a video gaining ~13,000 views a minute); how far apart is the first thing
   its record says. A study of it is pre-registered before it reads the tables (~2026-10-25 → 11-08).
   **Its first deadline, read (2026-09-27 16:00 UTC, reference §4 item 38):** the counter moves in five-minute batches
   landing 2 min 20 s – 2 min 45 s after each mark; the count at T was fixed 1 min 48 s before it, and the market was
   decided forty minutes before, with nothing left to take. The window covered 87 % of its seconds; its last 20 s were
   lost to pg_net's batch wait, which `0063` removes (reference §4 item 39).
   (e) WXSRC (Davies, 2026-09-27, on PMLATE's result: keep researching the data source, and weather models such as
   Google's newest; every city's source differs): a research agent's phase 1. Per open temperature city, the station,
   the resolution source and the fastest trustworthy source of the deciding observation (national 1- and 10-minute
   feeds, `api.weather.gov`, IEM, ASOS one-minute data, MADIS / Synoptic, measured live at 1 s where keyless and
   allowed), against when the stale side is taken; and a survey of weather models (Google's, from primary sources;
   HRRR / NBM / ECMWF AIFS / ICON-D2 / AROME): can a model's intraday prediction of the day's extreme beat the price
   after fees, and can that be backtested. At most five pre-registrations, then the coordinator's freeze. Research
   only: no key, no sign-up, nothing placed; a source that needs a key is a step for Davies. **Phase 1 done, nothing
   to freeze** (`reviews/2026-09-27-wxsrc-study.md`): the one keyless candidate (FASTSRC) was withdrawn on its own
   power check; what is left needs Davies' free sign-ups first (FAA SWIM SCDS, Météo-France DPObs, KMA API Hub, the
   WeatherNext 3 allowlist), then a measurement of each feed, then a pre-registration (study §C2, "What Davies must
   do or decide"). Reference §3.41.
   (f) VIEWS phase 1 (Davies, 2026-09-27: is the view strategy promising?): a research agent on the closed view events
   under tag 146 (MrBeast day-1…week-1, Gaming, others; ~157 MrBeast events, ~$92M traded): how efficient the price is
   near the deadline, what stale side is left once the last batch before T fixes the count (PMLATE's question), the
   resolution risk, a forward-test design for trajectory and batch-reaction rules, and what the recorder should record
   differently. At most five pre-registrations; then the freeze. **Done 2026-09-27 (reference §3.40): not promising as money, no
   pre-registration.** The market is calibrated near T (the winner's median 0.9985 at T − 1 h, the favourite won all
   92 dated deadlines from T − 15 min); after T $3,271 of stale edge in 547 days, +$253.59 at T + 1 s with 66.5 % on
   one contested date; depth fell from $935k to $104k an event since June. The recorder keeps recording 4–6 weeks as
   measurement; its changes (1 s from T − 6 to T + 6 min, batch brackets if today's jitter allows, freezes, the
   resolution from Gamma, premieres, exact publish times for 25 past ids) wait for the 16:00 window's data.
   (g) HARVEST (Davies, 2026-09-27: the research drifted — the idea is to eat the orders liquidity providers leave
   once a result is essentially confirmed, not to compete with the market; temperature markets included; and add
   the new kinds of market RW now selects). **Phase 1 done 2026-09-27, integrated on `main` (`429ebc27` … `6618ee31`;
   reference §3.42, `reviews/2026-09-27-harvest-phase1.md`): not worth money, nothing pre-registered.** Where the
   market agrees with the source the late book pays 0.1–0.5 ¢ a dollar, which one trap in 220–830 markets erases
   (measured: 1 in 136 earthquakes, 1 in 152 temperature, 1 in 243 mention proposals); the late money sits in one or
   two contested market-days per category, USLATE's failed shape; the economic releases are a 10-second race. The
   re-run on the committed inputs is byte-identical. **A defect it found in closed work**: PMLATE's
   `count_common.xt_posts` reads one page (100 posts) of the post tracker, so PMLATE phase 1's count basis and SPEED's
   `count_edge.py` truncated every window above 100 posts (every Elon Musk window, Trump's busier weeks);
   `harvest/scripts/hcommon.xt_posts` pages. No running strategy reads either; re-run SPEED's post-count figures with
   the paged reader before any post-count idea is taken up again.

5a. **The TESTING review is done (2026-09-27, `docs/agents/reviews/2026-09-27-testing-portfolio-review.md`, appendices
   A–C beside it; reference §3.43).** The set is sound and keeps all nine rows; its one defect is fixed (`0068`, §4
   item 41). **Davies picked every addition on 2026-09-27** (MX-1, RW-NEXT with RW-C built, QUEUE, PR5-R and the lower
   ones), and asked that the probe bug be ruled out of the live strategies: done, neither live path has it (§4 item 41).
   Every draft went through an independent review on 2026-09-28 and is frozen only after a second pass; until then the
   drafts and the reviews live in the working session's scratchpad, never in the repository, because the commit that
   adds a pre-registration freezes it.
   State at 2026-09-28 01:25 UTC:
   1. **JEV-DRIFT: done.** Code live (agents v91), monitor frozen (`reviews/2026-09-28-jev-drift-monitor.md`, §4 item
      43). Open: Davies' answer on whether a live-row flag should clear `live_confirmed_at` by itself.
   2. **MX-1**: R1, R2 and R3 recording are live (§4 items 41, 42, 44; R3 at 01:09 UTC). The draft is rewritten to the
      review: fills from the UK tape with quantities, events by decision, the price actually paid, protective exits out,
      exits at 60 min and entries at 15, a Clopper–Pearson bound so unseen misses count. Waiting on: C*, the chase of a
      missed order measured at the rules' own decision minutes (running); one production probe showing `order_id`; the
      second pass. After the freeze, **every Monday**: pull the UK tape for each event's window and export
      `agent_basis`'s BTC/ETH/SOL rows (pruned at 30 days) into `docs/agents/backtests/mx1/`. Read at 60 judged events a
      side or on 2027-03-31.
   3. **RW-NEXT + RW-C**: the RW-C engine is built on a branch (migration `0069`, `pm_rwc_*` tables, warm-up from
      2026-10-08 00:00 UTC, judged 10-09 → 10-23) and is being rebased; RW-NEXT is being revised (R1–R11). **Freeze
      RW-NEXT and land RW-C before 2026-10-08 00:00 UTC**, and before anyone reads a market-level RW figure.
   4. **QUEUE**: being revised against the second review (QF-1–QF-21). Freeze before 10-25 and before anyone reads the
      content of `agent_book_levels`. Run by **2026-11-01 10:25 UTC**, when the 35-day prune reaches its window. Pull
      Kraken's hourly USDT/USD and USDC/USD on 10-26 between 00:05 and 21:59 UTC (720 bars kept).
   5. **PR5-R**: being revised (P1–P8). Freeze before 10-21.
   6. **PR5-W**: being revised (WF-1–WF-11). Read on 2026-11-25, which needs PR5's paper engine running to then.
   7. **EX-GAP**: being revised (E1–E8).

6. **Davies' to decide or to do; nothing waits on them:**
   - **Cloudflare Pages builds** (his ask, 2026-09-27: every push sat in "Building" a long time; `ac006ca8`, pushed at
     19:00 UTC, was served from about 19:40). Watch paths Include `dist/*` is the dashboard cut (a push that does not
     change `dist/` then builds nothing; one that does still clones). `.github/workflows/pages-deploy.yml` Direct-Uploads
     the committed `dist/` via Wrangler (`pages deploy dist --project-name=daviesportfolios --branch=<ref>`). **Done
     2026-09-27 (his, through another tool):** the watch paths (Include `dist/*`) and both secrets,
     `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; the first upload, run by hand at 20:36 UTC, took 19 s.
     **Left, his click:** Pages' own Git build still publishes every `dist/` push too. Two deployers mean that when two
     such pushes land minutes apart, the Git build of the first can finish after the upload of the second and serve
     the older bundle until the second's Git build ends. Turning off the Git build's automatic deployments (Settings →
     Build → Branch control), or disconnecting the repository, leaves the upload alone; it deploys `main` only, so a
     branch then has no preview. No session can change these settings: the Cloudflare connector has no Pages tools.
   - HARVEST's one lead (reference §3.42): a forward recorder of UMA proposals and disputes on the harvest categories,
     with the book at C + 60 s, to see what rests after a confirmation and whether a proposal is safe to follow. Public
     reads only, nothing placed, like the view recorder; build it only on his word. The econ-release race (FAST-A) is
     the racing he ruled out. Any harvest opens a position: Ireland only, under his attestation.
   - WXSRC's keyed weather feeds (reference §3.41, §6 "The weather feeds"). Read 2026-09-27 by the `weather`
     function's probe: **Météo-France** — the stored `METEO_FRANCE_API_KEY` is an access token that expired six
     minutes after issue; store instead a long-lived **API Key** from the portal's "Générer Token" page (as
     `METEO_FRANCE_API_KEY`) or the page's OAuth2 **application ID** (as `METEO_FRANCE_APPLICATION_ID`), then re-run
     `weather?action=probe&only=meteofrance` (Davies is on it, 2026-09-27). **FAA** — the ITWS subscription works end
     to end but carries no temperature, and SCDS offers no METAR product yet: its list is STDDS, ITWS, TFMS, TBFM,
     SFDPS, NOTAM Distribution and TFDM, and the SWIFT Portal's news expects CSS-Wx in Q4 2026. When CSS-Wx appears,
     subscribe to its METAR/SPECI for the eleven US stations (KATL KAUS KBKF KDAL KHOU KLAX KLGA KMIA KORD KSEA KSFO);
     the probe reads it unchanged, then a day's measurement against `tgftp` and the takers. ITWS can lapse (60 days
     idle). Still open: KMA's API Hub (Seoul, Busan: needs a Korean phone number) and Google's WeatherNext 3 allowlist.
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

### [2026-09-28 05:12 UTC] Platform: Claude Code | Model: not recorded (session policy)

**RW-C landed on `main`, and two rows left the Agents page on Davies' word.** RW-C (the agent's build, history 00:38) was rebased onto `648adbe7`, its page commit's three conflicts resolved (imports, `RwDetail`'s signature, the sweep's pages list; its page call now passes `nowMs` too), every gate green, and pushed as `3682b557` + `17728e3c` at 04:39; `0069`'s cron list is `0064`'s with the four `pmrwc*` rows added and nothing else changed (read line by line). Then: **"Reward quotes variant-4" is off the page** (x3 = x1 on weather markets and x2 elsewhere, market by market, pinned in `pmrw_x.test.ts` on a world where both rules bite; the replays still run it for the verdict, only the dashboard leaves it out, `RWX_OFF_PAGE`), and **"Reward quotes confirmation" is off the page until its warm-up, 2026-10-08 00:00 UTC** (`rwcSummary` returns null before it and the dashboard reads nothing of RW-C; from then it is there by itself). The engine, its four cron rows and the frozen rules are unchanged. The sweep's default fixture now matches (no x3, no RW-C; every total re-derived by hand: TESTING $5,560 funded, realised +$125.56; the Polymarket card $4,000, unrealised −$4.60 on $35.80), and RW-C's warm-up row moved to a mode of its own (`rwc-warmup`), which also checks its page shows no test time.

### [2026-09-28 04:59 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Fixed: the NEW VERSION banner's reload painted older numbers first** (Davies: a refresh no longer did, the banner still did). Its purge ran `localStorage.clear()`, which wiped every copy a reload paints from — the book, the prices last shown, the 24H chart's bars, the Agents page — and `dp.prefs` with them, so hide-values switched itself off at every update. It now clears only the worker caches and registrations; an older shape is `Storage.migrate()`'s job, as on any reload after a deploy. The sweep's reload checks block the service worker, so none had gone down this path: a new section (0c') lets the page install its worker, serves a changed `sw.js`, waits for the banner and presses RELOAD with the book's stored prices at 0.95x and every answer held 1.5 s. On the old bundle it failed three checks (first paint $3,189 and the chart at −85.92 % where the screen had shown $3,183 and −33.00 %; `dp.prefs` null); on the new one all pass at both widths. Pinned in `sw_banner.test.js` too (fails with the clear put back).

### [2026-09-28 04:27 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Fixed: the performance panel (VS S&P / INVESTMENT) never refreshed** (Davies: it updated neither by itself nor on the refresh button). Its bars and the recorded 5-minute prices were fetched once per window, when first drawn; the axis and the S&P line then froze and only the book's last point followed the live prices. The app now passes the panel when its last refresh finished and how many times the button has been pressed: the tick fetches what has outlived its TTL (5 min on 24H), the button everything the window shows. A separate effect, so it never cancels the first load. Pinned: three vitest cases (a tick before and after the TTL, the button, the recorded prices), and two browser checks at both widths that failed on the old bundle (the panel stayed at +4.00 % after the button and after the app's refresh) and pass on the new one. The skill's chart rules say so.

### [2026-09-28 01:44 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Agents page, four changes on Davies' word:** the Stablecoin quotes page no longer says what its dry run would have sent (the line returns once its live path has traded); every PAPER/LIVE tag and venue tag is 18 px tall, wherever it sits; every strategy's and test's page says, after "running", how long it has been under test to the hour ("tested 3d 14h"; "live …" on the live row), from the row's creation (`createdAt`, new in the dashboard), the quotes' first minute, RW's first day or a variant's first minute; and the quotes' round trips show each trip's size in coins where "exit as" was, on a phone too. Every exit so far was a maker (9 of 9): the rule takes the book only at its 24-hour stop, never reached. Pinned in `agents.test.js` and the browser sweep (the tested words on each page, on the status's line at both widths; every tag's height on the list and each page; the size column).

### [2026-09-28 01:19 UTC] Platform: Claude Code | Model: not recorded (session policy)

**JEV-DRIFT's monitor document is frozen** (`reviews/2026-09-28-jev-drift-monitor.md`), after the reviewer's second pass and with the code it describes deployed (agents v91, 01:18:57 UTC). Its one open question goes to Davies in the briefing: should a flag on the live row clear `live_confirmed_at` on its own until the re-measure is in? Until he answers, it only alerts.

### [2026-09-28 01:17 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies: at most three sub-agents at a time, and every line to him in Chinese.**
- Both written into the working-with-davies skill (and its two Cursor copies): "以后请同时最多只开3个sub-agents" (the four already running finish; nothing new starts until fewer than three run), and a fifth reminder about English progress notes, "请保持说中文，别再忘了".

### [2026-09-28 01:15 UTC] Platform: Claude Code | Model: not recorded (session policy)

**JEV-DRIFT checks the question the decision records as asked, not the row's parameter.**
- `questionsForRow` asks a row's `params.jevQuestion` only when it is a wording of that row's own rule, so keying the check on the parameter would have skipped a check that could run and raised a false flag. The tick now reads `numbers.jevQuestion`. Pinned with `v2` and another rule's wording as the parameter; the pin fails on the old keying.
- The monitor document now says what a re-measure concludes (false alarm, drift that rebuilds the bands as a deviation, or a question for Davies), no repeat re-measure for one cause within seven days, and that any confirmed drift re-measures `trend-4h` too. It is frozen once this deploy is verified.

### [2026-09-28 00:57 UTC] Platform: Claude Code | Model: not recorded (session policy)

**R3: every maker probe now records the id of the order it shadows.**
- The column existed since `0042` and was always null. MX-1 needs it to group probes by decision, drop floor exits and IOC attempts that never filled, and take the fill price from the order, never the IOC limit (review M3/M4). Reference §4 item 44. MX-1 is frozen only after a production probe shows the id.

### [2026-09-28 00:52 UTC] Platform: Claude Code | Model: not recorded (session policy)

**JEV-DRIFT checks the question, the caution and the transport too, as the review asked (J1, J4, J5).**
- `jevDriftFlags` flags, on every entry the model answered: the healthy answer outside its band (as before); a question with no measured bands (another version, or a row's own wording), so the check cannot go quiet unseen; a caution of 1.5 or more (measured at most 1.02, veto at 1.75); and an answer from anything but `typesafe/jev-1.13-20260917` through OpenRouter, so the TypeSafe fallback is flagged whenever it answers an entry. The flag text names the transport. The test double now names each transport's real model. Pinned, with a counterfactual: both drift tests fail with the three new checks removed. Reference §4 item 43 rewritten to the code; the monitor document is rewritten to match and goes to the reviewer before it is frozen.

### [2026-09-28 00:44 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The probes' fill record corrected against the trade tape; the five pre-registration drafts go back for rework.**
- An independent review of the drafts (MX-1, EX-GAP, JEV-DRIFT, RW-NEXT, PR5-R) checked every probe against Revolut X's public UK trade tape, and I re-read two of them there myself: probe 1's fill was false (no print through its price for four hours) and probe 17 filled in 50.7 s, not the 39 minutes `0068` gave it from candles. Reference §4 item 41, §3.43 and the review's §2.3 now say so; the rows stay as the loop's rule computed them, and MX-1 will read fills from the tape. The corrected prior: exits about +5.4 to +6.2 bps (6 of 7 filled), entries +12.7.
- None of the five drafts is frozen yet: each goes back with the review's fixes (`scratchpad/prereg_review.md`, not committed). The lesson is in the working-with-davies skill: when a sentence names trades, read the tape.

### [2026-09-28 00:38 UTC] Platform: Claude Code | Model: not recorded (session policy)

**RW-C built (RW-NEXT part 2, Davies' go of 2026-09-27), on a branch for the main session to land: RW's engine as a second instance with tables of its own, forward on 2026-10-09 → 10-23 UTC.**
- `pmrw.ts` takes an instance (`RwInstance`: its seven tables, two leases, fourteen days, a quiet time); RW's (`RW_INSTANCE`) is the old constants, pinned. RW-C's (`RWC_INSTANCE`): `pm_rwc_*`, leases `pmrwc` / `pmrwc-select`, warm-up 10-08 00:00 by constant (before it both calls return with no read), flat start at 10-09 00:00, nothing after 10-23. The replays take one too (`RweReplay`, `RwxReplay`): `pmrwc-e` / `pmrwc-x` replay RW-C's minutes with every "from" at 10-09 00:00, live, because an Edge request's 2 s of CPU cannot replay fourteen days in one call and the check (arm `rw` = `pm_rwc_days` to under a cent) has to be readable as a scalar before any figure is. `db.ts` pages RW-C's two id-less tables by their keys, as RW's (without it RW-C's engine would have thrown on every run).
- `0069_pm_rwc.sql`: RW's eleven tables renamed (PGlite: columns, checks, indexes, RLS and refusals identical to RW's, re-runnable), four leases, and four rows added to `edge-calls-every-minute` (`cron_jobs.test.js` pins every other row unchanged). No prune, as RW's.
- Evidence: RW's engine and replays before and after, driven through one fake Polymarket over three windows (warm-up into day 1, a midnight mid-run, the end), made byte-identical database calls, requests and tables; the four RW test files run unchanged; `pmrwc.test.ts` (10) pins the instances, no read before the warm-up, RW-C never touching RW's tables nor RW RW-C's, the flat start, the end, the replay's check (and a planted 5 ¢ gap caught), and RW-E on RW-C's minutes equal to RW-C's engine run without the same-day market; nine counterfactuals each fail a pin (one of them the cron list's).
- Page: "Reward quotes confirmation", the last TESTING row, RW's page and $1,000 (`rwcSummary`, `rwcRow`): "starts 9 Oct 01:00 BST" on a grey dot before then, not running if no state 10 min into its warm-up, then RW's states. `pmrwc_view.test.ts` pins its summary from no state to after its end (and fails with the summary counting its warm-up). Its name takes two lines on a desktop's table (the column is set for "variant-4") and one on a phone's card; its page title wraps on a 390 px phone rather than lose its last letters. Sweep 391 checks, including a running RW-C at both widths.

### [2026-09-28 00:02 UTC] Platform: Claude Code | Model: not recorded (session policy)

**JEV-DRIFT runs in the tick: each entry's answer against the replies measured for its state.**
- `agents/jev_bands.ts` (a copy of the two answer files, rebuilt and compared by `jev_bands.test.ts`); the decision records `numbers.jevBand`, and an answer outside its band ±0.02, or an unmeasured state, goes to `ops_errors` as `agents.jev-drift`, apart from the turn's errors. It decides nothing. Reference §4 item 43; the monitor's rule is `reviews/2026-09-28-jev-drift-monitor.md`, frozen with the other pre-registrations.
- R2 verified in production: probe 19 (written 23:00:05) recorded o15/o30 as missed (they fell before the deploy) and o60 at 00:01:00 with the UK touch.

### [2026-09-27 23:48 UTC] Platform: Claude Code | Model: not recorded (session policy)

**R2 of MX-1: every maker probe records the touch 15, 30 and 60 minutes after it is written.**
- `o15`/`o30`/`o60` in `follow_up` (bid, ask, the turn's time), filled or not; a mark more than 3 minutes late is null, never late. MX-1 needs the touch at its deadline for twelve weeks and `agent_basis` keeps it 30 days. Reference §4 item 42. The MX-1 pre-registration is frozen next, before any event it is judged on.

### [2026-09-27 23:43 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies: run every addition the review ranked, and make sure the probe bug is not in the live strategies.**
- Audited both live paths (reference §4 item 41). `trend-4h-live` is filled by the venue, never by `tradedThrough`; its one probe resolved after it opened; the trail's high-water counts the fill bar from its start as the backtest does, and on Kraken's trades no high-water of the ten trend entries came from before a fill. PR5's live path (dry-run) places each paper decision 28.8–33.4 s after the paper counts it live (150 orders); none of the 9 paper fills fell in that window. Nothing to fix; the PR5 gap is settled before it goes live.

### [2026-09-27 22:26 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The TESTING review, written up (Davies: "深度研究一下目前的TESTING STRATEGIES组合").**
- `reviews/2026-09-27-testing-portfolio-review.md` with the three studies as appendices A–C; reference §3.43. Keep all nine rows; the rest is measurement, ranked in item 5a.
- Corrected: how to read the probes' `adverseBps` (reference §3.13 and `probeSummary`'s docstring: drift after a fill cancels for a rule that wants the position; fill rate, saving and chase decide); SUI's UK spread, 23.7 bps at the median over 1,815 samples, so a ~42 bps round trip (§3.20, `.claude/CLAUDE.md`); `momentum-1d` read against its daily-cadence figures (§3.17).

### [2026-09-27 22:19 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The TESTING review's one defect, fixed: a minute that began before a probe (or a resting paper order) was written no longer fills it.**
- `tradedThrough` takes the time the order or probe was written; both callers pass their row's `ts`. Probes 15 and 17 had been resolved on the minute they were written in (about 4.6 s into it). `0068` corrects them from Revolut X's public UK candles: 15 filled at 10:01 (2 min), 17 at 08:38 (39 min), marks cleared as `0050` did. Dry-run on production first (one row each). Pinned in `tick.test.ts`; both new pins fail with the check removed, and one older pin that had leaned on the defect now reads the right minute. Reference §4 item 41.

### [2026-09-27 21:34 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies: `trend-1h` and `momentum-1d` at $1,000 too, "所有数字全部乘2.5", to compare with Trend 4h.**
- `0067` sets both to $1,000 and scales their paper book × 2.5 from its first order (orders' sizes and fees, probes' sizes; `request` untouched), and moves the paper caps with the paper capital ($1,800 → $3,000): exposure $3,000 → $5,000, daily loss $50 → $100. Dry-run on production first (2 rows, 12 orders, 6 probes, the risk row); the live row is not touched. Reference §4 item 40.

### [2026-09-27 21:26 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies' asks on the venue cards, and faster gates.**
- Venue cards and tabs (his words): fees are set in under realised, as Polymarket's rewards and orders are; the fees read "maker 0% / taker 0.09%"; a card is two groups, funded, deployed and today, then unrealised, realised and the lines set in under it — side by side where a card has the width to itself (LIVE's one card on a desktop), one under the other otherwise; and TESTING's tab line reads "Paper" alone, its count being beside the label. The sweep checks both cards' set-in lines (12 px inside their cells) and LIVE's two groups at both widths.
- Gates (his ask: still slow): `bin/gates.sh` runs everything at once — the source checks beside the bundle's line, which builds and then runs the sweep's desktop and phone halves (`SWEEP_VIEWPORT`, `SWEEP_PORT`; no check compares the two), the perf matrix and the size budget together — and prints each step's seconds. Measured on a change to web and Edge both: 5 min 30 s before, 2 min 29 s after, every check passing under the load. CI still runs the sweep whole.

### [2026-09-27 20:28 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies: the four variants show only their own record ("只从自己rules下的记录才显示").**
- Until now variant-1 (RW-E) showed RW's record from 09-25 and x1–x3 RW-E's, so all four read the same before their rules began. Each replay now keeps an arm's accounts as its first minute begins (`base`: RW-E's `e` at 09-27 00:00, `pmrw_x.ts`'s arms at their `from`), and `rwSummary` takes `since`: every total, day, fill and market is the change since that minute, a position held then carried in at that minute's mark, a market settled before it left out. The running total less `base`'s equals the pre-registrations' own reading (running total less the close of the day before), pinned equal. Before its minute a row is `notStarted`: NEXT reads "28 Sep 01:00 BST" beside a grey dot whose words say "starts …", and its page's three tables say so.
- The rules are unchanged; RW-E's replay is version 3 and the variants' version 2 only so each replays once from RW's start and keeps the base it had already passed. Their day rows are rewritten with the same values; verify on production after the deploy that both checks stay under a cent and `base` is present.
- Evidence: `pmrw_e.test.ts` (a replay across 09-27 00:00 keeps exactly the accounts of 23:59's end, in both replays; by hand, a position bought at 49 ¢ before the minute and sold at 53 ¢ after it counts 0.60 from the 50 ¢ mark, plus two rewards: +0.80, equal to `rweSummary`'s reading), `pmrw_view.test.ts` (a short carried in at 30 ¢ and marked at 25 ¢, a new market, a market settled before the minute, days and today, all by hand), `pmrw_x.test.ts` (the round trip x2 sat out, now from 00:00), the counterfactual (no `since`: two tests fail), and `agents.test.js` / the sweep's `rwx-waiting` scenario at both widths.
- Deployed 21:05; both replays restarted from RW's start at 720 minutes a run and caught up at 21:11 (RW-E's `base` 30 markets, its total equal to its own 09-26 row and to the variants' `e` arm's to the 1e-9; the 09-25/26 day rows' hash unchanged; both checks $0). Davies saw variant-1 read "starts 27 Sep 01:00 BST", then "not running: its last decided minute is 552 min old", while it caught up: a replay far behind the clock whose state was written in the last 3 minutes now reads "catching up: replayed to …" (`catchingUp`, from the state row's `updated_at`; pinned in `pmrw_e.test.ts` and `agents.test.js`). pg_net's "Failed sending data to the peer" (8 of 2,437 calls since 15:12, at 19:41, 20:51 and 21:11) predates the deploy; not investigated.
- Cloudflare (Davies, through another tool, 20:35): the watch paths and both secrets are set, and `pages-deploy.yml` (Cursor's, `7a163bd4`) uploads `dist/`; this session's own draft of the same job was dropped for it. Item 6 now says what is left: one deployer, by turning off the Git build's automatic deployments.

### [2026-09-27 20:24 UTC] Platform: Cursor | Model: Grok 4.6

**Direct-Upload the committed `dist/` from GitHub Actions, so Cloudflare's builders do not clone the repository.** Item 6 asked for this on his word after Pages spent ~40 minutes cloning 118 MB of files to publish one folder. `.github/workflows/pages-deploy.yml` runs on a `dist/**` / `wrangler.jsonc` push to `main` (and `workflow_dispatch`), checks out shallow, and runs `cloudflare/wrangler-action@v4.1.3` (`pages deploy dist --project-name=daviesportfolios --branch=<ref>`). No npm build — `check.yml` already gates freshness. Secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are documented at the top of the file and skipped (warning, exit 0) until he adds them; token permission is Account → Cloudflare Pages → Edit. The dashboard Git integration is left as it is (watch paths `dist/*`, or disconnect later). Map, check.yml header and CLAUDE.md name the new workflow.

### [2026-09-27 19:55 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies' five asks of the evening: the variants renamed, the phone's "% of" lines gone, the Binance twins deleted, the paper rows at ten times their size, and faster gates.**
- Names (his word): RW-E is "Reward quotes variant-1" and x1–x3 "variant-2" to "-4", one line each; the rule a row changes is not on the site (`rweRow`, `RWX_NAMES`; reference §4 item 36 keeps the mapping). The phone's strategy cards lost their "% of cap" / "% of cost" lines (`FigLabel` takes a name only). Sweep: each name one line inside its row at both widths, and no "% of" on any strategy row or card (373 checks).
- Binance twins (his word: keep them only if they beat the Revolut X rows): measured on production, they decided nothing of their own (315/315, 132/135, 12/15 paired decisions; every difference a position held from before they existed) and filled no better (−1.0 bps a fill on four SOL pairs, a 10 bps fee against 9); a Binance row cannot be live. `0065` deletes them with their records (dry-run first: 7 probes, 7 orders, 465 decisions, 1,263 observations, 3 rows). VENUES then has no Binance card. The sweep's fixture keeps its Binance rows, so the page's second-venue path stays tested.
- ×10 (his word): `0066` puts `trend-4h` (paper) at $1,000 and `trend-1h` / `momentum-1d` at $400, scales their paper book from its first order (orders' sizes and fees, probes' sizes; `request` untouched), and moves the paper caps to $3,000 of exposure and a new `paper_daily_loss_limit_usd` of $50 — the paper books had shared the live row's $5, which at ten times the size would refuse their entries. `limitsFor` reads the paper number for paper books only; pinned in `tick.test.ts` with its counterfactual (the old shared limit fails it). The live row is not touched. Reference §4 item 40.
- Gates (his ask: every change ran every gate): `bin/gates.sh` now runs the gates the paths can break (src/dist every web gate; Edge the Deno checks and unit tests; migrations the unit tests; docs and Markdown the unit and Edge tests; anything else every gate), the independent checks at once and the browser sweep alone; `--full` as before. CI still runs everything. CLAUDE.md, the skill and its two Cursor copies, and the map say so.
- Cloudflare Pages: `ac006ca8` (pushed 19:00) was still not served at 19:31 (the site served `d9422f0e`'s bundle); Davies sees "Building" on every push for a long time. The fix is his to click (item 6).
- Two more of his: the Reward quotes pages no longer say "Its markets need $… today, more than its $1,000 cap…" (`rwOverCapText` and its tests removed; the days table's Costs column still shows what is at work), and a strategy page's orders table has Mode beside Venue (the sweep checks the heading order and the badge in the fourth cell).

### [2026-09-27 19:10 UTC] Platform: Claude Code | Model: not recorded (session policy)

**HARVEST phase 1 reported and is on `main`: after a public confirmation the late book pays pennies unless the confirmation is contested; nothing pre-registered.**
- The agent's seven commits, cherry-picked in order (`429ebc27` … `6618ee31`, each with `-x` naming its branch hash; the split commit keeps its 17:46 UTC author time, before any print pull). The coordinator re-ran `scripts/run_all.py` on the committed inputs: every result file's hash equals the committed one, the second run is byte-identical, and the five confirmation steps re-run offline reproduce every committed unit (the committed inputs hold the units whose event walks were complete, a subset of the re-run's). 21 MB, in line with fp6 and the Polymarket search.
- Result, map row and reference §3.42; item 5(g) closed; the recorder it suggests is under item 6; the PMLATE one-page defect is recorded under 5(g).
- The variants' replay started in production at 19:01 (`0064` applied, the job's list has `pmrw-x`, the state catching up from 09-25 at 720 minutes a run).

### [2026-09-27 19:00 UTC] Platform: Claude Code | Model: not recorded (session policy)

**RW-E's three variants run forward from their frozen pre-registration and are TESTING rows (`0064`).**
- `agents?action=pmrw-x` (`runPmrwX`, `agents/pmrw_x.ts`) replays RW's stored minutes every minute from RW's start into `pm_rw_x_state` / `pm_rw_x_days`, arms `rw`, `e`, `x1`–`x3` as frozen (`RWX_SPECS`, pinned). Two checks on every run: arm `rw` against `pm_rw_days`; arm `e` against RW-E's own `pm_rw_e_days`, over every day both have closed (RW-E's replay may close a day a minute later). `replayArms` and `armQuotes` are as the freezing commit left them but for the page's record of each paused span, which the accounts never read (the freezing commit's own pause test still pins them).
- The page: three rows after RW-E's, "Reward quotes (no weather)", "(pause on jumps)", "(no weather, pause on jumps)", each with RW's page read from its arm (`rwxArmSummaries`: its accounts and days; RW's fills less the market-days its rules leave out, the minutes it was paused and the markets it ran itself); counted in TESTING's scoreboard and the Polymarket card like RW and RW-E. Until 09-28 each equals RW-E.
- Evidence: `pmrw_e.test.ts` — x1's page equals RW's page of the engine run without its weather markets, x2 (no jump) equals RW-E's, x3 equals x1. Five counterfactuals on the page's filters each fail a test (three this one, two the round trip below). `pmrw_x.test.ts` — the driver's days and checks on a closed-form midnight (x1 drops the weather market at 00:00, x2 pauses at the 00:03 jump and not at the one before midnight), a planted 5 ¢ gap caught a run later, and a round trip RW made while x2 was paused kept off x2's page. The sweep carries the three rows (371 checks green).
- RW-E's version-2 replay caught up at 18:28: its 09-25 and 09-26 rows now equal RW's (+$148.09, +$219.72), check 0.
- Two headers of this session (now 18:20 and 18:05) had been written an hour and 45 minutes ahead of the clock; corrected to their commits' times.
- HARVEST phase 1 has reported (item 5g); it is integrated next.

### [2026-09-27 18:20 UTC] Platform: Claude Code | Model: not recorded (session policy)

**RW-E's three fixes measured on the days before its twelve; a deviation in RW-E's own replay found and fixed; a lapsed sign-in now returns to the login form.**
- The variants, run by `agents?action=pmrw-x-research` over 2026-09-25 00:00 → 09-27 00:00 (RW-E's rule applied throughout; the replay's `rw` arm reproduced RW's day rows to the cent). Total / stress: RW +$219.72 / −$28.53; RW-E +$200.66 / +$49.13; (a) cap 2N +$172.77 / +$44.10 and cap N +$102.62 / +$9.24 — worse on both, because RW's reward is the smaller side's score and a capped side earns nothing; (b) a pause after the adjusted mid moves 8–15 ¢ in a minute, for an hour, +$194 to +$206 / +$52.34 to +$66.69 (20 ¢: no effect, +$48.55; 3–5 ¢: +$139–142 / +$17–33, far too eager; a day's pause +$117.66 / +$22.42); (c) no weather markets +$196.77 / +$62.58; (b)+(c) with 15 ¢ +$205.66 / +$73.03. Two days: hypotheses to track, not evidence. (a) is dropped.
- **Deviation in RW-E, fixed**: its pre-registration removes nothing before 2026-09-27 00:00 so that it enters its twelve days holding what RW held; replay version 1 removed the same-day markets from 09-25, entering them without RW's positions in 09-26's same-day markets (which settle inside them and count in RW's figure). Replay version 2 (`RWE_STATE_VERSION`) applies the rule from 09-27 only and replays a version-1 state again from RW's start; pinned, failing on version 1. Reference §4 item 36 has it.
- Signed out (Davies: go back to the login page, not an error inside it): `auth.js` `signOut` / `onSignOut` / `noteAuthStatus`; App returns to the password form when the token lapses (a timer at its expiry, and a check whenever the page is shown or focused) and when the agents page or the board's data call answers 401 (a 403 is not a sign-out). A save refused by a 401 keeps its pending-save mirror and is replayed after the next sign-in. The token lasts 24 h (`auth`'s `TOKEN_TTL_MS`) and dies with the tab (sessionStorage). The app tests no longer reach the network: the Agents prefetch had been calling production with the tests' made-up tokens, and its 401 now signs the app out.

### [2026-09-27 18:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies asked for RW-E's three ways to cut its stress to be studied, and the ones worth it tracked as TESTING rows the way RW-E is: (a) a smaller inventory cap, (b) no quotes once a market is being decided, (c) which markets to pick. The research tool is built.**
- `agents/pmrw_x.ts`: RW-E's replay with any number of arms — RW-E's own rule, an inventory cap below RW's 3N (`stepRw`'s new `invCap`, RW's 3 by default, which RW and RW-E never pass), a pause after the adjusted mid jumps, categories left out. An arm with RW-E's rule reproduces RW-E account for account on the engine's own record (pinned in `pmrw_e.test.ts`). `agents?action=pmrw-x-research` (operator only) runs arms over RW's days before RW-E's twelve and never past 2026-09-27 00:00, so a variant is chosen on days RW-E's pre-registration already read and frozen before any minute it is judged on.
- (c) first read, RW's own per-market accounts at the 09-26 close, markets that do not end the day they are chosen: culture +$104.21 (stress +$25.80, 8 markets), politics +$76.03 (+$36.12, 4), economics +$16.53 (+$0.66, 1), weather +$3.88 (−$13.46, 2) — the temperature markets lose even when they end a day or more later.
- Davies on usage: a sub-agent's step costs about what the main session's does (24 h to 17:50 UTC: 391k cached input tokens a step against the main session's 453k); the spend came from how much ran — eleven sub-agents, 2,219 steps, often at once, against 1,283 main-session steps. His rule: do the work in the main session unless a task really suits a sub-agent (not a ban).

### [2026-09-27 17:40 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The one-minute job held (38 minutes, no split batch, the latest batch 0.68 s into its minute; the 17:00 hourly bar decided at 17:00:04), and Davies turned PMLATE's line back to what he asked for: harvesting after a result is confirmed. HARVEST phase 1 runs (item 5g).**
- Davies: the research drifted into competing with the market; the idea is to eat the orders liquidity providers leave once a result is essentially confirmed, temperature included. What the record says: for temperature that exact idea was measured (PMLATE phase 1: 89.5 % of the stale side's edge goes before aviationweather.gov has the report, and what is left late is mostly traps, $36,316 of late cost on 12 buckets that resolved against the reports against $8,271 of edge elsewhere); the source and speed work that followed chased the stale orders before they vanish, while WXSRC's weather models and VIEWS's trajectory rules were forecasting — the drift he saw.
- RW's other four same-day markets of 09-25/26 (besides eleven temperatures): UMich sentiment (a data release), "announcers say Fumble" (a mention), Trump's Truth Social posts in a week (a count), MrBeast's week-one views. **Read for the answer (disclosed for any later pre-registration of a narrower RW variant):** the public prints of the first three on 2026-09-25 (none of RW's own fills), RW's selections of 09-24 → 09-27, and RW's and RW-E's aggregate accounts (no market-by-market figure). What the prints showed: UMich's stale bids went within 3 s of the 14:00:00 UTC release; Fumble's within a minute; in the posts market, four hours after its window closed, about twenty wallets bought the losing NO at 0.005–0.007 against a resting YES bid at 0.993 — the late payer was a taker, the earner a patient maker.
- RW at 17:28 UTC: +$234.12, stress −$136.07 (today so far +$14.40, stress −$107.54; nine of today's fifteen markets end today). RW-E's arm: +$257.36, stress +$26.17 (today +$56.70, −$22.96). RW's selection now includes an earthquake-magnitude market, an MTV award, a home-value index and a temperature market whose day had already ended: all public-confirmation-before-resolution kinds, now in HARVEST's scope.

### [2026-09-27 16:35 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The view recorder's first deadline was read, and its last 20 s had gone to pg_net: nine cron jobs' calls ran in batches, and a call that missed the first batch waited up to 56 s. `0063` queues every call due in a minute from one job, in one statement.**
- The deadline (MrBeast Gaming's `PyLGTmWz37U`, counted at 16:00:04 UTC; reference §4 item 38): the API's counter moves in five-minute batches, landing 2 min 20 s – 2 min 45 s after each mark in three to five steps; the count at T, 15,912,406, was fixed at 15:58:16; the winning bucket (15–17.5M) was bid 0.999 with no ask from 15:21 at the latest. Decided forty minutes early, nothing left to take. 938 reads in the 18-minute window (87 %); two reads at 16:00 refused with a `myRating` error, not seen before or since; 2,024 units used by 16:05.
- The gap: 15:58:55 → 15:59:44. pg_net 0.20's worker (its `worker.c`, read at the tag) runs a batch until every request of it has answered before it reads the queue again, and the 15:59 view call committed just after the worker had taken `books` (~44 s). Over the 24 hours to 16:40 UTC the Edge logs show the tick starting more than 5 s late in 145 of 1,393 runs (the latest 56.8 s), the view recorder in 88 of 873, the board's snapshot in 23 of 279 (reference §4 item 39 has every call). The live row's decisions and protective checks ran up to a minute late in those minutes.
- `0063` replaces the nine jobs with `edge-calls-every-minute`, whose one statement queues every call due in its minute, each exactly as its old job sent it. Checked on production before the push, with nothing queued: the filter over seven sample minutes gives 9, 6, 9, 6, 8, 8 and 6 calls, the old schedules exactly; `explain` plans one scan with the vault read once; the unschedule list matches the nine jobs by name. `src/cron_jobs.test.js` replays every migration's cron calls: it fails on the tree without `0063` (nine jobs) and on a changed call (the overnight recorder's hours widened), and passes with it.
- CLAUDE.md: a new recurring Edge call is a row of that job's list, never a job of its own; a call fired by hand through pg_net holds the next minute's batch for as long as it runs past the minute. Item 2e now edits that list.
- **Applied and read back** (`migrations.yml` run 87, green, 16:39 UTC): `edge-calls-every-minute` is the one job that calls pg_net, and the nine are gone. It queued 8 calls at 16:40 and 6 at 16:41 and 16:42, and every minute's responses in `net._http_response` share one batch start (its `created` is the worker's batch transaction): none of the first four minutes (16:40–16:43) was split and every batch began within 0.44 s of its minute, against 143 split minutes of 357 in the six hours before (a second batch starting as late as 56.7 s). The tick, PR5's quotes, the books, the view recorder, RW and the board's snapshot all wrote in the job's first minutes; no `ops_errors` since 16:00. The first hourly bar under it is 17:00: its decisions are the next thing to read, and reference §4 item 39's query (split minutes over pg_net's six hours) should stay empty.

### [2026-09-27 06:40 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The first run of the weather probe (04:50–04:51 UTC, through pg_net with the Vault `cron_secret`) found one wrong credential and one bug of ours.**
- **Météo-France: the stored `METEO_FRANCE_API_KEY` is an OAuth2 access token, not an API key.** Its claims: issued 04:07:46, expiring 04:13:51 UTC (365 s), key type PRODUCTION, subscribed to `DonneesPubliquesObservation` at `/public/DPObs/v2`, tier `100ReqPerMin`. Read at 04:50 it had been dead 37 minutes: all four requests (v1 and v2, `apikey` and `Bearer`) came back 401 `900901 Invalid Credentials`. Davies (06:30): the portal username is `daviesluo`; the API never reads it. What works for good is either an **API Key** generated on the portal's "Générer Token" page with a long validity, stored as `METEO_FRANCE_API_KEY`, or the page's OAuth2 **application ID** (the Basic credential in its cURL command), stored as `METEO_FRANCE_APPLICATION_ID`, from which the probe now mints its own token. An expired token is now reported and asks nothing; the key's own version (v2) is asked first.
- **FAA: every name read right, TLS reached, the SMF login refused with `400 Header Parse Error`.** The fourteen names: `CONNECTION_FACTORY`, `CONNECTION_PASSWORD`, `CONNECTION_USERNAME` (19 characters, no `@`), `EMAIL`, `FILTERS`, `HOST` (17, `…faa.gov`), `JMS_CONNECTION_URL` (port 55443), `MESSAGE_VPN` (4), `PORT` (55443), `PRODUCT` (4), `PROTOCOL` (4), `QUEUE_NAME` (65, six dotted segments, names the VPN), `SERVICES`, `SUBSCRIPTION_ID` (36). TLS handshake 393 ms from the Edge. The refusal was ours: solclientjs writes each SMF frame as a binary string with `write(frame, "ascii")`, which Node sends one byte a character, and the Deno shim encoded it as UTF-8, doubling every byte above 0x7F. Fixed (`stringBytes`), pinned by a test that fails on the old write. Also: the tool stored `PROTOCOL` and `PRODUCT` as secrets, and scrubbing them took the URL's scheme and every product name out of the report; values from a closed public vocabulary (ports, protocol names, SCDS's products) are no longer scrubbed, pinned on the fourteen names as stored.
- **The second FAA run (06:38 UTC, after the fix) went through**: TLS 391 ms, SMF session up in 637 ms, the queue bound in 484 ms, twenty messages in under a second, left unacknowledged. Every one was ITWS's own `itws_msg` XML (products 9833/9834/9838/9839/9847/9848/9850/9858/9893/9894/9912; sites MIA, T75, MSY, D01, TUL); none carries a temperature. The oldest was sent 8 s before the bind: the queue holds seconds, not hours, so a reader must stay connected or lose what arrives while it is away. The report now groups messages by product with ITWS's own product name, reads up to 200, and keeps SCDS's service names (`Alert`, `Standard`) readable where the stored settings had scrubbed them.
- **SCDS has no METAR to offer yet** (Davies' assistant, logged in to the SWIFT Portal; reported 14:40 UTC): the New Subscription list is STDDS, ITWS, TFMS, TBFM, SFDPS, NOTAM Distribution and TFDM, and the portal's news expects CSS-Wx in Q4 2026. No other subscription was opened and ITWS was left as it is. The FAA leg waits for CSS-Wx (item 6).
- **The third FAA run (06:48 UTC) settles it: ITWS carries no temperature.** 200 messages from 25 terminal areas, sixteen products, every one ITWS's hazard output (microburst, gust front, tornado, configured alerts, AP status and indicated precipitation, precipitation 5nm/TRACON, hazard text, microburst and wind-shear ATIS, storm motion/extrapolated position); median 5.1 s old on arrival. Reference §6 "The weather feeds" has the table. The METAR on SWIM is CSS-Wx's product; whether the SWIFT Portal offers it to this account is Davies' look at its product list. No recorder is built: the one feed that works carries nothing a temperature market reads, and the other has no working credential.

### [2026-09-27 04:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies' first two keyed weather feeds exist (item 6): Météo-France's DPObs key and an FAA SWIM SCDS subscription, stored by another tool; a probe of both is built, not yet run.**
- What was stored (his message, 2026-09-27): `METEO_FRANCE_API_KEY`, `METEO_FRANCE_USERNAME` (the portal's `DonneesPubliquesObservation` API), and fourteen `FAA_SWIM_*` (host, VPN, queue, the connection's username and password among them) for an approved SCDS subscription to **ITWS, "Alerts + Standard", every available station**. KMA's API Hub was not opened: it needs a Korean phone number's SMS. Nothing has read either key yet.
- **ITWS is probably not the feed WXSRC priced.** SCDS's User Guide (v1.0, 2019) lists six products, STDDS, ITWS, TFMS, TBFM, FDPS and AIM FNS, each its own message VPN; ITWS is the terminal weather system's products (wind shear and microburst alerts, gust fronts, precipitation, storm motion), not surface observations. The FAA's METAR/SPECI publisher is CSS-Wx, which the FAA said in 2024 "will be made available to Non-NAS Consumers via ... SCDS" (FPAW 2024, Kratky). The probe reads real messages to settle what this subscription carries; if nothing in it is a temperature, the FAA leg waits for a CSS-Wx (or other METAR) product in the SWIFT Portal, Davies' step.
- **A new Edge Function, `weather`**, cron bearer only: `?action=probe&only=meteofrance,faa`. `meteofrance.ts` finds which version and header the gateway takes, Le Bourget's station id, its newest 6-minute reading and the service's insert delay on the last ten steps (≤ 20 of the 50 requests a minute). `faa_swim.ts` reports every `FAA_SWIM_*` name, the role it reads each as and each value's form, then a TLS handshake, an SMF login, a bind to the queue and up to twenty messages summarised and left UNACKNOWLEDGED (redelivered to the next consumer). A function of its own because the FAA's feed needs Solace's npm client in a session, which stays out of the live loop's isolate.
- **Deno 1.x cannot run Solace's client as shipped**: solclientjs wraps a still-connecting `net.Socket` with `tls.connect({ socket })`, and Deno 1.46.3's node compat throws an uncaught TypeError in its read loop, with or without a server (measured). `solace_tls.ts` hands the client a stream on `Deno.connectTls` instead; against a local TLS server the client's SMF login arrived intact (333 and 361 bytes, the credentials base64 inside TLS) and its connect timeout fired cleanly.
- 27 tests (`weather/*.test.ts`): the key only in a header and every request a GET; the gateway's header found; a gateway or broker that echoes every credential gets none into the report; the portal's own login never read as the connection's; plaintext SMF refused; connect, consume and close the only calls (no acknowledge, no publish); gzip XML opened; the shim's stream and patch.
- Next: deploy, fire the probe through pg_net with the Vault `cron_secret`, write what each key said into reference §6, then either a day's recorder (DPObs at 2 s beside `tgftp`'s LFPB file) or the FAA product question to Davies.

### [2026-09-27 03:20 UTC] Platform: Claude Code | Model: not recorded (session policy)

**WXSRC phase 1 (item 5e; a research agent on its own branch, not pushed): the race for the report is already run, the models are already in the price, and nothing is left to pre-register.**
- Per city (`reviews/2026-09-27-wxsrc-study.md` §A4, `backtests/wxsrc/results/source_table.json`, all 51 open cities): at 48 of 49 METAR stations the first stale-side taker acts before `tgftp`, the fastest keyless source, has the deciding report (a median 55 s after the observation; US takers 3–10 s at the p10, the ASOS one-minute value). In September $49,420.53 of the stale side's edge went before a 1 s keyless taker could act, $12,128.59 after. Hong Kong ($4.05 M traded, left out by PMLATE): 82 % of first stale prints come before the ten-minute slot holding the deciding minute has ended; the Observatory's CSV is public a median 511 s after it; a 1 s taker there made +$20.67 in 24 days. Toronto's SWOB-ML is the one keyless feed sometimes level with the takers (written 50–363 s after the observation, median 82 s).
- Models: Google's WeatherNext 3 (2026-09-03; hourly runs, 0.05° station head, 64 members, allowlist, free licence, 2026 archive) reaches users 7 h 10 min – 8 h 10 min after its initial time. HRRR's fresh run plus the day's reports, flattered in-sample, still loses to the price intraday (Brier 0.114 / 0.078 against 0.089 / 0.057). Every month with markets up to 2026-09-10 is seen (fp4's WX), so a model test records forward.
- FASTSRC (the six stations where a keyless source arrives with the takers) was drafted and withdrawn before any freeze: with `tgftp`'s measured lead outside the US (1.4 s, not the US 7.7 s) and USLATE-FAST's 3 s print margin, September gives −$122.63 on 43 buckets (z −0.91 over 56 days). What would pay is a keyed source as fast as the takers (September bounds at 15–60 s: US $77–104 a day, Paris $11, Seoul and Busan $4–8): FAA SWIM SCDS, Météo-France DPObs and KMA's API Hub each need Davies' free sign-up, then a day's measurement of whether the feed carries the report's reading and how fast, then a pre-registration. Nothing placed, no key used, nothing built; the live poll (02:00–03:08 UTC) is stopped.

### [2026-09-27 03:02 UTC] Platform: Claude Code | Model: not recorded (session policy)

**VIEWS phase 1 (what-remains item 5f on `main`; a research agent on its own branch `worktree-agent-ada7daf3e11ed5a5f`, not pushed): Polymarket's YouTube view-count markets on history. Not promising as money; no pre-registration.**
- Write-up `reviews/2026-09-27-views-phase1.md`; scripts, committed inputs and results in `backtests/views/` (`scripts/run_all.py` re-runs every analysis from the committed files, twice, byte-identical; raw pulls stay out of git, hashed in `MANIFEST.json`). Keyless reads only: Gamma, the data API, the CLOB's `/prices-history`, comments; no key, nothing placed, YouTube not read.
- Universe: 353 closed tag-146 events, 202 of them view counts ($113.0M, MrBeast 164 events / $99.3M). Split decided from Gamma's metadata before any print was read: exploration = 125 events with deadlines before 2026-06-01; held out = 77 (2026-06-01 → 09-26), no price or print of theirs requested. Every T is estimated: MrBeast posts at 12:00 ET (28 day-1 markets: 8.3 prints a minute before, 283 and 541 in the first two minutes after), P = 12:00:10 ET, 92 deadlines high confidence.
- Near T (92 deadlines): the winner's midpoint median 0.9625 at T − 6 h and 0.9985 at T − 1 h; the favourite wins 88 % / 97 % / 100 % at T − 6 h / − 1 h / − 15 min; calibrated at every horizon. Close calls (winner < 0.95 at T − 15 min): 8 of 92.
- After T: $3,271.40 of stale-side edge on 10 deadlines in 547 days; PMLATE's fill at T + 1 s makes +$253.59, 66.5 % on one contested date. Resolution risk is real: freezes, "sync" jumps, bots (organised in close calls), rules naming the wrong video or window, 7 early-proposal disputes on lowest brackets.
- Power: the held-out months would give ~7 deadlines with a fill against the fp5 bar's 25 dates; a forward last-batch taker needs 15–31 weeks (0.39 close calls a week), a trajectory rule 16–35 weeks at a plausible edge. Markets are 9× thinner per event now ($104k against $935k).
- Recommended: run the recorder 4–6 weeks as measurement, with 1 s reads from T − 6 min to T + 6 min, freeze flags, Gamma's resolution record after T and `liveStreamingDetails`. For the coordinator: `videos.list` on 25 named ids and the channels' uploads playlists would make every T exact (`results/publish_times_needed.json`).

### [2026-09-27 02:27 UTC] Platform: Claude Code | Model: not recorded (session policy)

**SPEED is on `main` (a research agent's commit, with this ledger line it did not carry): the source binds, not the loop.**
- Edge left after the event (September): US temperature 98 % at +5 s, 79 % at +60 s, 16 % when `tgftp` (the fastest keyless source) publishes; Elon's post counts 1 % after 30 s. The informed takers print ~64 s (US) and 48 s (non-US) after the observation, before any keyless source (`tgftp` 159 s / 250 s; AWC 182 s; `api.weather.gov` ~20 min).
- Architectures: a 1 s pg_cron job reaches ~1 s but writes 86,400 cron rows a day; one Edge call a minute looping each second reaches 0.68 s at no new cost; a Cloudflare Durable Object 0.6 s for $5.75 a month and a deployment. Decision per the study: keep the one-minute loop, deploy nothing. Reference §3.39.
- USLATE-FAST (USLATE at `tgftp`'s publication + 0.25 s, a 28-day forward test, must beat USLATE on the same days) is frozen by this commit and needs a 1 s `tgftp` recorder on Davies' word; expected $7–13 a day before traps. The coordinator reproduced four of the study's result files byte for byte.

### [2026-09-27 02:01 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies: how many markets does the view recorder record, should it add or change anything, for how long, and is it promising?**
- 22 markets in 4 events: MrBeast Gaming's day-1 (7 brackets) and week-1 (8), and MrBeast's month-end channel totals (views 3, subscribers 4). Two videos are read every minute: Gaming's `PyLGTmWz37U` and MrBeast's `v9QtM6qnG50`, named by the markets. The next MrBeast video's markets join by themselves (discovery every fifth minute).
- **The Data API's view count moves every ~5 minutes, each video on its own phase** (first 24 minutes, 01:34–01:58 UTC): `PyLGTmWz37U` at ~:38/:43/:48/:53/:58, +22k to +57k a batch; `v9QtM6qnG50` at ~:36/:41/:46/:51/:56. Likes and comments move between batches, so the change-only log keeps a row a minute. A market's final count is fixed by the last batch before its deadline, up to five minutes early.
- Not promising or unpromising yet: 24 minutes of record. A research agent's VIEWS phase 1 (item 5f) asks the question on history first. Once today's 16:00 window confirms the batch phase to the second, the plan is to spend the window quota as 1 s reads ±15 s around each predicted batch in the hours before a deadline, not 18 straight minutes.

### [2026-09-27 01:37 UTC] Platform: Claude Code | Model: not recorded (session policy)

**fp6 phase 2 (what-remains item 5a; a research agent on its own branch `worktree-agent-a55f5ae55a28323ec`, not pushed): the five frozen hypotheses, run exactly as frozen — none passes.**
- Study: `reviews/2026-09-27-fp6-study.md`; scorers and results in `backtests/fp6/` (`phase2_run.py` checks every input against `manifest.json`, the tapes and the frozen files, runs each scorer twice byte-identical, then Holm; sha256s in `phase2_runs.json`). H4's scorer first reproduced the incumbent (`btc_regime.json`, 16 cells) and `runGated`'s marks bar for bar (64 coin cells).
- H2 ETH quarterly carry 5.67 %/yr on its capital (last year 1.16 %; SOFR 4.57 %), p 0.810. H3 altcoin funding carry 2.58 %/yr (second half −0.56 %), p 0.9995; its coin choice beats random (p 0.0005), the carry is still below cash. H4 the live rule with a short leg on perpetuals makes window D worse in all four evaluations (primary −7.81 → −12.42 %), p 0.961: a short leg whipsaws the sideways year. H5 delist short +$265.80 on 67 events, p 0.0005, fails only the month rule (April 2026 = 46.6 % of the P&L). H6 new-perpetual short +$1,736.25 on 515, p 0.0005, fails the first half (−$357.64) and the month rule (January 2025 = 54.9 %).
- Holm over the five: H5 and H6 clear, the ladder stops at H2 (0.810 > 0.0167). No pass: fp6 closes with nothing to paper-trade.
- Speed at 1 s (Davies' standing rule; descriptive arms added after the freeze, no bar): H2, H3 and H4 act on settlements and closes, speed changes nothing. Entering 1 s after the event at the first aggTrade: H5 +$1,142.00 against the frozen +$265.80 (the first print sits a median 23 % above the next day's open); H6 −$3,176.14 against +$1,736.25 (215 stops, 67 of them on the listing day). The H5 arm is post hoc: a rule on it needs its own pre-registration, and its first-seconds fills assume a 3.56 bp book.
- Access unchanged: every hypothesis has a derivative leg; whether this account may run one is Davies' and Binance's call, not the study's.
- Big inputs stay out of git (sha256 in `manifest.json`); the 1 s arms streamed 577 aggTrades zips (5.5 GB, each checked against its published sha256, none stored) into `inputs/speed_1s.json.gz` (3 MB).

### [2026-09-27 01:37 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The view recorder is live, PMLATE is on `main`, and WXSRC is started.**
- `0062` applied at the push (`supabase_migrations` has it; `agents-views-every-minute` scheduled), and the function deployed at 01:33:18 UTC. The 01:33 call reached the old function (404 "unknown action", before the deploy). The 01:34 run: 4 view events, 22 markets, 2 channels, 10 uploads, 2 deadlines (MrBeast Gaming's day-1 at 2026-09-27 16:00:04 and week-1 at 10-03 16:00:04 UTC), 6 units, no error; 01:35 (a fifth minute) 4 units, the channels' totals, no error. A self check-in at 16:08 UTC today reads the first deadline's window.
- PMLATE's two commits came onto `main` rebased on the recorder, with reference §3.37 added. The coordinator re-ran the frozen script on the committed input on `main`: the result is byte-identical (`1aec3e0f…`).
- Davies asked to keep researching the data source and weather models (item 5e); a research agent started WXSRC's phase 1.

### [2026-09-27 01:18 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The view-count recorder (what-remains item 5d), on the key the probe verified: `0062`, `agents/views.ts`, `agents?action=views` every minute.**
- Records what nobody can pull later: each tracked video's counter (uploads of the last eight days and every video a market names), the channels' totals (every fifth minute), and the YES book of every open view market (a NO book is its mirror, checked on a live market). Markets come from Gamma's YouTube tag (146) every fifth minute, with what each event's rules name: the handle, the video when named, the hours counted ("first 24 hours", "first 7 days"); a "next video" market counts the channel's first upload after its creation that is not a Short.
- Around each deadline (posting time + hours counted) it reads that video and its markets' books every second, 15 minutes before to 3 after, every 10 s in the hour before; a run reads until 56 s into its minute. Change-only rows (`ts`, `seen_until`, `reads`), so each API batch is placed to a second. Quota ~2,300 units a day plus ~1,350 a deadline; windows stop reading YouTube past 9,000 in the Pacific day, everything past 9,800. Nothing is pruned: a study, pre-registered first, reads it after 4–6 weeks.
- First deadline it can catch: MrBeast Gaming's day-1 market, 2026-09-27 16:00:04 UTC (the video was posted 09-26 16:00:04). Pinned in `views.test.ts` (14 cases: the rules' parsing, the video a market counts, the windows, change-only rows across runs, a whole hot minute against fakes of Gamma, the CLOB and the Data API, the budgets, the lease, no key; the open rows read page by page, which a single 1,000-row read failed for thirty tokens; and a run that starts late still stops 56 s into its minute). The strict double knows the seven new tables.

### [2026-09-27 01:17 UTC] Platform: Claude Code | Model: not recorded (session policy)

**USLATE phase 2, finished after the session limit (the coordinator: price speed at 1 s, Davies' standing rule, as descriptive arms; the primary, the bar and the verdict stay as frozen).**
- At a 1 s loop (the station's p90 AWC delay + 2 s) the frozen rule makes +$735.24, $19.51 more than at + 90 s, and 2026-05-06 is still 56.1 % of it: the loop does not bind. At ten of the twelve stations the rule makes +$65 frozen, +$85 at 1 s and +$142 at the median delay + 2 s, against +$15,138 for a source with no delay (a bound, not a rule). By the time AWC has a typical report, the stale side is gone.
- The median-delay arm's +$2,681.79 is nearly all KBKF (p90 3,600 s) and KLGA (p90 436 s), whose AWC delivery has long tails. In September at US stations the first cut came a median 60 s after the observation, 163 s before AWC had the report. The source binds. If the idea is ever reopened, the first question is which keyless feed delivers a US report first, priced at 1 s (study's "Speed at one second"; `scripts/uslate_speed.py`, `results/uslate_speed_*.json`, each byte-identical twice).
- Non-US report (the pre-registered arm 5, not a test): +$1.11 on 1,404 buckets over 170 dates, because 83 verdict failures cost −$7,895.63; the US-only split held. Its 7.1 MB input stays out of git (sha256 `3089f3e7…`, in `MANIFEST.json`).

### [2026-09-26 23:04 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies: "YOUTUBE_API_KEY 加好了"; and every speed assumption in a study is one second (pg_cron 1.6.4 runs jobs every 1–59 s), an always-on Cloudflare Worker below that.**
- The probe gains a `youtube` part (`agents/youtube.ts`, `?action=probe&only=youtube`): the key rides in the `X-Goog-Api-Key` header, never in a URL; MrBeast and MrBeast Gaming looked up by handle (MrBeast's checked against its known channel id), their three newest uploads, one batch of their statistics, and the newest upload's counter read seven times 5 s apart — does the API's number move between reads seconds apart? Twelve units of the 10,000 a day. Pinned in `youtube.test.ts`: GETs to the three listed reads only, the key in the header and in no URL, no ten characters of it in the report even from a server that echoes it back, nothing sent without it. It is fired after the deploy; its answer goes to reference §6 and here.
- **The probe's answer (01:02 UTC 09-27, reference §6):** the key works from the functions' egress, in the header, on all three reads; `@MrBeast` resolves to its known id and `@MrBeastGaming` to `UCIPPMRA040LQr5QPyJEbmXA`; subscriber counts come rounded to three significant figures, channel view counts exact. **The view counter did not move in 30 s** on a nine-hour-old video gaining ~13,000 views a minute (seven reads 5 s apart, the same 6,987,687 each time, while the item's etag changed three times): the API publishes views in batches, and the recorder's first job is to measure how far apart.
- The one-second rule is in CLAUDE.md and the skill (all three copies). YouTube's own quota binds before it: 10,000 units a day is one read every 8.6 s on average, so a recorder reads every second only around a market's deadline (what-remains item 5d).

### [2026-09-26 22:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**USLATE phase 2 (the PMLATE research agent, on the coordinator's word): run the frozen test on 2026-03 → 08.**
- The test input is built by the frozen command and committed before the test runs: `backtests/pmlate/inputs/uslate_2026-03_2026-08.json.gz` (sha256 `98ecd9a2…`, rebuilt byte-identical, in `MANIFEST.json`) — 2,256 US market-days, every print walk complete (5,049 pages), every station's reports present, 12,711 buckets the reports decided. Nothing of it has been scored.
- One deviation, named in the study: four US events (NYC's and Miami's lows of 05-22 and 05-23) were archived by Polymarket four days early and never resolved (every market `closed: false`, no payout, $5–$60 traded). The pre-registration's universe is resolved events; the frozen input script reads only the event's `closed` flag, and the frozen test would stop at `1.0 - None` on them. `scripts/uslate_events.py`, which lists the events the print pull walks, leaves them out, so the input script counts them under `no_prints_file`.
- **USLATE fails, condition 6 of 7, and PMLATE is closed** (`reviews/2026-09-26-pmlate-uslate-study.md`, `backtests/pmlate/results/uslate_2026-03_2026-08.json`, sha256 `1aec3e0f…`, two runs byte-identical). +$715.73 on 611 fills (131 buckets, 55 dates, a $949 peak), both halves positive, above its null's p95 ($240.57), stress +$652.98, date-bootstrap p5 +$9.53; but 2026-05-06 is 57.6 % of it, against a 40 % limit. That date is one bucket: NYC's low, where a 23:48 special report gave whole degrees only, 14°C, which is 57°F (the routine report three minutes later read 14.4°C, 58°F). The market resolved on the special, and the dead 58–59°F bucket's YES traded at 93–94¢ for almost seven minutes after the loop could act. The three buckets where the reports and the source disagreed each lost the $100 cap (−$301.89).
- Determinism: twenty fills (seed 20260926) all match prints in a fresh cache-busted pull, and every one of the 131 filled markets' payouts agrees with Gamma.

### [2026-09-26 22:16 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies: turn RW's same-day loss round — be the informed taker once the day's result is known (PMLATE, a research agent's phase 1, on its own branch; nothing placed, public data only).**
- The mechanism is real and faster than a one-minute loop. September's temperature markets (2,537 market-days): where a report decided a bucket the market still priced, the first cut came a median 273 s before aviationweather.gov received the report; 97.9 % of those came before a loop acting two minutes after it, and 8.2 % of the stale side's edge was left later. Post counts: on Elon's markets 97–99 % of the stale side's edge goes within 60 s of the post; the seven smaller series leave ~$1k a year after the tracker's capture. View counts have no keyless history.
- What is left late is mostly resolution risk: 12 September buckets the reports had decided resolved the other way (9 on 09-20) and carried $36k of the late stale-side cost against $8k of edge elsewhere; over 12,874 market-days the reports missed the winning bucket on 1.8 %, in clusters (05-17 → 05-21, 09-20). The post tracker's count at the close missed the result on 24 of 380 windows, always low (19 of them Trump's).
- One hypothesis survives and is pre-registered, not yet frozen on `main`: USLATE (`reviews/2026-09-26-pmlate-prereg-uslate.md`), US stations only, 2026-03 → 08, $100 a bucket; its power check says a pass is unlikely and small (~$2.7k a year at September's rate). Scripts, phase 1's results and the pull manifest: `backtests/pmlate/`. Next: the coordinator reviews, freezes, and phase 2 pulls the test period's prints and runs it.
- The container's disk was full (0 bytes free on `/`, the shared scratchpad ~21 GB, mostly older studies' folders); this study's pulls are gzipped (~70 MB).
- fp6's phase 1 (the fourth Binance search, a research agent's branch) came in unchanged and is frozen on `main` by `d856fd2e`: five hypotheses with a derivative leg each, H1 withdrawn on arithmetic, the access findings stated before any result (what-remains item 5a). Phase 2 runs the five as frozen.
- Reviewed and frozen on `main` by `ad6ec6e3`, the commit that adds the pre-registration (its disclosures stand: the test period's winning buckets were read for the basis check, none of its prices or prints; the US-only split was chosen on September). Phase 2 runs it as frozen. The disk: the coordinator deleted closed studies' raw pulls from the scratchpad (the 3-year Kraken bundle, DRAW-X's and the CV check's, Bitget's year of prints), 9.4 GB free.
- The fifteen same-day market-days behind RW's stress loss, read from RW's engine state at ~21:30 UTC: eleven temperatures −$31.69 of stress; the other four −$45.97 — Trump's Truth Social post count −$26.29 and MrBeast's week-one views −$25.43 (the same mechanism: a public counter the takers watch), UMich sentiment +$5.31 (RW stopped quoting at its end date, before the release) and a broadcast word, "Fumble", +$0.44. PMLATE took in the counters; releases and broadcast words were left out, each with its reason.

### [2026-09-26 20:15 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies (two screenshots, Saturday ~20:50 BST): why the 24H futures chart says OPEN at 20:50 and why the S&P one has a line at 20:55; is "no stablecoin book left in the UK" true; would Binance or Bitget do; why the live row keeps Jev's gate.**
- The 24H chart put "OPEN" on the first point of any window that began after the regular open: on Saturday the trailing 24 hours of futures hold Friday 20:50–21:55 BST only, and the open (14:30 BST) was outside. The perf chart had its own copy of the ticker modal's open scan; both now call `findRegularOpenIdx`, which also requires the bar before the open bar to be earlier than the open (or the first bar to be stamped at it), so a window that starts after the open draws no OPEN, and neither does the futures' Sunday reopen. Pinned in `chart_geometry.test.js` (the old scan returns 0 where −1 is right) and by the sweep's new `markers/24H-ext`, whose fixture session starts at 14:00 UTC with nothing before it: run against the old bundle it FAILS ("OPEN" drawn), against the new it passes. The 20:55 line on the S&P chart is the time axis's gridline under its one label: of that window the cash index traded only Friday 20:50–21:00 BST, three points. Not changed. `docs/guide.md` says what the markers mean and what a weekend 24H holds.
- "No stablecoin book left in the UK" is true: Revolut X's public pair list (455 pairs, both regions, read 2026-09-26) has no stablecoin base but USDC and USDT, and no USDT/USDC book (its USDC-quoted books are all coins); the UK side has USDC/GBP, USDT/GBP, USDC/USD and USDT/USD. The gold tokens PAXG and XAUT were closed in §3.29.
- Binance was already answered: §3.29's ZF, PR5's mechanism on Binance's zero-fee stablecoin books, fails (pooled +$88.74, 2.6 %/yr, stress −$51.03; EURI's books lost $439), and its zero-fee USD fiat books exclude UK residents. Bitget: a read-only feasibility study is running in this session (access for a UK and Irish resident, fees, its stablecoin books' spreads from the public API); nothing registered, nothing committed.
- Jev on the live row stays on: since v2 (`0047`) `trend-4h-live` has had one entry signal (SOL, the 09-25 08:00 bar), P = 0.58, entered; the gate has vetoed nothing. On trend-4h the v2 gate passed its bar (§4.21: worst window unchanged), and the paper control carries the same gate.

**Davies, next: take RW-E's section off the pages, name it "Reward quotes (no same-day)" and run it every minute; drop "· venue" from every strategy name and tag each strategy page with its venue beside PAPER.**
- RW-E's row is "Reward quotes (no same-day)", the bracket on a line of its own, and its replay runs every minute from `0060` (Davies: "every min"; a run replays only what RW decided since the last, under the `pmrw-e` lease). The RW-E section is gone from RW's page and from RW-E's; RW-E's page keeps one line, shown only when the replay's copy of RW stops equalling RW's closed days (`rweCheckWarn`). `RWE_STALE_MINUTES` is RW's five plus three (it was 15 for the five-minute cadence). The sweep reads the two-line name, "every minute", and both pages without the section.
- No strategy's name says its venue from `0061` ("Trend 4h", "Trend 1h", "Momentum 30d" on Revolut X and on Binance; the live row "Trend 4h · live", shown without " · live"); the migration fails if any name still carries one. Every strategy and test page's head reads PAPER or LIVE, then the venue's tag in its colours (`VenueBadge`). The sweep finds each row by name AND venue and checks the tag on the four pages it opens; `.claude/CLAUDE.md` quotes the live row's new name.
- Davies, then: Binance still has no strategy of its own — another research agent, please; and his Binance account DOES support futures. What the record says is narrower: the API key's futures permission is off (reference §4 table, 2026-09-23), a setting on the key. A fourth Binance-first search (fp6) is running, and a Bitget feasibility study beside it: what-remains item 5.
- Davies, then: turn RW's same-day loss into a strategy of its own — be the informed taker once a temperature market's result is known. A research agent runs its phase 1 (what-remains item 5b); nothing is committed until its preregs are reviewed and frozen here.
- Bitget reported: **don't register** (`venue-survey.md` §12; scripts `scripts/bitget/`, results and sources `backtests/bitget/`). Its terms do not bar the UK or Ireland, but its UK route is s21 promotions approved by Archax with no FCA registration, and an Irish resident has no lawful route (no Bitget entity on ESMA's CASP register; its MiCAR application is pending). It has no GBP book; its EUR books are a tick wide (1.1–1.2 bps between a buy and a sell print within 60 s, every month for a year) at 10 bps a side, and its free USD books are the 1–3 bps family that already failed. It lost $387.5M from its hot wallets on 2026-09-24.
- Davies, then: both Reward quotes rows get a $1,000 cap, as every other strategy has one. The dashboard's RW and RW-E summaries carry `fundedUsd` (`RW_FUNDED_USD`, `pmrw_view.ts`), and `rwRow` takes its cap, FUNDED and the base of today's and realised's percents from it; what the markets have at work stays in the days table (the spec's capital: $165–$798 a day so far, the $798 RW's open 26 Sep; the commit message's "$165-$529" counted closed days only), and the frozen rule and the verdict's capital are untouched. The rule does not read the cap, so RW's page warns on a day its markets need more than $1,000 (`rwOverCapText`, pinned): a $1,000 account could not have placed every quote on such a day. TESTING's funded is $3,560 in the sweep's fixture and the Polymarket card's $2,000, each figure worked out by hand in the sweep; the three unit pins fail on the old row.

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
