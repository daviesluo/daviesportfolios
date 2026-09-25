# Pre-registration MED: the post-count bracket that contains the median (fp5, test MED)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before this rule's
input file was opened. Frozen by the commit that adds this file.

`med_test.py` is the rule. `ladder_pick.py med_test` only fetches the prints the rule names.
Shown prices are the open reading already defined for POST (`T_d = startDate + 1 h`).

## Why this is not a rule already killed

HITS buys the bracket whose hit rate clears its price by the most, wherever that bracket sits.
MED names one bracket first: the one that contains the median of past winning midpoints. A
cheaper bracket is not a candidate. POST's flat-book filter and early sale are not used.
POISSON's probability and PACE's tracker are not used.

## Rule

Same events, brackets, fees, tick and priors as POST: series 10000 and 11108, `endDate` before
2026-09-11, eight priors of the same series and the same title span whose `endDate` is at or
before `T_d`. The median of an even count is the average of the two central values. Buy that
bracket when the fraction of priors inside it clears the shown price plus one tick, after the
fee. Hold to `outcomePrices`.

Entry prints are taker prints in `(T_d, T_d + 60 min]`, the same fill walk as POST
(`post_test.walk_buys`): $10, one tick through the shown price, skip a print above 0.99 or with
no edge, less than $2 is no trade. An entry tape that hits 6 pages of 500 is incomplete, and one
incomplete tape means the test cannot pass.

Windows, the 253-day year-fraction and the six conditions are POST's.

## Pin

`med_test.py --self-check` prints 39.351744. Eight priors at 45, bracket 40–59 shown at 0.20,
tick 0.001, fee 0.05, a YES print at 0.19 floored to 0.201, payout 1. The bracket shown at 0.02
is not bought.
