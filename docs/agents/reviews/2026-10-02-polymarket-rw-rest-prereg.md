# Pre-registration RW-X4 and RW-X5: where x1's quotes rest, replayed beside it

Written 2026-10-02 (UTC), before any minute they are judged on exists. They are judged twice: on 2026-10-03 00:00 →
2026-10-09 00:00 UTC, six days of RW's paper run, and on 2026-10-09 00:00 → 10-23 00:00 UTC, RW-C's fourteen days. Frozen
by the commit that adds this file; nothing below may change after it, and any deviation is reported as a deviation. It
changes no rule that runs: RW's engine, RW-E's replay, the five arms already in RW-X's replay and every verdict they are
part of are untouched (`2026-09-24-polymarket-rw-paper-spec.md`, `2026-09-26-polymarket-rw-end-prereg.md`,
`2026-09-27-polymarket-rw-variants-prereg.md`, `2026-09-28-rw-next-prereg.md`). What adding two arms to the replays
changes is recorded in the two sections before the last.

## Why

Davies, 2026-10-02 ~17:15 UTC: "这个根据你的推荐再加1-2个variant对比（加在目前表现最好的无当天结束+无天气市场的基础上），暂停规则
（variant-3）如果表现不好的话可以隐藏掉，新加的策略从variant-3开始，但后台可以继续像之前variant-4一样继续记录，现在就做不要等，另外之前隐藏的
variant-4表现如何？有比variant-2（不做天气）更好吗？有的话就也加在这个list上变成原来的variant-3". In English: add one or two
variants, as recommended, on the best one so far — no market that ends the day it is quoted and no weather market (x1,
"Reward quotes variant-2"); hide the pause rule (x2, "variant-3") if it is doing badly, numbering the new ones from
variant-3, but keep recording it as variant-4 (x3) is kept; do it now; and say whether the hidden variant-4 beats
variant-2, and put it back on the list as variant-3 if it does.

What was read to answer him, aggregates only: the change over 2026-09-28 → 10-01 of each arm's day rows in
`pm_rw_x_days` (the rows are running totals; each figure is the 10-01 row less the 09-27 row), read by the coordinating
session on 2026-10-02:

| arm | total | stress | rewards | fills | largest capital |
|---|---:|---:|---:|---:|---:|
| rw (RW) | +$802.90 | +$155.44 | $994.25 | 1,318 | $1,720 |
| e (RW-E, variant-1) | +$615.19 | +$236.86 | $616.38 | 541 | $1,418 |
| x1 (no weather, variant-2) | +$641.38 | +$300.68 | $582.91 | 364 | $1,310 |
| x2 (pause on jumps, variant-3) | +$579.13 | +$211.72 | $596.07 | 518 | $1,411 |
| x3 (both, variant-4) | +$611.66 | +$279.35 | $565.03 | 354 | $1,301 |

x2 is the weakest variant on the total, below RW-E on both figures: it leaves the page, and both replays keep running it
as they run x3. x3 is below x1 on the total and on the stress: it stays off. Four days are four draws; none of this is a
verdict, which RW-X's pre-registration reaches on or after 10-09 by its own bar.

The two new rules act on every market rather than on a kind of market. RW's selection held sports markets on six
market-days in its first nine days, none ending the day it was chosen, so a rule for sports would leave x1 unchanged on
most days and could not be read. Two things in the frozen rule act everywhere: where the quotes rest, and what is held.

From the spec's formula, not from any result:

* **The reward.** A minute pays `rate / 1440 × Q / (Q + O)`, where `Q = N × min(S_bid, S_ask)` is our score, the smaller
  side's, with `S = ((v − s) / v)²` for a quote `s` cents from the adjusted mid in a band of `v` cents, and `O` the others'
  score in the book. Where our score is most of the pool, `Q` can fall a long way before the reward does; where it is a
  small part of it, the reward falls with `Q`.
* **The fills.** A quote fills only on a print strictly through it, at our price, up to N a side a minute. RW's quote
  rests a tick inside the touch, or joins it when the spread is two ticks or less, so it fills on the flow at the touch.
  A quote further out fills only when the price trades further through, at a price further from the mid.
* **The stress.** The stress arm, which the bar compares, halves the rewards, charges every fill a tick, and marks what
  is held at the adjusted touch. Every fill and every share held costs it something; the rewards count half.
* **The inventory.** RW's only inventory rule stops a side at 3N. With the smaller side's score, a stopped side stops the
  whole reward of that market, which is why RW-X's research found two lower caps (2N and N) worse on both figures.

