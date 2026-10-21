-- PR5's four-week review (2026-10-21): every input the scripts read, SELECT only, through the Supabase connector,
-- 2026-10-21 after 19:00 UTC. Each statement returns one payload {table, n, md5, text}: rows as text lines and the md5 the
-- database computed over that same text; scripts/grab_text.py cuts each into data/<table>.txt and refuses it unless its md5
-- and line count match. The test ran 2026-09-23 15:09 -> 2026-10-21 15:09 UTC; rows end there, except the prints, read a day
-- earlier for the post-only check's last print.

-- P1. PR5's minute records (kept from 2026-09-25 00:05): book|ms|x|fair_u|prints_n.
select json_build_object('table','minutes','n',count(*),'md5',md5(string_agg(l, E'\n' order by book, ms)),'text',string_agg(l, E'\n' order by book, ms)) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms,
 book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||coalesce(x::text,'')||'|'||coalesce(fair_u::text,'')||'|'||coalesce(prints_n::text,'') l
from agent_quote_minutes where minute < '2026-10-21T15:09:00Z') s;

-- P2. Every stored print (the public UK tape): id|book|ms|price|qty|side.
select json_build_object('table','prints','n',count(*),'md5',md5(string_agg(l, E'\n' order by ms, id)),'text',string_agg(l, E'\n' order by ms, id)) payload from (
select id, (extract(epoch from ts)*1000)::bigint ms, id||'|'||book||'|'||(extract(epoch from ts)*1000)::bigint||'|'||price||'|'||qty||'|'||side l
from agent_quote_prints where ts < '2026-10-21T15:09:00Z') s;

-- P3. The stored inputs: GBP/USD minute closes (kind fx) and the USD books' hourly closes (fair:*): kind|ms|value.
select json_build_object('table','inputs','n',count(*),'md5',md5(string_agg(l, E'\n' order by kind, ms)),'text',string_agg(l, E'\n' order by kind, ms)) payload from (
select kind, (extract(epoch from t)*1000)::bigint ms, kind||'|'||(extract(epoch from t)*1000)::bigint||'|'||value l
from agent_quote_inputs where t < '2026-10-21T15:09:00Z') s;

-- P4. PR5's events but the book snapshots: book|ms|side|k|kind|ticks|detail (json).
select json_build_object('table','events','n',count(*),'md5',md5(string_agg(l, E'\n' order by l)),'text',string_agg(l, E'\n' order by l)) payload from (
select book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||side||'|'||k||'|'||kind||'|'||coalesce(ticks::text,'')||'|'||detail::text l
from agent_quote_events where kind <> 'book' and minute < '2026-10-21T15:10:00Z') s;

-- P5. PR5's paper trips: every column, | separated.
select json_build_object('table','trips','n',count(*),'md5',md5(string_agg(l, E'\n' order by l)),'text',string_agg(l, E'\n' order by l)) payload from (
select book||'|'||side||'|'||k||'|'||(extract(epoch from t_entry)*1000)::bigint||'|'||(extract(epoch from fill_ts)*1000)::bigint||'|'||coalesce(fill_print_id,'')||'|'||entry||'|'||qty||'|'||x_entry||'|'||coalesce(fair_entry::text,'')||'|'||coalesce(entry_oid::text,'')||'|'||(extract(epoch from t_exit)*1000)::bigint||'|'||exit||'|'||how||'|'||coalesce(exit_print_id,'')||'|'||coalesce(exit_oid::text,'')||'|'||notional_usd||'|'||pnl_usd l
from agent_quote_trips) s;

-- P6. The go-live order-book snapshots (kind book) of every minute in which a paper order went live: book|ms|detail.
select json_build_object('table','books','n',count(*),'md5',md5(string_agg(l, E'\n' order by l)),'text',string_agg(l, E'\n' order by l)) payload from (
select book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||detail::text l
from agent_quote_events where kind = 'book' and minute < '2026-10-21T15:10:00Z') s;

-- P7. The daily order counts the engine keeps (condition 5): day|orders|fills|trips|won|realised_usd.
select json_build_object('table','days','n',count(*),'md5',md5(string_agg(l, E'\n' order by l)),'text',string_agg(l, E'\n' order by l)) payload from (
select day||'|'||orders||'|'||fills||'|'||trips||'|'||won||'|'||realised_usd l from agent_quote_days) s;
