-- Switch the overnight-record cron job's bearer token from the
-- `app.cron_secret` database SETTING to Supabase Vault.
--
-- Why: 0016 documented `ALTER DATABASE postgres SET app.cron_secret TO
-- '<secret>'` as the out-of-band step to wire the cron job's Authorization
-- header. On this project that ALTER DATABASE is rejected outright:
--
--     ERROR: 42501: permission denied to set parameter "app.cron_secret"
--
-- — hosted Supabase doesn't grant the `postgres` role privilege to set
-- arbitrary custom GUCs at the database level. Since the setting was
-- therefore NEVER successfully applied, `current_setting('app.cron_secret')`
-- inside the cron job's `net.http_post` silently resolved to nothing (or
-- errored), so the job never sent a valid Authorization header and
-- `overnight-record` 403'd it before recording anything — the entire
-- overnight-line + T212 auto-sync data pipeline had been failing quietly
-- since 0019 rebuilt the job from this SQL (2026-07-15).
--
-- Fix: use Vault, Supabase's own encrypted-secret store, exactly as their
-- docs recommend for "pg_cron job needs a bearer token" — the secret is
-- stored encrypted-at-rest and the job body only ever contains a lookup
-- by NAME, never the plaintext value, so (unlike inlining the literal
-- secret in the cron.schedule body) `cron.job.command` stays free of the
-- actual credential even if that table were ever readable by a broader
-- role.
--
-- REQUIRES the secret to actually be stored in Vault first — that's a
-- one-off, out-of-band step (same "value never lives in this file"
-- policy 0016 used for app.cron_secret), NOT part of this migration:
--
--   delete from vault.secrets where name = 'cron_secret';
--   select vault.create_secret(
--     '<the CRON_SECRET value — must match the Edge Function secret>',
--     'cron_secret',
--     'Bearer token for the overnight-record cron job'
--   );
--
-- Run that in the SQL Editor whenever the secret is first set or rotated.
-- This migration is safe to re-run / re-apply on its own; it only touches
-- the cron job definition, never the secret value.

create extension if not exists supabase_vault with schema vault;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'overnight-record-every-5min') then
    perform cron.unschedule('overnight-record-every-5min');
  end if;
end $$;

-- ⚠️  CROSS-ENVIRONMENT WARNING (same as 0016/0019/0020): the `url` below
-- is the PRODUCTION project's Edge Function host, hardcoded. Applying this
-- migration to any other database will make THAT database POST to
-- production every 5 minutes. Change the host per environment — and that
-- environment needs its OWN `cron_secret` Vault entry, matching ITS OWN
-- overnight-record deployment's CRON_SECRET.
select cron.schedule(
  'overnight-record-every-5min',
  '*/5 0-9 * * *',
  $cron$
    select net.http_post(
      url     := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/overnight-record',
      headers := jsonb_build_object(
        'Authorization',
        concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 9000
    );
  $cron$
);
