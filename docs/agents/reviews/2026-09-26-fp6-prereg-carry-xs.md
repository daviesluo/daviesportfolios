# Pre-registration fp6-H3 CARRY-X: cross-sectional funding carry on Binance's liquid altcoin perpetuals

Written 2026-09-26 (UTC), before any return, funding income, basis change or P&L of this rule was computed on any day
of its window. Frozen by the commit that puts this file on `main`; nothing below may change after it, and any deviation
is reported as a deviation. It is hypothesis H3 of fp6's family of five (`2026-09-26-fp6-prereg-family.md`),
Holm-corrected across the five.

**Access comes first**: the short leg is a derivative; the sources and what they allow are in the family file.

## Why

On BTC and ETH the carry is thinnest: the formula's floor, 0.0100 % per 8 hours, and since 2025 never above it — H1,
which would have priced it there, was withdrawn on that arithmetic (the family file). Binance's own structure makes the
carry far larger elsewhere: every USDⓈ-M perpetual pays funding of up to ±2 % a settlement (BTC ±0.3 %), and
since 2025-05-02 a contract whose funding hits its cap settles every hour (Binance FAQ 360033525031, updated
2026-03-06). When a coin is in demand as leverage, its longs pay far above 10.95 % a year, and a holder of the spot who
is short the same perpetual collects it. The three earlier searches priced funding only as a directional signal
(FUND, §3.21 H3, fp5's screens) and the basis only on BTC (SPQTR); nobody has priced the carry across Binance's list,
which is where it is largest.

## What was seen before the freeze (disclosed)

* fp5's SPQTR results (the Binance branch, `b348842e`; the fp5 review), the FUND study (§3.34), §3.21's H3 (BTCUSDT's
  daily summed funding as an entry filter), the venue survey, two BTCUSDT funding prints read while testing the
  endpoint on 2026-09-26 (+0.0049 % and −0.0005 % per 8 hours), and the withdrawn H1's counts of BTC and ETH
  settlements at, above and below the floor (the family file); §3.24's point-in-time Binance universe work (the
  listing-age filter idea, the dead included);
  fp5's "Funding cash, other names" (single-settlement extremes on PEPE, TRB, BLZ and UNFI; the Binance branch's
  reference, `b348842e`).
* In this session, counts only (`measurements.json` → `h3`): the universe's size over time, the rule's packages,
  closes by reason, holding lengths and slot-days by half, and the median coin's standard deviation of the daily change
  in its perpetual-to-spot basis over the window (no rule applied). Counting needs the rule's own tests (trailing
  funding against 25 % and 5 %, the universe's volume ranking, the +40 % guard against the perpetual's daily high), so
  which coins and days qualified is known as counts. No return, funding income, basis level or P&L was written.

## Data (`docs/agents/backtests/fp6/`, keyless, hashes in `manifest.json`)

* `inputs/perp_1d.json.gz`: daily klines of every USDⓈ-M perpetual quoted in USDT or USDC in the archive, delisted ones
  included (2022-06 → 2026-09), archive zips checked against their published sha256, September 2026 from REST.
* `inputs/spot_1d.json.gz` and `inputs/perp_spot_pairs.json.gz`: daily klines of every Binance spot USDT pair that
  matches a perpetual (same base, or the base with a 1000 / 10000 / 1000000 / 1M multiplier stripped).
* `inputs/funding.json.gz`: every settlement of those perpetuals (archive, and REST for September 2026).
* `inputs/books.json.gz`: twenty bookTicker samples, 60 s apart, 2026-09-26, of every USDT perpetual and spot pair.

## The rule (`rules.py` `h3_universe`, `h3_run`, frozen with this file)

Decisions at 00:00 UTC each day d from 2023-01-01 to 2026-09-24; fills at d's daily opens.

* **Universe U(d)**: crypto USDT perpetuals (`rules.py` `crypto_contracts`: not a TradFi or index contract) with a
  matching Binance spot USDT pair; base not BTC, ETH, a stablecoin or an index (`H3_EXCLUDE_BASES`); perpetual and spot
  pair both first traded at least 60 days before d; both with a daily bar on d − 1 and on d; ranked by the perpetual's
  quote volume summed over d − 30 … d − 1. Top 40 to enter, top 60 to stay.
* **Signal**: A3(p, d) = the sum of p's funding rates settled in [d − 3 days, d), × 365 / 3.
* **Each day, in order**: (1) a package whose perpetual traded 40 % above its entry price on d − 1 was closed during
  d − 1 at that level (the guard, before a 2× short is liquidated near +48 %); (2) at d's open close every package
  whose A3 is below 5 % or unknown, or whose coin left the top 60; (3) at d's open open packages on the top-40 coins
  with A3 ≥ 25 %, highest first (ties by symbol), while fewer than five are open, skipping a coin closed less than two
  days before.
* **A package**: $1,000 of capital: spot bought for $666.67 (0.10 % spot taker, + half-spread) and the same notional of
  the perpetual sold at its open (0.05 % USDⓈ-M taker, − half-spread) — equal notionals, so a 1000× contract
  (1000PEPEUSDT against PEPEUSDT) is sized by price, not by units — with $333.33 of USDT as the short's 2× margin. At
  the close the reverse at the same costs. At the guard: the perpetual is bought back at max(1.40 × entry, the day's
  open) plus the half-spread, and the spot sold at that price × (the day's spot close / perpetual close). Funding:
  every settlement with bucket in (entry day, exit day] adds q × the perpetual's open that day × the rate (received
  when positive, paid when negative); for a guard close, every settlement up to the end of the guard day (a squeezed
  short usually pays, so this is the costlier reading).
