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
   - **The one-minute job's lost `:X0` minutes: fixed by `0097` and the cause confirmed (2026-10-08 01:36).** `0093`'s
     TRUNCATE of `net._http_response` at :00, :10, … put the one-minute batch a minute late at 18 of 24 `:X0` minutes
     from 10-07 20:50 (`edge_call_beats`). After `0097` (DELETE at :05, :15, …): 01:00 and 01:10 had 1 beat each and
     27 the minute after (before the fix), 01:20 and 01:30 had all 27 at :00 (after). The prune ran 01:15 / 01:25 /
     01:35, deleting 0 / 136 / 194 rows. RW lost 00:00, 00:10, 00:30, 00:40, 00:50, 01:00 and 01:10 of 10-08, its
     last judged day: at RW's verdict name the shortfall as a deviation of that day (RW-NEXT Part 2, "The one-minute
     job"), with minutes stored against due; RW's bar is unchanged.
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
     d3. RW-X4 and RW-X5's Test 1 by `reviews/2026-10-02-polymarket-rw-rest-prereg.md` (10-03 → 10-08 from their 10-02
        rows, the seventh condition against x1), after the same two checks and its own (their 10-01 rows equal x1's, by
        its Addendum 1: their rules run from 2026-10-02 20:00 UTC, so their 10-02 rows are their own).
     e. A migration takes `pmrw`, `pmrw-select`, `pmrw-e` and `pmrw-x` out of the one-minute job — since `0075` that is
        `update public.edge_calls set enabled = false where path in (…)` on those four paths (RW-C's four `pmrwc*` rows
        and every other row unchanged; the tables stay); the page rows stay as a record until Davies says otherwise.
     f. Report to Davies in Chinese. Only an account that quotes can show what Polymarket actually pays.
     g. **Read together by RW-NEXT's Part 1** (frozen 2026-09-28, `reviews/2026-09-28-rw-next-prereg.md`), which amends
        what follows each of the three verdicts above: it fixes the candidate among the five arms, and the candidate
        goes to RW-C before any live test or design.

   - **RW-X1 (no weather), X2 (pause on jumps: 15 ¢, 60 minutes) and X3 (both)**: frozen 2026-09-27 18:25 UTC
     (`reviews/2026-09-27-polymarket-rw-variants-prereg.md`), judged on 09-28 → 10-08; `agents?action=pmrw-x` (`0064`)
     replays RW's stored minutes into `pm_rw_x_state` / `pm_rw_x_days`. X2 and X3 are off the page (`RWX_OFF_PAGE`; X2
     since 2026-10-02, Davies: the pause did worst) and still replayed. **Daily health:** `pm_rw_x_state.last_error`
     empty, `last_minute` within ~3 min of RW's, `checkMaxUsd` and `checkEMaxUsd` (over `checkEDays`) under $0.01, its arms
     `rw`, `e`, `x1`–`x5`, each arm's `diverged` read. Every row's page shows its own record only. No market-level figure
     of 09-28 or later is read before 10-09.
   - **RW-X4 ("wide", page "Reward quotes variant-3") and RW-X5 ("lean", "variant-4"), x1 plus where the quotes rest,
     from 2026-10-02 20:00 UTC** (moved from 10-03 00:00 by its Addendum 1 on Davies' word, "现在就开始测试 不要等"; the 20:00 →
     24:00 run-in is shown on the page and not judged): frozen 2026-10-02 (`reviews/2026-10-02-polymarket-rw-rest-prereg.md`, `0085`). x4 rests
     both quotes the most whole ticks out that keep 0.9 of the minute's reward at RW's quotes; x5 moves the quote that adds
     to the position a tick out per whole N held. In the same replay, joined as copies of x1; if they are not among
     `pm_rw_x_state`'s arms when it replays 10-02 20:00 (Addendum 1), Test 1 is void. **Test 1** on or after 10-09 00:05 UTC from
     `pm_rw_x_days`: each arm's change over 10-03 → 10-08 from its 10-02 row, RW-X's seven conditions over six days (seed
     20261009, × 365 / 6, per market the 10-08 `perMarket` less the 10-02), the seventh against x1; first RW-X's two checks
     and that x4's and x5's 10-01 rows equal x1's (Addendum 1). **Test 2** on RW-C's minutes (`pmrwc-x`, every rule from 10-09 00:00),
     after RW-NEXT's RW-C verdict (≥ 10-23 00:05, seed 20261023, against x1 there). Not among RW-NEXT's five; an arm that
     passes both goes to Davies. **Selling a fill at once was priced on 2026-10-04 and loses** (`backtests/rwexit/`,
     reference item 36): its lever is the 3N cap, which is x5's question. Next on it: once a path is live, read the
     first 20–50 live fills' next books before any exit rule; a trim near the cap only if x5 fails and the measured R is
     near 1, as a new replay after 10-23 on books stored with their sizes.

   - **TB1 ("tight book", page "Reward quotes variant-3" = `tb1-skip`, "variant-4" = `tb1-back`; x4 and x5 off the page
     and still replayed): frozen 2026-10-07 (`reviews/2026-10-07-polymarket-rw-tb1-prereg.md`, with the code and `0096`;
     designed after a NON-blind read of RW's record).** x1 plus, in a minute whose stored raw touch is at most a tick
     wide: skip rests nothing, back rests each quote a tick behind RW's (inside the band). Each starts FLAT at its own
     first minute (`fresh`): on RW's minutes 10-08 00:00 UTC or the first minute decided after the deploy (`start` in
     `pm_rw_x_state`), shown on the page until RW's end 10-09 00:00, not judged; on RW-C's from 10-09 00:00. **Verdict**
     after RW-C's (≥ 10-23 00:05 UTC), from `pm_rwc_x_days`: RW-X's seven conditions over 10-09 → 10-22 (seed 20261023),
     plus 7′ paired day bootstrap of (arm − x1) at R = 0.40 > 0 and 8 the R = 0.40 difference without the best
     market-day > 0 (`detail.rewardByMarket`, every arm's row since this commit); void if either arm carries a `start`
     in `pm_rwc_x_state` or a day row is missing. **Health:** both arms in `pm_rwc_x_state.state.arms` with `base` {} and
     no `start` after 10-09 00:05; x4/x5 still written in both replays. **From 10-09 00:00 UTC the page's
     variant-2/-3/-4 rows read RW-C's replay** (`pm_rwc_x_*`; `RWX_PAGE_SWITCH`, 2026-10-08 on Davies' word of 10-07):
     they start again from zero there, one replay at a time; before RW-C's replay has a state (quiet until 00:02) they
     say they start at 10-09 00:00. **To confirm after 00:05:** the dashboard's `rwx` entries carry `source` "RW-C",
     `startedAt` 2026-10-09T00:00:00.000Z and `notStarted` false. **"Reward quotes" and variant-1 (RW-E) move at the same
     instant** (2026-10-08, Davies chose "合并进 Reward quotes"; variant-1's move is the main session's call, told him):
     `rw` reads RW-C's engine run and `rwe` RW-E's `pm_rwc_e_*` replay (`readRwPage`, `RW_PAGE_SWITCH`); **to confirm
     after 00:05** that the dashboard's `rw.source` and `rwe.source` are "RW-C", `rw.startedAt` 2026-10-09T00:00:00.000Z
     with `notStarted` false, `rwe.notStarted` false once `pm_rwc_e_state` exists, and that it sends no `rwc`.
   - **Intraday re-selection every 2 h (S2; a dropped market goes close-only): backtested 2026-10-07 on the pm-rec
     archive, 10-05 00:00 → 10-07 21:59 UTC, read-only, no paper arm** (scratch scripts, not committed): against S2's
     daily selection, −$62.36 at R = 1 (day-block bootstrap p5 −120.60 / p95 −4.12, P(> 0) 0.03) and −$14.92 at R = 0.40
     (p5 −63.73 / p95 +33.89, P 0.37); only three day blocks (6-hour blocks: P 0.15 and 0.35). It churns (202 markets
     chosen in 35 selections against 29) and the held inventory of dropped markets fills the $320 cap (carried mean
     $244.7 against $75.8). With S2's modelled passive exit instead it reads +$215.72 / +$48.65, so the answer hinges on
     the exit, which is not measured. Not supported as specified; a longer archive would be needed to say more.
   - **RW-C, RW's rule forward on 2026-10-09 → 10-23 UTC (RW-NEXT part 2; Davies approved the build 2026-09-27): ON
     `main` since 2026-09-28 04:39 UTC** (`3682b557` engine + `0069`, `17728e3c` page; history 00:38 and 05:12).
     `pmrw.ts` as a second instance (`RWC_INSTANCE`) into `pm_rwc_*` (RW's eleven tables, renamed), leases `pmrwc*`,
     warm-up 10-08 00:00 by constant; RW-E and x1–x3 replayed on its minutes with every "from" at 10-09 00:00
     (`pmrwc-e`, `pmrwc-x`), and x4 and x5 since `0085` (an addendum to RW-NEXT Part 2, in their pre-registration). `0069_pm_rwc.sql` adds the tables and four rows of `edge-calls-every-minute`. **It has no page row of its own**
     (Davies, 2026-10-08: it is RW's rule's round 2, "合并进 Reward quotes"; the "Reward quotes confirmation" row it had
     from 10-08 00:00 is gone): from 10-09 00:00 UTC "Reward quotes" and its variants read its run, starting from zero,
     "starts 9 Oct 01:00 BST" until its first minute is decided. RW-NEXT
     is frozen (item 5a.3). The four calls return "before its warm-up" / "before RW-C's first minute is decided" (no
     database read) until 10-08 00:00 / 10-09 00:02. **Checked 10-08 00:33–00:43 UTC: WARM** (RW-NEXT's slip check
     true, item 5a.3; `pm_rwc_state.last_minute` 00:41:00 at 00:43:16, no `last_error`). **Next:** after 10-09 00:05, `pm_rwc_days` holds 10-08 with `detail->>'phase'` `warm-up`; after 10-10 00:05,
     both replays' `checkMaxUsd` (and the x replay's `checkEMaxUsd` over `checkEDays`) under $0.01, read as scalars.
     Nothing else of `pm_rwc_*` before its verdict (RW-NEXT's no-peek list). **Its verdict** on or after 2026-10-23
     00:05 UTC by the frozen RW-NEXT (the primary its part 1 names, from `pm_rwc_days` or the replays' day rows after
     the check), then a migration takes the four `pmrwc*` rows out of the one-minute job (`update public.edge_calls set enabled = false where path in (…)`, since `0075`).
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
     builds the rule-independent order path inert during RW-C (~5–7 days sooner). **He chose 1 on 2026-10-01** ("这个你现在
     就建好吧"): a recorded deviation of RW-NEXT's ordering ("before any live test or design") and of this item's "design,
     not build", on his word. **Built and running inert since 2026-10-01** (`reviews/2026-10-01-polymarket-order-path.md`,
     `0074`, `_shared/polymarket_orders.ts`, `agents/pm_live.ts`): V2 orders pinned byte for byte to eight the official
     client built (`backtests/pmlive/vectors/`, regenerated identical by the coordinator), a wire that sends nothing but
     a GET while `PM_ORDER_SENDS_ENABLED` is false and no POST outside eu-west-1, no private key loaded, a pending row
     before every POST, reconciliation by order hash, the gates (pause, `live_confirmed_at`, region, the geoblock's
     COUNTRY — from eu-west-1 it says `blocked: true`, country IE, §6 —, closed-only, the attestation, inventory, loss
     stops), caps $300 / $60 a market in code and in CHECKs. `agents?action=pmlive&forceFunctionRegion=eu-west-1` is one
     new row of `edge-calls-every-minute`, every other row unchanged (pinned in `src/cron_jobs.test.js`). It dry-runs
     every minute on two markets a UTC day with a reward rate under $10 (the database refuses $10 and over), with a
     placeholder rule (join the touch at the minimum size). A first live order still needs RW-C's pass, his word on the
     live design, a reviewed commit that turns sends on and loads the key, and the pre-study's other preconditions.
     **Check the first day** (read-only, its own tables only): `select state->>'sbRegion', state->>'mode',
     state->>'openBlockedBy', updated_at, last_error from public.pm_live_state;` — `sbRegion` eu-west-1 and no error;
     `select day, kind, cond, reward_rate, rank, detail->'note' from public.pm_live_markets order by day desc;` — two
     markets, the selection's `ms` under 40 s; `select ts, mode, side, price, size, state, gate from public.pm_live_orders
     order by id desc limit 20;` — dry-run rows only. A selection that never completes inside 40 s leaves the dry-run
     idle: then read the listing faster or less of it. **First minutes verified** (05:31–05:32 UTC): `sbRegion`
     eu-west-1 (so `forceFunctionRegion` works through pg_net), every gate true, the geoblock `blocked: true`, IE;
     the selection took 30.6 s (39 reward pages, 18,780 rewarded rows) and picked two unrewarded markets; four dry-run
     rows, none since (nothing changed); no `last_error`, no `ops_errors`; the job's other calls all 200 (05:30's one
     404 was this call reaching the function before its deploy finished at 05:30:41). **Fixed the same morning:** the
     standard pick (a China Open match, its game started 03:05) closed at 06:27 and every turn reported its 404 book —
     211 `ops_errors` by 09:26. The selection now passes over a market whose game starts or which ends within two days,
     and a 404 book drops a selected market for the day (recorded once, its kind chosen again without it); verified
     09:35–09:38. The second selection took 36.6 s of its 40: if one runs out, read the listing faster or less of it.

   - **Davies, 2026-10-01 afternoon: prepare a live test now** ("确保Polymarket可以上线测试（我准备把kraken的钱转到polymarket里去，密钥没有泄露，这些钱对我来说没多少，可以用来测试真实reward情况）…准备上线"). The session's choice: a
     calibration of R, RW's quoting as RW-E applies it, only on rewarded markets under $10 a day (outside RW's and
     RW-C's universe, so neither frozen test is touched and no post-09-28 RW figure is read); built in DRY-RUN with
     sends ready in code, going live one statement on his word after his funding; he says the key was not leaked.
     **He agreed (~15:25 UTC): "同意你polymarket的方案".** Funding: about **$400** (~17:00 UTC: "polymarket的策略我决定还是听你的转400美元进去追求最优效果",
     replacing the $300 he named first), USDC on Polygon from Kraken to his polymarket.com Deposit address, $5 first.
     **Landed in DRY-RUN (`0076`, pushed 2026-10-01 ~17:55 UTC; `reviews/2026-10-01-polymarket-live-calibration.md`):**
     `PM_ORDER_SENDS_ENABLED` true and the key loaded only for the stored signer; the config row keeps it home
     (`dry_run` true, `live_confirmed_at` null). Phase 1: 2 markets, $40; caps $320 in all (deposit − $75 − $5, the code
     ceiling) and $60 a market; stops −$25 a day, −$75 in all; GTD 600 s. The path reads its pUSD every minute
     (`pm_live_state.state.pusd`) and whether its key is loaded for the stored signer (`state.keyed` true, `signerProblem` null). **Next:** watch a day of dry-run (`pm_live_state.last_error`, `pm_live_events`, the
     day's two markets, no ops_errors); his $5 deposit, its balance read in `pm_live_state`; then ~$395; then the design
     doc's ONE go-time statement, in the conversation where he says go (it sets `cap_total_usd = least(320,
     floor(pusd − 75 − 5))` from the path's own read, refused when unread, older than 5 minutes or under $81, and arms);
     phase 2 (`max_markets = 8, select_budget_usd = 160`, ~100 market-days in 14) is set ALREADY, in the dry-run, since
     `0080` (2026-10-02, Davies: "现在就切 全功率320刀，并且什么时候上线我说了算不自动转了"): it goes live at that size, and
     only in the conversation where he says go.
     The first live day reads how soon a cancel shows on the venue (the doc's "Not verified" query).
   - **Reward quotes mini-pool (live-prep, then small-pool, until 2026-10-02): paper first; the check is reported to Davies and he alone decides the go-live** (Davies, ~18:15 UTC: "要不要先上线Reward
     quotes live-prep测试一下？有问题也及时修复，然后我们操作账户和转账问题，纸面测试24小时之后再验证一遍没问题自动上线？"). `0077`,
     `agents/pm_prep.ts`, `agents?action=pmprep` every minute (a row of `edge_calls`, retry true): the path's OWN dry-run
     orders filled on paper by RW's `stepRw` on the row the path decided on, two minutes behind; the path's P&L, stops and
     settlement; formula rewards and R = 0.40. Pre-registered (`reviews/2026-10-01-polymarket-live-prep-prereg.md`, frozen
     before its window): **2026-10-02 00:00 → 10-03 00:00 UTC**, conditions (a)–(g) read by
     `docs/agents/backtests/pmlive/prep_check.sql` (sha256 pinned by `src/pm_prep_prereg.test.js`). **Addendum 1**
     (Davies, ~19:52 UTC: "改为现在就开始测试，可以测试今天剩余时间+明天一整天"): the window opens on the first full UTC hour after
     2026-10-01's own selection and closes 10-03 00:00, read by `prep_check_addendum1.sql` (pinned the same way; the
     same conditions, per day where they read a day). Today's selection needs 0074's two placeholder rows out of
     `pm_live_markets`, by the addendum's one statement (`delete from public.pm_live_markets where day = date
     '2026-10-01' and reward_rate is null and max_spread is null;`): Davies ran it in the SQL editor at ~20:22 UTC (the
     connector's execute_sql timed out three times waiting for a confirmation that never reached him). The path chose
     today's two markets at **20:23:00 UTC** in one run, inside the rules (rate $8 each, max spread 8.5 and 5.5, N 20,
     formula $8 a day each, $35 of $40), with dry-run orders from 20:23, the layer two minutes behind and no fault. **The
     window is 2026-10-01 21:00 → 10-03 00:00 UTC** (1,620 minutes: a1 ≥ 1,604, a2 ≤ 16). 10-02's selection landed at
     00:00:01 UTC (two markets); at 00:14 both states were moving with no error and `ops_errors` empty since 23:50.
     Until the check, read only what the prereg allows (the two `last_error`s and the states' clocks, `ops_errors`,
     whether a day's selection landed). **Addendum 2** (2026-10-02 ~02:20 UTC; Davies chose option B: "现在就切
     全功率320刀，并且什么时候上线我说了算不自动转了"): `0080` set eight markets and $160 on the dry-run row and took 10-02's
     rows out so the path chose that day again at the full size; Addendum 1's window ends as FAIL by the rule; **the
     window is 2026-10-03 00:00 → 10-04 00:00 UTC**, read by `prep_check_addendum2.sql` (sha256 pinned; the frozen check
     with its dates moved a day). **Next:** at or after **2026-10-04 00:10 UTC** run it once, read-only, and report every
     row to Davies in Chinese. **Never run the go-time statement on a check**: his standing word for an automatic
     go-live is withdrawn; the path goes live only in the conversation where he says go (design step 8, word for word).
     A fix inside the window ends it as FAIL and moves the check a day, by a next addendum. (f) needs his funding
     (pUSD ≥ $81 read within 5 minutes; 0.036673 at 01:25 UTC). **Read before its check, on Davies' word**
     (2026-10-03 23:36 UTC, "授权你现在读", to compare the pools): the window's running figures (`pm_prep_state.state`'s
     `day` and `pnl`) and the closed days; the check runs as frozen and its report names the read (history, 23:39).
     **Checked at 00:17 UTC on 10-04** (`prep_check_addendum2.sql`, its hash verified): a1–c3, e and g PASS; **(d) FAIL**,
     8,193 of 11,520 market-minutes scored (71.1 %, bar 75 %), the pools' thin books and not the code; **(f) FAIL**,
     the account unfunded (pUSD 0.036673). No go-live on a FAIL; whether mini-pool's selection is tightened (a rule
     change: a new addendum and window) is Davies' call (history, 2026-10-04 00:22). **Fixed and given a new window by
     Addendum 6** (2026-10-04, Davies: "把mini-pool现在就全部修复优化了，dry-run的问题如果影响mid-pool的话也都修复掉"): the
     dry-run scored its quotes against the rest of the book's midpoint, not the book Polymarket would hold with them in it
     (508 of 10-03's minutes); it now scores them as the venue would, and its selection ranks first the books with two
     levels of the minimum within 10 ¢ a side (`PM_MINI_QUALITY`). **The window is 2026-10-05 00:00 → 10-06 00:00 UTC**,
     read by `prep_check_addendum6.sql` (sha256 pinned). **Every check window closed by Addendum 7** (2026-10-04 ~17:00,
     Davies: "验证没问题就直接落地TESTING STRATEGIES列表，把mini-pool 的检验窗口全关了，目前上线live的最大candidate是这个live-prep策略"):
     Addendum 6's window is withdrawn before its first minute and its check is never run; mini-pool is not a go-live
     candidate. It keeps dry-running as a comparison and arms nothing (history, 2026-10-04 17:00).
   - **Reward quotes live-prep (S2): the lead live candidate, a third instance of the order path, in dry-run and unarmed**
     (Davies, 2026-10-04: "验证没问题就直接落地TESTING STRATEGIES列表…目前上线live的最大candidate是这个live-prep策略").
     `0091_pm_lp.sql`, `agents/pm_lp.ts`, `agents?action=pmlp&forceFunctionRegion=eu-west-1` and `agents?action=pmlpprep`
     every minute (rows of `edge_calls`, retry true); the last row of TESTING. Rules: pools of $10 and over with no ceiling,
     10 markets / $200 a day, RW's prices with what is held sold first, 5N, x2's pause, carried markets close-only, no
     weather or same-day markets, $320 total / $100 a market, a −$75 stop on fills plus what was paid, no day stop.
     Pre-registered: `reviews/2026-10-04-polymarket-lp-prereg.md`; d1 is the first full UTC day after
     `pm_lp_config.created_at`. **Before Davies' go, in order:** P1 **checked 2026-10-07 20:22 UTC** (`lp_check.sql`
     run once as written, sha256 `7e94b042…0a57` verified on the file and on the text sent; late, as "at or after"
     allows, because the 10-06 00:20 Routine's wake reached this session only at 10-07 20:17; not blind): d1 10-05, a1
     1,440 of 1,440, a2 2, a3 one day row, b1 10 markets in one run at 00:05:04, b2 none outside the rules, b3 $188.70,
     c1 0 of 4,525 crossing, c2–c6 all 0 ($98.72 a market and $320.00 in all at worst; 459 sells in carried markets),
     (d) 7,101 of 11,068 = 64.2 %, (e) +$21.69 at R = 0.40 and no stop, (g) 0 of 14,990: all PASS; (f) FAIL on funding
     alone (pUSD $0.04; eu-west-1, the four gates true, keyed, no other config armed), so by the pre-registration the
     verdict on (a)–(e) and (g) stands and (f) is read again at the go; P2 pUSD ≥ $81 in
     the account; P3 the payouts-per-path patch (`docs/agents/pending/2026-10-04-mid-pool-payouts-per-path.patch`, rebuilt
     on this code) applied with an addendum, Davies' call ("之后再部署吧"), since without it the paths book each other's
     payouts; P4 mini-pool and mid-pool unarmed; P5 the probe reading the conditional-token allowances (not built); and a
     `monitor/health.ts` freshness reading for `pm_lp_state` (not built). Then step 8lp, only in the conversation where
     he says go. Not measured: the selection's CPU on Supabase over about 1,379 markets.
   - **Reward quotes mid-pool: the path and its paper layer again, on $10–$50 pools; since `0084` the same real order path as mini-pool, in dry-run**
     (Davies, 2026-10-02: "…再做一个Reward quotes mid-pool只做10-50，同时也不打扰其他的Reward quotes，也是400美元funded测试").
     `0081`, `agents/pm_mid.ts` (an instance of `pm_live.ts` and `pm_prep.ts`), `agents?action=pmmid&forceFunctionRegion=eu-west-1`
     and `agents?action=pmmidprep` every minute (rows of `edge_calls`, retry true); mini-pool's $400 sizes. **Since `0084`**
     (2026-10-02, Davies: "把mid-pool 的结构和路径也做成和mini-pool一样的真实下单路径，按上线规模跑 dry-run，之后更好对比，现在就做不要等")
     its action is mini-pool's: the key loaded for the stored signer, the pUSD read every minute, the same keyed wire; its
     config row is the lock (`dry_run` true, `live_confirmed_at` null), and a trigger on both configs refuses arming either
     while the other is armed (one account). Its go-time statement is the design doc's step 8m, run only in the
     conversation where Davies says go; a funded mid-pool needs first its own pre-registration (drafted 2026-10-04), its
     margin measured again (done 2026-10-04) and the readout told apart per path (a `pm_live.ts` change, built
     2026-10-04, deployed only on Davies' word). Its selection leaves out what RW's frozen selection, recomputed from public data with
     RW's code, takes or scores at ≥ 0.33 of its last pick (margin 0.67, measured), keeping only a count. Pre-registered:
     `reviews/2026-10-02-polymarket-mid-pool-prereg.md`, frozen by the commit that adds it; d1 is the first full UTC day
     after `pm_mid_config.created_at`, and the window fourteen days. **Running since 2026-10-02 05:01 UTC** (its first
     eight markets chosen at 05:01:01); mini-pool's Addendum 3 names the instance build's hashes, and a deploy of
     `pm_live.ts` or `pm_prep.ts` inside mini-pool's window (10-03 00:00 → 10-04 00:00 UTC) ends that window as FAIL.
     **Next:** at or after d2 00:10 UTC run `mid_check.sql` once,
     read-only, and report every row to Davies; at or after d15 00:10 `mid_readout.sql`; no earlier than 2026-10-23
     00:05 `mid_audit.sql` (all three in `backtests/pmlive/`, sha256 pinned by `src/pm_mid_prereg.test.js`). Until each,
     read only the prereg's health readings (the two `last_error`s and clocks, `ops_errors` of `agents.pm_mid` and
     `agents.pm_midprep` and their crash rows, whether a day's selection landed, and since its Addendum 1
     `pm_mid_state.state`'s `keyed`, `signerProblem`, `pusd`, `at` and `sbRegion`), never mid-pool's page or the
     dashboard's summary. **Deviation 1 (2026-10-03 23:36 UTC, on Davies' word "授权你现在读"):** its 10-02 day row,
     d1's running figures (`state.day`, `state.pnl`), both days' selections (count, rates, capital) and the share of its
     reward each market holds were read before the day-1 check, to compare it with mini-pool (history, 23:39); the check
     and the readout run as frozen, and both name it. **Day-1 check at 00:18 UTC on 10-04** (`mid_check.sql`, its hash
     verified): every row PASS, (f) N/A; (d) 9,352 of 11,520 market-minutes scored (81.2 %); (e) +$15.01 at R = 0.40.
     The readout runs at or after 2026-10-17 00:10 UTC and names deviation 1 and **deviation 2** (2026-10-04, its
     Addendum 2: the formula fix deployed with mini-pool's Addendum 6 scores what rests in the book as the venue holds it;
     no decision changes, pinned beside byte copies of the frozen code; history, 2026-10-04 16:44). **Readied for live** on Davies' word
     (2026-10-04, "准备mid-pool的上线，确保和现在的策略一致"; history, 2026-10-04 01:01): the funded pre-registration is a
     draft (`reviews/2026-10-04-polymarket-mid-pool-live-prereg.md`) that freezes on his go date, the earliest after the
     overlap audit (≥ 2026-10-23 00:05 UTC); step 8m arms only the current config (PGlite, `scripts/mid_live_check.mjs`);
     the margin measured again: 0.67 overlapped in 4 of 111 pairs, 0.8 in none (the draft keeps 0.67). **Kept for
     later on Davies' word** (2026-10-04, "之后再部署吧 我想等v-3 v-4的结果更明显了看看能不能inform现在的mid策略之后再决定上线，具体时间我来定，代码你先都存好"):
     the payouts-per-path change to `pm_live.ts` (each path books only its own live markets' payouts; no dry-run decision
     changes) is `docs/agents/pending/2026-10-04-mid-pool-payouts-per-path.patch`, its README saying how to land it;
     deployed before 10-17 it is a deviation of mid-pool's readout, from 10-17 none. **His go-live decision waits for the
     RW-X arms** (x4 "wide", x5 "lean": Test 1 at or after 10-09 00:05, Test 2 after RW-C's verdict): report then whether
     either should change mid-pool's quoting rule; a changed rule runs in the dry-run before any go date, which is his. **Before a go date:** he funds
     the account to at least $400.00 of pUSD ($320 cap); the probe from Ireland (design step 2); the two unused pUSD
     spenders revoked or kept (step 3, his call); a live row and page for the funded path and a freshness reading in the
     monitor (`monitor/health.ts`), built before go (PR5 live had both); the readout (≥ 10-17 00:10) and the audit
     (≥ 10-23 00:05) reported. A revocation of the Ireland attestation is recorded in both config rows. On the Agents page it
     is the last row of TESTING STRATEGIES, right after mini-pool's, with Reward quotes' page (`prepMid`).
   - **Any live step needs RW-NEXT Part 4** (and the pre-study above): Davies' word after RW-C passes; `eu-west-1`
     only; positions opened only while his Ireland attestation is current, otherwise reduce or close only (**standing
     since 2026-10-01**, his words: "我之后长期在爱尔兰，如果变动需要更改会和你说，不和你说关就一直没事 也不用问我" — current until
     he says it changed, and nobody asks him; this replaces Part 4's "an expiring timestamp", the frozen file unedited); never a VPN,
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
   book (`scripts/cap/book_30d.py`, baseline $31,007) is no worse, and the probe reads USD ≥ $100.20: **Davies topped
   it up — the probe read USD 120.00 total and available, nothing reserved, no coin (request 117164, 2026-10-01
   15:04:56 UTC)**, so the money condition is met (the tick does not check USD before a buy; a refused buy is
   recorded rejected and not re-sent). Otherwise keep $60 and tell him what is missing. AVAX stays (his word); re-read its
   book before any raise of the capital. **Checked 2026-10-08 06:23–06:26 UTC: held at $60, Davies' call.** CW-1/1b
   (172 decisions = 4 × 43 bars, max lag 64 s), CW-2/3 (no live order all week), CW-4 (0), CW-6/7 and CW-9 clean;
   AVAX's 30-day median $51,165 against $31,007; probe 305844 USD 120.00 total and available. Not literally clean:
   CW-5's tick row 583 (10-02 12:19:44) names the live row in the 10-02 stall's platform-wide "Signal timed out",
   and CW-8 has 28 "job startup timeout" runs in the 10-07 stall (run history before 10-02 15:40 truncated). No live
   entry in the week, so it proved nothing about two concurrent positions (pinned in `agents/tick.test.ts`); four
   slots double the drawdown (16.7 % of $100 in window A on both tapes against 7.3–7.5 % at one). Raise only on his
   word: `update public.agent_risk set max_exposure_usd = 150, updated_at = now() where id = 1;`, then read it back. **Never trade by hand in
   that account.** Rows, caps and the order path: `.claude/CLAUDE.md`'s Agents section, `docs/agents/go-live.md`,
   reference §3.31 and §4 items 32–34.

4. **PR5 (GBP stablecoin quotes): its live executor is LIVE since 2026-10-01 16:29:53 UTC at £10 a rung; the paper
   test still decides PR5 on 2026-10-21.** The paper test runs since 2026-09-23 15:09 UTC (`agents/quotes.ts`, `0051`,
   reference §4 item 31) and is decided by the spec's six conditions (`reviews/2026-09-23-pr5-paper-test-spec.md`); plan
   with ~$0.42 a day, the rate since the books tightened in the week of 2026-08-24. The live executor
   (`agents/quotes_live.ts`, `0052`, reference §4 item 35) carries out the paper engine's decisions order for order on
   PR5's own sub-account (key `_2`), at the paper's prices: `capital_gbp` 120, governor 900/950, a refused exit waits
   for a newer print not through it. Armed on Davies' word ("Stablecoin quotes你验证确定一切设置都是最佳，没有任何值得优化后可以上线…可以改到900")
   after the settings review (`reviews/2026-10-01-pr5-live-go.md`).
   - **How it went live (16:25–16:34 UTC):** probe GBP 120.33, no order (request 118271); `capital_gbp` 120 while
     dry-run, re-placed at £10 a rung (13.2 coins, 16:28:30); armed 16:29:53; six £10 bids accepted 16:30:29–31;
     `quotes-convert` bought 39.58399 USDT net at 0.7572 (the fee taken in the coin, £0.027) and 39.54742 USDC at
     0.7579; the six asks rested by 16:33:31. Twelve rungs live, 14 POSTs, no error.
   - **The verdicts must know it:** from 16:29:53 UTC PR5's paper test, PR5V, variant-2 and PR5-W run beside a live
     executor resting at the paper's prices; in the tightened market it would take 7 of PR5's 102 paper trips, the
     smallest (+0.49 % on the study's P&L; QUEUE's Q3 provides for live orders).
   - Watch with §4 item 35's L1–L5 on `mode = 'live'`: a filled entry gets its exit next turn; nothing rests
     `pending` past 2 minutes; the state row is under 3 minutes old.
   - **Its dead-man switch (2026-10-02, Davies: "加一个“掉线保护”…这个加上"):** the monitor Worker calls
     `monitor?action=deadman` every minute; when `agent_quote_live_state.updated_at` is more than 3 minutes old, or cannot
     be read and no read in the last 3 minutes found it fresh (since 2026-10-07: the Worker's `DeadmanMemory` Durable
     Object keeps that read; a held minute is one `ops_errors` row, verdict `held`), every resting order on the `_2` account is cancelled and read back (reference §4 item 35), recorded as an
     `agent_quote_live_events` row of kind `deadman` (`0086`) and an `ops_errors` row `monitor.deadman`; the executor's
     next turn reads them back cancelled and quotes the paper's decisions again. Fresh, it touches nothing at the venue. Kill switch: `update
     public.agent_quote_live_config set live_confirmed_at = null where id = 1;` (cancels entries; exits and stops stay
     armed); `global_pause` cancels everything.
   - **Its page (2026-10-01, Davies: "改成它单独的"; reshaped on his word 18:30–19:00 UTC):** LIVE's "Stablecoin quotes"
     opens a page of its own, in pounds — the scoreboard (the LIVE row's own figures), the paper page's BOOKS, INVENTORY
     (each coin with its unrealised), DAYS, ROUND TRIPS and ORDERS (no empty cancels, read so server-side; an entry by its
     side alone); TESTING's row opened the paper page until 2026-10-02 and opens its twin's since. A round trip carries the conversion fee of the coins it sold (FIFO
     per book, booked at its close). Coins are valued at Revolut X's ticker `index_price`, as the account values them
     (`agent_quote_tickers`, `0078`, written by `books`; the last print when the index is over 10 minutes old): UNREALIZED
     is the coins at the index against their cost, DEPLOYED the coins at the index plus the pounds its resting buys tie
     up (Davies: "每一笔钱都quote出去了"). The paper tests' DEPLOYED is every rung at work (quoting rungs' share of the capital
     plus what is held); their unrealised stays on what is held. Every stablecoin quotes row and page is in pounds; tab
     scoreboards and VENUES add them up in dollars.
   - Never trade by hand in PR5's sub-account (key `_2`): its executor books fills and inventory from that account.
   - **Its realistic twins are TESTING's stablecoin rows since 2026-10-02** (`0087`, `agents/quotes_twin.ts`,
     `agents/revx_sim.ts`, reference §4 item 51, frozen `reviews/2026-10-02-pr5-realistic-twins-prereg.md`; Davies:
     "确保一致，确保真实", "原版每档100磅，variant-2 每档50磅", "都按我们昨天新设立的maker费来换币", "这个variant-2上线testing后改名为
     variant-1"). The live executor's own code on a simulated Revolut X account. **Since 0088 (2026-10-03, not yet
     deployed when written; Davies: "你说的这四点建议全做") each twin is a row of `agent_quote_twin_specs`**, which the call and
     the page read; the rows are reference §4 item 51's "Twin variants" table: "Stablecoin quotes" (`pr5`) carries out
     PR5's paper decisions at £1,200 (£100 a rung); "Stablecoin quotes variant-1" (`p50`, 0088) the same decisions at
     £600 (£50 a rung), frozen `reviews/2026-10-03-pr5-size-twin-prereg.md`; "Stablecoin quotes variant-3" (`d`;
     variant-1 until 2026-10-03, Davies: "你目前正在做的variant改名为variant-1排上面，这个新的是variant-2，原来的variant-1改名为
     variant-3") rule D's arm `d` at £1,800 (£50 a rung, nine a side, four keys). "variant-2" is TAKE (below). A
     variant that differs only in its row is a migration of two statements (`reviews/TEMPLATE-variant-prereg.md`).
     PR5's, PR5V's and rule D's paper rows left the page and keep running with their frozen readings. Their records to
     2026-10-02 21:05 UTC load from `docs/agents/backtests/twins/` (sha256 in each row's `backfill`) on the call's first
     runs (one file a call; the other twins still turn in it), then catch up minute by minute and turn forward with
     PR5's call; p50 catches up about twenty turns a call (a day behind takes about an hour and a quarter).
     - **Daily health:** `agent_quote_twin_{pr5,p50,d}_sim.last_error` empty and its `state->'paperCheck'->'mismatches'`
       at 46 for `pr5` and `p50` (all before 2026-09-24 18:13) and 0 for `d`; `_state.updated_at` within ~3 min once
       caught up; `edge_call_beats` has `agents?action=quotestwins` every minute; no `ops_errors` `agents.quotes_twins`;
       no twin row in `agent_quote_live_orders`. Do not read rule D's twin's fills or P&L before rule D's reading (10-28).
     - **Readouts:** PR5's twin beside PR5's verdict (10-21), with p50 beside it per rung (the size effect); rule D's
       after its reading (10-28), with p50 beside it at the three rungs both quote; per rung as the pre-registrations
       say; no pass or fail bar.
     - **The size study is done (2026-10-03; Davies: "这个到时候你再研究下，不要忘了", asked again "之前说的这事你忘了？"):**
       reference §4 item 51's addendum, `docs/agents/backtests/twins/size/`. PR5's rule on its twin at £10/£25/£50/£100
       a rung: 60/58/57/47 trips, 14–15 bps each, 28.9/27.6/25.7/19.9 % a year realised; pennies under 0.2 bps a trip;
       a 5 % pound reserve recovers 5 trips at £100 and none at £50 or less.
     - **The variants, as Davies named them on 2026-10-03** ("你目前正在做的variant改名为variant-1排上面，这个新的是
       variant-2，原来的variant-1改名为variant-3"): "Stablecoin quotes" (PR5's rule, £100 a rung); **variant-1**, id
       `p50`, PR5's rule at £50 a rung (£600), built (0088, not deployed when written); **variant-2**, TAKE (variant-1 plus lifting the touch when
       the book rests through a rung by more than the 9 bps fee), studied and frozen (next bullet), approved to go live if it holds
       ("可以 批准研究后上线测试…你决定吧": built on variant-1, so the comparison isolates the one change); **variant-3**,
       rule D's twin (id `d`, formerly variant-1). Internal ids carry no variant number.
     - **Variants become rows** (Davies, 2026-10-03: "你说的这四点建议全做", after asking why small variants cost so
       much time and tokens): a spec table and a table-making function, so a parameter-only variant is two SQL
       statements and a one-page pre-registration from a template; `p50` is its first row (built by one opus-max sub-agent in
       a worktree, not pushed; the main session reviews and pushes it when it reports: Davies, 2026-10-03, "mini-pool
       我不打算今天上线，之后上线等我再决定，你东西该部署就部署", so no deploy waits for 10-04, and the 00:25 wake was
       deleted; mini-pool's own rule, no changed `pm_live.ts` or `pm_prep.ts` inside its window, still holds). The page must not change but for the names and the new rows
       (Davies: "只是针对后台吧？我前端看到的不影响吧？"). Reward quotes' variants move to rows after their 10-09
       reading, not inside it.
     - **TAKE, studied 2026-10-03 (reference §4 item 52, `backtests/take/`); its forward test is frozen in
       `reviews/2026-10-03-take-prereg.md` and BUILT the same day: "Stablecoin quotes variant-2", `take50`, `0089`
       (not pushed when written; the main session reviews and pushes it, and the push applies the migration).** In-sample
       (lit 09-28 → 10-02) the rule (a take keeps k after its 0.09 % fee) made 5 trips, 4 won, +£0.40 at £50 (+£0.18 net
       of the maker trip it displaced). Its record to 10-02 21:05 is p50's row for row (check K1 on the backfills,
       `src/take_twin.test.js`); it then catches up as p50 did, and from 10-05 00:00 turns a call behind, waiting for the
       book recorder's read after each turn (120 s at most). **After the push:** read its health (`_sim.last_error`, mode
       `forward`, `waiting` at most a turn or two) and check K1 against p50 once it is forward, before 10-05: its catch-up
       turns stand at :25.000 where p50's forward turns stood at PR5's read instants, so a turn on an exact boundary (the
       dead-man's 3 minutes, a 30-minute top-up, a 24-hour stop) or a print in between can differ; a K1 failure voids C4.
       The window is trips opened 10-05 → 11-02 (to 15 take trips, 11-30 at most), read 2 days after its end by a script
       committed before it ends, whose K2 mirrors the prereg's deviation 1 (two takes on one read share its levels); until
       then only health and K1 are read.

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
     - **Deviation 2 (2026-10-01, Davies: "把这几个paper testing的策略下单上限也都改成900/950，和live那个一样"):** the
       governor is the live design's, 900 / 950 (§2 holds each key "to the live design's order governor", 600 / 700 when
       frozen; the live executor's went to 900 / 950 the same day). At 21:22 UTC every key of both instances had reached
       600 and all 36 of each arm's rungs were idle. `VARIANT_CODE_VERSION` 3 re-decides from 2026-09-28 00:00 under it;
       condition 5 and the reading's `gov` read 900 / 950; the golden replay keeps its 600 / 700 (the function reads the
       arm's limits). Check after it as after deviation 1.

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
     version 3, re-decided from 09-28 00:00; the TrueFX code is kept in `954bd25`). Deviation 3 (2026-10-01, Davies):
     both arms take the live design's governor, 900 / 950, as PR5V's do (code version 4, re-decided from 09-28 00:00;
     `v1` stays PR5V's `main`). Reference §4 items 45 and 47. Check only `agent_quoted_state` code 4, caught up, no
     error, `checkMaxUsd` under $0.01 once both have caught up, and no `x_source = 'truefx'` row.
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
      checks in its §6. **Pulls:** 10-05, 6 windows (probes 22–27, all `trend-1h`, 4 BTC and 2 ETH), none failed, 179 UK
      prints; B empty (every probe's `o15` and `o60` recorded); C 3 exits and 3 entries.
   3. **RW-NEXT: frozen 2026-09-28 05:36 UTC** (`reviews/2026-09-28-rw-next-prereg.md`); RW-C on `main` since 04:39
      (`3682b557`, `17728e3c`; its page row off until the warm-up, `5a8423a9`). **Its slip check was run on 2026-10-08
      at 00:33 UTC (the wake `trig_01SY2TY9HuSQY5C7EEB9LD7y`): RW-C was WARM, so there is no slip and `RWC_RUN_START` /
      `RWC_RUN_END` stay 10-09 00:00 / 10-23 00:00.** The file's `select exists (…)` returned `true`; the four `pmrwc*`
      rows of `edge-calls-every-minute` (`public.edge_calls` ids 9, 10, 11, 15) were enabled; `agents` v145 answered
      them at 00:00 and at 00:10 (statements, numbers and the version in the history section of 2026-10-08 00:46).
      Nothing of this item is left open but RW-C's own checks and its verdict (item 2).
   4. **QUEUE: frozen 2026-09-28 06:22 UTC** (`reviews/2026-09-28-queue-prereg.md`); window 2026-10-04 → 11-01.
      **Freeze line:** until the export is taken, none of `agents/books.ts`, the table `agent_book_levels`, its prune
      job `agents-books-prune`, `stepMinute` in `agents/quotes.ts` or its minute record (`agent_quote_minutes`)
      changes, except a longer retention on Davies' word; any change is a deviation. **Deviation 1 (2026-10-03,
      Davies: "这个研究本来就是为了测试记录的，有用的话就用，之后都用这个来辅助判断是不是更好？"):** `agent_book_levels`
      may be read by other checks and studies, window rows included; QUEUE's design, scorer and checks stand, and its
      reading says it was not blind (the prereg's last section). First read: the twin's crossing check, rows before
      the window only (`backtests/twins/size/book_check.sql`). Its dates:
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
      at 16 pairs or after 2027-01-31 and then disables itself. **Count 2026-10-01 09:24 UTC: 2 pairs.**

6. **Davies' to decide or to do; nothing waits on them:**
   - **The errors box** (2026-10-01): 219 rows of one fault fixed at 09:35 fill its 24-hour summary until 09:35 UTC on
     10-02. Deleting them (one migration, kind `agents.pm_live`, 05:50–09:35, naming the China Open market) was refused
     by the session's permission classifier; his to approve, or click Acknowledge in the badge, or let them age out.
   - **PR5 live now** (item 4): approve the preparation the classifier refused, and decide the paper-test interaction.
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
     `eu-west-1` under his attestation that he is in Ireland (standing since 2026-10-01, item 2). When he says the transfer is done, fire the
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
   2026-09-28; items 4, 5, 10 and 14 closed on 2026-09-30, and items 9, 20 (error boundaries per surface) and 6 (a
   plausibility band on quotes) on 2026-10-02, so 18 of 28 done, 1 partly, 1 not doing (the committed bundle, his
   call), 8 open (its summary line said two more done until 10-02; the table never did). Worth doing, in order: the
   app icon; and item 3 measured before it is touched. Seven questions there wait on Davies, the first whether
   `APP_AUTH_SECRET` was rotated with the two passwords.
   - **What the band does not cover yet** (2026-10-02): the market cards and FX rates (`fetchTickers`; an FX rate
     values every GBP and CNY holding) and Trading 212's own prices (VUAA.L / SAEM.L's `lastPrice`, the overnight
     price); and with a CN fund in the book the public proxies are asked about the fund alone, so a stock the price
     function leaves out goes unpriced that tick (`fetchYahoo`'s CN branch, as before).
   - **10-01: the recorders' first audits of each other pass** (read 10:22 UTC). The night of 10-01, 00:00–08:00 UTC:
     `overnight_intraday_points` 96 of 96 buckets, `price_snapshots` 96 of 96, both 96 (65/30/15 and 71/54/29 on the
     two nights before the Trading 212 retry); `price_snapshots` 288 of 288 in the 24 hours to 09:20; no `recorder.watch`
     row has ever been written. The retry closed the overnight gap.

8. **US equities at Trading 212: nothing to run** (EQ1, EQ2, DFC, DAT; reference §3.44–§3.45). Davies, 2026-10-01: the Invest
   account is USD (no FX on US instruments), the ISA GBP; research deeply, and a trading key follows only if something
   can go live. Nothing can: without FX the verdicts stand, because power binds, not cost (research round §8), and the
   one test worth running, DFC, the month-end dash for cash, **failed** on CRSP's unseen 2016-01 → 2026-08
   (`reviews/2026-10-01-dfc-study.md`, frozen `99123378`: H1 p 0.219, H2 p 0.076; the dodge rule −2.87 % and −1.21 % a
   year at 8 bps). Month-end calendar rules, PEAD, reversal, overnight drift, low volatility, index additions and
   pre-FOMC drift are closed. TAC (Treasury auctions) and IS49 (industry seasonality) were drafted and not frozen; neither
   is recommended on its power. No trading key is needed. Any future live path keeps EQ2's guardrails (research round §8).
   - **MSTR against Bitcoin, BMNR against Ether, and the like: closed** (Davies, 2026-10-01: "mstr和比特币之间，还有bmnr和
     以太坊之间的套利机会或者其他类似的？有希望吗？"; DAT, `reviews/2026-10-01-dat-study.md`, reference §3.45). The premium is no
     arbitrage (no redemption; MSTR's closed through its own share sales) and predicted nothing on the 2020-08 → 2024-12
     screen; every tradable form lost; this account cannot short, and its ISA buys no bitcoin ETN since 2026-04-06; a
     held-out test has 0.09 power. MSTR's 2025 onward stays unread. Reopens only on a binding closing event at NAV or
     a coin hedge open to UK retail.

9. **Supabase, after the tests** (measured 2026-10-02 from pg_stat_statements and the table statistics; the database is
   315 MB after the clean-up):
   - After PR5's verdict (10-21): its paper engine re-upserts its inputs every minute, and `agent_quote_inputs` had
     11.0M updates on 11.4k rows. `quotes.ts` is frozen until then; then write only new rows.
   - After RW's verdict (10-09): RW's tables hold 134 MB, 83 MB of it indexes, and its state upserts take 12–38 ms each;
     the verdict's migration can drop or archive them.
   - `pm_view_books`, the view-count study's raw books, grows about 12 MB a day; nothing prunes it before its study
     reads it (about 500 MB at six weeks).
   - `net._http_response`: past 50 MB the dead space was back (297 MB on 10-07, the stall); since `0093` a job empties
     it every ten minutes. RW's minutes (`pm_rw_minutes`) are the largest table (280 MB on 10-07). **Davies' call:** the
     instance (Micro, 1 GB, the database 1.3 GB on 10-07) or incremental reads of the order tables the minute loop reads
     whole. (PR5's dead-man now holds an unreadable state for 3 minutes after a fresh read, 2026-10-07.)
   - **`0101` (review F4, approved 2026-10-08):** the paper layers' ended-orders read (256 ms a call, the whole orders
     table) goes by a `(mode, cancelled_at)` index; the three order paths' dry-run minutes and ended dry-run orders and
     their paper layers' minutes keep 14 days (`pm_paths_prune()`, 04:23 UTC daily; the first rows go on 10-15); the
     monitor's health shows the database's size, and `db-size-watch` writes `db.size` to the errors box daily past 4 GB.
     Still growing, each for its own decision: RW's and RW-C's tables (after their verdicts and TB1), `pm_view_books`
     (after its study), PR5's `agent_quote_inputs` (after 10-21). Still read whole each minute, for a later change:
     the recorder's market list (`pm_rec_markets`, about 14,000 buffers a call in id order with offsets) and the
     twins' filled orders (all of them, `select=*`, frozen with TAKE to 11-02).
   - **The health-check gap: closed by the monitor Worker, built 2026-10-02 on Davies' word** ("可以的，有问题开github
     issue吧并且也可以在网站中的error框发给我，我看到后可以叫你来处理"). `healthcheck.yml` ran 9 times in the 48 hours to 17:00 UTC
     of the 288 asked, none during the stall. `daviesportfolios-monitor` (`workers/monitor/`) runs every minute on
     Cloudflare's clock: the site, Supabase's minute loop (`monitor?action=health`) and PR5's dead-man
     (`monitor?action=deadman`, item 4); a check failing two minutes running alerts, and again on recovery, to the errors
     box (`monitor.*`) and the GitHub issue labelled `monitor` (`monitor-alert.yml`). **Running since 2026-10-02
     19:04 UTC**: Davies gave `CLOUDFLARE_API_TOKEN` Workers Scripts: Edit and made `MONITOR_GITHUB_PAT`; monitor-deploy
     runs 37051226413 (19:00, `MONITOR_SECRET` generated and set on both sides) and 37051581187 (19:03) deployed it, at
     https://daviesportfolios-monitor.daviesluo.workers.dev, its health reading github "configured", monitorSecret
     "configured", site, loop and pr5 "ok". Both secrets reach the Worker through `--secrets-file`. GitHub's path is
     proven by the first real alert: a dispatch GitHub refuses writes its own alert to the errors box naming the PAT.
     Issue #232 (the first run's failure) closed. **Check that it runs** (read-only): `select minute from
     public.edge_call_beats where path = 'monitor?action=deadman' order by minute desc limit 5;` gains a row each minute
     (every minute from 19:06); its GET address shows each check's state. `healthcheck.yml` stays for its warm pings and
     its not-found chunk probe.

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

### [2026-10-08 17:22 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The fonts are the site's own files, and nothing third-party holds the first paint** (review M7, approved by Davies
  2026-10-08). `index.html` loaded Inter and JetBrains Mono through a Google Fonts stylesheet in `<head>`, which the
  browser must fetch from a third party before it paints. The same 13 woff2 files Google served today (one variable
  file a family and subset, weights 400-700; 300 KB in all, of which a page uses the two Latin ones, 80 KB) are in
  `src/app/fonts/` with their OFL licences, and `src/app/fonts.css` is Google's own 52 rules with only the URL
  changed. `index.html` preloads the two Latin files; Vite hashes them into `dist/assets/` (the smallest subset,
  1.6 KB, is inlined as a `data:` URL). CSP: `font-src 'self' data:`, `style-src` without Google. The worker caches
  the font files cache-first, 200s only (Google's two runtime caches went). The browser tests serve `.woff2` as
  `font/woff2`, so the sweep now draws with the real fonts (it had aborted Google's and drawn fallbacks): all 644
  checks green, perf 76, size ok. Evidence: with Google answering 2 s late, first contentful paint 2,096, 2,100 and
  2,096 ms on the old bundle, 120, 116 and 104 ms on this one; the sweep's 28 desktop screenshots, drawn with Google's
  stylesheet and fonts (answered with these bytes) on the old bundle and with these files on the new, are identical
  but for the pulsing status dots' phase (at most 2,361 pixels, all in the dot column). Pins: `src/fonts.test.js`
  (no Google in the page or the CSP, the preloads, the 52 rules and their files; two of its four fail on the old page
  and headers), and no `.map` committed. **Source maps were never published:** `*.js.map` is ignored, the deploy
  uploads the committed `dist/`, and the live site answers `app-dd113a14.js.map`, `ops_error-8fda3738.js.map` and
  `sw.js.map` with its 404 page (fetched with a cache-busting query); my finding read the local build directory.

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

### [2026-10-08 16:52 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The browser tests wait on what they check, not on fixed sleeps** (review F13, approved by Davies 2026-10-08; the
  scoreboard flake it named was the app's, fixed by the scoreboard's dash, below). The sweep had 163 `waitForTimeout`
  calls, 143 of them fixed sleeps outside any polling loop, and the perf matrix 6: long on an idle machine and a guess
  on a loaded one, where CI flaked (runs 37704688114 and 37711889690).
  - **The sweep** (`src/e2e/app-sweep.mjs`): `readUntil` reads until the check's own condition holds (with `steady`,
    also unchanged and nothing in flight off the page's server for that long); `closeBy` waits for a modal or detail to
    be gone, `openMenu` for the menu's items, `settled` for a page to stop changing, `atRest` for no modal rising in,
    `toggleHidden` for the eye's own label, `extSwitchIs` for the switch. `openAgentsPage` now waits for the dashboard
    the page asks for on opening: it opens on the copy it last had, the previous section's payload, and the old 150 ms
    after the tab bar read that copy whenever the answer was slower. Counterfactual: with the dashboard answered 1.2 s
    late, the old sweep's `main` (desktop) fails 5 checks (`tabs/none`, `tabs/pr5-live`, two `tabs/pr5-page`,
    `tabs/prep`), the new one none; at 400 ms both pass. The reload sections wait for the chart drawn, its 24H rows in
    IndexedDB and the shown prices kept, not 2.5 s. Three fixed waits remain, each with its reason above it: two
    things that must not happen (nothing more sent, no demo book) and a chunk's code running.
  - **The perf matrix**: `settledPanel` (this view and range, drawn, still for 150 ms with nothing in flight) replaces
    the 400 ms after each of the 60 range clicks and the other five sleeps.
  - **The gate**: `src/e2e_waits.test.js` fails on a `waitForTimeout` outside a polling loop unless the comment above
    it starts "a fixed wait:", and pins how many (3 and 0); on the old files the same rule finds 143 and 5 unsaid.
  - Measured on this 4-core container, same bundle, all green both ways: alone, `main` desktop 83.0 → 52.4 s, phone
    72.1 → 25.8 s, perf matrix 41.1 → 24.6 s; the bundle line's six readers at once (four shards, perf, size)
    104 → 88 s (644 checks); two such sets at once (load ~23) 203 → 197 s, with no failure either way. CLAUDE.md's
    testing notes say how the tests wait.

### [2026-10-08 16:09 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **CI tests the committed bundle, requires it to be the commit's own build, and the deploy waits for CI** (review F7,
  approved by Davies 2026-10-08; the committed-bundle model kept). Until now the build stamp was the build's UTC minute,
  so two builds of a commit differed in all nine hashed chunks; CI built its own bundle and tested that; the freshness
  gate only asked that a push touching `src/` touch `dist/`; and `pages-deploy` ran beside `check` (run 37697762469
  published `dd2e979e`, whose check failed its freshness step).
  - **Deterministic build.** `src/build_stamp.js`: the stamp is `src.` and 12 hex digits of a SHA-256 over the app's
    files as git would commit them (tracked or new, not ignored; tests, `e2e/` and `.md` left out). Two builds a minute
    apart were identical but for the ignored `sw.js.map` (a temp path); a second build leaves `dist/` as committed.
    `git log -S<stamp> --oneline -- dist` finds a report's commit. `APP_VERSION` overrides; without git, the old minute.
  - **check.yml.** The source job builds and fails unless `git status --porcelain -- dist` is empty (no change, removal
    or addition); the sweep shards and the perf-and-size job build nothing and read `dist/` as checked out.
  - **pages-deploy.yml.** A push waits (up to 40 minutes) for `check.yml`'s run of the same commit: success publishes,
    failure or cancellation publishes nothing with a warning; a run by hand does not wait. The query, read-only on the
    real repository: `completed success` for main's head, `completed failure` for `dd2e979e`.
  - **bin/gates.sh.** The bundle line checks the same freshness right after its build.
  Cloudflare's Git-connected builder, if still connected (`dist/*` watch path), publishes a `dist/` push without waiting
  for anything: disconnecting it is Davies' dashboard step, written in the map. Pins: `src/build_stamp.test.js` (a
  scratch repository: the same source at two hours, tests/notes/ignored files not moving it, the source moving it, an
  untracked new file moving it, the override, the fallback; and the workflows and gates as written); three fail on the
  old clock stamp. CLAUDE.md (the build and the deploy), map rows, version.js and ops_error.js comments.

### [2026-10-08 16:00 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The 30 s tick no longer asks for every US holding's 1d/5m bars again** (review F12, approved by Davies 2026-10-08).
  Outside the regular session each refresh fetched the extended-hours bars of every US holding (one chart call, which
  asks Yahoo once a ticker), every 30 s on every weekday hour, sold-out holdings included, though the bars are five
  minutes wide. Now the tick reuses bars under two minutes old for the same holdings (`EXT_SERIES_TTL_MS`); the first
  refresh, a Refresh by hand or the R key, and a change of holdings ask at once; an empty answer is asked again on the
  next tick; and a holding with no shares is not asked for (nor preloaded for the overnight line). The quote check
  against the tape reads bars at most two minutes older than before. The cadence comment no longer says the overnight
  ticks every five minutes. Pin in `app.test.jsx` (fake clock: one ask, two ticks reusing it, a third past two minutes
  asking, a Refresh asking, never the sold-out AMD); it fails with the reuse removed and, separately, with the filter
  removed. `refreshPrices` still quotes sold-out holdings each tick: left as it was, since what reads a sold-out
  holding's quote was not traced.

### [2026-10-08 15:58 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Vitest runs under Node unless a test asks for a DOM** (review F14, approved by Davies 2026-10-08). Every one of the
  69 files ran in jsdom, whose set-up took more of the workers' time than the tests. Now `environment: 'node'`, and the
  25 files that need a DOM start with `// @vitest-environment jsdom`: the 15 component tests (`.jsx`) and `agents`,
  `chunk_recovery`, `storage`, `sw_banner`, `screenshot`, `trading212`, `network`, `overnight_intraday`, `prefetch` and
  `yahoo_fetch` (found by running all 69 under Node: exactly those 25 failed). Timed on this container, two runs each:
  before 36.5 s and 36.0 s (environment 58.0 s and 56.7 s summed over workers, tests 20.6 s and 20.4 s), after 23.9 s,
  24.8 s and 24.2 s (environment 20.2–21.5 s, tests 21.0 s); 1,323 tests pass either way. CLAUDE.md's testing section
  says so.

### [2026-10-08 15:53 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The scoreboard never shows the book at 1:1 while the exchange rates load: the sweep's `scoreboard` flake was a real
  bug** (review F13, Davies via the coordinator 2026-10-08: "if the APP shows a wrong total transiently, that is a real
  bug"). Under load the main part's `[desktop/scoreboard]` and `[phone/scoreboard]` read "3330, arithmetic says
  3182.5" (10-07 22:30 and again landing batch 1). 3,330 is the fixture's book with its GBP and CNY holdings at 1:1:
  before the first market data lands, `fxRateToUSD` values a holding whose pair is missing at 1:1 (BRIT.L 250 for
  312.50, VUAA.L 240 for 300, the CNY fund 300 for 30: +147.50), and the check read the scoreboard after a fixed
  1.2 s. Recorded frame by frame on the bundle before this fix, the scoreboard showed `["$3,330","$3,183"]` even unloaded:
  the wrong total was always shown first, the sleep only usually outlasted it. Now the header's three amounts and their
  percentages read `—` while the market data has not landed and a pair is missing (`fxPending`; after it lands, a
  pair still missing is the FX MISSING badge's, as before). The sweep waits for the total instead of sleeping and
  records every figure the scoreboard shows from its first paint (`recordScoreboard`, a MutationObserver): it fails on
  the old bundle (`["$3,330","$3,183"]`) and passes on the new at both viewports (`["—","$3,183"]`). Pin in
  `header_sidebar.test.jsx`, failing with the dash removed. The position cards and FORMATION VALUE still show the 1:1
  values for that moment on a first visit (noted for Davies). Guide's Currency bullet.

### [2026-10-08 15:39 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The order paths' dry-run record keeps 14 days, their ended-orders read is indexed, and the database's size is
  watched** (review F4, approved by Davies 2026-10-08). `0101_pm_paths_retention.sql`:
  - **Index.** The paper layers read their path's ended orders every minute by `cancelled_at`, which no index covered:
    a scan of the whole table (production's EXPLAIN on 10-08: 24,589 rows and 4,290 buffers for 5 matches; 256, 254 and
    206 ms a call in `pg_stat_statements`). Now `(mode, cancelled_at) where cancelled_at is not null` on each of the
    three orders tables; on PGlite, under a forced generic plan, the read goes from the primary key with a filter to an
    index range scan on both conditions. The read itself (`pm_prep.ts`, frozen) is unchanged.
  - **Retention.** `pm_paths_prune()` (04:23 UTC daily) deletes, per path, the dry-run minutes, the dry-run orders in
    an ended state (`cancelled`, `expired`, `rejected`) that no fill names, and the paper layer's minutes, all older than
    14 days and never later than a day before the paper layer's last decided minute (no state row: nothing). The
    migration's header lists every reader and why none needs those rows: the code reads two days back at most; the
    frozen checks that read dry-run rows have run (mini-pool's, `mid_check.sql` 10-04, `lp_check.sql` 10-07); what is
    left (`mid_readout.sql`, `mid_audit.sql`, `lp_readout.sql`, live-prep's (f)) reads days tables, live rows, markets,
    config and state. Not touched: RW's, RW-C's and the variants' tables, `pm_view_books`, PR5's and the twins'. On
    PGlite over a planted record (paths' tables from 0074/0076/0077/0081/0084/0091/0094): with the layer current it
    deleted the dry-run minutes of 15, 20 and 22 days, the ended, expired and rejected orders older than 14 days and
    the paper minutes of 20 and 22 days, and kept the 13-day rows, a 22-day open order, the live rows and an order a
    fill names; with the layer 20 days behind only what is older than 21 days; with no state row nothing; a second run
    nothing. The oldest rows are of 10-01, so the first go on 10-15; the group writes about 73 MB a day.
  - **Size.** `db_size_bytes()` (service role only) for a `size` reading beside the monitor's four (`health.ts`: shown,
    never failing the loop's reading, so a large database cannot hold that alert open over a stall), and
    `db-size-watch` (06:17 UTC daily) writing a `db.size` row to the errors box while the database is over 4 GB (1.16 GB
    on 10-08).
  Pins: `cron_jobs.test.js` (both jobs, their minutes off :X0/:X5, nine deletes and each one's condition, the cutoffs,
  the indexes, the grants; fails without 0101) and the monitor's Deno tests (the size read, over the line and unread,
  never failing `ok`; 28 pass). Not done, written in item 9: the recorder's `pm_rec_markets` read and the twins' whole
  filled-orders read. 0101 applies on push and `monitor` redeploys. Guide, map, `docs/agents/CLAUDE.md`.

### [2026-10-08 15:26 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The Trading 212 history walk runs without a page open, and a hidden page stops calling it** (review F17, approved
  by Davies 2026-10-08). `orders-sync` (fills, dividends and their two backfills) ran only from an open admin tab, every
  two minutes, hidden or not. `0100_t212_orders_sync_call.sql` makes it a row of the one-minute job: every ten minutes,
  55 s at most, run again by the watchdog when its worker never started (the walk upserts on each fill's id). The
  function now takes the job's POST for that action alone (`handleCronPost`: the cron bearer, the beat first, then the
  same sync the page's GET runs, now `historySyncResponse`); any other POST is refused as before. The page skips the
  walk while hidden and walks within two minutes of being shown. Sizes from the edge logs: the page's 392 calls in the
  24 hours to 10-08 15:00 UTC took 0.8 s at the median, 2.0 s at p95, 37.6 s at most. Pins: `cron_jobs.test.js` (the
  row, 144 calls a day, the POST route; the beat check covers `trading212` now), `handleCronPost` in the function's Deno
  tests (75 pass), and an app test (a hidden tab never calls the walk; shown, within two minutes), which fails without
  the guard. 0100 checked on PGlite against 0075's table (applied twice: one row). Redeploys `trading212`; 0100
  applies on push. Its freshness is not among the monitor's readings: no money moves on it. Guide and map.

### [2026-10-08 15:23 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **No call of the one-minute job can hold the next minute's batch** (review F6, approved by Davies 2026-10-08).
  pg_net runs a batch until its slowest call answers, and `pmrw-select` and `pmrwc-select` waited 290 s, so one that
  ran long would have held every later minute's calls, the live executors' turns among them, for up to five minutes.
  `0099_edge_calls_select_timeout.sql` makes both wait 55 s; the selection itself goes on past that, the runtime asked
  to keep its worker (`runSelectKeptAlive` in `agents/index.ts`, `EdgeRuntime.waitUntil`), under its unchanged 290 s
  lease, and still writes its day in one request, so neither spec's rule or days change. How it was checked: the edge
  logs (`function_edge_logs`) put RW's 2026-10-01 selection at 40.2 s, the longest read, and every call of both in the
  24 hours to 10-08 15:00 UTC within 11.2 s; 0099 applied on PGlite to 0075's table (both rows 290000 → 55000, the list's
  largest wait 59000, applying it twice changes nothing); production's two rows read 290000 before (SELECT). Pins:
  `cron_jobs.test.js` (replays the new `timeout_ms` update, both rows 55000, every other row as it was, every row of
  the list under 60 s; fails with 0099's update removed) and `runSelectKeptAlive` in `agents/index.test.ts`.
  Redeploys `agents`; 0099 applies on push. `docs/agents/CLAUDE.md` and reference item 39 say so.

### [2026-10-08 15:15 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Trading 212's own failures reach the errors box** (review F16, approved by Davies 2026-10-08). A refused or
  timed-out positions read, or an answer of the wrong shape, went only to the function's logs; the page went on with
  the cache, then with nothing, and the client's read returns null without a word, so the sync could stop unnoticed.
  The live path now files `trading212.upstream` (the invest account's read failed: what the page was sent, and what
  Trading 212 said) or `trading212.isa` (only the ISA's read failed, so the answer is not `complete`). The cache lives
  a second, so every open tab's refresh reaches the broker: a row is written only when none of its kind in the last
  hour reports the same fault (`t212FaultReportDue`; the fault is the message before Trading 212's body, so a trace id
  does not make it new, and the status does), and it is sent while the answer goes out (`EdgeRuntime.waitUntil`), not
  before it, since the read may have spent 8 s of the page's 10. Pins: two Deno tests (74 pass in the function); the
  wiring is read, not tested, as it sits in the served entry point. Redeploys `trading212`. Guide and map row.

### [2026-10-08 15:12 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The Edge deploy no longer drops a cancelled run's functions** (review F8, approved by Davies 2026-10-08).
  `edge-functions.yml` cancels a run in progress when a newer push starts one, and diffed each run from its own push's
  `before`, so a function changed by a push whose run was cancelled, or failed before its deploy, stayed on the old
  version with CI green until a later push touched it (5 cancelled runs in the 100 before; none lost anything so far).
  The detect step now diffs from the commit the workflow's last successful push run on main deployed (`gh api` on its
  own runs, `actions: read`), through the new `bin/edge-changed.sh`; `before` stays the fallback, with a warning, when
  no such run is found or the clone does not hold it or it is not behind this commit. The script also no longer names a
  deleted function. Pins: `src/edge_changed.test.js`, 8 cases on a scratch repository; the cancelled-push case fails
  with the old base. Checked read-only against the real repository: the query answers `3c419ab1` (an ancestor of
  main), and batch 1's commits would deploy `agents` and `trading212`. CLAUDE.md's deploy section and the map say so.

### [2026-10-08 15:04 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **A reload replays an unsaved edit only onto the version it was made against** (review F20, approved by Davies
  2026-10-08). The draft a tab keeps in sessionStorage (`dp.pendingSave`, for a tab that dies or is signed out before
  the server takes its edit) was replayed after the reload onto whatever the server then held, and its save went out
  against that newer version and was taken: a change saved from another tab or device in between was overwritten
  without a word. The draft now carries `baseVersion`, the `If-Match` its save would have sent
  (`knownPortfolioVersion`); a newer edit's draft moves to the version a save makes (`draftAfterSave`). On a reload,
  `pendingDraftAction` replays it when the server is still on that version, and otherwise ends where the save's 412
  would have left the tab: the draft on the board, nothing saved, the CONFLICT bar's choice. A draft from the earlier
  bundle (no version) replays as before. Pins: seven in `portfolio_saver.test.js` and two in `app.test.jsx` (a draft
  made against version 6, server on 7: the bar comes up and nothing is saved); the app pin fails on the old replay and
  the rebase pin with the rebase removed. The sweep's save-retry draft now carries the loaded version (both viewports
  green on the rebuilt bundle; with an older version the bundle sends no save). Guide updated.

### [2026-10-08 14:51 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Only the newest refresh's answer reaches the board** (review F18, approved by Davies 2026-10-08). `doRefresh`
  had no in-flight guard: the 30 s tick, the Refresh button, the return to the tab and the real load's catch-up can
  overlap, and an older refresh answering after a newer one began wrote its older prices over the newer ones and
  cleared the newer one's spinner. Each refresh now takes a number (`refreshSeqRef`); an answer that is no longer the
  newest is dropped before it is screened or applied, and only the newest clears the spinner. Pin in `app.test.jsx`
  (the load's refresh answers last with an older price: the board keeps the newer one), failing with the guard
  removed.

### [2026-10-08 14:50 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **UNREALIZED G/L's percentage leaves cash out** (review F19, narrowed by Davies 2026-10-08: "cash is NOT counted";
  the cost-at-today's-FX half stays as it is). `computeMetrics` divided the G/L by a cost that carried cash at its
  value, so the percentage read smaller the more cash the book held, and a position card mixing cash and a stock
  disagreed with the sectors list, which already left cash out. Now the book and every position read Σ unrealised ÷
  Σ cost of the holdings (`investedCost`); the G/L amount, PORTFOLIO and DAY CHANGE % are unchanged. Every place the
  figure shows was checked: the scoreboard, the sidebar's position cards and the drill modal read this function; the
  holding and sectors lists (and their exports) already excluded cash. Pins: three in `metrics.test.js` (a book with
  cash reads 10 %, not 5 %; a mixed position 20 %, not 8 %), two failing on the old code. Guide and skill updated.

### [2026-10-08 14:48 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The scoreboard's currency cycle no longer prints dollars under £ or ¥** (review F10, approved by Davies
  2026-10-08). With the GBP or CNY rate not yet in `marketData`, `usdToCcyRate` fell back to 1 and PORTFOLIO, DAY
  CHANGE and UNREALIZED G/L read the dollar figures with the other currency's sign; a test pinned that as the
  intended behaviour. Now the rate is null and the three amounts read `—` until it lands (the percentages and USD are
  unaffected). The old pin is replaced by one that fails on the old code (`header_sidebar.test.jsx`, 36 pass). The
  guide's header section names the button.

### [2026-10-08 14:46 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The portfolio keeps its earlier versions** (review F9, approved by Davies 2026-10-08). `board_data` is one row
  that every save overwrites, so a save that lost shares could only be undone from the platform's backups.
  `0098_board_data_history.sql`: an AFTER UPDATE OR DELETE trigger copies the version being replaced into
  `board_data_history` (RLS on, no grant to anon or authenticated, `search_path` empty) when `data` changes, and
  `board-data-history-prune` (SQL only, 10:55 UTC daily) keeps 90 days. About 25 kB a version and a few saves a
  day: a few MB. Restoring is by hand, one statement in the migration's header. Checked on PGlite 16 with 0009 and
  0013 (`board_history_check.mjs` in the session's scratchpad): a changing save keeps one row, an unchanged one and a
  refused one keep none, a delete keeps one, a restore keeps the version it replaces; without 0098 nothing is kept.
  Pinned in `src/cron_jobs.test.js` (the job, its command, the trigger, RLS, no grant). Applies on push
  (`migrations.yml`); nothing in the app reads the table.

### [2026-10-08 14:44 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **PR5's live executor watches the dead-man switch back** (review F5, approved by Davies 2026-10-08). The switch
  runs from the monitor Worker, and nothing watched the Worker: had it stopped, the live account would have kept
  quoting with its kill path gone and no alert. Each turn of the live account now reads the dead-man call's newest
  beat (`deadmanBeatAt` in `agents/index.ts`, key `monitor?action=deadman`, the one the `monitor` function writes)
  and, while it is over five minutes old or missing (`QUOTE_LIVE_DEADMAN_WATCH_MS`), guards both books: entries
  withdrawn, exits and 24-hour stops armed; the first such turn writes one `agents.quotes_live` error starting
  "DEAD-MAN SWITCH NOT RUNNING". An unreadable beat is a note only. The twins pass no `deadmanBeatAt`, so their
  decisions are unchanged (`quotes_live_instance`, `quotes_twin` and `quotes_take` tests pass, 161 in the files run).
  Pins: three in `quotes_live.test.ts` (the stale-beat case fails with the guard removed) and the key in
  `index.test.ts`. `agents` redeploys with it; production read 60 dead-man beats in the hour before, so the guard
  does not fire on landing. CLAUDE.md's monitor section, `docs/agents/CLAUDE.md`, reference §4 item 35, the guide's
  errors-badge paragraph and the map row say so.

### [2026-10-08 14:40 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **A position sold out in full at Trading 212 now leaves the board** (review F1, approved by Davies 2026-10-08).
  `/equity/positions` drops a ticker sold in full, and the function sent explicit zeros only for the two allow-list
  ETFs, so a tagged slice was never taken off: the board kept the shares at the live price for good and the lot
  editor read "pending" for ever (repro in the review: a 50-share board with a 20-share T212 slice still read 50 after
  the 20 were sold). The `trading212` answer now says whether it read every account (`complete`, `everyAccountRead`;
  stored with the cache row, false for a fallback or an older row), and `settleSoldOutSlices` takes a tagged slice the
  answer no longer reports to zero by the settled delta rule only when the answer is complete AND the stored fills
  net to zero; the other platform's shares stay. Otherwise the board is left as it is and, once it has stood ten
  minutes, the errors box gets a `t212.slice` row naming the holding and why. A position closed this way leaves its
  slot (`stripClosedFromPositions`, tested but never wired until now; no closed holding is on the board today).
  Pins: six vitest cases in `trading212.test.js` (four fail with the fix reverted), `unpackCache` and
  `everyAccountRead` in the function's Deno tests (72 pass). The function redeploys with it; an old client ignores the
  new field, and a new client before the deploy only warns. Guide, map rows and the skill's T212 section updated.

### [2026-10-08 06:30 UTC] Platform: Claude Code | Model: not recorded (session policy)
- Item 3's $150 step (wake `trig_01THvHcphx5gngXugfwwy788`): read-only checks by a sub-agent, the decision kept in
  the main session. Three conditions pass and the money is there (USD 120.00), but CW-5 names the live row once (the
  10-02 stall's timeout) and CW-8 holds the 10-07 stall's 28 startup timeouts, and the week had no live entry. The
  wake's rule is all-or-nothing on live money, so the cap stays $60 and the step waits on Davies; item 3 has the
  statement. `agent_risk` read back unchanged: 60, updated 2026-10-01 02:24:51.

### [2026-10-08 03:20 UTC] Platform: Claude Code | Model: not recorded (session policy)
- `sh bin/gates.sh --quick`: the gates by what changed less the bundle's line (build, sweep, perf, size), ending
  "quick gates green", which is not leave to push. On Davies' word ("如果不同agent都要跑所有gates的话可以一起就跑一个吗"
  … "好的"), sub-agents run it, commit and hand back; the main session rebases the batch onto `origin/main`, runs the
  full gates once and pushes. Urgent fixes still run the full gates alone. In CLAUDE.md's git workflow and the skill.

### [2026-10-08 03:04 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **TOP MOVERS no longer ranks part of the book while a window's history loads** (Davies, 10-08, screenshot: on every
  open, under REFRESHING, 1M showed VUAA +0.16 % and SAEM +0.02 % with no losers, then the whole list). Cause, measured:
  `holdingMoveOver` → `computeAt` counts a holding with no window history FLAT on its pre-window lots, so with the
  rows not yet there only in-window buys (the auto-DCA ETFs) moved and ranked alone; the rows were not there because
  the chart store hydrates from IndexedDB after the first paint and nothing re-read it (the card's only trigger was
  the prefetch's `CHARTS_UPDATED_EVENT`, which fires after the live refresh and a range's fetch). Fix: `moversPending`
  (`board/movers.js`) holds a longer window on "loading…" until the stores have loaded and every rankable name has
  rows, or until this session's prefetch has had an ANSWER for the window (`markRangeSettled` in `prices/prefetch.js`;
  `fetchHistoricalBatch`'s new `report.answered` says the Edge Function or a proxy answered), so a name with no
  history never blocks for good, while a failed call (the 8 s timeout, the gates run found it) settles nothing; the
  card re-reads when hydration ends. TODAY unchanged. Sweep part `movers-load` (1M, %, VUAA.L with one in-window buy;
  `chart` answers gated cold, every answer gated on a warm reload, each gate opened by the check, not a timer):
  origin/main's bundle paints `1M: VUAA +1.27% | —` on both visits (4 FAIL, both widths); the new one paints only
  loading → the whole list, and on the warm visit the whole list from the 20 stored 1M rows before any answer (the
  loading frame lasted ~170 ms after first paint, measured once on desktop). Pins: `movers.test.js` (moversPending,
  the partial list closed-form), `header_sidebar.test.jsx` (2 of 3 new cases fail on the old component),
  `prefetch.test.js` (settled on an answer; not on a failed call, which fails with an always-settle prefetch).
  Full gates green on `fb57f4f8` (the run at ~03:00); rebased onto `c7a9fbeb`, `--quick` green, handed back unpushed
  under that commit's rule: the landing run is the main session's.

### [2026-10-08 02:55 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **RW-C merged into "Reward quotes" (Davies, 2026-10-08: "合并进 Reward quotes"): from RW-C's first minute,
  2026-10-09 00:00 UTC, every Reward quotes row reads RW-C's run, and there is no "Reward quotes confirmation" row, now
  or later.** RW-C is RW's own rule on fresh days (RW-NEXT Part 2), so it is the row's round 2. `readRwPage` (agents
  `index.ts`) picks the run by the clock (`RW_PAGE_SWITCH` = `RWC_RUN_START`, `rwPageRun`, `rwePageReplay`,
  `rwxPageReplay`): before it `rw`, `rwe` and `rwx` are RW's engine run and its replays, read from `pm_rw_*` alone; from
  it RW-C's (`rwcSummary`, `pm_rwc_e_*` for variant-1, `pm_rwc_x_*`), read from `pm_rwc_*` alone, each starting from
  zero. Variant-1's move is the main session's call (told Davies), kept a separable part: `rweArmSummary` / `rweSummary`
  take the replay, with an empty-but-running row until `pmrwc-e` writes its first state (not running from 00:12). The
  dashboard sends no `rwc`; the page builds TESTING's tests in one function, `paperTestRows`, which adds no row for an
  `rwc` a stale payload carries, so the scoreboard and the Polymarket card add Reward quotes once (RW-C alone after the
  switch). Reward quotes' page says "Round 1: RW's own fourteen days from 25 Sep 01:00 BST. From 9 Oct 01:00 BST it
  reads round 2, …" / "Round 2: RW's rule on fresh days since 9 Oct 01:00 BST. Round 1's figures are not in it."
  (`rwRoundText`); variant-1's page prints `rwxSourceText` as the other variants do. RW's day rows, the verdict scripts,
  the routines reading `pm_rw_*` / `pm_rwc_*` and every frozen file are untouched. **Evidence:** `pmrwc_view.test.ts`
  (pinned clock: both rows before and after the switch, each touching its own run's tables only; 00:01 / 00:02 / 00:13
  empty-but-running; with the switch removed from `readRwPage` the two after-switch tests fail); `agents.test.js`
  (`paperTestRows` with and without a stale `rwc`: 2 tests, $2,000); the sweep's `rwc-running` (Reward quotes and
  variant-1 read RW-C's, no confirmation row, 15 rows, scoreboard and card move by RW-C's figures less RW's) and
  `rwc-warmup` (a payload carrying `rwc` adds no row), and the normal mode's round and source lines. Counterfactual:
  the new sweep against origin/main's bundle fails 10 of these checks (round/source lines, the stale-`rwc` row, the
  round-2 page line, variant-1's source line), plus one timing check, "dashboard requests stayed at 3 after a minute",
  that passes on the new bundle. Docs: guide (two rounds, no figures), reference §4 item 36, map row of `pmrw_view.ts`.
### [2026-10-08 02:57 UTC] Platform: Claude Code | Model: not recorded (session policy)
- Transaction history, on Davies' word ("type的dividends改为DIVS，并且一个公司同一批分红合在一起显示，目前是分账户分开的多行
  显示"): a dividend row's Type reads `DIVS` (as wide as SELL; the phone card's type column back to 46 px), and one
  company's payment is ONE row, not one per Trading 212 account. `buildTransactionLog` folds a holding's same-date
  dividends that sit next to each other in the walk (`mergeSameDayDividends`, transactions.js): amounts and shares summed,
  the price their quotient, the walk's Avg Cost after the last, gains summed. Display only: the events, `annotateLedger`,
  `realizedGain`, `withDividendCosts` and the headline are untouched, so no figure moves; a trade between two same-day
  dividends keeps them apart. A dividend and a return of capital paid the same day merge too (one distribution, both
  booked alike; the table never showed the type). Exports follow the rows; hide-values masks as before. Pins: 7 vitest
  cases in `transactions.test.js` (2,000-ledger property: a payment split across two accounts reads as the payment
  whole) + 1 in `transaction_history.test.jsx`; the sweep's ACME dividend is now two accounts' rows read as one DIVS row
  on both widths, its badge as wide as SELL. Counterfactuals: 8 vitest cases and 2 sweep checks per width fail on
  `origin/main`'s code and bundle. On production data in a scratchpad: 95 dividend rows became 75, TOTAL REALIZED
  unchanged, every merged row's Avg Cost equal to the old walk's after its last event.
  Handed back unpushed under the sub-agent rule (`sh bin/gates.sh --quick`); the landing run is the main session's.
### [2026-10-08 03:07 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The sweep's agents-detail reds (`after Load full history: button 1, rows 3`; `strategy actions Refresh,Close,
  dashboard 2→3, chart 25→25`) had two causes: checks that read after fixed sleeps, and one app race, now fixed.**
  Measured with latency injected into the sweep's own routes (a scratch copy of `app-sweep.mjs`, desktop `main`):
  the log's answer held 400 ms fails the old 300 ms read with exactly CI's "button 1, rows 3" every time, and the
  button goes once the answer lands — the app is right, the check read early. The dashboard's answer held 600 ms
  leaves the chart unasked at the old 400 ms read (25 → 25) and asked at 3.4 s — read early again. But the chart
  request the BTC tab sent just before Refresh, held 5 s, is JOINED by the click's refresh (`fetchAgentsChart`'s
  in-flight join): no chart request follows the click at all, 25 → 25 at 3.4 s. That is the app: the dashboard's own
  rule is "a click asks anew; anything else joins", and the chart did not follow it. Fix: a click's dashboard answer
  bumps `clicks` (agents.jsx), and the open chart then calls `fetchAgentsChart(..., fresh = true)`, which never
  joins; only the newest request for a pair writes the chart cache (`chartSeq`), so the overtaken one answering last
  cannot put its older chart back. Pin in `agents.test.js` (fails on the old `agents.js`: one request, not two). The
  sweep's tab swap, Load full history, Refresh and minute checks now wait for the state they assert (bounded 8 s)
  instead of 200–400 ms sleeps and a 2 s click; the share bar's squeeze and pinch waits go from 2 s to 8 s (2 of 32
  loaded shards timed out there while the read straight after found the slice right: "95%", one line, 19.9 px in 48).
  Counterfactuals with injected latency: old bundle + new checks, log 400 ms: green (the check waits, the app is
  right); old bundle + new checks, BTC chart 5 s: Refresh FAILS 25 → 25 (the join); new bundle, same: green; new
  bundle, dashboard 600 ms: green. Stress, 4 `main` shards at once (2 desktop, 2 phone) beside other sessions' sweeps,
  load average 20–50 on 4 cores: before, 3 of 32 runs red in the agents detail (chart 25 → 25 once; the tab click
  timing out at 2 s, then the `.ag-more` click crashing the run once; the minute's dashboard read at 200 ms once;
  CI's "button 1" itself never came up unprovoked); after (the squeeze bound not yet widened), 0 of 32 in those
  checks, 2 of 32 on the squeeze alone. Gates: the bundle line green before the rebase (four shards 240 / 77 / 248 /
  69, perf, size); on the rebased tree `--quick` green and the two `main` shards 240 / 248. Committed on the agent's
  worktree and handed back unpushed (the sub-agent rule of 2026-10-08), for the landing run on the batch.

### [2026-10-08 02:55 UTC] Platform: Claude Code | Model: not recorded (session policy)
- `bin/gates.sh` takes a machine-wide `flock` (`/tmp/daviesportfolios-gates.lock`, `GATES_LOCK` overrides): a second
  run waits and prints how long (Davies: "gates怎么又run的这么慢了"). Four worktrees' runs at once on four cores had
  the load at 48; each run took longer than queuing, and page checks timed out at random. Measured and not done:
  `deno test --parallel` cuts the Edge tests from 2 min 46 s to 1 min 26 s, but `pm_live.test.ts`'s "a full day
  through the real client sends nothing but GETs" fails under it (Deno.env is one per process, so files that set it
  collide); the unit tests run every file under jsdom, and the ones that need no DOM could run in node.

### [2026-10-08 01:12 UTC] Platform: Claude Code | Model: not recorded (session policy)
- `0097_http_response_prune.sql`, on Davies' word ("推 0097"): `http-response-truncate` is unscheduled and
  `http-response-prune` deletes pg_net responses over ten minutes old at :05, :15, … A DELETE takes row locks only,
  so pg_net's inserts of the one-minute batch's responses never wait on it, and it runs off the `:X0` minutes the
  truncate shared with that batch. Deletes from an ordinary backend reach the statistics, so autovacuum reclaims what
  `0093` was written for. Table at 01:00: 68 rows, 280 kB, `postgres` holds DELETE. Pinned in `src/cron_jobs.test.js`
  (no job may truncate the table again). The cause is still a lead, not proven: item 2's bullet says what to check.

### [2026-10-08 00:46 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **RW-NEXT's slip check, run at 00:33 UTC (the wake `trig_01SY2TY9HuSQY5C7EEB9LD7y`, item 5a.3): RW-C is WARM. No slip;
  `RWC_RUN_START` 10-09 00:00 and `RWC_RUN_END` 10-23 00:00 stand, and no commit was made for it.** Read-only through the
  Supabase connector, on the database's clock (00:33:17 UTC at the first statement):
  - `select exists (select 1 from public.pm_rwc_selection where day = date '2026-10-08' and selected_at <=
    timestamptz '2026-10-08 00:10:00+00')` → `true` (run once, as written; no other column of the table read).
  - The command of `edge-calls-every-minute` (cron job 27, `* * * * *`, active) queues one `net.http_post` per due row
    of `public.edge_calls` that is `enabled`. The four RW-C rows are `agents?action=pmrwc` (id 9, retry false),
    `pmrwc-e` (10), `pmrwc-x` (11) and `pmrwc-select` (15, every 5 minutes): all enabled, `last_utc_hour` 23. Their beats
    (`edge_call_beats`) reach the function every minute from 23:51 on, bar the `:X0` minutes below.
  - The Edge Function: `agents` v145, deployed 2026-10-07 23:17:07 UTC (`edge-functions` run 395, commit `a5c60ea2`;
    its `index.ts` lines 2416–2419 hold the four routes), answered every RW-C call until 00:26:02 (the Edge log's
    `deployment_id` `…_145`), so it was the version at 00:00 and at 00:10. v146 (run 398, `592111de`, 00:26:43) answers
    from 00:27:01; no `agents` deploy came between the two.
  - `pm_rwc_state` (its `state` never read): `last_minute` 00:33:00 at 00:35:30 (2 min 31 s behind) and 00:41:00 at
    00:43:16, `updated_at` 00:43:00.6, `last_error` null; `pm_rwc_minutes` held 39 distinct minutes of 10-08 at 00:43.
- **Daily health of RW, RW-E and RW-X (item 2), scalars only, read 00:35–00:44; no market-level figure was read.**
  `last_error` null on all three. `last_minute`: RW 00:37 at 00:40:06 (186 s: the 00:40 batch was late, below) and 00:41
  at 00:43; RW-E and RW-X 00:36 at 00:40:06. Today's `pm_rw_selection` present (15 rows, stored 00:01:00.8); `pm_rw_days`
  14 rows, 09-24 … 10-07, 10-07 closed 00:02:00.5. RW-E: version 3, `checkMaxUsd` 0, `diverged` 0. RW-X: version 2,
  `checkMaxUsd` 0, `checkEMaxUsd` 0 over 13 days; arms e, rw, tb1-back, tb1-skip, x1–x5, none with a `start`, tb1's `base`
  {}; `diverged` markets e 0, rw 0, x1 0, tb1-skip 3, tb1-back 4, x2 18, x3 15, x4 15, x5 27 (counts only).
  `net._http_response` holds ten minutes at most (empty at 00:42), so the 546/5xx read is the Edge log's, 24 h to 00:44:
  no 546 on any `pmrw*` / `pmrwc*` call; `pmrw-select` 245 × 200 (slowest 11.5 s), 1 × 500 (10-07 20:17:40) and 2 × 503
  (last 16:45); `pmrwc-select` 251 × 200, nothing else; the last 5xx on any of them was a 503 on `pmrw-e` at 23:31:10.
  `ops_errors`: no row after 10-07 20:47. NOT checked: the page's "fills and total differ" line (its figure comes from
  per-market accounts, which this read leaves alone; the replays' check fields above stand in for it).
- **Found while reading the beats, not fixed: the `:X0` minutes (item 2's bullet).** From the first run of `0093`'s
  `http-response-truncate` (`*/10`, 20:50 on 10-07) to 00:41, the `tick` beat is missing at 18 of the 24 `:X0` minutes
  (21:10 … 21:50, 22:10 … 22:40, 23:00 … 23:30, 23:50, 00:00, 00:10, 00:30, 00:40) and at none of the 208 others; from
  10-06 01:00 (the start of what was read) to 10-07 02:53 none was missing, and the stall of 02:55 → 20:47 lost
  scattered minutes. At 00:00 and 00:10 not one of the batch's ~26 calls has a beat, and all of them beat at 00:01 and
  00:11 (0.4–2 s into the minute); `cron.job_run_details` has job 27 starting on time (00:00:00.19, 26 rows, 0.06 s), so
  the delay is downstream of it, in pg_net. The truncate took 0.05–0.18 s at the 17 lost minutes through 00:30 and at
  four of the six on-time `:X0` ones (20:50, 21:00, 22:00, 00:20); it waited its full 30 s and gave up at the other
  two, 22:50 and 23:40. No other cron job runs at a `:X0` minute in those hours. That the truncate is the cause is a
  lead, not a finding: the next step is a test with it moved or replaced. Queries: `edge_call_beats` by minute,
  `cron.job_run_details` of jobs 27 and 37, and the Edge log's requests per minute (`function_edge_logs`, grouped by
  `toStartOfMinute(timestamp)`).

### [2026-10-08 00:24 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **The page's variant-2/-3/-4 rows (x1, tb1-skip, tb1-back) read RW-C's replay from RW-C's first minute** (Davies,
  2026-10-07: the page's variant-3 and -4 are TB1's two tests, whose test is RW-C's 10-09 → 10-22): RW's replay stops at
  RW's end, 10-09 00:00 UTC, so the rows would have frozen. `pmrw_view.ts`: `RWX_PAGE_SWITCH` (= `RWC_RUN_START`),
  `rwxPageReplay(now)`, and `rwxArmSummaries` reads the replay it is given (its specs, engine run and fourteen days);
  before RW-C's replay has a state the three rows are there, empty, "starts 9 Oct 01:00 BST". `index.ts`: `readRwxRows`
  reads one replay's tables and its run's (RW-C's run is read once for its own row and the variants). A row reads ONE
  replay, never both: at the switch its figures, days, quotes and fills restart at zero; RW's stay in `pm_rw_x_days`.
  Each entry carries `source` / `sourceNext`; the page prints which replay and since when (`rwxSourceText`, agents.js),
  and the check warning names RW-C's days there. TESTING's scoreboard and the Polymarket card add each row once, as
  before: RW-C's own row is RW's rule on RW-C's minutes (the replay's `rw` arm, not a page row), the variants its other
  arms. Variant-1 (RW-E) is not moved (not asked; Davies' call). The stale comment in `agents.js` naming x4/x5 fixed.
- Evidence: `pmrwc_view.test.ts` reads two replays from one in-memory database through `readRwxRows` with a pinned
  clock: 10-08 23:59 RW's figures by hand ($10 / $4 / $5) from RW's tables only; 10-10 12:00 RW-C's ($0.70 / $0.30 /
  $0.50, today $0.30 / $0.20 / $0.30, days from 10-09 only) from RW-C's tables only; 10-09 00:05 the empty rows,
  running, and not running 13 minutes after 00:02. Counterfactuals: the old reader (RW's replay at every hour) fails 3 of
  the 4 new tests; ignoring the given replay fails 2. Vitest pins `rwxSourceText` and the RW-C check wording; the sweep
  reads the RW source line on variant-3's page and, in `rwc-running`, the three rows once each with RW-C's figures and
  "On RW-C's minutes since 9 Oct 01:00 BST".
- **TB1's first tick, recorded (reported by the session that froze TB1, re-read here at 00:11):** both arms began
  writing flat at 2026-10-08 00:00 UTC; at 00:07 `pm_rw_x_state` held arms e, rw, tb1-back, tb1-skip, x1–x5,
  `last_error` null, tb1-skip's `base` {} and no `start` on either; x4/x5 day rows still written (10-07's for all seven
  older arms, closed 00:03:00 UTC, none for TB1, as designed); `pmrw-x`'s median wall time about 1.3 s, unchanged (that
  figure is the earlier session's, not re-measured). `pm_rwc_x_state` has no row yet (quiet until 10-09 00:02), as designed.

### [2026-10-07 23:52 UTC] Platform: Claude Code | Model: not recorded (session policy)
- **Dividends come off the average cost on the whole site, and each is a row of the Transaction history** (Davies:
  "分红的盈利也算起来，直接算在average cost里"; "整个网站的average cost都改，另外分红可以在Transaction history表中作为单独的行显示").
  `annotateLedger` / `realizedGain` / `netPosition` take dividend events (`{date, ts, amount}`, the net cash in the
  holding's currency): off the net cash and the classic basis, realized when nothing is held; `realizedGain` is now
  the sum of `annotateLedger`'s rows, one walk. The board's average cost goes through ONE function,
  `withDividendCosts` (t212_fills.js, `cost − Σ dividends / shares`) on `shownPortfolio`: the position cards, the
  ticker page, the holding/sectors lists' cost basis and unrealised G/L all read it; the stored `cost` stays
  dividend-free (display only, so no sync compounds it); the lot editor shows the same net figure with a line saying
  so. DIVIDEND rows: gold badge, shares paid on, net per share, cash received, Avg Cost after, Realised G/L blank
  (unless paid while none is held), sortable, exported; the phone card's type column widened to fit it.
- **Fill currency:** `lotsFromOrders` / `withClosedFromFills` use the stored currency (GBX ÷ 100 → GBP); the hand
  tables only stand in for a row without one; `fillCurrencyConflicts` reports any disagreement to the errors box
  (`t212.currency`) and `rebuildLedgerFromFills` refuses a holding kept in another currency than its fills.
- **A second fault fixed on the way:** main's headline (`realizedGain`) walked a day's buys before its sales, while
  the rows (`annotateLedger`) walk by time, so on the real book the headline and its own rows disagreed on four open
  positions (BMNR, MSTR, ORCL, RKLB). One walk now; pinned by a same-day case (old code reads 450 for 700).
- **Charts unchanged:** the vs-S&P and Investment lines read lots and sells (deposits are fills × price, value is
  shares × price), never `cost`, so dividends move neither; the cash a dividend paid is not modelled there.
- Evidence: vitest (dividend pins, a second 2,000-ledger property test: sold out = proceeds − cost + dividends, rows
  sum to the total, every sale = shares × (price − its Avg Cost); fill-currency and conflict pins; the history's
  DIVIDEND row, mask and sort), 22 of them fail on the old client; the sweep reads ACME's dividend row on desktop and
  phone (layout: no overlap) and its ticker page AC $198.00 net of the dividend (482 checks). Real book checked in
  the scratchpad only: every sold-out ticker realizes proceeds − cost + dividends to the cent. The board's AC still
  takes T212's `averagePricePaid` where a ledger does not reconcile, less the same dividends.

### [2026-10-07 23:43 UTC] Platform: Claude Code | Model: not recorded (session policy)
- Driven twice through pg_net with the cron bearer (requests 296906, 296932): both dividend walks complete (ISA 51,
  invest 44 rows; types DIVIDEND and RETURN_OF_CAPITAL), every non-matching one converted at the day's close (51 ISA
  GBP→USD, 1 invest USD→GBP), none left unconverted. The fill-currency backfill filled 59 of 69 tickers and missed
  ten: PostgREST caps a read at 1,000 rows whatever `limit` says, so the scan of null rows saw one page, and the
  six-hour stamp then held the retry. Fixed: the scan pages to the end, the throttle is 15 minutes (the metadata
  endpoint allows one call in 50 s), and the dividends read pages the same way.

### [2026-10-07 23:35 UTC] Platform: Claude Code | Model: not recorded (session policy)
- `trading212` stores each fill's currency and walks the dividends. `shapeT212Order` keeps `order.instrument.currency`
  (GBX as GBX; a fill that states none is upserted without the key, so it never erases one). `backfillOrderCurrencies`
  fills the rows without one from `/equity/metadata/instruments` (`currencyCode`), at most once in six hours, only
  rows still null. `syncDividendsOnce` walks `/history/dividends` a page per account per `orders-sync` (cursor in
  `t212_dividends_sync`, page one again once complete), storing the NET amount in the account's currency, the gross
  per share, the instrument's currency and `amount_holding`: the net in the holding's currency (GBX → GBP), the
  amount itself when the account pays in it, else `fillDividendFx` converts it at Yahoo's daily close of the
  account→holding pair on the day paid, recording the rate and its source. `?action=dividends` serves them.
  `orders-sync` now also answers the cron bearer (as the admin it stands in for), so the walk and both backfills can
  be driven through pg_net; no schedule is added, so nothing joins `edge_calls`. Pinned: 9 new Deno tests
  (currency on the shaper, the upsert split, the dividend shaper on the probe's shape with synthetic numbers, the day's
  close, the metadata map, the bearer check). Next: drive the walk, verify, then the client.
### [2026-10-07 23:12 UTC] Platform: Claude Code | Model: not recorded (session policy)
- TB1 built and frozen on Davies' word ("TB1"紧盘口"：两个版本…前端的3和4改为这两个新的测试，做好就立即上线，页面数据清空从新开始"):
  `reviews/2026-10-07-polymarket-rw-tb1-prereg.md` (frozen by this commit; its addendum to RW-NEXT Part 2 and the
  deviation of RW-X's "bookkeeping only" are in it), `agents/pmrw_x.ts` (`RwxTight`, `isTight`, `backTicks`,
  `tightBack`, `fresh` arms; `tb1-skip`, `tb1-back` in `RWX_SPECS`, so in RW-C's replay too), `0096` (arm checks),
  `pmrw_view.ts` (variant-3/-4 are TB1's, x4/x5 in `RWX_OFF_PAGE`; TB1's page quotes on a 1-tick minute), the page's
  latest minute now reads `bb`/`ba`. Every arm's day row gains `detail.rewardByMarket`. No client code changed (no
  bundle): the rows come from the dashboard payload.
- Evidence: hand-worked world pins (skip and back fills/rewards by hand, a late start keeps `start`, the page's
  quotes); mutations of the skip, back and late-start code each fail 2 tests. On RW's whole record (09-25 → 10-07
  21:49) the replay before (`dd2e979e`) and after gave the seven older arms identical states and day rows (less the new
  key), in 26 catch-ups and 6,197 three-minute runs. In-sample, TB1 active from 10-03 against x1's rules started flat
  there, at R = 0.40: skip +$29.34, back +$17.01 (five days). CPU: a minute's run median 2 ms before and after.
- x4/x5 keep recording in both replays; their frozen Test 1 (≥ 10-09 00:05) and Test 2 are untouched.
- Read-only research, nothing to the page: intraday re-selection every 2 h backtested on the pm-rec archive (what-remains,
  item 2); not supported as specified with close-only exits. Archive downloads deleted after.

### [2026-10-07 23:02 UTC] Platform: Claude Code | Model: not recorded (session policy)
- The probe (request 295815, 22:49 UTC) read: both keys answer `/history/dividends` (200; items `amount`, `currency`,
  `quantity`, `paidOn`, `reference`, `grossAmountPerShare`, `instrument{currency}`, `amountInEuro`, `type`; `amount` is
  the net in the ACCOUNT's currency, the ISA's GBP and invest's USD, the gross per share in the instrument's), the
  instrument metadata (200, `currencyCode`: JEQPl_EQ GBX, CSPX_EQ / QQQ3l_EQ / VUAAl_EQ / SAEMl_EQ USD, ROLGl_EQ /
  SEGMl_EQ / VUAGl_EQ GBP, 2DGd_EQ / XFABp_EQ EUR, every US line USD), and every nested fill's
  `order.instrument.currency`. `/equity/account/summary` is 403 on both keys (no account-data scope); nothing needs it.
- `0095_t212_fill_currency_dividends.sql` lands alone, before any code reads it: `t212_orders.currency` (null until the
  function fills it), `t212_orders_sync.currency_backfill_at`, and `t212_dividends` / `t212_dividends_sync` (RLS on, no
  grant, no policy). No recurring Edge call: the dividends walk will ride on `orders-sync`. Next: the function and the
  client that use them.

### [2026-10-07 22:47 UTC] Platform: Claude Code | Model: not recorded (session policy)
- `trading212?action=probe` (read-only, the Vault `cron_secret` through pg_net, or an admin token): per account, the
  account summary's currency, the orders page's currency fields per instrument (`probeOrderCurrencies`, which carries
  no price, quantity or amount), the dividends page's status, keys and first items, and the instrument metadata's
  `currencyCode` for the codes asked about. Why: the durable fill currency and the dividends (Davies: "这两件都做")
  need to know what the stored keys can read before anything depends on it; a 403 names the scope the key lacks.
  Pinned by one Deno test. Next: fire it once deployed and build on what it reads.

### [2026-10-07 22:43 UTC] Platform: Claude Code | Model: not recorded (session policy)
- Transaction history: a sell row's Avg Cost is now the classic average cost the sale was measured against, so
  Realised G/L = shares x (price - Avg Cost) on every sell row; a closing sale no longer reads blank (Davies,
  2026-10-07: sell rows had none; he chose this reading over the net-cash average before the sale). Buy rows keep
  the net-cash average. Pinned: hand-worked rows, and the 2,000-ledger property test now checks every sell row.
- main was force-pushed once, on Davies' word in the conversation ("这两件都做"), to drop a Claude co-author trailer
  that a commit carried against this repo's rule; content unchanged. Old -> new: fcc6b370 -> b107f2c0 (realized
  G/L), f325babf -> dd2e979e (24H; its ledger line now names b107f2c0). A clone holding the old hashes resets to
  origin/main.
- The panel's shortest range button reads 1D with extended hours off and 24H with them on (Davies: "24H改为1D吧，
  extended hours的那个实际就是24小时不用改"); internal key `1D`, buttons carry `data-range`, and the sweep and perf
  matrix click by it and check both labels.
- Queued, both with sub-agents: Trading 212 fill currency stored per fill (and dividends folded into the
  average cost, Davies: "分红的盈利也算起来，直接算在average cost里"); TB1 tight-book arms replacing the page's
  Reward quotes variant-3/-4 (x4/x5 keep recording behind), prereg to freeze before 10-09 00:00 UTC.

### [2026-10-07 22:25 UTC] Platform: Claude Code | Model: not recorded (session policy)
- 24H with extended hours off now draws the latest regular session measured from its previous close, on both
  tabs, on Davies' word (2026-10-07, "之前那个确认无误，可以开工"): the book from the scoreboard's own previous-close
  value (`previousCloseValue`), the S&P from the Market Conditions card's anchor with its last point at the card's
  price (`quoteDayMove`, which the card now calls too), so its ends ARE the DAY CHANGE % and the card. Ext on and
  1W+ unchanged. The ext-off rows keep the five-day fetch (`perfRowFilter`, keyed on range + switch: keying on the
  fetch variant made ext-on in-session five days, caught by the new matrix); the seed keeps 24 h. The skill's
  settled rule ("no previous-close basis on 24H") is reversed with its reason, in all three copies.
- Evidence: perf-matrix SESSIONS (16 cases: pre-market / in session / after close / weekend x ext off/on x both
  tabs, hand-worked; ext off ends = DAY CHANGE and = the card); the 60-case 24H expectations reworked by hand; the
  old bundle fails 74 (all ext-off, none ext-on). The matrix fixture's CASH sat in ST and GK (counted twice);
  fixed. The 14-17 UTC refusal is gone. CLAUDE.md's verify:perf bullet updated. gates --full green (sub-agent),
  rebased onto b107f2c0 with the bundle rebuilt.
- Open: ext-on 24H before the open reads vs-S&P +3.57 % against INVESTMENT +3.70 % in the matrix fixture
  (pre-existing; the basis is the last bar before the futures' UTC day, not the first point); the sweep fixture's
  CN fund intraday bars (100) disagree with its quote (1.5).
- Reward quotes study (read-only, not blind; Test 1 of RW-X4/X5 still runs as frozen on/after 10-09 00:05):
  variant-3 (x4) ≈ x1 (−$7.32 total, the 0.9 keep almost never binds at a 1¢ tick); variant-4 (x5) worse
  (−$68.83, P(>0) 0.00); neither should change live-prep or mid-pool. New: fills when the raw spread is ≤ 1 tick
  are the adverse ones; "skip ≤ 1 tick" on S2's sim reads +$46.7 at R = 0.40 (P 0.95, in-sample). Proposed paper
  arm TB1 (skip / one tick back on ≤ 1-tick books) on RW-C, prereg to freeze before 10-09 00:00, awaiting Davies.
  Scripts in the session scratchpad (`rwx107/`), not committed.

### [2026-10-07 21:54 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The paper layers' DAYS table gets a WORST CASE on every day, today's live** (Davies: "Reward quotes列表里后三个点开之后
DAYS里worst case里没数据"; then "WORST CASE目前是当天实时都可以显示吧？…之前的问题只是mini-pool、mid-pool、live-prep 展开后
WORST CASE 列为空"). Built by an opus-high agent, reviewed and landed here. `0094_pm_prep_stress_days.sql` (RLS on, no
grant, no policy, no data) and `agents/pm_prep_stress.ts`, called by the three layer actions after their turn; no
frozen file is touched (`pm_lp.ts` still `bfe38d1c…`). One row per layer per day holds the worst case at 00:00 UTC:
the layer's own state when it rests after deciding 23:59 (`recorded`), 0 for its first day (`start`), and a missed or
earlier day replayed from the day before (`replay`: minute rewards, fills through `applyFill` at the minute's tick,
the last full book, settlements before 00:00 plus 2 minutes), two days per layer per turn. The view gives each closed
day next start minus its own and today live as running minus today's start; a day without both is "—"; RW's rows are
unchanged. Faults go to `agents.pm_prep_stress`, never the layers' pre-registered kinds. Read-only check before
landing: the replay over every record reproduced all three layers' stored accounts (52 / 48 / 39 markets, to 2e-13);
expected starts — mini 10-02 0.1223 … 10-07 1.8090; mid 10-03 9.6822 … 10-07 11.5376; lp 10-05 32.1193, 10-06
40.5436, 10-07 35.0225. Pins: `pm_prep_stress.test.ts` (9, the real layer over RW's golden record across midnight,
minute by minute and in catch-ups, and live-prep's path and layer across midnight), `pm_prep_view.test.ts`, vitest,
and the sweep reading today's and a closed day's worst case on all three pages; the old server output reads "—"
(3 sweep checks fail). It changes nothing any path or layer decides or writes, so it is no deviation of mid-pool's or
live-prep's tests (their checks read neither the new table nor the new error kind).

### [2026-10-07 21:47 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Mini-pool's and mid-pool's day stop counts only the day's change** (Davies, answering a question: "只算当天变化"), on
the order path and both paper layers: the book's value now less its value at 00:00 UTC (each holding at its mark then,
or its cost if bought that day) plus the day's sells and settlements (`sinceOpenPnl` in `pm_live.ts`, `paperDayPnl` in
`pm_prep.ts`; the path keeps `dayOpen`/`marks`/`marksAt` in its state, the layer `state.open`). The −$75 total is
unchanged and still counts the carried loss. Why: mid-pool's paper stopped at 00:00 on 10-05 (−26.84), 10-06 (−48.52)
and 10-07 (−42.41) on carried inventory alone, and a live path would have stopped buying every day the same way.
Built by an opus-high agent, reviewed and landed here. Live-prep has no day stop and is unchanged (`pm_lp.test.ts`,
turn for turn). The deploy's own day counts as before; the first 00:00 UTC after it is the first day counted so.
`pm_live.ts` 23112a4f…e5a9 → 4032d6c0…6706, `pm_prep.ts` 78c804ee…8db6 → a13ef03c…696a; mini-pool's Addendum 8,
mid-pool's Addendum 4 (deviation 4: its 10-17 readout names 10-05..10-07 as stopped and the deploy time), live-prep's
Addendum 1. The frozen copies are unchanged; their comparisons run today's code on the old rule through a test-only
`dayStopOnCost` that no deployed instance sets (pinned), and a test beside each shows the day stop the one difference.
`pm_daystop.test.ts` pins the hand-worked cases (a carried −$40 does not trip a $25 day stop at 00:01; a fresh −$26
does; the total trips past −$75) and fails on the old rule. The payouts-per-path patch is rebuilt on it (after it:
`pm_live.ts` 57f4b1d7…1e40). **Watch:** mid-pool's paper total read −$60.32 at 21:17 UTC, $14.68 from its −$75 total
stop, so once it quotes again it may stop for good within days.

### [2026-10-07 21:37 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5's dead-man holds on an unreadable state while a read in the last 3 minutes found the executor fresh** (Davies:
"读不到时看上次"). On 10-07 it fired 48 times, 45 on "state could not be read (Signal timed out.)", each cancelling every
resting order (governor 900 at 18:25, 950 by 20:36). Built by an opus-high agent, reviewed and landed here: `monitor/
deadman.ts` (`DEADMAN_GRACE_MS` 180 s, `graceOf`) holds a failed read when the last fresh read is at most 3 minutes old
and no more than 5 s ahead of the function's clock: nothing at the venue, the key not even loaded, one `ops_errors` row
(`monitor.deadman`, verdict `held`, the last fresh read and its age), no events row. A stale state that was read, a
missing row and an unparseable time still cancel at once; an outage still ends in a cancel at the first minute past 3
minutes from the last fresh read (at worst ~6 minutes after the executor's last turn, since a fresh read can see a turn
up to 3 minutes old — the stricter variant, holding only while the last known turn is under 3 minutes old, is not
built); the twins' stale rule is unchanged. The last fresh read lives in the monitor Worker, a SQLite-backed Durable
Object `DeadmanMemory` (binding `DEADMAN_MEMORY`, wrangler migration v1), not the database (which a stall makes
unreadable) nor KV (1,440 writes a day against 1,000); the Worker sends it with each call and stores the `at` of each
fresh answer; an unreachable or unbound memory sends nothing and the old rule applies, so an old Worker or an old
function is safe in either deploy order. Replayed on 10-07's function log: 49 of 50 unreadable answers would have held
(last fresh read 66–137 s before); in 9 the next readable answer was stale, so those cancels would have come 1–2
minutes later. Pins: 7 new Deno tests (10-07's shapes, a long outage held, held, held, cancel), 5 new Worker tests; the
old `deadman.ts` fails the 2-minute hold and the long outage. `docs/agents/CLAUDE.md` and item 4 state the rule.

### [2026-10-07 21:30 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The desktop foot's shortcuts say what each mode's keys do.** Davies: "网站右下角"Shortcuts R (refresh) · E (edit) · X (ext)"，
在viewer模式中不该有E (edit)，然后把X (ext)改为X (extended)". The page's key handler already ignores E for a read-only
viewer (`app.jsx`); only the hint was wrong. `shortcutsHint` (`board/header_sidebar.jsx`) gives the owner "R (refresh)
· E (edit) · X (extended)" and a viewer "R (refresh) · X (extended)". Pinned: vitest renders the foot both ways (two
cases that fail on the old foot) and the sweep's viewer part reads it on desktop. Also queued, on Davies' word the same
evening: with extended hours off, the 24H VS S&P and INVESTMENT charts are to start from the previous close, not 0 %,
and match the scoreboard's live change during the session; it waits for a free sub-agent (three opus-high agents are
running: the paper layers' live worst case, the day stop on today's change, the dead-man's grace).

### [2026-10-07 21:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Three sub-agents by tier: `opus-high`, `sonnet-max`, `haiku-max`** (Davies: "以后sub-agent最高effort改为opus-high
（重要性和难度要求最高的任务）（现在在跑的这个effort也改为high），重要性和难度次一级的用sonnet5.5 max，最低级的任务可以用haiku5.5 max").
`.claude/agents/opus-max.md` is `opus-high.md` (Opus, high), `sonnet-max` runs at max again, and `haiku-max` is new
(Haiku 4.5, the newest Haiku there is: no Haiku 5.5 exists; max). `.claude/CLAUDE.md`, the working-with-davies skill
and its two Cursor copies say so. **Found doing it:** the session reads agent definitions from its primary checkout,
`/home/user/daviesportfolios`, which sat 21 commits behind at `dc97fe55`, so every agent since 10-04 ran at max while
`main` said high; that checkout is fast-forwarded to `origin/main` with this push. The three agents running at max
(the paper layers' worst case, the day stop on today's change, the dead-man's grace) are stopped and relaunched as
`opus-high`, each continuing from its own worktree. Davies chose both rule changes the same evening: the day stop
of mini-pool and mid-pool (path and paper) counts only the change since 00:00 UTC, as a recorded deviation; the
dead-man treats an unreadable state as stale only when no read in the last 3 minutes found the executor fresh.

### [2026-10-07 20:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The database stalled again from 10-07 02:55 UTC, on the same table as 10-02; `0093` empties it every ten minutes.**
Davies: "检查下每个策略的最新情况，有问题及时修复". Two opus-max health checks, read-only. The cause: `net._http_response`,
297 MB for ~6.4k live rows, its last autovacuum 10-02 14:12; pg_net's worker spent 40–180 s at a time in its own
six-hour delete reading that heap (pg_stat_statements: max 179 s), 2,237–2,652 s of every hour in 03:00–06:59 and
15:00–20:00 (quiet 07:00–14:59, cause not established). The one-minute job (cron 27) logged 27 "job startup timeout"
rows (03:32 → 20:03) and ran 36–41 times an hour at 30 s late; PostgREST reads timed out ("Signal timed out."; ops_errors
26–94 an hour). **PR5 live:** its dead-man fired 48 times, 45 of them a read that timed out while the executor was alive
(`monitor/deadman.ts:36–37`, `:77–78`, `:236`); every firing cancelled every resting order, the guard's on/off flips and
the re-posts took the governor to 900 at 18:25:41 (no entries since) and 950 by 20:36 (stops only) until 00:00 UTC;
the one fill in it (a USDC exit at 19:35) is booked, nothing pending, no venue rejection, no loss stop. The twins, PR5's
paper engine, the crypto rows, Jev and the workflows were OK (the trend rows decided every bar). `0093` schedules
`http-response-truncate` every ten minutes: a TRUNCATE that waits at most 30 s for the table's lock and otherwise waits
for the next run (pinned in `cron_jobs.test.js`). Nothing reads the table. **TAKE (variant-2, take50), for its entry:**
quoting again since the FX reopening (dark guard cleared and first entry 2026-10-04 23:02 UTC); its take leg acted 3
times, all filled (10-05 02:51 and 02:59 bids, 10-06 11:16 ask) and all closed by their exits; no `last_error`. Left for
Davies (item 9): the instance size or incremental reads, and the dead-man's rule on an unreadable state. The
trend-4h-live cap check at 10-08 06:20 will find CW-8 not clean (job 27's failures) and keep $60, as its rule says.
**Verified after the push (20:47 UTC, migrations green):** the first run, 20:50:00, succeeded; `net._http_response` fell
from 297 MB to 200 kB and the database from 1,298 MB to 1,003 MB; from 20:50 every minute's calls beat on time (22–26
a minute, 2 s into it on average, against 30–35 s late and a third missing before). RW's daily health line (the 546/5xx
read) now sees ten minutes of responses at most: read the Edge logs instead. **Also found** (a second opus-max check):
live-prep's P1, run at 20:22 (item 2); RW lost about 175 of 10-07's minutes to the stall (an infrastructure deviation
to name beside its verdict, with 10-08's if any); mid-pool's paper layer has tripped its day stop at 00:00 on 10-05,
10-06 and 10-07 (−26.84, −48.52, −42.41 against −25), because `bookPnl` counts every holding's whole unrealised P&L
as the day's (`pm_live.ts:743–753`, by design: "stricter") and its dry-run caps never bind the paper's $330–360 of
inventory (it decides on the account's fills, which are none: `pm_live.ts:1352–1360`); put to Davies. And the last
three Reward quotes rows show no WORST CASE: the paper layers keep no worst case at a day's close (an opus-max agent
is building its record outside the frozen files).

### [2026-10-05 06:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**MX-1's first weekly pull** (item 5a.2; the Monday Routine `trig_01Dm3nw4TbBm2GCX2z12tN7o`, 06:37 UTC). A sonnet-max
agent ran `weekly.sql` read-only and `pull_tape.py` unchanged; I checked its files by counts and hashes, printing no
price. A, serialised to one JSON text in SQL with its md5 and written byte for byte (md5 equal), is
`backtests/mx1/tape/2026-10-05.windows.json`: six probes since the freeze (ids 22–27), all the `trend-1h` row, four
BTC/USD and two ETH/USD. The pull, `tape/2026-10-05.json.gz`, has six windows, none failed and none merged, 179 UK
prints (BTC 121, ETH 58; 19 to 39 a window), its `script_sha256` and `source_sha256` equal to the script's and the
windows file's. B is empty (`basis/2026-10-05.json`, `[]`): every probe's `o15` and `o60` is recorded, so no stand-in
is needed yet. C: 3 exits and 3 entries. At this week's pace, three exits a week, 150 would take about fifty weeks, so
2027-06-30 comes first and the reading falls on the first pull after it, as item 5a.2 expects. `docs/map.md` gains MX-1's data folder.

### [2026-10-04 19:10 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Polymarket's rewarded markets are recorded for research** (Davies: "把polymarket的所有有reward的市场详细价格与order book
等一切重要的信息也全和之前revolut stablecoins市场一样详细记录下来吧？…你觉得是个好主意的话就加上也加到watchdog上"). Built by an
opus-max agent on `aee17037`: `agents/pm_book_rec.ts` with `agents?action=pmrec` every minute (the books within 10 ¢ of
every market paying $10 a day or more and of every market a Reward quotes path holds or quotes, a fifteenth of all
~18,900 rewarded markets summarised each minute so each is read every 15, and the set's prints from the global tape) and
`agents?action=pmrec-meta` every five (the listing every 15 minutes, Gamma metadata 250 markets a run, each closed hour
archived to the private Storage bucket `pm-rec` and indexed with a signed URL in `pm_rec_archive`, a daily dump of the
markets). `0092_pm_book_recorder.sql`: four tables, RLS on and no grant or policy, two leases, two `edge_calls` rows
with retry on (the watchdog), and the hourly SQL-only `pm-rec-prune` (unarchived data dropped after 6 h and marked
lost, frame rows after 7 days). Reference item 55; the evidence in `backtests/pmrec/`. Measured keylessly: a minute
1.8–2.5 s and 318–375 ms of the function's own CPU; ~320 MB a day to Storage (~9.7 GB a month, inside the Pro plan's
100 GB for about ten months, then $0.021 a GB-month); ~50 MB of the database, ~115 MB at most if the archive stops. Not
in `monitor/health.ts`: the Worker's `loop` is one alert state, and a stale recorder would mask a dead trading tick; its
faults go to `ops_errors` as `agents.pm_rec`. Reviewed before landing: the migration, the private bucket, the prune.
Pause it with `update public.edge_calls set enabled = false where path in ('agents?action=pmrec','agents?action=pmrec-meta')`.
Signed URLs are never committed. Davies sets the archive's horizon. **Verified in production** (read-only, a sonnet-max
check at 20:20 UTC): `0092` applied, both calls running since 19:10 with no `last_error` and no `ops_errors`; a books
frame every minute 19:11–20:20 (70 of 70, ~2,850 books each, no failed read); the 19:00 hour archived at 20:05 to the
private bucket `pm-rec` (books 8.7 MB, universe 2.0 MB, prints 78 KB, plus the day's markets dump 2.6 MB), each
object's size equal to its `pm_rec_archive` row, the frames' data then cleared and none lost; `pm-rec-prune` ran at
19:41; the recorder's tables 26.6 MB, the database 672 MB.

**The repository is public.** `gh api repos/daviesluo/daviesportfolios` reads `private: false` (checked 19:05 UTC),
while this file, `docs/handover.md` and `.claude/CLAUDE.md` were written for a private one and quote real balances.
Told Davies; whether it stays public, or which files leave it, is his call. Nothing was changed.

### [2026-10-04 18:15 UTC] Platform: Claude Code | Model: not recorded (session policy)

**A Reward quotes row's "N open" is its QUOTES table's rows.** Davies: "STRATEGIES表格中Reward quotes的那些行中xx open应该显示的是
quotes里面的行数吧？但我看好像目前显示的都是fills里的行数". It counted the markets holding inventory (`open`), so live-prep's
first evening, ten markets quoted and nothing held, read "0 open", which before a fill matches the FILLS table. Now
`rwQuoteRows` counts the page's QUOTES rows (today's markets and those held from an earlier day) on RW's row, RW-E's,
the variants', RW-C's and the three paper layers'. Display only: no rule or record reads it. Pinned: vitest (ten markets
and none held read 10; a held earlier market counts; every Reward row says the same), four cases that fail on the old
code; the sweep's row texts move to the fixtures' QUOTES rows (RW 4, RW-E, its variants and RW-C 3, live-prep 2), and
RW's page check already reads 4 rows. The guide says what the number is. Also asked: live-prep's Quote column read
something else in its first minutes and is right now (Davies, "quote列现在显示正常了"): the paper layer decides two minutes
behind the path, so until its first minute there is no bid or ask to show. Production read-only: its last minute had
all ten markets matched, with both sides resting.

### [2026-10-04 17:50 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Reward quotes live-prep (S2) lands in dry-run, unarmed, as the last row of TESTING** (Davies: "验证没问题就直接落地
TESTING STRATEGIES列表"). Phase B, built by the opus-max agent in `lp-phase-b` and rebased onto `4d87d416`: the build
(`agents/pm_lp.ts`, options in `pm_live.ts` / `pm_prep.ts` that only live-prep sets, `0091_pm_lp.sql`, the page, the
fixture and sweep checks), the pre-registration with `lp_check.sql` / `lp_readout.sql` pinned by hash and Phase A's
evidence in `backtests/pmlp/`, mid-pool's Addendum 3 (this deploy is its deviation 3), the payouts-per-path patch
rebuilt on this code (still pending) and the docs. Reviewed before landing: `0091` creates 16 tables, every one with
RLS and no grant, the config dry-run and unarmed (10 markets, $200, caps $320 / $100, stop $75, no day stop), the
attestation copied from mini-pool's config; the one-account trigger function now refuses arming any of the three
configs while another is armed. Mini-pool and mid-pool are unchanged: `pm_instance.test.ts` and
`pm_mid_formula.test.ts` pass unedited. The agent's evidence: Deno 1,006 and vitest 1,195 pass; 18 code mutations
each fail a test; on PGlite over all migrations the go-time statement refuses its 13 cases, arms at the caps the
balance allows and then changes only `pm_lp_config`; a simulated day of `lp_check.sql` passed every row but (d) at
58.3 % against 60 %. What stands between it and live is item 2's live-prep sub-item (P1–P5 and a monitor reading).
**Verified in production after the push (17:52:55 UTC; migrations, edge-functions, pages-deploy and check all green):**
`0091` applied (`pm_lp_config` created 17:53:13 UTC: dry-run, unarmed, 10 / $200 / $320 / $100, so d1 = 2026-10-05
and P1's check is due at 2026-10-06 00:10 UTC); the path's first selection landed at 17:55:02 UTC, ten markets;
`pm_lp_state` region eu-west-1, keyed, dry-run, unarmed, and both states fresh at 17:57–17:58 with no `last_error`;
31 dry-run orders recorded; no `ops_errors` since the push; mini-pool and mid-pool unarmed, dry-run and moving with
no error. The 10-06 00:20 Routine (`trig_01MUaysruKoiGbxgQPK5xecu`) is rewritten to run `lp_check.sql` (P1) once,
read-only, and report every row; it arms nothing. The recorder agent is told its migration is `0092`.

### [2026-10-04 17:15 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Both sub-agents run at high effort** (Davies: "把两个子代理的effort改成high，之后开opus子代理effort都是high"):
`.claude/agents/opus-max.md` and `sonnet-max.md` now say `effort: high`. The names stay, so every Routine and
instruction that calls them still works. `.claude/CLAUDE.md`, the working-with-davies skill and its two Cursor copies
say so. Agents already running keep the effort they started with. **Two agents are running**: live-prep's Phase B,
in the worktree at `.claude/worktrees/agent-ae8f87d25420061f3`, now on branch `lp-phase-b`, which adds migration
`0091_pm_lp.sql`; and a Polymarket rewarded-market recorder (Davies, 2026-10-04: record every rewarded market's prices
and books, tiered for size, with a watchdog row). The recorder works in its own worktree. Its migration number is
settled when the second of the two lands.

### [2026-10-04 17:00 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Mini-pool's check windows are closed and live-prep is the lead live candidate** (Davies: "验证没问题就直接落地TESTING
STRATEGIES列表，把mini-pool 的检验窗口全关了，目前上线live的最大candidate是这个live-prep策略"). Mini-pool's pre-registration takes
Addendum 7: Addendum 6's window (10-05) is withdrawn and `prep_check_addendum6.sql` will never run. Mini-pool keeps its
dry-run as a comparison and is not a candidate. Reward quotes live-prep (S2) lands on the TESTING list as soon as its
Phase B build is verified, without waiting for 10-06. The opus-max agent building it in `lp-phase-b` has been told so.
Its change to shared code stays mid-pool's deviation 3. The 10-06 00:20 Routine is rewritten to match.

### [2026-10-04 16:50 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The fix is deployed and running.** `edge-functions` run 37217861082 (c6c4daa6) succeeded 16:44:08 → 16:45:35 UTC;
`agents` is version 140, updated 16:45:30. Every mini-pool and mid-pool minute recorded from 16:46 carries
`detail.after` and `mRw` (8 of 8 each at 16:46); both states and both paper layers have no `last_error`, and
`ops_errors` has nothing since 16:44. The paper layers decide two minutes behind, and their matched minutes up to 16:44
(recorded before the deploy) are paid RW's line (`paid: rw`), as the rule says. **Scheduled:** a one-shot Routine at
2026-10-06 00:20 UTC (`trig_01MUaysruKoiGbxgQPK5xecu`) runs mini-pool's Addendum 6 check, confirms variant-2's first
takes after the FX market reopened, and lands Reward quotes live-prep's Phase B if it has handed back; the 10-17
mid-pool readout's Routine now names deviations 1 and 2 (and 3 if Phase B lands inside the window). **Phase B** is
being built by the same opus-max agent in its own worktree (`lp-phase-b`), with nothing pushed before the 10-06 check:
a deploy of `pm_live.ts` or `pm_prep.ts` inside mini-pool's window would end it as FAIL. The previous section's header
said 16:55; it was written at 16:44, and both are corrected here.

### [2026-10-04 16:44 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Mini-pool fixed and ranked by book depth; its window moves to 2026-10-05 (Addendum 6); mid-pool takes the formula fix
as its deviation 2** (Davies: "把mini-pool现在就全部修复优化了，dry-run的问题如果影响mid-pool的话也都修复掉"). Addendum 2's check
failed (d) 71.1 % and (f) unfunded. Of 10-03's 3,327 minutes with no formula, 508 were the dry-run scoring its quotes
against the rest of the book's midpoint (not 153), 836 a side with no level of the minimum, 1,935 a book too wide. The
formula now scores against the book with our quotes in it, never twice live (`minuteFormula`, `detail.after`, the paper
paying it): 10-03 75.5 %, 10-02 77.0 %, 10-04 partial 71.5 %; mid-pool d1 82.2 % for 81.2 %. Mini-pool's selection ranks
first the books with two levels of the minimum within 10 ¢ a side (`PM_MINI_QUALITY`), chosen on a two-hour keyless
sample (121 reads, `backtests/pmlive/results/mini_books_out.txt`): picks' scoring minutes 72.5 → 93.6 % (1 h),
80.0 → 93.2 % (30 min), at 104 % / 89 % of the formula. Sizes, stops, gates, go-time and mid-pool's rule unchanged;
both tests not blind from 10-04. Pinned beside both frozen codes; 18 counterfactuals fail. Code `pm_live.ts`
effd6351…, `pm_prep.ts` ea3ee5b1…; check `prep_check_addendum6.sql` 6b839a0f…. The pending payouts patch is rebuilt on
the fix (pm_live.ts after it 61b1d53f…). Built in a worktree by an opus-max agent (`51cd7e45`, `0a4797d4`, the second
committed with `LEDGER_OK=1` before this line), reviewed and pushed by the coordinator; the deploy is read in the next
section. **TAKE (variant-2) from 16:00:** its rule is in force and the twin runs with no error, but every stablecoin
executor, the live account's and the twins', is dark for the weekend by design ("no GBP/USD minute in the last ten":
the FX market is shut, last order Friday 20:55 UTC), so its first take can come only after the FX market reopens on
Sunday evening. **Reward quotes live-prep (Davies' request of 2026-10-04): Phase A done** by an opus-max agent, read-only:
the spec (S2), its draft pre-registration and Phase B's plan are in the session's scratchpad (`rw_best/`) until Phase B
commits them with the build.

### [2026-10-04 15:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**COUNTS: leaving post-count and view-count markets out of Reward quotes variant-2 (x1) would not help** (Davies:
"…你研究下如果把这两类或还有类似的市场也去掉的话表现会更好吗？"). An `opus-max` sub-agent replayed RW-X's own code on RW's
minutes, reproducing every `pm_rw_x_days` row and the stored state to the cent, then x1 less each class (frozen at
14:48:36 before any arm ran): posts +$14.46 (one market; −$16.95 without it), views $0.00 (x1 never quoted one), live
counters −$268.92, finance −$33.31, general −$9.94; a 24-hour cut on count markets +$20.45, all from that one market.
x4 = x1 by design (its 0.9 keep never binds at a 1¢ tick; 0.6–0.7 would act), x5 −$8.72 since the 10-02 row. Filed in
`docs/agents/backtests/rwcounts/`; reference item 36. **Read under the 14:45 waiver:** `pm_rw_x_days`/`pm_rw_x_state`
for every arm (x4/x5 Test 1-window figures before 10-09), mini-pool's and mid-pool's paper records; nothing of RW-C.

### [2026-10-04 14:50 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Every no-peek rule is cancelled, on Davies' word** ("所有不偷看条款全部取消，所有的数据都可用来达到最佳研究效果，你也可以发消息给子代理告诉他们").
Every record may now be read for research: RW-X's x4/x5, RW-C, mid-pool, PR5V, rule D, variant-2 (TAKE), QUEUE's
levels, PR5-W and the rest. The pre-registrations are not edited: their readings run as written (scripts, bars, dates)
and each report says it was not blind from 2026-10-04. `.claude/CLAUDE.md`'s agents bullet says so; the two running
sub-agents (mini-pool's fix, the count-market study) were told. Where the what-remains list or a routine still says
"read only the health readings", that clause no longer binds.

### [2026-10-04 14:50 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Reward quotes pages name every market by its question** (Davies: "quotes表格中里有很多市场名字显示类似于“0x2764…”这样的乱码，请修复，并确保之后不会发生").
Cause: `prepSummary` (mini-pool's and mid-pool's pages) gave a market still held from an earlier day an empty question,
and the page fell back to its condition id. Every market the path chose has its question in `pm_live_markets` (26 of
26 read); RW's state names all 149 of its markets, and RW-E's and RW-X's pages read RW's names. Now the question comes
from any day the path chose the market, and the page never prints an id (`marketName`: a 0x… string or nothing reads
"Market name not recorded"). Pinned in `pm_prep_view.test.ts` (fails on the old code: held rows unnamed) and in the
sweep (no `0x…` name on an RW page).
Also fixed: `src/twin_specs.test.js` refused `0090` (TAKE's start, 13:36), whose guarded `update` of one rule date it
did not allow, so `check` was red on `afa53647` and `768f6fb8`; the guard now allows exactly that form, and lists 0090.

### [2026-10-04 14:00 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Every Reward quotes page keeps every column on a phone** (Davies: "手机端每个reward子页面中的表格每列都显示（和电脑端一样），左右滑动就行了，不要少列"):
`RwDetail`'s DAYS and QUOTES tables lose their `ag-ph` cells (Fills, WORST CASE, Pool/day, Quote, Share, Rewards,
Orders); the tables already scroll sideways in `.hl-scroll`. The sweep now expects no hidden column at either width,
the scroll container `overflow-x: auto`, and the page itself not wider than the phone. RW, RW-E, RW-X, RW-C, mini-pool
and mid-pool all use this page. TAKE's `0090` read back: `rules.take.from` 2026-10-04 16:00 UTC.

### [2026-10-04 13:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**TAKE (variant-2) starts at 2026-10-04 16:00 UTC, not 10-05 00:00** (Davies: "这个现在就开始吧 为什么要等？"; the
Monday start had no reason in the rule). Addendum 1 of `reviews/2026-10-03-take-prereg.md`, written before the new
start; `0090_take50_from_now.sql` moves only `take50`'s `rules.take.from`, guarded on the frozen value, pinned in
`src/take_twin.test.js`. Window 10-04 16:00 → 11-02 00:00; bar, seed, checks and reading date unchanged; 10-04 is a day
block of its own. **To check after 16:00:** the row reads 16:00, take50 turns without `agents.quotes_twins` errors.

### [2026-10-04 10:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The stablecoin twins' pages lose two lines** (Davies: "testing页面中的每个Stablecoin quotes子页面“3 rungs a side at £100 ·
the live code on a simulated Revolut X account…its replica differs from its engine's record in 46 events”这些信息行都删了"):
`quotesTwinLines` keeps only the "asks wait for their coin" lines; the unit test and the sweep expect no line where the
two were. Display only; nothing of the twins' engines or records changes.

### [2026-10-04 10:24 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The 10-04 health routine (`trig_014Rdj3qAgVVbh8h3eKcjb8X`): all well**, read-only, counts and timestamps only. QUEUE's
window (from 00:00): each of the four books read 619–620 times in 622 minutes, its first row at 00:00:40–43 and last
seen 10:21:40–43 (rows stored on change: USDC-GBP 351, USDT-GBP 279, USDC-USD 27, USDT-USD 19); no level read. RW
decided to 10:19, RW-E and RW-X to 10:18, none with `last_error`; RW-X's `checkMaxUsd` 0, `checkEMaxUsd` 0 over 9 days,
version 2, its arms e, rw, x1–x5; 10-02's and 10-03's day rows present for all three (dates only); no `ops_errors` of
theirs or the recorder's in 24 hours.

### [2026-10-04 01:15 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The payouts-per-path change is kept as a patch, not deployed** (Davies, told it waited for his word: "之后再部署吧
我想等v-3 v-4的结果更明显了看看能不能inform现在的mid策略之后再决定上线，具体时间我来定，代码你先都存好"). The agent's commit was
rebuilt on `8d06a995` (code, pins and map rows only; the docs already landed), its six test files run there (Deno
109 pass: `pm_live`, `pm_mid`, `pm_prep`, `pm_prep_view`, `pm_instance`, `pm_payouts`; vitest 24: `pm_mid_prereg`,
`docs_map`, `pm_prep_prereg`; `deno check` clean), and exported with `git format-patch` as
`docs/agents/pending/2026-10-04-mid-pool-payouts-per-path.patch` (sha256 `413644f8…17fa`; `git apply --check` clean on
`8d06a995`, where `pm_live.ts` is still `8ba7b915…`). `docs/agents/pending/README.md` says what it waits for and how to
land it; the draft pre-registration, reference item 53, `docs/agents/CLAUDE.md` and the map point there. This
supersedes the 01:01 section's "it lives only in this container". Nothing deploys from `docs/`. Mid-pool's go-live
waits for the RW-X arms' results (Test 1 at or after 10-09 00:05) and then his date.

### [2026-10-04 01:01 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Mid-pool readied for a funded go-live with its current strategy unchanged; the one code change waits for Davies'
word** (his, about 00:00 UTC: "准备mid-pool的上线，确保和现在的策略一致"). Built by an `opus-max` sub-agent in a worktree,
reviewed here; landed now: the draft pre-registration `reviews/2026-10-04-polymarket-mid-pool-live-prereg.md` (freezes
on his go date; the earliest funded start after the overlap audit, ≥ 2026-10-23 00:05 UTC; what an earlier date
accepts), step 8m run word for word on PGlite 16 over all 92 migrations (`backtests/pmlive/scripts/mid_live_check.mjs`,
125 checks: it refuses on twelve conditions, and armed on $401.37 changes of 137 tables only `pm_mid_config`'s
`dry_run`, `live_confirmed_at` and `updated_at`, the cap 320; without its key check, or also setting the market count,
2 checks fail each), the margin measured again keylessly (`results/mid_margin_2026-10-04_out.txt`, `…b_out.txt`,
00:13–00:47 UTC: at 0.67 one of mid-pool's picks was among RW's later picks in 4 of 111 pairs, none of 32 within two
minutes, where 10-02 had none of 91; at 0.8 none of 111; the draft keeps 0.67, the dry-run's rule, for a start after
RW-C's verdict), the design doc's "where each stands" under step 8m, reference item 53, and `docs/agents/CLAUDE.md`'s
mid-pool sentence. **Not landed: the payouts change** (`pm_live.ts`'s readout and share read: each path books only the
payouts of the markets its own minutes show it quoting live, and mid-pool reads the account's earnings only once live;
until it lands a live mid-pool's rewards would be booked in mini-pool's readout). It changes no dry-run decision
(`pm_payouts.test.ts` beside a byte copy of the frozen path; six counterfactuals fail 2–4 of 130 pins each; full gates
green: vitest 1,176, Edge 989, sweep 609), but landing it redeploys the live order path's code, and the session's
permission check stopped that as a production deploy without Davies' explicit word, so it waits for him: deployed
before 10-17 it is a deviation of mid-pool's readout, from 10-17 00:00 none. It lives only in this container, as
commit `4876f97d` on the local branch `mid-pool-live-prep` (worktree `.claude/worktrees/agent-ac18e281283212ff7`); a
new container rebuilds it from the draft's "told apart per path" section and reference item 53. Health at 00:13 and
00:54 UTC (prereg readings only): keyed, no signer problem, pUSD 0.036673, eu-west-1, no `last_error`; one
`agents.pm_mid` at 00:00:12 (the reward listing timed out; 10-04's eight markets landed); both configs dry-run and
unarmed; the attestation standing.

### [2026-10-04 00:42 UTC] Platform: Claude Code | Model: not recorded (session policy)

**EXIT: selling a Reward quotes fill at once does not pay** (Davies: "如果fill了的单可不可以直接卖出认亏来控制order的loss？
这是个好策略或者值得测试的策略吗？"). Priced by an `opus-max` sub-agent, read-only, and filed as run in
`docs/agents/backtests/rwexit/` (queries, outputs, Gamma's fee fields, `MANIFEST.json`); reference item 36 has the
summary. On RW's 2,665 paper fills (09-25 → 10-04, 126 markets), holding to 10-04 00:00 lost $568.72 (RW's own day
row to the cent); selling each at the first book after its minute, plus the taker fee, loses $581.12 at the best price
the record allows, about $1,135 centrally and $1,644.69 at the recorded book; stops (1, 2, 3 ticks, 10¢) and timers
(15, 60 minutes) lose $280–711 more than holding. The exit cuts the worst fill from −$18.60 to −$3.91 at a lower mean.
What it found that matters: RW's 3N cap stopped a side in 18.6 % of quoting minutes, earning nothing in them ($436.57 at
the formula over nine days) — x5's question, read on 10-09. No exit rule is pre-registered. **Disclosure:** to price
the groups, the study split RW's own fills by weather markets and by markets ending the same day, the kinds RW-E and x1
leave out; those are RW's figures, not the arms' (nothing of `pm_rw_e_*`, `pm_rw_x_*`, `pm_rwc_*`, `pm_mid_*` or
`pm_midprep_*` was read), and it read mini-pool's tables only after its check (00:28:57 on).

### [2026-10-04 00:22 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The two day-1 checks of 2026-10-03, run by the 00:15 routine** (`trig_014N6zxm3dqcQLMqUut3NKND`), each once,
read-only and as frozen (sha256 `8b72a9d2…65f0` and `723716c6…94c0` verified; nothing of `pm_live.ts`, `pm_prep.ts`,
`pm_mid.ts` or the pools' tables changed in the window: its two migrations, `0088` and `0089`, were the twins'). Both reports
name the read of 10-03 23:36 (the section below).

- **Mini-pool, `prep_check_addendum2.sql` (00:17 UTC):** a1 1,440 turns PASS; a2 0 fault minutes PASS; a3 decided to
  00:15, one day row PASS; b1 8 markets in one run at 00:00:01 PASS; b2 none outside the rules PASS; b3 8 markets,
  $148.60 of $160 PASS; c1 0 of 3,384 orders crossing PASS; c2 0 under size PASS; c3 $19.80 a market, $152.40 in all
  PASS; **d 8,193 of 11,520 market-minutes scored (71.1 %, bar 75 %) FAIL**; e +$2.0011 at R = 0.40 (fills −$4.5845,
  formula $16.4640, matched 10,683; no stop) PASS; g 0 of 11,520 diverged PASS; **f FAIL**: region eu-west-1, every
  gate true, keyed, but pUSD 0.036673 (the account is not funded).
- **Why (d) failed: the pools, not the code.** Of the 3,327 minutes without a formula reward, 844 had fewer than two
  quotes resting (the first minute, a book with no mid), and 2,330 would score nothing even with our own orders in the
  book: the book wider than twice the reward's spread (2,387 zero minutes in all) or its mid under 0.10 (881). Three
  markets of eight carry it: one scored 19.5 % of its minutes (its best bid flickering between 0.03 and 0.27 under a
  0.39 ask, a 6.5¢ band), two 52 % and 67 % (mids near 0.08–0.09). 153 minutes are the dry-run's own blind spot (the
  formula reads the book without our orders; live, ours would set the touch and score); counted as scored, (d) is still
  72.4 %. No fix is made: a tighter selection (a book within the band, a mid inside [0.10, 0.90]) is a rule change and
  Davies' call, by a new addendum and window. No go-live on a FAIL.
- **Mid-pool, `mid_check.sql` (00:18 UTC):** w PASS; a1 1,440 PASS; a2 0 PASS; a3 to 00:16, one day row PASS; b1 8
  markets in one run at 00:00:01 PASS; b2 none outside, exclusion RW / 0.67 / 32 excluded PASS; b3 $151.78 PASS; c1 0 of
  3,407 PASS; c2 0 PASS; c3 $19.86 / $155.12 PASS; d 9,352 of 11,520 (81.2 %) PASS; e +$15.0098 (fills −$2.4907, formula
  $43.7512, matched 11,455; no stop) PASS; g 0 PASS; f N/A (dry_run true, live_confirmed_at null). Its readout runs as
  frozen at or after 2026-10-17 00:10 UTC.

**Davies' next words (about 00:00 UTC):** "准备mid-pool的上线，确保和现在的策略一致" — an `opus-max` sub-agent in a
worktree is readying it, on a branch it does not push: the live path against the dry-run (step 8m on PGlite), payouts
told apart per path, the exclusion margin measured again, a draft pre-registration for a funded mid-pool (which, by the
dry-run's own pre-registration, waits for the overlap audit, no earlier than 10-23 00:05, unless Davies takes the risk
to RW-C), and a readiness list. He also asked whether variant-3 and variant-4 (x4, x5) beat variant-2 (x1): that is
their Test 1, read at or after 10-09 00:05, so nothing of theirs was read and he was told so. And whether selling a
filled order at once would cap the fills' losses: a second `opus-max` sub-agent is pricing it, read-only, on RW's paper
fills and mini-pool's (read only after its check), against holding at 15 and 60 minutes, 4 hours, the day's end and
settlement, with two milder rules (a stop after k ticks, a time stop).

### [2026-10-03 23:39 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Mini-pool against mid-pool, read before their checks on Davies' word** (asked which to take live on the
strategies' own results; told the read breaks both no-peek rules and costs mid-pool a blind readout, he answered
"授权你现在读"). Read at 23:36–23:38 UTC, read-only, and nothing else: every row of `pm_prep_days` and
`pm_midprep_days`; both states' `day`, `pnl`, `dayOf`, `stopDay` and `stopTotal`; each pool's 10-02 and 10-03
selection as a count, the sum, least and most of its rates and its capital; the share of each pool's reward its best
market and its best three hold. Paper figures (formula rewards; R unmeasured), dollars:

- **10-03 to 23:34 UTC**, both at eight markets and about $150 of first quotes: pools of $62 a day (mini, $6–9 each)
  and $180 (mid, $11–40); formula reward 16.38 against 42.72 (about 27 % and 24 % of the pools); fills 14 against 34,
  the fills' P&L on the day −2.48 against −2.17; at R = 0.40 +4.07 against +14.92; dark market-minutes 812 against 65;
  none diverged, no stop.
- **10-02** (mid-pool from 05:01): formula 14.75 against 25.19, fills' P&L −1.92 against +3.55, at R = 0.40 +3.98
  against +13.63.
- **Since each began:** formula 31.37 against 67.92, the fills marked −4.40 against +1.38, at R = 0.40 +8.15 against
  +28.55; mini-pool breaks even at R ≈ 0.14, mid-pool's fills are in profit. Neither rests on one market: the best
  holds 13 % and 15 % of the reward, the best three 34 % and 40 %.

On these two days mid-pool earns about 2.6 times as much for the same capital and pays no more on its fills. What
they cannot show: R (only live orders can), and how others answer real orders in larger pools. Mid-pool's
pre-registration also makes a funded mid-pool wait for its own pre-registration, with its margin measured again from
the overlap audit (no earlier than 10-23 00:05) and a new measurement, so its real orders stay out of the books RW
(to 10-09) and RW-C (10-09 → 10-23) read. Both checks at 00:15 run as frozen; mini-pool's check report, mid-pool's
day-1 report and its readout each name this read (mid-pool's deviation 1).

### [2026-10-03 22:40 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Reward quotes: a variant's first day is counted from its first minute, so its today row can no longer show a
negative reward** (Davies: "为什么reward的测试v-3和v-4今天的reward是负数"). Found from the code, with no figure of x4
or x5 read (their no-peek runs to 10-09 00:05). RW-X's arms x4 and x5 start at 2026-10-02 20:00 UTC, inside a UTC day.
`rwDayRows` (`agents/pmrw_view.ts`) measured a variant's first closed day against the day before, so the arms' 10-02
row held their parent's twenty hours as well as their own four, while the arms' totals (`rwSummary`: now less
`since.base`) hold the four alone; the page's today row (`rwTodayRow`: the total less the closed days) then went below
zero on a reward, which only grows. The arms' totals, and TODAY on the row and in TESTING's scoreboard (`todayUsd`,
against yesterday's close), were right throughout. The first own day is now measured from the arm's figures at its
first minute (`was`). Pin in `pmrw_view.test.ts` (an arm from 20:00: its first day 0.6 − 0.5 = 0.1, today
0.25 − 0.1 = 0.15, as `todayUsd`); on the old code it fails (the first day 0.3) and the other 62 tests of RW, RW-E,
RW-X, RW-C and their pages pass, as all 63 do on the new. A view change only: the engines and their tables are
untouched, and Test 1's reading takes `pm_rw_x_days` directly. RW-E (from a day boundary) and RW-C (from its run's
start) read as before; mini-pool's and mid-pool's pages do not use this function, and `pm_live.ts` (`8ba7b915…`) and
`pm_prep.ts` (`8d7861ab…`) are unchanged. `agents` redeploys (Davies: "你东西该部署就部署").

### [2026-10-03 05:03 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Variant-2 caught up, and K1 holds so far** (the TAKE prereg's check, the one read it allows before its reading). At
05:03 UTC take50 and p50 both turned forward, 13,675 turns each, last at 05:02:25, no error and no `ops_errors` since
04:38. Their orders before 2026-10-05 compared on minute, book, rung, leg, side, price, size, state, fill, average price
and fee: 3,360 each, none in one and not the other, no take; their simulated balances and event counts are equal. Only
those counts were read, no figure of either twin's P&L. From here both turn in the same call at the same instant, so
they stay equal by construction until `take.from`; the reading's script checks K1 again over the whole span.

### [2026-10-03 04:41 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Variant-2 (TAKE, `take50`) is in production** (`43369d36`, item 4). Reviewed before the push: the take path runs only
for an instance with `take`, from `take.from` (the live account's has none and still equals `quotes_live_frozen.ts`);
a take's IOC fills against the recorder's read after the turn; take50's backfill equals p50's but for its id (K1
before 10-05). Full gates green on the merged tree (sweep 603 checks single-process: 228 + 76 + 236 + 69). Runs on
`43369d36`: migrations (04:36:18), edge-functions (04:37:27) and check succeeded; no bundled source changed, so no
pages deploy. Read at 04:41 UTC: `0089` applied; the rows in order pr5, p50 (variant-1), take50 (variant-2,
`rules.take.from` 2026-10-05 00:00 UTC), d (variant-3); take50's six tables closed to `anon` and `authenticated`; two
`agents.quotes_twins` errors at 04:36:40 and 04:37:39, the deployed code refusing the new row's rule in the 70 s
between the migration and the deploy, none after; take50's backfill loaded (3,360 orders, as p50's) and catching up
about 24 minutes of record a call; pr5, p50, d and the live executor turning without error. **To do:** once take50
turns forward, check K1 (its tables equal p50's to the penny before 10-05) and record it. Variant-2's and variant-3's
results stay unread. CLAUDE.md says 603 checks.

### [2026-10-03 04:28 UTC] Platform: Claude Code | Model: not recorded (session policy)

**"Stablecoin quotes variant-2" built by TAKE's frozen pre-registration** (item 4; `0089`, `take50`;
`reviews/2026-10-03-take-prereg.md`, its rule unchanged). The executor gains an instance option `take` (from 2026-10-05
00:00 UTC) and a dependency for the book recorder's reads: before a rung's paper entry, steps 1–4 (eligibility, the read
at most 90 s old, the trigger at k + 0.09 % from its own fair, the entry cancelled and read back, then one IOC for £50 at
the limit, `request.take`). The simulated account fills a take against the recorder's first read after the turn (the
twins' pre-registration's deviation 2, variant-1's deviation 1); the driver waits for that read, so from `take.from` the
twin turns a call behind (120 s at most). `take50.json.gz` is `p50.json.gz` in every row but its twin id (check K1);
pr5's, p50's and rule D's backfills built again on the new code are the same bytes (rule D's output discarded). Each of
the take's 14 rules removed in turn fails its pin. The page shows the new row from its spec row (fixture regenerated);
the sweep's "no variant-2" check now counts variant-2 as the twins name it. Recorded in the TAKE prereg's deviation 1:
two takes on one read share its levels (study.py's `taken`), which the reading's K2 must mirror. Nothing of rule D,
PR5V or variant-3 was read; no production query was run. Not pushed. Gates: `sh bin/gates.sh --full` (sweep 603 checks
in one process, 228 + 76 + 236 + 69 in shards; README says 603, `.claude/CLAUDE.md` still says 595, left to the main
session).

### [2026-10-03 03:43 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Variant-1 and the twins' rows are in production** (`7476fbbf`, item 4). Reviewed before the push: `0088` keeps the
spec table under RLS with no grant or policy, its table-making function runs as its caller with an empty
`search_path`, and the page's code changed in comments only (the bundle differs by its build stamp). Full gates green on
the merged tree (sweep 595 checks single-process: 224 + 76 + 232 + 69 in shards); the four runs on `7476fbbf` (check,
migrations, edge-functions, pages-deploy) succeeded. Read at 03:42 UTC: `0088` applied; rows pr5 (10, £1,200), p50
"Stablecoin quotes variant-1" (20, £600), d "Stablecoin quotes variant-3" (40, £1,800); p50's six tables made;
`anon` and `authenticated` can read neither the spec table nor p50's tables and cannot execute
`create_quote_twin_tables`; p50's backfill loaded (13,198 turns, 3,360 orders, as the size study's £50 run) and
catching up from 2026-10-02 21:05; pr5, d and the live executor turning without error; no `ops_errors` in 30 minutes;
the site serves `app-30713727.js`, byte for byte `dist/`'s. `docs/agents/CLAUDE.md` names the three twins and the
two-statement recipe; README and CLAUDE.md say 595 checks.

### [2026-10-03 03:29 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The stablecoin twins are rows, and the size study's twin is "Stablecoin quotes variant-1"** (item 4; reference §4
item 51's later addendum and its "Twin variants" table; the twins' pre-registration's deviation 1, its §12;
`reviews/2026-10-03-pr5-size-twin-prereg.md`). Davies: "你说的这四点建议全做"; the names, "你目前正在做的variant改名为
variant-1排上面，这个新的是variant-2，原来的variant-1改名为variant-3"; the page, "把变体改成数据只是针对后台吧？我前端看到的不影响吧？".
Migration `0088` adds `agent_quote_twin_specs` (a row a twin: id, page name and order, engine, capital, keys, start,
tables, lease, rule extensions, backfill, pre-registration) and `create_quote_twin_tables` (0087's statement for one
id), and makes `p50`: PR5's rule at £600 from PR5's first minute, its record to 2026-10-02 21:05 the size study's `s50`
run figure for figure (57 trips, 53 won, +£3.9040). The call and the page read the rows; rule D's twin is "variant-3";
"variant-2" waits for TAKE. pr5's backfill built again on the new code: the same bytes; rule D's twin not run. The page's
code is unchanged (two comments; the bundle rebuilt for them is main's in every chunk but its build stamp); the browser
test's twin checks run over the fixture's rows, made by `backtests/twins/scripts/fixture.ts`. The next parameter-only
variant is two statements (`reviews/TEMPLATE-variant-prereg.md`). No rule D figure was seen. Not pushed: the main
session reviews and pushes. Gates: `sh bin/gates.sh --full`.

### [2026-10-03 03:04 UTC] Platform: Claude Code | Model: not recorded (session policy)

**TAKE studied; its forward test frozen, not built** (item 4, reference §4 item 52, `backtests/take/`,
`reviews/2026-10-03-take-prereg.md`). Davies approved a study of taking the touch when the book rests through a rung,
and a test on the best base. Read on QUEUE's deviation 1: the recorded books, PR5's minute records and the tail of its
prints (every query and its md5 in `queries.sql`). The live executor's rules simulated on 841 book-minutes through the
0.1 % rung (33 episodes, lit 09-28 → 10-02): the rule the stated principle gives (a take keeps its rung's k after the
0.09 % fee) made 5 trips, 4 won, +£0.40 at £50 a rung, +£0.18 net of the maker trip it displaced; the IOC at the rung's
own price made 17 trips, +£0.35, first half −£0.11, net +£0.09. Fair mostly holds; the take does not change the case
for £50 (same trips at £100). Go, thinly: frozen as "Stablecoin quotes variant-2" (`take50`) on variant-1, trips opened
10-05 → 11-02 UTC, four conditions, power 0.49 at +5 bps a trip. Disclosure: 200 characters of rule D's first three
order placements (no fill or P&L) were printed while inspecting the twins' input file. Gates: unit and Edge tests.
The main session merged it to `main` on 2026-10-03, before the freeze's deadline (10-05 00:00 UTC).

### [2026-10-03 02:37 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The agents' rules left `.claude/CLAUDE.md` for `docs/agents/CLAUDE.md`** (Davies: "你说的这四点建议全做", the third
of four fixes for what small variants cost). The section, 38,874 bytes of the file's 60,087, was paid for on every
call of every session and sub-agent; the file is now 22,567 bytes, keeping a pointer and the four rules no session
may miss (no trade by hand in the two Revolut X accounts; only Davies arms; no-peek binds; every recurring Edge call is
a row of `edge_calls`). Claude Code loads `docs/agents/CLAUDE.md` when a session reads a file under `docs/agents/`;
one-line pointers in `supabase/functions/agents/CLAUDE.md` and `src/agents/CLAUDE.md` load the same way, and Cursor's
`.cursor/rules/agents.mdc` covers those paths. The working-with-davies skill and its two Cursor copies record the
lesson: a parameter-only variant is a row, internal ids carry no number, mechanical work goes to `sonnet-max`. The
variant-1 build was redirected to build the rows mechanism with `p50` as its first row (item 4). Adding
`supabase/functions/agents/CLAUDE.md` started an `agents` redeploy inside mini-pool's window (edge-functions run
37090556577); it was cancelled during its tests, before the deploy step, and `edge-functions.yml` now leaves `.md`
files out of what deploys a function.

### [2026-10-03 01:51 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The size study is done, and the books are read on Davies' word** (item 4, item 5a.4, reference §4 item 51's
addendum). PR5's rule carried out by its twin (`backtests/twins/size/study.ts`, the production code on the twins'
committed inputs; its £100 run reproduces the committed backfill, 47 trips, 44 won, +£6.0476) at £10, £25, £50 and
£100 a rung, and with 5 % and 10 % more pounds than the rungs: the trips fall from 60 to 47 as the rungs grow while
each keeps 14–15 bps, so the year's realised return on the capital falls from 28.9 % to 19.9 %; pennies cost under
0.2 bps a trip at every size (the live account's own fills agree); a reserve recovers 5 trips at £100 and none below.
Rule D was not run. Davies, told the twin's refusals could be checked only after QUEUE's export: "这个研究本来就是为了
测试记录的，有用的话就用，之后都用这个来辅助判断是不是更好？" So `agent_book_levels` is read from now on, QUEUE's
deviation 1 (its prereg's last section): rows before its window confirm all 12 refused entries and all but 1 of 2,200
sent ones; exits are less sure (11–12 of 18 refusals confirmed, 7–8 of 162 sends would have been refused). Proposed:
"Stablecoin quotes variant-2", PR5's rule at £50 a rung (£600). Gates: unit and Edge tests (docs only).

### [2026-10-03 01:32 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Disclosure: rule D's twin's figures were seen.** At 02:27 BST (01:27 UTC) Davies sent the session a screenshot of
"Stablecoin quotes variant-1"'s BOOKS: each book's round trips, the share won and USDC's realised, and two USDT asks
held with their marks. The twins' pre-registration (§9) keeps rule D's twin unread before rule D's reading (10-28); its
figures on the page are his. Nothing of them is used in any analysis, reading or proposal, and no query of rule D's
twin's fills or P&L was run.

**What his screenshots showed, answered from the record.** Every rung idle: the weekend. The last GBP/USD minute is
2026-10-02 21:29 UTC, and the executor's stale-input guard ("no GBP/USD minute in the last ten: dark") cancelled the
live account's entries by 20:55 and the PR5 twin's ten by 21:00; neither has sent an order since, and they quote
again when FX reopens. A book with no order shows no fair (the page takes it from a rung's order). The ENTRY ORDERS
rows marked rejected are orders the executor never sent: post-only orders whose price the book it met already crossed
(`request.crossesBook`, `response.wouldBeRefused`), as PR5's paper rule itself refuses one the market is through at
go-live (`blocks`) and places it again when the market is not. The page's newest 50 of the PR5 twin hold 12 filled
and 10 not-sent entries, 18 filled, 1 resting and 9 not-sent exits. The book a twin meets is PR5's snapshot where one
was stored (50–92 a book a day since 09-28) and otherwise the touch the last print implies, a tick wide: the
narrowest book that print allows, so it refuses at least as often as the real book would. QUEUE's recorded books
could test that, but its freeze line allows only counts, bytes, hashes and timestamps of `agent_book_levels` until its
export; none was read.

### [2026-10-03 01:16 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The site serves the twins' bundle.** Davies put Account → Cloudflare Pages → Edit back on the deploy token beside
Workers Scripts → Edit (its value and the repository secret unchanged). `pages-deploy` run 37085303539
(`workflow_dispatch` on `cdebc516`) succeeded in 36 s, and 40 s after it was queued daviesluo.com served
`app-1ac85573.js`. Byte for byte, the served `app-1ac85573.js` and `agents-c6f6154a.js` (the chunk with the twins'
rows) equal `dist/`'s; the root page differs from `dist/index.html` only by the challenge script Cloudflare injects at
its edge (`/cdn-cgi/challenge-platform/`). The page itself was not opened: it needs a password. The twins at 01:15: both
`forward`, no error, mismatches 46 and 0, 120 beats in two hours, no `ops_errors`; the live executor turned at 01:14:26.

### [2026-10-02 23:25 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The twins landed and run forward; the site still serves the bundle before them.** Read 23:24 UTC: both twins'
`_sim` rows in mode `forward`, no `last_error`, `paperCheck` mismatches 46 (`pr5`, all before 2026-09-24 18:13) and 0
(`d`), every twin table turned 23:23:25; 60 beats of `agents?action=quotestwins` in 60 minutes, no `ops_errors`
`agents.quotes_twin%` in two hours; the live executor's state turned 23:24:26 with no error. Rule D's twin's fills
and P&L were not read. The site serves `app-729a873e.js`, not this commit's `app-1ac85573.js`: `pages-deploy` failed
on Cloudflare's code 10000 (authentication) after the token was edited for the monitor, so `CLOUDFLARE_API_TOKEN`
needs Account → Cloudflare Pages → Edit back beside Workers Scripts → Edit (item 6); then re-run the failed run and
check the site's `app-<hash>.js`. The old bundle still renders: the server only added `quotesTwins`.

**The README's two stale facts** (the 22:02 entry left its paper-test sentence for later): two strategies trade a small
account, not one (the stablecoin quotes since 2026-10-01), and the page shows the stablecoin tests as twins of the live
executor. Its Edge count says "over 950" (968 today; Vitest 1,162, both read from this tree's runs), so it stays
true as tests are added. The interview showcase and both preparation PDFs in `daviesluo/personal` are corrected in
that repository's own commit.

### [2026-10-02 22:02 UTC] Platform: Claude Code | Model: not recorded (session policy)

**TESTING's stablecoin rows are realistic twins of PR5's live executor** (Davies: "…确保一致，确保真实"; "原版每档100磅，
variant-2 每档50磅"; "都按我们昨天新设立的maker费来换币"; "这个variant-2上线testing后改名为variant-1"; frozen
`reviews/2026-10-02-pr5-realistic-twins-prereg.md`, reference §4 item 51, item 4 above). `quotes_live.ts` runs as an
instance; its default is the live account, equal turn by turn to the file as it was (`quotes_live_frozen.ts`,
`quotes_live_instance.test.ts`: six simulated hours, every table, account and report; two perturbations fail it). A
twin is that executor against `revx_sim.ts`, a simulated Revolut X account (a resting order fills only by prints
strictly through it, by their size; pennies as the venue moves them; holds, refusals, the IOC's book walk, cancel lag,
the dead-man; no network, no key), carrying out a replica of its engine's decisions at PR5's timing: "Stablecoin quotes"
PR5's at £1,200 (£100 a rung), "Stablecoin quotes variant-1" rule D's arm `d` at £1,800 (£50 a rung, nine a side, four
keys). Its asks' coin is the operator's maker conversion (a quarter of the capital a book; sent again after a 24-hour
cancel for what the asks lack), so an ask waits for its coin, and the page says so. `0087` adds their tables and the
call `agents?action=quotestwins` (retry true; one file a call while loading, then at most 12 s of catch-up turns).
Their records to 2026-10-02 21:05 UTC were computed by this code (`docs/agents/backtests/twins/`, rebuilt byte for
byte on the final code, loaded into Postgres 17 twice with every CHECK) and load from `main`, sha256-checked. The page:
TESTING shows the two twins (funded £1,200 and £1,800, the live page's layout, PAPER, a line saying what each is);
PR5's, PR5V's and rule D's paper rows are off it and keep running with their frozen readings; the scoreboard and the
Revolut X card add the twins. The dashboard reads a twin's orders that filled or rest, and its DAYS from the twin's own
tally (a twin sends thousands a week).

Evidence: the account's rules by hand (132 coins with 20 and 30 through fills 50, at its price 0; penny both ways; the
422; crossing; the IOC with its fee in the coin; cancel lag; dead-man; no fetch), each of nine counterfactuals failing
2–6 of 12 pins; the driver in a hand-built world (maker conversions, asks waiting, the dead-man's cutoff, the
operator's re-send, replica = engine, day tally, backfill load and the record after it); the validation against the
live record 10-01 16:29 → 10-02 21:05 at £120: 23 fills each, 14 matched, 9 and 9 apart, every difference the fill rule
(six live fills at their own price with nothing through) or code the live account did not yet run; realised −£0.0358
live, −£0.0118 simulated. PR5's twin to 21:05: 47 trips, 44 won, +£6.0476 (PR5's paper 61, 59, +$8.0348 on $100
rungs); of the 16 paper trips it missed, 5 were bids short of free GBP, 6 a rung still holding, 4 an entry no print
went through, 1 an ask without coin. Rule D's twin structurally only: 7,505 entries all arm-`d` decisions, at most 716
POSTs a key a day, replica 11,094 events with no difference. Gates: `sh bin/gates.sh` green on this tree (web, Edge, unit), run again by the main session before the push.

**Disclosures:** while building, one figure of rule D's twin's P&L (the day's P&L in an earlier run's last-turn
report, in a log tail) and a count of that run's filled orders were seen; nothing else of its results. The twins'
call no longer returns that report. The loader reads `raw.githubusercontent.com` (the repository is public on GitHub,
whatever older notes say); a private repository would leave an unloaded twin unloaded. The interview showcase
(`daviesluo/personal`) and the README's paper-test sentence were not touched. **Next:** after the deploy, read
`schema_migrations` 0087, the call's beats, each twin's sim row loaded then catching up, no `ops_errors`
`agents.quotes_twins`, the live executor's turns unchanged and no twin row in `agent_quote_live_orders`.

**How it landed.** The sub-agent that built it was stopped (the session stalled) after its last gates run passed
and before it committed; Davies asked for it to be resumed in place, and a stopped agent cannot be. The main session
reviewed the migration (tables of their own with RLS on and no grant, no live table touched), the twins' venue (the
live's own Revolut X client over `revx_sim.ts`'s fetch, a throwaway key, no network but the backfill's sha256-checked
download) and the live instance's diff (defaults equal to the file before, pinned by `quotes_live_instance.test.ts`),
and committed the tree as the sub-agent left it with this entry.

### [2026-10-02 19:34 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Disclosure: PR5V's and variant-2's totals read before their readings, on Davies' question.** Davies: "Stablecoin
quotes variant-1和2哪个更好？如果一个不行的话就下线" (correcting a slip that named Reward quotes). Read at 19:34 UTC, aggregates
only, 2026-09-28 → 10-02 (10-02 partial), realised only: PR5's paper test 52 trips, 50 won, $6.95 on $1,200, 2,621
orders; PR5V arm main 189, 162, $15.60 on $3,600, 15,922 orders; variant-2 arm d 198, 170, $15.51, 10,419 orders (its
control arm v1 equal to PR5V's main). Per dollar of capital PR5 earned 0.58 % and each variant 0.43 %. Variant-1 is
dominated (the same money for 53 % more orders, about 3,200 a day against one account's 1,000), so on his word it
leaves the page; its engine keeps running and its 10-28 reading is unchanged. This adds to the 2026-09-30 disclosure:
both reading scripts are still to be written strictly from their pre-registrations, with no discretionary choice, and
each result file repeats both disclosures.

### [2026-10-02 19:31 UTC] Platform: Claude Code | Model: not recorded (session policy)

**One count for each test suite, read from today's runs.** The front page said 242 browser checks and about 450 Edge
tests, `.claude/CLAUDE.md` 489 checks and over 900 Vitest cases, and the interview showcase 591 (CI's four shards
summed, which counts the sweep's two whole-run invariants four times). Measured: the sweep run once in one process,
"ALL GREEN — 585 checks passed"; Vitest 1,158 tests in 62 files; the Edge suite 952 (the gates' run of 19:08 UTC); the
perf matrix 60. README and CLAUDE.md now say 585, over 1,150 and about 950; the showcase follows in the personal
repository. The showcase itself was brought up to today in `bcb3873` and `b1c8f86` there (the monitor, the dead-man,
PR5's protections, x4/x5 from 20:00, mini-pool and mid-pool as one real path).

### [2026-10-02 19:12 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The monitor runs, and x4/x5's earlier start is deployed before its hour.** Davies: "CLOUDFLARE_API_TOKEN 已更新，
MONITOR_GITHUB_PAT也已经建好". monitor-deploy run 37051581187 (dispatched 19:03 UTC, after his own run 37051226413 at
19:00 that generated `MONITOR_SECRET`) deployed `daviesportfolios-monitor`, cron every minute; its health output reads
github configured, monitorSecret configured, site, loop and pr5 ok. `monitor?action=deadman` beat every minute from
19:06; no `deadman` event, no `monitor.*` row, twelve live orders open and none cancelled unasked. Issue #232 closed with
a comment. The x4/x5 change (`6184f7ed`) deployed with edge-functions run 37052356962 at 19:11:35 UTC, while the replay
stood at 19:09: its arms e, rw, x1–x5, checks 0, no error, x4's and x5's accounts still equal to x1's (compared as
booleans; nothing of them read) and no base yet, as they should be until 20:00.

### [2026-10-02 19:10 UTC] Platform: Claude Code | Model: not recorded (session policy)

**RW-X4 and RW-X5 run their own rules from 2026-10-02 20:00 UTC, not 10-03 00:00; Test 1 does not move.** Davies
(~19:05 UTC): "Reward quotes variant-3和4现在就开始测试 不要等". The rest pre-registration's Addendum 1, written before
20:00: `RWX_REST_START` is `Date.UTC(2026, 9, 2, 20)` (the first whole hour this could deploy before with room, since
the replay decides minutes in order about three minutes behind the clock); Test 1 still judges 10-03 → 10-08 from the
10-02 rows, so the four hours are a run-in the page shows and the bar does not see; its copy check reads the 10-01 rows;
the slip rule reads 20:00; Test 2 is unchanged. Tests: the frozen-spec pins in `pmrw_x.test.ts` and `pmrwc.test.ts` read
20:00 (either fails with the old constant); the hand-worked world and the page's quotes run on the new start; the
seeding's mechanics run on a midnight world (`MIDNIGHT_SPECS`) so a day still closes on the way. Gates green
(edge-check, edge-test 951 + 1, unit). Read of these arms since the freeze: health readings and that both are in the
replay's state, nothing of their accounts. To check after the deploy: the replay's `last_minute` was before 20:00 when
the new code first ran (else Test 1 is void by the slip rule), and from 20:00 x4's and x5's page rows count.

### [2026-10-02 18:44 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Why PR5's live trips win less often than its paper's; the monitor checked; CLAUDE.md's mid-pool paragraph brought up
to `0084`.** Davies: "为什么Stablecoin quotes live的策略won的概率那么低？比paper testing的低很多，可以优化吗？或者paper testing的机制是不是不符合现实情况需要改动？".
Live had closed nine trips and won four, the paper 59 of 61. Recomputed with the page's own functions (reference §4 item
35): three losses are bids that rested through the stall at their 12:05 prices (the executor's last whole turn 12:16,
the next 14:12) while the paper's replay re-priced them in time, which the dead-man switch fixes; one is the first
trip's penny rounding, fixed on 10-01; one made +0.13p and carried 0.90p of the first conversion's fee (USDC's next
three asks carry the same, once). The paper's fill rule is the more conservative and stays frozen to 10-21. Asked which
Polymarket pool to fund, within both no-peek rules (nothing of either's results read): the two now run the same code at
the same size on the same days, mid-pool without the top of its band (RW's picks) and both on an assumed R = 0.40;
mini-pool first, after its 10-04 00:10 check, his funding and his word, since mid-pool needs its own pre-registration,
its margin measured again and its payouts told apart, and its band is RW-C's to 10-23. The monitor, checked by the main
session: check runs 37046852683, 37047789478 and 37048828795 green, monitor-deploy 37048828891 green with its warning;
`monitor` v1 ACTIVE with `verify_jwt`; `0084`–`0086` in `schema_migrations`, the kind check ending `'deadman'`; no
`deadman` event or `monitor.*` row; twelve live orders open, eleven entries and top-up 1657 (USDC 0.2118 at 0.7554), sent
at 18:27:29 after 1634 rested 30 minutes unfilled. The Worker still waits on Davies' token (item 9). `.claude/CLAUDE.md`
said mid-pool was "a dry-run its tables enforce", false since `0084`: it now gives the same footing as mini-pool, the
one-armed trigger and what a funded mid-pool needs, and the go-time sentence names `0084`'s extra refusals.

### [2026-10-02 18:33 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`3fa527f4` landed and runs: x4 and x5 are in RW's variant replay as copies of x1; the sweep shows three variant rows.** migrations run 37046852783 applied `0085` (both arm checks read back from the catalog with `x4` and `x5`); edge-functions run 37046852686 deployed `agents` at 18:22:13 UTC; check run 37046852683 green. Read back, read-only: the replay's first run on the new code, 18:23:01 UTC, wrote `pm_rw_x_state` with arms `e`, `rw`, `x1`–`x5`, x4's and x5's accounts, markets run through the rule and active markets each equal to x1's (compared as booleans; no figure read), no `base` yet (it is taken at 10-03 00:00), `last_minute` 18:20 against RW's 18:21, no `last_error`, version 2, `checkMaxUsd` 0 and `checkEMaxUsd` 0 over 7 days. The call's wall time (function_edge_logs, database reads and writes included, so not its CPU): 631–804 ms a run over 18:13–22 UTC before the deploy, 1,395 ms on the first run after it (a new isolate, and the copies), then 770 and 716 ms, every one 200. This commit: the sweep's fixture sends what the dashboard now sends, three variant rows (x1, x4, x5, each RW-E's figures, so every count and sum gains one RW-E row): twelve rows; TESTING $6,560 funded, $1,473.65 deployed (22.46 %), today +$43.04, unrealised −$4.16 on $156.55, realised +$149.16; Polymarket's card five strategies, $252.40 deployed, −$5.80 on $42.60; the share bar 83 % / 17 %; variant-3 and -4 starting "3 Oct 01:00 BST" in the waiting mode. Each figure was worked by hand before the run (the arithmetic is in the comments beside them), and the sweep read exactly those at both widths; the one check the edit missed counted the rows that decide every minute (five, now six) and failed until it was changed. `agents.js`'s comment names x1, x4 and x5 (bundle rebuilt). **Erratum, not edited into the frozen file:** the pre-registration's "Why" says RW's quote "fills on the flow at the touch"; where the spread is two ticks or less RW's quote is at the touch, and it fills only on prints strictly through it. Its rules and bar are unaffected. **Left for the main session:** the interview showcase (`showcase/daviesportfolios/README.md` in `daviesluo/personal`, the working-with-davies rule: the same week) does not yet describe x4 and x5 or x2 leaving the page.

### [2026-10-02 18:33 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The monitor's first deploy (`ee3fda3a`): the function and `0086` are in production, the Worker is not, for want of a
Cloudflare permission.** edge-functions run 37047789319 deployed `monitor` (v1, `verify_jwt` true; `agents` not
redeployed), migrations run 37047789456 applied `0086` (the kind check now ends `'deadman'`), check run 37047789478
passed. monitor-deploy run 37047789327 passed its tests (20 of 20) and stopped at the Worker's secrets: "No access to the
specified resource", with the token's list of the account's Workers empty: a token made for Pages. Its notify job opened
issue #232. Read back by hand: the function answers 401 "unauthorised" without the secret, the gateway 401 without the
anon key, 405 to a GET; `MONITOR_SECRET` is set nowhere, so nothing calls it and nothing at the venue was touched. The
deploy now reads that refusal and stays green with a warning naming the permission, as pages-deploy does without its
secrets, instead of going red on every push. Davies' three steps are item 9; close #232 once the deploy has run green.

### [2026-10-02 18:19 UTC] Platform: Claude Code | Model: not recorded (session policy)

**A monitor outside both schedulers, and PR5's dead-man switch.** Davies, 2026-10-02: "可以的，有问题开github issue吧并且也可以在网站中
的error框发给我，我看到后可以叫你来处理，这个会话里cloudflare连接器已打开请搭建好", and for PR5: "加一个“掉线保护”：执行器连续几轮没跑时撤掉所有挂单，
免得像今天卡死时那样旧挂单被成交。这个加上". Measured first (read-only, `edge_call_beats`): between 12:51 and 14:12 UTC the tick's
and PR5's calls each started in 2 minutes of 81, and the hourly decisions came 1 h 29 min apart (1 h 00 min at most in
the three days around). Built: the Cloudflare Worker `daviesportfolios-monitor` (`workers/monitor/`, a one-minute cron,
KV namespace `98f4596d95c8454e901cae2ae1b97da5` made through the connector); the Edge Function `monitor` (dead-man,
health, report; nothing of `agents` imported); `0086` (kind `deadman`); `monitor-deploy.yml` and `monitor-alert.yml`.
Thresholds: a minute reading stale past 180 s (tick beat, tick lease, PR5's state), the newest decision past 75 min; an
alert after 2 failing runs in a row, and on recovery; KV written only on a change, under a 900-a-day budget. The
executor needed no change: a pin in `quotes_live.test.ts` runs the dead-man's own code on its fake venue and shows the
next turn reading the orders back cancelled and re-quoting the same paper decisions, the exit too. 20 Deno pins in
`monitor/index.test.ts`, 20 vitest pins in `src/monitor_worker.test.js`; 25 counterfactuals, one rule removed each
(staleness, unreadable, the venue before the verdict, the read-back, the re-reads, the 429 retry, the deadline, the
empty secret, a limit, the kind filter, the record's kind, the key names, the executor's read-back of an order missing
from the active list and its count of a cancelled decision, two failing runs, the capped count, writes only on change,
the queue, GitHub without a token, a permanent 401, the recovery, the budget, KV's cache TTL, the chunk's type and the
unrecorded cancel), every one failed at least one pin. Davies' to do and the check are item 9.

### [2026-10-02 18:15 UTC] Platform: Claude Code | Model: not recorded (session policy)

**RW-X4 and RW-X5, two more variants on x1 from 2026-10-03 00:00 UTC; x2 off the page.** Davies (~17:15 UTC): "这个根据你的推荐再加1-2个variant对比（加在目前表现最好的无当天结束+无天气市场的基础上），暂停规则（variant-3）如果表现不好的话可以隐藏掉…". Over 09-28 → 10-01 (aggregates, each arm's day rows less its 09-27 row) x2 was the weakest variant (+$579.13, stress +$211.72) and x3 below x1 on both (+$611.66 / +$279.35 against +$641.38 / +$300.68): x2 leaves the page (`RWX_OFF_PAGE`), x3 stays off, both still replayed. Pre-registered and frozen in this commit (`reviews/2026-10-02-polymarket-rw-rest-prereg.md`): **x4 "wide" (page "Reward quotes variant-3")** rests both quotes the most whole ticks further from the adjusted mid that keep at least 0.9 of the minute's reward at RW's quotes; **x5 "lean" ("variant-4")** moves the quote that would add to what it holds a tick out per whole N held. Both stay inside the band by more than 1e-9 ¢: a grid price reaches the band's edge a hair inside it, where RW's `scoreS` gives 1e-30 that would take an empty pool (the lean pin's first run caught it). RW's own `quote` places the moved quotes (`restRow`: the book's raw touch a tick outside them) and RW's own `stepRw` scores, fills and books them; `pmrw.ts` is untouched. They join the running replay as copies of x1 (`seed`, only before 10-03 00:00) and RW-C's replay runs them from 10-09 (`RWCX_SPECS`). `0085` widens the arm checks of `pm_rw_x_days` and `pm_rwc_x_days` (the test double with it); the dashboard reads the latest minute's `tick` so x4's and x5's QUOTES show their own prices and share. Pins (`pmrw_x.test.ts`, eight new): `restRow` over 20,000 random books; `wideTicks` and `leanTicks` in closed form; a world by hand (x4 fills at 0.48 / 0.52, x5 leans its bid to 0.48); added mid-way equals always there, and changes none of the five arms; a seed after 10-03 refused; the page's quotes; a minute's prints. Eight mutations, each caught (`restRow` at the touch, `scoreS` for the band, `keep` ignored, ceil for floor, a shared seed, a late seed, RW's quotes on the page, x1's start on the page). Once, in the scratchpad: on 60 random worlds, 532,800 minutes replayed in random chunks, the replay at `829632cf` and now gave rw, e and x1–x3 the same state and day rows byte for byte (67 RW-E divergences, 868 pauses and 84,659 fills of RW exercised); a leak of the wide rule into every arm was caught at the first chunk past 10-03 00:00; x4 and x5 on a minute's prints equal them on the whole list. CPU in this container: a minute's run 2 ms before and after; a 720-minute catch-up of 40 markets 116 → 204 ms, of 80 markets and 108,352 prints 392 → 676 ms (1,046 ms on the whole print list); RW's last 720 minutes held 44 markets and 302 prints. Recorded in the new file: a deviation of RW-X's "bookkeeping only", and an addendum to RW-NEXT Part 2. The sweep's fixture follows in the next commit.

### [2026-10-02 18:08 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Both top-ups rest; a refused one now waits 30 minutes.** Read at 18:07 UTC: `4398ce3b` deployed and the 18:05 turn sent USDT's top-up again, 1644 (0.1854 at 0.7551, held as £0.14 beside USDC's 1634 at £0.16 of the £0.31), accepted; twelve live orders open (six bids, four asks, two top-ups), the third asks waiting for the top-ups to fill; no `ops_errors`. Before that deploy USDT's went out every minute and was refused eight times, 17:57–18:04 (1636–1643): nothing resting held it back. Now the book's next top-up waits `QUOTE_LIVE_TOPUP_REST_MS` from a refusal the venue gave (not a rate limit). Pinned with the fake venue's `onPost`, which now receives the request: the pounds leave between the executor's read and the top-up's arrival, the refusal reaches the turn's errors, nothing is sent for 29 minutes, the next goes at 30; without the wait the pin fails (58 tests).

### [2026-10-02 18:02 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Mid-pool is the same real order path as mini-pool, in dry-run and unarmed, and the two configs can never both be armed (`0084`).** Davies (~17:15 UTC): "把mid-pool 的结构和路径也做成和mini-pool一样的真实下单路径，按上线规模跑 dry-run，之后更好对比，现在就做不要等". `runPmMidAction` (`agents/index.ts`) is wired as `runPmLiveAction`: `loadPmLiveEnv` with the signing key (kept only when its address is the stored signer), the same keyed wire (`pmVenue` under `PM_ORDER_SENDS_ENABLED`), the same account and switch; `pm_mid_state.state` records `keyed`, `signerProblem` and `pusd` every minute. Its config row is the lock, as mini-pool's: `dry_run` true, `live_confirmed_at` null. `0084` drops `pm_mid_config`'s two CHECKs, lets `pm_mid_orders` be `live`, and adds `pm_one_account_one_armed()`, an AFTER trigger on both configs that refuses a row armed while the other row is (a transaction-scoped advisory lock makes two arming transactions take turns); it writes no row. The design doc's step 8 (mini-pool's go-time statement) now also refuses without `keyed`, outside eu-west-1, without a current attestation, or while mid-pool is armed; step 8m is mid-pool's, the same checks on its own state and mini-pool's arm, with what a funded mid-pool still needs first (its own pre-registration, its margin measured again, the readout told apart per path: mid-pool reads no payout and mini-pool's readout books every market the account is paid for, a `pm_live.ts` change after mini-pool's window). Sizes unchanged and verified on PGlite after `0084`: eight markets, $160, $320, $60, −$25, −$75, GTD 600 s. **Evidence:** PGlite 16 with `0074` → `0084` (`backtests/pmlive/scripts/one_armed_check.mjs`, `results/one_armed_check_out.txt`): 60 checks pass, both statements read word for word from the doc, each refused on eleven conditions and arming at $401.37 → $320, $398.20 → $318, $300 → $220, $81 → $1; the trigger refuses a plain update, an insert, both rows armed in one statement and in one transaction. Deno: `pm_mid.test.ts` 15 cases (as deployed a simulated day of the action sends nothing but GETs and the exclusion's batch read; armed, six POSTs; the kill switches cancel at the venue and sell a holding; a wrong key loads none; the double's one-armed rule); the whole Edge suite 917 pass; `deno check supabase/functions/` clean. Counterfactuals: the old wiring fails 3 of the 15, the double without its rule 1, with 0081's checks 3; on PGlite, without the triggers 6 checks fail (the statements still refuse on their own), without `0084` 13. `pm_live.ts` (`8ba7b915…`) and `pm_prep.ts` (`8d7861ab…`) unchanged, so mini-pool's window (10-03) is untouched; `pm_mid.ts` changed in comments only (`b7854ab5…` → `9fd37436…`). Loading the key costs a turn 32 ms of CPU cold and 0.45 ms warm. Mini-pool's pre-registration gains Addendum 5 (the trigger on its config, the longer statement), mid-pool's Addendum 1 (why d1 and its fourteen days are the same test: with `dry_run` on a turn decides as before; five scalars of its state join the health readings). Not changed: either pool's selection rule (the main session measured no same-day market among the 18 picks so far and one monthly weather market). **Not edited here:** `.claude/CLAUDE.md`'s Polymarket paragraph still says mid-pool is "a dry-run its tables enforce"; a sub-agent does not change that file, so its new sentence is in the report to the main session. **Landed and verified in production** (`0e6c5cff`, pushed 18:06:38 UTC): migrations run 37045239213, edge-functions run 37045239194 (`agents` deployed 18:07:53 UTC) and check run 37045239093 all green. Read back, read-only: `schema_migrations` holds 0084; both configs `dry_run` true and `live_confirmed_at` null; both triggers present and enabled, the function `search_path=""` and SECURITY INVOKER; 0081's two config CHECKs gone and `pm_mid_orders_mode_check` `mode in ('dry_run','live')`. Mid-pool's turns from 18:08:01 to 18:11:00 UTC: `keyed` true, `signerProblem` null, `pusd` 0.036673 (the account is not funded), `sbRegion` eu-west-1, no `last_error`; its layer to 18:11 (last minute 18:09) with none; mini-pool's path and layer at 18:11 with none; no `ops_errors` of `agents.pm_*` or `agents.crash` since 18:07.

### [2026-10-02 18:02 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The first automatic top-ups: one rests, one was refused for a penny; the executor now counts the pounds the venue holds.** After `48352c64` deployed, the 17:56 UTC turn placed both: 1634, 0.19898 USDC at 0.7553, resting; 1635, 0.19898 USDT at 0.7553, refused "Not enough funds! Wanted £0.16 but has only £0.15". Revolut X holds a buy's pounds rounded UP to the penny: the six £10 bids hold £60.00, and £0.31 free covers £0.16 + £0.15, not £0.16 twice. The sizing used exact pounds, and so did the fake venue, which is why no pin caught it. Now every pound promised to a buy is `pennyUp` (open buys, a bid's check, an ask's buy-back, `quotes-convert`), `planTopUps` shares the buffer in whole pennies, `FakeRevx.holdFor` holds a GBP buy as the venue does (all 615 agents tests passed under it before the fix), and a refused top-up reaches the error box. The 17:56 case replayed fails on the old sizing and passes now (57 pins). The next turn after this deploy should send USDT's top-up again: £0.15 is free beside USDC's resting one.

### [2026-10-02 17:53 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5 live tops its asks' coin up itself, a maker conversion at the bid** (Davies: "以后这种问题自动处理，用昨天新加的规则maker换币"). An ask skipped for want of coin now makes the same turn place a `convert` order with `request.auto` (`planTopUps`, step 6b of `quotes_live.ts`): post-only at the top of the bids (a tick over the best bid when the ask stays a tick above; never over fair + 50 bps), back to three asks' worth at the rule's prices and 2 % over, less the coin beyond the book's longs, out of the GBP the entries leave free: each short book's shortfall first (at least the venue's £0.10 minimum: `revx_get_pairs` reads min_order_size_quote 0.1 on both GBP books), the buffer shared from what is left, none while a shortfall goes unfunded. One rests per book, at most £5 a book a UTC day, cancelled after 30 minutes unfilled; live and armed only, under the entries' guards. The operator's `quotes-convert` is unchanged and shares `asksNeedOf`. With £0.31 of GBP beyond the six bids the first turn after the deploy should buy about 0.2 of each coin, the third asks following once they fill; a larger shortfall needs GBP added, and the turn's report says so. Pinned: hand-worked sizing (39.65286 coins at fair 0.7550; 0.94591 with the buffer; 0.20535 each when two books share £0.31; the £5 day) and the loop end to end; removing step 6b, the one-at-a-time rule or the 30-minute cancel each fails a pin (56 tests). **The Revolut X connector** Davies connected sees his own account, not the loop's or PR5's (balances and active orders read 17:42 UTC): CLAUDE.md now says a session reads public market data through it and the strategy accounts through the database and the probe, as before.

### [2026-10-02 17:41 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5's live page lists refusals again, all but the five known of 10-02; and why ENTRY ORDERS shows ten of twelve.** Davies: "我之前的意思是只是让你把已知问题的订单删掉，不是以后再出现问题的订单也不显示，不然感觉我没法知道". `13cfa152`'s filter (no refusal listed) is reversed, its fixture, sweep, test and guide with it; the page now leaves out only `QUOTES_LIVE_KNOWN_REFUSALS` (1517, 1518, 1521, 1536, 1537: the funds refusal fixed by `94ae4f0e` and the four crossing exits fixed by `81fbde0a`), so any later refusal shows with its reason, and one refused at its book and never sent reads "not sent: its price crossed the book…". DAYS counts only the POSTs the venue saw: the summary reads `not_sent:response->wouldBeRefused` (a PostgREST JSON path, which the test double now answers as PostgREST does, through `selectItems`/`pickRow` that the dashboard-reads helper also uses, refusing an unknown base column). Pinned: three counterfactuals each fail a test. **Ten of twelve:** not the page and not the refusals. The account holds 39.56 USDC and 39.58 USDT; three £10 asks at today's prices need about 39.61 and 39.64, since GBP has risen since the 10-01 conversions bought them, so the third ask of each book is skipped every turn ("no USDC to sell": 13.126 free of 13.191 needed at 0.3 %; USDT 13.160 of 13.226 at 0.1 %), as the 14:13 entry foresaw. Davies, on being told: "以后这种问题自动处理，用昨天新加的规则maker换币" — the next commit has the executor top the coin up itself, a maker conversion at the bid.

### [2026-10-02 17:00 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`81fbde0a` deployed and running; the health check's real cadence found.** edge-functions run 37037424979 deployed `agents` at 16:58:26 UTC and check run 37037424936 passed in 1 min 47 s. PR5 live's turns at 16:59 and 17:00 ran with no error and no `ops_errors`, ten orders open, the governor at "all" and its count unchanged at 314 (every live row so far went to the venue, the four refusals included); no live row has been refused since 14:26. Mini-pool's and mid-pool's paths and paper layers: no `last_error`, updated at 17:00. While answering Davies' "做了这些修复后以后还会发生吗": the 10-02 stall raised no issue because `healthcheck.yml`'s `*/10` schedule ran only 9 times in 48 hours, of 288 (what-remains item 9; the commit that recorded this said 7, counting from 10-01 00:00).

### [2026-10-02 16:55 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5 live sends no post-only order the book it met shows crossing.** Davies: "并确保以后不会再发生这种rejected的情况". The 16:32 entry read the four post-only refusals as the book moving under orders already sent; the rows say otherwise. All four (1517, 1518, 1536, 1537) carried `request.crossesBook: true`: the book read 30 ms before already had its bid at or above them, and the live path sent them anyway, where the dry-run has always recorded that case refused without sending. Of the 465 live post-only orders whose book did not cross, the venue refused none for crossing. Now neither mode sends one (`quotes_live.ts`, `placeOrder`): the row is `rejected` with `wouldBeRefused: true`, so `exitMayGo` and the one-POST-per-decision rule read it as a venue refusal, and the governor counts only rows sent (`wasSent`). The venue can still refuse an order whose book moved in flight; nothing trades on that. 53 pins (reference §4 item 35); on the old executor three fail (the live case, the dry-run governor count, an exit refused every minute that never reaches the venue), and the two venue-refusal tests now move the venue's book as the order arrives, so its own 4xx and status refusals stay covered. `agents` redeploys before mini-pool's window opens at 10-03 00:00 UTC; `pm_live.ts` and `pm_prep.ts` are untouched.

**The parallel `check.yml` measured** (run 37036195644 on `4714437f`, every job green): 1 min 41 s from the push to the last job, against 6 min 12 s on `13cfa152`. The source job 76 s; the sweep's shards 75–97 s (each sweep 49–66 s, phone `main` the slowest); perf and size 79 s.

### [2026-10-02 16:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`check.yml` runs its gates as jobs at once.** Davies: "ci为什么跑的这么慢 有可以优化和并行跑的吗". On `13cfa152` its one job took 6 min 08 s, every gate in turn: checkout 7 s, `npm ci` 7 s, types 8 s, lint 4 s, vitest 37 s, build 3 s, Chromium 9 s, the browser sweep 235 s in one process, the perf matrix 33 s, size-limit 16 s (its time plugin runs the bundle in a headless Chrome), knip and the audits 4 s. Now `typecheck-and-build` keeps freshness, types, lint, the unit tests, the build, knip and the audits; `sweep` runs the four shards `bin/gates.sh` runs (desktop / phone × `main` / every other part) as a matrix of runners, fail-fast off; `perf-and-size` runs the perf matrix and the size budget. Each job that reads the bundle builds its own and installs its own Chromium (~12 s), cheaper than handing one build between jobs, which would make them wait; `notify-failure` waits on all three. No gate is dropped or loosened, and the sweep's shards are the ones gates.sh has run since 10-01 (the same 485 checks). The repository is public, so the extra runner minutes cost nothing.

### [2026-10-02 16:32 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5 live page: the venue's refusals are no longer listed in ORDERS; the executor keeps them.** Davies: "目前live的Stablecoin quotes页面中ORDERS列表中的rejected行删了，并确保以后不会再发生这种rejected的情况". Read first: since go-live (10-01 16:29) the live book has five refusals in ~430 POSTs, all in the hour after the database stall: the "Not enough funds" ask (fixed by `94ae4f0e`) and four post-only exits at 0.7549 / 0.7548 under a best bid of 0.7550 / 0.7549, which the venue refuses rather than let them take; none in the 22 hours of normal running before. The rows stay in the database, because the executor reads them (a refused entry decision is not sent again, a refused exit waits for a newer print, `exitMayGo`); `quotesLiveDetail` leaves `state = rejected` out of the page's ORDERS. Pins: `index.test.ts` (114, the fixture's refusal, is read and not listed), `quotes_live_fixture.json` (the function's answer less 114), the sweep (seven entries, no refusal, no reason line; seven in the no-exit view), the guide. A post-only refusal cannot be ruled out entirely (the venue judges the book when the order lands, after the executor read it); it moves no money. `agents` redeploys before mini-pool's window; `pm_live.ts` and `pm_prep.ts` are untouched.

### [2026-10-02 16:03 UTC] Platform: Claude Code | Model: not recorded (session policy)

**0082 and 0083 applied in production at 16:02 UTC and verified** (migrations run 106 on `3a54182e`, pushed on Davies' word: "同意把 0082 和 0083 推到 main，并让 CI 应用到生产数据库"). Read back: `schema_migrations` holds 0082 and 0083; `board_data` has no policy; in `public`, no function `anon` or `authenticated` may execute, no table or view `anon` may read or write, and none the service role lacks; postgres's default privileges now grant new functions, tables and sequences to postgres and the service role only; `cron-run-details-prune` is job 35. With the page's anon key, `board_data` (it answered `*/1` before), `portfolio_snapshots` and `rpc/price_snapshot_series` now answer 401 "permission denied". Every service-key PostgREST request since 16:02 succeeded (303 × 200, 64 × 201, 33 × 204); `ops_errors` none; the job 3/3, the calls, PR5 live, mini-pool and mid-pool ran on. The security advisor's sixteen SECURITY DEFINER warnings are gone; it keeps RLS-without-policy (the design) and the two variant reset functions' search_path (left, as 0082 says). A sign-in, a save and the charts by Davies on the site exercise the RPCs through the service role, which holds EXECUTE on every function.

### [2026-10-02 16:00 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Supabase housekeeping: the two bloated tables emptied, seven days of pg_cron's history kept from now (`0083`), and what is left for after the tests (item 9).** Davies: "没用的话就清理掉吧". He ran `truncate cron.job_run_details` and `truncate net._http_response` himself at about 15:39 UTC; the connector's confirmation for a destructive statement had timed out twice, unanswered, changing nothing. That removed 115 MB of run history back to 05-13 and 206 MB of pg_net responses holding about 4.7k live rows; the rest was dead space no vacuum could hand back, because the table is supabase_admin's and pg_net holds a lock on it through each minute's batch. The database fell from 634 MB to 315 MB, and the job, the calls and pg_net ran on (checked at 15:40). Nothing reads either table: the Jev replies once read from the responses are in `backtests/jev*.json`. `0083` schedules `cron-run-details-prune` daily at 10:45 UTC, deleting runs started over seven days ago; pg_net prunes its own responses after six hours.

### [2026-10-02 15:42 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The page's anon key could read and write the portfolio; it now opens nothing in the database (`0082`; Davies: "同意把 0082 和 0083 推到 main，并让 CI 应用到生产数据库").** Asked to look for anything else to improve in Supabase ("看看supabase还有没有其他可以优化的地方"), its security advisor and then the catalogue showed two openings for the anon key the bundle carries (the repository is public). `board_data` held three permissive policies made in the dashboard before 0009 was written ("allow anon read", "allow anon write", "allow anon update"; `using (true)` and `with check (true)`, to PUBLIC), so anyone with the key could read the whole book and overwrite it through `/rest/v1/board_data`: a count-only read with it answered `*/1` (nothing was read). And eight SECURITY DEFINER functions were executable by `anon` and `authenticated`: `save_board_data`, `prune_price_snapshots`, `prune_portfolio_snapshots`, `price_snapshot_series`, `portfolio_snapshot_series`, `bump_auth_attempt`, `try_claim_av_call`, `try_claim_t212_refresh`; 0013 and 0017 revoked PUBLIC, but Supabase's default privileges grant both roles by name. No use of either shows in the edge logs kept: every PostgREST request on 09-25, 09-29, 09-30, 10-01 and 10-02 (196k–340k a day) carried the service key. Every caller is an Edge Function with the service role, or pg_cron as postgres; the page never reaches PostgREST. `0082` drops the three policies, revokes every privilege of both roles on the schema's tables, views, sequences and functions (and PUBLIC's EXECUTE), and revokes them in the default privileges so what is created later starts closed; the service role keeps everything. It lands before mini-pool's window and mid-pool's d1 (10-03 00:00 UTC): no code and no column changes, only privileges of two roles nothing uses, on their tables as on every other. CLAUDE.md now carries the rule, and the migrations README says its 0017 check read true. Left, with reasons: a mutable search_path on the two variant reset functions (SECURITY INVOKER, service role only, a running test's), RLS without a policy on every table (the design), unindexed foreign keys on two tables of a few rows, unused indexes only on running tests' tables, and the Auth server's connection setting (Supabase Auth is unused).

### [2026-10-02 14:40 UTC] Platform: Claude Code | Model: not recorded (session policy)

**"Reward quotes small-pool" is "Reward quotes mini-pool" on the page and in the docs; no code it runs changes.** Davies: "Reward quotes small-pool“ - 另外把这个改成Reward quotes mini-pool". The row's name is the page's own (`prepRow` in `src/agents/agents.js`, which its page's title reads); the sweep checks the new name and that no testing row carries "live-prep" or "small-pool"; the guide, the map, reference §4, CLAUDE.md and the what-remains list say mini-pool, each once naming the earlier names. `pm_live.ts` and `pm_prep.ts` are untouched, so their default instances still carry the name "Reward quotes small-pool", which nothing reads: changing it would move the hashes mini-pool's window (10-03) tests. The live-prep pre-registration's Addendum 4, written before that window, records exactly that; mid-pool's pre-registration is left as frozen, its "small-pool" naming the same row. Tables, files, actions and checks keep their names. Also corrected in the what-remains list: mid-pool runs since 05:01 UTC (it still read "not pushed").

### [2026-10-02 14:37 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5 live: the venue refused a USDC ask for want of coin, because the executor counted a re-priced exit's coin twice; fixed and pinned.** Davies: "live的Stablecoin quotes里显示“rejected refused by the venue: Not enough funds! Wanted 13.20307 USDC but has only 13.11631 USDC”这是什么情况". Read from the orders, read-only: at 14:13:29 UTC, the first turn after the stall, the executor re-priced the three USDC exits of the longs the bids bought during it (a cancel read back as cancelled, then a place) and then placed the asks. A confirmed cancel gives its coin back to what the entries may spend (`cancelConfirmed`), and the replacement exit never took it again, so the asks counted the exits' 39.67 USDC twice and the third (0.3 %, 13.20307 at 0.7574) went out against 13.11631 free: 422, recorded rejected. Nothing traded and nothing was lost. The shortfall itself is the market's: the coin converted on 10-01 covers fewer than three £10 asks at 0.7559–0.7574, so that rung has been skipped since ("no USDC to sell") and will be until the price or the inventory moves. The two USDT exits refused at 14:13:33 and 14:26:28 are the rule's own: post-only sells at 0.7549 and 0.7548 under a best bid of 0.7550 and 0.7549 would have taken, and each waits for a newer print not through it (`exitMayGo`). **The fix** (`agents/quotes_live.ts`): the stock entries are sized from is taken after step 5, from the orders as they then stand, the turn's own new exits and stops included (`takeStock`), and each exit is capped at the coin the turn's earlier exits left (`sentNow` in `exitBase`). Pins in `quotes_live.test.ts`: an ask the account cannot cover beside a re-priced exit is skipped, never refused; two exits in one turn fit the account together; both fail on the old code, where the first ask (5.53562 USDT) is refused, and the other 50 pass on both. Reference §4 item 35 records it. `agents` redeploys with it; `pm_live.ts` and `pm_prep.ts` are untouched (small-pool's window tests their hashes).

### [2026-10-02 14:23 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The database stalled from 12:17 to 14:11 UTC; Davies restarted it, and the login page no longer calls a server failure a wrong password.** Davies, ~13:00: "网站好像出问题了 我输入两个密码都说密码错误". Measured, read-only: from 12:17 every new database connection took over ten seconds, so the one-minute job (`edge-calls-every-minute`, cron job 27) failed to start in most minutes ("job startup timeout"; function calls fell from ~267 per 15 minutes to 71, 89, 49 and 2), PostgREST timed out acquiring connections (PGRST003) and ordinary statements hit the statement timeout, across a dozen unrelated tables; nothing held a lock, nothing long ran, and the instance had not restarted since April. `auth` answered 500 after ~8 s to all of Davies' attempts from 12:47 (its first read is `auth_attempts`), and the page showed every 500 as "Incorrect password."; no IP was locked. His Supabase charts gave the cause: the instance was Nano (0.5 GB), it ran with ~600 MB in swap all day and memory committed above its limit, and the hour of the stall was ~90 % IOwait: the working set stopped fitting and the machine thrashed. Supabase's status page showed nothing for eu-west-2. He restarted the database at 14:11:39 UTC; by 14:15 the job ran every minute in 0.1 s, the crypto tick wrote its 14:15 basis, PR5 live was fresh with nothing stuck, both Polymarket paths and RW ran, and no `ops_errors`. **Lost:** every one-minute call from about 12:17 to 14:11 (RW's, PR5 paper's and the variants' minutes are recorded as missing, as their specs keep them; the small-pool and mid-pool run-in day is outside both windows). Also measured: `net._http_response` holds 206 MB for ~5k live rows, autovacuumed twice since stats began (last before today 08-05), and `cron.job_run_details` 115 MB; responses average 0.1–2.3 KB, so it is dead space, not data. **The login fix:** `authenticate` (`src/app/auth.js`) now answers `{ unavailable, status }` for a 5xx, a timeout or no network, and the page shows SERVER UNAVAILABLE (the password was not checked; try again in a minute); only a 401 reads "Incorrect password.". Pins: `auth.test.js` (200, 401, 429, 500, 503, a rejected fetch, an empty password) and an `app.test.jsx` render; the old code fails both new pins. **The instance is Micro (1 GB) since 14:20:** Davies upgraded it from Nano (free on the Pro plan), and the database restarted again at 14:20:59 UTC (`effective_cache_size` now 768 MB); the job missed 14:20 and 14:21 and ran from 14:22. **Open:** watch the swap and IOwait charts on 1 GB and the job's `job startup timeout` rows; reclaiming the dead space in `net._http_response` and `cron.job_run_details` is Davies' call.

### [2026-10-02 09:02 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The 09:00 health check: small-pool, mid-pool and PR5 live all healthy; nothing to fix** (routine `trig_016nnqDsXAowM2SK9yYr216P`; read only what the pre-registrations allow). Small-pool: the path at 09:01:01 with no error, the layer at 08:59 with none, 2026-10-02's eight markets chosen at 02:24:01. Mid-pool: the path at 09:01:01 with no error, the layer at 08:59 with none, its eight chosen at 05:01:01. PR5 live: fresh at 09:00:30, no error, loss stop off, nothing pending over two minutes. pUSD 0.036673 (not funded). `ops_errors` since 00:00: one `agents.pm_live` and one `agents.pm_mid` at 07:50:09, both a token balance read timing out ("Signal timed out") in the same second, neither again. Since 05:00, twelve 503 `BOOT_ERROR`s, each retried by the watchdog (eight ok) or left by design (`pmrw` ×2, `pmrwc` ×2, whose frozen specs read the book at `t`).

### [2026-10-02 04:56 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Reward quotes mid-pool lands, and small-pool's pre-registration records the instance change before its window** (Davies: "做完并验证好就直接上线，不管几点"; "small-pool没有定时上线任务…之后我想什么时候决定哪个策略上线再说": no routine arms anything, and which strategy goes live, and when, is his later call). Reviewed before landing: the branch's three commits fast-forward `4fd9cedc`; the four hashes read again from the files (`pm_live.ts` 8ba7b915…9653, `pm_prep.ts` 8d7861ab…4dea, the frozen copies fbdaca34…9b89 and 83fe596f…7061); `0081` only creates `pm_mid_*` / `pm_midprep_*`, two locks and two `edge_calls` rows (`on conflict do nothing`), every earlier row untouched; the mid wire refuses POST and DELETE, and its one public POST is the CLOB's keyless `/books` batch read. **Addendum 3** of `reviews/2026-10-01-polymarket-live-prep-prereg.md` (written before 2026-10-03 00:00 UTC, the window unmoved): the row renamed small-pool, the new hashes, and why it is the same test (`pm_instance.test.ts`: the default instances beside the frozen files over 56 turns, identical after every turn; six counterfactuals fail it). CLAUDE.md's Polymarket paragraph names small-pool, `0080`'s size, the end of the automatic go-live and mid-pool, with the revocation statement mid's copied attestation needs. To watch after the deploy: mid's first selection lands (a count and `selected_at` only, per its no-peek), no 546 or 5xx on `action=pmmid` (its selection's CPU was measured only in this container, ~1.16 s), both states moving, no `ops_errors`; and the interview showcase gains mid-pool this week. **Verified in production after the push (04:59:25 UTC; all four workflows green by 05:04):** `0081` applied; `pm_mid_config` dry-run, unarmed, 8 / $160 / $320 / $60; mid's first selection landed at 05:01:01 UTC in one run, eight markets (a count and `selected_at` only, per its no-peek); `pm_mid_state` moving with no error, the layer two minutes behind with none; small-pool unchanged (both states moving, no error); no `ops_errors` since 04:59. One 503 `BOOT_ERROR` at 05:02:00 was `agents?action=views`, retried by the watchdog at 05:02:13 (200).

### [2026-10-02 03:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Polymarket's order path and its paper layer run as instances, the default being the pre-registered code** (item 2;
Davies, 2026-10-02: "把目前Reward quotes live-prep改名为Reward quotes small-pool，再做一个Reward quotes mid-pool只做10-50，同时也不打扰其他的Reward
quotes，也是400美元funded测试"). Step 1 of 3, the way `pmrw.ts` took `RwInstance` for RW-C: `pm_live.ts` takes a
`PmLiveInstance` (its nine tables, its lease, its band of daily rates, its migrations' names, an optional exclusion its
selection applies to the listing it has just read, an optional batch read of its candidates' books, and whether it
reads what the account earns: its share of each pool every minute and its daily payouts) and `pm_prep.ts` a `PrepInstance` (its seven tables, the path's four it reads, its
lease); `PM_LIVE_INSTANCE` and `PREP_INSTANCE` are the names and behaviour the code had, and a turn given none runs them.
**Equivalence:** `pm_live_frozen.ts` and `pm_prep_frozen.ts` are the files the live-prep pre-registration froze, byte for
byte (sha256 `fbdaca34…b89`, `83fe596f…061`, held to the document's words by a new case in `src/pm_prep_prereg.test.js`);
`pm_instance.test.ts` runs them beside today's default instances (once left out, once named) over 56 turns spread on three
simulated UTC days, each in its own database and fake Polymarket, and after every turn finds every table, every request
(method, URL with its query, body) and every report identical: selection, re-price, refresh, expiry, a one-sided book, a
market leaving the book, the geoblock failing then stale, the pause, an unreadable balance, the readout; then live posts, a
fill and its CONFIRMED trade, a lost reply, a 425, a cancel late and one never carried out, the cancel-all, the day's loss
stop, earnings and rebates read, a settlement; the paper layer beside every turn (its fills, dark and matched minutes,
its days). It also pins that every export of the frozen files is today's, text for text and value for value, except the
five the build took (`inUniverse`, `candidateOf`, `selectMarkets`, `runPmLive`, `runPmPrep`), and that the frozen layer's
one import of `pm_live.ts` reaches functions identical to the frozen path's. Counterfactuals, each alone and restored by
hash: the default band to $11, the default reading no payouts, its state written elsewhere, the selection's band
[6, 10.5), the layer's days written elsewhere, its markets read from another table — each fails the equivalence pin
(four the export pin too). The fake gains the keyless public reads (`publicFetch`: the CLOB's short list, `POST /books`,
the data API's prints). `pm_live.ts` sha256 `8ba7b915…9653`, `pm_prep.ts` `8d7861ab…4dea`. Committed on the worktree's
branch, not pushed: a deploy of these two files inside the live-prep window (10-03 00:00 → 10-04 00:00 UTC) ends it as
FAIL, so the main session lands them before 10-03 00:00 with an Addendum 3 naming the new hashes, or after the 10-04
00:10 check.

**Step 2 of 3: "Reward quotes mid-pool", the path and the layer again as a second instance, in dry-run, pre-registered.**
`agents/pm_mid.ts` and `0081_pm_mid.sql` (tables `pm_mid_*` and `pm_midprep_*`, small-pool's final shapes; a reward
rate in [$10, $50) on its markets and minutes; its config refuses `dry_run` false and any `live_confirmed_at`, its orders
any mode but `dry_run`; the $400 sizes; the attestation copied from small-pool's row, never made; leases `pm-mid` and
`pm-midprep`; two rows of `edge_calls`, retry true). Its action reads no signing key and builds its wire with sends
off. **Not disturbing RW, RW-E, RW-X and RW-C:** its selection recomputes RW's frozen selection from public data
(`rwSelectionNow`: RW's own `summarize`, `firstScore`, `choose`, budget and floor, imported; the same picks as
`runPmrwSelect` on 60 random worlds and a hand-worked one) and leaves out every market scoring at least 0.33 of its last
pick, recording only how many. **The margin, 0.67, measured** (`backtests/pmlive/results/mid_margin_out.txt`: fourteen
recomputations 03:58–04:14 UTC, 91 pairs 1–16 minutes apart, counts and ratios only): at 0.5 one of mid-pool's picks was
RW's in 40 pairs (3 of 25 within two minutes); at 0.67 and 0.8, in none; at 0.67 about 17 of the band's markets are left
out at each. An earlier run that morning, kept in the scratchpad only, saw no overlap at any margin, so 0.5 was the first
choice; the committed run moved it. **CPU:** its candidates' books (~1,010; small-pool's ~490) are read a hundred a
keyless POST to `/books`: one GET each the selection took ~2.1 s of CPU, past an Edge request's 2 s; batched ~1.2 s
(`mid_selection_time_out.txt`, this container; never measured on Supabase). It reads no payout, share or rebate
(`readsPayouts` false). Pinned: `pm_mid.test.ts` (13: the boundary at 0.33, RW's Gamma loop carried into the margin,
no RW pick among mid-pool's on 25 random worlds, no excluded id in any mid table, a failed public read failing the day's
try, its own tables only, no key read and no POST but `/books`); `src/cron_jobs.test.js` (0081 adds exactly its two rows,
every other row and job unchanged); the double's 0081 rules against PGlite 16 with 0074 → 0081 applied (each CHECK
refusal with Postgres's own name; every mid table identical to its small-pool namesake but the band, the dry-run checks,
the config's `created_at` and defaults, and the foreign key's table). **Pre-registration**
(`reviews/2026-10-02-polymarket-mid-pool-prereg.md`): d1 the first full UTC day after `pm_mid_config.created_at`, fourteen
days; `mid_check.sql` (small-pool's (a)–(g) on its tables, (f) N/A), `mid_readout.sql` (descriptive, beside small-pool's,
at R = 0.40 and at the formula) and `mid_audit.sql` (against RW's and RW-C's actual selections from 2026-10-23 00:05 UTC;
before that its scans never execute), each run on PGlite against synthetic days (a passing day passes, fourteen planted
faults each fail their own row) and frozen by sha256 in `src/pm_mid_prereg.test.js`. Not edited here: `.claude/CLAUDE.md`
(a sub-agent does not change it; the sentence for its Polymarket paragraph is in the report to the main session).

**Step 3 of 3: the page, and the rename.** Davies' "把目前Reward quotes live-prep改名为Reward quotes small-pool": the row,
its page's title and every doc that names the row now say "Reward quotes small-pool" (the map, the guide, reference §4
item 36, this ledger's item 2, code comments outside the frozen files); its tables, files, actions, ids
(`PREP_ROW_ID`), the pre-registration and the history keep their names, and `pm_live.ts` and `pm_prep.ts` are not
touched (their hashes are the ones both pre-registrations name). The dashboard reads both layers through one function,
`readPrepSummary(d, inst, …)` (small-pool's as `prep`, mid-pool's as `prepMid`), and `midRow` is small-pool's row under
its own id and name, the last row of TESTING STRATEGIES, counted in TESTING's scoreboard and the Polymarket card, with
`RwDetail` as its page (a loss stop shown on either's page, `isPrepRowId`). Pinned: `src/e2e/mid_fixture.json`, a record
of the band worked out by hand (C $20 and D $36 a day; held $11.20 against $10.80, quotes tying up $29.20, rewards
$9.00, today +$4.60, RW's worst case $4.20, the top share 60 %), proved in Deno to be `prepSummary`'s own answer; Deno
also runs `readPrepSummary` on both fixtures side by side in one database and finds each read only its own instance's
eight tables; vitest (`midRow`, `isPrepRowId`); the sweep's `mid` mode at both widths (the last two rows small-pool then
mid-pool, no row named live-prep; what mid-pool adds to the scoreboard and the card, $320, $40.40, +$4.60, +$0.40, +$9,
the card counting 6; its page's figures, days, quotes and fills; nothing wider than the screen). The guide says what the
two rows are in plain words. `dist/` rebuilt.

### [2026-10-02 02:35 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The snapshot recorder writes no price in other units than the board's (improvement plan item 6, the recorders' half).** A recorded price is permanent, and neither recorder banded what it wrote. `snapshot-record` prefers Trading 212's `currentPrice`, which the broker gives in the instrument's own currency — pence for a London stock — while the board keeps London listings in pounds (the prices function divides Yahoo's pence by 100); a London stock held at Trading 212 would have gone into `price_snapshots` 100 times its board price, for good. None has: both London holdings are USD lines (Yahoo's close over the broker's price reads 1.0038 and 1.0003 on the board row, read-only), and the table's largest move between consecutive buckets is +23.1 %. `recordablePrice` now checks each candidate's units (`unitsDiffer`: 70–140 times, either way) against the board's own last saved price (`boardPricesOf`), or without one against the prices function's: a broker quote in pence falls through to Yahoo's pounds in session and after hours, and to nothing overnight; a Yahoo price 100 times the board's is not written. Any skip is reported as `snapshot-record.units` once an hour (the hour's first bucket) while it lasts (`unitSkips`). A fuller band there (a price's move against the row before it, scaled by the name's own moves) would need the previous row read on every call and its own pins; the unit guard is the part a single call can decide. `overnight-record` needs nothing: it writes only US equities, which have no subunit, and nothing ≤ 0. Pinned: 5 Deno cases (`snapshot-record/index.test.ts`, 21 pass); the same four behaviours through the old recorder's exports fail on it (it writes 252.4 for a £2.52 stock, 252 against a board at 2.50) and pass on the new. Deploys with `snapshot-record` on push.

### [2026-10-02 02:32 UTC] Platform: Claude Code | Model: not recorded (session policy)

**A plausibility band on every holding's live quote (improvement plan item 6).** The quotes are the board's prices for each holding as `refreshPrices` hands them over — the `prices` function, the public proxies for what it leaves out, a CN fund's own proxy path — and nothing checked one between the fetch and the board. The history was read first: no recorded price was ever ×100 or ≤ 0 (production, read-only: `price_snapshots` 44,911 consecutive pairs over 26 tickers since 08-19 moved at most +23.1 % / −18.5 %, real moves; `overnight_intraday_points` 34,501 pairs at most ±15 %); the shapes met were each fixed at their own parse (pence normalised twice, in the function and the proxy parse; a proxy's own body in a 200, benched since 06-10; SFTBY's open as an after-hours price, `700d7b78`; non-prices). `src/prices/quote_band.js` now screens at the write in `app.jsx`: a quote whose last price is not a price is not shown (`quote.bad`); one passes when any of its last price and previous close sits within the band of any of the last good quote's two, the band being the after-hours guard's (`ahQuoteTolerance`, 3–15 % from the name's own five-minute bars: this tick's extended-hours series, else the 24H window's cached bars) widened by √(bars since the last good quote), never past ×5; otherwise it is held — the board keeps the last good price — reported as `quote.held` under its ticker, and the next refresh asks the other source too (`refreshPrices` now tags each quote `edge`/`proxy` and fetches the proxies for a ticker held from the function). A held quote is believed when the other source agrees, the same refresh or a later one (two paths to Yahoo), or after five minutes of one source, except a 100× quote on a London listing against this page's own last price, which only a second source can confirm. The last good quote starts from what the browser last showed (`dp.lastPrices`, ≤ 7 days, `Storage.loadLastPricesAt`); a holding with none passes. Real moves pass because they come with the close the board knows: an earnings gap or a halving, a thin listing's −18.5 % bar, a CN fund's estimate turning into its NAV, crypto past its 16:00 anchor, a +60 % week since the last visit; a split or an IPO's first minutes is held until the proxies agree or five minutes pass. The after-hours half keeps its own guard (`extPriceIsRealAh`, `extPriceLooksReal`); the band only drops an `extPrice` that is not a price or is 100× its own last price. Pinned: 25 closed-form cases (`quote_band.test.js`; removing any one rule — the closes, the strict pence rule, either second-source path, the five minutes, the non-price check — fails 1–5 of them), two fetch cases (sources and the second opinion; both fail on the old fetch), a storage case, and the sweep's `quote-band` part, 8 checks on a desktop and 6 on a phone: a proxy's 250 in a GBP body for BRIT.L is held at 2.50 (its card $312.50, the total $2,972.50 with NOVA's real −30 % from a proxy shown; unbanded $33,910), reported, listed by the errors badge, still held a minute on; ACME at 24 on a 23.80 close is held at 240 ($2,978.75) and shown when the proxies, asked, agree ($1,682.75); a CN fund's proxy relaying another fund's NAV is held at 1.50 ($3,182.50; unbanded $3,209.50). On the bundle before the band 12 of the 14 fail (only the two starting totals pass). Not banded: the market cards and FX rates, and Trading 212's own prices (what-remains item 7). Main bundle 115.02 → 116.51 kB gzipped of 122.

### [2026-10-02 02:21 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Every surface of the page has an error boundary of its own (improvement plan item 20; Davies approved items 20 and 6 on 2026-10-02).** There was one boundary, at the root of `app.jsx`, besides one per lazily loaded page for its code, so a throw in any panel replaced the whole board with RENDER ERROR. `src/app/surface_boundary.jsx` now sits around each surface: the header, both copies of the performance panel, Market Conditions and Upcoming Earnings at either width, the board (tactics or heat map), the sidebar and inside it Top Movers, the errors badge and the update banner (these two fail to nothing), every modal (position, edit, add, cash, the confirm dialog, the two lists, the transaction history, the chart, the Agents page), and inside the Agents page its list and each page opened over it. A throw shows "This panel failed to load." (a page: "This page failed to load.") with a Retry in that surface's own place, a modal keeping its frame and close; Refresh retries a failed board panel, a dashboard answer a failed Agents part; a failed confirm dialog closes as Cancel (`useConfirm`'s new `cancel`). Each failure is reported as `render.crash` (`chunk.load` for code that did not load) with the surface's name as its symbol, the stacks cut to stay inside ops-error's 2 KB context. The root boundary stays for a throw in the board's own frame; a throw in an event handler or a promise still goes to the unhandled-rejection report, as before. The sweep's hook: each boundary fails when `window.__dpSweepFail` names it, which only the sweep's init script sets. Pinned: 8 unit cases (`surface_boundary.test.jsx`) and the sweep's new `surfaces` part, 38 checks a viewport: each of 7 board surfaces made to fail shows its fallback in place while every other panel is drawn and the scoreboard reads $3,183 ($3,182.50), is reported under its name, and Retry draws it again; 14 modals and pages likewise, the failed confirm dialog removing nothing; a page whose code never loads says so in its frame and reports `chunk.load`; and the part's console errors are exactly its 21 throws. Counterfactuals on the same checks: the old bundle (origin/main's `dist/`) fails 56 of the 76 (76 failure lines), passing only the 20 Retry and Cancel follow-ons, which nothing failing makes trivial; a bundle built with the boundaries made pass-through (no `getDerivedStateFromError`, no `componentDidCatch`) blanks the page at each throw: on desktop all 21 of the 7 board surfaces' checks fail with RENDER ERROR on screen and no scoreboard, each throw reported only by the root boundary and under no name, and once the first modal fails every later check runs on a blank page. Main bundle 113.96 → 115.02 kB gzipped of 122. A data-driven throw was not used: the surfaces have no known crash to feed, and one found would be a bug to fix.

### [2026-10-02 02:20 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Polymarket's order path runs its dry-run at the $400 deposit's full size from now, and goes live only on Davies' word** (item 2, live-prep). Asked when phase 2 and the $320 start (neither was today: $320 is the total cap, set at go-time from the balance; phase 2 waited for the first live payout, 10-05 at the earliest), and given A (finish Addendum 1's window at two markets, switch after its check) or B (switch now; the window ends FAIL and the check moves to 10-03), he chose B, verbatim: "现在就切 全功率320刀，并且什么时候上线我说了算不自动转了". `0080_pm_live_full_size.sql`: `max_markets = 8, select_budget_usd = 160` on the row while it is dry-run (the cap stays $320; code ceilings 12 and $320), and 10-02's `pm_live_markets` rows out (guarded to run only on 10-02 UTC) so the path's next turn chooses the day again at that size, as Addendum 1 did on 10-01. Read first: the path chooses a day on the first turn that finds no row of it (its last try was 00:00, past the 5-minute retry); no foreign key reads `pm_live_markets`; a dry-run order of a market not chosen again expires within its 600 s; the paper layer keeps each market's tokens in its state and uses the day's list only to count missing minutes. The pre-registration's **Addendum 2** (written before its window): Addendum 1's window ends as FAIL by the rule; the window is **2026-10-03 00:00 → 10-04 00:00 UTC**, read by `prep_check_addendum2.sql` (the frozen check with its three date lines moved a day; sha256 `8b72a9d2…65f0` pinned in `src/pm_prep_prereg.test.js`, which also holds it line for line to `prep_check.sql`); its CTEs run read-only before the window parse and read FAIL where they should (no window yet; b3 still 2 / $40). **No session or routine runs the go-time statement any more**: the check's rows are reported to him, and the path goes live, at eight markets, only in the conversation where he says go. The routine at 10-03 00:15 (`trig_014N6zxm3dqcQLMqUut3NKND`) is moved to 10-04 00:15 and rewritten to run the check and report, never to arm; the 09:00 health check names Addendum 2. Reference §4's live-prep paragraph, the design doc's step 15, the guide (eight markets; live only on his word) and `docs/map.md` say so. **Verified in production:** `0080` applied by 02:23:16 UTC (the row reads 8 markets, $160, cap $320, dry-run, unarmed); the path chose 2026-10-02 again at 02:24:01 UTC in one run, eight markets; both states moving (the layer two minutes behind), no `last_error`, no `ops_errors` since 02:20.

### [2026-10-02 02:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

**One Trading 212 → Yahoo ticker map, `_shared/t212_tickers.ts`, and the snapshot recorder takes the broker's price only where the board shows it** (improvement plan item 9, approved by Davies on 2026-10-02 through the main session). The map was three copies, in `trading212`, `overnight-record` and `snapshot-record`. The recorders' two were identical to each other and had drifted from the function's: six aliases, not nine (none for `2DGd_EQ`, `XFABp_EQ`, `CSPX_EQ`), no share-class rule (`BRK_B_US_EQ → BRK-B`) and no digit in an LSE symbol (`QQQ3l_EQ → QQQ3.L`). Over 527,632 distinct inputs (production's codes, every code the tests named, a structured corpus and a seeded fuzz) the shared function answers as `trading212`'s did everywhere except nine `Object.prototype` names ("constructor" returned the `Object` function; now null, by `Object.hasOwn`), and as the recorders' did wherever they answered; each input they left null and it maps is an alias, a share class or an LSE symbol with a digit. All 69 codes in `t212_orders` map to their stored ticker, checked against production on 2026-10-02; the recorders' copies got five of them wrong. **The recorder's source, by the main session's rule:** `snapshot-record` records Trading 212's price only for a US listing (no "." in its Yahoo ticker; a share class such as BRK-B counts) and for VUAA.L / SAEM.L, the board's own list (`T212_LIVE_PRICE_TICKERS`, `src/portfolio/trading212.js`), and everything else from Yahoo, as the board shows it, with the overnight rule unchanged (`recordsT212Price`, applied in `extractT212Prices`). Taking the newly mapped 2DG.SG from the broker would have put the 24H chart's recorded points on another source than the board's live price and its right edge (the two stood 0.57 % apart at 01:17 UTC), and flipped a sample between the two whenever the Trading 212 call failed. Against 524f3670 no held ticker changes source: the 24 Trading 212 held at 01:17 UTC (`trading212_cache`, both accounts, names only), each run through both versions of the recorder at 05:00, 10:00, 17:30 and 22:00 EDT, take the same source in all 96 cases. Two classes nobody holds do change: a share class (Yahoo by day and nothing overnight, now the broker) and a letters-only LSE code other than VUAA.L / SAEM.L (the broker, now Yahoo by day and nothing overnight). **A finding, not a defect:** 2DG.SG is in no snapshot during the US overnight session (0 of 293 rows from 00:00 to 07:59 UTC between 09-25 01:30 and 10-02 01:30, against all 703 from 08:00). By design a ticker absent from a row leaves the chart on Yahoo's own bars, or on its previous value where there are none (Stuttgart is closed until 06:00 UTC), which is what the board shows. **Pins:** `_shared/t212_tickers.test.ts` pins both tables whole and both rules on generic and made-up codes (case, a share class, digits, other exchanges' letters, frozen tables, inherited names); it fails 2 of 7 against `trading212`'s old copy and 6 of 7 against each recorder's. Each function's `index.test.ts` pins that it reads the shared map (the identity, and a case driven by the shared tables): on 524f3670 `trading212` fails 1 of 61, `overnight-record` 2 of 13 and `snapshot-record` cannot load (no `recordsT212Price`); an identical local copy fails the identity, and a dropped import fails at load. `snapshot-record`'s source pin (2DG.SG from Yahoo by day and absent overnight; VUAA.L, a US name and BRK-B from the broker; QQQ3.L, CSPX.L and XFAB.PA from Yahoo) fails all three of its cases on this change's first draft, which took every mapped code from the broker, and all three on 524f3670, on BRK-B. The improvement plan's summary line had said two more done than its table since the 09-28 re-check (that day 13 against 11); it now reads 16 done, 10 open. A `_shared/` change redeploys every function on push. Committed on branch `worktree-agent-a083903695f646f60`, not pushed: the main session integrates. The board's own list (`T212_LIVE_PRICE_TICKERS`, `src/portfolio/trading212.js`) and the recorder's (`BOARD_T212_PRICED`) are held to each other by a vitest case in `src/portfolio/trading212.test.js`, which reads both files; with CSPX.L added to the recorder's alone it fails.

### [2026-10-02 01:57 UTC] Platform: Claude Code | Model: not recorded (session policy)

**A live fill is booked at the pounds or dollars the venue moved, not at its rounded average** (Davies: "“成交记账精度” - 这个做"). Revolut X moves the quote currency in whole hundredths (a sell's credit floored, a buy's debit rounded up), reports that as `filled_amount`, and derives `average_fill_price` from it at the pair's price step; the client booked the average, so fill 1184 (13.18565 USDT, credited £9.99) was booked at 0.7576, £9.98945, and PR5's first trip read −£0.0105 where the account lost £0.0100 (up to ~£0.0007 a £10 fill, against ~£0.01 a 0.1 % trip earns, in the live page and the daily loss stop). `toOrderView` now prices a fill at `filled_amount` ÷ the GROSS quantity, unrounded (`fillPrice`, `_shared/revx.ts`), and at the average only when the reply has no usable `filled_amount`; both consumers book it as it comes (`quotes_live.ts`, `tick.ts`). Unchanged: the missing-field guard (`average_fill_price` still required), D4's net coin fee (now valued at that price, so the coins held and the fee cost exactly the debit), D8, D11, D12, `rungBase`, `pennyExit`, `dustBase`. **Verified first, read-only:** all eight live fills (PR5 1154, 1158, 1184, 1186, 1309, 1314; trend-4h-live 37, 44) store `filled_amount`; PR5's GBP moved exactly −£60.00, their sum, from probe 118271 to the executor's 01:31 UTC balance read (the averages say −£60.00053), its USDT and USDC equal the booked bases; the live row's USD moved −$0.66 from its $100 to probe 106565 ($25.01 debited, $24.38 credited, $0.03 fee; the averages say −$0.66006). The venue rounds fees up too (0.000187 SOL for 0.00018612; $0.03 for $0.021942). **Pins:** the eight stored replies through `toOrderView` (`revx.test.ts`); fill 1184's shape (£9.99 booked, its buy-back at the debit, the rung's book equal to the account's pounds) and a 1154-shaped taker conversion (£30.00 booked, 39.58399 net) through the executor (`quotes_live.test.ts`); the live row's round trip through `tick`, its P&L the account's dollars (`lifecycle.test.ts`). `FakeRevx.settlement = "venue"` (`testing.ts`) is the venue as measured, and answers 1154 and 1184 field for field; the default stays "exact" (no `filled_amount`, the fallback path). Counterfactuals: the old client fails 7 (the six new pins, e.g. "9.989448440000002 ≠ 9.99", "booked 29.99999898", the tick's "booked 19.999999435499998, debited 20", plus the documented reply's re-expected 239.98 / 0.002); the fallback removed fails the fallback pin and five older tests; D4 dropped fails five. The page test's two-trip fixture now carries the corrected prices (−£0.0100, +£0.0092). Reference §4 items 24, 32 and 35 (35's "books … right throughout" marked corrected). A shared module: the Edge workflow redeploys every function (`pm_live.ts`, `pm_prep.ts` unchanged). **The eight rows already booked** are re-priced by `0079_live_fill_prices.sql` (its own commit), from each row's own stored reply by the same rule: PR5 1154 0.7572 → 0.757200025745…, 1158 0.7579 → 0.757900161812…, 1184 0.7576 → 0.757641830323…, 1186 0.7584 → 0.758400230554…, 1309 0.758 → 0.757999548232…, 1314 0.7573 → 0.757300100064…; live row 37 120.94 → 120.938689258652…, 44 118 → 117.998954562175…; the three coin fees re-valued at the new price (1154 £0.027001752 → £0.027001752918…, 1158 £0.027003977 → £0.027003982765…, 37 $0.02261578 → $0.022615534891…); every row then books its `filled_amount` (dry-run as a read-only SELECT of the file's own expressions). `db push` runs in about a minute and the Edge deploy only after the whole Deno suite, so a fill settled between the two would keep its average: push the code commit first and the migration after its deploy, or, after both, read `avg_fill_price` against `filled_amount ÷ filled_quantity` on every live fill (all eight top-level replies; nothing should differ by more than 1e-12). The working-with-davies skill (and its two Cursor copies) gains point 5 of what he accepts as evidence: money is checked against the account's balance, never by the ledger agreeing with itself.

### [2026-10-02 00:58 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5's conversion rests at the bid, a maker's 0 %, for the next time capital is added.** Davies: "改吧，以后加仓可以用" (to: convert with a 0 % maker order instead of the go-live's two taker IOCs, £0.027 each). `runQuotesConvert` now posts a post-only, good-till-cancelled buy at the top of the bids (one tick over the best bid when the spread leaves room, else at it), sized at its own price, with no fee in its GBP check; it is refused while a conversion of the book already rests. The minute loop books its fills as every live order's (the generic read-back), and cancels it on a global pause, whenever the executor is not live and armed, and after 24 hours unfilled (`QUOTE_LIVE_CONVERT_REST_MS`). `"taker": true` keeps the IOC for coin wanted at once. Nothing is converting now; the next use is a capital raise. Pinned in `quotes_live.test.ts` (the price on a wide and a one-tick book, the size, post-only and GTC, one a book, the fill booked at 0 %, the three cancels; the old test now asks for the taker); without the cancel loop the pin fails. Deploys with `agents` (PR5's executor; `pm_live.ts` and `pm_prep.ts` unchanged).

### [2026-10-02 00:39 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The live stablecoin page lists only what is still working, and calls a resting order "open".** Davies: "Stablecoin quotes里如果ENTRY ORDERS和EXIT ORDERS都filled的行（已经两边交易了的）就都删了，因为已经在EXIT ORDERS了，另外state中new改成open是不是更好些" (read as: both are already in ROUND TRIPS). `quotesLiveDetail` leaves out the orders of every closed round trip (`LiveTrip.ids`, the fills `tripEnds` cut into the trip: its entries and its exit or stop), so EXIT ORDERS holds the exits resting and ENTRY ORDERS the entries resting, refused, or filled on a rung still holding. The venue's "new" reads "open" (`orderStateText`) there and on a strategy's ORDERS, one word on every page. Pinned: the fixture's three closed trips' six orders out of its eighteen (Deno), `orderStateText` (vitest), and the sweep's two tables at both widths (two exits, eight entries, the held entries last, no "new"). **His next question, why ROUND TRIPS' fees are so high, and whether a 0 % maker order could not convert:** every PR5 trading fill is a maker fill at 0 % (`fee_gbp` 0 on all four); the fees column is each ask trip's share of the two conversions that bought the asks' coins at go-live, marketable IOCs at the 0.09 % taker fee, £0.0270 on each £30 (orders 1154, 1158). An ask trip selling 13.19 converted coins carries 13.19 / 39.58 of it, about £0.0090, nearly a 0.1 % rung's whole edge on £10. Once a book's converted coins are sold (USDT: one more ask trip after the two so far; USDC: three) its asks carry none: they sell coins earlier exits bought back at 0 %. A post-only conversion at the bid would have paid nothing; `quotes-convert` is still the IOC, and making it rest at 0 % is offered to him for the next conversion (when capital is added).

### [2026-10-02 00:14 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Live-prep at 00:14 UTC: Addendum 1 in effect, 10-02's selection landed, nothing faulted; and a disclosure of reads made before the check.** The routine's check, read-only and limited to what the pre-registration allows before its check: 0074's placeholders are gone and 2026-10-01 has its two selected rows (the addendum took effect); 2026-10-02's two rows landed at 00:00:01 UTC; `pm_live_state` and `pm_prep_state` were moving (00:14:01; last decided minute 00:12) with `last_error` null; `ops_errors` had nothing since 23:50; PR5's executor was fresh with no error. The routine's prompt also asked for the window's class counts, and the 09:00 routine's for minute coverage and the shares of diverged and formula-positive market-minutes: those are the check's own inputs, which the prereg keeps unread until the check ("nothing of the window is read before the check, except the health scalars a fault needs" and, by the addendum, whether each day's selection landed), so they were not read and the 09:00 routine's prompt was narrowed to the allowed reads. **Disclosure:** while building and verifying the live-prep page on 2026-10-01 22:16–00:04 UTC, this session read figures of the window beyond those scalars: `pm_prep_state`'s per-market accounts (rewards to then, nets, fill counts: no fill), the last decided minute's class, quote, reward and rate per market, and 2026-10-01's day row (its rewards, no fill, its matched, dark, diverged and missing minute counts). Nothing was decided on them: the check is frozen SQL at its pinned hash, `pm_live.ts` and `pm_prep.ts` are unchanged, and the only deploys inside the window (22:41 and 00:02 UTC) changed the dashboard's view and PR5's executor. The page itself shows the row's figures to whoever opens it, as it has since it landed.

### [2026-10-02 00:00 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The live stablecoin page: exits and entries in two tables, sizes on a phone, and a round trip that ends where the executor calls its rung flat.** Davies: "live的stablecoin quotes也面中orders表拆成两个，上面是Exit orders（没有Exit orders的话就不显示）下面是Entrence orders，side列都只显示buy/sell（conversion也删了，这列和其他列等宽…）并且price右边加size列，round trips表格exit右边也加size列…另外现在我看order表里exit filled了两个为什么round trip里只有一个". Why one trip for two filled exits: the second trip's exit (order 1314) was trimmed to the penny the venue rounds to (`pennyExit`: 13.1916 USDT for £9.99, not 13.19262 for £10.00) and left 0.00102 USDT owed. That is under the book's dust (about 0.13 USDT, the venue's £0.10 minimum), so the executor calls the rung flat and carries the hair, but the page cut trips at exactly zero and held the trip open, drawing the rung as holding. The executor now saves each book's `dust` in its state; the page's `tripEnds` closes a trip at that dust over every fill so far, books a conversion fee there and calls a rung holding only over it, and a trip's P&L is what it added to the rung's realised. The first trip's prices read past their limits (sold at 0.7576 under a 0.7584 limit, bought at 0.7584 over 0.7578) because the venue's `average_fill_price` is its penny-rounded pounds over the coins: credited £9.99 for £9.99999696, debited £10.00 for £9.9920856. That is real money, −£0.0105 on the trip, and is why `rungBase`/`pennyExit` came in that afternoon. The page: EXIT ORDERS (exit and stop legs, only while there are any, a stop marked under its time) above ENTRY ORDERS; each side buy or sell alone; the conversions in neither; Size at every width in both and in ROUND TRIPS. On a phone every column of the three now fits the screen (a time stacks its date over its clock, a book shows its coin, a size its number, the cells sit closer): ROUND TRIPS' P&L had sat off the screen's edge before. "Entrence" is written ENTRY. Pinned: Deno with the two trips' own fills (−£0.0105 and +£0.0092, adding up to the rung's realised; one trip without the dust; a conversion fee booked at the dust), the executor's state carrying the dust, and the sweep at both widths (both tables, buy or sell only, no conversion, Size shown, every column inside the screen, no EXIT ORDERS when the page has no exit). Asked the same evening why live-prep's Held column is empty: it has no fill yet, so it holds nothing; its deployed is its resting quotes' collateral and its gain the formula rewards. Nothing to fix.

### [2026-10-01 22:53 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`bin/gates.sh` runs the browser sweep as four processes at once, two a viewport, each on a port the system has free.** Davies, ~20:10 UTC: "gates的运行还可以更快吗 还有没有可以一起并行跑的内容". The sweep held up the bundle line: on an idle 4-core machine origin/main's `sh bin/gates.sh --full` took 247 and 240 s, its bundle line 246 and 239 s, of which the phone half 227 and 228 s beside the desktop half's 180 and 179 s and the perf matrix's 48 and 50 s. A viewport's sweep is nine tenths waiting on its pages (the phone's alone: 222 s of wall time on 22 s of CPU), so processes side by side cost almost nothing. By part, alone (desktop / phone, s): sections 0–0d 36.7 / 88.9, sections 1–8 on their one page (`main`) 123.7 / 119.9, the viewer 1.1 / 10.8. `SWEEP_PART` (`src/e2e/app-sweep.mjs`) runs the parts named, or with `-name` every part but those; each part is guarded at its own header line, so nothing moved or was re-indented, and unset every part runs, as CI runs them. gates.sh runs `main` and `-main` for each viewport: a viewport's last shard takes every part its others leave out, a part added later included. `SWEEP_PORT=0`, and the perf matrix's new `PERF_PORT=0`, listen on a free port and read it back: the fixed 8931–8933 collided whenever two gate runs, or a gate run and a sweep by hand, shared a machine. Nothing is checked less: origin/main's sweep run whole, as CI runs it, printed 485 checks besides its two invariants, and the four shards printed the same 485 (desktop 241, phone 244) besides two invariants each; sorted, the lists differ only in the 8 lines whose figures are timings (read counts, a first paint's ms, the tick's seconds), which differ between any two runs of one build, and with those masked they are equal.

**The sweep's `desktop/tabs/none` read the Agents page while it was still rising in; `openAgentsPage` now waits for the rise to end.** It failed twice on 2026-10-01 under load, once in a shard beside a full gate run of the main session's and once in a whole run of this branch with `SWEEP_PART` unset, which runs main's lines: its first read of the venue cards came 150 ms after the tab bar appeared, while the desktop modal's 0.22 s `modal-in` rise (a `translateY(12px)`) could still be running, and its second, after a tab round trip, at rest. With the rise slowed to 2 s it fails every time, the two reads differing only in `top` (436 and 427 px), and no other check does. `openAgentsPage` now also waits until no animation runs on a `.modal` itself (the rise is the only one there; a phone's modal has none): with the rise slowed, the desktop's `main` passes 215 of 215 with the wait and 214 of 215 without it.

**The sweep no longer waits out timeouts that can only expire: 60 s of every desktop run and 130 s of every phone run.** Every Playwright call that took a second or more, logged with its line: two reads of elements their checks require absent (the quote page's live line, RW's `.ag-rw-when`) each waited out `textContent()`'s 30 s default at both widths, and on a phone four waits for `.perf-legend-item` to show (15 s each) and the viewer's for `.perf-lbl` (10 s) watched the panel's first copy, the desktop column's, which a phone never shows. The reads now read without waiting (`allTextContents()`; the comparisons are unchanged, and the live line's check already counted the line without waiting) and the waits watch the copy on screen (`:visible`). Alone on an idle machine the sweep took 99 s on a desktop (165 before) and 92 s on a phone (222); by part (desktop / phone, s) sections 0–0d 33.2 / 30.0, `main` 64.7 / 60.4, the viewer 0.9 / 1.0, and no call waits a second or more but the sweep's own three pauses. Checked as the shards were: run whole and in its four shards, it printed origin/main's 485 checks, the lists equal but for the 8 timing lines. `sh bin/gates.sh --full` on an idle 4-core machine, no other checkout's process running: origin/main 247 and 240 s (its bundle line 246 and 239 s); with the shards and without this commit 157 s (the bundle line 157 s, its slowest shard the desktop's `main`, 148 s); with this commit 107, 109 and 107 s (the bundle line 106, 109 and 106 s: shards 96–100, 61–62, 90–92 and 52–53 s, the perf matrix 56–61 s), every run green. The unit tests (84–86 s) and the Edge tests (85–86 s) now end within seconds of the bundle line, so it is no longer the one thing to wait for.

### [2026-10-01 22:40 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Reward quotes live-prep's page is Reward quotes' page.** Davies: "把“Reward quotes live-prep”策略的子页面改成和其他Reward quotes子页面一样". `PrepDetail` is gone and its row opens `RwDetail`, fed by `prepSummary` in `rwSummary`'s shape: a view change, with `pm_prep.ts`, `pm_live.ts` and their tables untouched inside the frozen window (`agents` redeploys; the 21:47 deploy cost the layer no minute, `minutes_missing` 0). STATUS is RW's: the worst case is `accStress` on the layer's own account per market (RW's `Acc`), then the best market's share of the total, markets quoting, positions held. DAYS are RW's too: a closed day is its change since the close before (`fills_pnl_total` less the close before's, plus its rewards) and today the total less the last close, so the days add up to the total; TODAY on the row and in TESTING's scoreboard moves with it (the fixture's +$1.17 reads +$1.47). The path's own day figure, every holding against its cost, stays with its day stop and `prep_check_addendum1.sql`, and the R = 0.40 figures left the page for the check alone. Costs are the day's selection's `pm_live_markets.capital` (N × (b + 1 − a), the path's own measure; RW's also count the largest inventory). `pm_prep_days` keeps no worst case (no column, frozen until 10-03), so a closed day's reads a dash, and today's once a day has closed. QUOTES has RW's columns: the share of the pool from the minute's formula reward (rate / 1440 × share, the rate from `pm_live_minutes`), holdings by token ("5 Yes · 4 No": the path buys NO where RW sells YES and nets nothing), each market's rewards (its account's) and orders (`bookPnl` on its two tokens), which add up to the total (`mismatchUsd`), and why a market has none of the rule's quotes resting. FILLS are the path's token trades. A day stop now shows only on its own UTC day; it read "tripped" on every day after (pinned). Pinned: the hand-worked record gains each market's account (worst case 0.69 + 0.31 = 1.00; A 1.00 + 0.39 = 1.39, B 0.70 + 0.28 = 0.98; top share 59 %; today 2.37 − 0.90 = 1.47; costs $24.30 and $24.34; shares 3.6 % and 2.88 %) and a day later (17 Sep +1.75, today 0, the days the total) in Deno; vitest pins the unknown worst case, holdings, fills and stops; the sweep reads the page as RW's at both widths. Read-only on production: the last minute's shares are 5.6 % and none (a quote too wide to score). Gates green.

### [2026-10-01 21:47 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The Reward quotes rows' DEPLOYED is every dollar at work too: what their resting quotes tie up and what they hold.** Davies: "按照同样的逻辑“Reward quotes live-prep”为什么deploy目前是0需要改吗？" — live-prep's deployed was what its paper inventory held, nothing yet. The quotes' collateral is counted as RW counts a market's first quotes' capital (`firstCap`): a resting bid N × b (its Yes), a resting ask N × (1 − a) (its No), N the market's quote size, from each summary's latest minute (`rwSummary` for RW, RW-E, its variants and RW-C; `prepSummary` for live-prep, close-only minutes counting nothing beyond what is held); the rows add it to what is held, and keep `heldUsd` so the scoreboard's unrealised base does not move. Display only: no rule, record or verdict of the frozen reward tests reads it, and no production figure of theirs was read for it. Pinned: live-prep's hand-worked record, 5 × 0.46 + 5 × 0.52 + 20 × 0.201 + 20 × 0.771 = $24.34 quoted, so $33.11 with its $8.77 held (the function's output equals it); RW's test market, 20 × 0.49 + 20 × 0.49 = 19.60, its selection capital, and 9.80 with the bid withdrawn; the rows and the scoreboard's unchanged base in vitest; the sweep's fixtures carry what the function would send (RW 58.80, RW-E and its variants 39.20 each, a variant not started 0) and it reads TESTING's DEPLOYED $1,429 (25.70 %), the Polymarket card $207.60 (5.19 %), the venue bar 85 % / 15 %, live-prep's page $33.11 (10.35 %), RW-C's row $44.80.

### [2026-10-01 21:30 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Variant-1 and variant-2 take the live design's governor, 900 / 950, and re-decide from 2026-09-28** (PR5V's deviation 2, variant-2's deviation 3; reference §4 items 45 and 47). Davies asked why the two variants had not taken the new DEPLOYED: they had, but at 21:22 UTC every key of both had reached 600 POSTs (variant-1 600, 630, 600, 667; variant-2 600 each), so all 36 rungs of each judged arm were withdrawn until midnight and nothing was at work. He then asked for the paper tests' limits to be the live executor's ("把这几个paper testing的策略下单上限也都改成900/950，和live那个一样"); PR5V's §2 holds each key to the live design's governor, which went to 900 / 950 that day. Both engines' arms take 900 / 950, and the code versions (3 and 4) re-decide each record from its start on the stored inputs. The golden replay keeps the golden's 600 / 700, since the minute function reads its arm's limits; the arms' limits are pinned, and with 600 / 700 put back three tests fail. PR5's own paper engine has no POST governor at all (the page's 1,000 is the venue's limit, shown for reference), so it does not change; he asked, and was told so.

### [2026-10-01 20:59 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Stablecoin quotes value coins at Revolut X's index price, and DEPLOYED is every pound at work.** Davies, on two screenshots of his Revolut account beside PR5's live page: "这两个地方的UNREALIZED G/L为什么不一样，另外这里的DEPLOYED应该是120毕竟每一笔钱都quote出去了？", then "你这些做好后把testing页的几个Stablecoin quotes也同步". Measured: the account marks a coin at the ticker's `index_price` (USDT 0.7570, the index, where the mid was 0.7573), at its average cost with fees; the page marked at the last trade (0.7588 / 0.7576). At the index, USDC's unrealised is the account's; USDT's differs only by the round trip the page books as realised (−£0.0195) and the account folds into its average cost. `0078` adds `agent_quote_tickers` (a row a book, replaced), written by `books` after its levels from one keyless read of `/api/1.0/public/tickers` (none after a 429 or past the budget); the dashboard reads it, and an index more than 10 minutes old falls back to the last print (`liveIndexPrices`). The live page: UNREALIZED, BOOKS and INVENTORY at the index, the price beside each coin; DEPLOYED is the coins at the index and the pounds its resting buys tie up (`liveRestingBuysGbp`; the fixture £999.14 of £1,200, 83.26 %). The paper test and both variants: DEPLOYED is each quoting rung's share of the capital and what the held rungs hold (`quotesDeployed`), held rungs marked at the index; their unrealised percent stays on what is held, in the row and in TESTING's scoreboard and card (`heldUsd`), so the base did not move. VENUES' share bar leaves blank a slice too narrow even for its percent: with the quote tests' deployed, Polymarket's 2 % slice was 9 px on a phone and painted the middle of "2%" (counterfactual: the old slice fails the sweep's fit and pinch checks on the phone). Pinned: Deno 54 (coins at the index by hand, the resting buys, realised + unrealised = account value − capital, paper deployed, the ticker read's 429/503/budget), vitest 111 (the scoreboard's unrealised base unmoved by quoting rungs), the sweep (PR5 page £999.14 (83.26 %), BOOKS at the index, INVENTORY with its prices, TESTING $1,252 (22.53 %), the Revolut X card $1,221 (88.50 %), the variants' £2,727, the share bar 98 % / 2 % and the pinched slice; sums compared at the scoreboard's whole dollars from $1,000). `docs/map.md`'s row for `0078` came in the next commit: reading that file had been refused by the session's permission classifier at 19:58 UTC (while a migration that deleted rows was being prepared), so this commit waited on `claude/relaxed-sagan-yuzaf0` (no workflow runs there) until Davies' word ("可以读 map"), and the two went to main together.

### [2026-10-01 20:44 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The browser sweep's `perf-refresh/tick` flake was a race in the app, fixed: a chart row's age now counts from when its fetch was asked.** The check missed +6.08 % three times in ~12 full gate runs on 09-30/10-01, never alone, and bimodally (about a second, or never in 20 s). Reproduced with the section cut out of the sweep, four copies at once under eight busy loops, and traced with `[DBG]` logs in a scratch build: the button's refresh also runs `prefetchAllChartData`, whose 24H batch was asked at 23:00:00; under load it landed after the test moved the page's clock to 23:06 and was stamped on arrival (`ts: Date.now()`, 23:06), so the catch-up's refresh found every 24H row fresh (`stale=[]`), fetched nothing and drew nothing, and the panel kept the button's +5.04 %. In 40 traced runs that late landing happened 6 times, and those were the 6 failures (over 9 traced failures the late row held the new 5304 six times and the old 5252 three times); a fixed clock never ages a row, so the panel never recovered. A phone locked with a refresh's fetch out does the same for one TTL. Fix: every writer of the chart-range rows stamps `ts` before its request goes out: the panel's window load and its benchmark retry, its refresh and its other-ranges warm-up (`perf_chart.jsx`), and `prefetch.js`'s range block (the modal rows from that fetch too). Pinned by three cases in `perf_chart.reload.test.jsx` and one in `prefetch.test.js`, each failing on the old code (a refresh six minutes on asks for nothing; 23:06 stamped where 23:00 was asked); the warm-up's fails on its own with only its hunk reverted. Counterfactual, both builds side by side under one load: unfixed 10 of 100 failed, fixed 0 of 100 (all batches: 29 of 300 against 0 of 220; in 4 fixed runs the prefetch landed after the jump, stamped 23:00, and the tick fetched). The sweep's comment now says what the misses were; its 20 s wait stays (it ends when the reading arrives; fixed passes took 0.2–3.4 s). `docs/map.md`'s prefetch note says how a row ages. Left as they were: the MA and P/E rows (12 h TTLs) and the modal's own fetch still stamp on arrival; and the panel still draws only rows it fetched itself, so a row another writer asks for after it, inside the TTL, waits for the next stale refresh (in the sweep that needs the button's refresh to end after the clock moves: 0 of 80 traced runs).

### [2026-10-01 20:09 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Reward quotes live-prep starts now, not at 00:00 UTC: the pre-registration's Addendum 1.** Davies, ~19:52 UTC, on the note that the path would first quote after the 00:00 selection: "改为现在就开始测试，可以测试今天剩余时间+明天一整天". The path chooses a UTC day's markets once, on the first turn that finds no row of the day in `pm_live_markets`; today's two rows are 0074's placeholders (no reward rate, no maximum spread), on which RW's quote rests nothing. Taking them out makes the next turn choose today's markets by RW's ranking with the code unchanged (`pm_live.ts`, `pm_prep.ts` at their frozen hashes). The addendum (`reviews/2026-10-01-polymarket-live-prep-prereg.md`) records his words and that statement, and opens the window on the first full UTC hour after today's selection (the first `selected_at` of 2026-10-01's rows with a reward rate), closing 2026-10-03 00:00 UTC: a window defined by the selection's own record, so it is frozen now whenever the statement runs. Its check is a new file, `prep_check_addendum1.sql` (sha256 `b49b9fc5…`, pinned by `src/pm_prep_prereg.test.js`; `prep_check.sql` untouched, as its header requires): the frozen bars, (a1)/(a2) as shares of the window's minutes, (a3)/(b)/(e) on each of the two days, (c)/(d)/(g) on the window (g from `pm_prep_minutes`). Run read-only before the window, with the placeholders still there, it parses and reads FAIL where it should; changing one bar fails the pin. A fix before 10-02 00:00 leaves 10-02 as the first full day after it, which `prep_check.sql` then checks as frozen, so the go-live time does not move. **The statement has not run:** the Supabase connector's `execute_sql` timed out twice (20:00 and 20:01 UTC) on it, waiting for a confirmation that never reached this session, and a read-back shows both placeholder rows still in place; a migration was not used (its map row could not be read here). Davies runs it in the SQL editor or confirms it in the connector; item 2's live-prep sub-item and item 6 have it word for word.

### [2026-10-01 19:08 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5's live page rebuilt on Davies' word, and every stablecoin quotes figure in pounds.** His asks, 18:30–19:00 UTC: "scoreboard里的(incl. fees $0)怎么没算底下的货币转换费"; RUNGS → the paper page's BOOKS; DAYS under INVENTORY; the conversions table and FILLS deleted; "ROUND TRIPS表格里的fees列加上那笔所用的货币转换费，并也计算到后一列的p&l里"; ORDERS' side without the word "entry" (he then asked for ORDERS to go, and took that back: "这句话当我没说过"; it stays the order history, since current quotes would repeat BOOKS); from his exchange account's screenshot, the coins' own unrealised P&L on the scoreboard; and "法币金额都应该是英镑而不是美元吧，可以在agents页的汇总scoreboard里换算成美元显示，这个逻辑在testing页面也一样". Server (`agents/index.ts`): `liveConversionShares` gives each live ask entry the conversion fee of the coins it sold (FIFO per book, a later conversion gives an earlier fill nothing), `withConversionFees` books it on the fill that closes the trip, so a trip's fees and P&L carry it and the trips still add up to REALIZED; `liveCoinBooks` marks the account's coins (the executor's last balances, else the book's own count) against their cost — conversions paid, less fees booked to trips, plus what the holding rungs paid or sold for — for UNREALIZED, DEPLOYED and INVENTORY; `liveDays` (rungBook increments, conversion shares included, so the days add up to REALIZED); `QUOTES_LIVE_ORDERS_FILTER` drops empty cancels where ORDERS is read; the events, conversions and status reads are gone. Pounds beside the dollars in `quotesLiveSummary` and `quotesSummary` (a paper trip's pounds are its own `qty × Δprice`, `quoteTripGbp`; its $ capital at the books' rate). Client: rows carry `ccy`/`gbp` (`rowMoney`), the table, cards and both quote pages show pounds, `QuoteBooks`/`QuoteDaysTable` shared; `dropDot00` drops the sign of a pound amount that rounds to zero ("-£0" was showing). The executor's loss stop is untouched: TODAY is still its reading less the conversion fees of trips closed today. Pinned by closed form: the fixture's realised + unrealised = its account value − capital (−£0.0355687, exact), D's share 132/395.6436 of £0.2697948; vitest pins the rows' pounds and the formatters; the sweep reads the hand-worked pounds on both pages and both tables, and LIVE's dollars ($791.03 deployed). Production read-only: 2 conversions (£0.054 fees), one completed ask trip, which now carries about £0.009 of them. The working-with-davies skill records both rules.

### [2026-10-01 19:01 UTC] Platform: Claude Code | Model: not recorded (session policy)

**"Reward quotes live-prep" on the Agents page.** The last row of TESTING STRATEGIES, on Polymarket, on the order path's total cap ($320), counted in TESTING's scoreboard and the Polymarket card as RW's rows are; its page: the scoreboard (realised split into rewards and orders), FIGURES (rewards at the formula and at R = 0.40, the fills' P&L, holdings at the mid), DAYS (each day's fills P&L, rewards, at R = 0.40 and the day at R = 0.40, today first), QUOTES (today's markets, the bid and ask the path rested, Yes and No held, the mid) and the newest FILLS; amber while a paper stop holds it close-only. Server: `prepSummary` (`agents/pm_prep_view.ts`) from the layer's own records by its own `paperPnl` (the path's `tokenBooks`/`bookPnl`), counting only what the state has decided; in `runDashboard` as `prep`, in a try of its own. Pinned: a record worked out by hand at the sweep's clock (`src/e2e/prep_fixture.json`: held $8.77 at the mids against $8.35, fills +$0.67, rewards $1.70 and $0.68 at R = 0.40, realised +$1.95, a fill of an undecided minute left out), whose `output` the Deno test proves is the function's own answer; vitest (`prepRow`); the sweep's `prep` mode at both widths (the row, what the scoreboard and the card add with it — exactly $320, $8.77, +$1.17, +$0.42, +$1.95 = $1.70 + $0.25 — the page's figures, and hide-values).

### [2026-10-01 18:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**"Reward quotes live-prep": Polymarket's order path is paper-traded for a day before it goes live** (Davies, ~18:15 UTC, verbatim: "Polymarket的准备好的live策略是不是从来没有paper trading测试过？要不要先上线Reward quotes live-prep测试一下？有问题也及时修复，然后我们操作账户和转账问题，纸面测试24小时之后再验证一遍没问题自动上线？"). `0077` and `agents/pm_prep.ts` (`agents?action=pmprep`, every minute; its `edge_calls` row has `retry` true, the reason in the header): two minutes behind the clock it reads the path's own dry-run record (`pm_live_minutes`, `pm_live_orders`, read only) and, for each market-minute where what the path rested after its turn is RW's quote on the very row it decided on (`matched`), decides it with RW's frozen `stepRw` on that row and the market's public prints — the fills, the 3N stop on the PAPER inventory, the reward line; nothing rested is `dark`, anything else `diverged` (not quoted, counted). Fills are booked as the path books its own (`tokenBooks`, `bookPnl`, `settlementFills`, marks at the touch mid of the book the path read); the path's −$25/−$75 stops act on paper as live (then `closeOnly`'s sells only, each side alone through `stepRw`); a held market Gamma shows resolved settles at its payout; days close with rewards at the formula and at R = 0.40. It writes only `pm_prep_*`. Pinned (`pm_prep.test.ts`, 11 tests): a hand-worked day (through and at-the-price prints, a NO print, a GTD expiry, a re-quote, a divergence, a missing minute: YES 9 at 4.07 and NO 5 at 2.65 marked at 0.47 → +$0.16, four of RW's reward minutes); a settlement (+$2.28 at payout 1); the day stop (−$25.80 at t3, then a SELL of YES at 0.03 × 20 alone, −$25.60); prints never skipped, a dropped public read made again once (a second failure is the fault); the day row; RW's golden day fed as the path would rest RW's quotes — rw_test.py's fills, inventory and rewards on 20 of 29 markets, RW's fills up to the stop on the 9 the −$25 stop stops; and the path's dry-run identical minute for minute over 40 minutes with the layer on and off. 12 single-rule removals each fail a pin. Pre-registration frozen before its window (`reviews/2026-10-01-polymarket-live-prep-prereg.md`; window 2026-10-02 00:00 → 10-03 00:00 UTC; (a) turns ≥ 1,426 of 1,440 minutes and ≤ 14 fault minutes, the layer through 23:59; (b) one selection by 00:10 inside the rules, phase 1; (c) post-only, sizes, caps; (d) formula > 0 on ≥ 75 % of market-minutes; (e) paper day P&L at R = 0.40 > −$25, no paper stop; (g) ≤ 2 % diverged; (f) gates, key and pUSD ≥ $81 at go time); `prep_check.sql` run read-only against today's partial record to prove it parses (on 0074's placeholders it reads FAIL where it should: no reward spread, no formula, no funding). The page is the next commit.

### [2026-10-01 18:12 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5's live page trimmed on Davies' word, and Polymarket's key confirmed loaded.** Davies, having looked at the page: "这些部分全删了" (STATUS: ARMED, POSTS TODAY, LOSS STOP, LAST TURN, the two books' guard lines), the inventory's note "删了", "ORDERS里canceled的全删了不用显示", "EVENTS表也删了，但其中skip是啥意思？是有问题需要修复吗？". Done in the page only (`agents.jsx`; `quotesLiveStatus` and its test and CSS removed as dead): RUNGS, INVENTORY, ROUND TRIPS, FILLS and ORDERS remain, ORDERS leaves out every cancelled order (a re-price cancels one every few minutes), the warning line under the scoreboard stays for a late or failed turn; the sweep's checks now read those five sections, no tiles, guards, note or events, and 18 of the fixture's 24 orders (its 6 cancelled left out) with the one refusal's reason; under hide-values the check reads the loss stop masked in the scoreboard (`-£••`), where it read the LOSS STOP tile. The skips: every live event is one of six from the first live turn (16:30 UTC, keyed to the paper decision's minute, 16:27) — the six asks skipped because the account held no USDC or USDT before the conversions at 16:31–16:32; none since. Nothing to fix. Polymarket: `pm_live_state` at 18:11 UTC reads `keyed` true and no `signerProblem`, mode dry-run because the row's `dry_run` is on, pUSD 0.036673: the path is ready but for his funding and his go.

### [2026-10-01 18:01 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Both landings verified in production; the Polymarket path now records whether its key is loaded.** `0076` applied (the row dry-run, unarmed, cap $320, 2 markets, $40; `pm_live_minutes` exists). The new `agents` runs: `pm_live_state` 17:58 UTC reads mode `dry_run`, why "pm_live_config.dry_run is on", `sendsEnabled` true, pUSD 0.036673 (the L2 read works; nothing deposited yet), every gate open but armed (region eu-west-1, geoblock, closed-only, attestation, inventory, both stops), no ops_errors since the push; today's two markets are 0074's placeholders (no `max_spread`), quoting nothing until RW's ranking runs at 00:00 UTC, as designed. Nothing showed whether the key itself loaded — `why` names it only once dry_run is off — so the state now carries `keyed` and `signerProblem` (one of the loader's fixed sentences, never the key); a pin checks both ways and that the state never carries the key (its removal fails it); the design doc's step 7 and item 2 read it before the go-time statement. LIVE's Stablecoin quotes page landed (`ee67cff7`, full gates on the merged tree: desktop 237, phone 240, perf 60).

### [2026-10-01 17:53 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Polymarket's order path is ready for its live calibration, landed in dry-run** (`0076`, item 2; design and checklist `reviews/2026-10-01-polymarket-live-calibration.md`). Davies, verbatim: "选市场速度的问题也直接优化下吧，并且确保Polymarket可以上线测试…准备上线"; "同意你polymarket的方案" (~15:25 UTC); about $400, "polymarket的策略我决定还是听你的转400美元进去追求最优效果" (~17:00 UTC), replacing $300. The rule is RW's as RW-E applies it, plus the 48-hour horizon, on rewarded markets of $6 to under $10 a day ranked by RW's first-round reward per dollar — outside RW's and RW-C's universe, and no variant (that would read their results); it measures R = Σ actual ÷ Σ formula (`pm_live_reward_days`; RW breaks even at 0.40, 0.58 at the stress fills). `PM_ORDER_SENDS_ENABLED` is true and the key is kept only when its address is the stored signer (held in a private field, scrubbed from every message); every send still needs dry_run off, the key, `eu-west-1`, and every gate (armed, geoblock, closed-only, attestation, inventory, both stops). Reviewed here: `mode` is live only when sends are enabled, dry_run is off and the key matches; a dry-run `post` only writes its row; `cancelAll` is called only with live rows open. Selection 13.1–14.1 s (the listing read eight pages at a time with a completeness check) where the sequential listing took 30.6–36.6 s. PR5's two lessons applied before it can matter: a refused quote waits for new information, and a cancel is read again after 300 and 700 ms before its slot freezes, an error only from the next turn (the fake Polymarket now lands a cancel a read later). Caps for $400: $320 total and code ceiling, phase 2 at 8 markets and $160 (~100 market-days in 14; power 0.90–1.00 to tell R = 1 from R ≤ 0.6). 90 Deno tests; 49 of 50 single-rule removals fail a pin (the one that does not, RW-E's same-day rule, is redundant under the horizon). `0076` checked against production before the push: no duplicate (day, cond) for the new key, event kinds only `gates` and `selection`, the row at cap $300. CLAUDE.md's Polymarket paragraph rewritten for it.

### [2026-10-01 17:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**LIVE's "Stablecoin quotes" opens a page of its own** (Davies, ~16:33 UTC: "网站目前live里显示的Stablecoin quotes点开还是paper testing里的页面信息，请修复 改成它单独的"). `agents.jsx` sent both rows (`__quotes`, `__quotes_live`) to the paper test's page; `quotesPageFor` now sends LIVE's to `QuotesLiveDetail`: the real-money book and nothing of the paper record. Its scoreboard is its LIVE row's own (capital and the −1 % loss stop in pounds beside it); STATUS (armed since, where entries go, POSTs today against 900/950, the loss stop, the last turn, each book's guards); RUNGS (each rung's live order: price, size in coins and £, state, since; a holding on a line under its rung); INVENTORY (the executor's own `state.balances`, each coin in £ at its book's last print, and the conversions); ROUND TRIPS, FILLS, the newest 50 ORDERS with each refusal's and cancel's reason, EVENTS. Server: `quotesLiveDetail` in `agents/index.ts`, served as `quotes.live.detail` only while the executor is a LIVE row, from bounded reads (open orders, newest 50 orders, 20 conversions, 50 events) in a try of their own, so a failed read never costs the LIVE row its figures. The page's rungs and the row's totals are now one walk (`liveRungs`, `liveBookGbp`: the executor's `rungBook` and `markedGbp`); a round trip is `rungBook` over its own fills. `quotes_live.ts` untouched; the paper page unchanged. Pinned: Deno, a synthetic £1,200 book worked out by hand (`src/e2e/quotes_live_fixture.json`, asserted to be the function's own answer for its rows; the old `quotesLiveSummary` pin unchanged and green); vitest (`quotesPageFor`, status, rungs, inventory); the sweep's `pr5-page`, 10 checks a width (the hand figures, the LIVE row's equal to the page's, TESTING's row still the paper page with its live-path line, hide-values, no table past its box). Counterfactual: the old routing line restored fails it at both widths ("opened the live page with the paper page 1× beside it", 236/237 and 239/240). Run once over production's rows, read-only and copied nowhere: no NaN, 50 of the 59 live orders listed, ~19 KB. Conversion fees are in no scoreboard figure, as they never were on the LIVE row; the page lists them with the conversions. Full gates green (desktop 237, phone 240, perf 60). Next: merge and push; the Edge deploy carries the dashboard half; open LIVE's row on production after it.

### [2026-10-01 17:36 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5's resting exits are trimmed to the penny the venue rounds to** (the watch, 17:27 UTC). The first round trip finished: ask 1184 sold 13.18565 at 0.7584 (£9.99999696) and was credited £9.99; its exit 1186 bought them back at 0.7578 (£9.9920856) and was debited £10.00 (the venue's `filled_amount` "10", its average 0.7584 derived from it, above the order's own limit). A trip worth +0.79p came out at −1p: the venue floors a sell's GBP and rounds a buy's up, on every fill. 17:14's fix took the penny back on ask entries; an exit trades what its rung holds, so `pennyExit` now trims a resting exit — a buy-back to the penny below (13.18289: debited £9.99, owing 0.00276 of a coin, £0.0021), a sell to the least coin still credited its penny — and carries the hair as dust into the rung's next trip (under a penny of coin, far under the 0.13-coin dust line, so the rung stays flat and quoting). Never worse than the untrimmed exit under this rounding; the stop is untouched. 47 tests (two new, three re-expected to the trimmed size; removing the trim fails five), reference §4 item 35. Also from the watch: every cancel since 16:56 confirmed in its own turn; every new ask entry since 17:10 sized just over a whole pound; three asks rest on each book with the coin 0.16 % over what they need.

### [2026-10-01 17:14 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5's live sells no longer give the venue a penny each.** Revolut X credits a sell's GBP floored to the penny (fill 1184: £9.99999696 credited £9.99) and debits a buy's rounded up (the conversions: £29.999999 → £30.00). A £10 sell sized down to the step landed a hair under £10 and lost the penny, the 0.1 % rung's whole edge. `rungBase` now takes one base step more on a sell when that step carries the proceeds over a whole penny (£10.000004544 → £10.00); buys are unchanged. It cannot lose more than one step's value (0.00001 of a coin) under any rounding. 45 tests (one new; its counterfactual fails it), reference §4 item 35. Exits trade what a rung holds, so their rounding stays (about half a penny a fill on average).

### [2026-10-01 17:06 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The crypto loop no longer settles a live cancel as cancelled while the venue still shows the order resting** (Davies: "感觉这个问题挺大的？现在就修复吧，紧急情况下可以用超过3个sub-agents"). `tick.ts`'s `cancelOrder` read a live cancel back once and, finding no fill, settled the row `cancelled` whatever the venue's state — with Revolut X carrying a cancel out after its 204 (16:50's entry), an order the venue went on holding could have filled into no book. It never ran live: the live row has sent two orders ever (2026-09-25 buy, 09-28 sell), both filled at once, none cancelled. Now a live cancel is read again after 300 and 700 ms (`CANCEL_REREAD_MS`); an order still `new` or `partially_filled` is left open for the next turn to settle from the venue's own view (a part that filled is counted in the floor by the balance, as an unreadable buy is); the first ask is kept on the row (`response.cancelAskedAt`, merged so the placement reply stays), and a cancel still not carried out a turn later is an error. Three pins in `lifecycle.test.ts`, on the strict fake (a resting live buy past its hour): the venue a read behind (settled only once it is gone), slower than the re-reads (open a turn, no error, settled next), never carried out (an error from the second turn). Counterfactuals: the old cancel fails all three; no re-read fails two; no error on a lost cancel fails one. Edge suite green. CLAUDE.md's settlement paragraph and reference §4 item 35 say so. Also found by the watch (17:00 UTC): Revolut X credits a sell's GBP floored to the penny — fill 1184 sold 13.18565 USDT at 0.7584 (£9.99999696) and booked £9.99, the venue's `average_fill_price` 0.7576 derived from it — and a buy's debit rounds up (both conversions, £29.999999 → £30.00). At £10 a rung that penny is the 0.1 % rung's whole edge. Sizing an ask entry just over a whole penny loses nothing under any rounding and saves it under this one: next.

### [2026-10-01 16:50 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5's live executor no longer freezes a rung, or writes an error, when Revolut X carries a cancel out a moment after its 204.** The first live hour's watch caught it: at 16:37:29 UTC a re-price read 3 of 11 cancelled orders back still `new` straight after their DELETE, and at 16:41:29 7 of 11; each rung kept its old price for a minute and the turn wrote an `agents.quotes_live` error (two rows, 16:37:35 and 16:41:35); every one read back cancelled on the next turn, 57–58 s later. No order was doubled, filled or refused. The dry-run could not see it (its cancels never reach the venue) and neither could the pins, because the fake Revolut X cancelled at once. Now an order still open on its read-back is read again after 300 and 700 ms (`QUOTE_LIVE_CANCEL_REREAD_MS`), a freeze is an error only from the turn after the cancel was first asked, and still nothing is replaced before the venue shows the old order gone. The fake lands a cancel a read after its 204, or a second later (`cancelLagReads` 1, as measured): ten pins failed against the old executor under it. 44 tests in `quotes_live.test.ts` (two new: the production case confirmed and replaced in the same turn with no error; a cancel slower than the re-reads frozen a turn without an error and replaced the next); the whole Edge suite passes, 817. Counterfactuals: no re-read fails 12; an error on a first-turn freeze fails 2; a double that cancels at once fails the production case. Reference §4 item 35; the skill's looser-double entry has its third case. The crypto loop's `cancelOrder` settles a live cancel whose read-back shows no fill as cancelled whatever its state — no live path today (the live row takes the touch, nothing rests), hardened next.

### [2026-10-01 16:36 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5's live executor is LIVE: armed 2026-10-01 16:29:53 UTC at £10 a rung, twelve rungs resting by 16:33:31.** The steps item 4 named, in order, each checked: the deploy of `602b1009` (edge-functions run 343, success 16:26:51); the probe `only=revx2` read GBP 120.33 available, nothing reserved, no active or historical order (request 118271, 16:25:44); `capital_gbp` 50 → 120 at 16:26:25 while dry-run, and the dry-run re-placed its six bids at £10.0000 each (13.217–13.256 coins, 16:28:30); a `quotes-convert` preview at 16:28:43 sized at capital 120 (`asksNeed` 39.56045 USDT); armed at 16:29:53.51 on Davies' word of ~15:25 UTC. First live turn 16:30:29–31: six bids, £10 each, every one accepted (`new`, a venue id each); the dry-run's orders cancelled ("entries go live"). Conversions: USDT-GBP sent 16:31:48, filled 39.61965 at 0.7572, booked 39.58399 net (the venue takes a buy's fee in the coin: the review's open question answered), fee £0.027; USDC-GBP sent 16:32:49, 39.58305 at 0.7579, 39.54742 net. Asks at 16:32:32 (USDT) and 16:33:31 (USDC). At 16:36 UTC: 14 live POSTs, 12 open, no fill yet, the state row a minute old, no ops_errors since arming. Davies, 16:33 UTC: "网站目前live里显示的Stablecoin quotes点开还是paper testing里的页面信息，请修复 改成它单独的" — `agents.jsx` sends both rows to the paper page (`quotesOpen`); a page of its own is being built (dashboard payload, page, sweep checks). He also asked for it to be watched ("上线的话不停的盯着一段时间，有任何问题及时修复"): a monitor reads it every 5–15 minutes to ~19:00 UTC and reports anything wrong at once. His question whether the bug found before going live applies to the paper strategies: no — the refused exit was the live executor's alone; the paper engines (`quotes.ts` lines 172–174, `quotes_variant.ts` 203–205, rule D through it) already re-place a refused order only when the last print is no longer through it, which is the rule the fix copied. The Polymarket order path was told to check for the same pattern.

### [2026-10-01 16:24 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5's live settings verified at £120, and the two that were not right fixed** (Davies: "Stablecoin quotes你验证确定一切设置都是最佳，没有任何值得优化后可以上线…可以改到900"). `reviews/2026-10-01-pr5-live-go.md`; `backtests/pr5_live/go_live_120.py` → `go_live_120.json`, on the committed pre-test data and the day's public books only (its port of the frozen minute loop reproduces `simulate()` trip for trip and order for order on both windows; re-run byte-identical); nothing of PR5's paper record, dry-run, PR5V, variant-2 or PR5-W was read. Kept, each with its number: capital 120 (£10 a rung, about 13.2 coins an order, 100× the venue's minimum), the −1 % loss stop (worst day −£0.92 at £10 rungs in 273 wide-market days, never tripped), the 50 bps de-peg guard, the 2-hour stale USD hour, the ±50 bps 24-hour stop, the £30 conversion cap. Changed in `agents/quotes_live.ts`: the governor at **900/950** (Davies' 900; stops-only at 950 leaves 50 under the venue's 1,000; on 281 days entries withdrawn on 18 instead of 73, $665.68 against $580.95 at $100 rungs, the venue's bucket never under 555), and **a refused exit waits as the rule's refused order waits** — sent again only once the paper engine holds a newer print that is not through it (`exitMayGo`, `request.paperLastPrint`): before, a refused post-only exit went out every minute, 872 of 1,150 exit POSTs in the tightened market. Same price as the paper recommended: the live orders take 7 of PR5's 102 paper trips in the tightened market, the smallest, and the study's P&L moves +0.49 %; a tick behind takes none but costs the live test a fifth of its fills. 42 tests in `quotes_live.test.ts`; each new part removed fails at least one. Davies topped the sub-account up to £120.20 for the second conversion's GBP check. Next: deploy, probe, capital 120, the go statement, convert, first-hour checks (item 4).

### [2026-10-01 16:07 UTC] Platform: Claude Code | Model: not recorded (session policy)

**No call of the one-minute job is lost to the platform's boot failures any more** (Davies: "“过去约 6 小时的 5 次函数启动失败” - 这个可以修复吗，可以的话就彻底修复"). Measured first: 19 of ~19,700 calls in the 24 h to 15:00 UTC answered 503 `BOOT_ERROR` on `agents` in eu-west-2, 10.1–10.9 s after the request, with no execution id and no boot failure in the function logs (Supabase's "boot_error" class; normal boots 18–82 ms): the platform not starting a worker at the top of the minute, which cannot be stopped from here. `0075_edge_call_watchdog.sql` moves the job's list into `public.edge_calls` (0074's 17 rows unchanged and in order, plus `edge-watchdog`), proven request for request over every minute of a day in `src/cron_jobs.test.js` and, outside the suite, in Postgres 17.5 (19,704 = 19,704, 0 mismatches). Every function the job calls writes a beat first (`_shared/beats.ts`, `edge_call_beats`, the minute stamped by the database; a daily SQL-only job, `edge-call-beats-prune`, keeps two days). `edge-watchdog` (verify_jwt off) runs a due call with no beat again, once, 13 s into its minute, claimed and recorded in `edge_call_retries`; it reports `edge-watchdog.retry` when a retry fails too, `.beats` when more than four beats are missing (then retries nothing), `.unreadable` when it cannot read. `pmrw` and `pmrwc` are not retried (`retry` false: their frozen specs read the book at `t`; a missed minute stays missed and is recorded `excluded`). Item 2's steps e and RW-C's removal now mean disabling rows. A retried tick on a fifth minute counts as a late start in RW-NEXT's `agent_basis` lateness reading; `edge_call_retries` names those minutes. Reviewed before landing: the migration's statement is 0074's text plus `call.enabled` and `order by call.id`; the router split (`serveRequest` → beat → `route`) leaves every action as it was; 90 Deno and 11 cron tests pass; two counterfactuals checked (beat after the work fails the router pin; `pmrw` retryable fails the seed pin). **Check after deploy:** `edge-watchdog` verify_jwt off; beats for every due call over 15 minutes; `edge_call_retries` and `ops_errors` kinds `edge-watchdog.%` over the first day. Davies, the same afternoon: "之后如果有新的调用适合加入看门狗的也记得及时更新". CLAUDE.md's cron paragraph and the working-with-davies skill (and its two Cursor copies) now say so: a new recurring call joins the watchdog in the migration that adds it, its `retry` decided there with the reason, and a call whose reason for `false` goes away is switched on in the change that removes it; the cron test already fails on a function that writes no beat and on an insert that does not state `retry`. The browser sweep's perf-refresh tick now waits up to 20 s for the app's own refresh, not 8: under the full parallel gate run it missed 8 s twice today (desktop) and once on 09-30 (phone), each passing alone; it prints the time it took. Full gates green on this tree (desktop 227, phone 230, perf 60 cases).

### [2026-10-01 15:26 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies agreed the Polymarket plan and approved PR5's live preparation** (items 2 and 4). He asked why a small live test should matter to the paper tests; the answer given: RW's selection picks the pools with the fewest other makers, so a live copy of the same rule would quote the same markets at the same size and price as RW-C and halve its paper share where it is alone, while PR5's effect is limited to takers whose remainder at our price is at most £10 and is to be measured, not assumed. He agreed the first ("同意你polymarket的方案"), approved PR5 live after verification, topped its sub-account up to £120 (probe 117453: GBP 120.00, no order) and set the live executor's governor to 900. A third agent verifies PR5's settings; production steps stay with the coordinating session.

### [2026-10-01 15:10 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies' afternoon round: the live account verified at $120; Polymarket's live calibration and a boot-error watchdog being built; PR5's live preparation and the errors box's cleanup refused by the permission classifier.** The read-only probe (request 117164, 15:04:56 UTC): the live row's account USD 120.00 total and available, no coin (item 3: the $150 step's money condition is met; the clean week still ends 10-08); PR5's sub-account GBP 59.33, no coin. The errors box (a 24-hour summary): 219 `agents.pm_live` rows of the one fault fixed at 09:35 (32 "book not two-sided" while the match played, 187 "404" after it closed) and one geoblock timeout at 10:20; a migration deleting the 219 was refused ("Cloud Storage Mass Delete"), so they leave the box by 09:35 UTC on 10-02, the badge's Acknowledge hides them on one device, and deleting them is his call. Boot errors: 19 in 24 h, all `agents`, each ~10.1–10.9 s after the request with no boot failure logged (Supabase's "boot_error" class; normal boots 18–82 ms): the platform failing to start a worker at the top of the minute, about 0.1 % of calls; one agent builds a watchdog that re-invokes a call that never started within its minute. A second builds Polymarket's calibration (item 2). The third, PR5's live preparation (item 4), was refused at launch.

### [2026-10-01 10:23 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The recorders' first audits pass, and RW, RW-E and RW-X are healthy** (the 10:20 wake; items 7 and 2; read-only, no market-level figure). Recorders: item 7's line. RW: `last_minute` 10:20 at 10:22, no `last_error`; today's selection 14 rows, made at 00:00:00.65; `pm_rw_days` 7 rows, the last 09-30. RW-E: `last_minute` 10:19, no error, `checkMaxUsd` 0, `diverged` empty. RW-X: `last_minute` 10:19, no error, `checkMaxUsd` 0 and `checkEMaxUsd` 0 over 6 days; arms' `diverged`: rw 0, e 0, x1 0, x2 5, x3 3 (the pause arms replaying a market on their own after a pause, by design). pg_net keeps about six hours of replies: 4,895, of which 5 were 503 `BOOT_ERROR` in eu-west-2, and the edge logs name their calls: `pmrw-x` (04:28, 08:40), `pmrwc-x` (04:40), `pmrwc-e` (08:49) and `quotes` (09:28) — replays that catch up on their next call, RW-C calls that do nothing before 10-08, and PR5's engine, current at 10:22 with no error. None was `pmrw-select`, the tick or the order path (eu-west-1). The page's "fills and total differ" warning was not read: the page needs the app's password.

### [2026-10-01 09:32 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The order path's dry-run stopped reporting a market that had left the book** (item 2). The 09:23 EX-GAP wake (item 5a.7: 2 pairs, recorded in `56ee56e`) also read `pm_live_state`: `last_error` named the standard pick's book, 404, and `ops_errors` held 211 of its rows since about 06:28. The pick was a China Open match whose `endDate` was a week on but whose game had started at 03:05; it closed at 06:27 and the selection is made once a day. `agents/pm_live.ts` now passes over a market whose `gameStartTime` or `endDate` falls within two days (`PM_LIVE_MIN_HORIZON_MS`; `pmTime` reads Gamma's `+00` offsets), and treats a 404 book as the market leaving: recorded once in the minute's selection event, its orders closed, not read again that day, its kind chosen again without it. Three pins in `pm_live.test.ts` (49 pass), each failing under its counterfactual: no horizon, a 404 as a fault, the gone market read again, no offset fix. Nothing about sending changed. The 211 rows stay in `ops_errors`; new ones stop with the deploy. **Verified in production:** deployed by 09:35; at 09:35 the gone market was recorded once (404), at 09:36 the standard kind was chosen again (an unrewarded political market, Gamma rank 40, so the horizon passed over the near-term ones before it) in 36.6 s, and no `pm_live` error after 09:34. 36.6 s against the 40 s deadline (30.6 s at 05:31) is the thing to watch: a listing not read in time takes nothing and is retried in five minutes.

### [2026-10-01 05:25 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Polymarket's order path is built and runs inert** (item 2; `reviews/2026-10-01-polymarket-order-path.md`; Davies' Option 1, a recorded deviation of RW-NEXT's ordering, not of any frozen test). One agent built it in a worktree; the coordinating session reviewed it before landing: the 67 new Deno tests pass; four counterfactuals of its own (the send switch on, the region check removed, the $10 reward filter removed, the executor reading `pm_rwc_minutes`) each fail them, and the restored tree passes; `npm ci --ignore-scripts` of the vectors' lockfile and `node gen_vectors.mjs` reproduce `vectors.json` byte for byte from `@polymarket/clob-client-v2` 1.2.0; 0074's cron statement differs from 0072's by exactly the new row; the route answers the cron bearer only and passes no signer; `loadPmLiveEnv` never reads `POLYMARKET_PRIVATE_KEY`. The agent's own 43 counterfactuals are in the design doc (42 fail a pin; the one that cannot, L2 headers to a non-CLOB host, is unreachable because every L2 route is on the CLOB, and its route list is pinned). The geoblock gate reads the country, not `blocked`, because Ireland reads `blocked: true` from eu-west-1. Choices recorded there: a 6,000-POST governor, holdings not explained by fills counted at $1 a share, 425/429 re-sent as a new order, a 5xx left pending. The two DAT CSVs re-staged with no content change (an index stat left from their CRLF copies).

### [2026-10-01 04:50 UTC] Platform: Claude Code | Model: not recorded (session policy)

**DAT closed: MSTR against Bitcoin and BMNR against Ether offer nothing this account can trade** (item 8, reference §3.45, `reviews/2026-10-01-dat-study.md`, `backtests/dat/`). One research agent fixed the design before pulling a price (`design.md`, sha256 `4b298c90…`), screened MSTR on 2020-08-11 → 2024-12-31 from its SEC filings, and wrote the MSTR verdict down before reading any 2025–2026 price; MSTR's 2025 onward was never pulled. The coordinating session re-ran every analysis script from the inputs, on a copy and in the repository's layout: every result byte-identical, the 37 files equal to `MANIFEST.json`. The raw SEC cache (7.6 MB) is not committed; `pull_sec.py` re-creates it and the MANIFEST lists its hashes. Its User-Agent carries no e-mail address. The scratch copy of EQ1's French file was not copied in. Nothing is pre-registered, nothing goes to paper, no key is needed. The next commit makes `build_mnav.py` write its two CSVs with LF: git had stored them as LF (`.gitattributes`) while the MANIFEST held their CRLF hashes, so a checkout would not have matched; values unchanged, every JSON result byte-identical, the old hashes kept in the MANIFEST's `eol_note`.

### [2026-10-01 03:50 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies chose Option 1 for Polymarket, and his Ireland attestation is now standing** ("“选项 1：…可以早约 5–7 天” - 这个你现在就建好吧 我之后长期在爱尔兰，如果变动需要更改会和你说，不和你说关就一直没事 也不用问我"). The order path is being built now, inert, in a worktree, by one agent; it lands with its own entry (item 2). The attestation is current until he says it changed and nobody asks him; item 2, item 6 and `CLAUDE.md` say so, and the pre-study records his choice. RW-NEXT's frozen file is not edited: the deviation of its ordering and the end of its "expiring timestamp" are recorded here and in item 2. A second agent studies MSTR against Bitcoin and BMNR against Ether (item 8). Five headers below were stamped ahead of their commits and now carry the commit times, read from git and checked against the database's clock (`select now()` agreed with `date` to two seconds): 04:05 → 03:19, 03:55 → 03:17, 03:40 → 03:07, 03:05 → 02:44, 02:35 → 02:32.

### [2026-10-01 03:19 UTC] Platform: Claude Code | Model: not recorded (session policy)

**DFC failed, as frozen** (`reviews/2026-10-01-dfc-study.md`; `equity2/results/heldout_dfc.json`, two runs byte-identical at the freeze commit `99123378`): neither hypothesis clears its Holm step (H1 D 4.87 bp a day, t 0.77, p 0.219; H2 7.97, t 1.42, p 0.076, its second half negative), and the dodge rule lost 2.87 % and 1.21 % a year net of 8 bps against a market that returned 13.54 % a year over cash. By the pre-registration's §11, month-end calendar rules are closed at this size, and US equities have nothing to run (item 8). No deviation.

### [2026-10-01 03:17 UTC] Platform: Claude Code | Model: not recorded (session policy)

**DFC is frozen** (`docs/agents/reviews/2026-10-01-dfc-prereg.md`, sha256 `65c675aa…`; `equity2/scripts/heldout_dfc_pull.py` `4926a5e6…` and `heldout_dfc_score.py` `8a1a0984…`, in this one commit). The review's second pass found the guard checked against HEAD rather than the freeze commit and one wrong figure in §7; both fixed with its tested code and text, with its optional items (a missing-code stop, the best month defined, §8 and §10 worded as the code runs, English glosses). The final scorer reproduced every pre-2016 screen number on eight spans, 0 mismatches. Step 1 (dates only) read 2,680 days, 127 turns, 20 / 80 / 27. Nothing after 2015-12-31 but dates has been read by anyone (item 8).

### [2026-10-01 03:07 UTC] Platform: Claude Code | Model: not recorded (session policy)

**EQ2's screens are committed; EQ1's missing-code check is fixed; DFC's pre-registration is revised and in its review's second pass** (Davies on 10-01: research the USD account's strategies, and post-earnings drift and the turn of the month if still worth it). EQ2 (an `opus-max` agent; the coordinator re-ran its DFC screens byte-identical from `docs/agents/backtests/equity2/`): with no FX the verdicts stand, because power binds, not cost; DFC is the one test worth running. An independent review found seven blocking defects in its draft (a freeze guard that checked the draft, an unpinned input, no verdict in code, an open Holm family, uncoded descriptive lines, two disclosure errors, an optimistic power statement), each fixed; the scorer is the review's. EQ1's `screen_french.py` compared missing codes after dividing by 100 (−99.99/100 is not ≤ −0.9999); fixed, and its results re-ran byte-identical (item 8).

### [2026-10-01 02:44 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The ledger is slimmed, under the protocol's archiving rule** (Davies: "ledger目前是不是过长了？如果是的话按照skill的要求优化下，避免不必要的过多usage limit消耗"): 1,203 lines and about 54,500 tokens to 540 lines and about 16,400. The what-remains list as it stood and the 79 history sections of 2026-09-25 → 09-28 moved word for word to `docs/handover.md` Part 2, under "LEDGER.md, archived 2026-10-01", oldest first; a script checked that the old list and every moved section arrived intact, that the handover changed only by that insertion, and that the 16 kept sections are unchanged. The list was rewritten to what is open and keeps its item numbers, which the fifteen scheduled wakes and the 10-08 cap wake quote: items 1 and 5 are one-line closures, item 2 keeps its health checks, the verdict's steps a–g and RW-C's checks word for word, items 4 and 5a keep their frozen tests' dates, owners, freeze lines and dry-run records, and item 8 (US equities) is new.

### [2026-10-01 02:32 UTC] Platform: Claude Code | Model: not recorded (session policy)

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

