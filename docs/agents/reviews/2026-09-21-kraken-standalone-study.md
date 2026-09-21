# Kraken standalone study — is there a rulebook built for 80 bps, or a coin Kraken alone carries, that earns real money? And what are the TESTING rows worth?

Run 2026-09-21T23:15Z. Script `supabase/functions/agents/backtest_kraken2.ts`; raw output `docs/agents/backtests/kraken2.json`. It extends `docs/agents/reviews/2026-09-21-kraken-study.md` (reference §3.12) and does not repeat it: the seven existing rulebooks are not re-run over the 27 coins, and §3.12's conclusion is treated as the thing to be tested rather than the thing to be quoted.

**Three questions, from the owner.** **K1** — push §3.12 further: rulebooks built for an 80 bps round trip rather than borrowed from a venue that charges 20, and a coin search widened past the 27 pairs Revolut X lists. **K2** — for each TESTING row on the dashboard: delete, keep as-is, or optimise, with the number behind it. **K3** — at most three candidates worth ADDING to TESTING, each with a measurement job paper can do and a backtest cannot.

**Two windows, never averaged.** *Window A* = parameters on the first two thirds, the LAST third out of sample (the bear year). *Window B* = parameters on the first third, the MIDDLE third out (the bull year). Each series is split on its own bar count. **Ranked by the worse window**, never by an average.

**One change of method from §3.12, deliberately.** §3.12 chose every parameter in sample on **Revolut X** costs, which is right when the question is "the same rule on two venues" and wrong when the question is "a rulebook for Kraken". K1 chooses in sample on **Kraken's** costs.

**⚠ The shipped stops changed while this study was running, and every number here is from after the change.** Commit **`eff6ca8`** switched the intra-bar ATR trail off in `backtest.ts` and `tick.ts` (`SHIPPED_STOPS.atrStop: 3 → null`; `stopsForKind` now returns `null` for every rulebook — reference §3.13, §4.11). The rulebook's own close-based trail (`DEFAULT_TREND.atrStop = 3`) and the intra-bar 8 % floor are unchanged. This study imports `SHIPPED_STOPS` and `stopsForKind`, so **every table below was produced against `eff6ca8`** — the committed `kraken2.json` was regenerated after it, and the pre-change run is kept only for the comparison in §7, which turns out to be one of the study's more useful results.

---

## Fidelity — the copy is checked, and so is the harness

Everything that can go through `backtest.ts`'s `run` / `runRotation` does. The one copy is `runLogged` — `run` with the rulebook replaced by a callback (the four new rulebooks, the null control and the regime gate are not `run` `kind`s) and a per-trade log added, which is where the hold distribution and the break-even drift come from.

| check | result |
|---|---|
| `runLogged(shippedDecider)` vs `run` — 6 coins × 2 windows × {trend-4h on 4h bars, momentum-1d on daily, the trend rule on daily, the trend rule on weekly} × 3 fee schedules × 2 parameter points | **252 cells, worst \|Δreturn\| 0, \|ΔmaxDD\| 0, \|Δtrades\| 0** |
| K3's BTC regime gate **switched off**, vs `run` — 7 coins × 2 windows × 2 fee schedules | **28 cells, worst \|Δreturn\| 0, \|ΔmaxDD\| 0, \|Δtrades\| 0** |
| §3.11's seven per-row figures reproduced, against `backtest.ts` **as it stood at 23:08 UTC** (trail on) | **7 rows × 2 windows, largest difference 0.05 of a point** — §3.11's own rounding. −0.3 / +12.6, +0.5 / +4.0, −8.1 / +62.4, −20.1 / +53.6, −0.4 / +4.8, −13.3 / +128.5, −9.8 / +77.0, in §3.11's order |
| the same check against the **current** `backtest.ts` (trail off) | the four rows that never had a trail — both momentum rows, both rotation rows — still reproduce to 0.05 of a point; the three trend rows move by **+8.4 / +7.4** (`trend-4h·revx`), **+3.3 / +6.2** (`trend-1h`), **+9.0 / +8.8** (`trend-4h·kraken`). That is the stop change, not the harness |
| §3.11's twin correlations reproduced | momentum 0.999 / 1.000 and rotation 0.905 / 0.939 to the digit; trend-4h 0.966 / 0.999 against §3.11's 0.958 / 0.999 (the trail again) |
| determinism | a second run's JSON is **byte-identical** apart from `ran_at` and `runtimeSeconds` — verified on both builds, and the committed file is from the trail-off build |

One thing the harness had to match rather than re-decide: `backtest.ts` runs `momentum-1d` on **4-hour** bars with the daily closes passed in for the 30-day momentum state, so its stops read 4-hour lows and its windows are thirds of the 4-hour series. Run on daily bars instead, `momentum-1d·revx` window B reads +67.7 % rather than +62.4 %.

---

## 0. The universe — 622 pairs measured, 68 tested

Kraken's book was measured keylessly for this study on 2026-09-21 22:09–22:20 UTC: `GET /0/public/AssetPairs` once and `GET /0/public/Ticker` **twelve** times, 60 s apart. No private endpoint, no key. §3.12 measured 27 pairs; this measures **all 622 online USD pairs**.

The price series is **Kraken's own tape**, which no study in this repository has used before: the quarterly OHLCVT bundle (8.97 GB, 4-hour `<PAIR>_240.csv`, complete to 2026-06-30) spliced with the last 720 candles of the public OHLC endpoint. The overlap is ~223 bars per pair and the two sources agree to **0.000 bps** — they are the same tape. §3.12 named this bundle as "the right source for the next round"; this is that round.

**The funnel, written down before any return was looked at:**

