# Pre-registration FAV: buying the favourite a fixed time before a Polymarket market ends (fp4, test FAV)

Written 2026-09-24 (UTC) before any price at a decision time, any entry print or any return of this
rule was read or computed. Frozen by the commit that adds this file; its sha256 is recorded in the
study (`2026-09-24-polymarket-fp4-study.md`). Nothing below may change after the freeze; any
deviation is reported as a deviation.

## Why this is Polymarket's own

Betting markets have long overpriced longshots and underpriced favourites. On Polymarket the
favourite side is cheap to trade at the extremes: the taker fee is `rate × p × (1 − p)` a share
(Fee Structure V2, 2026-03-30: 0.04–0.07 by category, 0 for geopolitics; makers pay nothing), so a
token bought at 0.95 pays about 0.24 ¢ a share in fees against 5 ¢ of upside. What can go wrong is
Polymarket's too: resolution by the UMA optimistic oracle (a 2-hour challenge window, disputes, the
DVM vote, "50-50" and void outcomes), and capital locked until the market settles. The claim tested:
a once-a-minute loop that buys whichever token is priced 0.90–0.99 a fixed time before the market's
scheduled end, and holds it to resolution, earns more than every cost, beyond what calibrated prices
would give, on markets the rule never saw.

## What was seen before the freeze (disclosed)

* Polymarket's documentation (fees, programmes, resolution, geoblock, order types) and the live
  snapshot M1 (2026-09-24 02:17–02:29 UTC: counts, fee schedules, spreads, reward pools, books).
* The closed-market pulls (`pull_closed.py`: every closed market with an end date from 2025-01 on,
  with its FINAL payout). They were read for counts only; no payout was set against any price.
* One price series (the 2025 NBA Finals "Boston Celtics" market, 2025-05-11 → 05-17) to check that
  the CLOB's batch price history serves hourly points for 2025 markets.
* M4 (maker wallets' all-time P&L split) and M3's code (not its result).
* Prior knowledge, not measured here: the favourite–longshot bias in betting and prediction markets.
No calibration table, no price at any decision time and no entry print has been computed.

## Data (keyless, public)

* Gamma `/markets/keyset?closed=true&end_date_min&end_date_max` month by month (`pull_closed.py`):
  outcomes, token ids, final `outcomePrices` (the payout), `endDate`, `closedTime`, `startDate`,
  volume, fee schedule, tick, event id.
* The CLOB's `POST /batch-prices-history` (20 tokens a request, `fidelity` 60, window
  `[T_d − 6 h, T_d]`): the price the site shows (midpoint, or last trade when the spread is over
  10 ¢), hourly (`fav_prices.py`).
* The Data API's `/v2/trades?condition=` (taker rows, newest first) for every market that passes the
  pre-filter below (`fav_trades.py`); every print carries time, side, outcome index, price and size.

## Universe

Two-outcome markets with an order book, lifetime volume ≥ $5,000, not a crypto up/down market (slug or
series containing `updown` / `up-or-down`), `endDate` in [2025-01-01, 2026-09-10), and OPEN at the
decision time: `startDate` (else `createdAt`) earlier than `T_d − 6 h` and `closedTime` later than
`T_d`. Every payout counts, including 50-50 and void payouts: a market is never dropped for how it
resolved. `endDate` is read as Gamma serves it now (a date moved after the fact would move `T_d`;
disclosed, not corrected). Lifetime volume includes volume after `T_d` (disclosed).

## Windows (by `endDate`)

IS: 2025-01-01 → 2025-12-31. OOS1: 2026-01-01 → 2026-05-31. OOS2: 2026-06-01 → 2026-09-10. Nothing is
chosen in sample: every parameter is fixed below. The OOS end sits two weeks before today so that
slow resolutions are settled; markets with an end date in the windows that are still unresolved
today are counted and reported (they cannot be traded by the test).

## Rule

* Decision time `T_d = endDate − h`. **Primary h = 24 h.** Secondary (reported and judged by the same
  bar, not the verdict): h = 168 h and h = 1 h.
* Price read: `p0` = the last hourly point of token 0's series at or before `T_d`. None → no trade.
* Favourite: token 0 when `0.90 ≤ p0 < 0.99`; token 1 when `0.01 < p0 ≤ 0.10` (its shown price
  `1 − p0`). Otherwise no trade. Call the favourite's shown price `pf`.
* Entry: a marketable buy of the favourite with a limit of 0.99, $10 of cost. Its fills are taken from
  the buy-equivalent taker prints of the favourite in `(T_d, T_d + 60 min]`, in time order: a BUY of the
  favourite token at `p`, or a SELL of the other token at `q` (the favourite at `1 − q`; the book is one
  book, its NO side the mirror of its YES side). Each print is used for at most its own size, and only
  prints at or below 0.99. Each fill's price is `max(print price, pf + one tick)` — never below one tick
  over what the site showed at `T_d`. Less than $2 of fill in the hour → no trade (counted).
* Fees: every fill pays the taker fee `r × price × (1 − price)` a share, `r` = the market's own fee
  schedule rate when it has one, else 0.05 (0.07 when the market reads as crypto by the keyword rule in
  `fav_universe.py`) — today's schedule, charged on history before it existed too.
* Hold to resolution. Payout per share = the token's final `outcomePrices` value (1, 0, or a fraction).
  P&L = shares × (payout − fill price) − fees.
* One trade per event and horizon: when several markets of one Gamma event qualify, the one whose
  first qualifying print is earliest trades (ties: the lowest condition id).
* Capital: each trade locks its cost from its first fill to `closedTime`.

## Arms

1. Primary: h = 24 h, as written.
2. Stress (must stay > 0): each fill one tick worse, fees doubled.
3. Secondary horizons: h = 168 h and h = 1 h (the same bar, reported beside the primary).
4. Descriptive, no bar: by category, by favourite price band (0.90–0.95, 0.95–0.99), capacity at $100 a
   trade, the calibration of all tokens at `T_d` (every price, not only the favourites), and the
   largest single losses with their resolution records.

## Null (chance comparison)

Calibration null: each OOS trade's payout is redrawn as Bernoulli(its average fill price) — what a
calibrated market would pay — with the same shares and fees; 10,000 draws, `random.Random(20260924)`.
The primary's OOS P&L must exceed the null's 95th percentile (sorted draws, index floor(0.95·n)).
Trades are one per event, so the draws are independent across events by construction.

## The bar (primary, OOS = OOS1 ∪ OOS2, all of)

1. OOS P&L > 0, and OOS1 > 0 and OOS2 > 0.
2. OOS P&L > the calibration null's 95th percentile.
3. Stress OOS P&L > 0.
4. At least 200 OOS trades.
5. Not carried by one month: no calendar month (of entry) holds more than 40 % of the OOS P&L, and OOS
   without its best month is > 0.
6. Worth money: the OOS P&L over the OOS days, annualised, on the peak capital the trades held at once,
   exceeds 4 % a year (cash).

## Determinism

`fav_test.py` run twice from the committed inputs; byte-identical JSON, sha256 recorded.

## What this cannot show

The ask at the decision instant (a later print, floored at one tick over the shown price, stands in
for it); queue competition for the same prints; whether the UK account may trade at all (Polymarket
lists the United Kingdom as close-only: reported in the study, outside this test); resolutions that
are still pending today.
