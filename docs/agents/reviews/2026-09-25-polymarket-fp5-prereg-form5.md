# Pre-registration FORM5: last five matches, points per game (fp5, test FORM5)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
Premier League price file was opened. Frozen by the commit that adds this file.

`form_test.py` is the rule. It does not read a bookmaker price.

## Why this is not ELO

ELO updates a rating from every match. FORM5 uses only the last five, and only
points. A gap under 0.6 points per game is no trade.

## Rule

The decision, the fee, the fill, the windows and the six conditions are ELO's.
Both clubs have five finished matches. Buy the higher one when it leads by at
least 0.6 points per game. The fair value is how often that side then won, from
at least eight such matches.

## Pin

`form_test.py --self-check` prints `H 1.0 14.638156`. The last five are five wins
against five losses, and all eight earlier leads won. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1. Level form is no trade.
