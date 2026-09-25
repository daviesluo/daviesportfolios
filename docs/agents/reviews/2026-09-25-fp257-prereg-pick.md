# Pre-registration: PICK, a finished four-day spot decline, nine-day coin-margined long against a nine-day spot long (fp257)

Written 2026-09-25 after the 2023 screen and before any later-year return of
this rule was computed. Frozen at 2026-09-25T13:16:20Z by the sha256 in
`2026-09-25-fp257-prereg-pick.sha256`. The spot book was read at
2026-09-25T13:15:30.993461Z (`bookTicker` BTCUSDT, bid 84529.73, ask
84529.74, half-spread 5.915078291274204e-08). The coin-margined book was
read at 2026-09-25T13:15:31.413772Z (`bookTicker` BTCUSD_PERP, bid 84467.7,
ask 84467.8, half-spread 5.91941895018044e-07; the book's own time was
1790342130852). Each half-spread is `(ask − bid) / (ask + bid)`. No daily
bar after the screen's 2024-01-01 exit has been requested. No open from
2024-01-01 onward has been read as an entry.

## Why this one

The screen in `2026-09-25-fp257-protocol.md` scored one idea on 2023 only.
PICK passed: 156 trades, mean net +233.222 bps after 20 bps of fees, total
+$363.8263 on $100 a trade, against the other trade's mean of +230.2271 bps.
The other trade is the nine-day spot long on the same entries. The pool
length equals the trade count, so that cutoff is the other trade's mean.
The gap is about 3 bps. This file does not widen it. A later-year fail voids
the rule. The buy and the sell are not moved, and a nearby signal is not
substituted.

The hold stays nine days on both trades. The null is not the coin-margined
long with the decline turned off, and it is not every nine-day long. LATER
is a different rule and is registered on its own. FADEU, DEFER, CMLAG, LAGB,
OTHER and AFTER failed the 2023 screen and are not rerun. TRIP and CFAL
failed their later years. HI10 and STEP failed their later years. CMF and
QNEW failed their later years. MTH is void and is not rerun. BRKHI is void
and is not rerun. Nothing in the dead rules is retuned.

## What was seen

The 2023 screen, the two books above, and the code that reproduces the
screen. No daily open from 2024-01-01 onward has been read as an entry.

## Rule

Unchanged from the protocol. The reproduction check is what shows it did not
move. `docs/agents/scripts/fp257/common.py` stays the file the screen hashed.

* Spot's finished four-day return is strictly negative. The two closes have
  already printed. A missing day is not a signal and is not filled in.
* Enter the next BTCUSD_PERP daily open and sell the open nine days later.
  $100 notional. One coin-margined leg. Spot is the signal and the other
  trade, not a second leg of this trade. Funding cash is not added.
* The other trade buys the BTCUSDT daily open on that same entry and sells
  the open nine days later. A signal counts only when both windows have an
  open on that contract. A missing open is not taken from the other book.
* The entry day's open is the fill. The entry day's close is not an input.
* Fee on the coin-margined leg: 10 bps a side plus the coin-margined
  half-spread above, on each side. Fee on the spot leg: 10 bps a side plus
  the spot half-spread above, on each side. Doubled costs are 20 bps a side
  plus that same half-spread, once. The spread is not doubled.

## Windows

A trade belongs to the window of its entry. The exit is the open nine days
later.

* Reproduction, not the bar: entries in 2023, at the screen's fee with no
  spread. Must come back as 156 trades and +$363.8263 within one cent, and
  the other trade's mean must come back as +230.2271 bps. If it does not,
  this run is invalid and is not a pass.
* OOS1: entries on [2024-01-01, 2025-01-01). An exit open in the first days
  of 2025 is an exit.
* OOS2: entries on [2025-01-01, 2026-09-17). The last entry is 2026-09-16.
  The exit is the open on 2026-09-25. A bar on 2026-09-25 is not an entry.
  A bar on 2026-09-26 is not requested.
* A close after 2026-09-15 is not a signal. Both books are stored through
  the 2026-09-25 open because both are fills.

## Null

The nine-day spot long on the same entries as the rule, same fee rule as
the spot leg. Every null hold is nine days. The pool length equals the
trade count, so the cutoff is that other trade's mean. It is not a draw
from every nine-day coin-margined long. 1,000 draws without replacement,
seed 20260925, are the house machine; with the pool this short they return
that mean. The cutoff index is `floor(0.95 × 1000) = 950`. The rule's mean
OOS pnl must be strictly above it. If a trade is missing from either book,
it is not in the pool and it is not a rule trade.

## The bar, all of them

The 2023 gap of about 3 bps does not relax any line.

1. OOS total > 0, and OOS1 > 0, and OOS2 > 0.
2. The OOS mean beats the other trade's cutoff.
3. Doubled-cost OOS total > 0.
4. At least 30 OOS trades.
5. No entry-month is more than 40% of the OOS total, and the total without the
   best month is > 0.
6. The OOS total on the $100 it locks, annualised over the 998 UTC days from
   2024-01-01 to 2026-09-25, exceeds 4%.

## What a pass would mean

A pass is a research record. It does not arm a testing row, and it does not
move the buy or the sell. A fail is the end of this rule. The next search
does not inherit the four-day decline or the nine-day hold. This file does
not arm a testing row. A Binance daily open is not a Revolut X fill.
