-- 0051: the paper test of PR5's quotes (reference §3.27, §4 item 31).
--
-- PR5 re-tested PR3's rule — 0 % resting quotes 0.1 / 0.2 / 0.3 % either
-- side of interbank on Revolut X's USDC/GBP and USDT/GBP books — on every
-- public print of the nine months PR3 never saw, and it passed all six
-- pre-registered conditions. It also found that the books tightened in the
-- week of 2026-08-24 (the gap between buy and sell prints fell from 11–52
-- bps to 3–5), and since then the rule earns about $0.42 a day on the
-- $1,200 its quotes lock. Davies: if it passes, run it on paper. This is
-- that run: four weeks, paper only, measured against the frozen simulator.
--
-- It is a notebook, like the maker probes (`0042`). Nothing here is an
-- order: the loop never calls a venue's order endpoints for it, never
-- writes `agent_orders`, and no position, exposure, cap or P&L of the
-- strategy rows reads these tables. `agents?action=quotes` runs it, from
-- its own cron job below, so the trading tick's minute is untouched.
--
-- What is stored is every INPUT beside every conclusion — each print, each
-- GBP/USD minute, each USD-book hour — so the frozen simulator
-- (docs/agents/scripts/pr5/pr5_sim.py) can replay the four weeks and say
-- whether the loop ran the rule that was tested. The venue keeps its
-- minute candles 28 days; these tables are the record.

create table if not exists public.agent_quote_state (
  id          integer primary key check (id = 1),
  -- The engine's whole state: each book's six rungs (idle / quote /
  -- position, the working order, the position), the last print, the last
  -- GBP/USD, and how far the prints have been read.
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,                    -- the last minute fully decided (the engine runs one minute behind)
  updated_at  timestamptz not null default now(),
  last_error  text
);

-- Every UK print of the two books, from the venue's public trade history.
create table if not exists public.agent_quote_prints (
  id    text primary key,                     -- the venue's print id
  book  text not null check (book in ('USDC-GBP', 'USDT-GBP')),
  ts    timestamptz not null,
  price numeric not null check (price > 0),
  qty   numeric not null check (qty > 0),
  side  text not null check (side in ('buy', 'sell'))   -- the aggressor
);
create index if not exists agent_quote_prints_book_ts on public.agent_quote_prints (book, ts);

-- The two series fair value is built from: GBP/USD minute closes (Yahoo
-- GBPUSD=X) and the USD books' UK hourly closes.
create table if not exists public.agent_quote_inputs (
  kind  text not null check (kind in ('fx', 'fair:USDC-USD', 'fair:USDT-USD')),
  t     timestamptz not null,                 -- the bar's start
  value numeric not null check (value > 0),
  primary key (kind, t)
);

-- The order log: every placement, re-price, re-placement, refusal,
-- withdrawal, fill, exit and stop, and the order book a going-live order
-- met (`book`: the evidence of whether a post-only order was acceptable).
create table if not exists public.agent_quote_events (
  book   text not null check (book in ('USDC-GBP', 'USDT-GBP')),
  minute timestamptz not null,
  side   text not null check (side in ('bid', 'ask', '-')),
  k      numeric not null,                    -- 0.001 / 0.002 / 0.003; 0 for a book-wide row
  kind   text not null check (kind in ('order', 'refused', 'withdraw', 'fill', 'exit', 'stop', 'book')),
  ticks  integer,                             -- the price in 0.0001 GBP
  detail jsonb not null default '{}'::jsonb,
  primary key (book, minute, side, k, kind)
);

-- One row per round trip, with the print that proved each side of it.
create table if not exists public.agent_quote_trips (
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
  primary key (book, side, k, t_entry)
);

alter table public.agent_quote_state  enable row level security;
alter table public.agent_quote_prints enable row level security;
alter table public.agent_quote_inputs enable row level security;
alter table public.agent_quote_events enable row level security;
alter table public.agent_quote_trips  enable row level security;

insert into public.agent_locks (name) values ('quotes') on conflict (name) do nothing;

-- Its own minute, beside the tick's. The action waits until 25 s into the
-- minute before reading Revolut X, so its public reads (about three a
-- minute) do not land on the tick's.
select cron.schedule(
  'agents-quotes-every-minute',
  '* * * * *',
  $cron$
    select net.http_post(
      url     := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/agents?action=quotes',
      headers := jsonb_build_object(
        'Authorization',
        concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 58000
    );
  $cron$
);
