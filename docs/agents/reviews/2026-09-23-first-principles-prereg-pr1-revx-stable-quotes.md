# Pre-registration: resting quotes around fair value on Revolut X's stablecoin books (PR1)

Written 2026-09-23, before any return of this rule was computed. Frozen by the sha256 in
`prereg_revx_stable_quotes.sha256` and the UTC time in `prereg_revx_stable_quotes.frozen_at`.

## What was already seen (disclosed)

* Counts only, IS half: hours in which each book traded `k` away from the fair value defined
  below (`analysis/is_wicks_hourly.py`). USDC/GBP, 1,664 traded IS hours: trades beyond 0.25 % below
  fair in 555, above in 461; 0.5 %: 94 / 84; 1 %: 66 / 30; 2 %: 23 / 10. USDT/GBP (1,882): 721 / 888;
  13 / 48; 2 / 6; 0 / 1. USDC/USD (1,270): 15 / 26; 0 / 1; 0 / 1; 0 / 0. USDT/USD (1,754): 14 / 17; 1 / 3; 0 / 3.
* The five lowest lows and highest highs of each book over the WHOLE year (a sanity print that
  included out-of-sample hours: USDC/USD 0.96 on 2026-07-06; USDC/GBP 0.716 on 2026-03-17 and 0.72 on
  2026-03-20; USDT/USD 0.9881 on 2026-08-21, among others).
* The year's deviation statistics of the stable/GBP books against the BTC-implied rate
  (`results/a_crosscurrency_hist.json`: medians, quantiles, AR(1) half-life 0.6–0.9 h, the share of a
  gap the book closes, monthly mean |dev| falling from ~20 bps to ~5 bps). These are measurements
  of the price series, not of this rule's P&L.
No P&L, fill-by-fill outcome or exit path of this rule has been computed on any window.

## Hypothesis

Revolut X's four stablecoin books (USDC/USD, USDT/USD, USDC/GBP, USDT/GBP; UK region) are thin, are
hit by retail market orders, and have a fair value that is known from outside the book (the peg for
the USD books; the peg divided by the GBP/USD rate for the GBP books). A resting post-only order a
fixed distance from fair costs nothing to leave in place (0 % maker) and is filled only when someone
trades through it; because fair value is pinned, the price returns and the order earns the
distance. The claim tested: this earns money after costs out of sample, more than the same trades
at random times, and survives doubled costs.

## Data (all keyless, public, UK book)

* Revolut X 1-hour candles, `GET /api/1.0/public/candles/{SYM}?interval=60&region=UK`:
  `data/revx_hist/{USDC-USD,USDT-USD,USDC-GBP,USDT-GBP,BTC-USD,BTC-GBP}_60m.json`
  (rows `[start_ms, open, high, low, close, volume_base]`). sha256 at freeze:
  - USDC-USD a6462aee61697b8a2a5cca38d030525e09d59c26fff0385c64af7bfca8672723
  - USDT-USD 4c2aaf9b4128f881f8f9cb317b59b0594d66acf5a54305f959b469235006b84d
  - USDC-GBP 07b0f67208e22b7a537575035d9c67191df42c3612c7fa792c6ffe84bb296ae0
  - USDT-GBP a5dbd5a499a79cec84c402b269ef702cee11b788114bc69a7b36abe10c7eea0f
  - BTC-USD  f68da1df854c933b5584e4fbad4c795071e29a6f44994bc6127e17f601ae24b0
  - BTC-GBP  f263617910fbf468f9f0eceaf104a44ddbc557edfc039575af13d6a516396f88
* Robustness input only: Yahoo `GBPUSD=X` 1-hour closes, `data/ref/yahoo_GBPUSD_1h.json`
  (sha256 47b392140c70344bf6bef2d66ae7fa4bcc1f9ed40caef227c8a4a314775d830e).
* Revolut X keeps 1-hour candles for a year but 1–30-minute candles for only ~28 days (measured
  2026-09-23: every interval below 60 returns nothing before 2026-08-26). So the year-long test is
  hourly. A 1-minute replay of the last 28 days is a secondary, descriptive check (it lies inside
  the out-of-sample half).

## Windows

The books opened (first traded hour) on 2025-11-26 (USDC/GBP, USDC/USD) and 2025-12-16 (USDT/GBP,
USDT/USD). The data year is 2025-09-11 → 2026-09-23; its midpoint 2026-03-18 00:00 UTC splits it.
* In-sample (IS): each book's first traded hour → 2026-03-18 00:00 UTC.
* Out-of-sample (OOS): 2026-03-18 00:00 UTC → 2026-09-23 00:00 UTC.
A position opened inside a window is followed to its exit even past the window's end; it is
counted in the window in which it was opened.

