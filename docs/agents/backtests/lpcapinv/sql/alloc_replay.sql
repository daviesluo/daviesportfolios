-- LP-CAPINV: the cap's buy budget handed out two ways, replayed on every live minute. Read-only.
--
-- Each minute's budget for resting buys is the cap less what the holdings cost: B = cap − held at cost (the cap as
-- cap_minutes.sql rebuilds it; held at cost from the CONFIRMED fills and the settlement by average cost, as
-- `tokenBooks`). That is the closed form of the turn's check: committed = held at cost + resting buys ≤ cap.
-- Each market of today's in state 'quote' whose raw touch is wider than one tick wants, per side, a BUY of N
-- (YES at bb, NO at 1 − ba, the touch the minute stored) unless the token that side would sell is held ≥ N, in which
-- case that side is a SELL and costs nothing (`lpQuotes`).
--   now:  the turn's order, slot key (condition id, then token id), each BUY funded if it still fits, else skipped.
--   rank: today's rank (pm_lp_markets.rank), a market's two sides funded together or not at all.
-- A market counts as two-sided when both its sides are funded or are sells; its weight is its selection's formula a
-- minute (formula_day / 1440). The minute's real fills, holdings and orders are as recorded: neither order's fills are
-- re-simulated, so this prices the allocation, not what it would have bought.
with recursive
-- extra budget in dollars: 0 = as live; 80 = the cap's $80 lifted (options c/d, bounded by pUSD); 230 = every
-- sellable carried holding turned into pUSD at its mid (option b, done at once)
params as (select 0::numeric extra),
f0 as (
  select f.token, f.side, f.price::numeric p, f.size::numeric s, f.match_time t from pm_lp_fills f where f.status = 'CONFIRMED'
  union all select s.yes_token, 'SELL', s.payout::numeric, 1e9, s.settled_at from pm_lp_settlements s
  union all select s.no_token, 'SELL', 1 - s.payout::numeric, 1e9, s.settled_at from pm_lp_settlements s
),
f as (select *, row_number() over (partition by token order by t, case side when 'BUY' then 0 else 1 end) k from f0),
b as (
  select token, k, t, case when side = 'BUY' then s else 0 end held, case when side = 'BUY' then p else 0 end avg, 0::numeric r
  from f where k = 1
  union all
  select f.token, f.k, f.t,
    case when f.side = 'BUY' then b.held + f.s else greatest(0, b.held - f.s) end,
    case when f.side = 'BUY' then (b.avg * b.held + f.p * f.s) / nullif(b.held + f.s, 0) when b.held - f.s <= 0 then 0 else b.avg end,
    case when f.side = 'SELL' then least(b.held, f.s) * (f.p - b.avg) else 0 end
  from b join f on f.token = b.token and f.k = b.k + 1
),
-- each token's cost held after each of its fills, and the change it made to the total
bd as (select t, held * coalesce(avg, 0) - coalesce(lag(held * coalesce(avg, 0)) over (partition by token order by k), 0) d, r from b),
run as (select t, sum(d) over (order by t rows unbounded preceding) heldcost, sum(r) over (order by t rows unbounded preceding) realised from bd),
mins as (select distinct minute from pm_lp_minutes where mode = 'live'),
bud as (
  select m.minute, x.heldcost, x.realised,
    case when m.minute < '2026-10-09 15:20+00' then 320
      else floor(402.028365 + x.realised
        + case when m.minute >= '2026-10-10 00:05+00' then 6.524180 else 0 end
        + case when m.minute >= '2026-10-10 01:00+00' then 1.976628 else 0 end
        + case when m.minute >= '2026-10-11 00:05+00' then 21.890765 else 0 end - 80) end + (select extra from params) cap
  from mins m cross join lateral (select heldcost, realised from run where run.t <= m.minute order by run.t desc limit 1) x
),
mk as (
  select x.minute, x.cond, k.rank, k.formula_day / 1440 w, k.yes_token, k.no_token,
    case when coalesce((x.detail->'lp'->'held'->>'no')::numeric, 0) >= (x.detail->'lp'->>'n')::numeric - 1e-9 then 0
      else (x.detail->'lp'->>'n')::numeric * x.bb end cy,
    case when coalesce((x.detail->'lp'->'held'->>'yes')::numeric, 0) >= (x.detail->'lp'->>'n')::numeric - 1e-9 then 0
      else (x.detail->'lp'->>'n')::numeric * (1 - x.ba) end cn
  from pm_lp_minutes x join pm_lp_markets k on k.cond = x.cond and k.day = (x.minute at time zone 'utc')::date
  where x.mode = 'live' and x.detail->'lp'->>'state' = 'quote' and (x.ba - x.bb) > x.tick + 1e-9 and x.bb is not null and x.ba is not null
),
-- the turn's order: one row per BUY slot, by condition id then token id (the slot key), in the minutes where the
-- wanted buys cost more than the budget (elsewhere both orders fund everything)
tot as (select m.minute, sum(m.cy + m.cn) want from mk m group by 1),
bound as (select t.minute from tot t join bud bu using (minute) where t.want > bu.cap - bu.heldcost + 1e-9),
slots as (
  select minute, cond, cy cost, 'y' s, yes_token tok from mk where cy > 0 and minute in (select minute from bound)
  union all select minute, cond, cn, 'n', no_token from mk where cn > 0 and minute in (select minute from bound)
),
so2 as (select minute, cond, cost, s, row_number() over (partition by minute order by cond, tok) i from slots),
gnow as (
  select s.minute, s.i, s.cond, s.s, s.cost, (s.cost <= bu.cap - bu.heldcost + 1e-9) funded,
    case when s.cost <= bu.cap - bu.heldcost + 1e-9 then s.cost else 0 end used, bu.cap - bu.heldcost budget
  from so2 s join bud bu using (minute) where s.i = 1
  union all
  select s.minute, s.i, s.cond, s.s, s.cost, (g.used + s.cost <= g.budget + 1e-9),
    g.used + case when g.used + s.cost <= g.budget + 1e-9 then s.cost else 0 end, g.budget
  from gnow g join so2 s on s.minute = g.minute and s.i = g.i + 1
),
gagg as (
  select minute, cond, bool_or(funded and s = 'y') fy, bool_or(funded and s = 'n') fn, count(*) filter (where funded) nbuys
  from gnow group by 1, 2
),
nowmk as (
  select m.minute, m.cond, m.w, (b.minute is not null) bound,
    case when b.minute is null then true else (m.cy = 0 or coalesce(g.fy, false)) and (m.cn = 0 or coalesce(g.fn, false)) end two,
    coalesce(g.nbuys, 0) nbuys
  from mk m left join bound b using (minute) left join gagg g using (minute, cond)
),
rk as (select minute, cond, w, cy + cn cost, row_number() over (partition by minute order by rank, cond) i from mk where minute in (select minute from bound)),
grank as (
  select r.minute, r.i, r.cond, r.w, (r.cost <= bu.cap - bu.heldcost + 1e-9) funded,
    case when r.cost <= bu.cap - bu.heldcost + 1e-9 then r.cost else 0 end used, bu.cap - bu.heldcost budget
  from rk r join bud bu using (minute) where r.i = 1
  union all
  select r.minute, r.i, r.cond, r.w, (g.used + r.cost <= g.budget + 1e-9),
    g.used + case when g.used + r.cost <= g.budget + 1e-9 then r.cost else 0 end, g.budget
  from grank g join rk r on r.minute = g.minute and r.i = g.i + 1
)
select (n.minute at time zone 'utc')::date as utc_day,
  count(distinct n.minute) minutes,
  count(*) market_minutes,
  count(distinct n.minute) filter (where n.bound) bound_minutes,
  count(*) filter (where n.two) two_now, count(*) filter (where not n.bound or g.funded) two_rank,
  count(*) filter (where not n.two and n.nbuys > 0) one_sided_buys_now,
  round(sum(n.w), 2) w_all, round(sum(n.w) filter (where n.two), 2) w_now, round(sum(n.w) filter (where not n.bound or g.funded), 2) w_rank
from nowmk n left join grank g on g.minute = n.minute and g.cond = n.cond
group by 1 order by 1;
