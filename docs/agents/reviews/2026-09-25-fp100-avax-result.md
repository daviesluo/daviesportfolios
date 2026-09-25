# fp100 out of sample: AVAX-Q fails (2026-09-25)

The 2023 screen passed and was pre-registered before this run (`0a3786a`,
sha256 `b080801a6326a2966347eea41ac1e525ec5cb00be1f4284d82fadd0ea8e59bd1`,
frozen 2026-09-25T05:23:21Z, AVAXUSDT bid 10.17300000, ask 10.17400000,
half-spread 4.914729444141376e-05). Two runs of `avax_test.py` wrote the
same file. Result `docs/agents/backtests/fp100/avax_oos.json`, sha256
`01fa9fa2c80778b4c2831f5a2e40c1f1b8d662d9eb66005733e282e739426e5c`.

2023 reproduces: 77 trades, +$80.1845. The run is valid.

| | |
|---|---|
| trades | 112 |
| total on $100 | −$63.8438 |
| mean | −$0.570034 |
| null p95 | +$0.442 |
| 2024 | −$14.5546 |
| 2025-01-01 through 2026-09-24 | −$49.2892 |
| doubled costs | −$86.0939 |
| annualised on the locked $100 | −0.233497 (−23.35%) |
| 80th percentile | 178 trades, −$50.7577 |
| 95th percentile | 71 trades, −$63.2799 |

The count of 30 is met. Both later windows are negative, so the total is
negative, the mean loses to the null, doubled costs lose, and the
annualised result is under 4%. The best month is 2026-09 (+$6.0157, share
−0.0942). The total without it is −$69.8595, so the rest of the book is not
positive. Both neighbours lose, so the veto fires. A losing neighbour is not
a candidate. `passes` is false. `neighbors_hold` is false.

No hourly bar was read. ETH was not scored. The 2026-09-25 quote is stored
as zero and is an exit print. The OOS window is 998 days.

A day AVAX was quiet versus BTC is not scored. The 80th and the 95th are
not candidates. The rule is not fit to add.
