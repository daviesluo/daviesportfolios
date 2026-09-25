# Pre-registration: QNEW, a new quarterly held eleven days (fp231)

Written 2026-09-25 after the 2023 screen and before any later-year return of
this rule was computed. Frozen at 2026-09-25T11:45:09Z by the sha256 in
`2026-09-25-fp231-prereg-qnew.sha256`. The book below was read at
2026-09-25T11:45:08.701Z. No daily bar from 2024 has been requested. No open
from 2024-01-01 onward has been read as an entry. The symbols below are the
calendar, not a price.

## Why this one

The screen in `2026-09-25-fp231-protocol.md` scored one idea on 2023 only.
QNEW passed: 40 trades, mean net +761.2554 bps after 20 bps of fees, total
+$304.5022 on $100 a trade, against a null p95 of +599.9328 bps (200 draws,
seed 20250925). The null pool was the same eleven-day long on every later
day of that contract, the age filter off. This file is the test that decides
whether that pass was the year.

The hold stays eleven days. The null hold stays eleven days. A shorter pool
is not this test. The three 2023 symbols stay the screen's list. Their first
fourteen days are inside 2023, so leaving the list there would score no
entry from 2024. The same listing rule, applied to later last Fridays, is
frozen here before any of those opens is read.

fp225 through fp230 and fp232 are not this test. MTH is void and is not
rerun. Nothing in the dead rules is retuned.

## What was seen

The 2023 screen, the live quarterly book at this freeze (`bookTicker`
BTCUSD_261225, bid 85644.4, ask 85685.6, half-spread 0.0002404716045059922),
and the code that reproduces the screen. The half-spread is
`(ask − bid) / (ask + bid)`. BTCUSD_260925 was read the same morning and
printed bid 0.0, ask 0.0, at 2026-09-25T08:06:14.215Z. That is the expiry
print. It is not this spread. BTCUSD_PERP was not used for this spread.
BTCUSDT was not read for this spread. BTCUSD_261225 lists on 2026-09-25. It
is not an entry and its daily bars are not requested. No daily open from
2024-01-01 onward has been read as an entry.

## Rule

Unchanged from the protocol. The reproduction check is what shows the 2023
list did not move. `docs/agents/scripts/fp231/common.py` stays the file the
screen hashed. The later rows live only in this file.

* Listing midnight is the previous quarterly's expiry. Expiry is the last
  Friday of March, June, September or December, at 00:00 UTC. The symbol is
  `BTCUSD_` plus the expiry as `YYMMDD`. The position is the most recently
  listed of those contracts.
* Buy during ages 0 through 13 after that listing, and sell the open eleven
  days later. The sale is strictly before that contract's expiry. $100
  notional. One leg. The perpetual is not a second leg. Funding cash is not
  added. A missing bar is a skip. A missing symbol is a skip. A different
  symbol is not substituted after a file is missing.
* The March 2023 contract stays out, as it did on the screen.
* Ages 0, 1 and 2 of BTCUSD_240329 are 2023-12-29, 2023-12-30 and 2023-12-31.
  They are not 2023 screen entries, because the sale falls after 2024-01-01,
  and they are not out-of-sample entries, because the entry is before
  2024-01-01. They are not pulled into either window.
* Fee: 10 bps a side plus the half-spread above, on each side. Doubled costs
  are 20 bps a side plus the same half-spread, once. The spread is not doubled.

Listing, expiry, symbol. Timestamps are UTC midnights.

| Listing ms | Expiry ms | Symbol | Listing | Expiry |
| --- | --- | --- | --- | --- |
| 1672358400000 | 1688083200000 | BTCUSD_230630 | 2022-12-30 | 2023-06-30 |
| 1680220800000 | 1695945600000 | BTCUSD_230929 | 2023-03-31 | 2023-09-29 |
| 1688083200000 | 1703808000000 | BTCUSD_231229 | 2023-06-30 | 2023-12-29 |
| 1703808000000 | 1711670400000 | BTCUSD_240329 | 2023-12-29 | 2024-03-29 |
| 1711670400000 | 1719532800000 | BTCUSD_240628 | 2024-03-29 | 2024-06-28 |
| 1719532800000 | 1727395200000 | BTCUSD_240927 | 2024-06-28 | 2024-09-27 |
| 1727395200000 | 1735257600000 | BTCUSD_241227 | 2024-09-27 | 2024-12-27 |
| 1735257600000 | 1743120000000 | BTCUSD_250328 | 2024-12-27 | 2025-03-28 |
| 1743120000000 | 1750982400000 | BTCUSD_250627 | 2025-03-28 | 2025-06-27 |
| 1750982400000 | 1758844800000 | BTCUSD_250926 | 2025-06-27 | 2025-09-26 |
| 1758844800000 | 1766707200000 | BTCUSD_251226 | 2025-09-26 | 2025-12-26 |
| 1766707200000 | 1774569600000 | BTCUSD_260327 | 2025-12-26 | 2026-03-27 |
| 1774569600000 | 1782432000000 | BTCUSD_260626 | 2026-03-27 | 2026-06-26 |
| 1782432000000 | 1790294400000 | BTCUSD_260925 | 2026-06-26 | 2026-09-25 |

The first three rows are the screen. The screen file is not edited to add
the rest. From 2024-01-01 the active contract is never one of those three,
because BTCUSD_240329 listed on 2023-12-29.

## Windows

A trade belongs to the window of its entry. The exit is the open eleven days
later, and only if that open is strictly before the contract's expiry.

* Reproduction, not the bar: entries in 2023, at the screen's fee with no
  spread, on the three screen symbols only. Must come back as 40 trades and
  +$304.5022 within one cent. If it does not, this run is invalid and is not
  a pass.
* OOS1: entries on [2024-01-01, 2025-01-01).
* OOS2: entries on [2025-01-01, 2026-09-14). The last entry that can still
  sell before the 2026-09-25 expiry is 2026-09-13, and that sale is the open
  on 2026-09-24. A bar on an expiry midnight is not stored. A bar on
  2026-09-25 is not requested. BTCUSD_261225 is not requested.
* Each later symbol is stored from its listing through the UTC day before
  its expiry. Days the venue did not print are not filled in.

The first out-of-sample entries on BTCUSD_240329 are ages 3 through 13,
2024-01-01 through 2024-01-11. The young window of BTCUSD_260925 is
2026-06-26 through 2026-07-09.

## Null

Every day of the active contract in the OOS window whose sale eleven days
later is still strictly before that contract's expiry, same eleven-day long,
the age filter off. Same fee as the rule in that run. Every pool hold is
eleven days. 1,000 draws without replacement, seed 20260925. The cutoff is
the mean at index `floor(0.95 × 1000) = 950`. The rule's mean OOS pnl must
be above it. If the pool is shorter than the trade count, the null is absent
and this bar fails.

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
does not inherit the first-fourteen-days filter or the eleven-day hold. This
file does not arm a testing row.
