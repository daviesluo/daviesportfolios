# IG strategy search, round 3 (2026-10-18)

Davies, 2026-10-18: "再继续深度研究下ig的策略，可以更激进一些也可以，只要策略够好".

**Headline.** Nothing new is worth real money. I ran 50 arms: intraday index rules that are flat by the cash close
(so they pay no overnight admin fee), event days (FOMC, CPI, payrolls, EIA crude), and FXW's Sunday-open rule on ten more
pairs and on earlier years. **None meets the frozen bar**, which needs test-era t ≥ 2.5 with a bootstrap lower bound
above zero, plus train-era t ≥ 2.0.

- **Intraday index rules.** IG's spread plus a 1 bp slippage allowance costs 1.6-3.6 bps a trade. Every intraday rule
  that trades daily (momentum, last half hour, breakout, gap fade) grosses −2.7 to +2.8 bps a trade over 2018-2026, so
  all of them are flat or negative after that cost.
- **Intraday momentum.** The published effect (Gao et al.; Baltussen et al.) is not there in 2010-2026 CFD prices. If
  anything the last half hour reverses slightly, and on both feeds.
- **The one rule that works is FXW, and it is a post-2016 effect.**
  - AUD/USD: +23.6 bps a trade 2019-2026 (t 5.34). It is **flat on 2013-2015, the years FXW-AUD's discovery never
    saw**: +0.6 bps, t 0.07, n 43 on FXCM; +7.1, t 1.19, n 52 on HistData for 2012-2015.
  - AUD/NZD and NZD/USD show the same shape: strong from 2016, nothing before.
  - EUR/JPY is the one pair positive in both eras and on both feeds (2013-2026 +16.1 bps, t 3.2), but its 2019-2026
    t is 1.58, so it fails the bar.

