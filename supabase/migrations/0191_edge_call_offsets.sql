-- 0191: the minute's `agents` calls start over 23 seconds, not all in its first second.
--
-- On whose word. Davies, 2026-10-31 ~08:20 UTC: "做", on spreading the one-minute job's calls across seconds.
--
-- The fault. Every recurring call is queued by `edge-calls-every-minute` at :00 (0063), so fourteen `agents` calls a minute (fifteen
-- at a five-minute mark) reach the function in the same second. The platform has served several of them from one worker since 2026-10-26, and a worker that
-- fails to start answers 503 BOOT_ERROR to all it holds (edge-watchdog's header): in the 24 hours to 2026-10-31 08:30 UTC,
-- 327 of 1,440 minutes lost one or more `agents` calls to it, 213 of them seven to thirteen at once, about 21 every 20
-- minutes after the lazy imports (068298f5); the watchdog ran them again 13 s in. No other function of the list lost more
-- than one call a day.
--
-- Why not from SQL. pg_net 0.20's worker takes the queue as one batch and reads it again only when every request of that
-- batch has answered (src/worker.c: `do { … } while (running_handles > 0)`; 0063): a second cron job queuing at :10 would
-- wait behind `books` (45 s) and `quotestwins` (44 s). pg_cron 1.6.4 can run a job every few seconds, but every job's
-- requests go to the same worker. So the job keeps one statement and sends the rows of second 0, and `edge-watchdog`, a row
-- of second 0 that holds no pg_net slot while it waits, sends each other row at its second by the job's own request (the
-- URL, the cron bearer, JSON, `{}`, the row's timeout) and looks for its beat 13 s after its second, so a row that did not
-- start is still run again once, keyed to its minute, after its own start. No pg_sleep: nothing blocks the cron worker.
--
-- What this does.
--   1. `edge_calls.offset_s`, the second of its minute a row is sent at: 0 (every row now, and every row inserted later
--      unless a migration moves it) is the job's; more is the watchdog's. Two checks: 0 to 30, and the row's whole timeout
--      inside its minute (`offset_s * 1000 + timeout_ms < 60000`), the rule `src/cron_jobs.test.js` held since 0099.
--   2. The seconds below, each with the timeout that keeps its row inside the minute (statement by statement).
--   3. The job: 0104's word for word, with one condition more, `call.offset_s = 0`.
--
-- Each row's second, read from the code (the 0075 table, again):
--   agents?action=quotes      0   PR5's paper engine and both Revolut X live executors (LIVE, USDC/GBP). A live executor
--                                 keeps its start; it waits to :25 inside its call anyway (`QUOTES_START_MS`).
--   agents?action=cblive      0   Coinbase's live executor ('self' since 0182): keeps its start.
--   agents?action=cbrec       0   Coinbase's recorder and base paper test: its touch is the book at its minute's read, what
--                                 a post-only order met and the 24-hour stop sold into (cb_rec.ts; the frozen
--                                 reviews/2026-10-10-coinbase-paper-prereg.md). Keeps its second.
--   agents?action=okxrec      0   OKX's recorder and twins: its top five levels are the twins' crossing check and stop
--                                 (okx_rec.ts; reviews/2026-10-27-okx-paper-prereg.md). Keeps its second.
--   agents?action=fxrec       0   The second-level FX recorder: it answers at once and reads through its minute from :00
--                                 (fx_rec.ts); the Coinbase arms read "the newest read that arrived by t + 58 s". Keeps it.
--   agents?action=cbnudge     3   Coinbase's nudged paper arm: decides the minutes the recorder's state row covers, a minute
--                                 behind the clock (`minuteOf(now) - M`), from recorded inputs alone, so its decisions do
--                                 not move with its second; at 3 s it reads the row cbrec wrote this minute. Coinbase LIVE
--                                 decides by itself ('self') and reads this arm's state for its shadow record only.
--   agents?action=cbusdc      5   Coinbase's USDC arm: as cbnudge.
--   agents?action=cbhold      7   Coinbase's weekend arm: as cbnudge.
--   agents?action=okxbasis    9   OKX's basis twin: the recorder's state row, the minutes it covers, as cbnudge.
--   agents?action=xhedge     11   The hedge arms: the minutes three or more behind the clock, from the recorders' tables.
--   agents?action=cjrec      13   CoinJar's recorder: prints by cursor, a book stored when it changed (`seen_until`); no
--                                 paper test reads it, and its reads are bounded from its own start.
--   agents?action=grokpmrec  15   GROKPM's keyless record, every five minutes: reads the wallet's trades by cursor.
--   agents?action=cbbooks    17   Coinbase's books recorder: reads from :30 inside its call (`CB_BOOKS_START_MS`) whenever
--                                 it arrived; ends by 46 s at most (12 s budget, 4 s a read). Timeout 58 s → 41 s.
--   agents?action=quotestwins 20  Revolut X's twins: wait to :38 (`TWINS_START_MS`), when PR5's call has decided; ended by
--                                 50.9 s at the most in the three hours to 08:30 UTC. Timeout 58 s → 38 s.
--   agents?action=books      23   Revolut X's books recorder: reads from :40 (`BOOKS_START_MS`), ends by 56 s at most
--                                 (12 s budget, 4 s a read; 45.3 s measured); the maker watch runs in its wait until :32,
--                                 9 s from 23 s, which is what one minute's write takes. Timeout 58 s → 35 s.
--   every other row           0   Other functions (snapshot-record, overnight-record, edge-watchdog, trading212, ig, grokpm,
--                                 targets, igbot, cxbot): none lost more than one call a day to a boot, and the watchdog is
--                                 the one that sends.
--
-- So at :00 the job sends five `agents` calls where it sent fourteen, and no two moved rows share a second.
--
-- Safe while the job runs. Adding a column with a constant default writes the catalogue only; the two checks read the
-- list's 48 rows (every timeout is under 60 s already, 59 s the longest); the lock is held to the commit, milliseconds
-- later, and `lock_timeout` keeps this out of the lock queue behind a long reader (as 0104). `db push` sends a file with no index, vacuum or cluster statement as one
-- transaction: the job's new command, the column and the seconds become visible together.
--
-- In either order with the watchdog's deploy. Deployed first, the new watchdog finds no `offset_s` (it reads `select=*`), so
-- every row is the job's and it sends nothing. Applied first, the old watchdog finds the moved rows with no beat at 13 s and
-- runs each again once, `edge_call_retries` rows of outcome `ok`, until edge-functions.yml has deployed it (a minute or two):
-- every call still runs, 13 s late. If that deploy did not happen, the retries go on every minute: check the function's
-- "Last updated" after the push.
--
-- ⚠️  As 0075: the job's URL is the PRODUCTION project's Edge host, so applying this anywhere else makes that database
-- call production every minute.

set lock_timeout = '3s';

alter table public.edge_calls add column if not exists offset_s integer not null default 0;
alter table public.edge_calls add constraint edge_calls_offset_s_range check (offset_s between 0 and 30);
alter table public.edge_calls add constraint edge_calls_within_minute check (offset_s * 1000 + timeout_ms < 60000);

update public.edge_calls set offset_s = 3 where path in ('agents?action=cbnudge');
update public.edge_calls set offset_s = 5 where path in ('agents?action=cbusdc');
update public.edge_calls set offset_s = 7 where path in ('agents?action=cbhold');
update public.edge_calls set offset_s = 9 where path in ('agents?action=okxbasis');
update public.edge_calls set offset_s = 11 where path in ('agents?action=xhedge');
update public.edge_calls set offset_s = 13 where path in ('agents?action=cjrec');
update public.edge_calls set offset_s = 15 where path in ('agents?action=grokpmrec');
update public.edge_calls set offset_s = 17, timeout_ms = 41000 where path in ('agents?action=cbbooks');
update public.edge_calls set offset_s = 20, timeout_ms = 38000 where path in ('agents?action=quotestwins');
update public.edge_calls set offset_s = 23, timeout_ms = 35000 where path in ('agents?action=books');

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
      and call.offset_s = 0
      and (call.active_from is null or call.active_from <= now())
      and extract(minute from now() at time zone 'utc')::int % call.every_minutes = 0
      and extract(hour from now() at time zone 'utc')::int <= call.last_utc_hour
    order by call.id;
  $cron$
);

reset lock_timeout;
