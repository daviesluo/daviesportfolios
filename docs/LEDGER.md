# Ledger

The live handover record for this repository, under the ledger protocol
in `.agents/skills/ledger/SKILL.md`. Read this file first on any resume; it is kept
small on purpose. The deep record — the full decision log and the raw
session transcripts — is `docs/handover.md`, which is this ledger's ARCHIVE
and is opened only when a closed item is reopened or audited. The commit hook refuses it over 80 KiB
(`bin/hooks/pre-commit`, gate 3): before that, move closed history sections into the archive.

## What remains right now

Rewritten on 2026-10-08 to a paragraph per open item (review F15, approved by Davies). Item numbers are unchanged: the
scheduled wakes quote them. Each item's full record (what was checked and when, the figures, every deviation and
addendum) is the list as it stood before this rewrite, word for word in `docs/handover.md` Part 2 under "LEDGER.md,
archived 2026-10-08", with every history section from 2026-09-30 to 2026-10-08 16:52 UTC; open it before acting on an
item whose paragraph points there. Paths under `reviews/`, `backtests/` and `scripts/` are in `docs/agents/`. The app's
own plan is `docs/improvement-plan.md` (item 7).

Standing rules for every item: only Davies arms anything live, in the conversation where he says go; never trade by
hand in the loop's Revolut X account or in PR5's sub-account (key `_2`); Polymarket opens a position only from
`eu-west-1` under his Ireland attestation (standing since 2026-10-01, current until he says it changed; nobody asks
him); a frozen rule changes only as a recorded deviation (spec, reference, ledger) with a pin that fails on the old code;
a pre-registered reading runs as its pre-registration says (script, bar, date) and, since 2026-10-04, says it was not
blind (there is no no-peek rule; `docs/agents/CLAUDE.md`).

