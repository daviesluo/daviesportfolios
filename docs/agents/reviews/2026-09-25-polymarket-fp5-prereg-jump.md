# Pre-registration JUMP: the temperature bucket one step past the last two days (fp5, test JUMP)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before the weather file
was opened for this rule. Frozen by the commit that adds this file.

`jump_test.py` is the rule. It reads the committed weather input. It does not read a forecast.

## Why this is not WX, YDAY or CLIM

The bracket is not yesterday's bucket and not the monthly median. It is the midpoint reached by
adding the last resolved step again: if the last two winning midpoints differ by D, the target
is the newer midpoint plus D. A zero step is no trade.

## Rule

The decision time, the closed-before-`td` prior, the three-day lag, the fee, the fill, the
windows and the six conditions are YDAY's. The last two priors must each sit within three days
of the next date. Eight prior midpoints are required. Buy the listed bucket that contains the
extrapolated midpoint. If several contain it, take the lower bound, then the condition id. The
fair value is the fraction of prior midpoints inside that bucket. Buy only when that fraction
clears the shown price plus one tick.

## Pin

`jump_test.py --self-check` prints 14.095244. The last two resolved midpoints are 20 and 30, so
the target is 40, in 38–42. Eight earlier priors land there and the two steps do not, so the hit
rate is 0.8. Shown 0.40, tick 0.01, print 0.39 floored to 0.41, fee 0.05, payout 1.
