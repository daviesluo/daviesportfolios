# Pre-registration YRFI: a run in the first inning (fp5, test YRFI)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file of this rule was opened. Frozen by the commit that adds this file.

`yrfi_test.py` is the rule. It does not read a bookmaker price.

## Why this is not BTTS or FH05

BTTS is both clubs scoring at any time. FH05 is a first-half goal. YRFI is
whether either starter allows a first-inning run. The fair value is
1-(1-r1)*(1-r2), each rate from up to the last ten known first innings and
only once both have eight. It is not the average of the two rates. A full-game
total does not trade.

## Rule

The decision is one hour before first pitch. Yes and No are both quoted. An
equal edge keeps Yes.

## Pin

`yrfi_test.py --self-check` prints `Y 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1. Seven first innings do not
trade. Eight shutout first innings buy No.
