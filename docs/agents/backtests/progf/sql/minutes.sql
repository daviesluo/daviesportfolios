-- PROGF: each paper Reward quotes row's rewarded minutes with the rate it priced them at, read-only, for the before/after
-- evidence of the programme factor (scripts/factor.py). One statement per source, the same shape; :src, :mins, :rate are
-- RW-C (pm_rwc_minutes, its selection's rate that day), mini-pool (pm_prep_minutes, pm_live_minutes' rate), mid-pool
-- (pm_midprep_minutes, pm_mid_minutes' rate) and live-prep's paper (pm_lpprep_minutes, pm_lp_minutes' rate), dry-run rows.
-- RW-C:
select jsonb_build_object('pad', repeat('x', 100000), 'src', 'rwc', 'rows', (select string_agg(concat_ws(',', m.cond, extract(epoch from m.minute)::bigint, m.reward, s.rate), ';' order by m.minute, m.cond)
  from public.pm_rwc_minutes m join public.pm_rwc_selection s on s.day = (m.minute at time zone 'UTC')::date and s.cond = m.cond where m.reward > 0)) payload;
-- the paper layers (src, layer minutes, path minutes):
select jsonb_build_object('pad', repeat('x', 100000), 'src', 'midprep', 'rows', (select string_agg(concat_ws(',', m.cond, extract(epoch from m.minute)::bigint, m.reward, p.rate), ';' order by m.minute, m.cond)
  from public.pm_midprep_minutes m join public.pm_mid_minutes p on p.mode = 'dry_run' and p.minute = m.minute and p.cond = m.cond where m.reward > 0)) payload;
