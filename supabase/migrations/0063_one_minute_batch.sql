-- 0063: every call pg_cron makes through pg_net goes out from one job, in one statement a minute.
--
-- pg_net 0.20's worker (src/worker.c) is woken when a transaction that queued a request commits. It takes what the
-- queue holds at that moment as one batch and reads the queue again only when every request of that batch has
-- answered. Nine cron jobs each queued their own call at :00, and a call that committed a moment after the worker had
-- taken the others waited for the slowest of them: `quotes` answers after ~28 s and `books` after ~44 s (both wait
-- inside the minute on purpose), a view run with a deadline's window open after 56 s. In the 24 hours to 2026-09-27
-- 16:40 UTC the Edge logs show the tick starting more than 5 s into its minute in 145 of 1,393 runs (the latest at
-- 56.8 s), the view recorder in 88 of 873 and the board's snapshot in 23 of 279; at 15:59 the view call reached its
-- function 5 ms after `books` answered, 20 s before a market's deadline.
--
-- The rows one statement queues commit together, so the worker takes them together. The job below queues every call
-- due in its minute: the six per-minute calls always, and the three five-minute calls when the minute is a multiple
-- of five (the overnight recorder only 00:00-09:55 UTC, as before). Each call is the job it replaces, unchanged: the
-- same URL, headers, body and timeout. A batch still lasts as long as its slowest call. Every call ends inside its
-- minute except `pmrw-select`, which may run to its 290 s lease (36 s at most in those 24 hours) and would hold the
-- next minute's batch while it does. A call queued by hand waits for the batch in flight, then holds the next
-- minute's batch for as long as it runs past the minute.
--
-- RW's verdict (after 2026-10-09) now takes `pmrw`, `pmrw-e` and `pmrw-select` out of this job's list rather than
-- unscheduling jobs of their own. `src/cron_jobs.test.js` replays the migrations' cron calls and fails if any other
-- job queues a pg_net call.
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (as 0037): the `url` is the PRODUCTION project's Edge Function host,
-- hardcoded. Applying this to any other database makes THAT database POST to production every minute.

select cron.unschedule(jobid) from cron.job where jobname in (
  'agents-tick-every-minute', 'agents-quotes-every-minute', 'agents-books-every-minute', 'agents-pmrw-every-minute',
  'agents-pmrw-e', 'agents-views-every-minute', 'agents-pmrw-select', 'snapshot-record-every-5min',
  'overnight-record-every-5min', 'edge-calls-every-minute'
);

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
    from (values
      ('agents?action=tick',          50000, 1, 23),
      ('agents?action=quotes',        58000, 1, 23),
      ('agents?action=books',         58000, 1, 23),
      ('agents?action=pmrw',          58000, 1, 23),
      ('agents?action=pmrw-e',        58000, 1, 23),
      ('agents?action=views',         59000, 1, 23),
      ('agents?action=pmrw-select',  290000, 5, 23),
      ('snapshot-record',             25000, 5, 23),
      ('overnight-record',             9000, 5, 9)
    ) as call(path, timeout_ms, every_minutes, last_utc_hour)
    where extract(minute from now() at time zone 'utc')::int % call.every_minutes = 0
      and extract(hour from now() at time zone 'utc')::int <= call.last_utc_hour;
  $cron$
);
