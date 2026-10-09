-- F3's replay inputs and the twins' records: every read of production behind data/raw/, SELECT only, through the Supabase
-- connector, 2026-10-09 16:26-16:30 UTC. Each statement returns one payload per table, {table, n, md5, text}: the rows as
-- text lines and the md5 the database computed over that same text; scripts/grab.py cuts each out of the saved reply into
-- data/raw/<table>.txt and refuses it unless its md5 and line count match. Rows end at 2026-10-09 16:00 UTC (the replay's end).

-- prints after the committed inputs' cut (2026-10-02 21:08): id|book|ms|price|qty|side. 1,849 rows.
select json_build_object('table','prints','n',count(*),'md5',md5(string_agg(l, E'\n' order by ms, id)),'text',string_agg(l, E'\n' order by ms, id)) payload from (
select id, (extract(epoch from ts)*1000)::bigint ms, id||'|'||book||'|'||(extract(epoch from ts)*1000)::bigint||'|'||price||'|'||qty||'|'||side l from agent_quote_prints where ts >= '2026-10-02T21:08:00Z' and ts < '2026-10-09T16:00:00Z') s;

-- inputs (GBP/USD minutes, the USD books' hourly closes) from 2026-10-01, overlapping the committed ones: kind|ms|value. 9,903 rows.
select json_build_object('table','inputs','n',count(*),'md5',md5(string_agg(l, E'\n' order by kind, ms)),'text',string_agg(l, E'\n' order by kind, ms)) payload from (
select kind, (extract(epoch from t)*1000)::bigint ms, kind||'|'||(extract(epoch from t)*1000)::bigint||'|'||value l from agent_quote_inputs where t >= '2026-10-01T00:00:00Z' and t < '2026-10-09T16:00:00Z') s;

-- PR5's minute records from 2026-10-02 21:00: book|ms|x|x_t|fair_u|hours_n|prints_n|recorded_at. 19,560 rows.
select json_build_object('table','minutes','n',count(*),'md5',md5(string_agg(l, E'\n' order by book, ms)),'text',string_agg(l, E'\n' order by book, ms)) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms,
 book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||coalesce(x::text,'')||'|'||coalesce(((extract(epoch from x_t)*1000)::bigint)::text,'')||'|'||coalesce(fair_u::text,'')||'|'||coalesce(hours_n::text,'')||'|'||coalesce(prints_n::text,'')||'|'||coalesce(((extract(epoch from recorded_at)*1000)::bigint)::text,'') l
from agent_quote_minutes where minute >= '2026-10-02T21:00:00Z' and minute < '2026-10-09T16:00:00Z') s;

-- PR5's events from 2026-10-02 21:00 (its decisions, fills and book snapshots): tab-separated. 2,934 rows.
select json_build_object('table','events','n',count(*),'md5',md5(string_agg(l, E'\n' order by book, ms, side, k, kind)),'text',string_agg(l, E'\n' order by book, ms, side, k, kind)) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms, side, k, kind,
 book||E'\t'||(extract(epoch from minute)*1000)::bigint||E'\t'||side||E'\t'||k||E'\t'||kind||E'\t'||coalesce(ticks::text,'')||E'\t'||coalesce(detail::text,'null') l
from agent_quote_events where minute >= '2026-10-02T21:00:00Z' and minute < '2026-10-09T16:00:00Z') s;

-- the beats production still keeps (from 2026-10-07 10:36) of PR5's call and the twins' call: path|minute ms|ts ms. 6,119 rows.
select json_build_object('table','beats','n',count(*),'md5',md5(string_agg(l, E'\n' order by l)),'text',string_agg(l, E'\n' order by l)) payload from (
select path||'|'||(extract(epoch from minute)*1000)::bigint||'|'||coalesce((extract(epoch from ts)*1000)::bigint::text,'') l from edge_call_beats where path in ('agents?action=quotes','agents?action=quotestwins') and minute < '2026-10-09T16:00:00Z') s;

-- the twins' own records, for the baseline's check: every order pr5 and p50 wrote (5,638 and 5,881 rows) as a JSON array
-- [id, ts ms, mode, book, rung_side, k, leg, side, state, base_size, filled_base, avg_fill_price, price, fee_gbp, filled_at ms,
--  wouldBeRefused, paper_oid, paper_live, fair, cancel_requested_at ms, cancelled_at ms, cancel_reason, client_order_id].
select json_build_object('table',t,'n',count(*),'md5',md5(string_agg(l, E'\n' order by id)),'text',string_agg(l, E'\n' order by id)) payload from (
select 'orders_pr5' t, id, json_build_array(id, (extract(epoch from ts)*1000)::bigint, mode, book, rung_side, k, leg, side, state, base_size, filled_base, avg_fill_price, price, fee_gbp, (extract(epoch from filled_at)*1000)::bigint, response->'wouldBeRefused', paper_oid, paper_live, fair, (extract(epoch from cancel_requested_at)*1000)::bigint, (extract(epoch from cancelled_at)*1000)::bigint, cancel_reason, client_order_id)::text l from agent_quote_twin_pr5_orders where ts < '2026-10-09T16:00:00Z'
union all
select 'orders_p50' t, id, json_build_array(id, (extract(epoch from ts)*1000)::bigint, mode, book, rung_side, k, leg, side, state, base_size, filled_base, avg_fill_price, price, fee_gbp, (extract(epoch from filled_at)*1000)::bigint, response->'wouldBeRefused', paper_oid, paper_live, fair, (extract(epoch from cancel_requested_at)*1000)::bigint, (extract(epoch from cancelled_at)*1000)::bigint, cancel_reason, client_order_id)::text from agent_quote_twin_p50_orders where ts < '2026-10-09T16:00:00Z'
) s group by t;

-- their dead-man and guard events, and their driver state without the account's orders (its dead-man cancels and balances kept).
select json_build_object('table',t,'n',count(*),'md5',md5(string_agg(l, E'\n' order by l)),'text',string_agg(l, E'\n' order by l)) payload from (
select 'twin_events_pr5' t, json_build_array((extract(epoch from minute)*1000)::bigint, book, rung_side, k, kind, detail)::text l from agent_quote_twin_pr5_events where mode='live' and kind not in ('skip')
union all
select 'twin_events_p50' t, json_build_array((extract(epoch from minute)*1000)::bigint, book, rung_side, k, kind, detail)::text from agent_quote_twin_p50_events where mode='live' and kind not in ('skip')
union all
select 'twin_sims', json_build_array(x, s)::text from (select 'pr5' x, state - 'venue' || jsonb_build_object('deadmen', state->'venue'->'deadmen', 'balances', state->'venue'->'balances') s from agent_quote_twin_pr5_sim union all select 'p50', state - 'venue' || jsonb_build_object('deadmen', state->'venue'->'deadmen', 'balances', state->'venue'->'balances') from agent_quote_twin_p50_sim) q
) s group by t;
