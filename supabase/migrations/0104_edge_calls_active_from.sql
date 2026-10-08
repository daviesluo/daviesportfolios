-- 0104: a call the one-minute job gains is first made 15 minutes after its row is written, so the code it calls is
-- deployed before it.
--
-- Why (review D1, approved by Davies 2026-10-08: "以上内容都修"). A push that adds a call does two things at once: its
-- migration writes the call's row into `public.edge_calls` (migrations.yml) and its function learns the action
-- (edge-functions.yml). The two workflows start together on the push, and the migration lands first: on 10-07 and
-- 10-08 a migrations run took 20 to 67 s and a deploy run 65 to 145 s. Until the deploy, the job calls the old code. It
-- happened once: 0100's `trading212?action=orders-sync` row was in by 15:49:03 UTC, when its migrations run ended, and
-- trading212 v75 deployed at 15:50:34, so the 15:50:13 call and the watchdog's retry met v74, which refused the POST
-- (405, one `edge-watchdog.retry` row). That call resumes; one that does not would lose its first minutes.
--
-- What this does.
--   1. `edge_calls.active_from`: the instant from which the job makes the call. It is added without a default, so every
--      row already on the list holds null, which the job reads as always. The default, set afterwards, gives every row
--      inserted later `now() + 15 minutes`, six times the longest deploy above. A migration that adds a call leaves it
--      to the default (`src/cron_jobs.test.js` refuses an insert that names the column).
--   2. The job, 0075's word for word but for one condition: `(call.active_from is null or call.active_from <= now())`.
--   3. `edge-watchdog` counts a row due only from the first minute that begins at or after its `active_from`, so it
--      never runs again a call the job held back.
--
-- Safe while the job runs. The job reads the list once a minute in a statement of milliseconds, and the watchdog once,
-- 13 s in. Adding a column with no default writes the catalogue only and setting a default touches no row: the table's
-- exclusive lock is taken for that and held to the commit, milliseconds later. `lock_timeout` stops this waiting in the
-- lock queue, where it would hold the job's read behind it, behind a long reader: after 3 s it fails instead, and
-- migrations.yml says so (the job's read of that minute is then at most 3 s late, once). `db push`
-- (CLI 2.117.0, `ExecBatch`) sends a file with no index, vacuum or cluster statement as one batch with its version row,
-- one transaction: the job's new command and the column it reads become visible together, at commit, and no minute
-- reads one without the other. The rows' order, paths, timeouts and filter are as they were.
--
-- ⚠️  As 0075: the job's URL is the PRODUCTION project's Edge host, so applying this anywhere else makes that database
-- call production every minute.

set lock_timeout = '3s';

alter table public.edge_calls add column if not exists active_from timestamptz;
alter table public.edge_calls alter column active_from set default now() + interval '15 minutes';

select cron.schedule(
  'edge-calls-every-minute',
  '* * * * *',
  $cron$
    select net.http_post(
      url     := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/' || call.path,
      headers := jsonb_build_object(
        'Authorization',
        concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := call.timeout_ms
    )
    from public.edge_calls as call
    where call.enabled
      and (call.active_from is null or call.active_from <= now())
      and extract(minute from now() at time zone 'utc')::int % call.every_minutes = 0
      and extract(hour from now() at time zone 'utc')::int <= call.last_utc_hour
    order by call.id;
  $cron$
);

reset lock_timeout;
