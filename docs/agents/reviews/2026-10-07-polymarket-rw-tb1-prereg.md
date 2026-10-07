# Pre-registration TB1: x1 on the minutes whose touch is one tick wide — sit them out, or rest a tick behind

Written 2026-10-07 (UTC), before any minute it is judged on exists. Judged once, out of sample: on RW-C's fourteen days,
2026-10-09 00:00 → 2026-10-23 00:00 UTC, read after RW-NEXT's RW-C verdict (no earlier than 2026-10-23 00:05 UTC).
Frozen by the commit that adds this file; nothing below may change after it, and any deviation is reported as a
deviation. **It was designed after a non-blind read of the record** (below): every minute it is judged on comes after the
freeze, but the idea and its parameter were chosen from RW's record of 2026-09-25 → 10-07.

It changes no rule that runs and no frozen test: RW's engine, RW-E's replay, the seven arms already in RW-X's replays,
their pre-registrations and every verdict they are part of are untouched (`2026-09-24-polymarket-rw-paper-spec.md`,
`2026-09-26-polymarket-rw-end-prereg.md`, `2026-09-27-polymarket-rw-variants-prereg.md`, `2026-09-28-rw-next-prereg.md`,
`2026-10-02-polymarket-rw-rest-prereg.md`). In particular **x4's and x5's frozen Test 1 (on or after 2026-10-09 00:05
UTC, from `pm_rw_x_days`) and Test 2 (on RW-C's minutes) still run exactly as frozen**, and so do their replays. It does
not change live-prep's frozen rules (`2026-10-04-polymarket-lp-prereg.md`) or any order path. What adding two arms changes
is recorded in the addendum at the end.

## Why

Davies, 2026-10-07, verbatim:

> TB1"紧盘口"：两个版本。一个是价差 ≤ 1 档时不报价；另一个是这时把报价往后退一档。作为 RW-C 回放里新增的两个版本，不动
> live-prep 已冻结的规则。用 10-09 到 10-22 的新数据做样本外检验。预注册要在 10-09 00:00 UTC 前冻结。 … 目前的variant-3和4转为
> 在后台继续记录，前端的3和4改为这两个新的测试，做好就立即上线，页面数据清空从新开始

In English: TB1, "tight book", in two versions: one does not quote when the spread is at most one tick; the other moves
the quotes one tick back then. Two new arms in RW-C's replay, without touching live-prep's frozen rules. An out-of-sample
test on the new data of 10-09 to 10-22, its pre-registration frozen before 10-09 00:00 UTC. The current variant-3 and
variant-4 keep recording in the background; the page's variant-3 and variant-4 become these two tests, live as soon as
they are built, their page data cleared and started afresh.

**Seen before the freeze (not blind; the no-peek clauses were withdrawn on 2026-10-04).** A read-only study by the
coordinating session on 2026-10-07 of RW's stored record (`pm_rw_minutes`, `pm_rw_prints`, `pm_rw_fills`,
`pm_rw_selection`, `pm_rw_settlements`) and of the replays' rows, 2026-09-25 → 10-07 ~21:50 UTC; its scripts are in that
session's scratchpad and are not committed:

