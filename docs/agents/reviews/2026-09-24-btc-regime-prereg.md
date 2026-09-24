# Pre-registration S1: the BTC-regime entry filter on the live row, re-tested on non-bear windows

Written 2026-09-24 00:07–00:09 UTC (`date -u`), BEFORE any BTC-regime arm was run on any window. Nothing above the
"Corrections" heading is edited after results exist. Corrections go below it, dated, and are reported in the study.

Script: `docs/agents/backtests/btc_regime/backtest_btc_regime.ts`, committed with this file, sha256
`f77ff3888737b4e2b9758bf59b28b9a83a4b0039c02d679f2d6c6d59ec4ce738`. It writes
`docs/agents/backtests/btc_regime/btc_regime.json` and nothing else.

## Why this test

Reference §3.9 left one rule idea standing: gate every entry of the 4-hour trend rule on BTC being in an up-regime. It
passed §3.7's bar on SOL, LINK and AVAX in window A, and §3.9 said it improved on the baseline only "by being out of
the market more" in a bear year, so the condition for going further was "the same test with the middle third held out
instead of the last (a window that is not a bear year) agreeing with this one, and then a paper twin". Davies asked for
this last pre-registered candidate to be finished before two strategies go live at $50 each.

## What was already seen (disclosed)

This test is not blind, and says so:

* §3.9 (per coin, window A), §3.10 point 6 (per coin, window B: it clears both windows on LINK, NEAR, SUI and ALGO),
  §3.15 W4 (per coin, window C: it keeps NEAR and UNI against a null of 1.06–1.34 — chance).
* §3.17 S1 priced the same gate on the FIVE-coin sleeve at $20 slots on windows A–D, N chosen in sample per window:
  Δ return A +0.003, B −0.023, C +0.014, D −0.038, worst return over drawdown −0.72 against −0.50, and "makes the
  sideways year worse at sleeve level: median ΔD −5.5 points, 0 of 3 points improve D, on both stop rules". SUI has
  no data in C and D, so that D is this sleeve's D. **The direction on the deciding window is therefore already
  published.** `testingset.json`'s per-N cells were not opened.
* In this session, before writing this: the script's `definitions` stage (the four-coin incumbent on every window and
  evaluation, the window cuts, buy-and-hold per window, where BTC's averages are defined — log below), and its `smoke`
  stage, which runs the arm, null and verdict machinery on a PLACEBO gate unrelated to BTC (refuse an entry decided on
  an even UTC day of the year) with 50 kept null draws. The smoke run showed that a gate refusing about half the entry
  bars at random days moves window D from −7.81 % to +1.89 % on the primary evaluation — which is §3.17's finding
  (anything that stays out helps the sideways year) and the reason the null decides. No BTC-regime gate state at any
  bar, and no arm result, was computed.

What is new here: the live configuration (four coins — it changes A and B only), the house bar with a matched null and
an explicit "cost beyond chance" test, and four FRESH windows no study has scored out of sample.

## The incumbent

`trend-4h-live` as `go_live.sql.draft` creates it: Revolut X, BTC/ETH/SOL/AVAX, four equal $25 slots, seeded
parameters (`DEFAULT_TREND`: fast 20, slow 100, breakout 55/20, ATR 14, trail 3, vol 42), Revolut X's costs
(`backtest.ts` `COSTS.revx`: half the measured spread plus 9 bps taker per fill), the rulebook alone (every published
number prices the rulebook; the v2 Jev gate at 0.45 refused 0 of 32 entries in window D, the deciding window,
`jev_v2.json` and the go-live audit's A2). Four evaluations (§3.19): shipped·coinbase (primary), shipped·kraken,
trail·coinbase, trail·kraken. Sleeve arithmetic: `backtest_jev.ts` `combine` at $25 a slot.

Reproduction (done, definitions stage): `runGated` equals `run` on all 96 coin × window × evaluation cells, and the
sleeve equals `sui.json`'s "without SUI" sleeve on A and B and `set2.json`'s `equal` row on C and D in all four
evaluations, worst |Δ| 0.

| evaluation | A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|---|
| shipped·coinbase | +8.51 % | +25.05 % | +55.64 % | **−7.81 %** | −5.30 % | +83.87 % | +54.94 % | +14.45 % |
| shipped·kraken | +3.56 % | +28.11 % | +50.95 % | **−7.81 %** | −5.30 % | +83.87 % | +54.94 % | +14.45 % |
| trail·coinbase | +1.31 % | +14.43 % | +47.07 % | **−3.20 %** | −1.46 % | +9.31 % | +48.65 % | +12.34 % |
| trail·kraken | +0.33 % | +15.46 % | +38.29 % | **−3.20 %** | −1.46 % | +9.31 % | +48.65 % | +12.34 % |

The incumbent's worst window among A–D is D in all four evaluations.

## The filter — exactly as §3.9 wrote it

At each decision where the rulebook would enter (flat, signal, not cooling down), take BTC's last CLOSED daily candle
at the 4-hour bar's close (day start + 24 h ≤ decision time). The entry is allowed when that close is strictly above
the N-day simple average of BTC's daily closes ending on that day, and refused otherwise; it is allowed where no close
or no average exists yet (`backtest_ideas.ts` `regimeFiltered`). Exits, the 8 % floor, the trail and the two-bar
cooldown are untouched; a refused entry is asked again on the next bar, as the loop does. BTC's daily series is the
evaluated tape's (the Coinbase-spliced dailies on the coinbase evaluations, the Kraken tape's on the kraken ones). The
gate applies to every coin, BTC included. BTC's averages are defined from 2014-01-15 / 03-06 / 04-25 (N = 100 / 150 /
200), before every window's in-sample start.

