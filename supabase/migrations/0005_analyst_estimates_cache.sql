-- Server-side cache for analyst-consensus 3-year EPS-growth CAGR
-- pulled from FMP's /v3/analyst-estimates per-symbol endpoint.
-- Computed and stored as a decimal (0.225 = 22.5 %).
--
-- The `fundamentals` Edge Function queries this table first with a
-- 7-day TTL and only hits FMP on a miss. The 7-day window matches
-- the cadence at which sell-side analysts actually revise multi-
-- year forecasts (they batch revisions to earnings season + major
-- catalysts; daily refetches would burn FMP's 250-call/day quota
-- for data that didn't change). Steady-state usage on a 30-ticker
-- portfolio is ~4-5 FMP calls per day instead of ~30; the lazy
-- fetch-on-miss pattern spreads the per-ticker refreshes across
-- the week naturally rather than spiking on a single cron tick.
--
-- Anon access is denied at the table level — only the service role
-- (Edge Function) can read or write. Clients never query this
-- directly; they receive PEG values pre-computed in the
-- Fundamentals response.
--
-- To apply: paste this SQL into Supabase Dashboard → SQL Editor → Run.

create table if not exists public.analyst_estimates_cache (
  symbol       text primary key,         -- e.g. 'NVDA', 'AAPL', 'MU'
  growth_3y    numeric not null,         -- 3y EPS-CAGR decimal (0.225 = 22.5 %)
  fetched_at   timestamptz not null default now()
);

alter table public.analyst_estimates_cache enable row level security;
-- No policies → anon/authenticated reads/writes denied. The Edge
-- Function uses the service-role key which bypasses RLS.
