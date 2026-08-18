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
-- Applied automatically: `migrations.yml` runs `supabase db push` on
-- every push to main that touches this directory. Do NOT also apply it
-- by hand — a dashboard paste records nothing in
-- `supabase_migrations.schema_migrations`, and the MCP connector records
-- a version under its own name; either one desyncs the history and the
-- next push fails outright.

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

-- Bucketed read for the chart.
--
-- A plain range scan does not work here: at 5-minute sampling a YTD
-- window is ~60k rows, so any LIMIT either truncates the window (an
-- ascending limit returns January and drops everything recent) or ships
-- a payload no phone should parse. The chart never needs that density
-- anyway — it draws a few hundred points.
--
-- So the caller passes the bucket it wants (5 min for 1D, a day for YTD)
-- and gets the LAST sample in each bucket: the closing value of that
-- slice, which is what a chart point means. Row count then follows the
-- chart, not the sampling rate.
create or replace function public.portfolio_snapshot_series(
  _since          timestamptz,
  _bucket_seconds int
)
returns table (
  ts          timestamptz,
  value_usd   double precision,
  deposit_usd double precision
)
language sql
stable
security definer
-- Explicit search_path so a shadowing schema can't redirect the table
-- reference — same hardening every other security-definer RPC here uses.
set search_path = public
as $$
  select
    to_timestamp(
      floor(extract(epoch from s.ts) / greatest(_bucket_seconds, 1)) * greatest(_bucket_seconds, 1)
    ) as ts,
    (array_agg(s.value_usd   order by s.ts desc))[1] as value_usd,
    (array_agg(s.deposit_usd order by s.ts desc))[1] as deposit_usd
  from public.portfolio_snapshots s
  where s.ts >= _since
  group by 1
  order by 1
$$;

-- The `data` Edge Function calls this with the service-role key. Nobody
-- else should reach it.
revoke execute on function public.portfolio_snapshot_series(timestamptz, int) from public;
grant  execute on function public.portfolio_snapshot_series(timestamptz, int) to service_role;
