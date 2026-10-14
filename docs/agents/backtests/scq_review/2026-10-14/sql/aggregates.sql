-- 2026-10-14 stablecoin quotes review: the aggregate reads the review quotes, SELECT only, through the Supabase
-- connector, 2026-10-14 04:01-04:12 UTC. Each output is quoted under its statement.

-- H1. Health: the spec rows, each instance's state and the replica checks.
select id, display_name, engine, capital_gbp, gov, start, enabled, rules from public.agent_quote_twin_specs order by display_order;
-- pr5 "Stablecoin quotes" £1,200; p50 "variant-1" £600; take50 "variant-2" £600, rules {"take":{"from":"2026-10-04T16:00:00Z"}};
-- d "variant-3" £1,800, engine ruled-d, four keys. All enabled.
select 'pr5' t, state->'paperCheck'->'mismatches' m from public.agent_quote_twin_pr5_sim
union all select 'p50', state->'paperCheck'->'mismatches' from public.agent_quote_twin_p50_sim
union all select 'take50', state->'paperCheck'->'mismatches' from public.agent_quote_twin_take50_sim
union all select 'd', state->'paperCheck'->'mismatches' from public.agent_quote_twin_d_sim;
-- 46 / 46 / 46 / 0 (as known). Every _state and _sim last_error null; updated_at 04:00-04:02; LIVE's state 14 s old, no
-- error, governor {"live":"all"}; cb_quote_state and cb_hold_state last_minute 04:02 / 04:01, no error.

-- H2. TAKE's check K1: take50's orders before 2026-10-04 16:00 against p50's, EXCEPT both ways.
with a as (select ts, book, rung_side, k, leg, side, price, base_size, filled_base, state, fee_gbp from public.agent_quote_twin_take50_orders where ts < '2026-10-04 16:00'),
b as (select ts, book, rung_side, k, leg, side, price, base_size, filled_base, state, fee_gbp from public.agent_quote_twin_p50_orders where ts < '2026-10-04 16:00')
select (select count(*) from a), (select count(*) from b), (select count(*) from (select * from a except select * from b) x), (select count(*) from (select * from b except select * from a) y);
-- 3,360 / 3,360 / 0 / 0: K1 holds.

-- T1. Every take so far (request.take), all states.
select id, ts, book, rung_side, k, side, state, base_size, filled_base, avg_fill_price, fee_gbp, fair from public.agent_quote_twin_take50_orders where request ? 'take' order by id;
-- 5 rows, all USDT-GBP, all filled: 3423 (10-05 02:51 bid 0.1 %), 3440 (10-05 02:59 bid 0.2 %), 4112 (10-06 11:16 ask 0.1 %),
-- 5087 (10-08 02:59 bid 0.1 %), 5110 (10-08 05:53 bid 0.2 %); fees £0.045-0.05 each. None since 10-08 05:53.

-- P1. The paper engines and Coinbase's two paper tests: trips, P&L, worst trip, from LIVE's first minute and from TAKE's.
with t as (
 select 'pr5_paper' s, t_entry, t_exit, pnl_usd pnl, notional_usd nt, how from public.agent_quote_trips
 union all select 'pr5v_'||arm, t_entry, t_exit, pnl_usd, notional_usd, how from public.agent_quotev_trips
 union all select 'ruled_'||arm, t_entry, t_exit, pnl_usd, notional_usd, how from public.agent_quoted_trips
 union all select 'cb_quote', t_entry, t_exit, pnl_gbp, notional_gbp, how from public.cb_quote_trips
 union all select 'cb_hold', t_entry, t_exit, pnl_gbp, notional_gbp, how from public.cb_hold_trips)
select s, count(*) trips, count(*) filter (where pnl>0) won, round(sum(pnl),4) pnl, round(min(pnl),4) worst, min(t_entry), max(t_exit),
 count(*) filter (where t_entry>='2026-10-04 16:00') n_w, round(sum(pnl) filter (where t_entry>='2026-10-04 16:00'),4) pnl_w,
 count(*) filter (where t_entry>='2026-10-01 16:29:53') n_l, round(sum(pnl) filter (where t_entry>='2026-10-01 16:29:53'),4) pnl_l
