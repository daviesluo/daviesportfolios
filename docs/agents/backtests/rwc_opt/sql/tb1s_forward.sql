-- TB1-SELLS (2026-10-09), read-only on live-prep's paper record (pm_lpprep_*, 2026-10-04 17:55 -> 10-09 01:32 UTC):
-- the 60-minute mark-out of each paper fill in YES terms (a bid fill earns mid60 - price, an ask fill price - mid60), split
-- by the token side (a SELL of a held token or a BUY) and by whether the minute's touch was at most one tick (the tick
-- from the market's latest pm_lp_markets row), with each market-hour's sum for the cluster bootstrap in the report.
with mk as (select distinct on (cond) cond, tick from pm_lp_markets order by cond, day desc),
f as (select fl.*, (p.ba - p.bb) <= mk.tick + 1e-9 tight, (g.bb + g.ba) / 2 mid60, (h.bb + h.ba) / 2 mid15,
  case when fl.side = 'bid' then 1 else -1 end sg
  from pm_lpprep_fills fl join mk using (cond) left join pm_lpprep_minutes p on p.cond = fl.cond and p.minute = fl.minute
  left join pm_lpprep_minutes g on g.cond = fl.cond and g.minute = fl.minute + interval '60 minutes'
  left join pm_lpprep_minutes h on h.cond = fl.cond and h.minute = fl.minute + interval '15 minutes')
select token_side, tight, count(*) n, count(mid60) n60, round(sum(size)) shares, count(distinct cond) mkts,
  count(distinct (cond, date_trunc('hour', minute))) mkt_hours,
  round(sum(size * sg * (mid15 - price)) / nullif(sum(size) filter (where mid15 is not null), 0) * 100, 2) mo15_c,
  round(sum(size * sg * (mid60 - price)) / nullif(sum(size) filter (where mid60 is not null), 0) * 100, 2) mo60_c
from f group by rollup(1, 2) order by 1, 2;
-- The held side's own drift: every paper minute with a holding, its adjusted mid 15 / 60 minutes later in the direction
-- of the larger holding, tight or not, sellable (the larger holding >= N, N from pm_lp_markets.n_size) or not.
with mk as (select distinct on (cond) cond, tick, n_size from pm_lp_markets order by cond, day desc),
m as (select p.minute, p.cond, (p.bb + p.ba) / 2 mid, p.yes_held, p.no_held, mk.n_size, (p.ba - p.bb) <= mk.tick + 1e-9 tight
  from pm_lpprep_minutes p join mk using (cond) where p.bb is not null and p.ba is not null and (p.yes_held > 0 or p.no_held > 0)),
j as (select m.*, (f.bb + f.ba) / 2 mid60, (g.bb + g.ba) / 2 mid15, case when m.yes_held >= m.no_held then 1 else -1 end dir,
  greatest(m.yes_held, m.no_held) >= m.n_size - 1e-9 sellable
  from m left join pm_lpprep_minutes f on f.cond = m.cond and f.minute = m.minute + interval '60 minutes'
         left join pm_lpprep_minutes g on g.cond = m.cond and g.minute = m.minute + interval '15 minutes')
select tight, sellable, count(*) n, count(mid60) n60, count(distinct cond) mkts, count(distinct (cond, date_trunc('hour', minute))) mkt_hours,
  round(avg(dir * (mid15 - mid)) * 100, 3) held_move15_c, round(avg(dir * (mid60 - mid)) * 100, 3) held_move60_c,
  round(avg(abs(mid60 - mid)) * 100, 3) absmove60_c
from j group by 1, 2 order by 1, 2;
