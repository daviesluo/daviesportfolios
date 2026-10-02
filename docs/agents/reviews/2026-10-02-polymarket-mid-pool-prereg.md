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
