-- Widen the overnight-record cron from the US-overnight-only UTC window
-- (`*/5 0-9 * * *`, migration 0016) to every 5 minutes around the clock.
--
-- Why: the recorder now serves TWO windows (overnight-record/index.ts):
--   - US overnight, 20:00-04:00 ET weekdays  → UTC 00:00-09:00 (both DST
--     regimes) — the window 0016 scheduled for.
--   - Venue DAY session for sparse-tape listings (2DG.F — Sivers'
--     Frankfurt line), 07:00-21:00 Europe/London weekdays → UTC
--     06:00-21:00 across BST/GMT.
-- The union spans nearly the whole day and shifts with two different DST
-- calendars, so scheduling it as cron windows is fragile; fire every
-- 5 min instead and let the function's own DST-safe gates decide. An
-- off-window call is one cheap early-exit request ("outside-all-windows")
-- — ~90 no-op invocations a day, negligible.
--
-- The job's COMMAND is unchanged from 0016 (same URL, same
-- `app.cron_secret` bearer); only the schedule moves. Re-created via
-- unschedule+schedule because pg_cron's alter_job isn't available on all
-- hosted versions — the same idempotent pattern 0016 uses.
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (same as 0016): the `url` below is the
-- PRODUCTION project's Edge Function host, hardcoded. Applying this
-- migration to any other database will make THAT database POST to
-- production every 5 minutes. Change the host per environment.

do $$ begin
  if exists (select 1 from cron.job where jobname = 'overnight-record-every-5min') then
    perform cron.unschedule('overnight-record-every-5min');
  end if;
end $$;

select cron.schedule(
  'overnight-record-every-5min',
  '*/5 * * * *',
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
