-- 0118: "Stablecoin quotes with Euros - 2", the weekend variant of the Coinbase paper test (agents/cb_hold.ts).
--
-- On whose word. Davies, 2026-10-13, after the first-days review (docs/agents/reviews/2026-10-12-coinbase-first-days.md, its
-- section 6, item 3): "周末变体写预注册然后上线paper trading 策略with Euros - 2" — write the pre-registration for the weekend
-- variant and put it on paper as the strategy "with Euros - 2". Pre-registered in
-- docs/agents/reviews/2026-10-13-coinbase-weekend-prereg.md, frozen at the commit that adds this file.
--
-- The one change from "Stablecoin quotes with Euros" (0112): the interbank rates are held through a closure, up to 60 hours,
-- where the base test goes dark after ten minutes. Everything else is the base test's: its books, its recorded prints
-- (`cb_trades`, `cb_rec_state` are 0112's and are only READ here), PR5's stored GBP/USD and hourly closes (`agent_quote_inputs`),
-- Yahoo's EUR/USD as the base test's call stores it (`cb_quote_inputs`), `stepMinute` unchanged, £100 a rung on a GBP book and
-- €100 on a EUR book. Nothing here touches 0112's tables, its call or its prune.
--
-- What it adds, the shape of 0112's paper-test tables under the prefix `cb_hold_` (an id names tables, never a variant number):
--   cb_hold_state    one row: the four books' rungs, the newest trade id fed to each, the last minute decided, the window's start
--                    (`state.startedAt`: the first 00:00 UTC after the call's first run).
--   cb_hold_events   every placement, re-price, re-placement, refusal, withdrawal, fill, exit and stop.
--   cb_hold_trips    one row per round trip, in the book's currency and in pounds.
--   cb_hold_minutes  what each minute was decided on (X, fair, the bar's start `x_t` — hours old in a closure) and its prints as a
--                    bar, for the replay (the pre-registration's bar 1) and for the base-arm replay, which darkens the minutes
--                    whose bar is over ten minutes old.
--   cb_hold_days     a view: each UTC day's orders, entry fills, closed round trips, won, realised in pounds.
-- and the lease `cb-hold` (agent_locks), the call `agents?action=cbhold`, and a daily prune of the minute record.
--
-- Its size: the same rows as 0112's paper-test tables, except that a closure's minutes are decided, not dark: 5,760 minute rows a
-- day (about 1 MB), events about 900 a day, trips a few dozen; the minute record kept 120 days, events and trips kept.
--
-- The call. Every minute, all day, `retry` true: a second run in its minute changes nothing the first did (it holds a lease, takes
-- the recorder's coverage as the state row gives it, and upserts every row on its natural key). 30 s at most, under the minute
-- like every row (0099). It writes its beat first (the `agents` function's, before its work) and reads only the database, so it
-- needs no read of Coinbase. Like every row since 0104 it waits 15 minutes (`active_from`'s default) for the function's deploy;
-- an insert never names it. Not among the monitor's health readings (a paper test that stops trades nothing); its faults go to
-- the errors box as `agents.cb_hold`.
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` from the new
-- tables and the view. Only the service role (the function) and postgres (the prune) touch them.
--
-- ⚠️  As 0075: the job's URL is the PRODUCTION project's Edge host, so this row makes any database it is applied to call
-- production.

create table if not exists public.cb_hold_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);

create table if not exists public.cb_hold_events (
  book   text not null check (book in ('USDC-GBP', 'USDT-GBP', 'USDC-EUR', 'USDT-EUR')),
  minute timestamptz not null,
  side   text not null check (side in ('bid', 'ask', '-')),
  k      numeric not null,
  kind   text not null check (kind in ('order', 'refused', 'withdraw', 'fill', 'exit', 'stop')),
  ticks  integer,                                     -- the price in the book's price steps (0.0001; USDT-EUR 0.00001)
  detail jsonb not null default '{}'::jsonb,
  primary key (book, minute, side, k, kind)
);

create table if not exists public.cb_hold_trips (
  book          text not null check (book in ('USDC-GBP', 'USDT-GBP', 'USDC-EUR', 'USDT-EUR')),
  side          text not null check (side in ('bid', 'ask')),
  k             numeric not null,
  t_entry       timestamptz not null,                 -- the minute it filled
  fill_ts       timestamptz not null,
  fill_trade_id bigint not null,
  entry         numeric not null check (entry > 0),   -- the book's currency per coin
  qty           numeric not null check (qty > 0),     -- coins
  x_entry       numeric,                              -- pounds per unit of the book's currency
  fair_entry    numeric,
  entry_oid     integer,
  t_exit        timestamptz not null,
  exit          numeric not null check (exit > 0),
  how           text not null check (how in ('maker', 'taker')),
  exit_trade_id bigint,
  exit_oid      integer,
  notional_gbp  numeric not null,
  pnl_gbp       numeric not null,
  primary key (book, side, k, t_entry)
);
create index if not exists cb_hold_trips_t_exit on public.cb_hold_trips (t_exit);

create table if not exists public.cb_hold_minutes (
  book      text not null check (book in ('USDC-GBP', 'USDT-GBP', 'USDC-EUR', 'USDT-EUR')),
  minute    timestamptz not null,
  x         numeric,                                  -- pounds per unit of the book's currency; null: dark (no rate within the hold)
  x_t       timestamptz,                              -- the GBP/USD bar it came from (a closure holds Friday's)
  eur_t     timestamptz,                              -- the EUR/USD bar (EUR books)
  fair      numeric,                                  -- the book's fair, in its currency
  hours_n   integer not null,
  prints_n  integer not null,
  vol       numeric not null,                         -- the minute's volume in the book's currency
  sell_lo   numeric, sell_hi numeric, buy_lo numeric, buy_hi numeric,   -- each aggressor side's extremes
  last      numeric,
  last_side text check (last_side in ('buy', 'sell')),
  primary key (book, minute)
);

alter table public.cb_hold_state   enable row level security;
alter table public.cb_hold_events  enable row level security;
alter table public.cb_hold_trips   enable row level security;
alter table public.cb_hold_minutes enable row level security;

-- The paper test's DAYS, as 0112's (and PR5's, 0070): orders are every order event, fills the entry fills, trips/won/realised the
-- round trips that CLOSED that day. security_invoker: as closed to the anon key as its tables.
create or replace view public.cb_hold_days with (security_invoker = true) as
with ev as (
  select (minute at time zone 'UTC')::date as day,
         count(*) filter (where kind = 'order') as orders,
         count(*) filter (where kind = 'fill') as fills
  from public.cb_hold_events
  where kind in ('order', 'fill')
  group by 1
), tr as (
  select (t_exit at time zone 'UTC')::date as day,
         count(*) as trips,
         count(*) filter (where pnl_gbp > 0) as won,
         sum(pnl_gbp) as realised_gbp
  from public.cb_hold_trips
  group by 1
)
select coalesce(ev.day, tr.day) as day,
       coalesce(ev.orders, 0) as orders,
       coalesce(ev.fills, 0) as fills,
       coalesce(tr.trips, 0) as trips,
       coalesce(tr.won, 0) as won,
       coalesce(tr.realised_gbp, 0) as realised_gbp
from ev full outer join tr on tr.day = ev.day;

insert into public.agent_locks (name) values ('cb-hold') on conflict (name) do nothing;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=cbhold', 30000, 1, 23, true) on conflict (path) do nothing;

-- Daily: minute records older than 120 days (the 28-day test, its comparison and room). Events and trips are kept.
select cron.schedule(
  'cb-hold-prune',
  '49 10 * * *',
  $cron$delete from public.cb_hold_minutes where minute < now() - interval '120 days';$cron$
);
