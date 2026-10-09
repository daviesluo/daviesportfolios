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
   - **RW's verdict, on or after 2026-10-09 00:05 UTC** once `pm_rw_days` has its 10-08 row (wake
     `trig_01THWfdRa6aKk2mZg8N8DUzC`, 10-09 00:40): steps a–g of the archived item 2, written up as
     `reviews/2026-10-09-polymarket-rw-paper-result.md`, reference §3.x and this ledger. (a) the spec's six conditions
     from `pm_rw_days` (seed `random.Random(20261009)`, the script committed with its output); (b) replay
     `pm_rw_minutes` with `pm_rw_prints` through the frozen rule and reproduce the fills and rewards; (c) re-pull every
     quoted market's prints from `/v2/trades` (cache-busted) against `pm_rw_prints`; (d) RW-E by its pre-registration
     from `pm_rw_e_days`, after arm `rw` equals `pm_rw_days`; (d2) RW-X1–X3 by `reviews/2026-09-27-polymarket-rw-variants-prereg.md`
     from `pm_rw_x_days`, after its two checks; (d3) RW-X4/X5's Test 1 by `reviews/2026-10-02-polymarket-rw-rest-prereg.md`
     (10-03 → 10-08 from the 10-02 rows, seed 20261009, × 365 / 6, the seventh condition against x1), after the same
     checks and that their 10-01 rows equal x1's; (e) written ahead as `0103` (history 2026-10-08 23:52 UTC): once
     landed, `public.retire_after_rw()` (job `edge-calls-retire-after-rw`, every five minutes at :02, :07 …) turns
     `pmrw`/`pmrw-select` off once `pm_rw_days` holds 10-08 and `pmrw-e`/`pmrw-x` once their replays hold it on every
     arm; the verdict confirms it fired (`select path, enabled from edge_calls where path like 'agents?action=pmrw%'`;
     `cron.job_run_details` for the job), and writes no second migration (RW-C's four `pmrwc*` rows untouched; the
     tables and page rows stay until Davies says); (f) report to Davies in Chinese; (g) RW-NEXT Part 1 (`reviews/2026-09-28-rw-next-prereg.md`)
     names the candidate, which goes to RW-C before any live design. Name as a deviation of 10-08 that RW lost seven
     `:X0` minutes that day (00:00, 00:10, 00:30, 00:40, 00:50, 01:00, 01:10; fixed by `0097`), minutes stored against
     due; the bar is unchanged. Until then, daily health as the archive lists it (both states' `last_error` and
     clocks, today's selection by ~00:05, a day row a day, no 546/5xx for `pmrw-select`, each arm's `diverged`, the
     checks under $0.01). Do NOT change `agents/pmrw.ts`'s rule.
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
     allowances (his, from Ireland); the monitor's freshness reading for `pm_lp_state` is built (`monitor/health.ts`
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
     function once (0100, 2026-10-08; history 16:59). From 0104 (batch 5, not yet landed) the row waits 15 minutes for
     the deploy (`active_from`); until it is live, land the function first unless the call is resumable.

10. **The repository review of 2026-10-08** (`opus-high`; batches 1–4 approved by Davies, F2, F3 and F11 not):
   - **Open with Davies:** F21 (the coordinator puts it to him; not fixed); M9, a deposit's own-date FX rate instead of
     one frozen rate per currency (reported, not built: it changes the Deposited line and needs FX history by date that
     nothing stores; few deposits are in another currency than USD); #233 (the open `ci-failure` issue, every
     failure since 10-04 green again); eight worktrees under `.claude/worktrees/` and three detached ones with a commit
     not in main (history 17:25); `refreshPrices` still asks for sold-out holdings' quotes.
   - **Batch 4's deploy order, kept:** `overnight-fetch` requires the app token from the commit after the page's
     bundle that sends it went live (app-1b24810b.js, 2026-10-08 ~17:50 UTC); an older tab still open gets no new
     overnight points until it reloads.
   - **M7 (the site's own fonts) reverted, redone in batch 5:** CI's Chromium drew the sweep with Inter for the first
     time (the sweep had aborted Google Fonts, so every earlier run drew a fallback) and three layout checks failed
     (history 17:45). They fail in the headless shell alone; CI launches the full Chromium from T2 (history 23:06, 23:16).
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
   - **Batch 5** (Davies, 2026-10-08: "以上内容都修"; L1, L2 and PITR are handled outside the repository): done on
     `review-fixes`, not yet landed: the board's first paint at 1:1 FX; T1; T2 (the full Chromium on CI); M7 again; D1
     (0104, `edge_calls.active_from`: migrations.yml applies it on landing, and the watchdog redeploys); A2 (the
     `agents` function redeploys); A3; A4; A6; A7; the size budget (`@size-limit/file`; 3.58 kB of headroom). **A1 not
     done, stopped as the batch said:** rounding `applyFill`'s base to 12 digits moves `backtest.ts`'s `run` (ret,
     drawdown, fees, realised in all 24 runs of four coins × three kinds × two stop rules, at most 8.4e-10 relative),
     because a buy from flat (`cash / price`) carries 17 digits; a snap of a residue under 1e-12 of the sizes to flat
     moves nothing tested. The choice is Davies'.

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
under "LEDGER.md, archived 2026-10-01", and the 2026-09-30 → 10-08 16:52 UTC sections, with the list as it stood on
2026-10-08, under "LEDGER.md, archived 2026-10-08"; each oldest first.

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

### [2026-10-08 23:58 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The size budget has lasting room again: the drill-in and the editors left the main bundle** (batch 5's size item).
  Batch 5's first-paint waiting had left 1.35 kB of the 122 kB. A position's drill-in with its player cards
  (`board/position_drill.jsx`) and the lot editor, add-a-holding and cash dialogs (`board/edit_modals.jsx`) open only
  on a click, so they are chunks of their own now, fetched after the first paint with the lists, the ticker chart and
  Agents (`prefetchModalChunks`), each opening in its own frame (`ModalFrame`) should a click beat its code;
  `board/modals.jsx` keeps the frame and the confirm the board itself uses. The budget's figure is 118.42 kB (3.58 kB
  of headroom, from 1.35). What the first paint loads (the entry and the chunk it preloads, gzip -9): 123,360 bytes
  before, 119,771 after (the shared chunk is now formatters and ticker classes, 1,441 bytes; `ops_error.js` moved
  into the entry). The editors' tests read the new modules; the whole unit suite: 1,369 passed.

