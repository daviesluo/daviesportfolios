# Revolut X, a fourth search: nothing reached a pre-registered test (2026-09-25)

Public data only, plus one read-only aggregate of `agent_basis`. No key was printed, no order was sent, and no strategy row was added. PR5's rule, `trend-4h`, and `pmrw.ts` were not edited. The screen is `docs/agents/scripts/fp5/screen.py`. It reads the frozen inputs in `docs/agents/backtests/inputs/fp5_2026-09-25/`, writes `docs/agents/backtests/fp5/summary.json`, and exits non-zero if a kill below stops holding. A second run with `--check` matches that file byte for byte. `reached_preregistration` is false: every idea below died on arithmetic or on a measurement, which is the same gate the earlier searches used before they froze a test.

## What was already closed, and was not re-opened

PR5 (0 % quotes on USDC/GBP and USDT/GBP), the trend and momentum rulebooks, maker-only variants of those rulebooks (§3.23), T1/T2/T3 (§3.28), and the Binance-first tests (§3.29). The question was whether the venue's structure on this day gives a new mechanism those tests did not already price.

## The universe, 2026-09-25 00:20 UTC

`GET /api/1.0/public/configuration/pairs` returned 455 active pairs: USD 307, GBP 64, EUR 61, USDC 23. UK tickers exist for the 394 non-EUR names except `PUMP/USD`, which the ticker rejects (`Couldn't find currency pair X:8:PUMP/USD`), so 393 books. EUR names 400 on `region=UK` and 200 on `region=EEA`. This account trades the UK book, so the EUR list is not a strategy.

UK against EEA mids, one read: BTC, ETH and SOL 0.00 bps. XRP −1.94 bps. SUI +9.74 bps inside a UK spread of 66 bps on that read. No lead to trade.

## Kills

