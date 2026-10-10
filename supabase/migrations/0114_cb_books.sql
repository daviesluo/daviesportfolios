-- 0114: Coinbase's four GBP and EUR stablecoin order books, their top ten levels a side recorded keyless once a minute and
-- stored when they change (`agents/cb_books.ts`, `agents?action=cbbooks`).
--
-- On whose word. Davies, 2026-10-10: "Coinbase的订单簿要不要像 Revolut X 一样也记录上用来inform策略" — record Coinbase's books
-- as Revolut X's are (0057, `agent_book_levels`). It needs no account and no key: `GET /products/{id}/book?level=2` is
-- Coinbase Exchange's public market data. Nothing here trades or can.
--
-- What it is for: a queue model of the Coinbase books (the same use as Revolut X's QUEUE study), pre-registered before
-- any of it is read, and where a rung sits and how deep the book is behind it. Nothing in the frozen Coinbase paper test
-- (0112, docs/agents/reviews/2026-10-10-coinbase-paper-prereg.md) reads it, and this file changes nothing of 0112's.
--
--   cb_book_levels  a row per book and reading that differs from the book's last row: the ten best levels a side as
--                   three arrays (prices in the book's price steps, sizes in hundredths of a coin, order counts), best
--                   first; Coinbase's sequence and time for what it served; `seen_until` and `reads` extended while
--                   readings find the same levels.
--   cb_book_state   one row: the fault last reported to `ops_errors` (`agents.cb_books`, at most hourly while it lasts),
--                   the minute's errors and its report.
--
-- Its size: 524 bytes a row, about 560 with its key (`pg_column_size` of the fixture's books on the production database,
-- 2026-10-10); all four books changed between two readings a minute apart, so about 5,760 rows and 3.2 MB a day, kept 35
-- days as the CoinJar books and Coinbase's touch are: about 113 MB. The database was 1,312 MB on 2026-10-10.
--
-- The row. Every minute, all day, 58 s as the Revolut X books' row: the call waits until 30 s into the minute, after the
-- recorder's reads (from :00, none starting past 15 s, each 8 s at most), then reads the four books 250 ms apart, none
-- starting past 12 s, each 4 s at most. Coinbase serves public data at 10 requests a second per IP; with the recorder's
-- eight a minute (28 in a burst) the minute is 12 requests (32 at most), never more than four in a second from this
-- call, and it stops at a 429. Run again by the watchdog when its worker never started (`retry`): a second run stores
-- another reading or extends the last, and changes nothing else. Its beat is the `agents` function's, written before its
-- work. Like every row since 0104 it waits 15 minutes (`active_from`'s default) for the function's deploy.
--
-- Not among the monitor's health readings (`monitor/health.ts`), as neither Coinbase recorder is: a research recorder
-- that stops trades nothing; its faults go to the errors box.
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` from
-- the new tables. Only the service role (the function) and postgres (the prune) touch them.
--
-- ⚠️  As 0075: the job's URL is the PRODUCTION project's Edge host, so this row makes any database it is applied to call
-- production.

create table if not exists public.cb_book_levels (
  product    text not null check (product in ('USDC-GBP', 'USDT-GBP', 'USDC-EUR', 'USDT-EUR')),
  ts         timestamptz not null,                    -- the instant the reading arrived
  seq        bigint,                                  -- Coinbase's `sequence` for the book served
  book_ts    timestamptz,                             -- Coinbase's `time` for the book served (its CDN keeps a book 2 s)
  bid_px     integer[] not null,                      -- best first, in the book's price steps
  bid_sz     bigint[] not null,                       -- hundredths of a coin
  bid_n      integer[] not null,                      -- orders at the level
  ask_px     integer[] not null,
  ask_sz     bigint[] not null,
  ask_n      integer[] not null,
  seen_until timestamptz not null,                    -- the last reading that found these levels
  reads      integer not null default 1 check (reads >= 1),
  primary key (product, ts),
  check (cardinality(bid_px) <= 10 and cardinality(bid_sz) = cardinality(bid_px) and cardinality(bid_n) = cardinality(bid_px)),
  check (cardinality(ask_px) <= 10 and cardinality(ask_sz) = cardinality(ask_px) and cardinality(ask_n) = cardinality(ask_px))
);

comment on column public.cb_book_levels.bid_px is 'Price steps: 0.0001 of the quote currency (USDT-EUR 0.00001), Coinbase''s quote_increment on 2026-10-10.';
comment on column public.cb_book_levels.ask_px is 'Price steps: 0.0001 of the quote currency (USDT-EUR 0.00001), Coinbase''s quote_increment on 2026-10-10.';
comment on column public.cb_book_levels.bid_sz is 'Hundredths of a coin (Coinbase''s base_increment, 0.01).';
comment on column public.cb_book_levels.ask_sz is 'Hundredths of a coin (Coinbase''s base_increment, 0.01).';

create table if not exists public.cb_book_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz,
  last_error  text,
  last_report jsonb
);
insert into public.cb_book_state (id, updated_at) values (1, now()) on conflict (id) do nothing;

alter table public.cb_book_levels enable row level security;
alter table public.cb_book_state  enable row level security;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=cbbooks', 58000, 1, 23, true) on conflict (path) do nothing;

-- Daily: book rows older than 35 days.
select cron.schedule(
  'cb-books-prune',
  '57 10 * * *',
  $cron$delete from public.cb_book_levels where ts < now() - interval '35 days';$cron$
);
