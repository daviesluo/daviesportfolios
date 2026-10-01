-- 0075: no call of the one-minute job is lost to a worker the platform never started.
--
-- On whose word. Davies, 2026-10-01, of the "5 boot failures in about the last 6 hours" the ledger recorded that day:
--
--   “过去约 6 小时的 5 次函数启动失败” - 这个可以修复吗，可以的话就彻底修复
--
-- In English: "'5 function boot failures in about the last 6 hours': can this be fixed? If it can, fix it thoroughly."
--
-- The fault. In the 24 hours to 2026-10-01 15:00 UTC, 19 calls of `edge-calls-every-minute` answered 503
-- {"code":"BOOT_ERROR","message":"Function failed to start (please check logs)"}: all on `agents` in eu-west-2, each
-- 10.1–10.9 s after the request (the edge logs' execution_time_ms 10,082–10,955), with an empty execution_id and no
-- boot error in the function's logs, where a normal boot logs "booted (time: 18–82 ms)". The calls hit: pmrwc-x 5,
-- pmrw-x 3, views 3, pmrwc-e 2, pmrwc 2, quotes 1, pmrw 1, quotesv 1, tick 1. About 0.1 % of the ~19,700 calls a day, at
-- random across the actions: the platform failing to start a worker within ~10 s at the top of the minute, when 13–17
-- calls boot together. That cannot be stopped from here, so "thoroughly" is: no call is lost to it. A call whose worker
-- never started runs again within the same minute, once.
--
-- What this does.
--   1. One list. The job's calls leave the VALUES list inside its command for `public.edge_calls`, seeded with 0074's
--      seventeen rows exactly, in its order, and one more, `edge-watchdog`. The job's one statement reads the table with
--      the same URL, headers, body, timeout and filter, and `enabled`, in the seed's order. `src/cron_jobs.test.js`
--      proves that every minute of a day queues the requests 0074's did, and replays the list through later
--      migrations. A row leaves the job by a migration's `update public.edge_calls set enabled = false where path in
--      (…)` (RW's verdict takes `pmrw`, `pmrw-select`, `pmrw-e` and `pmrw-x` out this way; RW-C's, its four `pmrwc*`).
--   2. A beat per call, `public.edge_call_beats`: every function the job calls writes its beat key as its first act
--      (`_shared/beats.ts`) and the database stamps the minute, so a call that started is told apart from one that never
--      did. A daily job deletes the beats older than two days.
--   3. A watchdog, `edge-watchdog`, a row of the job every minute: 13 s into its minute it reads the minute's due calls
--      and beats and runs each due call with no beat again, once, by the same URL and bearer, awaited within the call's
--      own timeout. Each retry is claimed and recorded in `public.edge_call_retries` (a call the list says not to run
--      again is recorded `excluded`), and a retry that fails too is reported to ops_errors. Its header has the rest.
--
-- Safe twice. A call run again is the same code later in the same minute. A call may be run again when a second run in
-- its minute changes nothing a first run did; read from the code, path by path (`retry`):
--   tick          the `tick` lease; each bar claimed by a unique decision row, each protective exit by one a second into
--                 its minute, each order attempt by (decision, attempt); observations written on change; a fifth minute's
--                 basis keyed by the turn's own start, so a second turn adds a sample and replaces none. A second turn
--                 places nothing the first did. Yes. (A retried tick on a fifth minute writes its basis at its own
--                 start, 13 s or more in: RW-NEXT's lateness reading counts that minute late, not missing, and
--                 `edge_call_retries` names it.)
--   quotes        the `quotes` lease; PR5's state decides each minute once (`lastMinute`), its rows upserted on their
--                 keys; its live executor's `quotes-live` lease, one open order per rung (a unique index) and one POST
--                 per paper decision. Yes; a retry still waits to :25.
--   quotesv, quotesd  their leases; each minute PR5 decided replayed once (`lastMinute`), upserted. Yes.
--   books         no lease; a book stored when it changed, a read counted otherwise; a second read is a real read and a
--                 429 ends it. Yes; a retry still waits to :40.
--   pmrw-e, pmrw-x, pmrwc-e, pmrwc-x  their leases; each stored minute RW or RW-C decided replayed once. Yes.
--   pmrw-select, pmrwc-select  the selection lease; a day selected once ("already selected today"). Yes: the try the
--                 spec schedules at that minute then happens seconds late, with its book read at the selection as ever.
--   views         the `views` lease; its reads end 56 s into the minute it began in, whenever it began; rows on change.
--                 Yes.
--   pmlive        the `pm-live` lease; one open order per market, token and side (a unique index); events upserted on
--                 (mode, minute, kind), the day's markets on (day, kind); dry-run. Yes.
--   snapshot-record, overnight-record  rows upserted on the five-minute bucket. Yes.
--   pmrw, pmrwc   a minute's book is stored once, so a second run is harmless, but they are NOT run again: each reads
--                 the quoted markets' books for the minute it runs in, and the frozen spec
--                 (reviews/2026-09-24-polymarket-rw-paper-spec.md; RW-NEXT's slip rule for RW-C) says "The book is the
--                 one read at `t`", "A minute whose book was not read quotes nothing", fills from prints in (t, t + 60 s].
--                 A book read 13 s late could be filled by prints from before it was read. A minute they miss stays
--                 missed, as pre-registered, and the watchdog records it `excluded`.
--   edge-watchdog never: it does not run itself again.
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (as 0037): the `url` is the PRODUCTION project's Edge Function host,
-- hardcoded. Applying this to any other database makes THAT database POST to production every minute.

-- 1. The list. `id` is the order the job queues the calls in; `path` is appended to the Edge host as it stands.
create table if not exists public.edge_calls (
  id            integer generated always as identity primary key,
  path          text    not null unique check (path ~ '^[a-z][a-z0-9-]*([?][A-Za-z0-9=&_.-]+)?$'),
  timeout_ms    integer not null check (timeout_ms > 0),
  every_minutes integer not null check (every_minutes between 1 and 60),
  last_utc_hour integer not null check (last_utc_hour between 0 and 23),
  -- The job queues an enabled row only, in the minutes its filter names.
  enabled       boolean not null default true,
  -- The watchdog may run the call again when its worker never started (the table above says why each may or not).
  retry         boolean not null default true
);

-- 0074's list, row for row and in its order, then the watchdog's own row.
insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values
  ('agents?action=tick',          50000, 1, 23, true),
  ('agents?action=quotes',        58000, 1, 23, true),
  ('agents?action=quotesv',       58000, 1, 23, true),
  ('agents?action=quotesd',       58000, 1, 23, true),
  ('agents?action=books',         58000, 1, 23, true),
  ('agents?action=pmrw',          58000, 1, 23, false),
  ('agents?action=pmrw-e',        58000, 1, 23, true),
  ('agents?action=pmrw-x',        58000, 1, 23, true),
  ('agents?action=pmrwc',         58000, 1, 23, false),
  ('agents?action=pmrwc-e',       58000, 1, 23, true),
  ('agents?action=pmrwc-x',       58000, 1, 23, true),
  ('agents?action=views',         59000, 1, 23, true),
  ('agents?action=pmlive&forceFunctionRegion=eu-west-1', 58000, 1, 23, true),
  ('agents?action=pmrw-select',  290000, 5, 23, true),
  ('agents?action=pmrwc-select', 290000, 5, 23, true),
  ('snapshot-record',             25000, 5, 23, true),
  ('overnight-record',             9000, 5, 9,  true),
  ('edge-watchdog',               58000, 1, 23, false)
on conflict (path) do nothing;

-- 2. The beats: one per call that reached its function, keyed by the minute and the call's beat key
-- (`_shared/beats.ts`: the function, and `?action=` with its action). The minute is stamped here, on the database's
-- clock, the one pg_cron fires the job by: a call reaches its function 0.1–0.5 s after its minute begins, so a function
-- whose own clock ran half a second behind would file its beat under the minute before, and the call would be run again
-- although it ran. `ts` is when the beat was written, so it also says how far into its minute each call started.
create table if not exists public.edge_call_beats (
  minute timestamptz not null default date_bin('1 minute', now(), timestamptz '2000-01-01 00:00:00+00'),
  path   text        not null,
  ts     timestamptz not null default now(),
  primary key (minute, path)
);

-- 3. The watchdog's record: one row per minute and call that had no beat 13 s in. A retry's row is its claim, written
-- before the retry is sent, so a call is run again at most once a minute; it then holds the answer.
create table if not exists public.edge_call_retries (
  minute     timestamptz not null,
  path       text        not null,                 -- the call, as `edge_calls` names it
  claimed_at timestamptz not null default now(),
  outcome    text        not null check (outcome in ('sent', 'ok', 'failed', 'running', 'no_beat', 'excluded', 'held')),
  status     integer,                              -- the retry's HTTP status; null when none came
  ms         integer,                              -- how long it took to answer, or to be given up on
  detail     text,                                 -- what a retry that failed answered, or why it failed
  primary key (minute, path)
);
create index if not exists edge_call_retries_outcome on public.edge_call_retries (outcome, minute);

alter table public.edge_calls        enable row level security;
alter table public.edge_call_beats   enable row level security;
alter table public.edge_call_retries enable row level security;

-- Beats are needed for their own minute; two days are kept to audit one. The retries are kept.
select cron.schedule(
  'edge-call-beats-prune',
  '35 10 * * *',
  $cron$ delete from public.edge_call_beats where minute < now() - interval '2 days'; $cron$
);

-- The one-minute job (0063), reading its list from the table. Its URL, headers, body, timeout and filter are 0074's word
-- for word; `call.enabled` and the order are new.
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
      and extract(minute from now() at time zone 'utc')::int % call.every_minutes = 0
      and extract(hour from now() at time zone 'utc')::int <= call.last_utc_hour
    order by call.id;
  $cron$
);
