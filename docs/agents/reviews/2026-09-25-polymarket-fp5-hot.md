# fp5 — HOT, the bucket above the month's median high, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-hot.md` (sha256
`cf69fd10806fb9567e83f9daac3161523d43eed12678548ccb6bc7506af4f09a`) and frozen in `55f029b` before this
file was opened for the rule. The rule is `scripts/hot_test.py` (git blob
`0f0ce3aca66786db63d0f01d6fbb00343b3f3746`). The input is `inputs/wx_inputs.json.gz` (sha256
`890d805ef362fbc63eec19db4309d5bcbe7fc3b3ab85487634b9e124a841a948`). The run wrote `results/hot_run.json`
(sha256 `efaeae3c364966305d67d0a572573c82c7a2aba454d22234be3e2475b35f1b40`). A second run wrote a
byte-identical file. `hot_test.py --self-check` still prints `156.196667`. No forecast was read.
Lowest-temperature markets were outside the rule from the start.

## Result

8,614 events had no trade. 2,465 filled under $2. 507 filled. No tape was incomplete.

Out of sample: **−$735.322014 on 493 trades**, cost $3,206.43, fees $135.98, 55 won and 438 lost.
OOS1 −$498.73 on 255. OOS2 −$236.59 on 238. Stress −$924.88. The null's 95th percentile is +$869.02.
Peak capital $101.86, −10.42 % a year. In sample +$96.65 on 14.

The trade count is the only condition that passes. **HOT fails.**

## What this kills

The bucket just above the month's median high is not underpriced after the fee. Both halves lose. Not
retried by buying the median bucket instead (that is CLIM, which also failed), by including the lowest
temperature, or with a forecast. WX stays failed.