0a. **LIVE-PREP STOPPED: its −$75 total stop tripped 2026-10-12 07:30 UTC, and stays tripped (Davies, 10-12 ~23:00 UTC:
   "保持止损").** Close-only since: no buy rests, its sells do; nobody clears the stop (`pm_lp_events` `loss_stop_total`).
   Three studies run (history 2026-10-12 23:05): the live fills' adverse selection and a deep optimisation, Davies'
   reward-timing hypothesis with a 1-second speed study, and Coinbase's first days. Their proposals go to Davies; a rule
   change is an addendum on his word, and a restart is his call alone. The 10-16 end-rule read still runs as written.
   **Results (landed, history 2026-10-13 23:47):** LP-ADVERSE (`reviews/2026-10-12-lp-adverse-selection.md`): the fills lost
   to one-shot takers (adverse −$305 in the first hour against +$101 of half-spread); live realised a fraction of the formula
   because carried stock held the cap; no priced package clears $0 with confidence; it recommends staying stopped, and P1
   (no quote after a 10 c hour, touch ≥ 3 c) if Davies wants it back. LP-SPEED (`reviews/2026-10-12-lp-reward-timing-speed.md`):
   programmes do change fast, but no fill came while a programme was out, paper's fills were as adverse, and a 1–30 s loop is
   worth +$0.3 to +$2.0 a day (the CLOB reward read is cached 5 s); change no cadence. Davies chooses.
   LP-BEST (`reviews/2026-10-13-lp-best-strategy.md`, `backtests/lpbest/`; Davies, 10-13: "继续研究最好的策略…给我讲讲我再评估下"):
   a simulator calibrated to live (−$18.40 to −$24.96 a day against live's −$21.77) finds quoting a tick inside the touch loses
   across the whole reward universe; the one positive design is **Q2, quiet books** (≤ 50 shares traded in 24 h by the data
   API, touch ≥ 4 c, RW's price, N a side, a 2N inventory cap): +$3.6/day at $316 [+1.4, +6.0], +$4.2 out of sample, not
   larger with more money; R in quiet books never measured. Its design and an Addendum 19 draft are in the review (§7–8),
   nothing built. **Davies chose Q2 with no dry-run day** (10-13: "做B，不用空跑吧 做好后验证没问题了直接上线吧？", then
   "B 方案同意 继续推进"; and "B上线后盯着，每隔1-2小时查看一次有问题立马修复"). **Addendum 19 built** (the LP-BEST agent;
   verified by the main session: 903 Deno tests, six mutations each failing their pins), migration `0119`
   (`pm_lp_config.restarted_at`, `restart_loss_usd`). **Next: after the deploy and 0119, the go statement in Addendum 19
   (a self-checking `update … set restarted_at = now()`), then verify the picks are quiet by the data API, then a
   `sonnet-high` watcher every ~90 min that wakes the main session on any ALERT.** 14-day bar: total since the restart ≥ $0,
   rewards ≥ 1.5 c a filled share, no UTC day below −$15, the −$25 stop not reached.

0. **HANDOVER, 2026-10-11 ~03:30 UTC: Claude Code's weekly limit is near; Cursor (Grok 4.7) continues.** The watch and
   safe-maintenance procedure is `.agents/skills/live-watch/SKILL.md` (pointers in `.claude/skills/` and
   `.cursor/skills/`): copy-paste read-only SQL, OK/NOTE/ALERT/URGENT rules, the error box, the safe-fix workflow, the
   proposal path and the dated reads. The in-session watcher sub-agent ends with this session; the next platform runs
   watch cycles itself (Davies triggers them). State at 03:15 UTC 10-11: live-prep live and armed, Addenda 9–18 deployed
   (`ac162cc9`; Addendum 18 seen working: `state.lp.refill.deferred` set at 02:22 with $10.53 free), stop basis −$13.71
   (fills −48.92 marked at mid, rewards 28.41, rebates 6.79), **room $61.29**; error box empty since 00:12; PR5 fresh.
   `state.pnl.total` is the fills alone, never the stop's number (the skill's Step 2). Dates: 10-13 forward tests and
   LP-RULES item 1; **10-16 ≥ 01:00 the 7-day end-rule read with `backtests/pmlp/lp_readout_a18.sql` only** and the $40
   buffer re-read; 10-22/23 LPRESEL6, TB1 C1, 14-day readout. Showcase (`daviesluo/personal`) not yet updated for this
   week's strategy changes (Addenda 9–18, LP studies): left for Claude Code.

0b. **Every PAPER Reward quotes test is off (Davies, 2026-10-13: "目前paper testing里的reward quotes全关了吧？感觉都不赚钱没什么
   意义？"; `0120`).** Off: `pmrwc`, `pmrwc-select`, `pmrwc-e`, `pmrwc-x`, mid-pool (`pmmid`, `pmmidprep`), live-prep's paper layer
   (`pmlpprep`) and `pmprog` (with the `pm-prog-refresh` cron). On: live-prep's live call and `pmlpreserve`, the recorder
   (`pmrec`, `pmrec-meta`). TESTING shows no Reward quotes row. Withdrawn, each noted in its pre-registration: RW-C's verdict,
   RW-X4/X5's Test 2, TB1, RWC-OPT, mid-pool's readout and audit and its funded draft. LPRESEL6 still reads (pm-rec), with a
   deviation note. **Davies' wakes:** `trig_01XwUUNT5yXL3pzHoyH4JLaG` (10-17) is moot; `trig_018MBeyZsWkLBmbMq9ta3GNf`
   (10-23) still has LPRESEL6 and live-prep's own reads, its other tasks withdrawn. Item 2's paragraphs on those tests are
   history from here.

1. **Closed: fp5's ranked list.**

2. **Polymarket reward quotes (paper; RW, RW-E, RW-X, TB1, RW-C) and the three order paths (dry-run, unarmed).**
   - **Live-prep's Addenda 9–17 are live** (the reward check, FUNDED and the early readout, FUNDED at once: $402.028365
     booked 02:32 UTC 10-10; AI markets out; the refill, `b84cec4f`, ten refills 14:23–14:52 UTC; the $10 loss guard,
     `65650793`, 15:02 UTC; Addendum 15, the reserve ranked once a day at 00:00, `rerankEveryMin` 5 → 1440, pushed
     10-11 on Davies' "同意" of 10-10 23:59, quoted in the addendum; its programmes still read every minute;
     no migration, `pm_live.ts` unchanged; Addendum 16, a carried market in a one-tick book rests its exit, and 17, the
     caps fund whole markets in rank order on Davies' "按照你推荐的来" of 00:29 UTC 10-11, both pushed 10-11). Its paper layer's calls stay on until
     LPRESEL6 has read 10-09 → 10-22 (then a migration turns them off); LPRESEL6's "live-prep's own selection" is now the
     day's `pm_lp_markets` rows without `detail.refill`. Left for Davies: ranking on a rate that does not flip within the
     hour (not built).
   - **LP-RULES (10-11): no rule change today** (`reviews/2026-10-11-lp-rules-audit.md`). Reads it leaves: capital held
     by carried stock over 10-11 → 10-13 (its triggers and three options for Davies are in the review); TB1, LPRESEL6,
     near-end inventory and 3N/5N by 10-23.
   - **Addendum 18 (Davies 01:41 UTC 10-11: "同意，这些都按你推荐的来"), with the display fix before it: pushed 10-11
     by the main session** (LP-OBS-DEEP, LP-CAPDEEP). The end rule and 14-day readout read `backtests/pmlp/lp_readout_a18.sql`
     (10-09 like for like: R 0.7366 now, the frozen script 0.154); the 7-day read is on or after **10-16 01:00 UTC**. The
     refill waits while free buy budget < $20; a close-only market's exit rests through a pause; the live stop is the
     page's TOTAL (rebates in, fees out). The cap's $80 stays: **re-read 10-16** (LP-CAPDEEP's three conditions for $40).
     Forward tests (three live days): refills taken/deferred, exits filled in paused markets, the stop's room.

   - **RW's verdict: read 2026-10-09 00:42–00:50 UTC** (`reviews/2026-10-09-polymarket-rw-paper-result.md`, reference
     §3.46, `backtests/rwverdict/`). RW 6/6, RW-E 7/7, x1–x3 7/7 each; step b (all 4,116 fills by `stepRw`) and c (13,634
     prints re-pulled, none missed) clean; **RW-NEXT's candidate is RW-E**, to RW-C (Part 3's bar on or after 10-23
     00:05); no variant replaces it (index 33 below zero for each). **RW-X4/X5's Test 1 is VOID**: Addendum 1's copy check
     reads 10-01 rows that never existed (the arms joined 10-02 18:23 UTC); descriptively both fail condition 7 against
     x1; neither points to a change in mid-pool's rule; their Test 2 still runs on RW-C. Step e was done ahead by `0103`
     (checked: four `pmrw*` rows off, `edge-calls-every-minute` on, tick 60/60 beats). RW-C's 10-08 row is `warm-up`.
     Deviation named: RW stored 1,429 of 10-08's 1,440 minutes (19,800 of 20,160 in all). **Open:** step f, the report to
     Davies in Chinese, with the question the result file puts to him (live-prep now or after RW-C's 10-23 verdict).
   - **10-09 after 00:05, the page switch to confirm:** "Reward quotes", variant-1 and variants 2–4 read RW-C's run and
     replays from 10-09 00:00 (`RW_PAGE_SWITCH`, `RWX_PAGE_SWITCH`); the dashboard's `rw.source`, `rwe.source` and each
     `rwx` entry's `source` are "RW-C", `startedAt` 2026-10-09T00:00:00.000Z, `notStarted` false (`rwe` once
     `pm_rwc_e_state` exists), and it sends no `rwc`.
   - **RW-C (RW-NEXT Part 2; round 2 of RW's rule, 10-09 → 10-23 UTC, no page row of its own):** warm-up checked WARM
     on 10-08 00:33. After 10-09 00:05, `pm_rwc_days` holds 10-08 with `detail->>'phase'` = `warm-up`; the 10-10 check
     PASSED at 00:21 UTC: both replays' `checkMaxUsd` 0 and the x replay's `checkEMaxUsd` 0 over `checkEDays` 1 (10-09,
     closed in `pm_rwc_days` as `run` and in both replays' days), read as scalars. **Verdict on or after 2026-10-23 00:05 UTC** (wake
     `trig_018MBeyZsWkLBmbMq9ta3GNf`, 10-23 00:40) by the frozen RW-NEXT, then a migration disables the four `pmrwc*`
     rows. The same wake reads RW-X4/X5's **Test 2** on RW-C's minutes (`pmrwc-x`, seed 20261023, against x1; an arm
     passing both tests goes to Davies). **TB1** is read after RW-C's verdict too, though that wake's prompt predates it
     (`reviews/2026-10-07-polymarket-rw-tb1-prereg.md`, `0096`; arms `tb1-skip`, `tb1-back`; designed after a non-blind
     read of RW): from `pm_rwc_x_days`, RW-X's seven conditions over 10-09 → 10-22 (seed 20261023), plus 7′ a paired
     day bootstrap of (arm − x1) at R = 0.40 > 0 and 8 that difference without the best market-day > 0
     (`detail.rewardByMarket`); void if either arm carries a `start` in
     `pm_rwc_x_state` or a day row is missing. TB1's health: both arms in `pm_rwc_x_state.state.arms`, `base` {}, no
     `start` after 10-09 00:05; x4 and x5 still written in both replays.
   - **LPRESEL6** (`reviews/2026-10-09-lp-reselect6h-prereg.md`, frozen 2026-10-09 before any pm-rec data of 10-09 on was
     read for design; `backtests/lpresel6/`, pinned by `src/lp_resel6_prereg.test.js`): live-prep's rule against it choosing
     again every 6 h, offline on pm-rec's whole-universe record 10-09 → 10-23. **Read on or after 2026-10-23 00:05 UTC**
     beside RWC-OPT: `sql/archive_urls.sql` → `scripts/fetch.py`, `sql/aux.sql`, `build.ts`, `run.ts`, `bar.py`; coverage
     ≥ 90 % a day else void. Needs `pmrec`/`pmrec-meta` running to 10-23 00:00; the archive is never pruned.
   - **RWC-OPT** (`reviews/2026-10-09-rwc-optimised-arms-prereg.md`, frozen 2026-10-08 before RW-C's first minute;
     scripts `backtests/rwc_opt/`, pinned by `src/rwc_opt_prereg.test.js`): offline replays of RW-C's record, C1 = live-prep's
     S2 + TB1's skip against S2 (primary), C3 = x1 + x2's pause + TB1's skip against x1, C2's exits reported. **Read on or
     after 2026-10-23 00:05 UTC beside RW-C's verdict**: pull `pm_rwc_*` with `sql/*.sql`, `check.ts rwc` (must PASS),
     `run.ts rwc`, `bar.py results/rwc_arms.json` (`random.Random(20261023)`, 2,000 draws, index 100 > 0 under both fill
     models, market-days less the best > 0), at the freezing commit; commit the output and report to Davies. A pass is a
     candidate for live-prep's rules only (his word and its own pre-registration). It changes nothing that runs.
   - **After the verdicts:** POOLAGE (reference §3.44) only if RW or RW-E passes: read RW's `others` by minute of day
     from `pm_rw_minutes`; build no recorder before that read and Davies' word; drop it if both fail. An exit rule
     (selling a fill at once, priced 2026-10-04, loses): once a path is live, read its first 20–50 fills' next books
     first; a trim near the cap only if x5 fails and the measured R is near 1, as a new replay after 10-23 on books
     stored with their sizes. Reward quotes' variants become rows of a spec table, as the twins did, after their 10-09
     reading, not inside it. Intraday re-selection every 2 h (S2) was backtested on 10-07 and is not supported as
     specified (a longer archive would be needed).
   - **The three order paths, each in dry-run with its config row the lock** (`dry_run` true, `live_confirmed_at`
     null; a trigger refuses arming two at once; one account, unfunded: pUSD $0.04 at the last read). **mini-pool**
     (`pm_live`, `0074`/`0076`/`0080`, `reviews/2026-10-01-polymarket-live-calibration.md`): every check window closed
     by Addendum 7 (2026-10-04); not a go-live candidate; off TESTING, and `pmlive` and `pmprep` off, when `0103`
     applies (Davies, 2026-10-08: "按你说的停掉mini-pool的两个调用"); config row untouched (nothing arms). **live-prep (S2)**, the lead
     candidate, with TB1's skip of a one-tick touch since its Addendum 2 (2026-10-08, Davies' word; pinned in
     `pm_lp.test.ts`, deployed with the next push of `agents`) (`0091`, `agents/pm_lp.ts`, `reviews/2026-10-04-polymarket-lp-prereg.md`): P1 checked 2026-10-07 20:22
     UTC with `backtests/pmlp/lp_check.sql` (sha256 `7e94b042…0a57`): (a)–(e) and (g) PASS, (f) FAIL on funding alone.
     Before Davies' go, in order: P2 pUSD ≥ $81 in the account (read $0.04 on 10-09 00:00); P3 met in code (the
     payouts-per-path change applied 2026-10-08, live-prep's Addendum 4, mid-pool's deviation 5; it deploys with the
     push that lands it); P4 mini-pool and mid-pool unarmed (both are); P5 the probe's read of the conditional-token
     allowances: built on branch `pm-prego` (2026-10-09 01:06 section below), read after its deploy with
     `GET agents?action=probe&only=polymarket&forceFunctionRegion=eu-west-1`, `polymarket.conditional.sellsApproved`
     both true; the go-live audit's fixes and live-prep's Addendum 5 (`pm_live.ts` `a208878b…`) land with it; the monitor's freshness reading for `pm_lp_state` is built (`monitor/health.ts`
     `pmLp`, three minutes); then step 8lp, only where he says go. Not measured: the selection's CPU over about
     1,379 markets. **mid-pool** (`0081`/`0084`, `agents/pm_mid.ts`, `reviews/2026-10-02-polymarket-mid-pool-prereg.md`;
     day-1 check PASS 10-04): run `backtests/pmlive/mid_readout.sql` once at or after **2026-10-17 00:10 UTC** (wake
     `trig_01XwUUNT5yXL3pzHoyH4JLaG`), naming deviations 1 and 2 and, as a deviation on Davies' word (2026-10-09), that
     mini-pool's (small-pool's) column is empty from the day `0103` landed (its calls stopped; the days missing, never
     zero), and the overlap audit `mid_audit.sql` no earlier than
     **2026-10-23 00:05 UTC** (the 10-23 wake), read-only, every row reported to Davies (both sha256 pinned by
     `src/pm_mid_prereg.test.js`). The payouts change, applied 2026-10-08, is the readout's deviation 5 (its Addendum 5),
     named beside deviations 1, 2 and 4. His go-live waits for the RW-X arms (report whether x4 or x5 should change mid-pool's rule; a changed rule
     dry-runs before any go date). Before a go date: ≥ $400 of pUSD funded ($320 cap); the probe from Ireland (design
     step 2); the two unused pUSD spenders revoked or kept (step 3, his call); a live row, page and monitor freshness
     reading built; the readout and audit reported; then the funded draft `reviews/2026-10-04-polymarket-mid-pool-live-prereg.md`
     freezes on his go date (the earliest after the audit) and step 8m (`backtests/pmlive/scripts/mid_live_check.mjs`)
     arms only the current config.
     A revocation of the Ireland attestation is recorded in every config row. **Any go-time statement** is the design
     doc's, in the conversation where he says go; never on a check.
   - **Any live Polymarket step (RW-NEXT Part 4):** his word after RW-C passes; `eu-west-1` only, under his
     attestation; never a VPN, a proxy or anyone else's account; `_shared/polymarket.ts` GET-only until the design is
     agreed; the Terms of Use bar (fp4 §0) his accepted risk; the wallet kept small (its key was exposed to another
     tool; revoking that tool's token is his). A path's first live day reads how soon a cancel shows on the venue (the
     calibration doc's "Not verified" query).

3. **`trend-4h-live`: LIVE on Revolut X, cap $60 (two $25 slots of four) since 2026-10-01 02:24:51 UTC.** The $150 step
   was checked 2026-10-08 06:23–06:26 UTC and held at $60, Davies' call (the clean week not literally clean, no live entry
   all week to prove two concurrent positions, four slots doubling the drawdown). Raise only on his word:
   `update public.agent_risk set max_exposure_usd = 150, updated_at = now() where id = 1;`, then read it back; re-read
   AVAX's book (`scripts/cap/book_30d.py`) before any raise; AVAX stays. No trade needs his confirmation; a session
   watches when asked and reports, never asks. **When asked to look (read-only):** after a 4h close + 3 min (00:03,
   04:03 … 20:03 UTC) the live row's four decisions beside `trend-4h`'s, `agent_orders` with `mode = 'live'`,
   `ops_errors`, the tick's cron runs; five minutes after a live order its read-back (fee fields or `feeDerived`,
   `filled_base` in whole `base_step`s, `fromAccount`, the coin's balance against the book); after a sell, the book
   flat. Report a live order, a fill, an order `pending` over 2 minutes, a missing decision, a live-row error or a
   failed tick. Rows, caps, order path: `docs/agents/CLAUDE.md`, `docs/agents/go-live.md`, reference §3.31 and §4
   items 32–34.

4. **PR5 (GBP stablecoin quotes): live executor LIVE since 2026-10-01 16:29:53 UTC at £10 a rung; the paper test decides
   PR5 on 2026-10-21** (spec `reviews/2026-09-23-pr5-paper-test-spec.md`, six conditions; wake
   `trig_01QsXPKHc6Nt6NK3BJmbB2RY`, 10-21 15:40). Every verdict below says the paper tests ran beside a live executor
   from 16:29:53 that day. Watch with reference §4 item 35's L1–L5 on `mode = 'live'` (a filled entry gets its exit
   next turn; nothing `pending` past 2 minutes; the state row under 3 minutes old). The monitor's dead-man
   (`monitor?action=deadman`) cancels every resting order when the state is over 3 minutes old. Kill switch:
   `update public.agent_quote_live_config set live_confirmed_at = null where id = 1;` (entries cancelled, exits and
   stops stay armed); `global_pause` cancels everything.
   - **At the 10-21 verdict, check condition 5 first:** PR5's paper engine logged 714 orders on 2026-10-01
     (`agent_quote_days`), over the spec's 700 a day, which the spec calls "a finding to fix, not a pass"; confirm how the
     verdict script counts orders (SCQ-1014, `reviews/2026-10-14-stablecoin-quotes-review.md`). The same review proposes
     for 10-21: LIVE at £50 a rung (£600) as Davies' call; stop the `pr5` twin after its readout, `d` after 10-28 unless rule D
     passes; keep `p50`, `take50` and both Coinbase tests to their dates; add nothing.
   - **At the 10-21 verdict, put to Davies:** keep PR5's paper engine and its minute record running (PR5V needs it to
     10-28 00:30, QUEUE to 11-02, PR5-W to 11-25, 12-23 at the latest); if PR5's record stops early, PR5V's window
     ends with it (under 21 days: reported, not judged). PR5-R (`reviews/2026-09-28-pr5-readings-prereg.md`) is read
     after PR5's four weeks, before that review.
   - **The twins** (TESTING's stablecoin rows; `0087`–`0090`, `0108`–`0109`, `agents/quotes_twin.ts`, reference §4 item 51,
     one row each of `agent_quote_twin_specs`: `pr5`, `p50` = variant-1, `take50` = variant-2, `d` = variant-3 (variant-4
     from `0108` to `0109`); `d` quotes no 0.03 % entry from 10-10 00:00, its readout reads the spans apart,
     twins' prereg §15). Daily health: each `_sim.last_error` empty, `paperCheck.mismatches` 46 for `pr5` and `p50`
     (all before 2026-09-24 18:13) and 0 for `d`, `_state.updated_at` within ~3 min, `edge_call_beats` has `agents?action=quotestwins` each minute, no
     `agents.quotes_twins` errors, no twin row in `agent_quote_live_orders`. Readouts, no pass bar: PR5's twin beside
     PR5's verdict (10-21) with `p50` per rung; rule D's twin after rule D's reading (10-28) with `p50` at their three
     common rungs. **TAKE** (`take50`, `reviews/2026-10-03-take-prereg.md` and its Addendum 1): take trips opened
     2026-10-04 16:00 → 2026-11-02 00:00 UTC (extended a week at a time to 11-30 until 15 have closed); read on or
     after the window's end + 2 days by a script committed before it ends, whose K2 mirrors the prereg's deviation 1;
     K1 held at 05:03 on 10-03 and is checked again over the whole span. **p50x1 withdrawn** before its window by `0109`
     (Davies, 10-09; its prereg §7): no reading, and `p50` need not run to 11-09 for it. **After `0109` applies:** the
     spec table holds four rows (`d` "Stablecoin quotes variant-3"); no `agent_quote_twin_p50x1_*` table and no
     `quotes-twin-p50x1` lock row; the next `quotestwins` beats with no `agents.quotes_twins` error; the page shows four
     stablecoin rows.
   - **The review of 2026-10-09** (`reviews/2026-10-09-stablecoin-quotes-review.md`, not blind). **F1 built on Davies'
     word** (10-09: a buy-back at the venue's £0.10 minimum buys what its whole penny buys, LIVE and every twin; the twins'
     deviation 3, p50's deviation 2, TAKE's addendum 2, the live design's addendum). After its deploy: the next LIVE or
     twin buy-back worth £0.10–£0.11 has `base_size` = floor(£0.11 / price), is debited £0.11, and the rung reads flat.
     The 10-21 and 10-28 readouts count such buy-backs before and after the deploy. Every reading named here should
     cite the review as a non-blind read.
   - **PR5V and variant-2 (rule D), frozen 2026-09-28** (`reviews/2026-09-28-pr5-variant-prereg.md`,
     `reviews/2026-09-28-pr5-rule-d-prereg.md`; governor 900/950 since their deviations of 2026-10-01): PR5V's window
     09-29 → 10-26 by entry day, E = 10-28 00:30 UTC; both reading scripts committed before **2026-10-27 00:00 UTC**
     (wake `trig_01Myqe75KezMbWXZ15qK8mBD`, 10-24 09:20), both read on or after **10-28 01:00** (latest 11-04; wake
     `trig_01SekCNjJaux9Qbhn2Yaj7QD`, 10-28 01:20), each result file repeating the disclosure of 2026-09-30 22:14 (this
     ledger read their 09-28 → 09-30 results early). Variant-2 is judged only if arm `v1` equals PR5V's `main`; its
     health: `agent_quoted_state` code 4, caught up, no error, `checkMaxUsd` under $0.01, no `x_source = 'truefx'`.
     Expect the governor to bind on fresh weekdays. A faster GBP/USD feed (TrueFX) counts only in a live executor that
     posts at once: PR5's live path after 10-21, as a pre-registered change; no frozen test may switch.

5. **Closed: the studies of 2026-09-26/27** (reference §3.37–§3.42). Two notes: the view recorder's study is
   pre-registered after 4–6 weeks of recording (~10-25 → 11-08); PMLATE's and SPEED's post counts read one page of the
   post tracker, so re-run them with HARVEST's paged reader before any post-count idea is taken up again.

5a. **The seven measurements of 2026-09-27, frozen 2026-09-28** (`reviews/2026-09-27-testing-portfolio-review.md`,
   reference §3.43):
   1. **JEV-DRIFT: done** (option (c), 2026-09-28; reference §4 item 43).
   2. **MX-1** (`reviews/2026-09-28-mx1-maker-first-prereg.md`, C* = 110 bps): **every Monday** the wake
      `trig_01Dm3nw4TbBm2GCX2z12tN7o` (06:37 UTC) runs `scripts/mx1/weekly.sql` and `scripts/mx1/pull_tape.py`: the UK
      tape of each event's window into `backtests/mx1/tape/` (a failed window retried weekly, void only if it still fails
      at the reading) and the `agent_basis` rows (pruned at 30 days) of any event missing `o15` or `o60` into
      `backtests/mx1/basis/`. Read at the first pull with 150 eligible exit events (the first 150 by `t0`); if fewer have
      `t0` before 2027-06-30 00:00 UTC, after the first pull after it, on all (under 60: undecided); disable the wake
      then. A pass moves only `trend-1h`'s exits, after its §6's five checks. Pulls so far: 10-05 (6 windows, 3 exits).
   3. **RW-NEXT:** slip check done 2026-10-08 00:33 (WARM, no slip); what is left is RW-C's (item 2).
   4. **QUEUE** (`reviews/2026-09-28-queue-prereg.md`; window 10-04 → 11-01). Freeze line until the export: none of
      `agents/books.ts`, `agent_book_levels`, its prune job, `stepMinute` in `agents/quotes.ts` or
      `agent_quote_minutes` changes, but a longer retention on Davies' word; anything else is a deviation (deviation 1,
      10-03: the book table may be read by other checks; the reading says it was not blind). Dry run done 2026-09-30
      (no deviation). Dates: Kraken's spare pull between 2026-10-18 and 10-25 (keyless; wake
      `trig_01U3odxMpVv4zaqVueHJvaM7`, 10-18 06:20); the scorer and checks 1–3 committed before **2026-11-02 00:00 UTC**
      (the 10-24 wake); the export after 11-02 00:10 and before **11-06 10:25 UTC**, the tape after 11-02 00:10 and
      Kraken's main pull on 11-02 between 00:05 and 19:59 UTC (wake `trig_01Q3DV4MArsf3tQ1Po8yCh1X`, 11-02 00:40); if
      check 4 has not passed by **2026-11-04 00:00 UTC**, a longer retention goes to Davies.
   5. **PR5-R:** read after PR5's four weeks, before the 10-21 review (item 4).
   6. **PR5-W** (`reviews/2026-09-28-pr5-weekend-prereg.md`): the same freeze line as QUEUE's until its reading. Dry runs
      and arm 3a's candles done (2026-09-28 and 09-30; hashes in the archive). Dates: arm 3b's first export after
      2026-11-01 21:02 and before **2026-11-05 10:25 UTC** (the 11-02 wake); the count script committed before
      **2026-11-25 00:05 UTC** (wake `trig_01Ecb6B2TUMRhvYiyc3a8BuE`, 11-20 09:20); the reading, with 3b's second export,
      on 2026-11-25 from 00:05 UTC, 12-23 at the latest (wake `trig_01JVzTyxtpoSkB7Wgw2eRkqk`, 11-25 00:40). At the 10-21
      verdict, ask whether PR5's paper engine keeps running to it (item 4).
   7. **EX-GAP** (`reviews/2026-09-28-ex-gap-prereg.md`): counted on the 1st of each month at 09:23 UTC by
      `trig_018Ni6ydYybx39fE2wn7ZLeo`, which reads at 16 pairs or after 2027-01-31 and then disables itself; under 8
      pairs by its date, undecided. 2 pairs on 10-01.

