# Pre-registration K35: one pitcher, strikeouts over 3.5 (fp5, test K35)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file of this rule was opened. Frozen by the commit that adds this file.

`k35_test.py` is the rule. It does not read a bookmaker price.

## Why this is not another strikeout line

The line is 3.5. A 4.5 line does not trade. The fair value is the fraction of
his last starts, up to 10 and at least 8, with four or more strikeouts. A
reliever with no starts does not trade. This is not K9, which is a moneyline.

## Rule

The decision is one hour before first pitch. Yes is the over and No is the
under. An equal edge keeps Yes. These markets are in the second out-of-sample
window.

## Pin

`k35_test.py --self-check` prints `Y 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1. Seven starts do not trade.
