# Pre-registration VOL: a Deribit hourly DVOL digital against Polymarket's daily Bitcoin ladder (fp5, test VOL)

Written 2026-09-25 (UTC) before any historical price at a decision time, any entry print or any return of this
rule was read or computed. Frozen by the commit that adds this file; its sha256 is recorded in the study.
Nothing below may change after the freeze; any deviation is reported as a deviation.

`vol_test.py` is the rule. `vol_inputs.py` only assembles the inputs the rule names. The test reads the committed
input and nothing else.

## Why this is Polymarket's own

Polymarket lists a daily ladder, "Bitcoin above $K on <date>", that resolves on the Binance BTCUSDT 1-minute
candle closing at noon ET. A digital that pays 1 when that close is above K is the market. Deribit's public
volatility index (the same `public/get_volatility_index_data` the probe reads) and Binance's own klines (the
resolution source, `data-api.binance.vision`) are enough to price it. The claim tested: where that price and
the ladder disagree by more than the taker fee and one tick, buying the cheap side and holding to the Binance
print earns more than every cost, beyond what a calibrated price would pay, on days the rule never saw.

## What was seen before the freeze (disclosed)

* fp4's published verdicts (FAV, WX, RW, and the measurements M1–M6). This test does not repeat them. RW's
  paper engine is not read and not changed.
* One live book, 2026-09-25 about 00:22 UTC: Binance BTCUSDT near 84,559; Deribit BTC DVOL (daily) near 36;
  trailing 24-hour realised vol near 40% annualised; the 25 September ladder's $84,000 YES shown about
  0.72–0.73, against a zero-drift digital near 0.65 (realised) and near 0.67 (that daily DVOL). The gap was
  larger than the crypto taker fee on that one strike. No other day's book was priced, and no return was
  computed. **That date is outside the window below.**
* The same minute, Kraken XBTUSDT was about 4 bps from Binance. A few basis points do not move a 16-hour
  digital by a cent, so a second spot is not a second model.
* Eighteen markets then in `uma_resolution_status=disputed`, and a month leaderboard's recent buys. Those
  two are other ideas (the study's kill table). They are not inputs to this rule.
* A capability check, not a price: the February 23 ladder still serves 1-minute history for a two-hour window,
  `/v2/trades` accepts a time bound, events keyset accepts an end-date bound, and hourly DVOL returns candles.
  The numbers in those replies were not put against a model.

No parameter below was chosen from that one ladder. The entry is "the model still has edge one tick through
the shown price, after the fee at that price", which is what a taker has to clear on any day.

## Data (keyless, public)

* Gamma `events/keyset?series_id=45&closed=true` with an end-date bound (the BTC multi-strike series), then
  the event by slug for its markets: question, outcomes, `clobTokenIds`, `outcomePrices`, `endDate`,
  `closedTime`, tick, `feeSchedule.rate`, `feesEnabled`.
* Binance `GET /api/v3/klines?symbol=BTCUSDT` on `data-api.binance.vision`: the 1-minute candle whose close
  time is at or before the decision time (its close is the spot), and the 25 hourly closes ending at the last
  hour close at or before the decision time (the realised-vol arm).
* Deribit `public/get_volatility_index_data`, currency BTC, resolution 3600. The candle whose open time plus
  one hour is at or before the decision time; its close, divided by 100, is the volatility.
* The CLOB `prices-history` of the YES token, fidelity 1 minute, on `[T_d − 30 min, T_d]`.
* The Data API `GET /trades?market=<condition>&start=&end=&takerOnly=true` for that one market on
  `(T_d, T_d + 60 min]`. `/v2/trades` accepts the same words and ignores them (it returns the newest
  prints), so it is not the source. This was checked on one February market before any of those
  prints was priced.

## Universe

Events in series 45 whose slug matches `bitcoin-above-on-<month>-<day>` or `bitcoin-above-on-<month>-<day>-<year>`
and does not contain `am-et` or `pm-et`, with `endDate` in [2025-01-01, 2026-09-11). One event per UTC date of
`endDate`: the lowest slug. A market whose outcomes are not exactly `["Yes","No"]` is skipped. The strike is the
dollar amount in "above $K". The traded market is the strike closest to the spot; a tie takes the lower strike.

## Windows (by `endDate`)

IS: 2025-01-01 → 2026-01-01, reported, nothing chosen there. OOS1: 2026-01-01 → 2026-06-01. OOS2: 2026-06-01 →
2026-09-11. The OOS end is the day before anything in the disclosed snapshot, and it matches the end of fp4's
out-of-sample window extended by one day so 10 September is inside and 11 September is not.

## Rule

* Decision time `T_d = endDate − 16 h`.
* Spot `S`: the close of the last Binance BTCUSDT 1-minute candle whose close time is ≤ `T_d`. None → no trade.
* Primary volatility: that Deribit hourly close. None → no trade. Secondary arm, same trades otherwise: the
  population standard deviation of the last 24 hourly log returns (25 closes), annualised by `sqrt(24 × 365.25)`.
  The secondary arm is reported and is not the verdict.
* Time to the print `T` in years: `(endDate − T_d) / (365.25 × 24 × 3600)`, which is 16/24/365.25.
* Model price of YES: `N(d2)` with `d2 = (ln(S/K) − ½ σ² T) / (σ √T)` and `N` the standard normal cdf. Zero
  drift, no discount. `K` is the strike.
* Shown YES price `p0`: the last 1-minute history point at or before `T_d`, and not more than 30 minutes before.
  Shown NO price: `1 − p0` (one book; fp4 checked YES bid + NO ask = 1 on 400 of 400). None → no trade.
* Tick: the market's `orderPriceMinTickSize`, else 0.01. Fee rate `r`: the market's `feeSchedule.rate` when it
  is a positive number, else 0.07. Fee at a price `p` is `r × p × (1 − p)` a share.
* Side. Let `e(q, fair) = fair − q − fee(q)`. Buy YES when `e(p0 + tick, model) > 0`. Buy NO when
  `e((1 − p0) + tick, 1 − model) > 0`. Both, or neither → no trade.
* Entry: a marketable buy of that token, $10 of cost. Fills come from the taker prints in `(T_d, T_d + 60 min]`,
  in time order. A BUY of the token at `p`, or a SELL of the other token at `q` (this token at `1 − q`). Each
  print is used for at most its own size. The fill price is `max(print, shown token + one tick)`, and a print
  whose fill price is above 0.99, or whose edge `e(fill price, fair)` is not positive, is skipped. Less than
  $2 of fill → no trade.
* Hold to resolution. Payout per share is that token's final `outcomePrices` value. P&L = shares × (payout −
  fill price) − fees. One trade per event.
