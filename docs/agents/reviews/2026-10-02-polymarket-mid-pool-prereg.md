# Reward quotes mid-pool: fourteen days of Polymarket's order path on $10 to $50 pools, in dry-run (pre-registration)

Written 2026-10-02 (UTC), before mid-pool runs at all. Frozen by the commit that adds this file, which lands before
mid-pool's first full UTC day; nothing below may change after that, and any deviation is reported as one. Its three
statements are frozen with it, each a file of `docs/agents/backtests/pmlive/` named by its sha256
(`src/pm_mid_prereg.test.js` fails if any of them changes):

- the day-1 check, `mid_check.sql` sha256 `723716c6c2ccac5376442c80e21dbd91e6e2462c0007b4c0e84b652b52d394c0`;
- the fourteen-day readout, `mid_readout.sql` sha256 `f148c296c9052571ddd71fb00efe0de1a6a0a90fca87fa88e7b17a5a600f3225`;
- the overlap audit, `mid_audit.sql` sha256 `c6597b6b2f5ffdc98796bc4b3e663d64e72993648712421931ac4ec53fd49073`.

## On whose word

Davies, 2026-10-02, verbatim:

> 把目前Reward quotes live-prep改名为Reward quotes small-pool，再做一个Reward quotes mid-pool只做10-50，同时也不打扰其他的Reward quotes，也是400美元funded测试

In English: rename the current "Reward quotes live-prep" to "Reward quotes small-pool"; build a "Reward quotes
mid-pool" that only does $10–50; without disturbing the other Reward quotes; also a test as funded with $400.

## What runs

The order path and its paper layer, the same code as small-pool's (`agents/pm_live.ts`, `agents/pm_prep.ts`), each run
a second time with mid-pool's instance (`agents/pm_mid.ts`; migration `0081`, tables `pm_mid_*` and `pm_midprep_*`):
`agents?action=pmmid&forceFunctionRegion=eu-west-1` every minute from `eu-west-1`, and `agents?action=pmmidprep` every
minute, two minutes behind the clock.

- **The band.** A market's total daily reward rate is at least $10 and under $50, at its selection. The database
  refuses any other rate on the day's markets and on every minute (`pm_mid_markets`, `pm_mid_minutes`).
- **The rule.** Everything else is the path's, as small-pool runs it: the UTC day's markets chosen once, from N =
  max(the reward minimum, 5) ≤ 20, a reward spread above 0, Gamma's word that a market accepts orders and that nothing
  ends or starts within 48 hours, RW-E's same-day rule, a two-sided book agreeing with Gamma, a first-round formula of
  at least $2.50 a day, then RW's ranking (`firstScore`, `choose`); RW's quotes as RW-E applies them, post-only GTD
  orders, the gates, the caps and the loss stops.
- **The size: small-pool's at its $400 deposit** (`0080`; this is "funded with $400"). Eight markets a UTC day and
  $160 of first quotes, $320 resting in all, $60 a market, stops at −$25 a day and −$75 in all, GTD orders of 600 s
  (`pm_mid_config`).
- **Dry-run only, held there by the database.** `pm_mid_config` refuses `dry_run` false and any `live_confirmed_at`,
  and `pm_mid_orders` refuses every mode but `dry_run`, so not even the pending row a live order must have before its
  POST can be written. The action reads no signing key (the env loader is not asked for it), and its wire refuses
  every POST and DELETE. It records the orders it would send and each minute's book and formula reward, and the paper
  layer fills them from the public prints, exactly as small-pool's does. It reads the account as small-pool's dry-run
  does (the gates, the pUSD balance, its markets' token balances), and never what the account earns: no reward,
  payout or rebate read.
- **Its code at the freeze.**
  - `pm_live.ts` sha256 `8ba7b915018c8f34bc9f57486f703e016770696947d3d6665fa1a0fc44f39653`
  - `pm_prep.ts` sha256 `8d7861ab263554fba73e2ee2ef6f80bbfa7c33c1fa1971e00822c97b94794dea`
  - `pm_mid.ts` sha256 `b7854ab5a3c93d4e420654c7c21567aae8db27f08a9fc961aefc703ac90471b6`

  The first two run small-pool too, as their default instance. `agents/pm_instance.test.ts` runs that default and
  small-pool's frozen code (`pm_live_frozen.ts`, `pm_prep_frozen.ts`, byte copies at the hashes small-pool's
  pre-registration names) over the same fixture, minute by minute, and finds them identical.

## Not disturbing the other Reward quotes