* RW's rule rests a tick inside the touch, or joins it when the spread is two ticks or less. **In minutes whose raw touch
  (ask − bid) was at most one tick, RW's paper fills were adverse**: over x1's universe, those fills' formula rewards were
  $158.69 against −$225.31 of fills P&L to the end mark (the study's figure; not recomputed here).
* On the study's simulator of RW-X's own `stepRw` with live-prep-like account rules ("S2"), over RW's record, at
  R = 0.40 (Polymarket paying 0.40 of the formula): "skip ≤ 1 tick" +$46.71 against S2 ($540.49 against $493.78;
  bootstrap P(> 0) 0.95), "one tick back ≤ 1 tick" +$19.65 ($513.43; P 0.90); with no account rules (x1-like), "skip
  ≤ 1 tick" +$162.26 ($557.86 against $395.59). The differences were recomputed here from the study's output file; the
  two P values are the study's.
* On RW-X's own replay with the code this file freezes, over RW's record with TB1's rule from 2026-10-03 00:00 UTC
  instead of its production start, each arm flat there against x1's rules started flat at the same minute ("x1f"), to
  10-07 21:49 UTC: x1f total +$382.35 (stress +$147.92, rewards $374.65, 277 fills); tb1-skip +$388.81 (stress +$180.51,
  rewards $336.53, 235 fills); tb1-back +$396.71 (stress +$168.59, rewards $370.24, 257 fills). At R = 0.40 the
  differences against x1f were +$29.34 (tb1-skip; by day +7.85, +20.43, +4.50, +2.28, −5.73) and +$17.01 (tb1-back; +8.83,
  +9.54, −1.12, +2.32, −2.57). Five days, in sample: this is the expectation, not evidence.

The threshold, one tick, is the one the study read; no other was tried for the bar. The second version's step, one
tick, has no parameter of its own. RW-C's minutes, on which the arms are judged, did not exist when this was written.

## The arms

Each is x1 exactly — RW-X's `x1`: RW-E's rule (no market on a day its scheduled end falls inside) and no `weather_fees`
market — plus one rule, TB1, in a minute it quotes a market whose **stored raw touch** is at most one tick wide:
`(ba − bb) / tick ≤ 1` (+1e-9 for rounding), with `bb`, `ba` and `tick` the minute's row of the source's
`*_minutes` table. A minute whose stored `bb` or `ba` is missing is not such a minute. In every other minute, the arm is
x1.

1. **TB1-skip** (`tb1-skip`; page name "Reward quotes variant-3"): in such a minute it rests nothing: no quote, no
   reward, no fill; what it holds is marked at the minute's adjusted mid, as every arm of the replay marks a market it
   holds and does not quote. RW's rule has no close-only orders, so there is no exit order to keep.
2. **TB1-back** (`tb1-back`; page name "Reward quotes variant-4"): in such a minute each of RW's quotes for that minute's
   book (`quote` in `agents/pmrw.ts`: a bid `b` and an ask `a` around the adjusted mid `m`) rests one whole tick further
   from `m` — the bid at `b − tick`, the ask at `a + tick` — where the moved quote stays inside (0, 1) and inside the
   reward band (a distance from `m` of less than `v` cents by more than 1e-9 ¢, `v` the market's maximum spread); a side
   that cannot move stays RW's (`backTicks`). The scores, the others' score, the reward and the fills are then RW's own
   rule's at the moved quotes, as for x4 and x5: RW's `quote` places them from the book with its raw touch put a tick
   outside them (`restRow`), and RW's `stepRw` scores, fills and books them.

Everything else is RW's, unchanged: fills only from prints strictly through a quote in `(t, t + 60 s]`, at the quote,
up to N a side; the 3N cap; settlement; the accounts (total, stress, capital). A minute in which the arm holds what RW
held, quotes what RW quoted and rests where RW rested takes RW's recorded decision and fills, as every arm of the replay
does; any other quoted minute is run through `stepRw` on the stored book and the minute's prints (`minutePrints`), and the
market is named in the arm's `diverged`. A skipped minute in which RW recorded fills names the market too, since those
fills are not the arm's.

**Each starts flat at its own first minute** (`fresh`): it is not a copy of x1 and holds nothing at that minute. On
RW-C's minutes that minute is RW-C's first, 2026-10-09 00:00 UTC, where every arm of that replay starts flat anyway.

As `agents/pmrw_x.ts` specs them (`RWX_SPECS`, mapped to RW-C by `RWCX_SPECS`), on RW-C's minutes: `tb1-skip`
`{ noSameDayFrom: 2026-10-09T00:00Z, from: 2026-10-09T00:00Z, noCats: ["weather_fees"], tight: { mode: "skip",
maxTicks: 1, from: 2026-10-09T00:00Z }, fresh: true }`; `tb1-back` the same with `mode: "back"`. They are computed by that
file's rules (`replayArms`, `isTight`, `backTicks`, `tightBack`, `restRow`, `minutePrints`) as they stand at the commit
that freezes this file; a later change may add bookkeeping for the page and nothing else, and the accounts must stay
those of the freezing commit.

## Data and replay

Only what RW-C's engine stores (`pm_rwc_selection`, `pm_rwc_minutes`, `pm_rwc_fills`, `pm_rwc_prints`,
`pm_rwc_settlements`), replayed by `agents?action=pmrwc-x` (every minute) into `pm_rwc_x_state` / `pm_rwc_x_days`
beside RW-NEXT's arms and x4 and x5. Day rows hold running figures; a day's figure is the day's row less the day before's
(10-09 against zero). From this commit every arm's day row also holds `detail.rewardByMarket`, each market's running
reward beside `detail.perMarket`'s running total and stress.

**Checks before anything is read**, every day 2026-10-09 → 10-22, to within $0.01: RW-NEXT Part 2's checks for that
replay (its `rw` arm against `pm_rwc_days`, its `e` arm against `pm_rwc_e_days` arm `e`; `checkMaxUsd`,
`checkEMaxUsd`). And the start: both arms are among `pm_rwc_x_state`'s arms with `base` `{}` and no `start` of their own,
which is what they hold when they began at 2026-10-09 00:00 UTC.

**Slip rule.** If either arm is missing from `pm_rwc_x_state` or carries a `start` (the replay met it after its first
minute and started it later), or if `pm_rwc_x_days` lacks its row or x1's for any of the fourteen days, the test is void
for that arm and reported so, with what is there. A minute RW-C missed quotes nothing, as RW's spec says.

## The bar (each arm, judged on its own)

From `pm_rwc_x_days`, the fourteen rows 2026-10-09 → 10-22 of the arm (A) and of `x1`. For a day i, A's figures are its
day row's `total`, `stress_total`, `reward`, `fills` less the day before's (10-09 against zero); `capital` is the row's.
"At R = 0.40" a day's figure is `total − 0.6 × reward` (the fills' P&L plus 0.40 of the formula rewards). Per market c,
a market-day's change is its `detail.perMarket[c].total` and `detail.rewardByMarket[c]` less the day before's (0 where
absent).

