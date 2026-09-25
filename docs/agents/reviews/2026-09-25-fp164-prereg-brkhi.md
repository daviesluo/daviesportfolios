# Pre-registration: BRKHI, a wide break of yesterday's high (fp164)

Written 2026-09-25 after the 2023 screen and before any 2024–2026 return of this
rule was computed. Frozen at 2026-09-25T08:45:36Z by the sha256 in
`2026-09-25-fp164-prereg-brkhi.sha256`. The book below was read at that same
time. No daily bar after 2023-12-31 has been requested. The screen file stops
on 2023-12-31.

## Why this one

The screen in `2026-09-25-fp164-protocol.md` scored one idea on 2023 only.
BRKHI passed: 70 trades, mean net +132.4951 bps after 20 bps of fees, total
+$92.7466 on $100 a trade, against a null p95 of +64.3265 bps (200 draws,
seed 20250925). The null pool was the 170 breaks of yesterday's high, with
the four-day width filter off. This file is the test that decides whether
that pass was the year.

fp5 through fp163 and fp165 through fp168 stay dead, including BASBOOK,
FNCARRY, TAKSESS, OINIGHT, MOM5, UPSTOP, PEAK0 and TAKX. FNCLIMB, ACCUM,
TAKTGT, FAILSH, VOL3, WIDE4 and FLOW failed the same 2023 screen and are not
retuned here. Nothing in the dead rules is retuned. This rule has no
percentile. An 80th and a 95th are not scored.

## What was seen

The 2023 screen, the BTC book at this freeze (`bookTicker` BTCUSDT, bid
84306.00000000, ask 84306.01000000, half-spread 5.930775627881614e-08), and
the code that reproduces the screen. No daily open from 2024 onward has been
read. The screen's last bar is 2023-12-31.

## Rule

Unchanged from the protocol. The reproduction check is what shows it did not
move.

* On day D the high trades strictly above yesterday's high, and today's high
  minus today's low is strictly wider than each of the three UTC days before
  it. A missing prior day is not a signal and is not filled in. An equal
  range does not fire.
* Buy yesterday's high. If the open is already strictly above that high, buy
  the open. Sell today's close. $100 notional. A missing bar is a skip.
* The width is the finished day's high minus its low. The price that is
  bought was traded during that day. This is the fill the screen ran. It is
  not rewritten here as an entry on the next day.
* Fee: 10 bps a side plus the half-spread above, on each side. Doubled costs
  are 20 bps a side plus the same half-spread, once. The spread is not doubled.

## Windows

A trade belongs to the window of its entry. The exit is the same day's close,
so the window does not need the next day's open.

* Reproduction, not the bar: entries in 2023, at the screen's fee with no
  spread. Must come back as 70 trades and +$92.7466 within one cent. If it
  does not, this run is invalid and is not a pass.
* OOS1: entries on [2024-01-01, 2025-01-01).
* OOS2: entries on [2025-01-01, 2026-09-25). The last entry is 2026-09-24.
  That day's bar is the exit. A bar on 2026-09-25 is not an entry.

## Null

Every BTCUSDT day in the OOS window whose high trades strictly above
yesterday's high, same stop-entry payoff, four-day width filter off. Same
fee as the rule in that run. 1,000 draws without replacement, seed 20260925.
The cutoff is the mean at index `floor(0.95 × 1000) = 950`. The rule's mean
OOS pnl must be above it. If the break pool is shorter than the trade count,
the null is absent and this bar fails.

## The bar, all of them

1. OOS total > 0, and OOS1 > 0, and OOS2 > 0.
2. The OOS mean beats the null cutoff.
3. Doubled-cost OOS total > 0.
4. At least 30 OOS trades.
5. No entry-month is more than 40% of the OOS total, and the total without the
   best month is > 0.
6. The OOS total on the $100 it locks, annualised over the 998 UTC days from
   2024-01-01 to 2026-09-25, exceeds 4%.

## What a pass would mean

Fit to add to testing, on paper, BTC only, at this size. Not a live row, and
not a migration. A fail is the end of this rule. The next search does not
inherit the four-day width or the stop at yesterday's high.
