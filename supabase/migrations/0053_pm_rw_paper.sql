-- 0053: the paper test of RW (reference §3.33; spec docs/agents/reviews/2026-09-24-polymarket-rw-paper-spec.md).
--
-- RW — minimum-size two-sided quotes for Polymarket's liquidity rewards — passed all six of its pre-registered
-- conditions forward, on 268 recorded minutes of one day (+$46.61 on $480). Davies (2026-09-24): run it on paper.
-- This is that run: fourteen days from 2026-09-25 00:00 UTC, the portfolio re-selected each UTC day, every input a
-- keyless public read. Nothing here is an order, no key is read, and nothing of the strategy rows or the stablecoin
-- quotes reads these tables. `agents?action=pmrw-select` picks the day's portfolio; `agents?action=pmrw` records each
-- minute's books and decides each minute two minutes later, from the cron jobs below.
--
-- It stores every input beside every conclusion — each minute's book as the rule reads it, each print, each day's
-- selection — so the frozen rule (docs/agents/backtests/polymarket/scripts/rw_test.py) can be run over the fourteen
-- days and say whether the engine ran the rule that was tested. Polymarket keeps neither the books nor our quotes.

create table if not exists public.pm_rw_state (
  id          integer primary key check (id = 1),
  -- Every market's running account (inventory, cash, rewards, marks), the markets' parameters, the last minute
  -- decided, and the UTC day being accumulated.
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,                    -- the last minute decided (two minutes behind the clock)
  updated_at  timestamptz not null default now(),
  last_error  text
);

-- One UTC day's portfolio: whole markets by RW's first-round reward per dollar, until $300 of capital.
create table if not exists public.pm_rw_selection (
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

-- Each minute's book of each market quoted or held, as the rule reads it (rw_inputs.py's row), and the minute's
-- decision once it is taken: our bid and ask, our score, the others' score and the reward.
create table if not exists public.pm_rw_minutes (
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
create index if not exists pm_rw_minutes_minute on public.pm_rw_minutes (minute, cond);

-- Every taker print of every quoted market while it was quoted: what a fill is proven by.
create table if not exists public.pm_rw_prints (
  id    text primary key,                      -- transaction, wallet, token, side, price, size and second
  cond  text not null,
  ts    timestamptz not null,
  side  text not null check (side in ('BUY', 'SELL')),
  oi    integer not null,                      -- the outcome index: 0 YES, 1 NO
  price numeric not null check (price >= 0 and price <= 1),
  size  numeric not null check (size > 0)
);
create index if not exists pm_rw_prints_cond_ts on public.pm_rw_prints (cond, ts);

-- Every paper fill, with the print that proved it.
create table if not exists public.pm_rw_fills (
  cond     text not null,
  minute   timestamptz not null,               -- the minute whose quote it filled
  ts       timestamptz not null,
  side     text not null check (side in ('bid', 'ask')),
  price    numeric not null check (price > 0 and price < 1),
  size     numeric not null check (size > 0),
  print_id text not null,
  primary key (cond, minute, print_id)
);

-- The running totals as each UTC day ended: the spec's day totals are the differences.
create table if not exists public.pm_rw_days (
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
create table if not exists public.pm_rw_settlements (
  cond        text primary key,
  closed_time text,
  payout      numeric not null check (payout >= 0 and payout <= 1),
  net         numeric not null,
  cash        numeric not null,
  settled_at  timestamptz not null default now()
);

alter table public.pm_rw_state       enable row level security;
alter table public.pm_rw_selection   enable row level security;
alter table public.pm_rw_minutes     enable row level security;
alter table public.pm_rw_prints      enable row level security;
alter table public.pm_rw_fills       enable row level security;
alter table public.pm_rw_days        enable row level security;
alter table public.pm_rw_settlements enable row level security;

insert into public.agent_locks (name) values ('pmrw'), ('pmrw-select') on conflict (name) do nothing;

-- Every minute: record this minute's books, decide the minute two minutes back.
select cron.schedule(
  'agents-pmrw-every-minute',
  '* * * * *',
  $cron$
    select net.http_post(
      url     := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/agents?action=pmrw',
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

-- The day's portfolio: every five minutes, and a day already selected is skipped, so a day is selected in its first
-- minutes and a failed selection is tried again five minutes later. Until it lands, the day quotes nothing.
select cron.schedule(
  'agents-pmrw-select',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url     := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/agents?action=pmrw-select',
      headers := jsonb_build_object(
        'Authorization',
        concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 290000
    );
  $cron$
);
