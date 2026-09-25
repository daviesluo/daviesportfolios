# Pre-registration VAR: the bracket named by two variances (fp5, test VAR)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before this rule's
input file was opened. Frozen by the commit that adds this file.

`var_test.py` is the rule. `ladder_pick.py var_test` only fetches the prints the rule names.

## Why this is not a rule already killed

POISSON prices every bracket with a Poisson at the mean and buys the largest edge. VAR does not
use a Poisson probability. It compares two variances and then allows only the one bracket that
comparison names. HITS, POST and PACE are not this.

## Rule

Same events, priors and decision time as POST. The historical variance divides by the count of
priors, not by one less. The book's variance uses bracket midpoints weighted by shown prices that
sit strictly between 0 and 1, renormalised. If the book's variance is larger, the bracket is the
one that contains the historical mean. If it is smaller, the bracket is the one whose midpoint is
furthest from that mean; a tie takes the higher count, then the condition id. Equal variances are
no trade. The named bracket is bought only when its historical hit rate clears the shown price
plus one tick, after the fee. Hold to settlement. Fills, the stake, the windows and the six
conditions are POST's.

## Pin

`var_test.py --self-check` prints 9.607843. Eight priors at 50, so the historical variance is 0
and the book is richer. The rule buys 40–59, shown 0.50, tick 0.01, fee 0, print 0.50 floored to
0.51, payout 1. A second case, priors split between 0 and 100 against a book piled on 40–59,
names 200–219 and does not buy it, because that bracket's hit rate is 0.
