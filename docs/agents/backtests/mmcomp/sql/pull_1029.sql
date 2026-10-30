-- MAKER-ABSENT (2026-10-30, SELECT only, through the Supabase connector, 03:24-03:27 UTC): the record from REVX-FAIR's end
-- (2026-10-29 00:00) to 2026-10-30 03:00 UTC, in REVX-FAIR's own formats (fair_price/sql/pulls.sql F1, F2, F4-F5), cut by
-- pr5_opt/scripts/grab_text.py, which refuses a payload whose md5 (computed by the database) or line count does not match,
-- and committed gzip'd under data/. The md5s the database gave:
--   prints2           768 lines  21bc68ab76472001ed0c5c9cbac0faf9
--   minutes2         3240 lines  97d10304b1e28caab2909c34ae1750d5
--   book2_USDC-GBP   1290 lines  5e9271cc141d14be87f2075ca4a5de3c
--   book2_USDT-GBP   1285 lines  d436231447b20cb3b544a14b54dd624f

-- Every stored Revolut X UK print of both books: id|book|ms|price|qty|aggressor.
select json_build_object('table','prints2','n',count(*),'md5',md5(string_agg(l, E'\n' order by ms, id)),'text',string_agg(l, E'\n' order by ms, id)) payload from (
select id, (extract(epoch from ts)*1000)::bigint ms, id||'|'||book||'|'||(extract(epoch from ts)*1000)::bigint||'|'||price||'|'||qty||'|'||side l
from agent_quote_prints where ts >= '2026-10-29T00:00:00Z' and ts < '2026-10-30T03:00:00Z') s;

-- PR5's minute record, the two GBP books: book|ms|x|fair_u|minutes between the minute and its GBP/USD bar|hours_n|prints_n.
select json_build_object('table','minutes2','n',count(*),'md5',md5(string_agg(l, E'\n' order by book, ms)),'text',string_agg(l, E'\n' order by book, ms)) payload from (
select book, (extract(epoch from minute)*1000)::bigint ms,
 book||'|'||(extract(epoch from minute)*1000)::bigint||'|'||coalesce(x::text,'')||'|'||coalesce(fair_u::text,'')||'|'||coalesce(((extract(epoch from minute)-extract(epoch from x_t))/60)::int::text,'')||'|'||coalesce(hours_n::text,'')||'|'||coalesce(prints_n::text,'') l
from agent_quote_minutes where minute >= '2026-10-29T00:00:00Z' and minute < '2026-10-30T03:00:00Z' and book in ('USDC-GBP','USDT-GBP')) s;

-- Revolut X's book snapshots of the two GBP books, one payload a book: ms|seen_until ms|price:qty:orders;...|price:qty:orders;...
select json_build_object('table','book2_'||book,'n',count(*),'md5',md5(string_agg(l, E'\n' order by ms)),'text',string_agg(l, E'\n' order by ms)) payload from (
select book, (extract(epoch from ts)*1000)::bigint ms,
 (extract(epoch from ts)*1000)::bigint||'|'||(extract(epoch from seen_until)*1000)::bigint||'|'||
 coalesce((select string_agg((e->>0)||':'||(e->>1)||':'||coalesce(e->>2,''), ';' order by o) from jsonb_array_elements(bids) with ordinality as a(e,o)),'')||'|'||
 coalesce((select string_agg((e->>0)||':'||(e->>1)||':'||coalesce(e->>2,''), ';' order by o) from jsonb_array_elements(asks) with ordinality as a(e,o)),'') l
from agent_book_levels where book in ('USDC-GBP','USDT-GBP') and ts >= '2026-10-29T00:00:00Z' and ts < '2026-10-30T03:00:00Z') s group by book;

-- LIVE's own fill prints from 2026-10-27 to 2026-10-30 03:00: sql/live_fill_prints.sql's question with `ts >= '2026-10-27' and
-- ts < '2026-10-30T03:00:00Z'` in place of `ts < '2026-10-29'`. 164 prints, md5 fe4ffea99dc72d54ed73e8e08d2d27c3. NOT committed
-- (with the tape it would give LIVE's fill sizes); handed to scripts/absent.py as $MM_LIVE_P8 with the first list.
