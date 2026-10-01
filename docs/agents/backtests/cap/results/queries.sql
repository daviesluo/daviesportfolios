-- Trend family status, 2026-10-01. Every statement below was run read-only (SELECT only) through the Supabase connector,
-- project flmvxigozjuizpckllvk, between 00:21 and 00:40 UTC on 2026-10-01 (Q0's clock). Outputs are pasted beneath each
-- statement as comments. No write, no pg_net, no cron function, no vault read, no migration, no Edge call.
-- No-peek list honoured: agent_maker_probes is read only inside Q13 (MX-1 statement C, exits, a count; the columns read
-- are symbol, side, ts, order_id, strategy_id, venue - no outcome column); EX-GAP is a count (Q14) that selects no price,
-- fee or time; no agent_quote*, pm_rw*, agent_book_levels, yt_* or pm_view_* table was read.

-- Q0. The database clock.
select now() as db_now;
-- db_now 2026-10-01 00:21:36.147891+00

-- Q1. The four rows.
select id, kind, venue, signal_venue, mode, symbols, capital_usd, params, created_at, updated_at, retired_at
from public.agent_strategies order by id;
-- momentum-1d   momentum-1d revx kraken paper [BTC,ETH,SOL]          1000 {exitMax .3, jevGate false, enterMin .45, lookbackDays 30}   created 2026-09-20 18:23:35
-- trend-1h      trend-1h    revx kraken paper [BTC,ETH,SOL]          1000 {atrN 14, fast 20, slow 100, volN 42, atrStop 3, exitMax .3, jevGate false, enterMin .45, breakoutUp 55, breakoutDown 20}   created 2026-09-20 18:23:35
-- trend-4h      trend-4h    revx kraken paper [BTC,ETH,SOL,AVAX,SUI] 1000 {atrN 14, fast 20, slow 100, volN 42, atrStop 3, exitMax .3, enterMin .45, breakoutUp 55, breakoutDown 20}   created 2026-09-20 18:23:35
-- trend-4h-live trend-4h    revx kraken live  [BTC,ETH,SOL,AVAX]     100  {same as trend-4h}   created 2026-09-24 22:51:15, updated 2026-09-25 02:42:24
-- (retired_at null on all four; updated_at on the paper rows is 2026-09-23 00:52:16 - migrations 0066/0067 do not touch it)

-- Q2. The caps.
select * from public.agent_risk;
-- global_pause false | max_exposure_usd 25 | paper_exposure_usd 5000 | daily_loss_limit_usd 5 | paper_daily_loss_limit_usd 100
-- max_orders_per_day 40 | live_confirmed_at 2026-09-24 22:53:09.568392+00 | updated_at 2026-09-25 02:42:24.600822+00

-- (Capital-change instants, from GitHub Actions `migrations.yml` runs, not SQL: 0066 in run 89, 2026-09-27 20:00:14-20:00:37Z;
--  0067 in run 90, 2026-09-27 21:35:14-21:35:40Z. The live row's capital 50 -> 100: agent_risk/agent_strategies updated_at 2026-09-25 02:42:24.)

-- Q3. Decisions per row, by rule_action and outcome.
select strategy_id, count(*) as decisions, min(ts) as first_ts, max(ts) as last_ts,
 count(*) filter (where (numbers->>'kind')='protective') as protective,
 count(*) filter (where rule_action='enter') as rule_enter, count(*) filter (where rule_action='exit') as rule_exit,
 count(*) filter (where rule_action='hold') as rule_hold, count(*) filter (where final_action='enter') as final_enter,
 count(*) filter (where final_action='exit') as final_exit, count(*) filter (where final_action='hold') as final_hold,
 count(*) filter (where final_action<>'hold' and risk_allowed) as acted_allowed,
 count(*) filter (where final_action<>'hold' and not risk_allowed) as acted_refused
from public.agent_decisions group by strategy_id order by strategy_id;
-- row           decisions first_ts                 last_ts                 prot rule_enter rule_exit rule_hold final_enter final_exit final_hold allowed refused
-- momentum-1d   36        2026-09-20 18:24:09      2026-10-01 00:00:03     0    4          0         32        3           0          33         3       0
-- trend-1h      735       2026-09-20 18:24:15      2026-10-01 00:00:03     0    7          5         723       5           5          725        10      0
-- trend-4h      305       2026-09-20 18:24:15      2026-10-01 00:00:04     0    4          4         297       4           4          297        8       0
-- trend-4h-live 152       2026-09-24 22:52:04      2026-10-01 00:00:04     0    1          1         150       1           1          150        2       0

-- Q4. Every decision that was not a plain hold (rule or final action enter/exit).
select id, ts, strategy_id, symbol, mode, bar_start, rule_action, final_action, risk_allowed, risk_reason, provider,
 left(rule_reason,140) as rule_reason, left(final_reason,260) as final_reason
from public.agent_decisions where rule_action<>'hold' or final_action<>'hold' order by strategy_id, ts;
-- momentum-1d  #1    2026-09-20 18:24 BTC bar 09-19  enter->hold  model vetoed (P(healthy)=0.15 < 0.6)          [v1 question, 0.60]
-- momentum-1d  #2    2026-09-20 18:24 ETH bar 09-19  enter->enter model agrees (P=0.92)
-- momentum-1d  #3    2026-09-20 18:24 SOL bar 09-19  enter->enter model agrees (P=0.93)
-- momentum-1d  #45   2026-09-21 00:00 BTC bar 09-20  enter->enter model agrees (P=0.92)
-- trend-1h     #69   2026-09-21 01:00 ETH bar 00:00  enter->enter (P=0.95)
-- trend-1h     #106  2026-09-21 09:00 BTC bar 08:00  enter->enter (P=0.95)
-- trend-1h     #108  2026-09-21 09:00 SOL bar 08:00  enter->hold  model vetoed (P(healthy)=0.59 < 0.6)          [v1, 0.60]
-- trend-1h     #131  2026-09-21 14:00 SOL bar 13:00  enter->hold  model vetoed (P(healthy)=0.59 < 0.6)          [v1, 0.60]
-- trend-1h     #174  2026-09-21 21:00 SOL bar 20:00  enter->enter (P=0.95)
-- trend-1h     #217  2026-09-22 04:00 BTC bar 03:00  exit  ATR trailing stop (3xATR from high-water) [rule only]
-- trend-1h     #231  2026-09-22 05:00 ETH bar 04:00  exit  ATR trailing stop
-- trend-1h     #241  2026-09-22 08:00 SOL bar 07:00  exit  ATR trailing stop
-- trend-1h     #814  2026-09-25 12:00 SOL bar 11:00  enter->enter model agrees (P=0.56)                         [v2, 0.45, gated]
-- trend-1h     #1036 2026-09-26 10:00 SOL bar 09:00  exit  ATR trailing stop
-- trend-1h     #1244 2026-09-27 08:00 SOL bar 07:00  enter->enter model in shadow - agrees (P=0.74)            [v2, shadow since 0059]
-- trend-1h     #1384 2026-09-27 23:00 SOL bar 22:00  exit  ATR trailing stop
-- trend-4h     #83   2026-09-21 04:00 ETH bar 00:00  enter->enter (P=0.94)
-- trend-4h     #118  2026-09-21 12:00 BTC bar 08:00  enter->enter (P=0.95)
-- trend-4h     #120  2026-09-21 12:00 SOL bar 08:00  enter->enter (P=0.61)
-- trend-4h     #417  2026-09-23 16:00 ETH bar 12:00  exit  ATR trailing stop
-- trend-4h     #524  2026-09-24 04:00 BTC bar 00:00  exit  ATR trailing stop
-- trend-4h     #594  2026-09-24 12:00 SOL bar 08:00  exit  ATR trailing stop
-- trend-4h     #820  2026-09-25 12:00 SOL bar 08:00  enter->enter (P=0.59)                                     [v2, 0.45]
-- trend-4h     #1435 2026-09-28 08:00 SOL bar 04:00  exit  ATR trailing stop
-- trend-4h-live #830  2026-09-25 12:00 SOL bar 08:00 enter->enter (P=0.58)                                     [v2, 0.45]
-- trend-4h-live #1440 2026-09-28 08:00 SOL bar 04:00 exit  ATR trailing stop
-- (all risk_allowed true; risk_reason "within limits" on every acted decision, "hold" on the three vetoes)

-- Q5. Every decision by reason class (cooldown, too late, wide book, JEV-DRIFT, Jev veto, else the rule's own reason).
select strategy_id,
 case when rule_reason ilike 'cooling down%' then 'cooldown'
      when rule_reason ilike '%too late to enter%' then 'entry too late'
      when final_reason ilike '%book too wide%' then 'wide spread'
      when final_reason ilike '%JEV-DRIFT%' then 'jev-drift veto'
      when final_reason ilike '%model vetoed%' then 'jev veto'
      else regexp_replace(left(rule_reason,60), '[0-9.]+', '#', 'g') end as reason_class,
 rule_action, final_action, count(*) n
from public.agent_decisions group by 1,2,3,4 order by 1,5 desc;
-- momentum-1d   in position, momentum still positive   hold/hold   32 | #-day momentum positive  enter/enter 3 | jev veto enter/hold 1
-- trend-1h      #h trend not up                        hold/hold  367 | no close above prior #-bar high hold/hold 266 | in position, no exit condition hold/hold 90
--               ATR trailing stop exit/exit 5 | trend up, breakout, momentum positive enter/enter 5 | jev veto enter/hold 2
-- trend-4h      no close above prior #-bar high hold/hold 231 | in position, no exit condition hold/hold 62 | ATR trailing stop exit/exit 4
--               volatility extreme hold/hold 4 | trend up, breakout, momentum positive enter/enter 4
-- trend-4h-live no close above prior #-bar high hold/hold 133 | in position, no exit condition hold/hold 16
--               trend up, breakout, momentum positive enter/enter 1 | ATR trailing stop exit/exit 1 | volatility extreme hold/hold 1
-- => 0 cooldown, 0 too late, 0 wide spread, 0 JEV-DRIFT vetoes, 0 cap / daily-loss / paper-exposure refusals (Q3: acted_refused 0).

-- Q6. Jev shadow, JEV-DRIFT bands, transports.
select strategy_id,
 count(*) filter (where final_reason ilike '%model in shadow%') as shadow_asked,
 count(*) filter (where final_reason ilike '%would veto%') as shadow_would_veto,
 count(*) filter (where final_reason ilike '%model in shadow — agrees%') as shadow_agrees,
 count(*) filter (where final_reason ilike '%model in shadow — no answer%') as shadow_no_answer,
 count(*) filter (where numbers ? 'jevBand') as with_jevband,
 count(*) filter (where (numbers->'jevBand'->>'inBand')='false') as jevband_out,
 count(*) filter (where (numbers->'jevBand'->>'inBand')='true') as jevband_in,
 count(*) filter (where rule_action='enter' and provider in ('openrouter','typesafe')) as entries_answered,
 count(*) filter (where rule_action='enter' and provider='typesafe') as answered_by_fallback,
 count(*) filter (where rule_action='enter' and provider='none') as no_transport,
 count(*) filter (where rule_action='enter' and ts >= '2026-09-23 00:52:20+00') as rule_enter_since_v2
from public.agent_decisions group by strategy_id order by strategy_id;
-- row           shadow_asked would_veto agrees no_answer with_jevband out in answered fallback none since_v2
-- momentum-1d   0            0          0      0         0            0   0  4        0        0    0
-- trend-1h      1            0          1      0         0            0   0  7        0        0    2
-- trend-4h      0            0          0      0         0            0   0  4        0        0    1
-- trend-4h-live 0            0          0      0         0            0   0  1        0        0    1
-- (No entry signal on any row since 2026-09-27 08:00 UTC, before JEV-DRIFT went live on 2026-09-28, so no decision carries jevBand.)

-- Q7. ops_errors since 2026-09-24, by kind.
select kind, count(*) n, min(created_at) first_at, max(created_at) last_at
from public.ops_errors where created_at >= '2026-09-24 00:00:00+00' group by kind order by n desc;
-- agents.crash        4  2026-09-28 04:11:00 -> 2026-09-29 15:51:00
-- agents.tick         2  2026-09-24 08:20:10 -> 2026-09-24 10:05:21
-- agents.quotes_live  1  2026-09-24 12:31:46
-- data.load.error     1  2026-09-29 18:02:46
-- (no agents.jev-drift row)

-- Q8. Those rows' messages (the tick's and the crashes').
select id, created_at, kind, symbol, left(message, 300) as message, left(context::text, 300) as context
from public.ops_errors where created_at >= '2026-09-24 00:00:00+00' and kind in ('agents.crash','agents.tick','data.load.error') order by created_at;
-- 349 2026-09-24 08:20:10 agents.tick  LEASE CLAIM FAILED - agent_locks: Signal timed out.; no stop and no decision this turn ...
-- 350 2026-09-24 10:05:21 agents.tick  kraken: quotes Signal timed out.
-- 352 2026-09-28 04:11:00 agents.crash connection reset on agent_locks?name=eq.pmrw     (RW's call, not the tick)
-- 353 2026-09-28 20:52:00 agents.crash connection reset on agent_locks?name=eq.pmrw-e   (RW-E's call)
-- 354 2026-09-29 05:01:00 agents.crash connection reset on agent_locks?name=eq.pmrw-x   (RW-X's call)
-- 355 2026-09-29 15:51:00 agents.crash connection reset on agent_locks?name=eq.quotesv  (PR5V's call)
-- 356 2026-09-29 18:02:46 data.load.error "signal timed out" (the browser, url "/")
-- => both agents.tick rows predate the live row (created 22:51:15 that day); none of the crashes is the tick's.

-- Q9. Every order of the four rows (each row's own figures; no pairing, no difference computed).
select o.id, o.ts, o.strategy_id, o.decision_id, o.symbol, o.mode, o.side, o.order_type, o.state, o.base_size, o.filled_base,
 o.avg_fill_price, o.fee_usd, o.requotes, o.filled_at, o.cancelled_at, o.updated_at, d.bar_start
from public.agent_orders o left join public.agent_decisions d on d.id=o.decision_id
where o.strategy_id in ('trend-4h','trend-4h-live','trend-1h','momentum-1d') order by o.strategy_id, o.ts;
-- 23 rows, all state 'filled', requotes 0, none cancelled. Saved field by field in orders.json (input of pnl.py):
-- momentum-1d: 3 buys (ETH #1, SOL #2 at 2026-09-20 18:25; BTC #11 at 2026-09-21 00:01), no sell.
-- trend-1h: 5 buys, 5 sells (#13 #18 #23 #24 #25 #26 #33 #38 #40 #42).
-- trend-4h: 4 buys, 4 sells (#16 #19 #20 #27 #31 #32 #35 #43).
-- trend-4h-live: #37 buy SOL 2026-09-25 12:00:07.80, base_size 0.206799, filled_base 0.206612, avg 120.94, fee_usd 0.02261578;
--                #44 sell SOL 2026-09-28 08:00:04.64, base_size = filled_base 0.206612, avg 118, fee_usd 0.03.

-- Q10. The live orders' recorded keys (no values).
select id, side, state, (select array_agg(k order by k) from jsonb_object_keys(request) k) as request_keys,
 (select array_agg(k order by k) from jsonb_object_keys(response) k) as response_keys,
 case when jsonb_typeof(response->'view')='object' then (select array_agg(k order by k) from jsonb_object_keys(response->'view') k) end as view_keys
from public.agent_orders where mode='live' order by id;
-- 37 buy  filled request [base, clientOrderId, marketable, postOnly, price, side, symbol, timeInForce, touch]
--                response [average_fill_price, client_order_id, created_date, execution_instructions, fee_currency, filled_amount,
--                          filled_quantity, id, leaves_quantity, price, quantity, side, status, symbol, time_in_force, total_fee, type, updated_date]
-- 44 sell filled (same keys); no `view`, no `feeDerived`, no `fromAccount` on either. Only two live orders exist.

-- Q11. The live orders' settlement fields (request.touch and request.price deliberately NOT read: they are EX-GAP's inputs).
select id, side, state, base_size, filled_base, fee_usd, ts, filled_at, updated_at,
 response->>'status' as v_status, response->>'type' as v_type, response->>'time_in_force' as v_tif,
 response->>'quantity' as v_quantity, response->>'filled_quantity' as v_filled_quantity, response->>'leaves_quantity' as v_leaves,
 response->>'total_fee' as v_total_fee, response->>'fee_currency' as v_fee_currency,
 response ? 'feeDerived' as has_fee_derived, response ? 'fromAccount' as has_from_account,
 request->>'marketable' as marketable, request->>'postOnly' as post_only, request->>'timeInForce' as tif
from public.agent_orders where mode='live' order by id;
-- 37 buy  filled base_size 0.206799 filled_base 0.206612 fee_usd 0.02261578 ts 2026-09-25 12:00:07.803581 filled_at = ts
--         updated_at 2026-09-25 12:01:00.882 | venue: status filled, limit, ioc, quantity 0.206799, filled_quantity 0.206799,
--         leaves 0, total_fee 0.000187 SOL | feeDerived false, fromAccount false | marketable true, postOnly false, ioc
-- 44 sell filled base_size 0.206612 filled_base 0.206612 fee_usd 0.03 ts 2026-09-28 08:00:04.635928 filled_at = ts
--         updated_at 2026-09-28 08:01:00.778 | venue: status filled, limit, ioc, quantity 0.206612, filled_quantity 0.206612,
--         leaves 0, total_fee 0.03 USD | feeDerived false, fromAccount false | marketable true, postOnly false, ioc
-- D11: 0.206799 gross - 0.000187 SOL fee = 0.206612 booked, the whole of it sold. D12 not exercised (the fee was reported).
-- Pending: neither row is open now; each was last updated 53 s / 56 s after it was written (an upper bound on any pending spell).

-- Q12. The live row's missed bar decisions (every closed 4h bar x 4 coins since its first decided bar).
with bars as (
  select generate_series(timestamptz '2026-09-24 16:00:00+00', date_trunc('hour', now()) - interval '4 hours' - (extract(hour from now())::int % 4) * interval '1 hour', interval '4 hours') as bar_start
), syms as (select unnest(array['BTC/USD','ETH/USD','SOL/USD','AVAX/USD']) as symbol),
want as (select b.bar_start, s.symbol from bars b cross join syms s),
have as (select bar_start, symbol, count(*) n, min(ts) first_ts from public.agent_decisions where strategy_id='trend-4h-live' and coalesce(numbers->>'kind','bar')<>'protective' group by 1,2)
select count(*) as expected, count(h.n) as present, count(*) - count(h.n) as missing,
 sum(case when h.n>1 then 1 else 0 end) as duplicated, min(w.bar_start) as first_bar, max(w.bar_start) as last_bar,
 max(extract(epoch from (h.first_ts - (w.bar_start + interval '4 hours')))) filter (where w.bar_start > '2026-09-24 16:00+00') as max_lag_s,
 percentile_cont(0.5) within group (order by extract(epoch from (h.first_ts - (w.bar_start + interval '4 hours')))) filter (where w.bar_start > '2026-09-24 16:00+00') as median_lag_s,
 array_agg(w.bar_start::text || ' ' || w.symbol) filter (where h.n is null) as missing_list
from want w left join have h using (bar_start, symbol);
-- expected 152 | present 152 | missing 0 | duplicated 0 | bars 2026-09-24 16:00 -> 2026-09-30 20:00 | lag after the close: median 5.09 s, max 35.66 s

-- Q12b. The paper rows' bar decisions, present against expected, since each row's first decided bar.
with cfg as (
  select 'trend-4h'::text sid, interval '4 hours' bar, array['BTC/USD','ETH/USD','SOL/USD','AVAX/USD','SUI/USD'] syms
  union all select 'trend-1h', interval '1 hour', array['BTC/USD','ETH/USD','SOL/USD']
  union all select 'momentum-1d', interval '1 day', array['BTC/USD','ETH/USD','SOL/USD']
), first_bar as (
  select c.sid, c.bar, c.syms, (select min(bar_start) from public.agent_decisions d where d.strategy_id=c.sid and coalesce(d.numbers->>'kind','bar')<>'protective') fb from cfg c
), want as (
  select f.sid, gs as bar_start, unnest(f.syms) as symbol from first_bar f, generate_series(f.fb, now() - f.bar - interval '1 minute', f.bar) gs
)
select w.sid, count(*) expected, count(d.id) present, count(*) - count(d.id) missing,
 array_agg(w.bar_start::text || ' ' || w.symbol order by w.bar_start) filter (where d.id is null) as missing_list
from want w left join public.agent_decisions d on d.strategy_id=w.sid and d.bar_start=w.bar_start and d.symbol=w.symbol and coalesce(d.numbers->>'kind','bar')<>'protective'
group by w.sid order by w.sid;
-- momentum-1d 36/36, 0 missing
-- trend-1h   735/741, 6 missing: the 2026-09-22 15:00 and 16:00 bars x BTC/ETH/SOL (the tick outage of that day)
-- trend-4h   305/315, the 10 "missing" are AVAX and SUI bars of 09-20 12:00 -> 09-21 04:00, before 0039/0040 put them in the row

-- Q13. MX-1: eligible EXIT events so far - statement C of docs/agents/scripts/mx1/weekly.sql, restricted to side = 'sell'.
with p as (
  select p.symbol, p.side,
         d.bar_start + case s.kind when 'trend-4h' then interval '4 hours' when 'trend-1h' then interval '1 hour' end as bar_close
  from public.agent_maker_probes p
  join public.agent_orders o on o.id = p.order_id
  join public.agent_decisions d on d.id = o.decision_id
  join public.agent_strategies s on s.id = p.strategy_id
  where p.venue = 'revx' and p.ts >= timestamptz '2026-09-28 12:14:32+00' and p.ts < now() - interval '66 minutes'
    and s.kind in ('trend-4h', 'trend-1h') and p.symbol in ('BTC/USD', 'ETH/USD', 'SOL/USD')
    and coalesce(d.numbers->>'kind', '') <> 'protective' and coalesce(o.filled_base, 0) > 0
)
select count(distinct (symbol, bar_close)) as eligible_exit_events
from p where bar_close >= timestamptz '2026-09-28 12:14:32+00' and side = 'sell';
-- eligible_exit_events 0

-- Q14. EX-GAP: pairs so far (same symbol, side and decision bar_start; both rows filled; marketable). Count only.
with live as (
  select distinct d.symbol, o.side, d.bar_start from public.agent_orders o join public.agent_decisions d on d.id = o.decision_id
  where o.strategy_id = 'trend-4h-live' and coalesce(o.filled_base, 0) > 0 and (o.request->>'marketable') = 'true'
), ctrl as (
  select distinct d.symbol, o.side, d.bar_start from public.agent_orders o join public.agent_decisions d on d.id = o.decision_id
  where o.strategy_id = 'trend-4h' and o.state in ('filled','partially_filled') and coalesce(o.filled_base, 0) > 0 and (o.request->>'marketable') = 'true'
)
select (select count(*) from live join ctrl using (symbol, side, bar_start)) as pairs, (select count(*) from live) as live_fill_decisions;
-- pairs 2 | live_fill_decisions 2

-- Q15. Marks: the Revolut X UK mid in the loop's own agent_basis, newest row and the row at or before each capital change.
select tag, symbol, ts, revx_bid, revx_ask, (revx_bid + revx_ask)/2 as mid from (
  select 'now' as tag, b.* from (select distinct on (symbol) * from public.agent_basis where symbol in ('BTC/USD','ETH/USD','SOL/USD','AVAX/USD','SUI/USD') order by symbol, ts desc) b
  union all select 'T0066 2026-09-27 20:00:37' as tag, b.* from (select distinct on (symbol) * from public.agent_basis where symbol in ('BTC/USD','ETH/USD','SOL/USD') and ts <= '2026-09-27 20:00:37+00' order by symbol, ts desc) b
  union all select 'T0067 2026-09-27 21:35:40' as tag, b.* from (select distinct on (symbol) * from public.agent_basis where symbol in ('BTC/USD','ETH/USD','SOL/USD') and ts <= '2026-09-27 21:35:40+00' order by symbol, ts desc) b
) x order by tag, symbol;
-- now   2026-10-01 00:25:01  AVAX 10.8995 | BTC 83409.58 | ETH 2680.655 | SOL 118.092 | SUI 1.16125
-- T0066 2026-09-27 20:00:01  BTC 84720.26 | ETH 2691.115 | SOL 123.0315
-- T0067 2026-09-27 21:35:01  BTC 84590.915 | ETH 2686.57 | SOL 122.834

-- Q16. The UK touch the loop records every fifth minute (agent_basis), last 30 days, spread in bps of the mid.
select symbol, count(*) n, min(ts) first_ts, max(ts) last_ts,
 round(percentile_cont(0.5) within group (order by (revx_ask-revx_bid)/((revx_ask+revx_bid)/2)*1e4)::numeric, 2) as p50_bps,
 round(percentile_cont(0.9) within group (order by (revx_ask-revx_bid)/((revx_ask+revx_bid)/2)*1e4)::numeric, 2) as p90_bps,
 round(percentile_cont(0.99) within group (order by (revx_ask-revx_bid)/((revx_ask+revx_bid)/2)*1e4)::numeric, 2) as p99_bps,
 round(100.0*avg(case when (revx_ask-revx_bid)/((revx_ask+revx_bid)/2)*1e4 > 50 then 1 else 0 end)::numeric, 2) as pct_over_50bps,
 round(100.0*avg(case when (revx_ask-revx_bid)/((revx_ask+revx_bid)/2)*1e4 > 20 then 1 else 0 end)::numeric, 2) as pct_over_20bps
from public.agent_basis where revx_bid > 0 and revx_ask > 0 and ts >= now() - interval '30 days' group by symbol order by symbol;
-- AVAX n 2723 (09-21 13:15 -> 10-01 00:30) p50 9.71  p90 11.08 p99 14.28 | >50 bps 0.04 % | >20 bps 0.40 %
-- BTC  n 2949 (09-20 18:25 -> 10-01 00:30) p50 1.59  p90 2.41  p99 3.87  | 0.00 % | 0.07 %
-- ETH  n 2949                              p50 1.82  p90 2.70  p99 4.59  | 0.03 % | 0.14 %
-- SOL  n 2949                              p50 3.53  p90 4.66  p99 5.83  | 0.10 % | 0.14 %
-- SUI  n 2711 (09-21 14:15 -> 10-01 00:30) p50 23.57 p90 44.68 p99 67.61 | 6.05 % | 91.85 %
-- XRP  n 497  (09-20 18:25 -> 09-22 12:05) p50 5.93  p90 7.24  p99 18.33 | 0.80 % | 1.01 %

-- Schema reads used to write the statements above (information_schema, no data):
select table_name, column_name, data_type from information_schema.columns
where table_schema='public' and table_name in ('agent_decisions','agent_orders','ops_errors') order by table_name, ordinal_position;
select column_name from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations';
-- (version, statements, name, created_by, idempotency_key, rollback: no timestamp, hence the GitHub Actions times above)