**The primary arm (decides): N chosen from §3.9's grid {100, 150, 200}** per evaluation × window on that window's
in-sample span, by the gated sleeve's return over max(0.05, drawdown), ties to the larger N. The in-sample span is the
timestamps `backtest_jev.ts` `windowsOn` cuts for A–D (for E–H: the two years before the window), run on the evaluated
tape with warm-up bars from before the span; a coin enters the in-sample sleeve where its span has more than the
101-bar warm-up plus two bars. **Secondary (reported, never decides): each fixed N**, with the share of decision bars
on which the gate allows an entry.

## The windows, and why B, C, D, F, G, H count as non-bear

Rule, fixed before any arm: a window is BEAR when the equal-weight buy-and-hold of its coins over its out-of-sample span
is below −20 %. From the definitions stage (market prices only):

| window | out of sample | coins | buy-and-hold (equal weight) | label |
|---|---|---|---|---|
| A | 2025-09-10 → 2026-09-21 | BTC ETH SOL AVAX | −45.8 % (BTC −28.0, ETH −40.1, SOL −50.2, AVAX −65.0) | bear |
| B | 2024-08-31 → 2025-09-21 | BTC ETH SOL AVAX | +59.0 % | not bear (bull) |
| C | 2023-08-22 → 2024-09-21 | BTC ETH SOL AVAX | +234.6 % | not bear (strong bull) |
| D | 2022-08-22 → 2023-09-22 | BTC ETH SOL AVAX | −16.7 % (BTC +21.4, ETH +3.1, SOL −41.9, AVAX −49.5) | not bear (sideways) |
| E | 2021-08-22 → 2022-08-22 | BTC ETH | −52.9 % | bear |
| F | 2020-08-22 → 2021-08-22 | BTC ETH | +528.0 % | not bear (strong bull) |
| G | 2019-08-23 → 2020-08-22 | BTC ETH | +58.8 % | not bear |
| H | 2018-08-23 → 2019-08-23 | BTC ETH | +14.7 % (BTC +58.9, ETH −29.5) | not bear (mixed) |

A–D are the house's four windows (`loadMeasuredSeries`, unchanged). **E–H are new**: the same one-year steps
`windowsOn` takes for C and D, continued backwards from each coin's Coinbase start, on the Kraken-bundle side of the
spliced series and on Kraken's own 4-hour tape. Only BTC and ETH have history covering every one of them and its
in-sample span, so E–H are two-coin sleeves ($25 slots). No study in this repository has scored an out-of-sample
window before 2022-08. Both tapes are Kraken's there, and the definitions stage shows they price identically, so E–H
carry two distinct evaluations (the two stop rules), not four.

§3.9 asked for "a window that is not a bear year": the deciding windows B, C and D are three, and the incumbent's worst
window, D, is the sideways one. The fresh non-bear windows F, G and H are the out-of-sample test nobody has run.

## The null (decides C2 and C3)

