# Pre-registration NEAR: the bracket beside the dearest, toward the median (fp5, test NEAR)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before this rule's
input file was opened. Frozen by the commit that adds this file.

`near_test.py` is the rule. `ladder_pick.py near_test` only fetches the prints the rule names.

## Why this is not a rule already killed

The dearest bracket is not bought because it is dearest (that edge is negative and was not run).
NEAR buys an adjacent bracket, and only when the dearest one does not already contain the median
of past winning midpoints. HITS can buy any bracket. POST requires a flat open. Neither is this.

## Rule

Same events, priors and decision time as POST. The dearest bracket is the highest shown price;
a tie takes the lower count, then the condition id. Brackets are ordered by their lower count.
The candidates are the brackets immediately beside the dearest. Keep the one whose midpoint is
strictly closer to the median. A tie takes the lower count. Buy it when its historical hit rate
clears the shown price plus one tick, after the fee. Hold to settlement. Fills, the stake, the
windows and the six conditions are POST's.

## Pin

`near_test.py --self-check` prints 39.751244. Eight priors at 70. Shown prices 0.05, 0.20 and
0.55. The dearest is 80–99 and does not contain 70, so the rule buys 60–79. Tick 0.001, fee 0,
print 0.19 floored to 0.201, payout 1. When 60–79 is itself the dearest, there is no trade.
