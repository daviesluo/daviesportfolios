# fp7 protocol: after the fp6 screen failed (2026-09-25)

Written before any return of these rules was computed. The five fp6 rules are
dead, including the weekday controls. Tuesday came closest and is spent. It is
not a candidate here. USDC-CHEAP's count stays 30. Nothing in fp6 is retuned,
and no sign is flipped.

The screen below is the only measurement this file allows. A pass is not an
adoption. It earns a pre-registration before any later year is scored. 2023 is
spent once this screen runs.

Nothing here changes a frozen spec, arms a row, or sends an order. The fill is
fp5's `net_return`. Public reads only.

## Not this search

The families already priced, the fp6 rules, and these:

* A fourth column of the positioning file. Retail, top-over-retail and taker
  already have a number. The position-weighted top-trader ratio is that family.
* FDUSD at the same 20 bp gap. BTCUSDC at that gap had no day.
* The broad dollar index. `fred.stlouisfed.org` did not answer within 90 seconds,
  twice, from this host. That is not a result. It is not scored here, and a
  later search may still use it if the host answers.

## Costs, window, null

Ten basis points a side. No spread on this screen. Entries in
`[2023-01-01, 2024-01-01)` UTC. History for a threshold may start on
2022-10-01. A price, or a metric stamp, on or after 2024-01-01 is refused,
except the 2024-01-01 BTC open, which may be an exit print. The null is fp5's:
200 draws, seed `20250925`, index 190. The pool is every in-screen BTC daily
hold. A pass is at least 30 trades, mean net above zero, and mean net above
the null.

## The ideas

1. **MVRV.** Coin Metrics `CapMVRVCur`, daily, field printed beside `time`.
   The signal day is the UTC date of `time` (the first ten characters,
   `YYYY-MM-DD`). It fires when the value is strictly below 1, the published
   line, compared as `Decimal` of the printed number. Enter the next BTCUSDT
   daily open. Hold one day. A missing day is a skip.
2. **ADDR.** Coin Metrics `AdrActCnt`, same clock. It fires when the value is
   strictly above its own trailing-90-day 90th percentile, at least 90 earlier
   days. The percentile is `sorted[floor(0.90 × (n − 1))]`. Enter the next
   BTCUSDT daily open. Hold one day. The lower tail is not scored.
3. **BTC-SHARE.** BTCUSDT quote volume divided by BTCUSDT plus ETHUSDT quote
   volume, same UTC day, both volumes present and the sum positive. It fires
   when that share is strictly above its own trailing-90-day 90th, at least
   90 earlier days. Enter the next BTCUSDT daily open. Hold one day. The lower
   tail is not scored.

## What a pass becomes

The house bar used for LS-FADE: both later sub-windows positive, above a fresh
null, positive with doubled costs, at least 30 trades, no month above 40% of
the profit and the rest positive, and more than 4% a year on the $100 it
locks, entries 2024-01-01 through 2026-09-24. Where the rule has a quantile,
the neighbouring quantiles are a veto that can only reject. 2023 is not part
of that bar. If nothing passes, these three rules are dead and the next search
does not inherit their cuts.
