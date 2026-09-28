-- 0069: RW-C, RW's rule run again, forward, on fourteen days that did not exist when it was pre-registered: part 2 of
-- the RW-NEXT pre-registration (drafted in docs/agents/reviews/2026-09-27-testing-review-b-quote-tests.md §4.4). Davies
-- approved the build on 2026-09-27.
--
-- RW's engine stops by constant at 2026-10-09 00:00 UTC (`RW_RUN_END`), so a confirmation needs a second instance of
-- it: the same `agents/pmrw.ts` — its rule, its selection ($300 of whole markets a UTC day by first-round reward per
-- dollar), its timing, fills, settlement and accounts — driven on RW-C's instance (`RWC_INSTANCE`) by
-- `agents?action=pmrwc` (every minute) and `agents?action=pmrwc-select` (every five), into tables of its own, over
-- 2026-10-09 00:00 → 10-23 00:00 UTC. Its warm-up is 2026-10-08, a constant: before it both calls return at once and
-- read nothing, and from it the engine is running when the first day's selection lands. The warm-up is closed at its
-- marks as the fourteen days begin, so they start flat and it counts nowhere, as RW's did. After 10-23 both calls do
-- nothing; RW-C's verdict's migration takes them out of the job below.
--
-- RW-E and RW-E's three variants are replayed on RW-C's stored minutes by the frozen `pmrw_e.ts` and `pmrw_x.ts` rules,
-- with every "from" at RW-C's first minute (`RWCE_REPLAY`, `RWCX_REPLAY`): `agents?action=pmrwc-e` and `pmrwc-x`, every
-- minute, doing nothing until RW-C has decided that minute (10-09 00:02). Each replay's `rw` arm must equal
-- `pm_rwc_days` to under a cent — the pre-registration's check, before anything is read — and the variants' `e` arm
-- RW-E's own `pm_rwc_e_days`, as on RW's minutes.
--
-- The eleven tables are RW's (0053, 0056, 0064) under the name `pm_rwc_…`: the same columns, keys, checks and indexes;
-- row level security on with no policy, as RW's (the function reads and writes them with the service role, and the page
-- reads them through it); and, as RW's, no prune. Nothing here reads or writes RW's tables, and nothing else reads
-- these. The four calls are rows of `edge-calls-every-minute` (0063): the list below is 0064's with them added, every
-- other row unchanged.
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (as 0037): the `url` is the PRODUCTION project's Edge Function host,
-- hardcoded. Applying this to any other database makes THAT database POST to production every minute.

create table if not exists public.pm_rwc_state (
  id          integer primary key check (id = 1),
  -- Every market's running account (inventory, cash, rewards, marks), the markets' parameters, the last minute
  -- decided, and the UTC day being accumulated.
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,                    -- the last minute decided (two minutes behind the clock)
  updated_at  timestamptz not null default now(),
  last_error  text
);

-- One UTC day's portfolio: whole markets by RW's first-round reward per dollar, until $300 of capital.
create table if not exists public.pm_rwc_selection (
  day            date not null,
  cond           text not null,                -- the market's condition id
  rank           integer not null check (rank > 0),
  yes            text not null,                -- its YES token (the NO book is its mirror)
  tick           numeric not null check (tick > 0),
  v              numeric not null check (v > 0),          -- the maximum qualifying spread, in cents
  min_size       numeric not null check (min_size >= 0),  -- the minimum qualifying size, in shares
  rate           numeric not null check (rate >= 0),      -- the daily pool, in dollars
  per_dollar_day numeric not null,                        -- the expected reward per dollar a day at the selection
  capital        numeric not null check (capital > 0),
  q              text,
  cat            text,
  end_date       timestamptz,
  selected_at    timestamptz not null default now(),
  primary key (day, cond)
);

-- Each minute's book of each market quoted or held, as the rule reads it, and the minute's decision once it is taken.
create table if not exists public.pm_rwc_minutes (
  cond    text not null,
  minute  timestamptz not null,
  quoting boolean not null,                    -- selected that day (false: only held, marked, never quoted)
  tick    numeric not null check (tick > 0),   -- the book's own tick at that minute
  bb      numeric, ba numeric,                 -- the touch
  ab      numeric, aa numeric,                 -- the best levels holding the minimum qualifying size
  q1      numeric, q2 numeric,                 -- the others' scores, bids and asks
  m       numeric, b numeric, a numeric,       -- the decision: the adjusted mid, our bid and our ask …
  ours    numeric, others numeric, reward numeric,
  qb      boolean, qa boolean,                 -- … and which sides were quoted
  primary key (cond, minute)
);
create index if not exists pm_rwc_minutes_minute on public.pm_rwc_minutes (minute, cond);

