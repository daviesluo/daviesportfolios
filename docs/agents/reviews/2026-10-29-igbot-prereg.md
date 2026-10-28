# Pre-registration (DRAFT): IGBOT, "IG analyst (Grok)", an outside LLM agent trading IG spread bets on the demo (2026-10-29)

**Status: DRAFT, not frozen.** It freezes at the commit that adds Davies' word to §0 (with the date) and pins its sha256
in a test; until then any part may change. The research behind it is `reviews/2026-10-29-igbot-research.md`; the server is
`supabase/functions/igbot/` (migration `0157_igbot.sql`); the agent's prompt is `docs/agents/igbot/GROK_PROMPT.md`. The
record is **not blind**: every row may be read at any time (Davies, 2026-10-04); the reading in §6 runs as written here and
its report says it was not blind. Money: IG's **demo** account only. Nothing here can reach Davies' live IG account.

## 0. On whose word, and what this is

- Davies, 2026-10-28: "我觉得grokbot做polymarket的这个策略不错，你仔细深度研究下是否可以做个类似的做ig的cfd/options/spread betting的trading
  bot并搭建架构，做好了给我发prompt".
- **Freezing needs:** Davies' word to run the test (to be quoted here with its date), his demo secrets stored, the dry-run
  rehearsal of §3.1 passed.
- What is ours: this file, the `igbot` function, its tables and its minute call. What is not: the Grok agent, its
  platform and its schedule. Grok holds no IG credential; it can act only through the server, which enforces §2.

## 1. Hypothesis

**H1:** an LLM analyst that opens only defined-risk brackets on scheduled macro events (E), their aftermath (R) or news
(N), on six of IG's most liquid spread-bet markets, forecasts which side of its bracket is hit first better than the
bracket's own driftless probability, and does not lose money doing so.

**H0:** its p is no better than m = d_stop / (d_stop + d_limit); any profit is luck.

Why this framing: IG quotes no probability. A bracket (entry, guaranteed stop, limit) turns every trade into a binary
forecast with a market-implied baseline, so GROKPM's question (does the agent's p beat the market's?) can be asked on IG,
and asked of many more forecasts than there are trades (§5, shadow brackets).

## 2. The rules (the server enforces every one; `igbot/rules.ts`, `IGBOT_RULES`)

Frozen as the code stands at the freeze commit; a change is a deviation (§9). In short (the research's §7.2 gives each
reason):

- Spread bets only (daily funded bets, £ a point) on the whitelist `igbot_instruments`: US 500, US Tech 100, Wall Street,
  FTSE 100, Germany 40, AUD/USD.
