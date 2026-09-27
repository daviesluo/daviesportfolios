-- 0064: RW-E's three variants replayed beside it (pre-registration `reviews/2026-09-27-polymarket-rw-variants-prereg.md`,
-- `agents/pmrw_x.ts`): no weather markets, a pause after a jump in the mid, and both, each RW-E from 2026-09-27 plus its
-- rule from 2026-09-28 00:00 UTC. Their own state and day rows, beside RW-E's and apart from them, so nothing of RW-E's
-- frozen test is touched; the replay reads `pm_rw_*` and writes only these two tables.
--
-- Its call is a row of `edge-calls-every-minute` (0063): one statement queues every call due in a minute, so pg_net
-- takes them as one batch. The list below is 0063's with that one row added.
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (as 0037): the `url` is the PRODUCTION project's Edge Function host,
-- hardcoded. Applying this to any other database makes THAT database POST to production every minute.

create table if not exists public.pm_rw_x_state (
  id          integer primary key check (id = 1),
  -- Every arm's running accounts (rw: RW itself, the check; e: RW-E, the second check; x1–x3: the variants), the UTC
  -- day being accumulated, the last minute replayed, and the largest gaps of the two checks.
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);

create table if not exists public.pm_rw_x_days (
  day          date not null,
  arm          text not null check (arm in ('rw', 'e', 'x1', 'x2', 'x3')),
  total        numeric not null,
  stress_total numeric not null,
  reward       numeric not null,
  fills        integer not null check (fills >= 0),
  capital      numeric not null check (capital >= 0),
  markets      integer not null check (markets >= 0),
  detail       jsonb not null default '{}'::jsonb,  -- per market; the markets an arm ran through the rule; the checks' gaps
  closed_at    timestamptz not null default now(),
  primary key (day, arm)
);

alter table public.pm_rw_x_state enable row level security;
alter table public.pm_rw_x_days  enable row level security;

insert into public.agent_locks (name) values ('pmrw-x') on conflict (name) do nothing;

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
      ('agents?action=pmrw-x',        58000, 1, 23),
      ('agents?action=views',         59000, 1, 23),
      ('agents?action=pmrw-select',  290000, 5, 23),
      ('snapshot-record',             25000, 5, 23),
      ('overnight-record',             9000, 5, 9)
    ) as call(path, timeout_ms, every_minutes, last_utc_hour)
    where extract(minute from now() at time zone 'utc')::int % call.every_minutes = 0
      and extract(hour from now() at time zone 'utc')::int <= call.last_utc_hour;
  $cron$
);
