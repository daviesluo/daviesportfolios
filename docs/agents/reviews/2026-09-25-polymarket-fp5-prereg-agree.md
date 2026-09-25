# Pre-registration AGREE: three local days and other cities, same bucket (fp5, test AGREE)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before the weather file
was opened for this rule. Frozen by the commit that adds this file.

`agree_test.py` is the rule. It reads the committed weather input. It does not read a forecast.

## Why this is not MEAN3 or PEER alone

MEAN3 would buy the three-day mean by itself. PEER would buy the other cities' median by itself.
AGREE buys only when those two land in the same listed bucket. A disagreement is no trade.

## Rule

The decision time, the fee, the fill, the windows and the six conditions are YDAY's. Eight of
this city's prior midpoints, three linked recent days, and three other cities are required, under
MEAN3's gaps and PEER's three-day peer window. The fair value is this city's own hit rate for
that bucket. Buy only when that fraction clears the shown price plus one tick.

## Pin

`agree_test.py --self-check` prints 42.226579. Both estimates land in 19–21. Shown 0.18, tick
0.01, print 0.10 floored to 0.19, fee 0.05, payout 1. When the peers land in 9–11 instead, there
is no trade.
