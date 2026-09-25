# fp5 — VAR, the bracket named by two variances, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-var.md` (sha256
`a79c4178e92f0b14ef2b5239e57504e0c18686c60912c134699d0de6e5487087`) and frozen in `55f029b` before any
return of this rule was computed. The rule is `scripts/var_test.py` (git blob
`4bc847d4ade113adcfc2598237b8c8e8ad326cea`). The input is `inputs/var_inputs.json.gz` (sha256
`cdccb393000e7fb11e3f1e1975be88f3a23c581153cbfc86d4cfc909506dd840`). The run wrote `results/var_run.json`
(sha256 `fd5c4f64c7e8b3736413f975d8e5de5f4106f2933b37f023964644f73df95b44`). A second run wrote a
byte-identical file. `var_test.py --self-check` still prints `9.607843`.

## Result

117 events had no trade. 80 filled under $2. 15 filled. No tape was incomplete.

Out of sample: **−$71.465357 on 11 trades**, 0 won. All 11 are in the first half. The second half has no
trade. Stress −$96.58. The null's 95th percentile equals the loss, −$71.465357. Peak capital $10,
−10.31 % a year. In sample −$18.50 on 4 trades.

One fill, the week ending 6 January 2026, open bracket 740+. One YES print, 500 shares at 0.012, fee
rate 0, payout 0. P&L −$6.00, which is the December entry in the month table.

Every condition fails. **VAR fails.**

## What this kills

Comparing the book's variance with the variance of past winning midpoints, and buying the one bracket
that comparison names, loses the stake. Not retried with a sample variance, a different distance, or the
second half dropped.