6. **Davies' to decide or to do; nothing waits on them:**
   - **Cloudflare Pages:** turn off Pages' own Git build's automatic deployments (Settings → Build → Branch control):
     it still publishes a `dist/` push without waiting for CI, which `pages-deploy.yml` now does (review F7). Then check
     the next `dist/` push: its `pages-deploy` run succeeds and the site serves its `app-<hash>.js`.
   - Rotate `APP_ADMIN_PWD`, `APP_RO_PWD` and `APP_AUTH_SECRET` (Edge Function secrets): the site served the
     repository, `auth` included, until 2026-09-18; nothing suggests it was read. Every device logs in again once.
   - **The Kraken balance to Polymarket** (2026-09-30): before money reaches the wallet, its key's exposure (item 2), the
     proxy wallet's unlimited pUSD allowances to four spenders (harmless only while empty), and that nothing opens a
     position before RW-C passes and he says go. When he says the transfer is done, fire the read-only probe
     `?action=probe&only=polymarket` through pg_net with the Vault `cron_secret` and record the collateral it reads.
   - **WXSRC's weather feeds** (reference §3.41): Météo-France needs a long-lived API Key (as `METEO_FRANCE_API_KEY`) or
     the OAuth2 application ID (as `METEO_FRANCE_APPLICATION_ID`), then `weather?action=probe&only=meteofrance`; FAA:
     subscribe CSS-Wx's METAR/SPECI for KATL KAUS KBKF KDAL KHOU KLAX KLGA KMIA KORD KSEA KSFO when it appears (Q4 2026;
     ITWS lapses after 60 idle days); KMA's API Hub needs a Korean phone number; Google's WeatherNext 3 allowlist.
   - HARVEST's lead (reference §3.42): a forward recorder of UMA proposals and disputes, build only on his word; any
     harvest opens a position (Ireland only).
   - The research round of 2026-10-01 (`reviews/2026-10-01-research-round.md` §5): whether US equities are in scope
     (item 8).
   - Binance: switch off "Enable Spot & Margin Trading" and universal transfer; Deribit: `trade:read_write`; until a use
     is decided (neither funded). The venue survey's §10 questions (`docs/agents/venue-survey.md`).
   - Whether this ledger's `Model:` headers are backfilled. DecisionFC's next steps (`docs/improvement-plan.md` there)
     start only on his word. A clone made before 2026-09-24's history rewrite is re-cloned or reset
     (`docs/commit-map-2026-09-24.md`); every clone runs `sh bin/setup.sh` once.

