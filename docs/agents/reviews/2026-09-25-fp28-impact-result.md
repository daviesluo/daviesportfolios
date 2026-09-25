# fp28 out of sample: IMPACT fails (2026-09-25)

The 2023 screen passed and was pre-registered before this run (`fb4330e`,
sha256 `61c415a5…`, frozen 2026-09-25T02:52:42Z). Two runs of `impact_test.py`
wrote the same file. Result `docs/agents/backtests/fp28/impact_oos.json`,
sha256 `6f6710e833e222f4347e8346beebcd99c5d311084e6a16a81811b8baf7ca6f37`.

2023 reproduces: 37 trades, +$32.0371. The run is valid.

| | |
|---|---|
| trades | 113 |
| total on $100 | −$22.6606 |
| mean | −$0.200536 (−20.05 bps) |
| null p95 | +$0.2644 |
| 2024 | −$9.0706 |
| 2025-01-01 through 2026-09-24 | −$13.59 |
| doubled costs | −$45.1928 |
| annualised on the locked $100 | −8.29% |
| 80th percentile | 202 trades, −$50.2414 |
| 95th percentile | 71 trades, −$25.6306 |

The count of 30 is met. Both later windows are negative, so the total is
negative. The mean does not beat the null. Doubled costs lose. The best
month is 2024-11 (+$10.5571); without it the total is −$33.2177. The
annualised result is −8.29%, not above 4%. The 80th loses, so the veto
fires. The 95th also loses and does not save the rule.

The hourly grid from 2024-01-01 through 2026-09-24 23:00 has 23,952 bars
and no hole. The daily grid through the 2026-09-25 open has 999 bars and
no hole. The 2026-09-25 bar is an exit print, and only its open is stored.

A day whose volume and moves do not line up is not scored. The 80th is not
a candidate. The rule is not fit to add.
