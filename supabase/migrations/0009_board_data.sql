-- Single-row server-side store for the user's portfolio.
--
-- The `data` Edge Function (`supabase/functions/data/index.ts`) reads
-- and writes this table on behalf of the React client. Admin tokens
-- can save; admin + ro tokens can load. The function uses
-- SUPABASE_SERVICE_ROLE_KEY so the table is RLS-denied to anon /
-- authenticated callers — the function itself is the only path in.
--
-- Same single-row (id=1) shape as `trading212_cache`: the row is the
-- whole portfolio JSON (positions + holdings + lots + cash + the
-- per-position labels), and any save action upserts onto id=1 via
-- `Prefer: resolution=merge-duplicates`.
--
-- This file was added retroactively. The table was originally
-- created ad-hoc via the Supabase Dashboard SQL editor; without a
-- committed migration, a future `supabase db reset` or fresh clone
-- would silently break load/save with no clue what's missing —
-- exactly the silent-fail mode the trading212 rollout hit when
-- 0007 wasn't applied. `if not exists` makes the file safe to run
-- against a project that already has the table.
--
-- To apply: paste this SQL into Supabase Dashboard → SQL Editor → Run.

create table if not exists public.board_data (
  id          int primary key,           -- always 1 (single-row)
  data        jsonb not null,            -- full portfolio JSON
  updated_at  timestamptz not null default now()
);

alter table public.board_data enable row level security;
-- No policies → anon/authenticated reads/writes denied. The `data`
-- Edge Function uses the service-role key which bypasses RLS.
