# IG strategy search beyond FXW-AUD (2026-10-16)

Davies, 2026-10-16: "ig除了澳元这个还有什么别的策略吗？再深度研究下，结合多个数据源，策略够好的话有一定风险会亏钱也没问题".

**Headline.** Not one of the 23 headline arms across 12 families (trend, calendar, FX flow, session, Monday gap, VIX
carry, cross-asset) passes the frozen bar after IG's costs: t ≥ 2.5 and a bootstrap lower bound above zero on the
untouched test era, with t ≥ 2.0 on the train era. So there is no portfolio of survivors to build. Several documented
anomalies were real in the train era and gone in the test era (the pre-FOMC drift t 3.09 → 0.83, gold's
September-November t 3.55 → −1.87, turn-of-month on UK 100 and Germany 40). Trend following earns a little before IG's
costs (test Sharpe 0.40) and nothing after them (−0.01): IG's overnight admin fee, not the spread, is what kills it.
**FXW-AUD remains the only IG strategy with a historical case**, and the recommendation is unchanged: verify it on IG's
own data (S1a, then S1b's recorded Sundays) before any money.

Everything was frozen before any data was pulled (`backtests/ig_search/params/frozen.json`, commit `183c380a`), its
three source deviations were written before any result existed (`4683fbb4`), and nothing was tuned on the test era.
(Audit, 2026-10-16: `b5732235` and `5aff701c` were these commits before a rewrite; all three reached `main` in one push
at 16:02:30 UTC, so their order rests on their content and author times, not on an outside timestamp.)

## 1. The sources, and what each covered

`scripts/pull.py` read every source keyless and pinned each answer's sha256 in `inputs/pull_log.json` (3,306 reads,
3,137 answered 200; the rest are FXCM weeks that do not exist and Dukascopy's throttle).

| source | series | span used |
|---|---|---|
| Yahoo chart API (daily) | ^GSPC, ^FTSE, ^GDAXI, ^N225, ^AXJO, ^STOXX50E, GC=F, CL=F, ^TNX, ^VIX, SPY and QQQ (open and close), EUR/USD, GBP/USD, USD/JPY, AUD/USD | 1970 (indices) / 1993 (SPY) / 2000 (futures) / 2003-06 (FX) → 2026-10-15 |
| FRED | SP500, DEXUSEU/UK/JP/AL, DCOILWTICO, DGS10, DTB3, DFII10, DBAA, VIXCLS, SOFR, SONIA, 3-month interbank (US, UK, euro area, Japan, Australia), ECB deposit rate | 1954-2003 → 2026-10 |
| Dukascopy (daily candles) | USA500IDXUSD, XAUUSD | 2012 / 2003 → 2025, years missing where the throttle refused |
| FXCM public archive (weekly H1 bid/ask) | EUR/USD, GBP/USD, USD/JPY, AUD/USD | 2012-01 → 2026-10 |
| FXCM minute fix table (committed, statarb_search2) | the same four at London 14:00 and 16:00 | 2016 → 2026-09 |
| federalreserve.gov | scheduled FOMC statement days, parsed from the historical pages and the calendar | 261 days, 1994 → 2026-09 |
| CFTC legacy futures-only reports | non-commercial positions in gold, WTI, E-mini S&P, 10-year note, EUR, JPY | 2003 → 2026-10 |
| Cboe (committed, ig_research) | VX futures settlements, VIX | 2013 → 2026 |

**Deviations (written before results).** (1) Dukascopy throttled this machine (HTTP 429 and dropped connections), so the
FX hourly tests use FXCM's H1 files, which start in 2012: MONTHEND_FIX and SESSION split train 2012-2018 / test
2019-2026. (2) With no long hourly US 500 history, MONDAY_GAP has only Yahoo's 730 days of ES=F: *not run, coverage*.
(3) Stooq refused every connection and is not used; Dukascopy daily was read for the US 500 and gold only, so UK 100,
Germany 40 and Japan 225 have no source B.

Two data faults were found in the first run's output and fixed (neither changes a rule, and no verdict moved: every arm was dead in both runs): a return spanning a hole in a
source (a Dukascopy year the throttle refused) had been counted as one day's or one month's return, and is now dropped;
and FXCM's bid alone carries the spread's widening at the 22:00 UK rollover into the 23:00 and 00:00 legs, so the FX
tests read the mid.

Cross-source agreement on daily excess returns: US 500 0.91, WTI 0.91, gold 0.85, 10-year 0.99; FX 0.38-0.49, because
Yahoo's daily FX closes and FRED's New York noon fixings are half a day apart (shifting by a day does not raise them, so
it is timing, not a mismatch); monthly signals are not affected.

## 2. IG's costs used

From IG's UK pages, read at source (`ig_deepdive/inputs/sources/` and the commodity and bond pages read for this
search): spreads in hours US 500 0.4 pt, UK 100 1, Germany 40 1.2, AUD/USD 0.82 pip average, EUR/USD 0.85, GBP/USD 1.4,
USD/JPY 0.94, spot gold 0.3, US crude 2.8, Treasury and Bund futures bets 2; funding: index DFB benchmark ± 3.4 % (spread
bet), FX tom-next + 0.80 % (F12; the 1.5 % on the other page is worse), spot gold tom-next + 1 %, undated commodities and
bonds cost of carry + 3 %; minimum stakes US 500 £1/pt, UK 100 and Germany 40 £0.50, EUR/USD and AUD/USD £0.50/pip,
GBP/USD £1, spot gold £5, US crude £0.25/cent, bonds £2 per 0.01; margins 5 % (indices, gold), 3.33 % (FX majors), 10 %
(oil), 20 % (bonds). Present-day levels turn points into bps (each in `params/frozen.json`).

