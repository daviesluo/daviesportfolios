# Pre-registration WALK: starter walks on the moneyline (fp5, test WALK)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file of this rule was opened. Frozen by the commit that adds this file.

`walk_test.py` is the rule. It does not read a bookmaker price.

## Why this is not ARM

ARM uses earned runs. WALK uses walks per nine over the last six starts, and
only when the gap is at least 1.5. Fewer walks is the side. A one-walk gap
does not trade.

## Rule

The decision is one hour before first pitch. The fair value is how often the
side this rule would have named then won, with eight such games.

## Pin

`walk_test.py --self-check` prints `HOT 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1.
