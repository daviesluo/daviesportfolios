# Pre-registration DRIFT: one bucket on the side past steps took (fp5, test DRIFT)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before the weather file
was opened for this rule. Frozen by the commit that adds this file.

`drift_test.py` is the rule. It reads the committed weather input. It does not read a forecast.

## Why this is not JUMP

JUMP's target moves by the size of the last step. DRIFT moves one listed bucket from yesterday's
bucket. The side is whichever sign occurred more often among all linked steps. A zero step does
not vote. A tie is no trade. The last step's size does not choose a further bucket.

## Rule

The decision time, the fee, the fill, the windows and the six conditions are YDAY's. Eight prior
midpoints and eight linked steps are required. Yesterday is within three days. The fair value is
how often prior midpoints landed in the chosen bucket. Buy only when that fraction clears the
shown price plus one tick.

## Pin

`drift_test.py --self-check` prints 25.354286. Four steps are up and three are down, so the trade
is the bucket above yesterday. Shown 0.27, tick 0.01, print 0.20 floored to 0.28, fee 0.05,
payout 1.
