# fp5 — MEAN3, the mean of the last three temperatures, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-mean3.md` (sha256
`7f7f5b415069ad63999f616802b260a45881da0b01568b1fc7e93bd9d7649069`) and frozen in `dcfc6ce` before this
file was opened for the rule. The missing-bracket guard is `d1e958f`. The rule is `scripts/mean3_test.py`
(git blob `655d2108194c02f7e58572b52922c9caa7181cb4`). The input is `inputs/wx_inputs.json.gz` (sha256
`890d805ef362fbc63eec19db4309d5bcbe7fc3b3ab85487634b9e124a841a948`). The run wrote
`results/mean3_run.json` (sha256 `37b79a2301cfd0cf93738050a861620a6db59cb234af6ee08d20d706835ea1dc`).
A second run wrote a byte-identical file. `mean3_test.py --self-check` still prints `17.457778`.
No forecast was read.

## Result

6,498 events had no trade. 4,392 filled under $2. 696 filled. No tape was incomplete.

Out of sample: **+$299.8544 on 670 trades**, cost $4,513.30, fees $180.61, 123 won and 547 lost.
OOS1 −$169.166136 on 415. OOS2 +$469.020535 on 255. Stress +$22.775856. The null's 95th percentile is
+$1,203.137223. Peak capital $125.70, +344.15% a year. In sample −$66.438415 on 26.

Stress, the trade count and the 4% a year pass. The first half loses. April is 129.5% of the total
(+$388.32646); without it the remainder is −$88.47206. **MEAN3 fails.**

## What this kills

The mean of the last three resolved midpoints is not underpriced after the fee across both halves.
Not retried by replacing the mean with the month's median (that is CLIM), by dropping April, or with
a forecast. Not JUMP and not YDAY.
