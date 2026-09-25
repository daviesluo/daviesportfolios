# Pre-registration DRAWBASE: the league draw rate (fp5, test DRAWBASE)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
Premier League price file was opened. Frozen by the commit that adds this file.

`draw_test.py` is the rule. It does not read a bookmaker price.

## Why this is not VENUE

VENUE is one club at home. DRAWBASE is every finished match, and only the draw.

## Rule

The decision, the fee, the fill, the windows and the six conditions are ELO's.
Eight finished matches are required. Buy the draw when that rate clears the
shown price plus one tick.

## Pin

`draw_test.py --self-check` prints `D 0.25 88.560401`. Two draws in eight matches.
Shown 0.10, tick 0.001, print 0.10 floored to 0.101, fee 0.05, payout 1. A draw
shown at 0.50 is no trade.
