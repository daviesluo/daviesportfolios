-- PR5-OPT (2026-10-27): the replay's inputs, SELECT only, through the Supabase connector, 2026-10-27 03:08-03:10 UTC. Each statement
-- returns one payload {table, n, md5, text}; scripts/grab_text.py cuts it into data/<table>.txt and refuses it unless the md5 the
-- database computed and the line count match. Whole UTC days only: rows end at 2026-10-27 00:00 UTC.

-- P1. Every stored UK print of both books: id|book|ms|price|qty|side.
select json_build_object('table','prints','n',count(*),'md5',md5(string_agg(l, E'\n' order by ms, id)),'text',string_agg(l, E'\n' order by ms, id)) payload from (
select id, (extract(epoch from ts)*1000)::bigint ms, id||'|'||book||'|'||(extract(epoch from ts)*1000)::bigint||'|'||price||'|'||qty||'|'||side l from agent_quote_prints where ts < '2026-10-27T00:00:00Z') s;

-- P2-P4. PR5's minute records (the X and fairU each minute was decided on), both books, in three parts: book|ms|x|fair_u|prints_n.
select json_build_object('table','minutes_a','n',count(*),'md5',md5(string_agg(l, E'\n' order by book, ms)),'text',string_agg(l, E'\n' order by book, ms)) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms,
 book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||coalesce(x::text,'')||'|'||coalesce(fair_u::text,'')||'|'||coalesce(prints_n::text,'') l
from agent_quote_minutes where minute < '2026-10-06T00:00:00Z') s;

select json_build_object('table','minutes_b','n',count(*),'md5',md5(string_agg(l, E'\n' order by book, ms)),'text',string_agg(l, E'\n' order by book, ms)) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms,
 book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||coalesce(x::text,'')||'|'||coalesce(fair_u::text,'')||'|'||coalesce(prints_n::text,'') l
from agent_quote_minutes where minute >= '2026-10-06T00:00:00Z' and minute < '2026-10-17T00:00:00Z') s;

select json_build_object('table','minutes_c','n',count(*),'md5',md5(string_agg(l, E'\n' order by book, ms)),'text',string_agg(l, E'\n' order by book, ms)) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms,
 book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||coalesce(x::text,'')||'|'||coalesce(fair_u::text,'')||'|'||coalesce(prints_n::text,'') l
from agent_quote_minutes where minute >= '2026-10-17T00:00:00Z' and minute < '2026-10-27T00:00:00Z') s;

-- Read beside them (not cut to files): the twin spec table as it stands, LIVE's switches (no capital or balance read), and the row
-- counts of the record tables.
select id, display_name, display_order, engine, capital_gbp, gov, start, table_prefix, lease, rules, prereg, migration, enabled, hidden
from agent_quote_twin_specs order by display_order;
select dry_run, live_confirmed_at is not null as armed, take_mode, weekend_mode, updated_at, now() from agent_quote_live_config where id = 1;
select 'prints' t, count(*), min(ts), max(ts) from agent_quote_prints union all select 'minutes', count(*), min(minute), max(minute) from agent_quote_minutes
union all select 'trips', count(*), min(t_entry), max(t_entry) from agent_quote_trips union all select 'live_orders', count(*), min(ts), max(ts) from agent_quote_live_orders
union all select 'book_levels', count(*), min(ts), max(ts) from agent_book_levels;
