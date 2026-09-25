# Pre-registration: DOM-UP, BTC dominance return (fp12)

Written 2026-09-25 after the 2023 screen and before any 2024–2026 return of this
rule was computed. Frozen at 2026-09-25T01:22:11Z by the sha256 in
`2026-09-25-fp12-prereg-dom-up.sha256`.

## Why this one

The screen in `2026-09-25-fp12-protocol.md` scored one idea on 2023 only.
DOM-UP passed: 115 trades, mean net +30.9469 bps after 20 bps of fees, total
+$35.589 on $100 a trade, against a null p95 of +4.7979 bps (200 draws, seed
20250925). This file is the test that decides whether that pass was the year.

fp5 through fp11 stay dead. Nothing in them is retuned here. The lower tail of
dominance is not a candidate. The volume-share rule is not reopened.

## What was seen

The 2023 screen, the BTC book at this freeze (`bookTicker` BTCUSDT, bid
84645.6, ask 84645.61, half-spread 5.906981227649864e-08), and the code that
reproduces the screen. No dominance price, spot price or return from 2024
onward has been read for this rule.

## Rule

Unchanged from the protocol. The code takes a quantile so the neighbors below
can be scored. The 90th path is the one the screen ran. The reproduction check
is what shows it did not move.

* The signal is the BTCDOMUSDT 8h close-to-close return. Both bars must exist,
  exactly 8h apart, both closes positive. The return is known at the next 8h
  open, and that open is the entry.
* It fires when the return is strictly above its own trailing-90-day 90th
  percentile, at least 90 earlier prints. The percentile is
  `sorted[floor(0.90 × (n − 1))]`.
* Enter BTCUSDT spot at that open. Exit 8h later. A missing bar is a skip.
  $100 notional. BTC spot's own return is not an input.
* Fee: 10 bps a side plus the half-spread above, on each side. Doubled costs
  are 20 bps a side plus the same half-spread, once. The spread is not doubled.

## Windows

A trade belongs to the window of its entry.

* Reproduction, not the bar: entries in 2023, at the screen's fee with no
  spread. Must come back as 115 trades and +$35.589 within one cent. If it
  does not, this run is invalid and is not a pass.
* OOS1: entries on [2024-01-01, 2025-01-01).
* OOS2: entries on [2025-01-01, 2026-09-25). The last entry is 2026-09-24
  16:00 UTC and its exit print is the 2026-09-25 00:00 open. A later bar is not
  an entry.

## Null

Every BTC 8h open in the OOS window that has an open 8h later, same fee, same
$100. 1,000 draws without replacement, seed 20260925. The cutoff is the mean at
index `floor(0.95 × 1000) = 950`. The rule's mean OOS pnl must be above it.

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
