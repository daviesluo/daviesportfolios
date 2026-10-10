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

1. **Closed: fp5's ranked list.**

2. **Polymarket reward quotes (paper; RW, RW-E, RW-X, TB1, RW-C) and the three order paths (dry-run, unarmed).**
   - **TO LAND: live-prep's reward check (Addendum 9)**, committed on branch `lp-reward-refresh` (10-10 01:00 section):
     the reward programme read every minute, no entry where it no longer pays, a 3-minute scoring backstop, R and the
     estimate on scored formula. The main session rebases it, runs full gates and pushes; **migration 0111 must apply
     with or before the Edge deploy**. Left for Davies: whether a slot freed during the day is refilled (not built), and
     whether 10-09 (R 0.33 on a stale-programme formula, ≈ 0.9 on the fixed one) counts in the estimate's R.
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

12. **Coinbase recorder and paper test "Stablecoin quotes Coinbase": built, not yet deployed** (Davies, 2026-10-10;
   reference §4 item 58, migration `0112`, `agents?action=cbrec`). After it lands and its 15 minutes pass: check
   `select last_report->'reached', last_error from cb_rec_state` (true: the Edge region reaches Coinbase; never
   confirmed before), `select product, count(*), min(ts), max(ts) from cb_trades group by 1`, `select last_minute,
   last_error from cb_quote_state`, and no `agents.cb_rec` row in `ops_errors`. Pre-registration
   `reviews/2026-10-10-coinbase-paper-prereg.md` (frozen): 28 UTC days from the first 00:00 after its first decided
   minute, read on day 29 with `backtests/cbpaper/scripts/replay.py` on an export of the window (a wake to set once the
   start is known). The budget split is `reviews/2026-10-10-coinbase-vs-revolutx.md`.

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
(second)", and the 2026-10-09 00:10 → 02:46 UTC sections under "LEDGER.md, archived 2026-10-09 (third)"; each oldest
first.

### [2026-10-10 01:15 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Coinbase paper test pre-registered and frozen; Revolut X against Coinbase** (`reviews/2026-10-10-coinbase-paper-prereg.md`,
  `reviews/2026-10-10-coinbase-vs-revolutx.md`, `backtests/cbpaper/`, map row, reference §4 item 58, what-remains item 12).
  Since 2026-08-24 at £100 a rung: Revolut X 17.1 %/yr on £1,200, Coinbase 9.7 % on £2,400 (USDC-GBP 20.7 %, flat to £1,000
  a rung); Revolut X's rate falls with size. Robust split: £1,000 → £690 Revolut X + £300 Coinbase USDC-GBP; £5,000 →
  £2,580 + £2,400.

### [2026-10-10 00:53 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Coinbase recorder and paper test built** (Davies: "先建起来吧，并且和Revolute X对比看哪个更好"): `agents?action=cbrec`
  (`cb_rec.ts`, `cb_quotes.ts`, `cb_view.ts`, migration 0112, map rows). Keyless: every print of USDC-GBP, USDT-GBP,
  USDC-EUR, USDT-EUR by trade id with no gap, the touch each minute, then PR5's `stepMinute` unchanged on them in pounds
  (£100 a rung, £2,400). Not pushed; whether the Edge region reaches Coinbase shows in `cb_rec_state.last_report.reached`.
- Its TESTING row "Stablecoin quotes Coinbase" (after the twins, its own Coinbase card) and page (the twins' page, no
  INVENTORY, EUR books in euros), `dist/` built, the sweep's checks for both (all green, both viewports), a guide line.

