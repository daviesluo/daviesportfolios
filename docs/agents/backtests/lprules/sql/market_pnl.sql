-- LP-RULES: every market live-prep has touched live, with what it earned and what its fills did. Read-only.
-- Per market: the first day it was in pm_lp_markets and how it got there (00:00 pick with its rank, or a refill), its
-- question; its CONFIRMED fills' cash (sells − buys), what it still holds and that holding at the latest adjusted mid
-- (detail.m of its last live minute; YES at m, NO at 1 − m) or at the settlement payout; the fills' P&L marked
-- (cash + holding at the mark); and what Polymarket paid it (pm_lp_reward_days, live rows: rewards and maker rebates).
-- 10-09's rewards are booked as paid (the R correction of Addendum 10 changes the formula, not the payout).
with mk as (
  select distinct on (cond) cond, yes_token, no_token, question, end_date, game_start
  from pm_lp_markets order by cond, day desc),
first_day as (
  select distinct on (cond) cond, day, rank, (detail ? 'refill') refill, formula_day, reward_rate, capital
  from pm_lp_markets order by cond, day asc, selected_at asc),
f as (
  select f.cond, f.side, f.price::numeric p, f.size::numeric s, f.match_time t, (f.token = mk.yes_token) yes
  from pm_lp_fills f join mk on mk.cond = f.cond where f.status = 'CONFIRMED'),
pos as (
  select cond,
    sum(case when side = 'SELL' then p * s else -p * s end) cash,
    sum(case when yes then (case when side = 'BUY' then s else -s end) else 0 end) yes_held,
    sum(case when not yes then (case when side = 'BUY' then s else -s end) else 0 end) no_held,
    count(*) fills, sum(s) shares, sum(p * s) traded_usd
  from f group by cond),
mark as (
  select distinct on (cond) cond, (detail->>'m')::numeric m, minute
  from pm_lp_minutes where mode = 'live' and detail->>'m' is not null order by cond, minute desc),
rw as (
  select cond, sum(actual_usd) paid, sum(rebate_usd) rebate, sum(formula_usd) formula, sum(formula_scored_usd) formula_sc
  from pm_lp_reward_days where mode = 'live' group by cond)
select fd.day first_day, case when fd.refill then 'refill' else 'pick' end how, fd.rank, left(mk.question, 60) q,
  substr(p.cond, 1, 10) cond, p.fills, round(p.shares, 1) shares,
  round(p.yes_held, 2) yes_held, round(p.no_held, 2) no_held,
  coalesce(s.payout::numeric, mark.m) mark,
  round(p.cash, 2) cash,
  round(p.cash + p.yes_held * coalesce(s.payout::numeric, mark.m) + p.no_held * (1 - coalesce(s.payout::numeric, mark.m)), 2) fills_pnl,
  round(coalesce(rw.paid, 0), 2) paid, round(coalesce(rw.rebate, 0), 2) rebate,
  round(coalesce(rw.formula, 0), 2) formula,
  round(p.cash + p.yes_held * coalesce(s.payout::numeric, mark.m) + p.no_held * (1 - coalesce(s.payout::numeric, mark.m))
        + coalesce(rw.paid, 0) + coalesce(rw.rebate, 0), 2) net,
  mk.end_date
from pos p
join mk on mk.cond = p.cond
left join first_day fd on fd.cond = p.cond
left join mark on mark.cond = p.cond
left join pm_lp_settlements s on s.cond = p.cond
left join rw on rw.cond = p.cond
union all
-- markets paid but never filled
select fd.day, case when fd.refill then 'refill' else 'pick' end, fd.rank, left(mk.question, 60), substr(rw.cond, 1, 10), 0, 0, 0, 0, null, 0, 0,
  round(rw.paid, 2), round(rw.rebate, 2), round(rw.formula, 2), round(rw.paid + rw.rebate, 2), mk.end_date
from rw join mk on mk.cond = rw.cond left join first_day fd on fd.cond = rw.cond
where rw.cond not in (select cond from pos)
order by 1, 3;
