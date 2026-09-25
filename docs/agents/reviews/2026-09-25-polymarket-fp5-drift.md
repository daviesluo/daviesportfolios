# fp5 — DRIFT, one bucket on the side past steps took, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-drift.md` (sha256
`4b199778130a41b8c72270236e8b6a4fd49422b5e271beccf681037b0dd06400`) and frozen in `dcfc6ce` before this
file was opened for the rule. The rule is `scripts/drift_test.py` (git blob
`7ad60faf2b7f9502af92930a9815679fb9e6f284`). The input is `inputs/wx_inputs.json.gz` (sha256
`890d805ef362fbc63eec19db4309d5bcbe7fc3b3ab85487634b9e124a841a948`). The run wrote `results/drift_run.json`
(sha256 `419b54c250b2fc16687bba464085c710e7a85ed2a57e98a850d5921f7b74f7dc`). A second run wrote a
byte-identical file. `drift_test.py --self-check` still prints `25.354286`. No forecast was read.

## One fill, by hand

Seoul's highest temperature, event 180827, bracket −4.5 to −3.5. Shown 0.0235, tick 0.001, fair 0.05,
fee rate 0.05, payout 0. Two taker buys: 57 shares at 0.04, and 81.03 shares at 0.0245 (the shown
price plus one tick). The fee is `0.05 * p * (1 − p)`.

- `0.05 * 0.04 * 0.96 = 0.00192`, so 57 shares cost `57 * (0.04 + 0.00192) = 2.38944`
- `0.05 * 0.0245 * 0.9755 = 0.0011949875`, so 81.03 shares cost `81.03 * (0.0245 + 0.0011949875) = 2.082064837125`

The sum is 4.471504837125. The payout is 0, so the P&L is **−4.471504837125**. `post_test.pnl_of`
returns the same number. Rounded to six decimals it is the whole of January in the out-of-sample
month table (−$4.471505).

## Result

9,211 events had no trade. 2,121 filled under $2. 254 filled. No tape was incomplete.

Out of sample: **+$660.418866 on 251 trades**, cost $1,488.31, fees $66.46, 29 won and 222 lost.
OOS1 +$404.822084 on 112. OOS2 +$255.596782 on 139. Stress +$558.40792. The null's 95th percentile is
+$773.299372. Peak capital $54.79, +1,739.00% a year. In sample −$11.580916 on 3.

Both halves, stress, the trade count and the 4% a year pass. The null is not beaten ($660.42 against
+$773.30). April is 76.5% of the total (+$505.481367); without it the remainder is +$154.937499, which
is still over the 40% line the bar refuses. **DRIFT fails.**

## What this kills

One listed bucket on the side the old steps mostly took does not beat a redraw of the same fills.
Not retried by dropping April, by following only the last step (that is JUMP, which failed), or with
a forecast.
