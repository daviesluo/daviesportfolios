-- LP-RULES: live-prep's live P&L by UTC day. Fills: the day's cash (sells − buys) plus the change in what is held,
-- each holding marked at its market's last adjusted mid (detail.m) before the day's start and before its end (or at
-- the payout once settled). Paid: rewards and maker rebates as the readout booked them for that day. Read-only.
with mk as (select distinct on (cond) cond, yes_token from pm_lp_markets order by cond, day desc),
f as (select f.cond, f.side, f.price::numeric p, f.size::numeric s, f.match_time t, (f.token = mk.yes_token) yes
      from pm_lp_fills f join mk on mk.cond = f.cond where f.status = 'CONFIRMED'),
days as (select d::date d from generate_series('2026-10-09'::date, (now() at time zone 'utc')::date, '1 day') d),
b as (select d, d::timestamptz t0, least(d::timestamptz + interval '1 day', now()) t1 from days),
conds as (select distinct cond from f),
-- holdings before t: YES and NO
h as (
  select b.d, c.cond,
    coalesce(sum(case when f.t < b.t0 then (case when f.side = 'BUY' then 1 else -1 end) * f.s end) filter (where f.yes), 0) y0,
    coalesce(sum(case when f.t < b.t0 then (case when f.side = 'BUY' then 1 else -1 end) * f.s end) filter (where not f.yes), 0) n0,
    coalesce(sum(case when f.t < b.t1 then (case when f.side = 'BUY' then 1 else -1 end) * f.s end) filter (where f.yes), 0) y1,
    coalesce(sum(case when f.t < b.t1 then (case when f.side = 'BUY' then 1 else -1 end) * f.s end) filter (where not f.yes), 0) n1,
    coalesce(sum(case when f.t >= b.t0 and f.t < b.t1 then (case when f.side = 'SELL' then 1 else -1 end) * f.p * f.s end), 0) cash
  from b cross join conds c left join f on f.cond = c.cond group by b.d, c.cond),
mm as (
  select h.*,
    (select case when s.settled_at < b.t0 then s.payout::numeric end from pm_lp_settlements s where s.cond = h.cond) pay0,
    (select case when s.settled_at < b.t1 then s.payout::numeric end from pm_lp_settlements s where s.cond = h.cond) pay1,
    (select (m.detail->>'m')::numeric from pm_lp_minutes m where m.cond = h.cond and m.mode = 'live' and m.minute < b.t0 and m.detail->>'m' is not null order by m.minute desc limit 1) m0,
    (select (m.detail->>'m')::numeric from pm_lp_minutes m where m.cond = h.cond and m.mode = 'live' and m.minute < b.t1 and m.detail->>'m' is not null order by m.minute desc limit 1) m1
  from h join b on b.d = h.d),
v as (
  select d, cond, cash,
    y0 * coalesce(pay0, m0, 0) + n0 * (1 - coalesce(pay0, m0, 1)) v0,
    y1 * coalesce(pay1, m1, 0) + n1 * (1 - coalesce(pay1, m1, 1)) v1
  from mm),
pd as (select d, sum(cash) cash, sum(v0) held0, sum(v1) held1, sum(cash + v1 - v0) fills_pnl from v group by d),
rw as (select day d, sum(actual_usd) paid, sum(rebate_usd) rebate, sum(formula_usd) formula from pm_lp_reward_days where mode = 'live' group by day)
select pd.d, round(pd.cash, 2) cash, round(pd.held0, 2) held_mark_start, round(pd.held1, 2) held_mark_end,
  round(pd.fills_pnl, 2) fills_pnl, round(coalesce(rw.paid, 0), 2) paid, round(coalesce(rw.rebate, 0), 2) rebate,
  round(pd.fills_pnl + coalesce(rw.paid, 0) + coalesce(rw.rebate, 0), 2) net, round(rw.formula, 2) formula
from pd left join rw on rw.d = pd.d order by pd.d;
