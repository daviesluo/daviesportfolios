# Pre-registration ROUND: a $10,000 Bitcoin strike against the two beside it (fp5, test ROUND)

Written 2026-09-25 (UTC) before any historical price at a decision time, any entry print or any return of this
rule was read or computed. Frozen by the commit that adds this file. Nothing below may change after that
commit; a deviation is reported as a deviation.

`round_test.py` is the rule. `round_inputs.py` only assembles the inputs the rule names. The test reads the
committed input and nothing else.

## Why this is not a rule already killed

VOL bought the cheap side of the at-the-money strike against a volatility model, and lost. This rule does not
read a spot, a volatility index or a digital. It asks whether a round strike — a multiple of $10,000 — is
priced off the straight line through the strike below it and the strike above it by more than the taker fee
and one tick. COPY and the undated leaderboard are other people's trades; this rule does not read a wallet.
FAV's favourite and longshot bands are not the entry. The daily up/down drift and an equity "hit this week"
digital are not opened: a day's drift does not clear 1.75¢ at 50¢, and M6's near-dated ladder gaps were
0.02¢.

## What was seen before the freeze (disclosed)

* fp4's verdicts and fp5's VOL and COPY results. Neither is an input.
* One event, `bitcoin-above-on-may-1`, for the question text only. It has 11 markets, worded "Will the price
  of Bitcoin be above $K on May 1?", strikes every $2,000 from $68,000 to $88,000. No price from that reply
  was kept. The $10,000 modulus is the round number, not a fit to that spacing; $70,000 and $80,000 sit on
  the grid, which is why a round strike can have a neighbor on each side. The modulus is not moved to $2,000
  or $5,000 after seeing the grid.
* VOL's capability check: prices-history and `/trades` accept a time bound; `/v2/trades` does not, and is
  not used.

No parameter below was chosen from a return.

## Universe

Events in series 45, closed, `endDate` in [2025-01-01, 2026-09-11), slug
`bitcoin-above-on-<month>-<day>` or `bitcoin-above-on-<month>-<day>-<year>`, one event per UTC day, the
lowest slug. Markets whose outcomes are not exactly `["Yes","No"]` are skipped. The strike is the dollar
amount in "above $K". A repeated strike keeps the lower condition id.

## Rule

* Decision time `T_d = endDate − 16 h`.
* A candidate is a strike that is a multiple of 10,000 and is not the lowest or the highest strike on that
  event. Its neighbors are the adjacent strikes in that list, not a further strike skipped because a price
  is missing.
* Shown YES price: the last 1-minute history point of the YES token at or before `T_d`, and not more than
  30 minutes before. Shown NO is `1 −` that price. Any of the three shown prices missing, or the
  interpolated price not strictly between 0 and 1 → no trade.
* Interpolated YES price: the straight line in the strike from the neighbor below to the neighbor above.
* Tick: the market's, else 0.01. Fee rate: the market's `feeSchedule.rate` when it is positive, else 0.07.
  Fee at `p` is `rate × p × (1 − p)` a share.
* Buy YES when the interpolated price still has edge one tick through the shown YES price, after the fee.
  Buy NO when `1 −` the interpolated price still has edge one tick through the shown NO price. Both, or
  neither → no trade.
* Entry: a marketable buy of that token, $10 of cost. Fills come from taker prints in `(T_d, T_d + 60 min]`,
  in time order. A BUY of the token, or a SELL of the other token (this token at one minus that price).
  The fill price is the maximum of the print and the shown token plus one tick. A print whose fill price is
  above 0.99, or whose edge at that price is not positive, is skipped. Less than $2 of fill → no trade.
  One tape print is used up to its size.
* Hold to `outcomePrices`. Capital locks from the first fill until the market's `closedTime`, else
  `endDate`.

A round strike whose print pages hit the cap (6 pages of 500) is incomplete. One incomplete tape means the
test cannot pass, whatever the sign of the partial sum.

## Windows and the bar

Windows are by `endDate`. IS is [2025-01-01, 2026-01-01), reported, and nothing is chosen there. OOS1 is
[2026-01-01, 2026-06-01). OOS2 is [2026-06-01, 2026-09-11). The year-fraction uses 253 days, the length of
2026-01-01 to 2026-09-11.

The six conditions, all required, on OOS = OOS1 ∪ OOS2:

1. Out-of-sample P&L positive, and both halves positive.
2. Above the 95th percentile of 10,000 draws (seed 20260925) of a Bernoulli at the fill price, index
   `floor(0.95 × 10000)`, fees left on.
3. The same shares one tick worse and fees doubled, book not re-walked, still positive.
4. At least 80 out-of-sample trades.
5. No calendar month of the entry above 40 % of the out-of-sample P&L, and the total without that month
   still positive.
6. Annualised on the peak capital tied up in the window, above 4 % a year.

## Pin, before the historical run

`round_test.py --self-check` must pass on the frozen file. Strikes 90,000 / 100,000 / 110,000 shown at
0.60 / 0.55 / 0.40 interpolate to 0.50, so the rule buys NO. The hand fill is $10 at 0.46 (the shown NO
plus one tick), payout 1, fee rate 0.07: P&L 11.36113. A price that sits on the line does not trade. A
strike that is not a multiple of 10,000 does not trade. An end strike does not trade. An incomplete tape
cannot pass. An empty book cannot pass.
