# Ledger

Real balances and amounts are masked as `[•]` (Davies, 2026-10-21: the repository is public): what his accounts and
the live strategies hold, made or lost. Settings, caps, paper and backtest figures and the tickers stay. Write `[•]`.

The live handover record for this repository, under the ledger protocol
in `.agents/skills/ledger/SKILL.md`. Read this file first on any resume; it is kept
small on purpose. The deep record — the full decision log and the raw
session transcripts — is `docs/handover.md`, which is this ledger's ARCHIVE
and is opened only when a closed item is reopened or audited. The commit hook refuses it over 100 KiB
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

0a. **(History since 2026-10-13 13:25:32 UTC, when Q2 went live under Addendum 19: the live state is 0a″ and 0a′.) LIVE-PREP STOPPED: its −$75 total stop tripped 2026-10-12 07:30 UTC, and stays tripped (Davies, 10-12 ~23:00 UTC:
   "保持止损").** Close-only since: no buy rests, its sells do; nobody clears the stop (`pm_lp_events` `loss_stop_total`).
   Three studies run (history 2026-10-12 23:05): the live fills' adverse selection and a deep optimisation, Davies'
   reward-timing hypothesis with a 1-second speed study, and Coinbase's first days. Their proposals go to Davies; a rule
   change is an addendum on his word, and a restart is his call alone. The 10-16 end-rule read still runs as written.
   **Results (landed, history 2026-10-13 23:47):** LP-ADVERSE (`reviews/2026-10-12-lp-adverse-selection.md`): the fills lost
   to one-shot takers (adverse −$[•] in the first hour against +$[•] of half-spread); live realised a fraction of the formula
   because carried stock held the cap; no priced package clears $0 with confidence; it recommends staying stopped, and P1
   (no quote after a 10 c hour, touch ≥ 3 c) if Davies wants it back. LP-SPEED (`reviews/2026-10-12-lp-reward-timing-speed.md`):
   programmes do change fast, but no fill came while a programme was out, paper's fills were as adverse, and a 1–30 s loop is
   worth +$0.3 to +$2.0 a day (the CLOB reward read is cached 5 s); change no cadence. Davies chooses.
   LP-BEST (`reviews/2026-10-13-lp-best-strategy.md`, `backtests/lpbest/`; Davies, 10-13: "继续研究最好的策略…给我讲讲我再评估下"):
   a simulator calibrated to live (−$18.40 to −$24.96 a day against live's −$[•]) finds quoting a tick inside the touch loses
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
   (`ac162cc9`; Addendum 18 seen working: `state.lp.refill.deferred` set at 02:22 with $[•] free), stop basis −$[•]
   (fills −[•] marked at mid, rewards [•], rebates [•]), **room $[•]**; error box empty since 00:12; PR5 fresh.
   `state.pnl.total` is the fills alone, never the stop's number (the skill's Step 2). Dates: 10-13 forward tests and
   LP-RULES item 1; **10-16 ≥ 01:00 the 7-day end-rule read with `backtests/pmlp/lp_readout_a18.sql` only** and the $40
   buffer re-read; 10-22/23 LPRESEL6, TB1 C1, 14-day readout. The interview showcase is no longer
   maintained (Davies, 10-23).

