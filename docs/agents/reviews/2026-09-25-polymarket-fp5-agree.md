# fp5 — AGREE, the three-day mean and other cities, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-agree.md` (sha256
`6a86051ea3a2925025d53b8dbf7c0680b583949ff6028558c6a51734ef7699ab`) and frozen in `dcfc6ce` before this
file was opened for the rule. The missing-bracket guard is `d1e958f`. The rule is `scripts/agree_test.py`
(git blob `c64f5ef5ec7dc9fbe03fe91985020cd3ae01d9d7`). The input is `inputs/wx_inputs.json.gz` (sha256
`890d805ef362fbc63eec19db4309d5bcbe7fc3b3ab85487634b9e124a841a948`). The run wrote
`results/agree_run.json` (sha256 `a6e3c915b4c4623e0de25cb82a8fb6e0a76c1ced1be6a764195e63cdbbe915c6`).
A second run wrote a byte-identical file. `agree_test.py --self-check` still prints `42.226579`.
No forecast was read. A disagreement of the two estimates was not a trade.

## Result

10,593 events had no trade. 796 filled under $2. 197 filled. No tape was incomplete.

Out of sample: **−$513.325434 on 193 trades**, cost $1,335.67, fees $49.21, 34 won and 159 lost.
OOS1 −$550.088211 on 143. OOS2 +$36.762777 on 50. Stress −$590.720514. The null's 95th percentile is
+$654.260437. Peak capital $67.63, −1,095.04% a year. In sample +$15.793615 on 4.

The trade count is the only condition that passes. **AGREE fails.**

## What this kills

Requiring the three-day mean and the other cities' median to name the same bucket does not make that
bucket cheap. The out-of-sample book loses, and the first half loses. Not retried by trading either
estimate on its own from this result: MEAN3 and PEER were run separately and also fail. Not a forecast.
