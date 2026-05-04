-- Server-side cache for index P/E values pulled from Alpha Vantage.
-- The `fundamentals` Edge Function queries this table first (24 h TTL)
-- and only hits Alpha Vantage on a miss, so even with several users
-- and many page loads we stay well under the free-tier limit
-- (25 requests / day, our usage is 4 indices × 1 refresh / day = 4).
--
-- Anon access is denied at the table level — only the service role
-- (Edge Function) can read or write. Clients never query this
-- directly; they call /functions/v1/fundamentals which surfaces the
-- cached pe + the hardcoded 3Y AVG via a normal Fundamentals shape.
--
-- To apply: paste this SQL into Supabase Dashboard → SQL Editor → Run.

create table if not exists public.index_fundamentals_cache (
  symbol      text primary key,        -- e.g. 'SPY', 'QQQ', 'IWM', 'SOXX'
  pe          numeric not null,        -- trailing P/E from Alpha Vantage OVERVIEW
  fetched_at  timestamptz not null default now()
);

alter table public.index_fundamentals_cache enable row level security;
-- No policies → anon/authenticated reads/writes denied. The Edge
-- Function uses the service-role key which bypasses RLS.
