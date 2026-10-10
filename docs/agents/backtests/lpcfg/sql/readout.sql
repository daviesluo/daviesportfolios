-- LPCFG: the readout of 2026-10-09 as live-prep's path wrote it (pm_lp_reward_days, mode live), read-only; its rows are
-- data/readout_2026-10-09.json.
select day, cond, minutes, minutes_two_sided, minutes_scored, formula_usd, formula_scored_usd, rate, actual_usd, actual_sponsored_usd, rebate_usd, read_at, detail->'total' as total
  from public.pm_lp_reward_days where mode = 'live' and day = '2026-10-09' order by cond
