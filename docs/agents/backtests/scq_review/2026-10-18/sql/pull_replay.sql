-- 2026-10-18 stablecoin quotes review: the replay's inputs (scripts/replay.py), SELECT only, through the Supabase
-- connector, 2026-10-18 03:4x UTC. Each statement returns one payload per table, {table, n, md5, text}: rows as text lines and
-- the md5 the database computed over that same text; scripts/grab_text.py cuts each into data/<table>.txt and refuses it unless
-- its md5 and line count match. Rows end at 2026-10-18 00:00 UTC (the replay's end; whole UTC days only).

-- R1. PR5's minute records, both books, every row the table keeps (from 2026-09-25 00:05): book|ms|x|fair_u|prints_n.
select json_build_object('table','minutes','n',count(*),'md5',md5(string_agg(l, E'\n' order by book, ms)),'text',string_agg(l, E'\n' order by book, ms)) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms,
 book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||coalesce(x::text,'')||'|'||coalesce(fair_u::text,'')||'|'||coalesce(prints_n::text,'') l
from agent_quote_minutes where minute < '2026-10-18T00:00:00Z') s;

-- R2. Every stored UK print (the public tape, as F3 checked to 10-09): id|book|ms|price|qty|side.
select json_build_object('table','prints','n',count(*),'md5',md5(string_agg(l, E'\n' order by ms, id)),'text',string_agg(l, E'\n' order by ms, id)) payload from (
select id, (extract(epoch from ts)*1000)::bigint ms, id||'|'||book||'|'||(extract(epoch from ts)*1000)::bigint||'|'||price||'|'||qty||'|'||side l from agent_quote_prints where ts < '2026-10-18T00:00:00Z') s;

-- R3. PR5's paper trips (the engine the replay must reproduce): book|side|k|t_entry ms|t_exit ms|entry|exit|how|notional_usd|pnl_usd.
select json_build_object('table','paper_trips','n',count(*),'md5',md5(string_agg(l, E'\n' order by l)),'text',string_agg(l, E'\n' order by l)) payload from (
select book||'|'||side||'|'||k||'|'||(extract(epoch from t_entry)*1000)::bigint||'|'||(extract(epoch from t_exit)*1000)::bigint||'|'||entry||'|'||exit||'|'||how||'|'||notional_usd||'|'||pnl_usd l from agent_quote_trips) s;
