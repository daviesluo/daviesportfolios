# Ledger

The live handover record for this repository, under the ledger protocol
in `.agents/skills/ledger/SKILL.md`. Read this file first on any resume; it is kept
small on purpose. The deep record — the full decision log and the raw
session transcripts — is `docs/handover.md`, which is this ledger's ARCHIVE
and is opened only when a closed item is reopened or audited.

## What remains right now

This list was rewritten on 2026-10-01 to hold only what is open. It keeps its item numbers, which the scheduled wakes
quote. The list as it stood before, and every history section from 2026-09-25 to 2026-09-28, are in
`docs/handover.md` Part 2 under "LEDGER.md, archived 2026-10-01", word for word; an item number in a history section
dated before 2026-10-01 refers to that list. The app's own plan is `docs/improvement-plan.md` (item 7).

1. **Closed: fp5's ranked list** (`reviews/2026-09-26-fp5-review.md`): PR6, funding crowding and DRAW-X failed
   (reference §3.34–§3.36). What it left open is RW-E (item 2), PR5's live path (item 4) and QUEUE (item 5a.4).

2. **RW, RW-E and RW-X1–X3 (Polymarket reward quotes, paper): the verdicts on or after 2026-10-09 00:05 UTC; RW-C,
   10-09 → 10-23, after them.** RW runs 2026-09-25 00:00 → 10-09 00:00 UTC (`agents/pmrw.ts`, `0053`; spec
   `reviews/2026-09-24-polymarket-rw-paper-spec.md`; reference §3.33, §4 item 36). RW-E, RW without the markets that end
   on the day they are quoted, is judged on 09-27 → 10-08 (`agents/pmrw_e.ts`; frozen
   `reviews/2026-09-26-polymarket-rw-end-prereg.md`); its arm `rw` must equal `pm_rw_days` to under a cent.

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
     g. **Read together by RW-NEXT's Part 1** (frozen 2026-09-28, `reviews/2026-09-28-rw-next-prereg.md`), which amends
        what follows each of the three verdicts above: it fixes the candidate among the five arms, and the candidate
        goes to RW-C before any live test or design.

   - **RW-X1 (no weather), X2 (pause on jumps: 15 ¢, 60 minutes) and X3 (both)**: frozen 2026-09-27 18:25 UTC
     (`reviews/2026-09-27-polymarket-rw-variants-prereg.md`), judged on 09-28 → 10-08; `agents?action=pmrw-x` (`0064`)
     replays RW's stored minutes into `pm_rw_x_state` / `pm_rw_x_days`. X3 is off the page (`RWX_OFF_PAGE`) and still
     replayed. **Daily health:** `pm_rw_x_state.last_error` empty, `last_minute` within ~3 min of RW's, `checkMaxUsd` and
     `checkEMaxUsd` (over `checkEDays`) under $0.01, each arm's `diverged` read. Every row's page shows its own record
     only. No market-level figure of 09-28 or later is read before 10-09.

   - **RW-C, RW's rule forward on 2026-10-09 → 10-23 UTC (RW-NEXT part 2; Davies approved the build 2026-09-27): ON
     `main` since 2026-09-28 04:39 UTC** (`3682b557` engine + `0069`, `17728e3c` page; history 00:38 and 05:12).
     `pmrw.ts` as a second instance (`RWC_INSTANCE`) into `pm_rwc_*` (RW's eleven tables, renamed), leases `pmrwc*`,
     warm-up 10-08 00:00 by constant; RW-E and x1–x3 replayed on its minutes with every "from" at 10-09 00:00
     (`pmrwc-e`, `pmrwc-x`). `0069_pm_rwc.sql` adds the tables and four rows of `edge-calls-every-minute`. **Its page row
     "Reward quotes confirmation" appears by itself at its warm-up, 10-08 00:00 UTC** (Davies, 2026-09-28: off the page
     until then; the dashboard reads nothing of it before), "starts 9 Oct 01:00 BST" until its first minute. RW-NEXT
     is frozen (item 5a.3). The four calls return "before its warm-up" / "before RW-C's first minute is decided" (no
     database read) until 10-08 00:00 / 10-09 00:02. **Check after 10-08 00:10 UTC**: first RW-NEXT's slip-rule check
     (item 5a.3, its exact query), then `pm_rwc_state.last_minute` within ~3 min and no `last_error`; after 10-09 00:05, `pm_rwc_days` holds 10-08 with `detail->>'phase'` `warm-up`; after 10-10 00:05,
     both replays' `checkMaxUsd` (and the x replay's `checkEMaxUsd` over `checkEDays`) under $0.01, read as scalars.
     Nothing else of `pm_rwc_*` before its verdict (RW-NEXT's no-peek list). **Its verdict** on or after 2026-10-23
     00:05 UTC by the frozen RW-NEXT (the primary its part 1 names, from `pm_rwc_days` or the replays' day rows after
     the check), then a migration takes the four `pmrwc*` rows out of `edge-calls-every-minute`.
   - **POOLAGE (fp7, 2026-10-01, reference §3.44), only if RW or RW-E passes:** after the verdict, read RW's own
     `others` by minute of day (`pm_rw_minutes`) to see how fast other makers arrive on a reward pool. Build no recorder
     before that read and Davies' word; a recorder's data would cover RW-C's markets, so nobody reads it before 10-23
     00:05 UTC. If both fail, drop it.
   - **The first live step, pre-studied 2026-10-01** (`reviews/2026-10-01-polymarket-live-prestudy.md`, `backtests/pmlive/`;
     Davies asked which Polymarket strategy suits a live experiment): the RW-NEXT candidate, live at small scale as a
     calibration of what Polymarket actually pays (R = actual / formula rewards; RW's six paper days break even at R ≈
     0.40, 0.58 at the stress fills), only after RW-C passes and on his word under Part 4: about 6 markets, ~12 days in
     Ireland, a $300 cap in code, about $400 funded. No money moves before then; its twelve preconditions are listed
     there. Options put to him: 0 as frozen (recommended; first order ~10-29 to 11-01) or 1, a recorded deviation that
     builds the rule-independent order path inert during RW-C (~5–7 days sooner).

   - **Any live step needs RW-NEXT Part 4** (and the pre-study above): Davies' word after RW-C passes; `eu-west-1`
     only; positions opened only while his Ireland attestation is current, otherwise reduce or close only; never a VPN,
     a proxy or anyone else's account; `_shared/polymarket.ts` GET-only until the design is agreed; the Terms of Use bar
     (fp4 §0) stated as his accepted risk; the wallet kept small (its key was exposed to another tool; revoking that
     tool's token is his).

3. **`trend-4h-live` is LIVE on Revolut X at $100** (BTC/ETH/SOL/AVAX, four $25 slots; `0054_go_live.sql`, armed
   2026-09-24 22:53:09 UTC; capital $100 since 2026-09-25 02:42 UTC, on Davies' word). One round trip so far (SOL,
   09-25 → 09-28, −$0.66, read back clean). Its same-venue control is the paper `trend-4h` ($1,000, five $200 slots);
   `trend-1h` and `momentum-1d` are paper at $1,000 (three $333 slots), with paper caps of their own ($5,000, $100 a
   day). Davies: no confirmation of his for any trade after the go-live ("上线后的买卖不需要找我确认，如果真的需要你帮忙盯着就行");
   a session watches when asked and reports, never asks.
   **When asked to look (read-only):** after a 4h close + 3 min (00:03, 04:03 … 20:03 UTC)
   the live row's four decisions beside `trend-4h`'s (same `rule_action` per coin), `agent_orders` where
   `mode = 'live'`, `ops_errors` and the tick's cron runs; five minutes after a live order, its read-back (the fee
   fields or `feeDerived`, `filled_base` in whole `base_step`s (D11), `fromAccount` (D12), the coin's balance
   against the book); after a sell, the book flat and the account under one step. Report a live order, a fill, an
   order `pending` over 2 minutes, a missing decision, a live-row error or a failed tick.
   **The cap is $60 (two slots)
   since 2026-10-01 02:24:51 UTC** on Davies' word ("按照你的建议验证后确定好了就去做"), after an audit found no defect
   (`reviews/2026-10-01-research-round.md` §7, reference §3.44; pins in `agents/tick.test.ts`). **$150 (four) on 2026-10-08**
   (wake `trig_01THvHcphx5gngXugfwwy788`, 06:20 UTC): only if `scripts/cap/clean_week.sql` CW-1–CW-9 are clean, AVAX's
   book (`scripts/cap/book_30d.py`, baseline $31,007) is no worse, and the probe reads USD ≥ $100.20: the account holds
   $99.34 and Davies was asked to top it up to about $115 (the tick does not check USD before a buy; a refused buy is
   recorded rejected and not re-sent). Otherwise keep $60 and tell him what is missing. AVAX stays (his word); re-read its
   book before any raise of the capital. **Never trade by hand in
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

   - A live test on that £50 as a measurement, never as a return (Davies' question, 2026-09-28; answered yes, with
     what it would show): deferred on his word, "£50 实盘之后再说".

   - **PR5V, "Stablecoin quotes - variant": frozen 2026-09-28 14:27 UTC** (`reviews/2026-09-28-pr5-variant-prereg.md`;
     Davies: "本轮优化后的最优策略可以按Stablecoin quotes - variant上线paper testing"). PR5's rule with nine rungs a side
     (0.03–0.30 %), a 0.03 % re-price and four governed keys, $3,600, replayed on paper from PR5's own stored minutes at
     PR5's own timing; arm top5 beside it. Window 2026-09-29 → 10-26 by entry day, paired with PR5 day by day; E =
     10-28 00:30 UTC; read on or after 10-28 01:00 (latest 11-04) by the first session then with the database
     connector, with a reading script committed before 10-27 00:00. Five conditions: faithful to `pr5v_sim.py`, above
     its own null, better than PR5 on a 7-day block bootstrap, stress above zero, the governor held.
     - **The engine runs on production** (`agents/quotes_variant.ts`, `1f16126d`, migration `0071` applied
       2026-09-28 14:46 UTC, `agents?action=quotesv` a row of `edge-calls-every-minute`): flat from 2026-09-28 00:00,
       catching up 120 minutes a call. Its record counts only if its golden replay against `pr5v_sim.py` passed on the
       code that wrote it (it did, on `1f16126d`); a code change after it has decided a minute re-decides everything
       from 00:00 and is a deviation. Check only `agent_quotev_state.last_minute` / `last_error` and `ops_errors`
       before the reading; the page's row (`cfe493df`) shows once the dashboard sends `quotesVariant`.
     - **Deviation 1 (2026-09-30):** `185b9fa` added `entryBand` to this engine after it had decided minutes and kept
       `VARIANT_CODE_VERSION` at 1, where §3 asks for a re-decide on any code change. Bumped to 2: the first call after
       the deploy wipes `agent_quotev_*` and decides again from 2026-09-28 00:00 (about 33 calls of 120 minutes). No
       decision can differ (no PR5V arm sets `entryBand`, pinned; the golden replay passes on the new code). Check after
       it: `agent_quotev_state.last_error` empty, `last_minute` back within ~3 min of PR5's, and variant-2's
       `checkMaxUsd` under $0.01 once both instances have caught up (reference §4 item 45).
     - **At PR5's 10-21 verdict**, keeping PR5's paper engine running is put to Davies: PR5V needs it to 10-28 00:30,
       QUEUE to 11-02, PR5-W to 11-25 (12-23 at the latest). If PR5's record stops early, PR5V's window ends with it
       (the file's fallback; under 21 days it is reported, not judged).
     - Expect the governor to bind: on Yahoo's GBP/USD every key reached 600 POSTs on each fresh weekday, from 14:49
       UTC, and the paired gain there was +$0.28 a day against the 28 days' +$0.64.

   - Faster GBP/USD and more keys (answered 2026-09-28, reference §4 item 46, `reviews/2026-09-28-pr5-fast-fx-study.md`):
     neither earns much more; rule D became variant-2. A TrueFX feed would count only in a live executor that posts at
     once (PR5's live path after 10-21, as a pre-registered change); PR5 and PR5V cannot switch without voiding frozen
     tests.
   - **Variant-2, rule D on paper: frozen 2026-09-28** (`reviews/2026-09-28-pr5-rule-d-prereg.md`): far rungs re-priced
     only past max(0.03 %, k/3), its own instance of `stepVariantMinute` (`agents/quotes_ruled.ts`,
     `agents?action=quotesd`, `0072`); arm `d` is judged, and arm `v1` (PR5V's own settings) must equal PR5V's arm `main`
     or the test is not judged. Deviation 1 (2026-09-30): arm d had priced each turn with TrueFX read after it
     (`backtests/pr5v/lookahead.json`, worth +$0.054 a day; code version 2). Deviation 2 (2026-09-30, Davies: variant-2
     is the test of rule D): arm d reads PR5's stored X, as variant-1 does, so the two differ by rule D alone (code
     version 3, re-decided from 09-28 00:00; the TrueFX code is kept in `954bd25`). Reference §4 items 45 and 47. Check
     only `agent_quoted_state` code 3, caught up, no error, `checkMaxUsd` under $0.01, and no `x_source = 'truefx'` row.
   - **Disclosure (history 2026-09-30 22:14):** this session read PR5V's and variant-2's daily results for 09-28 → 09-30
     before their reading. Both reading scripts are written from the pre-registrations alone (by 10-27 00:00; the 10-24
     wake), and both result files repeat the disclosure. From here the check is `checkMaxUsd` and `checkDays` alone.

5. **Closed: the studies of 2026-09-26/27** (fp6, PMLATE/USLATE, SPEED, VIEWS, WXSRC, HARVEST; reference §3.37–§3.42).
   The view recorder keeps recording; its study is pre-registered after 4–6 weeks (~10-25 → 11-08). One note left:
   PMLATE's and SPEED's post-count figures read one page (100 posts) of the post tracker; re-run them with HARVEST's
   paged reader before any post-count idea is taken up again.

5a. **The seven measurements Davies picked on 2026-09-27, all frozen on 2026-09-28** (the TESTING review,
   `reviews/2026-09-27-testing-portfolio-review.md`; reference §3.43). Their dates and owners:

   1. **JEV-DRIFT: done.** Code live (agents v91), monitor frozen (`reviews/2026-09-28-jev-drift-monitor.md`, §4 item
      43). **Davies chose (c) on 2026-09-28**: a flagged answer vetoes its own entry on a row whose gate has the vote
      (`trend-4h-live` and its control `trend-4h`), the reason naming the flag; the row stays armed, and a row in
      shadow enters, flag reported (`tick.ts`, pinned in `tick.test.ts`; reference §4 item 43). The test double now
      answers each state with its measured reply (`measuredReply`): its old 0.9 lay outside the fixture's band.
   2. **MX-1: frozen 2026-09-28 12:14 UTC** (`reviews/2026-09-28-mx1-maker-first-prereg.md`), as Davies chose on
      2026-09-28 ("MX-1和JEV-DRIFT按照你推荐的来"): one test at 5 %, H1 the mean `A_60` of the trend rules' BTC/ETH/SOL
      exits above 0, with condition 2 at **C* = 110 bps** (measured before the freeze, `backtests/mx1/cstar/`); entries
      at T = 15 and `momentum-1d` described, never judged. A second independent review's fourteen findings were applied
      before the freeze. R1, R2 and R3 are live (§4 items 41, 42, 44); R3 seen working on probes 20 and 21 (orders 43
      and 44). Only events whose bar closes at or after the freeze commit count; no probe after 21 existed at it.
      **Every Monday from 2026-10-05**: pull the UK tape for each event's window into `docs/agents/backtests/mx1/tape/`
      (one gzipped JSON a pull; a failed window is retried every week and is void only if it still fails at the
      reading), and export the `agent_basis` rows (pruned at 30 days) of every event whose `o15` or `o60` is missing
      into `docs/agents/backtests/mx1/basis/`. The pull is `scripts/mx1/weekly.sql` (A: the windows, B: the stand-ins,
      C: eligible events so far, a count) and `scripts/mx1/pull_tape.py`. **Owner:** the session named under "Scheduled
      wakes" in Machine and platform setup, woken every Monday 06:37 UTC from 10-05 by `trig_01Dm3nw4TbBm2GCX2z12tN7o`
      (the helper session and its Routine went with the previous account, 2026-09-30); disable it at the reading. **Read**
      at the first weekly pull after which there are 150 eligible exit events, on the first 150 by `t0`; if fewer have
      `t0` before 2027-06-30 00:00 UTC, after the first pull after it, on all of them (under 60: "undecided"). Expect
      about 14 weeks at the last week's pace and 57 at the backtests', so 2027-06-30 likely comes first, at about 100
      exits (chance of a pass 0.27–0.45 at a true 5 % miss rate). A pass moves only `trend-1h`'s exits, after the five
      checks in its §6.
   3. **RW-NEXT: frozen 2026-09-28 05:36 UTC** (`reviews/2026-09-28-rw-next-prereg.md`); RW-C on `main` since 04:39
      (`3682b557`, `17728e3c`; its page row off until the warm-up, `5a8423a9`). Its slip rule turns on one check at
      **2026-10-08 00:10 UTC**, which the first session on or after then runs before anything else (or a one-shot
      Routine, if Davies grants it the database connector): `select exists (select 1 from public.pm_rwc_selection
      where day = date '2026-10-08' and selected_at <= timestamptz '2026-10-08 00:10:00+00')`, the command of
      `edge-calls-every-minute` and the Edge Function version deployed then; the answer goes here. If RW-C is not warm,
      its dates move by whole days in a commit deployed before 10-09 00:00 (the file's slip rule). Owner since
      2026-09-30: the session under "Scheduled wakes", woken at 10-08 00:32 UTC by `trig_01SY2TY9HuSQY5C7EEB9LD7y`
      (the helper session and its Routine went with the previous account). It writes the answer here and makes the
      slip commit itself if RW-C is not warm; any session after 00:10 checks it did.
   4. **QUEUE: frozen 2026-09-28 06:22 UTC** (`reviews/2026-09-28-queue-prereg.md`); window 2026-10-04 → 11-01.
      **Freeze line:** until the export is taken, none of `agents/books.ts`, the table `agent_book_levels`, its prune
      job `agents-books-prune`, `stepMinute` in `agents/quotes.ts` or its minute record (`agent_quote_minutes`)
      changes, except a longer retention on Davies' word; any change is a deviation. Until then every read of
      `agent_book_levels` is of counts, byte lengths, hashes and timestamps. Its dates:
      - **Dry run, before 2026-10-04 00:00 UTC** (after 09-29 00:10): statements A and B of "Before the window", once
        each, as written (no `page` column). A statement that needs a change is changed before the window and
        recorded as a deviation.
        **Run 2026-09-30 ~20:40 UTC, once each, as written** (this session, Davies' database connector): A `n` 1,254,
        `bytes` 457,371, `sha256` 3c790f0e32ca91f635fb9e50ba7d30b88430b3e61d706bd86d869f24a9109994; B `n` 1,254,
        `first_ts` 2026-09-28 00:00:42.531, `last_ts` 23:55:43.772. The two `n` agree; no statement needed a change, so
        no deviation. The largest book-day's page is 457 KB (about 610 KB in base64). Nothing else of the table was read.
      - Kraken's spare pull between 2026-10-18 and 10-25 (keyless, "Data" item 3).
      - The scorer and checks 1–3 committed before 2026-11-02 00:00 UTC.
      - The export after 2026-11-02 00:10 and before 11-06 10:25 UTC; the tape after 11-02 00:10; Kraken's main pull
        on 11-02 between 00:05 and 19:59 UTC.
      - If check 4 has not passed by 2026-11-04 00:00 UTC, a longer retention is put to Davies.
      - Wakes (see "Scheduled wakes"): `trig_01U3odxMpVv4zaqVueHJvaM7` 10-18 06:20 UTC, the spare pull;
        `trig_01Myqe75KezMbWXZ15qK8mBD` 10-24 09:20, the scorer and checks 1–3; `trig_01Q3DV4MArsf3tQ1Po8yCh1X` 11-02
        00:40, the pulls, the export and check 4.
   5. **PR5-R: frozen 2026-09-28 05:36 UTC** (`reviews/2026-09-28-pr5-readings-prereg.md`). Read after PR5's four
      weeks, before the 10-21 review.
   6. **PR5-W: frozen 2026-09-28 06:22 UTC** (`reviews/2026-09-28-pr5-weekend-prereg.md`). **Freeze line:**
      until the reading, none of `stepMinute` in `agents/quotes.ts`, its minute record (`agent_quote_minutes`),
      `agents/books.ts`, the table `agent_book_levels` or its prune job changes, except a longer retention on Davies'
      word; any change is a deviation. Its dates:
      - **Dry runs, before 2026-10-02 21:00 UTC** (after 09-29 00:00): the fifteen statements of "Before the first
        forward weekend", once each, without the `page` column. A statement that needs a change is changed before
        that closure and recorded as a deviation.
        **Run 2026-09-30 ~20:40 UTC, once each, as written, without `page`** (this session); none needed a change, so no
        deviation. `n` / `bytes` / `sha256`:
        - 3b, closure 09-25 21:00 → 09-27 21:00: USDC-GBP 1,034 / 378,233 /
          36a8149615de9201f4dcab545843c88aed7ceb37d1604bb1e5d28e2e900bc32a; USDT-GBP 835 / 312,763 /
          ffa3b4000943bb25c02cf5c542d97884c598d68f3a5df862b97ca94c4a44992d.
        - 2026-09-28, `agent_quote_minutes`: USDC-GBP 1,440 / 242,914 / 4f121b69cffaf87a9792b36f992bd9cd051b65de62916708aa25eff7adf98b3b;
          USDT-GBP 1,440 / 250,404 / 7a74dc2378078e7761fac86ddc82b44a9f49698c9f0f7f3fdcdb85fb53d44dbb.
        - `agent_quote_prints`: USDC-GBP 80 / 12,539 / 14a01280e8aeacf13afa6ea704850cf41ac1d2e5a9ed0a4b21fa8c1cb11dafad;
          USDT-GBP 227 / 35,526 / bfddb6306d4ef53a879ff4ac19d6a9fd39d563471ab046c6c9188527cc547c6f.
        - `agent_quote_trips`: USDC-GBP 9 / 4,857 / 70cc3ca724306a2e9bf1d31805af16e4adfe4fe27aa902d2f9ffbed6600c02bf;
          USDT-GBP 22 / 12,058 / 70e504083996efdba27c97fc2e6b89b7ffa37fee72d24db009f1132296494656.
        - `agent_quote_events` (not `book`): USDC-GBP 249 / 60,336 / f7a505a715c09d69169ccab86e22f963fa2382fa76e41e8b85810f7296a2dfa9;
          USDT-GBP 293 / 72,865 / 593b9b6887ff22bec761e2aa2aa67a34107d33e9c11170d9bb28f01fa5cc74b2.
        - `agent_quote_live_orders` (`live`): 0 / 0 / e3b0c442… (the empty string) on both books; the live path is in dry-run.
        - `agent_quote_inputs`: `fx` 1,434 / 114,277 / dd46b6d0c2c4a80fcd15a3232e8ad4550cecd22c196d3aa37bf296acd7e5175f;
          `fair:USDC-USD` 24 / 1,800 / a569a0bb15813f1e9267341c0e1471edf8c6f76b2aa43302a772df723a6739fa;
          `fair:USDT-USD` 24 / 1,893 / 5e3a93c1154ab71dbb935dee913d034f56e2d41cb918005280979e40882c86be.
      - Arm 3a's backward candles: **done 2026-09-28 06:24 UTC**, 16 minutes after the freeze
        (`backtests/inputs/pr5w_2026-09-28/candles/`, by `scripts/pr5w/pull_coin_candles.py`): BTC, ETH, SOL and XRP
        against USD and GBP, 2025-11-25 → 2026-09-23, 7,247 hours each, every hour but 2026-03-09 10:00, which the
        venue serves for none of them; 64 calls, all 200; each file's sha256 in `SHA256SUMS` there.
      - Arm 3b's first export after 2026-11-01 21:02 and before 2026-11-05 10:25 UTC.
      - The count script committed before 2026-11-25 00:05 UTC.
      - The reading, with 3b's second export, on 2026-11-25 from 00:05 UTC (2026-12-23 at the latest).
      - At PR5's 2026-10-21 verdict: ask Davies whether PR5's paper engine and its minute record keep running to the
        reading.
      - Wakes (see "Scheduled wakes"): `trig_01Q3DV4MArsf3tQ1Po8yCh1X` 11-02 00:40 UTC, 3b's first export;
        `trig_01Ecb6B2TUMRhvYiyc3a8BuE` 11-20 09:20, the count script; `trig_01JVzTyxtpoSkB7Wgw2eRkqk` 11-25 00:40,
        the reading.
   7. **EX-GAP: frozen 2026-09-28 05:36 UTC** (`reviews/2026-09-28-ex-gap-prereg.md`). At least 8 pairs by its date,
      else undecided. Counted on the 1st of each month at 09:23 UTC by `trig_018Ni6ydYybx39fE2wn7ZLeo`, which reads
      at 16 pairs or after 2027-01-31 and then disables itself.

6. **Davies' to decide or to do; nothing waits on them:**
   - **Cloudflare Pages:** the watch paths (Include `dist/*`) and the Direct Upload Action (`pages-deploy.yml`, both
     secrets) are set (2026-09-27). Left, his click: turn off Pages' own Git build's automatic deployments (Settings →
     Build → Branch control), which grokbot is doing (2026-09-30); then check the next `dist/` push: its `pages-deploy`
     run succeeds and the site serves that push's `app-<hash>.js`. No session can change these settings.
   - HARVEST's one lead (reference §3.42): a forward recorder of UMA proposals and disputes on the harvest categories,
     with the book at C + 60 s, to see what rests after a confirmation and whether a proposal is safe to follow. Public
     reads only, nothing placed, like the view recorder; build it only on his word. The econ-release race (FAST-A) is
     the racing he ruled out. Any harvest opens a position: Ireland only, under his attestation.
   - WXSRC's keyed weather feeds (reference §3.41, §6 "The weather feeds"). Read 2026-09-27 by the `weather`
     function's probe: **Météo-France** — the stored `METEO_FRANCE_API_KEY` is an access token that expired six
     minutes after issue; store instead a long-lived **API Key** from the portal's "Générer Token" page (as
     `METEO_FRANCE_API_KEY`) or the page's OAuth2 **application ID** (as `METEO_FRANCE_APPLICATION_ID`), then re-run
     `weather?action=probe&only=meteofrance` (Davies is on it, 2026-09-27; on 2026-09-30 grokbot is storing the
     long-lived key, and the probe is the check once it says so). **FAA** — the ITWS subscription works end
     to end but carries no temperature, and SCDS offers no METAR product yet: its list is STDDS, ITWS, TFMS, TBFM,
     SFDPS, NOTAM Distribution and TFDM, and the SWIFT Portal's news expects CSS-Wx in Q4 2026. When CSS-Wx appears,
     subscribe to its METAR/SPECI for the eleven US stations (KATL KAUS KBKF KDAL KHOU KLAX KLGA KMIA KORD KSEA KSFO);
     the probe reads it unchanged, then a day's measurement against `tgftp` and the takers. ITWS can lapse (60 days
     idle). Still open: KMA's API Hub (Seoul, Busan: needs a Korean phone number) and Google's WeatherNext 3 allowlist.
   - Rotate `APP_ADMIN_PWD`, `APP_RO_PWD` and `APP_AUTH_SECRET` (Supabase dashboard, Edge Function secrets), as
     cheap insurance: the site served the repository, `auth`'s source included, until 2026-09-18, and nothing
     suggests anyone read it (five failed logins in the auth table's whole history). Changing the secret re-prompts
     every device once.
   - The Kraken balance: **Davies now plans to move it to Polymarket** (2026-09-30, "Kraken 余额我准备转入polymarket"),
     not to Revolut X as decided on 2026-09-22 (reference §4.23). The Kraken key stays in use as the signal and needs
     no balance. Before money reaches the Polymarket wallet, said to him on 2026-09-30: its key was exposed to another
     tool (item 2: keep the wallet empty or small; revoking that tool's Supabase token is his); the proxy wallet
     carries unlimited pUSD allowances to four spenders (reference §2d's probe), harmless only while it is empty;
     nothing may open a position there until RW-C passes on 10-23 (RW-NEXT, which amends "RW or RW-E passes on 10-09")
     and he says go, and then only from
     `eu-west-1` under his current attestation that he is in Ireland. When he says the transfer is done, fire the
     read-only probe `?action=probe&only=polymarket` through pg_net with the Vault `cron_secret` and record the
     collateral it reads.
   - **The research round of 2026-10-01** (`reviews/2026-10-01-research-round.md` §5, reference §3.44): the live cap's
     next step and AVAX's seat (item 3); whether US equities are in scope (EQ1: no rule earns a paper row at Trading
     212; if they are, which account, a demo key, and whether the turn-of-the-month held-out test at 26 % power is worth
     freezing). Nothing was added to paper; POOLAGE waits on 10-09 (item 2).
   - Binance: switch off "Enable Spot & Margin Trading" and universal transfer; Deribit: `trade:read_write`; until a
     use is decided. Neither account is funded, and nothing trades on either.
   - The venue survey's §10 questions (`docs/agents/venue-survey.md`): US state and SSN/ITIN, HKID, stay small or
     scale, an always-on host, a long/short study.
   - Whether this ledger's `Model:` headers are backfilled. A session under an operator rule that forbids model
     identifiers in pushed files writes `not recorded (session policy)`; any other writes the real model.
   - DecisionFC's next steps are `docs/improvement-plan.md` in that repository (2026-09-28, his ask); start any of
     them only on his word.
   - A clone made before `main`'s history was rewritten (2026-09-24) must be re-cloned or reset to `origin/main`;
     `docs/commit-map-2026-09-24.md` maps the old hashes. Every clone runs `sh bin/setup.sh` once, or the ledger hook
     is off there.

6b. **Parked for later** (Davies, 2026-10-01: "其他的都先记下来，之后再考虑"; reference §3.44, the research round's §3 and
   the live pre-study). Each needs his word to start; none is running.
   - POOLAGE: how fast other makers reach a new reward pool; only if RW or RW-E passes on 10-09 (item 2).
   - A venue where this account may open event positions: Smarkets' event list answered keylessly, Betfair's API needs
     a key. A survey first.
   - Polymarket Combos maker (signed quotes within 400 ms: an always-on process and the Ireland rule), the UMA
     disputer's bounty and listing announcements (both races), Revolut X's `index_price` as a fair value (one
     observation; no frozen test may switch), a Revolut X coin-book recorder (it would share the public token bucket with
     the tick, PR5 and QUEUE's recorder; not before QUEUE's export).
   - Closed, no hope (his question of 2026-10-01): coin/USDC maker quotes on the 23 UK books (a ceiling of $0.13–0.51 a day
     a book that the 5-minute drift takes back, and re-pricing beyond the 1,000-a-day budget); token unlocks (the payer
     makes prices fall, which only a short can use, and a +2 % mean needs about 1,200 events).

7. **The app's own list is [`docs/improvement-plan.md`](improvement-plan.md)**, re-checked item by item on
   2026-09-28; items 4, 5, 10 and 14 closed on 2026-09-30, so 17 of 28 done, 1 partly, 1 not doing (the committed
   bundle, his call), 9 open. Worth doing, in order: the app icon; one shared Trading 212 ticker map; a plausibility
   band on quotes; error boundaries per surface; and item 3 measured before it is touched. Seven questions there wait
   on Davies, the first whether `APP_AUTH_SECRET` was rotated with the two passwords.
   - **10-01, after 10:00 UTC:** the recorders' first audits of each other run (09:30 and 10:00). With the Trading 212
     retry deployed both should pass (≥ 90 % of the buckets owed); read `ops_errors` for kind `recorder.watch`, and if
     either is short, count the night's buckets as the 2026-09-30 history entry did before changing anything.

8. **US equities at Trading 212 (EQ1, EQ2; reference §3.44).** Davies, 2026-10-01: the Invest account is USD (no FX on
   US instruments) and the ISA GBP; research deeply, and a trading key follows only if something can go live. Nothing
   earns a paper row on what is known; the one test worth running is **DFC**, the month-end dash for cash (Etula et al.
   2020), on CRSP's unseen 2016-01 → 2026-08: its draft is under independent review, then it is frozen by its commit and
   run once. PEAD, TOM as EQ1 defined it, reversal, overnight drift, low volatility, index additions and pre-FOMC drift
   are closed; TAC (Treasury auctions) and IS49 (industry seasonality) are drafted and not frozen. No trading key before
   a pass, a paper row and a demo-account test (guardrails in EQ2 §4).

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
  Davies' word, `trig_01THvHcphx5gngXugfwwy788` 10-08 06:20 (the live cap's clean week and its $150 step, item 3). Each wake delegates
  only to `sonnet-max` (easy work) or `opus-max` (important or difficult work), as Davies ruled for every sub-agent on
  2026-09-30, and checks their work before committing.
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

Closed operations move verbatim into `docs/handover.md` Part 2, this ledger's archive: the 2026-09-05 → 09-21
sections under "LEDGER.md history, archived 2026-09-22", the 2026-09-22 → 09-24 sections under "LEDGER.md,
archived 2026-09-26", and the 2026-09-25 → 09-28 sections, with the what-remains list as it stood on 2026-10-01,
under "LEDGER.md, archived 2026-10-01"; each oldest first.

### [2026-10-01 03:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The ledger is slimmed, under the protocol's archiving rule** (Davies: "ledger目前是不是过长了？如果是的话按照skill的要求优化下，避免不必要的过多usage limit消耗"): 1,203 lines and about 54,500 tokens to 540 lines and about 16,400. The what-remains list as it stood and the 79 history sections of 2026-09-25 → 09-28 moved word for word to `docs/handover.md` Part 2, under "LEDGER.md, archived 2026-10-01", oldest first; a script checked that the old list and every moved section arrived intact, that the handover changed only by that insertion, and that the 16 kept sections are unchanged. The list was rewritten to what is open and keeps its item numbers, which the fifteen scheduled wakes and the 10-08 cap wake quote: items 1 and 5 are one-line closures, item 2 keeps its health checks, the verdict's steps a–g and RW-C's checks word for word, items 4 and 5a keep their frozen tests' dates, owners, freeze lines and dry-run records, and item 8 (US equities) is new.

### [2026-10-01 02:35 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The live cap is $60, verified first; Polymarket's first live step is pre-studied; coin/USDC and token unlocks are closed; the rest is parked** (Davies: "按照你的建议验证后确定好了就去做，确保上线的这个策略各个方面都最佳"; "你研究下哪个策略最适合进live实验…之后和我确认"; "其他的都先记下来，之后再考虑"). An audit agent read the live row's configuration and code and re-priced the cap on two tapes (`reviews/2026-10-01-research-round.md` §7, `backtests/cap/`, re-run byte-identical from the repository): no defect, and `max_exposure_usd` is the only setting that binds. Two slots need $50.10 and the account holds $99.34 (the read-only probe, request 106565: USD total and available 99.34, nothing reserved, no coin, no open order); four need at least $100.20. `update public.agent_risk set max_exposure_usd = 60, updated_at = now() where id = 1;` ran at 02:24:51 UTC and read back, and the next minutes ran clean. Eight pins of the multi-slot paths are in `agents/tick.test.ts` (111 pass). The $150 step waits for 10-08 and the money (item 3, wake `trig_01THvHcphx5gngXugfwwy788`). Polymarket (`reviews/2026-10-01-polymarket-live-prestudy.md`, item 2): the RW-NEXT candidate, as a live calibration of what Polymarket pays, only after RW-C passes; no money moves before. Item 6's Kraken bullet now names RW-C's pass, as RW-NEXT amends it. Item 6b parks the rest and closes coin/USDC and token unlocks.

### [2026-10-01 00:55 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The research round Davies asked for: everything runs, nothing earns a new paper row, and two facts move** (Davies: "目前在测的和交易的策略以及只测量、不交易的研究都进展如何？研究下有值得优化的地方或者值得新加入paper trading或测试与测量的策略吗？"). `reviews/2026-10-01-research-round.md`, reference §3.44, `backtests/cap/`, `backtests/fp7/`, `backtests/equity/`: three `opus-max` agents (the trend family, new candidates, US equities) and this session's own reads, every read inside the frozen tests' no-peek lists, every quoted script re-run byte-identical from the committed folders. The live row's $25 cap is one slot of four, a sizing no study had priced (CAP); the brief's next steps scaled to $100 are $60 and then $150, on his word (item 3). AVAX's UK book is $31k a day on a 30-day median, not §3.8's $1.9m, which was one day's ticker: corrected in §3.8, §3.11, §4.16 and `.claude/CLAUDE.md`, and a book test is read on a 30-day median from now on. fp7 found no untried quote book and no new payer; POOLAGE waits on RW's verdict (item 2). EQ1: no US-equity rule earns a paper row at Trading 212 (item 6). RW's state read also returned `dayActive`, the day's 39 active market ids, and no figure of any market.

### [2026-09-30 23:09 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The interview showcase moves with the strategies** (Davies: "内容中也要加上showcase/decisionfc和showcase/daviesportfolios（…其中要包含上面说的不同策略的内容，面试时可以说到，如果之后有更新的话记得维护）"). The page is `showcase/daviesportfolios/README.md` in the private `daviesluo/personal`: the dashboard and every strategy with its rules, status and headline numbers, in English and with no figure from the real book, printed into his interview PDF by that repository's `interview/marex-2026-09/pdf/build.mjs`. `.claude/CLAUDE.md` (the last agents bullet) and the working-with-davies skill (all three copies) say when it changes and how; the five Routines that end in a verdict or reading (10-09, 10-21, 10-23, 10-28, 11-25) now end by updating it.

### [2026-09-30 22:20 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Every sub-agent is `opus-max` or `sonnet-max`** (Davies: "以后你开的所有sub-agents必须都是opus5.5 max（重要性高难度高的任务）或者sonnet5.5 max（难度低的任务）"). The Agent tool picks only a model, so effort comes from a definition: `.claude/agents/` now holds the two, each with its model and `effort: max`. `.claude/CLAUDE.md` and the working-with-davies skill (all three copies) say to launch nothing else; the skill's "cheap subagent" line now names `sonnet-max`. The fifteen Routines' prompts say the same.

### [2026-09-30 22:14 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Disclosure: a read past PR5V's and variant-2's limit before their reading.** At 21:40 UTC, checking that variant-2's arm `v1` still equals variant-1's arm `main`, this session summed per-day trips and P&L for PR5V's `main` and variant-2's `v1` and `d` over 2026-09-28 to 09-30. `v1` equalled `main` to the cent. But the rule for these two tests before their reading is operational fields only (2026-09-28 entry), and 09-29 and 09-30 fall inside their judged window. The frozen rules and bars are unchanged, and nothing was decided on the figures; they are not repeated here or to Davies. The 10-24 wake must write both reading scripts strictly from the pre-registrations, with no discretionary choice. Both result files must repeat this disclosure. From here the check is `checkMaxUsd` and `checkDays` alone.

### [2026-09-30 22:12 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Every dated task from here to 2027 has a scheduled wake** (Davies: "之后的那些任务…单独开的就单独开，用便宜模型就行"; then "上一个账号已经没了，目前只有这一个账号"). The previous account took its Routines and helper session with it, so the MX-1 Mondays, the 10-08 check and the 11-02 / 11-25 reminders had no owner. Fifteen Routines, listed under Machine and platform setup, now wake this session for each item's date. Each wake hands its bulk work to a subagent on the cheaper model. Two cheaper designs failed here: a Routine cannot carry the database connector, and a created session waits for a person to approve each MCP call.

### [2026-09-30 21:59 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies' three notes of the day, in item 6, and how a container without `deno.land` runs the Deno gates** (machine setup). He is having another tool (grokbot) turn off Pages' Git deployments and store Météo-France's long-lived key; each bullet names the check for when it says done. The Kraken balance now goes to Polymarket, not Revolut X. The bullet carries what was said to him first: the wallet's key was exposed to another tool; its unlimited allowances are harmless only while it is empty; nothing opens a position there before RW or RW-E passes and he says go, from Ireland only.

### [2026-09-30 21:58 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The price recorders audit each other once a day** (improvement plan item 10; Davies: "你觉得需要做的话你做下"). Nothing noticed a recorder that stopped writing. Now each one counts the other's last 24 hours: buckets owed by the calendar, less the last ten minutes, against buckets written. Below 90 %, or none of the last six, is one `recorder.watch` row in `ops_errors`. The snapshot recorder owes every bucket; the overnight recorder owes only a session it records, so a weekend or holiday is never missing. The overnight rules moved to `_shared/us_overnight_session.ts` so the snapshot recorder can use them. The snapshot recorder audits at 10:00 UTC, after the session ends in either season, and the overnight recorder at 09:30. Neither audits itself, so one that is not running is reported by the other. Run on this morning's data it reports both: overnight 71 of 96 (74 %), snapshots 246 of 288 (85 %), the losses the Trading 212 retry (the entry below) addresses. Pinned: nine cases, including Friday and Sunday nights, Thanksgiving eve and the early close, the paged read, and an unreadable table.

### [2026-09-30 21:50 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The two price recorders stop refusing each other at Trading 212** (found while building improvement plan item 10). T212 allows one positions call a second per account, and since `0063` both recorders are queued by one cron statement, so every five minutes they asked for the same two accounts in the same second. Measured in production for 00:00-08:00 UTC, the US overnight session: `overnight_intraday_points` held 65 and 71 of 96 buckets on 09-29 and 09-30, and `price_snapshots` 30 and 54. They shared only 15 and 29, and on 09-30 every bucket had one or the other. Daytime buckets were complete, since the snapshot recorder falls back to Yahoo there and not overnight. `_shared/t212_positions.ts` is now the one read both use, and a call refused with 429 is tried once more 1.1 s later; no other failure is retried. Pinned: four cases, two of which fail without the retry. To check after the deploy: the same two counts for the night of 10-01, which should both be near 96.

### [2026-09-30 21:41 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The recorded prices know the market's early closes** (improvement plan item 14, before 2026-11-27; Davies: "你觉得需要做的话你做下"). On the Friday after Thanksgiving, and July 3 / December 24 when they fall Monday to Thursday, the regular session ends at 13:00 ET and the late session trades to 17:00. The snapshot recorder took 13:00-16:00 as regular, so a Yahoo-priced holding was recorded at the frozen 13:00 close, and a tick whose Trading 212 fetch failed dropped every US holding to it. Moving only the recorder would have been worse: the price function's extended-hours scan also ran to 16:00, and at 14:00 returned the morning's pre-market print. `_shared/us_market_calendar.ts` now gives each day's close, and both read it. The days match NYSE's published calendars for 2025-2028: 2026-11-27 and 12-24, then 2027-11-26. Pinned: a whole-year sweep for 2025-2030, and recorder and scan cases that fail on the old code (3 failures, 42 passing). The board keeps 16:00 on those days by decision: its after-hours verdict, market-card anchor and chart windows all read 16:00-ET bars.

### [2026-09-30 21:15 UTC] Platform: Claude Code | Model: not recorded (session policy)

**A failed save is said and tried again; a failed cross-tab load no longer swaps in the demo book** (improvement plan items 4 and 5, Davies: "你觉得需要做的话你做下"). The save effect marked a change saved before its request resolved and dropped a failed one without a word, so the board looked saved while the server never had the change. `portfolio/portfolio_saver.js` now sends one request at a time and moves the marker only when the server takes a change. A refusal shows NOT SAVED and is retried after 5 s, 15 s, 45 s, 2 min and 5 min, then by hand. A newer edit takes over from a waiting retry, a conflict is never retried, and an edit undone mid-flight is sent after. The cross-tab reload now refuses a demo result and drops this tab's older queued save. Pinned: eight unit cases, and four sweep checks a viewport (a draft replayed on mount, two 503s then 200; a broadcast reload that fails), which fail on the old bundle (4 failures, 223 passing) and pass on the new one (455).

### [2026-09-30 20:46 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Variant-2 now differs from variant-1 by rule D alone** (its deviation 2, reference §4 item 47). Davies, asked whether a third arm should isolate rule D from the rate: "规则 D 是不是本来就该应用在 variant-2 上？是的话就直接修改成需要的样子，不用加新的 variant 了吧". So arm d reads PR5's stored X, as arm v1 and PR5V do, and condition 3 tests rule D, as the study priced it. Production said TrueFX had nothing to add on paper: held before its turn it sat a median 0.41 bps from Yahoo's bar (1.15 at p95), and Yahoo is not throttled from Supabase. Code version 3 reads no feed and re-decides from 2026-09-28 00:00. Pinned: two calls as production runs them, no feed read, both arms placing on the same fair; the pin fails on code version 2. The TrueFX code stays in `954bd25` for a live executor that posts as it reads.

### [2026-09-30 20:41 UTC] Platform: Claude Code | Model: not recorded (session policy)

**QUEUE's and PR5-W's dry runs are done, before their deadlines** (items 5a.4 and 5a.6 carry every count, byte length
and hash). Davies turned the database connector on in this session. All seventeen statements ran as their files write
them, without the `page` column; none needed a change. Read beside them, and nothing else: variant-1 and variant-2 both
re-decided on the new code and caught up with PR5 (last minute 20:26, no error; variant-2's `checkMaxUsd` $0.00 over
three days); the 176 minutes since the fix that read TrueFX all read it before their turn (median 58.6 s), and differ
from Yahoo's stored rate by 0.41 bps at the median (1.15 at p95, 3.0 at most); and Yahoo is not throttled from
Supabase: over the last seven days 5,444 of 5,472 lit minutes used the bar one minute back.

### [2026-09-30 16:55 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Variant-2 priced each turn with TrueFX from about two minutes after it; priced, fixed, re-decided** (its deviation 1, reference §4 item 47). The call fires at :00 and PR5 decides m − 1 only at :25, so the call decided m − 2 with the snapshot it had just read, while its turn reads data to t − 1. Priced before the fix on the study's days (`scripts/pr5v/lookahead.py` → `backtests/pr5v/lookahead.json`; §1's rule D and variant-1 runs reproduced first, 593 trips $30.3004 and 563 trips $29.5129): rule D $1.0793 a day on the rate two minutes after the turn against $1.0255 a minute before it, +$0.054 a day (+$0.037 on the fresh five). Code version 2 holds the snapshot read in the minute before each turn for that turn alone. `0073` adds `x_d_t` / `x_d_read` and refuses a TrueFX row read at or after its minute: applied here to PostgreSQL 16 over a version-1 row, it refused the three look-ahead rows and took the fix's row and a Yahoo row, and the constraint validated after the reset. Counterfactual: given 1.4 read at 23:59:01 and 1.5 read at 00:02:01, the old engine priced the 00:00 turn with 1.5 and the new one with 1.4, and the double as strict as `0073` refuses the old engine's write. 37 engine tests pass here and every gate is green (`sh bin/gates.sh --full`, its Deno steps through the local import map); the sweep (447/447) now photographs the two variant rows when `SWEEP_SHOTS` is set.

### [2026-09-30 16:55 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Two tick tests expired on 2026-09-30, and would have turned the next push red and held back its Edge deploy.** `golive.test.ts`'s D3 and `lifecycle.test.ts`'s lost-reply test failed on the untouched `185b9fa` today: the Revolut X client's `findOrder` measured the history's week from the machine's clock, and the fixtures' orders (2026-09-23 04:05) left that window seven days on. `revxVenue` now takes the clock the window is measured from; production passes none and keeps the machine's, so the live path is unchanged. Every test that drives it through a fake venue passes that venue's clock (golive ×5, lifecycle, and quotes_live, whose 09-24 fixtures would have expired on 10-01). Pinned in `revx.test.ts`, which fails on the old client. The whole Edge suite run with the clock moved 7 and 30 days on passes (687), so nothing else there expires within a month. Seen once, in the first full gate run of the day, and not in three runs since: the sweep's `phone/perf-refresh/tick` gives the app's refresh 8 s and missed it while every gate ran at once; watch it before calling it a flake.

### [2026-09-30 16:33 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Resumed from `185b9fa` (main = origin/main) on Davies' handover; PR5V re-decides once, as its §3 asks.** Cursor's two commits of 2026-09-28 (`5f02817` the freeze, `185b9fa` variant-2's instance) are live: `0072` applied 19:42:38 UTC, `agents` deployed 19:43:06, every workflow green since. `185b9fa` also changed `quotes_variant.ts` (the `entryBand` hook) after PR5V had decided minutes and kept `VARIANT_CODE_VERSION` at 1; PR5V's pre-registration re-decides on any code change, so it is bumped to 2 (PR5V's deviation 1, reference §4 item 45; item 4 above has the check). This container's network policy blocks deno.land, Dukascopy and TrueFX: the Deno checks here map `deno.land/std@0.224.0/assert` to JSR's `@std/assert@0.224.0` through a local import map, not committed, and CI runs them as written.