RW (to 2026-10-09), RW-E and RW-X (replays on RW's minutes) and RW-C (2026-10-09 → 10-23, warm-up 10-08) quote, on
paper, the markets RW's frozen selection takes from rates of $10 and over, which holds mid-pool's band.

- **Mid-pool's orders reach no book.** It is a dry-run, so it cannot move a book or a print that RW or RW-C reads.
- **It reads none of their tables.** No row of `pm_rw_*` or `pm_rwc_*`, as their pre-registrations require.
- **It never takes a market of theirs.** At its own selection it computes RW's frozen selection rule from public data,
  exactly as the RW spec words it ("The portfolio, re-selected daily"), with RW's own functions and reads (`summarize`,
  `firstScore`, `choose`, `RW_BUDGET_USD`, `RW_MIN_RATE` from `agents/pmrw.ts`, imported and not copied; the CLOB's
  short list, its books, Gamma), on the reward listing its selection has just read:
  - the universe: a rate of at least $10 and a maximum spread above 0;
  - each market ranked by RW's first-round reward per dollar, rate/1440 × Q/(Q + others)/(N × (b + 1 − a));
  - whole markets taken in that order while they fit in $300, one that does not fit passed over;
  - a market Gamma does not show accepting orders, or whose YES token disagrees, dropped and the choice made again
    (RW's selection loop).

  Pinned: `agents/pm_mid.test.ts` runs RW's own `runPmrwSelect` beside it on 60 random worlds and a hand-worked one,
  and the picks are the same.
- **The exclusion and its margin.** Every market scoring at least 0.33 of the last market that rule takes
  (`PM_MID_EXCLUSION_MARGIN` = 0.67), RW's picks among them, is left out of mid-pool's universe for the day. RW's and
  RW-C's selections read their books a few seconds to a few minutes from mid-pool's, and a market's score moves with
  its book. The margin was measured keylessly before this was written (`backtests/pmlive/scripts/mid_margin.ts`,
  output `results/mid_margin_out.txt`, 2026-10-02 03:58–04:14 UTC, counts and ratios only): RW's selection recomputed
  fourteen times about 72 s apart, and mid-pool's picks at each against RW's at every later one, 91 pairs.
  - At a margin of 0.5, one of mid-pool's picks was RW's in 40 of the 91 pairs (3 of the 25 at most two minutes apart).
  - At 0.67 and at 0.8, in none. 0.67 is the least margin with none.
  - Its cost: about 17 of the band's markets left out at each recomputation (7 at 0.5, 60 at 0.8). Mid-pool's own
    selection left out 9 to 12 of the about 1,370 markets of its universe (`results/mid_selection_time_out.txt`).
  - Of the 37 markets that joined RW's picks from one recomputation to the next, 18 were not scorable the minute
    before. Of the 19 that were, three scored 0.158, 0.431 and 0.473 of that minute's last pick, the rest 0.719 or
    more.

  Pinned in `agents/pm_mid.test.ts`: the boundary (a market at 0.33 of the last pick left out, one just under it
  kept), RW's Gamma loop carried into it, and on 25 random worlds no pick of mid-pool's among RW's own.
- **Only a count is recorded.** The day's selection event carries `exclusion`: `rule` "RW", `margin`, how many
  markets RW's universe held and how many it scored, and `excluded`, how many markets of mid-pool's universe were left
  out. Never which: nothing mid-pool writes is a list of RW's or RW-C's picks (pinned: no excluded market's id appears
  in any mid-pool table).
- **What no margin covers.** A market that is not scorable at mid-pool's read and becomes one of RW's or RW-C's picks
  minutes later. The audit below counts it.

## The window

**d1 is the first full UTC day after `pm_mid_config.created_at`**, the moment `0081` made mid-pool's config row. The
same push deploys the `agents` function, so it is landed at least an hour before a UTC midnight. **The window is
fourteen UTC days, d1 00:00 → d15 00:00 UTC.** d1 is checked; all fourteen are read out.

A change to `pm_live.ts`, `pm_prep.ts`, `pm_mid.ts` or `0081`'s tables deployed inside d1 ends d1 as FAIL, as in
small-pool's pre-registration. A change deployed on d2–d14 does not end the readout. It is a deviation: the readout
names it with its day, and a session finds it with `git log` over those three files and the migrations.

## The day-1 check

`mid_check.sql`, run once, read-only, at or after d2 00:10 UTC. Its rows, each with what it measured, its bar and PASS
or FAIL, are small-pool's conditions (a)–(g) asked of mid-pool's tables (`prep_check_addendum2.sql`'s bars, unchanged
but where named):

- **w** the window has ended: the check runs at or after d2 00:10 UTC.
- **(a) The path and the layer ran.**
  - a1: a minute of the path's record (`pm_mid_minutes`, mode `dry_run`) in at least **1,426 of d1's 1,440 minutes**.
  - a2: at most **14 minutes** with an `ops_errors` row of kind `agents.pm_mid` or `agents.pm_midprep`, or an
    `agents.crash` row of the `pmmid` or `pmmidprep` action.
  - a3: the layer decided through d1 23:59 (`pm_midprep_state.last_minute`) and closed d1 (one `pm_midprep_days` row).
- **(b) d1's selection.**
  - b1: once (one `selected_at`), with at least one market, by **00:10 UTC**.
  - b2: every market inside the rules: a rate of at least $10 and under $50, N = max(its minimum, 5) ≤ 20, a reward
    spread above 0, nothing ending or starting within 48 hours of the selection, a first-round formula of at least
    $2.50 a day; and the selection's event records the exclusion: `rule` "RW", `margin` 0.67, `excluded` a count.
  - b3: no more markets than `max_markets` (8) and first-quote capital within `select_budget_usd` ($160).
- **(c) Every would-be order of d1** (`pm_mid_orders`, mode `dry_run`): c1 post-only, none crossing the book it was
  decided on, and at least one; c2 each at least its market's N and the venue's minimum; c3 at each order's placement
  the resting buys' collateral within `cap_market_usd` ($60) in its market and `cap_total_usd` ($320) in all.
- **(d) The quotes scored:** at least **75 %** of d1's market-minutes of the path's record carry a formula reward
  above zero.
- **(e) The paper day:** d1's row exists with matched minutes, its P&L with rewards at R = 0.40 is **above −$25**,
  and no paper loss stop tripped (no stop event in d1, neither flag set).
- **(g) The paper is the path's:** at most **2 %** of d1's decided market-minutes are `diverged`.
- **(f) Not applicable.** Small-pool's (f) asks whether it is ready to go live. Mid-pool cannot go live: the row prints
  the config's `dry_run` and `live_confirmed_at`, and N/A.

Run on PGlite 16 with `0074` → `0081` applied before freezing: right after `0081` it reads FAIL on w, a1, a3, b1, b2,
c1, d, e and g (no window, nothing run); on a synthetic day built to pass, every row reads PASS and (f) N/A; and each
of fourteen planted faults (a turn short, a fault minute over, the layer behind, a second selection run, a $2 formula,
no exclusion recorded, a crossing order, an order under N, $70 in one market, 30 % scored, a −$28 day, a stop flag,
3 % diverged) fails its own row and no other. A $50 market cannot be planted: the table refuses it.

**What happens.** Every row PASS: the readout runs to d14, and the check's output goes to Davies. Any FAIL: no
readout. The failure is found, fixed and reported to Davies with the check's output, and the window (d1 and the
fourteen days) starts again on the first full UTC day after the fix is deployed, by an addendum to this file written
before that day starts. Nothing else here moves.

