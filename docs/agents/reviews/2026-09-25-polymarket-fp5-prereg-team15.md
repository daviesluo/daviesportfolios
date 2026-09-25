# Pre-registration TEAM15: one club scores two (fp5, test TEAM15)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file of this rule was opened. Frozen by the commit that adds this file.

`team15_test.py` is the rule. It does not read a bookmaker price.

## Why this is not SPREAD15

SPREAD15 buys a full-time win by two goals. TEAM15 buys that club's own
full-time over 1.5: scoring twice, not winning by two. A 0.5 or 2.5 team
total does not trade. A first-half team total does not trade.

## Rule

The decision is one hour before kickoff. The fee, the fill and the windows are
the same as the earlier full-time rules. The line must be 1.5. The fair value
is that club's own rate of scoring two or more, from eight prior matches. Buy
the over with the larger edge. An equal edge keeps the home club.

## Pin

`team15_test.py --self-check` prints `HOT 1.0 14.638156`. Shown 0.40, tick
0.001, print 0.10 floored to 0.401, fee 0.05, payout 1. Seven matches do not
trade. A 0.5 line does not trade. When only the away club scores twice, the
away over is bought.
