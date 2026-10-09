-- 2026-10-09 stablecoin quotes review: the aggregate reads the review quotes, SELECT only, through the Supabase
-- connector, 2026-10-09 15:50-16:15 UTC. Each output is quoted under its statement (the review's numbers).

-- A. The live account's orders by UTC day: rows, refused at the book and never sent, venue refusals, fills by leg.
select date_trunc('day', ts)::date d, count(*) n,
 count(*) filter (where coalesce((response->>'wouldBeRefused')::boolean,false)) not_sent,
 count(*) filter (where state='rejected' and not coalesce((response->>'wouldBeRefused')::boolean,false)) venue_rej,
 count(*) filter (where filled_base>0 and leg='entry') entry_fills, count(*) filter (where filled_base>0 and leg='exit') exit_fills,
 count(*) filter (where filled_base>0 and leg='stop') stop_fills, count(*) filter (where leg='convert') conv
from public.agent_quote_live_orders where mode='live' group by 1 order by 1;
-- 10-01 167 0 0 2 2 0 2 | 10-02 376 0 14 8 8 0 13 | 10-04 24 0 0 0 0 0 0 | 10-05 452 7 0 2 1 0 0 | 10-06 516 8 0 8 10 0 1
-- 10-07 951 1 0 4 2 0 0 | 10-08 579 5 0 11 13 3 0 | 10-09 (to 15:46) 254 1 0 7 8 0 0

-- B. The same decision, live against PR5's twin: entry orders joined on (book, side, k, paper_oid, paper_live), from the
-- live account's first order. Totals: live 2,428 decisions, twin 2,357, both 2,268; filled live 41 (33 of £1 or more),
-- twin 34; both 23; live only 10 (9 of £1 or more); twin only 3; refused at the book and never sent: live 18, twin 19.
-- USDC-GBP bids: live 7 fills (all of £1 or more), the twin none (6 of the 7 on decisions both sent).
with l as (select book, rung_side, k, paper_oid, paper_live, bool_or(filled_base>0) lf, max(filled_base*coalesce(avg_fill_price,price)) lgbp from public.agent_quote_live_orders where mode='live' and leg='entry' and paper_oid is not null group by 1,2,3,4,5),
t as (select book, rung_side, k, paper_oid, paper_live, bool_or(filled_base>0) tf from public.agent_quote_twin_pr5_orders where mode='live' and leg='entry' and paper_oid is not null and ts >= '2026-10-01 16:29:53' group by 1,2,3,4,5)
select coalesce(l.book,t.book) book, coalesce(l.rung_side,t.rung_side) side, count(l.paper_oid) live_dec, count(t.paper_oid) twin_dec,
 count(*) filter (where lf) live_fill, count(*) filter (where tf) twin_fill, count(*) filter (where lf and tf) both_fill,
 count(*) filter (where lf and t.paper_oid is not null and not tf) live_only, count(*) filter (where tf and l.paper_oid is not null and not lf) twin_only
from l full join t on l.book=t.book and l.rung_side=t.rung_side and l.k=t.k and l.paper_oid=t.paper_oid and l.paper_live=t.paper_live
group by rollup(1,2) order by 1,2;

-- C. The paper engines' own trips (USD), all and closed from 2026-10-02 16:00 UTC.
select 'pr5_paper', count(*), count(*) filter (where pnl_usd>0), round(sum(pnl_usd),4), count(*) filter (where t_exit >= '2026-10-02 16:00'), round(sum(pnl_usd) filter (where t_exit >= '2026-10-02 16:00'),4) from public.agent_quote_trips;
-- 99 trips, 95 won, $10.9875; 7 days 41, $3.1971; no stop.
select arm, count(*), count(*) filter (where pnl_usd>0), round(sum(pnl_usd),4), count(*) filter (where t_exit >= '2026-10-02 16:00'), round(sum(pnl_usd) filter (where t_exit >= '2026-10-02 16:00'),4) from public.agent_quotev_trips group by arm;
-- PR5V main 381, 324, $20.2806 (7 days 198, $4.7642); top5 246, 217, $15.7208 (129, $4.0824).
select arm, count(*), count(*) filter (where pnl_usd>0), round(sum(pnl_usd),4), count(*) filter (where t_exit >= '2026-10-02 16:00'), round(sum(pnl_usd) filter (where t_exit >= '2026-10-02 16:00'),4) from public.agent_quoted_trips group by arm;
-- rule D v1 381, 324, $20.2806 (198, $4.7642); d 401, 341, $19.5203 (212, $4.6120). v1's trips EXCEPT PR5V main's: 0 rows
-- both ways (compared on book, side, k, t_entry, t_exit, pnl_usd to 6 dp).

-- D. Check K1 (TAKE): take50's orders before 2026-10-04 16:00 against p50's on (ts, book, rung_side, k, leg, side,
-- price, base_size, filled_base, state, fee_gbp), EXCEPT both ways: 0 and 0 of 3,360 rows. TAKE's takes so far
-- (request->>'take'): 5, ids 3423, 3440, 4112, 5087, 5110, all USDT-GBP, all filled.

-- E. The paper engine's lag (agent_quote_minutes, USDT-GBP, recorded_at - minute) by day from 10-02 16:00: median
-- 86.5-86.7 s every day; minutes over 120 s: 10-03 2, 10-05 1, 10-06 1, 10-07 220 (64 over 180 s), 10-08 7, 10-09 0.

-- F. GBP/USD's daily closes (agent_quote_inputs kind 'fx', the last minute of each UTC day), 2026-09-22 → 10-09:
-- 15 daily log returns, standard deviation 33.1 bps, mean absolute 26.5 bps.

-- G. ops_errors of kinds like '%quote%' or '%deadman%' from 10-01, by day: quotes_live 10-01 2, 10-02 2, 10-07 28,
-- 10-08 17 (16:04-16:21 UTC: cancels the venue still showed new, rungs frozen; orders answering 404); quotes_twins
-- 10-03 2, 10-07 17, 10-08 1, 10-09 1 (one 502 each); monitor.deadman 10-07 85.

-- H. The live account's orders whose cancel was asked 2026-10-08 15:55-16:30: the eleven entries asked at 16:03:29
-- landed at 16:11:26; one (4107, USDT-GBP bid 0.1 %) filled while its cancel waited; six entries withdrawn 16:17:27 by
-- the de-peg guard ("the GBP book's last print 0.75 is -93 bps from fair 0.75701").

-- I. Mark-outs: sql/markouts.sql.
