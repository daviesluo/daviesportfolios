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
     on 10-08 00:33. After 10-09 00:05, `pm_rwc_days` holds 10-08 with `detail->>'phase'` = `warm-up`; after 10-10 00:05
     (wake `trig_0147EKGhR4aHoVq5QWUFy1mr`) both replays' `checkMaxUsd`, and the x replay's `checkEMaxUsd` over
     `checkEDays`, under $0.01, read as scalars. **Verdict on or after 2026-10-23 00:05 UTC** (wake
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
   - **The twins** (TESTING's stablecoin rows; `0087`–`0090`, `agents/quotes_twin.ts`, reference §4 item 51, one row
     each of `agent_quote_twin_specs`: `pr5`, `p50` = variant-1, `take50` = variant-2, `d` = variant-3). Daily health:
     each `_sim.last_error` empty, `paperCheck.mismatches` 46 for `pr5` and `p50` (all before 2026-09-24 18:13) and 0
     for `d`, `_state.updated_at` within ~3 min, `edge_call_beats` has `agents?action=quotestwins` each minute, no
     `agents.quotes_twins` errors, no twin row in `agent_quote_live_orders`. Readouts, no pass bar: PR5's twin beside
     PR5's verdict (10-21) with `p50` per rung; rule D's twin after rule D's reading (10-28) with `p50` at their three
     common rungs. **TAKE** (`take50`, `reviews/2026-10-03-take-prereg.md` and its Addendum 1): take trips opened
     2026-10-04 16:00 → 2026-11-02 00:00 UTC (extended a week at a time to 11-30 until 15 have closed); read on or
     after the window's end + 2 days by a script committed before it ends, whose K2 mirrors the prereg's deviation 1;
     K1 held at 05:03 on 10-03 and is checked again over the whole span.
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
"LEDGER.md, archived 2026-10-09", and the 2026-10-08 22:49 → 23:58 UTC sections under "LEDGER.md, archived 2026-10-09
(second)"; each oldest first.

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

### [2026-10-09 02:46 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Fees on every Reward quotes page and the Polymarket card** (Davies: "像live一样加入fees行"; "按照实际情况估算"), and HELD
  off LIVE's page ("QUOTES表里已经有了"). `agents/pm_fees.ts`: fee = C × rate × (p(1−p))^e, 5 dp, makers never charged
  (docs trading/fees; clob-client-v2 `calculatePlatformFee`); maker rebate estimated as rebateRate × own fee-equivalent
  (docs maker-rebates), shown apart, counted nowhere. Paper fills are all makers' → fees $0; fee types from RW's `cat`
  and `pm_rec_markets.fee_type`. LIVE: each trade record's `trader_side`/`fee_rate_bps` (all MAKER, $0). Not pushed.

### [2026-10-09 02:25 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **LIVE's live-prep row is "Reward quotes", its page below the scoreboard reshaped** (Davies, three messages: rename;
  "STATUS里WORST CASE部分改为实际R值"; "表格部分还是用现在的live页里的设计…RECENT ORDERS表删了，DAYS表放在所有表最上面";
  "RESTING ORDERS表格还是改为testing页的QUOTES表格吧，fills也一样"). Page: TESTING's STATUS with R (ACTUAL) = Σ paid ÷ Σ formula
  on live days read ("—" before), then DAYS, STOP AND GATES, HELD, TESTING's QUOTES and FILLS (`RwQuotesTable`,
  `RwFillsTable`, now shared). `lpLive` gains `status`, `quotes`, TESTING-shaped fills and the live minute's share; no
  `pm_lpprep_*` read. TESTING's two rows keep their names (distinct ids). Not pushed.

### [2026-10-09 02:05 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The Sonnet sub-agent tier runs at high effort: `sonnet-high` replaces `sonnet-max`** (Davies, 2026-10-09: "以后sonnet的都
  从max改为…", then "改成 sonnet-high吧"). `.claude/agents/sonnet-max.md` is now `sonnet-high.md` (`effort: high`);
  `.claude/CLAUDE.md`, the working-with-davies skill and its two Cursor copies say so. Live-prep's watch was restarted
  on it (Sonnet, high) at about 02:03 UTC.

