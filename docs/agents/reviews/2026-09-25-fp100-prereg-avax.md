# Pre-registration: AVAX-Q, AVAX quote over BTC quote (fp100)

Written 2026-09-25 after the 2023 screen and before any 2024–2026 return of this
rule was computed. Frozen at 2026-09-25T05:23:21Z by the sha256 in
`2026-09-25-fp100-prereg-avax.sha256`. The book below was read at that same
time. No later-year kline has been requested.

## Why this one

The screen in `2026-09-25-fp100-protocol.md` scored one idea on 2023 only.
AVAX-Q passed: 77 trades, mean net +104.1357 bps after 20 bps of fees, total
+$80.1845 on $100 a trade, against a null p95 of +96.2019 bps (200 draws,
seed 20250925). This file is the test that decides whether that pass was
the year.

fp5 through fp99 and fp101 through fp102 stay dead, including LS-FADE, BODY,
BAL-CHG, IMPACT, PEAK, DOM-UP, and the hourly-bar shape statistics fp30
through fp94. SOL-Q, BNB-Q, XRP-Q, DOGE-Q, ADA-Q, LINK-Q and LTC-Q failed
the same 2023 screen and are not retuned here. Nothing in the dead rules is
retuned. A day AVAX was quiet versus BTC is not a candidate. The 80th of a
failed screen is not a candidate.

## What was seen

The 2023 screen, the AVAX book at this freeze (`bookTicker` AVAXUSDT, bid
10.17300000, ask 10.17400000, half-spread 4.914729444141376e-05), and the
code that reproduces the screen. No daily open from 2024 onward has been
read except the 2024-01-01 open stored in the screen file, which is the exit
print of the last 2023 entry. That bar's quote is stored as zero.

## Rule

Unchanged from the protocol. The code takes a quantile so the neighbors
below can be scored. The 90th path is the one the screen ran. The
reproduction check is what shows it did not move.

* The statistic is AVAXUSDT quote volume divided by BTCUSDT quote volume on
  the same day. Either quote non-positive, or either bar missing, is not a
  print. The opens are not inputs. No hourly bar is read.
* It fires when that ratio is strictly above its own trailing-90-day 90th
  percentile, at least 90 earlier prints. The percentile is
  `sorted[floor(0.90 × (n − 1))]`.
* Enter the next AVAXUSDT daily open. Exit one day later. A missing bar is a
  skip. $100 notional.
* Fee: 10 bps a side plus the half-spread above, on each side. Doubled costs
  are 20 bps a side plus the same half-spread, once. The spread is not doubled.

## Windows

A trade belongs to the window of its entry.

* Reproduction, not the bar: entries in 2023, at the screen's fee with no
  spread. Must come back as 77 trades and +$80.1845 within one cent. If it
  does not, this run is invalid and is not a pass.
* OOS1: entries on [2024-01-01, 2025-01-01).
* OOS2: entries on [2025-01-01, 2026-09-25). The last entry is 2026-09-24
  and its exit print is the 2026-09-25 open. A later bar is not an entry.
  The 2026-09-25 quote is stored as zero.

## Null

Every AVAXUSDT daily open in the OOS window that has a next-day open, same
fee, same $100. 1,000 draws without replacement, seed 20260925. The cutoff
is the mean at index `floor(0.95 × 1000) = 950`. The rule's mean OOS pnl
must be above it.

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
They were not used to choose the 90th. Each one that has at least 10 OOS
trades must have an OOS total above zero. Fewer than 10 trades is an absence
and does not veto. If either armed neighbor loses, the 90th's pass is the
quantile the screen happened to clear, and the rule is not fit to add.

## What a pass would mean

Fit to add to testing, on paper, AVAX only, at this size. Not a live row, and
not a migration. A fail is the end of this rule. The next search does not
inherit its threshold, and it does not promote the 80th or the 95th.