## Rule (evaluated hour by hour; hour `h` = the candle starting at `h`)

Fair value, recomputed at the start of every hour from bars that ENDED before it:
* USD books: `fairU(S,h)` = median of the closes of S/USD over hours `[h−24h, h−1h]` that traded
  (volume > 0); at least 6 such hours, else no quotes on that book that hour.
* GBP books: `fairG(S,h) = fairU(S,h) / X(h)`, where `X(h)` = BTC/USD close ÷ BTC/GBP close of the
  latest hour `≤ h−1h` in which both traded, not older than `h−3h`; else no GBP quotes that hour.
  (Robustness arm: `X(h)` = Yahoo GBPUSD close of the latest hour `≤ h−1h`.)

Rungs: on each book, each side, one order per distance `k ∈ {0.25 %, 0.5 %, 1 %, 2 %}`;
bid at `fair·(1−k)`, ask at `fair·(1+k)`, each for $100 of notional (GBP books: $100 converted at
`X(h)`). Prices are rounded to the book's tick (0.0001) — bids down, asks up.

Order life: a rung with no open position is (re)priced at the start of each hour at the new fair,
if it moved by more than 0.05 % since the rung was priced (else it keeps its price). It is active
for the whole hour.

Fill (conservative, strictly through): a bid at `p` fills in hour `h` if the hour traded
(volume > 0) and `low_h < p`; an ask fills if `high_h > p`. The fill is at `p`. Full $100 fill in
the primary arm. A rung that fills is inactive until its position is closed; it is re-placed at
the start of the hour after the exit.

Exit: from the hour after the fill, a post-only order on the other side at the current fair
(`fair(h')`, recomputed each hour; rounded to tick in the order's favour: asks up, bids down),
filling only strictly through (`high > price` for an exit ask; `low < price` for an exit bid) in
a traded hour. If not filled within 24 hours after the fill hour, the position is closed at the
close of hour `fill_hour + 24h` as a taker: sell at `close·(1 − 0.0009 − s/2)`, buy at
`close·(1 + 0.0009 + s/2)`, where `s` is the pair's median touch spread measured live on
2026-09-23 (USDC/USD 1.00 bps, USDT/USD 2.00, USDC/GBP 1.33, USDT/GBP 1.33).

Costs: 0 on every maker fill (Revolut X's fee schedule); 9 bps + half-spread on a taker exit.

P&L per round trip, in the quote currency: long `(exit − entry)/entry · notional`, short
`(entry − exit)/entry · notional`; GBP amounts converted to USD at `X` of the exit hour.
Capital: 4 books × 2 sides × 4 rungs × $100 = $3,200. Returns are reported on that capital.

## Arms

1. **Primary**: the rule as written, all four books, all four rungs, BTC-implied `X`.
2. **Stress** (must stay > 0): taker exits pay 18 bps + the full spread, AND every maker fill (entry
   and exit) requires the market to trade through by one more tick (`low < p − 0.0001`,
   `high > p + 0.0001`).
3. **Capacity-limited**: each fill's size is `min($100, 10 % of the fill hour's quote volume)`
   (quote volume = base volume × close); exits follow the same size.
4. Robustness (descriptive, no bar): Yahoo `X`; per book; per rung; IS vs OOS; 1-minute replay of
   the last 28 days with the same rule evaluated minute by minute (fair recomputed each hour).

## Null (must be beaten)

Random-time twin: for every OOS round trip of the primary arm, draw a traded hour uniformly from
the same book's OOS hours, enter on the same side at that hour's close (free, as if filled there),
and apply the same exit rule from the next hour. The OOS total of one draw is the sum over trips.
2,000 draws, `random.Random(20260923)`. The primary OOS total must exceed the draws' 95th percentile.

## The bar (all four must hold, OOS)

1. Primary OOS P&L > 0 after costs.
2. Primary OOS P&L > the random-time null's 95th percentile.
3. Stress OOS P&L > 0.
4. Capacity-limited OOS P&L > 0; capacity reported as the average $ of fills per day it implies.

Also reported: trips, win rate, worst trip, max drawdown of cumulative P&L, P&L per book and rung,
orders placed per day (every placement and re-price counts one; the venue allows 1,000 a day).

## Determinism

`analysis/pr1_revx_stable_quotes.py` is run twice; the two JSON outputs must be byte-identical
(sha256 recorded). No parameter is changed after the freeze; any change is a new pre-registration.

## What this cannot show

A real depeg (a stablecoin that does not come back) did not happen on these books in the year, so
the tail risk of holding the bought stablecoin is not in the sample. Hourly bars cannot say how
much of a wick an order of our size would have taken; the capacity arm bounds it.