from t group by s order by s;
-- pr5_paper 126 trips, 119 won, $11.7806, worst $-0.3459, 09-24 18:57 -> 10-14 01:00; from 10-04 16:00 65, $3.7457; from LIVE 71, $4.1212
-- pr5v_main 553, 469, $22.9550 (from LIVE 383, $7.5990); pr5v_top5 347, 302, $18.0776
-- ruled_v1 553, 469, $22.9550 (= pr5v_main to the cent); ruled_d 573, 488, $22.2581 (from LIVE 405, $8.0444)
-- cb_quote 10, 8, £0.5748, worst £-0.1525, 10-12 08:06 -> 10-13 18:06; cb_hold 2, 2, £0.0851 (its window from 10-13 00:00)
select 'cb_quote' s, * from public.cb_quote_days union all select 'cb_hold', * from public.cb_hold_days order by 1,2;
-- cb_quote 10-11 48 orders 0 fills; 10-12 463, 8 fills, 8 trips, £0.4897; 10-13 512, 3, 2, £0.0851; 10-14 50, 1, 0.
-- cb_hold 10-13 510 orders, 2 trips, £0.0851 (the same two trips as cb_quote: no closure in its window yet); 10-14 50.
select * from public.agent_quote_days order by day;
-- PR5's paper engine, orders a day (the view counts agent_quote_events kind 'order'): 09-24 440, 09-25 306, 09-28 466,
-- 09-29 343, 09-30 535, **10-01 714**, 10-02 575, 10-05 452, 10-06 519, 10-07 382, 10-08 591, 10-09 307, 10-12 203,
-- 10-13 233. The spec's condition 5 is "at most 700 orders on every day".
select date_trunc('day', t_entry)::date d, count(*) trips, count(*) filter (where notional_usd < 1.5) dust, round(sum(pnl_usd),4) pnl, count(*) filter (where how='taker') stops from public.agent_quote_trips where t_entry >= '2026-09-24' group by 1 order by 1;
-- dust (notional under $1.50) trips first on 10-08: 10-08 5, 10-09 4, 10-12 2, 10-13 9, each +$0.0000-0.0002; stops 3 (10-07).

-- L1. LIVE's orders by UTC day.
select date_trunc('day', ts)::date d, count(*) n,
 count(*) filter (where coalesce((response->>'wouldBeRefused')::boolean,false)) not_sent,
 count(*) filter (where state='rejected' and not coalesce((response->>'wouldBeRefused')::boolean,false)) venue_rej,
 count(*) filter (where state='pending') pending,
 count(*) filter (where filled_base>0 and leg='entry') entry_fills, count(*) filter (where filled_base>0 and leg='exit') exit_fills,
 count(*) filter (where filled_base>0 and leg='stop') stop_fills, count(*) filter (where leg='convert') conv,
 count(*) filter (where filled_base>0 and leg='entry' and filled_base*coalesce(avg_fill_price,price) < 1) dust_entry_fills
from public.agent_quote_live_orders where mode='live' group by 1 order by 1;
-- 10-01 167 | 10-02 376 (14 venue refusals, 13 conversions) | 10-04 24 | 10-05 452 (7 not sent) | 10-06 516 (8) | 10-07 951 (1)
-- | 10-08 579 (5; 3 stops; 5 dust entries) | 10-09 295 (1; 4 dust) | 10-11 24 | 10-12 211 (2; 2 dust) | 10-13 237 (2; 25 entry
-- fills, 15 of them dust) | 10-14 to 03:57 35 (1 conversion, a top-up). Nothing pending; no venue refusal since 10-02.