## The fourteen-day readout

Descriptive: no bar, no verdict, and it arms nothing. `mid_readout.sql`, run once, read-only, at or after d15 00:10
UTC, and reported to Davies whole. One row for each UTC day d1–d14, then the total:

- mid-pool's paper day (`pm_midprep_days`) beside small-pool's (`pm_prep_days`) on the same day: markets, fills,
  minutes matched, dark, diverged and missing, the formula reward, the fills' P&L, the P&L at R = 0.40 and at the
  formula (R = 1), the holdings' value and the stops;
- whether a day's layer closed it (`*_days`): a day it did not close is missing, never zero, and the total says over
  how many days it runs;
- small-pool's live record of the day (`pm_live_minutes`, `pm_live_reward_days`, mode live): on a day its path was
  live, its paper layer, which reads only the dry-run's record, has nothing of the live minutes to fill.

Run on PGlite 16 over a synthetic fourteen days (one of mid-pool's days missing, a stop, two of small-pool's days
live) before freezing, it gives one row a day and the total as constructed.

The readout also names every deviation (a deploy inside the window, a day missing from either side, a stop) with its
day. A day mid-pool's or small-pool's layer did not close is read as missing, never as zero. Whether mid-pool is ever
funded is Davies' decision, and would need a pre-registration of its own.

## The overlap audit, after RW-C's verdict

`mid_audit.sql`, run once, read-only, no earlier than 2026-10-23 00:05 UTC (RW-C's verdict; RW's is 2026-10-09),
when both their no-peek rules have ended. For each day of the window, how many of mid-pool's picks RW's and RW-C's
actual selections (`pm_rw_selection`, `pm_rwc_selection`) took on the same UTC day: counts, never a market. Run
earlier, it reads no row of either: each is read under a condition on the clock alone, in a materialized common table
expression, which Postgres plans as a one-time filter (PGlite 16: the scans "never executed" before the date; with the
clock moved past it, they ran and counted two planted overlaps).

The expected count is zero on every day. Any overlap is reported to Davies with its days and counts, and those days
are marked in the readout. The audit decides nothing about RW or RW-C: mid-pool's orders were in no book. A margin for
a funded mid-pool would be measured again before one, from this audit and a new measurement.

## No peeking

Until the day-1 check runs, and then from it until the readout, nobody reads anything of `pm_mid_*` or `pm_midprep_*`
but these health readings:

- `pm_mid_state`'s `last_error` and `updated_at`, and `pm_midprep_state`'s `last_error`, `updated_at` and
  `last_minute`, never either `state`;
- `ops_errors` rows of kind `agents.pm_mid` or `agents.pm_midprep`, and `agents.crash` rows of the `pmmid` or
  `pmmidprep` action;
- whether `pm_mid_markets` holds rows for a day (a count, nothing of a row).

