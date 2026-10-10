-- 0112: Coinbase's GBP and EUR stablecoin books, recorded keyless, and the forward paper test of PR5's rule on them
-- (`agents/cb_rec.ts`, `agents/cb_quotes.ts`; TESTING's "Stablecoin quotes Coinbase").
--
-- On whose word. Davies, 2026-10-10, on the venue screen (docs/agents/reviews/2026-10-09-stablecoin-venues.md, Coinbase
-- first): "先建起来吧，并且和Revolute X对比看哪个更好，投入的话资金该如何安排" — build it, and compare it with Revolut X. It needs
-- no account and no key: Coinbase Exchange's market data is public and GET only. Nothing here trades or can. The test is
-- pre-registered in docs/agents/reviews/2026-10-10-coinbase-paper-prereg.md, frozen at the commit that adds this file.
--
-- What it keeps, each minute, of USDC-GBP, USDT-GBP, USDC-EUR and USDT-EUR:
--   cb_trades        every print once, by Coinbase's trade id (one sequence a book, no gap), as served: price, size, the
--                    AGGRESSOR (Coinbase serves the maker's side), time to the microsecond. Read newest first and paged
--                    back to the newest stored id; an empty table starts at the first page.
--   cb_touch         each book's best bid and ask, sizes and order counts, a row a minute.
--   cb_rec_state     one row: each book's cursor (`cb_rec.ts`'s `CbCursor`), the fault last reported to `ops_errors`
--                    (`agents.cb_rec`, at most hourly while it lasts), the minute's errors and its report.
-- And the paper test's, as PR5's paper engine keeps its own (0051, 0055, 0070):
--   cb_quote_state   one row: the four books' rungs (`stepMinute`'s `BookState`), the newest trade id fed to each, the
--                    last minute decided.
--   cb_quote_inputs  Yahoo's EURUSD=X minutes (GBP/USD and the USD books' hourly closes are PR5's own, `agent_quote_inputs`).
--   cb_quote_events  every placement, re-price, re-placement, refusal, withdrawal, fill, exit and stop.
--   cb_quote_trips   one row per round trip, in the book's currency and in pounds.
--   cb_quote_minutes what each minute was decided on (X, fair, how many hourly closes) and its prints as a bar: all PR5's
--                    simulator reads of a minute (scq_venues/scripts/bars.py, proven equal to the prints), so the test can
--                    be replayed after the prints are pruned.
--   cb_quote_days    a view: each UTC day's orders, entry fills, closed round trips, won, realised in pounds.
--
-- Its size (measured from Coinbase's own history, 2025-10-09 → 2026-10-09): about 47,000 prints a day across the four
-- books, about 125 bytes a row with its key: about 6 MB a day, so prints are kept 10 days (the paper engine decides a
-- minute behind; its minute bars keep the test replayable). Touch rows: 5,760 a day, about 0.4 MB, kept 35 days, as the
-- CoinJar books are. Minute records: 5,760 a day, about 0.7 MB, kept 120 days (the 28-day test, its 90-day comparison and
-- room). Events about 900 a day and trips a few dozen: kept. The database was 1.31 GB on 2026-10-10.
--
-- The row. Every minute, all day. 30 s at most, under the minute like every row (0099): a minute is eight requests (a page
-- more a book only in a burst) to a host that serves 10 a second, each waiting 8 s at most, none starting past 15 s into
-- the run; then the paper minutes, from the database. Run again by the watchdog when its worker never started (`retry`):
-- a second run in a minute inserts only prints not stored (by trade id), a touch row by its instant, and decides nothing
-- already decided (the paper engine holds a lease and its last minute), so it changes nothing the first run did. Its
-- beat is the `agents` function's, written before its work. Like every row since 0104 it waits 15 minutes
-- (`active_from`'s default) for the function's deploy.
--
-- Not among the monitor's health readings (`monitor/health.ts`), as the CoinJar recorder (0110) is not: those say whether
-- the trading loop is alive, and a research recorder and paper test that stop trade nothing; their faults go to the errors
-- box, and the watchdog reruns a call that never started.
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` from
-- the new tables and the view. Only the service role (the function) and postgres (the prunes) touch them.
--
-- ⚠️  As 0075: the job's URL is the PRODUCTION project's Edge host, so this row makes any database it is applied to call
-- production.

create table if not exists public.cb_trades (
  product   text not null check (product in ('USDC-GBP', 'USDT-GBP', 'USDC-EUR', 'USDT-EUR')),
  trade_id  bigint not null check (trade_id > 0),    -- Coinbase's trade id, one sequence a book
  ts        timestamptz not null,                     -- the print's time, as served (microseconds)
  price     numeric not null check (price > 0),       -- the book's currency per coin
  size      numeric not null check (size > 0),        -- coins
  side      text not null check (side in ('buy', 'sell')),   -- the aggressor
  primary key (product, trade_id)
);

create table if not exists public.cb_touch (
  product    text not null check (product in ('USDC-GBP', 'USDT-GBP', 'USDC-EUR', 'USDT-EUR')),
  ts         timestamptz not null,                    -- the instant the reading arrived
  bid        numeric not null check (bid > 0),
  ask        numeric not null check (ask > 0),
  bid_size   numeric not null,
  ask_size   numeric not null,
  bid_orders integer,
  ask_orders integer,
  primary key (product, ts)
);

create table if not exists public.cb_rec_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz,
  last_error  text,
  last_report jsonb
);
insert into public.cb_rec_state (id, updated_at) values (1, now()) on conflict (id) do nothing;

create table if not exists public.cb_quote_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);

create table if not exists public.cb_quote_inputs (
  kind  text not null check (kind in ('fx:EURUSD')),
  t     timestamptz not null,                         -- the bar's start
  value numeric not null check (value > 0),
  primary key (kind, t)
);

create table if not exists public.cb_quote_events (
  book   text not null check (book in ('USDC-GBP', 'USDT-GBP', 'USDC-EUR', 'USDT-EUR')),
  minute timestamptz not null,
  side   text not null check (side in ('bid', 'ask', '-')),
  k      numeric not null,
  kind   text not null check (kind in ('order', 'refused', 'withdraw', 'fill', 'exit', 'stop')),
  ticks  integer,                                     -- the price in the book's price steps (0.0001; USDT-EUR 0.00001)
  detail jsonb not null default '{}'::jsonb,
  primary key (book, minute, side, k, kind)
);

create table if not exists public.cb_quote_trips (
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
create index if not exists cb_quote_trips_t_exit on public.cb_quote_trips (t_exit);

create table if not exists public.cb_quote_minutes (
  book      text not null check (book in ('USDC-GBP', 'USDT-GBP', 'USDC-EUR', 'USDT-EUR')),
  minute    timestamptz not null,
  x         numeric,                                  -- pounds per unit of the book's currency; null: dark
  x_t       timestamptz,                              -- the GBP/USD bar it came from
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

alter table public.cb_trades        enable row level security;
alter table public.cb_touch         enable row level security;
alter table public.cb_rec_state     enable row level security;
alter table public.cb_quote_state   enable row level security;
alter table public.cb_quote_inputs  enable row level security;
alter table public.cb_quote_events  enable row level security;
alter table public.cb_quote_trips   enable row level security;
alter table public.cb_quote_minutes enable row level security;

-- The paper test's DAYS, as PR5's (0070): orders are every order event, fills the entry fills, trips/won/realised the
-- round trips that CLOSED that day. security_invoker: as closed to the anon key as its tables.
create or replace view public.cb_quote_days with (security_invoker = true) as
with ev as (
  select (minute at time zone 'UTC')::date as day,
         count(*) filter (where kind = 'order') as orders,
         count(*) filter (where kind = 'fill') as fills
  from public.cb_quote_events
  where kind in ('order', 'fill')
  group by 1
), tr as (
  select (t_exit at time zone 'UTC')::date as day,
         count(*) as trips,
         count(*) filter (where pnl_gbp > 0) as won,
         sum(pnl_gbp) as realised_gbp
  from public.cb_quote_trips
  group by 1
)
select coalesce(ev.day, tr.day) as day,
       coalesce(ev.orders, 0) as orders,
       coalesce(ev.fills, 0) as fills,
       coalesce(tr.trips, 0) as trips,
       coalesce(tr.won, 0) as won,
       coalesce(tr.realised_gbp, 0) as realised_gbp
from ev full outer join tr on tr.day = ev.day;

insert into public.agent_locks (name) values ('cb-quotes') on conflict (name) do nothing;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=cbrec', 30000, 1, 23, true) on conflict (path) do nothing;

-- Daily: prints older than 10 days, touch rows older than 35, minute records older than 120. Events and trips are kept.
select cron.schedule(
  'cb-rec-prune',
  '53 10 * * *',
  $cron$
    delete from public.cb_trades where ts < now() - interval '10 days';
    delete from public.cb_touch where ts < now() - interval '35 days';
    delete from public.cb_quote_minutes where minute < now() - interval '120 days';
  $cron$
);