-- L2. LIVE's events by kind and cause.
select kind, case when detail::text like '%paper engine''s last minute%' then 'stale paper' when detail::text like '%GBP/USD minute%' then 'fx dark'
 when detail::text like '%de-peg%' or detail::text like '% from fair%' then 'de-peg' when kind='skip' then left(coalesce(detail->>'reason', detail::text),60)
 when kind='deadman' then 'deadman' else left(detail::text,60) end cat, count(*) n, count(distinct minute) minutes,
 count(*) filter (where minute >= '2026-10-09 16:00') since_1009, min(minute), max(minute)
from public.agent_quote_live_events where mode='live' group by 1,2 order by 1, n desc;
-- deadman 48 (all 10-07 02:54-20:34, none since); stale paper 496 rows / 248 minutes (10-02 -> 10-12 18:32; 4 rows since
-- 10-09 16:00, the 10-12 18:31 lease error); de-peg 19 (10-08 16:17-16:36); fx dark 8 (the weekend edges); the 24-hour stop's
-- guard 4 (10-08 02:56-03:02); skips: no USDT to sell 36 (1 since 10-09), no USDC 22 (none since 10-06), not enough GBP 2.
select date_trunc('day', created_at)::date d, kind, count(*), min(created_at), max(created_at), left(min(message),160) from public.ops_errors
where created_at >= '2026-10-09 16:00' and (kind like '%quote%' or kind like '%deadman%' or kind like '%cb_%' or kind like 'monitor%') group by 1,2 order by 1,2;
-- 10-09 agents.quotes_twins 2 (p50x1's last two turns before 0109); 10-10 agents.cb_books 1, agents.quotes_twins 1 (timeout);
-- 10-11 agents.cb_rec 1, agents.quotes_twins 1 (timeouts); 10-12 agents.quotes 1 (the paper engine's lease claim). No
-- agents.quotes_live and no monitor.deadman row since 10-09.

-- L3. The same decisions, LIVE against PR5's twin: entries joined on (book, side, k, paper_oid, paper_live); a "real"
-- fill is more than 0.2 coins (a £0.10 print fills about 0.13).
with l as (select book, rung_side, k, paper_oid, paper_live, min(ts) ts, bool_or(filled_base>0) lf, bool_or(filled_base>0.2) lf1 from public.agent_quote_live_orders where mode='live' and leg='entry' and paper_oid is not null group by 1,2,3,4,5),
t as (select book, rung_side, k, paper_oid, paper_live, bool_or(filled_base>0) tf, bool_or(filled_base>0.2) tf1 from public.agent_quote_twin_pr5_orders where mode='live' and leg='entry' and paper_oid is not null and ts >= '2026-10-01 16:29:53' group by 1,2,3,4,5),
j as (select l.*, t.tf, t.tf1 from l join t on l.book=t.book and l.rung_side=t.rung_side and l.k=t.k and l.paper_oid=t.paper_oid and l.paper_live=t.paper_live)
select case when ts >= '2026-10-09 16:00' then 'since_1009' else 'before' end span, book, rung_side, count(*) both_dec,
 count(*) filter (where lf1) live_real, count(*) filter (where tf1) twin_real, count(*) filter (where lf1 and tf1) both_real,
 count(*) filter (where lf1 and not tf1) live_only_real, count(*) filter (where tf1 and not lf1) twin_only_real,
 count(*) filter (where lf and not lf1) live_dust, count(*) filter (where tf and not tf1) twin_dust
from j group by rollup(1,(2,3)) order by 1,2,3;
-- before 10-09 16:00: 2,268 decisions both sent; real fills LIVE 28, twin 22, both 19, LIVE only 9 (6 of them USDC-GBP bids),
-- twin only 3; dust LIVE 6, twin 5. Since: 444 decisions; real fills LIVE 10, twin 9, both 9, LIVE only 1, twin only 0;
-- dust LIVE 12, twin 9. All 2,712: LIVE 38, twin 31, both 28.

-- L4. Post-only orders refused at the book (LIVE: wouldBeRefused, never sent; twins: state rejected), and minutes to the
-- rung's next order.
with r as (
 select 'live' t, id, ts, book, rung_side, k, leg from public.agent_quote_live_orders where mode='live' and coalesce((response->>'wouldBeRefused')::boolean,false)
 union all select 'pr5', id, ts, book, rung_side, k, leg from public.agent_quote_twin_pr5_orders where mode='live' and state='rejected'
 union all select 'p50', id, ts, book, rung_side, k, leg from public.agent_quote_twin_p50_orders where mode='live' and state='rejected'
 union all select 'take50', id, ts, book, rung_side, k, leg from public.agent_quote_twin_take50_orders where mode='live' and state='rejected'),
nx as (select r.*,
 (select min(o.ts) from public.agent_quote_live_orders o where r.t='live' and o.mode='live' and o.book=r.book and o.rung_side=r.rung_side and o.k=r.k and o.ts>r.ts) n_live,
 (select min(o.ts) from public.agent_quote_twin_pr5_orders o where r.t='pr5' and o.mode='live' and o.book=r.book and o.rung_side=r.rung_side and o.k=r.k and o.ts>r.ts) n_pr5,
 (select min(o.ts) from public.agent_quote_twin_p50_orders o where r.t='p50' and o.mode='live' and o.book=r.book and o.rung_side=r.rung_side and o.k=r.k and o.ts>r.ts) n_p50,
 (select min(o.ts) from public.agent_quote_twin_take50_orders o where r.t='take50' and o.mode='live' and o.book=r.book and o.rung_side=r.rung_side and o.k=r.k and o.ts>r.ts) n_take50
 from r)
select t, leg, count(*) n, count(*) filter (where ts>='2026-10-09 16:00') since_1009,
 percentile_cont(0.5) within group (order by extract(epoch from coalesce(n_live,n_pr5,n_p50,n_take50)-ts)/60) med_min_to_next,
 count(*) filter (where extract(epoch from coalesce(n_live,n_pr5,n_p50,n_take50)-ts) > 3600) over_1h
from nx group by 1,2 order by 1,2;
-- from each row's first minute: LIVE entries 20 (median 33 min to the rung's next order), exits 6 (median 134 min, 4 over an
-- hour); pr5 42 / 24; p50 55 / 29; take50 52 / 29. From LIVE's first minute: pr5 21 entries / 8 exits, p50 25 / 11.

-- L5. What each refused exit cost against filling at its own price: the next exit or stop fill on its rung,
-- (refused price - fill price) x coins for a sell, the reverse for a buy.
with r as (
 select 'live' t, id, ts, book, rung_side, k, side, price::float8 p, base_size::float8 q from public.agent_quote_live_orders where mode='live' and leg='exit' and coalesce((response->>'wouldBeRefused')::boolean,false)
 union all select 'pr5', id, ts, book, rung_side, k, side, price::float8, base_size::float8 from public.agent_quote_twin_pr5_orders where mode='live' and leg='exit' and state='rejected'
 union all select 'p50', id, ts, book, rung_side, k, side, price::float8, base_size::float8 from public.agent_quote_twin_p50_orders where mode='live' and leg='exit' and state='rejected'),
f as (
 select 'live' t, ts, book, rung_side, k, avg_fill_price::float8 a, filled_base::float8 fq, filled_at from public.agent_quote_live_orders where mode='live' and leg in ('exit','stop') and filled_base>0
 union all select 'pr5', ts, book, rung_side, k, avg_fill_price::float8, filled_base::float8, filled_at from public.agent_quote_twin_pr5_orders where mode='live' and leg in ('exit','stop') and filled_base>0
 union all select 'p50', ts, book, rung_side, k, avg_fill_price::float8, filled_base::float8, filled_at from public.agent_quote_twin_p50_orders where mode='live' and leg in ('exit','stop') and filled_base>0),
j as (select r.*, (select f.a from f where f.t=r.t and f.book=r.book and f.rung_side=r.rung_side and f.k=r.k and f.ts>r.ts order by f.ts limit 1) a,
 (select f.fq from f where f.t=r.t and f.book=r.book and f.rung_side=r.rung_side and f.k=r.k and f.ts>r.ts order by f.ts limit 1) fq,
 (select f.filled_at from f where f.t=r.t and f.book=r.book and f.rung_side=r.rung_side and f.k=r.k and f.ts>r.ts order by f.ts limit 1) fat from r)
select t, count(*) n, round(sum(case when side='sell' then (p-a) else (a-p) end * least(q,fq))::numeric,4) cost_gbp,
 round(sum(case when side='sell' then (p-a) else (a-p) end * least(q,fq)) filter (where ts>='2026-10-09 16:00')::numeric,4) cost_since_1009,
 round(avg(extract(epoch from fat-ts)/60)::numeric,0) mean_min_to_fill,
 count(*) filter (where case when side='sell' then (p-a) else (a-p) end > 0) worse, count(*) filter (where case when side='sell' then (p-a) else (a-p) end < 0) better
from j where a is not null group by t order by t;
-- live 6 refused exits, cost £0.0066 (since 10-09: £0.0238), mean 418 min to the fill, 2 worse, 4 better
-- p50 29, £0.4575 (since 10-09 £0.1209), 202 min, 19 worse, 10 better; pr5 24, £1.1129 (£0.2202), 190 min, 19 worse, 5 better.
-- The 10-13 case: LIVE 4799/4800 (USDC-GBP bid rungs' exits at 0.7558, 06:50) and p50 6206/6207 refused; the next exit
-- went at 11:47 (LIVE) and the rungs sold at 0.7549 (LIVE, 15:12) and 0.7542-0.7543 (p50, pr5, 18:25). take50, turning a
-- minute later, placed 0.7557 at 06:51, which rested and filled at 07:28.

-- D1. The £0.10 prints: UK prints a day, those worth under £0.11, and the pounds of the rest.
select date_trunc('day', ts)::date d, count(*) prints, count(*) filter (where price*qty < 0.11) dust_prints, round(sum(price*qty) filter (where price*qty >= 0.11)::numeric,0) gbp_non_dust
from public.agent_quote_prints where ts >= '2026-10-01' group by 1 order by 1;
-- 10-01 -> 10-07: 0-2 a day. 10-08 221 of 470; 10-09 402 of 670; 10-10 (Sat) 484 of 636; 10-11 (Sun) 460 of 630; 10-12 446 of
-- 617; 10-13 459 of 646. The rest: £74,502-£396,052 a weekday, £89,398 and £116,040 on the weekend of 10-10/11.
select book, ts, price, qty, side, round((price*qty)::numeric,6) gbp from public.agent_quote_prints where book='USDT-GBP' and ts between '2026-10-13 09:36' and '2026-10-13 09:49' order by ts;
-- The pattern: 09:39:11 buy 0.13253 at 0.7546 (£0.100007); 09:39:29 sell 0.13264 at 0.7539 (£0.099997: LIVE's fill 4849);
-- 09:43:39 sell 0.13266 at 0.7538 (£0.099999) ... a counterparty sizing each order to £0.10 at the price it meets.
select id, ts, leg, side, k, state, base_size, filled_base, avg_fill_price, price, response->>'filled_amount' amt from public.agent_quote_twin_pr5_orders
where book='USDT-GBP' and ts between '2026-10-13 09:30' and '2026-10-13 09:50' and filled_base>0 order by id;
-- 6006 entry buy at 0.7539, filled 0.13266 (the 09:43:39 print's size) for £0.11; 6007 exit sell at 0.7546, filled
-- 0.13244 for £0.09. LIVE's same decision (4849) bought 0.13264 for £0.1000 and sold 0.13253 for £0.1000 (4850).

-- X1. GBP/USD minutes PR5 stored around the weekend (agent_quote_inputs kind 'fx'): to 2026-10-09 21:29, one at 22:59, then
-- from 2026-10-11 23:00. The paper engine's minutes (agent_quote_minutes) on 10-10 had no X at all (dark, a Saturday).