**x4 ("wide")** rests both quotes further from the mid exactly where it costs little: the most whole ticks out that keep
nine tenths of the minute's reward at RW's quotes. In a pool RW holds almost alone it goes out to the band's last tick;
in a pool it shares it stays where RW is. It gives up at most a tenth of any minute's reward for fewer fills, each
further from the mid. **x5 ("lean")** moves the quote that would add to what is held a tick further out for every whole N
held, so the side that would reduce the position is the likelier to fill, and the side that adds keeps a score (lower)
instead of being stopped: a graded version of RW's cap, from the first N rather than at 3N. Whether either beats x1 is
the question this file asks.

The parameters were set before any market-level figure was read and are not tuned on any result: a tenth is the most
x4 may give up in any minute; x5's step is one tick for each N, the order size RW fills in, and has no parameter of its
own. Neither was run on RW's recorded days.

## What was seen before the freeze (disclosed)

* Everything RW-E's, RW-X's and RW-NEXT's pre-registrations disclose.
* The aggregate table above, and that RW's selection held sports markets on six market-days in nine, none ending the
  day it was chosen.
* For the build, read by this session: the arm checks of `pm_rw_x_days` and `pm_rwc_x_days` (catalog); in RW's last 720
  minutes before 2026-10-02 18:04 UTC, 24,641 stored minute rows over 44 markets and 302 prints (counts, to size the CPU
  measurement below); `pm_rw_x_state`'s size (271,114 bytes), version (2), arms (`rw`, `e`, `x1`–`x3`), `last_minute`,
  `last_error` (none) and checks ($0 and $0 over 7 days).
* No market-level figure of 2026-09-28 or later: no market's fills, P&L, book, minute or print.

## The variants

Each is x1 exactly — RW-X's `x1`, RW-E's rule from 2026-09-27 00:00 and no `weather_fees` market from 2026-09-28
00:00 UTC — plus one rule from **2026-10-03 00:00 UTC** on where its quotes rest. In a minute it quotes a market, the rule
starts from RW's own quotes for that minute's stored book (`quote` in `agents/pmrw.ts`: a bid `b` and an ask `a` on the
minute's tick grid `t`, around the adjusted mid `m`), the market's maximum spread `v` in cents, RW's order size N
(`sizeN`), and the others' score `O` as RW reads it from the book (`othersOf`). "Inside the reward band" is a distance
from the adjusted mid of less than `v` by more than a rounding error (1e-9 ¢): RW's `scoreS` is zero at the band's edge,
and a price on the grid reaches the edge a hair either side of it.

1. **RW-X4, "wide"** (`x4`; page name "Reward quotes variant-3"): both quotes rest `j` whole ticks further from the
   adjusted mid than RW's, the bid at `b − j t` and the ask at `a + j t`, with `j` the largest whole number such that for
   every step up to `j` both quotes are inside (0, 1) and inside the reward band, and
   `Q_j / (Q_j + O) ≥ 0.9 × Q_0 / (Q_0 + O)`, where `Q_j = N × min(S(v, s_bid), S(v, s_ask))` at the moved quotes with both
   sides counted as quoted. `j` is 0 when RW's own quotes score nothing.
2. **RW-X5, "lean"** (`x5`; page name "Reward quotes variant-4"): with `H` what the arm holds in the market as the minute
   begins, the quote that would add to it — the bid while `H > 0`, the ask while `H < 0` — rests `k` whole ticks further
   from the adjusted mid than RW's, `k = floor(|H| / N)`, reduced to the most that keeps it inside (0, 1) and inside the
   reward band. The other quote is RW's. Holding less than N, both are RW's.

Everything else is RW's, unchanged: the scores, the others' score and the reward at the arm's own quotes; fills only
from prints strictly through a quote in `(t, t + 60 s]`, at the quote, up to N a side; the 3N cap, which still stops
the adding side; settlement; and the accounts (total, stress, capital). A minute in which the arm's quotes rest where
RW's did and it holds what RW held takes RW's recorded decision and fills, as every arm of the replay does; any other
quoted minute is run through RW's own `stepRw` on the stored book and prints, its quotes placed by RW's own `quote` from
the book with its raw touch put one tick outside them (`restRow`), and the market is named in the arm's `diverged`.

As `agents/pmrw_x.ts` specs them (`RWX_SPECS`): `x4` `{ noSameDayFrom: 2026-09-27T00:00Z, from: 2026-09-28T00:00Z,
noCats: ["weather_fees"], rest: { rule: "wide", from: 2026-10-03T00:00Z, keep: 0.9 }, seed: "x1" }`; `x5` the same with
`rest: { rule: "lean", from: 2026-10-03T00:00Z }`. They are computed by that file's rules (`replayArms`, `restTicks`,
`wideTicks`, `leanTicks`, `restRow`, `minutePrints`) as they stand at the commit that freezes this file; a later change may
add bookkeeping for the page and nothing else, and the accounts must stay those of the freezing commit.