Per evaluation × window, for the primary arm: a random refusal of the SAME NUMBER of entries — whole breakout episodes
refused at random (`backtest_jev.ts` `episodeNullPolicy`, imported), the episode probability bisected (10 steps × 100
draws, seeds `cal`) so the null's mean entries equal the arm's, then only draws whose entries over the window's coins
EQUAL the arm's kept, up to 1,000 (at most 50,000 attempts; seeds `null`). §3.21's H2/H3 null, unchanged. If the arm
takes more entries than the incumbent, no refusal can match it and that window counts against the arm; if exactly as
many, the null is the incumbent itself.

## The bar

In EACH of the four evaluations, on windows A–D:

1. **C1 — it must improve the worst window.** The arm's worst-window return is strictly above the incumbent's
   worst-window return (4 dp, as `combine` rounds).
2. **C2 — beyond chance.** P(null's worst-window return ≥ the arm's worst-window return) ≤ 0.05, draws paired across
   windows by index, ties against the arm.
3. **C3 — without costing the others beyond chance.** In every other window where the arm's return is below the
   incumbent's, at least 5 % of the null's draws must be STRICTLY below the arm (ties against the arm); a window whose
   null cannot be built counts as a cost beyond chance.

**Verdict:**
* **ADOPT** — C1, C2 and C3 in all four evaluations, AND in each fresh non-bear window (F, G, H) C3's test finds no cost
  beyond chance in either stop rule. Adopting means the step §3.9 named — a paper twin of the live row with the filter
  on, measured against it for a quarter — never money on this evidence.
* **REJECT** — C1 fails in any evaluation (the filter does not improve the live row's worst window), or C3 fails in any
  evaluation.
* **INCONCLUSIVE** — anything else: C1 and C3 hold everywhere, but C2 fails somewhere, or a fresh non-bear window is
  costed beyond chance.

The fresh windows can only downgrade ADOPT to INCONCLUSIVE; they never upgrade a verdict. Return over drawdown goes
through C1 and C2 as well and is reported; it never decides.

## Multiple comparisons

One primary arm, one bar. The idea has been priced before, per coin in §3.9, §3.10 and §3.15 and at sleeve level in
§3.17 (the 33-gate search that found nothing repairs the sideways year), which is context, not part of this test.

## Determinism

No wall clock is written. Every draw is `mulberry32(seedOf(purpose, evaluation, window, coin, draw))`. The sources
(`backtest.ts` `31d27c7d…845a`, `agents_strategy.ts` `097c9519…a85a82`, `backtest_jev.ts` `4d5af9e5…d2ed`, this
script) are hashed at the start and the end, and a run that straddles an edit throws. The run is done twice; the two
outputs must be byte-identical.

Inputs (the tapes every study since §3.15 reads; the definitions stage reproduced `set2.json` and `sui.json` from
them to the digit): Coinbase hourly `BTC c773e6ff…`, `ETH 5d922a8b…`, `SOL 8a23665b…`, `AVAX 8713037a…`; Kraken bundle
hourly `BTC 59d4c1fd…`, `ETH cc48c300…`, `SOL a0c55179…`, `AVAX b4d01720…`; Kraken 4h tape `BTC a1109d82…`,
`ETH 614d5c26…`, `SOL 3fe74401…`, `AVAX 99482cd1…`; `set2.json` `60a84be4…`, `sui.json` `badf7b33…`. The full hashes
are written into the output.

## What this cannot show

* The deciding window's direction was published before this was written (above).
* E–H are two coins, not four, and on one venue's history; a pass or failure there is about BTC and ETH.
* One draw per window; the regimes are what the market did, not a design.
* The model (Jev) is not priced; nor is the daily loss limit.

## Definitions-stage log (2026-09-24 00:03 UTC, abridged)

    incumbent (four coins, $25 slots): runGated ≡ run on 96 cells | against sui.json (A, B) and set2.json (C, D): worst |Δ| 0
    window A: BTC/ETH/SOL/AVAX OOS 2025-09-10 → 2026-09-21 | buy-and-hold equal weight −45.8 % → BEAR
    window B: … +59.0 % → not bear      window C: … +234.6 % → not bear      window D: … −16.7 % → not bear
    window E: BTC/ETH OOS 2021-08-22 → 2022-08-22 | −52.9 % → BEAR
    window F: … +528.0 % → not bear     window G: … +58.8 % → not bear       window H: … +14.7 % → not bear
    BTC daily averages defined from 2014-01-15 / 2014-03-06 / 2014-04-25 on both tapes

## Corrections

(none yet)
