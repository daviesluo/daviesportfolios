# Kraken study — is there a rulebook, a holding period, a coin or a fee tier at which Kraken earns real money on its own terms?

Run 2026-09-21T21:07Z. Script `supabase/functions/agents/backtest_kraken.ts`; raw output `docs/agents/backtests/kraken.json`. It extends `docs/agents/reviews/2026-09-21-allocation-study.md` (reference §3.11) question 3 and does not repeat it: the allocation arms are not re-run and the shipped set's own numbers are only reproduced as a check.

**The two operational blockers are gone.** The Kraken account holds USD rather than GBP and the key carries a nonce window (§2b, §4.18), so Kraken *can* trade. The allocation study asked whether it should run the **same** rules and answered no. This asks the different question: **is there a rulebook, a holding period, a coin or a fee tier at which Kraken earns its place?** Four candidate exits from the 80 bps arithmetic are tested — a slower rulebook, a bigger per-trade move, a cheaper fee tier, and a coin Revolut X's UK book cannot carry.

**Two windows, never averaged.** *Window A* = parameters on the first two thirds, the LAST third out of sample (2025-09 → 2026-09, a bear year). *Window B* = parameters on the first third, the MIDDLE third out (2024-09 → 2025-09, a bull year). Each coin is split on its own bar count. Parameters are chosen **once, in sample, on Revolut X costs** (`backtest.ts`'s own rule) and the same rule is then priced on both venues, so the two venue figures differ by costs alone.

**Fidelity — the copy is checked, not asserted.** Everything that can go through `backtest.ts`'s `run` / `runRotation` does: the trend rulebook on 4-hour, **daily** and **weekly** bars is `run` with a different `barHours`, and the slow rotation is `runRotation` with a different `RotationParams`. The one copy is `runLogged` — `run` with the rulebook replaced by a callback (for the Donchian channels and the long-lookback momentum rule, which are not `run` `kind`s) and a per-trade log added. Driven by the shipped decider it must BE `run`:

| check | result |
|---|---|
| `runLogged(shippedDecider)` vs `run` — 5 coins × 2 windows × {trend-4h on 4h bars, momentum-1d on daily bars, the trend rule on daily bars} × both venues | **60 checks, worst \|Δreturn\| 0, \|ΔmaxDD\| 0, \|Δtrades\| 0** |
| the recommended set reproduced (§3.11 §6) | A **−0.3 %** DD **11.8 %** ret/DD **−0.03**; B **+12.6 %** DD **10.2 %** **1.24**; peak open **$100** — §3.11 to the digit |
| `trend-4h` alone on Kraken reproduced (§3.11 §3 "Kraken, four ways") | A −0.4 % DD 14.3 % −0.03; B +4.8 % DD 11.7 % 0.41 — to the digit |
| `rotation-1w-kraken`, the shipped 7-day seed, reproduced (§3.11's correction table) | A −13.2 % DD 35.2 %; B +86.8 % DD 42.8 % — to the digit |
| POL on the **seeded** trend-4h parameters reproduced (§3.11 §3) | A +33.0 %, B −5.2 % — to the digit |
| `trend-4h` two-window clearers reproduced (§3.8's universe bar) | SUI and POL, and nothing else — the same two |

**What is measured rather than assumed.** Kraken's 24-hour book had only ever been read for BTC, ETH and SOL (§2b, probe 2026-09-20), which is why §3.11 could not apply §4.16's $100k-a-day test to a single candidate. It is now measured for **all 27 coins in `COSTS`**, keyless and read-only: `GET /0/public/AssetPairs` once and `GET /0/public/Ticker` eleven times, 60 s apart, 2026-09-21 20:47–20:57 UTC. No private endpoint was called and no key was touched. The backtests still charge `COSTS`' half-spreads (§3.8's medians of 21 samples) so this study's fills stay comparable with every other study's; the new spreads sit beside them as a check.

---

## 0. Kraken's book, measured — and does Coinbase stand in for Kraken's price?

**All 27 coins in `COSTS` are listed on Kraken against USD, and all 27 clear §4.16's $100k a day.** The thinnest is ETC at $327k. `costmin` is $0.50 everywhere and `ordermin` in dollars runs $2.53–$16.26, so **a $20 slot is placeable on every one of them** — with NEAR ($16.26) and UNI ($13.21) leaving the least headroom, which matters only if a partial slot is ever sent.

| coin | Kraken 24 h book | spread median / min / max (bps) | `COSTS` spread (bps) | `ordermin` | `ordermin` in $ | `costmin` | UK book (§3.8) | Kraken-only? |
|---|---|---|---|---|---|---|---|---|
| BTC | $415.9M | 0.011 / 0.011 / 0.012 | 0.010 | 0.00005 | 4.35 | 0.5 | $3.6M | |
| ETH | $211.3M | 0.036 / 0.036 / 0.504 | 0.040 | 0.001 | 2.78 | 0.5 | $3.2M | |
| XRP | $115.5M | 0.522 / 0.065 / 2.218 | 1.000 | 1.65 | 2.53 | 0.5 | $2.6M | |
| SOL | $89.8M | 0.840 / 0.839 / 0.843 | 0.920 | 0.06 | 7.14 | 0.5 | $3.3M | |
| NEAR | $36.0M | 3.924 / 0.248 / 9.187 | 4.560 | 4 | 16.26 | 0.5 | $2.8M | |
| SUI | $36.2M | 2.943 / 0.978 / 5.884 | 3.820 | 5 | 5.11 | 0.5 | $942k | |
| DOGE | $26.1M | 4.587 / 0.010 / 9.286 | 4.400 | 50 | 5.00 | 0.5 | $199k | |
| AVAX | $19.6M | 2.696 / 0.899 / 5.403 | 1.700 | 0.5 | 5.56 | 0.5 | $1.9M | |
| HYPE | $18.5M | 1.071 / 1.069 / 3.207 | 3.170 | 0.1 | 9.34 | 0.5 | $123k | |
| ADA | $15.8M | 4.309 / 3.414 / 6.119 | 4.100 | 20 | 4.92 | 0.5 | $122k | |
| PEPE | $15.0M | 4.105 / 4.064 / 8.142 | 4.700 | 1.5M | 7.37 | 0.5 | $102k | |
| UNI | $14.8M | 4.310 / 2.724 / 7.844 | 6.592 | 1.5 | 13.21 | 0.5 | $159k | |
| LTC | $13.5M | 3.212 / 1.602 / 6.423 | 4.792 | 0.1 | 6.24 | 0.5 | $44k | **yes** |
| LINK | $13.2M | **3.028** / 0.008 / 5.883 | **0.100** | 0.55 | 7.24 | 0.5 | $693k | |
| XLM | $7.7M | 3.326 / 2.393 / 5.455 | 3.226 | 30 | 6.43 | 0.5 | $176k | |
| AAVE | $5.5M | 8.863 / 4.756 / 12.908 | 8.190 | 0.05 | 7.35 | 0.5 | $54k | **yes** |
| BCH | $3.9M | 7.470 / 5.256 / 11.198 | 8.216 | 0.01 | 2.67 | 0.5 | $928k | |
| HBAR | $3.5M | 4.349 / 3.259 / 4.373 | 6.604 | 55 | 5.06 | 0.5 | $114k | |
| BNB | $2.6M | 0.872 / 0.497 / 1.492 | 1.394 | 0.007 | 5.63 | 0.5 | $19k | **yes** |
| POL | $2.3M | 8.963 / 8.056 / 16.992 | 15.932 | 50 | 5.59 | 0.5 | $11k | **yes** |
| ALGO | $2.2M | 6.245 / 2.676 / 9.822 | 7.020 | 41 | 4.60 | 0.5 | $180k | |
| ICP | $2.2M | 6.757 / 6.734 / 10.103 | 6.800 | 2 | 5.94 | 0.5 | $171k | |
| SHIB | $1.8M | 3.348 / 1.677 / 6.678 | 3.516 | 770k | 4.60 | 0.5 | $11k | **yes** |
| DOT | $1.4M | 3.377 / 0.845 / 5.930 | 6.770 | 3.9 | 4.61 | 0.5 | $769k | |
| TON | $1.2M | 6.866 / 6.866 / 13.755 | 7.044 | 3.5 | 5.10 | 0.5 | $8k | **yes** |
| ATOM | $666k | 11.061 / 7.218 / 12.173 | 10.624 | 3.5 | 6.32 | 0.5 | $17k | **yes** |
| ETC | $327k | 17.048 / 15.895 / 22.732 | 17.106 | 0.7 | 6.16 | 0.5 | $8k | **yes** |

Measured and `COSTS` agree within a basis point or two on 26 of 27. The exception is **LINK, where `COSTS` charges 0.10 bps and today's median is 3.03** — §3.8's one snapshot caught an unusually tight moment. A LINK round trip on Kraken is therefore ~83.0 bps, not the 80.10 the tables say; against 80 bps of fee the correction changes nothing, and it is recorded rather than quietly used.

**Does Coinbase's series stand in for Kraken's price?** `backtest.ts` answers that for Revolut X and nothing had ever answered it for Kraken. From `GET /0/public/OHLC?interval=240` — 720 candles is the ceiling (§2b) — against the same bars resampled from this study's Coinbase data, |Δclose| in bps over the ~710–719 overlapping 4-hour bars:

| | BTC | ETH | SOL | XRP | LINK | AVAX | SUI | NEAR |
|---|---|---|---|---|---|---|---|---|
| median | 0.93 | 1.09 | 1.33 | 1.16 | 3.42 | 5.33 | 4.15 | 6.11 |
| p95 | 3.24 | 4.10 | 5.48 | 4.96 | 12.10 | 17.03 | 15.29 | 22.94 |
| max | 17.33 | 15.96 | 61.52 | 31.83 | 46.38 | 365.29 | 214.10 | 219.64 |

A median 1–6 bps against a round trip of 80–96. The substitution costs far less than the thing being measured; the maxima are single bars where one venue printed a wick the other did not.

---

## 1. Is there a slower rulebook that carries 80 bps?

Seven rulebooks, 27 coins, two windows, both venues, 12,492 out-of-sample grid evaluations. `trend-4h` is the anchor. Every figure below is the **median over the coins**, Kraken costs first and Revolut X's beside it, with the plateau on Kraken's own costs (an edge has neighbours; a fit does not).

| rulebook | bar | grid | A: Kraken / revx / DD / trades / plateau | B: Kraken / revx / DD / trades / plateau | median hold | fills/slot/y |
|---|---|---|---|---|---|---|
| `trend-4h` (shipped) | 4h | 27 | −4.4 % / −2.0 % / 17.7 % / 12 / 26 % | +2.0 % / +7.6 % / 22.1 % / 14 / 59 % | **3.2 d** | 19.5 |
| `trend-4h-wide` (slow 200/300, breakout 100/200, ATR 4/6) | 4h | 8 | −4.6 % / −3.5 % / 16.8 % / 6 / 12 % | +11.5 % / +14.4 % / 23.3 % / 10 / 50 % | **4.9 d** | 13.5 |
| `trend-1d` (the 200-day trend among them) | 1d | 36 | 0.0 % / 0.0 % / 8.8 % / **2** / 0 % | 0.0 % / 0.0 % / 19.9 % / **4** / 39 % | **9.5 d** | 3.3 |
| `trend-1w` | 1w | 24 | 0.0 % / 0.0 % / 5.4 % / **1** / 19 % | +2.1 % / +2.7 % / 22.8 % / **2** / 52 % | **14.0 d** | 2.9 |
| `donchian-1d` (50/100/200 in, 20/50 out) | 1d | 12 | 0.0 % / 0.0 % / 15.6 % / **2** / 17 % | −8.8 % / −8.2 % / 41.7 % / 5 / 50 % | **21.0 d** | 4.6 |
| `donchian-1w` (8/13/26 in, 4/8 out) | 1w | 12 | 0.0 % / 0.0 % / 2.5 % / **1** / 17 % | +1.1 % / +2.2 % / 34.9 % / 4 / 29 % | **35.0 d** | 3.1 |
| `momentum-long` (90 / 180 / 365-day lookback) | 1d | 6 | −22.9 % / −18.8 % / 33.4 % / 9 / 0 % | +3.2 % / +5.8 % / 54.6 % / 11 / 50 % | **6.0 d** | 13.2 |

**Slowing down does close the break-even gap.** At a 30 %-a-year drift a Kraken major's 80.01 bps round trip pays itself back in 9.73 days and POL's 95.93 bps in 11.67; `trend-1d` holds 9.5 days, `trend-1w` 14.0, `donchian-1d` 21.0 and `donchian-1w` 35.0. The fee bill falls with it: from 7.81 % of the slot a year on `trend-4h` to 1.15–1.85 % on the slow four.

**And it buys nothing, because it destroys the sample.** A slow rulebook's window contains **1 to 5 trades**, and 8–14 of its 44 or 54 coin-windows contain **no trade at all** (a 0.0 % median return is a rule that never entered): `trend-1d` 12 of 54, `trend-1w` 14 of 44, `donchian-1d` 8 of 54, `donchian-1w` 10 of 44 — 51 of the study's 353 in total. §3.9 already said this of weekly bars — "one or two trades a year, from which no edge can be estimated" — and this is the same finding on daily bars, on Donchian channels and on a 12-month momentum rule.

**The bar, on Kraken's costs, against chance.** §4.15's four tests on both windows, applied from Kraken's point of view as §4.16 requires. Beside the observed count is what chance alone would give: if a coin's two windows were independent draws, the number clearing both is (coins × the share that cleared A × the share that cleared B).

| rulebook | coins | clears A | clears B | **clears BOTH** | **expected by chance** | coin-windows with no trade |
|---|---|---|---|---|---|---|
| `trend-4h` | 27 | 7 | 13 | 2 — SUI, POL | 3.37 | 1 |
| `trend-4h-wide` | 27 | 10 | 13 | 2 — SOL, AVAX | 4.81 | 2 |
| `trend-1d` | 27 | 6 | 10 | 2 — ETH, AVAX | 2.50 | 12 |
| `trend-1w` | 22 | 6 | 8 | 1 — ETH | 2.18 | 14 |
| `donchian-1d` | 27 | 4 | 5 | 2 — ETH, HYPE | 0.74 | 8 |
| `donchian-1w` | 22 | 4 | 4 | 2 — BTC, ETH | 0.73 | 10 |
| `momentum-long` | 27 | 2 | 3 | 1 — BNB | 0.24 | 4 |
| **total** | | **39** | **56** | **12** | **14.57** | **51** |

**Twelve two-window passes where chance alone gives 14.6.** The search found fewer than it would have found in noise.

And the passes themselves are one or two trades wide:

| rulebook · coin | A: Kraken / DD / trades / plateau | B: Kraken / DD / trades / plateau | median hold A / B |
|---|---|---|---|
| `trend-4h`·SUI | +10.1 % / 28.1 % / 19 / 78 % | +0.8 % / 27.2 % / 10 / 70 % | 1.3 d / 1.0 d |
| `trend-4h`·POL | +6.6 % / 7.2 % / 12 / 100 % | +14.2 % / 10.8 % / 14 / 52 % | 1.2 d / 0.8 d |
| `trend-4h-wide`·AVAX | +27.1 % / 13.9 % / 7 / 100 % | +77.0 % / 25.5 % / 11 / 100 % | 6.0 d / 8.0 d |
| `trend-4h-wide`·SOL | +13.6 % / 16.1 % / 11 / 100 % | +11.5 % / 28.7 % / 19 / 75 % | 11.2 d / 10.5 d |
| `trend-1d`·ETH | +14.2 % / 5.1 % / **1** / 56 % | +55.1 % / 23.0 % / 5 / 83 % | **never closed** / 22 d |
| `trend-1d`·AVAX | +13.4 % / 0.0 % / **1** / 67 % | +37.9 % / 21.6 % / 5 / 83 % | **never closed** / 16 d |
| `trend-1w`·ETH | +14.2 % / 4.6 % / **1** / 75 % | +17.2 % / 23.9 % / 3 / 100 % | **never closed** / 56 d |
| `donchian-1d`·ETH | +2.1 % / 10.6 % / 3 / 92 % | +85.2 % / 19.3 % / 5 / 58 % | 29 d / 52 d |
| `donchian-1d`·HYPE | +28.8 % / 12.5 % / **1** / 100 % | +10.6 % / 28.8 % / 2 / 100 % | **never closed** / 23 d |
| `donchian-1w`·BTC | +5.4 % / 12.0 % / 3 / 58 % | +44.4 % / 19.2 % / 3 / 83 % | 35 d / 133 d |
| `donchian-1w`·ETH | +2.6 % / 5.0 % / **1** / 100 % | +7.0 % / 30.6 % / 5 / 100 % | **never closed** / 38.5 d |
| `momentum-long`·BNB | +19.1 % / 7.5 % / **3** / 100 % | +1.3 % / 6.7 % / **3** / 100 % | 8.0 d / 1.0 d |

**Five of the twelve pass window A on a single entry that never closed inside it** — the window's whole return is one open position marked to the last bar, which is a direction, not a round trip. BNB's 112-day thirds are the short-history problem §3.8 already flagged.

**Every rulebook clears the Kraken bar on exactly the coins it clears the Revolut X bar on.** Seven rulebooks, 27 coins, two windows — and the two lists are identical in every case. **No coin anywhere prefers Kraken.** §3.11 said the same on 2 rulebooks and 8 coins; it holds on 7 and 27.

**The floor, widened.** Because `tick.ts` reads `maxLossPct` from the row's own params, a slow rulebook can carry a wider floor, and §3.9 blamed the 8 % floor for weekly bars' losses ("sized for 4-hour bars, hit intra-bar almost by construction"). Both floors are in every slow grid. The 20 % floor beats the 8 % one on 5/51 coin-windows (`trend-1d`), 8/44 (`trend-1w`), **20/54 (`donchian-1d`, median −5.7 % → 0.0 %)**, 5/44 (`donchian-1w`) and 14/52 (`momentum-long`). It helps the Donchian rule and nothing else, and it does not turn a failure into a pass anywhere.

**A slower rotation.** `runRotation` itself, at 60 / 90 / 180-day lookbacks, top 1 / 2, and 30 / 60 / 90-day minimum holds — the shape §3.4 found was "the only shape whose two venues come out close":

| window | chosen | Kraken | Revolut X | Kraken tier 2 | turnover | plateau | the shipped 7-day seed on Kraken | clears? |
|---|---|---|---|---|---|---|---|---|
| A | 90 d / top 2 / 60-day hold | −24.2 % DD 45.5 % (32 trades) | −21.0 % DD 43.4 % | −23.2 % | 10.2×/y | 0 % | −13.2 % DD 35.2 % | **no** — all four tests |
| B | 90 d / top 1 / 30-day hold | +12.5 % DD 61.0 % (29 trades) | +22.6 % DD 59.4 % | +15.8 % | 25.3×/y | 83 % | +86.8 % DD 42.8 % | **no** — drawdown ≥ 35 % |

Slowing the rotation down cuts its turnover from the shipped row's 26×/y to 10.2×/y in window A (25.3×/y in B, where the chosen point is top 1 with a 30-day hold) and makes it **worse on both windows** than the 7-day seed already running in paper — −24.2 % against −13.2 %, +12.5 % against +86.8 %. Nothing there.

---

## 2. What a Kraken round trip actually needs

Every closed round trip of every coin-window pooled, on Kraken's fills, as the **gross** move before any spread or fee — which is what the cost has to be paid out of. A round trip on Kraken is 80.01 bps (BTC/ETH) to 95.93 (POL); on Revolut X 19.50 to 53.52.

| rulebook | trades | p10 | p25 | **median** | p60 | p75 | p90 | **mean** | win rate | **clears 96 bps** | **clears 192 bps** | clears 20 bps |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `trend-4h` | 362 | −677 | −450 | **−174** | −22 | +355 | +1222 | **+226** | 40 % | **34 %** | **31 %** | 38 % |
| `trend-4h-wide` | 238 | −797 | −628 | **−227** | −29 | +314 | +2306 | **+568** | 38 % | **34 %** | **31 %** | 38 % |
| `trend-1d` | 69 | −800 | −798 | **−796** | −665 | +362 | +2128 | **+196** | 29 % | **29 %** | **28 %** | 29 % |
| `trend-1w` | 34 | −1993 | −800 | **−796** | −751 | +1510 | +6016 | **+2013** | 38 % | **38 %** | **38 %** | 38 % |
| `donchian-1d` | 95 | −1997 | −1100 | **−798** | −797 | −472 | +2265 | **+50** | 21 % | **19 %** | **18 %** | 20 % |
| `donchian-1w` | 45 | −1998 | −1152 | **−800** | −799 | −797 | +3343 | **+468** | 22 % | **22 %** | **22 %** | 22 % |
| `momentum-long` | 292 | −800 | −798 | **−441** | −266 | −99 | +423 | **+34** | 21 % | **18 %** | **15 %** | 20 % |

All figures in bps.

**The median round trip loses money before any fee on every rulebook**, as §3.11 found on the three that existed then. What the full distribution adds:

- **The share clearing 96 bps and the share clearing 20 bps are nearly the same number** — 34 % against 38 % for `trend-4h`, 29 against 29 for `trend-1d`, 22 against 22 for `donchian-1w`. The distribution is bimodal: a trade is either stopped near the floor (−798 bps is the 8 % floor, and it is the median of four rulebooks) or it runs a long way. **Almost no trade lives between the two venues' costs.** So Kraken's extra 60 bps does not disqualify marginal winners; it is simply subtracted from every round trip — 9.76 round trips a year × 60.5 bps = **5.9 % of the slot a year**, which is §3.11's 5.8 % reproduced.
- **A rule whose 60th-percentile trade clears the cost does not exist here.** `trend-4h` reaches 96 bps at its **66th** percentile and 192 bps at its 69th; `donchian-1d` at its **81st** and 82nd; `momentum-long` at its **82nd** and 85th. In every rulebook, roughly the best third of trades pays for the other two thirds and the fee.
- **"The mean beats a Kraken round trip" is not a measurement at these sample sizes.** The distribution's standard deviation is 2,058–6,668 bps, so the mean's standard error is 108–1,144 bps — **larger than the entire Kraken round trip in every one of the seven**:

| rulebook | trades | mean (bps) | sd | s.e. of the mean | t vs an 82 bps Kraken round trip | t vs a 20 bps Revolut X round trip |
|---|---|---|---|---|---|---|
| `trend-4h` | 362 | +226 | 2058 | 108 | **1.33** | 1.90 |
| `trend-4h-wide` | 238 | +568 | 3460 | 224 | **2.17** | 2.44 |
| `trend-1d` | 69 | +196 | 2177 | 262 | **0.43** | 0.67 |
| `trend-1w` | 34 | +2013 | 6668 | 1144 | **1.69** | 1.74 |
| `donchian-1d` | 95 | +50 | 3631 | 373 | **−0.09** | 0.08 |
| `donchian-1w` | 45 | +468 | 3937 | 587 | **0.66** | 0.76 |
| `momentum-long` | 292 | +34 | 3300 | 193 | **−0.25** | 0.07 |

Only `trend-4h-wide` clears t = 2, and it is the rulebook chosen from an 8-point grid over 27 coins. Per trade, net of cost, the shipped `trend-4h` keeps **+144 bps on Kraken against +206 bps on Revolut X** — Kraken keeps 70 % of what the same trade keeps on the cheaper venue, which is why the twins are 3.0–16.8 points worse a window rather than catastrophically worse.

---

## 3. The fee tier

Tier 1 is 0.40 / 0.80; tier 2 is **0.30 / 0.60 at $2,500 of 30-day volume**; maker reaches 0 % only at $10M (§2b). Volume here is traded notional as a live row actually sends it: an entry trades one slot and its exit trades that slot grown by the trade's own net return. The last column prices the identical fill count on Revolut X at 9 bps taker plus BTC's 0.75 bps half-spread, per fill.

| rulebook | fills / slot / year | **30-day volume at five $20 slots** | multiple of turnover needed for $2,500 | capital at which the recommended row reaches $2,500 | fee a year at tier 1 | at tier 2 | the same rule on Revolut X |
|---|---|---|---|---|---|---|---|
| `trend-4h` | 19.52 | **$160** | 15.6× | **$1,558** | 7.81 % | 5.86 % | 1.90 % |
| `trend-4h-wide` | 13.53 | $111 | 22.5× | $2,248 | 5.41 % | 4.06 % | 1.32 % |
| `momentum-long` | 13.15 | $108 | 23.1× | $2,312 | 5.26 % | 3.95 % | 1.28 % |
| `donchian-1d` | 4.62 | $38 | 65.9× | $6,591 | 1.85 % | 1.38 % | 0.45 % |
| `trend-1d` | 3.31 | $27 | 91.8× | $9,175 | 1.33 % | 0.99 % | 0.32 % |
| `donchian-1w` | 3.05 | $25 | 99.7× | $9,973 | 1.22 % | 0.92 % | 0.30 % |
| `trend-1w` | 2.87 | $24 | 106.0× | $10,598 | 1.15 % | 0.86 % | 0.28 % |

**No configuration this account can run reaches $2,500 a month.** The recommended shape generates **$160**, and the *slower* candidates — the ones that would make the fee bearable — generate $24–$38, further away, not nearer.

**Trading more to reach the tier is a bill, not a strategy, and the arithmetic is an identity.** $2,500 of 30-day volume on $100 of capital is $30,417 a year, which is **304× turnover**, which at the *discounted* 0.30 % maker fee is **91.2 % of the account a year in fees**. That number is the same for every rulebook in the table because it does not depend on the rule at all — it is what $100 turning over 304 times costs. The only honest route to tier 2 is **more capital**: $1,558 in the recommended shape, at which the fee falls from 7.81 % to 5.86 % of the book a year — a saving of **1.95 points** on a book **15.6× larger than the one being discussed**, and still **3.1× Revolut X's 1.90 %**. The Kraken account holds about $100.

Re-pricing the candidates at 0.30 / 0.60 changes no verdict: over the twelve two-window clearers, tier 2 adds **+0.11 to +2.13 points** per window (SOL on `trend-4h-wide` +1.3 / +2.1; SUI on `trend-4h` +2.1 / +1.0; POL +1.3 / +1.6; ETH on `donchian-1d` +0.3 / +1.0). Not one changes a pass into a different answer, and not one closes the gap to the same rule on Revolut X.

---

## 4. Coins Kraken has and Revolut X's UK book cannot carry

With Kraken's book finally measured, §4.16's test can be applied. **Eight coins clear $100k a day on Kraken while their Revolut X UK book does not**: BNB ($19k UK), LTC ($44k), TON ($8k), SHIB ($11k), AAVE ($54k), ETC ($8k), POL ($11k), ATOM ($17k). All eight are placeable at a $20 slot.

§4.16 has such a coin joining `trend-4h-kraken` **by its own migration**, which means it runs that row's **seeded** parameters — the distinction §3.11 drew about POL, and the one that turned its pass into a fail. On the seeded parameters, Kraken costs, both windows:

| coin | history | Kraken book | window A | window B | clears both? |
|---|---|---|---|---|---|
| POL | 2.05 y | $2.3M | **+33.0 %** — clears | **−5.2 %** — fails | **no** |
| BNB | 0.91 y | $2.6M | +7.7 % — clears | −17.4 % — fails | **no** |
| ETC | 3 y | $327k | +4.7 % — clears | −6.3 % — fails | **no** |
| TON | 0.84 y | $1.2M | −8.2 % — fails | +22.0 % — clears | **no** |
| SHIB | 3 y | $1.8M | −4.4 % — fails | +9.3 % — clears | **no** |
| AAVE | 3 y | $5.5M | −6.8 % — fails | −1.6 % — fails | **no** |
| LTC | 3 y | $13.5M | −12.4 % — fails | −9.0 % — fails | **no** |
| ATOM | 3 y | $666k | −15.4 % — fails | −16.1 % — fails | **no** |

**Zero of eight.** POL reproduces §3.11's +33.0 % / −5.2 % exactly.

On **parameters chosen in sample** — §3.7 / §3.8's own method for a new candidate — POL does clear both windows on Kraken costs (A +6.6 %, DD 7.2 %, 12 trades, plateau 100 %; B +14.2 %, DD 10.8 %, 14 trades, plateau 52 %), and so does BNB on `momentum-long` at a 90-day lookback (A +19.1 %, B +1.3 %, **three trades each**, 112-day thirds). Both sit inside the 12-against-14.6 count above, POL's thirds are 8-month slices on 2.05 years of history, and POL is the one coin whose in-sample choice and seeded record disagree by 26 points in window A. **Neither is a candidate; both are watches.**

The rest of §4.16's named candidates cannot be reached at all: ZEC, XMR and TRX are not in `COSTS` and have no Coinbase series in this study's data, so `spreadOf` refuses them rather than guessing (§3.8 named them for exactly this reason). Whether Kraken lists them was not measured here — the book measurement covers the 27 coins `COSTS` already prices, because a book without a spread and a price series cannot be backtested anyway.

---

## 5. What to put on Kraken, and at what size

The test is not "is it positive" but "does it improve the SET on both windows", ranked by the **worse** of the two — the only ranking an all-or-nothing decision can use (§3.11 question 2). The set is `trend-4h` · Revolut X · BTC/ETH/SOL/AVAX/SUI · five equal $20 slots · $100. `agent_risk` caps are **per venue account**, so a Kraken row's $20 slots and $100 exposure are the Kraken account's own and take nothing from Revolut X.

Every Kraken row that cleared the bar on both windows, added to the set — and beside it **the identical rulebook, coins and parameters on Revolut X's costs**:

| Kraken row added | set A | set B | **worse** | the same row on Revolut X: A / B / worse | Revolut X possible? |
|---|---|---|---|---|---|
| *(nothing — §3.11's recommendation)* | **−0.3 %** | **+12.6 %** | **−0.03** | — | — |
| `trend-4h-wide` · SOL + AVAX | +6.0 % | +21.2 % | 0.53 | +6.7 % / +22.4 % / **0.62** | yes |
| `donchian-1d` · ETH + HYPE | +4.2 % | +26.2 % | 0.46 | +4.4 % / +26.5 % / **0.48** | yes |
| `trend-1d` · ETH + AVAX | +3.7 % | +23.5 % | 0.44 | +3.8 % / +23.8 % / **0.45** | yes |
| `donchian-1d` · HYPE | +4.3 % | +18.4 % | 0.44 | +4.4 % / +18.4 % / **0.44** | yes |
| `trend-4h-wide` · AVAX | +4.4 % | +21.8 % | 0.39 | +4.7 % / +22.3 % / **0.42** | yes |
| `momentum-long` · BNB | +2.8 % | +10.9 % | 0.28 | +2.9 % / +11.0 % / **0.30** | **no** — $19k UK book |
| `trend-4h` · SUI + POL | +2.9 % | +14.2 % | 0.25 | +3.9 % / +14.8 % / **0.33** | POL no — $11k |
| `trend-1d` · ETH | +2.1 % | +19.1 % | 0.22 | +2.2 % / +19.4 % / **0.22** | yes |
| `trend-1w` · ETH | +2.1 % | +15.3 % | 0.21 | +2.2 % / +15.5 % / **0.22** | yes |
| `trend-4h-wide` · SOL | +2.3 % | +13.5 % | 0.20 | +2.8 % / +14.4 % / **0.25** | yes |
| `trend-1d` · AVAX | +1.9 % | +18.9 % | 0.20 | +2.0 % / +19.0 % / **0.20** | yes |
| `trend-4h` · SUI | +2.3 % | +13.8 % | 0.17 | +2.9 % / +14.0 % / **0.22** | yes |
| `donchian-1w` · BTC + ETH | +1.2 % | +18.4 % | 0.13 | +1.3 % / +18.6 % / **0.16** | yes |
| `trend-4h` · POL | +0.9 % | +13.3 % | 0.09 | +1.3 % / +13.7 % / **0.13** | **no** — $11k UK book |
| `donchian-1w` · BTC | +0.9 % | +17.5 % | 0.09 | +1.0 % / +17.7 % / **0.10** | yes |
| `donchian-1d` · ETH | +0.4 % | +22.7 % | 0.03 | +0.5 % / +23.0 % / **0.05** | yes |
| `donchian-1w` · ETH | +0.2 % | +14.4 % | 0.02 | +0.3 % / +14.6 % / **0.03** | yes |
| `trend-4h-kraken`, the shipped twin | −0.4 % | +8.7 % | **−0.03** | (the recommended row doubled) | yes |

**Revolut X beats Kraken in 18 of 18 pairs, on both windows, without exception.** There is no rulebook, coin or parameter set in this study for which putting the trade on Kraken is better than putting the same trade on Revolut X. Kraken is never a choice; it is a 60 bps handicap on a trade that could have been placed elsewhere — except on the eight coins Revolut X's UK book cannot carry, and none of those clears the bar on the parameters a row would run.

**The rows that improve the set are the rows this study selected by looking at the windows it then scored them on.** That is the whole of their advantage: 12 two-window passes against 14.6 expected by chance, five of them resting on a single entry that never closed. The one Kraken configuration **not** chosen that way — the shipped twin, which was seeded before any of this — makes the set worse on both windows (A −0.4 % against −0.3 %, B +8.7 % against +12.6 %).

### The recommendation

| | row | venue | coins | row capital | slot | parameters |
|---|---|---|---|---|---|---|
| **recommended** | `trend-4h` | Revolut X (UK book) | BTC, ETH, SOL, AVAX, SUI | **$100** | **$20 × 5, equal** | unchanged |
| | **Kraken** | — | — | **$0 of real money** | — | every Kraken row stays in paper; `trend-4h-kraken`, `momentum-1d-kraken` and `rotation-1w-kraken` keep supplying the signal and the fill measurement |

| | capital | A return | A DD | A ret/DD | B return | B DD | B ret/DD | peak open A / B | 30-day volume A |
|---|---|---|---|---|---|---|---|---|---|
| **recommended (nothing on Kraken)** | $100 | **−0.3 %** | **11.8 %** | **−0.03** | **+12.6 %** | **10.2 %** | **1.24** | $100 / $100 | $156 |
| + the shipped Kraken twin at $100 | $200 | −0.4 % | 13.0 % | −0.03 | +8.7 % | 10.9 % | 0.80 | $200 / $200 | $311 |
| the best searched Kraken row (`trend-4h-wide`·SOL+AVAX, $40) | $140 | +6.0 % | 11.2 % | 0.53 | +21.2 % | 10.3 % | 2.05 | $140 / $120 | $185 |
| …the same row on Revolut X instead | $140 | +6.7 % | 10.9 % | 0.62 | +22.4 % | 10.1 % | 2.21 | $140 / $120 | $185 |
| that Kraken row alone, on the Kraken account's own $40 | $40 | +21.7 % | 12.0 % | 1.80 | +42.5 % | 12.7 % | 3.33 | $40 / $40 | $29 |

**Caps: nothing has to be raised, because nothing is being added.** The recommendation is §3.11's, unchanged: biggest order $20 (`max_order_usd` = 20), peak simultaneous open notional $100 (`max_exposure_usd` = 100). Had a Kraken row been recommended at five $20 slots it would also have fitted without raising either, since `agent_risk` is per venue account — the constraint on Kraken was never the cap, and is not the USD conversion or the nonce window either. It is 80 bps.

---

## Verdicts

1. **Is there a slower rulebook that carries 80 bps? No.** Seven rulebooks over 27 coins and two windows produce **12 two-window passes where chance alone gives 14.6**. Slowing down does what it is supposed to do to the *cost* — the median hold rises from 3.2 days to 9.5 / 14.0 / 21.0 / 35.0, clearing the 9.73-day break-even a Kraken major needs at a 30 % drift, and the fee falls from 7.81 % of the slot a year to 1.15–1.85 % — and it destroys the sample doing it: 1–5 trades a window, 51 of 353 coin-windows with **no trade at all**, and five of the twelve passes resting on a single entry that never closed inside its window. **§3.9's weekly-bar finding is confirmed and extended**: a longer look-back does not rescue weekly bars (1–2 trades a window, one two-window pass against 2.18 expected), and the same is now true of daily bars, of bare Donchian channels and of 3 / 6 / 12-month momentum. The slow rotation is worse on both windows than the 7-day seed already in paper.
2. **What does a Kraken round trip need? More than any of these rules reliably delivers.** The median round trip is negative on every rulebook (−174 to −800 bps). `trend-4h` reaches 96 bps at its **66th percentile** and 192 bps at its 69th; `donchian-1d` at its 81st; `momentum-long` at its 82nd. The share clearing 96 bps is within 4 points of the share clearing 20 bps on every rulebook — the distribution is bimodal, so Kraken's extra 60 bps does not remove marginal winners, it is subtracted from all 9.76 round trips a year (5.9 % of the slot). And **"the mean beats the cost" is not a measurement**: with a standard deviation of 2,058–6,668 bps the mean's standard error is 108–1,144, so t against an 82 bps round trip is **1.33** for `trend-4h`, **0.43** for `trend-1d`, **−0.09** for `donchian-1d` and **−0.25** for `momentum-long`.
3. **The fee tier does not arrive.** The recommended shape generates **$160 of 30-day volume**; tier 2 needs $2,500, which is **15.6× more turnover or $1,558 of capital** against an account holding about $100 — and the slower rulebooks generate $24–$38, further away. **Trading to reach the tier is an identity, not a strategy**: $2,500 a month on $100 is 304× turnover a year, which at the *discounted* 0.30 % maker is **91.2 % of the account a year in fees**. At tier 2 the twelve clearers gain **+0.11 to +2.13 points** a window and not one of them changes side.
4. **Kraken's book is now measured, and there is still no Kraken-only coin.** All 27 coins in `COSTS` are listed on Kraken and all 27 clear §4.16's $100k a day (thinnest ETC, $327k); `costmin` is $0.50 and `ordermin` is $2.53–$16.26, so a $20 slot is placeable on every one. **Eight coins clear on Kraken while failing Revolut X's UK book** — BNB, LTC, TON, SHIB, AAVE, ETC, POL, ATOM — and on the seeded parameters a row would run, **zero of the eight clear the bar on both windows**. POL (+33.0 % / −5.2 %) and BNB (+7.7 % / −17.4 %) fail window B; TON and SHIB fail window A; the other four fail both. On in-sample-chosen parameters POL and BNB do pass, on 8-month and 112-day thirds respectively, and both sit inside the 12-against-14.6 count.
5. **Put nothing on Kraken. The recommendation is §3.11's, unchanged: `trend-4h` · Revolut X · BTC/ETH/SOL/AVAX/SUI · five equal $20 slots · $100, and $0 of real money on Kraken.** The decisive number is that **Revolut X beats Kraken in 18 of 18 paired comparisons, on both windows, without a single exception** — the same rulebook, the same coins, the same parameters, 60 bps cheaper. The Kraken rows that *do* improve the set are the ones this study chose by looking at the windows it scored them on; the one Kraken configuration seeded before the search, the `trend-4h` twin, makes the set worse on both windows (−0.4 % / +8.7 % against −0.3 % / +12.6 %). Nothing has to be raised in `agent_risk`, and the USD conversion and the nonce window did not change the answer — they removed the two reasons Kraken *couldn't* trade and left the one reason it shouldn't.

**What would change my mind**, in either direction: a third window (a sideways year rather than one bear and one bull) on which `trend-4h-wide` holds up on SOL and AVAX — it is the one rulebook whose mean round trip clears a Kraken round trip at t > 2, and the one whose passes are 7–19 trades wide rather than one; a Kraken fee tier reached by capital the account actually has rather than by turnover; a quarter of paper in which the Kraken twins' **fills** differ from the backtest's post-only assumption in Kraken's favour (that is the one thing a backtest cannot see and the twins exist to measure); or a coin listed on Kraken and not on Revolut X's UK book that clears the bar on both windows **on seeded parameters** — POL is the nearest, and it is 26 points away from itself.

---

## Caveats — all of them

- **Window A is one bear year and window B is one bull year.** Nothing here estimates a return; each column is one draw, and the two windows disagree about almost every candidate — which is the finding, not a defect.
- **The whole study is a search, and it is scored on the windows it searched.** 7 rulebooks × 27 coins × 2 windows × up to 36 grid points is **12,492 out-of-sample evaluations**. The chance column in §1 is the control, and it is the reason the answer is no: 12 observed against 14.57 expected. That control assumes the two windows are independent draws for a coin, which flatters neither side — a coin with a real edge would pass both more often than the product, and none does.
- **Five of the twelve two-window passes rest on a single entry that never closed** inside window A, and 51 of 353 coin-windows contain no trade at all. Nothing under about twenty round trips separates a rule from luck (§3.11's own caveat), and the slow rulebooks are two orders of magnitude short of that.
- **The parameters are chosen in sample on Revolut X costs**, per `backtest.ts`'s rule, so a rulebook that would have preferred different parameters on Kraken's costs is not given them. The plateau IS computed on each venue's own costs, so the robustness half of the bar is Kraken's; the point itself is not. Choosing on Kraken costs instead would be choosing and scoring on the same venue's noise.
- **The Kraken book is one ten-minute window on a Monday evening** — eleven samples 60 s apart, 2026-09-21 20:47–20:57 UTC. `ordermin`, `costmin` and the pair list are from one `AssetPairs` call the same minute. §3.8's UK-book figures it is compared against are a different twenty-minute window that afternoon. A book measured at one hour is not a book under stress.
- **`COSTS` and the new measurement disagree materially on LINK** (0.10 bps against 3.03). The backtests charge `COSTS`, so LINK's Kraken cost is understated by ~3 bps of round trip in every table here. It changes nothing against 80 bps of fee and it is recorded rather than used quietly.
- **Coinbase stands in for Kraken's price**, within a median 0.93–6.11 bps on the eight coins checked (p95 3.2–22.9, max 0.6–3.7 %). That is small against 80–96 bps of cost and large against a 1 bps spread, so nothing in this study would survive being repriced bar by bar on Kraken's own candles — but nothing in it turns on a single bar either. Kraken's own full history (the quarterly OHLCVT bundle, §2b) has still never been pulled; it is the right source for the next round and was out of scope here.
- **Short histories.** HYPE 0.62 y, TON 0.84 y, BNB 0.91 y, PEPE 1.85 y, POL 2.05 y — their thirds are 8-month, 4-month and 112-day slices, and three of the twelve passes (HYPE, BNB, POL) are on them. The five shortest are excluded from the weekly rulebooks entirely (22 coins, not 27), which is why those rows have a different denominator.
- **The universe is the 27 coins `COSTS` already prices.** Kraken lists hundreds of USD pairs; this study measured the book for 27 of them, because the other requirement — a measured half-spread on both venues and three years of hourly candles — exists only for those. A Kraken-only coin outside that set has not been ruled out; it has not been looked at.
- **The 27 coins move together.** Seven long-only crypto trend rulebooks over 27 correlated coins is far fewer independent tests than 189 looks suggests, which cuts both ways: it inflates the pass count and it also means one bad year is one observation.
- **The break-even arithmetic assumes a constant drift** (30 % and 100 % a year) applied to a median hold. Real trend returns are not a drift; the figure is a scale, not a forecast. The distribution in §2 is the measurement; the break-even table is the intuition.
- **The t-statistics in §2 assume independent trades and finite variance.** Trend-following round trips are neither cleanly independent (overlapping regimes across coins) nor obviously finite-variance at these tails, so those t values are generous to the "mean beats the cost" case, not harsh to it.
- **The stop is treated as a row parameter**, which `tick.ts` supports (`maxLossPct` from the row's params, `atrStop` from its trend params), so the slow rulebooks carry an 8 % and a 20 % floor in their grids. `reentryBars` is the code constant `REENTRY_BARS` and is fixed at two of the rule's own bars everywhere — which for a weekly rule is a two-week cooldown, a materially different thing from two 4-hour bars, and it is not tuned here.
- **The model is not in the backtest.** Jev's veto can only remove entries, so every figure is an upper bound on what the live rule would have traded.
- **Paper decides.** Nothing here is a fill on Kraken. The post-only assumption — that a resting order at the touch fills — is exactly what the Kraken paper twins were seeded to measure and have not yet reported on, and a twin whose fills are worse than post-only would make this verdict stronger, not weaker.
- **The recommendation is chosen by the worse of two windows**, which is one number from each of two single draws. A third window could reorder the table in §5 — though not the 18-of-18 column, which is arithmetic on costs rather than a result.

---

## Commands run

```
npx deno check --quiet supabase/functions/agents/backtest_kraken.ts
npx deno run --allow-read --allow-write supabase/functions/agents/backtest_kraken.ts \
    --data <scratchpad>/ohlcv --out docs/agents/backtests
```

Run time 30.8 s for 7 rulebooks, 27 coins, 2 windows, 12,492 out-of-sample grid evaluations, a slow rotation grid and 55 priced plans. Re-run to a scratch directory it reproduces `kraken.json` exactly, apart from `ran_at` and `runtimeSeconds`. The Kraken measurements were taken separately with `GET /0/public/AssetPairs`, `GET /0/public/Ticker` (×11) and `GET /0/public/OHLC` — keyless and read-only — and are constants in the script with their provenance. `latest.json`, `summary.json`, `allocation.json`, `portfolio.json`, `ideas.json`, `universe*.json` and `frequency.json` were not touched.

## Files written

- `supabase/functions/agents/backtest_kraken.ts` — the study script (new).
- `docs/agents/backtests/kraken.json` — its distilled output (new).
- `docs/agents/reviews/2026-09-21-kraken-study.md` — this file (new).

No other repository file was touched; nothing was committed or pushed.
