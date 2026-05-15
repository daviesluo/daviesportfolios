-- Server-side cache for Trading 212 portfolio snapshots.
--
-- The `trading212` Edge Function reads this row first (30 s TTL) and
-- only hits the live T212 API on a miss. With cache-first, N concurrent
-- visitors share a single upstream call per window — without it the
-- visitor count would punch straight through T212's 1-req-per-30-s rate
-- limit on `/equity/portfolio`.
--
-- Single-row table (id = 1) because there's only one T212 account to
-- mirror (the site owner's). `data` is the response payload exactly as
-- the Edge Function returns it; clients never read this table directly,
-- they call /functions/v1/trading212 which adds CORS + the freshness
-- check + the upstream fetch.
--
-- Anon access is RLS-denied at the table level — only the service role
-- (Edge Function) can read or write. Same posture as
-- `index_fundamentals_cache`.
--
-- To apply: paste this SQL into Supabase Dashboard → SQL Editor → Run.

create table if not exists public.trading212_cache (
  id          int primary key,           -- always 1 (single-row)
  data        jsonb not null,            -- response payload (holdings map)
  updated_at  timestamptz not null default now()
);

alter table public.trading212_cache enable row level security;
-- No policies → anon/authenticated reads/writes denied. The Edge
-- Function uses the service-role key which bypasses RLS.