**GBP coin books still sit on interbank.** Sixty-four GBP books with a USD twin, against Kraken GBP/USD 1.32115. Median absolute implied-rate gap 1.00 bp, 90th percentile 4.10, maximum 22.48 (inside that book's own half-spread). The same fact as §3.26. The only GBP stables are still USDC/GBP and USDT/GBP; their index gaps on this snapshot were about 2 bps, which is PR5's market, not a new one. Gold tokens are thinner than on 2026-09-23: about $1k–$10k a day and ~10 bps wide. The 23 USDC-quoted coin books together did $87,583. Capacity kills all three.

**No wide book clears the maker budget.** fp2's inequality: a quote refreshed once a minute needs a half-spread of at least 2.7 one-minute sigmas. On 2026-09-23's UK 1-minute candles, against the 00:20 UTC half-spread: NEON 1.36 (half-spread 340 bps, sigma 250), ALEO 0.66, AURORA 1.14, NEAR 0.96, VVV 1.58, STRK 1.71, QNT 0.95, FET 0.52. The highest ratio is still under 2.7. The pin in `screen.py` checks the inequality both ways: a 30 bp half-spread against a 5 bp minute would clear, and none of these books does.

**The hourly gap versus Binance is a few basis points, and the fat tail does not pay doubled costs.** July 2026, 745 aligned hours, UK close over Binance USDT close. BTC median −8.44 bps, and 1 hour beyond 40 bps; ETH, SOL, XRP and LTC are the same shape (1–4 hours). That 8 bps is smaller than a taker round trip and is common to the majors, so it is the numeraire and the candle, not a coin premium. PEPE had 45 such hours; the median move back toward zero over the next hour was 28.37 bps, under a doubled hedge cost of about 40 bps. SUI had 16 hours and a 46.56 bp median reversion on the close. That close is not the touch: the loop's own 5-minute UK-versus-Kraken basis (below) has one SUI sample beyond 40 bps in 983, and Revolut's 1-minute candles move when nothing trades (§3.26). A fade of the hourly close would be pricing quotes as trades. It was not pre-registered.

**The touch basis the loop records does not pay a hedge.** `agent_basis`, 14 days to 2026-09-25 00:25 UTC, read-only. BTC 1,221 samples, median −0.06 bps, 95th percentile 1.29, none beyond 20. ETH the same (95th 1.85). SOL and AVAX one sample each beyond 40, inside a wide spread. SUI is the wide one: 14 of 983 beyond 20 bps, 95th percentile 9.48. The nine SUI samples with |basis| ≥ 20 and a spread under 5 bps shrank by a median 19.42 bps over the next five minutes, while the mid itself moved 28.18 bps. After the 9 bp taker the gap left is about 10 bps, smaller than the coin's own move, and a hedge on Kraken costs 40 bps a side. Nine events in two weeks is also under a 60-trip bar.

**15:00 UTC is the market's hour, not Revolut's.** July, the return from 15:00 to 16:00 UTC: BTC +22.16 bps on Revolut (t = 2.09, 31 days) and +22.19 on Binance (t = 2.04). ETH, SOL and XRP match to within 2 bps. t stays under 2.5 across 24 hours of looks. A taker round trip is about 20 bps, so the net is a couple of basis points and the doubled-cost stress is negative. Not a Revolut mechanism.

**Deribit carry does not clear a spot round trip, and the account is not funded there.** BTC-PERPETUAL funding value for 2026-09-24 was 0.945 bps, about 3.4 % a year. One taker fee is 9 bps.

**A stale bulk ticker is not a 45 bp XRP premium.** An all-symbol `bookTicker` from the Binance mirror sat ~45 bps under Revolut XRP. The next single-symbol reads did not: Binance 1.5520/1.5521, Coinbase 1.5516/1.5518, Kraken 1.55163/1.55180, Revolut mid 1.5544, gap −4.18 bps. The bulk dump is not an input to the screen.

## What was not tested, and why

No pre-registered P&L was run, because nothing above survived to one. Order-book history does not exist, so a queue strategy stays untestable, as in §3.28. Families already priced (trend, momentum, rotation, maker-only rulebooks, GBP stable quotes, inside-spread quotes, 50 bp Binance anchors, gold weekends, listing premia) were not given a new threshold after looking at this sample.

## Later passes, still nothing

The same bar, on mechanisms the first screen had not measured. `docs/agents/scripts/fp5/screen_pass2.py` reads the extra frozen inputs in `pass2/` and exits if a kill stops holding. `reached_preregistration` is still false. A print markout below can kill a rule. It is not a pass: the fill is the print's own price, which a follower does not get.

**July's GBP coin books move with each other.** BTC, ETH, XRP and SOL implied-rate deviations from their own trailing 24-hour median have correlations 0.92–0.94. The cross-book residual (each coin minus BTC) has a 95th percentile of 16–19 bps, inside one taker round trip, so there is no second leg to arb. SUI's residual 95th percentile is 37.6 bps and its correlation is 0.75. That is above one round trip and under a doubled cost, on the same hourly closes pass 1 already refused to treat as trades.

**No hour of the July clock is Revolut's.** Across all 24 hours the largest |t| is 15:00 UTC on every coin checked, t = 2.06–2.41, and the mean matches Binance within 2 bps.

**A coin/BTC ratio that is 40 bps off its own 24-hour median comes back 0.8–5.6 bps over the next hour** (ETH, SOL, XRP, LTC, SUI, PEPE; hundreds of hours each). Two legs cost about 36 bps. Fading it does not pay, and the residual is not a continuation either.

**Long the hour's worst of six coins and short the best returns +5.3 bps on average** over the next hour (July; BTC, ETH, SOL, XRP, LTC, SUI). Under one round trip.

**Daily closes have nothing a round trip can take.** Lag-1 autocorrelation is between −0.06 and +0.05. After a day that moved 300 bps or more, BTC's next day continues by a median 43.6 bps, but that is 55 days and the other coins do not agree (XRP's median goes the other way, −43 bps). A day with twice its own 20-day median volume does not continue: the medians are −28 to +25 bps. Five-day ratio momentum, non-overlapping, misses a two-leg cost of 36 bps on the median for every coin; XRP's mean is +51 bps and its median is +14. A quiet 10-day range is followed by a smaller move, not a breakout (BTC's next-day absolute move is 24 bps under the typical day). On the days both venues have, SOL's weekend mean is +15.8 bps on Revolut X and +12.9 on Binance, and the weekdays are larger on both (+27 and +28). Not a weekend premium, and not a Revolut one.

