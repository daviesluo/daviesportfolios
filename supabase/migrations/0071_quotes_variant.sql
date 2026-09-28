-- 0071: "Stablecoin quotes - variant" (PR5V) on paper: PR5's stored minutes replayed through the variant's rule
-- (reference §4 item 45; its pre-registration, `reviews/2026-09-28-pr5-variant-prereg.md`, §2–§3).
--
-- Davies, 2026-09-28: the best configuration of the PR5v study goes on paper as "Stablecoin quotes - variant". The
-- study (`reviews/2026-09-28-pr5-variant-study.md`) chose nine rungs a side (0.03 … 0.30 %) on both books, a 0.03 %
-- re-price, one 10 % volume cap a minute shared by the orders on each side of a book, and four keys (a book and a side
-- each) held to the live design's order governor (600 / 700 POSTs a UTC day). The pre-registration runs it at PR5's own
-- minute, as arm `main`, beside arm `top5` (k = 0.05 … 0.15 %), which is reported and never judged.
--
-- `agents?action=quotesv` (`agents/quotes_variant.ts`) decides a minute only once PR5's engine has decided it
-- (`agent_quote_state.last_minute`, the one column of PR5's state it reads), from the X and fairU PR5's rule was given
-- (`agent_quote_minutes`, 0055) and the minute's prints (`agent_quote_prints`), taken by time and then by id in code-point
-- order. It calls no venue, reads none of PR5's conclusions and writes only the tables below: nothing PR5's paper engine,
-- its live executor or their tables read is touched. Both arms start flat at 2026-09-28 00:00 UTC. Each call decides at
-- most 120 minutes, in chunks, and starts none after 10 s, so it never lengthens the minute's pg_net batch.
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (as 0037): the job's `url` is the PRODUCTION project's Edge Function host, hardcoded.
-- Applying this to any other database makes THAT database POST to production every minute.

create table if not exists public.agent_quotev_state (
  id          integer primary key check (id = 1),
  -- Both arms: each book's rungs (idle / quote / position, the working order, the position), its last print and last
  -- GBP/USD, and each key's POSTs in the current UTC day.
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,                    -- the last minute decided (never past agent_quote_state.last_minute)
  updated_at  timestamptz not null default now(),
  last_error  text
);

-- What each book-minute was decided on, one row for both arms (they share it): PR5's record of the minute (`minutes`),
-- or, where PR5 decided it without writing a row, the minute rebuilt from `agent_quote_inputs` by PR5's own functions
-- (`rebuilt`); and how many prints it was decided on beside how many PR5 was (they differ when a print came late).
create table if not exists public.agent_quotev_minutes (
  book         text not null check (book in ('USDC-GBP', 'USDT-GBP')),
  minute       timestamptz not null,
  source       text not null check (source in ('minutes', 'rebuilt')),
  x            numeric check (x is null or x > 0),            -- GBP/USD; null is dark
  x_t          timestamptz,                                   -- the start of the minute bar X came from
  fair_u       numeric check (fair_u is null or fair_u > 0),  -- the USD book's median close; null is none
  hours_n      integer not null check (hours_n >= 0),
  prints_n     integer not null check (prints_n >= 0),        -- the prints this minute was decided on
  pr5_prints_n integer check (pr5_prints_n is null or pr5_prints_n >= 0),   -- the prints PR5 decided it on; null when rebuilt
  recorded_at  timestamptz not null default now(),
  primary key (book, minute)
);

-- Each arm's order log, as PR5's engine keeps its own: every POST (`order`, and `stop`), with the key it counted against
-- (`book/side` of its rung) and what it was (`what`: place, reprice, replace, exit, exit_reprice, exit_replace, stop),
-- each refusal, each withdrawal with its reason (`detail.why`: dark, or the governor), each fill and each exit.
create table if not exists public.agent_quotev_events (
  arm    text not null check (arm in ('main', 'top5')),
  book   text not null check (book in ('USDC-GBP', 'USDT-GBP')),
  minute timestamptz not null,                -- the minute decided
  side   text not null check (side in ('bid', 'ask', '-')),
  k      numeric not null,                    -- the rung's distance from fair
  kind   text not null check (kind in ('order', 'refused', 'withdraw', 'fill', 'exit', 'stop')),
  what   text,
  key    text check (key is null or key in ('USDC-GBP/bid', 'USDC-GBP/ask', 'USDT-GBP/bid', 'USDT-GBP/ask')),
  ticks  integer,                             -- the price in 0.0001 GBP
  detail jsonb not null default '{}'::jsonb,
  primary key (arm, book, minute, side, k, kind),
  -- A POST says what it was, and nothing else does (coalesce: a check that comes out null would let a null through).
  constraint agent_quotev_events_what_check check (case kind
    when 'order' then coalesce(what in ('place', 'reprice', 'replace', 'exit', 'exit_reprice', 'exit_replace'), false)
    when 'stop' then coalesce(what = 'stop', false)
    else what is null end)
);

-- One row per round trip, as `agent_quote_trips` keeps PR5's, with its arm and key. `id` only orders a paged read.
create table if not exists public.agent_quotev_trips (
  id            bigint generated by default as identity unique,
  arm           text not null check (arm in ('main', 'top5')),
  key           text not null check (key in ('USDC-GBP/bid', 'USDC-GBP/ask', 'USDT-GBP/bid', 'USDT-GBP/ask')),
  book          text not null check (book in ('USDC-GBP', 'USDT-GBP')),
  side          text not null check (side in ('bid', 'ask')),
  k             numeric not null,
  t_entry       timestamptz not null,         -- the minute it filled
  fill_ts       timestamptz not null,
  fill_print_id text not null,
  entry         numeric not null check (entry > 0),
  qty           numeric not null check (qty > 0),
  x_entry       numeric,
  fair_entry    numeric,
  entry_oid     integer,
  t_exit        timestamptz not null,
  exit          numeric not null check (exit > 0),
  how           text not null check (how in ('maker', 'taker')),
  exit_print_id text,
  exit_oid      integer,
  notional_usd  numeric not null,
  pnl_usd       numeric not null,
  primary key (arm, book, side, k, t_entry)
);

alter table public.agent_quotev_state   enable row level security;
alter table public.agent_quotev_minutes enable row level security;
alter table public.agent_quotev_events  enable row level security;
alter table public.agent_quotev_trips   enable row level security;

-- Each arm's UTC days for its page, as `agent_quote_days` (0070) counts PR5's, every count by the UTC day of the minute
-- decided, never of the clock it was written at: orders (every order event, placements, re-prices and re-placements
-- alike), posts (those and the stops: what the governor counts), the entry fills, and the round trips that CLOSED that
-- day with what they made. security_invoker: it reads the tables with the caller's rights, so it is exactly as closed to
-- the anon key as they are.
create or replace view public.agent_quotev_days with (security_invoker = true) as
with ev as (
  select arm, (minute at time zone 'UTC')::date as day,
         count(*) filter (where kind = 'order') as orders,
         count(*) filter (where what is not null) as posts,
         count(*) filter (where kind = 'fill') as fills
  from public.agent_quotev_events
  where kind in ('order', 'stop', 'fill')
  group by 1, 2
), tr as (
  select arm, (t_exit at time zone 'UTC')::date as day,
         count(*) as trips,
         count(*) filter (where pnl_usd > 0) as won,
         sum(pnl_usd) as realised_usd
  from public.agent_quotev_trips
  group by 1, 2
)
select coalesce(ev.arm, tr.arm) as arm,
       coalesce(ev.day, tr.day) as day,
       coalesce(ev.orders, 0) as orders,
       coalesce(ev.posts, 0) as posts,
       coalesce(ev.fills, 0) as fills,
       coalesce(tr.trips, 0) as trips,
       coalesce(tr.won, 0) as won,
       coalesce(tr.realised_usd, 0) as realised_usd
from ev full outer join tr on tr.arm = ev.arm and tr.day = ev.day;

-- A code change that could change a decision bumps `VARIANT_CODE_VERSION` in quotes_variant.ts; the next call then runs
-- this, through PostgREST's rpc endpoint, and decides everything again from 2026-09-28 00:00 UTC, flat. It deletes the
-- variant's own rows and nothing else (`where true`: a delete with no condition is refused where safeupdate is loaded).
create or replace function public.agent_quotev_reset() returns void language sql as $$
  delete from public.agent_quotev_events where true;
  delete from public.agent_quotev_trips where true;
  delete from public.agent_quotev_minutes where true;
  delete from public.agent_quotev_state where true;
$$;
revoke execute on function public.agent_quotev_reset() from public, anon, authenticated;
grant execute on function public.agent_quotev_reset() to service_role;

insert into public.agent_locks (name) values ('quotesv') on conflict (name) do nothing;

-- The one job every recurring Edge call is a row of (0063), with the list 0069 left and the variant's call added. It
-- waits for nothing: it decides what PR5 has decided by the time it runs, so it runs a minute behind PR5.
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
      ('agents?action=quotesv',       58000, 1, 23),
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
