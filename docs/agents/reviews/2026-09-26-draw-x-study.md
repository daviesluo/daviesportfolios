# DRAW-X: DRAWBASE loses on four leagues it had never seen (study, 2026-09-26)

Pre-registered in `2026-09-26-draw-x-prereg.md` (sha256 `4d43a552…f074`, frozen by commit `714a71c0` at 18:34:02
UTC) and run exactly as frozen. Scripts, input and results are in `backtests/polymarket/drawx/`. Nothing was placed:
every read was a keyless GET.

**Verdict: DRAW-X fails.** It made 495 trades and lost **$1,188.82** on $4,849.96 staked, −24.5 % a dollar. Seven
of the nine conditions fail. The draws it bought came 15.2 % of the time, at an average fill of 19.9¢. All four
leagues lost, both halves lost, and ten of the twelve months lost. As the pre-registration says, a fail closes
DRAWBASE: its Premier League profit belonged to one league and one season.

## The bar

| # | Condition | Required | Result | |
|---|---|---|---|---|
| 1 | Trades | at least 300 | 495 | pass |
| 2 | Total, and against the null | > 0 and above the null's p95 | −$1,188.82; the null's p95 is +$722.59 (mean −$46.57) | **fail** |
| 3 | Leagues positive | at least 3 of 4 | 0 of 4 | **fail** |
| 4 | Halves, split by trade count | both > 0 | −$539.92 on the first 247 trades; −$648.90 on the last 248 | **fail** |
| 5 | Not one month | total > 0, no month over 40 % of it, the rest > 0 | total negative; best month October 2025, +$17.91; the rest −$1,206.72 | **fail** |
| 6 | Stress: fills one tick worse, fees doubled | > 0 | −$1,266.10 | **fail** |
| 7 | Not one league | the other three leagues above their own null's p95 | best league Bundesliga (−$129.48); the other three −$1,059.34 on 365 trades; their p95 +$618.71 | **fail** |
| 8 | Worth money | over 4 % a year on peak capital | −1,043 % a year on a $100 peak | **fail** |
| 9 | Every tape complete | all | 550 of 550 | pass |

The halves split on 13–14 February 2026: 15 August 2025 to 13 February 2026, then 14 February to 20 September 2026.

## What happened

* **Selection.** For 550 of the 1,554 matches (35.4 %), the league's draw rate so far beat the draw's screen price
  plus a tick plus the fee. 495 of those filled (90.0 %), and 55 filled less than $2. 472 trades filled the full
  $10. Of 1,064 fills, 197 were at the floor (screen price plus a tick) and 867 at the print's own price, above it.
* **The rule's belief against the result.** The draw rate so far averaged 25.7 % on the traded matches. The rule
  paid 19.9¢ on average, and the draws came 15.2 % of the time. At the prices paid, 98.5 draws were due; 75 came.
* **Why.** A draw priced well under the league's average usually means a match with a clear favourite. Its draw is
  cheap because it is less likely, and the league's rate is no fair value for it; the pre-registration said this
  under "what it cannot show". Across all 1,554 matches the market was close to right: the screen price averaged
  25.3¢ and the draw came 24.6 % of the time (382 draws). The rule bought only the low end, where draws came even
  less often than their price.
* **Descriptive, not part of the bar.** Under DRAWBASE's own null (every payout redrawn at its fill price), a total
  this low or lower came in 49 of 10,000 draws (0.49 %). On this evidence, the draws the rule bought were priced
  too high, not too low. That direction was not pre-registered, and it is not a finding to trade.
* **The Premier League was the exception.** Over nearly the same months (15 August 2025 to 10 September 2026)
  DRAWBASE made +$258.75 on 158 Premier League trades: −$102.84 on 58 in 2025 and +$361.59 on 100 in 2026. The same
  rule lost in every one of the other four leagues, and in both halves.

### By league