1. Total > 0.
2. Stress total > 0.
3. At least 100 fills.
4. No single market holds more than 50 % of the total (per market from the 10-22 row's `perMarket`), and the total
   without the best market is > 0.
5. The fourteen day totals resampled with replacement: Python's `random.Random(20261023)`, 2,000 draws of fourteen
   `choice`s, the sums sorted, the one at index `int(0.05 × 2000)` = 100 is > 0.
6. Worth money: the total on the arm's capital (the largest of the fourteen rows' `capital`), × 365 / 14, exceeds 4 % a
   year.
7. It improves on x1: its stress total over the fourteen days exceeds x1's.
7′. Paired against x1 at R = 0.40: with `D_i` = A's day figure at R = 0.40 less x1's on the same day, a fresh
   `random.Random(20261023)`, 2,000 draws of fourteen `choice`s of the `D_i`, the sums sorted: the one at index 100 is
   > 0.
8. Not one market-day: with `d_{c,i}` = A's market-day change at R = 0.40 (`Δtotal − 0.6 × Δreward`) less x1's for the
   same market and day, over every market of either arm, the sum of all `d_{c,i}` less the largest one is > 0.

An arm passes if all ten conditions (1–8 with 7′) hold. Two arms are tested; no correction is made for that, and the
report says so.

**Reported beside the bar, never part of it:** conditions 7′ and 8 at R = 1 (the formula) and at R = 0.58 (RW's stress
break-even), the differences against x1 in total, stress, rewards and fills, the count of market-days each arm leaves
`diverged`, and the same figures for x4 and x5 on the same days.

## What is read when

Anything, at any time (the no-peek clauses were withdrawn on 2026-10-04); the bar runs once, as above, on or after RW-C's
verdict, from the rows as they stand, with the script committed beside its output, and its report says it was not blind.
On RW's own minutes (`pm_rw_x_*`) the two arms run from 2026-10-08 00:00 UTC, or from the first minute the replay decides
after this commit's code lands if that is later (their `start`), to RW's end, 2026-10-09 00:00 UTC: at most a day,
shown on the page and **not judged**.