0a⁗. **LIVE-PREP LIQUIDATING (Addendum 24, live since 2026-10-15 16:23:55 UTC; Davies: "那目前的单都尽快卖出掉吧，还剩多少").**
   16:26: 6 NO 0x76051f8c at 0.27 and 40 YES 0x7465aead at 0.12 sold, 10.2 of 80 YES 0xecc209a6 at 0.002 (pUSD [•] →
   [•]). **Addendum 25 (pushed with `f7eed09f`, `agents` deployed 16:50)** books those taker trades; read-only 19:14 UTC
   10-15: 308e1767, cd415cc7, 7d6f857f in `pm_lp_fills`, `last_error` null. (16:23:55 is `0123`'s apply; its reader deployed
   16:25.) **Disarmed by `0125`** (applied 15:24 UTC 10-16; its header's read: largest unsettled holding 4.2791, nothing
   resting; item 15's 15:38 check read `live_confirmed_at` null): only dust is left, to settle and be redeemed.
   `liquidate_at` is still set as far as this ledger knows; clear it with
   `update public.pm_lp_config set liquidate_at = null where id = 1;` (Davies' call, PMPOST's proposal).
   **The seven-day read: done 2026-10-23, late** (R 0.7156 over 220 market-days, the restart's days 0.7642; no trip;
   `reviews/2026-10-23-lp-reads.md`). **The 14-day readout: read 2026-10-28, a day late; Addendum 19's bar FAILS**
   (rewards 0.769 c a filled share against 1.5 c, the total since the restart negative; `reviews/2026-10-28-lp-reads.md`):
   Polymarket rewards end, as the disarmed path already is. Its `pmlp`/`pmlpreserve` calls still run (Davies' call).
   Davies, 2026-10-20 (Portfolio Project group): live-prep's wind-up (`liquidate_at`) is left as it is for now.

0a‴. **Q2 CLOSED, close-only, 2026-10-15 00:08 UTC** (Davies: "看一下最新的rewards payout，还不行的话就关了然后只卖出"). 10-14 paid
   $[•] on formula $[•] (R 0.71); since the restart rewards+rebates $[•] over 718 filled shares = 0.61 c a share, under
   the 1.5 c bar; stop room $[•]. Ran `update public.pm_lp_config set restarted_at = null where id = 1;` (returned null;
   `dry_run` false, still armed so the exits work): at 00:10 `openBlockedBy` = `loss_total`, 3 SELLs resting, no BUY. The held
   lots exit on their own; no restart without Davies' word. Item 0a″ below is superseded.
   PMPOST (10-15, `reviews/2026-10-15-pm-postmortem.md`): not viable; its calls-off proposals wait for Davies.

0a″. **URGENT for the next session: Q2's stop room was $[•] of $25 at 17:47 UTC 10-14** (basis −[•]; 0x7465aead "Democratic
   Senate odds 60-62% on October 16?" 40 YES at cost $[•], mid 0.15, −[•]; 0x6eed2a46 20 YES bought again 17:40). The −$25
   stop trips by itself at room 0 (close-only, nothing to do); this session recommended Davies stop now with the undo below;
   no answer before the 19:00 UTC handover. First read `state->'lp'->'stop'` and `trippedAt`. Then after 00:05/01:20 UTC 10-15
   read 10-14's payout and rebates (rewards and rebates per filled share since the restart: 0.27 c at 16:17; the bar, 1.5 c, counts rewards alone).

0a′. **Q2 live, the second post-mortem (`reviews/2026-10-14-q2-trips.md`, landed 2026-10-14 ~16:45 UTC): no rule fixes it.**
   15 of 16 lots lost to informed takers and the drift while held (16 lots −[•]: entry edge +[•], first minute −[•], held
   −[•], exits +[•], residual −[•]; the review's erratum); of 27 rules none clears $0 at its 5 % bound on both spans or the 1.5 c bar on the live window. The
   main session did NOT push its draft Addendum 23 (entries 4 c from the adjusted mid: 0.77 c a share live, under the bar),
   though Davies' standing word allowed a fix to go live. **Recommended to Davies: stop for good** (`update public.pm_lp_config
   set restarted_at = null where id = 1;`, close-only, held lots exit); his call, live still running, stop room ~$[•].

0c. **The audit of 2026-10-14 evening (history 2026-10-14 20:11; PR on `claude/audit-2026-10-14`): four calls for Davies.**
   (1) and (2) **built as Addendum 23 on his word** (2026-10-15, "Addendum 21和Addendum 20都修复了"; history 15:20;
   pushed, `agents` deployed 15:27 UTC 10-15). (3) **`origin/lp-skew-ft`
   (Grok, 10-11) must not be merged:** its `0117_lpskew.sql` collides with the applied `0117_cb_minute_extremes_repair.sql`,
   its pins hold Addendum 18's `pm_live.ts`/`pm_lp.ts` bytes, its base arm is the S2 that Q2 replaced and its window
   (10-12 → 10-19) has passed unrun; close it. Davies, 2026-10-20 (Portfolio Project group): delete the remote branch
   `lp-skew-ft` (deleted 2026-10-22; `audit-2026-10-14` and `hopeful-planck-acdq5g` not approved). (4) **SPCX: closed** (Davies,
   10-15: the Trading 212 and board share counts of SPCX, RKLB and HOOD are fine; [•] elsewhere plus T212's [•]).

0b. **Every PAPER Reward quotes test is off (Davies, 2026-10-13: "目前paper testing里的reward quotes全关了吧？感觉都不赚钱没什么
   意义？"; `0120`).** Off: `pmrwc`, `pmrwc-select`, `pmrwc-e`, `pmrwc-x`, mid-pool (`pmmid`, `pmmidprep`), live-prep's paper layer
   (`pmlpprep`) and `pmprog` (with the `pm-prog-refresh` cron). On: live-prep's live call and `pmlpreserve`, the recorder
   (`pmrec`, `pmrec-meta`; off with the view recorder and `pm-rec-prune` by `0137`, written 10-23, records kept). TESTING shows no Reward quotes row. Withdrawn, each noted in its pre-registration: RW-C's verdict,
   RW-X4/X5's Test 2, TB1, RWC-OPT, mid-pool's readout and audit and its funded draft. LPRESEL6 was withdrawn 10-23 (history 10-23 02:10). **Davies' wakes:** `trig_01XwUUNT5yXL3pzHoyH4JLaG` (10-17) is moot; `trig_018MBeyZsWkLBmbMq9ta3GNf`
   (10-23) fired: live-prep's 7-day read done, its 14-day readout not yet due, LPRESEL6 withdrawn. Item 2's paragraphs on those tests are
   history from here.

1. **Closed: fp5's ranked list.**

2. **Polymarket reward quotes (paper; RW, RW-E, RW-X, TB1, RW-C) and the three order paths (dry-run, unarmed).**
   - **Live-prep's Addenda 9–17 are live** (the reward check, FUNDED and the early readout, FUNDED at once: $[•]
     booked 02:32 UTC 10-10; AI markets out; the refill, `b84cec4f`, ten refills 14:23–14:52 UTC; the $10 loss guard,
     `65650793`, 15:02 UTC; Addendum 15, the reserve ranked once a day at 00:00, `rerankEveryMin` 5 → 1440, pushed
     10-11 on Davies' "同意" of 10-10 23:59, quoted in the addendum; its programmes still read every minute;
     no migration, `pm_live.ts` unchanged; Addendum 16, a carried market in a one-tick book rests its exit, and 17, the
     caps fund whole markets in rank order on Davies' "按照你推荐的来" of 00:29 UTC 10-11, both pushed 10-11). Its paper layer's calls were turned off by
     `0120`. Left for Davies: ranking on a rate that does not flip within the
     hour (not built).
   - **LP-RULES (10-11): no rule change today** (`reviews/2026-10-11-lp-rules-audit.md`). Reads it leaves: capital held
     by carried stock over 10-11 → 10-13 (its triggers and three options for Davies are in the review); TB1, near-end
     inventory and 3N/5N by 10-23 (LPRESEL6 withdrawn).
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
   - **LPRESEL6: withdrawn 2026-10-23** (`reviews/2026-10-23-lpresel6-withdrawn.md`; frozen at `242596a1`, its file untouched;
     Davies: "选择你来决定吧", the main session decided). Archive and rows kept; nothing pending.
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
     null; a trigger refuses arming two at once; one account, unfunded: pUSD $[•] at the last read). **mini-pool**
     (`pm_live`, `0074`/`0076`/`0080`, `reviews/2026-10-01-polymarket-live-calibration.md`): every check window closed
     by Addendum 7 (2026-10-04); not a go-live candidate; off TESTING, and `pmlive` and `pmprep` off, when `0103`
     applies (Davies, 2026-10-08: "按你说的停掉mini-pool的两个调用"); config row untouched (nothing arms). **live-prep (S2)**, the lead
     candidate, with TB1's skip of a one-tick touch since its Addendum 2 (2026-10-08, Davies' word; pinned in
     `pm_lp.test.ts`, deployed with the next push of `agents`) (`0091`, `agents/pm_lp.ts`, `reviews/2026-10-04-polymarket-lp-prereg.md`): P1 checked 2026-10-07 20:22
     UTC with `backtests/pmlp/lp_check.sql` (sha256 `7e94b042…0a57`): (a)–(e) and (g) PASS, (f) FAIL on funding alone.
     Before Davies' go, in order: P2 pUSD ≥ $81 in the account (read $[•] on 10-09 00:00); P3 met in code (the
     payouts-per-path change applied 2026-10-08, live-prep's Addendum 4, mid-pool's deviation 5; it deploys with the
     push that lands it); P4 mini-pool and mid-pool unarmed (both are); P5 the probe's read of the conditional-token
     allowances: built on branch `pm-prego` (2026-10-09 01:06 section below), read after its deploy with
     `GET agents?action=probe&only=polymarket&forceFunctionRegion=eu-west-1`, `polymarket.conditional.sellsApproved`
     both true; the go-live audit's fixes and live-prep's Addendum 5 (`pm_live.ts` `a208878b…`) land with it; the monitor's freshness reading for `pm_lp_state` is built (`monitor/health.ts`
     `pmLp`, three minutes); then step 8lp, only where he says go. Not measured: the selection's CPU over about
     1,379 markets. **mid-pool** (`0081`/`0084`, `agents/pm_mid.ts`, `reviews/2026-10-02-polymarket-mid-pool-prereg.md`;
     day-1 check PASS 10-04) — **WITHDRAWN 2026-10-13 (`0120`, item 0b): nothing below runs; the 10-17 wake fired and
     stood down.** As it stood: run `backtests/pmlive/mid_readout.sql` once at or after **2026-10-17 00:10 UTC** (wake
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

3. **The crypto loop: rows RETIRED (`0158`, applied 10-28), its tick call OFF (`0160`)** (Davies, 10-28: "把实盘的Trend 4h和测试的
   Trend 1h Trend 4h删了吧…"; on the tick, "你来决定"). Push order: the monitor commit first (drops `tickBeat`/`tickTurn`;
   PR5's `quotes` is the loop's one reading), wait for `edge-functions.yml` to deploy `monitor` and `monitor-deploy.yml`
   the Worker, then `0160` (`migrations.yml`). After it applies: `edge_calls` row 1 `enabled = false`; no
   `agents?action=tick` beat after it; the Worker's loop check green; `agents.tick` silent. The day PR5's call goes off,
   the monitor needs another loop reading in the same push. This item as it stood: `docs/handover.md`, "LEDGER.md,
   archived 2026-10-29 (fifth)".
4. **PR5 (GBP stablecoin quotes): live executor LIVE since 2026-10-01 16:29:53 UTC at £10 a rung; the paper test decides
   PR5 on 2026-10-21** (spec `reviews/2026-09-23-pr5-paper-test-spec.md`, six conditions; wake
   `trig_01QsXPKHc6Nt6NK3BJmbB2RY`, 10-21 15:40). Every verdict below says the paper tests ran beside a live executor
   from 16:29:53 that day. Watch with reference §4 item 35's L1–L5 on `mode = 'live'` (a filled entry gets its exit
   next turn; nothing `pending` past 2 minutes; the state row under 3 minutes old). The monitor's dead-man
   (`monitor?action=deadman`) cancels every resting order when the state is over 3 minutes old. Kill switch:
   `update public.agent_quote_live_config set live_confirmed_at = null where id = 1;` (entries cancelled, exits and
   stops stay armed); `global_pause` cancels everything.
   - **10-21 verdict (`reviews/2026-10-21-pr5-paper-test-review.md`): conditions 1–5 pass and 6 is recorded under the
     review's deviation 7 (Davies 10-21: loosen the self-set 700 instead of changing the rule; condition 5 reads ≤ 900 a day,
     the live governor's entry limit); as first worded, 5 missed (714 on 10-01). Re-price budget not needed. Placement timing
     replayed (LIVE-faithful): earlier is worse (0 s −£0.25, 10 s −£0.20, both 90 % bands below 0): the code stays. Davies 10-21: "A，引擎也继续运行，但要确保模拟的真实性和实盘策略完全一致，不一致的地方就直接改"** — LIVE stays at £10, the
     engine and minute record keep running. Sim-vs-LIVE audit `reviews/2026-10-21-sim-vs-live-audit.md`: the twin layer gains
     LIVE's fill rule (`fill`, opt-in) and the replay LIVE's operations; `0136` adds "Stablecoin quotes LIVE twin" (`live`,
     £120, the rule, backfill = LIVE's life replayed; prereg `reviews/2026-10-21-live-twin-prereg.md`, read 11-23; deploy
     before 10-24, the beats it catches up from are kept ~3 days); condition
     5's re-price budget drafted (`reviews/2026-10-21-pr5-reprice-budget-draft.md`), not in force. The notes below are history.
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
     one row each of `agent_quote_twin_specs`: `pr5`, `p50` = variant-1, `take50` = variant-2, `take50wk` = variant-3 (`0130`, 10-18), `d` = variant-4 since `0130` (variant-4
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
   - **The review of 2026-10-18** (`reviews/2026-10-18-stablecoin-quotes-review.md`, not blind; history 2026-10-18 04:00):
     best Revolut X testing row variant-2 (`take50`); for LIVE only size (10-21) and weekends survived the replay; a Revolut X
     weekend paper row is drafted, NOT frozen (`reviews/2026-10-18-revx-weekend-prereg.md`): Davies' word to build it, deploy by
     10-23 for four weekends, read beside PR5-W on 11-25. PR5-W's result should name this review (it replayed PR5-W's rule on
     its first forward weekends).
   - **LIVE's take switch 'shadow' since 10-18 05:17, weekend switch 'live' since 21:06:04** (`0131`; Davies 10-18 "…会的话就加上，然后加上周末的挂单，
     一定验证好没问题再推上实盘部署"). Plan and go statements: the live design's addendum of 10-18. Weekend shadow read 10-18 20:20:
     all eight criteria pass (the addendum's log). 'live' (Davies 10-18: "没问题的话就直接live也行") set 20:28:05, back
     to 'shadow' 20:28:43: inside a closure 'live' acts at once on the replica, which was `late`, and 11 £10 entries went out at
     20:28:27, all cancelled by 20:29:26 with 0 filled. Re-set to 'live' at 21:06:04, outside the closure (PR5's
     minute 21:04); first trading Fri 10-23 21:00. Take shadow read 10-23 18:05 (five weekdays): 0 events, not a fail,
     'shadow' kept (the addendum's log). Read again 10-30 18:00: 47 events, 2 opportunities, (a)–(d) pass. Davies 10-31: stays
     'shadow'; TAKE-DEPTH from 10-31 04:00 (no take through £1 of coin or less); no take inside an FX closure (10-31). LIVE 'live' since 10-31 02:10:43 on Davies' word ("RX USDT/GBP上"); RXU 'shadow'. Next:
     read the first live take (fill, fee, exit) against (a)–(d).
     **Review 10-26** (`reviews/2026-10-26-stablecoin-quotes-review.md`): "+64.9 %" right but realised-only, half one weekend.
     **LIVE at £600 since 2026-10-27 03:09 UTC** (Davies; §8): his two maker conversions for the asks' coin. Since 10-28 an operator's
     conversion left under the bid goes again at the top for its remainder (history 10-28 19:48). `0144`:
     `live600` "LIVE twin" (bar 11-11), `live1200` "variant-1" £1,200 from 10-28 (prereg `live-next-size`, bar 11-11: ≥ 80 % of
     `live600` per pound, no loss-stop day), `live300` off; compounding (`0146`) built OFF, his switch (review §9.3); `live` "variant-2" £120, weekends from 10-30; `pr5`, `p50`, `d` off by `0151`
     (10-28 readouts); `take50wk` off. `0142`: `take50` "variant-3" on the page; Coinbase "with Euros - 1" (hold, 11-10) and
     "- 2", the USDC arm at £25/€25 (prereg `cb-usdc`, 14 days, bar > 0, ≥ 8 %/yr, ≥ 5 bps a trip).
     **PR5-OPT 10-27** (`reviews/2026-10-27-pr5-rules-optimisation.md` §4): five twins on LIVE's rules against `live600`,
     (**renumbered by `0167`, 10-29**: the page counts 1 to 6, `live1200` 1, `take50` 2, `n600no03` 3, `n600hold1` 4, `n600usdt3` 5, `n600usdt` 6; `live` off and hidden, `n600usdt2` hidden and running)
     variant-4 to -8, restarted by `0152` as `n600no03`, `n600hold1`, `n600usdt2`, `n600usdt3`, `n600usdt`, started at once
     by `0154` from 10-28 22:00, read on or after 11-25 22:00 (prereg `pr5-opt-twins-now`, deviations 1-2; history 10-28 19:56,
     21:00); 0148's three and 0149's five (`o600*`, start conversions unweighted) off. After deploy: each `n600*` turns nothing before 22:01 on 10-28, then
     converts as the prereg's §1 table says (£199.98/£99.99, £225/£75, £300/none; no 0.3 % and hold £1: £150/£150).
     **Audit 2026-10-19:** the read's eight criteria are not the addendum's step 2: its "`late` is false" was dropped (the
     replica was late), variant-3 was not compared (no orders before 10-23), and 900 of the closure's 2,880 minutes were
     read. The executor never reads `late`; only the rule "set 'live' outside a closure" keeps a late copy from trading.
     Pinned since (tests only): no weekend entry unless the entry book is live, no weekend source outside a closure, no
     take shadow when not `allowed`. **Davies, 2026-10-20 (Portfolio Project group): the weekend stays 'live', and the
     take read counts the weekend** (10-23's closure gives the take shadow fair inputs; its `take_shadow` events count).
     **Revolut X's outage of 10-20** (reference §4 item 35, archived history 16:22 and 17:45): no stuck order filled; 7229
     and 7230 settled `rejected` by the main session on Davies' word; since `e1439f32` the errors box hears a live fault once,
     hourly and on recovery, and an order shown nowhere for an hour is parked (still pending, looked for every 15 min).
     Until `ops-error` deploys, read `ops_errors` for these, not the box. `7ed60689` hides an hourly guard fault with no
     state word (the dead-man beat, `agent_risk` unreadable, balances unreadable, the loss stop), a `LEASE CLAIM FAILED`
     written every minute, an intermittent `agents.quotes_weekend` fault, and `grokpm.redeem`. This branch shows each,
     and folds the same fault to one line per hour (its count and its latest time); a different order or redeem stays
     its own line.
   - **The review of 2026-10-09** (`reviews/2026-10-09-stablecoin-quotes-review.md`, not blind). **F1 built on Davies'
     word** (10-09: a buy-back at the venue's £0.10 minimum buys what its whole penny buys, LIVE and every twin; the twins'
     deviation 3, p50's deviation 2, TAKE's addendum 2, the live design's addendum). After its deploy: the next LIVE or
     twin buy-back worth £0.10–£0.11 has `base_size` = floor(£0.11 / price), is debited £0.11, and the rung reads flat.
     The 10-21 and 10-28 readouts count such buy-backs before and after the deploy. Every reading named here should
     cite the review as a non-blind read.
   - **PR5V and rule D, read 2026-10-28** (`reviews/2026-10-28-pr5v-ruled-readings.md`, not blind): PR5V **PASS** (5 of 5;
     paired +$0.743/day, p 0.0000), rule D **FAIL** on condition 3 (paired +$0.055/day, p 0.1825). **For Davies:** both
     pre-registrations stop their arms at the reading unless he says otherwise: `quotesv`/`quotesd` still run (calls off,
     rows kept, on his word). A PR5V pass moves no money. Twins `pr5`, `p50`, `d` read and off by `0151`.

5. **Closed: the studies of 2026-09-26/27** (reference §3.37–§3.42). Two notes: the view recorder stops with `0137` (10-23, its record
   kept), and its study was never pre-registered; PMLATE's and SPEED's post counts read one page of the
   post tracker, so re-run them with HARVEST's paged reader before any post-count idea is taken up again.

5a. **The seven measurements of 2026-09-27, frozen 2026-09-28** (`reviews/2026-09-27-testing-portfolio-review.md`,
   reference §3.43):
   1. **JEV-DRIFT: done** (option (c), 2026-09-28; reference §4 item 43).
   2. **MX-1: closed 2026-10-28, undecided** (7 eligible exits of the 60 it needs; no event can be added once `0158`
      retires the trend rows): `reviews/2026-10-28-trend-rows-retired.md`, its deviation 1. Wake
      `trig_01Dm3nw4TbBm2GCX2z12tN7o` (Mondays 06:37) to be disabled (Davies).
   3. **RW-NEXT:** slip check done 2026-10-08 00:33 (WARM, no slip); what is left is RW-C's (item 2).
   4. **QUEUE** (`reviews/2026-09-28-queue-prereg.md`; window 10-04 → 11-01). Freeze line until the export: none of
      `agents/books.ts`, `agent_book_levels`, its prune job, `stepMinute` in `agents/quotes.ts` or
      `agent_quote_minutes` changes, but a longer retention on Davies' word; anything else is a deviation (deviation 1,
      10-03: the book table may be read by other checks; the reading says it was not blind). Dry run done 2026-09-30
      (no deviation). Dates: Kraken's spare pull DONE 2026-10-18 06:23 UTC
      (`backtests/queue/kraken/`, 721 bars each from 09-18 06:00, covers 10-03 21:00); the scorer and checks 1–3 **committed 2026-10-24**
      (`backtests/queue/scripts/score.py` sha256 9f8f805d…, `qsim.py` 552540b9…; every file's sha in
      `reviews/2026-10-24-queue-scorer.md`, pinned by `src/queue_scorer_prereg.test.js`; synthetic only, `check3.txt`,
      `test_score.txt`; the data steps and their dates in `backtests/queue/MANIFEST.json`'s `run`); the export after 11-02 00:10 and before **11-06 10:25 UTC**, the tape after 11-02 00:10 and
      Kraken's main pull on 11-02 between 00:05 and 19:59 UTC (wake `trig_01Q3DV4MArsf3tQ1Po8yCh1X`, 11-02 00:40); if
      check 4 has not passed by **2026-11-04 00:00 UTC**, a longer retention goes to Davies.
   5. **PR5-R:** read after PR5's four weeks, before the 10-21 review (item 4).
   6. **PR5-W** (`reviews/2026-09-28-pr5-weekend-prereg.md`): the same freeze line as QUEUE's until its reading. Dry runs
      and arm 3a's candles done (2026-09-28 and 09-30; hashes in the archive). Dates: arm 3b's first export after
      2026-11-01 21:02 and before **2026-11-05 10:25 UTC** (the 11-02 wake); the count script committed before
      **2026-11-25 00:05 UTC** (wake `trig_01Ecb6B2TUMRhvYiyc3a8BuE`, 11-20 09:20); the reading, with 3b's second export,
      on 2026-11-25 from 00:05 UTC, 12-23 at the latest (wake `trig_01JVzTyxtpoSkB7Wgw2eRkqk`, 11-25 00:40). At the 10-21
      verdict, ask whether PR5's paper engine keeps running to it (item 4).
   7. **EX-GAP: closed 2026-10-28, undecided** (2 pairs, mean gap +3.73 bps; the live arm retired by `0158`, so its
      2027-01-31 reading is recorded now): `reviews/2026-10-28-trend-rows-retired.md`, its deviation 1. Wake
      `trig_018Ni6ydYybx39fE2wn7ZLeo` (the 1st, 09:23) to be disabled (Davies).

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
     rows then. RW's tables (134 MB): Davies, 2026-10-20: drop them after RW-C's 10-23 verdict. That verdict will not run
     (withdrawn 10-13 with `0120`: `reviews/2026-10-02-polymarket-rw-rest-prereg.md`, "Withdrawn (2026-10-13)"), nor will
     `mid_audit.sql` (item 0b). RW's page and readers left on 10-21 (`4729e015`: `pmrw_view.ts`, `pmrwc_view`'s tests,
     `pm_prog.ts`); its engines and replays (`pmrw*.ts`) stay, as does every `pm_rw_*` table. Still reading them: pm-rec's
     source list (`agents/pm_book_rec.ts`, `PM_REC_OURS_SOURCES` "RW" and "RW selection"; a source it cannot read is skipped
     and named every run, so the drop's migration takes those two lines out with it) and POOLAGE, parked (item 6b). The
     drop is a migration and waits on his word alone (audits 2026-10-21 and 10-22). `pm_view_books`
     stops growing with `0137`. Since `0101` (2026-10-08) the order paths' dry-run record keeps 14 days (from
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
   **The blackout's BLS dates are verified** (2026-10-17 ~19:10 UTC, https://www.bls.gov/schedule/news_release/cpi.htm and
   https://www.bls.gov/schedule/news_release/empsit.htm): CPI 11-10 and 12-10, Employment Situation 11-06 and 12-04, each
   08:30 ET, 13:30 UTC once US summer time ends 11-01; `agents/cb_releases.ts` holds the same four instants. Its comments
   still say recalled/UNCONFIRMED: left alone, since changing them redeploys `agents` and `src/cb_blackout.test.js:42` pins
   the word (change both together with the next `agents` change).

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
   **Since 2026-10-29 this arm is shown as "Stablecoin quotes with Euros"** (display only) and the base test is off the page,
   deciding on as bar 6's control. **After the 11-10 reading:** switch off the base test's deciding (cb_quotes.ts' loop in
   `cbrec`) but keep its EUR/USD and Coinbase USDT-USD fetches, which every Coinbase arm reads (base prereg Deviation 6).

13. **Coinbase's order books recorded, ten levels a side: live since `96a9da37` (10-10); KEPT and used** (Davies, 2026-10-18:
   "cbbooks留着并利用起来，和revolut x的订单簿一样可以做策略研究"; this replaces the 10-18 review's "retire by 11-08 unless a study is
   pre-registered"). Reference §4 item 59, migration `0114`, `agents?action=cbbooks`; health: `select last_error, last_report from
   cb_book_state`, no `agents.cb_books` row in `ops_errors`. **First study CBBOOKS-1** (`reviews/2026-10-18-coinbase-books-study.md`,
   `backtests/cbbooks/`, rules frozen in `params.json` before results, not blind): the Coinbase paper rows' fills all real (through
   prints, post-only accepted; slightly conservative); Coinbase leads Revolut X, no better fair for PR5; a touch maker on Coinbase
   dead; **XV-1, a Revolut X maker hedged on Coinbase, drafted NOT frozen; fees read 10-18, fortnightly the cadence, recommended not to freeze (about 1.2 % a year on £23–30k with a £16–21k dollar position; history 05:50)** (`reviews/2026-10-18-cross-venue-maker-prereg.md`: an
   offline reading 10-18 → 11-15, read by 11-19; needs both venues' transfer fees read first, and Davies' word). **R1 decided and built
   (`0132`, history 2026-10-18 05:16):** `cb_print_minutes` keeps the prints 40 days; R2–R4 no change. **After `0132` applies:**
   `select count(*), min(minute), max(minute) from cb_print_minutes` (rows from 2026-10-08/09, the newest within ~12 min), the
   `cb-print-minutes-build` runs in `cron.job_run_details` succeeding every 10 min, and
   `backtests/cbbooks/sql/verify_print_minutes.sql` with its stored-table swap returning the MANIFEST's five md5s. **Read
   2026-10-20 ~02:00 UTC by Grok Bot, outside the repository (reported in the Portfolio Project group; not re-checked by
   the 10-20 audit, which has no database): all three pass, 46,043 rows, `cb-print-minutes-build` 266 of 266 runs
   succeeded, the five md5s equal the MANIFEST's.** Note: `cb_trades.side` is the aggressor's (the recorder flips Coinbase's maker side).

14. **IG verification: S1a passes** (Davies, 2026-10-15; spec `backtests/ig_deepdive/SPEC-for-verification.md`, review
   `reviews/2026-10-15-ig-verification.md` §9). The `ig` function and `0122` are live (demo, read-only). S1a on 50 of 51
   frozen weekends of IG's spread-bet demo history: all five transfer conditions pass (median opening spread 10.1 bps,
   gap correlation with FXCM 0.957); 10 trades at IG's quotes +30 to +38 bps, t 3.2-3.5, not blind. Next: S1b, the
   weekend recorder's twelve Sundays from 10-18. Window 2025-11-28 was re-pulled 16:15 UTC 10-16 (51 of 51); S1a's
   committed result is on the 50. Decisions left to
   Davies: funding `LT8Q2` (£350-400 covers one £0.50 position through the worst historical excursion; the spec puts
   S1b first), entity and tax route; no order code exists.
   **2026-10-18 03:40 UTC: the weekend recorder fails two runs in three** (`ig.quotes` 165 errors since 10-16 20:52,
   "401 error.security.account-token-invalid", about 190 logins an hour; `ig_quote_runs` still stores ~145 snapshots an
   hour): S1b's first Sunday is 10-18. **First fix live 04:19 UTC** (`ea3e74da`; history 04:12 UTC): one login a run,
   at most one re-login. Still 3 of 13 runs failed; the waits and same-token retries (`8edc426c`, live 04:39) left 4 of
   15 failing with the token refused on the CFD account the login named, no switch made. Third fix (`8cd5fb8e`, live
   05:06): an explicit switch after every login, spread-bet account first, accounts isolated; runs then cycled every
   three minutes (ok, ok after a re-login, both accounts refused) with no session ever logged out. Fourth fix (live
   05:42): log out every run; still one run in four failed, both logins refused (client-token-invalid). It ran so
   all of 10-18 (~75 % ok; the 20:00 UTC Sunday open caught, 19:59-20:01 ok). Fifth fix (`dc74dca2`, live ~20:30
   UTC): keep the session; changed nothing, every cron call is a fresh worker. Sixth fix (`ab2e8f3d`, live 21:20
   UTC): an 18 s re-login wait; changed nothing (~75 % of runs ok), and the recorder stays so (harmless, runs ~34 s).
   Audit 2026-10-19: a re-login that itself fails let the next account's switch log in again (five logins a run on a fake
   IG), and nothing bounded a run (77 s on a fake that hangs, against the call's 55 s); an ok run leaves its session
   logged in. **PR #244** (Muse; a failed re-login ends the run's logins, a 50 s run deadline with the log-out allowed
   to 55 s) fixes both; **Davies, 2026-10-22: land it** (Claude-reviewed; `ig` last deployed 10-21 21:01 UTC in
   `7e6de307`'s every-function deploy, so landing it is its own `ig` redeploy). Muse's 10-20 03:44 history section is in
   the archive, "LEDGER.md, archived 2026-10-22 (fourth)".
   **Davies, 10-19: "都按你推荐的来"**: S1b's usable weekend is now judged by quote coverage, Deviation 1
   (`backtests/ig_deepdive/DEVIATION-1-S1b-coverage.md`, reading `sql/s1b_coverage.sql`; the spec is unchanged); the
   session table (option A) is dropped, not built. Weekend 1 of 12 (10-18/19): USABLE, final 1,515 of 1,515
   minutes covered, no gap, first TRADEABLE 20:00:05 UTC (runs ok 1,141 of 1,515); read 10-19 21:17 UTC. Next: 10-25/26.

15. **GROKPM, "Polymarket analyst" ("(Grok)" dropped 10-17): LIVE since 2026-10-17 02:39:14 UTC (Davies: "上线"); ends
   2026-11-14 00:00 UTC at the latest (wake `trig_01C3a3b3F38FYavx6jFeqJEq`); trades through our Ireland server on the shared account** (Davies, 2026-10-15: "让grok bot里开一个trading bot，给他100美元…先让他就用100美元测试"; 2026-10-16:
   "可以用目前这个polymarket跑吗", "让grok用我们搭好的爱尔兰服务器下单，不是网页端"; `reviews/2026-10-15-grokpm-prereg.md`, frozen,
   with its Deviations D2–D6 (§9); migrations `0124`–`0128`; history 2026-10-15 GROKPM, 2026-10-16 GROKPM D2 and D3,
   2026-10-17 D4, D5, the go and D6).
   - **The design.** Grok holds no key or wallet. It calls the `grokpm` function (`?action=account|market|order|cancel|cancel_all`,
     `&forceFunctionRegion=eu-west-1`, bearer `GROKPM_LOG_TOKEN`). The server checks every order against §2's rules and the
     agent's own book, journals it, and only armed signs and sends it on the account live-prep used.
   - **0125.** It disarms live-prep (only with nothing sellable left; its dust waits to settle) and adds GROKPM to the
     one-armed trigger.
   - **Davies does:** (1) create the Supabase Edge Function secret `GROKPM_LOG_TOKEN` (32 or more random characters; never
     in a chat or a commit) and give it only to Grok; (2) configure Grok with the prompt: §2's rules, §7.5's rhythm,
     Appendix A and A.2 (no key, no wallet: the server trades); (3) say go.
   - **The main session after deploy, in dry-run:**
     - `grokpm` deployed with `--no-verify-jwt`; `0125` applied;
     - `select dry_run, live_confirmed_at from pm_lp_config` shows `live_confirmed_at` null;
     - `select wallet is not null, dry_run, armed_at from grokpm_config` shows true / true / null after the first sync
       (the function writes the wallet);
     - the edge call `grokpm?action=sync&forceFunctionRegion=eu-west-1` beating every minute;
     - with the token: `GET ?action=account&forceFunctionRegion=eu-west-1` answers `mode` dry_run, geoblock IE,
       `key_loaded` true, budget 100;
     - a `POST ?action=order` on a real market answers `sent: false` with `would_send`, and a refused one names its rule;
     - nothing in `grokpm_fills`; no `grokpm.sync` errors.
   - **Dry-run checks all done 10-16 15:38** (Grok's rehearsal: one dry-run B open, one longshot refusal, one cycle row; no
     fills, no errors). The journal is the base URL with no `action` (an `action=journal` in the first prompt was wrong).
     **D3** (same day) makes the server refuse `edge`, `kelly` and `adjustment` too. **D4** (10-17 pre-go audit): resolved
     wins settle into cash, the stops latch, every fill is booked, the kill switches cancel resting orders. Before go:
     land D4 (the deploy must show it), then Davies sends Grok the audit's message (prompt v2).
   - **The go** (0125's header, only in the conversation where Davies says it):
     `update public.grokpm_config set dry_run = false, armed_at = now(), started_at = now() where id = 1 and dry_run = true
     and armed_at is null and started_at is null and wallet is not null and ireland_attested_at is not null and
     (ireland_until is null or ireland_until > now()) and (select p.live_confirmed_at from public.pm_lp_config p where
     p.id = 1) is null returning dry_run, armed_at, started_at;`. The undo is
     `update public.grokpm_config set dry_run = true, armed_at = null where id = 1;`.
   - **The reading.** 28 days from the start day, or 40 resolved positions, or the −$30 stop; continue only if P&L > 0 AND
     Brier_agent < Brier_market.
   - **Never trade by hand in that account while GROKPM is armed.** Davies' own exception, 2026-10-17 ~03:45 UTC (desk
     ledger; that log line was trimmed 10-20, `ebd69f78`): a position he bought by hand in the shared wallet (CoreWeave
     bankruptcy, NO, resolves 2027) is not the agent's; its book and record exclude it (agent cash $[•] then), and D6 redeems
     it with the rest once it resolves.
   - **Zero trades, reviewed 10-20** (`reviews/2026-10-20-grokpm-zero-trades.md`): no rule or server limit was the problem; looser
     bars lost on every resolved near miss. **D7 agreed 10-20 ("同意")**: shadow forecasts, no rule change (prereg §9 D7;
     the review's §7 is the message, sent via Davies and posted as C-003 in the desk ledger). The end reading adds their Brier.
     Audit 2026-10-20: B10 and B8 lost every resolved case (5 trades, one Alberta loss on a count not yet official); B5's
     six held one win, and one of the six A confirmations sat at 0.934/0.979 (the review's §9 lists the wording).
     Grok answered C-003 at 16:58 UTC: D7's rows from its next wake (desk ledger). **PR #245** (Muse, the Kelly cap cumulative by market) carries
     its own prereg deviation, approved by Claude on Davies' delegation; it is **D8**, D7 being the shadow forecasts
     (Davies confirmed D8, 2026-10-22). **D7's sample (Davies, 2026-10-22):** shadow forecasts count from C-003's start,
     2026-10-20 16:58 UTC (17:58 London); the 17:05 UTC wake's two rows (ids `2026-10-20T17:05Z-d7-*`) are left out, that
     round having read price and votes together, so each market's first counted forecast is 17:35 UTC's. Recorded in the
     zero-trades review's §10 and as the prereg's §9 D9, after #245's D8 (sha chain 0cfc80c8 → D9's).
   - **Rules study, 10-23** (`reviews/2026-10-23-grokpm-rules-study.md`): the bars are not what binds. Every gap was an
     emptied, thin book the market had already settled, and no looser rule fills. **Decided 10-23** (Davies: "同意，按你的
     建议做"): rules kept; C-004 posted on the desk ledger (`6144d1d0`); D10 is §9's D10, the review's §7 word for word,
     after D8 and D9 (sha chain 0cfc80c8 → c5c663f3 → D10's).
   - **C-005 posted 10-24** (Davies: "同意"; desk ledger `33f674ac`): far B markets chosen by title before any price. **Optimisation
     review, 10-24** (`reviews/2026-10-24-grokpm-optimisation.md`): F1–F4 fixed and pinned (forecast outcomes, `0138`'s last
     trades and books, busy retries, market-read ids), F5 the D7/D10 reading's SQL. **After the push:** read
     `grokpm_shadow_marks` and `grokpm_resolutions` filling (10-24 07:55: 320 and 17 rows, no errors). **P1–P5 decided 10-24**
     (Davies: "这些你看看需要做的话就做"; the review's §6): D11 `?action=markets_far`, D12 `last_trade` on the market read, D13
     the reading's m 0.05–0.95 stratum, D14 settlement only at 0, ½ or 1; C-006 on the desk ledger (`cfb9d195`) asks about
     event wakes. §9 now runs D8 → D14 in order; the pin moved with each (D10's a83d12d8 → D14's 409b6acd).
   - **Thin-rule study, 10-26** (`reviews/2026-10-26-grokpm-thin-rule-study.md`; Davies: "是不是规则还是太严了"): 42 clearing rows
     on 9 markets, every one stopped by `thin` alone. **D15 verified and built 10-26** (Davies: "你再验证下D15的修改，推荐的话就做";
     the review's §9, `0140`): a capped thin exception for far B markets, $5 a market, 3 at once, `event_at` and a 48 h cut.
     **After the deploy:** `?action=account` shows `thin_cap_markets`; then post C-007 (the review's §9.4) and append D15 to
     §9 after D14. Score the filled-bid markets after 11-01 (`backtests/grokpm_thin/`).
   - **First orders verified 10-27** (`reviews/2026-10-27-grokpm-first-orders.md`; Davies: "下了几单，你也仔细验证下"): 15 orders,
     3 fills, all OK. V1 (`0143`) stores each order's `event_at` and checks. **P1 and P2 decided 10-27** (Davies: "剩下两点由你
     权衡后来做出最优选择"; no money note, "台账里的金额无所谓"): D16, a B bid lives 65 min; D17 (`0147`), one cap per
     negative-risk event. **After the deploy:** post C-008 (the review's §5.3), and append D16 and D17 to §9 after D15. **Utilisation review 10-28:** keep every rule; funds wait (new prereg). **D18 (Davies, 10-28): D15's $5 is $10 at an edge of 0.20+**, in §9 with D15–D17 (their texts were still unwritten); **after the deploy:** post C-010 on the desk ledger (Grok's note on D18; drafted, held until the deploy is confirmed). **D19 (Davies, 10-29: "把polymarket的策略里的钱全换成百分比，这样的话可以有效实现盈利资金的再利用")**: every money limit is a share of the agent's equity at the start of the UTC day (10 % a market or event, 25 % a theme, 30 % cash kept, D15 5 %, D18 10 %, day stop −10 %; `grokpmCaps`); the total stop stays −$30 of FUNDED; no migration (`daily_loss_usd` no longer read); §9's D19 (pin `4c49e5e2…`). **After the deploy:** `?action=account` shows `cap_basis_usd` and the `*_pct` fields; then post C-011 on the desk ledger (drafted in the hand-back).
   - **Automatic redemption (D6, `0128`, `grokpm/redeem.ts`; Davies: "加上吧 全部都自动化掉")**: hourly, one gasless relayed
     transaction for up to five of the shared account's redeemable markets (pUSD back; losing tokens cleared), a dry run
     while `redeem_enabled` is false (its plan in `grokpm_exec_state.redeem_state`). **Davies does:** polymarket.com →
     Settings → API Keys → Relayer API Keys → create; store the API key as the Edge Function secret
     `POLYMARKET_RELAYER_API_KEY` and the Signer Address shown beside it as `POLYMARKET_RELAYER_API_KEY_ADDRESS` (never in a
     chat). **Done 2026-10-18 03:05 UTC: enabled, first redemption mined (history 2026-10-18 03:08).** Before that the main
     session read one dry run's `grokpm_exec_state.redeem_state` (its plan, `blockedBy` empty) and ran
     `update public.grokpm_config set redeem_enabled = true where id = 1 and redeem_enabled = false returning redeem_enabled;`
     (undo: `… set redeem_enabled = false …`), and watches the first `grokpm_redeems` rows reach `confirmed`.
   - **The desk ledger** (Davies, 2026-10-17: "开一个这个grok bot trading的专属ledger…他每次唤醒后可以看到你的留言，你每次醒时也可以
     检查最新动态"): `GROKPM_LEDGER.md`, alone on the branch `grokpm-ledger` (no CI, no deploy; never merged into `main`).
     Grok reads it every wake, answers Claude's requests there and pushes only to that branch. **Every session that touches
     GROKPM reads it first** (`git fetch origin grokpm-ledger && git show origin/grokpm-ledger:GROKPM_LEDGER.md`), answers
     "Grok → Claude", and keeps it under 10 KB, read as 10,240 bytes (Davies, 2026-10-22). Its introduction still says "D1–D5" twice (D1–D7 now); Davies, 2026-10-20:
     left for now. A daily check (trigger `trig_0165DPcrxXo6NhdDZdjDsmZ8`, 23:45 London) reads it and the record.
16. **Target price page (Davies, 2026-10-21; `targets` function, `0134`, `src/tables/target_price*`).** After the deploy and
   0134: one `analyst_targets` row a holding within ~16 min (the call waits 15 min, then runs the newest slot owed). Bitcoin's
   targets are a hand table **as of 2026-10-21** (`targets/strategists.ts`): a session refreshes it when a bank publishes a new
   one. Questions to Davies in the hand-back (risks editable in the UI, SPCX note's end date, BTC's mixed horizons, fund coverage).
17. **PMSTATARB S1 TOUCH-CAL re-run: FAIL on available sample** (Davies, 2026-10-22) (`reviews/2026-10-15-pm-statarb-verification.md`,
    `backtests/pmstatarb/results/s1_verdict.txt`). May titles parse. 2026-05 is in the touch file (914 daily
    with a clause, 140 weekly without). Fills are taker BUY of the bought outcome. One market is tape-capped
    at the data-api offset cap and is not done. Headline 1178 trades, mean ROI −0.1137, p05 −0.2266. 2025
    still has 19 trades; 2026 has 1159. Do not retune. September cursor key 4946930 stays quarantined. Print and spot sha256 are in `MANIFEST.json`;
    the bytes stay on `/tmp/pmstatarb-data/`. `FROZEN.md` records the late freeze. #242 squash-merges only.
    S2 is not started. S4 is one snapshot on 2026-10-18, not before. History: "LEDGER.md, archived 2026-10-22 (third)".
    **PMSAMEBET (10-27, `reviews/2026-10-27-pm-same-bet-statarb.md`)**: the same bet across events has real gaps that are
    pennies deep, and Kalshi leads nothing. Nothing to run. Davies decides only whether SAMEBET-REC (§6) is ever wanted
    (recommended: no).

18. **IGBOT, "IG analyst": a Grok bot on IG's DEMO, built, dry-run, not deployed** (Davies, 2026-10-28: "…做个类似的做ig的
    cfd/options/spread betting的trading bot并搭建架构，做好了给我发prompt"; `reviews/2026-10-29-igbot-research.md`, prereg DRAFT
    `reviews/2026-10-29-igbot-prereg.md`, prompt `docs/agents/igbot/GROK_PROMPT.md`, `0157`, `igbot` function). **Davies does:**
    a demo login and demo API key; secrets `IGBOT_DEMO_API_KEY`, `IGBOT_DEMO_USERNAME`, `IGBOT_DEMO_PASSWORD`,
    `IGBOT_DEMO_ACCOUNT_ID` (a spread-bet demo account), `IGBOT_TOKEN` (32+ chars, to Grok only); Grok gets the prompt.
    **The main session:** create `igbot-ledger` (an orphan branch holding `docs/agents/igbot/ledger_seed.md` as
    `IGBOT_LEDGER.md`); after the deploy, the ping answers `ig_configured`; the dry-run rehearsal (prereg §3.1); the demo arm
    (0157's header) only on his word. No live path exists. **Audited 2026-10-29** (research §11, prereg §10, `0159`): land
    0159 with the function (the code reads `igbot_requests.ig_calls`); the demo account must hold nothing (`account_shared`);
    before the arm, read the demo key's own allowances (`GET /operations/application`) and confirm on the first demo deals:
    a close as `LIMIT` fill-or-kill, how IG's stop or limit close shows in `/history/activity`, and that a filled working
    order's position keeps our `IGB-` reference (else `account_shared` refuses opens, safely). The release list ends
    2026-12-31 (opens refused after it). Shown on TESTING as "IG Trader" (dry-run until armed). **Settled 2026-10-29 ("同意，按方案1改"):** the `ig` recorder reads
    IG's LIVE login for prices only (`IG_*_LIVE`, `0161`'s `environment`; `DEVIATION-2-live-prices.md`); the demo login is
    IGBOT's alone. **Before Fri 21:35 UK, after `0161` and `ig` deploy:** run `facts` on live for `sb` and `cfd` and read back
    `ig_action_log` and `igbot_requests` (the SQL: `reviews/2026-10-15-ig-verification.md` §11). **Session fix (10-29, `0165`):**
    land 0165 with the function; after the deploy `igbot_requests` (action `sync`) should read `ig_calls` 3 a quiet minute,
    a login (5 calls) only when IG drops the session, and no `account switch refused`.

19. **CXBOT, "Crypto analyst": BUILT, paper only, dry-run until Davies' go** (Davies, 2026-10-28/29; the audit
    `reviews/2026-10-29-crypto-grok-bot-audit.md`, prereg DRAFT `reviews/2026-10-29-cxbot-phase1-prereg.md`, prompt
    `docs/agents/cxbot/GROK_PROMPT.md`, seed `docs/agents/cxbot/ledger_seed.md`; `cxbot` function, `0163`). No key of any venue.
    **Main session after the deploy:** fire `reach` once (SQL in the 01:32 history line) and read `cxbot_reach`: if Hyperliquid
    is not 200 from eu-west-2, `update public.cxbot_config set venue = 'binance'` (then OKX) before the go, never routed
    round; create `cxbot-ledger` from the seed; the daily desk check (23:45 UK, with GROKPM and IGBOT). **Davies:** the secret `CXBOT_TOKEN` (32+
    chars, to Grok only), the name, then the go (0163's statement; 48 h shakedown, 56 days).
    **Independent audit 2026-10-29** (`reviews/2026-10-29-cxbot-independent-audit.md`), its §3 settled by Davies: 7-day blocks,
    CXBOT's own 2027 Q1 releases (opens to 2027-03-31), P&L from the shakedown's end. Prompt changed: resend it to Grok.

20. **Second-level FX recorded beside Yahoo** (Davies, 10-29: "并行记录秒级汇率 并研究下最佳数据源并且要有fallback"; `0172`,
    `agents/fx_rec.ts`, `reviews/2026-10-29-fx-second-sources.md`). TrueFX every second, Kraken the marked fallback, into
    `fx_ticks`; no strategy reads it. **After the deploy:** `fx_rec_state.last_report` each minute (59 TrueFX reads, 12 Kraken,
    `primaryHealthy` true), `fx_ticks.failed` low, no `agents.fx_rec` in `ops_errors`. The comparison (that review's §4) reads
    14 days from the first full day. **Backtest done (§7,
    FX-SPEED):** a faster X is worth nothing on Revolut X and about +£66/yr on Coinbase's £2,400 (19 days). **§8 (FX-SPEED-LONG)
    passed every Coinbase arm, and every Coinbase arm now prices its rate on `fx_ticks`** (`agents/cb_fx.ts`, `0173`; base Dev 7,
    weekend 6, USDC 5, nudge 4): so the recorder is no longer research only, and its switch-off statement must not run without
    Davies' word (the arms would fall back to Yahoo). **After that deploy:** apply `0173` before or with it (a run that writes
    `fx_src` before the column exists is refused and re-decided by the next); each arm's state gets `fxFrom` (its first minute at
    or after 10:00 UTC, after the deploy) and `fxCount`; `cb_*_minutes.fx_src` mostly `truefx` on a weekday, `yahoo`/`kraken`
    a few, `dark` (base) or `held:*` from Friday 21:00 UTC. **Revolut X long (§9, FX-SPEED-RX): no row passes**; LIVE and its twins keep Yahoo.

21. **Coinbase live, "Stablecoin quotes USDC/GBP": built dry-run and unarmed** (Davies, 10-29; `agents/cb_live.ts`, `0177`,
    `reviews/2026-10-29-cb-live-design.md`). "with Euros - 2"'s decisions at £20 a rung of £120. **Go only on Davies' word:** the
    probe `ok` (with `preview=1`), a 30-minute dry-run check (design §5), then §7's guarded statement; its undo is in the same
    section. **Armed 20:51 and disarmed 20:55:57 on 10-29: Coinbase answered 403 "User is not allowed to buy crypto"** (Davies'
    account must allow buying crypto before the next go; design §9). **'self' (`0182`, design §10; Davies 10-30: "要做"):** lands
    `decide` 'paper' with the shadow on; read §10's SQL after a few hours of `cb_live_shadow`, then the switch only on his word.

22. **Compounding for every Stablecoin quotes (`0183`, `reviews/2026-10-30-compounding.md`; Davies 10-30: "…盈利金额再利用…").** Twins,
    Coinbase and OKX paper arms compound from 10-31 00:00 UTC. LIVE, the RX USDC/GBP and Coinbase executors: turned on ~02:10 UTC
    10-30 ("打开", §6's statements, `compound_from` 10-31 00:00). After 11-01 00:00 read each config's `compound_last`,
    `agent_quote_twin_compound.last` and the arms' `state.compound`. The base Coinbase test stays uncompounded (a control).

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

Closed operations move verbatim into `docs/handover.md` Part 2, this ledger's archive, each batch under a heading
"LEDGER.md history, archived 2026-09-22" or "LEDGER.md, archived <date> (<n-th>)" that names the sections it holds, oldest
first: `grep -n '^## LEDGER.md' docs/handover.md` lists them, 2026-09-05 to the 2026-10-29 01:24 UTC section (archived
2026-10-29, tenth), and the 2026-10-29 01:32, 2026-10-29 01:31 one(s) (eleventh), and the 2026-10-29 01:33 one (twelfth), and the 2026-10-29 01:45, 2026-10-29 01:57 one(s) (thirteenth), the 2026-10-29 02:19 one(s) (fourteenth),
and the 2026-10-29 02:13 one (fifteenth), and the 2026-10-29 02:30, 2026-10-29 02:43, 2026-10-29 02:36, 2026-10-29 02:49, 2026-10-29 03:00, 2026-10-29 03:02, 2026-10-29 03:07, 2026-10-29 03:12 ones (sixteenth), and the 2026-10-29 03:24, 2026-10-29 03:30, 2026-10-29 03:39, 2026-10-29 03:41, 2026-10-29 03:49 ones (seventeenth), and the 2026-10-29 04:18, 2026-10-29 05:50 ones (eighteenth), and the 2026-10-29 06:05, 2026-10-29 06:30, 2026-10-29 06:41 ones (nineteenth), and the 2026-10-29 06:56, 2026-10-29 07:05, 2026-10-29 07:26, 2026-10-29 07:31 ones (twentieth), and the 2026-10-29 07:45, 2026-10-29 07:52, 2026-10-29 07:58 ones (twenty-first), and the 2026-10-29 08:10, 2026-10-29 08:25, 2026-10-29 09:05 ones (twenty-second), and the 2026-10-29 09:22, 2026-10-29 09:40, 2026-10-29 09:45, 2026-10-29 10:15 ones (twenty-third), and the 2026-10-29 17:10, 2026-10-29 18:20, 2026-10-29 18:33, 2026-10-29 18:43 ones (twenty-fourth), and the 2026-10-29 19:16, 2026-10-29 19:25, 2026-10-29 19:28, 2026-10-29 19:31 ones (twenty-fifth), and the 2026-10-29 19:50, 2026-10-29 19:55, 2026-10-29 20:00, 2026-10-29 20:15 ones (twenty-sixth), and the 2026-10-29 20:41, 2026-10-29 21:07 ones (twenty-seventh), and the 2026-10-29 21:30, 2026-10-29 22:10 ones (twenty-eighth), and the 2026-10-29 22:12, 2026-10-29 22:27 ones (twenty-ninth), and the 2026-10-29 22:40, 2026-10-29 22:43 ones (thirtieth), and the 2026-10-29 22:55, 2026-10-29 23:13 ones (thirty-first), and the 2026-10-29 23:24, 2026-10-29 23:30 ones (thirty-second), and the 2026-10-30 00:17, 2026-10-30 00:30 ones (thirty-third), and the 2026-10-30 00:35, 2026-10-30 00:57 ones (thirty-fourth), and the 2026-10-30 01:05, 2026-10-30 01:20 ones (thirty-fifth), and the 2026-10-30 01:45, 2026-10-30 01:48 ones (thirty-sixth), and the 2026-10-30 02:05, 2026-10-30 02:11, 2026-10-30 02:12, 2026-10-30 02:17 ones (thirty-seventh), and the 2026-10-30 02:55, 2026-10-30 03:05 ones (thirty-eighth), and the 2026-10-30 03:50, 2026-10-30 04:05, 2026-10-30 04:20, 2026-10-30 05:25 ones (thirty-ninth), and the 2026-10-30 05:40, 2026-10-30 05:55 ones (fortieth).

### [2026-10-31 03:31 UTC] Platform: Claude Code | Model: not recorded (session policy)
- Agents audit round 2, rebased on 0188 (cblive's watchdog retry on): the monitor's `cbLive` comment names it. Moved the 10-30
  05:40, 05:55 sections to handover (fortieth).

### [2026-10-31 03:07 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Agents audit, round 2 (sub-agent; commits, not pushed).** `agents/index.ts` loads each action's modules when the request
  asks for them, after its beat, not at boot: 56 imports became bindings set by literal `import()` loaders, and
  `AGENTS_ROUTE_MODULES` lists each action's (an action not listed loads all; a test importing the file loads all). The boot
  graph went from 76 modules / 2.21 MB to 5 / 0.28 MB; LIVE's minute loads 5 modules, Coinbase LIVE's 2. Function bodies are
  unchanged. `src/agents_lazy_modules.test.js` reads the code and fails when an action reaches a binding outside its list
  (counterfactual: `quotes` without `quotes_live_weekend.ts` fails). Measure after deploy: `function_edge_logs` 503 share
  for the agents function a hour (49-161 of ~950 on 10-30), its boot_time, and `edge_call_retries` a day for `agents%`
  (quotes 134-154 a day since 10-27). Moved the 10-30 03:50, 04:05, 04:20 (two), 05:25 sections to handover (thirty-ninth).
- **Compounding a pound a rung from 2026-11-01 00:00 UTC** (Davies, ~03:05: "a和b都改； c也改"). LIVE moved in whole £12 (£2 a rung of its six
  USDT-GBP rungs): the unit and step are now derived, £1 × the rungs each strategy quotes at the day's 00:00 (`compoundUnitOf`,
  `cbLiveRungCount`): LIVE £6, RXU £4, Coinbase £6 (unchanged), `live600`/`live1200`/`take50` £6, `n600no03` £4, the both-book
  twins £12. `0189` stores the same. Deviation `reviews/2026-10-31-compound-unit-deviation.md`; pins in `quotes_compound.test.ts`
  (£6.70 realised moves LIVE to £606; in £12 it stays 600) and `compound_unit_deviation.test.js`.
- **Coinbase LIVE sells surplus USDC back to pounds from 2026-10-31 06:00 UTC** (Davies: "a和b都改"; `CB_LIVE_DRAIN_FROM`, move it to
  the next whole hour if the push lands later). Its 0.3 % bid had rested nothing since 10-29 20:34 (13.48 USDC over the asks' need,
  £9.84 short of the bids'). `planCbDrain`: only when a bid lacks pounds and no ask lacks USDC; the coin beyond each ask's at fair
  (rounded up) and every held bid's; at most what the bids lack and the day's cap; post-only a tick inside the ask, never under
  fair; cancelled the turn an ask lacks USDC or no bid lacks pounds. Design §12, reference item 68; pins in `cb_live.test.ts`.
- **`skip_inventory` once a skip** (cb_live): an event when a rung's skip for funds starts, changes leg or side, or its need or funds
  move over 5 %, not every minute (1,748 of `cb_live_events`' 1,938 rows were one bid repeating). The last told skip per rung is kept
  in the state (`skips`); pin in `cb_live.test.ts` (old code: five events where one is news).
- **A batch upsert with a key twice** (`db.ts` `upsertRows`): the test double merged such a batch where Postgres fails it whole
  (21000: xhedge's stall of 10-30, the EUR/USD minutes' 33 errors from 10-16); now it fails it too. Yahoo's stray in-minute point
  makes a repeated minute legitimately: a vendor's bar series (`UPSERT_FIRST_WINS`: `agent_quote_inputs`, `cb_quote_inputs`,
  `cxbot_tape`, `igbot_bars`) keeps each key's first row, the bar, which later runs stored anyway (no EUR/USD gap over 3 minutes
  on a weekday in 20 days). No frozen file changed (the fix is in the client, not `cb_quotes.ts`/`quotes.ts`), and no decision:
  the failing batch was caught and the arms read the stored series. Every other batch upsert in the module was read: keys unique
  by construction (one row a book/source/minute, trade ids, a lease's id). Pin in `db.test.ts` (old code: the merge keeps the
  stray value, three rows sent, xhedge's duplicate stored).

### [2026-10-31 03:07 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Agents-module audit, round 1 landed** (fa07448e paged reads in waves, 80bb0fcd monitor reads Coinbase LIVE). Davies on its
  proposals: "a和b都改； c也改". A: `0188` turns the watchdog retry on for `agents?action=cblive` (188 of 1,440 minutes a day lost
  to boot failures). B (Coinbase USDC→GBP maker rebalance) and C (LIVE's compounding unit £12 → £6, a pound a rung on six
  USDT-GBP rungs; RXU £4/4 and Coinbase £6/6 already are) go to the audit agent's round 2 with the lazy-import boot fix.

### [2026-10-31 02:49 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Agents module audit (sub-agent; commits, not pushed; Davies, 10-31: "…仔细深度全面审核下整个网站的agents…确保一切细节完美与最优").**
  First fix: `selectAll` (`agents/db.ts`, every function's `makeDb`) read a big table's pages one after another; LIVE's
  10,443 orders were eleven reads on every dashboard call (`quotesLive`, its slowest stage, 1,536 ms of `serverMs` 1,536).
  Past the first page it now asks `PAGE_WAVE` (4) pages at once and joins them in order; a one-page read is still one request.
  Pin in `db.test.ts` (counterfactual: the old loop never has more than one page in flight). No rule, no frozen file.
  Moved the 02:55, 03:05 (10-30) sections to handover (thirty-eighth).
- **Coinbase's live executor joins the monitor's health readings** (`monitor/health.ts` `cbLive`, 300 s; the Worker's label).
  Armed since 10-29 21:45 with no reading and no dead-man of ours (Coinbase's 20-minute order ends are its only one), its call
  has no watchdog retry (0177) and missed 188 of 1,440 minutes on 10-30/31 to the `agents` boot failures, at most four in a row
  since armed. A turn over five minutes old now fails the loop check (two minutes running pages). Pins in
  `monitor/index.test.ts` and `monitor_worker.test.js` (counterfactual: four health tests fail on the old file).

### [2026-10-31 02:16 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Coinbase USDC/GBP take shadow, records only** (sub-agent; commit, not pushed; Davies, 10-31 ~02:00: "Coinbase USDC/GBP也做好加开
  shadow记录"). `0187`: `cb_live_config.take_mode` 'off'|'shadow' (no 'live'), set 'shadow'. Per rung it would enter, outside
  closures and blackouts: limit k + the SPOT `transaction_summary` taker fee (a day's cache), `product_book` read only when
  `best_bid_ask` is through it, deeper than the £1 line → a `take_shadow` event in `cb_live_events`. Nothing sent. Caution: the
  spot tier may not be the stable pair's price (maker fills paid 0); read the first events' `fee`. Design §11, ref item 68.

### [2026-10-31 02:11 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **LIVE's take is 'live' since 02:10:43 UTC** (Davies: "RX USDT/GBP上"), after the closure guard deployed (7b3d28cd, 02:09);
  RXU's take 'shadow' since 02:00:12. Undo: LIVE 'shadow', RXU 'off'. First possible live take: Sun 11-01 21:00 UTC. The live
  design's addendum of 2026-10-31 has both statements. Coinbase take shadow: a sub-agent is building it.

### [2026-10-31 02:00 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **No take inside an FX closure, at once** (sub-agent; commit, not pushed). With `weekend_mode` 'live' a closure minute is the
  weekend replica's (held X), and the take and its shadow ran on it. Every take the rule was tested on is a weekday's
  (take50's 14, the shadow's 2), so `takeClosed` in the shared take path now stops both in a closure. take50 never sees one
  with a fair (no weekend rule), and no enabled twin has take and weekend together. Pin in `quotes_live_switches.test.ts`
  (counterfactual: the guard reverted sends one IOC and records one shadow event). Recorded apart in
  `reviews/2026-10-31-take-closure-deviation.md` (the five pre-registrations' executor hash; their tests and `take_twin.test.js`).
- **Davies, 2026-10-31 ~02:00 UTC: "RX USDT/GBP上 / RX USDC/GBP开 shadow / Coinbase USDC/GBP也做好加开 shadow记录".** RXU's
  `take_mode` 'shadow' at 02:00:12 (`update public.agent_quote_rxu_config set take_mode = 'shadow' …`; undo 'off'). LIVE's
  `take_mode` 'live' follows once this guard is deployed (undo 'shadow'). Coinbase's take shadow is to build (cb_live has no
  take path). No USDC take was ever seen: take50 0 of 14 since 09-23, LIVE's shadow 0 of 47 rows while it quoted both books.

### [2026-10-31 01:47 UTC] Platform: Claude Code | Model: not recorded (session policy)
- xhedge Deviation 2's measurement added after the replay: at most 3 (`inside`) and 2 (`behind`) folded trips; both arms decided
  every missed minute, no error. TAKE-DEPTH (ef2e7565) landed, effective 04:00 UTC; take_mode stays 'shadow'.

### [2026-10-31 01:41 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **TAKE-DEPTH: a take only through more coin than the £1 holding line, from 2026-10-31 04:00 UTC** (sub-agent; commit, not
  pushed; Davies, ~01:30: "按照你推荐的来，确保效果最佳，你觉得需要改就改"). Measured first, read-only. None of take50's 14 takes or
  LIVE's 47 shadow events was that thin. On the recorder's USDT-GBP reads (10-05 to 10-31), £1 or less sat through an ask rung's
  limit 132 times, all on 10-22 05:00–09:00, and each, taken, lost to fair (−£0.015 on average: the venue's penny). So B alone:
  A (sizing to the remainder) changes nothing on the record. `takeDeep`/`readDepthThrough` sit in the shared take path, so
  LIVE (shadow stays) and variant-2 change together. Recorded apart in `reviews/2026-10-31-take-depth-deviation.md` (five
  pre-registrations' executor hash; their tests and `take_twin.test.js` read it); pins in `quotes_live_take_rules.test.ts`
  (counterfactual: 10-30's reads sent three IOCs). Moved the 01:45, 01:48 sections to handover (thirty-sixth).

### [2026-10-31 01:23 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The header clock's market dot reads "Market Closed" (grey) when nothing trades** (Davies, Sat 01:20 UTC: "现在都周六1:20了
  还是night market的颜色，请彻底修复"): `usClockPhase` (`prices/market_hours.js`) for the dot alone, closed through the weekend dead
  zone, a holiday until its 20:00 ET and from 20:00 ET the evening before; `usMarketPhase` keeps calling those "overnight" for
  the refresh cadence and the T212 night overlay, unchanged. Pins in `market_hours.test.js` (fail without it); `docs/guide.md`.
- **xhedge A1/A2 run again** after 59f471db's deploy (01:18 UTC): no error, catching up 30 minutes a run.

### [2026-10-31 01:16 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **PR5 take: the two risks the 10-30 read left open, tested** (sub-agent; commit, not pushed; Davies keeps 'shadow': "按照你推荐的来").
  `quotes_live_take_rules.test.ts` runs LIVE's executor on a simulated account under today's rules. A take that fills under
  the £1 line leaves the rung unheld, and the next minute sends the full IOC again: 3 IOCs in the test, one a turn, at most a
  line over the rung, one exit for all of it. That is the holding line's own rule, which variant-2 shares, so no fix; a
  single-IOC change would be Davies' word plus a deviation. A rebook's sale never offers the take's coin and never starves
  its exit (pinned; a mutation dropping the longs fails it). Take stays 'shadow' until the first USDT-only take event reads
  clean, then Claude proposes the flip (design addendum 10-18, log). Moved the 01:05, 01:20 sections to handover (thirty-fifth).

### [2026-10-31 01:10 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **xhedge A1/A2 stood still from 10-30 09:57 (inside) and 10:55 (behind) to this fix** (Davies: "两个策略停了，有报错").
  Two Revolut X prints of one millisecond, each over £1, owed two hedges with the same first fill, settled on one Coinbase
  read: two trips with one key (arm, book, side, t_fill, t_hedge), so the batch upsert failed (21000) and every run rolled
  the arm back. `xhSettle` now folds them into one trip (qty, fee, P&L and fills summed, RX price qty-weighted); pin test
  fails on the old code. The arms replay the missed minutes from the recorded inputs, 30 a minute, about half an hour;
  recorded as the test's Deviation 2 (`reviews/2026-10-30-xhedge-deviation.md`): money unchanged by construction, the files' new sha256 named there.
- **PR5 take stays 'shadow'** (Davies: "按照你推荐的来"): the two unverified risks of the 10-30 re-read (a partial fill
  under holdMin letting more IOCs out; a rebook sale competing with the exit) go to tests first; Claude proposes the flip
  after the first USDT-only take event reads clean.
- **IGBOT:** C-003 answered by Grok (the 8.5 h gap was its own pause after a box restart; restore step added); checked
  against the record and closed on `igbot-ledger` 7ca96b50.

### [2026-10-30 18:30 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **PR5 take shadow read again, 10-18 05:17 → 10-30 18:00** (sub-agent; commit, not pushed; routine "PR5 take-shadow
  re-check"). 47 `take_shadow` rows are 2 opportunities (10-28 18:42, one 49.8-coin bid ~30 bps over fair repeated each
  minute because the shadow holds nothing, by design; 10-29 15:22); 'live' would have sent 3 IOCs (2 filling). Criteria
  (a)–(d) pass; none since USDT-only. Size, limit and exit follow USDT-only weights, compounding, exitOffset and holdMin;
  take50's twin lacks `fill: at` and weekends. take_mode stays 'shadow' until Davies' word (statement in the 10-18
  addendum's log). Moved the 00:35, 00:57 sections to handover (thirty-fourth).
