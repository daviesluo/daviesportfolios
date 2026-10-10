-- LP-ALLOC: quotes that rest while the formula scores them 0, read-only. RW (pm_rw_*), RW-C (pm_rwc_*): a minute with a
-- side quoted (qb or qa) and our score `ours` 0; live-prep (pm_lp_minutes, dry-run and live): a minute with a side resting
-- (bid_price or ask_price) and `formula_usd` 0, and per side its own score (detail qBid / qAsk) 0. Each paper fill
-- (pm_rw_fills, pm_rwc_fills, pm_lpprep_fills) is classed by its minute's row (zero / scoring) and marked as
-- sql/markouts.sql marks it, 5 / 30 / 120 minutes later at the path's own mid.
with mins as (
  select 'RW' p, count(*) filter (where qb or qa) quoted, count(*) filter (where (qb or qa) and coalesce(ours, 0) = 0) zero from public.pm_rw_minutes
  union all select 'RW-C', count(*) filter (where qb or qa), count(*) filter (where (qb or qa) and coalesce(ours, 0) = 0) from public.pm_rwc_minutes
  union all select 'LP ' || mode, count(*) filter (where bid_price is not null or ask_price is not null), count(*) filter (where (bid_price is not null or ask_price is not null) and coalesce(formula_usd, 0) = 0) from public.pm_lp_minutes group by mode),
sides as (
  select 'LP ' || mode p, count(*) filter (where bid_price is not null) bid_rest, count(*) filter (where bid_price is not null and coalesce((detail->>'qBid')::numeric, 0) = 0) bid_zero,
    count(*) filter (where ask_price is not null) ask_rest, count(*) filter (where ask_price is not null and coalesce((detail->>'qAsk')::numeric, 0) = 0) ask_zero
  from public.pm_lp_minutes group by mode),
f as (
  select 'RW' p, f.cond, f.minute, f.side, f.price, f.size, (coalesce(x.ours, 0) = 0) zero from public.pm_rw_fills f left join public.pm_rw_minutes x on x.cond = f.cond and x.minute = f.minute
  union all select 'RW-C', f.cond, f.minute, f.side, f.price, f.size, (coalesce(x.ours, 0) = 0) from public.pm_rwc_fills f left join public.pm_rwc_minutes x on x.cond = f.cond and x.minute = f.minute
  union all select 'LP paper', f.cond, f.minute, f.side, f.price, f.size,
    (case when f.side = 'bid' then coalesce((x.detail->>'qBid')::numeric, 0) else coalesce((x.detail->>'qAsk')::numeric, 0) end = 0)
    from public.pm_lpprep_fills f left join public.pm_lp_minutes x on x.mode = 'dry_run' and x.cond = f.cond and x.minute = f.minute),
mk as (
  select f.*, case when side = 'bid' then 1 else -1 end s,
   coalesce((select m from public.pm_rw_minutes x where f.p = 'RW' and x.cond = f.cond and x.minute between f.minute + interval '5 min' and f.minute + interval '20 min' and x.m is not null order by x.minute limit 1),
            (select m from public.pm_rwc_minutes x where f.p = 'RW-C' and x.cond = f.cond and x.minute between f.minute + interval '5 min' and f.minute + interval '20 min' and x.m is not null order by x.minute limit 1),
            (select (ab + aa) / 2 from public.pm_lp_minutes x where f.p = 'LP paper' and x.mode = 'dry_run' and x.cond = f.cond and x.minute between f.minute + interval '5 min' and f.minute + interval '20 min' and x.ab is not null and x.aa is not null order by x.minute limit 1)) m5,
   coalesce((select m from public.pm_rw_minutes x where f.p = 'RW' and x.cond = f.cond and x.minute between f.minute + interval '30 min' and f.minute + interval '45 min' and x.m is not null order by x.minute limit 1),
            (select m from public.pm_rwc_minutes x where f.p = 'RW-C' and x.cond = f.cond and x.minute between f.minute + interval '30 min' and f.minute + interval '45 min' and x.m is not null order by x.minute limit 1),
            (select (ab + aa) / 2 from public.pm_lp_minutes x where f.p = 'LP paper' and x.mode = 'dry_run' and x.cond = f.cond and x.minute between f.minute + interval '30 min' and f.minute + interval '45 min' and x.ab is not null and x.aa is not null order by x.minute limit 1)) m30,
   coalesce((select m from public.pm_rw_minutes x where f.p = 'RW' and x.cond = f.cond and x.minute between f.minute + interval '120 min' and f.minute + interval '135 min' and x.m is not null order by x.minute limit 1),
            (select m from public.pm_rwc_minutes x where f.p = 'RW-C' and x.cond = f.cond and x.minute between f.minute + interval '120 min' and f.minute + interval '135 min' and x.m is not null order by x.minute limit 1),
            (select (ab + aa) / 2 from public.pm_lp_minutes x where f.p = 'LP paper' and x.mode = 'dry_run' and x.cond = f.cond and x.minute between f.minute + interval '120 min' and f.minute + interval '135 min' and x.ab is not null and x.aa is not null order by x.minute limit 1)) m120
  from f),
agg as (select p, zero, count(*) n, sum(size) sh,
  sum(s * (m5 - price) * size) filter (where m5 is not null) mo5, sum(size) filter (where m5 is not null) sh5,
  sum(s * (m30 - price) * size) filter (where m30 is not null) mo30, sum(size) filter (where m30 is not null) sh30,
  sum(s * (m120 - price) * size) filter (where m120 is not null) mo120, sum(size) filter (where m120 is not null) sh120 from mk group by p, zero)
select jsonb_build_object('minutes', (select jsonb_agg(to_jsonb(mins)) from mins), 'sides', (select jsonb_agg(to_jsonb(sides)) from sides), 'fills', (select jsonb_agg(to_jsonb(agg)) from agg)) payload
