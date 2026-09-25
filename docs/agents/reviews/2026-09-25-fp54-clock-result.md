# fp54 out of sample: VOL-CLOCK fails (2026-09-25)

The 2023 screen passed and was pre-registered before this run (`1b3b81c`,
sha256 `d0083afe…`, frozen 2026-09-25T04:06:10Z, bid 84178.00000000, ask
84178.01000000, half-spread 5.9397938896041255e-08). Two runs of
`clock_test.py` wrote the same file. Result
`docs/agents/backtests/fp54/clock_oos.json`, sha256
`0339111ef7f8d88439ddf284bf9333fb9f2920c62d53d631a9e2f99edcd6eace`.

2023 reproduces: 38 trades, +$25.3277. The run is valid.

| | |
|---|---|
| trades | 109 |
| total on $100 | −$42.8954 |
| mean | −$0.393536 (−39.35 bps) |
| null p95 | +$0.2948 |
| 2024 | −$14.7672 |
| 2025-01-01 through 2026-09-24 | −$28.1282 |
| doubled costs | −$64.588 |
| annualised on the locked $100 | −15.69% |
| 80th percentile | 203 trades, −$73.9054 |
| 95th percentile | 71 trades, −$39.7305 |

The count of 30 is met. Both later windows are negative, so the total is
negative, the mean loses to the null, doubled costs lose, and the
annualised result is under 4%. The best month is 2026-08 (+$6.8278). The
total without it is −$49.7232, so the rest of the book is not positive.
Both neighbours lose, so the veto fires. A losing neighbour is not a
candidate.

The hourly grid from 2024-01-01 through 2026-09-24 23:00 has 23,952 bars
and no hole. No hourly bar is at or after 2026-09-25 00:00 UTC. The daily
grid from 2024-01-01 through the 2026-09-25 open has 999 bars and no hole.
That last open is an exit print.

A day whose quote printed earlier is not scored. The 80th and the 95th are
not candidates. The rule is not fit to add.
