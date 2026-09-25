# fp12 out of sample: DOM-UP fails (2026-09-25)

The 2023 screen passed and was pre-registered before this run (`d46ff8c`,
sha256 `d5dc5a69…`, frozen 2026-09-25T01:22:11Z). Two runs of `dom_up_test.py`
wrote the same file. Result `docs/agents/backtests/fp12/dom_up_oos.json`,
sha256 `c58cb9cb87e43701d6b43b511e4f71934ed8876a62bbb78d23858636f05bbb7c`.

2023 reproduces: 115 trades, +$35.589. The run is valid.

| | |
|---|---|
| trades | 302 |
| total on $100 | −$47.1558 |
| mean | −$0.156145 (−15.6 bps) |
| null p95 | −$0.0452 |
| 2024 | +$7.3351 |
| 2025-01-01 through 2026-09-24 | −$54.4909 |
| doubled costs | −$107.4014 |
| annualised on the locked $100 | −17.2% |
| 80th percentile | 602 trades, −$97.4434 |
| 95th percentile | 161 trades, −$13.8799 |

Only the count of 30 is met. Both sub-windows are not positive, the mean does
not beat the null, doubled costs lose, the year without the best month loses,
and the annualised result is not above 4%. Both neighbors lose, so the veto
fires as well. The dominance file for 2026-09-24 was not published; the last
bar used is 2026-09-23 16:00 UTC. That hole is not where the loss is.

An earlier scorer returned no 2024 trade because it dropped every bar opened
from 2024 on. That file was not a result. This one reproduces the screen.

The lower tail is not scored. The rule is not fit to add.
