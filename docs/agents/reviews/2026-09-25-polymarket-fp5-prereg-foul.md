# Pre-registration FOUL: fewer fouls over six matches (fp5, test FOUL)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file was opened. Frozen by the commit that adds this file.

`foul_test.py` is the rule. It does not read a bookmaker price.

## Why this is not SOT

SOT buys the side with more shots on target. FOUL buys the side with fewer
fouls, gap two fouls per game over six matches. Cards are not fouls.

## Rule

The decision, the fee, the fill, the windows and the six conditions are REF's.
Buy the side that fouls at least two fewer times per game. The fair value is
how often that side then won, from at least eight such matches. The side that
fouls more is not bought.

## Pin

`foul_test.py --self-check` prints `H 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1. A one-foul gap does not
trade. When the away side fouls less, that side is bought.
