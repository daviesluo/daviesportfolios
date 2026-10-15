-- PMPOST: the live record's P&L by UTC day, 2026-10-09 → today. The day's fills P&L is marked to market: the day's
-- cash (sells − buys) plus the change in what is held, each token marked at its market's last others' raw touch
-- midpoint ((bb + ba) / 2) before the day's start and before its end, or at the payout once settled. It is split into
-- the spread and the first minute of the fills made that day (as decompose_phase.sql), the settlement jumps of the
-- markets that settled that day (what was held then × (payout − the last mid before)), and the rest, the drift of what
-- was held. Rewards and maker rebates are the readout's for that day (a day's payout arrives after 00:05 the next day).
-- Fees: none (every fill was a maker's, fee rate 0). Read-only.
with mk as (select distinct on (cond) cond, yes_token from pm_lp_markets order by cond, day desc),
f as (select f.cond, f.side, f.price::numeric p, f.size::numeric s, f.match_time t, (f.token = mk.yes_token) yes
      from pm_lp_fills f join mk on mk.cond = f.cond where f.status = 'CONFIRMED'),
days as (select d::date d from generate_series('2026-10-09'::date, (now() at time zone 'utc')::date, '1 day') d),
b as (select d, d::timestamptz t0, least(d::timestamptz + interval '1 day', now()) t1 from days),
conds as (select distinct cond from f),
h as (
  select b.d, b.t0, b.t1, c.cond,
    coalesce(sum(case when f.t < b.t0 then (case when f.side = 'BUY' then 1 else -1 end) * f.s end) filter (where f.yes), 0) y0,
    coalesce(sum(case when f.t < b.t0 then (case when f.side = 'BUY' then 1 else -1 end) * f.s end) filter (where not f.yes), 0) n0,
    coalesce(sum(case when f.t < b.t1 then (case when f.side = 'BUY' then 1 else -1 end) * f.s end) filter (where f.yes), 0) y1,
    coalesce(sum(case when f.t < b.t1 then (case when f.side = 'BUY' then 1 else -1 end) * f.s end) filter (where not f.yes), 0) n1,
    coalesce(sum(case when f.t >= b.t0 and f.t < b.t1 then (case when f.side = 'SELL' then 1 else -1 end) * f.p * f.s end), 0) cash
  from b cross join conds c left join f on f.cond = c.cond group by b.d, b.t0, b.t1, c.cond),
mm as (
  select h.*, st.payout::numeric payout, st.settled_at,
    (select (m.bb + m.ba) / 2 from pm_lp_minutes m where m.mode = 'live' and m.cond = h.cond and m.minute < h.t0 and m.bb is not null and m.ba is not null order by m.minute desc limit 1) m0,
    (select (m.bb + m.ba) / 2 from pm_lp_minutes m where m.mode = 'live' and m.cond = h.cond and m.minute < h.t1 and m.bb is not null and m.ba is not null order by m.minute desc limit 1) m1,
    (select (m.bb + m.ba) / 2 from pm_lp_minutes m where m.mode = 'live' and m.cond = h.cond and m.minute < st.settled_at and m.bb is not null and m.ba is not null order by m.minute desc limit 1) mpre,
    (select coalesce(sum(case when f.side = 'BUY' then 1 else -1 end * f.s) filter (where f.yes), 0) from f where f.cond = h.cond and f.t < st.settled_at) ys,
    (select coalesce(sum(case when f.side = 'BUY' then 1 else -1 end * f.s) filter (where not f.yes), 0) from f where f.cond = h.cond and f.t < st.settled_at) ns
  from h left join pm_lp_settlements st on st.cond = h.cond),
v as (
  select d, cond, cash,
    y0 * coalesce(case when settled_at < t0 then payout end, m0, 0) + n0 * (1 - coalesce(case when settled_at < t0 then payout end, m0, 1)) v0,
    y1 * coalesce(case when settled_at < t1 then payout end, m1, 0) + n1 * (1 - coalesce(case when settled_at < t1 then payout end, m1, 1)) v1,
    case when settled_at >= t0 and settled_at < t1 then (ys - ns) * (payout - coalesce(mpre, payout)) else 0 end settle
  from mm),
day_mtm as (select d, sum(cash + v1 - v0) fills_pnl, sum(v1) held_end, sum(settle) settle from v group by d),
g as (
  select (f.t at time zone 'utc')::date d, f.s, case when f.yes then f.p else 1 - f.p end y, case when (f.side = 'BUY') = f.yes then 1 else -1 end dd,
    (select (m.bb + m.ba) / 2 from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.minute <= f.t and m.bb is not null and m.ba is not null order by m.minute desc limit 1) m0,
    (select (m.bb + m.ba) / 2 from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.minute >= f.t + interval '60 s' and m.bb is not null and m.ba is not null order by m.minute asc limit 1) m1
  from f),
fd as (
  select d, count(*) n, sum(s) sh, sum(dd * (coalesce(m0, y) - y) * s) spread, sum(dd * (coalesce(m1, m0, y) - coalesce(m0, y)) * s) firstmin
  from g group by d),
rw as (select day d, sum(actual_usd) paid, sum(rebate_usd) rebate, sum(formula_usd) formula from pm_lp_reward_days where mode = 'live' group by day)
select x.d, coalesce(fd.n, 0) fills, round(coalesce(fd.sh, 0), 0) shares, round(coalesce(fd.spread, 0), 2) spread, round(coalesce(fd.firstmin, 0), 2) first_min,
  round(x.fills_pnl - coalesce(fd.spread, 0) - coalesce(fd.firstmin, 0) - x.settle, 2) drift, round(x.settle, 2) settlement,
  round(x.fills_pnl, 2) fills_pnl, round(coalesce(rw.paid, 0), 2) rewards, round(coalesce(rw.rebate, 0), 2) rebates,
  round(x.fills_pnl + coalesce(rw.paid, 0) + coalesce(rw.rebate, 0), 2) net, round(x.held_end, 2) held_at_mark_end
from day_mtm x left join fd on fd.d = x.d left join rw on rw.d = x.d order by x.d;
