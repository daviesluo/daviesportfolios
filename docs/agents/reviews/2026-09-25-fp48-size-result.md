# fp48 out of sample: AVG-CHG fails (2026-09-25)

The 2023 screen passed and was pre-registered before this run (`e63f691`,
sha256 `e5463632…`, frozen 2026-09-25T03:47:48Z, bid 84180.31000000, ask
84180.32000000, half-spread 5.939630903800506e-08). Two runs of
`size_test.py` wrote the same file. Result
`docs/agents/backtests/fp48/size_oos.json`, sha256
`13d0368d767e2f01705a0d43eb31ed469f16897ee793b3e7b128f81608c968f9`.

2023 reproduces: 48 trades, +$37.2656. The run is valid.

| | |
|---|---|
| trades | 116 |
| total on $100 | −$14.8577 |
| mean | −$0.128083 (−12.81 bps) |
| null p95 | +$0.2669 |
| 2024 | +$3.839 |
| 2025-01-01 through 2026-09-24 | −$18.6967 |
| doubled costs | −$38.0048 |
| annualised on the locked $100 | −5.43% |
| 80th percentile | 202 trades, −$25.3009 |
| 95th percentile | 64 trades, +$5.685 |

The count of 30 is met. The total is negative, so the later window is
negative, the mean loses to the null, doubled costs lose, and the
annualised result is under 4%. The best month is 2024-11 (+$20.8241). The
total without it is −$35.6818. The 80th neighbor loses, so the veto fires.
The 95th is positive. A positive neighbour does not save a failed rule and
is not a candidate.

The daily grid from 2024-01-01 through the 2026-09-25 open has 999 bars and
no hole. The 2026-09-25 quote and trade count are stored as 0. The
2024-01-01 bar keeps its real quote and trade count.

A day the average size did not rise is not scored. The 80th is not a
candidate. The rule is not fit to add.
