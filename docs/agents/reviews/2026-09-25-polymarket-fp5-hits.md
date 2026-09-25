# fp5 — HITS, the bracket whose hit rate clears its price by the most, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-hits.md` (sha256
`03c3cb710318784c2183207b84ee384068176a1a7b6af5fda6c7b169b8214415`) and frozen in `c7f7093` before any
return of this rule was computed. The rule is `scripts/hits_test.py` (git blob
`9943968cb68ef36d30610b738548c9fd5c514afa`). The input is `inputs/hits_inputs.json.gz` (sha256
`676b4b35b3757ca9e1adb31428a246d717252c1501579d122ad9ae378ad4d383`). The run wrote `results/hits_run.json`
(sha256 `4583c9815360cc7e5969a68c665b7d1b98ef0d0ed001cd030af341b61a926228`). A second run wrote a
byte-identical file. `hits_test.py --self-check` still prints `88.560401`.

## What the pull did

The shown prices are POST's open reading. 133 brackets had a positive edge. 100 of those filled less than
$2. 24 filled. No tape was incomplete.

## Result

Out of sample: **−$68.657229 on 9 trades**, cost $66.415705, fees $2.241524, 0 won and 9 lost. OOS1
−$31.233351 on 5. OOS2 −$37.423878 on 4. Stress −$89.635361. The null's mean is −$1.349781 and its 95th
percentile +$109.9142. Peak capital $29.12, −3.40 % a year on that peak over 253 days.

In sample: −$81.19693 on 15 trades.

One fill, checked against the tape: the week ending 3 February 2026, bracket 240–259, one YES print for
157.894735 shares at 0.026, fee rate 0, payout 0. P&L −4.105263, the stake that print could sell, and the
figure the scorer returns. The historical rate on that bracket was 0.081.

The bar fails on every condition. **HITS fails.**

## What this kills

Buying the bracket whose past hit rate most exceeds the open price, and holding, loses the stake. The
entries were cheap brackets. None of the nine out-of-sample buys won. Not retried by requiring the
bracket to be the mode, or by widening the hour.
