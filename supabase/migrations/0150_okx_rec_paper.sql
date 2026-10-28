-- 0150: OKX's recorder and its two paper twins, "Stablecoin quotes OKX USDG" and "Stablecoin quotes OKX EURC" (okx_rec.ts,
-- okx_quotes.ts; docs/agents/reviews/2026-10-27-okx-paper-prereg.md, frozen with this file).
--
-- On whose word. Davies, 2026-10-27, on OTHERVENUES (docs/agents/reviews/2026-10-27-other-coins-venues.md): "我已经有okx在英国的
-- 账户了，okx的这两个策略在这个账户上可以做吗？可以的话就加盘口记录器和开testings策略（目前live的rules？）" (he has a UK OKX account; can the
-- two strategies run on it? If so, add the book recorder and start the testing strategies, on LIVE's rules).
--
-- 1. The recorder: every print of USDG-EUR and EURC-USDC by trade id (`okx_trades`, kept 400 days: about 300 prints a day
--    together) and their best five levels a side each minute (`okx_books`, kept 60 days), from OKX's public market data; its
--    state row (`okx_rec_state`).
-- 2. The paper twins: PR5's rule as LIVE carries it out, one call with the recorder (`agents?action=okxrec`), its own tables
--    (`okx_quote_*`, the Coinbase arms' shapes with a quote-currency P&L column and the minute's guard) and lease (`okx-quotes`).
--    An empty record starts at the first 00:00 UTC after its first run.
--
-- `retry` true: a second run in its minute stores nothing twice (every print and book read upserted on its key; a second book
-- read in a minute is a second row of that minute, harmless), and the paper twins hold a lease and decide only what the
-- recorder's coverage says is complete; under a minute; its row waits 15 minutes for the function (0104).
--
-- What it leaves alone: every other recorder, twin and paper test, LIVE and its config, and every frozen file. No grant and no
-- policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` out.

create table if not exists public.okx_trades (
  book     text not null check (book in ('USDG-EUR', 'EURC-USDC')),
  trade_id bigint not null check (trade_id > 0),
  ts       timestamptz not null,
  price    numeric not null check (price > 0),
  size     numeric not null check (size > 0),
  side     text not null check (side in ('buy', 'sell')),
  primary key (book, trade_id)
);
create index if not exists okx_trades_book_ts on public.okx_trades (book, ts);

create table if not exists public.okx_books (
  book     text not null check (book in ('USDG-EUR', 'EURC-USDC')),
  ts       timestamptz not null,
  bid      numeric not null check (bid > 0),
  ask      numeric not null check (ask > 0),
  bid_size numeric not null,
  ask_size numeric not null,
  levels   jsonb not null default '{}'::jsonb,
  primary key (book, ts)
);

create table if not exists public.okx_rec_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  last_error  text,
  last_report jsonb
);

create table if not exists public.okx_quote_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);

create table if not exists public.okx_quote_events (
  book   text not null check (book in ('USDG-EUR', 'EURC-USDC')),
  minute timestamptz not null,
  side   text not null check (side in ('bid', 'ask', '-')),
  k      numeric not null,
  kind   text not null check (kind in ('order', 'refused', 'withdraw', 'fill', 'exit', 'stop')),
  ticks  integer,
  detail jsonb not null default '{}'::jsonb,
  primary key (book, minute, side, k, kind)
);

create table if not exists public.okx_quote_trips (
  book          text not null check (book in ('USDG-EUR', 'EURC-USDC')),
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
create index if not exists okx_quote_trips_t_exit on public.okx_quote_trips (t_exit);

create table if not exists public.okx_quote_minutes (
  book          text not null check (book in ('USDG-EUR', 'EURC-USDC')),
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
  primary key (book, minute)
);

alter table public.okx_trades        enable row level security;
alter table public.okx_books         enable row level security;
alter table public.okx_rec_state     enable row level security;
alter table public.okx_quote_state   enable row level security;
alter table public.okx_quote_events  enable row level security;
alter table public.okx_quote_trips   enable row level security;
alter table public.okx_quote_minutes enable row level security;

create or replace view public.okx_quote_days with (security_invoker = true) as
with ev as (
  select book, (minute at time zone 'UTC')::date as day,
         count(*) filter (where kind = 'order') as orders,
         count(*) filter (where kind = 'fill') as fills
  from public.okx_quote_events
  where kind in ('order', 'fill')
  group by 1, 2
), tr as (
  select book, (t_exit at time zone 'UTC')::date as day,
         count(*) as trips,
         count(*) filter (where pnl_gbp > 0) as won,
         sum(pnl_gbp) as realised_gbp
  from public.okx_quote_trips
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

insert into public.agent_locks (name) values ('okx-quotes') on conflict (name) do nothing;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=okxrec', 30000, 1, 23, true) on conflict (path) do nothing;

select cron.schedule(
  'okx-prune',
  '59 10 * * *',
  $cron$
    delete from public.okx_trades where ts < now() - interval '400 days';
    delete from public.okx_books where ts < now() - interval '60 days';
    delete from public.okx_quote_minutes where minute < now() - interval '120 days';
  $cron$
);