### [2026-10-10 01:00 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Live-prep's reward check, built on branch `lp-reward-refresh`** (sub-agent; Davies: "策略每分钟读的时候都检查奖励配置，
  避免再次出现这种白挂了并且承担风险并且没奖励的事情"; Addendum 9 of `reviews/2026-10-04-polymarket-lp-prereg.md`, mid-pool's
  Addendum 10). Every turn, before anything rests, each quoted market's programme is read from the CLOB
  (`GET /rewards/markets/{cond}`, a new keyless route, plus the sponsored listing): out of the universe ($10, N ≤ 20,
  ended) means no entry that minute, buys cancelled (gate `reward`), sells rest; the formula uses the programme read; a
  failed read keeps the last good one 5 minutes. Backstop: 3 live minutes of both sides not scoring while the formula
  scores both, out for the UTC day (M = 3: 0 false positives on 10-09's kept markets). R, DAYS and REWARDS TODAY (EST.)
  on `formula_scored_usd`, R itself one function (`lpLiveR`, for the TESTING-pages follow-on); `0111` relaxes `pm_lp_minutes.rate` to ≥ 0 and adds the scored columns to the hours view.
  Replay (`backtests/lpcfg/`): 10-09's $153.90 of formula is $7.56 under the fixed rules; 8,150 of 13,362
  market-minutes and 29 buy fills were in markets that no longer paid. Gamma was measured and not chosen (lags the CLOB,
  cached 5 min). Replacement of a freed slot not built. Page unchanged (its inputs are the same fields), no `dist/`.
- **10-09's readout landed at 01:00:01** (paid $6.5242 over ten markets): R is 0.042 on the recorded formula, 0.330 on
  its scored minutes, 0.863 on the fixed rules' formula, 0.912 on its scored minutes (`backtests/lpcfg/results/replay.txt`;
  Addendum 9). The estimate will still learn 10-09 at ≈ 0.33, since its scored formula used the stale programme:
  whether to leave 10-09 out of R's calibration is Davies' call (listed under item 2).


### [2026-10-10 00:25 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **RW-C's 10-10 check PASSED** (wake `trig_0147EKGhR4aHoVq5QWUFy1mr`, fired 00:20): `pm_rwc_e_state` `checkMaxUsd` 0;
  `pm_rwc_x_state` `checkMaxUsd` 0, `checkEMaxUsd` 0 over `checkEDays` 1; both replays decided to 00:17, 10-09 closed in
  `pm_rwc_days` (`run`), `pm_rwc_e_days` and `pm_rwc_x_days`. Scalars and day keys only.
- **live-prep's first payout, and why it read low.** 10-09's rewards landed at 00:00 (+$6.53 of pUSD, no fill between
  23:57 and 00:05:01); `lpCapital` followed it, 322 → 329. Against the day's live formula ($153.90) that is R ≈ 0.04,
  but the formula is wrong: the path reads each market's reward config once, at the 00:00 selection, and Polymarket
  changed three of the day's ten during it (Gamma now: the two "Gemini … by October 16" markets at minimum 50 and
  50/day, selected at 20 and 200/day; "Gemini Argon … October 10" with no `clobRewards`, $84.14 of the formula, not one
  minute scored). Polymarket's `order-scoring` and `pct` turned false/0 there from about 04:20–05:36 UTC while the path
  kept quoting at the old figures. Over minutes both sides read scoring the formula is ≈ $19.80 (R ≈ 0.33), and where
  the config held, `pct` tracks our share (7.39 % vs 8.16 %, 2.10 vs 2.13). A fix is being built (`opus-high`, branch
  `lp-reward-refresh`): the reward config read every minute before anything rests (Davies: "策略每分钟读的时候都检查奖励
  配置"), a market that no longer pays takes no entry that minute (its sells keep resting), Polymarket's scoring
  verdict as a backstop, the estimate on scored formula; Addendum 9 of live-prep's pre-registration records it.
- **A unit test that failed every weekend**: `app.test.jsx`'s "the 30 s tick reuses the bars…" read the real clock,
  and from Friday 20:00 ET to Sunday 20:00 ET the page refreshes every 5 minutes, so it failed from 10-10 00:00 UTC
  (the test is from review F12, its first weekend). Pinned to a weekday's after-hours; fails on the old line, passes now.

### [2026-10-10 00:20 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **SCQ-VENUES, other venues for PR5's rule** (Davies: "还有没有其他平台可以做这种策略的？"): `reviews/2026-10-09-stablecoin-venues.md`,
  `backtests/scq_venues/` (map row). PR5's frozen simulator on two years of keyless prints, as minute bars proven equal; nothing opened or traded.
  At £100 a rung, last 12 months: Coinbase UK's four books £192.95 (28-day rate £315/yr; £1,781 at £1,000 a rung),
  OKX EEA £104.69 (USDG-EUR, £598/yr over 28 days, young and thin), Kraken and the rest dead. Recommendation: Coinbase (UK) next, OKX (Irish, spot-only) paper first.

### [2026-10-09 22:39 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **IG research** (Davies: "ig的api可以做所有cfd trading吗？…可以深度研究下有什么机会"): `reviews/2026-10-09-ig-opportunities.md`,
  `backtests/ig_research/` (map row); keyless, no account, key or trade. The API reaches spread-bet, CFD and IG's options
  (not shares' prices, share dealing or DMA); 30/60/100 requests a minute, 10,000 history points a week; Term 9(12) wants
  IG's written consent for automated dealing. FXW-AUD keeps +18.9 bps a trade at a 12 bps opening spread (breakeven
  ≈ 50), but IG's FX opens an hour before FXCM's. Calendar effects, option selling, short VIX and FX carry: no edge net.
- Open: once his demo key exists, FXW-AUD's IG backfill and Sunday recorder, then the weekend-market backfill (§C.2 draft).

### [2026-10-09 22:20 UTC] Platform: Claude Code | Model: not recorded (session policy)
- VB-K is PAUSED on Davies' word ("VB-K先暂停吧，听起来似乎不怎么赚钱"): no Odds API key, no paper phase; the design stays
  in `reviews/2026-10-09-vbk-design.md`. His CoinJar UK and IG accounts are registered and under the venues' review (no
  key yet). Running: other venues for PR5's rule (UK and Irish/EEA), IG's API and products for an edge, Polymarket's
  short crypto markets (resumed after the 21:05 container restart).


