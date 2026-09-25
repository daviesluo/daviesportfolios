# fp5 — POISSON, one bracket against a Poisson at the prior mean, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-poisson.md` (sha256
`11830c6a1009687a14cff4bb69386776db19f6cdae5dc7d70deadc3f921595fe`) and frozen in `c7f7093` before any
return of this rule was computed. The rule is `scripts/poisson_test.py` (git blob
`9f61a764af2d26b433a91e8e1f2d81c2ebd643da`). The input is `inputs/poisson_inputs.json.gz` (sha256
`53498b7bca13db2172d77374596fedf28feefbf9fb65c66e7e5b2c326afbbb85`). The run wrote
`results/poisson_run.json` (sha256 `e6b50b006f7639204ced9aaeefc72db8b8ac0c91e6b051c635fd51f804d2d1c0`).
A second run wrote a byte-identical file. `poisson_test.py --self-check` still prints `39.351744`.

## What the pull did

150 brackets had a positive Poisson edge at the open. 108 filled less than $2. 35 filled. No tape was
incomplete.

## Result

Out of sample: **+$115.240837 on 26 trades**, cost $204.939647, fees $3.404169, 2 won and 24 lost.
OOS1 +$159.19845 on 21. OOS2 −$43.957613 on 5. Stress +$109.855058. The null's mean is −$2.931814 and its
95th percentile +$225.274225. Peak capital $36.044444, +4.61 % a year on that peak over 253 days.

In sample: −$74.999996 on 9 trades.

Months of the out-of-sample P&L, by the entry: Dec 2025 −5.00, Jan +213.08, Feb +27.86, Mar −30.12,
Apr −15.99, May −30.63, Jun −10.38, Jul −10.45, Aug −23.13. January is 185 % of the total. Without
January the total is −$97.83. The two wins are the week of 30 January 2026, bracket 280–299, bought at
0.0228 and 0.0267 for 131.72 and 100.955554 shares, fee rate 0, payout 1, P&L 226.975555 (232.675554
shares minus $5.70 of cost); and the week of 20 February, bracket 300–319, P&L +80.909099. Both were
read after the run. Neither is a second rule.

Stress and the 4 % on peak capital pass. The halves, the null, the trade count and the month do not.
**POISSON fails.**

## What this kills

A Poisson at the average of past winning midpoints is not a price to take on this ladder after the fee
and one tick. Two longshot brackets that paid produced the whole gain, and the other twenty-four lost.
Not retried with a different distribution, a different mean, or January removed.
