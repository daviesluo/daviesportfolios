# Pre-registration: TRIP, three finished two-day spot rises, held three days (fp246)

Written 2026-09-25 after the 2023 screen and before any later-year return of
this rule was computed. Frozen at 2026-09-25T12:24:44Z by the sha256 in
`2026-09-25-fp246-prereg-trip.sha256`. The book below was read at
2026-09-25T12:24:36.772Z. The screen stores a coin-margined bar on 2024-01-01
only so a 2023 entry can exit. No daily bar after that exit has been
requested. No open from 2024-01-01 onward has been read as an entry.

## Why this one

The screen in `2026-09-25-fp246-protocol.md` scored one idea on 2023 only.
TRIP passed: 55 trades, mean net +178.4819 bps after 20 bps of fees, total
+$98.165 on $100 a trade, against a null p95 of +151.7253 bps (200 draws,
seed 20250925). The null pool was every three-day coin-margined long, the
three-rise filter off. This file is the test that decides whether that pass
was the year.

The hold stays three days. The null hold stays three days. A shorter pool is
not this test. It is not four consecutive higher closes and it is not a
one-day trade. DROP, UPRI, AHEAD, CALM, CDEC and BOUN stay failed on this
screen. HI10 and STEP failed their later years and are not rerun. CFAL is a
different rule and is registered on its own. CMF and QNEW stay failed. MTH
is void and is not rerun. Nothing in the dead rules is retuned.

## What was seen

The 2023 screen, the coin-margined perpetual book at this freeze
(`bookTicker` BTCUSD_PERP, bid 84187.9, ask 84188.0, half-spread
5.939092233854178e-07), and the code that reproduces the screen. The
half-spread is `(ask − bid) / (ask + bid)`. BTCUSDT spot and the USDT
perpetual were not read for this spread. No daily open from 2024-01-01
onward has been read as an entry.

## Rule

Unchanged from the protocol. The reproduction check is what shows it did not
move. `docs/agents/scripts/fp246/common.py` stays the file the screen hashed.

* Three finished two-day spot rises, back to back, the latest ending
  yesterday. Each two-day return is strictly positive. Those closes have
  already printed. A missing day is not a signal and is not filled in.
* Enter the next BTCUSD_PERP daily open and sell the open three days later.
  $100 notional. One coin-margined leg. Spot is a signal, not a second leg.
  Funding cash is not added. A missing bar is a skip.
* The entry day's open is the fill. The entry day's close is not an input.
  The comparison does not read it.
* Fee: 10 bps a side plus the half-spread above, on each side. Doubled costs
  are 20 bps a side plus the same half-spread, once. The spread is not doubled.

## Windows

A trade belongs to the window of its entry. The exit is the open three days
later.

* Reproduction, not the bar: entries in 2023, at the screen's fee with no
  spread. Must come back as 55 trades and +$98.165 within one cent. If it
  does not, this run is invalid and is not a pass.
* OOS1: entries on [2024-01-01, 2025-01-01). An exit open in the first days
  of 2025 is an exit.
* OOS2: entries on [2025-01-01, 2026-09-23). The last entry is 2026-09-22.
  The exit is the open on 2026-09-25. A bar on 2026-09-25 is not an entry.
  A bar on 2026-09-26 is not requested.
* Spot closes used as the signal stop on 2026-09-21, the day before the last
  entry. A spot close after 2026-09-21 is not stored.

## Null

Every BTCUSD_PERP day in the OOS window that has an open three days later,
same three-day long, the three-rise filter off. Same fee as the rule in that
run. Every pool hold is three days. 1,000 draws without replacement, seed
20260925. The cutoff is the mean at index `floor(0.95 × 1000) = 950`. The
rule's mean OOS pnl must be above it. If the pool is shorter than the trade
count, the null is absent and this bar fails.

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

A pass is a research record. It does not arm a testing row, and it does not
move the buy or the sell. A fail is the end of this rule. The next search
does not inherit the three two-day rises or the three-day hold. This file
does not arm a testing row.
