# Pre-registration DIURNAL: yesterday's low plus the month's range (fp5, test DIURNAL)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before the weather file
was opened for this rule. Frozen by the commit that adds this file.

`diurnal_test.py` is the rule. It reads the committed weather input. It does not read a forecast.

## Why this is not WX or YDAY

WX uses a forecast. YDAY buys the previous high's bucket. DIURNAL buys, on a highest-temperature
market only, the bucket that contains the latest resolved low plus the median of (high minus the
same-day low) in this calendar month.

## Rule

The decision time, the fee, the fill, the windows and the six conditions are YDAY's. The low has
to be the same city and unit, already closed, and within three days. Eight same-month ranges are
required. Lowest-temperature markets are not trades. The fair value is how often prior highs
landed in the chosen bucket. Buy only when that fraction clears the shown price plus one tick.

## Pin

`diurnal_test.py --self-check` prints 21.913065. Eight January ranges are 12 and yesterday's low
is 10, so the target is 22. The trade buys 21–23, shown 0.30, tick 0.01, print 0.25 floored to
0.31, fee 0.05, payout 1.