6b. **Parked** (Davies, 2026-10-01: "其他的都先记下来，之后再考虑"; reference §3.44): each needs his word. POOLAGE (item
   2); a venue for event positions (Smarkets keyless, Betfair needs a key; survey first); Polymarket Combos maker, the
   UMA disputer's bounty, listing announcements; Revolut X's `index_price` as a fair value (no frozen test may switch);
   a Revolut X coin-book recorder (not before QUEUE's export). Closed: coin/USDC maker quotes on the UK books; token
   unlocks.

7. **The app's own list is [`docs/improvement-plan.md`](improvement-plan.md)** (18 of 28 done on 2026-10-02, 8 open).
   Worth doing next: the app icon; item 3 measured before it is touched. Seven questions there wait on Davies. Not yet
   under the quote band: the market cards and FX rates (`fetchTickers`), Trading 212's own prices (VUAA.L / SAEM.L's
   `lastPrice`, the overnight price), and a stock the price function leaves out while a CN fund is in the book.

8. **US equities at Trading 212: nothing to run** (EQ1, EQ2, DFC, DAT; reference §3.44–§3.45; DFC failed, MSTR/BMNR
   closed). No trading key is needed; any future live path keeps EQ2's guardrails.

9. **Supabase, after the tests:**
   - After PR5's verdict (10-21): `quotes.ts` re-upserts its inputs every minute (`agent_quote_inputs`); write only new
     rows then. RW's tables (134 MB) stay past RW's verdict: `mid_audit.sql` reads `pm_rw_selection` on or after 10-23 and POOLAGE
     would read `pm_rw_minutes`; dropping them is Davies' call after 10-23. `pm_view_books`
     grows ~12 MB a day until its study. Since `0101` (2026-10-08) the order paths' dry-run record keeps 14 days (from
     10-15) and `db-size-watch` reports past 4 GB. Still read whole each minute, for a later change: the recorder's
     market list and the twins' filled orders (frozen with TAKE to 11-02). Davies' call: the instance (Micro, 1 GB; the
     database 1.3 GB on 10-07) or incremental reads.
   - **The monitor Worker** (`workers/monitor/`, every minute since 2026-10-02 19:04 UTC): check it with
     `select minute from public.edge_call_beats where path = 'monitor?action=deadman' order by minute desc limit 5;`
     (a row a minute). `healthcheck.yml` stays for its warm pings and its not-found chunk probe.
   - **A migration that adds an `edge_calls` row for an action its function learns in the same push** can meet the old
     function once (0100, 2026-10-08; archived history 16:59). From 0104 (batch 5, not yet landed) the row waits 15 minutes for
     the deploy (`active_from`); until it is live, land the function first unless the call is resumable.

