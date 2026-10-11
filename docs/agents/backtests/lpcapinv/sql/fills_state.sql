-- LP-CAPINV: every live fill with the state its market was in that minute ('quote' = today's and taking entries,
-- 'carried' = held from another day or taken out today, close-only sells), the minute's adjusted mid
-- (detail.m, in the token's terms: YES m, NO 1 − m), and the mid 60 minutes, 6 hours and 24 hours on (the last mid
-- read before that time; null when the market left the record or the time has not come). Read-only.
with mk as (select distinct on (cond) cond, yes_token, no_token from pm_lp_markets order by cond, day desc),
f as (
  select f.cond, f.side, f.price::numeric p, f.size::numeric s, f.match_time t, (f.token = mk.yes_token) yes
  from pm_lp_fills f join mk on mk.cond = f.cond where f.status = 'CONFIRMED'
),
x as (
  select f.*,
    (select m.detail->'lp'->>'state' from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.minute <= f.t order by m.minute desc limit 1) st,
    (select (m.detail->>'m')::numeric from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.minute <= f.t and m.detail->>'m' is not null order by m.minute desc limit 1) m0,
    (select (m.detail->>'m')::numeric from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.minute <= f.t + interval '60 min' and m.minute > f.t and m.detail->>'m' is not null order by m.minute desc limit 1) m60,
    (select (m.detail->>'m')::numeric from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.minute <= f.t + interval '6 hours' and m.minute > f.t + interval '5 hours' and m.detail->>'m' is not null order by m.minute desc limit 1) m360,
    (select s.payout::numeric from pm_lp_settlements s where s.cond = f.cond) payout
  from f
)
select st, side,
  count(*) fills, round(sum(s), 1) shares, round(sum(p * s), 2) usd,
  -- edge at the fill against the mid (+ = we sold above / bought below the mid), in $ and in ¢ a share
  round(sum(s * case when side = 'SELL' then p - (case when yes then m0 else 1 - m0 end) else (case when yes then m0 else 1 - m0 end) - p end), 2) edge_usd,
  round(100 * sum(s * case when side = 'SELL' then p - (case when yes then m0 else 1 - m0 end) else (case when yes then m0 else 1 - m0 end) - p end) / sum(s), 2) edge_c,
  -- markout at 60 min / 6 h: the edge less the mid's move against the fill (for a sell, a mid that rises after it costs)
  round(100 * sum(s * case when side = 'SELL' then p - (case when yes then m60 else 1 - m60 end) else (case when yes then m60 else 1 - m60 end) - p end) filter (where m60 is not null) / nullif(sum(s) filter (where m60 is not null), 0), 2) mo60_c,
  round(100 * sum(s * case when side = 'SELL' then p - (case when yes then m360 else 1 - m360 end) else (case when yes then m360 else 1 - m360 end) - p end) filter (where m360 is not null) / nullif(sum(s) filter (where m360 is not null), 0), 2) mo6h_c,
  count(*) filter (where m360 is not null) n6h
from x group by rollup (st, side) order by st nulls last, side nulls last;
