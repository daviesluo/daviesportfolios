# fp5 — MED, the bracket that contains the median, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-med.md` (sha256
`9275e8a886aff16fd087356ff29e5998d9c1bdce89ff22461674b770cd7bd81f`) and frozen in `55f029b` before any
return of this rule was computed. The rule is `scripts/med_test.py` (git blob
`39bc83382ca9807db8d98e70dfb6f21e60d2ab29`). The input is `inputs/med_inputs.json.gz` (sha256
`c4c9b65998072cfe2c9626301d9cc4e3cca22481daa67a25050381670cd59348`). The run wrote `results/med_run.json`
(sha256 `3cdf218ee9be5073b5e8694c4fafd34b4132478153a8b4b189c0cefb8f4ed174`). A second run wrote a
byte-identical file. `med_test.py --self-check` still prints `39.351744`.

## Result

212 events inside the windows. 181 had no trade. 28 filled under $2. 3 filled. No tape was incomplete.

Out of sample: **−$18.41788 on 2 trades**, both lost. OOS1 −$9.00 on 1. OOS2 −$9.42 on 1. Stress
−$19.17. The null's 95th percentile is +$107.68. Peak capital $9.00, −2.95 % a year. In sample −$10.00
on 1 trade.

One fill, the week ending 3 February 2026, bracket 260–279. Two YES prints, 20 shares at 0.05 and
177.434781 at 0.045087, fee rate 0, payout 0. The cost is 9.00 and the P&L is −9.00.

Every condition fails. **MED fails.**

## What this kills

The bracket around the median of past counts is not underpriced at the open after the fee and one tick.
The three buys all lost. Not retried by using the mean instead of the median, or by widening the hour.