10. **The repository review of 2026-10-08** (`opus-high`; batches 1–4 approved by Davies, F2, F3 and F11 not):
   - **Open with Davies:** F21 (the coordinator puts it to him; not fixed); M9, a deposit's own-date FX rate instead of
     one frozen rate per currency (reported, not built: it changes the Deposited line and needs FX history by date that
     nothing stores; few deposits are in another currency than USD); #233 (the open `ci-failure` issue, every
     failure since 10-04 green again); eight worktrees under `.claude/worktrees/` and three detached ones with a commit
     not in main (archived history 10-08 17:25); `refreshPrices` still asks for sold-out holdings' quotes.
   - **Batch 4's deploy order, kept:** `overnight-fetch` requires the app token from the commit after the page's
     bundle that sends it went live (app-1b24810b.js, 2026-10-08 ~17:50 UTC); an older tab still open gets no new
     overnight points until it reloads.
   - **M7 (the site's own fonts) reverted, redone in batch 5:** CI's Chromium drew the sweep with Inter for the first
     time (the sweep had aborted Google Fonts, so every earlier run drew a fallback) and three layout checks failed
     (archived history 10-08 17:45). They fail in the headless shell alone; CI launches the full Chromium from T2 (history 23:06, 23:16).
   - **Second review done (2026-10-08 ~18:30 UTC), read-only; awaiting Davies' pick, nothing fixed:**
     T1 vitest reaches production (four perf_chart test files leave `price_snapshots.js` / `overnight_intraday.js`
     unmocked; ~560 GETs a day; fix: fail any non-localhost fetch in `test_setup.js`); T2 CI's sweep runs the
     headless shell, which alone fails Inter's layouts (full Chrome 141/153 green; launch `channel: 'chromium'`, then
     M7 returns unchanged); D1 migration vs deploy order (`edge_calls.active_from`, `cancel-in-progress: false` in
     migrations.yml); A1 `applyFill` leaves float residue on a sell (round as quotes_live.ts:373; check the frozen
     preps' outputs), A2–A4 and A6–A7 low (one-turn double count, two unsettled buys, PR5 429 counted once,
     Polymarket same-second fill order, caps before cancels read back); A5 PR5 stops-only from 20:36 on 10-07;
     L1 Bot Fight Mode's script blocked by our CSP, L2 Cloudflare overrides `max-age=0` on js/css (Browser Cache TTL),
     L4 the SW keeps the board in "data-api"; B1 no off-site database copy, B2 the `pm-rec` bucket unbacked
     (PITR add-on unverified); size budget 1.76 kB of headroom. Full report: this session's transcript; evidence
     paths in the reviewer's scratchpad.
   - **Batch 5** (Davies, 2026-10-08: "以上内容都修"; L1, L2 and PITR are handled outside the repository): landed 2026-10-09
     (history 00:45): the board's first paint at 1:1 FX, T1, T2, M7 again, D1 (`0104`), A2, A3, A4, A6, A7, the size
     budget. Follow-ups on `review-fixes`, not yet landed: A1 by the snap (history 00:46); tick.ts booking a pending
     order the venue's history shows cancelled after a partial fill as a fill (history 00:51); UNREALIZED G/L never
     showing the gain before dividends (history 01:15). Landing them: A1 changes a `_shared/` module, so every Edge
     Function redeploys (`bin/edge-changed.sh`); the tick fix is in `agents`; the UNREALIZED fix is a new bundle
     (`dist/`).

11. **CJ5's keyless CoinJar recorder: built, not yet deployed** (Davies, 2026-10-09: "建起来"; reference §4 item 57,
   migration `0110`, `agents/cj_rec.ts`). After it lands: the `agents` deploy and the migration, then 15 minutes
   (`active_from`); check `select product, count(*), min(ts), max(ts) from cj_trades group by 1` (from 2026-09-01:
   about 2,280 USDC/GBP and 1,250 USDT/GBP prints at the first run), `select product, count(*), max(seen_until) from
   cj_book group by 1` (a row a minute a book), `select * from cj_rec_state`, the `agents?action=cjrec` beats in
   `edge_call_beats`, and no `agents.cj_rec` row in `ops_errors`. CJ5's prints need no waiting: CoinJar's trades
   endpoint pages back to 2020 with `after` (the search's "eight days" was its default page), so CJ5's paper test can be
   pre-registered and built on history now; only its book (queue) history starts at the deploy. CoinJar offers post-only
   (`MOC`). Live needs Davies' CoinJar UK account and a trades-scope key he creates himself (never printed), stored by
   him as a Supabase secret, and an order path that does not exist. **Its paper test on history is done**
   (`reviews/2026-10-09-cj5-paper-test.md`): an edge in every year, shrinking; a forward paper test is drafted, not frozen
   (`reviews/2026-10-09-cj5-forward-paper-prereg.md`), and waits on a design and his word.

12. **The minute record's defect (2026-10-12, `reviews/2026-10-12-coinbase-first-days.md`): `cbMinuteRow`'s
   `reduce(Math.min)` stored null extremes for every side with two or more prints (7,216 of 12,802 printed minutes), so bar 1's
   replay of the 11-08 reading fails as stored. Deviation 2 agreed (Davies, 2026-10-13: "Coinbase修复同意"; prereg §7);
   the fix landed with it (history 2026-10-13 00:08).** The fix deployed 00:10:57 UTC 10-13; `0117` repaired the
   stored minutes (migrations run green); the verify query read 8,786 minutes, 0 wrong. Closed. The test reads PR5's paper engine's `agent_quote_inputs`: keep that engine
   running to 11-08 whatever the 10-21 review decides. Candidate: a weekend variant (CBK, in sample +34–47 %).
   The paper test itself: **Coinbase recorder and paper test "Stablecoin quotes with Euros" ("…Coinbase" until its Deviation 1): deployed
   2026-10-10 01:46 UTC; Deviation 1 (€100 a rung on the EUR books, the name, the window 2026-10-11 → 11-08) must deploy
   before 10-11 00:00 UTC** (Davies, 2026-10-10;
   reference §4 item 58, migration `0112`, `agents?action=cbrec`). After it lands and its 15 minutes pass: check
   `select last_report->'reached', last_error from cb_rec_state` (true: the Edge region reaches Coinbase; never
   confirmed before), `select product, count(*), min(ts), max(ts) from cb_trades group by 1`, `select last_minute,
   last_error from cb_quote_state`, and no `agents.cb_rec` row in `ops_errors`. Pre-registration
   `reviews/2026-10-10-coinbase-paper-prereg.md` (frozen; Deviation 1 in §7): 28 UTC days 2026-10-11 00:00 → 11-08
   00:00, read on 11-08 from 00:30 with `backtests/cbpaper/scripts/replay.py` on the export Deviation 1 names (a wake to
   set). The budget split is `reviews/2026-10-10-coinbase-vs-revolutx.md`.

12b. **"Stablecoin quotes with Euros - 2" (the weekend variant; Davies, 2026-10-13: "周末变体写预注册然后上线paper trading 策略with
   Euros - 2"): pre-registered and built** (`reviews/2026-10-13-coinbase-weekend-prereg.md`, migration `0118`, `agents/cb_hold.ts`,
   `agents?action=cbhold`, reference §4 item 60). The one change: the interbank bar is held 60 h through a closure. Its window is
   28 UTC days from the first 00:00 after its first run (`cb_hold_state.state->>'startedAt'`), read the day after from 00:30
   with `backtests/cbwk/scripts/replay_wk.py`. **Started: first run 01:07 UTC 10-13 set `startedAt` 2026-10-14 00:00 UTC;
   Deviation 1 (Davies, 2026-10-13 evening: start at once, not at 10-14 00:00; migration `0121`, prereg §7) moved it to
   2026-10-13 00:00 UTC, so the window is 10-13 00:00 → 11-10 00:00 and the reading is on 2026-11-10 from 00:30 UTC** (four
   whole weekends; no wake set yet: the fifteen Routines fire into the 'portfolios - 5' session). The first runs after
   `0121` decide 10-13's recorded minutes 60 at a time until current; verify `startedAt` reads 2026-10-13 and
   `last_minute` is ~2 min behind. After the deploy and 15 minutes: `select state->>'startedAt', last_error from cb_hold_state`, `cbhold` beats, no
   `agents.cb_hold` errors, `last_minute` ~2 min behind. It reads `cbrec`'s stored EUR/USD and PR5's paper engine's
   `agent_quote_inputs`: both run to this window's end, past 11-08 and past PR5's 10-21 review.

13. **Coinbase's order books recorded, ten levels a side: live since `96a9da37` (10-10)** (Davies,
   2026-10-10; reference §4 item 59, migration `0114`, `agents?action=cbbooks`). After it lands and its 15 minutes
   pass: `select last_error, last_report from cb_book_state` (`recorded` 4 a minute, `reached` true) and `select product,
   count(*), max(ts) from cb_book_levels group by 1`; no `agents.cb_books` row in `ops_errors`. Nothing reads it until a
   queue-model study of the Coinbase books is pre-registered.

