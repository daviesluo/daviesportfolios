-- 0110: CoinJar UK's GBP stablecoin books, recorded keyless for CJ5's paper test (`agents/cj_rec.ts`; reference §4 item 57).
--
-- On whose word. Davies, 2026-10-09, on the stat-arb search (docs/agents/reviews/2026-10-09-stat-arb-search.md, CJ5 second
-- of its ranking: PR5's rule on CoinJar UK's USDC/GBP and USDT/GBP at 0.00 % maker): "建起来" — build the keyless recorder
-- first. It needs no account and no key: CoinJar's Data API is public and GET only. Nothing here trades or can.
--
-- What it keeps, each minute, of USDCGBP and USDTGBP:
--   cj_trades   every print once, by CoinJar's trade id (`tid`), as served: price, size, value (in the quote currency),
--               taker side (buy, sell, or auction for a print of one of its auctions) and the print's time to the
--               microsecond. Read forward from the newest stored print's second (`?after=`, inclusive, a thousand a page);
--               an empty table starts at 2026-09-01 00:00 UTC from CoinJar's own history, which the endpoint pages back
--               to each book's first print (the search took the newest 500 for all there was).
--   cj_book     each book's levels within 40 bps of its mid (the best always, 25 a side at most), a row when they change;
--               an unchanged reading extends the row (`seen_until`, `reads`), as `agent_book_levels` (0057, 0058).
--   cj_rec_state one row: the fault last reported to `ops_errors` (`agents.cj_rec`, at most hourly while it lasts), the
--               minute's errors and its report.
--
-- Its size (measured 2026-10-09). Prints from 2026-09-01: USDC/GBP 59 a day, USDT/GBP 32; about 175 bytes a print with
-- both indexes: about 16 KB a day, 6 MB a year, kept (CoinJar keeps them too). Both books changed from every reading to
-- the next in ten readings a minute apart (18:26–18:35 UTC): 2,880 rows a day, about 830 and 450 bytes (17–20 and 10–13
-- levels; jsonb ~35 bytes a level, measured with pg_column_size), about 1.8 MB a day; kept 35 days as Revolut X's books
-- are (four weeks and a week to read them), about 65 MB at most. The database was 1.29 GB the same day.
--
-- The row. Every minute, all day. 30 s at most, under the minute like every row (0099): a minute is four requests (a
-- page more a book while it catches up) to a data host that is not rate limited, each waiting 8 s at most, and none
-- starts past 18 s into the run. Run again by the watchdog when its worker never started (`retry`): a second run in a
-- minute inserts only prints not stored (by `tid`) and stores the book only if it changed since the first run read it,
-- so it changes nothing the first run did. Its beat
-- is the `agents` function's, written before its work (`beatKeyOfRequest("agents", req.url)`, `serveRequest`). Like
-- every row since 0104 it waits 15 minutes (`active_from`'s default) for the function's deploy.
--
-- Not among the monitor's health readings (`monitor/health.ts`): those say whether the trading loop is alive, and a
-- research recorder that stops trades nothing; its faults go to the errors box, and the watchdog reruns a call that
-- never started.
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` from
-- the new tables. Only the service role (the function) and postgres (the prune) touch them.
--
-- ⚠️  As 0075: the job's URL is the PRODUCTION project's Edge host, so this row makes any database it is applied to call
-- production.

create table if not exists public.cj_trades (
  product     text not null check (product in ('USDCGBP', 'USDTGBP')),
  tid         bigint not null check (tid > 0),       -- CoinJar's trade id, one sequence across its books
  ts          timestamptz not null,                  -- the print's time, as served (microseconds)
  price       numeric not null check (price > 0),    -- quote currency per coin: GBP per USDC / USDT
  size        numeric not null check (size > 0),     -- coins
  value       numeric not null check (value >= 0),   -- quote currency, as served (price × size to about a penny)
  taker_side  text not null check (taker_side in ('buy', 'sell', 'auction')),
  recorded_at timestamptz not null default now(),
  primary key (product, tid)
);
create index if not exists cj_trades_product_ts on public.cj_trades (product, ts);

create table if not exists public.cj_book (
  product    text not null check (product in ('USDCGBP', 'USDTGBP')),
  ts         timestamptz not null,                   -- when this book was first read: the instant the reading arrived
  seen_until timestamptz not null,                   -- the last reading that found the same book
  reads      integer not null default 1 check (reads >= 1),
  bids       jsonb not null,                         -- [[price, size], …], best first, within 40 bps of the mid
  asks       jsonb not null,
  primary key (product, ts)
);

create table if not exists public.cj_rec_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz,
  last_error  text,
  last_report jsonb
);
insert into public.cj_rec_state (id, updated_at) values (1, now()) on conflict (id) do nothing;

alter table public.cj_trades    enable row level security;
alter table public.cj_book      enable row level security;
alter table public.cj_rec_state enable row level security;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=cjrec', 30000, 1, 23, true) on conflict (path) do nothing;

-- Daily: the books' 35 days. Prints are kept.
select cron.schedule(
  'cj-rec-prune',
  '47 10 * * *',
  $cron$ delete from public.cj_book where ts < now() - interval '35 days'; $cron$
);
