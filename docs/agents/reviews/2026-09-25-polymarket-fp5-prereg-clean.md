# Pre-registration CLEAN: two more clean sheets, then the match (fp5, test CLEAN)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file of this rule was opened. Frozen by the commit that adds this file.

`clean_test.py` is the rule. It does not read a bookmaker price.

## Why this is not FOUL

FOUL buys the side that fouls less. CLEAN buys the full-time win of the side
with more clean sheets. A clean sheet is conceding zero. Cards are not this count.

## Rule

The decision, the fee, the fill, the windows and the six conditions are the
earlier full-time rules. Last six matches. Buy the side ahead by at least
2/6. The fair value is how often that side then won, from at least eight such
matches. One more clean sheet in six does not trade.

## Pin

`clean_test.py --self-check` prints `H 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1. One clean sheet in six does
not trade. The same gap the other way buys the away side.
