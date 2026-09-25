# fp5 — YDAY, today's temperature bucket equals the last resolved day, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-yday.md` (sha256
`872b2ee387d2c51efb24f565fb64cff5a0f192ba1382e5f3156af44d8187be2b`) and frozen in `55f029b` before this
file was opened for the rule. The rule is `scripts/yday_test.py` (git blob
`056cdd01b14aff1a75e922dfbd40d1c00d56e164`). The input is the committed weather file
`inputs/wx_inputs.json.gz` (sha256 `890d805ef362fbc63eec19db4309d5bcbe7fc3b3ab85487634b9e124a841a948`).
The run wrote `results/yday_run.json` (sha256 `237a6ab9924c0a989919dc927eab8262e849357c8d8a23fa470c7fac30213880`).
A second run wrote a byte-identical file. `yday_test.py --self-check` still prints `14.095244`. No forecast
was read.

## Result

11,586 events inside the windows. 7,929 had no trade. 3,072 filled under $2. 585 filled. No tape was
incomplete.

Out of sample: **−$1,536.215242 on 584 trades**, cost $3,776.92, fees $162.54, 58 won and 526 lost.
OOS1 −$443.01 on 230. OOS2 −$1,093.21 on 354. Stress −$1,764.09. The null's 95th percentile is +$999.33.
Peak capital $104.78, −21.15 % a year. In sample −$7.33 on 1 trade.

Every condition except the trade count fails. **YDAY fails.**

## What this kills

The frequency with which the next day repeats the last resolved bucket does not clear the price after
the weather fee. The buys lost about 41 cents a dollar. Not retried with a longer lag, a forecast, or
2025 removed. WX stays failed.
