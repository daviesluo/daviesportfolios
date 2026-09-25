# Pre-registration TABLE: this season's table (fp5, test TABLE)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
Premier League price file was opened. Frozen by the commit that adds this file.

`table_test.py` is the rule. It does not read a bookmaker price.

## Why this is not FORM5

FORM5 is five matches and a rate. TABLE is points since 1 August of the current
season. Last season's points do not carry. Both clubs have played four games.
A lead under three points is no trade.

## Rule

The decision, the fee, the fill, the windows and the six conditions are ELO's.
Buy the side that leads by at least three points. The fair value is how often
that lead then won, from at least eight such matches.

## Pin

`table_test.py --self-check` prints `H 1.0 14.638156`. A July win is not a
September point. Shown 0.40, tick 0.001, print 0.10 floored to 0.401, fee 0.05,
payout 1.
