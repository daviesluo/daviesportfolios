-- 0060: RW-E's replay runs every minute, as RW does (Davies, 2026-09-26: "every min").
--
-- 0056 scheduled `agents?action=pmrw-e` every five minutes, so RW-E's row read "every 5 minutes" and trailed RW's by
-- up to five. A run replays only the minutes RW has decided since the last one, under the `pmrw-e` lease, so a run a
-- minute is one or two minutes of work and two runs never overlap. Its call gets 58 s, as every per-minute job does.
-- After 2026-10-09 00:00 UTC a run does nothing; a migration unschedules it with RW's own jobs and the verdict.
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (as 0037): the `url` is the PRODUCTION project's Edge Function host,
-- hardcoded. Applying this to any other database makes THAT database POST to production every minute.

do $$ begin
  if exists (select 1 from cron.job where jobname = 'agents-pmrw-e') then
    perform cron.unschedule('agents-pmrw-e');
  end if;
end $$;

select cron.schedule(
  'agents-pmrw-e',
  '* * * * *',
  $cron$
    select net.http_post(
      url     := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/agents?action=pmrw-e',
      headers := jsonb_build_object(
        'Authorization',
        concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 58000
    );
  $cron$
);
