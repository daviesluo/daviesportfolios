# Pre-registration POST: the historically likely bracket, when a post-count ladder opens flat (fp5, test POST)

Written 2026-09-25 (UTC) before any opening price of a bracket, any entry print or any return of this rule
was read or computed. Frozen by the commit that adds this file. Nothing below may change after that
commit; a deviation is reported as a deviation.

`post_test.py` is the rule. `post_inputs.py` only assembles the inputs the rule names. The test reads the
committed input and nothing else.

## Killed on arithmetic in this round, and not run

**A price gap between Polymarket and Betfair is not a testable arbitrage here.**

* Betfair's own historical exchange files are a purchased package. The download API wants a session token.
  That is not a keyless source.
* The free football CSV (football-data.co.uk) is one closing price per match. It is not a book at a time
  you can hit, and it is not the same contract: Polymarket pays 50-50 on a postponed game, and Betfair voids
  on its own rules.
* One leg, bet because the other venue's close differed, is an information bet. fp4's S5 already called
  that out for Kalshi and Betfair, and B13 already called sports-versus-a-bookmaker untestable without a
  keyless odds feed. Neither is reopened. A locked arb has to clear Polymarket's sports taker fee (0.75¢
  to 1.25¢ a share at 50¢) and Betfair's commission on winnings, on both books at the same moment. There
  is no keyless tape of that moment.

## Why POST is not a rule already killed

FAV bought the 0.90–0.99 side late and lost. This rule buys one bracket of a count ladder at the open,
and only the bracket past windows of the same length landed in most often. VOL, ROUND and FADE read the
Bitcoin ladder. COPY reads wallets. B11 (mentions: what a speaker will say) is decided in seconds and is
not this. B15 (a new listing with no fair value) is not this: the fair value is the hit rate of the
bracket on windows that had already resolved.

The daily Elon series mixes "25+ times on Wednesday" with calendar months. It is not the interval ladder,
and it is not in the universe.

## What was seen before the freeze (disclosed)

* fp4's verdicts and fp5's VOL, COPY, ROUND and FADE results. None is an input.
* The shape of two series, with no price kept. Series 10000, "Elon Tweets", 180 closed events, titles
  "May 31 - June 7" through "September 15 - September 22, 2026". One event,
  `elon-musk-of-tweets-september-23-september-30`, has 30 brackets from 0-19 to 580+, outcomes
  `["Yes","No"]`, and on that 2025 event the fee flag was off. A 2026 bracket on the same series had
  culture fees on, rate 0.05, exponent 1, taker only, tick 0.001. Series 11108, "Trump Truth Social",
  65 closed events from February 2026, the same kind of weekly title. No opening price and no hit rate
  was read.

No parameter below was chosen from a return.

## Universe

Closed events in series 10000 and series 11108 with `endDate` before 2026-09-11, including 2024 so a
2025 window has priors. A title that does not parse to a span of days is stored and never traded.
Markets whose outcomes are not exactly `["Yes","No"]`, or whose question is not a bracket
(`200-219` or `580+`), are skipped. An event is one slug.

## Rule

* Decision time `T_d = startDate + 1 h`. Exit clock `T_x = endDate − 24 h`.
* Shown YES at a clock time: the last 1-minute history point of the YES token at or before that time,
  and not more than 30 minutes before. The earlier price and the exit price are history points. A
  history point can kill a rule; it cannot pass one. The fill is a taker print.
* Priors: the same series and the same title span in days, whose `endDate` is at or before `T_d`, and
  whose winning bracket paid at least 0.99. The winner's place on the count is the middle of its
  bracket, or the threshold itself for an open-ended bracket. Fewer than 8 priors → no trade.
* Each current bracket's historical rate is the fraction of those winners that land inside it. The
  bracket with the highest rate is the candidate. A tie takes the lower count, then the lower condition
  id. A rate of zero is not a candidate.
* The open is flat when at least two brackets have a shown price, the live ones are those at or above
  the greater of 0.02 and half the highest shown price, there are at least two live brackets, and the
  highest live price minus the lowest live price is at most 0.03. The candidate has to be live. Otherwise
  no trade. 0.03 is the reading of "the intervals are close". It is not widened after the result.
* The candidate's rate has to clear one tick through its shown price after the fee. Fee rate is the
  market's `feeSchedule.rate` when fees are enabled, exponent 1, else 0.05 when the rate is missing; a
  market with fees off pays 0. A fee exponent other than 1 drops that market. Fee at `p` is
  `rate × p × (1 − p)` a share. Tick is the market's, else 0.001.
* Entry: a marketable buy of YES, $10 of cost, taker prints in `(T_d, T_d + 60 min]`. The fill price is
  the maximum of the print and the shown price plus one tick. A print above 0.99, or with no edge against
  the historical rate, is skipped. Less than $2 of fill → no trade.
* Exit: only when `T_x` is after `T_d` and the shown YES at `T_x` is above the shown YES at `T_d`. Sell
  YES into taker prints in `(T_x, T_x + 60 min]`. The fill is the minimum of the print and the shown exit
  price minus one tick, and a fill at or below the entry price is skipped. Shares that do not sell are
  held to `outcomePrices`. A shown price that did not rise is held. There is no second exit rule.
* Capital locks from the first fill until the last sell if the position is closed, else until the
  market's `closedTime`, else `endDate`.

An entry tape or an exit tape that hits the page cap (6 pages of 500) is incomplete. One incomplete tape
means the test cannot pass.

## Windows and the bar

Windows are by `endDate`. IS is [2025-01-01, 2026-01-01), reported, and nothing is chosen there. OOS1 is
[2026-01-01, 2026-06-01). OOS2 is [2026-06-01, 2026-09-11). Events before 2025 stay in the file as priors
and are not scored. The year-fraction uses 253 days.

The six conditions, all required, on OOS = OOS1 ∪ OOS2:

1. Out-of-sample P&L positive, and both halves positive.
2. Above the 95th percentile of 10,000 draws (seed 20260925), index `floor(0.95 × 10000)`. Shares already
   sold keep their print. Shares still held are redrawn Bernoulli at the entry price, fees left on. A book
   with nothing left held has no settlement draw, so this condition compares the result with itself and
   does not pass.
3. The same shares one tick worse and fees doubled, book not re-walked, still positive.
4. At least 80 out-of-sample trades.
5. No calendar month of the entry above 40 % of the out-of-sample P&L, and the total without that month
   still positive.
6. Annualised on the peak capital tied up in the window, above 4 % a year.

## Pin, before the historical run

`post_test.py --self-check` must pass on the frozen file. The four weekly titles parse to 7 days, including
a year turn from December 28 to January 4. Brackets `200-219` and `580+` parse.

Eight priors all landed in 40-59. The open shows 0.04, 0.12 and 0.11, so 0.12 and 0.11 are live and 0.01
apart. The rule buys 40-59. The hand buy is a YES print at 0.10, which floors to 0.121. The shown price
at the exit is 0.20, and a YES sell at 0.25 fills at 0.199. Stake $10, fee rate 0.05. The round trip is
5.348107, which is the first number `--self-check` prints. The same buy held to a payout of 1, because
the exit shown price fell to 0.05, is 72.205128, the second number. A gap of 0.10 does not trade. Seven
priors do not trade. An incomplete tape cannot pass. An empty book cannot pass. A stored pick the rule
would not make is a pull error.
