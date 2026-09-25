# Pre-registration: LS-FADE, retail long/short ratio on BTC (fp5)

Written 2026-09-25 after the 2023 screen and before any 2024–2026 return of this
rule was computed. Frozen by the sha256 in `2026-09-25-fp5-prereg-ls-fade.sha256`.

## Why this one

The screen in `2026-09-25-fp5-protocol.md` scored fifteen ideas on 2023 only.
Fourteen failed its hurdle. LS-FADE passed: 60 trades, mean net +56.272 bps after
20 bps of fees, total +$33.7632 on $100 a trade, against a null p95 of +51.5273 bps
(200 draws, seed 20250925). The margin is thin. This file is the test that decides
whether that pass was the year.

The other fourteen stay dead. Their 2023 numbers are in `docs/agents/backtests/fp5/screen_2023.json`.
Nothing in them is retuned here. Fear-and-greed never printed below its published
cut of 20 in the 2023 file (the lowest reading was 25). The perp mark never traded
10 bps under the index (the deepest 8h close was about 7 bps). Both are empty
because the threshold written in advance was not reached, not because a parser
dropped the rows.

## What was seen

The 2023 screen, the BTC book at 2026-09-25 (`bookTicker` BTCUSDT, bid 84591.62,
ask 84591.63, half-spread 5.9107506265030525e-08), and the code that reproduces
the screen. No price, ratio or return from 2024 onward has been read for this rule.

## Rule

Unchanged from the protocol.

* BTCUSDT spot. The signal is the last `count_long_short_ratio` of the UTC day,
  from `data.binance.vision` daily metrics. A blank field is missing and that day
  is skipped.
* It fires when the ratio is strictly below its own trailing 90-day 10th
  percentile, with at least 30 earlier daily points. The percentile is
  `sorted[floor(0.10 × (n − 1))]`. The history is strictly before the signal day.
* Enter the next UTC daily open. Exit the open one day later. A missing day is a
  skip. $100 notional.
* Fee: 10 bps a side plus the half-spread above, on each side. Doubled costs are
  20 bps a side plus the same half-spread, once.

## Windows

A trade belongs to the window of its entry.

* Reproduction, not the bar: entries in 2023. Must come back as 60 trades and
  +$33.7632 within one cent, at the screen's fee with no spread. If it does not,
  this run is invalid and is not a pass.
* OOS1: entries on [2024-01-01, 2025-01-01).
* OOS2: entries on [2025-01-01, 2026-09-25). The last entry is 2026-09-24 and its
  exit print is the 2026-09-25 open. A partial later bar is not used.

## Null

Every BTC daily open in the OOS window that has a next-day open, same fee, same
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

The 5th and the 20th percentiles are the same rule with the quantile changed.
They were not used to choose the 10th. Each one that has at least 10 OOS trades
must have an OOS total above zero. Fewer than 10 trades is an absence and does
not veto. If either armed neighbor loses, the 10th's pass is the quantile the
screen happened to clear, and the rule is not fit to add.

## What a pass would mean

Fit to add to testing, on paper, BTC only, at this size. Not a live row, and not
a migration. A fail is the end of this rule. The next search does not inherit its
threshold.
