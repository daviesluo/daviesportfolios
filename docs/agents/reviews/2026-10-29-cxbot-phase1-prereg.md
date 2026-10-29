# Pre-registration (DRAFT): CXBOT Phase 1, "Crypto analyst", an outside Grok agent on paper against Hyperliquid's live tape (2026-10-29)

**Status: DRAFT, not frozen.** It freezes at the commit that adds Davies' word to §0 (with its date) and pins its sha256 in a
test; until then any part may change. It is written from the independent audit (`reviews/2026-10-29-crypto-grok-bot-audit.md`,
the audit) on the research (`reviews/2026-10-29-crypto-grok-bot-research.md`). The server is `supabase/functions/cxbot/`
(migration `0163_cxbot.sql`, built 2026-10-29); the prompt is `docs/agents/cxbot/GROK_PROMPT.md`. The record is **not blind** (Davies,
2026-10-04): every row may be read at any time; the reading of §6 runs as written here and its report says it was not
blind. **Money: none.** Phase 1 holds no key, no wallet and no session at any venue; every read is public.

## 0. On whose word, and what this is

- Davies, 2026-10-28: "我打算把币所的买卖交易也做成一套类似于用grokbot交易polymarkt/ig的系统…并且最好long和short都可以做";
  "交易所不限…". 2026-10-29: "…只判断对策略来说最优的币所，给grok的prompt里也需要提供具体的数据和概率推断来源等，确保一切设定最佳"; the main
  session: Phase 1, paper on live public data, in TESTING, no live keys.
- **Freezing needs:** Davies' word to start (quoted here with its date), `CXBOT_TOKEN` stored, the server's `reach` probe
  showing Hyperliquid's `/info` answering from eu-west-2 (else §2's venue becomes Binance USDⓈ-M by a deviation written
  before the start), and the shakedown of §3.1.
- **Settled before the freeze** (Davies, 2026-10-29: "你说的那三件事全按你的建议来", on the independent audit's §3,
  `reviews/2026-10-29-cxbot-independent-audit.md`): the bootstrap's blocks are 7 days (§5); CXBOT carries its own list of
  2027 releases to 2027-03-31 (CPI, NFP, FOMC; §2), so a go after early November runs its 56 days into 2027; and bar (c)
  counts the P&L from the shakedown's end, the whole run's beside it (§5).
- Ours: this file, the `cxbot` function, its tables and its minute calls. Not ours: the Grok agent, its platform and its
  schedule. Grok holds no credential of any venue; it acts only through the server.

## 1. Hypotheses

- **H1 (primary, layer A):** on brackets the server assigns (both directions of BTC, ETH and SOL every four hours), Grok's
  probability p beats the bracket's model-free baseline m on Brier, by more than a drift oracle per coin and direction can
  explain. **H0:** it does not.
- **H2 (layer C):** on brackets Grok chooses (paper trades and shadows), the same holds, and the paper book makes money after
  fees, slippage and funding.
- **Reported, not tested (layer B):** Grok's p on Polymarket's daily BTC and ETH "above ___" questions against the market's
  mid and last trade, with Deribit's digital beside them.

## 2. The rules (the server enforces every one; `cxbot/rules.ts`, `CXBOT_RULES`)

Frozen as the code stands at the freeze commit; a change is a deviation (§9). The audit's §7.2 gives each reason.

