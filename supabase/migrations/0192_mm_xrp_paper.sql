-- 0192: "Crypto quotes XRP/GBP", a real-time paper test of the XRP/GBP maker on Revolut X (agents/mm_core.ts, agents/mm_paper.ts;
-- pre-registered in docs/agents/reviews/2026-10-31-xrp-gbp-paper-prereg.md; the studies docs/agents/reviews/2026-10-31-crypto-books-deep.md,
-- reviews/2026-10-31-xrp-gbp-strategy.md and backtests/cryptobooks/scripts/final_opt.py and final_card.py; the design
-- reviews/2026-10-31-one-second-loop-architecture.md §4.4, paper as one call a minute replaying the closed minute second by second).
--
-- On whose word. Davies, 2026-10-31 ~11:55 UTC: "好 再研究下确保策略一切最优后就开做然后上testing" (one more pass to make sure the
-- strategy is the best it can be, then build it and put it on TESTING).
--
-- Every minute one call (`agents?action=mm`):
--   1. records, keyless: Binance's one-second XRPUSDT klines of the minutes closed since its last read (data-api.binance.vision,
--      the host binance.ts reads), Revolut X's UK XRP-GBP prints since a little before its newest (by id, so a print is kept
--      once), Revolut X's XRP-GBP book (five levels a side) and Coinbase's USDT-USD price, once each;
--   2. steps the rule (mm_core.ts, rule.py's port, pinned fill for fill by mm_core.test.ts) through every second of the
--      minutes from its last to two behind the clock, on those inputs and the FX recorder's GBP/USD (`fx_ticks`, 0172),
--      in three arms that differ only in money: £600 (£200 a quote; the one judged and the one on the page), £120 and £1,200.
-- It holds no key, places nothing and reads nothing of LIVE.
--
-- Its own tables (`agent_mm_*`), lease (`mm`), call (a row of `edge_calls` under the watchdog, its beat first, as every agents
-- action's) and prune.
--
-- Its second, 12 (0191's table: 0 3 5 7 9 11 13 15 17 20 23 are taken). It reads Revolut X's public endpoints, one token a
-- second an address (reference §2): PR5's live executor reads them from :25 (`QUOTES_START_MS`), the twins from :38 and the books
-- recorder from :40 to :56, and the tick at the top of the minute; at :12 none of those is reading. Its two Revolut X reads go
-- 1.1 s apart. Timeout 30 s: 12 s + 30 s ends inside the minute (`edge_calls_within_minute`). It decides minutes two behind the
-- clock, so a print the venue publishes late is in before its minute is stepped.
--
-- `retry` true: a second run in its minute changes nothing the first did (a lease; prints and klines upserted on their keys;
-- each arm's state carries its last minute and is saved after its rows, every row upserted on its natural key); under a minute;
-- its row waits 15 minutes for the function (0104).
--
-- The prune keeps what the 28-day reading needs and more: the prints 120 days, the inputs (one row a minute, about 1 KB) 45 days.
-- The minutes, fills and trips stay (three arms' minutes are about 4,300 rows a day): the days view marks each day from the
-- minute before it, back to the arm's first.
--
-- What it leaves alone: every recorder, LIVE and every executor and their configs, every twin and arm. No grant and no policy:
-- row level security is on, and 0082's default privileges keep `anon` and `authenticated` out.

-- One row a minute of the book: Binance's last XRPUSDT trade of each of its 60 seconds (null where a second was not served),
-- and, in the minute it was read, Revolut X's book (five levels a side, [price, coins]) and Coinbase's USDT-USD price.
create table if not exists public.agent_mm_inputs (
  book     text not null check (book in ('XRP-GBP')),
  minute   timestamptz not null,
  bn       double precision[],
  usdt     numeric,
  usdt_at  timestamptz,
  bids     jsonb,
  asks     jsonb,
  book_at  timestamptz,
  primary key (book, minute)
);

-- Revolut X's UK prints of the book, each once by the venue's id; `side` the taker's.
create table if not exists public.agent_mm_prints (
  book  text not null check (book in ('XRP-GBP')),
  id    text not null,
  ts    timestamptz not null,
  price numeric not null check (price > 0),
  qty   numeric not null check (qty > 0),
  side  text not null check (side in ('buy', 'sell')),
  primary key (book, id)
);
create index if not exists agent_mm_prints_ts on public.agent_mm_prints (book, ts);

-- The recorder's cursors (`rec`) and each arm's engine state (`p600`, `p120`, `p1200`).
create table if not exists public.agent_mm_state (
  arm         text primary key check (arm in ('rec', 'p600', 'p120', 'p1200')),
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);

-- Each arm's minute: the fair it knew at the minute's end, the basis, the two rates, its two quotes (null when a side was off),
-- its pounds, coin and the coin's cost (first in, first out), its equity marked at the fair, and the minute's placements,
-- cancels, fills and stale seconds.
create table if not exists public.agent_mm_minutes (
  arm       text not null check (arm in ('p600', 'p120', 'p1200')),
  minute    timestamptz not null,
  fair      numeric,
  basis_bps numeric,
  usdt      numeric,
  gbpusd    numeric,
  bid       numeric,
  ask       numeric,
  cash      numeric not null,
  coin      numeric not null,
  cost      numeric not null,
  equity    numeric not null,
  placed    integer not null,
  cancels   integer not null,
  fills     integer not null,
  stale_s   integer not null,
  primary key (arm, minute)
);

-- Each fill: its second, its order in that second, our side, how (a public taker order, the arbitrageur, the stop), coins, price
-- and the true fair of the second.
create table if not exists public.agent_mm_fills (
  arm   text not null check (arm in ('p600', 'p120', 'p1200')),
  ts    timestamptz not null,
  seq   integer not null,
  side  text not null check (side in ('bid', 'ask')),
  kind  text not null check (kind in ('taker', 'arb', 'stop')),
  qty   numeric not null check (qty > 0),
  price numeric not null check (price > 0),
  fair  numeric,
  primary key (arm, ts, seq)
);

-- Each sale and the coin it sold, first in, first out: when the first of that coin was bought, the coins, the average buying
-- price, the selling price, the taker fee (a stop's), and the P&L.
create table if not exists public.agent_mm_trips (
  arm     text not null check (arm in ('p600', 'p120', 'p1200')),
  t_exit  timestamptz not null,
  seq     integer not null,
  t_entry timestamptz not null,
  qty     numeric not null check (qty > 0),
  entry   numeric not null check (entry > 0),
  exit    numeric not null check (exit > 0),
  fee_gbp numeric not null,
  pnl_gbp numeric not null,
  how     text not null check (how in ('maker', 'arb', 'stop')),
  primary key (arm, t_exit, seq)
);
create index if not exists agent_mm_trips_t_exit on public.agent_mm_trips (t_exit);

alter table public.agent_mm_inputs  enable row level security;
alter table public.agent_mm_prints  enable row level security;
alter table public.agent_mm_state   enable row level security;
alter table public.agent_mm_minutes enable row level security;
alter table public.agent_mm_fills   enable row level security;
alter table public.agent_mm_trips   enable row level security;

-- An arm's UTC day: placements, fills, stale seconds, the P&L marked at the fair (the equity's change over the day, from the
-- arm's capital before its first minute: what the pre-registration's bar reads), and the round trips closed, won and realised.
create or replace view public.agent_mm_days with (security_invoker = true) as
with mi as (
  select arm, (minute at time zone 'UTC')::date as day,
         equity - coalesce(lag(equity) over (partition by arm order by minute),
                           case arm when 'p600' then 600 when 'p120' then 120 else 1200 end) as d_eq,
         placed, fills, stale_s
  from public.agent_mm_minutes
), md as (
  select arm, day, sum(placed) as orders, sum(fills) as fills, sum(stale_s) as stale_s, sum(d_eq) as pnl_gbp
  from mi
  group by 1, 2
), tr as (
  select arm, (t_exit at time zone 'UTC')::date as day,
         count(*) as trips,
         count(*) filter (where pnl_gbp > 0) as won,
         sum(pnl_gbp) as realised_gbp
  from public.agent_mm_trips
  group by 1, 2
)
select coalesce(md.arm, tr.arm) as arm,
       coalesce(md.day, tr.day) as day,
       coalesce(md.orders, 0) as orders,
       coalesce(md.fills, 0) as fills,
       coalesce(md.stale_s, 0) as stale_s,
       coalesce(md.pnl_gbp, 0) as pnl_gbp,
       coalesce(tr.trips, 0) as trips,
       coalesce(tr.won, 0) as won,
       coalesce(tr.realised_gbp, 0) as realised_gbp
from md full outer join tr on tr.arm = md.arm and tr.day = md.day;

insert into public.agent_locks (name) values ('mm') on conflict (name) do nothing;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=mm', 30000, 1, 23, true) on conflict (path) do nothing;
update public.edge_calls set offset_s = 12 where path in ('agents?action=mm');

select cron.schedule(
  'mm-prune',
  '43 11 * * *',
  $cron$delete from public.agent_mm_inputs where minute < now() - interval '45 days';
        delete from public.agent_mm_prints where ts < now() - interval '120 days';$cron$
);
