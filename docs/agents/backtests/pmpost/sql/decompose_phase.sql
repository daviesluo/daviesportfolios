-- PMPOST: the live record's P&L taken apart, by phase. Every CONFIRMED fill (all maker, fee 0: checked) is split into
--   spread      d · (m0 − y) · s        what we were paid against the others' mid when the taker hit us
--   first min   d · (m1 − m0) · s       the mid's move in the next minute (the informed taker's information)
--   drift       d · (mpre − m1) · s     the mid's move from then to the end: the latest mid now, or the last mid
--                                       before the market settled
--   settlement  d · (payout − mpre) · s the jump at resolution (settled markets only)
-- y is the YES-equivalent price, d +1 for a fill that adds YES (BUY YES, SELL NO), the mids the others' raw touch
-- midpoint ((bb + ba) / 2 of the book without our orders) from live-prep's own minute rows. The four parts sum to
-- d · (mfin − y) · s, so over all fills to the fills' P&L marked now. A market's fills, rewards and rebates all go to the
-- phase its first live fill fell in (S2: before 2026-10-13 13:25:32 UTC, Q2: after), so an S2 lot sold during the
-- close-only spell is S2's. Rewards and maker rebates: pm_lp_reward_days, live rows, by market. Read-only.
with mk as (select distinct on (cond) cond, yes_token from pm_lp_markets order by cond, day desc),
f as (
  select f.cond, f.side, f.price::numeric p, f.size::numeric s, f.match_time t, (f.token = mk.yes_token) yes
  from pm_lp_fills f join mk on mk.cond = f.cond where f.status = 'CONFIRMED'),
g as (
  select f.*, case when f.yes then f.p else 1 - f.p end y, case when (f.side = 'BUY') = f.yes then 1 else -1 end d,
    (select (m.bb + m.ba) / 2 from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.minute <= f.t and m.bb is not null and m.ba is not null order by m.minute desc limit 1) m0,
    (select (m.bb + m.ba) / 2 from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.minute >= f.t + interval '60 s' and m.bb is not null and m.ba is not null order by m.minute asc limit 1) m1,
    st.payout::numeric payout,
    coalesce(
      (select (m.bb + m.ba) / 2 from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.minute < st.settled_at and m.bb is not null and m.ba is not null order by m.minute desc limit 1),
      (select (m.bb + m.ba) / 2 from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.bb is not null and m.ba is not null order by m.minute desc limit 1)) mpre
  from f left join pm_lp_settlements st on st.cond = f.cond),
h as (
  select g.*, coalesce(m0, y) m0c, coalesce(m1, m0, y) m1c,
    min(t) over (partition by cond) first_t from g),
ph as (
  select h.*, case when first_t < '2026-10-13 13:25:32+00' then 'S2' else 'Q2' end phase from h),
fills as (
  select phase, count(*) n, sum(s) sh,
    sum(case when side = 'BUY' then 1 else 0 end) buys,
    sum(d * (m0c - y) * s) spread, sum(d * (m1c - m0c) * s) firstmin,
    sum(d * (coalesce(mpre, m1c) - m1c) * s) drift,
    sum(case when payout is not null then d * (payout - coalesce(mpre, m1c)) * s else 0 end) settle
  from ph group by phase),
mph as (select distinct cond, phase from ph),
rw as (
  select coalesce(mph.phase, 'no fill') phase, sum(r.actual_usd) paid, sum(r.rebate_usd) rebate, sum(r.formula_usd) formula
  from pm_lp_reward_days r left join mph on mph.cond = r.cond where r.mode = 'live' group by 1)
select coalesce(fills.phase, rw.phase) phase, fills.n, round(fills.sh, 1) shares, fills.buys,
  round(fills.spread, 2) spread, round(fills.firstmin, 2) first_min, round(fills.drift, 2) drift, round(fills.settle, 2) settlement,
  round(fills.spread + fills.firstmin + fills.drift + fills.settle, 2) fills_pnl,
  round(rw.paid, 2) rewards, round(rw.rebate, 2) rebates, 0 fees,
  round(coalesce(fills.spread + fills.firstmin + fills.drift + fills.settle, 0) + coalesce(rw.paid, 0) + coalesce(rw.rebate, 0), 2) net,
  round(100 * fills.spread / fills.sh, 2) spread_c, round(100 * fills.firstmin / fills.sh, 2) first_min_c,
  round(100 * (fills.drift + fills.settle) / fills.sh, 2) held_c, round(100 * rw.paid / fills.sh, 2) rewards_c, round(100 * rw.rebate / fills.sh, 2) rebates_c
from fills full join rw on rw.phase = fills.phase order by 1;
