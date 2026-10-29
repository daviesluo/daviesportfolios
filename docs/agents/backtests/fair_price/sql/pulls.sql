-- REVX-FAIR (2026-10-29): the study's inputs, SELECT only, through the Supabase connector, 2026-10-29 05:40-05:50 UTC.
-- Each statement returns {table, n, md5, text} payloads; docs/agents/backtests/pr5_opt/scripts/grab_text.py cuts each into
-- data/<table>.txt and refuses it unless the md5 the database computed over the same text and the line count match (the
-- database's md5s are in ../MANIFEST.json). Rows end at 2026-10-29 00:00 UTC. The files are committed gzip -n -9.

-- F1. Every stored Revolut X UK print of both books: id|book|ms|price|qty|aggressor.
select json_build_object('table','prints','n',count(*),'md5',md5(string_agg(l, E'\n' order by ms, id)),'text',string_agg(l, E'\n' order by ms, id)) payload from (
select id, (extract(epoch from ts)*1000)::bigint ms, id||'|'||book||'|'||(extract(epoch from ts)*1000)::bigint||'|'||price||'|'||qty||'|'||side l from agent_quote_prints where ts < '2026-10-29T00:00:00Z') s;

-- F2. PR5's minute record, both books: book|ms|x|fair_u|minutes between the minute and its GBP/USD bar|hours_n|prints_n.
select json_build_object('table','minutes','n',count(*),'md5',md5(string_agg(l, E'\n' order by book, ms)),'text',string_agg(l, E'\n' order by book, ms)) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms,
 book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||coalesce(x::text,'')||'|'||coalesce(fair_u::text,'')||'|'||coalesce(((extract(epoch from minute)-extract(epoch from x_t))/60)::int::text,'')||'|'||coalesce(hours_n::text,'')||'|'||coalesce(prints_n::text,'') l
from agent_quote_minutes where minute < '2026-10-29T00:00:00Z') s;

-- F3. The USD books' hourly closes fairU is the median of: kind|hour start ms|close.
select json_build_object('table','hours','n',count(*),'md5',md5(string_agg(l, E'\n' order by kind, ms)),'text',string_agg(l, E'\n' order by kind, ms)) payload from (
select kind, (extract(epoch from t)*1000)::bigint ms, kind||'|'||(extract(epoch from t)*1000)::bigint||'|'||value l from agent_quote_inputs where kind like 'fair:%' and t < '2026-10-29T00:00:00Z') s;

-- F4-F6. Revolut X's book snapshots (agent_book_levels; five levels a side), one payload a book (USDC-GBP and USDT-GBP each
-- alone, USDC-USD and USDT-USD together): ms|seen_until ms|price:qty:orders;...|price:qty:orders;...
select json_build_object('table','book_'||book,'n',count(*),'md5',md5(string_agg(l, E'\n' order by ms)),'text',string_agg(l, E'\n' order by ms)) payload from (
select book, (extract(epoch from ts)*1000)::bigint ms,
 (extract(epoch from ts)*1000)::bigint||'|'||(extract(epoch from seen_until)*1000)::bigint||'|'||
 coalesce((select string_agg((e->>0)||':'||(e->>1)||':'||coalesce(e->>2,''), ';' order by o) from jsonb_array_elements(bids) with ordinality as a(e,o)),'')||'|'||
 coalesce((select string_agg((e->>0)||':'||(e->>1)||':'||coalesce(e->>2,''), ';' order by o) from jsonb_array_elements(asks) with ordinality as a(e,o)),'') l
from agent_book_levels where book in ('USDC-GBP') and ts < '2026-10-29T00:00:00Z') s group by book;
-- (the same with book in ('USDT-GBP'), then book in ('USDC-USD','USDT-USD'))

-- F7. Coinbase's touch on its USDC-GBP and USDT-GBP books (cb_touch, the "with Euros" recorder): ms|bid|ask|bid_size|ask_size.
select json_build_object('table','cb_'||product,'n',count(*),'md5',md5(string_agg(l, E'\n' order by ms)),'text',string_agg(l, E'\n' order by ms)) payload from (
select product, (extract(epoch from ts)*1000)::bigint ms, (extract(epoch from ts)*1000)::bigint||'|'||bid||'|'||ask||'|'||coalesce(bid_size::text,'')||'|'||coalesce(ask_size::text,'') l
from cb_touch where product in ('USDC-GBP','USDT-GBP') and ts < '2026-10-29T00:00:00Z') s group by product;