14. **IG CFD/spread-betting deep dive and verification handoff written, not run** (Davies, 2026-10-14: the same
   requirements and architecture as PMSTATARB; he would bear some risk for a good enough strategy after thorough
   research). `reviews/2026-10-14-ig-deepdive.md` keeps only FXW-AUD as a historically supported rule: on FXCM it
   survives 12-30 bp assumed spreads, but a 60-minute delay removes the statistical case and the worst 24-hour
   adverse excursion is 440 bps, so leverage cannot be sized from final drawdown. WKND remains quote discovery,
   ESG remains n 18, and the new gated-volatility measurements close the tested model-priced gates. The run-ready
   demo-only handoff is `backtests/ig_deepdive/SPEC-for-verification.md` (G0-G4, S1-S5). It starts only when
   Davies confirms the approved contracting entity, stores demo credentials himself and says to begin; no live
   host, order, funding or production deployment is authorised by the spec. Decisions left to Davies: hand it to
   Grok, identify entity/product and tax route, and later choose any risk amount only from S5's stress packet.

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
- **Scheduled wakes (2026-09-30).** Davies' previous account is gone, and with it every Routine and helper session
  the ledger named before this date. Fifteen Routines now fire into the Claude Code session
  `session_019JpeoB2bWdN7fhpKaor3fe` ("portfolios - 5"), which holds the database connector: `trig_018QYvjyPodsEokzzscF2yrR`
  10-01 10:20 UTC (item 7's audit check, RW health); `trig_014Rdj3qAgVVbh8h3eKcjb8X` 10-04 10:20 (RW health, QUEUE's
  window); `trig_01Dm3nw4TbBm2GCX2z12tN7o` Mondays 06:37 (MX-1); `trig_01SY2TY9HuSQY5C7EEB9LD7y` 10-08 00:32 (RW-C's
  warm check); `trig_01THWfdRa6aKk2mZg8N8DUzC` 10-09 00:40 (RW's verdict); `trig_0147EKGhR4aHoVq5QWUFy1mr` 10-10 00:20
  (RW-C's replay check); `trig_01U3odxMpVv4zaqVueHJvaM7` 10-18 06:20 (QUEUE's spare pull);
  `trig_01QsXPKHc6Nt6NK3BJmbB2RY` 10-21 15:40 (PR5's review); `trig_018MBeyZsWkLBmbMq9ta3GNf` 10-23 00:40 (RW-C's
  verdict); `trig_01Myqe75KezMbWXZ15qK8mBD` 10-24 09:20 (the reading scripts); `trig_01SekCNjJaux9Qbhn2Yaj7QD` 10-28
  01:20 (PR5V's and variant-2's readings); `trig_01Q3DV4MArsf3tQ1Po8yCh1X` 11-02 00:40 (QUEUE's and PR5-W's exports);
  `trig_01Ecb6B2TUMRhvYiyc3a8BuE` 11-20 09:20 (PR5-W's count script); `trig_01JVzTyxtpoSkB7Wgw2eRkqk` 11-25 00:40
  (PR5-W's reading); `trig_018Ni6ydYybx39fE2wn7ZLeo` the 1st of each month 09:23 (EX-GAP's count); and, set 2026-10-01 on
  Davies' word, `trig_01THvHcphx5gngXugfwwy788` 10-08 06:20 (the live cap's clean week and its $150 step, item 3);
  `trig_014N6zxm3dqcQLMqUut3NKND` 10-04 00:15 (mini-pool's check under Addendum 2 and, since 2026-10-02, mid-pool's
  day-1 `mid_check.sql`; report only, never arm); and, set 2026-10-02, `trig_01XwUUNT5yXL3pzHoyH4JLaG` 10-17 00:20
  (mid-pool's fourteen-day `mid_readout.sql`, only after a passed day-1 check). The same day the 10-09 wake gained d3
  (RW-X4/X5's Test 1) and the 10-23 wake RW-X4/X5's Test 2 and mid-pool's `mid_audit.sql`. Each wake delegates
  only to `opus-high` (the most important and difficult work), `sonnet-max` (the next tier) or `haiku-max` (the
  simplest), as Davies ruled on 2026-10-07, and checks their work before committing; a Routine's prompt that still
  names `opus-max` means `opus-high`.
  Why not their own sessions: a Routine created from a session here cannot store connectors ("not available for this
  organization"), so a fresh session it starts has no database; and a session created with `create_session` waits for
  a person to approve its MCP calls (the test session `session_0141N6ayHSNVrjfNezYV18Yj` stopped at the first one).
  If this session is archived, the fifteen must be created again pointing at a session that holds the connector.
- **The Edge Function checks run on Deno 1.46.3 through npx**
  (`npx --yes deno@1.46.3 test --allow-env supabase/functions/`), the
  version CI's `setup-deno` `v1.x` resolves to; this container has no
  `deno` of its own. A bare `npx deno` fetches Deno 2, which CI never runs
  — and which `bin/gates.sh` used until 2026-09-23 03:06 UTC.
- **A cloud container whose network policy blocks `deno.land`** (the
  Claude Code one on 2026-09-30) cannot fetch the tests' std assert module.
  Map it to JSR in a scratch file, never committed:
  `{"imports":{"https://deno.land/std@0.224.0/assert/mod.ts":"jsr:@std/assert@0.224.0"}}`,
  and pass it as `--import-map=<file>` to `deno check` / `deno test`. To run
  `sh bin/gates.sh` unchanged, put a scratch `npx` first on `PATH` that adds
  that flag after `--yes deno@1.46.3 check|test` and hands every other
  call to the real `npx`.
- **The app sweep is now a normal gate**: `npm run verify:browser`.
  Playwright is a devDependency, so `npm ci` brings it. Chromium is
  preinstalled at `/opt/pw-browsers` in this container — do NOT run
  `playwright install` here; point the sweep at it instead:

        cd src && PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run verify:browser

  CI runs `npx playwright install --no-shell chromium` (the full Chromium, which the checks launch with
  `channel: 'chromium'`; never the headless shell) and needs no such variable.
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

Closed operations move verbatim into `docs/handover.md` Part 2, this ledger's archive: the 2026-09-05 → 09-21
sections under "LEDGER.md history, archived 2026-09-22", the 2026-09-22 → 09-24 sections under "LEDGER.md,
archived 2026-09-26", the 2026-09-25 → 09-28 sections, with the what-remains list as it stood on 2026-10-01,
under "LEDGER.md, archived 2026-10-01", the 2026-09-30 → 10-08 16:52 UTC sections, with the list as it stood on
2026-10-08, under "LEDGER.md, archived 2026-10-08", the 2026-10-08 16:59 → 18:35 UTC sections under
"LEDGER.md, archived 2026-10-09", the 2026-10-08 22:49 → 23:58 UTC sections under "LEDGER.md, archived 2026-10-09
(second)", the 2026-10-09 00:10 → 02:46 UTC sections under "LEDGER.md, archived 2026-10-09 (third)", and the 2026-10-09
03:20 → 22:53 UTC sections under "LEDGER.md, archived 2026-10-10", and the 2026-10-10 sections under "LEDGER.md,
archived 2026-10-11", and the 2026-10-11 sections under "LEDGER.md, archived 2026-10-14"; each oldest first.

### [2026-10-14 16:26 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Handover to Davies' other session tonight** (Davies, ~16:25 UTC: "今天20:00之后我另外一个session就恢复额度了，你这边所有盯盘和自动
  唤醒等全关了"). This session's Q2 watcher stops after its cycle at or before 20:00 UTC; **the two reading wakes it had set are
  DISABLED and must be set again by whoever owns the readings**: Coinbase "with Euros" on 2026-11-08 from 00:30
  (`trig_0155ojPaC5BmUSTGsoYKQuTL`) and "with Euros - 2" on 2026-11-10 from 00:30 (`trig_01BFEc2udBJhBFvKbdSBZgv9`). Q2 state at
  16:17: stop room $9.01 of $25 (basis −15.99; ALERT band, flat for hours), 30 fills since the restart, every closed market at
  a loss, rewards+rebates 0.27 c a filled share; no BUY resting at 16:17. Davies' standing word for the pending second
  post-mortem (`reviews/2026-10-14-q2-trips.md`, the LP-BEST agent): "代理修好后如果你觉得可以就直接推送更改实盘策略". This
  session recommended stopping Q2 (the undo: `update public.pm_lp_config set restarted_at = null where id = 1;`, which latches
  the 10-12 stop again, close-only); Davies chose to keep it running for now.

### [2026-10-14 06:46 UTC] Platform: Muse | Model: muse-wonder-full-1.0
- **IG deep dive: no live-ready strategy; one venue-transfer test and one quote-discovery test survive**
  (Davies: apply the PMSTATARB research and handoff architecture to IG CFD/spread betting, with real risk only
  after deep research). `reviews/2026-10-14-ig-deepdive.md` and `backtests/ig_deepdive/` add two reproducible
  measurements. FXW-AUD is pair-specific (EUR flat, GBP/JPY negative), positive in all four era splits and at
  12/20/30 bp assumed spreads, but a 60-minute entry delay leaves only +3.06 bps at 20 bp (t 0.66) and its
  maximum adverse excursion is 440.1 bps against a worst finished trade of -129.3 bps; the earlier leverage-12
  illustration is therefore explicitly not carried forward. Public IV-minus-RV gates worsen daily/weekly model
  straddle sales at 0.8 times Cboe indices, and contango gates remove rather than isolate the front-VX roll.
  `SPEC-for-verification.md` freezes G0-G4 and S1-S5 for Grok: actual entity/product facts, demo-only IG hourly
  history, a 12-weekend quote recorder, FXW transfer, WKND bias, ESG coverage, an IG option-bid audit and a
  stress-based wrapper packet. No IG account, credential, quote or order was touched.

### [2026-10-14 04:17 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **SCQ-1014, every stablecoin quotes row reviewed, not blind, no reading** (Davies: "我看variant-2比stablecoin quotes表现好不少？";
  `reviews/2026-10-14-stablecoin-quotes-review.md`, `backtests/scq_review/2026-10-14/`). Variant-2 leads per pound, not in
  pounds; at £50 a rung +£1.46 over "Stablecoin quotes": size £1.05, TAKE's 5 takes net +£0.21 (not beyond noise, none
  since 10-08), the twins' turn timing £0.19 (one refused exit, 10-13). LIVE tracks its twin (+£0.001 a day at £50, ±0.12);
  realised +£0.28, coins marked −£0.37. **For 10-21: PR5's paper engine logged 714 orders on 10-01 (`agent_quote_days`),
  over its spec's condition 5 (700).** The twins pay ~£0.02 a £0.10-print trip that LIVE does not (state it in readouts).
  Proposals only: LIVE's size at 10-21; stop `pr5` after 10-21 and `d` after 10-28 unless rule D passes; add nothing.

### [2026-10-14 03:47 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Addendum 22, no refills** (Davies: "同意 Addendum 22（取消补选）", on `reviews/2026-10-14-q2-day1-postmortem.md`, landed
  `3b7343e6`): `PM_LP_REFILL.maxPerDay` 10 → 0 and the idle alarm 30 → 360 minutes (with refills off it would fire every
  half hour a quiet book sits out). A dipped pick keeps its slot and quotes again when its programme is back. The refill
  mechanism stays in `pm_live.ts` (unchanged, its tests on Addendum 21's numbers, `A21_REFILL`); a new pin fails on the old
  constants. Also this sitting: Muse's four commits of 10-13/14 reviewed (0121, the paged live-hours read, the `?pwd=`
  service-worker fix, PMSTATARB): no fault found, CI and deploys green, Euros - 2 deciding since 10-13 00:00; its reading
  reminder moved to 11-10 00:40 (`trig_01BFEc2udBJhBFvKbdSBZgv9`); the 10-11 history archived.

### [2026-10-14 03:23 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Q2-PM, why Q2 lost on day 1** (`reviews/2026-10-14-q2-day1-postmortem.md`, `backtests/lpbest/`; "为什么还在亏"):
  13:26 → 01:59 live −$8.51. Against LP-BEST's +1.76 for the span: window −3.33; live's refill on a programme dip −4.80
  (refills lost $8.10 of $10.67), unpriced by LP-BEST; rewards −1.39 (x2's pause trips 13× the engine's: −0.87); fills
  −0.76. Rates re-price ~every 14 min, 89–98 % of quiet books dip under $10 daily, TRAIN/TEST alike; not caused by us.
  10-05 → 10-12: no refills beats live's +$2.27/day [+1.59, +2.88], 8/8 days; calibrated −0.74 → +1.47/day, 1.53 ¢/share.
  Proposal (Davies' call): Addendum 22, `PM_LP_REFILL.maxPerDay` 10 → 0, or stop. Nothing live changed.

### [2026-10-14 02:09 UTC] Platform: Muse | Model: muse-wonder-full-1.0
- **PMSTATARB handoff written** (Davies: each item's requirements and standards clear for Grok to verify).
  `backtests/pmstatarb/SPEC-for-verification.md` freezes the order, endpoints, entry hours, model, fill rule,
  neighbour parameters, five-part bars, acceptance checks and Chinese report shape for G1–G4 and TOUCH-CAL,
  BUCKET-DIST, KALSHI-LEAD and SPORTS-XCHECK. No peer session was reachable from this seat; the file is the handoff.

### [2026-10-14 02:02 UTC] Platform: Muse | Model: muse-wonder-full-1.0
- **PMSTATARB: the Polymarket statistical-arbitrage line taken stock of, two historical tests proposed** (Davies: absorb
  the earlier Claude/Cursor stat-arb research and look for new candidates worth testing; `reviews/2026-10-14-pm-statarb-deepdive.md`,
  snapshots in `backtests/pmstatarb/`). What stands closed, with its evidence: every locked identity (sets, ladders,
  YES+NO), favourites (out of sample), weather, sub-second crypto (PMSC), disputes, DEADLINE-NO (its frozen 2024
  test). Tonight's new measurement closes one more locked form — touch against terminal at the same strike: 45
  properly nested pairs under their settlement windows (Binance High over the title day vs the noon Close), none
  locks its $1 under $1 after fees (best 1.0079); the cheaper pairs are window mismatches. Bucket partitions sum to
  0.99–1.07 at mids. What is proposed, historical-first and unfrozen: TOUCH-CAL (touch calibration against the
  reflection relation at prints) then BUCKET-DIST (bucket distribution shape against a lognormal), a KALSHI-LEAD
  lead-lag measurement (both minute series verified keyless), and a SPORTS-XCHECK snapshot; the mechanical pulls are
  packaged as G1–G4 for another engineer in §5 of the review (no peer session was reachable from here). Decisions
  for Davies are §6 there. Research only: nothing built, armed or written to production.

### [2026-10-14 01:36 UTC] Platform: Muse | Model: muse-wonder-full-1.0
- **The `?pwd=` bookmark's "This site can't be reached" is fixed at the service worker** (Davies, same morning: the
  bookmark failed while typing daviesluo.com worked). The asymmetry: `/` is answered by the precache route itself,
  but `/?pwd=…` fell through to Workbox's NavigationRoute bound to `index.html`; on a precache miss (the banner
  purge, cleared site data, storage eviction — all leave the worker registered with an empty precache) that handler
  fetches `/index.html`, which production answers with a 308 to `/` (measured), and a redirected response cannot
  satisfy a navigation request. The root's own miss-fetch is a plain 200, so the root kept working. Now the fallback
  is bound to `/` and precache matching ignores `pwd` (`vite.config.js`), pinned twice: a unit pin on the generated
  `dist/sw.js` (fails on the old worker, checked) and a sweep check that deletes every cache under a controlling
  worker and opens the deep link, with the sweep's server serving production's 308 for `/index.html`. If the
  bookmark still fails on Davies' browser after this deploy, the `ERR_…` code at the foot of Chrome's error page
  distinguishes what is left (DNS would be a different fix, outside the repo).

### [2026-10-14 01:09 UTC] Platform: Muse | Model: muse-wonder-full-1.0
- **Euros - 2 verified running; the live/testing review landed; one display defect fixed** (Davies' three instructions
  of the evening, in order). At 21:22 UTC `0121` is applied and Euros - 2 has decided every minute from 00:00
  (5,120 rows, lag 3 min, no `agents.cb_hold` error): the "1022 min ago" Davies saw was its 60-minutes-a-run catch-up,
  current by about 21:20. **The review** (`reviews/2026-10-13-live-testing-review.md`, read-only production reads
  21:22–21:45, no config touched): the page's "REWARDS TODAY (EST.) $0 – $0" is a bug — `readLpLive`'s one-page read
  of `pm_lp_live_hours` (1,555 rows in 48 h) stopped at today 05:00, before every scored minute; with all rows the
  tile reads about $0.28–$1.01 ($0.98 of scored formula). Fixed here with a pin that fails on the old read (paged
  reads for the hours and the selection, their keys in `PAGED_KEYS`); display only. Q2's first eight hours: stop room
  $20.83 of $25, 14 fills (closed trips −5.3 ¢ a share, 60-minute markout about zero at n=14), 284 both-scoring
  minutes, 9 of 10 refills spent by 17:35, programme rates decaying under the $10 floor for most minutes — the review
  prices the candidates (programme stability, refill allowance, exit) as studies for after Addendum 19's bar, and
  gives every live/testing row a keep/cut/change verdict with six decisions for Davies (§3 there; D1 keep Q2 to its
  day-14 bar). Postscript read at 2026-10-14 01:08 before this landed: the 10-13 payout booked $0.8921 on $1.2409 of
  formula (R 0.72 whole — quiet books pay at the old books' rate; scoring minutes are the shortfall), rebates $0.6175;
  fills since the restart −$10.91 and the stop's room $15.60, so a first full day closing below −$10 is reported the
  same night, not at day 7. Euros - 2's first day closed at 510 orders, 2 trips, +£0.0851, still current at 01:08.
  Nothing live was armed, disarmed, resized or written.

### [2026-10-13 20:54 UTC] Platform: Muse | Model: muse-wonder-full-1.0
- **"Stablecoin quotes with Euros - 2" starts today** (Davies, 2026-10-13 evening: start it immediately, do not wait for
  2026-10-14 00:00 UTC). Deviation 1 of its pre-registration (§7) and migration `0121`: the still-empty record's
  `startedAt` moves to 2026-10-13 00:00 UTC (window to 2026-11-10 00:00, reading that day from 00:30; four whole
  weekends unchanged), guarded to a no-op once any minute is decided; `cb_hold.ts` and every frozen file untouched —
  a start at the minute of his word was not taken because the frozen reading buckets days from a midnight start.
  The first runs after `0121` decide 10-13's recorded minutes 60 at a time, each on its own minute's inputs, then run
  current. Item 12b updated. Post-deploy check: `startedAt` 2026-10-13, `last_minute` ~2 min behind, no
  `agents.cb_hold` errors (this session reads production through the site's agents payload, having no SQL connector;
  the SQL form is in item 12b).

### [2026-10-13 15:25 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Addendum 21** (live-prep only; Davies: "有问题立马修复"), from the watch of 15:16: Q2's first fill (20 NO at 0.85 in
  0xe612eb64…, 13:45) rested no exit once its book narrowed under 4 c, because the touch rule dropped a quoting market's
  sells with its buys. Now a narrow book rests only the sells of what is held. Pinned; counterfactual fails. The watch's
  other question, the OpenRouter "market share" market being selected, is Addendum 12's rule as written (typed "counts"
  first, pinned), so it stays. Also seen at 15:16: no BUY resting, every pick and refill either out of its programme or
  under the 4 c touch at that minute; that is Q2's rule (the engine priced it per minute), not a fault, and the watch
  carries on.