Nothing else is read: not a market, order, minute, fill, event, settlement or day row, and not mid-pool's row or page
on the Agents page or the dashboard's mid-pool summary. No session opens them during the window. A check of how the
page draws mid-pool uses fixtures only (the browser sweep's). Anything read beyond this is disclosed in the readout as
a deviation.

## What this does not test

- **R, what Polymarket actually pays.** Only live orders can show it. Mid-pool's paper rewards are the formula, and
  R = 0.40 is a column, not a measurement.
- **Live-only behaviour:** the venue's replies, cancels landing late, collateral, scoring durations.
- **Our own orders in the book.** The dry-run's orders are in no book, so the paper's touch is the market's without
  them. In larger pools, the share a funded mid-pool's quotes would take is the formula's Q/(Q + others), with the
  others as they were without it.
- **The account it reads is small-pool's.** Its gates and pUSD balance are that account's, and a market small-pool
  holds that mid-pool picks on a later day would read as held by mid-pool. The bands are disjoint at each selection, so
  this needs a market whose rate crossed $10 between the two.
- **Production's CPU.** An Edge request may use 2 s of CPU. Mid-pool's selection measured about 1.2 s with its
  candidates' books read in batches, and about 2.1 s read one GET each as small-pool reads them, in this repository's
  container (`backtests/pmlive/results/mid_selection_time_out.txt`: the process's CPU, every thread), never on
  Supabase. If production stops it, (b1) fails on d1.

## Addendum 1 (2026-10-02, about 18:00 UTC): the same real order path as mini-pool, still a dry-run

Written before d1 (2026-10-03 00:00 UTC), and landed and deployed before it. Davies, 2026-10-02 about 17:15 UTC,
verbatim:

> 把mid-pool 的结构和路径也做成和mini-pool一样的真实下单路径，按上线规模跑 dry-run，之后更好对比，现在就做不要等

In English: make mid-pool's structure and path the same real order-placing path as mini-pool's, run its dry-run at the
go-live size, so the two compare better later; do it now, don't wait. What changes, and nothing else:

- **The action** (`agents/index.ts`, `runPmMidAction`) is wired as mini-pool's (`runPmLiveAction`): it loads the
  signing key, kept only when its address is the stored signer; the same keyed wire, whose POST and DELETE leave only
  when the turn is live; the account's pUSD read every minute, as it already was. "What runs" above said the action
  reads no signing key and its wire refuses every POST and DELETE: neither holds from this addendum.
- **The database** (`0084_pm_mid_order_path.sql`): `pm_mid_config` no longer refuses `dry_run` false or a
  `live_confirmed_at`, and `pm_mid_orders` may hold `live` orders, as mini-pool's tables always could. What keeps
  mid-pool home is its config row, `dry_run` true and `live_confirmed_at` null, as `0081` set them; `0084` writes
  neither, and no session or routine arms it. A trigger on both configs refuses arming either while the other is armed
  (the two paths trade one account), and each path's go-time statement refuses it too (the design doc,
  `2026-10-01-polymarket-live-calibration.md`, steps 8 and 8m). The sizes do not move: eight markets and $160 of first
  quotes, $320 in all, $60 a market, −$25 a day and −$75 in all, GTD 600 s.
- **The code.** `pm_live.ts` (`8ba7b915018c8f34bc9f57486f703e016770696947d3d6665fa1a0fc44f39653`) and `pm_prep.ts`
  (`8d7861ab263554fba73e2ee2ef6f80bbfa7c33c1fa1971e00822c97b94794dea`) do not change. `pm_mid.ts` changes in its
  comments only: sha256 `9fd37436d6c535d56ed5da85824b9346eb2aec5142152787f507664f011eadfd` (frozen above:
  `b7854ab5a3c93d4e420654c7c21567aae8db27f08a9fc961aefc703ac90471b6`); `PM_MID_INSTANCE` is unchanged, `readsPayouts`
  false among it, so mid-pool still reads no reward, payout or rebate.
- **Why it is the same test.** The path decides its mode from the config before it asks about a key: a turn is live
  only when sends are enabled in code, `dry_run` is off and the key is loaded (`pm_live.ts`). With `dry_run` on, every
  turn's mode, reason, gates, selection, quotes, would-be orders and minutes are what they were; a dry-run order is
  recorded, never sent, and the key signs nothing. The paper layer reads `pm_mid_config`, `pm_mid_markets`,
  `pm_mid_minutes` and `pm_mid_orders`, whose rows this does not change, so its decisions are unchanged. What does
  change in the record: `pm_mid_state.state`'s `keyed` reads true and `signerProblem` null (until now false and the
  instance's own sentence), and a key that failed to load would now be reported among the action's faults, as
  mini-pool's is. Pinned (`agents/pm_mid.test.ts`): as deployed, a simulated day of the action sends nothing but GETs
  and the exclusion's keyless batch read, and neither does a config out of dry-run but unarmed; armed, the same action
  and client send; the kill switches reach the venue; a key that is not the stored signer's loads none. On the old
  wiring three of those fail.
- **What the frozen statements read that this touches.** All three read `pm_mid_config` (`created_at`, for d1; the
  check also `max_markets`, `select_budget_usd`, `cap_market_usd`, `cap_total_usd`, `dry_run` and
  `live_confirmed_at`): `0084` changes its constraints and adds a trigger, and writes none of those values. The check
  reads `pm_mid_orders`, `pm_mid_minutes` and `pm_mid_events` of mode `dry_run` only; `pm_mid_orders` may now hold
  `live` rows, which it does not read. (f) stays N/A as frozen; its row prints `dry_run` and `live_confirmed_at`, which
  read `true` and `null` unless Davies arms mid-pool. Nothing else they read is touched.
- **Arming mid-pool inside the window** would end the dry-run its paper layer fills: from that turn the path records
  live orders, which the layer does not read. The readout names it as a deviation with its day. Before any go-time
  statement it needs what the design's step 8m lists, a pre-registration of its own among them, as "The fourteen-day
  readout" above already says.
- **The health readings gain five scalars of `pm_mid_state.state`**: `keyed`, `signerProblem`, `pusd`, `at` and
  `sbRegion`, each read by name, never the rest of `state`. They are what the go-time statement reads (the key loaded,
  the account's balance and when, the region the turn ran from), and they describe the account and the key, which
  mini-pool's state shows the same, not mid-pool's markets, orders or P&L.
- **The window does not move:** d1 is 2026-10-03, checked by `mid_check.sql` as frozen.

## Addendum 2 (2026-10-04, about 15:00 UTC): deviation 2, the formula measured as the venue would hold our quotes

Written inside the window (d1 was 2026-10-03; the readout runs at or after 2026-10-17 00:10 UTC). Davies, 2026-10-04
about 14:10 UTC, verbatim:

> 把mini-pool现在就全部修复优化了，dry-run的问题如果影响mid-pool的话也都修复掉

In English: fix and optimise mini-pool completely now; any dry-run problem that also affects mid-pool, fix there too.
And about 14:45 UTC, verbatim: "所有不偷看条款全部取消，所有的数据都可用来达到最佳研究效果" (every no-peek clause is
cancelled; all data may be used for the best research). **From 2026-10-04 this test is not blind, on his word**: the
"No peeking" section above no longer binds, its readings are not deviations, and the readout runs as frozen and says it
was not blind. What changes, and nothing else:

- **Deviation 2: the deploy of 2026-10-04's measurement fix** to `pm_live.ts` and `pm_prep.ts`, the shared code mid-pool
  runs (mini-pool's pre-registration, Addendum 6, gives its evidence; deviation 1 was the read of 2026-10-03 23:36
  UTC). The readout names it with the day it is deployed; the days before it were measured the old way, the days after
  it the new, and the deploy's own day both.
- **What it changes in mid-pool's record, and only there.** The formula of a minute (`pm_mid_minutes`: `ours`, `others`,
  `formula_usd`, and `detail`, whose `m` is now the venue's midpoint and which gains `mRw`, RW's, and `after`) scores our
  quotes against the book as the venue would hold them, with our quotes in it: Polymarket scores every order "vs the
  size-cutoff-adjusted midpoint" of the market's one book, and our orders, at N ≥ the minimum, are in it. The code until
  now put the midpoint at the rest of the market's alone, so a dry-run whose book had moved since its quotes were placed
  read them as outside the spread they would have set live. The readout's sums of those minutes (`pm_mid_reward_days`'
  `formula_usd`, `formula_scored_usd`, `minutes_two_sided`) follow. The paper layer pays a matched minute the path's own
  figure of the quotes it rested, with them in the book (`detail.after`), instead of stepRw's line: `pm_midprep_minutes`'
  `reward` (RW's line stays in its `detail`), `pm_midprep_days`' `reward`, `reward_r40` and `pnl_day_r40`.
- **Measured on mid-pool's own record** (read 2026-10-04, after the cancellation above): the minutes whose formula was
  zero and is above zero with our quotes in the book were 277 of 2026-10-02's 8,168 market-minutes, 123 of d1's 11,520
  (d1's (d) would have read 82.2 % for 81.2 %) and 95 of 10-04's first 7,024. At placement our quotes move the venue's
  midpoint from RW's in 1,315 of 10-02's 8,045 matched minutes, 1,652 of d1's 11,455 and 856 of 10-04's first 6,720:
  those minutes' paper reward changes. What mid-pool loses most is not this: on d1, 1,931 of its 2,056 resting minutes
  with no formula had quotes more than twice the maximum spread apart, a book too wide to score with or without us.
- **No decision of mid-pool changes, pinned.** `agents/pm_mid_formula.test.ts` runs mid-pool through today's path and
  layer beside the code this document froze, byte for byte (`pm_live_mid_frozen.ts` sha256
  `8ba7b915018c8f34bc9f57486f703e016770696947d3d6665fa1a0fc44f39653`, `pm_prep_mid_frozen.ts` sha256
  `8d7861ab263554fba73e2ee2ef6f80bbfa7c33c1fa1971e00822c97b94794dea`, held to the hashes under "Its code at the freeze"
  by `src/pm_mid_prereg.test.js`), minute by minute over three simulated days, dry-run and live: every table, request,
  body and report is the frozen code's but the fields named above, its orders, fills, selections (RW's exclusion
  recomputed from public data included), settlements, paper fills and paper events whole, and where the venue's midpoint
  is RW's every figure is the frozen one.
- **Nothing else moves.** Its rule, its band, its exclusion and its margin, its sizes, its gates and its stops; its
  day-1 check (2026-10-03, every row PASS, (f) N/A) stands; `mid_check.sql`, `mid_readout.sql` and `mid_audit.sql` are
  unchanged. Mini-pool's book-quality rule (its Addendum 6) is mini-pool's instance alone (`PM_MINI_INSTANCE`):
  `PM_MID_INSTANCE` has none, and its selection is pinned unchanged by the test above.

## Addendum 3 (2026-10-04, about 18:00 UTC): deviation 3, the deploy of "Reward quotes live-prep"

Written inside the window (d1 was 2026-10-03; the readout runs at or after 2026-10-17 00:10 UTC), before the deploy it
records. Davies, 2026-10-04, verbatim: "以现在知道的所有信息，选出来一个最佳的reward区间+市场+rules等一切最优的策略，不考虑其他一切因素，
做出一个策略组合加到测试列表中叫它Reward quotes live-prep，然后你验证后确保一切都没问题后做上线准备", and about 17:00 UTC: "验证没问题就
直接落地TESTING STRATEGIES列表，把mini-pool的检验窗口全关了，目前上线live的最大candidate是这个live-prep策略". Live-prep is a third
instance of the order path and its paper layer (`agents/pm_lp.ts`, migration `0091_pm_lp.sql`, its own pre-registration
`2026-10-04-polymarket-lp-prereg.md`). What changes for mid-pool, and nothing else:

- **Deviation 3: the deploy of live-prep's build** to `pm_live.ts`, `pm_prep.ts` and `agents/index.ts`, the shared code
  mid-pool runs. The readout names it with the day it is deployed. Every rule it adds is an option only live-prep's
  instance sets (`PmLpOptions`, `PrepInstance.lp`); the exports the frozen copies are compared with text for text
  (`effectiveLimits`, `candidateOf`, `pmLiveDbTables`, the layer's book-keeping) are left byte for byte as they were,
  and live-prep's rules sit in new functions beside them (`lpLimits`, `lpCandidateOf`, `pmLpDbTables`, `classifyLp`,
  `stepSides`, `decideLp`).
- **No decision of mid-pool changes, pinned.** `agents/pm_mid_formula.test.ts`, unchanged, runs mid-pool through the
  build's path and layer beside the code this document froze, byte for byte (`pm_live_mid_frozen.ts`,
  `pm_prep_mid_frozen.ts`, the hashes under "Its code at the freeze"), minute by minute over three simulated days,
  dry-run and live, and finds every table, request, body and report the same but the fields Addendum 2 names; its test
  of every export, text for text and value for value, passes unchanged too. Mini-pool's instance is pinned the same way
  beside its own frozen code (`pm_instance.test.ts`, unchanged).