**Large UK prints do not pay a follower 30 minutes later.** Screen window 2026-09-11 through 2026-09-14, notional at least $5,000, BTC, ETH and XRP, the next print at least 30 minutes on: 1,479 markouts, median +0.69 bps in the taker's direction, mean +23.0. The mean is ETH's right tail (ETH mean +37.2, median −2.6). Doubled costs are about 40 bps, so the tail does not survive the stress either, and it is one book. The rule was one size and one horizon, written down before these numbers.

**A GBP print does not lead the USD book, and BTC does not lead ETH.** Screen window 2026-09-18 through 2026-09-21, written down before the pull was read. A GBP taker of at least 2,000 in the quote currency, then the USD book's print from one to five minutes later, held five minutes: 3,572 markouts, mean +0.89 bps, median +0.23. The same shape with a USD print as the signal is −0.68. The difference is 1.6 bps. BTC and ETH leading each other, measured on that same week after the GBP rule had already died, is median −3.0 bps on 1,024 pairs. That second cut was not pre-registered and could not have been a pass; the number kills it, so it was not taken to a fresh week.

**The six filled maker probes are not an edge.** Three of them have a 15-minute follow-up. Adverse to the fill: 35.2, 29.9 and 26.1 bps, all above the 10–20 bp break-even for resting instead of taking. Three probes is not a test, and it does not point at resting.

**One look at the book.** After 00:47 UTC the same morning, BTC's bid and ask notional within 10 bps of the mid differ by 0.12 %. No level in the eight books pulled showed more than 4 orders. SUI's spread was 24 bps, so nothing sat inside 10 bps. There is still no history of the queue.

**The venue index, on the 00:20 ticker.** Of 76 books with more than $50k of 24-hour quote volume, one has a mid-to-index gap wider than its own half-spread plus the 9 bp taker: SUI/USD, which is the basis pass 1 already measured.

UK tax-year and month-end calendars were not priced. Three Aprils, or thirty-six month-ends, cannot reach a 60-trip bar, so there was no P&L to compute.

## Continuation: new families, still nothing

Rules under `docs/agents/scripts/fp5/` were hashed before their own results. Numbers are in `backtests/fp5/summary_pass3.json`. A candle screen can kill a rule. It cannot pass one. `reached_preregistration` is still false.

Directional screens, each killed by its own bar: Friday pinning toward a round number (2023–24, pooled −1,241 bps). The next UTC day after a positive S&P session (2024, −578 bps; BTC negative). A one-hour long 100 bps under the running VWAP (2024, median gross about +11 bps, pooled −34,000). Binance's global long/short account ratio in its trailing bottom quintile (2022–23, pooled +4,159 bps and above the null, but January 2023 is 60% of it). Stablecoin-supply expansion (2020–21, 10 entries, because supply almost always rises). CME Bitcoin gap-downs (2018–20, 162 bars, pooled −3,192 bps). Extreme fear on the published fear-and-greed index (2018–19, pooled +4,841 bps and above the null, one month is 52%). Hash rate below its 30-day median (2025, pooled −4,443 bps). A stronger pound leading the next day (2025, pooled −1,723 bps). On-chain transaction count above its 30-day median (2020, pooled +6,822 bps, stress positive, month share 0.35, and still under the random-day null's p95 of +11,134).

Same-venue structure. PAXG-USD and XAUT-USD differ by a median 16 bps in June–August 2026 (95th percentile 39). Buying the cheaper one when the gap is at least 40 bps, on March–May, is 16 trips, all in May, pooled −276 bps. A half-spread through-fill bid was then tested on prints, not candles: 38 bps behind the last print, maker exit 38 bps higher within 30 minutes, otherwise a taker stop. Window 2026-07-23 through 2026-09-23 excluding the one VVV day (2026-09-21) that had already been used as a count screen. VVV-USD: 253 trips, −1,673 bps, stress −3,950. STRK-USD: 103 trips, +1,413 bps, stress +486. The pair was pre-registered together, so STRK is not split out. Pooled −130 bps, stress −1,732. NEON the day before had 8 through-fills (the screen required 30) even though those 8 marked out +226 bps; the count gate stands.

