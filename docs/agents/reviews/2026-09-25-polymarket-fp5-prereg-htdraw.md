# Pre-registration HTDRAW: the halftime draw (fp5, test HTDRAW)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file of this rule was opened. Frozen by the commit that adds this file.

`htdraw_test.py` is the rule. It does not read a bookmaker price.

## Why this is not DRAWBASE

DRAWBASE is the league-wide full-time draw rate on the full-time draw market.
HTDRAW buys only the halftime-draw yes. The fair value is the average of the
two clubs' own rates of being level at the break. Both-teams-to-score is not
this contract.

## Rule

The decision is one hour before kickoff. The fee, the fill and the windows are
the same as the earlier full-time rules. Eight prior matches for each club.
Buy the halftime draw only.

## Pin

`htdraw_test.py --self-check` prints `D 1.0 14.638156`. Shown 0.40, tick
0.001, print 0.10 floored to 0.401, fee 0.05, payout 1. Eight matches that
were not level do not trade. Seven matches do not trade.
