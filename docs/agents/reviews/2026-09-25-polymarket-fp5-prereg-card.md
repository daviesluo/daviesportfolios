# Pre-registration CARD: fewer yellow cards over six matches (fp5, test CARD)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file was opened. Frozen by the commit that adds this file.

`card_test.py` is the rule. It does not read a bookmaker price.

## Why this is not FOUL

FOUL is fouls, gap two per game. CARD is yellow cards, gap 0.8 per game over
the same six matches. Red cards are not added in.

## Rule

The decision, the fee, the fill, the windows and the six conditions are REF's.
Buy the side with at least 0.8 fewer yellow cards per game. The fair value is
how often that side then won, from at least eight such matches.

## Pin

`card_test.py --self-check` prints `H 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1. Four yellows across six
games, against a side with none, do not trade.
