-- 0184: "Stablecoin quotes RX↔Coinbase hedge" and "… - 1", a real-time paper test in two arms (agents/xhedge.ts;
-- docs/agents/reviews/2026-10-30-xhedge-prereg.md; the studies docs/agents/reviews/2026-10-30-revx-mm-competition.md and
-- docs/agents/reviews/2026-10-30-mmcomp-2.md, their strategy A, and backtests/mmcomp/scripts/xhedge_a2.py).
--
-- On whose word. Davies, 2026-10-30: "怎么实现自动化？如果真的可以实现的话就做成实时纸面测试加到testing里，然后解释下不调仓的话怎么运行的？"
-- (how is it automated? if it really can be, make it a real-time paper test on TESTING, and explain how it runs without
-- rebalancing), then "A 策略可以单独做吗还是只能做像你刚才说的和做市商抢生意的那个做法？" (can A be done on its own, or only by competing
-- with the maker?): two arms side by side, differing only in where the Revolut X order rests.
--
-- Every minute, each arm, on USDT-GBP and USDC-GBP, each on its own two simulated accounts (Revolut X and Coinbase, £600 each,
-- half pounds and half coin): a quote on Revolut X's recorded book, one tick inside the other maker (arm `inside`) or 10 bps from
-- Coinbase's mid and never better than Revolut X's own touch (arm `behind`), capped by Coinbase's recorded touch ± 2 bps, on a
-- side whose two legs can carry a fill; a fill by a recorded Revolut X print; its hedge a Coinbase taker at the first Coinbase
-- read 30 s or more later, 0.45 bps. No transfer between the venues, ever: a side short of inventory stops quoting until the
-- other side's fills bring it back, and the minutes it is off are recorded.
--
-- Its own tables (`agent_xhedge_*`), lease (`xhedge`), call (`agents?action=xhedge`, a row of `edge_calls` under the watchdog,
-- its beat first, as every agents action's) and prune. It reads Revolut X's recorded book (`agent_book_levels`), its stored prints
-- (`agent_quote_prints`, PR5's engine's) and Coinbase's recorded touch (`cb_touch`); it calls no venue and holds no key.
--
-- `retry` true: a second run in its minute changes nothing the first did (a lease, the state's last minute, every row upserted
-- on its natural key, the state saved after them); under a minute; its row waits 15 minutes for the function (0104).
--
-- What it leaves alone: every recorder, LIVE and every executor and their configs, every twin and arm. No grant and no policy:
-- row level security is on, and 0082's default privileges keep `anon` and `authenticated` out.

create table if not exists public.agent_xhedge_state (
  arm         text primary key check (arm in ('inside', 'behind')),
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);

-- Each arm's and book's minute: the books it read, its two prices (null when the side was off), why a side was off, the placements and fills
-- of the minute, and the four balances after it (coins in coins, pounds in pounds).
create table if not exists public.agent_xhedge_minutes (
  arm       text not null check (arm in ('inside', 'behind')),
  book      text not null check (book in ('USDT-GBP', 'USDC-GBP')),
  minute    timestamptz not null,
  rx_bid    numeric,
  rx_ask    numeric,
  cb_bid    numeric,
  cb_ask    numeric,
  cb_age_s  integer,
  our_bid   numeric,
  our_ask   numeric,
  bid_block text check (bid_block in ('rx-gbp', 'cb-coin', 'rx-stale', 'cb-stale', 'order-cap')),
  ask_block text check (ask_block in ('rx-coin', 'cb-gbp', 'rx-stale', 'cb-stale', 'order-cap')),
  orders    integer not null,
  fills     integer not null,
  rx_gbp    numeric not null,
  rx_coin   numeric not null,
  cb_gbp    numeric not null,
  cb_coin   numeric not null,
  primary key (arm, book, minute)
);

-- Each Revolut X fill: the print that filled it, our price, the coins, and whether we were strictly inside the best level.
create table if not exists public.agent_xhedge_fills (
  arm      text not null check (arm in ('inside', 'behind')),
  book     text not null check (book in ('USDT-GBP', 'USDC-GBP')),
  print_id text not null,
  ts       timestamptz not null,
  side     text not null check (side in ('bid', 'ask')),
  price    numeric not null check (price > 0),
  qty      numeric not null check (qty > 0),
  inside   boolean not null,
  primary key (arm, book, print_id)
);

-- Each round trip: Revolut X's fill(s) and the Coinbase hedge that closed them.
create table if not exists public.agent_xhedge_trips (
  arm      text not null check (arm in ('inside', 'behind')),
  book     text not null check (book in ('USDT-GBP', 'USDC-GBP')),
  side     text not null check (side in ('bid', 'ask')),
  t_fill   timestamptz not null,
  t_hedge  timestamptz not null,
  qty      numeric not null check (qty > 0),
  rx_price numeric not null check (rx_price > 0),
  cb_price numeric not null check (cb_price > 0),
  fee_gbp  numeric not null,
  pnl_gbp  numeric not null,
  fills    integer not null,
  primary key (arm, book, side, t_fill, t_hedge)
);
create index if not exists agent_xhedge_trips_t_hedge on public.agent_xhedge_trips (t_hedge);

alter table public.agent_xhedge_state   enable row level security;
alter table public.agent_xhedge_minutes enable row level security;
alter table public.agent_xhedge_fills   enable row level security;
alter table public.agent_xhedge_trips   enable row level security;

-- An arm's book's UTC day: placements and fills, round trips, won, realised, and the minutes each side was off for want of inventory.
create or replace view public.agent_xhedge_days with (security_invoker = true) as
with mi as (
  select arm, book, (minute at time zone 'UTC')::date as day,
         sum(orders) as orders, sum(fills) as fills,
         count(*) filter (where bid_block in ('rx-gbp', 'cb-coin')) as bid_blocked,
         count(*) filter (where ask_block in ('rx-coin', 'cb-gbp')) as ask_blocked
  from public.agent_xhedge_minutes
  group by 1, 2, 3
), tr as (
  select arm, book, (t_hedge at time zone 'UTC')::date as day,
         count(*) as trips,
         count(*) filter (where pnl_gbp > 0) as won,
         sum(pnl_gbp) as realised_gbp
  from public.agent_xhedge_trips
  group by 1, 2, 3
)
select coalesce(mi.arm, tr.arm) as arm,
       coalesce(mi.book, tr.book) as book,
       coalesce(mi.day, tr.day) as day,
       coalesce(mi.orders, 0) as orders,
       coalesce(mi.fills, 0) as fills,
       coalesce(tr.trips, 0) as trips,
       coalesce(tr.won, 0) as won,
       coalesce(tr.realised_gbp, 0) as realised_gbp,
       coalesce(mi.bid_blocked, 0) as bid_blocked,
       coalesce(mi.ask_blocked, 0) as ask_blocked
from mi full outer join tr on tr.arm = mi.arm and tr.book = mi.book and tr.day = mi.day;

insert into public.agent_locks (name) values ('xhedge') on conflict (name) do nothing;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=xhedge', 30000, 1, 23, true) on conflict (path) do nothing;

select cron.schedule(
  'xhedge-prune',
  '37 11 * * *',
  $cron$delete from public.agent_xhedge_minutes where minute < now() - interval '120 days';$cron$
);
