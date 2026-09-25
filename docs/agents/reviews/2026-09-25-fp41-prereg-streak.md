# Pre-registration: STREAK, consecutive rising closes (fp41)

Written 2026-09-25 after the 2023 screen and before any 2024–2026 return of this
rule was computed. Frozen at 2026-09-25T03:28:08Z by the sha256 in
`2026-09-25-fp41-prereg-streak.sha256`.

## Why this one

The screen in `2026-09-25-fp41-protocol.md` scored one idea on 2023 only.
STREAK passed: 33 trades, mean net +111.9095 bps after 20 bps of fees, total
+$36.9301 on $100 a trade, against a null p95 of +74.7946 bps (200 draws,
seed 20250925). This file is the test that decides whether that pass was
the year.

fp5 through fp40 stay dead, including LS-FADE, BODY, BAL-CHG, IMPACT, PEAK,
and the eight screens fp30 through fp37. Nothing in them is retuned here.
A shorter run of rising closes is not a candidate. The 80th of a failed
screen is not a candidate. IMPACT's 80th and 95th are not candidates.
PEAK's close under the prior 30-day high, and its 80th, are not candidates.
BODY's 80th is not a candidate. The level of the address count is not
scored, and BAL-CHG's 80th is not a candidate.

## What was seen

The 2023 screen, the BTC book at this freeze (`bookTicker` BTCUSDT, bid
84200.00000000, ask 84200.01000000, half-spread 5.938241924546982e-08), and
the code that reproduces the screen. No daily close from 2024 onward has
been read. No daily open from 2024 onward has been read except the
2024-01-01 open stored in the screen file, which is the exit print of the
last 2023 entry. That bar's close is stored equal to its open.

## Rule

Unchanged from the protocol. The code takes a quantile so the neighbors
below can be scored. The 90th path is the one the screen ran. The
reproduction check is what shows it did not move. A day that did not rise
scores 0 and stays in the history. The neighbours keep that gate: the value
must be strictly above the threshold and strictly above 0.

* Consecutive daily closes, ending today, each strictly above the prior
  close. Today and yesterday must exist. The open is not the signal. A down
  close resets the count.
* It fires when that count is strictly above its own trailing-90-day 90th
  percentile and strictly above 0, at least 90 earlier prints. The
  percentile is `sorted[floor(0.90 × (n − 1))]`.
* Enter the next BTCUSDT daily open. Exit one day later. A missing bar is a
  skip. $100 notional.
* Fee: 10 bps a side plus the half-spread above, on each side. Doubled costs
  are 20 bps a side plus the same half-spread, once. The spread is not doubled.

## Windows

A trade belongs to the window of its entry.

* Reproduction, not the bar: entries in 2023, at the screen's fee with no
  spread. Must come back as 33 trades and +$36.9301 within one cent. If it
  does not, this run is invalid and is not a pass.
* OOS1: entries on [2024-01-01, 2025-01-01).
* OOS2: entries on [2025-01-01, 2026-09-25). The last entry is 2026-09-24
  and its exit print is the 2026-09-25 open. A later bar is not an entry.
  The 2026-09-25 close is stored equal to that open.

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
They were not used to choose the 90th. Each one still requires the count to be
strictly above 0. Each one that has at least 10 OOS trades must have an OOS
total above zero. Fewer than 10 trades is an absence and does not veto. If
either armed neighbor loses, the 90th's pass is the quantile the screen
happened to clear, and the rule is not fit to add.

## What a pass would mean

Fit to add to testing, on paper, BTC only, at this size. Not a live row, and not
a migration. A fail is the end of this rule. The next search does not inherit
its threshold, and it does not promote the 80th or the 95th.
