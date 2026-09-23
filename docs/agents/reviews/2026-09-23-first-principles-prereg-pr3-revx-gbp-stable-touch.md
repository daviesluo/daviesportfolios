# Pre-registration: quoting Revolut X's stablecoin/GBP books around interbank, fills verified by trades (PR3)

Written 2026-09-23, before any return of this rule was computed. Frozen by the sha256 in
`prereg_revx_gbp_stable_touch.sha256` and the UTC time in `prereg_revx_gbp_stable_touch.frozen_at`.

## Why a third test

PR1 read Revolut X's UK candles' high/low as trades. They are not: between trades the candles
are built from quotes (checked against the public trade tape: in minutes with prints the candle's
volume equals the prints' volume and its close is the last print; minutes without prints move
anyway). What survives of the idea is the one Revolut X-only structure the measurements found:
its USDC/GBP and USDT/GBP books trade away from interbank GBP/USD while every coin/GBP book sits on
it. This test asks whether resting quotes a fixed distance from interbank on those two books earn
money when a fill requires a PRINT beyond the quote, using only what a trade proves.

## What was already seen (disclosed)

Over the same 28 days (both halves below): the minute-by-minute distribution of each book's close
against the BTC-implied rate (`results/a_crosscurrency_1m.json`); the traded volume by distance from
fair, against the BTC-implied rate and against Yahoo's interbank rate
(`results/a_stable_flow_by_dev*.json`: USDC/GBP 50 % of weekday volume 10–25 bps below interbank,
USDT/GBP 22 % below −10 and 10 % above +10); PR1's descriptive 1-minute replay (fills on candle
extremes in traded minutes: 59 trips, +$7.73 over 28 days); the count of traded minutes beyond
0.5 % of fair (`results/diag_quote_wicks.json`). The live session's touch queues (≈ £4–10k at the
touch) and first 20 minutes of the trade tape. No P&L of THIS rule (its distances, its close-based
fill, its exits) has been computed.

## Data

Revolut X UK 1-minute candles (the venue keeps 28 days of them), `region=UK`:
* USDC-GBP 520c2427f20e2736d5a033835dcea5f7a58103e6f0804d7b69271da23ed5004e
* USDT-GBP 278a92497fbd3f8e4d3592939c94f3728950faab76154f01a125e213cc9bb8a4
* USDC-USD 1432f5fa3a5d37fb24ae4ab05edbe8714fbb239e7927e2509e95b1e0d5422043
* USDT-USD df132dcc0204a0214fb0b42baf6e5225fc0593a561ef508ba2857985a304dfcd
* robustness only: BTC-USD ceb13453…, BTC-GBP e0a62575…
Yahoo `GBPUSD=X` 1-minute closes, `data/ref/yahoo_GBPUSD_1m.json`
(9438ab91f5476a314023584173a75f862c7790e7ebe02df4275393acd8bc51ee), 2026-08-30 23:00 → 2026-09-23.

## Windows

IS: 2026-08-26 00:00 → 2026-09-09 18:00 UTC. OOS: 2026-09-09 18:00 → 2026-09-23 00:00 UTC (the
midpoint of the 28 days). A position counts in the window where it opened; it is followed to its exit.

## Rule (minute by minute; the loop acts at the start of minute t, its orders are live from t+1)

* Interbank `X(t)`: the latest Yahoo 1-minute close whose bar started in `[t−10 min, t−1 min]`;
  none → no quotes and no new exit prices that minute (weekend FX closures quote nothing).
* `fairU(S,t)`: median of the S/USD closes of minutes `[t−1440, t−1]`.
* `fair(S,t) = fairU(S,t) / X(t)` (GBP per stablecoin).
* Rungs per book and side: `k ∈ {0.10 %, 0.20 %, 0.30 %}`; bid `fair·(1−k)` rounded down to 0.0001,
  ask `fair·(1+k)` rounded up; notional $100 each (converted at `X`).
* Re-pricing: a rung with no position is re-priced when fair has moved more than 0.05 % since it was
  priced; every placement and re-price counts one order.
* Fill, trade-verified: in minute `m ≥` the order's live minute, with volume > 0, a bid at `p`
  fills if the minute's CLOSE (its last print) is `< p`; an ask if the close is `> p`. Fill at `p`.
  Size `min($100, 10 % of the minute's quote volume)` — the primary arm; the queue at the touch is
  £4–10k and a 60-second loop is never first in it.
* Exit: from the minute after the fill, a post-only order at the current fair (re-priced on 0.05 %
  moves; asks rounded up, bids down), filling on the same close-based test. Not filled within 24 h:
  closed at that minute's close as a taker, `close·(1 ∓ (0.0009 + 0.000067))` (half the measured
  1.33 bps spread).
* One position per rung at a time; a rung is re-placed the minute after its position closes.
* P&L in GBP, converted to USD at `X` of the exit minute (last known `X` if none that minute).
  Capital: 2 books × 2 sides × 3 rungs × $100 = $1,200.

## Arms

1. Primary: as written.
2. Stress (must stay > 0): taker exits at 18 bps + the full spread; every fill (entry and exit) needs
   the close beyond the price by one more tick.
3. Descriptive: per book, per rung, per side; the same rule with the BTC-implied rate in place of
   Yahoo (quotes at weekends too); full $100 fills.

## Null

Random-time twins: each OOS round trip of the primary arm is replaced by an entry on the same book
and side at the close of a uniformly drawn OOS traded minute that has a Yahoo rate, same size rule
(10 % of that minute's quote volume, ≤ $100), same exit; 2,000 draws, `random.Random(20260923)`.

## The bar (OOS; all must hold)

1. Primary P&L > 0.  2. Primary > the null's 95th percentile.  3. Stress > 0.
4. At least 20 OOS round trips (fewer cannot tell a rule from luck); orders ≤ 1,000 a day.
Capacity reported as fill notional per day.

## Determinism

`analysis/pr3_revx_gbp_stable_touch.py` run twice; byte-identical JSON.

## What this cannot show

Queue position is not modelled beyond the 10 % size cap; the close-based fill ignores prints that
went through the quote earlier in the minute (conservative). Fourteen OOS days can refute a rule
more easily than confirm one.