### [2026-10-08 23:55 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Live-prep against itself: nothing further adopted** (live-prep's Addendum 3, `backtests/lpself/`). Every change to
  S2 + TB1's skip (selection size and cadence, quotes, inventory, exits, pause, stops, caps, horizon, fill cooldown,
  book imbalance) on RW's 14 days and on a full-universe record built from the pm-rec archive (10-05 → 10-08, 1,373
  markets, 1.73 million book minutes); the adoption rule (at-price, R = 0.40, ahead on RW's first and last seven days
  and on the full universe, worst day no worse) passed none; reality check p 0.99. Worth a forward test: re-selection
  every 6 h (+$57 at-price on the full universe, untestable on RW's record), 8N, skip at two ticks. The pm-rec
  archive's signed URLs are read into a padded reply, never shown or committed.

### [2026-10-08 23:52 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **What RW's round 1 leaves running: `0103` and mini-pool off TESTING** (Davies, 10-08: "按你说的停掉mini-pool的两个调用 …
  把你觉得前台和后台不需要和没必要再继续测的策略都可以关掉"; a sub-agent's branch `retire-after-rw`, not pushed). Each of the 27
  `edge_calls` rows (read 10-08 23:31 UTC) was set against the readings still to run (reference §4 item 56). Off at
  apply, on Davies' word: `pmlive`, `pmprep` (mini-pool; the cost he accepted: mid-pool's readout finds mini-pool's
  column empty from 10-09, a deviation it names). Off only once the last day its reading reads is closed: `pmrw`,
  `pmrw-select` (RW's 10-08 day row), `pmrw-e`, `pmrw-x` (their replays' 10-08 rows on every arm), by one function,
  `retire_after_rw()`, run every five minutes by a job that unschedules itself and once at apply, so a push at any hour
  is safe; `enabled = false` only, no table touched. Checked on PGlite 16 (scratchpad `pgl/check2.mjs`): applied with
  days to 10-07 it turns off mini-pool's two and nothing of RW's; RW's day closed with one replay arm missing turns off
  only `pmrw`/`pmrw-select`; each replay goes once its last arm lands, and the job then unschedules itself; applied
  after RW closed it acts at once and leaves no job; applied twice it changes nothing more. `src/cron_jobs.test.js`
  pins the list after it (mini-pool's two off, nothing else), the four RW paths, three guards and the schedule (fails
  on the deferred version, with a guard dropped or a `pmrwc*` path added). Saves ~7,490 Edge calls a day from 10-09. Mini-pool's row and page left
  TESTING (`paperTestRows`; its `prep` still in the payload, adding nothing); the sweep checks a dashboard carrying it
  draws no row and changes no total, and the paper layers' hide-values check moved to mid-pool's page. Kept, with the
  reading each serves: reference §4 item 56. For Davies: `momentum-1d` (no pending reading, no Edge call; retire on his
  word), the views and book recorders (their horizon is his).

### [2026-10-08 23:52 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The size budget measures the gzipped size alone** (batch 5's size item). `@size-limit/preset-app` is
  `@size-limit/file` plus a time plugin that ran the bundle in a headless Chrome (16 s on CI, through estimo and
  puppeteer) for figures nothing gated; `@size-limit/file` alone measures the same gzipped bytes against the same
  122 kB (120,646 before and after the swap on the same bundle) in 0.6 s, and 80 packages leave the lockfile, no
  remaining one changing version. The bundle is rebuilt for the new stamp (`package.json` is a bundle input).

