# Pre-registration NEXT: the bucket yesterday's bucket moved to (fp5, test NEXT)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before the weather file
was opened for this rule. Frozen by the commit that adds this file.

`next_test.py` is the rule. It reads the committed weather input. It does not read a forecast.

## Why this is not YDAY

YDAY buys yesterday's bucket at the rate at which buckets repeat. NEXT buys a different bucket:
the one yesterday's bucket moved to most often. The fair value divides by every transition out
of that bucket, including stays. If the modal move is a stay, or there is no other bucket, there
is no trade.

## Rule

The decision time, the fee, the fill, the windows and the six conditions are YDAY's. Eight
transitions out of yesterday's bucket are required. Gaps are at most three days. Ties take the
lower bound, then the upper bound. Buy only when the fair value clears the shown price plus one tick.

## Pin

`next_test.py --self-check` prints 33.093261. Eight transitions from 9–11 all land in 19–21.
The trade buys 19–21, shown 0.22, tick 0.01, print 0.20 floored to 0.23, fee 0.05, payout 1.
Eight stays are not a trade.
