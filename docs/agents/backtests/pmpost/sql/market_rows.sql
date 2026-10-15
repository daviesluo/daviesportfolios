-- PMPOST: one row per market live-prep quoted or held live (data/markets.csv is this query's output of 2026-10-15
-- ~15:20 UTC, its string_agg split one row a line): the phase of its first live fill (or of its first reward day if it
-- never filled), its fills, filled shares, the spread and first-minute parts (decompose_phase.sql's), its fills marked
-- now or at the payout, and Polymarket's rewards and maker rebates for it. Read-only.
with mk as (select distinct on (cond) cond, yes_token from pm_lp_markets order by cond, day desc),
f as (
  select f.cond, f.side, f.price::numeric p, f.size::numeric s, f.match_time t, (f.token = mk.yes_token) yes
  from pm_lp_fills f join mk on mk.cond = f.cond where f.status = 'CONFIRMED'),
g as (
  select f.*, case when f.yes then f.p else 1 - f.p end y, case when (f.side = 'BUY') = f.yes then 1 else -1 end d,
    (select (m.bb + m.ba) / 2 from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.minute <= f.t and m.bb is not null and m.ba is not null order by m.minute desc limit 1) m0,
    (select (m.bb + m.ba) / 2 from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.minute >= f.t + interval '60 s' and m.bb is not null and m.ba is not null order by m.minute asc limit 1) m1,
    coalesce(st.payout::numeric, (select (m.bb + m.ba) / 2 from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.bb is not null and m.ba is not null order by m.minute desc limit 1)) mfin
  from f left join pm_lp_settlements st on st.cond = f.cond),
pm as (
  select cond, min(t) first_t, count(*) n, sum(s) sh, sum(d * (coalesce(m0, y) - y) * s) spread, sum(d * (coalesce(m1, m0, y) - coalesce(m0, y)) * s) fm,
    sum(d * (coalesce(mfin, m1, m0, y) - y) * s) fills_pnl from g group by cond),
rw as (select cond, min(day) d0, sum(actual_usd) paid, sum(rebate_usd) reb from pm_lp_reward_days where mode = 'live' group by cond)
select string_agg(concat_ws(',', substr(coalesce(pm.cond, rw.cond), 1, 10),
  case when coalesce(pm.first_t, rw.d0::timestamptz) < '2026-10-13 13:25:32+00' then 'S2' else 'Q2' end,
  coalesce(pm.n, 0), round(coalesce(pm.sh, 0), 2), round(coalesce(pm.spread, 0), 4), round(coalesce(pm.fm, 0), 4), round(coalesce(pm.fills_pnl, 0), 4),
  round(coalesce(rw.paid, 0), 4), round(coalesce(rw.reb, 0), 4)), ';') rows
from pm full join rw on rw.cond = pm.cond;
