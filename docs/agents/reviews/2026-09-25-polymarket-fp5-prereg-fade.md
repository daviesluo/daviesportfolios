# Pre-registration FADE: a six-hour move in the near-even Bitcoin strike, taken the other way (fp5, test FADE)

Written 2026-09-25 (UTC) before any historical price at a decision time, any entry print or any return of this
rule was read or computed. Frozen by the commit that adds this file. Nothing below may change after that
commit; a deviation is reported as a deviation.

`fade_test.py` is the rule. `fade_inputs.py` only assembles the inputs the rule names. The test reads the
committed input and nothing else.

## Why this is not a rule already killed

VOL bought the cheap side of the at-the-money strike against a volatility model, and lost. This rule does
not read a spot or a volatility. ROUND bought a $10,000 strike when it sat off the straight line through
its two neighbors, and lost on both sides. This rule does not read a neighbor. COPY and the undated
leaderboard are other people's trades; this rule does not read a wallet. The band below chooses which
strike is the live one. It is not FAV's claim that 0.40–0.60 is underpriced, and the sign is not FAV's
sign flipped: the entry is the side a six-hour move made cheaper, not a standing longshot.

Two ideas die here on arithmetic and are not run. A day's drift on the crypto up/down market does not
clear 1.75¢ at 50¢, which is the same fee that killed funding-as-drift and the daily up/down in the
ROUND pre-registration. Fading the hourly, 15-minute, 5-minute or 4-hour crypto up/down is not opened:
fp4's M3b measured the price history there lagging the prints by about 12¢, so a fade against that
history is a fade of the lag, and the model already lost 2.8¢ a share at the prints.

## What was seen before the freeze (disclosed)

* fp4's verdicts and fp5's VOL, COPY and ROUND results. None is an input.
* The May 1 ladder's question text, already disclosed for VOL and ROUND: 11 markets, every $2,000. No
  price from that reply was kept, and no six-hour move on any day was read.
* VOL's capability check: prices-history and `/trades` accept a time bound; `/v2/trades` does not, and is
  not used.

No parameter below was chosen from a return.

## Universe

Events in series 45, closed, `endDate` in [2025-01-01, 2026-09-11), slug
`bitcoin-above-on-<month>-<day>` or `bitcoin-above-on-<month>-<day>-<year>`, one event per UTC day, the
lowest slug. Markets whose outcomes are not exactly `["Yes","No"]` are skipped. The strike is the dollar
amount in "above $K". A repeated strike keeps the lower condition id.

## Rule

* Decision time `T_d = endDate − 16 h`. The earlier time is `T_e = T_d − 6 h`. Six hours is the lag. It
  is not moved after the result.
* Shown YES price: the last 1-minute history point of the YES token at or before `T_d`, and not more than
  30 minutes before. The earlier YES price is the same reading at `T_e`. Shown NO is `1 −` the shown YES
  price. The earlier price is a history point. A history point can kill a rule; it cannot pass one. The
  fill is still a taker print.
* The strike is the one whose shown YES price lies in [0.40, 0.60] and is closest to 0.50. A tie takes
  the lower strike, then the lower condition id. A price outside the band is not a candidate. No strike
  in the band → no trade. The band is not widened after the result.
* Tick: the market's, else 0.01. Fee rate: the market's `feeSchedule.rate` when it is positive, else 0.07.
  Fee at `p` is `rate × p × (1 − p)` a share.
* Buy YES when the earlier YES price still has edge one tick through the shown YES price, after the fee
  (the price fell by more than the fee and one tick). Buy NO when `1 −` the earlier price still has edge
  one tick through the shown NO price (the price rose by more than the fee and one tick). Both, or
  neither → no trade. The sign is fade, not follow. It is not flipped after the result.
* The fair value in the fill walk is the earlier YES price when buying YES, and `1 −` that price when
  buying NO.
* Entry: a marketable buy of that token, $10 of cost. Fills come from taker prints in `(T_d, T_d + 60 min]`,
  in time order. A BUY of the token, or a SELL of the other token (this token at one minus that price).
  The fill price is the maximum of the print and the shown token plus one tick. A print whose fill price is
  above 0.99, or whose edge at that price is not positive, is skipped. Less than $2 of fill → no trade.
  One tape print is used up to its size.
* Hold to `outcomePrices`. Capital locks from the first fill until the market's `closedTime`, else
  `endDate`. One trade per event.

A picked strike whose print pages hit the cap (6 pages of 500) is incomplete. One incomplete tape means
the test cannot pass, whatever the sign of the partial sum.

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

`fade_test.py --self-check` must pass on the frozen file. Shown prices 0.42, 0.48 and 0.70 pick 0.48.
An equal distance picks the lower strike. 0.39 is not selected. A move from 0.50 to 0.495 does not
trade. A move from 0.50 to 0.40 buys YES. A move from 0.50 to 0.62 buys NO.

The hand YES fill: earlier 0.50, shown 0.40, the only price in the band, one BUY of YES at 0.39, which
floors to the shown price plus one tick, 0.41. Stake $10, payout 1, fee rate 0.07. P&L 13.977244, which
is what `--self-check` prints. The hand NO fill uses a single market shown at 0.60, earlier 0.48, and
one BUY of NO at 0.30, which floors to 0.41. An incomplete tape cannot pass. An empty book cannot pass.
A stored pick the rule would not make is a pull error.