## Data and replay

Only what RW's engine stored (`pm_rw_selection`, `pm_rw_minutes`, `pm_rw_fills`, `pm_rw_prints`, `pm_rw_settlements`),
replayed by `agents?action=pmrw-x` into `pm_rw_x_state` / `pm_rw_x_days` beside the five arms there, every minute.

The two arms join a replay that is already running. Until 2026-10-03 00:00 their rules are x1's, rule for rule, so the
first run after this commit's deploy starts each as a copy of x1's arm — its accounts and its list of markets run through
the rule — which is what a replay from RW's start would hold (pinned in `pmrw_x.test.ts`: added mid-way, they end where
arms that were always there end). The copy is made only while the replay has not yet replayed 2026-10-03 00:00. Each
enters 10-03 holding exactly what x1 held at 10-03 00:00, and its result is the change over the days from its 10-02 row,
which equals x1's.

**Slip rule.** If x4 and x5 are not in `pm_rw_x_state`'s arms when the replay first replays 2026-10-03 00:00, the
replay leaves them out for the rest of RW's run (they cannot join later), Test 1 is void and reported as such, and Test 2
is unaffected.

**Checks before anything is read.** RW-X's two checks, every day 2026-09-25 → 10-08: the replay's `rw` arm reproduces
`pm_rw_days` and its `e` arm reproduces `pm_rw_e_days` arm `e`, to within $0.01 (`checkMaxUsd`, `checkEMaxUsd`). And the
copy: the 10-02 rows of `x4` and `x5` in `pm_rw_x_days` equal x1's 10-02 row in `total`, `stress_total`, `reward`,
`fills`, `capital` and `markets`. If any fails, the test is void and reported with the difference.

## The bar (each of x4 and x5)

### Test 1 — RW's minutes, 2026-10-03 → 2026-10-08, six days

A day's figure is the change of the arm's running figure over that UTC day: the day's row in `pm_rw_x_days` less the
row of the day before (10-03 against 10-02). Per market, a market's figure over the six days is its `detail.perMarket`
total in the 10-08 row less that in the 10-02 row (0 where it is absent).

1. Total > 0.
2. Stress total > 0.
3. At least 100 fills.
4. No single market holds more than 50 % of the total, and the total without the best market is > 0.
5. The six day totals resampled with replacement (2,000 draws, seed 20261009, Python's `random.Random(seed)`, six
   `choice`s a draw, the sums sorted and the one at index `int(0.05 × 2000)` read): the 5th percentile of the sum is > 0.
6. Worth money: the total on the arm's capital (RW's definition: the largest, over the six days, of the day rows'
   `capital`), annualised (× 365 / 6), exceeds 4 % a year.
7. It improves on x1: its stress total over the six days exceeds x1's (`pm_rw_x_days` arm `x1`) over the same six days.

### Test 2 — RW-C's minutes, 2026-10-09 → 2026-10-22, fourteen days

`agents?action=pmrwc-x` replays every arm of `RWX_SPECS` on RW-C's minutes with every "from" at RW-C's first minute,
2026-10-09 00:00 UTC (`RWCX_SPECS`): x4's and x5's rules apply from that minute, and the replay starts flat. The same
seven conditions over the fourteen days, from `pm_rwc_x_days` (10-09 against zero), with seed 20261023, fourteen
`choice`s a draw, annualised × 365 / 14, and condition 7 against x1 on RW-C's minutes (`pm_rwc_x_days` arm `x1`). The checks
before it are RW-NEXT Part 2's for that replay, every day 2026-10-09 → 10-22, to within $0.01: its `rw` arm against
`pm_rwc_days` and its `e` arm against `pm_rwc_e_days` arm `e`.

## What is read when

* Until 2026-10-09 00:05 UTC, of these arms: whether they are in `pm_rw_x_state`'s arms, and the replay's health readings
  as RW-X's are read (`last_minute`, `updated_at`, `last_error`; `checkMaxUsd`, `checkEMaxUsd`, `checkEDays`). No
  market-level figure of x4 or x5 is read before then, as none of 2026-09-28 or later of any arm is.
