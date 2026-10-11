-- LP-CAPINV: the rebuilt cap (as cap_minutes.sql), what the holdings cost, the buys resting (committed less held at
-- cost) and the budget for buys (cap less held at cost), by hour from 2026-10-10. Read-only.
with recursive
f0 as (
  select f.token, f.side, f.price::numeric p, f.size::numeric s, f.match_time t from pm_lp_fills f where f.status = 'CONFIRMED'
  union all select s.yes_token, 'SELL', s.payout::numeric, 1e9, s.settled_at from pm_lp_settlements s
  union all select s.no_token, 'SELL', 1 - s.payout::numeric, 1e9, s.settled_at from pm_lp_settlements s
),
f as (select *, row_number() over (partition by token order by t, case side when 'BUY' then 0 else 1 end) k from f0),
b as (
  select token, k, t, case when side = 'BUY' then s else 0 end held, case when side = 'BUY' then p else 0 end avg, 0::numeric r from f where k = 1
  union all
  select f.token, f.k, f.t, case when f.side = 'BUY' then b.held + f.s else greatest(0, b.held - f.s) end,
    case when f.side = 'BUY' then (b.avg * b.held + f.p * f.s) / nullif(b.held + f.s, 0) when b.held - f.s <= 0 then 0 else b.avg end,
    case when f.side = 'SELL' then least(b.held, f.s) * (f.p - b.avg) else 0 end
  from b join f on f.token = b.token and f.k = b.k + 1
),
bd as (select t, held * coalesce(avg, 0) - coalesce(lag(held * coalesce(avg, 0)) over (partition by token order by k), 0) d, r from b),
run as (select t, sum(d) over (order by t rows unbounded preceding) heldcost, sum(r) over (order by t rows unbounded preceding) realised from bd),
mins as (select minute, max((detail->'lp'->>'committed')::numeric) committed from pm_lp_minutes where mode = 'live' and minute >= '2026-10-10' group by 1),
bud as (
  select m.minute, m.committed, x.heldcost,
    floor(402.028365 + x.realised + case when m.minute >= '2026-10-10 00:05+00' then 6.524180 else 0 end
        + case when m.minute >= '2026-10-10 01:00+00' then 1.976628 else 0 end
        + case when m.minute >= '2026-10-11 00:05+00' then 21.890765 else 0 end - 80) cap
  from mins m cross join lateral (select heldcost, realised from run where run.t <= m.minute order by run.t desc limit 1) x
)
select date_trunc('hour', minute) h, min(cap) cap_lo, max(cap) cap_hi, round(avg(heldcost), 0) held_cost,
  round(avg(committed - heldcost), 0) buys_resting, round(avg(cap - heldcost), 0) buy_budget,
  count(*) filter (where cap - committed < 10) mins_headroom_lt10
from bud group by 1 order by 1;
