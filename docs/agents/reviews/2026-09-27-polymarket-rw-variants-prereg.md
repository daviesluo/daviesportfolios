# Pre-registration RW-X: three variants of RW-E, replayed beside it

Written 2026-09-27 (UTC), before any minute they are judged on exists: they are judged on 2026-09-28 00:00 →
2026-10-09 00:00 UTC, eleven days of RW's paper run. Frozen by the commit that adds this file; nothing below may change
after it, and any deviation is reported as a deviation. It changes nothing that runs: RW's engine, RW-E's replay and
their verdicts are untouched (`2026-09-24-polymarket-rw-paper-spec.md`, `2026-09-26-polymarket-rw-end-prereg.md`).

## Why

Davies (2026-09-27): RW-E's stress went below zero on the first day of its test; study the three ways to cut it — (a) a
smaller inventory cap, (b) no quotes while a market is being decided, (c) which markets to pick — and track the ones
worth it as TESTING rows the way RW-E is tracked: frozen before anyone reads a market-level figure of the days they are
judged on, and replayed from RW's stored minutes from the day they start.

The research ran every rule over RW's days before RW-E's twelve, 2026-09-25 00:00 → 09-27 00:00 UTC, with RW-E's rule
applied throughout, through `agents/pmrw_x.ts`'s `researchRwx` (`agents?action=pmrw-x-research`). The replay's `rw` arm
reproduced RW's own day rows to the cent. Running totals at 09-27 00:00:

| arm | total | stress | fills |
|---|---:|---:|---:|
| RW | +$219.72 | −$28.53 | 402 |
| RW-E | +$200.66 | +$49.13 | 147 |
| (a) inventory cap 2N | +$172.77 | +$44.10 | 138 |
| (a) inventory cap N | +$102.62 | +$9.24 | 114 |
| (b) pause 60 min after a mid move of 3 ¢ / 5 ¢ | +$139.04 / +$142.09 | +$33.41 / +$17.36 | 64 / 81 |
| (b) pause 60 min after 8 ¢ / 10 ¢ / 15 ¢ / 20 ¢ | +$201.15 / +$194.06 / +$205.63 / +$198.91 | +$58.89 / +$52.65 / +$57.62 / +$48.55 | 106 / 134 / 139 / 145 |
| (b) pause after 10 ¢ for 30 min / 120 min / a day | +$202.35 / +$195.63 / +$117.66 | +$52.34 / +$66.69 / +$22.42 | 139 / 128 / 77 |
| (c) no weather markets | +$196.77 | +$62.58 | 144 |
| (c) no weather, no economics | +$180.24 | +$61.92 | 120 |
| (b) + (c): no weather, pause after 10 ¢ / 15 ¢ | +$194.09 / +$205.66 | +$68.06 / +$73.03 | 131 / 136 |
| (a) + (b), (a) + (c): cap 2N with a 5 ¢ pause / no weather | +$131.51 / +$173.96 | +$20.14 / +$55.00 | 77 / 136 |

Two days are two draws, and these rules were chosen among 24 configurations run on them: they are hypotheses, not
evidence. **(a) is not tracked**: both caps lowered the total and the stress, because RW's reward is the smaller side's
score and a side the cap has stopped earns nothing, which costs more than the inventory it saves. (b) helps across 8–15 ¢
and not outside it; 15 ¢ is taken, the best of that plateau on both figures, which is a choice made on the two days and
is disclosed as one. (c) rests on two weather markets that did not end the day they were chosen (stress −$13.46 between
them) and on the mechanism RW's same-day loss already showed: a temperature market is informed through the day.

## What was seen before the freeze (disclosed)

* Everything RW-E's pre-registration disclosed, RW's per-market accounts at the 09-26 close (the split by category and
  by horizon: among markets that do not end the day they are chosen, culture +$25.80 of stress on 8 markets, politics
  +$36.12 on 4, economics +$0.66 on 1, weather −$13.46 on 2), and the research table above.
* RW's and RW-E's aggregate accounts during 09-27 (totals at 17:28 and 17:39 UTC, and RW-E's split of the day into the
  markets it quoted and those it carried, totals only), and RW's selections of 09-24 → 09-27.
* The public prints of three of RW's 09-25 markets (UMich sentiment, "announcers say Fumble", Trump's Truth Social count).
* No market-level figure of 09-27 or later, and no minute of 09-28 or later.

