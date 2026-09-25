# fp5 — CLIM, the bucket that contains the month's median, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-clim.md` (sha256
`c725d8ae7024f64892e6f0a59907cec668cd9eea99b3b5ec3b432a725200a5e6`) and frozen in `55f029b` before this
file was opened for the rule. The rule is `scripts/clim_test.py` (git blob
`d73c241b6b79b1fd669a6e9b4628fed3c9d362eb`). The input is `inputs/wx_inputs.json.gz` (sha256
`890d805ef362fbc63eec19db4309d5bcbe7fc3b3ab85487634b9e124a841a948`). The run wrote `results/clim_run.json`
(sha256 `6a7101f40ded74bf0b5a1c298c2edfad56a4d5f6e93df2519ccad672e2ded4a0`). A second run wrote a
byte-identical file. `clim_test.py --self-check` still prints `37.224048`. No forecast was read.

## Result

6,677 events had no trade. 3,939 filled under $2. 970 filled. No tape was incomplete.

Out of sample: **−$283.661551 on 944 trades**, cost $6,582.63, fees $250.85, 212 won and 732 lost.
OOS1 −$534.11 on 450. OOS2 +$250.45 on 494. Stress −$636.48. The null's 95th percentile is +$1,152.98.
Peak capital $195.25, −2.10 % a year. In sample −$83.77 on 26.

The trade count is the only condition that passes. **CLIM fails.**

## What this kills

The bucket around the same month's past median is not underpriced after the fee. One half makes back
part of what the other half loses, and the sum is still a loss. Not retried on one half, with a shorter
month, or with a forecast. WX stays failed.