| stage | pairs | dropped |
|---|---|---|
| Kraken online USD pairs sampled (dotted altnames excluded) | 622 | |
| median 24-hour quote volume ≥ $100k (§4.15's liquidity test) | **199** | 423 |
| not a stablecoin, fiat pair or tokenised fiat | 190 | 9 (USDT, USDC, EUR, GBP, USDG, AUD, EURC, AUSD, TGBP) |
| not a wrapped duplicate | 189 | 1 (WBTC) |
| ≥ 3 years of Kraken's own 4-hour history | 74 | 115 (TAO, HYPE, ENA, ONDO, PENGU, PUMP, HBAR, BNB, POL, TON … — almost all listed after 2023) |
| ≤ 2 % of the 4-hour grid forward-filled for want of a trade | **68** | 6 (LSK 8.1 %, STG 6.9 %, CELR 5.4 %, RLC 5.2 %, BICO 3.9 %, RARI 2.4 %) |

**68 pairs: 22 of the core 27, and 46 Kraken has that no earlier study could test.** They include **ZEC, XMR and TRX** — the three coins §4.16 named as untestable on Revolut X — and PAXG, tokenised gold, kept and flagged rather than quietly dropped, because "a coin Kraken has and Revolut X does not" is exactly what the search is for. **51 of the 68 are Kraken-only** by §4.15's UK-book test. A $20 slot is placeable on every one (`costmin` $0.50, largest `ordermin` $16.26).

The round trip they have to clear, on Kraken's post-only 0.40 % a side plus the measured spread: **80.01 bps on BTC, a median of 89.5, 298 on the widest (SRM)**. Against Revolut X's 19.5–53.5 on the pairs it carries. Note that the five core coins Kraken lists but with under three years of history — BNB, HBAR, HYPE, POL, TON — drop out of this universe, so §3.12's POL finding is not re-tested here.

---

## 1. K1a — rulebooks built for the cost, and what they had to earn

Five rulebooks were written for the constraint — plus §3.12's one exception, plus **a null**. Every one is charged Kraken's fee, filled at Kraken's touch, stopped by the shipped floor, and held back by the same two-bar cooldown; each chose its own parameters in sample on Kraken costs over its own grid; each is scored on both windows.

| arm | bar | grid | median hold | **break-even drift** | median trades / window | A median | B median | plateau A / B | clears A | clears B | **clears BOTH** | chance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `trend-4h` (the anchor) | 4 h | 27 | 3.33 d | **106 %/y** | 11 | −2.7 % | −3.0 % | 20 / 31 % | 20 | 19 | **3** | 5.59 |
| `trend-4h-wide` (§3.12's exception) | 4 h | 8 | 4.63 d | **71 %/y** | 7.5 | −4.1 % | −1.1 % | 19 / 25 % | 21 | 26 | **6** | 8.03 |
| `ma-regime-1d` (100/150/200-day hold) | 1 d | 12 | 4.50 d | 75 %/y | 11 | −11.1 % | −25.1 % | 0 / 4 % | 10 | 4 | **0** | 0.59 |
| `donchian-wide-1d` (100/200 entry, 50/100 exit) | 1 d | 8 | 5.00 d | 71 %/y | 2 | 0.0 % | −8.9 % | 0 / 0 % | 9 | 3 | **1** | 0.40 |
| `crash-stop-hold` (hold, out 25/35 % off the 252-day high) | 1 d | 12 | 4.50 d | 80 %/y | 4 | 0.0 % | −14.3 % | 0 / 0 % | 9 | 10 | **1** | 1.32 |
| `monthly-trend` (one decision a month) | 1 d | 8 | **10.25 d** | **31 %/y** | 4 | −1.5 % | −18.9 % | 6 / 13 % | 8 | 3 | **1** | 0.35 |
| **`null-hold-1d` — THE CONTROL** | 1 d | 16 | 6.00 d | 56 %/y | 4 | 0.0 % | 0.0 % | 6 / 13 % | 6 | 11 | **0** | 0.97 |

*Break-even drift is the constant annual drift at which the arm's median hold pays for one round trip at the median Kraken cost of 89.5 bps. §3.11's measured holds — trend-4h 2.29 d, momentum 3.42 d, trend-1h 0.60 d — imply 142 %, 96 % and 545 % a year on the same arithmetic; the anchor here reads 3.33 d and 106 %, which is the same rule on Kraken's own tape with the trail off.*

**The slow rulebooks do fix the arithmetic.** The monthly rebalance needs a 31 %-a-year drift where the shipped 4-hour rule needs 106 %, and its fee bill falls from 4.68 % of the slot a year to 1.53 %. That is the whole of the good news.

**Two things eat the fix.** First, **the floor truncates the hold**: `tick.ts` reads `maxLossPct` from the row's own params, so an 8 % floor is part of a rulebook's definition. Where the in-sample choice took the wide floor (65 % of `ma-regime-1d` cells, 33 % of `monthly-trend`, 29 % of `donchian-wide-1d`) the median hold is 6, 61 and 103 days; where it took the 8 % floor it is 3, 7 and 3. A rulebook is only as slow as its stop allows.

Second, **slowing down destroys the sample**. The daily arms make 2–4 closed round trips a window; `donchian-wide-1d` has 40 of 136 coin-windows with **no trade at all**, `crash-stop-hold` 23, `monthly-trend` 16, and `ma-regime-1d` ends the window still holding in 13 of its passes, so part of its "return" is an unrealised mark.

**What a round trip actually caught, pooled over every closed trade:**

| arm | closed round trips | mean gross | median gross | t against an 89.5 bps round trip | share clearing its own cost |
|---|---|---|---|---|---|
| `trend-4h` | 831 | +184 bps | −185 bps | **1.41** | 33.5 % |
| `trend-4h-wide` | 524 | +313 bps | −383 bps | **1.77** | 29.0 % |
| `ma-regime-1d` | 865 | −239 bps | −638 bps | −3.13 | 9.7 % |
| `donchian-wide-1d` | 126 | −385 bps | −797 bps | −1.54 | 6.3 % |
| `crash-stop-hold` | 351 | +306 bps | −585 bps | 0.62 | 11.4 % |
| `monthly-trend` | 235 | −628 bps | −798 bps | −2.43 | 6.4 % |
| null | 328 | +48 bps | −790 bps | −0.32 | 27.4 % |

The median round trip loses money before any fee on every rulebook, which is what trend following is supposed to look like; the mean is the number that decides a venue, and **no arm's mean clears a Kraken round trip at t > 2**. §3.12 measured `trend-4h-wide` at t = 2.17 over 27 coins; over 68 coins on Kraken's own tape it is **1.77**. The one number that argued for Kraken in §3.12 is weaker on the wider cross-section, not stronger.

**The fee tier is further away than ever**, which is what a rulebook built to trade less must do to it:

| arm | traded notional per $1 of slot per year | 30-day volume on five $20 slots | turnover multiple needed for tier 2 | capital needed instead |
|---|---|---|---|---|
| `trend-4h` | 11.70 | $96.16 | 26.0× | $2,600 |
| `ma-regime-1d` | 11.48 | $94.40 | 26.5× | $2,648 |
| `trend-4h-wide` | 7.67 | $63.08 | 39.6× | $3,963 |
| `crash-stop-hold` | 4.90 | $40.27 | 62.1× | $6,207 |
| `monthly-trend` | 3.83 | $31.44 | 79.5× | $7,952 |
| `donchian-wide-1d` | 1.96 | $16.15 | **154.8×** | **$15,479** |

---

## 2. K1b — the widened coin search, and every pass priced against its own twin

**Twelve arm × coin pairs clear the bar on both windows, where the independence product gives 16.28.** Fewer than chance, over 408 arms (6 rulebooks × 68 coins), 12,376 in-sample and 24,752 out-of-sample evaluations. Here is every one of them.

| arm · coin | window | Kraken | DD | closed round trips | median hold | break-even drift | plateau | the SAME rule at a 9 bps taker fee | beaten by it? |
|---|---|---|---|---|---|---|---|---|---|
| `trend-4h-wide` · RAY | A | +68.2 % | 18.6 % | 3 | 7.83 d | 46 %/y | 100 % | +71.4 % (hypothetical) | yes |
| | B | +115.0 % | 33.2 % | 4 | 10.75 d | 34 %/y | 100 % | +120.4 % | yes |
| `trend-4h-wide` · MINA | A | +40.0 % | 27.6 % | **2** | 12.83 d | 28 %/y | 100 % | +41.7 % (hypothetical) | yes |
| | B | +38.7 % | 21.1 % | 4 | 9.00 d | 39 %/y | 50 % | +42.1 % | yes |
| `trend-4h-wide` · AVAX | A | +33.9 % | 8.7 % | **2** (+1 open) | 5.33 d | 56 %/y | 100 % | +35.7 % (real Revolut X) | yes |
| | B | +8.9 % | 23.5 % | 7 | 6.67 d | 45 %/y | 75 % | +13.2 % | yes |
| `trend-4h-wide` · SOL | A | +15.1 % | 17.2 % | 4 (+1 open) | 11.42 d | 26 %/y | 100 % | +18.3 % (real Revolut X) | yes |
| | B | +9.3 % | 30.8 % | 10 (+1 open) | 9.33 d | 32 %/y | 100 % | +16.5 % | yes |
| `trend-4h-wide` · AAVE | A | +14.8 % | 16.1 % | **2** (+1 open) | 5.17 d | 62 %/y | 100 % | +16.7 % (Revolut X, $54k UK book) | yes |
| | B | +2.0 % | 24.4 % | 7 | 5.67 d | 57 %/y | 75 % | +6.7 % | yes |
| `trend-4h-wide` · INJ | A | +9.6 % | 22.9 % | 3 | 2.83 d | 111 %/y | 100 % | +11.6 % (hypothetical) | yes |
| | B | +0.7 % | 15.3 % | 3 | 6.00 d | 52 %/y | 50 % | +2.6 % | yes |
| `trend-4h` · AVAX | A | +45.3 % | 8.7 % | 3 (+1 open) | 4.83 d | 62 %/y | 96 % | +48.1 % (real Revolut X) | yes |
| | B | +23.4 % | 26.3 % | 10 | 4.92 d | 61 %/y | 100 % | +30.3 % | yes |
| `trend-4h` · SOL | A | +15.8 % | 12.0 % | 6 (+1 open) | 1.83 d | 161 %/y | 96 % | +20.4 % (real Revolut X) | yes |
| | B | +4.4 % | 21.3 % | 19 | 1.67 d | 177 %/y | 56 % | +16.9 % | yes |
| `trend-4h` · KSM | A | +1.1 % | 12.1 % | 5 | 0.50 d | **742 %/y** | 67 % | +4.3 % (hypothetical) | yes |
| | B | +3.0 % | 17.8 % | 5 | 4.83 d | 77 %/y | 67 % | +6.3 % | yes |
| `donchian-wide-1d` · PAXG | A | +0.7 % | 27.2 % | **1** | 247 d | 1.2 %/y | 100 % | +1.4 % (hypothetical) | yes |
| | B | +20.3 % | 11.9 % | **1** (+1 open) | 52 d | 5.7 %/y | 100 % | +21.4 % | yes |
| `crash-stop-hold` · PAXG | A | +3.2 % | 32.4 % | 4 (+1 open) | 4.50 d | 65 %/y | 100 % | +6.1 % (hypothetical) | yes |
| | B | +39.7 % | 8.2 % | **0** — one entry that never closed | — | — | 100 % | +40.2 % | yes |
| `monthly-trend` · PAXG | A | +14.7 % | 20.4 % | **1** | 243 d | 1.2 %/y | 100 % | +15.4 % (hypothetical) | yes |
| | B | +36.2 % | 8.2 % | **0** — one entry that never closed | — | — | 100 % | +36.7 % | yes |

Five facts about that table decide K1.

**1. Kraken never wins. In 952 coin-window cells across seven rulebooks, the Kraken figure beats the same rule at Revolut X's fee schedule in ZERO.** 133 cells are ties because neither traded; in all 819 that differ, Kraken loses. §3.12 found Revolut X ahead in 18 of 18 paired comparisons; this is the same finding at 819 of 819, on a universe 2.5× wider and on Kraken's own prices.

**2. The passes are thin.** Eight of the twenty-four pass-cells rest on **two closed round trips or fewer**, and four on none or one — PAXG's window B "passes" on two different rulebooks are the same single entry that never closed inside the window. §3.12 found five of its twelve passes in that state; the failure mode has not changed.

**3. The ones with enough trades need drifts they cannot have.** KSM holds 0.50 days and needs 742 % a year; SOL on the anchor needs 161 % and 177 %. The passes whose arithmetic is comfortable — MINA at 28 %/y, SOL on `trend-4h-wide` at 26–32 %/y, RAY at 34–46 %/y — are all on `trend-4h-wide`, and all of them are beaten by the same rule at a 9 bps fee by 2–5 points.

**4. The null clears ZEC, XMR and TRX in the bear window.** The null rulebook — entries from a deterministic hash, exits after a fixed number of days, everything else identical — clears the four-part bar in window A on **APT, AVAX, BCH, TRX, XMR and ZEC**, and in window B on eleven more coins. It clears **nothing** on both windows, which is the control's headline; but a bar cleared in one window by a random-entry rule is not evidence about a rulebook, and three of the six coins it clears in the bear year are coins a real arm also clears there.

**5. The pass list is not stable.** Switching the intra-bar trail off — a change made for unrelated reasons, hours after the first run — kept only **5 of the 10** arm × coin passes and produced 7 new ones (§7). A set of passes that a stop change reshuffles is a set of passes chance would also reshuffle.

**§4.16's three named coins, answered.** ZEC, XMR and TRX were named as the coins §3.8 could not test because Revolut X does not carry them. All three now have three years of Kraken's tape, and **none clears the bar on both windows on any of the six rulebooks**:

- **ZEC** — the most spectacular numbers in the study and the least evidence in it: `ma-regime-1d` +2,096 %, `donchian-wide-1d` +1,400 %, `crash-stop-hold` +776 % in window A, each on **one or two** closed round trips with a position still open at the end, and each failing window B (−8.6 %, −13.7 %, and +53.2 % on a 50 % plateau). The trend rules clear window A (+99.5 %, +17.3 %) and fail window B (−0.8 %, −27.0 %). The null clears ZEC in window A too.
- **XMR** — clears window A on `trend-4h-wide` (+15.0 %, 8 round trips, plateau 100 %) and then loses 26.3 % in window B on a 25 % plateau. Clears window B on `ma-regime-1d` and `donchian-wide-1d` and fails window A on both.
- **TRX** — clears window B on the anchor (+4.3 %) and on `trend-4h-wide` (+43.6 %), fails window A on both (+14.8 % on a 33 % plateau; −0.7 %).

**PAXG, since it will be asked about.** Tokenised gold is the only thing in the universe that clears both windows on **three** rulebooks. It is also the only thing whose passes rest on 0–4 closed round trips, whose break-even drift reads 1.2 %/y because it holds for eight months, and whose "strategy" is therefore indistinguishable from owning gold through a bull market. It is not crypto, it is in no rulebook's remit, and its Kraken round trip (80.5 bps) is still four times what Revolut X would charge if it listed it. Recorded, not proposed.

---

## 3. Does the tape matter? (it does, and this is new)

§3.12 compared 720 of Kraken's closes with Coinbase's and found a median 0.93–6.11 bps difference. This compares the thing that decides a verdict — **the same rulebook's return** — over the same calendar span on both tapes, on the nine coins that have both.

| rulebook | comparisons | median \|Δreturn\| | max \|Δreturn\| | sign flips |
|---|---|---|---|---|
| seeded `trend-4h` | 18 | **3.37 points** | **68.1 points** | 2 |
| `ma-regime-1d` (ma 200, no buffer, 8 % floor) | 18 | 0.44 points | 8.3 points | 0 |

The worst case is **ALGO in window B: +79.9 % on Kraken's tape against +147.9 % on Coinbase's, with 12 trades on both**. A breakout rule triggers on wicks and prior-N highs; a one-bar difference in which bar makes the high moves an entry, and the difference compounds. The slow moving-average rule, which triggers on an average of a hundred closes, is almost tape-independent.

Two consequences, and they cut both ways. K1's numbers are on Kraken's tape and §3.12's are on Coinbase's, so **the two studies' per-coin figures are not directly comparable** and no verdict here rests on matching them. And more generally: **a single coin's single-window out-of-sample return from a fast breakout rule is partly a property of the exchange it was measured on.** That is a caveat on every table in this repository that quotes one, including the ones this study is arguing with.

---

## 4. K2 — the TESTING rows, one verdict each

"Optimise" is tested the only honest way: the best of the row's variant grid is chosen on the **first third**, scored on the **middle third**, and then scored again on the **last third** — a window that played no part in choosing it. The contaminated direction (choosing on the first two thirds, which contain the middle third) is in the JSON and is not used for a verdict.

| row | A return / DD / P&L | B return / DD / P&L | worse ret/DD | fills per 90 d (A / B) | turnover | best of N variants chosen on the first third → middle third → **last third** |
|---|---|---|---|---|---|---|
| *`trend-4h·revx` (LIVE, for scale)* | +8.0 % / 11.3 % / +$8.03 | +20.1 % / 10.5 % / +$20.08 | **0.71** | 20.4 / 26.8 | 17–22×/y | 162 → +22.8 % → **+5.7 %** |
| `trend-1h·revx` | +3.8 % / 18.8 % / **+$1.51** | +10.2 % / 16.9 % / **+$4.08** | **0.20** | **46.0 / 56.1** | **62–76×/y** | 108 → **−9.2 %** → +2.0 % |
| `momentum-1d·revx` | −8.1 % / 41.0 % / −$3.22 | **+62.4 %** / 17.1 % / +$24.97 | −0.20 | 29.0 / 21.2 | 29–39×/y | 32 → +44.9 % → **−12.3 %** |
| `momentum-1d·kraken` | **−20.1 %** / 51.3 % / −$8.05 | +53.6 % / 19.4 % / +$21.46 | −0.39 | 29.0 / 21.2 | 29–39×/y | 32 → +66.6 % → **−15.7 %** |
| `trend-4h·kraken` | +8.6 % / 14.1 % / +$8.62 | +13.6 % / 11.8 % / +$13.60 | 0.61 | 20.1 / 26.8 | 16–22×/y | 162 → +16.7 % → **+0.8 %** |
| `rotation-1d·revx` | −13.3 % / 37.0 % / −$5.32 | +128.5 % / 22.5 % / +$51.42 | −0.36 | 15.5 / 21.7 | 26–75×/y | 54 → +105.4 % → **−66.0 % (DD 93.6 %)** |
| `rotation-1w·kraken` | −9.8 % / 41.5 % / −$3.94 | +77.0 % / 26.8 % / +$30.78 | −0.24 | 11.1 / 16.8 | 16–49×/y | 54 → +120.2 % → **−75.2 % (DD 116.0 %)** |

**Not one row's optimisation earns its search.** Four of seven go negative on the window that did not choose them; the three that stay positive do so at +5.7 %, +2.0 % and +0.8 % against seeded rows that made +8.0 %, +3.8 % and +8.6 % in the same window — i.e. the optimised variant is **worse than the seeded one** in every case. 604 variants were searched across the seven rows, twice.

**What the rows measure, by correlation of daily P&L** (the only currency in which "it measures something nothing else does" can be paid):

| pair | window A | window B |
|---|---|---|
| `momentum-1d·revx` · `momentum-1d·kraken` | 0.999 | 1.000 |
| `trend-4h·revx` · `trend-4h·kraken` | 0.966 | 0.999 |
| `rotation-1d·revx` · `rotation-1w·kraken` | 0.905 | 0.939 |
| `momentum-1d·revx` · `rotation-1d·revx` | 0.722 | 0.639 |
| `trend-4h·revx` · `momentum-1d·revx` | 0.458 | 0.603 |
| `trend-4h·kraken` · `momentum-1d·kraken` | 0.445 | 0.589 |
| `trend-4h·revx` · `trend-1h·revx` | 0.399 | 0.534 |

### The verdicts

**`trend-1h·revx` — DELETE.** It earns **$1.51 and $4.08 on $40** while turning over **62–76×** a year, three to four times any other row, and it is the **worst row in the set by the worse window's return over drawdown (0.20 against the live row's 0.71)** in both windows separately. It is on a plateau on no coin in either window (§3.10 point 4). Its 108-variant optimisation loses 9.2 % on the first window it meets. Its stated job is feedback speed, and the number for that job is fills: **46–56 per 90 days against `trend-4h·revx`'s 20–27**. A factor of two on a row that already produces a fill every four days — and §3.6 has already established that nothing below four hours survives a round trip on any venue, so the fills it produces are for a rulebook nobody will run.

**`momentum-1d·revx` — KEEP AS-IS, and do not optimise it.** It is the only rulebook in the set whose P&L is not a restatement of another row's: its highest correlation with any non-twin row is 0.72 (A) / 0.64 (B), and with the live row 0.46 / 0.60. It is the largest bull-window contributor at +$24.97 on $40 and carries a 41.0 % row drawdown in the bear window — the two facts the set needs measured on the same coins the live row holds, and the reason §3.11 called it "the one row a larger live set should add, and the one that costs most when the year goes the other way". Its optimisation (32 variants) makes +44.9 % on the middle third and **−12.3 %** on the last, so the seeded parameters stay. It is also the only row the stop change did not touch, which makes it the cleanest instrument in the set right now.

**`momentum-1d·kraken` — DELETE.** Correlation with its Revolut X twin **0.999 / 1.000** — it is the same row with a fee — and the fee costs it 12.1 points in A and 8.8 in B. Its own job is Kraken's fill behaviour, and that job is already staffed: `trend-4h·kraken` produces 20–27 fills per 90 days to this row's 21–29, on the same venue, with the same post-only assumption to test. Two rows are not twice the evidence about one fill model; they are one piece of evidence and twice the noise.

**`trend-4h·kraken` — KEEP AS-IS, and stop reading its return.** Its job is the one thing no backtest can see: whether a post-only limit at the touch actually fills on Kraken, and at what price. It is the only row that runs the **live** rulebook, on the live coins, on the second venue, and it produces **20.1 and 26.8 fills per 90 days** — enough to settle the post-only question inside a quarter. Its return is 0.966 / 0.999 correlated with the live row's; note that under the current stops it is **0.59 points AHEAD** of its Revolut X twin in the bear window and 6.48 behind in the bull one. That is a fill-path accident on a 0.966 correlation, not an edge — and it is exactly why this row's return must never be quoted as evidence for Kraken. K1's per-coin cells, where the two are priced on identical trades, have Kraken behind in 819 of 819.

**`rotation-1d·revx` — DELETE.** It fails §4.15's bar on both windows and for a different reason each time (−13.3 % in the bear year; a 37.0 % drawdown, over the 35 % limit). Its optimisation is the most expensive number in the study: the best of 54 variants chosen on the first third — top 3, 90-day lookback, **bear filter off** — makes +105.4 % on the middle third and **−66.0 % with a 93.6 % drawdown** on the last. The switch the optimiser reaches for is the one the reference already names as Davies' to flip, and the year it does not see is the year it would have destroyed the row.

**`rotation-1w·kraken` — DELETE.** 0.905 / 0.939 correlated with the Revolut X rotation; §3.11 found it the only row of seven whose removal improves the set on **both** windows; and its own optimisation goes +120.2 % → **−75.2 % with a 116 % drawdown**. It is the expensive copy of a row that is itself being deleted.

That leaves TESTING with two rows — `momentum-1d·revx` (a second rulebook on the live coins) and `trend-4h·kraken` (the fill measurement) — beside the one LIVE row, plus whatever K3 adds.

---

## 5. K3 — what is worth adding to TESTING

Two proposals, and a third that is conditional on a decision only Davies can make. All are for **Revolut X** unless stated: K1 is the answer to whether anything belongs on Kraken.

### Proposal 1 — `regime-trend-4h` on Revolut X (§3.10 point 6's candidate: NOT displaced, but narrowed)

The shipped trend rule with every **entry** gated by BTC's daily close being above its N-day average; exits untouched. Eight coins (the live five plus LINK, NEAR, ALGO), 27 grid points, parameters chosen in sample on Revolut X costs:

| coin | A return / DD / plateau / Kraken | B return / DD / plateau / Kraken | clears both? | the unfiltered baseline, A / B |
|---|---|---|---|---|
| **LINK** | +7.4 % / 16.1 % / 96 % / +5.9 % | +43.1 % / 17.1 % / 100 % / +35.9 % | **yes** | +4.2 % / +43.1 % |
| **NEAR** | +17.6 % / 20.2 % / 67 % / +15.6 % | +1.6 % / 24.5 % / 89 % / +2.4 % | **yes** | −7.9 % / +18.3 % |
| SUI | +44.0 % / 19.5 % / 89 % / +41.8 % | −2.5 % / 31.3 % / 22 % / −4.3 % | no | +1.4 % / −2.5 % |
| SOL | +18.7 % / 11.4 % / 100 % / +16.3 % | +7.1 % / 31.3 % / 63 % / −0.6 % | no (Kraken leg in B) | +17.6 % / +3.0 % |
| AVAX | +19.7 % / 9.8 % / 100 % / +18.1 % | −3.5 % / 30.3 % / 82 % / −8.6 % | no | +34.1 % / +6.8 % |
| ALGO | +7.2 % / 16.3 % / 48 % / +5.3 % | +130.8 % / 24.5 % / 100 % / +122.2 % | no (plateau in A) | −12.5 % / +156.1 % |
| ETH | +0.8 % / 14.1 % / 52 % / −1.6 % | +105.6 % / 17.8 % / 100 % / +93.6 % | no | −8.0 % / +80.2 % |
| BTC | −2.0 % / 10.3 % / 85 % / −6.0 % | +1.9 % / 21.7 % / 48 % / −8.0 % | no | −10.7 % / +12.4 % |

**Two of eight clear both windows against 2.50 expected by chance** — at chance, and that is the honest way to say it. What makes this a proposal anyway is that **§3.9 wrote down the promotion condition before the numbers existed**: "the same test with the middle third held out instead of the last agreeing with this one, and then a paper twin". That condition is met for LINK and NEAR. §3.10 point 6 named LINK, NEAR, SUI and ALGO; under the current stops **SUI and ALGO drop out and LINK comes back** — and the instability itself (§7: under the previous stops the two-window clearers were NEAR, SUI and ALGO) is the strongest argument for running it in paper rather than arguing about which four-month slice of backtest to believe.

**What paper measures that the backtest cannot**: the filter's whole mechanism is *not trading* — §3.9 measured it taking exposure down to 2–6 % of bars. A backtest cannot tell whether the entries it blocks are the ones that would have lost; only a twin running beside the unfiltered row, on the same coins at the same minutes, can, because it records the decision the gate refused. That is the one experiment that separates "it held less in a year when holding lost" from "it picks".

### Proposal 2 — `trend-4h-wide` on Revolut X

The shipped rulebook with slow 200/300, breakout 100/200 and a 4/6×ATR rulebook trail — §3.12's one exception, proposed for the venue where its round trip is 20 bps rather than 80. Same eight coins, 8 grid points:

| coin | A return / DD / plateau | B return / DD / plateau | clears both? | baseline A / B |
|---|---|---|---|---|
| **AVAX** | +37.2 % / 8.7 % / 100 % | +89.3 % / 19.9 % / 100 % | **yes** | +34.1 % / +6.8 % |
| **SOL** | +12.8 % / 16.2 % / 100 % | +14.8 % / 29.0 % / 100 % | **yes** | +17.6 % / +3.0 % |
| SUI | +31.2 % / 23.4 % / 63 % | +6.2 % / 21.3 % / 25 % | no (plateau in B) | +1.4 % / −2.5 % |
| ALGO | +4.4 % / 11.5 % / 13 % | +297.0 % / 33.2 % / 100 % | no (plateau in A) | −12.5 % / +156.1 % |
| BTC / ETH / LINK / NEAR | −15.8 / −4.2 / −7.6 / −11.1 % | +27.5 / +69.5 / +23.3 / −9.9 % | no | — |

**Two of eight clear both windows against 2.25 by chance** — again at chance. Its content is elsewhere: its median hold is **7.67 days against the live rule's 2.29–3.33**, which makes it the only variant of the shipped rulebook whose hold exceeds the break-even hold on *both* venues (2.4 days at a 30 % drift on Revolut X, 9.7 on Kraken), and it is the one rulebook whose mean round trip came closest to clearing a Kraken one (t = 1.77 over 68 coins; §3.12 measured 2.17 over 27).

**What paper measures that the backtest cannot**: a 7–11 day hold with a 6×ATR rulebook trail is a different *execution* problem, not just a different return — fewer, larger, longer-lived resting orders, stops that sit further from the mark for days, and re-quotes that have to survive a weekend. The backtest fills every order at the next bar's open; paper is the only place to find out whether an order that rests for ten days is still the order the rule wanted. It also feeds the one thing §3.12 said would change its mind — a third window on SOL and AVAX — a quarter at a time.

### Proposal 3 — conditional: `trend-4h-wide-kraken` on AAVE, **in place of** `momentum-1d-kraken`

AAVE is the best-documented Kraken-only candidate the widened search produced: Kraken book **$5.5M a day**, UK book **$54k** (a tenth of §4.15's floor, so Revolut X cannot carry it), `ordermin` $7.35, and it is one of the 27 whose spread is measured on *both* venues, so the single-venue decision rests on a measurement rather than on an absence. On `trend-4h-wide` at Kraken's own cost it clears both windows — **+14.8 % (DD 16.1 %, plateau 100 %) and +2.0 % (DD 24.4 %, plateau 75 %)** — on 2 and 7 closed round trips, holding 5.2–5.7 days against a 57–62 %-a-year break-even drift. (If the biggest numbers are wanted instead of the best-documented ones, `RAY` reads +68.2 % / +115.0 % on 3 and 4 round trips with a 100 % plateau in both windows, and `MINA` +40.0 % / +38.7 % with the best hold arithmetic in the study, 9–13 days against a 28–39 % break-even drift. Neither is listed on Revolut X at all.)

**The return case is at chance and should be stated as such**: one of twelve two-window passes where the independence product gives 16.3, window A resting on two closed round trips, and the same rule at a 9 bps fee making 1.9 and 4.7 points more. **The measurement case is not about return.** §4.16 — a coin that runs on one venue because the other cannot carry it — has never been exercised: no row in the system has ever had a symbol its twin does not. A paper row here would measure (a) whether a post-only order fills at the touch on a $5.5M-a-day alt book rather than a major's, (b) whether the single-venue row mechanism works end to end — migration, tick, page, positions — before it is ever needed for a coin that matters, and (c) whether Kraken's own tape agrees with the live venue's fills.

**It is a replacement, not an addition**, and the weakest of the three by design. K2 deletes `momentum-1d-kraken` because two Kraken twins measure one fill model; this row would use that slot to measure something no row measures. If Davies does not want §4.16 exercised yet, **the slot stays empty and nothing is added** — that is the better default.

---

## 6. What the answer would have to look like to be different

Recorded so the next session does not re-run this: a Kraken rulebook would earn real money if, on a third window, `trend-4h-wide` held its SOL / AVAX / RAY / MINA record with **more than ten closed round trips per coin per window**, its pooled mean round trip cleared a Kraken round trip at **t > 2** rather than 1.77, and the per-cell comparison against the same rule at a 9 bps fee stopped being 819 losses out of 819 — which requires a fill advantage on Kraken, not a return advantage, and only paper can produce that evidence. Nothing short of the fill evidence changes the arithmetic, because the arithmetic is a subtraction.

---

## 7. The stop that changed under the study — and why it is a result

Between this study's two runs, commit `eff6ca8` took `SHIPPED_STOPS.atrStop` from `3` to `null` and made `stopsForKind` return `null` for every rulebook (§3.13 — the intra-bar trail duplicated the rulebook's own close-based trail and fired first in 48 of 49 and 67 of 68 protective exits). No rule, coin, window, cost or grid in this study changed. The numbers did:

| what | before (trail on, 23:08) | after (trail off, 23:15 — the committed run) |
|---|---|---|
| K1 two-window passes / chance | 10 / 14.61 | **12 / 16.28** |
| which arm × coin pairs passed | trend-4h {RAY, SUI}; wide {AAVE, DASH, SOL, TRX, XMR}; PAXG ×3 | trend-4h {AVAX, KSM, SOL}; wide {AAVE, AVAX, INJ, MINA, RAY, SOL}; PAXG ×3 |
| pairs surviving both runs | — | **5 of 10** |
| `trend-4h` median hold / break-even drift | 2.50 d / 140 %/y | 3.33 d / 106 %/y |
| `trend-4h-wide` pooled t | 1.25 | 1.77 |
| `trend-4h·revx` (LIVE) A / B | −0.3 % / +12.6 % | **+8.0 % / +20.1 %** |
| `trend-1h·revx` A / B | +0.5 % / +4.0 % | +3.8 % / +10.2 % |
| `trend-4h·kraken` A / B | −0.4 % / +4.8 % | +8.6 % / +13.6 % |
| K3 regime filter, clears both | ALGO, NEAR, SUI | **LINK, NEAR** |
| K3 `trend-4h-wide`, clears both | AVAX, SOL | AVAX, SOL |
| everything without a trail (momentum ×2, rotation ×2, ma-regime, donchian, crash, monthly, the null) | — | **unchanged to the digit** |

Three things follow. **Kraken's answer is robust**: the passes are below chance either way, the null passes nothing either way, and Kraken loses to the cheaper fee in 0 of 952 cells either way. **The K2 verdicts are robust**: every deletion rests on a correlation, a turnover, or an optimisation that fails out of sample, and none of those moved. **The individual coin passes are not robust at all** — a stop change made for unrelated reasons kept 5 of 10 — which is the multiple-comparisons argument made physical, and the reason no coin is proposed for a row on the strength of one.

---

## Verdicts

**K1, in one sentence: no — there is no rulebook and no coin set that clears the bar on both windows on Kraken's costs and is not beaten by its own cheaper-fee twin, because in 952 coin-window cells across seven rulebooks and 68 coins the Kraken figure beats the same rule at Revolut X's fee schedule exactly zero times, the twelve pairs that do clear both windows are fewer than the 16.3 chance alone would give, eight of their twenty-four cells rest on two closed round trips or fewer, the null rulebook clears ZEC, XMR and TRX in the bear window on random entries, and a stop change made for unrelated reasons kept only five of the ten passes the first run found.**

**K2, row by row:**

| row | verdict | the number behind it |
|---|---|---|
| `trend-1h·revx` | **DELETE** | $1.51 and $4.08 on $40 at 62–76×/y turnover; the worst row in the set on the worse window's return over drawdown (0.20 against the live row's 0.71) and worse in each window separately; plateau on no coin in either window; its 108-variant optimisation loses 9.2 % on the first window it meets; its feedback-speed job is 46–56 fills/90 d against the live row's 20–27 — a factor of two, for a rulebook §3.6 has already priced out |
| `momentum-1d·revx` | **KEEP AS-IS** | the only rule whose P&L is not a restatement of another row's (≤ 0.72 / 0.64 against every non-twin, 0.46 / 0.60 against the live row); +$24.97 on $40 in the bull window against a 41.0 % row drawdown in the bear one; do not optimise — the best of 32 variants goes +44.9 % → −12.3 % |
| `momentum-1d·kraken` | **DELETE** | 0.999 / 1.000 correlated with its twin and 12.1 / 8.8 points worse; its fill job is already covered by `trend-4h·kraken` (20–27 fills/90 d against its 21–29) on the same venue under the same assumption |
| `trend-4h·kraken` | **KEEP AS-IS** | the only row that measures the LIVE rulebook's fills on the second venue, at 20.1 and 26.8 fills per 90 days — enough to settle the post-only question in a quarter; its return (0.966 / 0.999 correlated; +0.59 points ahead of its twin in A and 6.48 behind in B) is a fill-path accident and must never be read as evidence about a venue |
| `rotation-1d·revx` | **DELETE** | fails the bar on both windows (−13.3 % in A; a 37.0 % drawdown, over the 35 % limit); the best of 54 variants chosen out of sample turns the bear year into **−66.0 % with a 93.6 % drawdown** |
| `rotation-1w·kraken` | **DELETE** | 0.905 / 0.939 correlated with the row above; §3.11's only row whose removal improves the set on both windows; its own optimisation reads **−75.2 % with a 116 % drawdown** on the window that did not choose it |

