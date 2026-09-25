# Pre-registration POISSON: one post-count bracket against a Poisson at the prior mean (fp5, test POISSON)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before the POST input file was
opened. Frozen by the commit that adds this file.

`poisson_test.py` is the rule. `poisson_inputs.py` only fetches the prints. Shown prices are POST's open
reading. The fill walk is `post_test.walk_buys`.

## Rule

Same events, brackets, fees and priors as POST. The mean is the average of the prior winning midpoints,
including an open bracket at its threshold. That mean is λ of a Poisson. A bracket's fair value is the
Poisson probability of a count inside it. An open bracket is summed out to λ + 12 standard deviations;
the tail beyond that is below a tick and is dropped.

Buy the one bracket with the largest positive edge over the shown price plus one tick, after the fee. A
tie takes the lower count. Hold to `outcomePrices`. No flat-book test and no sale before the end.

Entry prints, the incomplete-tape rule, the windows and the six conditions are HITS's and POST's.

The midpoint is not the exact count. That bias is part of the rule. It is not corrected after the result.

## Pin

`poisson_test.py --self-check` must pass. P(2) + P(3) at λ = 2 equals `e^(−2) × (2 + 4/3)`, and the code
matches that sum. Eight priors sit at 2. Shown prices are 0.50 on 0–1, 0.20 on 2–3 and 0.30 on 4+. The
rule buys 2–3. A YES print at 0.10 floors to 0.201. Stake $10, payout 1, fee rate 0.05. P&L 39.351744.
