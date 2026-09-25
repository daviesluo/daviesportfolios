# Pre-registration FH05: first-half over 0.5 (fp5, test FH05)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file of this rule was opened. Frozen by the commit that adds this file.

`fh05_test.py` is the rule. It does not read a bookmaker price.

## Why this is not OVER35

OVER35 buys a full-time over 3.5, four goals. FH05 buys only the first-half
match over at the line 0.5. The fair value is the average of the two clubs'
rates that the first half had a goal. A 1.5 first-half line does not trade.

## Rule

The decision is one hour before kickoff. The fee, the fill and the windows are
the same as the earlier full-time rules. Eight prior matches for each club.
Buy the over only.

## Pin

`fh05_test.py --self-check` prints `Y 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1. Eight scoreless first halves
do not trade. A 1.5 line does not trade. Seven matches do not trade.