### [2026-10-09 20:00 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **VB-K design** (Davies: "VB-K也可以自动化…交给grokbot给我点…和polymarket也可以结合"): `reviews/2026-10-09-vbk-design.md`,
  `backtests/vbk/` (map row); keyless, nothing bet or signed up for. Out of sample, edge ≥ 2 %, odds < 5 against the
  exchange: +5.7 % on 1,134 bets (t 1.33); year 1 at £1,000 with limits and a 5-min delay about £180 (P(loss) 33 %),
  plus about £470 of sign-up offers once.
- Polymarket is a fair-price source, not a value venue or a cheap lay leg. Open: the paper phase (§7 draft) needs
  Davies' Odds API key and his word.

### [2026-10-09 20:13 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **CJ5's paper test on history** (Davies: "现在就用历史数据给 CJ5 做纸面测试"): `reviews/2026-10-09-cj5-paper-test.md`,
  `backtests/cj5/` (map row). PR5's frozen `pr5_sim.py` imported read-only, first reproducing `pr5_run1`'s PRIMARY
  exactly, on CoinJar's whole keyless print history (1,390,026 USDC/GBP prints from 2020-04-02, 186,416 USDT/GBP from
  2021-08-27), EXN interbank, CoinJar's fees. An edge in every year from 2021 and both halves, shrinking: last 12 months
  £24.87 / £103.40 / £177.66 on £120 / £600 / £1,200 (bootstrap index 100 £20.48 / £85.20 / £146.15). Against PR5 on
  Revolut X since 11-26 it made a fifth as much, but led since 08-24. A forward paper pre-registration is drafted, not
  frozen. No production read; nothing traded.

### [2026-10-09 22:53 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **PMSC, Polymarket's BTC 5m/15m up/down** (Davies: "polymarket的5分钟比特币涨跌…有套利空间吗", "加上Binance和Hyperliquid"):
  `reviews/2026-10-09-pm-short-crypto.md`, `backtests/pm_short_crypto/` (map row). Keyless only; nothing placed. **No edge
  we can take**: the book trails Binance/Coinbase by ~0.4 s and a cheap ask is hit in 0.14 s; taker markouts turn
  negative from 0.25–0.5 s, a 1 s maker loses, a spot/perp hedge needs ~1,400× the stake; no reward pool. Nothing frozen.

