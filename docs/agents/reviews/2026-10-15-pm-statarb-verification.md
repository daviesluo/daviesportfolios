# PMSTATARB verification — S1 TOUCH-CAL

Read on 2026-10-15 from `docs/agents/backtests/pmstatarb/results/s1_verdict.txt`.
The run used the parameters in `SPEC-for-verification.md` (commit `985a89a4`) and
`FROZEN.md`. Those parameters were not changed after the result. A FAIL closes
TOUCH-CAL. S2, S3, S4, G3 and G4 were not run.

## Verdict

FAIL.

## Sample

Headline markets are touch reach and dip markets whose title end is
2025-01-01 through 2026-08-31. Title ends on or after 2026-09-01 are held
out, including the incomplete September pull and the October tail. 2024 is
reported beside the bar and is not part of it: that beside sample has
0 trades.

The frozen window in the spec runs through 2026-09-30. Stopping at
2026-08-31 is the coverage of the complete months. It is not a new
threshold.

Headline horizon T−24h, deviation threshold 0.04, stake $20, bootstrap
seed 20261014, 10,000 draws of whole markets. The discrete-monitoring
one-touch price is the figure the bar uses. Stake $50 is reported beside
and has the same mean ROI, because the fee scales with shares.

## Bar

| Condition | Figure | Result |
| --- | --- | --- |
| ≥ 150 trades and ≥ 100 markets | 1018 trades, 1018 markets | pass |
| Mean ROI > 0, and the 5% bootstrap bound > −2% | mean ROI −0.1088, p05 −0.2310, P&L −2215.59 | fail |
| Neighbour horizons and thresholds, same sign of mean ROI | all eight neighbours negative | pass |
| No market > 25% of dollar P&L; no title-end month > 50% | top market 0.97% (`0x0e72c85140387a895a145c8051b8defbae04bb49ea1ec30853a38959f957e268`); 2026-03 is 51.46% | fail on the month |
| Each calendar year with trades, mean ROI ≥ −5% | 2025: n 19, mean −0.2680; 2026: n 999, mean −0.1058 | fail |

Neighbours, same sign as the headline:

| Horizon | Threshold | Trades | Mean ROI | p05 |
| --- | --- | --- | --- | --- |
| 72h | 0.04 | 2079 | −0.4306 | −0.5345 |
| 72h | 0.03 | 2186 | −0.4442 | −0.5412 |
| 72h | 0.05 | 1986 | −0.4218 | −0.5281 |
| 24h | 0.03 | 1111 | −0.1283 | −0.2407 |
| 24h | 0.05 | 904 | −0.0781 | −0.2159 |
| 12h | 0.04 | 503 | −0.2071 | −0.4010 |
| 12h | 0.03 | 583 | −0.2330 | −0.3983 |
| 12h | 0.05 | 433 | −0.2022 | −0.4266 |

Counts from the same file: touch rows 5737, no readable settlement clause
1442, no print inside the 12h window 874, no print inside 24h 30, no print
inside 72h 29. Universe preparation (`results/s1_universe_counts.txt`):
140,926 closed candidates read, 4,295 headline touch rows with a settlement
instant, 2024 with a readable clause 0.

## Calibration

All modelled headline markets at T−24h, not only the trades. Decile, count,
mean model probability, realised touch rate:

| Decile | n | Model | Realised |
| --- | --- | --- | --- |
| 0 | 3048 | 0.0103 | 0.0174 |
| 1 | 287 | 0.1464 | 0.1498 |
| 2 | 175 | 0.2463 | 0.1429 |
| 3 | 142 | 0.3490 | 0.2324 |
| 4 | 138 | 0.4518 | 0.4275 |
| 5 | 122 | 0.5451 | 0.4098 |
| 6 | 101 | 0.6472 | 0.6337 |
| 7 | 97 | 0.7451 | 0.6289 |
| 8 | 102 | 0.8493 | 0.8431 |
| 9 | 83 | 0.9463 | 0.9518 |

The tails sit close to the model. Deciles 2, 3, 5 and 7 overstate the
realised touch rate. The 2024 calibration table is empty.

## Fees and the spot feed

Each market is charged its own Gamma `feeSchedule` rate and exponent.
`dollar_fee(100, 0.07, 1, 0.5)` is 1.75 and `dollar_fee(100, 0.25, 2, 0.5)`
is 1.5625; both schedules occur on these markets. A disabled schedule
charges 0. An enabled schedule with a blank rate or a blank exponent is
excluded. This is the formula the run used.

`api.binance.com` returned HTTP 451 from this seat. The 1-minute closes are
from `data-api.binance.vision`, Binance's own public kline host, same
request shape. The overlap against `api.binance.com` was not re-measured.
Both BTCUSDT and ETHUSDT end at 2026-10-04T00:00:00Z
(`spot_last_close_ms` 1791072000000).

## The September gap

Complete closed-market months on disk are 2024-01 through 2026-08.
September stopped on a Cloudflare 403 at page size 60: pages 14857,
scanned 891420, kept 23562, cursor key 4946930. The one allowed retry, at
2026-10-15T11:34:08Z, sent that same cursor once and was 403 again. The
cursor stays quarantined. The 2026-10-01 through 2026-10-04 tail was never
requested. Nothing was filled from a third-party mirror.

`results/g1_gap_mix.txt` compares the complete August file with the
retrieved September slice. Both are mostly above-markets, with daily reach
and daily dip in matching counts (August 434 and 434; the retrieved
September slice 390 and 390). That slice is not the hole. Markets with an
id after 4946930 were not retrieved, so their family mix is unknown. A
match on the retrieved slice does not say what the missing tail is.

The headline sample does not contain September, so this hole does not
cut one family out of the sample the bar was computed on. It does mean a
claim about the spec window through 2026-09-30 cannot be made from this
run. If the missing tail had August's mix it would add on the order of a
few hundred daily reach markets and the same number of daily dip markets,
spread across families the way August is. That is a size illustration of
August, not a measurement of the tail.

## Not checked

- Fills priced from `/prices-history` instead of prints.
- The touch-against-terminal mid ratio. Terminal prints were not pulled.
- G4's clause table. Settlement instants used here are parsed from the
  question text. Rows without a readable clause are excluded (1,442).
- S2 bucket distribution, S3 Kalshi lead, S4 the 2026-10-18 sports snapshot.
  `FROZEN.md` still names 2026-10-18. That day has not been read.
- `scripts/g4_sources.py` was not run and is not an input to this verdict.

## What is committed

`data/` holds the family CSVs and `touch_s1_universe.csv` built from the
complete months through 2026-08 (47,426,290 bytes). The raw Gamma pages,
the print tape and the spot files stay in `/tmp/pmstatarb-data` on the
machine that ran the study. The print tape is larger than GitHub's file
limit, so a re-run of `scripts/s1_touch.py` on another machine cannot
rebuild `s1_verdict.txt` until those inputs are carried separately.
`FROZEN.md` lands in this same commit as the verdict: it was written
before the run and had not been committed yet.

## Do not

Do not change the threshold, the horizons, the seed, the volatility
window, the stale-print rule, the High/Low field rule or the fee formula
and run again. That would be a new proposal. Do not send the September
cursor again. Do not put a title end on or after 2026-09-01 into this
sample. A later fill of the hole, if Davies asks, comes from the official
Polymarket subgraph or from on-chain settlement.