| League | Trades | Draws came | Rate | Mean fill price | Mean draw rate so far | Cost | Fees | P&L | Per dollar | Stress |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| La Liga | 126 | 14 | 11.1 % | 18.6¢ | 25.5 % | $1,235.62 | $12.84 | −$554.24 | −44.9 % | −$574.50 |
| Bundesliga | 130 | 21 | 16.2 % | 19.2¢ | 24.6 % | $1,286.70 | $13.28 | −$129.48 | −10.1 % | −$150.36 |
| Ligue 1 | 61 | 8 | 13.1 % | 16.7¢ | 21.4 % | $588.79 | $7.25 | −$154.06 | −26.2 % | −$165.06 |
| Serie A | 178 | 32 | 18.0 % | 22.4¢ | 28.2 % | $1,738.85 | $16.94 | −$351.04 | −20.2 % | −$376.18 |
| All | 495 | 75 | 15.2 % | 19.9¢ | 25.7 % | $4,849.96 | $50.31 | −$1,188.82 | −24.5 % | −$1,266.10 |

### By month (UTC month of the first fill)

| Month | Trades | Draws came | P&L |
|---|---:|---:|---:|
| 2025-08 | 27 | 4 | −$58.04 |
| 2025-09 | 32 | 5 | −$93.45 |
| 2025-10 | 33 | 7 | +$17.91 |
| 2025-11 | 42 | 7 | −$62.54 |
| 2025-12 | 35 | 3 | −$124.79 |
| 2026-01 | 55 | 10 | −$72.91 |
| 2026-02 | 55 | 7 | −$250.08 |
| 2026-03 | 46 | 10 | +$16.53 |
| 2026-04 | 46 | 6 | −$178.15 |
| 2026-05 | 62 | 11 | −$8.06 |
| 2026-08 | 25 | 3 | −$138.73 |
| 2026-09 | 37 | 2 | −$236.50 |

### By fee rate (each market's own schedule)

| Fee rate | Trades | Fees | P&L |
|---:|---:|---:|---:|
| none | 324 | $0.00 | −$677.06 |
| 0.0175 | 6 | $0.85 | +$45.13 |
| 0.03 | 103 | $24.46 | −$181.66 |
| 0.05 | 62 | $25.01 | −$375.23 |

Fees were $50.31, 1.0 % of the money staked. The result is not a fee result: the 324 trades without a fee lost
21.4 % a dollar.

### Screen price against how often the draw came, all 1,554 matches

The screen price is the last one-minute history point in the 30 minutes before the decision.

| Screen price | Matches | Draws | Rate | Traded | Draws | Rate | Not traded | Rate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.00–0.05 | 1 | 0 | 0.0 % | 1 | 0 | 0.0 % | 0 | — |
| 0.05–0.10 | 19 | 1 | 5.3 % | 19 | 1 | 5.3 % | 0 | — |
| 0.10–0.15 | 75 | 8 | 10.7 % | 74 | 7 | 9.5 % | 1 | 100.0 % |
| 0.15–0.20 | 158 | 21 | 13.3 % | 150 | 21 | 14.0 % | 8 | 0.0 % |
| 0.20–0.25 | 332 | 70 | 21.1 % | 201 | 35 | 17.4 % | 131 | 26.7 % |
| 0.25–0.30 | 667 | 195 | 29.2 % | 50 | 11 | 22.0 % | 617 | 29.8 % |
| 0.30–0.35 | 296 | 85 | 28.7 % | 0 | 0 | — | 296 | 28.7 % |
| 0.35–0.40 | 6 | 2 | 33.3 % | 0 | 0 | — | 6 | 33.3 % |