### [2026-10-09 18:56 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **STATARB-2, the second stat-arb search** (Davies: "除了这三个还有别的好的吗？还有别的统计套利吗？而且不一定要和现有策略类似的"):
  `reviews/2026-10-09-stat-arb-search-2.md`, evidence `backtests/statarb_search2/` (map row). Keyless public data only;
  nothing traded, opened or signed up for; no production read; nothing frozen. Ranked:
  1. **VB-K**: value bets at UK books against the exchange's kick-off price, +5.83 % on 1,133 bets (t 1.37), Pinnacle
     anchor +6.88 % on 2,645 (t 2.20); manual, and books limit winners. Stage 1 is a re-run on 2026-27 next June.
  2. **FXW-AUD**: fade AUD/USD's Sunday-open gap, +21.8 bps on 85 weekends on FXCM (t 5.58); needs a broker's own
     Sunday quotes first.
  3. **DCS**: the cheaper class of a dual-class holding, +0.59 %/yr: an overlay.
- **Dead:** pairs (−0.69 %/yr gross), ADR switching, the 4 pm fix, Deribit parity, the volatility premium (gone in 2026),
  Hyperliquid–OKX funding, DeFi lending (cash), staking tokens but rETH (31 bps, redemption-gated).

### [2026-10-09 18:40 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **CJ5's CoinJar recorder built** (Davies: "建起来"; what-remains item 11; reference §4 item 57): `agents?action=cjrec`
  every minute (`edge_calls` row, 30 s, `retry` on, beat via `serveRequest`), migration `0110` (`cj_trades`, `cj_book`,
  `cj_rec_state`, RLS on, no grant; `cj-rec-prune` drops books after 35 days, prints kept), `agents/cj_rec.ts` and
  `cj_rec.test.ts` on a fixture of CoinJar's own answers (`backtests/cjrec/`). Keyless GETs of
  `data.exchange.coinjar.com` only; nothing trades. USDC/GBP and USDT/GBP; USDC/AUD left out (dead on S1, 491 prints a
  day). Not a monitor health reading (a research recorder).
- **Found:** CoinJar's full print history is keyless (`/trades?after=<unix s>`, inclusive, ascending, 1,000 a page;
  back to 2020-04-02 on USDC/GBP), so the search's "~500 prints, about eight days" was the default page; and CoinJar has
  a post-only time in force (`MOC`). The review's §5.2 still says otherwise; not edited here.

### [2026-10-09 18:35 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **`p50x1` withdrawn, rule D's twin "variant-3" again** (Davies: "删掉 p50x1：回到 4 个测试版本，规则 D 改回 variant-3。",
  after the F3 replay): `0109` waits (≤ 70 s) for the `quotes-twins` lease to be free and holds its row, deletes the
  spec row, renames `d` back (delete first: names are unique), drops the six `agent_quote_twin_p50x1_*` tables and the
  `quotes-twin-p50x1` lock row. Production before (read-only, 18:24 UTC): five rows, p50x1 catching up at 10-07 16:46
  (3,540 orders, 270 events, all `p50`'s: its offset was to start 10-12); no view, cron job or retention job names its
  tables. `exitOffset` stays in `quotes_twin.ts`/`quotes_live.ts`, named by no row (removing it changes the hash two
  pre-registrations pin). Removed `p50x1.json.gz`, `src/p50x1_twin.test.js`; fixture regenerated (`fixture.ts` applies
  deletes; byte-identical to the pre-`0108` one). Notes: p50x1 prereg §7, twins §17, p50 §11, rule D §10.


### [2026-10-09 17:58 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **STATARB, the stat-arb search** (Davies: "…还有没有其他有statistical arbitrage的策略，其他平台也可以，并先不考虑合规问题"; then
  "我开不了Kalshi的账户，Kalshi平台可以rule out"): `reviews/2026-10-09-stat-arb-search.md`, evidence
  `backtests/statarb_search/` (map row). Keyless public data only; nothing traded, opened or signed up for; no production
  read; nothing frozen.
