-- The clean-week checks for 2026-10-08, before the $150 step. Read-only. Each `p` CTE holds the moment the $60 statement ran
-- (agent_risk.updated_at, 2026-10-01 02:24:51 UTC). Every query was run once on 2026-10-01
-- with from = 2026-09-25 00:00 UTC to prove it parses; the "expect" lines are what a clean week returns.

-- CW-1  Every closed 4h bar since :from has exactly 4 bar decisions on the live row, each within 5 min of the close.  EXPECT: no rows.
with p as (select timestamptz '2026-10-01 02:24:51+00' as from_ts),
bars as (select gs as bar_start from p, generate_series(date_trunc('day', p.from_ts), now() - interval '4 hours 5 minutes', interval '4 hours') gs
         where gs + interval '4 hours' >= p.from_ts)
select b.bar_start, count(d.id) as decisions, max(d.ts - (b.bar_start + interval '4 hours')) as max_lag
from bars b left join public.agent_decisions d
  on d.strategy_id = 'trend-4h-live' and d.bar_start = b.bar_start and coalesce(d.numbers->>'kind', 'bar') = 'bar'
group by b.bar_start
having count(d.id) <> 4 or max(d.ts - (b.bar_start + interval '4 hours')) > interval '5 minutes'
order by b.bar_start;

-- CW-1b  Totals: bars, decisions (= 4 x bars), lag, and the gate's inputs at their extremes.  EXPECT: decisions = 4 x bars (~168 in 7 days).
with p as (select timestamptz '2026-10-01 02:24:51+00' as from_ts)
select count(distinct d.bar_start) as bars, count(*) as decisions,
  percentile_cont(0.5) within group (order by extract(epoch from d.ts - (d.bar_start + interval '4 hours'))) as median_lag_s,
  max(extract(epoch from d.ts - (d.bar_start + interval '4 hours'))) as max_lag_s,
  max((d.numbers->>'ordersToday')::numeric) as max_orders_today, min((d.numbers->>'pnlToday')::numeric) as min_pnl_today,
  max((d.numbers->>'exposureUsd')::numeric) as max_exposure_seen
from public.agent_decisions d, p where d.strategy_id = 'trend-4h-live' and d.ts >= p.from_ts and coalesce(d.numbers->>'kind', 'bar') = 'bar';

-- CW-2  Every non-hold or refused live decision (entries, exits, floor exits, refusals with their reason).  READ each row.
with p as (select timestamptz '2026-10-01 02:24:51+00' as from_ts)
select id, ts, symbol, bar_start, numbers->>'kind' as kind, rule_action, final_action, risk_allowed, risk_reason,
  numbers->>'exposureUsd' as exposure_usd, numbers->>'pnlToday' as pnl_today, left(final_reason, 200) as final_reason
from public.agent_decisions, p
where strategy_id = 'trend-4h-live' and ts >= p.from_ts and (rule_action <> 'hold' or final_action <> 'hold' or not risk_allowed)
order by id;

-- CW-3  Every live order since :from, with what settled it.  EXPECT: every state filled (or cancelled = an IOC that died, re-sent);
-- no `rejected` (a rejection is the venue saying no — read its response; "Insufficient balance" is the funding gap of §2/§5);
-- each buy: fee_currency + total_fee present (D11 path) OR feeDerived with fromAccount (D12 path); filled_base a whole number of base steps.
with p as (select timestamptz '2026-10-01 02:24:51+00' as from_ts)
select id, ts, decision_id, symbol, side, state, requotes, base_size, filled_base, avg_fill_price, fee_usd, filled_at,
  coalesce(response->>'filled_quantity', response->'view'->>'filled_quantity') as gross_qty,
  coalesce(response->>'total_fee', response->'view'->>'total_fee') as total_fee,
  coalesce(response->>'fee_currency', response->'view'->>'fee_currency') as fee_currency,
  coalesce(response->>'filled_amount', response->'view'->>'filled_amount') as filled_amount,
  response->'feeDerived' as fee_derived, response->'fromAccount' as from_account, response->>'placedState' as placed_state,
  case when state = 'rejected' then left(response::text, 300) end as rejection
from public.agent_orders, p where mode = 'live' and ts >= p.from_ts order by id;

-- CW-4  Nothing left in flight.  EXPECT: 0.
select count(*) as live_orders_open_over_2_min from public.agent_orders
where mode = 'live' and state in ('pending', 'new', 'partially_filled') and ts < now() - interval '2 minutes';

-- CW-5  The tick's own errors and the drift monitor since :from.  EXPECT: no agents.tick row naming trend-4h-live, revx, "pending",
-- "cannot be settled", "short of the gross", "balances unreadable", "rejected", "lease lost", "ESSENTIAL"; no agents.jev-drift row
-- (one means that entry was vetoed by design — report it); agents.crash rows only on other leases (pmrw*, quotes*), never the tick.
with p as (select timestamptz '2026-10-01 02:24:51+00' as from_ts)
select id, created_at, kind, left(message, 300) as message from public.ops_errors, p
where created_at >= p.from_ts and kind like 'agents.%' order by id;