### [2026-10-09 01:56 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Live-prep's real money is a row of LIVE** (Davies: "网站的agents live页怎么看不到这个上线"; it went live 10-09 01:32:21
  UTC). `agents/pm_lp_live_view.ts` + `readLpLive` send the dashboard's `lpLive` from `pm_lp_*` live rows only: funded
  is the cap (`cap_total_usd`, not the pUSD read, which also holds the stop's room and moves with fills); deployed the
  resting live buys' collateral plus holdings at cost; P&L `tokenBooks`/`bookPnl` on CONFIRMED fills and settlements at
  the last turn's mids, realised plus `pm_lp_reward_days` live actual (native + sponsored) and rebates; formula apart,
  R; fees 0 (post-only); the −$75 stop as the path reads it. Page `LpLiveDetail` (STOP AND GATES, HELD, RESTING/RECENT
  ORDERS, FILLS, DAYS). The venue card's "(Paper)" now follows the books on it (a live book folded on LIVE was "(Paper)").
  Not pushed: sub-agent commit for the main session to land; `pm_live.ts` and `pm_lp.ts` untouched.

### [2026-10-09 01:55 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **LPRESEL6 frozen** (Davies on the 6-hour re-selection: "这个你觉得有必要加吗？有必要的话就加上"): an offline forward test of
  live-prep's rule against it re-selecting at 06/12/18 UTC, on pm-rec's whole-universe record 10-09 → 10-23, bar at
  R = 0.40 under both fill models (paired day bootstrap seed 20261023 index 100, market-days less the best, worst day no
  worse). In sample (10-05 → 10-08, this pipeline): +$61.63 at-price, −$56.11 at R = 1, bootstrap negative on four days.
  Retention read: `pm_rec_archive` rows and `pm-rec` objects are never deleted (URLs 365 days, re-signed); frames go after
  7 days once archived. No new Edge call, no instance, no change to live-prep.

### [2026-10-09 01:51 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Live-prep may send 12,000 POSTs a UTC day, up from 6,000** (Davies: "同意提到 12000"; branch `lp-governor-12k`, not
  pushed). Live it posted 98 between 01:33:04 and 01:48:05 UTC (about 392 an hour, 9,100 to 9,400 a day): the 6,000
  governor would have stopped every order between about 16:15 and 16:50 UTC.
  - Code: `lpLimits` takes live-prep's own ceiling `PM_LP_MAX_POSTS_DAY` = 12,000; `PM_LIVE_MAX_POSTS_DAY` stays 6,000,
    so mini-pool and mid-pool are exactly as they were. `pm_live.ts` sha256 `8920e0c2…466a` (from `a208878b…`).
  - `0105_pm_lp_posts_12000.sql`: `pm_lp_config`'s CHECK admits 12,000 and its row is set there; no other column. The
    turn uses min(config, code), so either deploy alone keeps 6,000; `lock_timeout` 3 s, safe while live.
  - Live-prep's Addendum 6 and mid-pool's Addendum 7 (deviation 7); a dated note on the design doc's "POSTs a day" row.
  - Pins: `pm_lp.test.ts` (lpLimits; an armed day at 6,001 posts on, withheld at 12,000, and at 6,000 with the config
    at 6,000), `pm_live.test.ts`/`pm_mid.test.ts` (mini-pool's and mid-pool's governors stop at 6,000),
    `src/pm_live_hash.test.js` (the bytes and the addenda chain). 221 `pm_*`/`polymarket*` Deno tests pass.
  - After deploy: `select max_posts_day from public.pm_lp_config;` reads 12000 and
    `select state->'limits'->>'maxPosts' from public.pm_lp_state;` reads 12000 once both have landed.

