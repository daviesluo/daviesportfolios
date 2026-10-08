# Pre-registration RWC-OPT: live-prep's rules with TB1's skip, and x3 with TB1's skip, on RW-C's fourteen days

Written 2026-10-08 between 23:15 and 23:45 UTC, before RW-C's first minute (2026-10-09 00:00 UTC) existed. It is frozen
by the commit that adds this file and its scripts (`docs/agents/backtests/rwc_opt/`). Nothing below may change after
that commit, and any change is reported as a deviation. It is judged once, out of sample, on RW-C's record of
2026-10-09 00:00 → 2026-10-23 00:00 UTC, and read beside RW-C's verdict (on or after 2026-10-23 00:05 UTC).

**It was designed after a non-blind search** of RW's whole record (below). Every minute it is judged on comes after the
freeze; the arms, and the one parameter they carry, were chosen from RW's minutes of 2026-09-25 00:00 → 10-08 23:10 UTC.

**What it changes:** nothing that runs. It changes no rule, engine, replay, table, `edge_calls` row or page row. RW-C's
engine, its selection and its replays (`pmrwc`, `pmrwc-e`, `pmrwc-x`) run as RW-NEXT froze them. It changes no frozen
pre-registration: RW-NEXT (`2026-09-28-rw-next-prereg.md`), TB1 (`2026-10-07-polymarket-rw-tb1-prereg.md`), the rest
pre-registration's Test 2 for x4 and x5, live-prep's (`2026-10-04-polymarket-lp-prereg.md`) and mid-pool's all stand
unchanged. It is an offline replay of RW-C's stored record by a committed simulator, read from the database read-only
once the record is complete.

## On whose word

Davies, 2026-10-08, verbatim, through the coordinating session:

- "RW-C既然这么重要而且还没开始而且是很早以前设置的，可以用目前所有最新的数据看看RW-C可不可以优化到最佳吗"
  ("Since RW-C matters so much, has not started and was set up long ago, can all the latest data show whether RW-C can
  be optimised to the best?")
- "不用管时间，效果优先" ("Never mind the time; results first.")
- "不要等rw结束在继续，就用现在的所有数据" ("Don't wait for RW to end; use all the data there is now.")

The coordinating session then asked for Part 5's candidates C1–C3 to be frozen as a pre-registration before anyone
reads RW-C's minutes for design.

## The arms

Every arm is a configuration of one simulator, `docs/agents/backtests/rwc_opt/scripts/sim.ts`. It is live-prep's
Phase A simulator (`backtests/pmlp/scripts/sim.ts`) with one option added: TB1's tight-touch rule, computed by
`pmrw_x.ts`'s own `isTight`, `tightBack` and `restRow`. With RW's settings the simulator is RW's engine minute for
minute. On RW's record it reproduces `pm_rw_days` for all thirteen closed days (largest gap $1.6e-12, `results/rw_check.txt`), x1's and
RW-E's day rows to the same precision, and TB1's pre-registration's figures for 10-03 → 10-07 21:49 to the cent. The
arms are defined, word for word, in `scripts/arms.ts`.

**Base S2: live-prep's specification on a run's own selection.** This is Phase A's round 15, "S2 (redeemed at once)":

- markets with N ≤ 20;
- RW-E's same-day rule and no `weather_fees` market, from the record's first minute;
- each day, ten markets within $200 of first-quote capital, by first-round reward per dollar;
- caps of $320 in all and $100 a market, on holdings at cost plus resting buys, with a sell of what is held before a buy;
- 5N;
- x2's pause (15 cents, 60 minutes);
- a −$75 stop on the fills plus 0.40 of the rewards of the days before, and no day stop;
- carried positions worked off by Phase A's passive exit model (9.1 shares an hour at the mid less 1.8 cents).

**C1 (primary): S2 plus TB1's skip at one tick.** In a minute it would quote a market whose stored raw touch
`(ba − bb) / tick` is at most 1 (+1e-9), it rests nothing, earns nothing, fills nothing, and marks what it holds at the
mid. Its base is S2.

**C2 (reported only, never judged): S2 and C1 with carried positions sold only by close-only quotes** at RW's prices,
where the record holds the market's minutes and prints (`exitCarried`), instead of the passive exit model. It measures
how much the exit model flatters S2.

**C3 (secondary): x1 with x2's pause and TB1's skip at one tick.** That is x3 plus TB1, with no account: RW's 3N, RW's
size, every market of the record's selection that x1 quotes. Its base is x1 with no account (RW-X's x1 rules from the
record's first minute: the simulator's defaults).

