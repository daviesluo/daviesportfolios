# fp5 protocol: a fourth first-principles search, Binance only (2026-09-25)

Written before any return of these rules was computed. The screen below is the only
measurement this file allows. A rule that fails it is dead. A rule that passes it is
not adopted: it gets its own pre-registration, committed before any later year is
scored, and that later year is the test. 2023 is spent once this screen runs.

Nothing here changes a frozen spec, arms a row, or sends an order. Public reads only.

## What this search will not run again

These already have a verdict. Running them again would be choosing on data that has
been seen. Cross-sectional momentum (§3.24). Cross-sectional reversal and low
volatility (§3.25). Cascade bids, including the slice after Binance's price-range
cap (§3.29). Zero-fee stablecoin quotes (§3.29). The delisting window and new-listing
drift (§3.29). Launchpool carry (§3.29). The average drift in the half hour before
funding (§3.29, B8). Quoting U-books and triangles (§3.29). DVOL and funding used as
gates on the 4-hour trend rule, and volatility-sized slots (§3.21). The BTC-regime
entry filter (§3.30). Maker-only rules on Revolut X (§3.23).

Dead without a number, from the interfaces this repository already has:

* A cash-and-carry of positive funding needs a perpetual short. This search does not
  open a derivatives book. `fapi.binance.com` answers 451 from this host anyway.
* Historical order-book depth is not in the interfaces. A book-imbalance rule cannot
  be tested.
* Convert, Dual Investment and Simple Earn need a signed call. Not used.
* There is no public history of the insurance fund or auto-deleveraging in the
  interfaces. Not used.
* Cross-venue basis against Kraken was measured and did not clear the fee (§2c).
  Not reopened.

## Interfaces

Keyless, the ones the repository already documents:

* `data-api.binance.vision` `/api/v3/klines` for spot 8h and 1d.
* `data.binance.vision` monthly funding-rate files, daily BTC metrics (open interest,
  long/short ratios, taker ratio), and BTC 8h mark and index klines.
* Deribit `public/get_volatility_index_data`, BTC, 1 day.
* `api.alternative.me/fng`.
* Coinbase Exchange public `BTC-USD` daily candles.
* `stablecoins.llama.fi/stablecoincharts/all`.

Stored series stop at the end of 2023, plus the 2024-01-01 00:00 UTC open, which is
only an exit print for the last 2023 entry. A price after 2024-01-02 00:00 UTC is a
bug and the scorer refuses it.

## Basket

The 33 names in `docs/agents/scripts/fp5/common.py` `BASKET`: the liquid USDT names
the earlier Binance studies already treated as the book, plus LUNA, LUNC, FTT and
POL. It was written down before any of these returns. It is not the whole archive.
A coin outside it cannot be chosen later to improve a result.

## Costs and the null

Ten basis points a side, the account's measured Binance spot fee. The fill buys the
open at 10 bps above it and sells the later open at 10 bps below it. No spread is
added on this screen; the majors' half-spread is about a basis point and the
pre-registration, if one is written, measures the book that day and adds it.

The null draws 200 times, seed `20250925`, without replacement, from every hold of
the same length the rule could have taken. The cutoff is the sorted mean at index
`floor(0.95 × 200) = 190`. The same index as fp3's cascade test.

## The screen

An entry is scored only when its time is in `[2023-01-01, 2024-01-01)` UTC. History
used to build a threshold may start on 2022-10-01. A pass is all of: at least the
idea's minimum number of trades (30, or 15 for the Monday supply rule), mean net
return above zero, and mean net return above that idea's null cutoff.

One pass on this screen is not a result worth adding. It only earns a pre-registration.

## The ideas, parameters fixed

1. **FR-OWN.** At a funding settlement, the rate is below that coin's own trailing
   90-day 10th percentile (at least 90 earlier prints, strictly before the
   settlement; the percentile is `sorted[floor(0.10 × (n − 1))]`). Enter the spot
   open one 8h bar later. Hold exactly one 8h bar. Each coin, $100.
2. **FR-XS.** One coin per settlement: the most negative rate in the basket, and
   only when that rate is negative and below its own 10th. A tie takes the
   alphabetical symbol. Same entry, hold and cost.
3. **VOL-CLIMAX.** An 8h bar whose close is at least 3% under the previous bar's
   close, on a quote volume above 3× the median of the trailing 90 days (at least
   90 bars). Enter the next 8h open, hold one bar. It also has to beat VOL-DROP.
4. **VOL-DROP.** The same drop with no volume test. A candidate on its own, and the
   control the climax rule has to beat.
5. **SEASON.** BTC, one 8h bar, from 00:00, 08:00 and 16:00 UTC. The idea passes
   only when all three hours pass. A single hour is not a candidate.
6. **OI-FLUSH.** BTC. The day's last open-interest value is at least 5% under the
   previous day's, and the spot close fell. Enter the next daily open, hold one day.
7. **LS-FADE.** BTC retail long/short count ratio below its trailing-90-day 10th
   (at least 30 daily points). Next day, one day.
8. **TOP-RETAIL.** Top-trader long/short count ratio divided by the retail ratio,
   above its trailing-90-day 90th. Next day, one day.
9. **TAKER.** Taker buy/sell volume ratio below its trailing 10th. Next day, one day.
10. **FNG.** The published fear-and-greed index below 20. Next day, long BTC, one day.
    The cut is the index's own "extreme fear" label, not a searched one.
11. **DVOL-BUY.** Deribit BTC DVOL's daily close above its trailing-90-day 90th.
    Next day, long BTC. This is the opposite of §3.21's gate (that one skipped
    entries). It is a cousin, and a pass still has to clear a later pre-registered
    test on years this screen does not score.
12. **CB-PREMIUM.** Coinbase's BTC daily close more than 15 bps above Binance's.
    Next day, long BTC on Binance.
13. **PREM-REV.** The BTC perpetual mark more than 10 bps under the index at an 8h
    close. Buy spot at the next open, hold one bar.
14. **ETH-BTC.** ETH/BTC's daily close more than two trailing-30-day standard
    deviations under its mean (30 closes). Hold ETH for one day. The number is
    ETH's net return minus BTC's gross return.
15. **SUPPLY.** A Monday on which the stablecoin supply is higher than it was 30
    days earlier, the supply read strictly before that Monday. Hold BTC until the
    next Monday. Minimum 15 trades. It also has to beat the mean of every Monday.

A missing bar is a skip. Holds do not stretch across a hole. Funding stamps more
than two minutes off an 8h boundary are dropped.

## What a pass becomes

The pre-registration, written after this screen and before any other year is
touched, freezes the rule that passed, the house bar used for fp3's cascade test
(both later sub-windows positive, above a fresh null, positive with doubled costs,
at least 30 trades, no month above 40% of the profit, and more than 4% a year on
the capital it locks), and the years 2024-01-01 through 2026-09-24 as the test.
2023 is disclosed as seen and is not part of that bar. If nothing passes, the
search stops. No parameter is retuned on another year.
