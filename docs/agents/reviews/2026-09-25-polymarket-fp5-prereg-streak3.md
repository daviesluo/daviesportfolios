# Pre-registration STREAK3: three wins, the other side not (fp5, test STREAK3)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
Premier League price file was opened. Frozen by the commit that adds this file.

`streak_test.py` is the rule. It does not read a bookmaker price.

## Why this is not FORM5

FORM5 is a points rate over five matches. STREAK3 is three wins. Both sides on
a run, or neither, is no trade.

## Rule

The decision, the fee, the fill, the windows and the six conditions are ELO's.
Buy the side that won its last three when the other did not. The fair value is
how often that side then won, from at least eight such matches.

## Pin

`streak_test.py --self-check` prints `H 1.0 14.638156`. Two streaks at once are
no trade. Shown 0.40, tick 0.001, print 0.10 floored to 0.401, fee 0.05, payout 1.
