# fp26 out of sample: BODY fails (2026-09-25)

The 2023 screen passed and was pre-registered before this run (`ddef5c7`,
sha256 `4be527de…`, frozen 2026-09-25T02:37:30Z). Two runs of `body_test.py`
wrote the same file. Result `docs/agents/backtests/fp26/body_oos.json`,
sha256 `a983c9c66d0db16c14a24dda4da5c4e44c60a8b7ec37a5bd519d09e00b47400a`.

2023 reproduces: 46 trades, +$49.2172. The run is valid.

| | |
|---|---|
| trades | 119 |
| total on $100 | +$5.3179 |
| mean | +$0.044688 (+4.47 bps) |
| null p95 | +$0.2813 |
| 2024 | +$10.6116 |
| 2025-01-01 through 2026-09-24 | −$5.2937 |
| doubled costs | −$18.469 |
| annualised on the locked $100 | 1.94% |
| 80th percentile | 210 trades, −$26.5839 |
| 95th percentile | 74 trades, +$1.9132 |

The count of 30 is met. The total is positive and 2024 is positive. 2025
through 2026-09-24 is negative, so the two sub-windows are not both
positive. The mean does not beat the null. Doubled costs lose. The best
month is 2024-02 (+$11.1529); without it the total is −$5.835, and that
month is more than 40% of the profit. The annualised result is 1.94%, not
above 4%. The 80th loses, so the veto fires. The 95th is positive and does
not save the rule.

The daily grid from 2024-01-01 through the 2026-09-25 open has 999 bars and
no hole. The 2026-09-25 bar is an exit print.

An earlier scorer returned no out-of-sample trade because the screen's date
gate dropped every bar opened from 2024 on. That file was not committed and
is not a result. This one reproduces the screen.

A doji is not scored. The rule is not fit to add.
