# Pre-registration XIN: extra innings (fp5, test XIN)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file of this rule was opened. Frozen by the commit that adds this file.

`xin_test.py` is the rule. It does not read a bookmaker price.

## Why this is not a run total

A full-game total is a number of runs. XIN is whether the game goes past nine.
The fair value is the average of the two clubs' extra-inning rates over the
last 40 games, and only once each has 20. If a club has 25, those 25 are used.

## Rule

The decision is one hour before first pitch. Yes and No are both quoted. An
equal edge keeps Yes. The market exists mainly from July 2026.

## Pin

`xin_test.py --self-check` prints `Y 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1. Nineteen games do not trade.