## 3. Results: every arm, both eras

Net of IG's costs, bps of notional per trade (per month on capital for TSMOM). t and bootstrap 95 % per era; "B" is the
second source on the test era.

| arm | rule | trades a year | train mean (t), boot | test mean (t), boot | B test | worst trade / worst drawdown (test) | Term 9(12) | verdict |
|---|---|---:|---|---|---|---|---|---|
| TSMOM 12-month | sign of the 12-month excess return, 10 % vol a market, 11 markets, monthly | 12 rebalances | +7.39 (0.68), −14.0 to +28.3 | −0.28 (−0.03), −18.5 to +17.0 | −1.45 (−0.13) | −580 / −14.2 % | by hand, monthly | dead |
| TSMOM ensemble | mean sign of 1-, 3-, 12-month | 12 | +6.60 (0.80) | −1.41 (−0.19) | −4.69 (−0.55) | −312 / −10.0 % | by hand | dead |
| Pre-FOMC | long US 500 into the statement day | 8.0 | +31.4 (3.09), +11.5 to +51.6 | +8.1 (0.83), −10.7 to +27.0 | Dukascopy +12.9 (1.20); FRED 0.0 (0.00) | −302 / −9.8 % | by hand | dead (decayed) |
| Turn of month US 500 | last 2 to 3rd trading day | 12.1 | +18.6 (1.33) | +20.1 (1.47), −7.3 to +46.5 | +3.2 (0.26) | −640 / −11.6 % | by hand | dead |
| Turn of month UK 100 | the same | 12.1 | +39.9 (2.88) | +10.0 (0.73) | — | −658 / −22.1 % | by hand | dead (decayed) |
| Turn of month Germany 40 | the same | 12.1 | +52.7 (2.65) | +0.3 (0.02) | — | −804 / −39.7 % | by hand | dead (decayed) |
| Overnight US 500 | close → open, one night funded | 252 | +0.66 (0.66) | +0.61 (0.58), −1.5 to +2.7 | QQQ +2.38 (1.93) | −1,106 / −35 % | software | dead |
| Month-end fix EUR/USD | Melvin-Prins hedge flow, 14:00-16:00 London | 12 | +2.4 (0.80) | −0.6 (−0.23) | −1.0 (−0.38) | −95 / −3.7 % | by hand | dead |
| Month-end fix GBP/USD | the same | 12 | −0.2 (−0.07) | −0.3 (−0.09) | −0.4 (−0.11) | −90 / −5.4 % | by hand | dead |
| Month-end fix USD/JPY | the same | 12 | +5.5 (2.18) | −4.9 (−2.00) | −5.2 (−2.08) | −90 / −5.3 % | by hand | dead (reversed) |
| Month-end fix AUD/USD | the same | 12 | +1.2 (0.41) | +5.1 (1.61), −1.0 to +11.1 | +5.4 (1.66) | −85 / −1.9 % | by hand | dead |
| Gold Sep and Nov | long gold over each month | 2.1 | +382 (3.55), +185 to +593 | −155 (−1.87) | −49 (−0.38) | −1,217 / −68 % | by hand | dead (reversed) |
| WTI Mar-Apr | long WTI over the two months | 1.1 | +306 (0.56) | +150 (0.23) | +202 (0.31) | −8,730 / −94 % | by hand | dead |
| Session EUR/USD | short 07:00-12:00 UK | 246 | +1.57 (2.53) | −0.14 (−0.25) | — | −116 / −11.8 % | by hand or software | dead |
| Session GBP/USD | the same | 246 | +0.72 (1.06) | −0.10 (−0.15) | — | −152 / −9.4 % | by hand or software | dead |
| Session USD/JPY | long 00:00-06:00 UK | 245 | −2.69 (−3.94) | −0.96 (−1.57) | — | −300 / −21 % | software | dead |
| Session AUD/USD | short 23:00-05:00 UK | 245 | −1.83 (−2.40) | −3.11 (−4.39) | — | −320 / −60 % | software | dead (sign reversed; see 4.3) |
| Monday gap (ESG) | fade a 0.5 % S&P weekend gap, out Monday 16:00 ET | 9 | — | +50.7 (1.54), n 18 | — | −212 | by hand | not run, coverage |
| Monday gap fill | the same, out at Friday's close if touched | 9 | — | +42.2 (1.59), n 18 | — | −212 | by hand with a limit | not run, coverage |
| VIX carry | short front VX in contango and VIX < 20, +50 % guaranteed stop, 10 % notional | 6.8 cycles | +0.3 (0.01) | −16.2 (−0.51) | (FRED's VIXCLS is Cboe's VIX: the same) | −528 on capital / −13.9 % | by hand | dead |
| COT contrarian | fade speculators at a 3-year 10/90 percentile, 4 weeks | 90 (overlapping) | −7.3 (−0.46) | −14.6 (−0.99) | −28.8 (−2.09) | −2,718 / −304 % | by hand, weekly | dead |
| Real yields → gold | gold with the sign of falling 10-year real yields, monthly | 12 | +13.9 (0.30) | −1.6 (−0.04) | Dukascopy +43.2 (0.98), n 82 | −1,256 / −53 % | by hand | dead |
| Credit → US 500 | long only while the Baa-10y spread is below its 6-month mean, against always long | 12 (monthly sums) | −0.4 (−0.02) | −29.4 (−1.29) | — | — | by hand | dead |