* On or after 2026-10-09 00:05 UTC, once `pm_rw_x_days` holds 10-08's rows: Test 1, written up beside RW-X's verdict.
* Under RW-NEXT's no-peek list until its RW-C verdict (no earlier than 2026-10-23 00:05 UTC): nothing of `pm_rwc_x_*`
  beyond its health readings. Test 2 is computed after that verdict, from `pm_rwc_x_days`.

## What it cannot show

Six days are few, and the first test's condition 7 compares two arms that share every market and every minute. A quote
the replay moves is filled only from the prints that happened, against the book that was there; the replay cannot know
how other traders and makers would have answered a quote that was never in the book, nor where in a queue it would
have stood. Whether Polymarket pays what its formula implies, and whether this account may quote at all (the Ireland
rule), stay RW's open questions.

## What follows

These arms are not among the five RW-NEXT reads together: its Part 1 neither names nor reads them, and they cannot
replace its candidate or be sent to RW-C under it. They run on RW-C's days because RW-C's replay runs every arm of
`RWX_SPECS` (the addendum below). An arm that passes both tests is a candidate rule to put to Davies for a live design,
beside whatever RW-NEXT names, under RW-NEXT's Part 4; the choice is his. An arm that fails either is closed.

## Addendum to RW-NEXT Part 2 (RW-C's replays), recorded here because that file is frozen

RW-NEXT Part 2 replays RW-E and x1–x3 on RW-C's minutes by the frozen rules of `pmrw_e.ts` and `pmrw_x.ts`. This commit
adds x4 and x5 to the x replay's arms (`RWCX_SPECS` maps every arm of `RWX_SPECS`). What that changes:

1. `pm_rwc_x_days` holds rows for arms `x4` and `x5` as well; migration `0085` widens the arm check of `pm_rwc_x_days`
   and of `pm_rw_x_days` to take them. No other table, lease or row of `edge_calls` changes.
2. `pm_rwc_x_state.state.arms` holds two more arms, and each run replays them too (CPU below).
3. Nothing of `rw`, `e`, `x1`, `x2` or `x3`: their specs on RW-C's minutes are the ones RW-NEXT froze, byte for byte
   (pinned in `pmrwc.test.ts`), and their accounts, day rows and the replay's checks are computed exactly as before. On
   60 random worlds, 532,800 minutes replayed in random chunks across RW-E's, RW-X's and x4/x5's first minutes (67
   markets RW-E ran through the rule, 868 pauses, 84,659 fills of RW, 59 settlements), the replay before this change
   (commit `829632cf`) and after it gave the five arms the same state and the same day rows, byte for byte; a change
   that let the wide rule reach every arm was caught at the first chunk past 10-03 00:00 (ledger, 2026-10-02).
4. RW-NEXT's health readings of that replay are unchanged (`last_minute`, `updated_at`, `last_error`; `checkMaxUsd`,
   `checkEMaxUsd`, `checkEDays`, `version`), and its no-peek list covers the new arms' rows and accounts like every other
   content of `pm_rwc_x_*`.
5. The test files RW-NEXT named as passing unchanged (`pmrw_e.test.ts`, `pmrw_x.test.ts`) and `pmrwc.test.ts` were
   edited where they enumerate the arms, the page's rows or the arm check (seven arms where five were; x2 off the page);
   no assertion about the five arms' accounts was loosened.

**A deviation of RW-X's text, recorded with it.** RW-X's pre-registration allows a later change to `pmrw_x.ts` that adds
bookkeeping for the page and nothing else, the accounts staying those of its freezing commit. Adding two arms is more
than bookkeeping; the five arms' accounts are unchanged (item 3). On the page, on Davies' word of 2026-10-02, x2 left it
(as x3 did on 09-28) and the names variant-3 and variant-4 are x4's and x5's.

**CPU**, measured 2026-10-02 in this repository's container, single thread, never on Supabase (an Edge request has 2 s
of CPU): the replay's own work in a run as it runs every minute (three minutes, 40 markets) took 2 ms before this change
and 2 ms after it (at most 6). A 720-minute catch-up, the most one run replays, of 40 markets with 21,905 prints (RW's
last 720 minutes held 44 markets and 302 prints) took 116 ms before and 204 ms after; of 80 markets with 108,352
prints, 392 ms before and 676 ms after. The new arms read each minute's prints alone (`minutePrints`), the same fills as
the run's whole list (shown on the same 60 worlds); reading the whole list, the larger catch-up took 1,046 ms (404 ms
before the change, in that measurement).
