-- Schedule the `sftby-record` Edge Function every 5 min during the
-- approximate SFTBY session window (UK 13:00-21:00). Cron runs in UTC,
-- so we cover both DST regimes with a 12:00-20:59 UTC window. The
-- Edge Function does its own session-window check (Europe/London tz,
-- Mon-Fri 13:00-21:00) and exits 204 outside it, so over-firing
-- during the GMT half of the year (when the window starts at 13:00
-- UTC, not 12:00) is harmless — every spurious call is a single
-- 401-equivalent.
--
-- Also schedule a daily prune (06:00 UTC, well before the session
-- opens) so the table stays around 14 days of points instead of
-- growing forever.
--
-- Requires pg_cron and pg_net extensions. The Supabase Dashboard's
-- Database → Extensions page can flip them on; in case the migration
-- runs before that's been done, the CREATE EXTENSION calls below
-- handle it idempotently.
--
-- ALSO requires the `app.cron_secret` database setting to be a
-- random secret matching the `CRON_SECRET` env var on the
-- sftby-record Edge Function. Set it once via:
--   ALTER DATABASE postgres SET app.cron_secret TO '<your-secret>';
-- This is gitignore-safe — the value never lives in this file.
--
-- To apply: paste this SQL into Supabase Dashboard → SQL Editor → Run.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Drop existing jobs of the same name so re-running this migration
-- doesn't pile up duplicate schedules. `cron.unschedule` errors when
-- the job is missing, hence the safe-guard wrapper.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'sftby-record-every-5min') then
    perform cron.unschedule('sftby-record-every-5min');
  end if;
  if exists (select 1 from cron.job where jobname = 'sftby-points-daily-prune') then
    perform cron.unschedule('sftby-points-daily-prune');
  end if;
end $$;

-- Every 5 min Mon-Fri during the broad UTC window covering the SFTBY
-- session in either BST or GMT. The Edge Function gates internally.
select cron.schedule(
  'sftby-record-every-5min',
  '*/5 12-20 * * 1-5',
  $cron$
    select net.http_post(
      url     := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/sftby-record',
      headers := jsonb_build_object(
        'Authorization', concat('Bearer ', current_setting('app.cron_secret')),
        'Content-Type',  'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 8000
    );
  $cron$
);

-- Daily prune at 06:00 UTC — keep only the last 14 days of points.
select cron.schedule(
  'sftby-points-daily-prune',
  '0 6 * * *',
  $cron$
    delete from public.sftby_intraday_points
    where bucket_time < now() - interval '14 days';
  $cron$
);