## Data

RW-C's run as its engine stores it (`pm_rwc_selection`, `pm_rwc_minutes`, `pm_rwc_prints`, `pm_rwc_fills`,
`pm_rwc_settlements`, `pm_rwc_days`, `pm_rwc_state`). The same statements read RW's run for this file
(`sql/pull_minutes.sql` per UTC day, `sql/pull_record.sql` once), with `pm_rwc` for `pm_rw`, read-only through the
Supabase connector, after RW-C's last day row (`pm_rwc_days` for 2026-10-22) is written. `scripts/grab.py` and
`scripts/grab_payload.py` write `data/rwc_min_<day>.json` and `data/rwc_record.json`; `scripts/rec.ts`'s `loadRWC`
reads 2026-10-09 00:00 → 2026-10-23 00:00, flat at its first minute, nothing of RW-C's warm-up day.

Every arm trades only what RW-C's engine records: its own day's selection (RW's rule) and what it holds. The live
path's own universe is wider; a replay cannot know it, as Phase A could not.

## Fill models and R

Each arm is run under two fill models:

- **strict**: the paper's rule, a print strictly through the quote fills it;
- **at-price**: a print at the quote fills it too, as it would a quote alone at a level inside the touch.

R is the share of the formula's reward that Polymarket pays.

- **R = 0.40 is primary.** A day's figure is its total less 0.6 of its rewards.
- R = 1 and R = 0.2 are reported beside it.

## The bar

**For each of C1 (against S2) and C3 (against x1), separately:**

> the paired day bootstrap with `random.Random(20261023)`, 2,000 draws, index 100, > 0 under both fill models, and the
> sum without the best market-day > 0.

**What each part is**, as `scripts/bar.py` computes it:

- **The day differences.** For a day i, D_i is the arm's day figure at R = 0.40 less its base's on the same day; days
  are 2026-10-09 → 10-22.
- **The bootstrap.** A fresh `random.Random(20261023)` makes 2,000 draws of `len(D)` choices of the D_i. The sums are
  sorted, and the one at index 100 must be > 0.
- **The market-days.** Over every market of either arm and every day, d_{c,i} is the arm's market-day change at
  R = 0.40 less its base's. The sum of all d_{c,i} less the largest one must be > 0.
- **"Under both fill models"** applies to both parts. Four conditions per test: bootstrap strict, bootstrap at-price,
  market-days strict, market-days at-price.

**How a test resolves:**

- A test passes when all four hold.
- C2 has no bar.
- Two tests are run and no correction is made for that; this file says so here.

**Checks before the bar is read, in order:**

1. `scripts/check.ts rwc`: the simulator at RW's own settings reproduces `pm_rwc_days` for every closed day
   2026-10-09 → 10-22 to within $0.01 in total, stress and rewards.
2. Each day's pull reports `ok` (its expanded rows equal its row count).
3. The scripts are run as committed here, in a worktree at the freezing commit, so the simulator's imports
   (`pmrw.ts`, `pmrw_x.ts` and what they import) are the frozen ones.

**If a check fails:**

- The test is void and is reported with what is there.
- A missing day of RW-C's record is reported. The bar is read on the days there are, and the report says so.

## What is read when

Anything, at any time; there is no no-peek clause (2026-10-04). The bar runs once, as above, on or after
**2026-10-23 00:05 UTC**, beside RW-C's verdict (the wake of `trig_018MBeyZsWkLBmbMq9ta3GNf`), from the rows as they
stand then. Its output is committed beside the script, and its report says it was not blind.

## Seen before the freeze (not blind)

**Data.** The design used RW's record only: 2026-09-25 00:00 → 2026-10-08 23:10 UTC.

- 343,671 minute rows of 10-04 → 10-08 pulled here; 09-25 → 10-03 from live-prep's committed inputs.
- 14,288 prints, 4,241 fills, 224 selection rows and 138 settlements.
- The replays' day rows, and live-prep's, mini-pool's and mid-pool's paper records.

**Nothing of RW-C's run was read for the design.**

- RW-C's warm-up state was read once in aggregate, for a report: 2026-10-08, total +$29.86, stress −$92.34. The
  warm-up is not in the window.
- Its tables' columns were compared with RW's for the loader. No row of any `pm_rwc_*` table was read.

**The search**, on RW's 14 days (`scripts/grid.ts`, `scripts/analyse.py`, `results/rw_grid*.txt`): 65 arms in all.

- **Family A, no account: 28 arms against x1.** TB1 skip and back at 1 and 2 ticks, pauses, x4's wide and x5's lean
  quotes, inventory caps of 2, 3, 5 and 8 N, double size, late cuts, mid bands, a touch filter, top-N, a formula floor,
  a 48-hour horizon, weather markets in, and three combinations.
- **Family B, live-prep's account: 35 arms against S2.** The same changes, plus budgets, a $60 market cap, exits and
  the stop.

Walk-forward: train on at least 6 days, test on 8.

Reality check: a centred bootstrap of the family's best total difference over all its arms, seed 7.

| Family | Fills | R | Best arm in sample | Its difference | Reality-check p | Walk-forward gain on 8 held-out days |
|---|---|---|---|---|---|---|
| A | strict | 0.4 | tb2-skip | +$228.71 | 0.129 | +$66.80 |
| A | at-price | 0.4 | tb2-skip | +$412.95 | 0.015 | +$210.97 |
| A | strict | 1 | k2 | +$578.80 | 0.001 | +$278.70 |
| A | strict | 0.2 | tb2-skip | +$281.38 | 0.039 | +$112.19 |
| B | strict | 0.4 | tb1-skip (C1) | +$68.85 | 0.777 | +$42.26 |
| B | at-price | 0.4 | tb2-skip | +$162.99 | 0.276 | +$29.76 |
| B | strict | 1 | inv8 | +$62.96 | 0.908 | +$16.77 |
| B | strict | 0.2 | tb2-skip | +$105.53 | 0.491 | +$28.47 |

In family B, nothing beats S2 after the correction. TB1's skip at one tick was the arm the walk-forward chose on 6 of
its 8 test days, with an in-sample-to-held-out gap of $1.83 a day.

**Why one tick and not two:**

- One tick is the threshold TB1's pre-registration froze on 10-07, before this search.
- Two ticks was better in family A but worse in family B under strict fills (+$49.55 against +$68.85).
- One tick keeps the arm a rule already under test, rather than a second parameter chosen here.
- C3's pause is x2's, frozen on 2026-09-27.
- No other parameter of any arm was chosen in this search.

**The arms on RW's record (in sample; the expectation, not evidence).** `scripts/bar.py` on `results/rw_arms.json`,
written to `results/rw_bar.txt`:

| | C1 − S2, R=0.4 strict | C1 − S2, R=0.4 at-price | C3 − x1, R=0.4 strict | C3 − x1, R=0.4 at-price |
|---|---|---|---|---|
| sum of D | +$68.85 | +$141.19 | +$222.70 | +$380.10 |
| bootstrap index 100 | +$13.43 | +$82.00 | +$70.36 | +$180.63 |
| market-days less the best | +$46.30 | +$107.28 | +$184.66 | +$317.64 |
| days the arm is ahead | 10 / 14 | 13 / 14 | 10 / 14 | 11 / 14 |

**Totals at R = 0.4:**

| Arm | Strict | At-price | Worst day (strict) |
|---|---|---|---|
| S2 | $468.88 | $363.03 | −$27.79 |
| C1 | $537.73 | $504.22 | −$5.64 |
| x1 | $396.15 | $182.78 | −$43.04 |
| C3 | $618.85 | $562.88 | +$5.92 |

**Beside the totals:**

- At R = 1, C1 trails S2 by $22.51 under strict fills.
- C2: S2 with close-only exits only is $343.63 (strict), against $468.88 with the exit model.

**Evidence against, seen before the freeze:**

- On live-prep's own forward paper (2026-10-04 17:55 → 10-08), its fills in tight minutes marked out at 60 minutes
  better than its others: −1.56 cents a share against −2.24, over 65 and 383 fills.
- On 2026-10-08, the one day out of sample for TB1, the gain on RW's minutes came from one market. Under at-price fills
  the skip arm was behind x1 that day.

## What follows

- **A C1 that passes** is a candidate for live-prep's rules, nothing more. Adopting it on live-prep, in dry-run or live,
  needs Davies' word and a pre-registration of its own before any change, beside the go-live conditions live-prep's own
  file already sets.
- **A C3 that passes** is reported beside RW-NEXT's verdict as a candidate rule of RW's family, under RW-NEXT's
  Part 4.
- **An arm that fails is closed.**
- **C2's figures** go into any live estimate made from the replay.

## What it cannot show

- **The queue.** The two fill models bound it; neither is the queue.
- **Other makers.** How they would answer a quote that was not in the book, the winner's curse in the selection, and
  other makers' reaction to ours: none of it is in a paper record.
- **R itself.** It is unmeasured until a path is live.
- **The live universe.** The live path chooses from the whole universe paying $10 a day and over, not from RW-C's
  selection.
- **Sample size.** Fourteen days are few, and the arms share every market and minute with their bases.

## Frozen files

The commit that adds this file adds every file below; their sha256 are those at that commit.
`docs/agents/backtests/rwc_opt/MANIFEST.json` lists them too. `src/rwc_opt_prereg.test.js` fails if any file differs
from the hash named here.

| file | sha256 |
|---|---|
| `scripts/sim.ts` | `f6581e2ad7f464d9e07892280c6c77bd218d802e07d2ae8d746b90f5295b6027` |
| `scripts/rec.ts` | `cb702d16cc131f93c2932ddb60250795d0ff844f13513ac1116b91eeb73dafcf` |
| `scripts/arms.ts` | `9adefe4c419976c2ca60affee10c65fd120fee2cf1f4be0bc597a5173307e1a0` |
| `scripts/run.ts` | `f55b08b2ce6b50344fb963a902c432fb7b8dd2da072ad3bb586814b176a8f489` |
| `scripts/check.ts` | `90ae9e6379db52e20582c92dc12b50e8cdd2cd4378e3f56b8d75996e38a4c0a5` |
| `scripts/bar.py` | `a93c09bf086da7ce8710d3d93040be6fd1cc4adef34c282f599ced2f7788aec2` |
| `scripts/grid.ts` | `3bf98db4e2cb547229c04dff1667095af6b6007ebbcf5db1eea263feb8cf84fe` |
| `scripts/analyse.py` | `6299e362d2d70ff5683fa18553882ebeb799d9274ad8ee8d6efab071d94fa0fa` |
| `scripts/grab.py` | `95d381fe51014be245a45853a5898faf855f8bea972b6deb3db0a49b4d4189b8` |
| `scripts/grab_payload.py` | `0cc6063510f0647a28a07f1cbc1947c8a1da2782ebc9cfea09ce4d887cf36f20` |
| `sql/pull_minutes.sql` | `f666bbaae0fca7101b8b23537dccee4fc907143bde5ec047d39f9d121202e7ca` |
| `sql/pull_record.sql` | `70a9388ec01e7439c60f7fd07d95b84f93b273eea5543e72db8a388dd4834bf1` |

The simulator's imports (`supabase/functions/agents/pmrw.ts`, `pmrw_x.ts` and theirs, and
`supabase/functions/_shared/polymarket_public.ts`) are read at the freezing commit. At the freeze, `pmrw.ts` is
`f2bb5943dacb094d2c90cea91893cc5ec7e301874ebe6f420c9a7fb8278dd7f2` and `pmrw_x.ts` is `c145e8078e106a0666171b7f944229983cb0a4488022ffb58a499653411daea9`.
