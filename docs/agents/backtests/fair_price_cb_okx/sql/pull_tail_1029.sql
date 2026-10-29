-- The rates and Coinbase's USDC-EUR touch of 2026-10-29 00:00 → 06:00 UTC, for the OKX part (its record runs past the Coinbase
-- window's end). Same line shapes as pull_inputs.sql's fx and touch; tables fx_1029 and touch_1029.
with fx as (
  select 'GBPUSD' kind, t, value from public.agent_quote_inputs where kind = 'fx' and t >= '2026-10-29T00:00:00Z' and t < '2026-10-29T06:00:00Z'
  union all select 'EURUSD', t, value from public.cb_quote_inputs where kind = 'fx:EURUSD' and t >= '2026-10-29T00:00:00Z' and t < '2026-10-29T06:00:00Z'
), t2 as (select string_agg(concat_ws(chr(9), kind, (extract(epoch from t) / 60)::bigint, value), E'\n' order by kind, t) text, count(*) n from fx),
tc as (select product, ts, bid, ask, bid_size, ask_size from public.cb_touch where product = 'USDC-EUR' and ts >= '2026-10-29T00:00:00Z' and ts < '2026-10-29T06:00:00Z'),
t1 as (select string_agg(concat_ws(chr(9), product, (extract(epoch from date_trunc('minute', ts)) / 60)::bigint,
    round(extract(epoch from ts - date_trunc('minute', ts))::numeric, 2), bid, ask, bid_size, ask_size), E'\n' order by product, ts) text, count(*) n from tc)
select json_build_object('table', 'fx_1029', 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) payload from t2
union all select json_build_object('table', 'touch_1029', 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) from t1;