| League | Matches | Mean screen price | Draw rate | Traded | Mean price | Draw rate | Not traded | Mean price | Draw rate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| La Liga | 441 | 26.0¢ | 24.5 % | 126 | 18.1¢ | 11.1 % | 315 | 29.2¢ | 29.8 % |
| Bundesliga | 339 | 23.4¢ | 23.9 % | 130 | 18.6¢ | 16.2 % | 209 | 26.4¢ | 28.7 % |
| Ligue 1 | 347 | 24.5¢ | 25.1 % | 61 | 16.3¢ | 13.1 % | 286 | 26.3¢ | 27.6 % |
| Serie A | 427 | 26.8¢ | 24.8 % | 178 | 21.9¢ | 18.0 % | 249 | 30.3¢ | 29.7 % |

The buckets' mean prices are 13.0¢, 17.8¢, 22.8¢, 27.4¢ and 31.6¢ from 10¢ to 35¢. Below 25¢ the draws came less
often than their price, by 1.7 to 4.5 points. In the busiest bucket, 25–30¢ (667 matches), they came a little more
often (29.2 % against 27.4¢); from 30¢ up, a little less. The rule never bought above 30¢. Inside the 20–25¢
bucket, the draws it bought came 17.4 % of the time, against 26.7 % for the 131 it skipped. The rule chose between
them only by the league's running rate, which says nothing about the match, and a gap this size can be chance.

### One trade, by hand

Como v Genoa, 15 September 2025, kickoff 18:45 UTC. The Serie A file held 408 matches that kicked off at least four
hours earlier, 114 of them draws: 27.94 %. The screen price an hour before kickoff was 26.0¢, so the floor was
26.1¢. The market had no fee. 27.94 − 26.1 is positive, so the rule buys. The first taker buy of the draw in the
hour came at 18:06:42 UTC, at 27.0¢ for 9.259258 shares ($2.50); the edge at 27.0¢ was still positive. The next came
at 18:18:32 UTC, at 27.0¢; it filled the remaining $7.50, 27.777782 shares. The rule spent $10.00 on 37.037040
shares. The match ended 1–1 and the draw paid 1, so the P&L is +$27.04. `pnl_of` gives the same, and so does the
check below, which read both prints again.

## Checks

* **The code is DRAWBASE's.** `drawbase.py` holds DRAWBASE's functions from commit `31250cab`, each equal to its
  original line for line once the module prefixes are removed. The scorer's self-check prints DRAWBASE's pin,
  `self-check ok D 0.25 88.560401`. On DRAWBASE's committed input (sha256 `772f9690…9a81`) it writes
  `drawbase_run.json` byte for byte (sha256 `07df6a9f…c8`).
* **Determinism.** The scorer, run twice on the committed input, wrote byte-identical output (sha256
  `44724d0e6bb926c4d3ccc9f396ad11b1870c3c40f1da89407dc7beae4d66b7ca`).
* **Fills read again** (`drawx_check.json`). The check drew twenty trades with `random.Random(20260926).sample`. It
  found all 39 of their fills again in `/v2/trades?condition=…&taker_only=true` at their second, never using one
  print for two fills. All 20 payouts and all 20 fee rates agree with a fresh read of Gamma. The largest P&L
  difference is 3.6 × 10⁻¹⁵.
* **Payouts against results.** The draw's payout agrees with football-data's result on all 495 traded matches, and
  on all 1,554 kept.
* **The same matches.** The pull listed the same 1,574 events (sha256 `90bc93a5…f1a4`). The kickoff rule kept the
  same 1,554 (sha256 `0b270cae…0a42`), and dropped the same 20 as appendix B. Differences from the freeze: none.
  Every kept match had a screen price and every tape was complete. `/v2/trades` was never needed.

## The power check, looking back

It assumed DRAWBASE's Premier League rates: 41.7 % of matches selected, 92.4 % of those filled. Here 35.4 % were
selected and 90.0 % filled, which gave 495 trades against a central estimate of about 599. The null's 95th
percentile came out at +$722.59 against the +$752 estimated at 600 trades. So the test had about the power the
pre-registration described: 80 % at an edge of about +6.4 points. The result was about −4.7 points (15.2 % against
19.9¢), on the wrong side of zero.

