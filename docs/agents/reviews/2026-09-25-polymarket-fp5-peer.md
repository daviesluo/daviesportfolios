# fp5 — PEER, other cities' latest temperature, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-peer.md` (sha256
`74b201b53026cf83ebf16aa104c35a63e997caa6e465bb6fc97e7d6385ac0389`) and frozen in `dcfc6ce` before this
file was opened for the rule. A missing bracket is no trade (`d1e958f`); a run of that code matches this
file byte for byte. The rule is `scripts/peer_test.py` (git blob
`b07e05de8b0acde9d503963a8daec34f10914a5f`). The input is `inputs/wx_inputs.json.gz` (sha256
`890d805ef362fbc63eec19db4309d5bcbe7fc3b3ab85487634b9e124a841a948`). The run wrote `results/peer_run.json`
(sha256 `f3f9f5106945358850491ee9ccd1fdf8f7566483aeeca29217ae35e7e2f25ed8`). A second run wrote a
byte-identical file. `peer_test.py --self-check` still prints `37.224048`. No forecast was read.

## Result

5,904 events had no trade. 5,186 filled under $2. 496 filled. No tape was incomplete.

Out of sample: **−$547.639707 on 489 trades**, cost $3,205.68, fees $129.74, 70 won and 419 lost.
OOS1 −$876.709069 on 317. OOS2 +$329.069362 on 172. Stress −$783.482519. The null's 95th percentile is
+$1,273.386867. Peak capital $104.63, −755.12% a year. In sample +$18.61146 on 7.

The trade count is the only condition that passes. **PEER fails.**

## What this kills

Other cities' latest midpoint is not a fair price for this city's bucket. One half loses, and the whole
out-of-sample book loses. Not retried by dropping March, which is −$453.78. Not CLIM and not YDAY.
