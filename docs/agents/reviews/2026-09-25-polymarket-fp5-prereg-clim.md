# Pre-registration CLIM: the bucket that contains the month's median temperature (fp5, test CLIM)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before the weather file
was opened for this rule. Frozen by the commit that adds this file.

`clim_test.py` is the rule. It reads the committed weather input. It does not read a forecast.

## Why this is not WX or YDAY

WX uses a forecast. YDAY uses the previous day's bucket. CLIM uses the median of winning
midpoints from the same calendar month in prior years and earlier days of this month, for the
same city, kind and unit.

## Rule

The decision time, the closed-before-`td` prior, the fee, the fill, the windows and the six
conditions are YDAY's. Eight prior midpoints in the same month are required. The median of an
even count is the average of the two central values. Buy the listed bucket that contains that
median; if several do, the lower bound, then the condition id. The fair value is the fraction of
those midpoints inside it. Buy only when that fraction clears the shown price plus one tick.

## Pin

`clim_test.py --self-check` prints 37.224048. Eight January priors resolve in 28–30. The January
trade buys that bucket, shown 0.20, tick 0.01, print 0.19 floored to 0.21, fee 0.05, payout 1.
