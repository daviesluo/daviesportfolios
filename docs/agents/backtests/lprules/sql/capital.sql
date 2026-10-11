-- LP-RULES: what holds live-prep's capital now, by where each market came from (its first row in pm_lp_markets: an
-- 00:00 pick of 10-11, a 10-10 pick, a 10-10 refill, or a day before), unsettled markets only, each token held at its
-- average buy price (an approximation of the path's average cost). Read-only; read with pm_lp_state's capital and pUSD.
with mk as (select distinct on (cond) cond, yes_token, day first_day, (detail ? 'refill') refill from pm_lp_markets order by cond, day asc),
f as (select f.cond, f.side, f.price::numeric p, f.size::numeric s, (f.token = mk2.yes_token) yes
      from pm_lp_fills f join (select distinct on (cond) cond, yes_token from pm_lp_markets order by cond, day desc) mk2 on mk2.cond = f.cond
      where f.status = 'CONFIRMED'),
agg as (
  select cond, yes, sum(case when side = 'BUY' then s else -s end) held,
    sum(case when side = 'BUY' then p * s else 0 end) / nullif(sum(case when side = 'BUY' then s else 0 end), 0) avg_buy
  from f group by cond, yes)
select case when mk.first_day = '2026-10-11' then '10-11 picks' when mk.refill then '10-10 refills' when mk.first_day = '2026-10-10' then '10-10 picks' else 'from 10-09 or before' end grp,
  count(distinct agg.cond) filter (where held >= 0.5) markets, round(sum(held * avg_buy) filter (where held > 0.001), 2) held_at_avg_buy
from agg join mk on mk.cond = agg.cond left join pm_lp_settlements st on st.cond = agg.cond
where st.cond is null group by 1 order by 1;
