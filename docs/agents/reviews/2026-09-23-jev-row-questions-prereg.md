# Pre-registration: each paper row's own Jev question (2026-09-23)

Written and frozen before any reply to either question below exists. The
file's SHA-256 at freeze time goes into the answers file and the pricing
output; anything added after the freeze is appended under a dated heading.

## 1. Why

The v2 gate fails the bar on both paper rows (reference §4.21, review
`2026-09-23-jev-gates-paper-rows.md`): on trend-1h it lowers the worst window
in all four evaluations, and on momentum-1d at the cadence the loop runs it
lowers the bear year 4.2–15.1 points. Davies chose option (c) — "jev的问题选c"
— and added "每个策略的jev都可以有自己的设计": each row gets a question of
its own, measured on every entry state and priced before the loop asks it.

What the v2 replies show (`jev_answers_v2_other.json`): on momentum-1d the
model decides almost entirely on the 4-hour words — it vetoes 93 % of replies
when the 4-hour trend is down and 43 % when it is up — while the rule it gates
enters on a 30-day signal and holds while it lasts (a median of about three days in the published tables, sometimes weeks). On trend-1h it vetoes one state, a weak
trend in high volatility (every reply 0.37–0.41), and passes the rest; and for
that rule every word named `_4h` is in fact measured on 1-hour candles, which
the v2 wording never says.

## 2. What is fixed

Everything but the entry question's wording and each row's threshold:

- the rulebooks, rows, symbols, costs, stops, cooldowns and cadences as
  migrations 0037–0048 leave them; `buildSnapshot` and the state words
  unchanged; the caution question, the echo question and `combineDecision`
  unchanged, with `cautionExit` 1.75;
- the answers are the model's own replies through the production endpoint
  (`POST /functions/v1/agents?action=jev`, transport openrouter, the model the
  loop calls), five calls per state;
- the entry spaces are exactly the ones measured for v2: trend-1h's 54 states
  (3 coins × trend_strength × volatility low/normal/high × momentum_30d
  positive/unknown, with trend up and breakout above_range) and momentum-1d's
  189 (3 coins × trend_4h × trend_strength × breakout_4h × volatility
  low/normal/high, momentum positive); position flat, unrealised none,
  time_in_position none, drawdown_from_high none on every state;
- the pricing is the paper-rows study's (review §1): the four walk-forward
  windows, the four evaluations (Coinbase-spliced and Kraken tapes × shipped
  8 % floor and 3×ATR trail), 2,000 seeded draws of one measured reply per
  consulted state, the episode null calibrated to the same number of entries
  with 1,000 draws, momentum-1d judged at the daily cadence the loop runs
  (the 4-hour cadence reported beside it).

## 3. The two questions, verbatim

Only the `healthy_trend` instructions and criteria change. Version ids:
`v3-momentum-1d` and `v3-trend-1h`.

### 3.1 momentum-1d — `v3-momentum-1d`

Instructions:

> The state describes one crypto pair at the moment a 30-day momentum rule wants to BUY it, because the daily close is above its close 30 days earlier and volatility is not extreme. The rule then holds for as long as the daily close stays above its close 30 days earlier, unless the price falls 8 % below what it paid: sometimes a day or two, sometimes weeks. Those checks are done and are not the question. The question is whether, over the days to weeks the rule would hold, this rise looks more likely to keep going than to reverse. Answer yes if continuing looks more likely, and no if reversing looks more likely. How to read the words: momentum_30d compares the daily close with the close 30 days earlier, and is positive here, which is why the rule is asking. The other words describe the recent past on 4-hour candles: trend_4h and trend_strength compare a short average of 4-hour closes, covering about the last three days, with a long one, covering about the last two and a half weeks — strength is weak when the two are close together and strong when they are far apart; breakout_4h says whether the last 4-hour close is above the range of about the last nine days, below the range of about the last three days, or inside; volatility says how large the 4-hour swings of the last week are (low, normal, high). When the words point in different directions, weigh them together; no single word decides the answer on its own.

