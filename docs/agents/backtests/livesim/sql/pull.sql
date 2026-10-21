-- The simulation-against-LIVE audit (2026-10-21, Davies: "…要确保模拟的真实性和实盘策略完全一致，不一致的地方就直接改"): what the
-- replay needs beyond ../pr5_review/data (PR5's prints, inputs, events and go-live books, pulled the same evening), SELECT
-- only, through the Supabase connector, 2026-10-21 after 19:30 UTC; each payload {table, n, md5, text}, cut by
-- scripts/grab_text.py, which refuses one whose md5 or line count does not match.

-- L1. PR5's minute records with every column the twins read: book|ms|x|x_t ms|fair_u|hours_n|prints_n|recorded_at ms.
select json_build_object('table','minutes_full','n',count(*),'md5',md5(string_agg(l, E'\n' order by book, ms)),'text',string_agg(l, E'\n' order by book, ms)) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms,
 book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||coalesce(x::text,'')||'|'||coalesce((extract(epoch from x_t)*1000)::bigint::text,'')||'|'||coalesce(fair_u::text,'')||'|'||coalesce(hours_n::text,'')||'|'||coalesce(prints_n::text,'')||'|'||coalesce((extract(epoch from recorded_at)*1000)::bigint::text,'') l
from agent_quote_minutes where minute < '2026-10-21T15:10:00Z') s;

-- L2. The live account's orders (mode live), every row to 2026-10-21 15:10: one JSON object a line.
select json_build_object('table','live_orders','n',count(*),'md5',md5(string_agg(l, E'\n' order by id)),'text',string_agg(l, E'\n' order by id)) payload from (
select id, json_build_object('id',id,'ts',(extract(epoch from ts)*1000)::bigint,'book',book,'rung_side',rung_side,'k',k,'leg',leg,'side',side,'price',price,'base_size',base_size,
 'state',state,'filled_base',filled_base,'avg_fill_price',avg_fill_price,'fee_gbp',fee_gbp,'filled_at',(extract(epoch from filled_at)*1000)::bigint,
 'cancel_requested_at',(extract(epoch from cancel_requested_at)*1000)::bigint,'cancelled_at',(extract(epoch from cancelled_at)*1000)::bigint,'cancel_reason',cancel_reason,
 'paper_oid',paper_oid,'paper_live',(extract(epoch from paper_live)*1000)::bigint,'fair',fair,
 'marketable',request->'marketable','auto',request->'auto','take',request->'take','not_sent',coalesce((response->>'wouldBeRefused')::boolean,false),
 'status',response->'status','error',left(response->>'error',120),'outcome',response->>'outcome','reconciled',response->>'reconciled')::text l
from agent_quote_live_orders where mode = 'live' and ts < '2026-10-21T15:10:00Z') s;

-- L3. The live account's events (skips, guards, stops, loss stops, dead-man, shadows): mode|ms|book|rung_side|k|kind|detail.
select json_build_object('table','live_events','n',count(*),'md5',md5(string_agg(l, E'\n' order by l)),'text',string_agg(l, E'\n' order by l)) payload from (
select mode||'|'||(extract(epoch from minute)*1000)::bigint||'|'||book||'|'||rung_side||'|'||k||'|'||kind||'|'||detail::text l
from agent_quote_live_events where minute < '2026-10-21T15:10:00Z') s;
