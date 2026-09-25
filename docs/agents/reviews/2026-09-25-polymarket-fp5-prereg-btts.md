# Pre-registration BTTS: both teams to score (fp5, test BTTS)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file was opened. Frozen by the commit that adds this file.

`btts_test.py` is the rule. It does not read a bookmaker price.

## Why this is not a moneyline

The contract pays when both clubs score, not when one of them wins. The fair
value is the average of the two clubs' own both-teams-to-score rates. The no
side is not bought. A first-half both-teams market is not this rule.

## Rule

The decision, the fee, the fill, the windows and the six conditions are REF's.
Each club needs eight prior matches. Buy yes when that average clears the
shown price plus one tick and the fee.

## Pin

`btts_test.py --self-check` prints `Y 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1. Eight matches in which only
one club scored do not trade.