## The variants

Each is RW-E exactly — its pre-registration's rule from 2026-09-27 00:00 UTC, RW before it — plus one rule from
2026-09-28 00:00 UTC. They are computed by the rules of `agents/pmrw_x.ts` (`replayArms`, `armQuotes`) as they stand at
the commit that freezes this file: an arm takes RW's recorded decision and fills while it holds what RW held and its
rule quotes what RW quoted, and runs RW's own `stepRw` on the stored book and prints otherwise. A later change to that
file may add bookkeeping for the page (which minutes were paused, say) and nothing else: the accounts it produces must
stay those of the freezing commit, pinned by a test. A market an arm does not quote is held, marked each minute at the
adjusted mid, and settled at its payout, as RW-E does.

1. **RW-X1, "Reward quotes (no weather)"** (`x1`): a market whose category — the `cat` of its latest `pm_rw_selection`
   row of that day or before — is `weather_fees` is not quoted.
2. **RW-X2, "Reward quotes (pause on jumps)"** (`x2`): when a market's adjusted mid (the midpoint of the size-cutoff
   adjusted touch in RW's recorded minute) is 15 ¢ or more from its adjusted mid in the market's previous recorded
   minute, the market is not quoted in that minute and the 59 after it; a further jump starts the pause again. The
   previous mid is tracked from RW's first minute, so the first minute of 09-28 compares with the last of 09-27.
3. **RW-X3, "Reward quotes (no weather, pause on jumps)"** (`x3`): both rules.

As `pmrw_x.ts` specs: `x1` `{ noSameDayFrom: 2026-09-27T00:00Z, from: 2026-09-28T00:00Z, noCats: ["weather_fees"] }`;
`x2` the same with `pause: { cents: 15, minutes: 60 }` and no `noCats`; `x3` both.

## Data and replay

Only what RW's engine stored: `pm_rw_selection`, `pm_rw_minutes`, `pm_rw_fills`, `pm_rw_prints`, `pm_rw_settlements`.
The replay runs from RW's start, 2026-09-25 00:00, minute by minute as RW decides, into its own state and day rows,
so each variant enters 09-28 holding exactly what RW-E held at 09-28 00:00; its result is the change over the eleven
days, with what it carried in marked where RW-E marked it at 2026-09-28 00:00.

**Check before anything is read:** the replay's `rw` arm must reproduce RW's `pm_rw_days`, and an arm with RW-E's rule
alone (`e`, kept in the replay for this) must reproduce RW-E's own days (`pm_rw_e_days`, arm `e`, replay version 2),
for every day both have closed, 2026-09-25 → 10-08, to within $0.01. If either does not, the replay is wrong, nothing
below is computed, and the result is reported as void with the difference.

## The bar (each variant, over 2026-09-28 → 2026-10-08, eleven days)

1. Total > 0.
2. Stress total > 0.
3. At least 100 fills.
4. No single market holds more than 50 % of the total, and the total without the best market is > 0.
5. The eleven day totals resampled with replacement (2,000 draws, seed 20261009, Python's `random.Random(seed)`, eleven
   `choice`s a draw, the sums sorted and the one at index `int(0.05 × 2000)` read): the 5th percentile of the sum is > 0.
6. Worth money: the total on the variant's capital (RW's definition: the largest, over the eleven days, of the sum of
   the capital of the markets quoting or holding that day), annualised (× 365 / 11), exceeds 4 % a year.
7. It improves on RW-E: its stress total over the eleven days exceeds RW-E's over the same eleven days.

Descriptive, not part of the bar: each variant against RW-E and RW by day; the market-days a variant left out and the
minutes it paused, with their rewards, fills P&L and stress; how much capital it left idle.

## What it cannot show

Eleven days are few, and three variants chosen from 24 configurations on two days: one of them beating RW-E by chance is
likely enough that condition 7 alone proves nothing, so the absolute conditions carry the weight. A pause decided from
a recorded minute is causal — the minute's book is read before its quotes — but the replay cannot know how the book
would have moved had the quotes been there. Whether Polymarket pays what its formula implies, and whether this account
may quote at all (the Ireland rule), stay RW's open questions.

## What follows

Reported beside RW's and RW-E's verdicts on or after 2026-10-09. A variant that passes is a candidate rule for any live
design, behind RW's and RW-E's own verdicts and the Ireland rule; one that fails is closed.