No testing row. PR5, `trend-4h` and `pmrw.ts` were not edited.

## Continuation: exchange flow and MVRV, still nothing

`flow_rule.txt` (sha256 `19bd6e9c…`) and `mvrv_rule.txt` (sha256 `30e507a7…`) were hashed before their own results. Numbers are in `backtests/fp5/summary_pass4.json`. `reached_preregistration` is still false.

Bitcoin's exchange dollar outflow minus inflow, above the 80th percentile of 2021-10-03 through 2021-12-31, long BTC and ETH the next day in 2022 only: 60 long days, 82 trips, pooled −8,219 bps, stress −9,859, null p95 +653. June is −3,553 and November −2,101. A loss kills the family. The sign is not flipped to inflow, and 2023 is not added.

Bitcoin MVRV below its own trailing 30-day median, long the next day in 2017 only, on CoinMetrics reference rates: pooled +6,217 bps, stress +5,617, both books positive, and 136 long days that are only 30 trips. March 2017 is 46% of the pool. The random-day null's p95 is +21,073, so the gain is the year, not the ratio. The sign is not flipped, and the year is not moved.

## Continuation: funding decile and taker ratio, still nothing

`funding_rule.txt` (sha256 `3c2eb810…`) and `taker_rule.txt` (sha256 `362c9216…`) were hashed before their own results. Numbers are in `backtests/fp5/summary_pass5.json`. `screen_pass5.py` checks those hashes and exits if a fresh run disagrees with the summary. `reached_preregistration` is still false.

BTCUSDT perpetual funding, the day's three prints summed, strictly below the 9th of the previous 90 daily sums, long BTC and ETH the next day in 2021 only: 34 long days, 14 trips, pooled +6,208.7 bps, stress +5,648.7, both books positive, July is 35% of the pool, null p95 +4,649. The trip bar is 60. Thirty-four long days cannot make 60 entries. A loss is not what killed it; the count did. The sign is not flipped to high funding, the decile is not moved, and 2022 is not added.

BTCUSDT perpetual taker buy/sell volume ratio, the last print of the UTC day, strictly below the 18th of the previous 90 days, long the next day in 2024 only: 71 long days, 53 trips, pooled −2,389.6 bps, stress −4,509.6, both books negative, null p95 +3,104.5. The sign is not flipped, the quintile is not moved, and 2025 is not added.

The cost check is closed-form. On both rules the gap between the 20 bp charge and the doubled charge is 40 bps times the trip count (an entry and an exit). An independent sum of the long days' closes matches the funding pool to the tenth of a basis point. The first funding entry, 2021-03-26, is a signal of 0.00031828 against a threshold of 0.00033506, and that day's BTC close over the previous close is 727.54 bps by hand.

## Continuation: VIX and ETF creations, still nothing

`vix_rule.txt` (sha256 `f2a128d9…`) and `etf_rule.txt` (sha256 `097ba003…`) were hashed before their own results. Numbers are in `backtests/fp5/summary_pass6.json`. `screen_pass6.py` checks those hashes and exits if a fresh run disagrees with the summary. `reached_preregistration` is still false. Funding and the taker ratio stay killed; neither sign was reopened.

The VIX close strictly above the 202nd of the previous 252 sessions, long BTC and ETH the next UTC day in 2019 and 2020 only: 88 long days, 17 trips, pooled +2,395.9 bps, stress +1,715.9, both books positive. April 2020 is +3,343.9, larger than the pool. The random-day null's p95 is +5,684.6. The trip bar is 60. The sign is not flipped to a low VIX, the percentile is not moved, 2021 is not added, and April is not dropped.

US spot-bitcoin ETF net creation, the Farside Total column, strictly above the median of the previous 20 sessions, long the next UTC day in 2025 only: 118 long days, 47 trips, pooled +595.3 bps, stress −1,284.7. BTC is −2,089.9 and ETH is +3,280.6. May is +1,593.0, 2.7 times the pool. The null's p95 is +1,773.2. The sign is not flipped to net outflow, the window is not moved, and 2024 and 2026 are not added.

