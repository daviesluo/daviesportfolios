# Pre-registration: FDCSH, funding cash on a hedge (fp334)

Written 2026-09-25 after the 2023 screen and before any later-year return
of this rule was computed. Frozen by the sha256 in
`2026-09-25-fp334-prereg-fdcsh.sha256`. No TRB bar from 2024-01-01 onward
has been read as an entry. PEPRM's 2023 mean is negative and is not in
this file. SPQTR is a different mechanism and is not in this file.

## Why this one

The screen in `2026-09-25-fp334-protocol.md` scored the funding cash.
FDCSH passed: 85 trades on 36 entry days, mean net +88.5634 bps after
forty basis points of fills, total +$75.2789 on $100 a package. The
other trade is the same package when the completed-interval premium is
not 50 bp cheap: 815 packages, mean −38.3963 bps. The cutoff is the
house p95 of samples of 85, −36.9061 bps, not that mean. The gap is
125.4695 bps, strictly more than 20 bps. Median cash +105.9454 bp.
Median exit cash 0.

PEPRM's mean is −30.847 bps. It is not taken out of sample.

The legs are not moved. The −50 bp line is not lowered. A second symbol
is not pooled in. The coin's open-to-open move is not added. A negative
rate stays cash paid to the long, not a reason to be long the coin. The
null is not the opposite side.

## What was seen

The 2023 screen and the code that reproduces it. The August 2026 funding
file answers 200 and the September 2026 funding file answers 404. The
September file was not downloaded. No open from 2024-01-01 onward has
been read as an entry.

## Rule

Unchanged from the protocol. `docs/agents/scripts/fp334/common.py` stays
the file the screen hashed (`642ecd7b…`).

* The package is long the TRBUSDT perpetual and short TRB spot across
  one settlement. Gross is the cash credited to the long, the funding
  rate times −1. The exit cash is 0. The coin's move is not added.
* The print is not the signal. The signal is the average premium of the
  completed hours of this interval only. An eight-hour settlement uses
  seven hours. A four-hour settlement uses three. The entry hour is not
  included. The premium index is not read.
* The signal is on when that average is −50 bp or lower.
* The entry is the open one hour before the settlement. The exit bar is
  the open one hour after, so the hedge can be closed. That later price
  is not in the result. A missing hour is neither trade.
* Fee: ten basis points a fill, four fills, forty basis points. Doubled
  costs are twenty basis points a fill, eighty on the package. The
  entries must not move when the fee is doubled.
* The other trade is the same package when the interval premium is not
  50 bp cheap.

## Windows

A trade belongs to the window of its entry.

* Reproduction, not the bar: entries in 2023, at forty basis points.
  Must come back as 85 trades, 36 entry days, and +$75.2789 within one
  cent. The mean must come back as +88.5634 bps. The edge-off set must
  come back as 815 trades, mean −38.3963 bps, house p95 −36.9061 bps on
  samples of 85. If it does not, this run is invalid and is not a pass.
* OOS1: entries on [2024-01-01, 2025-01-01).
* OOS2: entries on [2025-01-01, 2026-09-01). The last entry that can be
  requested is 2026-08-31 23:00 UTC. A bar on 2026-09-01 is not
  requested. A settlement whose exit hour is not in the August 2026 file
  is neither trade. The span from 2024-01-01 to 2026-09-01 is 974 days.

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
