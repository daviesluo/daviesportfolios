-- LP-CAPDEEP: what is held now, unsettled, by market, with its end date and its value at the latest mid: what a
-- resolution against it would take from the stop's basis (which already marks it at the mid). Each token at its
-- average buy price (an approximation of the path's average cost). Read-only.
with mk as (select distinct on (cond) cond, yes_token, no_token, end_date, day last_day, rank, left(question,45) q from pm_lp_markets order by cond, day desc),
f as (select f.cond, (f.token=mk.yes_token) yes, sum(case when side='BUY' then size else -size end) held, sum(case when side='BUY' then price*size else 0 end)/nullif(sum(case when side='BUY' then size else 0 end),0) avgb
 from pm_lp_fills f join mk using (cond) where f.status='CONFIRMED' group by 1,2),
mid as (select distinct on (cond) cond, (bb+ba)/2 m, minute from pm_lp_minutes where mode='live' and minute > now() - interval '30 min' order by cond, minute desc)
select left(f.cond,10) c, mk.last_day, mk.rank, f.yes, round(f.held,2) held, round(f.avgb,3) avgb, round(mid.m,3) mid,
 round(f.held*f.avgb,2) cost, round(f.held*case when f.yes then mid.m else 1-mid.m end,2) at_mid, mk.end_date, mk.q
from f join mk using (cond) left join mid using (cond) left join pm_lp_settlements s on s.cond=f.cond
where s.cond is null and f.held > 0.01 order by at_mid desc nulls last;
