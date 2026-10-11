-- LP-OBS-DEEP, item 3: how fast live-prep's live SELLs (exits and sells of what is held) fill, and what a filled sell
-- was worth against holding. Rate: every live SELL order's shares matched over the minutes it rested (from its ts to
-- its fill, cancel, or now). Markout: each CONFIRMED live SELL fill's price against its token's value 60 and 360
-- minutes later and at the latest mark (YES at (bb + ba)/2 of the next recorded live minute, NO at 1 - that; a settled
-- market at its payout); positive = the sell beat holding. Read-only.
with o as (
  select o.id, o.cond, o.size, coalesce(o.size_matched, 0) matched,
    extract(epoch from (least(case when o.state = 'live' then now() else coalesce(o.filled_at, o.cancelled_at, o.updated_at) end, o.ts + interval '2 hours') - o.ts)) / 60 rest_min
  from pm_lp_orders o where o.mode = 'live' and o.side = 'SELL' and o.state in ('live', 'filled', 'cancelled', 'expired') and o.hash is not null),
mk as (select distinct on (cond) cond, yes_token from pm_lp_markets order by cond, day desc),
f as (
  select fl.cond, fl.match_time t, fl.price, fl.size, fl.token = mk.yes_token is_yes
  from pm_lp_fills fl join mk on mk.cond = fl.cond where fl.side = 'SELL' and fl.status = 'CONFIRMED'),
v as (
  select f.*,
    (select (e.bb + e.ba) / 2 from pm_lp_minutes e where e.mode = 'live' and e.cond = f.cond and e.minute >= f.t + interval '60 min' and e.bb is not null and e.ba is not null order by e.minute limit 1) y60,
    (select (e.bb + e.ba) / 2 from pm_lp_minutes e where e.mode = 'live' and e.cond = f.cond and e.minute >= f.t + interval '360 min' and e.bb is not null and e.ba is not null order by e.minute limit 1) y360,
    coalesce((select s.payout from pm_lp_settlements s where s.cond = f.cond),
             (select (e.bb + e.ba) / 2 from pm_lp_minutes e where e.mode = 'live' and e.cond = f.cond and e.bb is not null and e.ba is not null order by e.minute desc limit 1)) ylast
  from f)
select 'rate' what, count(*) n, round(sum(matched), 2) shares, round(sum(rest_min)) rest_minutes,
  round(sum(matched) / nullif(sum(rest_min), 0), 4) shares_per_rest_minute, null::numeric m60, null::numeric m360, null::numeric mlast
from o
union all
select 'markout', count(*), round(sum(size), 2), null, null,
  round(sum(size * (price - case when is_yes then y60 else 1 - y60 end)) / nullif(sum(size) filter (where y60 is not null), 0), 4),
  round(sum(size * (price - case when is_yes then y360 else 1 - y360 end)) / nullif(sum(size) filter (where y360 is not null), 0), 4),
  round(sum(size * (price - case when is_yes then ylast else 1 - ylast end)) / nullif(sum(size), 0), 4)
from v;