- **Ranked:**
  1. **PR5-EUR**: PR5's rule on Revolut X's EEA USDC/EUR. Screen $0.80/day on $600 over 08-10 → 10-02, 44 of 45 days
     positive; 1.6–3.8× the UK books per dollar. A live version needs an EEA account, which by Revolut's help pages
     closes the UK account.
  2. **CJ5**: the same rule on CoinJar UK's GBP books (0 % maker, 1.9× per dollar, $36k/day of books). Recorder first.
  3. **CBSWEEP**: deep 0 % bids on Coinbase's `fx_stablecoin` books. Lumpy, September only; history test first.
- **Dropped:** Kalshi (both the cross and its ~$385k/day incentive program), Smarkets (£14k matched on 28 NFL games),
  Limitless (pools $0), DeFi stable LPs (0.58 %/yr), HLP (4.06 %), stETH queue (~1 bp), Kraken (0.20 % maker on
  stable/FX books), Bitstamp.
- The three paper-test drafts and what each needs from Davies are the review's §5–§6.

### [2026-10-09 17:36 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **F3 validated by a full replay: one tick beyond fair is NOT robust** (Davies: `"F3 卖出价可以再挂远一个 tick"完整验证一下`).
  `backtests/scq_f3/` (map row): the twins' own code (quotes_twin/quotes_live/revx_sim, patched copies at run time, nothing in
  `supabase/functions` edited) over 09-23 15:09 → 10-09 16:00 UTC, read-only pulls. Baseline reproduces the twins to the
  penny (pr5 76 trips +£8.6076, p50 87 +£5.2830; 167/168 and 188/189 fills identical, one stop a turn early); stored prints
  = public tape (3,849). Through-only fills: +1 tick pr5 +£0.65 (+7.6 %), p50 +£0.24 (H2 ≈ 0), £10 −£0.01. At-price fills:
  pr5 −£0.70, p50 −£0.20, £10 −£0.05; LIVE filled 22 of 44 exits with no print through them, so at-price is the nearer
  model. Not for LIVE; `p50x1`'s bar on the through-only twin would read the favourable side only. Not blind; no reading.

### [2026-10-09 17:17 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **"Stablecoin quotes variant-3" = `p50x1`, rule D's twin renamed "variant-4"** (Davies: "新增 TESTING "variant-4"（p50x1），
  但和目前的variant-3换位置"): `0108` (rename first, names are unique; row at order 35; tables), rule extension
  `exitOffset` (`quotes_live.ts` `exitAt`, `TWIN_RULES.exitOffset`), backfill `p50x1.json.gz` = `p50.json.gz` but its id,
  pre-registration frozen (`reviews/2026-10-09-p50x1-prereg.md`, window 10-12 → 11-09, read ≥ 11-11). Default offset
  proven inert: the six simulated hours with an offset not yet begun equal the frozen executor; ignoring `from` fails it.
  Fixture regenerated (renames applied in `fixture.ts`); twins §16, p50 §10. No `edge_calls` row.

### [2026-10-09 16:54 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Rule D's twin (`d`) drops its 0.03 % rung from 2026-10-10 00:00 UTC** (Davies: "…"规则 D 最内层的档位基本不赚钱"这个档删了";
  review F7): `RULED_D_RETIRED` in `quotes_twin.ts`, the executor's `retired` (no entry, resting one withdrawn, holdings
  still exit, asks' coin leaves it out, £50 a rung kept). The twin alone: rule D's paper arms keep nine rungs (no
  re-decide), so its 10-28 reading is unchanged; code, not a row, so no migration lands before its function. Deviations:
  twins §15, p50 §9, rule D §9, reference item 47. Pins fail on the old code (executor and `asksNeedOf`).

### [2026-10-09 16:37 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **F1 fixed on every Stablecoin quotes row, LIVE included** (Davies: "修复 F1，应用所有tablecoin quotes包括live的"):
  `pennyExit` sizes a buy-back worth £0.10–£0.11 to `floorToStep(pennyUp(n) / price)`; the page books the hair as the
  account's coin at cost (`exitOverbuy`). Pins: LIVE fills 3956/4245/4304 by hand (£0.020663 → £0.000008), and end to
  end on `revx_sim` beside the frozen executor (0.135 → 0.14561, £0.11 both); each fails on the old code. Deviations
  recorded (twins §14, p50 §8, TAKE addendum 2, live design addendum, reference item 35); no frozen hash moves.