- Every open: a **guaranteed stop** (at least IG's minimum distance), a **limit**, reward ≥ 1.5 × risk, p ≥ m + 0.08, risk
  at the stop (premium included) ≤ 1 % of the budget and ≤ ¼ Kelly of the bot's equity (budget + its P&L), at least one
  source, an invalidation; category E needs a listed release within 72 h ahead, R one within 24 h behind.
- Immediate deals: IG `LIMIT` fill-or-kill, the level at most a tenth of the stop beyond the touch. Working orders:
  `LIMIT` or `STOP`, 5 minutes to 24 hours, never into a release window or past Friday 20:00 UTC.
- At most 3 positions and working orders, one per market (no adding, averaging down or hedging), 3 % of the budget at the
  stops in all, notional ≤ 5 × the budget.
- No open from T−5 to T+2 minutes of a listed CPI, NFP, FOMC, ECB or BoE release, nor from Friday 20:00 to Sunday 22:00
  UTC. A stop may only be tightened. The server closes a position held 5 days.
- Day stop −£20 (no open until 00:00 UTC), total stop −£100 (close-only to the end, the test FAILS); both latched.
- ≤ 3 trading requests a minute, ≤ 40 orders a UTC day; the global pause outranks everything but cancels.

## 3. Phases, window and stops

1. **Dry-run rehearsal** (mode `dry_run`, at least two UTC days, no money of any kind): the agent runs its schedule; a
   check passes when the record shows (a) every action answered, (b) at least one open answered `would_send` and at least
   one refused by a named rule, (c) cycle rows at the schedule's cadence, (d) a `no_action` shadow bracket, (e) no
   `igbot.request` or `igbot.sync` error the main session cannot explain.
2. **Demo** (mode `demo`, armed by 0157's statement on Davies' word): **42 days** from the arm's UTC day, or the total
   stop (a FAIL), whichever first. The budget is a notional **£1,000** of the demo account's play money.
3. **The end** is closed by the main session: mode back to `dry_run` (the sync deletes working orders; positions keep
   their guaranteed stops and limits and are closed by the agent or by the five-day rule), then the reading.

## 4. The record

- `igbot_snapshots`: the demo account's equity, balance, unrealised P&L and margin as IG reports them, each five minutes.
  **The test's money is this**, never the agent's journal.
- `igbot_positions`: every position the account held, its open and close levels, how it closed (stop, limit, bot,
  server) and its P&L from the levels (less the premium when its guaranteed stop closed it).
- `igbot_orders`, `igbot_decisions` (with the server's m beside the agent's p), `igbot_cycles`, `igbot_daily`,
  `igbot_requests` (every refusal by rule name).
- **The demo account is the bot's alone.** A deal made there by hand would be counted as the bot's.

## 5. Definitions

- **Bracket**: a direction, an entry level, a stop and a limit. **m** = d_stop / (d_stop + d_limit), distances from the
  entry level. **p**: the agent's probability that the limit is reached before the stop.
- **Real bracket**: an open the server sent and IG filled (a working order counts from its fill). It **resolves** y = 1
  if it closed at its limit, 0 at its stop; closed by the agent or by the five-day rule, it is excluded from the Brier
  reading and counted in P&L.
- **Shadow bracket**: a `no_action` decision with `epic`, `direction`, `level`, `stop_level`, `limit_level` and
  `p_target`, journalled as the agent's considered view (the prompt asks for one for every candidate it researches to a
  number). It starts at its `ts` (an entry level away from the touch starts when IG's price first reaches it within 24 h,
  or never). It resolves on IG's own HOUR bars (`/prices`, the bid for a sell's stop and a buy's limit, the offer for the
  other two): y = 1 if the limit is touched first, 0 if the stop is; an hour that touches both counts as the stop first;
  neither within five days is excluded and counted. At most one shadow bracket per market per four hours is counted (the
  first); a market with a real bracket open counts no shadow one.
- **Brier**: mean (p − y)² for the agent, mean (m − y)² for the baseline, over the same resolved brackets.
- **P&L**: the snapshot's equity at the end less the equity at the arm (funding and premiums included), in £ and in units
  of the 1 % risk (£10).

## 6. The reading (at the end)

Read-only SQL over the `igbot_*` tables and a script written and committed before the end
(`docs/agents/backtests/igbot/`), from the repository root:

1. **Calibration (primary).** D = Brier_m − Brier_p over every resolved bracket, real and shadow (positive: the agent is
   better); a paired bootstrap of D, 10,000 resamples of brackets, `random.Random(20261029)`, its 5th and 95th
   percentiles; the same on real brackets alone and by category.
2. **Money.** Total P&L (§5), the day-by-day table, the worst drawdown, and per real bracket in risk units.
3. **Discipline.** Refusals by rule; journal rows against the record (an open the record shows that no decision names);
   cycles by kind against the schedule.

**Bar to propose a live pre-registration** (all four): at least **150** resolved brackets; D > 0 **and** its bootstrap
5th percentile > 0; demo P&L > 0; the total stop never reached. Otherwise the test stops, and a different design is a new
pre-registration. Passing the bar proposes; it decides nothing. The live step needs Davies' word, IG's written consent
under its Term 9(12), a live key, a migration lifting the demo-only check and code that knows the live host.

## 7. Budget proposal (Davies decides)

- **Demo**: £1,000 notional, £10 a trade at risk, £30 in all, −£20 a day, −£100 in all.
- **A later live phase (not part of this test)**: £2,500 on the spread-bet account at 1.5 % a trade (£37.50), on the
  markets whose live minimum stake fits a 0.5 % stop at that risk (US 500 £1, FTSE 100 £0.50, Wall Street £0.20,
  AUD/USD £0.50 a point; Germany 40's 0.5 % stop costs about £63 at its £0.50 minimum), the total stop −£250.

## 8. What this does not check

- The agent's prompt, platform and scheduler (another platform).
- Demo against live fills: IG documents no likeness; the demo's minimum sizes and premiums differ from live.
- Funding per position (it is in the equity, not split).
- Tax, and IG's consent to automated dealing (both before any live step).

## 9. Deviations

None (draft).