### [2026-10-13 15:40 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Q2-AGE** (the LP-BEST agent, resumed; `reviews/2026-10-13-q2-age.md`, `backtests/lpbest/scripts/q2age*.py`,
  `MANIFEST_q2age.json`; Davies: "好的 继续深度检验和验证这两个"). PMOPPS' "quiet books under 3 days old lose", through LP-BEST's
  engine with Q2 as live: chosen on TRAIN it is no filter (Q2 +4.10 / +4.23 TEST / +3.61 all at $316; 3-day minimum +1.43 /
  +3.61 / +2.48, paired −1.13 [−3.43, +1.56] a day), but the filter cuts the worst day −10.34 → −2.40 and the SD 40 %. On
  10-13 00:00 → 12:59 (re-extracted archive, a second span) Q2 −9.87, the filter +4.28: eight of eleven picks under 6 hours
  old, two (UNP earnings, a Rotten Tomatoes score) −$17. Young quiet books are not more toxic per share; they are busier,
  pay ~10× the formula and are 23 % of picks. PMOPPS' loss sat almost all outside Q2's candidate set. Verdict: not an
  addendum now, not dropped: draft B′, an offline replay on the live window plus the live record split by age, decided at
  day 14; an early flag to Davies if a −$10 day comes from markets under 3 days old. Nothing changed in code or config.