### [2026-10-09 17:20 UTC] Platform: Claude Code | Model: not recorded (session policy)
- DAYS' 7-day annualised now counts the seven CALENDAR days before today, not the last seven rows: a day with no order
  has no row (weekends, outages), so seven rows reached back nine days and overstated by up to 9/7 (Davies asked why the
  twins' read so far above LIVE's). What is left of the gap is real: LIVE alone took 10-02's stall and the go-live
  conversions' fee; from 10-04 LIVE and PR5's twin earn the same per pound (review 2026-10-09, 0.200 % vs 0.208 %).

### [2026-10-09 16:45 UTC] Platform: Claude Code | Model: not recorded (session policy)
- Every Stablecoin quotes page (LIVE and the twins) heads DAYS with "- 7-day annualised ±x%": the last seven closed UTC
  days' realised over the capital, a year of them (`quoteDaysAnnualPct`; Davies: "days表格标题days旁边加上近七天平均年化收益率").


### [2026-10-09 16:20 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Stablecoin quotes reviewed, read-only, not blind** (Davies: "testing的4个Stablecoin quotes进展如何？live的进展如何？…testing的策略有改进
  或优化的地方吗？"): `reviews/2026-10-09-stablecoin-quotes-review.md`, evidence `backtests/scq_review/` (map row). No reading
  run, nothing changed in production. The four twins healthy (K1 holds; mismatches 46/46/46/0). Realised to 15:58 UTC: LIVE
  42 trips +£0.2126 (coins' mark −£0.17, GBP/USD); pr5 +£8.61, p50 +£5.28, take50 +£5.49, d +£12.74. Since 10-04 LIVE
  tracks its twin (+£0.240 against pr5/10 +£0.249). New: F1 a £0.10 dust print's buy-back pays a penny for nothing (LIVE
  £0.0207, a tenth of its realised; fix priced, to build on Davies' word as a deviation of the twins' and TAKE's
  pre-registrations); F3 an exit one tick beyond fair would have filled 67/67 of pr5's trips for +8.6 % (draft
  pre-registration `p50x1`, "variant-4", in the review's appendix, needs a small build); no adverse selection on entries;
  LIVE's at-price fills (+20 %) are the twins' blind spot. TESTING: keep all four to their dates.

### [2026-10-09 16:05 UTC] Platform: Claude Code | Model: not recorded (session policy)
- Every Reward quotes page's STATUS values are the scoreboard's size, 13px (12px on a phone), not 17/15 (Davies:
  "STATUS表里的字体请和上面的scoreboard一样大"); the sweep checks LIVE's tile and scoreboard value read the same size.

### [2026-10-09 15:48 UTC] Platform: Claude Code | Model: not recorded (session policy)
- LIVE's "Reward quotes" (Davies: "数字的字体改成绿色的，底下"day …"删掉不显示。…avg cost列删了，换成Rewards(est.)，用最新数据的最合理r
  来估算（每次自动校准后更新），之后的Total也改成Total(est.)算上预估的实时rewards，都实时更新"): REWARDS TODAY (EST.) in green,
  its note gone. QUOTES: Market | Pool/day | Quote | Held | Rewards (est.) | Orders | Total (est.). Rewards (est.) = paid
  + each unread day's formula (today, and yesterday until read) x the market's point R (`lpRewardEstimate().markets`,
  exp of its shrunk log mean); Total (est.) adds the orders, to the cent. Avg cost, `yesCost`/`noCost` and `rwCostOf`
  removed. The scoreboard stays on paid money (guide says so). Fixture regenerated; sweep, unit and view tests updated.

