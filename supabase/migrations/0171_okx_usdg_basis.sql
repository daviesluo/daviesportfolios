-- 0171: "Stablecoin quotes USDG/EUR - 1", an OKX paper twin: the USDG/EUR row's rule (okx_quotes.ts, 0150) with its fair moved
-- half-way to the book's trailing 24-hour basis (okx_basis.ts; docs/agents/reviews/2026-10-29-okx-usdg-basis-prereg.md; the study
-- that proposed it, docs/agents/reviews/2026-10-29-cb-okx-fair-price-study.md §4 and §5).
--
-- On whose word. Davies, 2026-10-29, on that study's recommendation 2: "okx usdg/eur可以按你说的做一个 -1" (make the OKX USDG/EUR one
-- as you proposed, as a "- 1").
--
-- `okx_basis.ts`: `stepOkxMinute`, the USDG/EUR row's engine, called unchanged on USDG-EUR alone, $100 a rung, $600, from the first
-- 00:00 UTC after its first run. Its own tables (`okx_basis_*`, the OKX twins' shapes on the one book, the minute record with the
-- minute's par, its trailing basis and how many minutes it rests on), lease (`okx-basis`), call (`agents?action=okxbasis`, a row of
-- `edge_calls` under the watchdog, its beat first, as every agents action's) and prune. It reads the OKX recorder's tables and the
-- stored rates; it calls no venue and holds no key.
--
-- `retry` true: a second run in its minute changes nothing the first did (a lease, the recorder's coverage as its state row gives
-- it, every row upserted on its natural key, the state saved after them); under a minute; its row waits 15 minutes for the
-- function (0104).
--
-- What it leaves alone: OKX's recorder and its two twins ("USDG/EUR" and "EURC/USDC": their tables, call, lease, prune and frozen
-- files), every other arm and twin, LIVE and its config. No grant and no policy: row level security is on, and 0082's default
-- privileges keep `anon` and `authenticated` out.

create table if not exists public.okx_basis_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);

create table if not exists public.okx_basis_events (
  book   text not null check (book in ('USDG-EUR')),
  minute timestamptz not null,
  side   text not null check (side in ('bid', 'ask', '-')),
  k      numeric not null,
  kind   text not null check (kind in ('order', 'refused', 'withdraw', 'fill', 'exit', 'stop')),
  ticks  integer,
  detail jsonb not null default '{}'::jsonb,
  primary key (book, minute, side, k, kind)
);

create table if not exists public.okx_basis_trips (
  book          text not null check (book in ('USDG-EUR')),
  side          text not null check (side in ('bid', 'ask')),
  k             numeric not null,
  t_entry       timestamptz not null,
  fill_ts       timestamptz not null,
  fill_trade_id bigint not null,
  entry         numeric not null check (entry > 0),
  qty           numeric not null check (qty > 0),
  x_entry       numeric,
  t_exit        timestamptz not null,
  exit          numeric not null check (exit > 0),
  how           text not null check (how in ('maker', 'taker')),
  notional_gbp  numeric not null,
  pnl_quote     numeric not null,
  pnl_gbp       numeric not null,
  primary key (book, side, k, t_entry)
);
create index if not exists okx_basis_trips_t_exit on public.okx_basis_trips (t_exit);

-- The USDG/EUR row's minute record (`x` the real EUR/USD, `fair` the fair quoted on), and the basis: `par` (1 / EUR/USD), `basis`
-- (the trailing median the fair moved half-way to, 0 with fewer than five minutes), `basis_n` (how many minutes it rests on).
create table if not exists public.okx_basis_minutes (
  book          text not null check (book in ('USDG-EUR')),
  minute        timestamptz not null,
  x             numeric,
  x_held        boolean not null default false,
  fair          numeric,
  gbp_per_quote numeric,
  guard         text,
  prints_n      integer not null,
  vol           numeric not null,
  last          numeric,
  bid           numeric,
  ask           numeric,
  par           numeric,
  basis         numeric,
  basis_n       integer not null default 0,
  primary key (book, minute)
);

alter table public.okx_basis_state   enable row level security;
alter table public.okx_basis_events  enable row level security;
alter table public.okx_basis_trips   enable row level security;
alter table public.okx_basis_minutes enable row level security;

create or replace view public.okx_basis_days with (security_invoker = true) as
with ev as (
  select book, (minute at time zone 'UTC')::date as day,
         count(*) filter (where kind = 'order') as orders,
         count(*) filter (where kind = 'fill') as fills
  from public.okx_basis_events
  where kind in ('order', 'fill')
  group by 1, 2
), tr as (
  select book, (t_exit at time zone 'UTC')::date as day,
         count(*) as trips,
         count(*) filter (where pnl_gbp > 0) as won,
         sum(pnl_gbp) as realised_gbp
  from public.okx_basis_trips
  group by 1, 2
)
select coalesce(ev.book, tr.book) as book,
       coalesce(ev.day, tr.day) as day,
       coalesce(ev.orders, 0) as orders,
       coalesce(ev.fills, 0) as fills,
       coalesce(tr.trips, 0) as trips,
       coalesce(tr.won, 0) as won,
       coalesce(tr.realised_gbp, 0) as realised_gbp
from ev full outer join tr on tr.book = ev.book and tr.day = ev.day;

insert into public.agent_locks (name) values ('okx-basis') on conflict (name) do nothing;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=okxbasis', 30000, 1, 23, true) on conflict (path) do nothing;

select cron.schedule(
  'okx-basis-prune',
  '56 10 * * *',
  $cron$delete from public.okx_basis_minutes where minute < now() - interval '120 days';$cron$
);
