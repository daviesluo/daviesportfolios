# Pre-registration YDAY: today's temperature bucket equals the last resolved day (fp5, test YDAY)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before the weather file
was opened for this rule. Frozen by the commit that adds this file.

`yday_test.py` is the rule. It reads the committed weather input. It does not read the forecast.

## Why this is not WX

WX prices a bucket with a normal distribution around a 48-hour forecast. YDAY never reads a
forecast. The fair value is the frequency with which the next resolved day of the same city,
kind and unit landed in the previous day's winning bucket.

## Rule

Every temperature event in the committed file. The decision time is that file's `td` (noon UTC
on the day before the temperature date). A prior counts only when its winning market has closed
at or before `td`. The previous day is the latest such prior whose temperature date is at most
three calendar days earlier. Pairs are consecutive priors at most three days apart. Eight such
pairs are required. Buy the bucket with the same bounds as the previous winner when the fraction
of pairs that repeated clears the shown price plus one tick, after the weather fee 0.05. Hold to
settlement.

Fills are taker prints in `(td, td + 60 min]`, $10, one tick through the shown price, nothing
above 0.99, nothing without edge, under $2 is no trade. One incomplete print tape on a chosen
market means the test cannot pass. Windows are the post-count windows, by the temperature date:
in sample through 2025, then 2026-01-01 and 2026-06-01, ending 2026-09-11. The year-fraction is
253 days. The six conditions are the same.

## Pin

`yday_test.py --self-check` prints 14.095244. Nine February days all resolve in 70–72, and
1 March buys that bucket. Shown 0.40, tick 0.01, print 0.39 floored to 0.41, fee 0.05, payout 1.
A previous day more than three days back is not a trade.