### [2026-10-09 15:10 UTC] Platform: Claude Code | Model: not recorded (session policy)
- LIVE's "Reward quotes" STATUS: TOP SHARE out, QUOTING TODAY and POSITIONS STILL HELD one left, and REWARDS TODAY
  (EST.) last (Davies: "TOP SHARE这个框删了…最右边的那个空余的框显示预估今日rewards收益…（最低-最优）", then "实时更新…自动优化
  算法，然后清0继续算下一个day窗口"). `lpRewardEstimate` (pm_lp_live_view.ts), a pure function of the live reward days and
  `0107`'s view `pm_lp_live_hours` (live minutes by UTC hour and market, last 48 h): so far today = each market's formula
  x its R band; R = log-scale mean of the paid days, shrunk to the prior's √0.2 as two days, band exp(mean ± 1.2816 σ)
  (prior 0.2-1.0 until a payout is read); the day projected at the lowest and highest of the newest hour's, today's and
  the earlier days' rates; a market under $1 counts nothing in the day's low. TESTING keeps TOP SHARE. FUNDED now reads
  the turn's cap (`state.limits.capTotal`). Fixture regenerated; guide, map, sweep updated.

### [2026-10-09 15:05 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **EXPENSIVE-LIMIT, live-prep's Addendum 7** (Davies: "加上，但你研究下这个最多买的数值最优的设定后再加，并且以持仓比例来算不是硬数值"):
  a BUY of a token at >= 0.95 rests only while that token's holding at the mark plus the order stays within **8 % of the
  path's capital** (`PM_LP_NEAR_CERTAIN`, `nearCertainBuyOk` in `pm_lp.ts`; capital = the turn's `capTotal`, which
  `pm_live.ts` now passes as the rule input's `capital`, so it follows whatever sets `cap_total_usd`). Sells untouched.
  Chosen by minimax regret over lambda {0,1,3} x three tail rates, on four simulated cells + the paper + the live fill
  speed: 8 % is at most $1.85/month short of the best (10 %: $2.15, 12.5 %: $5.50); vs no limit -1.72 / +1.36 / +2.24 /
  +2.19 (R .4); worst single hit 8 % of capital (was 30 %). `rwc_opt/results/expensive_limit.txt`. Mid-pool's Addendum 8
  (deviation 8: the field only, its decisions unchanged); `pm_live_hash.test.js` and `pm_lp_prereg.test.js` follow.
  **Open:** lands with the main session's push (Edge deploy); then read that LIVE's resting NO buy on 0xecc209a6 was
  cancelled with gate `rule` and its NO sell still rests.

### [2026-10-09 15:00 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Live-prep's cap follows its equity** (Davies: "每天的rewards受益payout之后立马运用资金进策略…如果我补充资金的话也可以立马运用资金";
  its pre-registration's Addendum 8, mid-pool's deviation 9): `lpCapital` in `pm_live.ts` (sha256 7e3e8c95…), `0106`
  (`pm_lp_config.reinvest` on, `cap_ceiling_usd` 1000). Live, each turn: floor(pUSD + held at cost + unredeemed − 75 −
  5), at most $1,000; down at once, up only on two agreeing reads a minute apart with no fill settling, held on an unread
  balance; off or dry-run, `cap_total_usd` ($320). Stop, N, 5N, $100 a market, 10 markets, $200 stay (LPCAP). Addendum 7's 8 % reads the same cap.
  Pinned: `pm_lp_capital.test.ts` (7), `src/pm_live_hash.test.js`. **Deploying changes live:** after the Edge deploy
  and 0106 both land, the second live turn sets the cap from the equity (about $322 now); the first payout (after
  10-10 00:00 UTC) raises it the turn after it is read. Off: `update public.pm_lp_config set reinvest = false where id = 1;`.
  **Open:** read `select state->'lp'->'capital', state->'limits'->'capTotal' from public.pm_lp_state;` after the deploy.

