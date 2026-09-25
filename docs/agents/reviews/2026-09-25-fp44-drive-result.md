# fp44 out of sample: OPEN-DRIVE fails (2026-09-25)

The 2023 screen passed and was pre-registered before this run (`3a830a9`,
sha256 `867061de…`, frozen 2026-09-25T03:28:08Z). Two runs of `drive_test.py`
wrote the same file. Result `docs/agents/backtests/fp44/drive_oos.json`,
sha256 `cf011fdd78697d10d28130af97e388964c57edaf9e9e55825bcdc958a896e035`.

2023 reproduces: 36 trades, +$29.0716. The run is valid.

| | |
|---|---|
| trades | 106 |
| total on $100 | +$19.7853 |
| mean | +$0.186654 (+18.67 bps) |
| null p95 | +$0.2899 |
| 2024 | +$9.0681 |
| 2025-01-01 through 2026-09-24 | +$10.7172 |
| doubled costs | −$1.4331 |
| annualised on the locked $100 | +7.24% |
| 80th percentile | 209 trades, +$15.3272 |
| 95th percentile | 64 trades, +$14.5699 |

The count of 30 is met. Both later windows are positive. The annualised
result is above 4%. The mean does not beat the null. Doubled costs lose.
The best month is 2024-07 (+$11.4648), 57.95% of the total. Without that
month the total is +$8.3206, and that does not repair the share. The 80th
and the 95th are both positive, so the veto does not fire. A positive
neighbour does not save a failed rule and is not a candidate.

The hourly grid from 2024-01-01 through 2026-09-24 23:00 has 23,952 bars
and no hole. The daily grid through the 2026-09-25 open has 999 bars and
no hole. The 2026-09-25 bar stores that open only.

A weak first hour is not scored. The 80th is not a candidate. The rule is
not fit to add.
