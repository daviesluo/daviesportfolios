-- PER-BOOK (2026-10-27): Coinbase's inputs for scripts/per_book.py, SELECT only, through the Supabase connector, 2026-10-27
-- ~05:00 UTC. Each of C1-C5 returns one payload {table, n, md5, text}; scripts/grab_text.py cuts it into data_cb/<table>.txt
-- (then gzip -n -9) and refuses it unless the md5 the database computed and the line count match. Rows end at 2026-10-27 00:00.
-- cb_trades holds prints from 2026-10-16 10:53 UTC only, so the common window starts 2026-10-17 00:00.

-- C1-C4. Each book's aggressor prints summed by 30-second bucket, price and side: bucket_start_s|price|size|side.
-- (USDC-GBP shown; the same for USDT-GBP, USDC-EUR and USDT-EUR, each its own payload "cb_<book>".)
select json_build_object('table','cb_USDC-GBP','n',count(*),'md5',md5(string_agg(l, E'\n' order by s, price, side)),'text',string_agg(l, E'\n' order by s, price, side)) payload from (
select s, price, side, s||'|'||price||'|'||round(sum(size),6)||'|'||side l from (
 select floor(extract(epoch from ts)/30)::bigint*30 s, price, size, side from cb_trades where product='USDC-GBP' and ts >= '2026-10-16T11:00:00Z' and ts < '2026-10-27T00:00:00Z') a
group by s, price, side) b;

-- C5. "with Euros - 2"'s minute record (its fair held through closures) for the four books: book|minute_s|fair|x.
select json_build_object('table','cb_minutes','n',count(*),'md5',md5(string_agg(l, E'\n' order by book, m)),'text',string_agg(l, E'\n' order by book, m)) payload from (
select book, minute m, book||'|'||(extract(epoch from minute))::bigint||'|'||coalesce(round(fair,7)::text,'')||'|'||coalesce(round(x,7)::text,'') l
from cb_hold_minutes where minute >= '2026-10-16T11:00:00Z' and minute < '2026-10-27T00:00:00Z') s;

-- E1. The paper engines' own round trips by book (data_cb/engine_books.json, copied from the reply).
with t as (
 select 'cb_quote' src, book, t_exit::date d, pnl_gbp pnl, notional_gbp notional, how from cb_quote_trips where t_exit >= '2026-10-11' and t_exit < '2026-10-27'
 union all select 'cb_hold', book, t_exit::date, pnl_gbp, notional_gbp, how from cb_hold_trips where t_exit >= '2026-10-13' and t_exit < '2026-10-27'
 union all select 'rx_pr5', book, t_exit::date, pnl_usd, notional_usd, how from agent_quote_trips where t_exit >= '2026-10-11' and t_exit < '2026-10-27')
select src, book, count(*) trips, count(distinct d) days_with, round(sum(pnl),4) pnl, round(sum(notional),2) notional, round(1e4*sum(pnl)/nullif(sum(notional),0),2) bps_trip,
 round(min(dp),4) worst_day, count(*) filter (where how not in ('maker','exit')) other_how, string_agg(distinct how, ',') hows
from (select *, sum(pnl) over (partition by src, book, d) dp from t) z group by 1,2 order by 1,2;

-- Read beside them: each book's median touch since 10-17 (USDC-EUR 1.12, USDC-GBP 1.34, USDT-EUR 0.22, USDT-GBP 1.34 bps; the
-- replay's stop pays agents/cb_quotes.ts's half-touch constants instead) and its print count.
select product, percentile_cont(0.5) within group (order by (ask-bid)/((ask+bid)/2))*1e4 med_spread_bps, min(nullif(abs(ask-bid),0)) min_step, count(*) n
from cb_touch where ts >= '2026-10-17' group by 1 order by 1;
