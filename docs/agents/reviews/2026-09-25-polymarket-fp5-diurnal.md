# fp5 — DIURNAL, yesterday's low plus the month's range, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-diurnal.md` (sha256
`9c5c7986159c35448c928f3a496acefb8f279ec7e42e0906c8ae5f54554e175b`) and frozen in `dcfc6ce` before this
file was opened for the rule. The missing-bracket guard is `d1e958f`, which is the code that produced
this run. The rule is `scripts/diurnal_test.py` (git blob
`29c0be5c877540fa6c4797968803cd23b7681f33`). The input is `inputs/wx_inputs.json.gz` (sha256
`890d805ef362fbc63eec19db4309d5bcbe7fc3b3ab85487634b9e124a841a948`). The run wrote
`results/diurnal_run.json` (sha256 `e1ba7a42cb9cd454ad835520cc03d30a471397dea432521f719dec1b8ff904df`).
A second run wrote a byte-identical file. `diurnal_test.py --self-check` still prints `21.913065`.
No forecast was read. Lowest-temperature markets were outside the rule from the start.

## Result

11,264 events had no trade. 279 filled under $2. 43 filled. No tape was incomplete.

Out of sample: **+$138.529726 on 43 trades**, cost $273.14, fees $12.13, 7 won and 36 lost.
OOS1 +$11.702959 on 11. OOS2 +$126.826767 on 32. Stress +$116.55396. The null's 95th percentile is
+$407.267793. Peak capital $30, +666.18% a year. In sample has no trade.

Both halves, stress and the 4% a year pass. August is 132.6% of the total (+$183.655998); without it
the remainder is −$45.126272. Forty-three trades are under 80. The null is not beaten. **DIURNAL fails.**

## What this kills

Yesterday's low plus the month's median range is not a price the fee leaves underpriced often enough,
and the profit that does appear is August. Not retried by dropping August, by trading lows, or with a
forecast. Not YDAY and not WX.