The same cost check holds: the gap between the two charges is 40 bps times the trip count on both rules. An independent sum matches the VIX pool to the tenth of a basis point. The first VIX entry, 2019-01-01, is a 2018-12-31 close of 25.42 against a threshold of 20.47, and that day's BTC close over the previous close is 254.50 bps by hand. Binance's 2025 daily files are timestamped in microseconds; 2018–2020 stay in milliseconds. The loader divides on that, and `1735689600000000` is 2025-01-01.

## Continuation: UTC Monday and open interest, still nothing

`monday_rule.txt` (sha256 `9f15628a…`) and `oi_rule.txt` (sha256 `0d14552a…`) were hashed at 2026-09-25 01:57:12 UTC, before their own results. Numbers are in `backtests/fp5/summary_pass7.json`. `screen_pass7.py` checks those hashes and exits if a fresh run disagrees with the summary. `reached_preregistration` is still false. VIX and the ETF net-creation rule stay killed; neither sign was reopened.

Long the UTC Monday and flat every other day, 2022 and 2023 only: 104 long days, 104 trips, 730 execution days, pooled −4,198.7 bps, stress −8,358.7. BTC is −3,312.9 and ETH is −5,084.6. The random-day null's p95 is +1,476.0. The weekday is not switched, 2024 is not added, and no month is dropped.

BTC perpetual dollar open interest (`sum_open_interest_value`, last row of the UTC day) whose day-over-day change is strictly below the 18th of the previous 90 printed changes, long the next day in 2021 only: 72 long days, 63 trips, 365 execution days, pooled +9,185.8 bps, stress +6,665.8. BTC is +8,878.3 and ETH is +9,493.3. February 2021 is +2,277.5, 24.8% of the pool. The null's p95 is +6,658.1. Every numeric gate in the frozen rule clears. That is not a pass: the fills are daily closes, not prints through a price. The sign is not flipped to rising open interest, the quintile is not moved, and 2022 is not added. The public metrics archive starts 2020-09-01; the first long day is 2021-01-05, so January is in the screen.

The same cost check holds: the gap is 4,160 bps on the Monday rule (40 × 104) and 2,520 bps on the open-interest rule (40 × 63). An independent sum of the long days' closes matches both pools to the tenth of a basis point. The first Monday, 2022-01-03, takes BTC from 47,286.18 to 46,446.10, −177.66 bps by hand. The first open-interest entry, 2021-01-05, is a 2021-01-04 change of −12.85% against a threshold of −3.60%, and that day's BTC close goes from 31,988.71 to 33,949.53, +612.97 bps by hand.

## Continuation: average trade size and bid depth, still nothing

`trade_rule.txt` (sha256 `acbb5417…`) and `depth_rule.txt` (sha256 `fa1a63d3…`) were hashed at 2026-09-25 02:06:04 UTC, before their own results. Numbers are in `backtests/fp5/summary_pass8.json`. `screen_pass8.py` checks those hashes and exits if a fresh run disagrees with the summary. `reached_preregistration` is still false. Monday and the open-interest drop stay killed, including the open-interest rule whose candle arithmetic cleared. That rule is not promoted. Neither sign was reopened.

BTC spot average trade size, quote volume divided by the number of trades, strictly above the 72nd of the previous 90 days, long the next UTC day in 2023 only: 107 long days, 35 trips, 365 execution days, pooled +3,780.6 bps, stress +2,380.6. BTC is +4,372.9 and ETH is +3,188.3. March 2023 is +1,426.8, 37.7% of the pool. The null's p95 is +3,021.3. The trip bar is 60. The sign is not flipped to a small average trade, the quintile is not moved, and 2024 is not added.

