# PMSTATARB verification — S1 TOUCH-CAL

Read on 2026-10-15 from `docs/agents/backtests/pmstatarb/results/s1_verdict.txt`
after the re-run. The parameters are `SPEC-for-verification.md` (commit
`985a89a4`) and `FROZEN.md`. They were not retuned. The first `FROZEN.md`
landed in the same commit as the first verdict. That is a deviation from
SPEC rule 5, recorded in `FROZEN.md`. The commit history was not rewritten
to hide it.

S2, S3, S4, G3 and G4 were not run. The title-date pattern S2 would use is
the same function, and the May fix is in that function.

## Verdict

The bar word is FAIL.

Davies chose the name on 2026-10-22: **FAIL on available sample** (the other was plain FAIL). `results/s1_verdict.txt`
keeps the script's own words, which leave the name to him.

The sample is the complete Gamma months 2024-01 through 2026-08. Title
ends on or after 2026-09-01 are held out. September is a partial pull.
The 2026-10-01 through 2026-10-04 tail was never requested.

## What this re-run changed

The hours, thresholds, stakes, seed, bootstrap, volatility window, fee
formula and High/Low field rule are the ones already frozen. Five
corrections, none of them a new threshold:

- Title months of three letters parse. The old pattern kept names longer
  than three characters and then only added Sept and Sep, so May was
  dropped. Every full month name and the usual abbreviation now matches,
  longest name first, and the self-test pins all twelve. 2026-05 is in
  the touch file: 457 daily reach, 457 daily dip, 70 weekly reach, 70
  weekly dip. The 914 daily rows have a settlement clause. The 140 weekly
  rows do not, so they are not trades. A note on the review that counted
  112 weekly May markets is this file's 140.
- A fill is the first print at or after entry on the side the study
  takes: taker BUY of the outcome it buys. A SELL print is the other
  side and is not a fill. `load_prints` keeps `side`. Against the
  previous headline, 11 trades dropped and 4 non-May trades appeared
  because the first BUY, not an earlier SELL, is the fill. 167 of the
  new headline trades are May 2026.
  The filter is narrower than "your side". A taker SELL of the other
  outcome at p is also a buy of this outcome at 1−p, and those prints are
  not counted. A fill can therefore only come later than the spec's first
  print on our side, never earlier. That is the conservative direction.
  Effect of the side filter on the previous headline (audit of
  2026-10-16): the 11 dropped trades had mean ROI +0.655 and P&L
  +144.13; 23 trades kept in both runs changed fill or side, and their
  P&L went from +89.15 to −78.03. The side-blind fills had leaned
  toward PASS.
- A print walk that hits the data-api offset cap (offset above 10000)
  is not marked done. One market,
  `0x0c4b0e8a485c7edf9267548c13ceef5b928ebf06df266d91554b308e03460813`,
  stopped at 21 pages and 10500 prints, still inside T−96 h. It is
  `tape_capped` and is not a trade.
- `FROZEN.md` says the file was first committed with the verdict.
- `MANIFEST.json` records sha256, line count and byte size for the print
  tape, the done file, the capped file, and both spot CSVs. September's
  stop counts are in `results/g1_gap_mix.txt`.

## Sample

Headline markets are touch reach and dip markets whose title end is
2025-01-01 through 2026-08-31, now including May 2026. 2024 is beside
the bar and has 0 trades.

Headline horizon T−24h, deviation threshold 0.04, stake $20, bootstrap
seed 20261014, 10,000 draws of whole markets. The discrete-monitoring
one-touch price is the figure the bar uses. Stake $50 is reported beside
and has the same mean ROI, because the fee scales with shares.

2025 has 19 trades, mean ROI −0.2680. 2026 has 1159 trades, mean ROI
−0.1112. The FAIL evidence is still the 2026 sample. May 2026 did not
add a 2025 trade.

## Bar

| Condition | Figure | Result |
| --- | --- | --- |
| ≥ 150 trades and ≥ 100 markets | 1178 trades, 1178 markets | pass |
| Mean ROI > 0, and the 5% bootstrap bound > −2% | mean ROI −0.1137, p05 −0.2266, P&L −2679.73 | fail |
| Neighbour horizons and thresholds, same sign of mean ROI | all eight neighbours negative | pass |
| No market > 25% of dollar P&L; no title-end month > 50% | top market 0.80% (`0x2a2a7c97a192201b93c27a04338af89bf305410a52084005016eb739fc0916a1`); 2026-03 is 45.58% | pass |
| Each calendar year with trades, mean ROI ≥ −5% | 2025: n 19, mean −0.2680; 2026: n 1159, mean −0.1112 | fail |

Neighbours, same sign as the headline:

| Horizon | Threshold | Trades | Mean ROI | p05 |
| --- | --- | --- | --- | --- |
| 72h | 0.04 | 2427 | −0.4525 | −0.5369 |
| 72h | 0.03 | 2547 | −0.4610 | −0.5424 |
| 72h | 0.05 | 2316 | −0.4438 | −0.5311 |
| 24h | 0.03 | 1286 | −0.1310 | −0.2340 |
| 24h | 0.05 | 1048 | −0.0813 | −0.2054 |
| 12h | 0.04 | 579 | −0.2175 | −0.3901 |
| 12h | 0.03 | 653 | −0.2451 | −0.3965 |
| 12h | 0.05 | 488 | −0.2073 | −0.4107 |