-- CW-6  The book against the account: what the venue should hold, from the record (funding $100 on 2026-09-25, nothing else
-- in or out).  Compare with the probe's revx.balances.rows (USD total within $0.01; each coin's total minus booked_base at or
-- above 0 and under one base step per settled live buy: 1e-8 BTC/ETH, 1e-6 SOL/AVAX).  If Davies tops up, add the top-up.
select 100
  - coalesce(sum(case when side = 'buy' then coalesce(nullif(coalesce(response->>'filled_amount', response->'view'->>'filled_amount'), '')::numeric, filled_base * avg_fill_price) end), 0)
  + coalesce(sum(case when side = 'sell' then coalesce(nullif(coalesce(response->>'filled_amount', response->'view'->>'filled_amount'), '')::numeric, filled_base * avg_fill_price) end), 0)
  - coalesce(sum(case when coalesce(response->>'fee_currency', response->'view'->>'fee_currency') = 'USD' or response ? 'feeDerived' then fee_usd end), 0) as expected_usd_at_venue,
  count(*) as live_fills
from public.agent_orders where mode = 'live' and venue = 'revx' and state in ('filled', 'partially_filled');
select split_part(symbol, '/', 1) as asset,
  sum(case when side = 'buy' then filled_base else -filled_base end) as booked_base,
  sum(case when side = 'buy' then coalesce(nullif(coalesce(response->>'filled_quantity', response->'view'->>'filled_quantity'), '')::numeric, filled_base) else -filled_base end)
  - sum(case when side = 'buy' and coalesce(response->>'fee_currency', response->'view'->>'fee_currency') = split_part(symbol, '/', 1)
             then coalesce(nullif(coalesce(response->>'total_fee', response->'view'->>'total_fee'), '')::numeric, 0) else 0 end) as expected_at_venue
from public.agent_orders where mode = 'live' and venue = 'revx' and state in ('filled', 'partially_filled') group by 1 order by 1;
-- (Baseline 2026-10-01: expected_usd_at_venue 99.34 over 2 fills; SOL booked 0.000000, expected 0.000000.)

-- CW-7  The UK touch over the week, per coin (AVAX's above all).  EXPECT for AVAX near the 2026-10-01 baseline: median 9.71 bps,
-- p99 14.28, 0.036 % over the 50 bps guard (BTC 1.59, ETH 1.82, SOL 3.53).
with p as (select timestamptz '2026-10-01 02:24:51+00' as from_ts)
select symbol, count(*) as samples,
  round(percentile_cont(0.5) within group (order by (revx_ask - revx_bid) / ((revx_ask + revx_bid) / 2) * 1e4)::numeric, 2) as median_bps,
  round(percentile_cont(0.99) within group (order by (revx_ask - revx_bid) / ((revx_ask + revx_bid) / 2) * 1e4)::numeric, 2) as p99_bps,
  round(100.0 * avg(case when (revx_ask - revx_bid) / ((revx_ask + revx_bid) / 2) * 1e4 > 50 then 1 else 0 end), 3) as pct_over_50bps
from public.agent_basis, p where ts >= p.from_ts and symbol in ('BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD') group by symbol order by symbol;
-- And AVAX's 30-day median of the UK daily candles (keyless, closed UK days only): python3 book_30d.py (scratch, prints only).
-- Baseline 2026-10-01: AVAX $31,007 (22 of 30 days under $100k), BTC $1.82m, ETH $1.06m, SOL $631k.

-- CW-8  The minute job.  EXPECT: one 'succeeded' run a minute (10,080 in 7 days), no other status.
with p as (select timestamptz '2026-10-01 02:24:51+00' as from_ts)
select j.jobname, r.status, count(*) as runs, min(r.start_time) as first, max(r.start_time) as last
from cron.job_run_details r join cron.job j on j.jobid = r.jobid, p
where j.jobname = 'edge-calls-every-minute' and r.start_time >= p.from_ts group by 1, 2 order by 1, 2;

-- CW-9  The ledger's own watch (item 3): the live row's four rule_action words per bar beside the control's.  Compare the
-- WORDS only (rule_action), never a price, a fill or a fee: pairing fills is EX-GAP's frozen reading (no-peek).
with p as (select timestamptz '2026-10-01 02:24:51+00' as from_ts)
select l.bar_start, l.symbol, l.rule_action as live_rule, c.rule_action as control_rule, l.final_action as live_final, l.risk_allowed as live_allowed
from public.agent_decisions l join public.agent_decisions c
  on c.strategy_id = 'trend-4h' and c.symbol = l.symbol and c.bar_start = l.bar_start and coalesce(c.numbers->>'kind', 'bar') = 'bar', p
where l.strategy_id = 'trend-4h-live' and l.ts >= p.from_ts and coalesce(l.numbers->>'kind', 'bar') = 'bar' and l.rule_action <> c.rule_action
order by 1, 2;
-- EXPECT: no rows, or rows explained by a position one row holds and the other does not (e.g. the control entered a coin the live
-- cap refused — the reason is in CW-2).
