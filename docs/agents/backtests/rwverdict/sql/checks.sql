-- RW's verdict, steps e and the RW-C check, read-only, 2026-10-09 ~00:48 UTC: RW's four calls off and RW-C's on
-- (0103's retire_after_rw()), the one-minute job still scheduled, the tick's beats each minute, RW-C's warm-up day row,
-- and RW's stored minutes against the 1,440 due each day.
select 'edge_calls' k, path a, enabled::text b, null c from edge_calls where path like 'agents?action=pmrw%'
union all select 'cron.job', jobname, schedule, active::text from cron.job where jobname in ('edge-calls-every-minute','edge-calls-retire-after-rw')
union all select 'tick beats last 60m', count(*)::text, min(minute)::text, max(minute)::text from edge_call_beats where path='agents?action=tick' and minute >= now() - interval '60 minutes'
union all select 'rwc 10-08 row', day::text, detail->>'phase', closed_at::text from pm_rwc_days where day='2026-10-08'
union all select 'rw minutes stored by day', d::text, count(distinct minute)::text, '1440 due' from (select minute::date d, minute from pm_rw_minutes where minute >= '2026-09-25' and minute < '2026-10-09') z group by d
