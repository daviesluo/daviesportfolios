-- LP-ALLOC: what Polymarket paid live-prep for 2026-10-09, per market (pm_lp_reward_days, mode live, read at 10-10 01:00
-- UTC), read-only. Copied into data/readout_1009.json for scripts/calib.py.
select left(cond, 10) cond, minutes, minutes_two_sided, minutes_scored, formula_usd, formula_scored_usd, rate, actual_usd, actual_sponsored_usd, rebate_usd, read_at
from public.pm_lp_reward_days where mode = 'live' and day = '2026-10-09' order by cond;
