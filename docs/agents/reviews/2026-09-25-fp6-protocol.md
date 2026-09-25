# fp6 protocol: the next Binance search, after LS-FADE failed (2026-09-25)

Written before any return of these rules was computed. LS-FADE failed the test
frozen in `2026-09-25-fp5-prereg-ls-fade.md`. That rule is dead. Its threshold
is not reused, and it is not widened to another coin. The other fourteen rules
in the fp5 protocol stay dead, including every one that failed the 2023 screen.

The screen below is the only measurement this file allows. A rule that fails it
is dead. A rule that passes it is not adopted: it gets its own pre-registration,
committed before any later year is scored. 2023 is spent once this screen runs.

Nothing here changes a frozen spec, arms a row, or sends an order. Public reads
only. The fill is `docs/agents/scripts/fp5/common.py` `net_return`: buy the open
at 10 bps above it, sell the later open at 10 bps below it. This search does
not keep a second copy of that formula.

## What this search will not run

Everything the fp5 protocol already refused, plus these, which are the same
family as a rule that already has a number:

* The spot kline's taker-buy share. The futures taker ratio failed the fp5
  screen. This is that family on another tape.
* A sign flip of a failed fp5 rule (funding, open interest, long/short,
  ETH/BTC, fear-and-greed, the perp premium).
* A lower fear cut, a lower premium cut, or a lower trade count than the one
  that failed.
* Buying a dip because the last bar fell. Volume-climax, the plain drop, and
  cascade bids already priced that family.
* Time-series trend. The live 4-hour row is that family.
* A short that would need the perpetual. Positive funding as a short is out
  of scope for the same reason cash-and-carry is.
* Spot versus the index at 10 bps. The fp5 screen already found the mark,
  which embeds the spot basis, never 10 bps under the index. The same cut on
  the spot-index gap is that empty family.

## Costs, window, null

Ten basis points a side. No spread on this screen. Entries in
`[2023-01-01, 2024-01-01)` UTC. History used to build a threshold may start on
2022-10-01. A price after 2024-01-02 00:00 UTC is a bug and the scorer refuses
it. The 2024-01-01 open may be an exit print only.

The null is fp5's: 200 draws, seed `20250925`, without replacement, cutoff at
index `floor(0.95 × 200) = 190`. The pool is every in-screen hold of the same
length on the same symbol the rule trades.

A pass is all of: at least 30 trades, mean net above zero, and mean net above
that rule's null cutoff. The count stays 30. A rare event does not get a
lower count after the screen is seen.

## The ideas, parameters fixed

1. **USDC-CHEAP.** USDCUSDT. The daily close is strictly below 0.998 (one
   round trip under par). The comparison is `Decimal` of the two printed
   numbers, so a close of exactly 0.998 does not fire. Enter the next daily
   open, hold one day. A missing day is a skip.
2. **BTCUSDC-GAP.** The same UTC day has a BTCUSDC close and a BTCUSDT close,
   and BTCUSDC / BTCUSDT − 1 is strictly below −0.002, again as `Decimal` of
   the printed closes. Enter BTCUSDC at the next daily open, hold one day. A
   day missing either close is a skip. This is a one-leg dislocation, not a
   three-leg triangle (those died on the fee).
3. **FUND-GAP.** At a Binance BTCUSDT funding settlement, subtract Deribit's
   BTC-PERPETUAL `interest_8h` at the same timestamp. Deribit rows that are
   not exactly on an 8h boundary are dropped, not shifted. A settlement with
   no Deribit row at that timestamp is a skip. The difference is below its own
   trailing-90-day 10th percentile, with at least 90 earlier prints, strictly
   before the settlement. The percentile is `sorted[floor(0.10 × (n − 1))]`.
   Enter the BTCUSDT spot open one 8h bar later. Hold one 8h bar. This is a
   cousin of FR-OWN, which died on the fp5 screen. The history length and the
   lag are FR-OWN's, so the only new piece is the Deribit residual. A pass
   still has to clear a later pre-registration, and that pre-registration has
   to require the rule to beat FR-OWN itself on the same later window.
4. **MONDAY.** BTCUSDT. Enter the Monday 00:00 UTC open, exit the Tuesday
   00:00 UTC open. Monday is the first UTC weekday after the weekend. No
   other weekday is a candidate. The scorer also prints Tuesday through
   Sunday, so a better day is not hidden, and those six numbers are spent:
   none of them can be chosen later, even if one of them clears the hurdle.
5. **QUIET.** BTCUSDT. The day's range `(high − low) / open` is strictly below
   its own trailing-90-day 10th percentile, at least 90 earlier days. Enter
   the next daily open, hold one day. This is a cousin of the cross-sectional
   low-volatility rule in §3.25, which failed. The upper tail is not scored.

## What a pass becomes

The same house bar as the LS-FADE pre-registration: both later sub-windows
positive, above a fresh null, positive with doubled costs, at least 30 trades,
no month above 40% of the profit and the rest positive, and more than 4% a
year on the $100 it locks, on entries from 2024-01-01 through 2026-09-24.
2023 is not part of that bar. Neighbours, where the rule has a quantile, are
a veto that can only reject. If nothing here passes the screen, these five
rules are dead and the next search does not inherit their cuts.