- **Venue and instruments**: Hyperliquid perpetuals BTC, ETH, SOL; paper only; the tape is Hyperliquid's public data.
- **Every open is a bracket**: stop and limit; reward ≥ 1.5 × risk; stop distance 0.75–5 × the coin's one-day volatility
  (the server's figure) and ≥ 1 %; p ≥ p\* + 0.08, p\* = m + c / (d_stop + d_limit), c the server's costs (fees, stop
  slippage, 72 hours' funding at the dearer of the current and the predicted rate); at least one source and an invalidation; category E (a listed release within
  72 h ahead, `event_at` exactly as the calendar gives it), R (one within 24 h behind), N, or C (a change).
- **Size**: risk at the stop, costs included, ≤ 1 % of the $1,000 notional budget and ≤ ¼ Kelly of the paper equity; size
  in Hyperliquid's size decimals, rounded down.
- **Book**: ≤ 3 positions and resting orders, one per coin, no adding, averaging down or hedging; ≤ 3 % at the stops in
  all and ≤ 2 % in one direction; gross notional ≤ 2 × budget, net ≤ 1 ×; leverage set by the server (isolated, the least of
  3× and what keeps the paper liquidation price ≥ 2.5 stop distances beyond the stop).
- **Funding**: no open whose side pays more than 0.01 %/h on the current or the predicted rate.
- **Blackouts and freshness**: no open from T−10 to T+5 minutes of a listed CPI, NFP, FOMC, ECB or BoE release
  (`agents/cb_releases.ts`, to 2026-12-31) and of CXBOT's own list of CPI, NFP and FOMC to 2027-03-31
  (`cxbot/rules.ts`, `CXBOT_RELEASES_2027Q1`, from bls.gov's and federalreserve.gov's schedules), none after 2027-03-31
  until the list is extended, none while the tape is over 2 minutes old or the
  spread is over 5 bps (BTC, ETH) or 10 bps (SOL).
- **Orders**: `market` (IOC, worst price ≤ the touch ± 0.1 × the stop distance), `limit` (rests 5 min–24 h), `stop` entry
  (5 min–24 h); a stop may only tighten; the server closes a position at 7 days.
- **Stops**: day −$20 (no open until 00:00 UTC), total −$100 (close-only to the end, the test FAILS); both latched.
- **Rates**: ≤ 3 trading requests a minute, ≤ 30 orders a UTC day, ≤ 600 requests an hour, 300 journal rows an hour.
- The global pause outranks everything but cancels and closes.

## 3. Phases, window and stops

1. **Shakedown** (mode `paper`, the first 48 hours after the start): everything runs and is recorded; nothing of it is
   scored. A fix in the shakedown is not a deviation; the main session writes each in the ledger. The start is 0163's go
   statement (`mode` 'paper', `started_at`), run only on Davies' word.
2. **The test**: 56 days from the end of the shakedown, or the total stop (a FAIL), or the futility look of §6.4.
3. **The end** is closed by the main session: mode `dry_run` (no new open; open paper positions run to their stop, limit
   or the 7-day close and are booked), then the reading.

## 4. The record

- `cxbot_tape`: each complete minute's candle of each coin on the venue (open, high, low, close, volume, trades), written by
  the minute job's recorder, which re-reads from its newest minute (at most six hours back), so a minute it missed is
  filled at its next run; and, on the minute it was read, the book's touch, the mark, the oracle (index), funding (per
  hour), open interest and premium. A minute never recorded stays absent: the outcomes skip it (§5) and the paper engine
  waits ten minutes for it, then steps over it.
- `cxbot_questions`: every assigned question with its issue time, deadline, geometry or Polymarket market, the server's m
  and numbers at issue, its start, its outcome as the server read it and its state (a question the server could not start,
  or never resolve, is `void`); `cxbot_forecasts`: every answer as received.
- `cxbot_decisions` (each with the server's `received_at`), `cxbot_orders`, `cxbot_positions` (fills, fees, funding and how
  each closed are columns of these two), `cxbot_snapshots` (the paper equity, written every minute into its 5-minute slot),
  `cxbot_cycles`, `cxbot_daily`, `cxbot_requests` (every request's status and, when refused, its rules).
- `cxbot_ctx`: Deribit, Polymarket, Binance spot and the slower context, as handed to Grok.
- The money is the paper engine's (`cxbot_snapshots`), never the agent's journal. The reading recomputes every outcome
  from the tape (`score.mjs`), never from the server's `y`.

## 5. Definitions

- **Bracket**: direction, entry e, stop s, limit l, hold H. **m** = (e − s)/(l − s) for a long, (s − e)/(s − l) for a short.
- **y**, on `cxbot_tape` from the bracket's start: 1 if a minute's trades reach the limit first (a long's high ≥ l), 0 if the
  stop first (a long's low ≤ s), else, at start + H, (x_H − s)/(l − s) for a long and (s − x_H)/(s − l) for a short,
  clipped to [0, 1], x_H the close of the minute ending at start + H. A minute that reaches both is **ambiguous**: §6 is
  run twice, once with it stop-first and once limit-first, and must pass both. A missing minute is skipped; a level crossed
  in a gap is reached at the first recorded minute after it.
- **Layer A (assigned brackets)**: issued at 00, 04, 08, 12, 16 and 20 UTC for each coin, a long and a short; stop 1 × and
  limit 2 × the coin's one-day volatility (the venue's last 7 days of hourly candles, the sd of their log returns × √24;
  the stop at least 1 %); H = 72 hours; the answer is due 20 minutes after issue; the bracket STARTS at the deadline, its
  e the open of the deadline's minute on the tape (distances unchanged). An answer after the deadline or a second answer is
  refused; a question with no answer is **missed** (counted). A question the server voided (no tape at its deadline) is not
  counted as issued.
- **Layer B (Polymarket)**: for each daily "Bitcoin above ___" and "Ethereum above ___" question, at 24 h, 8 h and 2 h
  before its resolution, the three strikes whose mid is nearest 0.25, 0.50 and 0.75 at issue; due 15 minutes later; its
  baselines the mid and the last trade at the deadline; y the question's resolution (0 or 1).
- **Layer C (own brackets)**: a real bracket is a paper open the server filled; its start is the first whole minute at or
  after its fill, e the fill price; it is scored on its ORIGINAL levels on the tape, whatever the position later did (closed, amended, the 7-day close: those
  change the money, not the forecast), with H = 7 days. A shadow bracket is a `no_action` decision with coin, direction,
  level, stop, limit and p; its clock is the server's receipt (`received_at`, or its `ts` if later: the journal takes a `ts`
  up to 7 days old, and a bracket on a move already made is not a forecast); it is reached in the first minute within 24 h
  of that clock whose trades span its level (never: not scored, counted), resolves from the minute after, and is excluded
  (counted) if that first minute already reached its stop or limit; H = 7 days. At most one shadow per coin per four hours
  is scored (the first by that clock); none while a real one in that coin is open. Every real bracket is scored.
- **Brier**: mean (p − y)² against mean (m − y)², p and m clamped to [0.001, 0.999]. **D** = Brier(m) − Brier(p): positive,
  Grok is better. **D_c**: the same with each (coin, direction) cell's m moved by that cell's mean (y − m), clamped.
- **The bootstrap**: circular blocks of 7 consecutive UTC days of the brackets' start days, 10,000 resamples, the generator
  mulberry32 seeded 20261029; its 5th and 95th percentiles of D.
- **P&L**: the paper equity at the end less the paper equity at the shakedown's end (the newest snapshot at or before it;
  §3.1: nothing of the shakedown is scored), fees, slippage and funding included; in dollars and in units of $10. The whole
  run's P&L from $1,000 is reported beside it; the total stop counts from $1,000.

