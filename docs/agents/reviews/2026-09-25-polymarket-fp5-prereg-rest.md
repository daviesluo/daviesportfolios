# Pre-registration REST: two more days since the previous match (fp5, test REST)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
Premier League price file was opened. Frozen by the commit that adds this file.

`rest_test.py` is the rule. It does not read a bookmaker price.

## Why this is not CONGEST

CONGEST counts matches in 14 days. REST is the gap since the one previous kickoff.
Equal rest is no trade.

## Rule

The decision, the fee, the fill, the windows and the six conditions are ELO's.
Buy the side with at least two more days of rest. The fair value is how often
the more rested side then won, from at least eight such matches.

## Pin

`rest_test.py --self-check` prints `H 1.0 14.638156`. Home last played ten days
ago and away one day ago. Shown 0.40, tick 0.001, print 0.10 floored to 0.401,
fee 0.05, payout 1. Equal rest is no trade.
