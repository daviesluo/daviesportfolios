-- LP-CAPINV: live-prep's holdings now, per token, at average cost (as `tokenBooks` in pm_live.ts keeps them:
-- CONFIRMED fills by match_time, a BUY first at a tie, a settlement booked as a sell at its payout), beside the
-- minute's adjusted mid (pm_lp_minutes.detail.m, the newest live minute of the market), whether the market is in
-- today's rows of pm_lp_markets, the day it was first taken, and what SELL of it rests now. Read-only.
with recursive
f0 as (
  select f.cond, f.token, f.side, f.price::numeric p, f.size::numeric s, f.match_time t
  from pm_lp_fills f where f.status = 'CONFIRMED'
  union all
  -- a settlement is each token sold at its payout at settled_at (`settlementFills`)
  select s.cond, s.yes_token, 'SELL', s.payout::numeric, 1e9, s.settled_at from pm_lp_settlements s
  union all
  select s.cond, s.no_token, 'SELL', 1 - s.payout::numeric, 1e9, s.settled_at from pm_lp_settlements s
),
f as (select *, row_number() over (partition by token order by t, case side when 'BUY' then 0 else 1 end) k from f0),
b as (
  select token, cond, k,
    case when side = 'BUY' then s else 0 end held,
    case when side = 'BUY' then p else 0 end avg,
    0::numeric realised
  from f where k = 1
  union all
  select f.token, f.cond, f.k,
    case when f.side = 'BUY' then b.held + f.s else greatest(0, b.held - f.s) end,
    case when f.side = 'BUY' then (b.avg * b.held + f.p * f.s) / nullif(b.held + f.s, 0)
         when b.held - f.s <= 0 then 0 else b.avg end,
    b.realised + case when f.side = 'SELL' then least(b.held, f.s) * (f.p - b.avg) else 0 end
  from b join f on f.token = b.token and f.k = b.k + 1
),
last as (select distinct on (token) token, cond, held, coalesce(avg, 0) avg, realised from b order by token, k desc),
mk as (select distinct on (cond) cond, yes_token, no_token, question from pm_lp_markets order by cond, day desc),
first_day as (select cond, min(day) d0, max(day) d1, bool_or(day = (now() at time zone 'utc')::date) today from pm_lp_markets group by cond),
mid as (select distinct on (cond) cond, minute, (detail->>'m')::numeric m from pm_lp_minutes where mode = 'live' and detail->>'m' is not null order by cond, minute desc),
sells as (select token, sum(size - size_matched) sz, min(price) px from pm_lp_orders where mode = 'live' and state = 'live' and side = 'SELL' group by token)
select left(l.cond, 10) cond, case when l.token = mk.yes_token then 'YES' else 'NO' end tok, left(mk.question, 60) q,
  fd.d0, fd.today, round(l.held, 4) held, round(l.avg, 4) avg_cost, round(l.held * l.avg, 2) at_cost,
  round(case when l.token = mk.yes_token then mid.m else 1 - mid.m end, 4) mark,
  round(l.held * case when l.token = mk.yes_token then mid.m else 1 - mid.m end, 2) at_mid,
  round(l.realised, 2) realised, sells.sz sell_resting, sells.px sell_px, mid.minute mark_minute
from last l join mk on mk.cond = l.cond join first_day fd on fd.cond = l.cond
left join mid on mid.cond = l.cond left join sells on sells.token = l.token
where l.held > 0.001
order by l.held * l.avg desc;
