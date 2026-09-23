# Pre-registration ZF: resting quotes on Binance's ZERO-FEE stablecoin books (fp3, test ZF)

Written 2026-09-23 (UTC) before any print, kline, fill or return of these books was read or computed
by this program. Frozen by the sha256 in `prereg_zero_fee_quotes.sha256` and the UTC time in
`prereg_zero_fee_quotes.frozen_at`. Nothing below may change after the freeze; any deviation is
reported as a deviation.

## Why this is Binance's own

Binance runs "zero trading fee" promotions (maker AND taker 0 %) on the books of stablecoins it is
launching, "until further notice", and the public announcements name the pairs and the start
times: EUR/EURI and EURI/USDT (2024-08-28 10:00 UTC), XUSD/USDT (2025-03-19 08:00), BFUSD/USDT
(2025-08-13 14:00), USDT/USD and USDC/USD (2025-11-18 15:00), U/USDT and U/USDC (2026-01-13 08:00),
RLUSD/USDT and RLUSD/U (2026-01-22 08:00). The UK is not in any of their restricted-country lists
(checked for U; the others say "subject to eligibility"). A zero fee removes the one cost that
killed every Binance quoting idea so far (the first program's PR2 paid 10 bps a fill). It is the
same structural gift that made PR5 possible on Revolut X (a free resting order), and EURI/USDT
around EUR's price is PR5's mechanism (a fiat-stablecoin book beside its fiat rate) on Binance.
The claim tested: resting quotes a few bps either side of a fair value on these books earn money
out of sample, from prints, net of the spread paid on forced exits.

## What was seen before the freeze (disclosed)

* `data/binance_exchangeInfo.json` (tick sizes: 0.0001 on EURIUSDT, EUREURI, UUSDT, UUSDC,
  RLUSDUSDT, RLUSDU, BFUSDUSDT, XUSDUSDT; 0.00001 on USDTUSD, USDCUSD; permission groups).
* `data/binance_executionRules_all.json` (price range ±2 % on the USD books, ±5 % EURIUSDT/BFUSDUSDT).
* The listing announcements' texts (pairs, start times, restricted countries).
* The archive's file list (aggTrades monthly zips exist from each listing month to 2026-08).
* PR2's published result (10 bps a fill, rungs 0.25–2 %, 2025-09 → 2026-09; XUSD, BFUSD and RLUSD
  among its pairs) and PR5's (Revolut X). No number of PR2's was re-derived here.
* Live bookTicker spreads sampled just before the freeze (`data/zf_spreads.json`), used only for
  the forced-exit half-spread below.
No price, print, kline, fill or P&L of any of these books over any historical window has been read.

## Data (keyless, public)

* Every print: Binance spot aggTrades from `data.binance.vision/data/spot/{monthly,daily}/aggTrades/`
  (monthly zips to 2026-08, daily zips 2026-09-01 → 2026-09-21), columns id, price, qty, first id,
  last id, time, buyer-is-maker. Timestamps normalised to ms.
* EURUSDT 1-minute klines (trade-built) from the same archive, for EURIUSDT's reference.
* sha256 of every zip in `MANIFEST.json`.

## Books

* Primary (8): EURIUSDT, EUREURI (family E: euro), UUSDT, UUSDC, RLUSDUSDT, RLUSDU, BFUSDUSDT,
  XUSDUSDT (family U: US dollar).