### [2026-10-09 01:40 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Reward quotes live-prep is LIVE since 2026-10-09 01:32:21 UTC** (Davies: "可以按原计划上线 … 期间你再验证一下所有系统和
  下单等所有上线会用到的细节都确保没有问题", then "live-prep等代理修好后你再审核一遍，确定所有都没问题了再上线，并且上线后派个便宜
  代理盯着"). Before it: the go-live audit's fixes landed (1e41c315, `pm_live.ts` `a208878b…`, live-prep Addendum 5),
  deployed by edge-functions at ~01:31; the coordinator reviewed the diff; the probe (pg_net, 01:32) read the account
  funded at the design's size, `conditional.sellsApproved` both true, 0 open orders; step 8lp's pre-read (keyed, no
  signer problem, pUSD read 14 s before, eu-west-1, mini-pool and mid-pool unarmed, attested, no global pause). Step
  8lp ran word for word; read back `dry_run` false, `live_confirmed_at` 01:32:21.868885, `cap_total_usd` 320. First live
  turn 01:33: mode live, every gate true (`ctf_approval` true), 14 live post-only BUYs, no error. A `sonnet-max` watch
  reads it every 5 min to 02:40 and every 15 to 07:40 UTC and reports to the session. The Agents page's LIVE tab does
  not show it yet: a live row and page for it are being built (opus-high, branch `lp-live-row`). Kill switches:
  `update public.pm_lp_config set live_confirmed_at = null where id = 1;` (no new buys; sells stay), `dry_run = true`
  (cancels its live orders), `agent_risk.global_pause`.

### [2026-10-09 01:34 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The review's 10-08 sections of batches 1–4, landed and closed, moved to the archive** (`docs/handover.md` Part 2,
  "LEDGER.md, archived 2026-10-09", word for word, oldest first): with batch 5's follow-ups the ledger stood at
  86,571 bytes, over its 81,920 (`src/ledger_budget.test.js`, the hook's gate 3). Three
  what-remains pointers to them now say archived.

### [2026-10-09 01:15 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **UNREALIZED G/L reads a dash or its own figure, never the gain before dividends** (Davies, 10-09: "其他似乎都订住了但score
  board里的UNREALIZED G/L刚刷新的前1s还是会显示别的内容再闪回"). The cause: every average cost on the board is net of the dividends its
  position paid (`withDividendCosts`), and the page read them after its first refresh, not awaited, and kept them
  nowhere, so each load's first figures took no dividend off and UNREALIZED read the gain less every dividend until
  the read landed. PORTFOLIO and DAY CHANGE carry no cost and never moved; TOTAL REALIZED, opened in that second, also
  counted no closed position, the fills not yet read. The fix: the dividends last read are kept (`dp.dividends`, a
  week, as the other first-paint stand-ins) and seed the next load, so a reload draws every figure from the state the
  page last showed; a failed read (`read: false`, new on the fills' and dividends' reads) is never taken for "none";
  until the dividends are known (a first visit, or a week on) UNREALIZED, its percentage and colour and each FORMATION
  VALUE row's gain wait with a dash, and TOTAL REALIZED waits for the fills and the dividends. Sweep part
  `unrealized`, both widths, ACME's shares tagged Trading 212's so the sync runs on every refresh: a first visit with
  the dividends held, then a reload with the service worker in control and every answer held while Transaction history
  opens (`routeWorker` answers the worker's own Supabase requests, which Playwright routes through the context alone:
  unrouted, they would go to production). On main's bundle (app-64101613.js) 6 failures: a first visit —(—) →
  +$412.50(+18.17%) → +$424.50(+18.80%); the reload's first paint +$412.50(+18.17%), then +$424.50; TOTAL REALIZED
  +$120.00 → +$240.00. On this one (app-fc25f1d0.js): — → +$424.50(+18.80%); the reload's first paint and every one
  after it $3,183 | +$30.95(+0.98%) | +$424.50(+18.80%); TOTAL REALIZED — → +$240.00; the sync applied twice after the
  reload and moved nothing. Unit pins, all 12 failing on the old source: the app's (a reload's first renders show 220
  net of the kept dividends, old 200; a first visit waits; a failed read keeps them), storage's, both reads' `read`,
  the scoreboard's, FORMATION VALUE's, TOTAL REALIZED's. Size 118.7 kB of 122. Not covered: the drill, the holding and
  sector lists and the ticker chart, opened on a first visit in the moment between the first refresh and the
  dividends' answer, show the ledger's cost (they wait for the rates alone).

