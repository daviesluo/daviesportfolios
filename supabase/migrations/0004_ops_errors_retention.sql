-- Daily retention sweep for public.ops_errors. The Edge Function
-- appends a row for every reported failure (fetch flake, auth
-- error, render crash, etc.) and never deletes — over time the
-- table would grow indefinitely. The admin error-triage badge in
-- the header only queries the last 24 h anyway, and any older
-- forensic data is more useful as aggregate counts than as raw
-- rows. Schedule a daily 03:00 UTC sweep that drops anything
-- older than 30 days. Keeps the row count bounded and the
-- summary-endpoint scans tight.
--
-- pg_cron is preinstalled on Supabase; just need to schedule.
--
-- To apply: paste into Supabase Dashboard → SQL Editor → Run.

create extension if not exists pg_cron;

select cron.schedule(
  'ops-errors-30-day-retention',
  '0 3 * * *',     -- daily at 03:00 UTC (off-peak; avoids the trading-day overlap)
  $$delete from public.ops_errors where created_at < now() - interval '30 days'$$
);