**K3:** (1) `regime-trend-4h·revx` on **LINK and NEAR** — not displaced, but narrowed from §3.10's four and unstable across a stop change, at chance on the numbers (2 of 8 against 2.50), proposed because §3.9's own written promotion condition is now met and because only paper can measure the entries a gate refuses. (2) `trend-4h-wide·revx` on **AVAX and SOL** — at chance too (2 of 8 against 2.25), but it holds 7.67 days against the live rule's 2.29–3.33, which makes it the only shipped-rulebook variant whose hold clears the break-even hold on both venues, and its execution behaviour (orders resting for days, a wide trail across weekends) is something no backtest sees. (3) **conditional** — `trend-4h-wide-kraken` on **AAVE** in place of `momentum-1d-kraken`, only if Davies wants §4.16's single-venue path exercised before it is needed; its return case is at chance and it should be expected to earn nothing.

---

## Caveats — all of them

- **The whole study is a search, scored on the windows it searched.** K1 looked at 408 arms (6 rulebooks × 68 coins) over 2 windows, 12,376 in-sample and 24,752 out-of-sample evaluations; K2 chose from 604 variants twice; K3 from 47 points over 8 coins twice. The chance column and the null rulebook are the controls, and the answer is no because the search found **fewer** passes than either control leads you to expect.
- **The null control is not a calibrated placebo.** It trades less than the real arms (median 2 closed round trips a window against 1–6), its grid is 16 points where theirs are 8–27, and it is long-only in the same rising market. It is a floor on how much a no-edge rule can manufacture, and its zero two-window passes should be read beside its **six and eleven single-window** passes.
- **Two windows, each a single draw**, one bear year and one bull year. Ranked by the worse; a third window could reorder everything. Nothing here estimates a return.
- **The shipped stops changed mid-study** (§7). Everything reported is from after the change, against the current repository; the before/after is in §7 and the trail-on run is not committed. Any figure here that is compared with §3.10–§3.12 is being compared across that change unless it is one of the four rows that never had a trail.
- **The tape changes the answer for fast rules.** The same seeded `trend-4h` on Kraken's and Coinbase's tapes over the same span differs by a median 3.4 and a maximum **68 points** (ALGO, window B), with two sign flips in eighteen. K1 is on Kraken's tape and §3.12 is on Coinbase's, so their per-coin figures are not comparable. The slow moving-average rule differs by a median 0.44 points, so the disagreement is a property of breakout rules, not of the tapes' quality.
- **The Kraken series is spliced.** The quarterly bundle ends 2026-06-30 and the last ~12 weeks come from the live endpoint; they overlap by ~223 bars per pair and agree to 0.000 bps, but they are the same vendor, so that agreement is a continuity check, not an independent one.
- **Missing bars are forward-filled.** Kraken omits a 4-hour bar in which nothing traded; the grid is completed with flat, zero-volume bars. The median universe pair is missing 0.05 % and the exclusion threshold was 2 %, set after looking at the distribution of missing bars and before looking at any return — six pairs were dropped by it.
- **For 51 of the 68 coins the "cheaper-fee twin" is hypothetical.** Revolut X does not list them, or lists them under §4.15's book floor; the comparison prices the same rule at a 9 bps taker fee and Kraken's own spread, which isolates the fee and says nothing about whether the coin could be traded there.
- **Spreads are twelve samples over twelve minutes on one evening.** For the majors that is stable to a basis point; for SRM (298 bps a round trip), CLOUD, AIOZ and the rest of the wide tail it is one reading of a book that moves. A rule that only just clears its costs on such a coin has cleared nothing.
- **Sample sizes are small where it matters most.** Eight of the twenty-four pass-cells rest on ≤ 2 closed round trips and four on none or one. `donchian-wide-1d` never trades at all in 40 of 136 cells, `crash-stop-hold` in 23, `monthly-trend` in 16; `ma-regime-1d` ends the window still holding in 13 of its passing cells, so part of that return is an unrealised mark.
- **The 8 % floor truncates the slow rulebooks.** It is a row parameter (`tick.ts` reads `maxLossPct` from the row's own params), so it belongs in the grid — but "a rulebook that holds for months" and "a rulebook whose stop lets it" are different things, and the tables report both (3–7 day holds under the floor, 6–103 days with it opened to 99 %).
- **The crash-stop and monthly arms need 253 bars of warm-up**, which leaves window B's in-sample segment 112 days long — thin for choosing a parameter, and the same thinness §3.12 flagged for BNB.
- **PAXG is tokenised gold**, not crypto, and its three "passes" are one or two trades seen three ways.
- **Five of the core 27 are missing from the universe** — BNB, HBAR, HYPE, POL, TON — because Kraken's own tape is under three years for them. §3.12's POL result is therefore not re-tested here.
- **The fee tier assumes this account stays at 0.40 / 0.80.** Every arm is further from tier 2 than the shipped rules were (26–155× the turnover, $2.6k–$15.5k of capital), which is what a rulebook designed to trade less must do.
- **K2's rows are on Coinbase's tape** (as §3.10–§3.12 are) so they stay comparable with §3.11's, which they reproduce to 0.05 of a point on the trail-on build. The K1 tape caveat applies to K1's coins, not to K2's rows.
- **The model is not in the backtest.** Jev can only veto entries, so every figure is an upper bound on what a live row would have traded.
- **Nothing was placed and no key was touched.** Every venue call in this study is a public, keyless GET.

---

## Commands run

```
npx deno check --quiet supabase/functions/agents/backtest_kraken2.ts
npx deno run --allow-read --allow-write supabase/functions/agents/backtest_kraken2.ts \
    --data <scratchpad>/ohlcv --kdata <scratchpad>/k4h --out docs/agents/backtests
```

118 s for 7 rulebooks over 68 coins on Kraken's own tape, 7 rows × 604 variants and 3 candidates over 8 coins, both windows. Re-running writes the same JSON byte for byte apart from `ran_at` and `runtimeSeconds` (checked). `latest.json`, `summary.json`, `kraken.json`, `allocation.json` and `portfolio.json` were not touched.

The data step (not shipped; it writes only into the scratchpad) measured Kraken's book — `GET /0/public/AssetPairs` once and `GET /0/public/Ticker` twelve times 60 s apart — and built the 4-hour tape from Kraken's quarterly OHLCVT bundle spliced with `GET /0/public/OHLC?interval=240` per pair. All keyless, all read-only.

## Files written

- `supabase/functions/agents/backtest_kraken2.ts` — the study script (new).
- `docs/agents/backtests/kraken2.json` — its raw output: the 199-pair book measurement, the universe funnel, the series provenance, the fidelity cells, 952 arm × coin × window cells, the K2 rows and the K3 candidates (new).
- `docs/agents/reviews/2026-09-21-kraken-standalone-study.md` — this file (new).

No other repository file was touched; nothing was committed or pushed.