-- Every taker print of every quoted market while it was quoted: what a fill is proven by.
create table if not exists public.pm_rwc_prints (
  id    text primary key,                      -- transaction, wallet, token, side, price, size and second
  cond  text not null,
  ts    timestamptz not null,
  side  text not null check (side in ('BUY', 'SELL')),
  oi    integer not null,                      -- the outcome index: 0 YES, 1 NO
  price numeric not null check (price >= 0 and price <= 1),
  size  numeric not null check (size > 0)
);
create index if not exists pm_rwc_prints_cond_ts on public.pm_rwc_prints (cond, ts);

-- Every paper fill, with the print that proved it.
create table if not exists public.pm_rwc_fills (
  cond     text not null,
  minute   timestamptz not null,               -- the minute whose quote it filled
  ts       timestamptz not null,
  side     text not null check (side in ('bid', 'ask')),
  price    numeric not null check (price > 0 and price < 1),
  size     numeric not null check (size > 0),
  print_id text not null,
  primary key (cond, minute, print_id)
);

-- The running totals as each UTC day ended: the fourteen day totals are the differences.
create table if not exists public.pm_rwc_days (
  day          date primary key,
  total        numeric not null,               -- rewards + fill cash + inventory at the adjusted mid (the payout once settled)
  stress_total numeric not null,               -- rewards halved, fills a tick worse, inventory at the adjusted touch
  reward       numeric not null,
  fills        integer not null check (fills >= 0),
  capital      numeric not null check (capital >= 0),
  markets      integer not null check (markets >= 0),
  detail       jsonb not null default '{}'::jsonb,
  closed_at    timestamptz not null default now()
);

-- A market Gamma shows closed with a payout: its inventory is worth that from then on.
create table if not exists public.pm_rwc_settlements (
  cond        text primary key,
  closed_time text,
  payout      numeric not null check (payout >= 0 and payout <= 1),
  net         numeric not null,
  cash        numeric not null,
  settled_at  timestamptz not null default now()
);

-- RW-E replayed on RW-C's minutes: both arms' running accounts, the UTC day being accumulated, the last minute
-- replayed, the markets RW-E had to run through the rule itself, and the largest gap between the rw arm and RW-C's days.
create table if not exists public.pm_rwc_e_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);

-- Each arm's running totals as each UTC day ended, as `pm_rwc_days` keeps RW-C's.
create table if not exists public.pm_rwc_e_days (
  day          date not null,
  arm          text not null check (arm in ('rw', 'e')),
  total        numeric not null,
  stress_total numeric not null,
  reward       numeric not null,
  fills        integer not null check (fills >= 0),
  capital      numeric not null check (capital >= 0),
  markets      integer not null check (markets >= 0),
  detail       jsonb not null default '{}'::jsonb,  -- per market; the markets RW-E left out that day; the rw arm's gap to RW-C
  closed_at    timestamptz not null default now(),
  primary key (day, arm)
);

-- RW-E's three variants replayed on RW-C's minutes: every arm's running accounts (rw: RW-C itself, the check; e: RW-E,
-- the second check; x1–x3: the variants), the UTC day being accumulated, the last minute replayed, and the two checks.
create table if not exists public.pm_rwc_x_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);

create table if not exists public.pm_rwc_x_days (
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

alter table public.pm_rwc_state       enable row level security;
alter table public.pm_rwc_selection   enable row level security;
alter table public.pm_rwc_minutes     enable row level security;
alter table public.pm_rwc_prints      enable row level security;
alter table public.pm_rwc_fills       enable row level security;
alter table public.pm_rwc_days        enable row level security;
alter table public.pm_rwc_settlements enable row level security;
alter table public.pm_rwc_e_state     enable row level security;
alter table public.pm_rwc_e_days      enable row level security;
alter table public.pm_rwc_x_state     enable row level security;
alter table public.pm_rwc_x_days      enable row level security;

insert into public.agent_locks (name) values ('pmrwc'), ('pmrwc-select'), ('pmrwc-e'), ('pmrwc-x') on conflict (name) do nothing;

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
      ('agents?action=pmrwc',         58000, 1, 23),
      ('agents?action=pmrwc-e',       58000, 1, 23),
      ('agents?action=pmrwc-x',       58000, 1, 23),
      ('agents?action=views',         59000, 1, 23),
      ('agents?action=pmrw-select',  290000, 5, 23),
      ('agents?action=pmrwc-select', 290000, 5, 23),
      ('snapshot-record',             25000, 5, 23),
      ('overnight-record',             9000, 5, 9)
    ) as call(path, timeout_ms, every_minutes, last_utc_hour)
    where extract(minute from now() at time zone 'utc')::int % call.every_minutes = 0
      and extract(hour from now() at time zone 'utc')::int <= call.last_utc_hour;
  $cron$
);
