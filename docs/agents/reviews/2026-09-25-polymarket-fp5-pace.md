# fp5 — PACE, the bracket the tracker points at with 48 hours left, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-pace.md` (sha256
`1a082817285e98e27688c2c1f6a299a48b70326bd3544a68e68dbb6d98f39567`) and frozen in `c7f7093` before any
pace or any return of this rule was read. The rule is `scripts/pace_test.py` (git blob
`f57e3659dac22368843e7e5bcae8e1d39f42a18d`). The input is `inputs/pace_inputs.json.gz` (sha256
`d40019926b9aa0c12ed84273ed17d4390e2e3cebea74b35b4a0699cf5160d3f6`). The run wrote `results/pace_run.json`
(sha256 `d2f8799f28215ac012f7ad51f2299199e1d9c3265cfeb0b2d2207a58df6d19cb`). A second run wrote a
byte-identical file. `pace_test.py --self-check` still prints `39.351744`.

## What the pull did

237 events. 17 forecasts had an edge. 8 filled less than $2. 9 filled. No tracker response and no tape
was incomplete.

## Result

Out of sample: **−$69.011 on 7 trades**, cost $69.011, fees $0, 0 won and 7 lost, −$1 a dollar. OOS1
−$69.011 on 7. OOS2 has no trade. Stress −$82.20576. The null's mean is −$0.597879 and its 95th
percentile −$69.011, the same loss, so the result does not clear it. Peak capital $10, −9.96 % a year
on that peak over 253 days.

In sample: −$20 on 2 trades.

One fill, checked against the tape: the week ending 3 February 2026, bracket 280–299, three YES prints
at 0.0050000000000000044, 0.005 and 0.0057504313, sizes 2.2, 800 and 869.5, fee rate 0, payout 0. The
cost is 9.011 and the P&L is −9.011, which is what the scorer returns.

Every condition fails. **PACE fails.**

## What this kills

Knowing the tracker's count with 48 hours left, and adding the average remainder from past windows, does
not pick the bracket that pays. All seven out-of-sample buys lost. Not retried at 24 hours or at 72.
