# Pre-registration HTLEAD: who leads at the break (fp5, test HTLEAD)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file of this rule was opened. Frozen by the commit that adds this file.

`htlead_test.py` is the rule. It does not read a bookmaker price.

## Why this is not VENUE

VENUE is a club's full-time home win rate on the full-time win market. HTLEAD
buys "leading at halftime" for the club that leads at the break more often.
The full-time win, the halftime draw, and a venue split are not this contract.

## Rule

The decision is one hour before kickoff. The fee, the fill and the windows are
the same as the earlier full-time rules. Eight prior matches. Buy the club
with the larger edge. An equal edge keeps the home club. The draw is not bought.

## Pin

`htlead_test.py --self-check` prints `HOT 1.0 14.638156`. Shown 0.40, tick
0.001, print 0.10 floored to 0.401, fee 0.05, payout 1. Seven matches do not
trade. A moneyline does not trade.
