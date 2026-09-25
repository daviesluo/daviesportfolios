# Liquidation snapshots were not scored (2026-09-25)

The public coin-margined liquidation snapshots for BTCUSD_PERP are present on
2023-06-25 and on 2023-12-31. The file for 2023-06-24 is absent. The
USDT-margined path for 2023-12-31 is absent. A trailing 90-print rule on a
series that starts that late does not have a sample that can be counted on
to reach 30 trades, and the window was not shrunk to make it fit. No
liquidation file was read into a screen. The count stays 30.

This note is the research record. It is not a rule and it has no fill.
