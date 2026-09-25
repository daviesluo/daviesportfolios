# Pre-registration HITS: the post-count bracket whose hit rate clears its price by the most (fp5, test HITS)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before the POST input file was
opened. Frozen by the commit that adds this file.

`hits_test.py` is the rule. `hits_inputs.py` only fetches the prints the rule names. Shown prices are the
open reading already defined in the POST pre-registration (`T_d = startDate + 1 h`). This rule does not
use POST's flat-book filter, POST's early sale, or POST's choice of the most frequent bracket.

## Rule

Same events, brackets, fees, tick and priors as POST: series 10000 and 11108, `endDate` before 2026-09-11,
eight priors of the same series and the same title span whose `endDate` is at or before `T_d`. A bracket's
fair value is the fraction of those priors whose winning midpoint lands inside it.

Buy the one bracket with the largest positive edge of that fraction over the shown price plus one tick,
after the fee. A tie takes the lower count, then the lower condition id. No flat-book test. Hold to
`outcomePrices`. No sale before the end.

Entry prints are taker prints in `(T_d, T_d + 60 min]`, the same fill walk as POST (`post_test.walk_buys`):
$10, one tick through the shown price, skip a print above 0.99 or with no edge, less than $2 is no trade.
An entry tape that hits 6 pages of 500 is incomplete, and one incomplete tape means the test cannot pass.

Windows, the 253-day year-fraction, the stake and the six conditions are POST's. Sold shares do not arise.
The null redraws every share Bernoulli at the entry price.

## Pin

`hits_test.py --self-check` must pass. Four of eight priors land in 40-59 and four in 60-79, so both hit
rates are one half. Shown prices 0.48 and 0.10. The rule buys 60-79. A YES print at 0.05 floors to 0.101.
Stake $10, payout 1, fee rate 0.05. P&L 88.560401, which is what `--self-check` prints.