- **One rule of the account reaches mid-pool's config.** 0091 replaces 0084's trigger function, so a write arming
  `pm_mid_config` is now refused while `pm_live_config` OR `pm_lp_config` is armed (its words name the three paths);
  0084's trigger on `pm_mid_config` itself is unchanged. Mid-pool is unarmed and its dry-run never reads an arm, so no
  minute of its record moves; it narrows when mid-pool could be armed, which is Davies' decision either way.
- **Nothing else moves.** Its rule, its band, its exclusion and its margin, its sizes, its gates and its stops; its
  tables, its leases and its rows of the one-minute job; `mid_check.sql`, `mid_readout.sql` and `mid_audit.sql`. Live-prep
  quotes the universe of $10 and over with no exclusion, mid-pool's band among it: both are dry-runs, so neither's orders
  reach a book, and live-prep's own pre-registration says what its going live does to the other tests.

## Addendum 4 (2026-10-07, about 21:40 UTC): deviation 4, the day stop counts only the day's change

Written inside the window (d1 was 2026-10-03; the readout runs at or after 2026-10-17 00:10 UTC), before the deploy it
records. Davies, 2026-10-07, answering whether the day stop of mini-pool and mid-pool should keep counting every
holding's whole unrealised loss as the day's or count only the day's own change; the option he chose, verbatim:

