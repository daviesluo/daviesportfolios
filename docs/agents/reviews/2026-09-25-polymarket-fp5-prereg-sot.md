# Pre-registration SOT: shots on target over six matches (fp5, test SOT)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file was opened. Frozen by the commit that adds this file.

`sot_test.py` is the rule. It does not read a bookmaker price.

## Why this is not FORM5

FORM5 is points over five matches, gap 0.6. SOT is shots on target over six
matches, gap 1.5 per game. Total shots, fouls and cards are not this count.

## Rule

The decision, the fee, the fill, the windows and the six conditions are REF's.
Buy the side ahead by at least 1.5 shots on target per game. The fair value is
how often that side then won, from at least eight such matches. A smaller gap
does not trade.

## Pin

`sot_test.py --self-check` prints `H 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1. A one-shot gap does not
trade. The same gap the other way buys the away side.
