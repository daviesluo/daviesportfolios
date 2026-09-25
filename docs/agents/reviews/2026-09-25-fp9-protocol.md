# fp9 protocol: implied-minus-realized, and cross-sectional dispersion (2026-09-25)

Written before any return of these rules was computed. The rules in fp5, fp6,
fp7 and fp8 are dead. None of their cuts is reused, and no sign is flipped.

This screen is the only measurement this file allows. A pass is not an
adoption. It earns a pre-registration before any later year is scored. 2023
is spent once this screen runs.

Nothing here changes a frozen spec, arms a row, or sends an order. The fill
is fp5's `net_return`. Public reads only. No file from 2024 onward is pulled.

## Not this search

Everything already priced, plus the four closed rounds. Also not here: DVOL's
level (DVOL-BUY already failed), a dip defined by a down close, a rule that
picks the winner or the loser coin, the upper tail of a single-name range,
another valuation ratio, exchange-reserve levels, the rich side of the
quarterly basis, and any calendar rule.

## Costs, window, null

Ten basis points a side. No spread on this screen. Entries in
`[2023-01-01, 2024-01-01)` UTC. History for a threshold may start on
2022-10-01. A price or a metric stamp on or after 2024-01-01 is refused,
except the 2024-01-01 BTC open, which may be an exit print. The null is
fp5's: 200 draws, seed `20250925`, index 190. VRP draws from every in-screen
BTC daily hold. DISPERSION draws from every in-screen BTC 8h hold. A pass is
at least 30 trades, mean net above zero, and mean net above that rule's own
null.

## The ideas

1. **VRP.** Deribit BTC DVOL daily close, in vol points, at the exact
   millisecond of the Binance daily open (midnight UTC). On day D, before
   2024-01-01, realized vol uses the BTCUSDT daily closes on D, D−1, …, D−30.
   Every one of those 31 closes must be present and positive. A missing day
   is a skip; nothing is interpolated. The 30 log returns are
   ln(close[D−k] / close[D−k−1]) for k = 0..29. Realized is their sample
   standard deviation (divide by 29) times sqrt(365) times 100. VRP is the
   DVOL close minus that number. It fires when VRP is strictly above its own
   trailing-90-day 90th percentile, at least 90 earlier days in
   `[D−90 days, D)`, percentile `sorted[floor(0.90 × (n − 1))]`. Enter the
   next BTCUSDT daily open. Hold one day. The lower tail is not scored.
   This is the gap versus recent realized vol. It is not DVOL's level, and a
   failure does not license the other tail.
2. **DISPERSION.** At each 8h bar whose open is t, with t strictly before
   2024-01-01, a basket coin's return is that bar's close divided by the
   close of the bar opened exactly 8h earlier, minus 1. Both closes must be
   positive and both bars must exist. Only the fp5 basket counts. Fewer than
   10 such coins and the bar has no print. The print is the population
   standard deviation of those returns (divide by n, not by n−1). It is known
   at t+8h, and that is the print's timestamp. It fires when the print is
   strictly above its own trailing-90-day 90th percentile, at least 90
   earlier prints in `[t+8h−90 days, t+8h)`, same percentile formula. Enter
   BTCUSDT at t+8h. Exit at t+16h. The lower tail is not scored. The rule
   does not pick a coin and does not require BTC's own bar to be down.

## What a pass becomes

The house bar used for LS-FADE: both later sub-windows positive, above a
fresh null, positive with doubled costs, at least 30 trades, no month above
40% of the profit and the rest positive, and more than 4% a year on the $100
it locks, entries 2024-01-01 through 2026-09-24. Neighbouring quantiles, the
80th and the 95th of the same series, are a veto that can only reject. They
are not scored on this screen. 2023 is not part of that bar. If nothing
passes, these two rules are dead and the next search does not inherit their
cuts.