Earnings drift on share CFDs (PEAD): **not run, data** — no keyless history of earnings surprises was found. IG's share
commission is 0.10 % a side (UK) or 2 cents a share (US), built into the spread-bet price, and a 60-day hold pays about
1.2 % of funding at today's rates plus 3.4 %: a round trip costs roughly 140 bps before any drift.

### What the costs take: trend following

| 12-month TSMOM, source A | train (1990-2009) | test (2010-2026) |
|---|---|---|
| before IG's costs | +3.13 % a year, vol 5.9 %, Sharpe 0.53, t 2.37 | +1.81 % a year, Sharpe 0.40, t 1.64 |
| after IG's spread and admin fee | +0.89 %, Sharpe 0.15 | −0.03 %, Sharpe −0.01 |

IG's costs take 2.2 % a year in the train era and 1.8 % in the test era. Most of it is the admin fee on every held
position: at the test era's typical positions the eleven-market book pays about 1.8 % a year in admin alone (3.4 % on
index longs and shorts, 3 % on bonds held at 1.7 times notional, 0.8 % on FX). IG's futures-dated bets carry no admin fee
but a quarterly roll spread and wider spreads; even at zero cost the test era's +1.8 % at Sharpe 0.40 is not a case for
money. At IG's minimum stakes, eleven markets need about £985,000 of capital (Japan 225's minimum stake alone is about
£47,000 of notional); the eight cheapest about £107,000.

## 4. What this says, family by family

**4.1 Documented anomalies decayed exactly as the literature after them warned.** The pre-FOMC drift (Lucca and Moench's
sample period strong; after 2012 +8 bps, t 0.83 on Yahoo and 0.0 on FRED), turn-of-month and gold's September-November
all had t ≥ 2.6 before 2010 and none after. None reached the test era with the strength it had in the train era.

**4.2 IG's funding is the binding cost for anything held for days.** Index DFBs pay the benchmark plus 3.4 % (7.28 % a
year on a long US 500 at today's SOFR), so overnight, turn-of-month, credit-timed equity and trend positions start several
percent a year behind their published gross returns.

**4.3 One finding that is not a candidate.** On FXCM's mids, AUD/USD rose, not fell, in its own Sydney hours: before costs
about +0.7 bps a day in the train era and +1.9 in the test era. The frozen rule shorted AUD in those hours, so it lost,
and it is reported as dead. The opposite trade would net about −0.5 and +0.8 bps a day after the 0.82-pip average spread,
and the real spread at 23:00 UK, an hour after the rollover, is likely wider. A rule found by reversing a failed one on
the same data is a new hypothesis, not evidence; it is recorded, not proposed.

**4.4 Month-end hedge flows did not survive the switch of eras.** USD/JPY reversed (+5.5 bps, t 2.18 → −4.9, t −2.00, on
both FXCM sources); AUD/USD was +5 bps (t 1.6) in the test era but near zero in train.

## 5. The ranking, and the recommendation

