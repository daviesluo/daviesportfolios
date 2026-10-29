-- Everything else the study reads from production, as {table, n, md5, text} payloads (scripts/grab.py checks each):
--   touch   : cb_touch, the recorder's touch read at the top of each minute (four books), 10-10 → 10-29.
--             Line: product, minute (epoch / 60), seconds into the minute, bid, ask, bid size, ask size.
--   fx      : agent_quote_inputs kind 'fx' (Yahoo GBP/USD minutes, PR5's) and cb_quote_inputs kind 'fx:EURUSD' (Yahoo EUR/USD).
--             Line: kind, minute (epoch / 60), value.
--   hours   : agent_quote_inputs 'fair:USDC-USD' / 'fair:USDT-USD' (Revolut X UK hourly closes). Line: kind, hour start (epoch / 60), close.
--   trips   : the three Coinbase arms' round trips (cb_quote_trips, cb_hold_trips, cb_usdc_trips), one JSON row a line with its arm.
--   refused : per arm, book, UTC day: entry orders placed or re-placed and post-only refusals (cb_*_events).
with tc as (
  select product, ts, bid, ask, bid_size, ask_size from public.cb_touch where ts >= '2026-10-10T00:00:00Z' and ts < '2026-10-29T00:00:00Z'
), t1 as (
  select string_agg(concat_ws(chr(9), product, (extract(epoch from date_trunc('minute', ts)) / 60)::bigint,
    round(extract(epoch from ts - date_trunc('minute', ts))::numeric, 2), bid, ask, bid_size, ask_size), E'\n' order by product, ts) text, count(*) n from tc
), fx as (
  select 'GBPUSD' kind, t, value from public.agent_quote_inputs where kind = 'fx' and t >= '2026-10-08T00:00:00Z' and t < '2026-10-29T00:00:00Z'
  union all select 'EURUSD', t, value from public.cb_quote_inputs where kind = 'fx:EURUSD' and t >= '2026-10-08T00:00:00Z' and t < '2026-10-29T00:00:00Z'
), t2 as (select string_agg(concat_ws(chr(9), kind, (extract(epoch from t) / 60)::bigint, value), E'\n' order by kind, t) text, count(*) n from fx),
hr as (select kind, t, value from public.agent_quote_inputs where kind like 'fair:%' and t >= '2026-09-22T00:00:00Z' and t < '2026-10-29T00:00:00Z'),
t3 as (select string_agg(concat_ws(chr(9), kind, (extract(epoch from t) / 60)::bigint, value), E'\n' order by kind, t) text, count(*) n from hr),
tr as (
  select 'base' arm, row_to_json(x)::text j, x.fill_ts from public.cb_quote_trips x
  union all select 'hold', row_to_json(x)::text, x.fill_ts from public.cb_hold_trips x
  union all select 'usdc', row_to_json(x)::text, x.fill_ts from public.cb_usdc_trips x
), t4 as (select string_agg(arm || chr(9) || j, E'\n' order by arm, fill_ts) text, count(*) n from tr),
ev as (
  select 'base' arm, book, (minute at time zone 'UTC')::date d, kind, detail from public.cb_quote_events
  union all select 'hold', book, (minute at time zone 'UTC')::date, kind, detail from public.cb_hold_events
  union all select 'usdc', book, (minute at time zone 'UTC')::date, kind, detail from public.cb_usdc_events
), ag as (
  select arm, book, d,
    count(*) filter (where kind = 'order' and detail->>'leg' = 'entry') entry_orders,
    count(*) filter (where kind = 'order' and detail->>'leg' = 'exit') exit_orders,
    count(*) filter (where kind = 'refused') refused,
    count(*) filter (where kind = 'fill') fills,
    count(*) filter (where kind = 'stop') stops
  from ev group by 1, 2, 3
), t5 as (select string_agg(concat_ws(chr(9), arm, book, d, entry_orders, exit_orders, refused, fills, stops), E'\n' order by arm, book, d) text, count(*) n from ag)
select json_build_object('table', 'touch', 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) payload from t1
union all select json_build_object('table', 'fx', 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) from t2
union all select json_build_object('table', 'hours', 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) from t3
union all select json_build_object('table', 'trips', 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) from t4
union all select json_build_object('table', 'events_daily', 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) from t5;
