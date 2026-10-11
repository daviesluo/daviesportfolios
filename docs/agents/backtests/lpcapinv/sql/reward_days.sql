-- LP-CAPINV: what Polymarket paid each market a day (pm_lp_reward_days, live) beside its formula, and the day it was
-- selected (R = refilled). Carried markets are the ones whose selection day is earlier than the row's day. Read-only.
select r.day, left(r.cond, 10) c, r.minutes, r.minutes_two_sided, r.minutes_scored, round(r.formula_usd, 3) f,
  round(r.formula_scored_usd, 3) fs, r.rate, round(r.actual_usd, 3) act,
  (select string_agg(distinct coalesce(m.kind, '') || ':' || m.day::text || coalesce(case when m.detail ? 'refill' then 'R' end, ''), ',')
     from pm_lp_markets m where m.cond = r.cond) sel
from pm_lp_reward_days r where mode = 'live' and day >= '2026-10-09' order by day, act desc nulls last;
