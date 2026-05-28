-- 5-min bucket snapshots of SFTBY's T212 currentPrice. Populated by the
-- `sftby-record` Edge Function via pg_cron (server-side recorder runs
-- even when no client is on the page), read by `sftby-fetch` to power
-- the modal's chart + the position card's prevClose.
--
-- Why bucket_time as the primary key (not a synthetic id):
--   - The recorder upserts on conflict — same bucket repeatedly written
--     within its 5-min window. PK on the natural key collapses that to
--     one row per bucket without an UPDATE-vs-INSERT branch in the
--     function.
--   - Time-range scans (`bucket_time >= cutoff`) hit the implicit PK
--     index, no separate index needed for the common access pattern.
--
-- Retention: 14-day rolling window via pg_cron prune (see migration
-- 0012). The chart only needs yesterday for prevClose and today's
-- session for the series, but 14 days of buffer covers long weekends,
-- holidays, and post-mortem debugging.
--
-- RLS: anon can SELECT (the `sftby-fetch` function uses anon-or-better
-- auth) but only the service-role key (used by `sftby-record`) can
-- INSERT/UPDATE.
--
-- To apply: paste this SQL into Supabase Dashboard → SQL Editor → Run.

create table if not exists public.sftby_intraday_points (
  bucket_time timestamptz primary key,
  price       numeric     not null,
  recorded_at timestamptz not null default now()
);

alter table public.sftby_intraday_points enable row level security;

-- Anon can read everything (the table only ever holds price snapshots).
create policy "anon_select_sftby_points"
  on public.sftby_intraday_points
  for select
  to anon, authenticated
  using (true);

-- Writes are service-role only — no anon INSERT/UPDATE/DELETE policy
-- means PostgREST will refuse anon writes by default. The Edge Function
-- uses the service-role key which bypasses RLS.
