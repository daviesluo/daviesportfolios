# Pre-registration ARM: starter ERA on the moneyline (fp5, test ARM)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file of this rule was opened. Frozen by the commit that adds this file.

`arm_test.py` is the rule. It does not read a bookmaker price.

## Why this is not FORM5

FORM5 buys a club from its recent results. ARM buys the club whose starter has
the lower ERA over his last six starts, and only when the gap is at least 1.5.
The contract is the full-time win. A run line is not this rule. A one-run ERA
gap does not trade. The away side is bought when it has the better arm.

## Rule

The decision is one hour before first pitch. The fair value is how often the
side this rule would have named then won, with eight such games. The fee, the
fill and the windows are the same as the earlier rules.

## Pin

`arm_test.py --self-check` prints `HOT 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1.