* Capital: each trade locks its cost from its first fill until `closedTime` (else `endDate`).

## Arms

1. Primary: hourly DVOL, as written.
2. Stress (must stay > 0): the same fills, each one tick worse, fees doubled. The book is not re-walked.
3. Secondary: trailing realised vol instead of DVOL, the same bar, reported beside the primary.
4. Descriptive, no bar: how many trades buy YES against NO; P&L if every fill had been at the shown price
   (the history price, which fp4 showed is not a price anyone traded); the largest five losses.

## Null

Each OOS trade's payout is redrawn as Bernoulli(its average fill price), with the same shares and fees.
10,000 draws, `random.Random(20260925)`. The primary's OOS P&L must exceed the null's 95th percentile
(sorted draws, index `floor(0.95 × n)`).

## The bar (primary, OOS = OOS1 ∪ OOS2, all of)

1. OOS P&L > 0, and OOS1 > 0 and OOS2 > 0.
2. OOS P&L > the null's 95th percentile.
3. Stress OOS P&L > 0.
4. At least 80 OOS trades.
5. Not carried by one month: no calendar month of the entry holds more than 40% of the OOS P&L, and the OOS
   P&L without its best month is > 0.
6. Worth money: the OOS P&L over the 253 days from 2026-01-01 to 2026-09-11, on the peak capital the trades
   held at once, exceeds 4% a year.

## Determinism

`vol_test.py` run twice from the committed input; byte-identical JSON, sha256 recorded. `vol_test.py --self-check`
pins the digital at `S = K = 100`, `σ = 0.40`, `T = 16/24/365.25` to 0.496591, a hand-worked $10 fill, the
one-tick floor, a no-trade when the model equals the shown price, and a bar that fails when one half is empty.

## What this cannot show

The ask at the decision instant (a later print, floored one tick over the history price, stands in for it);
queue position; Deribit's 30-day index used on a 16-hour option (the hourly print is still that index);
that anyone may open a position from the United Kingdom or from Ireland (fp4 §0 — outside this test);
a day whose history or whose hourly DVOL is missing, which is skipped rather than filled in.