| rank | strategy | why | verdict |
|---:|---|---|---|
| 1 | **FXW-AUD-IG** (2026-10-15 review) | the only rule with a historical bar passed, recomputed independently: +14.88 bps a trade at a 20 bp spread, t 3.78, 85 trades over 10.7 years | in verification: S1a on IG's own history, then S1b's recorded Sundays |
| 2 | WKND (IG's weekend index quotes against the reopen) | the recorder starts Friday 21:35 UK; S2 measures it | measurement, not yet a strategy |
| 3 | Monday S&P gap fade | 18 trades, +50.7 bps, t 1.54, on the only free hourly history found | not run, coverage; a paid ES history (FirstRate, about $100) would let it be tested |
| — | everything in section 3 | the bar failed on the test era | dead |

**Portfolio.** No arm passes, so there is no portfolio of survivors; a portfolio of the arms that merely look best on the
test era would be chosen on it, which the frozen rules forbid.

**The top recommendation is still FXW-AUD, at the smallest real size, and only after S1a and S1b pass.** Its numbers
(2026-10-15 review):

| | £0.50 a pip (IG's minimum, about £3,500 of notional) | £5 a pip (about £35,000) |
|---|---:|---:|
| trades a year | about 8 | about 8 |
| expected before tax, at a 20 bp IG spread | about £41 a year (bootstrap range £19 to £62) | about £410 (£190 to £620) |
| worst finished historical trade | about −£47 | about −£470 |
| worst 24-hour open excursion | about −£159 | about −£1,590 |
| worst with a 200 bp guaranteed stop (costs ~3 bps a trade) | about −£72 | about −£720 |
| margin (5 %) | about £175 | about £1,750 |
| capital so the worst open excursion is under 20 % of it | about £800 | about £8,000 |

**Term 9(12).** FXW is about eight trades a year, entered at Sunday 21:00-22:00 UK: it can be run by hand from a signal
published at the open, so IG's consent for automated strategies is not needed unless the order itself is automated.

## 6. S1a and the weekend recorder (read-only, 2026-10-16 15:03 UTC)

- `facts` is ok on both demo accounts: CFD (`ig_facts` id 2, 16:27 UTC 10-15) and spread bet (id 3, 16:40 UTC, after the
  token fix). The spread-bet account has `fx_audusd` = `CS.D.AUDUSD.TODAY.IP`; its "Weekend" search returned six
  markets (SpaceX, Hong Kong HS50, Australia 200, Germany 40, US crude, UK 100) and the searches by name for Weekend Wall
  Street, Weekend US Tech 100 and the three weekend FX pairs returned nothing, so the recorder reads those two indices on
  the CFD account, which lists them.
- **No history had been pulled when this search ran** (`ig_price_pulls` was empty; the S1a pulls fired 16:03–16:15 UTC
  the same day, ledger history 16:30). This search's SQL is read-only, so it could not fire
  them. The main session runs, with the Vault bearer and outside the recorder's windows (each call answers 202 at once):
  `ig?action=history&account=sb&plan=probe` (on the spread-bet account that is AUD/USD's one small window, since
  `wknd_wallst` is not selected there; `&account=cfd&plan=probe` adds the weekend-index probe on the CFD account's
  allowance), reads `ig_price_pulls` (timestamps, bid/ask, allowance), then `ig?action=history&account=sb&plan=fxw&max=15`
  four times. S1a's budget is at most 4,029 points (expected about 1,530) of the spread-bet account's 10,000 a week; this
  search used none of IG's allowance.
- The weekend recorder (`ig?action=quotes`) is switched on by the five-minute toggle from Friday 21:35 UK (20:35 UTC);
  `ig_quote_runs` was still empty at 15:03 UTC, as expected before the window.

## 7. Not checked

- No IG price was read for this search; every cost is from IG's public pages at today's levels applied to history.
- Index dividends are assumed yields (US 2 %, UK 3.5 %, Japan 2 %; Germany's index includes them), not paid dividends.
  WTI's continuous futures miss the roll yield an IG undated oil position pays or earns. The 10-year bond return is built
  from yields with a duration of 8.
- Dukascopy's hourly data, and its daily data for UK 100, Germany 40, Japan 225 and oil, were refused by its throttle;
  Stooq refused every connection. Those arms have one source.
- The CFTC reports are the legacy futures-only file; the disaggregated report was not read. Earnings drift was not run
  (data). CPI and NFP dates were not needed by any frozen family and were not fetched.
- Tax and IG's Term 9(12) are as read in the 2026-10-15 review's sources, not re-read.

## 8. Files

- `backtests/ig_search/params/frozen.json` (rules, costs, eras, bar; three deviations).
- `backtests/ig_search/scripts/pull.py` (the pulls), `search.py` (every family; `--selftest` checks its helpers by hand),
  `report.py` (money, capital, ranking), `build_manifest.py`.
- `backtests/ig_search/inputs/`: `daily.csv.gz`, `fx_events.csv.gz`, `cot.csv.gz`, `fomc_dates.json`, and
  `pull_log.json` with the sha256 of every answer read.
- `backtests/ig_search/results/`: `search.json`, `arm_months.json`, `ranking.json`; `MANIFEST.json`.
