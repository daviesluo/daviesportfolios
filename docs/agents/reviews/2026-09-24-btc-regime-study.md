# S1: the BTC-regime entry filter on the live row — REJECT (2026-09-24)

Davies asked for the one pre-registered research candidate left to be finished before two strategies go live at $50
each. That candidate is reference §3.9's idea 1: gate every entry of the 4-hour trend rule on BTC's daily close being
above its N-day average. §3.9 asked for a non-bear window before anything more. This is that test, pre-registered in
`2026-09-24-btc-regime-prereg.md` and committed (`a4ea134`, 00:08:44 UTC) before any arm ran.

## Order of work

* 00:02–00:07 UTC: the script's `definitions` stage (the four-coin incumbent reproduced against `sui.json` and
  `set2.json`, worst |Δ| 0; the windows and their buy-and-hold) and a `smoke` stage on a PLACEBO gate that has nothing
  to do with BTC (refuse entries decided on even days of the year). No BTC-regime state was computed.
* 00:08:44 UTC: the pre-registration and the script committed together (`a4ea134`); the script's sha256
  `f77ff388…ce738` is written in the pre-registration and again, by the run itself, in the output.
* 00:09–00:17 UTC: the full run, twice in parallel. **Both wrote `btc_regime.json` byte for byte, sha256
  `c30e5826…7deea0`.** Nothing in the pre-registration was changed; its Corrections section is empty.

## Answer first

**REJECT.** The filter makes the live row's worst window worse in all four evaluations, and it does so beyond chance:

| evaluation | incumbent's worst window (D, sideways) | with the filter | a random veto of the same size does at least as well |
|---|---|---|---|
| shipped · Coinbase (primary) | −7.81 % | **−11.58 %** | in 99.3 % of draws |
| shipped · Kraken | −7.81 % | **−11.58 %** | 98.6 % |
| trail · Coinbase | −3.20 % | **−8.13 %** | 95.4 % |
| trail · Kraken | −3.20 % | **−8.13 %** | 95.8 % |

C1 (improve the worst window) fails 0 of 4, C2 (beat chance there) fails 0 of 4. C3 (cost no other window of A–D
beyond chance) holds. In the fresh non-bear windows no study had scored, the filter also costs window G beyond chance on
three evaluations of four and window H on both trail evaluations. The one window it helps beyond chance is the bear year
A — exactly the caveat §3.9 wrote down: it helps by being out of the market when the market falls, and it pays for that
everywhere else.

## The numbers

Primary evaluation (shipped stop, Coinbase-spliced tape), four coins at $25 slots, the rulebook alone; N chosen in
sample per window from {100, 150, 200}; the null refuses the same number of entries at random (whole breakout episodes,
1,000 kept draws per cell):

| window | regime (buy-and-hold) | incumbent | filter (chosen N) | entries | null p05 / p50 / p95 | reading |
|---|---|---|---|---|---|---|
| A | bear (−45.8 %) | +8.51 %, DD 15.8 % | **+14.61 %**, DD 5.4 % (N 200) | 37 → 15 | −8.05 / +1.25 / +11.20 | better than 99 % of random vetoes |
| B | bull (+59.0 %) | +25.05 %, DD 11.4 % | +22.22 %, DD 11.7 % (200) | 53 → 49 | +15.38 / +23.70 / +29.08 | within chance |
| C | strong bull (+234.6 %) | +55.64 %, DD 7.3 % | +57.05 %, DD 7.3 % (100) | 47 → 41 | +36.55 / +52.61 / +59.59 | within chance |
| **D** | **sideways (−16.7 %)** | **−7.81 %**, DD 15.5 % | **−11.58 %**, DD 16.1 % (100) | 32 → 27 | −9.31 / −5.50 / −2.22 | **worse than 99 % of random vetoes** |
| E | bear (−52.9 %), BTC/ETH | −5.30 % | −2.35 % (100) | 19 → 13 | −19.17 / −7.97 / +1.42 | within chance |
| F | strong bull (+528 %), BTC/ETH | +83.87 % | +65.74 % (150) | 25 → 22 | +42.85 / +63.73 / +78.33 | within chance |
| G | bull (+58.8 %), BTC/ETH | +54.94 % | **+30.88 %** (150) | 18 → 16 | +30.64 / +45.42 / +56.41 | 5.4 % of draws below it |
| H | mixed (+14.7 %), BTC/ETH | +14.45 % | +8.06 % (200) | 19 → 11 | +1.65 / +18.64 / +33.04 | within chance |

The same windows under the other evaluations (incumbent → filter): shipped·Kraken A +3.56 → +7.73, B +28.11 → +24.87,
C +50.95 → +51.88, D −7.81 → −11.58; trail·Coinbase A +1.31 → +7.01, B +14.43 → +13.96, C +47.07 → +47.24,
D −3.20 → −8.13, F +9.31 → +3.17, G +48.65 → +25.44 (1.4 % of draws below it), H +12.34 → +3.48 (1.5 %); trail·Kraken
the same shape. E–H are Kraken's history on both tapes and price identically across tapes, as the pre-registration said.

**No fixed N rescues window D** (primary): N 100 −11.58 %, N 150 −14.52 %, N 200 −13.29 %, against −7.81 %. In D the
gate allows an entry on 56–60 % of decision bars, refuses 21 of 48 entry signals, and the 27 entries it lets through
lose more than the 32 it started from. In A it allows only 21–26 % of bars, which is the whole of its bear-year gain.

**Return over drawdown** (reported, never decides) says the same: the worst window's score falls from −0.50 to −0.72 on
the shipped stop and from −0.29 to −0.70 under the trail.

## What this closes

* §3.9's "one written-down candidate" is rejected on the live configuration, on the house's four windows and on four
  windows nobody had scored. No paper twin follows. §3.17 had already seen the direction on window D at sleeve level
  (five coins, "0 of 3 points improve D"); this test adds the matched null, the four-coin row that is going live, and the
  fresh windows, and all three point the same way.
* The pattern is §3.17's and §3.21's again: every entry gate this repository has priced improves the year it spends out
  of the market and pays in the others. A BTC-regime gate is the purest form of that — it is a bet that the next year is
  a bear year.

## What it cannot show

* The deciding window's direction was already published (disclosed in the pre-registration).
* E–H are two coins on one venue's history; they speak for BTC and ETH.
* The model (Jev) and the daily loss limit are not priced. The v2 gate refuses nothing in window D (the go-live audit's
  A2), so the deciding comparison is the same with it.
* One draw per window.

## Files

* `docs/agents/reviews/2026-09-24-btc-regime-prereg.md` — the frozen pre-registration.
* `docs/agents/backtests/btc_regime/backtest_btc_regime.ts` — the study (imports every simulator, window and sleeve
  function from `backtest.ts`, `agents_strategy.ts` and `backtest_jev.ts`; writes the gate, the fresh-window cuts, the
  in-sample choice and the verdict arithmetic only).
* `docs/agents/backtests/btc_regime/btc_regime.json` — the result (sha256 `c30e5826…7deea0`). Reproduce with the command
  in the script's header over the three tape directories whose sha256 the output records (the same tapes every study
  since §3.15 reads, which are not committed for their size); the definitions stage reproduces `sui.json` and
  `set2.json` to the digit before anything else runs.
