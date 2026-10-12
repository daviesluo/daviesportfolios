-- LP-SPEED (d): do fills come sooner after a post than chance would give? For every live order that rested
-- (the venue answered it live), its time at risk from the venue's created_at to its first fill, its cancel or its
-- expiry, binned by age; and the first fills by the age at which they came. Under a constant hazard the fills fall in
-- each bin in proportion to its exposure. Read-only; the period is the live run before the total stop (to 07:30 UTC
-- on 2026-10-12), by gate (open = buys, reduce = sells of what is held). Two queries; each answers one CSV text.

-- 1. Pooled: gate, lo, hi, exposure hours, first fills, orders alive at lo.
with o as (
  select o.id, o.gate, o.side, (o.response->'readBack'->>'created_at')::bigint as c,
         (select min(extract(epoch from f.match_time)) from pm_lp_fills f where f.hash = o.hash) as f1,
         extract(epoch from o.cancelled_at) as x, o.expiration - 60 as e
  from pm_lp_orders o
  where o.mode = 'live' and o.response->'readBack'->>'created_at' is not null and o.ts < '2026-10-12 07:30+00'
), r as (
  select id, gate, c, f1, least(coalesce(f1, 1e12), coalesce(x, 1e12), e, extract(epoch from timestamptz '2026-10-12 07:30+00')) - c as life,
         case when f1 is null then null else greatest(0, f1 - c) end as age_fill from o where c is not null
), b(lo, hi) as (values (0,1),(1,2),(2,5),(5,10),(10,20),(20,30),(30,60),(60,120),(120,300),(300,600),(600,100000))
select string_agg(concat_ws(',', coalesce(gate,'all'), lo, hi, exposure_h, first_fills, alive), E'\n' order by coalesce(gate,'zz'), lo) from (
select gate, lo, hi,
  round(sum(greatest(0, least(life, hi) - lo))::numeric / 3600, 3) as exposure_h,
  count(*) filter (where age_fill >= lo and age_fill < hi) as first_fills,
  count(*) filter (where life > lo) as alive
from r, b group by rollup(gate), lo, hi) z;

-- 2. The same with the market's own activity held fixed: each (market, UTC hour, gate) stratum's first fills are
-- spread over the age bins in proportion to that stratum's own exposure, so a bin's expected count is what a constant
-- hazard WITHIN each market-hour gives (young orders sit more often in busy markets, which the pooled table confounds).
-- gate, lo, hi, observed, expected, observed / expected.
with o as (
  select o.id, o.cond, o.gate, (o.response->'readBack'->>'created_at')::bigint as c,
         (select min(extract(epoch from f.match_time)) from pm_lp_fills f where f.hash = o.hash) as f1,
         extract(epoch from o.cancelled_at) as x, o.expiration - 60 as e
  from pm_lp_orders o
  where o.mode = 'live' and o.response->'readBack'->>'created_at' is not null and o.ts < '2026-10-12 07:30+00'
), r as (
  select id, cond, gate, c, date_trunc('hour', to_timestamp(c)) as hr,
         least(coalesce(f1, 1e12), coalesce(x, 1e12), e, extract(epoch from timestamptz '2026-10-12 07:30+00')) - c as life,
         case when f1 is null then null else greatest(0, f1 - c) end as age_fill from o where c is not null
), b(lo, hi) as (values (0,1),(1,2),(2,5),(5,10),(10,20),(20,30),(30,60),(60,120),(120,300),(300,600))
, s as (
  select cond, hr, gate, lo, hi, sum(greatest(0, least(life, hi) - lo)) as ex,
         count(*) filter (where age_fill >= lo and age_fill < hi) as ff
  from r, b group by cond, hr, gate, lo, hi
), t as (
  select *, sum(ex) over (partition by cond, hr, gate) as ex_all, sum(ff) over (partition by cond, hr, gate) as ff_all from s
)
select string_agg(concat_ws(',', coalesce(gate, 'all'), lo, hi, obs, round(expd, 2), round(obs / nullif(expd, 0), 2)), E'\n' order by coalesce(gate, 'zz'), lo) from (
  select gate, lo, hi, sum(ff) as obs, sum(case when ex_all > 0 then ff_all * ex / ex_all else 0 end) as expd
  from t group by rollup(gate), lo, hi
) z where lo is not null;
