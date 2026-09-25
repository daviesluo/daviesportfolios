# Pre-registration H2H: these two clubs (fp5, test H2H)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
Premier League price file was opened. Frozen by the commit that adds this file.

`h2h_test.py` is the rule. It does not read a bookmaker price.

## Why this is not the league table

TABLE uses every club's points. H2H uses only meetings of this pair. A reversed
fixture counts for the club that won, not for the ground. Three meetings are
required. Two results with the same count are no trade.

## Rule

The decision, the fee, the fill, the windows and the six conditions are ELO's.
Buy the modal result, from today's home club. The fair value is that count
divided by the meetings.

## Pin

`h2h_test.py --self-check` prints `H 1.0 14.638156`. One of the three wins was
away. A 2-2 split is no trade. Shown 0.40, tick 0.001, print 0.10 floored to
0.401, fee 0.05, payout 1.
