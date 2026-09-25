# Pre-registration SHWIN: half a goal after the break, then the match (fp5, test SHWIN)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file of this rule was opened. Frozen by the commit that adds this file.

`shwin_test.py` is the rule. It does not read a bookmaker price.

## Why this is not OVER35

OVER35 buys a full-time over 3.5. SHWIN buys the full-time win of the side
that scores more in the second half. The second-half result market is not
this contract. The count is full-time goals minus half-time goals.

## Rule

The decision, the fee, the fill, the windows and the six conditions are the
earlier full-time rules. Last six matches. Buy the side ahead by at least 0.5
second-half goals per game. The fair value is how often that side then won,
from at least eight such matches. An even second half does not trade.

## Pin

`shwin_test.py --self-check` prints `H 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1. An even second half does not
trade. The same gap the other way buys the away side.
