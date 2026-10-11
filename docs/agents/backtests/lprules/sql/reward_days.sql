-- LP-RULES: live-prep's live reward days, per market (data/reward_days.csv is this query's output of 2026-10-11 ~00:55
-- UTC, with Addendum 10's like-for-like formula of 10-09 from LP_R_DAY_CORRECTIONS added). Read-only.
select day, substr(cond, 1, 10) cond, minutes, minutes_two_sided m2, minutes_scored ms, round(formula_usd, 4) formula,
  round(formula_scored_usd, 4) formula_scored, round(actual_usd, 4) paid, round(rebate_usd, 4) rebate, rate
from pm_lp_reward_days where mode = 'live' order by day, paid desc;
