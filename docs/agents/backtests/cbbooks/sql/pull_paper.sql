-- The two Coinbase paper rows' order logs and trips over the window: "with Euros" (base: cb_quote_events, cb_quote_trips)
-- and "with Euros - 2" (hold: cb_hold_events, cb_hold_trips). Two {table, n, md5, text} payloads.
with e as (
  select 'base' arm, book, minute, side, k, kind, ticks, detail from cb_quote_events where minute >= '2026-10-10T03:00:00Z' and minute < '2026-10-18T03:00:00Z'
  union all
  select 'hold', book, minute, side, k, kind, ticks, detail from cb_hold_events where minute >= '2026-10-10T03:00:00Z' and minute < '2026-10-18T03:00:00Z'
), tr as (
  select 'base' arm, * from cb_quote_trips union all select 'hold', * from cb_hold_trips
), t1 as (select string_agg(concat_ws(chr(9), arm, book, extract(epoch from minute)::bigint, side, k, kind, coalesce(ticks::text,'-'), detail::text), E'\n' order by arm, book, minute, side, k, kind) text, count(*) n from e),
t2 as (select string_agg(row_to_json(tr)::text, E'\n' order by arm, book, fill_ts) text, count(*) n from tr)
select json_build_object('table', 'paper_events', 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) payload from t1
union all select json_build_object('table', 'paper_trips', 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) from t2;
