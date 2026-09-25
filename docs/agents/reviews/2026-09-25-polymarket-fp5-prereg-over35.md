# Pre-registration OVER35: four or more goals (fp5, test OVER35)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file was opened. Frozen by the commit that adds this file.

`over35_test.py` is the rule. It does not read a bookmaker price.

## Why this is not BTTS

BTTS pays when both clubs score, including 1-1. OVER35 buys the full-time
over 3.5, which pays on four or more goals. The under is not bought. A 2.5
line, a team total and a half-time total are not this rule.

## Rule

The decision, the fee, the fill, the windows and the six conditions are REF's.
The fair value is the average of the two clubs' rates of matches with four or
more goals. Each club needs eight prior matches.

## Pin

`over35_test.py --self-check` prints `Y 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1. A 2.5 line does not trade.
Eight one-goal matches do not trade.