### [2026-10-08 23:49 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **A live Polymarket buy being cancelled counts toward the caps until its cancel is read back** (review A7, batch 5;
  `agents/pm_live.ts`). The caps run before the turn's cancels and counted every buy the turn would cancel as gone; a
  cancel the venue takes and never carries out leaves it resting beside the new buys that used its room. In live mode
  such a buy now counts until its read-back: in full where its slot is withdrawn, and as the larger of the old and new
  order where it is re-priced (the new one waits for the read-back, so they never rest together). In a live turn: none
  of the three paths is live (all dry-run), so nothing today; once live, a turn that withdraws buys and wants new ones
  with a cap binding (a day's new selection replacing yesterday's markets) sends the new ones a turn later, after the
  read-back, and a frozen cancel no longer leaves the book past its cap. Dry-run is unchanged (its cancels are the
  database's and always land), so the dry-run windows and live-prep's recorded `committed` read as before. Pinned in
  `pm_live.test.ts`: A and B resting 24.34 USD under a $30 cap, the next day A and C selected and B's cancels lost;
  the old count left 43.94 USD resting, the new keeps C's buys back and stays under 30, and the same day in dry-run
  places C's buys at once. Every Polymarket test file, the frozen-instance comparisons among them: 171 passed, and 176
  rebased on the payouts-per-path change (869ba644), with which this and A6 merge cleanly. With A6 and this,
  `pm_live.ts` moves from `57f4b1d7…` (named in live-prep's Addendum 4 and mid-pool's Addendum 5) to `e933f28c…`;
  `pm_lp.ts` and `pm_mid.ts`, which the pre-registrations' tests pin, are unchanged. An addendum naming the new hash
  is the coordinator's call.

### [2026-10-08 23:45 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The Polymarket order paths book a buy before a sell matched in the same second** (review A6, batch 5;
  `agents/pm_live.ts`, the live branch of the turn's fill read). `match_time` is to the second and CONFIRMED fills were
  read in `trade_id` order, so a sell matched in the same second as the buy it sells could be counted first, find
  nothing held, and leave the buy standing as a holding: marked at its market, a phantom position, its loss in the day
  and total stops. The fills are now ordered buy first at a tie (as the loop's `positionFromFills`), and `tokenBooks`
  and `sinceOpenPnl`, unchanged, keep that order (their sort is stable). Not in those two functions: the frozen paper
  layers (`pm_prep_frozen.ts`, `pm_prep_mid_frozen.ts`) import `tokenBooks` and book their paper fills in print order,
  which stays. In a live turn: nothing today, as every path is in dry-run and there are no live fills (0 rows in
  `pm_live_fills`, `pm_mid_fills`, `pm_lp_fills`); once live, a same-second buy and sell are booked in that order.
  Pinned in `pm_daystop.test.ts`: 100 YES bought at 0.80 and sold at 0.85 in one second, the sell's trade id first, read
  `{ day: 5, total: 5 }` and the path open; the old order read −40 and tripped the $25 day stop. The Polymarket suites
  with the frozen-instance comparisons: 92 passed.

### [2026-10-08 23:43 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **PR5's governor counts a rate-limit retry as the second POST it is** (review A4, batch 5; `agents/quotes_live.ts`).
  An order the venue turned away with a 429 goes once more (same order, same client id), but the governor counted one
  POST, and a row taken the second time kept no mark of it, so later turns' recounts from the rows counted one too. The
  retry now counts where it is sent, the row keeps `retriedAfter429` whatever the second answer was, and every recount
  (the turn's, and the conversion's check) counts such a row twice (`postsOf`). In a live turn: no order, price or size
  changes; the day's POST count is higher by the number of retries, so on a day with N of them no-entries (900) and
  stops-only (950) come N POSTs sooner, at the venue's own count. How often it happens is not known: of 3,064 live rows
  since 10-01 none was turned away twice, and one taken on its retry left no trace until now. Pinned in
  `quotes_live.test.ts`: six orders with one retried read seven POSTs that turn and the next (the old code: six), and
  `postsOf`'s cases. PR5's instance test beside its frozen copy, the twins and the simulator: 85 passed (the simulator
  never answers 429, so the twins' counts cannot move).

### [2026-10-08 23:41 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **A buy booked from the account with another of its coin unbooked takes only its own coins** (review A3, batch 5;
  `bookLiveBuy` in `agents/tick.ts`, which the loop and PR5's executor both settle through). A buy the venue reports no
  fee for is booked from the account's balance less the rest of the live book (D12), at most its gross. With two such
  buys of a coin unbooked at once, the first was booked its gross out of the second's coins, and the second, short by
  both fees, was refused for good ("settles when the account accounts for it"). When the balance holds more than this
  buy's gross and two steps, its own share is now at most the gross less its fee in the coin (Revolut X takes a buy's
  fee in the coin, reference §3.31). Not the review's fix (count the other open buys in the rest): PR5's rungs rest
  unfilled most of the time, so that would refuse every such settlement while another rung rests. In a live turn:
  nothing changes unless a buy comes back with no fee (none has: 0 of the 76 live fills) and the account holds more of
  its coin than the book and that buy explain; then it books its net instead of its gross. A fee in dollars on a second
  buy would leave its fee as dust at the venue rather than in the book. Pinned in `quotes_live.test.ts`: two 132 USDC
  buys over 263.7624 held book 131.8812 each; the old rule booked the first 132 and refused the second (short 0.2376
  against 0.119 allowed). PR5's instance test (beside its frozen copy), the twins, the simulator and the tick: 196
  passed; the replays never derive a fee, so this branch never runs in them.

### [2026-10-08 23:37 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **A fill the loop books in a turn counts once in that turn's exposure** (review A2, batch 5; `agents/tick.ts`). The
  turn reads the open orders first and their exposure last; a live buy whose fill it booked without closing the row (a
  partial fill that grew, a pending row it reconciled from the venue) counted its new fill twice: in the position, and
  in the open buy's rest computed from the row as the turn began. The rest now reads what the turn wrote, and a
  reconciled pending row found filled (or closed with nothing filled) is no longer an open buy; one closed with a fill
  keeps its old count, as that fill is not in the book this turn reads (a separate finding, reported to Davies). In a
  live turn: only the exposure the risk gate reads changes, and only in the turn that books such a fill; it is lower by
  the fill counted twice, so an entry that double count refused for that turn can go through. No order, cancel, stop or
  row write changes. Pinned in `tick.test.ts`: the turn that books 0.05 more of a 0.155 buy at 129 reads the same
  exposure as the turn after it, and a reconciled pending buy too; on the old code $26.46 against $20.01 ($6.45 = 0.05 ×
  129 twice).

### [2026-10-08 23:35 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Live-prep takes TB1's skip** (Davies: "给 live-prep 加上 TB1 的 variant-3 规则：盘口只差 1 tick 时不挂单"): `lpQuotes` rests
  nothing in a market whose raw touch (the book without our orders) is at most one tick (`PM_LP_TIGHT`, `isTight`);
  `pm_lp.ts` only, mini-pool and mid-pool unchanged. Its pre-registration's Addendum 2 records the word, the evidence
  (S2 → S2 + skip on RW's 14 days: +$68.85 strict, +$141.19 at-price at R = 0.40; −$22.51 at R = 1; p 0.78 / 0.28 after
  35 changes) and that P2–P5 read the new rule from its first deployed minute; RWC-OPT's Addendum 1 makes C1 the
  out-of-sample measure of it. After the deploy: read `pm_lp_state.last_error` and that `pm_lp_minutes` has a row every
  minute. Not armed; only Davies arms.

### [2026-10-08 23:33 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **A call the one-minute job gains waits 15 minutes for its function's deploy** (review D1, batch 5). 0104 adds
  `edge_calls.active_from` with no default, so every row on the list holds null and is called as before, then sets the
  default `now() + 15 minutes` for every row inserted later; the job (0075's request word for word) adds
  `(call.active_from is null or call.active_from <= now())`; `edge-watchdog` counts a row due only from the first
  minute that begins at or after its instant, and reads the list whole (`select=*`), so it and 0104 land in either
  order. Safe while the job runs: `lock_timeout` 3 s, reset after; `db push` (CLI 2.117.0's `ExecBatch`, read from its
  source) sends the file as one transaction with its version row. migrations.yml no longer cancels a run in flight.
  Why 15: on 10-07 and 10-08 a migrations run took 20 to 67 s and a deploy run 65 to 145 s (GitHub's run times);
  0100's row met trading212 v74 once. On PGlite (Postgres 16, pg_cron/pg_net/Vault stubbed) after 0075, 0099 and 0100
  (0103, which only turns rows off, not run there; it was 0102 until 0103 landed first): 0104 applied twice; 19 rows,
  none with an instant; at 2026-10-09 10:00 UTC the old and new job queue the same 18 calls in the same order; a later
  insert gets written + 900 s and is queued at +15 min, not at +14.99. Pins: `cron_jobs.test.js` (the file's five
  statements in order, the job's filter, every migration that inserts into the list, 0075 to 0100 holding null and any
  later row the default, an insert naming the column refused, migrations.yml's concurrency) and the watchdog's Deno
  test (the instant, a held row neither missing nor run early and retried from its minute, the whole-row read); each
  fails on the old code or a broken 0104 (no file; the job without the condition; the column added with its default,
  which would have held the whole list for 15 minutes).

### [2026-10-08 23:30 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **RWC-OPT frozen before RW-C's first minute** (Davies: "RW-C…可以用目前所有最新的数据看看RW-C可不可以优化到最佳吗", "效果优先").
  A read-only search on RW's record 09-25 00:00 → 10-08 23:10 UTC (65 arms, strict and at-price fills, R 1 / 0.4 / 0.2,
  walk-forward, reality check) with live-prep's Phase A simulator plus TB1's option, which reproduces `pm_rw_days` to
  $1.6e-12 and TB1's 10-03 figures to the cent. Nothing beats S2 after the correction (p 0.78 strict, 0.28 at-price at
  R = 0.4); S2 + TB1 skip was the walk-forward's pick on 6 of 8 days (+$68.85 strict, +$141.19 at-price over 14 days, in
  sample). Frozen as C1 (primary), C2 (exits, reported) and C3 (x3 + TB1) in
  `reviews/2026-10-09-rwc-optimised-arms-prereg.md`, read after 10-23 00:05 on RW-C's record (item 2). RW-C's engine,
  selection, replays and every frozen pre-registration are unchanged; RW's 10-04 → 10-08 inputs are committed gzipped
  (3.3 MB) beside the scripts.

### [2026-10-08 23:16 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The site's own fonts are back (M7 redone), and the sweep checks it draws in them** (review batch 5). 6e8d7544
  cherry-picked as it was (Inter and JetBrains Mono from `src/app/fonts/`, Google's files and rules but for the URL,
  preloaded; the CSP and the worker without Google; its evidence is in 6e8d7544's own ledger lines, which the revert
  e7f0cafe took out) and the bundle rebuilt here: its stylesheet and the 12 font files hash as M7's did. New sweep
  check `fonts` (both widths): both families' Latin faces loaded, none failed, the page set in Inter and the book's
  total in JetBrains Mono. On the bundle before this commit it fails (`inter: false, mono: false`: Google's stylesheet
  is aborted, so no face exists) and the other 243 desktop checks of the main part pass. The whole sweep (648 checks)
  and the perf matrix (76) on this bundle: CI's browser after T2 (Chrome for Testing 153.0.8010.12, found by
  Playwright's own lookup with no shell installed) and this container's full Chromium 141 all green; the headless
  shell (141 and 153) green but for the four layout checks it alone failed before, unchanged: `desktop/agents` the
  RW-E row and the variant rows (each name on two lines), `desktop/tabs/rwx-waiting` (NEXT on three lines),
  `phone/tabs/pr5-page` (ROUND TRIPS and the orders 6 px past their boxes). Nothing launches the shell now, so CI
  should be green; its first run on the landed commit is the proof.

### [2026-10-08 23:06 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The browser checks run in Playwright's full Chromium, not its headless shell** (review T2, batch 5). Asked for a
  headless Chromium with no channel, Playwright 1.63 launches `chromium-headless-shell` (its source: `getExecutableName`
  returns the shell when `headless` and no channel), which alone failed four layout checks with the site's own Inter
  that full Chrome 141 and 153 pass. Both checks now launch with `src/e2e/browser.mjs`'s options: `channel: 'chromium'`
  (Playwright's documented switch to its full Chromium in the new headless mode), or the browser
  `PLAYWRIGHT_CHROMIUM_PATH` names, which wins. check.yml installs with `playwright install --no-shell chromium`: Chrome
  for Testing 153.0.8010.12 (`chromium-1243`, cdn.playwright.dev/builds/cft/153.0.8010.12/linux64/chrome-linux64.zip)
  and FFmpeg 1011, no longer the headless shell 1243 (`--dry-run` lists both; nothing else launches the shell: the size
  budget's timer finds the runner's own Chrome). Proved through Playwright's own lookup with a registry of CI's two
  builds: the old options launch `chromium_headless_shell-1243`, the new `chromium-1243`; with the shell absent, as CI
  installs now, the old options fail ("Executable doesn't exist") and the new launch. The whole sweep (646 checks) and
  the perf matrix (76) are green that way on this bundle. Pinned in `e2e_browser.test.js`: the options, both scripts
  launching with them alone, and CI's two installs; each fails against the old scripts, check.yml or options.

### [2026-10-08 22:55 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **No unit test reaches the network** (review T1, batch 5). Four performance-chart test files left the recorded
  snapshots and the overnight points unmocked: each Vitest run sent production's Edge Functions 25 GETs with the anon
  key (28 on this branch before this commit, measured with a preload that records and blocks every fetch), about 560 a
  day from local gates and CI. The four files now mock `refreshPriceSnapshots` (answering as a failed read does) and
  `fetchOvernightSeries` (nothing), and `src/test_setup.js` refuses any fetch beyond this machine: it rejects as a
  network failure does, and the test that made it fails when it ends, naming the URL. Under the same preload the whole
  run (74 files) now sends nothing beyond a loopback probe of the guard's own test. Pinned in `network_guard.test.js`
  (refused and recorded, loopback through, a stub gives way and the guard returns, and a swallowed refusal still fails
  its test); on main all four fail (no guard: the `.invalid` fetches fail on their name instead, and nothing records them).
  `test_setup.js` counts in the build stamp (`build_stamp.js` leaves out only tests, `e2e/` and notes), so the bundle is
  rebuilt with it; only its stamp moves.

### [2026-10-08 22:52 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Cloudflare and Supabase settings from the second review, done by Davies' other tool and checked from outside.**
  L1: Bot Fight Mode was on and is off, and the zone's separate `enable_js` (JavaScript Detections, which the Free
  plan's dashboard does not show; read by API) is now false: the home page and an unknown path carry no
  `/cdn-cgi/challenge-platform/` script (checked 22:46 and 22:50 UTC). L2: Browser Cache TTL is "Respect Existing
  Headers"; `sw.js`, `robots.txt` and the CSS now answer `max-age=0, must-revalidate`; no Cache or Page Rule. The
  token `daviesportfolios-pages-deploy` gained Bot Management write and Zone read on daviesluo.com only. PITR is OFF
  (the add-on is not enabled): the off-site copy (B1/B2) waits on Davies' choice of where. The monitor's deploy token
  is fine: monitor-deploy's last run (10-07 21:41 UTC) uploaded the Worker with `secrets.CLOUDFLARE_API_TOKEN`, so
  that secret holds a token with Workers Scripts edit, whichever of the account's tokens it is; a rotated one needs
  Pages and Workers Scripts both.

### [2026-10-08 22:49 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Nothing on the board draws the book at 1:1 before the exchange rates load** (review batch 5, approved by Davies
  2026-10-08: "以上内容都修"). Until the first market data lands, a holding whose FX pair is missing is valued at 1:1;
  the scoreboard has waited with a dash since 0bbc0829, and now so does everything else that converts with that pair,
  on one rule (`fxPendingOf` in `metrics.js`, and `fxPendingFor` in `fx.js` for what values the whole book): a position
  card holding one (value and move), FORMATION VALUE (dashes, in the board's order), Top Movers in dollars ("loading…",
  percent ranks at once), the captain's armband (none), the heat map (empty), the performance chart ("Loading…", sold
  holdings counted), the position, holding and sector lists (their dollars, shares of the book and sector percentages;
  export off), the ticker page's Cost/Value/G/L and share, and the history's realised total. Once the market data has
  landed, a pair still missing is the FX MISSING badge's, as before. The sweep's main part records every card's and
  FORMATION VALUE row's value from the first paint (`first-paint`, both widths): on main's bundle it caught
  `BRIT VUAA: $490.00 before $612.50` and the fund's card `$300.00 before $30.00`; green on this one. Pins in
  `metrics.test.js`, `pitch.test.jsx`, `header_sidebar.test.jsx`, `heatmap.test.js`, `perf_chart.test.jsx`,
  `modals.test.jsx`, `holdings_list.test.jsx` and `sectors_list.test.jsx`: the eleven new waiting cases fail on main.

### [2026-10-08 18:35 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Batch 4 finished in production; the second, read-only review reported** (item 10 lists its findings). fc2e8209
  pushed once the page that sends the token was live (e7f0cafe, app-1b24810b.js): overnight-fetch v39 answers the anon
  key alone with 401 `invalid token`. Checked by hand from the report: `applyFill` subtracts a sell unrounded
  (`_shared/agents_strategy.ts:100`), and `perf_chart.test.jsx` mocks neither `price_snapshots.js` nor
  `overnight_intraday.js`, which is how vitest reaches production.

### [2026-10-08 17:45 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Review batch 4 landed less M7, which is reverted; `overnight-fetch`'s token check waits for a green main.** Batch
  4's eight commits went out as 9ba3d76e with the gates green here, and check.yml went red on CI's browser
  (run 37818540386): `phone/tabs/pr5-page` (ROUND TRIPS and the orders past their boxes by 6 px) and three desktop
  checks, `tabs/rwx-waiting` among them (a variant's NEXT on three lines). The sweep aborts every third-party host, so
  until M7 it drew the page in a fallback font; M7 served Inter from the site and CI's Chromium (headless shell 1243)
  drew it wider than this container's 1194. The site has always shown Inter, from Google, so the checks may be
  catching a real 6 px overflow on phones; that is for the redo (item 10). pages-deploy publishes only on a green
  check, so the site stayed on batch 3's bundle the whole time; the Edge Functions deployed (trading212 without the
  cash walk, every function for `_shared/token.ts`).

### [2026-10-08 17:34 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The ledger is slimmed and has a size budget** (review F15, approved by Davies 2026-10-08). It had reached 372,764
  bytes (about 93,000 tokens, read whole on every resume): the what-remains list 74,931, the setup 7,835, 168 history
  sections 280,557. MOVED: the list as it stood and the 159 sections from 2026-09-30 to 10-08 16:52 UTC, word for word,
  to `docs/handover.md` Part 2 under "LEDGER.md, archived 2026-10-08", the sections oldest first; a script checked that
  each arrived byte for byte and that nothing else of the handover changed. KEPT here: the setup, unchanged, and the
  nine newest sections (the coordinator's of 16:59 and batch 4's eight). The list is rewritten to a paragraph per open item
  under the same numbers, every open instruction, date, script, wake and deadline kept, each item pointing at its
  archived record; closed or aged-out lines went to the archive only (the errors-box rows of 10-01, PR5's go-live
  preparation, the recorders' first audit, the dry runs' hashes). Item 10 is new: this review's open ends. The
  commit hook's gate 3 refuses a commit that leaves the ledger over 81,920 bytes (80 KiB), naming the move to make;
  `LEDGER_BUDGET_OK=1` commits anyway. Pinned in `src/ledger_budget.test.js` against the hook itself in a scratch
  repository (a ledger at the budget passes, a byte over is refused with the move to make, the hatch passes, a commit
  that does not stage the ledger is not weighed, and this ledger is under it); on the old hook two of its three fail.
  Now 44.7 KB.

### [2026-10-08 17:25 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Issue #234 closed, #233 left, six worktrees removed** (review M8, approved by Davies 2026-10-08; no code).
  - **#234** ("Production monitor: Supabase's minute loop failing", 52 comments since 10-07 03:06) closed with a
    comment: every check has read ok since the last recovery, 2026-10-07 20:35 UTC, and `ops_errors` has no `monitor.*`
    row after it. `monitor-alert.yml` opens a new issue on the next alert and drops a recovery with none open, so
    closing loses nothing.
  - **#233** ("pages-deploy failed on main", 10-02) is open as the one `ci-failure` issue every failing workflow
    bumps: five `check` failures since (10-04 `afa53647` and `768f6fb8`, 10-07 `dd2e979e`, and the two sweep flakes
    `6c141a9a` and `b24cbf30`). `check` and `pages-deploy` have passed on main since (`a4926a3e` 17:02 UTC); left
    open for Davies.
  - **Worktrees:** 19 before. Removed, each clean, its head an ancestor of `origin/main`, with no process's working
    directory or open file in it and no file changed in 90 minutes: `/home/user/dp-fillccy`, `dp-rwcwarm`, `dp-tb1`,
    `dp-tb1rwc`, `wt-rwmerge` (its branch `rw-merge-1791422591` kept) and a scratch checkout of mine. Kept: the
    primary; `dp-review` (this batch); `dp-divs`, `dp-flake` and `dp-movers` (detached, one commit each not in main by
    patch); and the eight under `/home/user/daviesportfolios/.claude/worktrees/`, inside the primary checkout, left
    alone: `agent-ae8f87d2…` (`lp-phase-b`) and `coord` (`coord-main`) are merged, `agent-a16b8130…`
    (`realized-fix`), `agent-a3c95fae…` and `agent-a5a85cb5…` have every commit in main under another hash, and
    `agent-a84c1de2…`, `agent-ac18e281…` (`mid-pool-live-prep`) and `agent-ae80ba22…` hold one commit each not in main.

### [2026-10-08 17:13 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The stated test counts are today's** (review M4, approved by Davies 2026-10-08). The docs said 603 sweep checks
  (CLAUDE.md, README) and 300 (the map), over 1,150 unit and over 950 Edge tests, and 60 perf cases. Counted on this
  branch: the sweep 644 (322 at each width: `main` 242 and 250, the rest 80 and 72), Vitest 71 files and 1,336 tests,
  Deno 1,081 (and 12 steps), the perf matrix 76 cases (60 and 16 of 24H). CLAUDE.md now says 644 on its date, the
  README and the map "over 640", "over 1,300", "over 1,000" and 76, so they stay true as tests are added; the perf
  step in `check.yml` is named with 76. The ledger's history keeps the counts of its day. **Review M5 needed nothing
  more:** F7 already took the build out of the sweep's job, so its "serves the COMMITTED bundle" is true, and
  `build_stamp.test.js` pins that neither bundle job builds.

### [2026-10-08 17:10 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **`_shared/token.ts` says what is true of it** (review M3, approved by Davies 2026-10-08): its header described the
  inline token checks `data`, `trading212` and `ops-error` carried and a migration still to come; all three, and
  `prices`, `chart`, `fundamentals`, `agents` and `overnight-fetch`, import `verifyToken` from it, and the
  constant-time comparison's rationale pointed at a copy in `data` that is gone. Comments only. **A change under
  `_shared/` redeploys every function** (`bin/edge-changed.sh`), so this commit alone of the batch redeploys `agents`
  and the rest with the code they run unchanged: land it when a redeploy of every function is acceptable, or hold it.

### [2026-10-08 17:09 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **`overnight-fetch` requires the app token** (review M6, second half; approved by Davies 2026-10-08). The handler is
  now `handle()`: the preflight as before, then `verifyToken` on `x-app-token` (any valid role) before the table is
  read, a 401 `{"error":"invalid token"}` otherwise; the Supabase JWT gate stays on. The health check probes it with
  `check_token_gated` (401 is healthy), and its unused `check_anon` went. Deno pin in `overnight-fetch/index.test.ts`
  (no token and a forged one refused before any read, a valid one served, the preflight free and still allowing
  `x-app-token`); 9 pass. **Deploy order:** the function deploys minutes after a push, the page only once
  `check.yml` has passed, so a tab still on a bundle older than the commit before this one gets no new overnight
  points until it reloads (it keeps its cached ones). Push this commit after that bundle is live, or accept that.
  A health-check run in the minutes between this push and the deploy reads 200 and would open an issue.

### [2026-10-08 17:08 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The page sends its app token to `overnight-fetch` too** (review M6, first half; approved by Davies 2026-10-08).
  The function is anonymous: anyone with the public anon key could ask it about up to 100 tickers a call and learn
  which US holdings have overnight points. Its callers, found: the page (`fetchOvernightSeries`, from `app.jsx` and
  the ticker chart's data hook), the health check (`healthcheck.yml`, anonymous, expects 200), and the two browser
  tests' mocks; nothing in `workers/`, no job. This commit is the client half, so that no open tab is refused when
  the function starts requiring the token: `edgeHeaders()` (now exported from `yahoo_fetch.js`, the one copy) on the
  call, and `/overnight-fetch` among the sweep's token-required functions. Pins: `overnight_intraday.test.js` (the
  header; fails on the old client), and the sweep's `token` check, which on the previous bundle fails "calls without
  X-App-Token: /overnight-fetch" and on this one passes (desktop `main` 242). The function and the health check
  change in the next commit.

### [2026-10-08 17:05 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The sweep's Binance venue is the one the dashboard sends, and the London pin says why it stays** (review M2,
  approved by Davies 2026-10-08). The fixture's Binance venue read an account (`canTrade: true`, USDT and BNB
  balances) that the dashboard has not read since Binance became a keyless paper venue (`binancePaperVenue`, `0049`):
  it is now `canTrade: false`, no balances, and the paused fixture's fault is worded as the dashboard words one now
  (`quotes: binance … 451`). The three Binance paper rows `0065` deleted STAY in the fixture: its comment says why (a
  venue with rows of its own beside Revolut X, and Binance's card, stay tested), and a venue with no row getting no
  card is pinned in `agents.test.js`; my finding missed that comment. `agents.js` and its test: the dashboard stays
  pinned to London, beside the database; Binance's 451 to US regions is now the reason only for a Binance row. Sweep
  `main` 242 and 250 green on the rebuilt bundle; agents unit tests 129 pass.

### [2026-10-08 17:02 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The Trading 212 cash-movement walk is gone from `trading212`** (review M1, approved by Davies 2026-10-08):
  `?action=history-sync`, `?action=transactions`, the walk, its page fetcher, shaper and cursor helpers, about 400
  lines and their 8 tests. Dead since the 2026-08-18 rollback: no client or job calls either action (the function's
  log for the last 24 h has only `orders`, `orders-sync`, `dividends` and the holdings read), and
  `t212_transactions_sync` was last written 2026-08-18. **The tables `t212_transactions` and
  `t212_transactions_sync` stay** (nothing written to either since 2026-08-18): no migration drops them, and a
  later reader of the cash history starts from them. `orders-sync` answers as before less its always-false
  `transactionsComplete`, which nothing read. Deno: 67 pass.

### [2026-10-08 16:59 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Review batch 2 verified in production; batch 3 (F7, F12, F13, F14) landed as the reviewer committed it**,
  fast-forward on 1bcf9079 with the same hashes; a rebuild at the head leaves dist/ unchanged (F7's stamp).
  - Batch 2's runs all succeeded: agents v149, trading212 v75, monitor v4; 0098–0101's jobs present.
  - **A deploy-order hazard, seen once**: 0100's `trading212?action=orders-sync` row went live with migrations.yml
    before edge-functions.yml finished trading212 v75 (15:50:34 UTC), so the 15:50:13 call and the watchdog's retry
    met v74, which refused every POST (405, one `edge-watchdog.retry` row). From 16:00 it works: POST 200 on v75,
    about 10 s, its beat written. The walk resumes, so nothing was lost. A migration adding an `edge_calls` row for an
    action its function learns in the same push can meet the old function once; harmless when the call is
    resumable, otherwise land the function first.

