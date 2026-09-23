# Pre-registration: the same quotes on Revolut X's USDC/USD and USDT/USD books (PR4)

Written 2026-09-23 after PR3 ran, before any return of THIS rule was computed. Frozen by the
sha256 in `prereg_revx_usd_stable_touch.sha256` and the UTC time in
`prereg_revx_usd_stable_touch.frozen_at`.

## Why

PR3 passed on the two GBP stablecoin books. If the mechanism is "a thin stablecoin book on a
0 %-maker venue pays resting quotes near fair", it should also show on the two USD stablecoin
books, where no exchange rate is involved at all. If it shows only on the GBP books, PR3's result
is about the GBP books' FX lag, not about stablecoin books in general. Same windows, same rule,
nothing tuned.

## What was already seen (disclosed)

PR3's full result. For these two books over the same 28 days: the traded volume by distance from
the book's own 24-hour median (USDC/USD: 23 % of $1.03M beyond ±10 bps; USDT/USD: 32 % of $1.47M),
PR1's hourly and 1-minute results on them (USDC/USD 2 minute-replay trips, USDT/USD none), the count
of traded minutes beyond 0.25–2 % (`results/diag_quote_wicks.json`), and the live touch (USDC/USD
0.9999/1.0000, USDT/USD 0.9995/0.9997). No P&L of this rule on these books.

## Data

`data/revx_hist/USDC-USD_1m.json` (1432f5fa3a5d37fb24ae4ab05edbe8714fbb239e7927e2509e95b1e0d5422043),
`data/revx_hist/USDT-USD_1m.json` (df132dcc0204a0214fb0b42baf6e5225fc0593a561ef508ba2857985a304dfcd).

## Rule — PR3's, with these differences only

* Books: USDC/USD, USDT/USD (UK). Quotes every minute of the week (no exchange rate needed).
* Fair `fair(S,t)` = median of the book's own closes over minutes `[t−1440, t−1]` (at least 60).
* Taker stop: `close·(1 ∓ (0.0009 + s/2))`, s = 1.00 bps (USDC/USD), 2.00 bps (USDT/USD).
* P&L in USD. Capital: 2 books × 2 sides × 3 rungs × $100 = $1,200.
Everything else — rungs 0.1/0.2/0.3 %, tick rounding, re-pricing on 0.05 % moves, orders live the
minute after placement, close-based strictly-through fills in traded minutes, size min($100, 10 %
of the minute's quote volume), exits resting at fair from the second minute after the fill, 24-hour
stop, windows (IS 2026-08-26 → 09-09 18:00, OOS → 09-23 00:00 UTC), the random-time null (2,000
draws, seed 20260923), the stress arm, and the bar (OOS > 0; > null p95; stress > 0; ≥ 20 OOS round
trips and ≤ 1,000 orders a day) — is PR3's, word for word.

## Determinism

`analysis/pr4_revx_usd_stable_touch.py` run twice; byte-identical JSON.
