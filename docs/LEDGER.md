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
     passes both goes to Davies.

   - **RW-C, RW's rule forward on 2026-10-09 → 10-23 UTC (RW-NEXT part 2; Davies approved the build 2026-09-27): ON
     `main` since 2026-09-28 04:39 UTC** (`3682b557` engine + `0069`, `17728e3c` page; history 00:38 and 05:12).
     `pmrw.ts` as a second instance (`RWC_INSTANCE`) into `pm_rwc_*` (RW's eleven tables, renamed), leases `pmrwc*`,
     warm-up 10-08 00:00 by constant; RW-E and x1–x3 replayed on its minutes with every "from" at 10-09 00:00
     (`pmrwc-e`, `pmrwc-x`), and x4 and x5 since `0085` (an addendum to RW-NEXT Part 2, in their pre-registration). `0069_pm_rwc.sql` adds the tables and four rows of `edge-calls-every-minute`. **Its page row
     "Reward quotes confirmation" appears by itself at its warm-up, 10-08 00:00 UTC** (Davies, 2026-09-28: off the page
     until then; the dashboard reads nothing of it before), "starts 9 Oct 01:00 BST" until its first minute. RW-NEXT
     is frozen (item 5a.3). The four calls return "before its warm-up" / "before RW-C's first minute is decided" (no
     database read) until 10-08 00:00 / 10-09 00:02. **Check after 10-08 00:10 UTC**: first RW-NEXT's slip-rule check
     (item 5a.3, its exact query), then `pm_rwc_state.last_minute` within ~3 min and no `last_error`; after 10-09 00:05, `pm_rwc_days` holds 10-08 with `detail->>'phase'` `warm-up`; after 10-10 00:05,
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
     (pUSD ≥ $81 read within 5 minutes; 0.036673 at 01:25 UTC).
   - **Reward quotes mid-pool: the path and its paper layer again, on $10–$50 pools; since `0084` the same real order path as mini-pool, in dry-run**
     (Davies, 2026-10-02: "…再做一个Reward quotes mid-pool只做10-50，同时也不打扰其他的Reward quotes，也是400美元funded测试").
     `0081`, `agents/pm_mid.ts` (an instance of `pm_live.ts` and `pm_prep.ts`), `agents?action=pmmid&forceFunctionRegion=eu-west-1`
     and `agents?action=pmmidprep` every minute (rows of `edge_calls`, retry true); mini-pool's $400 sizes. **Since `0084`**
     (2026-10-02, Davies: "把mid-pool 的结构和路径也做成和mini-pool一样的真实下单路径，按上线规模跑 dry-run，之后更好对比，现在就做不要等")
     its action is mini-pool's: the key loaded for the stored signer, the pUSD read every minute, the same keyed wire; its
     config row is the lock (`dry_run` true, `live_confirmed_at` null), and a trigger on both configs refuses arming either
     while the other is armed (one account). Its go-time statement is the design doc's step 8m, run only in the
     conversation where Davies says go; a funded mid-pool needs first its own pre-registration, its margin measured again
     and the readout told apart per path (mini-pool's books every paid market of the account: a `pm_live.ts` change, after
     mini-pool's window is checked). Its selection leaves out what RW's frozen selection, recomputed from public data with
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
     dashboard's summary. A revocation of the Ireland attestation is recorded in both config rows. On the Agents page it
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
   book before any raise of the capital. **Never trade by hand in
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
     be read, every resting order on the `_2` account is cancelled and read back (reference §4 item 35), recorded as an
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
   - On 10-03, read `net._http_response`'s size: six hours of responses is about 10 MB. Past 50 MB the dead space is
     back, and it needs a job of its own.
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

