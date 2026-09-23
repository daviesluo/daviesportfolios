# Pre-registration: sizing and entry filters for the live row trend-4h

Written 2026-09-23 03:03 UTC (`date -u`), BEFORE any hypothesis arm was run on
data. Nothing above the "Corrections" heading is edited after results exist.
Corrections go below it, dated, and are reported.

What had been run when this was written: the incumbent reproduction and the
definitions stage of `supabase/functions/agents/backtest_sizing.ts`
(`--stage definitions`, log `sizing_work/definitions.log`). That stage computes the
incumbent, H1's target, the filters' coverage and H1's placebo donors. It runs
no arm, and it computes no filter's on/off state at any entry. The desk study's
"first looks" (`research_bd/report.md`) were read as context only. Its analysis
outputs (`analysis/*firstlook*.json`) were not opened.

## Incumbent (the thing each arm must beat)

- Row `trend-4h`, Revolut X, BTC/ETH/SOL/AVAX/SUI, five equal $20 slots
  ($100; $80 in windows C and D, where SUI has no data). Seeded parameters
  (`DEFAULT_TREND`: fast 20, slow 100, breakout 55/20, ATR 14, trail 3, vol 42).
  Revolut X costs as `backtest.ts` `COSTS.revx` (the touch: half the measured
  spread, plus 9 bps taker per fill).
- Windows A (bear), B (bull), C (strong bull), D (sideways) are cut by
  `backtest_jev.ts` `loadMeasuredSeries` / `windowsOn`, unchanged.
  Out-of-sample decisions run from 2025-09-09/20 to 2026-09-19/20 (A),
  2024-08-30/09-20 to 2025-09-08/20 (B), 2023-08-21/09-21 to 2024-08-29/09-20 (C),
  and 2022-08-21/09-21 to 2023-08-20/09-21 (D). BTC/ETH/SOL come first, AVAX/SUI second.
- Four evaluations (§3.19): shipped·coinbase (primary), shipped·kraken,
  trail·coinbase, trail·kraken. That is the Coinbase-spliced tape or Kraken's own 4h
  tape, crossed with the shipped 8 % floor or the retired 3×ATR(14) intra-bar trail.
- Sleeve arithmetic: `sleeveStatsOf` / `combine` from `backtest_jev.ts`.
- Reproduction (done): the incumbent equals `set2.json`'s `equal` row on all
  four evaluations and windows, and the published sleeve on the primary one:
  A +8.03 % / B +20.08 % / C +55.64 % / D −7.81 %, worst |Δ| = 0.
  `runGated` equals `run` on all 72 coin × window × evaluation cells.
- Decision time: the close of the 4h signal bar (bar start + 4 h). A daily
  input is read from the most recent UTC day that has CLOSED at that instant
  (day start + 24 h ≤ decision time). This is the rule `run` applies to daily
  candles. For every bar except the one closing at 00:00 UTC, that day is the
  day before the bar's own day. Nothing later is read.

## H1: volatility-targeted entry size

- Entry size: each entry deploys f = min(1, TARGET / vol) of the slot's cash.
  The remainder stays in cash until the trade closes. Unlevered: f ≤ 1, so an
  entry never exceeds $20 at start. Entries, exits, stops and cooldowns are the
  incumbent's. No decision reads position size, and fees and spreads are
  proportional, so the scaled slot's equity is computed exactly from the
  incumbent's own marks as C′·(1 − f + f·E/C). That identity is checked with
  f ≡ 1 on every cell, and by a trade-product recomputation.
- vol: `realisedVol` (the rulebook's function) over the last 30 daily log
  returns of the evaluated tape's completed daily candles at the decision time.
  It uses the population stdev, annualised ×√365. "Evaluated tape" means the
  Coinbase-spliced dailies on the coinbase evaluations and Kraken-tape dailies on the kraken ones.
- TARGET = 0.7405 (74.05 % annualised; the exact float is written to
  sizing.json). It is the median of that same measure pooled over the five coins and
  every UTC day of window A's in-sample span (each coin's Coinbase series from
  its first day: 2023-08-22 for BTC/ETH/SOL, 2023-09-22 for AVAX/SUI), cut at
  the earliest window-A out-of-sample start among the five (last day used
  2025-09-09). That is 3,688 coin-days. It was fixed from volatility alone, before any
  return of any arm was seen. Per-coin medians for context: BTC 44.3 %,
  ETH 61.0 %, SOL 79.9 %, AVAX 88.1 %, SUI 102.9 %. Known consequence: this
  target is in-sample for windows B and C, and computed from data later than
  window D. It is a level of volatility, not a return.
- Venue minimum: Revolut X `min_order_size_quote` $0.10 on all five coins
  (reference §4 item 19). An entry under $0.10 would be counted and skipped.
  Skipping would change the path, which this arithmetic cannot price, so the run
  stops if any occurs.
- Null (DECIDES): placebo volatility, 2,000 draws. For each draw and coin, f is
  computed as above from the vol of the same coin 365–730 days before each
  decision. The shift is uniform over whole days and capped by the coin's
  history (SUI in B 365–476, AVAX in C 365–609, SOL in D 365–400). Where the
  coin's own history cannot reach 365 days before the window's first decision (AVAX in D only,
  both tapes), a donor is drawn uniformly from BTC, ETH and SOL (SOL 365–431 d).
  There is a fresh donor and shift per coin per draw (`seedOf("h1-placebo", evaluation,
  window, coin, draw)`).
- Second null (REPORTED, NEVER DECIDES): the arm's own multipliers permuted at
  random among the coin's own entries in the window, 2,000 draws. It keeps the
  amount of scaling exactly and destroys only its timing.
