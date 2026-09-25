# fp5 — NEXT, the bucket yesterday's bucket moved to, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-next.md` (sha256
`132f72da621ba680ba1eab80e282d47794d04c4593c53a6a725a2d30af6b3de2`) and frozen in `dcfc6ce` before this
file was opened for the rule. The rule is `scripts/next_test.py` (git blob
`dcd6b69e458b2b10c472782f50d13068e272083f`). The input is `inputs/wx_inputs.json.gz` (sha256
`890d805ef362fbc63eec19db4309d5bcbe7fc3b3ab85487634b9e124a841a948`). The run wrote `results/next_run.json`
(sha256 `213020ef16dc7ea11d1259a4e6e6416d738c0bd74e20f2b4e9a2612b5a9f7096`). A second run wrote a
byte-identical file. `next_test.py --self-check` still prints `33.093261`. No forecast was read.
A stay was not a trade.

## Result

10,183 events had no trade. 1,111 filled under $2. 292 filled. No tape was incomplete.

Out of sample: **+$27.3845 on 292 trades**, cost $2,031.54, fees $85.58, 46 won and 246 lost.
OOS1 +$251.804679 on 62. OOS2 −$224.42018 on 230. Stress −$84.750393. The null's 95th percentile is
+$656.173263. Peak capital $98.44, +40.13% a year. In sample has no trade.

The trade count and the 4% a year pass. The second half loses. May is 707% of the total
(+$193.556524); without it the remainder is −$166.172024. **NEXT fails.**

## What this kills

The usual destination of yesterday's bucket, other than a stay, is not underpriced after the fee.
Not retried by buying the stay (that is YDAY, which failed), by dropping May, or with a forecast.