## What it cannot show

A quote the replay moves or withdraws is filled only from the prints that happened, against the book that was there; the
replay cannot know how others would have answered a quote that was not in the book, nor where in a queue a quote a tick
behind would have stood. Rewards are the formula's: whether Polymarket pays them, and at what R, is the live calibration's
question. Fourteen days are few, and conditions 7′ and 8 compare two arms that share every market and every minute.

## What follows

An arm that passes is a candidate rule to put to Davies, beside whatever RW-NEXT names, under RW-NEXT's Part 4; the
choice is his, and adopting it on any path (live-prep's included) is a new pre-registration on his word, never an edit
of a frozen one. An arm that fails is closed.

## Addendum to RW-NEXT Part 2 (RW-C's replays), recorded here because that file is frozen

RW-NEXT Part 2 replays RW-E and x1–x3 on RW-C's minutes by the frozen rules of `pmrw_e.ts` and `pmrw_x.ts`; the rest
pre-registration's addendum added x4 and x5. This commit adds `tb1-skip` and `tb1-back` to the x replay's arms
(`RWCX_SPECS` maps every arm of `RWX_SPECS`). What that changes:

1. `pm_rwc_x_days` and `pm_rw_x_days` hold rows for the two arms; migration `0096` widens both tables' arm check to take
   them. No other table, lease or row of `edge_calls` changes.
2. `pm_rwc_x_state.state.arms` (and `pm_rw_x_state`'s, from the arms' first minute there) holds two more arms, and each
   run replays them too.
3. Every arm's day row gains `detail.rewardByMarket` (bookkeeping, for condition 8). No figure and no existing key of any
   row changes.
4. Nothing of `rw`, `e`, `x1`–`x5`: their specs are byte for byte the ones frozen before (pinned in `pmrwc.test.ts` and
   `pmrw_x.test.ts`), and their accounts, day rows and the replay's checks are computed exactly as before. Checked on
   RW's whole stored record, 2026-09-25 00:00 → 10-07 21:49 UTC (593,424 minute rows, 12,598 prints, 3,831 fills), by the
   replay before this change (`origin/main` at `dd2e979e`) and after it, in 720-minute catch-ups (26 runs) and in
   3-minute runs (6,197): the seven arms' states were identical, and their 84 day rows identical once the new key is set
   aside, both with TB1 at its production start and with TB1 active from 2026-10-03 00:00 (pinned on a hand-built world
   in `pmrw_x.test.ts`: the same state and day rows with and without TB1, in one pass or in chunks).
5. RW-NEXT's health readings of that replay are unchanged (`last_minute`, `updated_at`, `last_error`; `checkMaxUsd`,
   `checkEMaxUsd`, `checkEDays`, `version`).
6. The test files that enumerate the arms, the page's rows or the arm check (`pmrw_x.test.ts`, `pmrwc.test.ts`,
   `pmrw_e.test.ts`) were edited there; no assertion about the seven arms' accounts was loosened.

**A deviation of RW-X's and the rest pre-registration's text, recorded with it.** Both allow a later change to
`pmrw_x.ts` that adds bookkeeping for the page and nothing else, the accounts staying those of their freezing commits.
Adding two arms and a day-row key is more than that; the seven arms' accounts are unchanged (item 4). On the page, on
Davies' word of 2026-10-07, x4 and x5 left it (as x2 and x3 did before) and the names variant-3 and variant-4 are TB1's.

**CPU**, measured 2026-10-07 in this repository's container, single thread, never on Supabase (an Edge request has 2 s
of CPU), on RW's record: the replay's work in a run as it runs every minute (three minutes, over RW's last twelve hours,
241 runs) took a median of 2 ms before this change and 2 ms after it with TB1 active (99th percentile 12 and 18 ms); a
720-minute catch-up of those twelve hours, the most one run replays, 306 ms before and 234 ms after (the order of the two
is within the run-to-run noise of this measurement). The busiest 720-minute chunk of RW's whole record took at most
about 1.1–1.2 s with either code.