BTC perpetual book depth, the last snapshot of the UTC day, notional at percentage −1 divided by notional at percentage +1, strictly above the 72nd of the previous 90 days, long the next UTC day in 2024 only: 78 long days, 65 trips, 365 execution days, pooled −3,958.1 bps, stress −6,558.1. BTC is −2,491.2 and ETH is −5,425.0. The null's p95 is +3,054.2. The public archive has no file for 2024-04-18, so 2024-04-19 is not an execution day. The sign is not flipped to an offer-heavy book, the band is not moved, and 2025 is not added.

The same cost check holds: the gap is 1,400 bps on the trade-size rule (40 × 35) and 2,600 bps on the depth rule (40 × 65). An independent sum of the long days' closes matches both pools to the tenth of a basis point. The first trade-size entry, 2023-01-13, is a 2023-01-12 size of 936.83 against a threshold of 873.92 (quote 8,348,431,207.85 over 8,911,373 trades), and that day's BTC close goes from 18,846.62 to 19,930.01, +574.85 bps by hand. The first depth entry, 2024-01-01, is a 2023-12-31 23:59:31 snapshot of bid 95,665,835.00 over ask 70,660,135.48, ratio 1.35389 against a threshold of 1.30808, and that day's BTC close goes from 42,283.58 to 44,179.55, +448.39 bps by hand. A fresh download of that one zip matches the stored snapshot.

## Continuation: spot-versus-perp volume and BTC–ETH disagreement, still nothing

`mix_rule.txt` (sha256 `da6fdaa3…`) and `split_rule.txt` (sha256 `821f5cdb…`) were hashed at 2026-09-25 02:11:12 UTC, before their own results. Numbers are in `backtests/fp5/summary_pass9.json`. `screen_pass9.py` checks those hashes and exits if a fresh run disagrees with the summary. `reached_preregistration` is still false. Average trade size and bid depth stay killed. Neither sign was reopened.

BTC spot quote volume divided by USD-M perpetual quote volume, the day-over-day change strictly above the 72nd of the previous 90 changes, long the next UTC day in 2021 only: 71 long days, 64 trips, 365 execution days, pooled −619.2 bps, stress −3,179.2. BTC is −1,933.8 and ETH is +695.3. The null's p95 is +6,350.3. The futures daily archive starts 2020-01, so 2021 is the screen. The sign is not flipped to a falling spot share, the quintile is not moved, and 2022 is not added.

The absolute difference of the BTC and ETH close-to-close returns, strictly above the 72nd of the previous 90 differences, long the next UTC day in 2022 only: 72 long days, 51 trips, 365 execution days, pooled −3,719.4 bps, stress −5,759.4. BTC is −3,788.1 and ETH is −3,650.7. The null's p95 is +721.5. The sign is not flipped to a small disagreement, the difference is not replaced with BTC's own absolute return, and 2023 is not added.

The same cost check holds: the gap is 2,560 bps on the volume-mix rule (40 × 64) and 2,040 bps on the disagreement rule (40 × 51). An independent sum of the long days' closes matches both pools to the tenth of a basis point. The first volume-mix entry, 2021-01-05, is a 2021-01-04 change of +12.66% against a threshold of +7.67% (spot quote 4,429,010,349.70 over perpetual quote 15,879,195,836.25, against the previous day's 4,057,598,425.49 over 16,389,111,411.53), and that day's BTC close goes from 31,988.71 to 33,949.53, +612.97 bps by hand. The first disagreement entry, 2022-01-07, is a 2022-01-06 gap of 293.1 bps against a threshold of 248.4 bps (BTC 43,451.13 to 43,082.31, ETH 3,540.63 to 3,406.81), and that day's BTC close goes from 43,082.31 to 41,566.48, −351.85 bps by hand.

## Continuation: address-count jumps and lower wicks, still nothing

`addr_rule.txt` (sha256 `60dfc936…`) and `wick_rule.txt` (sha256 `f49c0b9d…`) were hashed at 2026-09-25 02:15:40 UTC, before their own results. Numbers are in `backtests/fp5/summary_pass10.json`. `screen_pass10.py` checks those hashes and exits if a fresh run disagrees with the summary. `reached_preregistration` is still false. The spot-versus-perp volume jump and the BTC–ETH return gap stay killed. Neither sign was reopened.

