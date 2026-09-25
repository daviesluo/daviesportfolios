# Pre-registration REF: this referee's home-win rate (fp5, test REF)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
price-history file was opened. Frozen by the commit that adds this file.

`ref_test.py` is the rule. It does not read a bookmaker price.

## Why this is not VENUE

VENUE is one club's own home games. REF is one referee's matches, whoever the
clubs were, and it buys the home side of today's match. Another referee's
results are not in the rate.

## Rule

The decision is one hour before kickoff. A prior match counts only when it
kicked off at least four hours earlier. Buy the home side when this referee
has at least eight such matches and the home-win rate clears the shown price
plus one tick and the fee. The away side and the draw are not bought.

The fee, the fill, the windows and the six conditions are the same as the
earlier full-time rules.

## Pin

`ref_test.py --self-check` prints `H 1.0 14.638156`. Shown 0.40, tick 0.001,
print 0.10 floored to 0.401, fee 0.05, payout 1. Seven matches do not trade.
Another referee's losses do not change the rate. An incomplete print tape
does not pass.