## Deviations

None from the frozen rule, data, bar or checks. Five points of implementation, none of which changes a number:

1. **Drop reasons.** The pull labels two Ligue 1 playoff matches, `fl1-se-nic-2026-05-26` and `fl1-nic-se-2026-05-29`,
   "kickoff differs" rather than "playoff". Saint-Etienne and Nice met in the 2024-25 league season, so the score
   file has a row for the pair at another date. Appendix B lists the same 20 events.
2. **Home and away prices not read.** DRAWBASE's pull read the home and away markets' screen prices for its other
   rules; its draw rule never reads them. The pull read only the draw's.
3. **A stricter fill check.** The check also re-read each market's fee schedule, and it let no print serve two fills.
4. **A wider payout check.** Payouts were checked against results on all 1,554 kept matches, not only the 495
   traded; there were no disagreements in either.
5. **Extra files.** `drawbase.py` gathers DRAWBASE's functions in one module. `frozen_listed.txt` and
   `frozen_kept.txt` hold the freeze's two slug lists, and each hashes to the value the pre-registration states.
   `pull_report.json` records what the pull read and dropped.

## Order of work (UTC, 2026-09-26)

* 18:34:02: the pre-registration frozen by commit `714a71c0`.
* 18:48:42: the four scripts' sha256 taken, before any read of the pull. None changed after.
* 18:48:49 to about 18:54: the pull, 315 s, with raw reads cached outside the repository.
* Then the scorer twice, then the fill check.

## What follows

DRAWBASE is closed; no paper test follows. This settles item 4 of the fp5 review's list, the one taker near-miss:
the Premier League's 2026 draws were not a mispricing that carries to other leagues.

## Files

All under `docs/agents/backtests/polymarket/drawx/`.

| File | What it is | sha256 |
|---|---|---|
| `drawbase.py` | DRAWBASE's functions, copied from commit `31250cab` | `5a924dc344f7150ab20f6410844812395e2dc52c8883f4b546ae6a42a3c256aa` |
| `drawx_pull.py` | the pull: events, results, the kickoff rule, screen prices, prints | `3bec9b1730c880756425499350eb716004cbe73304edc37684908a72fa0b9da9` |
| `drawx_score.py` | the scorer, with DRAWBASE's pin and its byte-for-byte reproduction | `bef7f23ff5ea8be842da233479779443b081c2167e9d4811427ba275ef4b1501` |
| `drawx_check.py` | the twenty-trade check against fresh reads | `85340377069434b295c994758296ea3ff7b3606785ac2d347e45575013a61d99` |
| `frozen_listed.txt` | the 1,574 events listed at the freeze | `90bc93a55b5d685c5c152694466eb7ce072ac63aa42312142378d709bdcbf1a4` |
| `frozen_kept.txt` | the 1,554 matches kept at the freeze | `0b270caef14143f7aa64bf9785e2699d49562c3aa88b50ea1ee16a1fd82b0a42` |
| `pull_report.json` | what the pull read and dropped, and the differences from the freeze | `553af44270adce3394413dbfbbdaccc469a17b4a759a782cfc450b370446e457` |
| `inputs/drawx_inputs.json.gz` | the scorer's input, 269 KB | `5f0afa157783856db14e1ee35a984d223e951dd200a866e6d88c582ca5e699eb` |
| `drawx.json` | the result, with every hash above it | `44724d0e6bb926c4d3ccc9f396ad11b1870c3c40f1da89407dc7beae4d66b7ca` |
| `drawx_check.json` | the fill check | `9409606f6cee2b04b0af5d41dc185ec03f721f0cf45dcb0d7885068ba4940389` |

To reproduce the result: extract DRAWBASE's committed input and result from commit `31250cab` with the two
`git show` lines at the head of `drawx_score.py`. Then run
`drawx_score.py inputs/drawx_inputs.json.gz drawx.json drawbase_inputs.json.gz drawbase_run.json`.