CoinMetrics `AdrBalCnt`, the day-over-day change strictly above the 72nd of the previous 90 changes, long the next UTC day in 2019 only: 95 long days, 57 trips, 365 execution days, pooled +39.6 bps, stress −2,240.4. BTC is +886.1 and ETH is −806.9. May 2019 is +1,199.8, 30.3 times the pool. The null's p95 is +3,763.9. The sign is not flipped to a shrinking address count, the quintile is not moved, and 2020 is not added.

The BTC spot lower wick divided by the day's high-low range, strictly above the 72nd of the previous 90 shares, long the next UTC day in 2018 only: 73 long days, 64 trips, 365 execution days, pooled −4,396.3 bps, stress −6,956.3. BTC is −4,905.3 and ETH is −3,887.2. The null's p95 is +1,763.4. The sign is not flipped to a short wick, the upper wick is not substituted, and 2019 is not added.

The same cost check holds: the gap is 2,280 bps on the address rule (40 × 57) and 2,560 bps on the wick rule (40 × 64). An independent sum of the long days' closes matches both pools to the tenth of a basis point. The first address entry, 2019-01-06, is a 2019-01-05 count of 22,226,186 against the previous day's 22,210,380, a change of 0.07116% against a threshold of 0.07108%, and that day's BTC close goes from 3,770.96 to 3,987.60, +574.50 bps by hand. The first wick entry, 2018-01-02, is a 2018-01-01 candle of 13,715.65 / 13,818.55 / 12,750.00 / 13,380.00, wick share 0.5896 against a threshold of 0.4992, and that day's BTC close goes from 13,380.00 to 14,675.11, +967.94 bps by hand.

## Continuation: USDC richening and the coin-margined basis, still nothing

`usdc_rule.txt` (sha256 `7ba2d139…`) and `basis_rule.txt` (sha256 `d9e87983…`) were hashed at 2026-09-25 02:18:58 UTC, before their own results. Numbers are in `backtests/fp5/summary_pass11.json`. `screen_pass11.py` checks those hashes and exits if a fresh run disagrees with the summary. `reached_preregistration` is still false. Address count and the lower wick stay killed. Neither sign was reopened.

The USDCUSDT close, its day-over-day change strictly above the 72nd of the previous 90 changes, long the next UTC day in 2020 only: 66 long days, 59 trips, 366 execution days, pooled +1,264.2 bps, stress −1,095.8. BTC is −839.9 and ETH is +3,368.2. June 2020 is +1,416.7, 1.12 times the pool. The null's p95 is +6,136.7. The sign is not flipped to a cheapening USDC, the quintile is not moved, and 2021 is not added.

The coin-margined BTC perpetual close divided by the USDT-margined perpetual close, the day-over-day change strictly above the 72nd of the previous 90 changes, long the next UTC day in 2021 only: 64 long days, 58 trips, 365 execution days, pooled +9,818.3 bps, stress +7,498.3. BTC is +4,786.6 and ETH is +14,850.0. May 2021 is +3,597.8, 36.6% of the pool. The null's p95 is +5,982.1. Every numeric gate except the trip count clears. That is not a pass: 58 trips are short of 60, and the fills are daily closes. The sign is not flipped to a cheapening coin-margined book, the quintile is not moved, and 2022 is not added. The COIN-M archive starts 2020-08, so 2021 is the screen.

The same cost check holds: the gap is 2,360 bps on the USDC rule (40 × 59) and 2,320 bps on the basis rule (40 × 58). An independent sum of the long days' closes matches both pools to the tenth of a basis point. The first USDC entry, 2020-01-09, is a 2020-01-08 close of 0.9991 to 1.001, a change of +0.1902% against a threshold of +0.0801%, and that day's BTC close goes from 8,055.98 to 7,817.76, −295.71 bps by hand. The first basis entry, 2021-01-02, is a 2021-01-01 coin-margined close of 29,388.9 against a linear close of 29,337.16, up from the previous day's 28,950.4 against 28,951.68, a change of +0.1808% against a threshold of +0.0343%, and that day's BTC close goes from 29,331.69 to 32,178.33, +970.50 bps by hand.

