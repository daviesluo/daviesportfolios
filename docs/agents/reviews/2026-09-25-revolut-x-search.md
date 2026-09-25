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

## Reproduce

From the repository root: `python3 docs/agents/scripts/fp5/screen.py --check` and `python3 docs/agents/scripts/fp5/screen_pass2.py --check`. Input hashes are the `inputs_sha256` objects in `docs/agents/backtests/fp5/summary.json` and `docs/agents/backtests/fp5/summary_pass2.json`. The continuation's frozen rule texts are the `*_rule.txt` files beside those screens; `summary_pass3.json` and `summary_pass4.json` are the records of what they returned.
