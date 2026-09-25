# fp5 — SHIFT, the histogram of temperature changes, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-shift.md` (sha256
`1e82aba0da392c1b1816131c2199435edceeaad4ee047bb47c1c9b3475c1f6b9`) and frozen in `dcfc6ce` before this
file was opened for the rule. The rule is `scripts/shift_test.py` (git blob
`1194e8139416c30329ca10c47613e7c3305f2f14`). The input is `inputs/wx_inputs.json.gz` (sha256
`890d805ef362fbc63eec19db4309d5bcbe7fc3b3ab85487634b9e124a841a948`). The run wrote `results/shift_run.json`
(sha256 `c58ac43ecb41fa2c515f24e7eda793be4e59213fbe9d359e5ed6163c6dde709b`). A second run wrote a
byte-identical file. `shift_test.py --self-check` still prints `60.998571`. No forecast was read.
Yesterday's own bracket stayed ineligible.

## Result

1,508 events had no trade. 8,980 filled under $2. 1,098 filled. No tape was incomplete.

Out of sample: **+$259.949931 on 1,064 trades**, cost $6,923.18, fees $283.04, 146 won and 918 lost.
OOS1 −$769.071349 on 635. OOS2 +$1,029.02128 on 429. Stress −$223.713321. The null's 95th percentile is
+$1,658.333262. Peak capital $147.33, +254.54% a year. In sample −$160.642252 on 34.

The trade count and the 4% a year pass. The first half loses. July is 227.8% of the total
(+$592.133084); without it the remainder is −$332.183153. **SHIFT fails.**

## What this kills

The histogram of past changes, with yesterday's bracket excluded, does not clear the bar. Not retried
by putting yesterday's bracket back (that would be a persistence rule, and YDAY already failed), by
dropping July, or with a forecast. Not JUMP.