### [2026-10-09 01:06 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Live-prep's go-live audit fixed, one commit each, branch `pm-prego`, not pushed** (the coordinator's batch, on
  Davies' "期间你再验证一下所有系统和下单等所有上线会用到的细节都确保没有问题"; nothing armed, no order sent).
  - **F1, the outcome tokens' approvals** (live-prep's P5). The probe's polymarket part reads
    `/balance-allowance?asset_type=CONDITIONAL` on a token of live-prep's selection today, else the busiest book's, and
    reports `conditional.allowances` named as the collateral block's and `sellsApproved` for the two exchanges. Live-prep's
    LIVE turn opens nothing while its own conditional reads (already made each minute) list either exchange missing or
    at 0: gate `ctf_approval`, said once; sells are never held back by it; no listing at all stops nothing; dry-run and
    the other instances have no such gate. The fake lists both exchanges approved and refuses a sell through one that
    is not. Pinned in `pm_lp.test.ts` and `index.test.ts`.
  - **F3, a POST the venue never took no longer holds its slot for good.** A live row the venue shows nowhere (404) once
    its expiration less the venue's minute has passed cannot rest: closed `expired` with `cancelled_at`, its slot and
    cap freed, said once if it was pending; before that moment it stays for a person, as before. Every path's live
    read-back and cancel; dry-run untouched. Pin `pm_live.test.ts` "unknown is never rejected … (F3)".
  - **F4, a Polymarket Protocol V2 book is unquotable.** The docs (2026-10-09) give V2 books `version: "v2"`, signed for
    0xe3333700… with domain version "3" and a position id; CTF books omit `version`. `bookNow` is null for a book naming
    any protocol (`bookProtocol`), so the selection passes it over and a selected market whose book turns V2 is withdrawn,
    recorded as the condition "a Polymarket Protocol v2 book: unquotable here". None of 10-09's ten books names one, and
    the CLOB's `GET /version` read 2. A refusal "order_version_mismatch" is reported once an hour (`state.versionMismatchAt`,
    kept only once one is). Pinned in `pm_live.test.ts` (three tests).
  - **F5, the dry-run kill switch re-asks a frozen cancel.** On a mode switch, a live order whose earlier cancel the
    venue never carried out is cancelled again (only pending and unread rows wait); before, it rested to its GTD expiry.
    Pin `pm_live.test.ts` "dry_run on: … (F5)", which fails on the old code.
  - The frozen-export checks (`pm_instance`, `pm_mid_formula`, `pm_payouts` tests) list `gates` (F1) and `bookNow` (F4)
    as changed; they fail on F1 and F4 alone until this commit. The minute-by-minute dry-run comparisons with the frozen
    code are unchanged and pass.
  - **U1, sell-first survives either reading of the conditional balance.** The docs imply the balance is the whole
    holding ("maxOrderSize = balance − Σ(openOrderSize − filledAmount)"), and the fake follows that; if it were net of
    our resting sells, the minute after a sell rested would read nothing held and flip the side to a buy. Live-prep's
    live turn now holds `heldFromBalance`: balance + our resting sells when that is at most what the CONFIRMED fills
    explain, else the balance (exact on either reading when fills agree; proof in its comment). Pinned in `pm_lp.test.ts`
    with the fake gross and net (`conditionalNetOfOrders`): one sell resting throughout, no flip, the same POSTs either
    way; it fails on the net reading without the rule.
  - **F2, the hash.** `pm_live.ts` is now sha256 `a208878b0f3b3c70fccee0fef34127ff28fa8fbd96c857e507bb494a88ed2703`
    (from `57f4b1d7…`, through A6/A7's `e933f28c…`). Live-prep's Addendum 5 and mid-pool's Addendum 6 (deviation 6)
    name it and every change since, what each changes live, and the dry-run evidence (the frozen-code comparisons; all
    217 `pm_*`/`polymarket*` Deno tests pass). `src/pm_live_hash.test.js` fails if `pm_live.ts` is not the bytes both
    latest addenda name, so its next change needs an addendum first.
- **RW's paper verdict** (the 10-09 wake; item 2): RW passes 6 of 6 (total +$1,981.72, stress +$94.79), RW-E 7 of 7
  (twelve days +$1,167.04, stress +$289.96 against RW's +$123.31), x1–x3 7 of 7; RW-NEXT Part 1 names **RW-E**, which
  goes to RW-C. `stepRw` reproduces every one of 4,116 fills; the re-pulled prints equal the stored 13,634. RW-X4/X5's
  Test 1 is void (no 10-01 rows for Addendum 1's copy check); descriptively both trail x1's stress. Scripts, reads and
  outputs in `backtests/rwverdict/`; nothing deployed, nothing armed, no frozen file edited.

### [2026-10-09 00:55 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **RW's paper verdict** (the 10-09 wake; item 2): RW passes 6 of 6 (total +$1,981.72, stress +$94.79), RW-E 7 of 7
  (twelve days +$1,167.04, stress +$289.96 against RW's +$123.31), x1–x3 7 of 7; RW-NEXT Part 1 names **RW-E**, which
  goes to RW-C. `stepRw` reproduces every one of 4,116 fills; the re-pulled prints equal the stored 13,634. RW-X4/X5's
  Test 1 is void (no 10-01 rows for Addendum 1's copy check); descriptively both trail x1's stress. Scripts, reads and
  outputs in `backtests/rwverdict/`; nothing deployed, nothing armed, no frozen file edited.

### [2026-10-09 00:51 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **A pending live order the venue's history shows cancelled after a partial fill is booked as a fill** (batch 5's
  follow-up; the finding A2's section reported; `agents/tick.ts`). The reconcile of a pending row (its reply lost)
  from `findOrder` wrote the venue's state as it came, `cancelled` or `rejected` with its `filled_base` beside it. The
  book reads filled and partially filled rows alone, so that fill was in no position, floor or P&L, nor after its turn
  in the exposure, and the turn itself counted the whole buy as open. It is now written as the read-back of an open
  order writes it: `filled`, with its fill, price, fee and `cancelled_at`, and closed for the turn. In a live turn:
  nothing changes until a pending loop order is found in the venue's history closed after a partial fill; its fill
  then enters the book at once. PR5's executor settles a history find through its own read-back (`settleFromView`),
  which already books such a fill as `filled`. **Production read first (SELECT only, 10-09 about 00:40 UTC):**
  `agent_orders` holds 30 rows, 2 live and 28 paper, every one `filled` with its fill; none is pending, cancelled,
  rejected or partially filled, none was reconciled, none carries `cancelled_at`. PR5's `agent_quote_live_orders` has
  no cancelled or rejected row with a fill (2,953 and 35 live rows, and the dry-run's 1,128 and 19), and none of its
  78 live filled rows carries `cancelled_at`. No book is wrong today, and no data was touched. Pinned in
  `tick.test.ts` (a history stub, `findOrder`): such an order, cancelled and rejected alike, leaves the row, the
  position and the exposure exactly as the read-back of the same order does (`filled` 0.05 at 129.01, fee 0.03,
  `cancelled_at`, long, $6.4595 of exposure); the old code wrote `cancelled`, read flat and counted $19.995. The
  tick's 113 tests pass.

### [2026-10-09 00:46 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **A sell that leaves only float residue closes the position** (review A1 by the snap, batch 5's follow-up;
  `applyFill` in `_shared/agents_strategy.ts`). A sell's remainder no larger than `RESIDUE` (1e-12) of the sizes is
  flat: 0.206612 − 0.206 − 0.000612 left 1.4e-18, and 0.1 + 0.2 − 0.3 left 5.6e-17, and either read as long for good
  (the rule never entered the coin again; the floor asked every minute to sell what cannot be sold). In a live turn: a
  position sold in two pieces, or bought in two and sold in one, reads flat after its last sell; nothing else moves.
  (The review's rounding of every base moved `run()` in all 24 runs, by up to 8.4e-10, and was stopped.)
  Byte-identical before and after (scratchpad `a1v/`): `backtest.ts`'s `run()` at full precision, four coins × three
  kinds × two stop rules; `cap_study.json`, `cap_revx.json`, `golive50/replay.json` and the three scripts' output;
  `backtest_ideas`' `ideas.json` less `ran_at`; the books of production's 30 `agent_orders` rows (read 10-08 ~23:20
  UTC); the frozen preps' tests, 7 passed (they book through `pmrw_e.ts`'s own `applyFill`). **Not run, as this
  container has no Kraken or Binance tape:** fp6's `trend_ls` / `score_trend_ls`, `btc_regime`, mx1's
  `cstar/decisions.ts`, and `backtest_binance`, `_set2`, `_tape`, `_sui`, `_xsmom`, `_xsrev`, `_maker`, `_sizing`,
  `_fill`, `_testingset`, `_kraken` (that one lacks the other coins' Coinbase data). Pinned in `strategy.test.ts`:
  both residue cases close (old code: base 1.4e-18, `openedAt` kept), a real 0.000612 remainder stays, and at the edge
  exactly 1e-12 closes while 4e-12 stays.

### [2026-10-09 00:45 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Review batch 5 landed** (approved by Davies 2026-10-08, "以上内容都修"; each commit's own section below): first-paint
  FX, T1 (unit tests off the network), T2 (browser checks on Playwright's full Chromium; CI installs `--no-shell`), M7
  restored, D1 (`0104`, `edge_calls.active_from`, migrations.yml no longer cancels a running push), A2, A3 (a
  different fix from the review's, see its section), A4, A6, A7, the size budget (3.58 kB of headroom). Still with the
  reviewer: A1 by the snap (no frozen output moves), an addendum for `pm_live.ts`'s new hash (`e933f28c…`, A6/A7) with
  a pin, and tick.ts booking the fill of a live order reconciled from history as cancelled after a partial fill.
  `.claude/CLAUDE.md`, `docs/agents/CLAUDE.md` and the working-with-davies skill (and its Cursor copies) now say the
  `--no-shell` install, the network guard and the fifteen-minute wait of a new `edge_calls` row.
- **Polymarket wallet:** Davies funded it for a test; `pm_lp_state` read pUSD $4.996673 at 00:25 UTC, eu-west-1, IE,
  attested, keyed, every gate true, dry-run. A real order has not been sent: the smoke test (one post-only 5-share
  buy at 1¢, read back, scoring read, cancel, read back, allowances read) waits on his word.

### [2026-10-09 00:10 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Live-prep's go preparation, everything short of arming** (Davies: "…然后最好上线准备"). P3 met in code: the payouts-per-path
  change (pending since 10-04) applied as it stood (`pm_live.ts` `4032d6c0…` → `57f4b1d7…`, `pm_mid.ts` comments,
  `index.ts`, `pm_payouts.test.ts`); live-prep's Addendum 4, mid-pool's Addendum 5 (deviation 5), the pending folder
  emptied. The monitor's health action reads `pm_lp_state.updated_at` (`pmLp`, three minutes; the Worker labels it).
  Kill switches read in code: `pm_lp_config.live_confirmed_at` (opening), `global_pause` (cancel-all), the −$75 total
  stop, the cancel read-back and the attestation and region gates. Left for Davies: fund pUSD (≥ $81; $400 for the
  design's ten markets), the probe's allowance read from Ireland, and step 8lp in the conversation where he says go.
