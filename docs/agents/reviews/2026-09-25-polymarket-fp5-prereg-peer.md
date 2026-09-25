# Pre-registration PEER: other cities' latest temperature (fp5, test PEER)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before the weather file
was opened for this rule. Frozen by the commit that adds this file.

`peer_test.py` is the rule. It reads the committed weather input. It does not read a forecast.

## Why this is not CLIM or YDAY

CLIM uses this city's own month. YDAY uses this city's previous bucket. PEER uses the median of
other cities' latest resolved midpoints, same kind and unit, within three days, already closed
at the decision.

## Rule

The decision time, the fee, the fill, the windows and the six conditions are YDAY's. Eight of
this city's own prior midpoints are required, and at least three other cities. The median of an
even count is the average of the two central values. Buy the listed bucket that contains that
median. The fair value is the fraction of this city's own midpoints inside it, not the peers'
prices. Buy only when that fraction clears the shown price plus one tick.

## Pin

`peer_test.py --self-check` prints 37.224048. Three other cities resolve at 20, 20 and 22, so
the median is 20. This city's own history is mostly 10. The trade buys 19–21, shown 0.20, tick
0.01, print 0.19 floored to 0.21, fee 0.05, payout 1. The cheap 9–11 bucket is not eligible.
