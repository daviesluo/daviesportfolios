# Paper-test specification: PR3/PR5's stablecoin/GBP quotes in the loop, four weeks, paper only

Written 2026-09-23 after PR5 passed its pre-registered bar. No repository code is written here. Everything below is
public data: no key, no signed call, no order. The rule is exactly `scripts/pr5_sim.py` (frozen with PR5's
pre-registration); this document says how the loop runs it forward and what decides the result.

## What it must reproduce, and why four weeks

PR5's primary window made +$707.90 on $1,200 in nine months, but in a market whose buy-minus-sell gap was 11–52 bps.
Since the week of 2026-08-24 that gap has been 3–5 bps, and the same rule made $0.42 a day (12.7 %/yr on the locked
capital). **The paper test measures the current regime and the one thing no backtest can: whether a post-only quote
at these prices would have been accepted and filled.**

## Each minute (pg_cron, once a minute; the tick at the start of minute t acts on data up to t−1)

Public calls. Revolut X allows one public request a second, shared with everything else the loop does; route every
call through `revxPublic`'s limiter and make the calls in this order.

1. **Prints since the last turn**, one call per book:
   `GET /api/1.0/public/trades/all?symbol=USDC-GBP&start_date=<last_seen_ts>&end_date=<now>&limit=100` and the same
   for USDT-GBP.
   * Follow `metadata.next_cursor` until it is empty.
   * The bounds are inclusive, so de-duplicate by `id`.
   * A book prints 50–300 times a day, so one page a minute is normal: 2 requests a minute.
   * Store every print (`id`, `timestamp`, `price`, `quantity`, `side`, `region`) as it comes. The venue's candles
     are not the record: they lag about a second at minute boundaries and drop a few prints.
2. **Fair value inputs**, once an hour at the first turn after hh:00:
   `GET /api/1.0/public/candles/{USDC-USD|USDT-USD}?interval=60&since=<now−25h>&until=<now>&region=UK` (2 requests an
   hour, cached). `fairU` is the median of the closes of the hourly candles lying wholly inside [t−24 h, t).
3. **Interbank GBP/USD**, one call a minute, not on Revolut X's budget: Yahoo
   `query1.finance.yahoo.com/v8/finance/chart/GBPUSD=X?interval=1m&range=1d`.
   * The `prices` Edge Function already reaches this host, and it is PR3's original source.
   * `X(t)` is the latest 1-minute close whose bar started in [t−10 min, t−1 min]. None means dark: withdraw the
     entry quotes and set no new exit prices. This makes weekends and the daily rollover dark.
   * Record every value. After each calendar month, compare against Exness's archive for that month (PR5's tested
     source, published on the 1st). Flag it if the median |dev| exceeds 1 bp.
   * Kraken's GBPUSD is not a substitute: it sits 1–2 bps under interbank and trades at weekends.
4. **Order-book evidence**, only in a minute when one of our orders goes live, per book with a live-going order:
   `GET /api/2.0/public/order-book/{SYM}?region=UK&limit=5`, at most 2 a minute.
   * Record the best bid and ask and the size at and ahead of our price.
   * This is the one measurement the backtest could not make: would the post-only order have been accepted
     (bid < best ask, ask > best bid), and would it have been the best price?

Budget: about 2–4 Revolut X requests a minute, plus 2 an hour. That is well inside 60 a minute, but it shares the
bucket with the loop's tickers and candles.

## State per rung

There are 12 rungs: 2 books × 2 sides × k ∈ {0.1, 0.2, 0.3 %}. Each is one row, with an event log beside it.

* `mode`: idle, quote or position.
* The working order: `price` (in 0.0001 ticks), `fair_at`, `placed_at`, `live_at` (the minute after placement), and
  `state`: pending, live or refused.
  * The refusal evidence: the last print before `live_at` (`id`, price, side) and the order-book snapshot.
* The position: `entry_price`, `qty`, `notional_usd`, `t_entry`, the filling print's `id`, and the minute's printed
  quote volume that set the size.
* The exit order: the same fields as the working order, at fair.
* `orders_today`: every placement, re-price and re-placement counts one.

## The turn: exactly PR5's rule

1. **Turn, at the start of minute t.** For each rung:
   * idle, with a fair value: place bid `floor(fair·(1−k))` or ask `ceil(fair·(1+k))`, $100 converted at X, live
     from t+1.
   * Quote, and fair has moved more than 0.05 % since it was priced: re-price, live from t+1.
   * Refused: re-target to the current fair without placing an order; re-place (one order) at the first turn whose
     last print is no longer through the price.
   * Position with no exit order yet: place the exit at fair, rounded up for a long and down for a short.
   * No fair value: withdraw entry quotes; leave exit orders as they are.
2. **Go-live, at the start of minute t, for orders whose `live_at` is t.** The order is refused if the last print
   before t is through it: for a bid, below the price, or at the price and a BUY; for an ask, the mirror of that.
   Record the order-book snapshot either way.
3. **Prints in minute t, in time order.** A live bid at p fills on a print strictly below p; an ask on a print
   strictly above p.
   * Fill at p.
   * Size min($100, 10 % of the quote volume printed on that book in minute t) × X.
   * An exit fills the whole position.
4. **Stop.** A position 24 h past its fill minute is closed at the last print × (1 ∓ 0.000967).
5. **P&L** is qty × (exit − entry) in GBP × X of the exit minute. Report it in USD.

## How a fill is proven, and what is recorded with it

A fill is proven by the print's `id`, with `timestamp ≥ live_at` and a price strictly through the order. The fill
record carries:
* that print;
* the refusal check's last print;
* the order-book snapshot at go-live;
* the minute's printed volume;
* `X` and `fairU` as used;
* the order's full history (placements and re-prices).

A fill whose go-live snapshot shows the order would have crossed the book (`bid ≥ best ask`, or `ask ≤ best bid`) is
recorded, and marked `would_be_refused`.

## What decides, after four weeks

Every condition must hold for a small live test to be put to Davies. Money moves only on his explicit go, and the
first live order needs his confirmation in the same conversation.

1. **Faithful.** The frozen `pr5_sim.py`, run offline on the four weeks of stored prints, candles and FX, reproduces
   the loop's paper round trips: the same fills to within 5 %, and the same P&L to within 10 %.
2. **P&L after costs** is positive, and above the random-time null's p95 on the same four weeks (PR5's null:
   2,000 draws, seed 20260923).
3. **Worth more than cash.** At least 8 %/yr on the $1,200 the quotes lock, i.e. at least $0.26 a day: twice cash,
   for the operational risk. The post-change backtest's rate is $0.42 a day.
4. **Fills that the book would have allowed.** At least 90 % of the paper fills have a go-live snapshot in which the
   post-only order would have been accepted. Report the share where our price would have been the best price.
5. **Order budget.** At most 700 orders on every day, leaving the rest of the account's 1,000 for the other rows. PR5
   hit 1,856 on one volatile day. A breach is a finding to fix (for example a wider re-price step), not a pass.
6. **The regime, recorded weekly.** The median gap between adjacent BUY and SELL prints within 60 s. The test says
   what the rule earns at the gap it sees, not what it earned at 20–40 bps.

## What a live test would need (not now)

GBP for six bids (about £450), plus $300 of USDC and $300 of USDT for the asks, held on Revolut X: $1,200 in all. The
loop places post-only GTC limits and nothing else, never trades the account by hand, and runs within the order
budget above.
