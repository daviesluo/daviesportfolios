# Pre-registration SHIFT: the histogram of temperature changes (fp5, test SHIFT)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before the weather file
was opened for this rule. Frozen by the commit that adds this file.

`shift_test.py` is the rule. It reads the committed weather input. It does not read a forecast.

## Why this is not JUMP

JUMP adds the last step once and then uses the unconditional hit rate of that one bucket. SHIFT
adds every linked historical step to yesterday's midpoint. The fair value of a bracket is the
fraction of those sums that land in it. Yesterday's own bracket is not eligible. The trade is
the bracket with the largest positive edge. Ties take the lower bound, then the condition id.

## Rule

The decision time, the fee, the fill, the windows and the six conditions are YDAY's. Eight linked
steps are required, each gap at most three days, and yesterday itself within three days. A zero
histogram outside yesterday's bracket is no trade.

## Pin

`shift_test.py --self-check` prints 60.998571. Eight steps of +10 from a midpoint of 80 land at
90. The trade buys 89–91, shown 0.13, tick 0.01, print 0.10 floored to 0.14, fee 0.05, payout 1.
A flat history does not buy yesterday's bracket.
