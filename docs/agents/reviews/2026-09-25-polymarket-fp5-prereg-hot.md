# Pre-registration HOT: the bucket above the month's median high (fp5, test HOT)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before the weather file
was opened for this rule. Frozen by the commit that adds this file.

`hot_test.py` is the rule. It reads the committed weather input. It does not read a forecast.

## Why this is not CLIM or WX

CLIM buys the bucket that contains the median. HOT buys the next listed bucket above that one,
and only on highest-temperature markets. Lowest-temperature markets are outside the rule, not
removed after a result.

## Rule

The month, the eight priors, the decision time, the fee, the fill, the windows and the six
conditions are CLIM's. Brackets are ordered by the lower bound, with an open lower bound first,
then the condition id. The median's bucket is that order's first bucket which contains the
median. The trade is the next bucket in the order. There is no trade on the top bucket. The fair
value is the fraction of the month's prior midpoints inside the next bucket. Buy only when that
fraction clears the shown price plus one tick.

## Pin

`hot_test.py --self-check` prints 156.196667. Six January highs sit in 28–32 and two in 33–37.
The median is 30, so the rule buys 33–37, shown 0.05, tick 0.01, print 0.04 floored to 0.06,
fee 0.05, payout 1. A lowest-temperature market with the same numbers is not traded.
