-- Schedule the `overnight-record` Edge Function every 5 min across the
-- UTC window that covers the US overnight session (20:00-04:00 ET) in
-- BOTH DST regimes, plus a daily prune of the points table.
--
-- DST math: ET overnight 20:00 → 04:00 maps to UTC as
--   EDT (UTC-4): 00:00 → 08:00 UTC
--   EST (UTC-5): 01:00 → 09:00 UTC
-- The union is 00:00-09:00 UTC, so `*/5 0-9 * * *` (every 5 min, UTC
-- hours 0 through 9, every day) covers the whole session year-round.
-- The Edge Function does its OWN check — overnight phase (America/
-- New_York 20:00-04:00) AND not the weekend dead zone (Fri 20:00 ET →
-- Sun 20:00 ET) — and returns a skip otherwise, so the handful of
-- spurious fires at the window edges / on weekend nights are harmless
-- (each is one cheap request that records nothing). Running only
-- hours 0-9 (vs all day) still saves ~60% of the calls a 24h schedule
-- would make.
--
-- Requires pg_cron + pg_net extensions (Dashboard → Database →
-- Extensions; the CREATE EXTENSION calls below are idempotent).
--
-- ALSO requires the `app.cron_secret` database setting to match the
-- `CRON_SECRET` env var on the overnight-record Edge Function. Set
-- once, out-of-band (value never lives in this file):
--   ALTER DATABASE postgres SET app.cron_secret TO '<your-secret>';
-- (If you already set this for another cron-driven function, the same
-- secret works — overnight-record validates against the same env var
-- name.)
--
-- To apply: paste into Supabase Dashboard → SQL Editor → Run, OR let
-- the `migrations.yml` workflow run `supabase db push` on merge to
-- main.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Drop same-named jobs first so re-running this migration doesn't pile
-- up duplicate schedules.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'overnight-record-every-5min') then
    perform cron.unschedule('overnight-record-every-5min');
  end if;
  if exists (select 1 from cron.job where jobname = 'overnight-points-daily-prune') then
    perform cron.unschedule('overnight-points-daily-prune');
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

-- Daily prune at 10:00 UTC (after the overnight window closes) — keep
-- only the last 30 days of points.
select cron.schedule(
  'overnight-points-daily-prune',
  '0 10 * * *',
  $cron$
    delete from public.overnight_intraday_points
    where bucket_time < now() - interval '30 days';
  $cron$
);