### [2026-10-09 14:57 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **LPCAP** (Davies: "另外也研究下不同本金的受益会有区别吗，最多能投入多少"): live-prep's L1 at total caps of $320 to $10,000,
  four ways of using the capital (the cap alone, more markets, bigger orders, both by sqrt), on RW's record (14 d) and the
  full-universe record (4 d), both fill models; LPSELF's L1 reproduced byte for byte first. At today's sizes the rule
  holds at most $368-$491 (holdings at cost + resting buys): a larger cap adds ~$0-$1.5 a day at R = 1 and nothing or
  less at R = 0.4, so its return % falls as 1/capital. Bigger orders saturate the pools (our share 0.22 -> 0.38 at 3x,
  0.74 at 31x) while fills grow with size: at R = 0.4 the most is at $1,000-$2,000 with both scaled ($38 -> $60 a day
  on RW's record; $29 -> $41 on the full universe, $18 -> $17 at-price) and every step past $2,000 loses there; at
  R = 0.2 nothing past $640 pays. More markets: 20 at $640 earns +$29 a day at R = 1, +$1.9 at 0.4, and ~20 markets is
  where the 12,000 POSTs a day bind. `backtests/lpcap/`, read in Addendum 8.

### [2026-10-09 04:27 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **EXPENSIVE-SIDE** (Davies: "你先回测研究一下，结果告诉我后我再决定", after LIVE bought 80 NO at 0.97 on the Iran voicemail
  market): limits on buying a token priced >= 0.95 / 0.90 against L1 on RW's and the full-universe record (both fill
  models), live-prep's paper, and a year of Polymarket history (5,617 markets). A $25-a-market cap on buys >= 0.95 costs
  nothing measurable (R .4: -1.72 / +1.36 / +2.24 / +2.19) and bounds one direct expensive buy's loss to ~$25; every
  0.90 rule loses $6-$63 on RW's record (strict). Favourites at 0.90-0.97 lose more often than priced (0.90-0.95:
  10.2 % vs 7.4 %).
  Recommended, not applied: Davies decides. `rwc_opt/results/expensive_side.txt`.

### [2026-10-09 03:55 UTC] Platform: Claude Code | Model: not recorded (session policy)

- LIVE's "Reward quotes" QUOTES drops Share and Rewards and gains Avg cost after Held (Davies: "shares列和rewards列也删了，
  可以在适当位置加一个投入的价格列"): `pm_lp_live_view.ts` adds each row's `yesCost` / `noCost` (the average price of what is
  still held, null for a token not held), `rwCostOf` prints it. TESTING's QUOTES is unchanged. Total still counts what
  Polymarket paid. The `agents` function redeploys for the new fields; the order path is untouched.
- Its QUOTES lists only markets with an order resting or a token held (Davies: "只看正在挂单或有持仓的市场",
  `lpLiveQuoteRows`); QUOTING TODAY still counts the day's chosen markets.

### [2026-10-09 03:40 UTC] Platform: Claude Code | Model: not recorded (session policy)

- LIVE's "Reward quotes" page loses STOP AND GATES (Davies: "live页的子页面中stopandgates那部分也删掉"); a tripped
  total stop still shows as the red line under the scoreboard. `lpLiveGates`, `lpLiveStopText` and their styles went
  with it; the dashboard's `lpLive` still carries `stop` and `gates` (no Edge change).
- Every Reward quotes page's QUOTES shows "—" where it said "nothing resting" (Davies: "nothing resting改为也用"-"表示").
  QUOTES lists the day's ten markets whether or not anything rests: a market with no quote and nothing held is one the
  rule is not quoting that minute (TB1's one-tick skip, x2's pause, no adjusted midpoint, or the caps).
- The ledger had reached 81 KB: the 2026-10-08 22:49 → 23:58 sections moved verbatim to `docs/handover.md` Part 2,
  "LEDGER.md, archived 2026-10-09 (second)".
- Running: a backtest of TB1 skipping only BUYS (resting the sells of what is held) against the live rule (skip both),
  on RWC-OPT's simulator; Davies: "测好了按照更优的方法直接上线".

### [2026-10-09 03:20 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **TB1-SELLS** (Davies: "持有时卖单也不挂吗？"): the TB1 skip as tested skipped held sells too; skip-buys (held sells rest)
  is behind L1 on C1's record (R .4: −30.67 strict, −47.23 at-price) and its tight-minute sells mark out −4 ¢ vs −2 ¢
  (sim and paper). Keep TB1 as is; no live change. `rwc_opt/results/tb1_sells.txt`. Davies had said "测好了按照更优的方法
  直接上线": the better rule is the one live, so nothing was deployed.
