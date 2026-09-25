# Pre-registration: EREAL, realized-price discount, two-day ETH coin-margined long (fp321)

Written 2026-09-25 after the 2023 screen and before any later-year return of
this rule was computed. Frozen at 2026-09-25T15:55:59Z by the sha256 in
`2026-09-25-fp321-prereg-ereal.sha256`. The coin-margined book was read at
2026-09-25T15:55:24.802151Z (`bookTicker` ETHUSD_PERP, bid 2673.58, ask 2673.59, half-spread 1.8701481344745498e-06; the book's own time was 1790351725110).
Each half-spread is `(ask − bid) / (ask + bid)`. The first read was
discarded. No daily bar after the screen's 2024-01-01 exit has been
requested as an entry. No open from 2024-01-01 onward has been read as an
entry. WBRAT and WBPAR are not in this file. Their 2023 means are negative.

## Why this one

The screen in `2026-09-25-fp321-protocol.md` scored one idea on 2023 only.
EREAL passed: 31 trades, mean net +292.9806 bps after 20 bps of fees, total
+$90.824 on $100 a trade. The other trade is the same leg with the discount
below 1 basis point: 325 two-day longs, mean −3.9242 bps. The cutoff is the
house p95 of samples of 31, +76.5994 bps, not that mean. The gap is 216.3812
bps, strictly more than 20 bps. This file does not replace the p95 with the
edge-off mean.

WBRAT's mean is −12.1842 bps and WBPAR's mean is −16.8623 bps. Neither is
taken out of sample. A mean that clears the cutoff by 20 bps or less is not
taken out of sample. The next rules are not frozen until this test is
recorded.

The buy and the sell are not moved. The 1 bp line is not raised. A second
realized-price coin is not substituted. The null is not the opposite side
and it is not an unconditional hold.

## What was seen

The 2023 screen, the book above, and the code that reproduces the screen.
No daily open from 2024-01-01 onward has been read as an entry.

## Rule

Unchanged from the protocol. The reproduction check is what shows it did not
move. `docs/agents/scripts/fp321/common.py` stays the file the screen hashed.

* Fair value is the Coin Metrics realized ETH price in USD,
  `CapMrktCurUSD / CapMVRVCur / SplyCur`. Publication is
  `AssetEODCompletionTime`, and a stamp that is not strictly earlier than
  the entry is not used. `PriceUSD` and `ReferenceRateUSD` are not stored.
* The previous ETHUSD_PERP close is at least 1 basis point under that
  price. The discount is `(fair − close) / close`. The comparison is
  decimal. The entry open is not in it. The entry day's own close is not
  an input. High and low are not stored.
* Enter that contract's own daily open and sell the open two days later.
  $100 notional. One coin-margined leg. Funding cash is not added.
* The other trade buys the same contract for two days when the discount is
  below 1 basis point. A missing close or a fair value that was not yet
  published is neither trade. A missing open is not borrowed. A missing
  day is not filled in, including the 2023-08-28 through 2023-08-31 gap.
* Fee on the leg: 10 bps a side plus the half-spread above, on each side.
  Doubled costs are 20 bps a side plus that same half-spread, once. The
  spread is not doubled.

## Windows

A trade belongs to the window of its entry. The exit is the open two days
later.

* Reproduction, not the bar: entries in 2023, at the screen's fee with no
  spread. Must come back as 31 trades and +$90.824 within one cent. The
  mean must come back as +292.9806 bps. The edge-off set must come back as
  325 trades, mean −3.9242 bps, house p95 +76.5994 bps on samples of 31.
  If it does not, this run is invalid and is not a pass.
* OOS1: entries on [2024-01-01, 2025-01-01). An exit open in the first days
  of 2025 is an exit.
* OOS2: entries on [2025-01-01, 2026-09-24). The last entry is 2026-09-23.
  The exit is the open on 2026-09-25. A bar on 2026-09-25 is not an entry.
  A bar on 2026-09-26 is not requested.
* A close after 2026-09-22 is not a signal. The coin-margined book is
  stored through the 2026-09-25 open because that open is an exit. The
  realized price is stored only when its publication is strictly earlier
  than 2026-09-24.

## Null

The same two-day coin-margined long with the discount below 1 basis point.
Every null hold is two days. The two sets do not share an entry. The cutoff
is 1,000 draws without replacement, seed 20260925, index
`floor(0.95 × 1000) = 950`, of samples of this rule's count from the
edge-off pnl. It is that sample p95. It is not the edge-off set's own mean,
including when that set is longer. When the edge-off set is shorter than
the rule, the cutoff is missing and this bar fails. The missing cutoff is
not replaced with the edge-off mean. The rule's mean OOS pnl must be
strictly above the cutoff.

## The bar, all of them

The 2023 gap does not relax any line. A clearance of 20 bps or less voids
the rule even when the other lines pass.

1. OOS total > 0, and OOS1 > 0, and OOS2 > 0.
2. The OOS mean beats the sample p95. It does not beat the edge-off mean
   instead.
3. Doubled-cost OOS total > 0.
4. At least 30 OOS trades.
5. No entry-month is more than 40% of the OOS total, and the total without
   the best month is > 0.
6. The OOS total on the $100 it locks, annualised over the 998 UTC days from
   2024-01-01 to 2026-09-25, exceeds 4%.
7. The OOS mean net clears that sample p95 by strictly more than 20 bps.
   Twenty bps on the locked $100 is a mean-pnl gap strictly above $0.20. A
   gap of 20 bps or less voids the rule even when the other lines pass.

## What a pass would mean

A pass is a research record. It does not arm a testing row. The fill is a
Binance daily open, not a price this account can get. A fail, or a mean
that clears the cutoff by 20 bps or less, is the end of this rule. The buy
and the sell are not moved. The next rules are not frozen by this file.
LS-FADE's 60-trade reproduction, the control, doubled costs, and the rule
that no month is above 40% of the profit are not relaxed.
