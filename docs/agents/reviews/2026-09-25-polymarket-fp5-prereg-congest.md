# Pre-registration CONGEST: fewer matches in 14 days (fp5, test CONGEST)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
Premier League price file was opened. Frozen by the commit that adds this file.

`congest_test.py` is the rule. It does not read a bookmaker price.

## Why this is not REST

REST is days since the previous kickoff. CONGEST is how many matches fall in
the last 14 days. A gap under two matches is no trade.

## Rule

The decision, the fee, the fill, the windows and the six conditions are ELO's.
Buy the side with at least two fewer matches in that window. The fair value is
how often the less crowded side then won, from at least eight such matches.

## Pin

`congest_test.py --self-check` prints `H 1.0 14.638156`. Home has none in the
window and away has three. Shown 0.40, tick 0.001, print 0.10 floored to 0.401,
fee 0.05, payout 1.
