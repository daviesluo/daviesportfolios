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
     e. A migration takes `pmrw`, `pmrw-select`, `pmrw-e` and `pmrw-x` out of the one-minute job — since `0075` that is
        `update public.edge_calls set enabled = false where path in (…)` on those four paths (RW-C's four `pmrwc*` rows
        and every other row unchanged; the tables stay); the page rows stay as a record until Davies says otherwise.
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
     phase 2 (`max_markets = 8, select_budget_usd = 160`, ~100 market-days in 14) after the first payout is read back.
     The first live day reads how soon a cancel shows on the venue (the doc's "Not verified" query).
   - **Reward quotes live-prep: 24 hours of paper first, then go live on the check** (Davies, ~18:15 UTC: "要不要先上线Reward
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
     window is 2026-10-01 21:00 → 10-03 00:00 UTC** (1,620 minutes: a1 ≥ 1,604, a2 ≤ 16). **Next:** 10-02's selection
     at 00:00 UTC (by 00:10); at or after **2026-10-03 00:10 UTC** run `prep_check_addendum1.sql` once (a fix
     deployed before 10-02 00:00 makes it `prep_check.sql`, as frozen); every row PASS → the go-time statement, word for
     word, on his word above; any FAIL → no go-live, fix and report. A fix deployed inside the window ends it as FAIL; the
     next full UTC day after the fix is the new window (the prereg's addendum first). (f) needs his funding (pUSD ≥ $81,
     read within 5 minutes); if only (f) fails it is read again once he has funded.
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
     `pending` past 2 minutes; the state row is under 3 minutes old. Kill switch: `update
     public.agent_quote_live_config set live_confirmed_at = null where id = 1;` (cancels entries; exits and stops stay
     armed); `global_pause` cancels everything.
   - **Its page (2026-10-01, Davies: "改成它单独的"; reshaped on his word 18:30–19:00 UTC):** LIVE's "Stablecoin quotes"
     opens a page of its own, in pounds — the scoreboard (the LIVE row's own figures), the paper page's BOOKS, INVENTORY
     (each coin with its unrealised), DAYS, ROUND TRIPS and ORDERS (no empty cancels, read so server-side; an entry by its
     side alone); TESTING's row opens the paper page. A round trip carries the conversion fee of the coins it sold (FIFO
     per book, booked at its close). Coins are valued at Revolut X's ticker `index_price`, as the account values them
     (`agent_quote_tickers`, `0078`, written by `books`; the last print when the index is over 10 minutes old): UNREALIZED
     is the coins at the index against their cost, DEPLOYED the coins at the index plus the pounds its resting buys tie
     up (Davies: "每一笔钱都quote出去了"). The paper tests' DEPLOYED is every rung at work (quoting rungs' share of the capital
     plus what is held); their unrealised stays on what is held. Every stablecoin quotes row and page is in pounds; tab
     scoreboards and VENUES add them up in dollars.
   - Never trade by hand in PR5's sub-account (key `_2`): its executor books fills and inventory from that account.

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
   2026-09-28; items 4, 5, 10 and 14 closed on 2026-09-30, so 17 of 28 done, 1 partly, 1 not doing (the committed
   bundle, his call), 9 open. Worth doing, in order: the app icon; one shared Trading 212 ticker map; a plausibility
   band on quotes; error boundaries per surface; and item 3 measured before it is touched. Seven questions there wait
   on Davies, the first whether `APP_AUTH_SECRET` was rotated with the two passwords.
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

### [2026-10-02 00:00 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The live stablecoin page: exits and entries in two tables, sizes on a phone, and a round trip that ends where the executor calls its rung flat.** Davies: "live的stablecoin quotes也面中orders表拆成两个，上面是Exit orders（没有Exit orders的话就不显示）下面是Entrence orders，side列都只显示buy/sell（conversion也删了，这列和其他列等宽…）并且price右边加size列，round trips表格exit右边也加size列…另外现在我看order表里exit filled了两个为什么round trip里只有一个". Why one trip for two filled exits: the second trip's exit (order 1314) was trimmed to the penny the venue rounds to (`pennyExit`: 13.1916 USDT for £9.99, not 13.19262 for £10.00) and left 0.00102 USDT owed. That is under the book's dust (about 0.13 USDT, the venue's £0.10 minimum), so the executor calls the rung flat and carries the hair, but the page cut trips at exactly zero and held the trip open, drawing the rung as holding. The executor now saves each book's `dust` in its state; the page's `tripEnds` closes a trip at that dust over every fill so far, books a conversion fee there and calls a rung holding only over it, and a trip's P&L is what it added to the rung's realised. The first trip's prices read past their limits (sold at 0.7576 under a 0.7584 limit, bought at 0.7584 over 0.7578) because the venue's `average_fill_price` is its penny-rounded pounds over the coins: credited £9.99 for £9.99999696, debited £10.00 for £9.9920856. That is real money, −£0.0105 on the trip, and is why `rungBase`/`pennyExit` came in that afternoon. The page: EXIT ORDERS (exit and stop legs, only while there are any, a stop marked under its time) above ENTRY ORDERS; each side buy or sell alone; the conversions in neither; Size at every width in both and in ROUND TRIPS. On a phone every column of the three now fits the screen (a time stacks its date over its clock, a book shows its coin, a size its number, the cells sit closer): ROUND TRIPS' P&L had sat off the screen's edge before. "Entrence" is written ENTRY. Pinned: Deno with the two trips' own fills (−£0.0105 and +£0.0092, adding up to the rung's realised; one trip without the dust; a conversion fee booked at the dust), the executor's state carrying the dust, and the sweep at both widths (both tables, buy or sell only, no conversion, Size shown, every column inside the screen, no EXIT ORDERS when the page has no exit). Asked the same evening why live-prep's Held column is empty: it has no fill yet, so it holds nothing; its deployed is its resting quotes' collateral and its gain the formula rewards. Nothing to fix.

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

