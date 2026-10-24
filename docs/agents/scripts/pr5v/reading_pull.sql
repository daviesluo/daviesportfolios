-- PR5V reading: every input `reading_pr5v.py` reads, SELECT only, through the Supabase
-- connector, on or after 2026-10-28 01:00 UTC (the reading's earliest instant), once the engine has decided every minute
-- before E = 2026-10-28 00:30 UTC. Written 2026-10-24 with the reading script, from the table definitions
-- (information_schema) only. Each statement returns one payload {table, n, md5, text}: rows as text lines and the md5
-- the database computed over that same text. Save each reply and run
--     python3 -I docs/agents/scripts/pr5v/reading_grab.py <saved reply> docs/agents/backtests/pr5v/forward/data
-- which writes data/<table>.txt and refuses a payload whose md5 or line count does not match; then gzip -n -9 the files.
-- No row is printed: the payloads go to files by script. The pages are weekly (by minute), and the meta statement's
-- counts must equal the pages' lines (the reading script checks it).
-- 0. meta: the engine's state, PR5's last decided minute, PR5's first live order, and the counts the pages must add to.
select json_build_object('table','meta','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by l),'')),'text',coalesce(string_agg(l, E'\n' order by l),'')) payload from (
select 'variant_last_minute='||coalesce((extract(epoch from st.last_minute)*1000)::bigint::text,'')
 ||'|variant_code_version='||coalesce(st.state->>'codeVersion','')
 ||'|variant_last_error='||replace(replace(coalesce(st.last_error,''),'|','/'),E'\n',' ')
 ||'|pr5_last_minute='||coalesce((select (extract(epoch from last_minute)*1000)::bigint::text from agent_quote_state where id = 1),'')
 ||'|first_live_order='||coalesce((select (extract(epoch from min(ts))*1000)::bigint::text from agent_quote_live_orders where mode = 'live'),'')
 ||'|minutes_n='||(select count(*) from agent_quotev_minutes where minute >= '2026-09-28T00:00:00Z' and minute < '2026-10-28T00:30:00Z')
 ||'|events_n='||(select count(*) from agent_quotev_events where kind in ('order','stop','withdraw','refused') and minute >= '2026-09-28T00:00:00Z' and minute < '2026-10-28T00:30:00Z')
 ||'|trips_n='||(select count(*) from agent_quotev_trips)
 ||'|pr5_trips_n='||(select count(*) from agent_quote_trips where t_entry >= '2026-09-28T00:00:00Z') l
from agent_quotev_state st where st.id = 1) s;

-- 1. prints: every stored UK print of both books from each book's last print before 2026-09-28 00:00 to E: id|book|ms|price|qty|side.
select json_build_object('table','prints','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by book, ms, id collate "C"),'')),'text',coalesce(string_agg(l, E'\n' order by book, ms, id collate "C"),'')) payload from (
select p.book, (extract(epoch from p.ts)*1000)::bigint ms, p.id, p.id||'|'||p.book||'|'||(extract(epoch from p.ts)*1000)::bigint||'|'||p.price||'|'||p.qty||'|'||p.side l
from agent_quote_prints p
where p.ts < '2026-10-28T00:30:00Z'
  and p.ts >= coalesce((select max(q.ts) from agent_quote_prints q where q.book = p.book and q.ts < '2026-09-28T00:00:00Z'), '2026-09-28T00:00:00Z')) s;

-- 2. minutes, weekly pages: what each book-minute was decided on: book|ms|source|x|fair_u|prints_n|pr5_prints_n.
select json_build_object('table','minutes.1','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by book, ms),'')),'text',coalesce(string_agg(l, E'\n' order by book, ms),'')) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms, book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||source||'|'||coalesce(x::text,'')||'|'||coalesce(fair_u::text,'')||'|'||coalesce(prints_n::text,'')||'|'||coalesce(pr5_prints_n::text,'') l
from agent_quotev_minutes where minute >= '2026-09-28T00:00:00Z' and minute < '2026-10-05T00:00:00Z') s;
select json_build_object('table','minutes.2','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by book, ms),'')),'text',coalesce(string_agg(l, E'\n' order by book, ms),'')) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms, book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||source||'|'||coalesce(x::text,'')||'|'||coalesce(fair_u::text,'')||'|'||coalesce(prints_n::text,'')||'|'||coalesce(pr5_prints_n::text,'') l
from agent_quotev_minutes where minute >= '2026-10-05T00:00:00Z' and minute < '2026-10-12T00:00:00Z') s;
select json_build_object('table','minutes.3','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by book, ms),'')),'text',coalesce(string_agg(l, E'\n' order by book, ms),'')) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms, book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||source||'|'||coalesce(x::text,'')||'|'||coalesce(fair_u::text,'')||'|'||coalesce(prints_n::text,'')||'|'||coalesce(pr5_prints_n::text,'') l
from agent_quotev_minutes where minute >= '2026-10-12T00:00:00Z' and minute < '2026-10-19T00:00:00Z') s;
select json_build_object('table','minutes.4','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by book, ms),'')),'text',coalesce(string_agg(l, E'\n' order by book, ms),'')) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms, book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||source||'|'||coalesce(x::text,'')||'|'||coalesce(fair_u::text,'')||'|'||coalesce(prints_n::text,'')||'|'||coalesce(pr5_prints_n::text,'') l
from agent_quotev_minutes where minute >= '2026-10-19T00:00:00Z' and minute < '2026-10-26T00:00:00Z') s;
select json_build_object('table','minutes.5','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by book, ms),'')),'text',coalesce(string_agg(l, E'\n' order by book, ms),'')) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms, book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||source||'|'||coalesce(x::text,'')||'|'||coalesce(fair_u::text,'')||'|'||coalesce(prints_n::text,'')||'|'||coalesce(pr5_prints_n::text,'') l
from agent_quotev_minutes where minute >= '2026-10-26T00:00:00Z' and minute < '2026-10-28T00:30:00Z') s;

-- 3. trips: both arms' round trips, every column: arm|key|book|side|k|t_entry|fill_ts|fill_print_id|entry|qty|x_entry|fair_entry|entry_oid|t_exit|exit|how|exit_print_id|exit_oid|notional_usd|pnl_usd.
select json_build_object('table','trips','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by l),'')),'text',coalesce(string_agg(l, E'\n' order by l),'')) payload from (
select arm||'|'||key||'|'||book||'|'||side||'|'||k||'|'||(extract(epoch from t_entry)*1000)::bigint||'|'||(extract(epoch from fill_ts)*1000)::bigint||'|'||coalesce(fill_print_id,'')||'|'||entry||'|'||qty||'|'||x_entry||'|'||coalesce(fair_entry::text,'')||'|'||coalesce(entry_oid::text,'')||'|'||(extract(epoch from t_exit)*1000)::bigint||'|'||exit||'|'||how||'|'||coalesce(exit_print_id,'')||'|'||coalesce(exit_oid::text,'')||'|'||notional_usd||'|'||pnl_usd l from agent_quotev_trips) s;

-- 4. events, weekly pages: every POST (kind order or stop), withdrawal and refusal: arm|book|ms|side|k|kind|what|key|ticks|n|why.
select json_build_object('table','events.1','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by l),'')),'text',coalesce(string_agg(l, E'\n' order by l),'')) payload from (
select arm||'|'||book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||side||'|'||k||'|'||kind||'|'||coalesce(what,'')||'|'||coalesce(key,'')
 ||'|'||coalesce(ticks::text,'')||'|'||coalesce(detail->>'n','')||'|'||coalesce(detail->>'why','') l
from agent_quotev_events where kind in ('order','stop','withdraw','refused') and minute >= '2026-09-28T00:00:00Z' and minute < '2026-10-05T00:00:00Z') s;
select json_build_object('table','events.2','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by l),'')),'text',coalesce(string_agg(l, E'\n' order by l),'')) payload from (
select arm||'|'||book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||side||'|'||k||'|'||kind||'|'||coalesce(what,'')||'|'||coalesce(key,'')
 ||'|'||coalesce(ticks::text,'')||'|'||coalesce(detail->>'n','')||'|'||coalesce(detail->>'why','') l
from agent_quotev_events where kind in ('order','stop','withdraw','refused') and minute >= '2026-10-05T00:00:00Z' and minute < '2026-10-12T00:00:00Z') s;
select json_build_object('table','events.3','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by l),'')),'text',coalesce(string_agg(l, E'\n' order by l),'')) payload from (
select arm||'|'||book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||side||'|'||k||'|'||kind||'|'||coalesce(what,'')||'|'||coalesce(key,'')
 ||'|'||coalesce(ticks::text,'')||'|'||coalesce(detail->>'n','')||'|'||coalesce(detail->>'why','') l
from agent_quotev_events where kind in ('order','stop','withdraw','refused') and minute >= '2026-10-12T00:00:00Z' and minute < '2026-10-19T00:00:00Z') s;
select json_build_object('table','events.4','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by l),'')),'text',coalesce(string_agg(l, E'\n' order by l),'')) payload from (
select arm||'|'||book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||side||'|'||k||'|'||kind||'|'||coalesce(what,'')||'|'||coalesce(key,'')
 ||'|'||coalesce(ticks::text,'')||'|'||coalesce(detail->>'n','')||'|'||coalesce(detail->>'why','') l
from agent_quotev_events where kind in ('order','stop','withdraw','refused') and minute >= '2026-10-19T00:00:00Z' and minute < '2026-10-26T00:00:00Z') s;
select json_build_object('table','events.5','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by l),'')),'text',coalesce(string_agg(l, E'\n' order by l),'')) payload from (
select arm||'|'||book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||side||'|'||k||'|'||kind||'|'||coalesce(what,'')||'|'||coalesce(key,'')
 ||'|'||coalesce(ticks::text,'')||'|'||coalesce(detail->>'n','')||'|'||coalesce(detail->>'why','') l
from agent_quotev_events where kind in ('order','stop','withdraw','refused') and minute >= '2026-10-26T00:00:00Z' and minute < '2026-10-28T00:30:00Z') s;

-- 5. PR5's paper trips entered from 2026-09-28 00:00 (condition 3 reads those of the window): every column but the arm and key.
select json_build_object('table','pr5_trips','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by l),'')),'text',coalesce(string_agg(l, E'\n' order by l),'')) payload from (
select book||'|'||side||'|'||k||'|'||(extract(epoch from t_entry)*1000)::bigint||'|'||(extract(epoch from fill_ts)*1000)::bigint||'|'||coalesce(fill_print_id,'')||'|'||entry||'|'||qty||'|'||x_entry||'|'||coalesce(fair_entry::text,'')||'|'||coalesce(entry_oid::text,'')||'|'||(extract(epoch from t_exit)*1000)::bigint||'|'||exit||'|'||how||'|'||coalesce(exit_print_id,'')||'|'||coalesce(exit_oid::text,'')||'|'||notional_usd||'|'||pnl_usd l from agent_quote_trips where t_entry >= '2026-09-28T00:00:00Z') s;
