# Pre-registration — the cross-sectional reversal and low-volatility (xsrev) study

Written 2026-09-23 from 08:07 UTC (`date -u` read 08:07:02Z), BEFORE any
candidate arm, grid point, null draw or combination was run. Nothing above the
"Corrections" heading is edited after results exist. A mistake found later is
corrected by a dated note APPENDED below that heading, and every such note says
whether it changed a decision and is reported with the results.

## 0. State of play when this was written

- The study is `supabase/functions/agents/backtest_xsrev.ts` → `docs/agents/backtests/xsrev.json`.
  Script sha256 at the freeze: `d7c7363193a6e79b16560710df8cec316f7ec075fc5ae3fa68165303db1e5815`.
- Inputs are xsmom's, unchanged: klines manifest `24cf84bd…`, exchangeInfo
  `8fb2eab1…`, book samples `c520f902…`, `set2.json` `60a84be4…`; plus, read to
  check reproduction, `xsmom.json` `5b68bee9…` and `sui.json` `badf7b33…`.
- **Disclosure — what ran before the freeze.** `--stage data`, once, at 08:05 UTC
  (`$S/research_bd/xsrev/stage_data_1.out`). It rebuilt the universe, the
  incumbent on four evaluations, the four-coin live row, the three benchmarks of
  xsmom (top-30 equal weight, BTC held, the four-coin control) and xsmom's four
  simulator checks — every one a number already published in `xsmom.json`,
  `sui.json` or `set2.json` — and confirmed each equal, 13 of 13. It computed each
  universe member's 3/7/14-day return and 30-day volatility on every day from
  2019-06-30 to 2026-09-18 only to confirm they exist (79,140 member-days),
  discarding the values: nothing was ranked, held or priced. Then two
  counterfactual runs, each with a doctored copy of `xsmom.json` (one benchmark
  digit; one universe date), were both refused by the gate. Writes nothing.
- No candidate, grid point, null draw or combination number exists anywhere.

## 1. The question

xsmom (reference §3.24) found that long-only weekly MOMENTUM over a
point-in-time top-30 Binance USDT universe fails the bar (0 of 7), saw last
week's winners reverse, and left reversal and low volatility untested as "a new
search". This is that search — the SECOND on this universe (xsmom's seven were
the first). Everything but the signal is xsmom's.

## 2. Data and universe — xsmom's, unchanged

- Daily klines of every USDT pair in Binance's keyless bulk archive (734 series,
  delisted pairs included), 2017-08-17 → 2026-09-22, verified file by file
  against the manifest. Rows `[open_time_sec, open, high, low, close, base_vol,
  quote_vol, trades]`.
- Segments: every missing day starts a new segment (xsmom's correction 1); a
  holding is sold at its segment's last close; a new segment must age again.
- Excluded by construction: xsmom's lists (50 leveraged tokens, 29 stable /
  fiat / pegged, 66 tokenised equities), copied verbatim; the run checks its
  excluded set equals `xsmom.json`'s `inputs.excluded`.