* Secondary, descriptive only (a UK account's access to the USD fiat group is unknown): USDTUSD,
  USDCUSD.
* Each book from the later of 2024-09-01 and the first full day after its promotion started, to
  2026-09-21 23:59:59 UTC.

## Windows (a round trip belongs to the window in which it OPENED)

* IS: before 2026-01-01 (only EURIUSDT, EUREURI, XUSDUSDT, BFUSDUSDT have any).
* OOS1: 2026-01-01 → 2026-05-31. OOS2: 2026-06-01 → 2026-09-21.
Nothing is chosen in sample: every number below is fixed now.

## Fair value (computed only from data strictly before the minute it is used in)

Per minute m, `last(m)` = the price of the book's last print in minute m (none if no print).
* EURIUSDT: `fair(m) = EURUSDT_close(m−2) × B`, where `B` = median over the 1,440 minutes before
  the current hour of `last_EURIUSDT(x) / EURUSDT_close(x)` over minutes x with an EURIUSDT print,
  recomputed at each hour start; at least 60 such minutes, else no quotes that hour.
* Every other book: `fair` = median of `last(x)` over the 1,440 minutes before the current hour,
  minutes with a print only, recomputed at each hour start; at least 60 such minutes, else no
  quotes that hour.

## Rule

* Rungs: each book, each side, one order per `d ∈ {2, 5, 10}` bps, $100 notional each:
  bid at `fair·(1 − d)` rounded DOWN to the tick, ask at `fair·(1 + d)` rounded UP. Asks sell the
  stablecoin held as inventory. Locked capital: 8 books × 2 sides × 3 rungs × $100 = $4,800
  (family E $1,200, family U $3,600).
* Timing ("one minute behind the clock"): the order that rests in minute m is the one priced from
  data up to the end of minute m−2 (the loop computes it during minute m−1). Re-priced every
  minute; on Binance this is one cancel-replace, far inside 200,000 orders a day.
* Entry fill (never a touch): the first print in minute m strictly beyond the order's price (bid:
  print < bid; ask: print > ask) fills the rung at the ORDER's price, for
  `min($100, notional of the prints in minute m strictly beyond the price)` (primary).
* A filled rung stays out until its position closes, then re-enters from the next minute.
* Exit: from minute m+1 (m = the fill minute), a limit order at the current fair (the fair priced
  one minute behind, as above; a long exit's ask rounded UP, a short exit's bid rounded DOWN),
  filled only by a print strictly beyond, at its price, for the whole position.
* Time stop: a position still open 24 hours after its fill is closed at the first print after
  that instant, as a taker, paying half the book's median live spread (`data/zf_spreads.json`, at
  least half a tick) beyond that print.
* A book with no print for the 24 h time stop keeps the position until its first print.
* Fees: 0 on every fill (the promotions). P&L in the quote asset, EUR converted to USD at the
  EURUSDT close of the exit minute; USDT, USDC, U and RLUSD counted at 1.0.

## Arms

1. Primary: as written, the 8 primary books.
2. Stress (must stay > 0): an entry or exit fills only on a print at least ONE TICK beyond its
   price, and the time stop pays one full tick more.
3. Capacity: every fill `min($100, 10 % of the minute's printed notional)`.
4. Descriptive, no bar: 0.10 % a fill (the promotion ends, or this account is excluded); each
   family alone; each book, rung, side and window; the secondary books.

## Null

Random-time twin (as PR2/PR5): each OOS round trip of the primary arm is replaced by an entry on
the same book and side at the last print of a uniformly drawn minute with a print in the same OOS
window, for the same notional, with the same exit rule; 2,000 draws, `random.Random(20260923)`.
The primary's OOS total must exceed the 95th percentile (sorted draws, index floor(0.95·n)).

## The bar (primary, OOS = OOS1 ∪ OOS2, all of)

1. OOS P&L > 0, and OOS1 > 0 and OOS2 > 0.
2. OOS P&L > the null's 95th percentile.
3. Stress OOS P&L > 0.
4. At least 200 OOS round trips.
5. Not carried by one month: no calendar month (of the opening) holds more than 40 % of the OOS
   P&L, and the OOS P&L without its best month is > 0.
6. The OOS return on the locked $4,800, annualised (× 365 / OOS days), exceeds 4 % (cash).
Each family is also judged by the same six conditions (family E locked $1,200, family U $3,600) as
secondary verdicts; the programme's verdict is the primary's.

## Determinism

`analysis/zf_test.py` run twice from the frozen inputs; the JSON must be byte-identical (sha256
recorded in `results/zf_run{1,2}.json.sha256`).

## What this cannot show

Whether this account pays zero on these books (a signed `GET /api/v3/account/commission?symbol=`
per pair) and may trade them (`GET /api/v3/account` → permissions against each symbol's
permissionSets). Queue position is not modelled beyond "strictly through" (a print beyond our
price means our level was consumed). A stablecoin that fails (the tail PR2 flagged) is not in the
window unless it happened in it.
