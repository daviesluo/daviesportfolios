# Pre-registration: BODY, the candle body (fp26)

Written 2026-09-25 after the 2023 screen and before any 2024–2026 return of this
rule was computed. Frozen at 2026-09-25T02:37:30Z by the sha256 in
`2026-09-25-fp26-prereg-body.sha256`.

## Why this one

The screen in `2026-09-25-fp26-protocol.md` scored one idea on 2023 only.
BODY passed: 46 trades, mean net +106.994 bps after 20 bps of fees, total
+$49.2172 on $100 a trade, against a null p95 of +58.7861 bps (200 draws,
seed 20250925). This file is the test that decides whether that pass was
the year.

fp5 through fp25 stay dead, including CLOSE-LOC, the quiet-day range,
EXCH-BAL and FEE-HIGH. Nothing in them is retuned here. A doji is not a
candidate. The wide-range upper tail is not scored.

## What was seen

The 2023 screen, the BTC book at this freeze (`bookTicker` BTCUSDT, bid
84514.26, ask 84514.27, half-spread 5.916161022824505e-08), and the code
that reproduces the screen. No daily high, low, close or return from 2024
onward has been read for this rule. The 2024-01-01 open stored in the
screen file is the exit print of the last 2023 entry, with the other three
fields set equal to that open.

## Rule

Unchanged from the protocol. The code takes a quantile so the neighbors
below can be scored. The 90th path is the one the screen ran. The
reproduction check is what shows it did not move.

* The signal is the absolute difference of the daily close and the open,
  divided by the high minus the low. The high must be strictly above the
  low. The open and the close must sit inside the range. All four prices
  must be positive. A flat bar is missing. The sign of the day is not used.
* It fires when the share is strictly above its own trailing-90-day 90th
  percentile, at least 90 earlier prints. The percentile is
  `sorted[floor(0.90 × (n − 1))]`.
* Enter the next BTCUSDT daily open. Exit one day later. A missing bar is a
  skip. $100 notional.
* Fee: 10 bps a side plus the half-spread above, on each side. Doubled costs
  are 20 bps a side plus the same half-spread, once. The spread is not doubled.

## Windows

A trade belongs to the window of its entry.

* Reproduction, not the bar: entries in 2023, at the screen's fee with no
  spread. Must come back as 46 trades and +$49.2172 within one cent. If it
  does not, this run is invalid and is not a pass.
* OOS1: entries on [2024-01-01, 2025-01-01).
* OOS2: entries on [2025-01-01, 2026-09-25). The last entry is 2026-09-24
  and its exit print is the 2026-09-25 open. A later bar is not an entry.

## Null

Every BTC daily open in the OOS window that has a next-day open, same fee,
same $100. 1,000 draws without replacement, seed 20260925. The cutoff is
the mean at index `floor(0.95 × 1000) = 950`. The rule's mean OOS pnl must
be above it.

## The bar, all of them

1. OOS total > 0, and OOS1 > 0, and OOS2 > 0.
2. The OOS mean beats the null cutoff.
3. Doubled-cost OOS total > 0.
4. At least 30 OOS trades.
5. No entry-month is more than 40% of the OOS total, and the total without the
   best month is > 0.
6. The OOS total on the $100 it locks, annualised over the 998 UTC days from
   2024-01-01 to 2026-09-25, exceeds 4%.

## A veto that can only reject

The 80th and the 95th percentiles are the same rule with the quantile changed.
They were not used to choose the 90th. Each one that has at least 10 OOS trades
must have an OOS total above zero. Fewer than 10 trades is an absence and does
not veto. If either armed neighbor loses, the 90th's pass is the quantile the
screen happened to clear, and the rule is not fit to add.

## What a pass would mean

Fit to add to testing, on paper, BTC only, at this size. Not a live row, and not
a migration. A fail is the end of this rule. The next search does not inherit
its threshold.
