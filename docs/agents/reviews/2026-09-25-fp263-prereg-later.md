# Pre-registration: LATER, a new two-day spot rise, fifteen-day spot long against the same long started later (fp263)

Written 2026-09-25 after the 2023 screen and before any later-year return of
this rule was computed. Frozen at 2026-09-25T13:16:20Z by the sha256 in
`2026-09-25-fp263-prereg-later.sha256`. The spot book was read at
2026-09-25T13:15:30.993461Z (`bookTicker` BTCUSDT, bid 84529.73, ask
84529.74, half-spread 5.915078291274204e-08). The half-spread is
`(ask − bid) / (ask + bid)`. Both trades are this spot book. No daily bar
after the screen's 2024-01-01 exit has been requested. No open from
2024-01-01 onward has been read as an entry.

## Why this one

The screen in `2026-09-25-fp263-protocol.md` scored one idea on 2023 only.
LATER passed: 87 trades, mean net +437.5697 bps after 20 bps of fees, total
+$380.6856 on $100 a trade, against the other trade's mean of +329.1846 bps.
The other trade is the fifteen-day spot long that starts fifteen days later.
The pool length equals the trade count, so that cutoff is the other trade's
mean. This file does not replace it with the fifteen-day long on every day.

The hold stays fifteen days on both trades. A signal counts only when both
windows can fill. PICK is a different rule and is registered on its own.
FADEU, DEFER, CMLAG, LAGB, OTHER and AFTER failed the 2023 screen and are
not rerun. TRIP and CFAL failed their later years. HI10 and STEP failed
their later years. CMF and QNEW failed their later years. MTH is void and
is not rerun. BRKHI is void and is not rerun. Nothing in the dead rules is
retuned.

## What was seen

The 2023 screen, the spot book above, and the code that reproduces the
screen. No daily open from 2024-01-01 onward has been read as an entry.

## Rule

Unchanged from the protocol. The reproduction check is what shows it did not
move. `docs/agents/scripts/fp263/common.py` stays the file the screen hashed.

* A finished two-day spot rise followed a two-day window that was not a rise.
  Those closes have already printed. A missing day is not a signal and is
  not filled in. Equals on the earlier window stay in, because that window
  is "not a rise".
* Enter the next BTCUSDT daily open and sell the open fifteen days later.
  $100 notional. One spot leg. Funding cash is not added.
* The other trade buys the BTCUSDT daily open fifteen days later and sells
  the open fifteen days after that. A signal counts only when both windows
  have an open on this contract. The later trade does not have to fire the
  signal again. A missing open is not borrowed from another book.
* The entry day's open is the fill. The entry day's close is not an input.
* Fee: 10 bps a side plus the half-spread above, on each side, on both
  trades. Doubled costs are 20 bps a side plus the same half-spread, once.
  The spread is not doubled.

## Windows

A trade belongs to the window of its entry. The rule's exit is the open
fifteen days later. The other trade's exit is the open thirty days after
the rule's entry.

* Reproduction, not the bar: entries in 2023, at the screen's fee with no
  spread. Must come back as 87 trades and +$380.6856 within one cent, and
  the other trade's mean must come back as +329.1846 bps. If it does not,
  this run is invalid and is not a pass.
* OOS1: entries on [2024-01-01, 2025-01-01). An exit open after that date
  is an exit.
* OOS2: entries on [2025-01-01, 2026-08-27). The last entry is 2026-08-26,
  because the other trade has to exit on the 2026-09-25 open. The rule's
  own exit on that entry is the open on 2026-09-10. A bar on 2026-09-25 is
  not an entry. A bar on 2026-09-26 is not requested.
* A close after 2026-08-25 is not a signal. Spot is stored through the
  2026-09-25 open because the later trade fills there.

## Null

The fifteen-day spot long that starts fifteen days after the rule's entry.
Same fee. Every null hold is fifteen days. The pool length equals the trade
count, so the cutoff is that other trade's mean. It is not a draw from
every fifteen-day spot long. 1,000 draws without replacement, seed
20260925, are the house machine; with the pool this short they return that
mean. The cutoff index is `floor(0.95 × 1000) = 950`. The rule's mean OOS
pnl must be strictly above it. If the later window has no open, that signal
is not a rule trade and it is not in the pool.

## The bar, all of them

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
does not inherit the two-day turn or the fifteen-day hold. This file does
not arm a testing row. A Binance daily open is not a Revolut X fill.
