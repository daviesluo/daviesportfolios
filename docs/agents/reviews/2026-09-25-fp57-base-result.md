# fp57 out of sample: BASE-CHG fails (2026-09-25)

The 2023 screen passed and was pre-registered before this run (`1b3b81c`,
sha256 `1b455c48…`, frozen 2026-09-25T04:06:10Z, bid 84178.00000000, ask
84178.01000000, half-spread 5.9397938896041255e-08). Two runs of
`base_test.py` wrote the same file. Result
`docs/agents/backtests/fp57/base_oos.json`, sha256
`ab214f5b69d8badd48e155d6e18cb03ced2ab113560a5a4d76edee524edff722`.

2023 reproduces: 44 trades, +$28.6869. The run is valid.

| | |
|---|---|
| trades | 102 |
| total on $100 | −$6.934 |
| mean | −$0.067981 (−6.80 bps) |
| null p95 | +$0.2877 |
| 2024 | +$7.8662 |
| 2025-01-01 through 2026-09-24 | −$14.8002 |
| doubled costs | −$27.2998 |
| annualised on the locked $100 | −2.54% |
| 80th percentile | 210 trades, −$50.133 |
| 95th percentile | 65 trades, −$6.0329 |

The count of 30 is met. 2024 is positive and the later window is negative,
so the total is negative, the mean loses to the null, doubled costs lose,
and the annualised result is under 4%. The best month is 2026-02
(+$10.5814). The total without it is −$17.5154, so the rest of the book is
not positive. Both neighbours lose, so the veto fires. A losing neighbour
is not a candidate. The neighbours kept the screen's gate: the change must
be strictly above the threshold and strictly above zero.

The daily grid from 2024-01-01 through the 2026-09-25 open has 999 bars
and no hole. The 2026-09-25 base volume is stored as 0. The 2024-01-01 bar
keeps its real base volume.

A day base volume did not rise is not scored. The 80th and the 95th are
not candidates. The rule is not fit to add.