Criteria: true — "Worth buying now: over the days to weeks ahead the 30-day rise looks more likely to continue than to reverse." false — "Better skipped: a reversal of the 30-day rise looks more likely than a continuation."

### 3.2 trend-1h — `v3-trend-1h`

Instructions:

> The state describes one crypto pair at the moment a trend-following rule on 1-hour candles wants to BUY it, because the 1-hour trend is up, the close is above the highest price of the previous 55 hours, 30-day momentum is not negative and volatility is not extreme. The rule then holds for hours to a few days, and sells when the 1-hour trend turns down, the close falls below the lowest price of the previous 20 hours, or the price falls three average hourly ranges from its high or 8 % below what it paid. Those checks are done and are not the question. The question is whether, over the hours to days the rule would hold, this 1-hour breakout looks more likely to keep going than to fail and reverse. Answer yes if continuing looks more likely, and no if failing looks more likely. How to read the words: for this rule every word except momentum_30d is measured on 1-hour candles, although the names say 4h. trend_4h and trend_strength compare a short average of hourly closes, covering about the last day, with a long one, covering about the last four days — strength is weak when the two are close together, as they are when a move has only just begun, and strong when they are far apart; breakout_4h is above_range here, which is part of why the rule is asking; volatility says how large the hourly swings of the last two days are (low, normal, high); momentum_30d compares the daily close with the close 30 days earlier, and unknown means there are fewer than 30 days of daily history, which says nothing about the direction. When the words point in different directions, weigh them together; no single word decides the answer on its own.

Criteria: true — "Worth joining now: over the next hours to days the breakout looks more likely to continue than to fail." false — "Better skipped: a failed breakout or a quick reversal looks more likely than a continuation."

## 4. Measurement

- One request per batch through `POST ?action=jev` with `version` set to the
  id above, `kind` the row's kind, `repeats` 5, transport openrouter, from the
  database through `pg_net` with the cron secret. Batches stay under the
  endpoint's 500-call cap (momentum-1d in two).
- The replies are written to `docs/agents/backtests/jev_answers_rows.json` in
  the layout of `jev_answers_v2_other.json`, with this file's SHA-256, the
  request ids, the model, the cost and a canonical MD5 per row.
- A state with a failed echo or no answer is asked again once in full (five
  calls); the re-ask replaces it and is recorded. A second failure fails the
  row's question at measurement.

## 5. The threshold, from the replies alone

For each row separately, on the 0.01 grid from 0.01 to 0.99:

- a call **vetoes** a state at t when `combineDecision` would refuse the entry
  on that reply: P(healthy) < t, or caution ≥ 1.75 (extreme);
- t is **deterministic** when every state is vetoed on all five calls or on
  none of them;
- t is **non-trivial** when it vetoes at least one state and passes at least
  one;
- the deterministic non-trivial thresholds form intervals on the grid; the
  row's threshold is the **midpoint of the widest interval**, rounded down to
  0.01. Ties go to the lower interval (it vetoes fewer states).
- If there is no deterministic non-trivial threshold, the question does not
  decide the row's entries the same way on every call, or decides them all the
  same way; it **fails at measurement** and is not priced.

## 6. Pricing and the bar

- A new study file prices the gates; it first reproduces the paper-rows
  study's rule and gate cells exactly when given the v2 replies at 0.45, and
  refuses to run otherwise.
- **The bar** (the paper-rows study's, unchanged): at its threshold, a row's
  gate must not lower the worst window in any of the four evaluations, and
  must beat a same-size random veto there, P(null's worst ≥ gate's worst) ≤
  0.05. momentum-1d is judged at the daily cadence; the 4-hour cadence and the
  return ÷ drawdown reading are reported and decide nothing.

## 7. What follows from each outcome

- A row whose question clears the bar: one migration sets its
  `params.jevQuestion` to the version id and `params.enterMin` to its
  threshold. Nothing else changes; the loop asks v2 until that migration.
- A row whose question fails at measurement or at the bar: nothing changes in
  production, and the choice between keeping the v2 gate and shadowing the row
  goes back to Davies with this evidence. No second wording is tried without
  a new pre-registration.
