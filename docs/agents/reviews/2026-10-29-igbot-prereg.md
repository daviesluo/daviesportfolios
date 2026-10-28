# Pre-registration (DRAFT): IGBOT, "IG analyst (Grok)", an outside LLM agent trading IG spread bets on the demo (2026-10-29)

**Status: DRAFT, not frozen.** It freezes at the commit that adds Davies' word to §0 (with the date) and pins its sha256
in a test; until then any part may change. **Revised by the independent audit of 2026-10-29** (§10): the rules, the
record, the baseline, the outcome and the bar below are the audit's. The research behind it is `reviews/2026-10-29-igbot-research.md`; the server is
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
- Every open: a **guaranteed stop** (at least IG's minimum distance, measured from the touch for an immediate deal), a
  **limit** (at least IG's minimum distance; neither past IG's maximum), reward ≥ 1.5 × risk, p ≥ m + 0.08, risk at the
  stop (premium included, a percentage premium as its share of the level) ≤ 1 % of the budget and ≤ ¼ Kelly of the bot's
  equity (budget + its P&L), at least one source, an invalidation; category E names a **listed** release (`event_at`, to
  the minute) within 72 h ahead, R one within 24 h behind.
- Immediate deals: IG `LIMIT` fill-or-kill, the level at most a tenth of the stop beyond the touch. Working orders:
  `LIMIT` or `STOP`, 5 minutes to 24 hours, never into a release window or past Friday 20:00 UTC. A close is IG's `LIMIT`
  fill-or-kill at the exit touch less the larger of three spreads and 5 bps.
- No open in a market where an earlier order of the bot has no answer from IG yet (two hours); none while the account
  holds a position or working order the bot did not place (its equity would not be the bot's book); none after
  2026-12-31, where the release list ends.
- At most 3 positions and working orders, one per market (no adding, averaging down or hedging), 3 % of the budget at the
  stops in all, notional ≤ 5 × the budget.
- No open from T−5 to T+2 minutes of a listed CPI, NFP, FOMC, ECB or BoE release, nor from Friday 20:00 to Sunday 22:00
  UTC. A stop may only be tightened. The server closes a position held 5 days.
- Day stop −£20 (no open until 00:00 UTC), total stop −£100 (close-only to the end, the test FAILS); both latched.
- ≤ 3 trading requests a minute, ≤ 40 orders a UTC day; ≤ 24 IG requests a minute for the whole function (the agent's
  actions and the minute's sync together); the global pause outranks everything but cancels. Nothing the server does
  (the five-day close, the kill switch's cancels) touches a deal the bot did not place.

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
- `igbot_orders` (with the bid and offer each open was decided on, in `checks`), `igbot_decisions` (with the server's m
  beside the agent's p), `igbot_cycles`, `igbot_daily`, `igbot_requests` (every refusal by rule name, and the IG requests
  each made).
- `igbot_bars` (0159): IG's own HOUR bars, bid and ask, of every whitelisted market, read by the minute's sync once an
  hour; `fetched_at` says whether a bar was read after its hour closed. The shadow brackets resolve on these.
- **The demo account is the bot's alone.** A deal made there by hand would be counted as the bot's.

## 5. Definitions

- **Bracket**: a direction, an entry level, a stop and a limit. **m** (the rules' bar) = d_stop / (d_stop + d_limit),
  distances from the entry level. **p**: the agent's probability that the limit is reached before the stop.
- **The scored baseline m\*** is the exit side's driftless chance: a buy's limit and stop are reached by the BID, so
  m\* = (x0 − stop) / (limit − stop) with x0 the bid at the start (the entry less the spread); a sell's by the OFFER,
  mirrored. The rules' m overstates the limit's chance by spread / (d_stop + d_limit): scored against it, a forecaster
  could win by shading every p down, with no skill (the audit's finding; `src/igbot_score.test.js` shows it).
- **Real bracket**: an open the server sent and IG filled (a working order counts from its fill). Its x0 is its fill less
  the spread the server read when it decided (`checks`). It **resolves** y = 1 if IG closed it at its limit, 0 at its
  stop; closed by the agent or by the five-day rule, or amended, it is excluded from the Brier reading (counted) and
  counted in P&L.
- **Shadow bracket**: a `no_action` decision with `epic`, `direction`, `level`, `stop_level`, `limit_level` and
  `p_target`, journalled as the agent's considered view (the prompt asks for one for every candidate it researches to a
  number). It starts in the first hour, from its `ts`'s, whose bars reach its entry (a buy's level at or above the hour's
  lowest ask, a sell's at or below its highest bid), within 24 h, or never. Its x0 uses that hour's opening spread. It
  resolves on IG's own HOUR bars (`igbot_bars`): y = 1 if the limit is reached first, 0 if the stop is. **An hour that
  reaches both, or the start's own hour reaching either, cannot be ordered: excluded and counted** (the draft counted
  both as the stop first, which biases y down and rewards shading p down). Neither within five days, or an incomplete
  bar before it resolves: excluded and counted. At most one shadow bracket per market per four hours is counted (the
  first); a market with a real bracket open counts no shadow one.
- **Brier**: mean (p − y)² for the agent, mean (m\* − y)² for the baseline, over the same resolved brackets (p and m\*
  clamped to [0.001, 0.999]).
- **P&L**: the snapshot's equity at the end less the equity at the arm (funding and premiums included), in £ and in units
  of the 1 % risk (£10).

## 6. The reading (at the end)

Read-only SQL over the `igbot_*` tables (`docs/agents/backtests/igbot/export.sql`) and the scorer written and tested
before the demo starts, `docs/agents/backtests/igbot/score.mjs` (pinned by `src/igbot_score.test.js`), from the
repository root:

1. **Calibration (primary).** D = Brier_m\* − Brier_p over every resolved bracket, real and shadow (positive: the agent
   is better); a paired bootstrap of D, 10,000 resamples of brackets, the generator mulberry32 seeded 20261029, its 5th
   and 95th percentiles; the same on real brackets alone and by category. **D_c**: the same difference against the
   baseline moved by c = mean (y − m\*) over all resolved brackets, an oracle shift in the baseline's favour, so that a
   constant bias in p is not read as skill.
2. **Money.** Total P&L (§5), the day-by-day table, the worst drawdown, and per real bracket in risk units.
3. **Discipline.** Refusals by rule; journal rows against the record (an open the record shows that no decision names);
   cycles by kind against the schedule.

**Bar to propose a live pre-registration** (all five): at least **150** resolved brackets; D > 0 **and** its bootstrap
5th percentile > 0; D_c > 0; demo P&L > 0; the total stop never reached. Otherwise the test stops, and a different design
is a new pre-registration. Passing the bar proposes; it decides nothing. **Power:** 150 is a floor, not a design: a
small true edge (D near 0.005) has a standard error of about 0.004 at 150 brackets and will not clear the 5th
percentile; only a clear one will. A miss says "not shown", never "no edge". The live step needs Davies' word, IG's written consent
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

## 10. The audit of 2026-10-29 (what changed in this draft, and why)

An independent audit read the server, the migration, the prompt and this draft against IG's reference before the prompt
went to the agent (`docs/LEDGER.md`, 2026-10-29). In this file: the scored baseline is the exit side's (m\*), the
ambiguous hour is excluded instead of counted as the stop, the oracle-shift guard D_c joins the bar, the hour bars are
recorded (they were not, and the client could not read them, so §5 could not have been run), the scorer and its export
are written and tested, and §2 lists the rules the audit added (listed releases for E and R, IG's distances from the
touch, the close's level, the pending-order and shared-account refusals, the calendar's end, the minute's IG budget).
