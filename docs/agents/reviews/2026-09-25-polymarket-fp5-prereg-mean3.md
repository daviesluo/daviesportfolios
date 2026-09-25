# Pre-registration MEAN3: the mean of the last three temperatures (fp5, test MEAN3)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before the weather file
was opened for this rule. Frozen by the commit that adds this file.

`mean3_test.py` is the rule. It reads the committed weather input. It does not read a forecast.

## Why this is not CLIM, JUMP or YDAY

CLIM is the median of a calendar month. JUMP adds the last step to the last midpoint. YDAY buys
the previous bucket. MEAN3 buys the bucket that contains the arithmetic mean of the last three
resolved midpoints, and only when each of those gaps, and the gap to today, is at most three days.

## Rule

The decision time, the fee, the fill, the windows and the six conditions are YDAY's. Eight prior
midpoints are required. The fair value is the fraction of all of them, not just the three, inside
the chosen bucket. Buy only when that fraction clears the shown price plus one tick.

## Pin

`mean3_test.py --self-check` prints 17.457778. The last three midpoints are 20. The trade buys
19–21, shown 0.35, tick 0.01, print 0.30 floored to 0.36, fee 0.05, payout 1. A cheaper empty
bucket is not eligible.
