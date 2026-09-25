# fp8 protocol: a different family, after fp5–fp7 (2026-09-25)

Written before any return of these rules was computed. The rules in fp5, fp6
and fp7 are dead, including LS-FADE, the weekday controls, MVRV, active
addresses and BTC's share of volume. None of their cuts is reused, and no
sign is flipped.

This screen is the only measurement this file allows. A pass is not an
adoption. It earns a pre-registration before any later year is scored. 2023
is spent once this screen runs.

Nothing here changes a frozen spec, arms a row, or sends an order. The fill
is fp5's `net_return`. Public reads only.

## Not this search

Everything already priced, plus the three closed rounds. Also not here:
another on-chain valuation ratio, another activity count, the perpetual's
premium (it never reached the old cut), and a second stablecoin quote.

## Costs, window, null

Ten basis points a side. No spread on this screen. Entries in
`[2023-01-01, 2024-01-01)` UTC. History for a threshold may start on
2022-10-01. A price or a metric stamp on or after 2024-01-01 is refused,
except the 2024-01-01 BTC open, which may be an exit print. The null is
fp5's: 200 draws, seed `20250925`, index 190, drawn from every in-screen BTC
daily hold. A pass is at least 30 trades, mean net above zero, and mean net
above the null.

## The ideas

1. **FLOW-OUT.** Coin Metrics `FlowOutExNtv` minus `FlowInExNtv`, both
   required on that UTC date (the first ten characters of `time`). A row
   whose value is present is used; the status string is not a filter. The
   net outflow fires when it is strictly above its own trailing-90-day 90th
   percentile, at least 90 earlier days. The percentile is
   `sorted[floor(0.90 × (n − 1))]`. Enter the next BTCUSDT daily open. Hold
   one day. The lower tail is not scored. This is exchange flow, not a
   valuation ratio and not an address count.
2. **HASH-DROP.** Coin Metrics `HashRate`. It fires when the value is
   strictly below its own trailing-90-day 10th percentile, at least 90
   earlier days, percentile `sorted[floor(0.10 × (n − 1))]`. Enter the next
   BTCUSDT daily open. Hold one day. The upper tail is not scored. A
   non-positive reading is missing.
3. **BASIS-BACK.** USDT-margined quarterly futures, these contracts only:
   `BTCUSDT_221230` expiring 2022-12-30, `BTCUSDT_230331` expiring 2023-03-31,
   `BTCUSDT_230630` expiring 2023-06-30, `BTCUSDT_230929` expiring 2023-09-29,
   `BTCUSDT_231229` expiring 2023-12-29, `BTCUSDT_240329` expiring 2024-03-29.
   On day D the future is the one with the soonest expiry strictly after
   D+7 days. Basis is that contract's daily close divided by the BTCUSDT
   daily close, minus 1, as `Decimal` of the printed closes. It fires when
   the basis is strictly below −0.002, one round trip. Enter the next
   BTCUSDT daily open. Hold one day. A day missing either close is a skip.
   This is the dated future, not the perpetual mark against the index.

## What a pass becomes

The house bar used for LS-FADE: both later sub-windows positive, above a
fresh null, positive with doubled costs, at least 30 trades, no month above
40% of the profit and the rest positive, and more than 4% a year on the $100
it locks, entries 2024-01-01 through 2026-09-24. For FLOW-OUT and HASH-DROP
the neighbouring quantiles are a veto that can only reject. For BASIS-BACK
the neighbours are −0.001 and −0.004, same veto. 2023 is not part of that
bar. If nothing passes, these three rules are dead and the next search does
not inherit their cuts.