> 只算当天变化

In English: count only the day's change. Why it was asked: the day stop's figure (`bookPnl` in `pm_live.ts`, "all of
it counts today: stricter") counted every holding's whole unrealised P&L against its cost as each day's, so an inventory
carried across 00:00 counted its whole loss again every day. Mid-pool's paper layer carries $330–360 of it (its days'
`held_value`), and tripped the −$25 day stop at the first minute of 2026-10-05 (−$26.84), 10-06 (−$48.52) and 10-07
(−$42.41) on that alone (`pm_midprep_events`, kind `loss_stop_day`), and quoted nothing for three days; a live path would
stop buying every day the same way. What changes, and nothing else:

- **Deviation 4: the deploy of this change** to `pm_live.ts` and `pm_prep.ts`, the shared code mid-pool runs. The day
  stop, the path's (`loss_day_usd`) and its paper layer's, now counts the day's change: what is held now at its marks,
  less what was held as the UTC day began at its marks then (a holding bought that day at its cost), plus the day's sells
  and settlements (`sinceOpenPnl`, `paperDayPnl`). The path keeps its opening marks in its state (`dayOpen`: the last marks
  read before 00:00); the layer the marks it held as the day began, the ones the day before closed on (`state.open`). The
  limit is unchanged, −$25 a day, and acts as before.
