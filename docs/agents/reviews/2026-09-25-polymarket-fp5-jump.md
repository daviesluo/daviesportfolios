# fp5 — JUMP, the temperature bucket one step past the last two days, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-jump.md` (sha256
`8724c6c28e83a8928e73e3f134ffecd11fa0911654dfb18cefe6388314ec3e6c`) and frozen in `55f029b` before this
file was opened for the rule. The rule is `scripts/jump_test.py` (git blob
`e77ca696e30c5b27a8da0150d1891b7130322007`). The input is `inputs/wx_inputs.json.gz` (sha256
`890d805ef362fbc63eec19db4309d5bcbe7fc3b3ab85487634b9e124a841a948`). The run wrote `results/jump_run.json`
(sha256 `dd587fa891539a8df194d57cfb0224f7d0bec82f5f30c8e7117532fa61e2fefa`). A second run wrote a
byte-identical file. `jump_test.py --self-check` still prints `14.095244`. No forecast was read.

## Result

7,250 events had no trade. 3,891 filled under $2. 445 filled. No tape was incomplete.

Out of sample: **+$692.119086 on 421 trades**, cost $2,771.18, fees $113.56, 67 won and 354 lost.
OOS1 −$15.30 on 277. OOS2 +$707.42 on 144. Stress +$491.87. The null's 95th percentile is +$1,208.88.
Peak capital $83.71, +1,192.8 % a year on that peak over 253 days. In sample −$84.82 on 24.

Months by the entry: Jan −11.22, Feb −182.60, Mar −296.01, Apr −264.19, May +728.42, Jun +173.59,
Jul +403.86, Aug +177.83, Sep −37.56. May is 105 % of the total. Without May the remainder is −$36.30.

Stress, the trade count and the 4 % on peak capital pass. The halves, the null and the month do not.
**JUMP fails.**

## What this kills

Extrapolating the last two resolved temperatures one step further does not beat a coin flip at the fill
price. The gain is May, and the first half of 2026 loses. Not retried by dropping May, by stopping at
one step of a different size, or with a forecast. WX stays failed.