- Windows judged: A, B, C, D.
- Reported per window × evaluation: return, max drawdown, Sharpe (daily
  sleeve returns by `combine`'s arithmetic, mean/sd × √365, no risk-free
  rate), average idle capital (time-average of the cash share of each slot,
  averaged over slots, and in $), entries, entries scaled, mean and min multiplier,
  entries under the venue minimum.

## H2: DVOL entry filter

- Index: Deribit DVOL daily close. BTC DVOL gates BTC, SOL, AVAX and SUI
  entries. ETH DVOL gates ETH entries. The day still forming when the file was
  fetched (2026-09-23) is dropped.
- Rule: at each decision where the rulebook would enter (flat, signal, not
  cooling down), the entry is refused if the reference day's DVOL is strictly
  above the 244th smallest of the 365 daily closes ending on the reference day,
  that day included. That is the top third: at most 121 of 365. The rulebook asks
  again on the next bar, exactly as the live loop does, so a refusal can delay an
  entry or remove it. One threshold, fixed now, no tuning.
- Coverage: the filter is defined for reference days 2022-03-23 → 2026-09-22.
  Every decision of every coin in all four windows on both tapes is covered.
  **H2 is judged on A, B, C and D.**

## H3: funding entry filter

- Input: Binance USDⓈ-M perpetual funding, the coin's own
  (BTCUSDT, ETHUSDT, SOLUSDT, AVAXUSDT, SUIUSDT), summed per UTC day (the file's
  daily sums of the printed rates).
- Rule: the 7-day mean of the daily sums for the seven days ending on the
  reference day. The entry is refused if that mean is strictly above the 292nd
  smallest of the 365 such 7-day means ending on the reference day (the top
  fifth, at most 73 of 365). The strict inequality means a mean tied with the
  threshold does not count, because funding sits on its floor for weeks. One threshold,
  fixed now, no tuning.
- Coverage: funding data ends 2026-08-31 (no September file exists yet; the
  daily and September archives return 404). The filter is defined from 2021-01-05
  (BTC, ETH), 2021-09-18 (SOL), 2021-09-27 (AVAX), 2024-05-07 (SUI) to
  2026-08-31. Window A's decisions from 2026-09-01 on (109–118 per coin) are
  uncovered. **H3 is judged on B, C and D only. A is not priced for H3.**

## Null for H2 and H3 (DECIDES): skip the same number of entries at random

- Per evaluation × window, the null takes exactly as many entries as the arm,
  summed over the window's coins. It therefore removes the same net number
  of entries as the arm relative to the incumbent.
- Mechanism: whole breakout episodes are refused at random, using `backtest_jev.ts`
  `episodeNullPolicy`, imported. An episode is a run of consecutive bars on which the
  rulebook wants in. The episode-refusal probability is bisected (10 steps ×
  100 draws, seeds `cal`) so the null's MEAN entries equal the arm's. Draws
  (seeds `null`, one per attempt) are then kept ONLY when their entries equal
  the arm's exactly, until 1,000 are kept, with at most 50,000 attempts. The kept count is reported. If the
  arm takes more entries than the incumbent, no refusal can match it and the
  hypothesis cannot pass in that evaluation. If it takes exactly as many, the null
  is the incumbent itself.
- Reported per window: arm return, max drawdown, Sharpe, idle capital, entries,
  signals refused (bar-level refusals), net entries removed; the null's
  p05/p50/p95/mean and P(null ≥ arm).

## The bar (the same for H1, H2 and H3)

In EACH of the four evaluations, on the windows the hypothesis is judged on:

1. The arm's worst-window return is strictly greater than the incumbent's
   worst-window return on the same windows. Returns are the sleeve's, rounded to
   4 dp as `combine` rounds them.
2. P(null's worst-window return ≥ arm's worst-window return) ≤ 0.05, with ties
   counted against the arm (`atLeast`). This means the arm is above the null's 95th
   percentile of worst-window returns. The null's worst window is taken draw by
   draw, pairing draws across windows by index.

A hypothesis PASSES only if 1 and 2 hold in all four evaluations. Return over
drawdown (ret / max(0.05, maxDD), `score`) goes through the same test and is
reported beside it. It never decides.

Multiple comparisons: three hypotheses are tested. The nominal per-hypothesis level
is 0.05. The Bonferroni level for the family is 0.0167, reported as context.
H1 re-tests an idea already priced in this repository (per-entry volatility
scaling, §3.10 point 8, §3.11 A2, §3.19 A2 `volScaledPerEntry`). H2 and H3 are
entry gates of the kind §3.17 S1 priced 33 of. Those earlier looks are counted
in the context, not in the test.

## Determinism and outputs

`supabase/functions/agents/backtest_sizing.ts` writes
`docs/agents/backtests/sizing.json` and nothing else. It writes no wall clock.
Every draw comes from `mulberry32(seedOf(purpose, evaluation, window, coin, draw))`.
Source files are hashed at the start and the end. Inputs: DVOL sha256
`30bfd643…21dc0`, funding sha256 `a5c25f58…43d17`. The run is done twice, and the two
sha256s must match.

## Corrections

- 2026-09-23T03:07:35Z (written while the first full runs were in progress, before any of their output was read; a label, not a definition): the incumbent section's date ranges for windows A–D are the first and last REFERENCE days of each window's decisions (the last closed UTC day at each decision, as printed by `--stage definitions`), not the decision dates. The decisions themselves run one day later, e.g. window A 2025-09-10 → 2026-09-20 for BTC/ETH/SOL, matching `set2.json`'s window spans. Nothing computed changes.
