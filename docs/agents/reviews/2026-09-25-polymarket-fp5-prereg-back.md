# Pre-registration BACK: one bucket from yesterday toward the month (fp5, test BACK)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before the weather file
was opened for this rule. Frozen by the commit that adds this file.

`back_test.py` is the rule. It reads the committed weather input. It does not read a forecast.

## Why this is not CLIM, HOT or YDAY

CLIM buys the bucket that contains the month's median. HOT buys the bucket above that one, and
only on highs. YDAY buys yesterday's bucket. BACK starts at yesterday's bucket and takes one
listed step toward the month-median bucket. If that step would be the median bucket, or yesterday
already contains the median, there is no trade.

## Rule

The decision time, the fee, the fill, the windows and the six conditions are YDAY's. Eight
midpoints in the same calendar month are required. Yesterday is within three days. The fair
value is the fraction of those month midpoints in the chosen bucket. Buy only when that fraction
clears the shown price plus one tick.

## Pin

`back_test.py --self-check` prints 80.464091. The month median is 30, yesterday is 9–11, and the
step between them is 19–21, which does not contain 30. Shown 0.10, tick 0.01, print 0.05 floored
to 0.11, fee 0.05, payout 1.
