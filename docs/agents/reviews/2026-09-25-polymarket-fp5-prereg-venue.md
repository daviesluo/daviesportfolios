# Pre-registration VENUE: this club's own home win rate (fp5, test VENUE)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
Premier League price file was opened. Frozen by the commit that adds this file.

`venue_test.py` is the rule. It does not read a bookmaker price.

## Why this is not DRAWBASE

DRAWBASE is the league's draw rate on the draw market. VENUE is one club's home
wins on the home market. Away games do not enter the rate. The away market is
not a second trade.

## Rule

The decision, the fee, the fill, the windows and the six conditions are ELO's.
Eight prior home games are required. Buy the home win when that rate clears the
shown price plus one tick.

## Pin

`venue_test.py --self-check` prints `H 1.0 -10.2995`. Eight home wins, and an
away loss that is not in the rate. Shown 0.40, tick 0.001, print 0.10 floored
to 0.401, fee 0.05, payout 0.