**Recommendation.** Fund nothing new. Keep FXW-AUD on its existing path (S1b's recorded Sundays, then demo). If it
then goes live, the sizing in §5 says a **GBP 1,000 spread-bet account at about GBP 1.50 a pip**:
- 10 times leverage; margin GBP 500;
- about GBP 150 a year (median; 5th percentile GBP 74);
- worst closed trade about GBP 130; worst mark-to-market about GBP 450, with no stop.

Treat those GBP figures as an upper end: they come from the 2016-2026 trades, and 2013-2015 earned nothing. Add
NZD/USD, AUD/NZD and EUR/JPY to the weekend recorder as a demo forward test (no money) if Davies wants more FX
coverage. That needs the `epics.ts` roles and one `facts` call per account.

Everything was frozen before any data was pulled: `backtests/ig_search3/params/frozen.json`, commit `ad689de3`,
committed 03:35 UTC (the file's own stamp says 03:40, written ahead). Its four deviations were each written before the
result they touch, except deviation 4's two added readings, which say so. Nothing was tuned on a test era.

## 1. Sources

`scripts/pull.py` read everything keyless. Each answer's sha256 is in `inputs/pull_log_*.json`. The raw files are not
committed; the derived tables are.

| source | what | span | notes |
|---|---|---|---|
| HistData.com 1-minute bars (bid) | US 500 (SPXUSD), US Tech 100 (NSXUSD), Germany 40 (GRXEUR), UK 100 (UKXGBP), WTI | 2010-11 → 2026-09 | **stamps are New York time, not the fixed EST its FAQ states** (deviation 2: summer last-half-hour vs SPY correlates 0.998 read as New York time, 0.05 as EST). WTI has no file for 2024, 2025 or 2026-01..05. 118 of 125 index files served |
| HistData.com 1-minute bars (bid) | 14 FX pairs | 2012 → 2026-09 | 322 of 322 served; second source for FXW |
| FXCM weekly 1-minute bid/ask | the same 14 pairs | 2012 → 2026-09 | 10,532 of 11,130 served; the misses are week-53 slots, 2026 weeks not yet published, and one truncated file. **FXCM's 2012 weeks open at Friday's close (every gap exactly 0)**, so they give no trade. A reimplementation of STATARB-2's weekend table matches the committed AUD/USD table on all 539 common weekends, field for field |
| Yahoo 1-hour bars | SPY, QQQ, DIA, ^GDAXI, ^FTSE, CL=F (and ES=F, NQ=F, YM=F) | 2023-11 → 2026-10-16 | second source for the index arms; the only source for Wall St |
| bls.gov release calendars | Employment Situation, CPI | 2010-2026 | 203 dates each (2025: 11, the shutdown). On those days the 08:30-09:30 ET move is twice the other days' (US 500 median 19.8 vs 9.5 bps), which checks both the dates and the clock |
| federalreserve.gov | scheduled FOMC days | round 2's `fomc_dates.json` | |
| the IG recorder | ig_quotes, ig_quote_runs (read-only SQL) | Fri 10-16 → Sun 10-18 04:05 UTC | §4 |

Clock check (deviation 3). For each year and season, the cash-open volatility step must exceed the same step an hour
either side. The year-seasons that fail are dropped from that market's arms:
- US 500: 4;
- Germany 40: 5;
- UK 100: 12 (2010-2014 has no pre-open bars at all);
- WTI: 4;
- US Tech 100: none.

All are listed in `results/search.json` (`checks`).

**Sample size.** With N test trades of standard deviation s, the bar can find a mean of 2.5·s/√N and no smaller:
- an intraday index arm (N ≈ 1,900, s ≈ 25-30 bps) can find about 1.5-2 bps;
- an event-day arm (N ≈ 54-184, s ≈ 50-100 bps) needs 12-25 bps;
- an FX pair (N 20-77) needs 10-25 bps.

Wall St has only Yahoo's three years, so it could reach "demo" at most.

## 2. The ranked table

All figures are net of IG's costs at the frozen levels:
- **Costs:** spreads in points turned into bps at present-day levels, plus 0.5 bps slippage a side, plus 1 bp on a stop
  exit. IG's actual levels on 10-16 were 6-22 % higher than the frozen ones, so these costs are slightly high.
- **Term 9(12):** automated spread bets need IG's consent.
- **Columns:** "second source" is HistData for FX and Yahoo for the indices.
- **GBP columns:** at IG's minimum stake. Capital = the minimum stake's margin plus the worst test-era trade.

| arm | trades/yr | net bps/trade (test) | t (test) | bootstrap 95 % | train net bps | test n | second source | GBP/yr at min stake | worst trade GBP | capital GBP | Term 9(12) | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FXW AUDUSD | 8 | +23.56 | 5.34 | [+14.6, +31.9] | +5.01 (t 0.82, n 67) | 61 | met (B +15.2, t 4.81, n 147) | +61 | -34 | 199 | hand (Sunday open) or software on CFD | demo-forward level |
| FXW AUDNZD | 3 | +13.25 | 4.77 | [+8.0, +18.6] | +2.85 (t 0.76, n 44) | 25 | met (B +9.2, t 3.94, n 105) | +24 | -13 | 298 | hand (Sunday open) or software on CFD | demo-forward level |
| FXW NZDUSD | 8 | +14.49 | 2.89 | [+4.2, +24.1] | +0.86 (t 0.15, n 74) | 61 | met (B +4.1, t 1.23, n 193) | +33 | -36 | 181 | hand (Sunday open) or software on CFD | demo-forward level |
| TOM_ID USTECH | 44 | +12.67 | 2.05 | [+0.4, +24.7] | -1.76 (t -0.42, n 344) | 382 | met (B +16.7, t 1.94, n 130) | +1323 | -889 | 2089 | hand (clock) | dead |
| FXW EURJPY | 5 | +12.16 | 1.58 | [-2.5, +27.1] | +18.58 (t 2.8, n 65) | 41 | met (B +16.2, t 4.12, n 144) | +56 | -100 | 390 | hand (Sunday open) or software on CFD | dead |
| TOM_ID US500 | 44 | +7.05 | 1.49 | [-2.3, +16.3] | -4.56 (t -1.05, n 267) | 382 | met (B +11.9, t 1.95, n 130) | +205 | -235 | 570 | hand (clock) | dead |
| FXW AUDJPY | 10 | +9.14 | 1.28 | [-5.4, +22.8] | -1.25 (t -0.16, n 97) | 77 | met (B +6.6, t 1.42, n 201) | +45 | -110 | 358 | hand (Sunday open) or software on CFD | dead |
| FXW EURUSD | 5 | +8.22 | 1.16 | [-6.0, +21.9] | +14.03 (t 2.37, n 39) | 36 | met (B +12.2, t 2.84, n 84) | +22 | -54 | 247 | hand (Sunday open) or software on CFD | dead |
| FXW NZDJPY | 9 | +7.41 | 1.01 | [-7.2, +21.3] | +1.73 (t 0.23, n 104) | 70 | met (B +4.5, t 1.38, n 260) | +29 | -108 | 325 | hand (Sunday open) or software on CFD | dead |
| FXW EURGBP | 4 | +4.35 | 0.98 | [-4.5, +12.7] | -2.99 (t -0.39, n 49) | 35 | met (B -0.9, t -0.23, n 107) | +9 | -25 | 169 | hand (Sunday open) or software on CFD | dead |
| FXW GBPJPY | 8 | +5.32 | 0.85 | [-6.9, +16.8] | +1.41 (t 0.24, n 80) | 64 | met (B +8.0, t 2.35, n 162) | +44 | -147 | 482 | hand (Sunday open) or software on CFD | dead |
| FXW EURAUD | 6 | +4.35 | 0.75 | [-7.4, +15.3] | +8.73 (t 1.7, n 63) | 46 | met (B +4.3, t 1.19, n 127) | +23 | -107 | 547 | hand (Sunday open) or software on CFD | dead |
| FXW USDCAD | 3 | +9.13 | 0.75 | [-14.9, +32.1] | +3.23 (t 0.47, n 27) | 20 | met (B +6.6, t 1.13, n 51) | +16 | -79 | 309 | hand (Sunday open) or software on CFD | dead |
| FOMC_PRE USTECH | 6 | +3.53 | 0.56 | [-8.8, +15.7] | -13.63 (t -2.57, n 57) | 54 | not met (B -10.4, t -1.33, n 23) | +52 | -237 | 1437 | hand (clock) | dead |
| ORB30 USTECH | 219 | +0.79 | 0.42 | [-2.8, +4.5] | -3.53 (t -2.5, n 1741) | 1922 | none | +415 | -626 | 1826 | hand (two stop-entry orders) | dead |
| FOMC_PRE US500 | 6 | +1.14 | 0.26 | [-7.2, +9.8] | -5.13 (t -0.93, n 46) | 54 | not met (B -6.5, t -1.38, n 23) | +5 | -41 | 376 | hand (clock) | dead |
| FXW GBPUSD | 5 | +0.44 | 0.06 | [-15.6, +15.4] | -9.06 (t -1.13, n 42) | 42 | met (B +1.6, t 0.35, n 92) | +2 | -94 | 317 | hand (Sunday open) or software on CFD | dead |
| GAPFADE USTECH | 138 | -0.17 | -0.06 | [-5.6, +5.2] | -4.78 (t -1.79, n 850) | 1216 | met (B -0.6, t -0.15, n 431) | -56 | -930 | 2130 | hand (clock + limit) | dead |
| MACRO_LONG USTECH | 21 | -1.89 | -0.2 | [-20.2, +16.0] | -4.06 (t -0.64, n 167) | 184 | met (B -17.2, t -1.18, n 66) | -95 | -1047 | 2247 | hand (clock) | dead |
| FOMC_POST US500 | 6 | -2.54 | -0.21 | [-24.8, +21.6] | +2.27 (t 0.18, n 46) | 53 | none | -10 | -139 | 474 | hand (screen at 14:05) | dead |
| GAPFADE US500 | 115 | -0.51 | -0.21 | [-5.3, +4.3] | -4.47 (t -1.51, n 622) | 1010 | met (B -0.1, t -0.03, n 346) | -39 | -240 | 575 | hand (clock + limit) | dead |
| FOMC_POST USTECH | 6 | -4.33 | -0.29 | [-32.5, +25.1] | -1.80 (t -0.17, n 57) | 53 | none | -62 | -706 | 1906 | hand (screen at 14:05) | dead |
| ORB30 US500 | 219 | -0.51 | -0.37 | [-3.2, +2.1] | -3.85 (t -2.55, n 1348) | 1928 | none | -75 | -173 | 508 | hand (two stop-entry orders) | dead |
| ORB30 DE40 | 184 | -0.75 | -0.45 | [-4.0, +2.5] | -0.64 (t -0.36, n 1786) | 1617 | none | -166 | -251 | 851 | hand (two stop-entry orders) | dead |
| FXW USDJPY | 6 | -3.78 | -0.46 | [-20.6, +11.4] | -0.57 (t -0.08, n 64) | 45 | met (B -1.1, t -0.21, n 114) | -16 | -139 | 388 | hand (Sunday open) or software on CFD | dead |
| FXW USDCHF | 4 | -3.28 | -0.47 | [-17.7, +9.0] | +3.43 (t 0.57, n 36) | 34 | not met (B +1.1, t 0.32, n 109) | -6 | -56 | 190 | hand (Sunday open) or software on CFD | dead |
| MACRO_LONG US500 | 21 | -4.96 | -0.71 | [-18.9, +8.8] | -0.82 (t -0.13, n 127) | 184 | met (B -19.6, t -1.89, n 66) | -69 | -235 | 570 | hand (clock) | dead |
| LASTHALF DE40 | 183 | -0.46 | -0.88 | [-1.5, +0.6] | -0.84 (t -1.43, n 1780) | 1611 | met (B -1.5, t -2.47, n 722) | -101 | -146 | 746 | hand (clock) | dead |
| TOM_ID UK100 | 39 | -3.93 | -0.93 | [-12.6, +4.3] | -11.78 (t -1.9, n 137) | 341 | met (B -1.0, t -0.13, n 112) | -72 | -211 | 448 | hand (clock) | dead |
| TOM_ID DE40 | 35 | -6.02 | -1.07 | [-17.3, +4.9] | -13.23 (t -2.21, n 344) | 310 | met (B -3.1, t -0.37, n 108) | -255 | -431 | 1031 | hand (clock) | dead |
| LASTHALF USTECH | 219 | -1.03 | -1.4 | [-2.4, +0.4] | -1.05 (t -1.8, n 1760) | 1921 | met (B -3.5, t -3.5, n 719) | -540 | -632 | 1832 | hand (clock) | dead |
| GAPFADE DE40 | 104 | -4.94 | -1.71 | [-10.7, +0.7] | -5.04 (t -1.63, n 898) | 915 | met (B -2.2, t -0.46, n 332) | -617 | -509 | 1109 | hand (clock + limit) | dead |
| GAPFADE UK100 | 97 | -4.75 | -1.87 | [-9.8, +0.2] | -9.00 (t -2.02, n 298) | 851 | sign agrees, feeds differ (B -7.3, t -0.43, n 10) | -218 | -178 | 416 | hand (clock + limit) | dead |
| ORB30 UK100 | 200 | -3.45 | -2.55 | [-6.1, -0.8] | -3.99 (t -2.04, n 734) | 1757 | none | -328 | -157 | 394 | hand (two stop-entry orders) | dead |
| IMOM DE40 | 183 | -1.34 | -2.57 | [-2.4, -0.3] | -2.10 (t -3.58, n 1781) | 1610 | met (B -1.6, t -2.64, n 722) | -295 | -146 | 746 | hand (clock) | dead |
| LASTHALF US500 | 218 | -1.66 | -2.57 | [-2.9, -0.4] | -0.43 (t -0.62, n 1344) | 1918 | met (B -3.7, t -4.65, n 720) | -243 | -163 | 498 | hand (clock) | dead |
| DOW UK100 | 37 | -11.95 | -3.07 | [-19.7, -4.4] | +8.45 (t 1.5, n 133) | 328 | sign agrees, feeds differ (B -9.2, t -1.54, n 134) | -212 | -173 | 410 | hand (clock) | dead |
| IMOM USTECH | 218 | -2.62 | -3.57 | [-4.1, -1.2] | -1.05 (t -1.81, n 1756) | 1920 | met (B -2.1, t -2.11, n 720) | -1374 | -632 | 1832 | hand (clock) | dead |
| IMOM US500 | 218 | -3.33 | -5.15 | [-4.6, -2.0] | -1.40 (t -1.99, n 1339) | 1918 | met (B -2.3, t -2.83, n 720) | -487 | -163 | 498 | hand (clock) | dead |
| LASTHALF UK100 | 200 | -2.64 | -5.95 | [-3.5, -1.8] | -2.36 (t -3.19, n 739) | 1759 | met (B -3.5, t -6.49, n 719) | -251 | -66 | 303 | hand (clock) | dead |
| IMOM UK100 | 200 | -2.94 | -6.63 | [-3.8, -2.1] | -3.94 (t -5.33, n 738) | 1760 | met (B -3.9, t -7.36, n 719) | -280 | -66 | 303 | hand (clock) | dead |

Not in the table: four arms had no test trades, and three Wall St arms ran on one short source.
- **DOW:** no weekday reached train t ≥ 2 on US 500, US Tech 100 or Germany 40. UK 100 picked short-Monday, which lost
  in the test era.
- **MACRO_MOM:** train t 0.39 and 0.46, so no sign was chosen.
- **EIA:** following the first five minutes had train t −1.04, so neither follow (t ≥ 2) nor fade (t ≤ −2) was
  chosen.
- **Wall St:** on Yahoo DIA alone (2023-11 → 2026-10), IMOM −2.57 bps (t −3.77), LASTHALF −2.20 (t −3.21), GAPFADE
  +0.26 (t 0.07).
- **Inclusive close:** charged the in-hours spread at the cash close (`results/search_inclusive_close.json`), nets rise
  by 0.1-1.6 bps and no verdict changes.

## 3. Reading each family

- **Intraday momentum and the last half hour (IMOM, LASTHALF).** The test-era gross is −1.6 to +1.8 bps a trade, and
  Yahoo agrees on the same days (correlation 0.67-0.99). The sign is negative on the US markets and UK 100 in both
  eras, so the documented momentum does not show in 2010-2026. Fading it would earn the same 1-2 bps gross that IG's
  cost removes.
- **Opening-range breakout (ORB30).** Gross +0.6 to +2.8 bps against a cost of 2.0-4.1 bps. The train era is negative
  everywhere but Germany 40.
- **Gap fade at the cash open (GAPFADE).** 38-45 % of the fades reach the previous close, and the rest lose more than those win.
  The test era nets about 0 on the US markets and −5 bps in Europe. IG quotes through the night, so this is the
  overnight move faded at the cash open.
- **Turn of the month, intraday (TOM_ID).** US Tech 100 makes +12.7 bps, t 2.05, in 2019-2026, and Yahoo agrees
  (+16.7). The train era 2010-2017 is −1.8, which is the round-2 pattern again: a calendar effect that appears in one
  era only.
- **FOMC, CPI and payroll days.** The intraday pre-FOMC drift is gone (train −5 to −14 bps). After the statement the
  move does not continue (t −0.2 to −0.3). Release days earn nothing intraday: the move happens at 08:30, before the
  cash open. Each arm has 54-184 test trades, so only an effect of 12-25 bps a trade could have shown.
- **EIA crude.** No direction in the first five minutes after 10:30 ET that persists (train t −1.04). HistData's WTI also
  stops in 2023.
- **FX Sunday open (FXW_X).** The same frozen rule on 14 pairs:
  - **AUD-bloc pairs (AUD/USD, AUD/NZD, NZD/USD):** strong in the test era and flat in the train era.
  - **EUR/JPY:** positive in both eras (FXCM t 2.8 / 1.58; HistData t 3.15 / 2.72).
  - **EUR/USD, GBP/USD, USD/JPY:** already among STATARB-2's arms and not new tests. Their 2013-2015 years are reported
    for completeness.
  - **The two feeds' gaps** correlate 0.76-0.96.
  - **Cost assumption:** the opening spread is FXCM's own, multiplied by 1.25, which is S1a's IG/FXCM ratio.
  - **Assumed IG spreads:** five pairs' IG average spreads are assumptions (NZD/USD, AUD/JPY, NZD/JPY, AUD/NZD,
    EUR/AUD), to be checked with `facts` before any money.
- **Correlation if more than one FX pair were run.** Trade returns correlate 0.52 between AUD/USD and NZD/USD (78
  common weekends), 0.32 with AUD/NZD (35) and 0.15 with EUR/JPY (55). NZD/USD adds little beside AUD/USD. EUR/JPY
  would diversify, if it were real.

## 4. The weekend recorder's first weekend (descriptive; no verdict)

`inputs/ig_recorder_weekend_2026-10-17.json`, read 04:20 UTC Sunday.
- **Weekend-market spreads (median):**
  - Weekend Wall St 55 pts (10.6 bps);
  - Weekend US Tech 40 pts (13.8 bps);
  - Weekend Germany 40 35 pts (13.7 bps);
  - Weekend UK 100 12 pts (11.1 bps).
  - At Friday's close the weekday markets were 4.8, 2.0, 7.0 and 4.0 pts.
  - A weekend round trip therefore costs 10-14 bps before any edge.
- **Against Friday's last mid:**
  - Weekend Wall St −20.6 bps, US Tech −41.0 bps (as far as −79), UK 100 −12.4 bps.
  - Germany 40 opened Saturday at Friday's mid and was back there at the last read.
- **No Monday reopen yet.** The recorder's 401 fault (two runs in three failed) means some changes were missed or
  recorded late. It was fixed in `ea3e74da` with a follow-up `141c6491`.
- **WKND_FADE's frozen test needs IG history** (plan `wknd`, CFD account): about 8,160 points expected, 18,360 at most.
  Even then, 51 weekends can reach "demo" at most.

## 5. FXW-AUD: Kelly, stake and ruin (`results/sizing.json`)

**The trade inputs.** 85 FXCM trades 2016-2026 on their minute paths, re-scored by `fxw_paths.run()`: a 12 bps opening
spread (S1a's IG median was 10.1) and 2 bps exit and funding. Each Monte Carlo draws 8 trades a year for 5 years,
10,000 times, at a fixed stake. IG closes a position when equity falls under half the margin. AUD/USD at 0.66; IG's
margin 5 %; IG's minimum stake GBP 0.50 a pip (about GBP 3,300 notional).

| stop | mean, bps/trade | sd | Kelly leverage | half-Kelly | Kelly at the bootstrap low | worst closed trade | worst excursion |
|---|---:|---:|---:|---:|---:|---:|---:|
| none | 18.9 | 36.3 | 143× | 72× | 82× | −129 bps | 449.5 bps |
| guaranteed 200 bps | 15.8 | 43.6 | 83× | 42× | 32× | −206 bps | 202 bps |
| guaranteed 150 bps | 13.9 | 47.1 | 63× | 31× | 16× | −155 bps | 152 bps |

Kelly is far above anything IG allows (20:1). So the binding limits are IG's margin and the tail, not Kelly.

| account | stake | leverage | margin | GBP a year, median (5th-95th) | worst closed trade | worst mark-to-market | P(50 % drawdown, 5 years) | P(margin close-out) |
|---|---|---:|---:|---|---:|---:|---:|---:|
| GBP 500 | GBP 0.50/pip (minimum) | 6.6× | 165 | 51 (24-74) | −43 | −148 | 0 | 0 |
| GBP 500 | GBP 0.76/pip | 10× | 250 | 77 (37-112) | −65 | −225 | 0 | 0 |
| GBP 1,000 | GBP 1.52/pip | 10× | 500 | 153 (74-223) | −129 | −449 | 0 | 0 |
| GBP 1,000, GSL 200 | GBP 1.52/pip | 10× | 500 | 130 (29-212) | −206 | −202 | 0.4 % | 0 |
| GBP 2,500 | GBP 3.79/pip | 10× | 1,250 | 384 (185-559) | −323 | −1,124 | 0 | 0 |
| GBP 2,500, GSL 200 | GBP 3.79/pip | 10× | 1,250 | 325 (74-530) | −516 | −506 | 0.4 % | 0 |
| GBP 2,500 | GBP 7.58/pip (20:1, deviation 1) | 20× | 2,500 | 561 (−352 to 1,089) | −2,247 | −2,247 | 9.3 % | 9.3 % |
| GBP 2,500, GSL 200 | GBP 7.58/pip (20:1) | 20× | 2,500 | 420 (−129 to 1,036) | −1,031 | −1,011 | 0.4 % | 0 |

**Reading the table.**
- **Leverage.** 10× (margin half the account) is the most I would run. At IG's 20:1, the one 449-bps weekend in the
  sample (in every path that draws it, 9 % of them) closes the position out at a 90 % loss. And after any loss the
  account can no longer margin the same stake.
- **Stops.** A guaranteed stop at 200 bps costs about 3 bps a trade in expectation and caps the worst trade at about
  2 %. That buys protection against a weekend worse than any in the sample, at a price.
- **A deduction for 2013-2015.** These GBP figures leave out 2013-2015, when the rule earned nothing. Over 2013-2026 the
  FXCM mean is 13.9 bps (t 3.54, n 128), about 0.65 of the 2016-2026 figure. Scale the GBP accordingly.

**What to fund, if S1b passes:** GBP 1,000 in the spread-bet account (UK spread-bet profits are untaxed), GBP 1.50 a pip
without a stop, or with a 200-bps guaranteed stop if Davies prefers a known worst case:
- about GBP 100-150 a year expected;
- the worst closed trade so far about GBP 130-210;
- a worst mark-to-market about GBP 450.

It is a small edge in GBP because it trades 8 times a year. Placing it by hand at Sunday's open is within Term 9(12).
Software on the spread-bet account needs IG's consent; on the CFD account it does not (CFD profits are taxable).

## 6. IG history that would help (to be fired by the coordinator; none was fired by me)

1. **FXW's missing window 2025-11-28** (spread-bet account, plan `fxw`): about 32 points, to complete S1a's 51.
2. **The weekend-market test** (CFD account, plan `wknd`, 8 roles × 51 weekends): about 8,160 points expected, 18,360
   at most, on the CFD account's own 10,000 a week, possibly over two weeks. Only worth it if Davies wants WKND_FADE
   answered. Its frozen rule is in `params/frozen.json`.
3. **No pull for the new FX pairs yet.** They first need roles in `epics.ts` and a `facts` row. After that, about 30
   points per weekend per pair, about 1,530 per pair on the spread-bet allowance.

## 7. Files

- `params/frozen.json`: the rules, costs, eras and bar, plus four deviations.
- `scripts/`:
  - `pull.py`: the pulls and derived tables;
  - `tzcheck.py`: deviation 3's clock check;
  - `search.py`: every arm (`--inclusive-close` for deviation 4a);
  - `sizing.py`: §5;
  - `report.py`: §2's table;
  - `build_manifest.py`.
- `inputs/`: the derived tables, `bls_dates.json`, the recorder's reading and the pull logs.
- `results/`: `search.json`, `search_inclusive_close.json`, `sizing.json`.
- `MANIFEST.json`: every file's sha256.

`search.py` and `sizing.py` give the same bytes on a re-run.

**What I could not do or did not check.**
- No IG call.
- Dukascopy is still throttled (HTTP 429), so there is no third source.
- No Dow on HistData.
- No intraday VIX history.
- Index rebalances have no index-level rule.
- HistData WTI stops in 2023.
- Five IG FX spreads are assumed.
- The weekend recorder has one weekend and no Monday reopen.
