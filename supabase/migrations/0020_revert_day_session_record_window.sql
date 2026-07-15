-- Revert 0019: put the overnight-record cron back on the US-overnight-only
-- UTC window (`*/5 0-9 * * *`, as 0016 originally scheduled it).
--
-- 0019 widened the schedule to 24/7 for the venue day-session recording of
-- the sparse-tape 2DG.F listing. That feature is withdrawn — the chart now
-- renders 2DG.F's full venue session client-side from Yahoo bars with
-- flat carry-forward gap-filling instead of sampling T212 — so the extra
-- ~190 off-window invocations a day buy nothing. Same idempotent
-- unschedule+schedule pattern, same command/secret as 0016/0019; the
-- daily prune job is untouched.
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (same as 0016/0019): the `url` below is
-- the PRODUCTION project's Edge Function host, hardcoded. Applying this
-- migration to any other database will make THAT database POST to
-- production every 5 minutes. Change the host per environment.

do $$ begin
  if exists (select 1 from cron.job where jobname = 'overnight-record-every-5min') then
    perform cron.unschedule('overnight-record-every-5min');
  end if;
end $$;

select cron.schedule(
  'overnight-record-every-5min',
  '*/5 0-9 * * *',
  $cron$
    select net.http_post(
      url     := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/overnight-record',
      headers := jsonb_build_object(
        'Authorization', concat('Bearer ', current_setting('app.cron_secret')),
        'Content-Type',  'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 9000
    );
  $cron$
);
