-- EXPENSIVE-LIMIT (2026-10-09): live-prep's own paper record (pm_lpprep_minutes, 2026-10-04 17:55 -> 10-09 01:32 UTC),
-- read-only through the Supabase connector. For each limit f (a share of the path's capital, $320) and threshold thr:
-- the minutes in which the market's expensive side was a BUY (its cheap token held < N, not close-only) at a price
-- >= thr that the limit would have stopped (that token's paper holding at the minute's mark plus N at the price > f x
-- 320), and the formula reward those minutes paid (a stopped expensive side leaves a lone quote, which scores nothing
-- outside [0.10, 0.90]). First order: the holdings are the record's own, not what the limit would have left (which
-- are lower), so the minutes and the reward it stops are upper bounds.
with m as (
  select minute, cond, reward, n, close_only, class,
    case when mark >= 0.5 then b else 1 - a end as px,
    case when mark >= 0.5 then yes_held else no_held end as hexp,
    case when mark >= 0.5 then no_held else yes_held end as hcheap,
    greatest(mark, 1 - mark) as mexp
  from pm_lpprep_minutes where greatest(mark, 1 - mark) >= 0.90 and b is not null and a is not null and n is not null
), g as (
  select t.thr, f.f from (values (0.93),(0.95),(0.97)) t(thr), (values (0.03),(0.045),(0.0625),(0.08),(0.10),(0.125),(0.15),(0.20),(0.25),(9.0)) f(f)
), blk as (
  select g.thr, g.f, m.* , (not close_only and hcheap < n and px >= g.thr and hexp * mexp + n * px > g.f * 320) as blocked
  from m cross join g
)
select thr, f, count(*) filter (where blocked) as blocked_min,
  round(sum(reward) filter (where blocked), 2) as reward_lost,
  round(sum(reward), 2) as reward_all_near,
  max(hexp * mexp) filter (where not blocked and hcheap < n and px >= thr and not close_only) as max_held_when_buy_rests
from blk group by thr, f order by thr, f;
-- And the live path's own near-certain buys since it was armed (2026-10-09 01:32 UTC), read 14:47 UTC:
-- select mode, cond, count(*) as orders, sum(size_matched::numeric) as matched,
--   round(sum(extract(epoch from (coalesce(cancelled_at, filled_at, least(now(), to_timestamp(expiration::bigint))) - ts)))/60) as rest_min
-- from pm_lp_orders where side = 'BUY' and price >= 0.95 and state <> 'rejected' and ts >= '2026-10-09 01:32' and mode = 'live'
-- group by mode, cond;
