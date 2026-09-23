# Pre-registration CB: deep resting bids for liquidation cascades on Binance spot (fp3, test CB)

Written 2026-09-23 (UTC) before any 1-minute price path, fill or return of this rule was read or
computed. Frozen by the sha256 in `prereg_cascade_bids.sha256` and the UTC time in
`prereg_cascade_bids.frozen_at`.

## Why this is Binance's own

Binance hosts the largest leveraged crowd in crypto, and its liquidation engine and its unified /
portfolio-margin collateral pricing sell into Binance's own spot books; in a cascade the sellers are
forced and price-insensitive, which is the one kind of counterparty that pays a resting bid. Two
Binance-only facts shape the rule: (1) OPO / OTO order lists let the take-profit be placed by the
exchange the instant the bid fills, so a once-a-minute loop can hold the whole trade; (2) since the
rollout of the Price Range Execution Rule (2026-03-09 → about 2026-03-30), no trade may execute
beyond `referencePrice × (1 ± R)`, the reference being the arithmetic mean trade price over the last
300 s (80 buckets × 3.75 s; `GET /api/v3/referencePrice/calculation`), R = 0.15 on BTC, ETH, BNB,
XRP, TRX, DOGE, SOL, 0.25 on 428 other USDT pairs, 0.10 on 80 (`data/binance_executionRules_all.json`,
read 2026-09-23). So the tail the history shows (−50 % to −90 % wicks) cannot print any more, and the
test must price history as the venue now is. The earlier programs tested wick bids only on Revolut X
(the UK book does not wick), on stablecoins (PR2) and on liquid-staking tokens (T3), never on the
coins themselves at cascade depth.

## What was seen before the freeze (disclosed)

* The point-in-time universes (`data/universe_top10.json`, `…top30.json`), built from daily QUOTE
  VOLUMES only; the Binance hourly klines of the top-30 universe were downloaded (`data/bn_1h/`) but
  no price in them was read or summarised.
* The execution rules, the reference-price calculation, the order-type FAQs (OPO, pegged orders).
* Knowledge that 2025-10-10, 2024-08-05, 2022-05 (LUNA), 2022-11 (FTX), 2021-05-19 and 2020-03-12
  were crash days (common knowledge; the second programme measured 2025-10-10 on six alts).
No 1-minute path, fill, exit or P&L of this rule has been computed on any window.

## Data (keyless, public)

* Binance spot 1-minute klines (trade-built) from `data.binance.vision/data/spot/daily/klines/<SYM>/1m/`
  for the SCREENED days (below) and the day before and after each; hourly klines (monthly zips) for
  the screen and the null. sha256 of every zip in `MANIFEST.json`.
* Screen (a necessary condition for any fill, so it removes no fill): day d of symbol s is screened
  when s is in the universe on d and some hour h of d has `low_h < max(high_h, high_{h−1}) × 0.95`.

## Universe

Each UTC day, the 10 USDT pairs with the largest quote volume over the 30 days ending the day before,
among pairs whose current contiguous segment is at least 100 days old, excluding stablecoins, fiat,
pegged, wrapped/staked, leveraged and tokenised-stock bases (the lists of `backtest_xsmom.ts`);
delisted pairs included (`scripts/universe.py`). A coin's bids exist only on days it is in the
universe (a position opened keeps its exit after it leaves).

## Windows (a round trip belongs to the window in which it OPENED)

IS 2020-01-01 → 2022-12-31; OOS1 2023-01-01 → 2024-12-31; OOS2 2025-01-01 → 2026-09-21 23:59 UTC.
Nothing is chosen in sample.

## Rule

* Rungs: `k ∈ {5 %, 10 %, 15 %}`, one bid per rung per coin, $100 notional each; locked capital
  10 × 3 × $100 = $3,000.
* Price and timing ("one minute behind"): the bid resting in minute m is `close(m−2) × (1 − k)`
  (priced from data to the end of minute m−2, placed during m−1). Re-priced every minute.
* Fill (never a touch): minute m fills the rung when `low(m) < bid` (klines are trade-built, so
  the low is a print), at the bid, for the whole $100 — AND, the price range rule applied
  retroactively, only when `bid > ref5(m) × (1 − R_s)`, with `ref5(m)` the mean of the closes of
  minutes m−5 … m−1 and `R_s` the symbol's current multiplier (0.25 for a symbol no longer listed).
* Exit (the OPO pending order): a limit sell at `bid × (1 + k/2)`, live from minute m+1, filled when
  a later minute's `high > target` (strictly), at the target.
* Time stop: still open at minute m + 1,440 → sold at that minute's close as a taker, paying
  10 bps + the half-spread `h_s` (median of `data/cb_spreads.json`, live bookTicker samples taken
  after this freeze; 5 bps for a symbol not listed now). If the data ends first (delisting), sold
  at the last close with the same cost.
* A filled rung stays out until its position closes; it re-arms from the next minute.
* Fees: 10 bps on the entry (maker) and on a target exit (maker); P&L in USDT.

## Arms

1. Primary: as written.
2. Doubled costs: 20 bps a fill, 2 × h_s on taker exits (must stay > 0).
3. Descriptive, no bar: without the retroactive price range cap (history as it printed); each rung,
   coin, year; the post-rollout months 2026-04-01 → 2026-09-21 alone; a "close twin" entering at the
   fill minute's close instead of the bid (how much of the P&L is the wick itself); top-30 universe.

## Null

Random-time twin: each OOS round trip is replaced by an entry at the OPEN of a uniformly drawn hour
(same coin, same window, a day the coin is in the universe), same notional, target
`entry × (1 + k/2)` checked on the hourly highs from the next hour, time stop at the close of the
hour 24 h after entry, same costs; 1,000 draws, `random.Random(20260923)`. The primary's OOS total
must exceed the 95th percentile (sorted draws, index floor(0.95·n)).

## The bar (primary, OOS = OOS1 ∪ OOS2, all of)

1. OOS P&L > 0, and OOS1 > 0 and OOS2 > 0.
2. OOS P&L > the null's 95th percentile.
3. Doubled-cost OOS P&L > 0.
4. At least 30 OOS round trips.
5. Not carried by one month: no calendar month holds more than 40 % of the OOS P&L, and OOS without
   its best month is > 0.
6. The OOS P&L on the locked $3,000, annualised over the OOS days, exceeds 4 % a year (cash).

## Determinism

`analysis/cb_test.py` run twice from the frozen inputs, byte-identical JSON (sha256 recorded).

## What this cannot show

The queue at a deep price in a cascade (strictly-through makes our fill certain); intra-minute order
of low and high (the target is checked only from the next minute); whether a future cascade on the
capped venue resembles the capped history; the UK account's access to each symbol.