## Continuation: DVOL jumps and Treasury yield jumps, still nothing

`dvol_rule.txt` (sha256 `c82440b6…`) and `yield_rule.txt` (sha256 `48f9ff10…`) were hashed at 2026-09-25 02:26:44 UTC, before their own results. Numbers are in `backtests/fp5/summary_pass12.json`. `screen_pass12.py` checks those hashes and exits if a fresh run disagrees with the summary. `reached_preregistration` is still false. The USDC premium and the coin-margined versus USDT premium stay killed. Neither year was extended to manufacture the two missing trips. Neither sign was reopened.

Deribit BTC DVOL, its day-over-day close change strictly above the 72nd of the previous 90 changes, long the next UTC day in 2022 only: 81 long days, 66 trips, 365 execution days, pooled −3,573.6 bps, stress −6,213.6. BTC is −3,735.7 and ETH is −3,411.5. The null's p95 is +375.5. The archive's first daily bar is 2021-03-24, so 2022 is the screen. The sign is not flipped to a falling DVOL, the quintile is not moved, and 2023 is not added.

The US 10-year yield (FRED DGS10), its day-over-day change strictly above the 72nd of the previous 90 changes, long the next UTC day in 2018 only: 36 long days, 31 trips, 192 execution days, pooled −2,080.6 bps, stress −3,320.6. BTC is −1,103.1 and ETH is −3,058.1. The null's p95 is +3,222.6. A change exists only against the previous calendar day, so a Monday print is never a signal and the screen is the 192 crypto days whose previous day had one. That is the frozen rule. The sign is not flipped to a falling yield, the quintile is not moved, the missing day is not filled from the previous session, and 2019 is not added. 2018 is the screen because Binance spot for both books starts in 2017-08.

The same cost check holds: the gap is 2,640 bps on the DVOL rule (40 × 66) and 1,240 bps on the yield rule (40 × 31). An independent sum of the long days' closes matches both pools to the tenth of a basis point. The first DVOL entry, 2022-01-06, is a 2022-01-05 close of 75.64 against the previous day's 72.52, a change of +4.3023% against a threshold of +2.2705%, and that day's BTC close goes from 43,451.13 to 43,082.31, −84.88 bps by hand. The first yield entry, 2018-01-10, is a 2018-01-09 yield of 2.55 against the previous day's 2.49, a change of +2.4096% against a threshold of +1.3274%, and that day's BTC close goes from 14,400.00 to 14,907.09, +352.15 bps by hand.

## Reproduce

From the repository root: `python3 docs/agents/scripts/fp5/screen.py --check` and `python3 docs/agents/scripts/fp5/screen_pass2.py --check`. Input hashes are the `inputs_sha256` objects in `docs/agents/backtests/fp5/summary.json` and `docs/agents/backtests/fp5/summary_pass2.json`. The continuation's frozen rule texts are the `*_rule.txt` files beside those screens; `summary_pass3.json` through `summary_pass6.json` are the records of what they returned. `python3 docs/agents/scripts/fp5/screen_pass5.py --check` rebuilds pass 5 from `backtests/inputs/fp5_2026-09-25/pass5/`. `python3 docs/agents/scripts/fp5/screen_pass6.py --check` rebuilds pass 6 from `pass6/`. `python3 docs/agents/scripts/fp5/screen_pass7.py --check` rebuilds pass 7 from `pass7/`. `python3 docs/agents/scripts/fp5/screen_pass8.py --check` rebuilds pass 8 from `pass8/`. The book-depth input there is the last ±1 snapshot of each UTC day, not the raw zip. `python3 docs/agents/scripts/fp5/screen_pass9.py --check` rebuilds pass 9 from `pass9/`. `python3 docs/agents/scripts/fp5/screen_pass10.py --check` rebuilds pass 10 from `pass10/`. `python3 docs/agents/scripts/fp5/screen_pass11.py --check` rebuilds pass 11 from `pass11/`. `python3 docs/agents/scripts/fp5/screen_pass12.py --check` rebuilds pass 12 from `pass12/`. The DVOL input there is the daily close, not the raw candles.