-- L1. LIVE's own orders, NOT committed (the repository is public and they carry the live account's sizes): pulled to a local
-- file and handed to the scripts as $FP_LIVE. Used to take LIVE's own resting orders out of the book snapshots and to place
-- its fills in time (fp_data.BookSeries, measure.py part C). 9,522 rows, md5 0cd06ea25edb2bcaa60eb2ff35d3ead5.
select json_build_object('table','live_orders','n',count(*),'md5',md5(string_agg(l, E'\n' order by id)),'text',string_agg(l, E'\n' order by id)) payload from (
select id, concat_ws('|', id, (extract(epoch from ts)*1000)::bigint, mode, book, coalesce(rung_side,'-'), coalesce(k::text,''), coalesce(leg,'-'), side, price, base_size, state, coalesce(filled_base,0), coalesce(avg_fill_price::text,''), coalesce(fair::text,''),
 coalesce(((extract(epoch from filled_at)*1000)::bigint)::text,''), coalesce(((extract(epoch from cancelled_at)*1000)::bigint)::text,''), coalesce(((extract(epoch from updated_at)*1000)::bigint)::text,''),
 coalesce(((extract(epoch from paper_live)*1000)::bigint)::text,''), coalesce(fee_gbp::text,'')) l
from agent_quote_live_orders where ts < '2026-10-29T00:00:00Z') s;

-- ADDENDUM (the Coinbase mirror of the USDC-GBP lead), 2026-10-29 06:20-06:26 UTC, cut the same way.
-- A1. Coinbase's USDC-GBP prints as the recorder summarises each minute (cb_print_minutes, from 2026-10-09 19:57; cb_trades
-- keeps only its last ten days): minute ms|seconds|prices in 0.0001|aggressor buy 1/0|counts|sizes in 0.01 coin.
select json_build_object('table','cb_print_minutes_USDC-GBP','n',count(*),'md5',md5(string_agg(l, E'\n' order by ms)),'text',string_agg(l, E'\n' order by ms)) payload from (
select (extract(epoch from minute)*1000)::bigint ms, (extract(epoch from minute)*1000)::bigint||'|'||array_to_string(sec,',')||'|'||array_to_string(px,',')||'|'||array_to_string(array(select case when b then 1 else 0 end from unnest(buy) b),',')||'|'||array_to_string(n,',')||'|'||array_to_string(sz,',') l
from cb_print_minutes where product='USDC-GBP' and minute < '2026-10-29T00:00:00Z') s;
-- A2. Yahoo's GBP/USD minute bars, the rate the Coinbase arms hold through a closure: bar start ms|close.
select json_build_object('table','fx','n',count(*),'md5',md5(string_agg(l, E'\n' order by ms)),'text',string_agg(l, E'\n' order by ms)) payload from (
select (extract(epoch from t)*1000)::bigint ms, (extract(epoch from t)*1000)::bigint||'|'||value l from agent_quote_inputs where kind = 'fx' and t < '2026-10-29T00:00:00Z') s;
-- A3. The engines' own USDC-GBP round trips, for the reproduction: src|side|k|t_entry ms|t_exit ms|entry|exit|how|qty|pnl_gbp.
select json_build_object('table','cb_engine_trips_USDC-GBP','n',count(*),'md5',md5(string_agg(l, E'\n' order by l)),'text',string_agg(l, E'\n' order by l)) payload from (
select concat_ws('|', src, side, k, te, tx, entry, exit, how, qty, pnl) l from (
 select 'hold' src, side, k, (extract(epoch from t_entry)*1000)::bigint te, (extract(epoch from t_exit)*1000)::bigint tx, entry, exit, how, round(qty::numeric,6) qty, round(pnl_gbp::numeric,6) pnl from cb_hold_trips where book='USDC-GBP' and t_exit < '2026-10-29'
 union all select 'usdc', side, k, (extract(epoch from t_entry)*1000)::bigint, (extract(epoch from t_exit)*1000)::bigint, entry, exit, how, round(qty::numeric,6), round(pnl_gbp::numeric,6) from cb_usdc_trips where book='USDC-GBP' and t_exit < '2026-10-29') a) s;
