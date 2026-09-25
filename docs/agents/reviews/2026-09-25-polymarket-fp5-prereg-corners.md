# Pre-registration CORNERS: one full-time corner over (fp5, test CORNERS)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file was opened. Frozen by the commit that adds this file.

`corner_test.py` is the rule. It does not read a bookmaker price.

## Why this is not OVER35

OVER35 is goals. CORNERS is the full-time total-corners contract. Each club's
last eight matches are pooled, and a match both clubs played is counted once.
The fair value of a line is the share of that pool with more corners than the
line. Half-time corners, one club's corners, and odd/even are not read.

## Rule

The decision, the fee, the fill, the windows and the six conditions are REF's.
Both clubs need eight matches with a corner count. Buy the single over with
the largest positive edge. An equal edge keeps the lower line. Unders are not
bought.

## Pin

`corner_test.py --self-check` prints `9.5 1.0 14.638156`. Shown 0.40, tick
0.001, print 0.10 floored to 0.401, fee 0.05, payout 1. A higher line at a
worse price is not the one bought. An equal edge keeps 8.5 ahead of 9.5.
Seven matches do not trade.
