-- QUEUE "Data" item 4 (Q3 only): PR5's recorded inputs, any time after 2026-11-02 00:10 UTC, SELECT only, through the
-- Supabase connector; these tables are not pruned. Each statement returns one payload {table, n, md5, text}: rows as text
-- lines and the md5 the database computed over the same text. scripts/grab.py cuts each saved reply into
-- <data>/pr5/<table>.txt, refusing a payload whose md5 or line count does not match; then gzip -n -9 them. No row is printed.
-- Plus, for the union of Data item 2, the stored GBP prints. Written 2026-10-24 with the scorer.

-- R1. agent_quote_minutes, 2026-10-03 00:00 -> 2026-11-02 00:00 (Q3 may start after 10-04): book|ms|x|fair_u|prints_n.
select json_build_object('table','minutes','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by book, ms),'')),'text',coalesce(string_agg(l, E'\n' order by book, ms),'')) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms,
 book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||coalesce(x::text,'')||'|'||coalesce(fair_u::text,'')||'|'||coalesce(prints_n::text,'') l
from public.agent_quote_minutes where minute >= '2026-10-03T00:00:00Z' and minute < '2026-11-02T00:00:00Z') s;

-- R2. agent_quote_inputs from 2026-10-02 00:00 (fx minutes and the USD books' hours a rebuilt minute reads): kind|ms|value.
select json_build_object('table','inputs','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by kind, ms),'')),'text',coalesce(string_agg(l, E'\n' order by kind, ms),'')) payload from (
select kind, (extract(epoch from t)*1000)::bigint ms, kind||'|'||(extract(epoch from t)*1000)::bigint||'|'||value l
from public.agent_quote_inputs where t >= '2026-10-02T00:00:00Z' and t < '2026-11-02T00:00:00Z') s;

-- R3. agent_quote_trips opened from 2026-10-02 (the window's, and any opened before 10-04 and closed after it): every column.
select json_build_object('table','trips','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by l),'')),'text',coalesce(string_agg(l, E'\n' order by l),'')) payload from (
select book||'|'||side||'|'||k||'|'||(extract(epoch from t_entry)*1000)::bigint||'|'||(extract(epoch from fill_ts)*1000)::bigint||'|'||coalesce(fill_print_id,'')||'|'||entry||'|'||qty||'|'||x_entry||'|'||coalesce(fair_entry::text,'')||'|'||coalesce(entry_oid::text,'')||'|'||(extract(epoch from t_exit)*1000)::bigint||'|'||exit||'|'||how||'|'||coalesce(exit_print_id,'')||'|'||coalesce(exit_oid::text,'')||'|'||notional_usd||'|'||pnl_usd l
from public.agent_quote_trips where t_entry >= '2026-10-02T00:00:00Z') s;

-- R4. agent_quote_events of kind book in the window (check 6), after checks 1-3 have passed: book|ms|detail.
select json_build_object('table','books','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by l),'')),'text',coalesce(string_agg(l, E'\n' order by l),'')) payload from (
select book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||detail::text l
from public.agent_quote_events where kind = 'book' and minute >= '2026-10-04T00:00:00Z' and minute < '2026-11-01T00:00:00Z') s;

-- R5. agent_quote_live_orders of mode live (Q3: PR5's own orders in the GBP books): id|ts|book|side|price|filled_base|updated_at.
select json_build_object('table','live_orders','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by l),'')),'text',coalesce(string_agg(l, E'\n' order by l),'')) payload from (
select id||'|'||(extract(epoch from ts)*1000)::bigint||'|'||book||'|'||side||'|'||price||'|'||coalesce(filled_base::text,'')||'|'||coalesce((extract(epoch from updated_at)*1000)::bigint::text,'') l
from public.agent_quote_live_orders where mode = 'live') s;

-- R6. agent_quote_prints of the GBP books, 2026-10-03 00:00 -> 2026-11-02 00:00 (Data item 2's union): id|book|ms|price|qty|side.
select json_build_object('table','prints','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by ms, id collate "C"),'')),'text',coalesce(string_agg(l, E'\n' order by ms, id collate "C"),'')) payload from (
select id, (extract(epoch from ts)*1000)::bigint ms, id||'|'||book||'|'||(extract(epoch from ts)*1000)::bigint||'|'||price||'|'||qty||'|'||side l
from public.agent_quote_prints where ts >= '2026-10-03T00:00:00Z' and ts < '2026-11-02T00:00:00Z') s;
