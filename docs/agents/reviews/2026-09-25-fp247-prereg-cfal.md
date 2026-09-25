# Pre-registration: CFAL, two finished five-day coin-margined declines, held eighteen days (fp247)

Written 2026-09-25 after the 2023 screen and before any later-year return of
this rule was computed. Frozen at 2026-09-25T12:24:44Z by the sha256 in
`2026-09-25-fp247-prereg-cfal.sha256`. The book below was read at
2026-09-25T12:24:37.190Z. The screen stores a USDT-perpetual bar on
2024-01-01 only so a 2023 entry can exit. No daily bar after that exit has
been requested. No open from 2024-01-01 onward has been read as an entry.

## Why this one

The screen in `2026-09-25-fp247-protocol.md` scored one idea on 2023 only.
CFAL passed: 64 trades, mean net +758.9861 bps after 20 bps of fees, total
+$485.7511 on $100 a trade, against a null p95 of +704.8709 bps (200 draws,
seed 20250925). The null pool was every eighteen-day USDT-perpetual long,
the two-decline filter off. This file is the test that decides whether that
pass was the year.

The hold stays eighteen days. The null hold stays eighteen days. A shorter
pool is not this test. DROP, UPRI, AHEAD, CALM, CDEC and BOUN stay failed on
this screen. HI10 and STEP failed their later years and are not rerun. TRIP
is a different rule and is registered on its own. CMF and QNEW stay failed.
MTH is void and is not rerun. Nothing in the dead rules is retuned.

## What was seen

The 2023 screen, the USDT-perpetual book at this freeze (`bookTicker`
BTCUSDT, bid 84212.8, ask 84212.9, half-spread 5.937336166111754e-07), and
the code that reproduces the screen. The half-spread is `(ask − bid) /
(ask + bid)`. BTCUSD_PERP and spot were not read for this spread. No daily
open from 2024-01-01 onward has been read as an entry.

## Rule

Unchanged from the protocol. The reproduction check is what shows it did not
move. `docs/agents/scripts/fp247/common.py` stays the file the screen hashed.

* Two finished five-day coin-margined declines, back to back, the latest
  ending yesterday. Each five-day return is strictly negative. Those closes
  have already printed. A missing day is not a signal and is not filled in.
* Enter the next BTCUSDT USDT-perpetual daily open and sell the open
  eighteen days later. $100 notional. One USDT-perpetual leg. The
  coin-margined book is a signal, not a second leg. Funding cash is not
  added. A missing bar is a skip.
* The entry day's open is the fill. The entry day's close is not an input.
  The comparison does not read it.
* Fee: 10 bps a side plus the half-spread above, on each side. Doubled costs
  are 20 bps a side plus the same half-spread, once. The spread is not doubled.

## Windows

A trade belongs to the window of its entry. The exit is the open eighteen
days later.

* Reproduction, not the bar: entries in 2023, at the screen's fee with no
  spread. Must come back as 64 trades and +$485.7511 within one cent. If it
  does not, this run is invalid and is not a pass.
* OOS1: entries on [2024-01-01, 2025-01-01). An exit open in the first days
  of 2025 is an exit.
* OOS2: entries on [2025-01-01, 2026-09-08). The last entry is 2026-09-07.
  The exit is the open on 2026-09-25. A bar on 2026-09-25 is not an entry.
  A bar on 2026-09-26 is not requested.
* Coin-margined closes used as the signal stop on 2026-09-06, the day before
  the last entry. A coin-margined close after 2026-09-06 is not stored.

## Null

Every BTCUSDT USDT-perpetual day in the OOS window that has an open eighteen
days later, same eighteen-day long, the two-decline filter off. Same fee as
the rule in that run. Every pool hold is eighteen days. 1,000 draws without
replacement, seed 20260925. The cutoff is the mean at index
`floor(0.95 × 1000) = 950`. The rule's mean OOS pnl must be above it. If
the pool is shorter than the trade count, the null is absent and this bar
fails.

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
does not inherit the two five-day declines or the eighteen-day hold. This
file does not arm a testing row.
