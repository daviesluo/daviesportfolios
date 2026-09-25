# fp41 out of sample: STREAK fails (2026-09-25)

The 2023 screen passed and was pre-registered before this run (`3a830a9`,
sha256 `968248fa…`, frozen 2026-09-25T03:28:08Z). Two runs of `streak_test.py`
wrote the same file. Result `docs/agents/backtests/fp41/streak_oos.json`,
sha256 `241e12186e73e603f5e4332afab0c01c7f468510b3b3cbfcb8badf66c0a14d0f`.

2023 reproduces: 33 trades, +$36.9301. The run is valid.

| | |
|---|---|
| trades | 84 |
| total on $100 | +$35.6965 |
| mean | +$0.424959 (+42.50 bps) |
| null p95 | +$0.3632 |
| 2024 | +$30.7475 |
| 2025-01-01 through 2026-09-24 | +$4.949 |
| doubled costs | +$18.842 |
| annualised on the locked $100 | +13.06% |
| 80th percentile | 138 trades, +$18.6522 |
| 95th percentile | 53 trades, +$32.9515 |

The count of 30 is met. Both later windows are positive. The mean beats the
null. Doubled costs are positive. The annualised result is above 4%. The
best month is 2024-02 (+$17.3009), 48.47% of the total. The bar is 40%.
Without that month the total is +$18.3956, and that does not repair the
share. The 80th and the 95th are both positive, so the veto does not fire.
A positive neighbour does not save a failed rule and is not a candidate.

The daily grid from 2024-01-01 through the 2026-09-25 open has 999 bars and
no hole. The 2026-09-25 close is stored equal to the open. The 2024-01-01
bar keeps its real close.

A shorter run of rising closes is not scored. The 80th is not a candidate.
The rule is not fit to add.
