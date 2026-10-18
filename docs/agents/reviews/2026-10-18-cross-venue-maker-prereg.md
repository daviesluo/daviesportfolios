# XV-1: a Revolut X maker hedged on Coinbase, read offline (pre-registration DRAFT, 2026-10-18)

**DRAFT, NOT FROZEN.** Nothing here runs, and no date in it binds, until Davies says to freeze it and the transfer costs in §4 are
filled in from the venues' own fee pages. Written from CBBOOKS-1 (`reviews/2026-10-18-coinbase-books-study.md` §4, rank 2), which
found the idea in sample on 2026-10-10 → 10-18 (not blind; that span is excluded from this window).

## 1. The question

Does a resting Revolut X order priced off Coinbase's touch, hedged at once on Coinbase, make money after both venues' fees AND the
cost of moving the coins it accumulates back, over four weeks it has not seen?

## 2. The rule (as `backtests/cbbooks/scripts/cross.py`, Q4 (ii), with m fixed)

- Inputs: Revolut X's prints and Coinbase's book reads only (no Coinbase prints are needed; `cb_print_minutes`, `0132`, is
  there for the fill checks).
- Books: USDC-GBP and USDT-GBP. At every Revolut X print (`agent_quote_prints`, side = the aggressor's), the standing Coinbase read
  (`cb_book_levels`, the latest row at or before the print, at most 3 minutes old) prices a Revolut X bid at
  floor(Coinbase best bid × (1 − 0.000045 − 0.0010), 0.0001) and an ask at ceil(Coinbase best ask × (1 + 0.000045 + 0.0010), 0.0001).
- A print strictly below the bid (a seller) fills the bid; strictly above the ask (a buyer) fills the ask; for min(£100, 10 % of that
  minute's Revolut X printed pounds); at most once a minute a side.
- The hedge: the coins are sold (bought) on Coinbase at the best bid (ask) of the first Coinbase read after the print, paying 0.0045 %.
- Transfers: at each Monday 00:00 UTC the week's net coins are moved from the venue where they accumulated back to the other, and the
  week's net pounds the other way, each charged the cost in §4. A week with nothing to move costs nothing.
- Revolut X maker fee 0 %; Coinbase taker fee 0.0045 % (its stable-pair schedule, the same at every tier).

## 3. Window and reading

- Window: 2026-10-18 03:00 UTC → 2026-11-15 03:00 UTC (28 days, four weekends).
- Read on 2026-11-15 from 04:00 UTC and **before 2026-11-19 00:00 UTC**: `cb_book_levels` is kept 35 days (`0114`), so the window's
  first day is pruned from about 11-22. Pull with `backtests/cbbooks/sql/pull_books.sql` (two products, as many parts as needed) and
  `sql/pull_revx.sql` with the window's dates; run a copy of `cross.py`'s Q4 (ii) with m = 10 bps and §2's transfers, committed
  before the window ends.
- Void if either recorder misses more than 5 % of the window's minutes.

## 4. Costs to fill in before freezing (from the venues' own pages, quoted with the date read)

Davies is considering opening a Coinbase account (2026-10-18); these are read from the venues' own pages (or his account
screens) on the date given, never estimated. Every coin row is needed per network the venue offers; the cheapest network both
venues share is the one the rule charges.

| leg | coin / currency | network | fee (fixed + %) | minimum | typical time to arrive | read on | source |
|---|---|---|---|---|---|---|---|
| Revolut X withdrawal | USDC | TO READ | TO READ | TO READ | TO READ | | |
| Revolut X withdrawal | USDT | TO READ | TO READ | TO READ | TO READ | | |
| Coinbase deposit | USDC | (as above) | TO READ | TO READ | TO READ (confirmations) | | |
| Coinbase deposit | USDT | (as above) | TO READ | TO READ | TO READ (confirmations) | | |
| Coinbase withdrawal | GBP (Faster Payments) | — | TO READ | TO READ | TO READ | | |
| Revolut X deposit | GBP | — | TO READ | TO READ | TO READ | | |
| Revolut X ⇄ Revolut app | GBP / coins, if the route goes through the app | — | TO READ | — | TO READ | | |

The weekly round the rule charges: one coin transfer Revolut X → Coinbase per book with flow and one pound transfer Coinbase →
Revolut X, each at its fixed fee plus its percentage. Transfer time sets how much of each venue's balance the rule needs in hand
(at least a week's flow plus the days in transit).

If a week's round of transfers costs more than about 5 bps of a week's flow at the in-sample rate (about 600–1,300 coins a day a
book), the test is dead before it starts and is not frozen.

## 5. Bars (all must hold)

1. Pounds a day after transfers above 0, with the 90 % lower bound of a 2,000-draw bootstrap of whole UTC days (seed 20261115) above 0,
   both books summed.
2. At least one fill a day on average on each book.
3. No UTC day below −£1.
4. No single day more than 40 % of the window's total.

## 6. What a pass allows, and what it does not

A proposal to Davies, nothing more: a live version would need his Coinbase account and a key he makes himself, a hedging order path
that does not exist, and a decision on how it shares Revolut X's books with PR5's LIVE (it would quote ahead of LIVE's rungs). It is
never run in the loop's Revolut X account or in PR5's sub-account (key `_2`), and nobody trades by hand in either.

## 7. Known limits

The through rule is conservative where our order would have been Revolut X's best price; the hedge assumes the Coinbase touch holds
the size (it held thousands of coins in sample); a fill's own effect on later prints is not modelled; transfer times are not modelled.
