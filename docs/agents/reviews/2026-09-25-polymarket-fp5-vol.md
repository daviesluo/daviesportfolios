# fp5 — VOL, a Deribit digital against the daily Bitcoin ladder, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-vol-digital.md` (sha256
`71851772002f4f373ecd22124001618d45dc7a9640dee47f58b51b5a8a15b75e`) and frozen in `3023290` before any
return was computed. The rule is `scripts/vol_test.py` (sha256
`62f92507a574aa1150a99471e549f10a30d284ac8d721dec98ac878d8020ffe5`, unchanged from that commit). The
input is `inputs/vol_inputs.json.gz` (sha256 `ed5bf0928e10f8c3bc1039a7ff04904d7b5838e16baffd9496c56dcc2fe4bc17`).
The run wrote `results/vol_run.json` (sha256 `5d599374b8d5cc9cb6dff94a5d91ca16bce75267cfcf500de26d7c9f24fa04d0`).
A second run of the same command wrote a byte-identical file.

## Deviation, before any P&L

The puller committed in `3023290` treated a Deribit chunk as already cached when one candle sat in its first
day. Deribit's end is inclusive, so each window's last hour is the next window's first candle, and every
other 40-day window was never requested (4,805 candles; 190 of 367 events had no hourly DVOL). That was
found from the cache, before `vol_test.py` ran. The puller now skips a chunk only when it already holds at
least 90 % of the hours the pre-registration named. The candle the rule reads did not change. After the
repair: 9,455 candles, 367 events, none missing a DVOL. The repaired puller is the one that built the
committed input.

## Result

Primary arm, hourly DVOL, out of sample (end dates 2026-01-01 → 2026-09-11): **−$239.675216 on 146 trades
of $10, −$0.166818 a dollar.** OOS1 −$277.082551 on 88, OOS2 +$37.407335 on 58. In sample −$35.826785 on
65. Fees $71.794052. Won 47, lost 99. Stress (one tick worse, fees doubled, book not re-walked)
−$320.41712. The calibration null's mean is −$69.977358 and its 95th percentile +$418.133763; the loss is
larger than the fee drag, and it does not clear the null. Peak capital in the window $10 (one open trade
at a time), −34.58 % a year on that peak over 253 days. The same shares filled at the shown history price,
which nobody could trade, still lose −$200.369172, so this is not the history-lag from fp4.

Months of the out-of-sample P&L: Jan −27.33, Feb −19.02, Mar −48.94, Apr −41.46, May −140.33, Jun +157.75,
Jul +16.79, Aug −140.72, Sep +3.59. Of 367 events in the window, 211 filled, 116 had no edge after the fee
and one tick, 40 were under the $2 minimum.

The bar is the six conditions in the pre-registration. Only the trade count passes. **VOL fails.**

Secondary arm, trailing 24-hour realised vol, is not the verdict and also fails: out of sample
−$20.794919 on 167 (OOS1 −$53.479838 on 105, OOS2 +$32.684919 on 62), stress −$91.945633, null 95th
+$289.647705, −3.00 % a year on a $10 peak. In sample it made +$105.192569 on 76. At the shown history
price the out-of-sample figure is +$15.668944; the one-tick floor takes that away. It is not promoted.

## What this kills

The zero-drift digital against this ladder, with Deribit hourly DVOL or a 24-hour realised vol, does not
beat the taker fee and one tick out of sample. Not retried inside this search: a different threshold, the
wings instead of the at-the-money strike, an ETH twin, a 4-hour multi-strike, or realised vol in place of
DVOL as the primary. A loss on both arms is the family, not a parameter.

## Killed on arithmetic before any test, same day

Recorded here so the next session does not reopen them.

* Copying the current leaderboard. The ranking has no as-of date, so a backtest would select on what
  already happened. A month-board sample's next buy was about 0.66¢ worse, on 16 of 63 buys. Those
  addresses are contaminated and are excluded from the next test by name.
* Buying a disputed proposal. The resolution record has no proposal time. Eighteen live disputes sat
  far from M2's 77 % stick rate, and that gap cannot be entered without looking ahead.
* Kraken XBTUSDT against Binance, about 4 bps, under a cent on a 16-hour digital.
* The 2028 nomination ladder against the presidency ladder: on the 24 shared names, no bid/ask cleared
  the politics fee.
* Funding as a drift. At the 16-hour at-the-money, one unit of annual drift moves the digital by about
  0.04; ordinary funding is far under the 1.75¢ fee at 50¢, and it is not a drift of the Binance spot
  the market settles on.
* Buying the 0.05–0.10 side after 2026-09-10. The only unseen window is one calendar month, so the
  month condition cannot pass. FAV already published the 2026 calibration the other way.
