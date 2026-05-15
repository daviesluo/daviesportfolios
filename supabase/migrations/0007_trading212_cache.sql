-- Server-side cache for Trading 212 portfolio snapshots.
--
-- The `trading212` Edge Function reads this row first (120 s TTL,
-- 4× T212's 1-req-per-30-s rate-limit window) and only hits the live
-- T212 API on a miss. With cache-first, N concurrent visitors share
-- a single upstream call per window. The TTL alone can't kill the
-- boundary race (two workers passing the freshness check at the same
-- ms); that's handled by the `try_claim_t212_refresh` RPC in
-- migration 0008 — only the worker that wins the atomic claim
-- actually calls T212.
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
