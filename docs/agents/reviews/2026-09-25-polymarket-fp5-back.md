# fp5 — BACK, one bucket from yesterday toward the month, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-back.md` (sha256
`b3b529ac8815a4dc60787085cc7568b45d2f4c9721ea28b3cf3e866cac3f7327`) and frozen in `dcfc6ce` before this
file was opened for the rule. The rule is `scripts/back_test.py` (git blob
`cd69d1e8087cbb22d8ee28857b52b7b5e0a004f0`). The input is `inputs/wx_inputs.json.gz` (sha256
`890d805ef362fbc63eec19db4309d5bcbe7fc3b3ab85487634b9e124a841a948`). The run wrote `results/back_run.json`
(sha256 `a8138acf24a3f2ae75b48bb7b55b3deac316e75f92e7fb81102fd8f40a421a76`). A second run wrote a
byte-identical file. `back_test.py --self-check` still prints `80.464091`. No forecast was read.
The month-median bucket was never the trade.

## Result

10,851 events had no trade. 621 filled under $2. 114 filled. No tape was incomplete.

Out of sample: **+$314.609943 on 114 trades**, cost $707.19, fees $31.44, 12 won and 102 lost.
OOS1 −$182.184088 on 49. OOS2 +$496.79403 on 65. Stress +$269.89577. The null's 95th percentile is
+$496.39246. Peak capital $38.85, +1,168.16% a year. In sample has no trade.

Stress, the trade count and the 4% a year pass. The first half loses. July is 139.2% of the total
(+$438.04994); without it the remainder is −$123.439997. The null is not beaten. **BACK fails.**

## What this kills

One listed step from yesterday toward the month median is not a bar-clearing price. Not retried by
buying the median bucket (that is CLIM), by dropping July, or with a forecast. Not HOT and not YDAY.
