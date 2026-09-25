# fp5 round of 2026-09-25, rules killed on arithmetic before a return

Written with the freezes for HITS, POISSON and PACE. None of the five below is run. A price is not an input.

## OVER — an overlapping week does not force a bracket to zero

Two Elon weeks overlap, so the tweets already posted in the overlap are in both totals. That would be an
arbitrage only if the days that are in just one week could not reach the next bracket. They can. The
public event index for 25–27 June 2026 is 58 posts in two days, and the weekly brackets are 20 wide
(0–19, 20–39, …) with one listing 30 wide. Fifty-eight is larger than either width. The part of a week
that does not overlap the next one is several days. No bracket is forced to zero, and there is nothing
for the fee to be smaller than.

## MIRROR — buying the dearest bracket because it is the dearest

The fair value in that sentence is the price itself. One tick through the shown price, plus
`rate × p × (1 − p)`, is a negative edge at every price in (0, 1). The rule never trades. It is not
FAV: FAV bought 0.90–0.99 a day before the end and was run. This one has no entry.

## QUEUE — quoting a geopolitics book because the taker fee is zero

Geopolitics is the schedule with rate 0. A resting bid would earn the spread and pay no taker fee. The
public tape is a price history and taker prints. It does not say where a new bid would have stood in the
queue, so a fill cannot be built from it. fp4 recorded a live book to score rewards; that recorder is
not a backtest of this quote, and this quote is not run.

## GRID — a second binning of the same week

A coarser bracket has to equal the sum of the finer brackets it covers. Series 10000 has a second grid
on five weeks, titled higher, lower, or 30-wide: the weeks ending 14 Feb, 21 Mar, 11 Apr, 8 Aug and
15 Aug 2025. The weeks that only repeat the same title (7 Feb 2025, and 26 May 2026 for both Elon and
Trump) are not a second grid. Every second grid ends in 2025. The out-of-sample population is zero, so
the 80-trade condition cannot pass. Not run.

## TAIL — buying NO on a bracket that rarely wins

When the YES price is a few cents, the NO price is 0.90–0.99. That is FAV's entry, which failed
(favourites won 95.1 % at 96.3¢). It is not reopened.