### [2026-10-13 14:26 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **DEADLINE-NO is closed: noise** (the PMOPPS agent, on Davies' "好的 继续深度检验和验证这两个"). Frozen first, alone:
  `reviews/2026-10-13-deadline-no-2024-prereg.md` + `backtests/pmopps/scripts/deadline_no.py` (sha256 `a8d664e4…`, theta.py's
  rule exactly, reproduced to the fourth decimal on 2025/2026), commit `74a6833b` at 13:45:25 UTC; the first 2024 file was
  written at 13:45:32. **2024 FAILS** (`reviews/2026-10-13-deadline-no-2024-result.md`): 71 trades in 59 events (bar 150/100),
  +5.6 % [−6.2, +17.4], one event 29.9 %. Deep check (description only): every 2026 market reads +1.8 % [−6.1, +9.3] (the
  held-out +7.1 % was the one-in-two sample); pooled 2024–26 T − 7 d +4.9 % [−0.1, +9.5] while T − 5/6/8/9/10 d read −3.7 to
  +0.8 %; the tape's real NO price plus today's fees leave +2.2 % (median) / −0.2 % (p75). No forward paper test drafted.
  The other lead (Q2 + age ≥ 3 days) was not this agent's part.

### [2026-10-13 13:48 UTC] Platform: Claude Code | Model: not recorded (session policy)
- Addendum 20 deployed (`a59d3205`); at 13:42 one mark was still missing (the Citigroup dust, a turn on the old code), at 13:45
  none: `openBlockedBy` null, 12 BUYs resting ($114.60) in the quiet picks, one carried SELL, stop room $24.91. A `sonnet-high`
  watcher runs a live-watch cycle every 90 minutes for 16 cycles (Q2's stop, picks, fills, rewards per filled share, the
  error box), messaging the main session each cycle and at once on any ALERT; it fixes nothing itself. Running too:
  DEADLINE-NO's frozen 2024 test (the PMOPPS agent) and Q2-AGE in LP-BEST's engine (the LP-BEST agent).

### [2026-10-13 13:39 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Q2 went live: restart at 2026-10-13 13:25:32 UTC** (the go statement of Addendum 19, its checks all passed; `restart_loss_usd`
  25, `max_markets` 12, `select_budget_usd` 320). The first selection read 60 books' trades (0 failed), passed over 46 busy
  and 510 narrow books, and picked 12 quiet ones; the stop opened at basis ~$0, room $25. **But nothing opened**: three dust
  holdings in two closed markets (4.2791 + 0.0031 shares in 0x0608b79b…, 0.0075 in 0x225b0d56…) had no mark, so every turn
  left the stop unjudged (four `agents.pm_lp` rows 13:26–13:29). **Addendum 20** (both pre-registrations; Davies: "有问题立马
  修复"): a holding under the 5-share minimum with no mark opens at 1, so it can only count as a loss (≤ $4.29); 5 shares or
  more still holds openings back. Pinned (fails on Addendum 19's `restartOpenMarks`); the hash chain moves to 20.

### [2026-10-13 13:18 UTC] Platform: Claude Code | Model: not recorded (session policy)
- Landed PMOPPS (the LP-ADVERSE agent, resumed after a usage limit; `reviews/2026-10-13-polymarket-opportunities.md`):
  nothing on Polymarket clears the bar for a new paper row now. DEADLINE-NO (NO at T − 7 days, YES 0.20–0.50) is the one
  lead (2025 +14.4 % a trade, held-out 2026 +7.1 % [−4.0, +17.0]); its draft A is a frozen test on unread 2024 first,
  waiting on Davies. Quiet books under 3 days old lost in-sample (draft B, Q2-AGE, a filter to price in LP-BEST's engine).
  Neg-risk sets, date ladders, disputes, new pools (POOLAGE closed), sponsored programmes and rebates alone: no-go.

### [2026-10-13 13:18 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Live-prep's Addendum 19, "quiet books"** (the LP-BEST agent wrote it; its tests and gates were blocked by the
  permission checks, so the main session ran them on Davies' "同意"): only books with ≤ 50 shares traded in 24 h (the data
  API, a failed read never quiet) and a touch ≥ 4 c, 2N a side, 90 % of the cap, a −$25 stop counted from a restart
  (`0119`). Rebased over `0120`, two doc conflicts kept both sides. Counterfactuals run here: INV_CAP 5, touch 1 c, a failed
  read taken as quiet, the 50-share bar ignored, the restart's limit ignored, the restart ignored: each fails its pins.
  Hashes in the addendum match the files (`pm_live.ts` 28930ad9…, `pm_lp.ts` 08be7827…, 0119 88437a19…).

### [2026-10-13 03:02 UTC] Platform: Claude Code | Model: not recorded (session policy)
- Landed `0120` (the LP-SPEED agent, resumed): the paper Reward quotes calls off, their page rows gone, the dashboard no
  longer reads them; checked by hand that live mode reads no paper layer (`pm_live.ts` `paper` is null unless dry-run).
  About 10,600 calls and 114,500 rows a day saved (2026-10-12's). Item 0b.

### [2026-10-13 01:35 UTC] Platform: Claude Code | Model: not recorded (session policy)
- Landed LP-BEST (`opus-high`): checked its validation by hand against the record (live −70.41 over the four days with 10-12's
  $7.96 paid; a quoting day −21.77; the engine −18.40 at the live calibration). Item 0a has the result and the open question.

### [2026-10-13 00:51 UTC] Platform: Claude Code | Model: not recorded (session policy)
- Coinbase Deviation 2 closed: fix deployed 00:10:57, `0117` applied, verify 8,786 minutes 0 wrong. Landed "Stablecoin quotes with
  Euros - 2" (the Coinbase review's agent, resumed: CLAUDE.md's reuse rule): the base test's files untouched, its own driver,
  call, tables (0118) and page row; eight Deno pins with five mutations each failing them; the sweep green by its hand run
  (682 checks) and again in this landing's full gates. Window start and reading date go into item 12b once it runs.

### [2026-10-13 00:08 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Davies, 2026-10-13: "Coinbase修复同意，周末变体写预注册然后上线paper trading 策略with Euros - 2 … live rewards继续停止，并继续研究
  最好的策略，所有地方都可以改，所有数据都可以用，然后给我讲讲我再评估下".** Landed: the Coinbase prereg's Deviation 2 and the
  `cbMinuteRow` fix with its pin (9 passed; with the old `reduce(f)` restored, 1 failed). Running: LP-BEST (`opus-high`,
  `reviews/2026-10-13-lp-best-strategy.md`, research only). Next: the repair migration after the deploy; the weekend
  variant "Stablecoin quotes with Euros - 2" (pre-registration, then its paper arm), after the fix, since it touches
  `cb_quotes.ts` too.

### [2026-10-13 23:47 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The three studies landed** (sub-agents' commits rebased onto `main`, one full gate run). LP-ADVERSE: 436 fills, 6,966
  shares, 42 markets, −129.43 = +100.56 half-spread −235.77 adverse 0–5 min −69.44 adverse 5–60 min +75.21 carried
  (checked: counts by query, the sum by hand); break-even R 1.80 on what ran; P1/P2/P4 priced, keep stopped recommended.
  LP-SPEED: Davies' hypothesis partly right (programmes change fast; fills come 3.4× chance in a post's first second) and the
  cure not (one fill in 118 programme changes fell in the detection gap; B and D, one taker sweeping or taking our touch, are
  97 % of the markout loss); the CLOB reward read's `max-age=5` checked by hand. Coinbase: recorders healthy, no gap in the
  window; the minute-record defect checked by query (item 12); its fix held back for Deviation 2.

### [2026-10-12 23:05 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Resumed from `787d878` (a Claude Code session had died; nothing in git after 10-11 04:30). Watch 22:54 UTC: URGENT.**
  Live-prep's −$75 total stop tripped 07:30 UTC 10-12 (`loss_stop_total`: fills −129.35, paid 38.10, rebates 10.02, basis
  −81.24); at 22:54 basis −81.12, pUSD 284.12, equity 316.34, ~$35.5 held at mid; 3 sells resting, 19 filled since the
  stop. Rewards are not the problem (10-11 R 0.81, pooled 0.75); the fills are: −$80 since the 10-11 handover, the
  MrBeast view-count markets about −$74 of the whole record. Two notes for the studies: a replacement sell for 10 shares
  refused on a 7.5-share balance (15:02), and refills still taken after the stop (07:32, the day's 8th). Error box since
  10-11 03:15: the stop, five single network blips. PR5, `trend-4h-live`, the monitor's dead-man and the tick all healthy;
  the site serves `app-e9c6998b.js`, main's CI green; four dependabot PRs red (not urgent); #235 stale.
- **Davies' decision (~23:00 UTC):** "保持止损，开始做逆向选择研究，并深度研究优化策略（目前的表现太差了），所有数据都能看，所有文件
  都能改，策略的实际良好运行更重要"; his hypothesis to test, that the reward markets change fast and fill fast, rewards gone
  soon after we post, which paper could not see, and whether a one-second reward check would answer it; and "coinbase上线后
  情况如何". Three sub-agents (two `opus-high`, one `sonnet-high`), each a review under `docs/agents/reviews/2026-10-12-*`.
