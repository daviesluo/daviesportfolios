# Pre-registration DL: buying a token after Binance announces its delisting (fp3, test DL)

Written 2026-09-23 (UTC) before any price of any delisted token around its announcement was read or
computed. Frozen by the sha256 in `prereg_delisting_window.sha256` and the UTC time in
`prereg_delisting_window.frozen_at`.

## Why this is Binance's own

Binance decides, on its own schedule, that a token leaves its spot market, announces it about one to
two weeks ahead (`bapi/composite/v1/public/cms/article/list/query?catalogId=161`, public, with the
release time to the millisecond), and its holders — the largest crowd in crypto — must sell or move
the token before the date. Many sell at once and on Binance, whatever the price: forced,
price-insensitive sellers again. The token keeps trading elsewhere, so the question is whether the
announcement overshoots, i.e. whether a long bought an hour after the announcement and sold a day
before trading stops is paid for taking the other side. Spot-only fits it: it is a buy.

## What was seen before the freeze (disclosed)

* The titles and release times of the 436 announcements in the delisting catalogue (2022-02-17 →
  2026-09-23) and the 42 "Binance Will Delist …" titles among them (`data/delist_events.json`).
* Today's spreads of the 50 lowest-volume USDT pairs (`data/lowvol_spreads.json`: median half-spread
  8.0 bps, 75th percentile 12.3 bps).
No price, kline or return of any delisted token has been read.

## Events

Every token named in a "Binance Will Delist <tokens> on <date>" title whose `<TOKEN>USDT` spot pair
has hourly klines in the public archive covering the announcement hour. Titles without a date, or
whose "tokens" are products (margin pairs, earn products, options), are not events. One event per
token per announcement.

## Data (keyless, public)

Hourly klines of `<TOKEN>USDT` from `data.binance.vision/data/spot/monthly/klines/<SYM>/1h/` for the
seven months up to and including the delisting month (daily zips for September 2026). sha256 of every
zip in `MANIFEST.json`.

## Rule

* Entry: buy $100 at the OPEN of the first hourly bar whose start is at least 60 minutes after the
  announcement's release time, as a taker: price × (1 + 0.0010 + h), h = 25 bps (about twice the
  75th-percentile half-spread of today's thinnest USDT books; delisting books are thinner).
* Exit: sell at the OPEN of the hourly bar that starts 24 hours before the pair's last hourly bar
  ends (the announced cease time, which the loop knows at entry), as a taker: price × (1 − 0.0010 − h).
  If that bar is at or before the entry bar, the event is skipped (reported).
* No stop, no target. P&L per event in USDT on $100.
* Windows by announcement time: IS 2022; OOS1 2023-01-01 → 2024-12-31; OOS2 2025-01-01 → 2026-09-21
  (events whose exit is after the data ends are dropped and reported).

## Arms

1. Primary: as written.
2. Doubled costs: 20 bps a side and h = 50 bps (must stay > 0).
3. Descriptive: entry 5 hours after release instead of 1; each event; per year.

## Null

Own-history twin: each OOS event is replaced by the same token held for the same number of hours,
entered at the open of a uniformly drawn hour in the 180 days before the announcement (the whole
holding window must end before the announcement), same costs; 2,000 draws,
`random.Random(20260923)`; the primary's OOS total must exceed the 95th percentile.

## The bar (primary, OOS = OOS1 ∪ OOS2, all of)

1. OOS P&L > 0, and OOS1 > 0 and OOS2 > 0.
2. OOS P&L > the null's 95th percentile.
3. Doubled-cost OOS P&L > 0.
4. At least 30 OOS events.
5. Not carried by one month: no calendar month holds more than 40 % of OOS P&L, and OOS without its
   best month > 0.
6. OOS P&L on the capital it locks — $100 × the largest number of positions open at once in OOS —
   annualised over the OOS days, exceeds 4 % a year.

## Determinism

`analysis/dl_test.py` run twice, byte-identical JSON (sha256 recorded).

## What this cannot show

Real spreads in each event's window (h is assumed, stressed ×2); the price elsewhere (a holder could
also withdraw); whether a UK account may buy a token Binance is delisting.
