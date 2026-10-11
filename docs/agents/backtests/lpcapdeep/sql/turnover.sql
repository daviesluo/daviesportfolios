-- LP-CAPDEEP: how fast a resting buy dollar fills, live. Resting buys a minute = the turn's stored committed (held at
-- cost + resting buys) less held at cost rebuilt from the CONFIRMED fills (as alloc_extra.sql); fills = CONFIRMED BUY
-- fills' notional that UTC day. Read-only.
with recursive
f0 as (
  select f.token, f.side, f.price::numeric p, f.size::numeric s, f.match_time t from pm_lp_fills f where f.status = 'CONFIRMED'
  union all select s.yes_token, 'SELL', s.payout::numeric, 1e9, s.settled_at from pm_lp_settlements s
  union all select s.no_token, 'SELL', 1 - s.payout::numeric, 1e9, s.settled_at from pm_lp_settlements s
),
f as (select *, row_number() over (partition by token order by t, case side when 'BUY' then 0 else 1 end) k from f0),
b as (
  select token, k, t, case when side = 'BUY' then s else 0 end held, case when side = 'BUY' then p else 0 end avg
  from f where k = 1
  union all
  select f.token, f.k, f.t,
    case when f.side = 'BUY' then b.held + f.s else greatest(0, b.held - f.s) end,
    case when f.side = 'BUY' then (b.avg * b.held + f.p * f.s) / nullif(b.held + f.s, 0) when b.held - f.s <= 0 then 0 else b.avg end
  from b join f on f.token = b.token and f.k = b.k + 1
),
bd as (select t, held * coalesce(avg, 0) - coalesce(lag(held * coalesce(avg, 0)) over (partition by token order by k), 0) d from b),
run as (select t, sum(d) over (order by t rows unbounded preceding) heldcost from bd),
mins as (select minute, max((detail->'lp'->>'committed')::numeric) committed from pm_lp_minutes where mode='live' and minute >= '2026-10-09 02:00' group by minute),
x as (select m.minute, m.committed, (select heldcost from run where run.t <= m.minute order by run.t desc limit 1) heldcost from mins m),
buys as (select (match_time at time zone 'utc')::date d, sum(price*size) usd, count(*) n from pm_lp_fills where status='CONFIRMED' and side='BUY' group by 1)
select (x.minute at time zone 'utc')::date d, count(*) minutes, round(avg(x.committed - x.heldcost),2) resting_buys, round(avg(x.heldcost),2) held,
  round(bu.usd, 2) buys_usd, bu.n, round(bu.usd / (avg(x.committed - x.heldcost) * count(*) / 1440), 3) fill_per_resting_dollar_day
from x join buys bu on bu.d = (x.minute at time zone 'utc')::date group by 1, bu.usd, bu.n order by 1;