## 6. The reading

Read-only SQL over the `cxbot_*` tables and a scorer written and pinned before the start
(`docs/agents/backtests/cxbot/score.mjs`, pinned by `src/cxbot_score.test.js`, including the no-skill forecasters of the
audit's `falsepass.py`).

1. **Layer A (primary)**: D, its bootstrap percentiles, D_c, the answered share; by coin and direction.
2. **Layer C**: the same on own brackets (real, shadow, both); the money (P&L, the day table, the worst drawdown, per real
   bracket in units of $10).
3. **Layer B**: Brier of p against the mid and against the last trade, with event-day clusters (bootstrap of days), and
   Deribit's digital at the deadline beside them; log loss beside Brier.
4. **Discipline**: refusals by rule; journal against the record; cycles against the schedule; missed questions.

**Bar to propose a live pre-registration (all of):** (a) layer A: at least 90 % of issued questions answered (a voided
question is not issued), D > 0, the
bootstrap's 5th percentile > 0 and D_c > 0, under both ambiguous conventions; (b) layer C: at least 60 scored brackets,
D > 0 and D_c > 0; (c) paper P&L > 0; (d) the total stop never reached and no paper liquidation. Otherwise the test stops,
and a different design is a new pre-registration. Passing proposes; it decides nothing. **Power** (audit §5.4): a calibrated
8-point skill passes about a quarter of the time, 13 points about two thirds; a miss says "not shown", never "no edge".

**Futility (day 28 of the test):** if layer A's bootstrap 95th percentile of D is below 0, the test stops as a FAIL. It can
end the test early; it can never pass it.

## 7. Budget

Paper: $1,000 notional; $10 a trade at risk; $30 in all, $20 in one direction; −$20 a day, −$100 in all. A later live phase
is a separate pre-registration on Davies' word (venue, budget, a testnet rehearsal, a wallet of the bot's own, the
monitor).

## 8. What this does not check

- Fills: paper is not a fill (queue, latency, a crash's book); the model is conservative by construction (audit §7.3), not
  measured against live fills.
- The agent's platform, scheduler and prompt beyond what the record shows.
- Whether Davies' venue accounts may trade these products; tax.
- The bootstrap's own width: on simulated martingale paths a no-skill forecaster whose luck runs in spells of one to two
  weeks made a 3-day-block bootstrap 10–25 % narrower than D's true spread (passing layer A's part of the bar in up to
  5.8 % of 56-day windows); 7-day blocks, chosen for that reason (§0), narrow the gap a little and held the worst case to
  5.0 %, because such a forecaster pays its leaning in Brier (the independent audit,
  `docs/agents/backtests/cxbot/blockcheck.py`). A pass is evidence at about that level, not more.

## 9. Deviations

None (draft).
