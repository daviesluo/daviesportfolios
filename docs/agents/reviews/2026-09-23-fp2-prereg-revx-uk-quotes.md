# Pre-registration — resting 0 % quotes on Revolut X UK coin books, anchored to Binance, fills from prints

Written 2026-09-23 before any return of either rule below was computed (in sample or out of sample).
Two tests share one simulator: **T1** quotes INSIDE a wide resident market maker's spread on thin
long-tail books; **T2** quotes FAR outside it on busier books, waiting for UK-only sweeps (the first
program's ideas 3–4, killed on quote-built candles, re-opened on prints).

## What was already seen (disclosed)

* Live, 2026-09-23 10:41–12:42 UTC (the first program's 122 one-minute snapshots): UK half-spreads per
  book (`results/m1_live_spreads_crosses.json`); Binance 1-minute sigma over the last 1,000 minutes
  (`results/m2_budget_ranking.json`). T1's six books were chosen from these by a rule (below) that also
  used UK daily volume in the in-sample months only. **The choice uses today's spreads, i.e. information
  from after the out-of-sample window; a book whose spread was not wide in May–September is still in the
  test (it is a limitation of the selection, not a filter on results).**
* In-sample days only (day < 2026-05-01), T2's six books: prints per day, size quantiles, effective
  half-spreads, the resident maker's markouts by distance from fair, UK-only sweep counts
  (`results/m3_is_descriptives.json`, `results/m4_is_markout_by_depth*.json`). No out-of-sample print
  of any book was read before this file was frozen, except PENDLE-USD's and the long-tail books' pull
  logs (counts of prints per day, nothing about prices).
* No strategy P&L of any kind has been computed.

## Data

* Revolut X public trade prints, `GET /api/1.0/public/trades/all?symbol=…&region=UK` (keyless), whole
  UTC days, pulled by `scripts/pull_revx_prints.py`: every 3rd day from 2025-10-01 to 2026-09-22 for
  T2's books, every 6th day of the same schedule for T1's books, each list in a seeded random order
  (`random.Random(20260923)`) fixed before any data was read. **Cut-off: the pullers are stopped at
  16:00 UTC on 2026-09-23 and the tests use every complete book-day file present then.** Because the
  order was random, the cut-off leaves a random subset of days. The sha256 of every input file goes into
  the output.
* Binance spot 1-minute klines, BASEUSDT and USDCUSDT (data.binance.vision archive + public mirror).
* Fair value at the loop's turn in minute m: `F(m) = close(BASEUSDT, m−1) / close(USDCUSDT, m−1)`
  (USD per coin with USDC = $1; measured on the live session to match Revolut X's own BTC/USD ÷
  BTCUSDT within 0.5 bps median). No local-basis correction. A minute without both klines: no action.

## Windows

IS: sampled days before 2026-05-01. OOS: sampled days from 2026-05-01 to 2026-09-22. **No parameter is
chosen on IS**: both rules are fixed below; IS is reported for comparison, and the bar is judged on OOS.
Each sampled day is simulated alone: flat at 00:00 UTC, flattened at the day's last turn.

## Books

* **T1**: the six UK USD books with half-spread ≥ 3 × Binance 1-minute sigma in today's live snapshot,
  ranked by mean UK daily USD volume over 2025-10-01 → 2026-04-30 (daily candles): **C98-USD, W-USD,
  CELO-USD, AUCTION-USD, KAVA-USD, ANKR-USD**. PENDLE-USD (ratio 3.0, no in-sample volume) is reported
  descriptively only.
* **T2**: **SUI-USD, NEAR-USD, FET-USD, ICP-USD, BCH-USD, AVAX-USD** (half-spreads 5–17 bps).
* `h_book` := the median over the book's IS prints of the taker-side distance from fair
  (`p/F − 1` for buy prints, `1 − p/F` for sell prints), in bps, computed by the test script from IS
  prints only. A T1 book with fewer than 50 IS prints is dropped from the primary and reported apart.

## Rule (one book, one lot at a time, the loop acts once a minute)

* Order size q = $200 (base quantity q/F at placement). One position at a time.
* **Flat**: rest a bid at `F·(1 − d)`. **Long**: cancel what is left of the bid at the next turn and
  rest an ask for the whole position at `F·(1 + d)`.
* Re-pricing: at each turn, an order whose distance from the current F is outside `d ± w` is cancelled
  and replaced at the target.
* **T1**: `d = 0.5·h_book`, `w = 0.3·h_book`, time stop 120 min, stop-loss `F ≤ entry·(1 − 3d)`.
* **T2**: `d = 50 bps`, `w = 20 bps`, time stop 60 min, stop-loss `F ≤ entry·(1 − 150 bps)`.
* **Order budget**: a token bucket per book, 800 placements a day (refill 800/1,440 a minute,
  capacity 40). A placement with no token is not made; an out-of-band bid is then cancelled and not
  replaced; an ask stays. Each book is simulated as a one-book deployment using the whole budget.
* **Timing**: orders placed or cancelled at the turn of minute m take effect at m + 30 s.
* **Post-only proxy**: a bid is not placed (the token is spent) if a UK buy print in the previous
  2 minutes was at or below it; an ask likewise if a UK sell print was at or above it.
* **Fills (maker, 0 %)**: a live bid fills only against a UK **sell** print (a taker selling) whose
  price is **strictly below** the bid, after the bid is live; quantity min(remaining, print quantity);
  at the bid's price. A live ask fills only against a UK **buy** print strictly above it.
* **Taker exits** (time stop, stop-loss, end of day): the whole position is sold at the price of the
  first UK sell print at or after the turn's effective time within 10 minutes (the UK bid a taker got),
  else at `F·(1 − h_book)`; minus 9 bps.

## Arms

1. Primary, as written.
2. Stress (must stay > 0): orders take effect 60 s after the turn; a fill needs a print beyond the price
   by at least 2 bps; taker exits pay 18 bps.
3. Descriptive: per book; T2 at d = 30 and 100 bps (w = 0.4·d); PENDLE-USD under T1's rule
   (h from its first 25 % of sampled days, which are then not counted).

## Null

Exposure-shift null: the primary's position path (base quantity held, minute by minute) on each OOS
book-day is shifted circularly by a uniform random number of minutes within that day, and the P&L of
holding the shifted path is computed from F's minute-to-minute changes. Summed over book-days; 2,000
draws, `random.Random(20260923)`. It earns the drift of holding that much exposure at random times and
nothing for the spread.

## The bar (OOS; judged separately for T1 and T2, summed over the test's books; all must hold)

1. Primary P&L > 0.
2. Primary P&L > the null's 95th percentile.
3. Stress P&L > 0.
4. At least 100 round trips (T1) / 30 (T2).
5. Primary P&L without its best calendar month > 0.
6. Placements ≤ 800 a book-day (the budget), i.e. ≤ 1,000 a day with the live row's orders.
Capacity is reported as fill notional per day and P&L per day for one book.

## Determinism

`analysis/t12_revx_uk_quotes.py` run twice; byte-identical JSON.

## What this cannot show

The UK book's depth and queue: a fill strictly through the price assumes the order was at the front of
its price level, which a price better than every resting order is; a print AT the price never fills.
History has no record of the orders that would have traded with a stale quote of ours (arbitrageurs),
so a stale quote is filled here only by the next print through it; the price is the same. Taker exits
assume the UK bid had depth for $200. Sampled days are simulated alone, so positions never carry over
midnight. T1's books were chosen with today's spreads.