Counts from the same file: touch rows 6791, no readable settlement clause
1582, tape capped 1, no taker-BUY print at or after T−12h 1052, at or
after T−24h 32, at or after T−72h 31. There is no upper time limit on
the fill: the first such print may come hours after entry while the
model price is the one at entry. That lag was not measured.
Universe preparation (`results/s1_universe_counts.txt`): 140,926 closed
candidates read, 5,209 headline touch rows with a settlement instant, 2024 with a readable
clause 0. `unparsed.no_title_date` is 839 after the month-name fix.
All 839 are month-long titles ("Will Bitcoin reach $N in November?"),
outside the daily and weekly families (audit of 2026-10-16, run on the
earlier `unparsed.csv`).

The headline has no trade in 2025-07 or in 2025-09 through 2026-02,
although the touch file has rows there (`s1_universe_counts.txt`).
Before 2026-03 the touch rows are weekly, apart from 25 daily rows in
2025-08 (the 19 trades of 2025). 812 of those 824 weekly rows have no
readable settlement clause (`clause_ok` 0), so they cannot be trades
(audit of 2026-10-16, on the earlier `touch_s1_universe.csv`; the
month counts before 2026-03 are the same in both runs).

## Calibration

All modelled headline markets at T−24h, not only the trades. Decile, count,
mean model probability, realised touch rate:

| Decile | n | Model | Realised |
| --- | --- | --- | --- |
| 0 | 3752 | 0.0099 | 0.0160 |
| 1 | 330 | 0.1460 | 0.1394 |
| 2 | 207 | 0.2461 | 0.1546 |
| 3 | 166 | 0.3497 | 0.2530 |
| 4 | 162 | 0.4508 | 0.4136 |
| 5 | 148 | 0.5473 | 0.4324 |
| 6 | 116 | 0.6484 | 0.6121 |
| 7 | 113 | 0.7457 | 0.6372 |
| 8 | 114 | 0.8484 | 0.8421 |
| 9 | 100 | 0.9449 | 0.9600 |

The 2024 calibration table is empty.

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
(`spot_last_close_ms` 1791072000000). Their sha256 values are in
`MANIFEST.json`.

## The September gap

Complete closed-market months on disk are 2024-01 through 2026-08.
September stopped on a Cloudflare 403 at page size 60: pages 14857,
scanned 891420, kept 23562, cursor key 4946930. The one allowed retry, at
2026-10-15T11:34:08Z, sent that same cursor once and was 403 again. The
cursor stays quarantined. The 2026-10-01 through 2026-10-04 tail was never
requested. Nothing was filled from a third-party mirror. Those stop lines
are in `results/g1_gap_mix.txt`.

`results/g1_gap_mix.txt` compares the complete August file with the
retrieved September slice. Both are mostly above-markets, with daily reach
and daily dip in matching counts (August 434 and 434; the retrieved
September slice 390 and 390). That slice is not the hole. Markets with an
id after 4946930 were not retrieved, so their family mix is unknown.

The headline sample does not contain September. The hole does not remove
May, and it does not remove one family from the months the bar used. A
claim about the spec window through 2026-09-30 cannot be made from this
run.

September cannot change the bar word. The per-year condition already
fails on 2025 (19 trades, mean −0.2680), and no September 2026 trade
changes 2025. On the mean alone: the headline's ROI sum is −133.99 over
1178 trades. August gave 180 trades from 868 daily markets, so a full
September would give about 190. Those would need a mean ROI of +0.705
to turn the headline mean positive, and +0.323 for 2026 to reach −5%.
The best month observed is 2026-04 at +0.1005.

## Not checked

- Fills priced from `/prices-history` instead of prints.
- The touch-against-terminal mid ratio. Terminal prints were not pulled.
- G4's clause table. Settlement instants used here are parsed from the
  description. Rows without a readable clause are excluded (1,582).
- S2 bucket distribution, S3 Kalshi lead, S4 the 2026-10-18 sports snapshot.
  `FROZEN.md` still names 2026-10-18. That day has not been read.
- `scripts/g4_sources.py` was not run and is not an input to this verdict.

## What is committed

The verdict, the headline trades, the gap note and the scripts are in
git. The family CSVs, `touch_s1_universe.csv`, the print tape and the
spot CSVs are not. Their bytes are under `/tmp/pmstatarb-data/` on the
machine that built them. `MANIFEST.json` records sha256 and size. The
print tape is 143,931,494 bytes and each spot CSV is over 100 MB, past
the size GitHub accepts as one file.

An ancestor commit of this branch adds those family CSVs, and a later
commit removes them from the tree. A merge that keeps that history would
put the blobs on `main`. Squash is the merge that does not.

## Do not

Do not change the threshold, the horizons, the seed, the volatility
window, the stale-print rule, the High/Low field rule or the fee formula
in order to run this study again. That would be a new proposal. Do not
send the September cursor again. Do not put a title end on or after
2026-09-01 into this sample. Do not mark a truncated print walk done.
A later fill of the September hole, if Davies asks, comes from the
official Polymarket subgraph or from on-chain settlement.
