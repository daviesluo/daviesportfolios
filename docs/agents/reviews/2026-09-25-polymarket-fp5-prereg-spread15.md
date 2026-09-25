# Pre-registration SPREAD15: win by two or more (fp5, test SPREAD15)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file was opened. Frozen by the commit that adds this file.

`spread15_test.py` is the rule. It does not read a bookmaker price.

## Why this is not MARGIN

MARGIN is a moneyline side ahead by one goal per game over eight matches.
SPREAD15 buys the full-time -1.5 contract. The fair value is that club's own
rate of winning by two or more goals. Wider handicaps are not this rule.

## Rule

The decision, the fee, the fill, the windows and the six conditions are REF's.
Each club needs eight prior matches. Buy the -1.5 cover with the larger
positive edge. An equal edge keeps the home club. Half-time spreads are not
read.

## Pin

`spread15_test.py --self-check` prints `HOT 1.0 14.638156`. Shown 0.40, tick
0.001, print 0.10 floored to 0.401, fee 0.05, payout 1. Seven matches do not
trade. When only the away club wins by two or more, that club's cover is bought.