- **The total stop does not change**: −$75 in all, every holding from its cost, the carried loss included. On mid-pool's
  paper the total read −$60.32 at 2026-10-07 21:17 UTC (`pm_midprep_state`), $14.68 from it.
- **What the readout reads.** `mid_readout.sql` is unchanged. It reads `pm_midprep_days`' `fills_pnl_day`,
  `pnl_day_r40`, `held_value` and its stop flags: `fills_pnl_day` and `pnl_day_r40` keep the figure on cost, as frozen
  (the day rows gain the stop's figure in `detail.dayChange`, which the readout does not read). What moves is when the
  paper quotes: from the first 00:00 UTC after the deploy a carried inventory no longer stops it, so its fills, rewards and
  stop flags from then are a different rule's. **The readout names**, beside its rows: 2026-10-05, 10-06 and 10-07 as days
  the frozen day stop stopped at 00:00 on the carried inventory alone (each `stop_day` true, no fill on 10-05 and 10-06,
  rewards $0.07 and $0; 10-07's row is not closed at this writing); the deploy of this change, at the time of the Edge
  Functions run that deploys the commit carrying `pm_live.ts` sha256 below; and the first day counted the new way, the
  first full UTC day after that deploy (the rest of the deploy's own day counts as before: neither the path nor the layer
  has opening marks for it).
- **Pinned.** `agents/pm_daystop.test.ts` works it by hand, on the path and on the paper layer: 100 YES carried at a $40
  loss at the day's opening mark do not trip the $25 day stop at 00:00 or 00:01; a fresh $26 loss within the day does;
  the total stop trips past −$75 on the carried loss; on the frozen rule the same turns trip the day stop at 00:00.
  `agents/pm_mid_formula.test.ts` runs mid-pool's instances on the frozen rule (`dayStopOnCost`, which no action sets)
  beside `pm_live_mid_frozen.ts` and `pm_prep_mid_frozen.ts`, byte for byte (the hashes under "Its code at the freeze"),
  and finds every table, request, body and report the same but the fields Addendum 2 names, as before; its last test
  runs mid-pool as deployed beside that over the same simulated days and finds them the same until a holding is carried
  across 00:00 (M3's 20 YES at 0.46, marked 0.315 as 10-07 began): the frozen rule stops the day at 00:01 on the carried
  −$2.90, the deployed one opens and stops at 06:00 on the settlement's −$6.30 that day (−$9.20 in all).
- **The code it deploys**: `pm_live.ts` sha256 `4032d6c01e255f5e682eb916d8ffdbdb35e774a7859f8defccfb22afe9236706`,
  `pm_prep.ts` sha256 `a13ef03c870db2a17411456ffbfcb1b203ffe4654525d7792e6e38ed675b696a`; `pm_mid.ts` is unchanged,
  `9fd37436d6c535d56ed5da85824b9346eb2aec5142152787f507664f011eadfd`. The frozen copies stay the bytes named above.
- **Nothing else moves.** Its rule, its band, its exclusion and its margin, its sizes, its gates and the total stop; its
  tables, leases and rows of the one-minute job; `mid_check.sql`, `mid_readout.sql` and `mid_audit.sql`. The draft of its
  funded pre-registration (`2026-10-04-polymarket-mid-pool-live-prereg.md`) states the day stop the same way.

## Addendum 5 (2026-10-08, about 00:05 UTC on 10-09): deviation 5, what Polymarket pays told apart per path

This addendum was written inside the window, before the deploy it records. Its readout runs at or after 2026-10-17
00:10 UTC.

**Deviation 5 is the payouts-per-path change**, built on 2026-10-04 and kept until now in `docs/agents/pending/`. It is
applied to `pm_live.ts` (after it, sha256 `57f4b1d74b89b76f30fe5060ab4c9431cbe9757f78e4a82cc8d3b9cb81821e40`),
`pm_mid.ts` and `index.ts`, for live-prep's go preparation. Davies, 2026-10-08: "确保live-prep各方面都做到最好，然后最好上线准备"
(live-prep's pre-registration, Addendum 4).

**What changes:**

- A path's readout books a payout only for a market its own minutes show it quoting live that day.
- Mid-pool reads what the account earns only once it is live.
- `pm_mid.ts` changes only in comments that described the change as pending: `pm_mid.ts` was sha256
  `9fd37436d6c535d56ed5da85824b9346eb2aec5142152787f507664f011eadfd` (Addendum 1), and `pm_mid.ts` is now sha256
  `215b5435fd86b8e06c2145ae7a7176304f1ee06773c820056d51636182e6c2b2`.
- No dry-run decision of mid-pool changes. That is pinned by `agents/pm_payouts.test.ts`, which runs mid-pool through
  today's path beside the path this file froze, minute by minute, and finds every decision the same.

**What the readout names.** `mid_readout.sql` is unchanged. Beside its rows, the readout names this deploy, at the time
of the Edge deploy that carries it, as deviation 5. Mid-pool's own go-live remains Davies' decision, and its draft
funded pre-registration's precondition 3 now reads as met.

## Addendum 6 (2026-10-09, about 01:30 UTC): deviation 6, the order path's live turn hardened for live-prep's go

This addendum was written inside the window, before the deploy it records. Its readout runs at or after 2026-10-17
00:10 UTC.

**Deviation 6 is a set of changes to the shared order path**, `pm_live.ts`, made for live-prep's go. Davies, 2026-10-09:
"可以按原计划上线 … 期间你再验证一下所有系统和下单等所有上线会用到的细节都确保没有问题". In English: go live as planned, and
meanwhile verify every detail of the order path. Live-prep's pre-registration, Addendum 5, gives each change and its
evidence. After it, `pm_live.ts` sha256 `a208878b0f3b3c70fccee0fef34127ff28fa8fbd96c857e507bb494a88ed2703`, where
Addendum 5 above named `57f4b1d7…1e40`. `pm_mid.ts` is unchanged, at `215b5435…c2b2`.

**What changes, by change:**

- **A6:** same-second CONFIRMED fills are booked buy first. This is live fills only.
- **A7:** a live buy being cancelled counts against the caps until it is read back. This is live mode only.
- **F1:** an approval gate on the outcome tokens. It runs in live-prep's live turn only, never in mid-pool's.
- **F3:** a live order shown nowhere after its expiry is closed as expired. This is live rows only.
- **F4:** a book naming a protocol (Polymarket Protocol V2) is unquotable. A refusal of the order's version is reported
  once an hour.
- **F5:** a frozen live cancel is asked again on the switch back to dry-run.
- **U1:** what is held is robust to the conditional balance's reading. This is live-prep's live turn only.

**No dry-run decision of mid-pool changes**, except through F4 on a book that names a protocol. None of live-prep's ten
books did on 2026-10-09, and mid-pool's books were not read for it. `agents/pm_mid_formula.test.ts` and `agents/pm_payouts.test.ts`
run mid-pool through today's path beside the path this file froze, minute by minute, and find every decision the same.

**What the readout names.** `mid_readout.sql` is unchanged. Beside its rows, the readout names this deploy, at the time
of the Edge deploy that carries it, as deviation 6.

## Addendum 7 (2026-10-09, about 01:55 UTC): deviation 7, live-prep's 12,000 POSTs a day

This addendum was written inside the window, before the deploy it records. Its readout runs at or after 2026-10-17
00:10 UTC.

**Deviation 7 is live-prep's daily POST governor raised to 12,000** (Davies, 2026-10-09: "同意提到 12000"; live-prep's
pre-registration, Addendum 6, gives the evidence). It changes the shared `pm_live.ts`: after it, `pm_live.ts` sha256
`8920e0c25306b85784a9255840bb2144045a78404020370a0d3e83ec4100466a`, where Addendum 6 above named `a208878b…2703`. The
one change is that live-prep's limits (`lpLimits`) take their own ceiling, `PM_LP_MAX_POSTS_DAY`, 12,000.
`0105_pm_lp_posts_12000.sql` writes only `pm_lp_config`.

**Mid-pool's governor stays at 6,000.** Its limits are `effectiveLimits`, whose ceiling `PM_LIVE_MAX_POSTS_DAY` is
unchanged, and its config and CHECK are untouched. `agents/pm_mid.test.ts` pins a live mid-pool turn at 6,000 POSTs that
places nothing. No dry-run decision of mid-pool changes: `agents/pm_mid_formula.test.ts` and `agents/pm_payouts.test.ts`
run it beside the path this file froze, minute by minute, and find every decision the same.

**What the readout names.** `mid_readout.sql` is unchanged. Beside its rows, the readout names this deploy, at the time
of the Edge deploy that carries it, as deviation 7.

## Addendum 8 (2026-10-09, about 15:00 UTC): deviation 8, the rule's input carries the path's capital

This addendum was written inside the window, before the deploy it records. Its readout runs at or after 2026-10-17
00:10 UTC.

**Deviation 8 is a field added to the quoting rule's input for live-prep's limit on near-certain buys.** Davies,
2026-10-09: "加上，但你研究下这个最多买的数值最优的设定后再加，并且以持仓比例来算不是硬数值". Live-prep's pre-registration, Addendum 7,
gives the rule and its evidence. It changes the shared `pm_live.ts`: after it, `pm_live.ts` sha256
`749bfcdb2b9170ddc455f18c4a5b691c89450c3bd9c8fd9784ada3d9ef2def09`, where Addendum 7 above named `8920e0c2…466a`. The
one change is that the rule's input (`PmQuoteInput`) carries `capital`, the turn's total cap (`capTotal`), in both of the
turn's calls of the rule. Live-prep's `lpQuotes` reads it; `rwQuotes` does not.

**Mid-pool is unchanged.** Its rule is `rwQuotes`, whose output does not depend on the new field. Its limits, config,
tables and every dry-run decision are untouched. `agents/pm_mid_formula.test.ts` and `agents/pm_payouts.test.ts` run it
beside the path this file froze, minute by minute, and find every decision the same.

**What the readout names.** `mid_readout.sql` is unchanged. Beside its rows, the readout names this deploy, at the time
of the Edge deploy that carries it, as deviation 8.
