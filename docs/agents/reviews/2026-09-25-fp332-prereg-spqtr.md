# Pre-registration: SPQTR, delivery-basis change (fp332)

Written 2026-09-25 after the 2023 screen and before any later-year return
of this rule was computed. Frozen by the sha256 in
`2026-09-25-fp332-prereg-spqtr.sha256`. The 2024-03-29 quarterly open and
the spot bars through 2024-03-31 were already stored so December 2023
entries could exit. None of those bars is an entry. No other bar from
2024-01-01 onward has been read as an entry. PEPRM's 2023 mean is
negative and is not in this file. FDCSH is a different mechanism and is
not in this file.

## Why this one

The screen in `2026-09-25-fp332-protocol.md` scored the change in the
delivery basis. SPQTR passed: 125 trades, mean net +93.2947 bps after
forty basis points of fills, total +$116.6183 on $100 a package. The
other trade is the same package when the previous close basis is below
100 bp: 240 packages, mean +5.9951 bps. The cutoff is the house p95 of
samples of 125, +9.2826 bps, not that mean. The gap is 84.0121 bps,
strictly more than 20 bps. Median entry basis +130.5214 bp. Median exit
basis −1.0325 bp.

PEPRM's mean is −30.847 bps. It is not taken out of sample.

The legs are not moved. The 100 bp line is not lowered. A second coin, a
coin-margined book, or the perpetual in place of spot is not substituted.
The null is not the opposite side.

## What was seen

The 2023 screen and the code that reproduces it. The symbol prefixes
`BTCUSDT_240329` through `BTCUSDT_261225` were listed. Monthly files for
2026-09 return 404 and were not downloaded. No open from 2024-01-01
onward has been read as an entry.

## Rule

Unchanged from the protocol. `docs/agents/scripts/fp332/common.py` stays
the file the screen hashed (`85d4e03e…`).

* The basis is `(quarterly − spot) / spot` on the two opens, in basis
  points. Gross is the entry basis minus the expiry-day basis, divided
  by 10,000. The coin's move is not the result. The settlement index is
  not read.
* The signal is the previous day's closes, at least 100 bp. The entry
  open is not in the signal.
* The front contract is the soonest expiry still after the entry day,
  among the contracts listed below, and that contract must have a bar on
  the signal day, the entry day, and the expiry day. Spot must have those
  three too. A missing bar is neither trade.
* Fee: ten basis points a fill, four fills, forty basis points. Doubled
  costs are twenty basis points a fill, eighty on the package. The
  entries must not move when the fee is doubled.
* The other trade is the same package when the previous close basis is
  below 100 bp.

## Contracts

Delivery is the last Friday 08:00 UTC. The bar used is that day's 00:00
open. Each stamp below is 00:00 UTC on the date in the symbol, and that
date is a Friday. These expiries fall inside a month whose file exists:

* `BTCUSDT_240329` at `1711670400000`
* `BTCUSDT_240628` at `1719532800000`
* `BTCUSDT_240927` at `1727395200000`
* `BTCUSDT_241227` at `1735257600000`
* `BTCUSDT_250328` at `1743120000000`
* `BTCUSDT_250627` at `1750982400000`
* `BTCUSDT_250926` at `1758844800000`
* `BTCUSDT_251226` at `1766707200000`
* `BTCUSDT_260327` at `1774569600000`
* `BTCUSDT_260626` at `1782432000000`

`BTCUSDT_260925` delivers on 2026-09-25 (`1790294400000`). That month's
file is 404. The contract is not a front. `BTCUSDT_261225`
(`1798156800000`) is not a front. An entry day whose only remaining
expiry is one of those two is neither trade. The scorer does not fall
through to a contract whose expiry open is absent.

## Windows

A trade belongs to the window of its entry. The exit is the expiry-day
open, which may fall in a later window.

* Reproduction, not the bar: entries in 2023, at forty basis points.
  Must come back as 125 trades and +$116.6183 within one cent. The mean
  must come back as +93.2947 bps. The edge-off set must come back as 240
  trades, mean +5.9951 bps, house p95 +9.2826 bps on samples of 125. If
  it does not, this run is invalid and is not a pass.
* OOS1: entries on [2024-01-01, 2025-01-01).
* OOS2: entries on [2025-01-01, 2026-09-01). The last entry that can be
  requested is 2026-08-31 (`1788134400000`). A bar on 2026-09-01 is not
  requested. The span from 2024-01-01 to 2026-09-01 is 974 days.
* The 2024-03-29 open already stored for the 2023 exits may be an exit
  again. It is not an entry.

## Null

200 draws, seed `20250925`, index 190, of the edge-off package. When
that set is shorter than the rule, the cutoff is missing and the rule
does not pass. The cutoff is not replaced by that set's mean.

## Pass

Both later sub-windows positive, the whole later window positive, above
a fresh null, positive with doubled costs, at least 30 trades, no month
above 40% of the profit and the rest positive, and more than 4% a year
on the $100 it locks, over the 974 days. The later window must also
clear its own null by strictly more than 20 bps. The 60-trade
reproduction of LS-FADE is not relaxed. A pass is not a testing row.
Nothing here sends an order.
