# Pre-registration: LOUDER, a louder three-day move, twenty-one-day USDT long against the quieter twenty-one-day long (fp268)

Written 2026-09-25 after the 2023 screen and before any later-year return of
this rule was computed. Frozen at 2026-09-25T13:42:41Z by the sha256 in
`2026-09-25-fp268-prereg-louder.sha256`. The USDT-margined book was read at
2026-09-25T13:39:52.405491Z (`bookTicker` BTCUSDT, bid 84066.00, ask 84066.10, half-spread 5.947704216257381e-07; the book's own time was 1790343592111).
Each half-spread is `(ask − bid) / (ask + bid)`. No daily bar after the
screen's 2024-01-01 exit has been requested as an entry. No open from
2024-01-01 onward has been read as an entry.

## Why this one

The screen in `2026-09-25-fp268-protocol.md` scored one idea on 2023 only.
LOUDER passed: 170 trades, mean net +601.172 bps after 20 bps of fees, total
+$1021.9923 on $100 a trade. The other trade is the quieter regime: 175
twenty-one-day USDT longs, mean +529.6739 bps. The cutoff is the house p95
of samples of 170, +551.9241 bps, not that quieter mean. This file does not
replace the p95 with the quieter mean.

Davies, 2026-09-25: LASTUP is void. Its other trade was the same-day short.
A losing short is not the control for a long. UNDER and STALE are not taken
out of sample. UNDER cleared its other trade by 4.2411 bps and STALE by
0.6983 bps, the same class as PICK, and neither is a testing row. FASTER,
BACK, INUP and LEDSP have negative means and are not taken out of sample.
The next eight are not frozen until this test is recorded.

The buy and the sell are not moved. A nearby signal is not substituted. The
hold stays twenty-one days on both trades. Equals go to neither. The null is
not this long with the louder comparison turned off, and it is not every
twenty-one-day long.

## What was seen

The 2023 screen, the book above, and the code that reproduces the screen.
No daily open from 2024-01-01 onward has been read as an entry.

## Rule

Unchanged from the protocol. The reproduction check is what shows it did not
move. `docs/agents/scripts/fp268/common.py` stays the file the screen hashed.

* The absolute three-day spot return that just finished is strictly larger
  than the absolute three-day spot return that ended three days earlier.
  The four closes have already printed. A missing day is not a signal and
  is not filled in. An equal absolute move is neither trade.
* Enter the next BTCUSDT perpetual daily open and sell the open twenty-one
  days later. $100 notional. One USDT leg. Spot is the signal only. It is
  not a second leg. Funding cash is not added.
* The other trade buys the BTCUSDT perpetual daily open on a day when the
  recent absolute return finished strictly smaller, and sells the open
  twenty-one days later. A day counts only when that contract's own entry
  open and exit open both exist. A missing open is not taken from spot.
* The entry day's open is the fill. The entry day's close is not an input.
* Fee on each leg: 10 bps a side plus the USDT half-spread above, on each
  side. Doubled costs are 20 bps a side plus that same half-spread, once.
  The spread is not doubled.

## Windows

A trade belongs to the window of its entry. The exit is the open twenty-one
days later.

* Reproduction, not the bar: entries in 2023, at the screen's fee with no
  spread. Must come back as 170 trades and +$1021.9923 within one cent. The
  mean must come back as +601.172 bps. The quieter set must come back as
  175 trades, mean +529.6739 bps, house p95 +551.9241 bps on samples of 170.
  If it does not, this run is invalid and is not a pass.
* OOS1: entries on [2024-01-01, 2025-01-01). An exit open in the first days
  of 2025 is an exit.
* OOS2: entries on [2025-01-01, 2026-09-05). The last entry is 2026-09-04.
  The exit is the open on 2026-09-25. A bar on 2026-09-25 is not an entry.
  A bar on 2026-09-26 is not requested.
* A close after 2026-09-03 is not a signal. Spot is stored through the
  2026-09-03 close. The USDT book is stored through the 2026-09-25 open
  because that open is an exit.

## Null

The quieter twenty-one-day USDT long. Every null hold is twenty-one days.
The two sets do not share an entry. The cutoff is 1,000 draws without
replacement, seed 20260925, index `floor(0.95 × 1000) = 950`, of samples of
this rule's count from the quieter pnl. It is that sample p95. It is not
the quieter set's own mean, including when the quieter set is longer. When
the quieter set is shorter than the rule, the cutoff is missing and this
bar fails. The missing cutoff is not replaced with the quieter mean. The
rule's mean OOS pnl must be strictly above the cutoff.

## The bar, all of them

The 2023 gap does not relax any line. UNDER's 4.2411 bps and STALE's
0.6983 bps are the few-bps class this bar refuses.

1. OOS total > 0, and OOS1 > 0, and OOS2 > 0.
2. The OOS mean beats the sample p95. It does not beat the quieter mean
   instead.
3. Doubled-cost OOS total > 0.
4. At least 30 OOS trades.
5. No entry-month is more than 40% of the OOS total, and the total without
   the best month is > 0.
6. The OOS total on the $100 it locks, annualised over the 998 UTC days from
   2024-01-01 to 2026-09-25, exceeds 4%.
7. The OOS mean net clears that sample p95 by strictly more than 10 bps.
   Ten bps on the locked $100 is a mean-pnl gap strictly above $0.10. A
   gap of 10 bps or less voids the rule even when the other lines pass.

## What a pass would mean

A pass is a research record. It does not arm a testing row. The fill is a
Binance daily open, not a price this account can get. A fail, or a mean
that clears the cutoff by 10 bps or less, is the end of this rule. The buy
and the sell are not moved. The next eight are not frozen by this file.
LS-FADE's 60-trade reproduction, the control, doubled costs, and the rule
that no month is above 40% of the profit are not relaxed.
