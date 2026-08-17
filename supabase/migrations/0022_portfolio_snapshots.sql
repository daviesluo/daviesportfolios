-- Time series behind the "Investment Performance" chart: the portfolio's
-- USD market value and the net amount deposited into it, sampled every
-- 5 minutes by the client.
--
-- Both numbers are also derivable from the lot/sell ledger plus price
-- history, and the chart still derives everything from before the first
-- stored row. The reason to record them anyway is the tickers you no
-- longer hold: once a position is sold out it comes off the board and
-- the app stops fetching its price history, so reconstructing a truthful
-- past portfolio value means re-fetching history for every symbol ever
-- owned. A stored sample sidesteps that, and pins the value that was
-- actually on screen at the time rather than a later recomputation of it.
--
-- Written through the `data` Edge Function (service-role key), same as
-- board_data — the table is RLS-denied so the function is the only path.
--
-- To apply: paste this SQL into Supabase Dashboard → SQL Editor → Run.

create table if not exists public.portfolio_snapshots (
  -- Sample time, floored by the CLIENT to a 5-minute bucket. Being the
  -- primary key is what makes the write idempotent: a phone and a laptop
  -- both sampling at 14:32 land on the same 14:30 row and upsert over
  -- each other instead of stacking two near-identical points, and a
  -- retry after a flaky write can't double-insert.
  ts           timestamptz primary key,
  -- Portfolio market value in USD — the same figure the scoreboard's
  -- PORTFOLIO cell shows, cash included.
  value_usd    double precision not null,
  -- Net deposited: cumulative buys minus sale proceeds, plus cash.
  deposit_usd  double precision not null,
  created_at   timestamptz not null default now()
);

-- The chart always asks for a trailing window (1D … YTD), never the
-- whole table, so every read is a range scan on ts. The primary-key
-- index already serves that; no extra index needed.

alter table public.portfolio_snapshots enable row level security;
-- No policies → anon / authenticated reads and writes are denied. The
-- `data` Edge Function uses the service-role key, which bypasses RLS.
