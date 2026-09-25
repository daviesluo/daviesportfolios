# Pre-registration HR05: one batter, home runs over 0.5 (fp5, test HR05)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file of this rule was opened. Frozen by the commit that adds this file.

`hr05_test.py` is the rule. It does not read a bookmaker price.

## Why this is not a line search

The line is 0.5. A 1.5 line does not trade. Each batter is his own row. The
fair value is the fraction of his last appearances, up to 20 and at least 10,
in which he homered at least once. A two-homer game counts once.

## Rule

The decision is one hour before first pitch. Yes is the over and No is the
under. An equal edge keeps Yes. These markets are in the second out-of-sample
window.

## Pin

`hr05_test.py --self-check` prints `Y 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1. Nine appearances do not trade.
