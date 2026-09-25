# Pre-registration MARGIN: goal difference over eight matches (fp5, test MARGIN)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
Premier League price file was opened. Frozen by the commit that adds this file.

`margin_test.py` is the rule. It does not read a bookmaker price.

## Why this is not FORM5

FORM5 is points over five matches, gap 0.6. MARGIN is goals over eight matches,
gap one goal per game. A win by 1-0 and a win by 4-3 are the same points and
not the same margin.

## Rule

The decision, the fee, the fill, the windows and the six conditions are ELO's.
Buy the side ahead by at least one goal per game. The fair value is how often
that side then won, from at least eight such matches.

## Pin

`margin_test.py --self-check` prints `H 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1.
