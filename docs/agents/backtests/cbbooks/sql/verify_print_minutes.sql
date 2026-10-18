-- 0132's aggregation (the g and r CTEs of cb_print_minutes_build, copied), unnested back into CBBOOKS-1's pull format
-- (sql/pull_trades.sql: second since 2026-10-10T03:00Z, price steps, b|s aggressor, hundredths, prints), md5 per pull.
-- BEFORE 0132 applies it checks the aggregation against the md5s in MANIFEST.json (trades_*); AFTER, swap the r CTE for
-- `select product, minute mi, sec s, px x, buy b, n c, sz z from public.cb_print_minutes` to check the stored table.
with w(name, product, t0, t1) as (values
  ('trades_USDC-GBP', 'USDC-GBP', timestamptz '2026-10-10T03:00:00Z', timestamptz '2026-10-18T04:10:00Z'),
  ('trades_USDT-GBP', 'USDT-GBP', timestamptz '2026-10-10T03:00:00Z', timestamptz '2026-10-18T04:10:00Z'),
  ('trades_USDT-EUR', 'USDT-EUR', timestamptz '2026-10-10T03:00:00Z', timestamptz '2026-10-18T04:10:00Z'),
  ('trades_USDC-EUR_1', 'USDC-EUR', timestamptz '2026-10-10T03:00:00Z', timestamptz '2026-10-14T03:00:00Z'),
  ('trades_USDC-EUR_2', 'USDC-EUR', timestamptz '2026-10-14T03:00:00Z', timestamptz '2026-10-18T04:10:00Z')
), g as (
  select t.product, date_trunc('minute', t.ts) mi, floor(extract(second from t.ts))::smallint s,
         round(t.price / case when t.product = 'USDT-EUR' then 0.00001 else 0.0001 end)::integer x,
         t.side = 'buy' b, count(*)::integer c, round(sum(t.size) * 100)::bigint z
  from public.cb_trades t
  where t.ts >= '2026-10-10T03:00:00Z' and t.ts < '2026-10-18T04:10:00Z'
  group by 1, 2, 3, 4, 5
), r as (
  select product, mi,
         array_agg(s order by s, x, b desc) s, array_agg(x order by s, x, b desc) x, array_agg(b order by s, x, b desc) b,
         array_agg(c order by s, x, b desc) c, array_agg(z order by s, x, b desc) z
  from g group by 1, 2
), e as (
  select r.product, r.mi, u.s, u.x, u.b, u.c, u.z
  from r cross join lateral unnest(r.s, r.x, r.b, r.c, r.z) u(s, x, b, c, z)
), l as (
  select w.name, (extract(epoch from e.mi - timestamptz '2026-10-10T03:00:00Z')::bigint + e.s) sec, e.x, case when e.b then 'b' else 's' end sd, e.z, e.c
  from e join w on w.product = e.product and e.mi >= w.t0 and e.mi < w.t1
)
select name, count(*) n, md5(string_agg(concat_ws(' ', sec, x, sd, z, c), E'\n' order by sec, x, sd)) md5 from l group by name order by name;