* **Half-spreads**: a pair's median over the twenty samples, half the full spread, at least 1 bp (spot) and 0.5 bp
  (perpetual); a pair not listed on 2026-09-26 takes the 90th percentile (sorted value at ⌊0.9 (n − 1)⌋) of the listed
  ones: 11.79 bp (496 USDT spot pairs) and 3.56 bp (525 crypto USDT perpetuals).
* **The sleeve**: five slots, $5,000; idle slots earn nothing; marks at every day's open, each package at its two legs'
  opens.

The window is the 1,363 days from 2023-01-01 to 2026-09-25. Halves by day: 2023-01-01 → 2024-11-12 and
2024-11-13 → 2026-09-25; the last twelve months: 2025-09-25 → 2026-09-25; P&L is counted on the day it accrues.
Capital $5,000; annualised = P&L / $5,000 × 365 / days.

## The null (for condition 8)

The same packages — the same entry days and holding lengths — each on a coin drawn uniformly, with replacement, from
U(d) at its entry day less the coins the rule held that day, priced exactly as the rule's (costs, funding, guard).
2,000 draws, seed `fp6-carry-xs`. p_sel = (1 + #{null P&L ≥ rule P&L}) / 2,001.

## The bar (a PASS needs every condition)

1. Annualised return on the $5,000 over the window ≥ 8 %.
2. Circular block bootstrap of the daily P&L (30-day blocks, 10,000 resamples, seed `fp6-carry-xs-boot`), H0 "the
   annualised mean ≤ 8 %", clearing its Holm step among the five.
3. Each half ≥ 4 % a year.
4. The last twelve months ≥ 4 % a year.
5. Condition 1 with every fee and half-spread doubled.
6. The best calendar month at most 40 % of the P&L, the rest positive.
7. Maximum drawdown of the daily marks at most 20 % of capital.
8. Choosing coins by their funding beats choosing them at random: p_sel ≤ 0.05.

## Descriptive, not in the bar

The P&L split into funding, basis and costs; the guard's closes; the packages, coins and holding lengths; a grid of the
entry line (10 / 25 / 50 %) and slots (3 / 5 / 10) as a plateau, never deciding; the USDC-margined twins where they
exist.

## Power check (`measurements.json` → `h3`)

* **Counts**: the coins passing every filter before the volume cut grow from 142 on 2023-01-01 to 365 by September
  2026 (at most 380). The rule opens 84 packages on 49 coins — 56 in the first half, 28 in the second, 16 in the last
  twelve months — and closes 35 by its funding test, 33 at the +40 % guard, 15 when the coin leaves the top 60 and 1 at
  the window's end. A package is held a median 13.5 days (quartiles 5 and 33; mean 19.7). Of the 6,815 slot-days
  (5 × 1,363) it holds 1,653: 1,211 in the first half, 442 in the second, 147 in the last twelve months.
* **What the bar needs, from the counts alone.** Idle slots earn nothing, so condition 1 (≥ 8 % a year on $5,000, at
  least $1,494) needs the packages to earn, net of every cost, $0.90 a held slot-day: 33 % a year on the capital they
  tie up, 49 % on their notional. Condition 3 needs 11 % a year on held capital in the first half and 31 % in the
  second; condition 4 needs 50 % on the 147 slot-days of the last twelve months (74 % on notional). The entry line is
  25 % a year of trailing funding on notional; the exit, 5 %.
* **Noise** (no rule; `medianCoin…` in `h3`): over the window the median coin's daily change in its perpetual-to-spot
  basis has a standard deviation of 0.84 % of notional, and its daily funding sum 0.136 %. With 1.21 packages open on
  an average day, the standard error of the annualised mean on $5,000 is about 1.2 % a year if days were independent
  and 1.3 % with BTC's measured persistence as a stand-in (the basis mean-reverts, funding persists), so condition 2
  sees an excess of about 4 % a year over the 8 % line (80 % power, 0.05 / 5 one-sided).
* **Condition 8**: a package's basis change over the mean hold of 19.7 days has a standard deviation of at most 3.7 % of
  notional (the random-walk bound), so the selection null sees the rule's coins beating random ones by about 1.0 % of
  notional a package on average (80 % power, 5 %). Funding at the entry line over that hold is 1.35 % of notional, at
  the formula's floor 0.59 %: the null sees the selection only if the chosen coins keep paying well above the line.
* So the test is decided by the level of the funding the rule collects and by what its guard closes cost (33 of 84),
  not by noise; condition 4 rests on 16 packages.

## Determinism, and what it cannot show

`score_carry.py` (phase 2) reads only `inputs/`, recomputes every count above from them and stops if one differs,
checks the sha256 of this file and of `rules.py`, writes `carry_xs.json` with sorted keys, fixed rounding and no clock,
and runs twice, byte-identical. It cannot show access; historical spreads (it uses
one evening's, doubled in condition 5); a squeeze inside a day beyond what the daily high shows; auto-deleveraging;
Binance's changes to caps and intervals, which it reads only as they happened; or custody risk on Binance.