- Eligible on the close of day d: not excluded; a kline on each of d−29 … d;
  current segment at least 100 days old (d − first + 1 ≥ 100). Universe = the 30
  eligible pairs with the largest 30-day quote volume (sum over d−29 … d), ties
  by symbol. IS_START = 2019-07-01 (xsmom's).

## 3. Calendar, windows, costs, mechanics — xsmom's, unchanged

- Weekly: decide on Sunday's close (UTC), fill at Monday's daily open. Every run
  also forms its book on its first day (decision on the prior close).
- Out of sample: A 2025-09-10 → 2026-09-19 (375 d), B 2024-08-31 → 2025-09-09
  (375), C 2023-08-22 → 2024-08-30 (375), D 2022-08-22 → 2023-08-21 (365), daily
  bars inclusive, checked at run time against `windowsOn` on BTC/USD. In sample
  for window W: IS_START → the day before W starts.
- Costs: 10 bps a side on every fill, plus half the full spread per side — the
  median of the 25 committed samples for the 25 measured pairs, and for every
  other pair the widest measured median, 20.429 bps (PEPE's).
- $100 per window, starting in cash; $5 minimum notional. Each holding targets
  1/k of equity (cash + holdings at the open; a pair that does not trade that day
  at its last close). Holdings leaving the target are sold whole; kept holdings
  are trimmed or topped up only when the difference is at least $5; a new entry
  under $5 is skipped; a full exit always executes. Sells before buys; buys
  scaled down if fees leave cash short. Marked at daily closes; the last day is
  marked, not liquidated. A holding whose segment ends is sold at that day's close.

## 4. The signals and the six candidates

- **Reversal**, lookback L: r = close(d) / close(d−L) − 1 at the decision close
  d. Hold the k universe members with the LOWEST r; ties by symbol.
- **Low volatility**: σ = the sample standard deviation (divisor n − 1) of the
  30 simple daily returns close(t) / close(t−1) − 1, t = d−29 … d (31 closes, all
  inside the current segment, which the 100-day age guarantees and the run
  checks). Hold the k members with the LOWEST σ; ties by symbol.
- **BTC regime filter** (xsmom's): the whole book is cash while BTCUSDT's close
  at the decision is below the mean of its 200 closes d−199 … d.
- Each holding at 1/k of equity; no absolute filter; long only.
- The six candidates, the only arms the bar judges:
  - **R1** reversal, k = 5, L = 7, filter off — fixed at the seed.
  - **R2** = R1 with the regime filter — fixed.
  - **R3** reversal, filter off, (k, L) chosen in sample per window over
    k ∈ {3, 5, 10} × L ∈ {3, 7, 14} (9 points; grid order k then L).
  - **V1** low volatility, k = 5, filter off — fixed at the seed.
  - **V2** = V1 with the regime filter — fixed.
  - **V3** low volatility, filter off, k chosen in sample per window over
    k ∈ {3, 5, 10} (3 points).
- **The choice** (R3, V3) is xsmom's C7's: the best in-sample return /
  max(0.05, in-sample max drawdown); the first in grid order wins a tie; the in
  sample for window W is IS_START → the day before W.
- R3 and V3 choose over the grid named for this study (k, and for reversal L),
  with the filter off; the filter is judged at the seed by R2 and V2. The same
  choice with the filter added to the grid (18 and 6 points) is reported and never
  decides.
- The descriptive grid, each point out of sample with its own null: reversal
  regime × k × L (18 points), low volatility regime × k (6) — 24 in all.

## 5. The null — xsmom's primary null, unchanged

At each rebalance it holds as many coins as the candidate holds (the same cash
weeks and unfilled slots), keeps as many of its own current holdings as the
candidate keeps (chosen at random among those still in the universe), and fills
the rest with coins drawn uniformly from the same 30-pair universe that it does
not already hold. Same engine, costs and minimum. 1,000 draws per grid point per
window; a candidate uses its chosen point's draws in each window. Seeds
`seedOf("xsrev-null", point, window, draw)` through `mulberry32` (both imported
from `backtest_jev.ts`). Note, never deciding: the null matches exposure and
turnover, not volatility or beta — a low-volatility book that loses less than
random coins in a falling window is partly holding the calmer coins, and the
write-up says so wherever it matters.

## 6. The bar — xsmom's, unchanged

A candidate PASSES when (1) its out-of-sample return is > 0 in window A AND in
window B, and (2) its worst window of A–D is above the 95th percentile of its
null's worst window — per draw, the minimum over A–D of that draw's four window
returns; the percentile is s[floor(0.95 · 1000)] of the sorted 1,000; "above"
is strict. P(null worst ≥ candidate worst), ties against the candidate, beside
it. Every window's return, drawdown, turnover and fees are reported. §4.15's
35 % drawdown limit is flagged: a pass with a window over it fails that limit
and cannot be recommended for money.

## 7. The chance count

- For each candidate, p = the share of its 1,000 null draws that pass the same
  bar (A > 0, B > 0, worst window above the candidate's own null threshold).
  Expected passes by chance = Σ p over the six; P(≥ observed) is the exact
  Poisson-binomial tail (independent candidates); P(≥ 1) also for identical
  candidates (max p). The 24 grid points as fixed arms: the same count,
  descriptive.
- **Both searches**: the same count over xsmom's seven candidates (their p's and
  0 passes read from `xsmom.json`) plus this study's six — 13 candidates.
- Looks: 6 candidates × 4 windows decide; 24 points × 4 windows × (in, out of
  sample) and the descriptive arms are reported.

## 8. The reproduction gate (before any candidate)

The run must reproduce, byte for byte as JSON, `xsmom.json`'s: input hashes;
spreads; IS_START and windows; excluded pairs; `inputs.everInUniverse` with the
count, the delisted members and the per-window membership; the USDC/USDT check;
the `reproduction` block (the incumbent on four evaluations against `set2.json`
and the published +8.03 / +20.08 / +55.64 / −7.81 %, runGated ≡ run, the
simulator checks); and the benchmarks — the top-30 equal weight, BTC bought and
held, and the four-coin control — in A–D. And the live row (section 9) must
equal `sui.json`'s drop-SUI figures in A and B and `set2.json`'s equal row in C
and D on all four evaluations, worst |Δ| 0. It refuses to continue otherwise.

## 9. The combination with the live row

- **The live row** is `trend-4h` on Revolut X as it will go live (go-live draft
  `0049`): BTC/ETH/SOL/AVAX, four equal $25 slots, $100, primary evaluation
  (shipped stop, Coinbase-spliced tape) — xsmom's incumbent's per-coin runs
  without SUI: A +8.51 / B +25.05 / C +55.64 / D −7.81 %. xsmom's five-coin
  incumbent is reported beside it (C and D hold the same four coins in both).
- Per candidate and benchmark, per window, on the xsrev window calendar: Pearson
  correlation of daily returns (all days; the row's exposed days), and **half
  each** — $50 in the xsrev book and $50 in the row, each compounding in its own
  account with no transfer, summed — return, drawdown and return/drawdown against
  the row alone on the same calendar.
- **"Adds"** only if ALL of: the candidate passes the bar; the half-each book's
  worst-window return AND worst-window return/drawdown beat the live row alone's;
  and the half-each worst window beats the same combination built with the
  candidate's null draws (P < 0.05). Judged against the four-coin live row; the
  five-coin figures never decide.

## 10. Reported, never deciding

The 24 grid points (share positive per window per signal, each point's null p95
and bar result, the grid-as-fixed-arms count); R3 and V3 with the filter in
their grid; BNB fees (7.5 bps); spreads doubled; the rebalance weekday (all
seven; the Monday entry must equal the primary exactly); per candidate the coins
it held most; the benchmarks and the four-coin control.

## 11. Reading rules, fixed now

- No candidate passes → the answer is no: neither reversal nor low volatility on
  this universe clears the bar; no row is proposed.
- One or more pass but this study's P(≥ observed | chance) ≥ 0.05 → the passes
  are inside chance; at most a paper MEASUREMENT row could be argued, never money.
- Passes and this study's P < 0.05 → a paper row on Binance is recommended (paper
  first; live only on Davies' word; a window over 35 % drawdown blocks money) —
  unless the count over both searches gives P ≥ 0.05, in which case the pass is
  read as inside chance across the two searches on this universe and at most a
  paper measurement row could be argued.
- The combination changes nothing unless "adds" holds.

## 12. Determinism and verification

- No wall clock in the output. Two runs from a clean start must write the same
  sha256.
- An independent Python re-implementation, written from this text and not from
  the TypeScript, must reproduce the universe (`everInUniverse`), the benchmarks,
  every candidate's out-of-sample daily equity path (written into the output to
  six decimals), R3's and V3's in-sample choices, and the first ten null draws of
  every candidate window — to rounding.
- At the end, `backtest.ts`, `backtest_jev.ts`, `backtest_jev_other.ts`,
  `backtest_xsmom.ts`, `backtest_maker.ts` and `_shared/agents_strategy.ts` must be
  byte-identical to `origin/main` (`c0c9230`).
- Nothing in this study uses a key, places an order or writes to a database.

## Corrections

(none at the freeze)
