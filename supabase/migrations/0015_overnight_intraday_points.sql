-- 5-min bucket snapshots of T212's overnight `currentPrice` for every
-- US-equity holding, recorded server-side so the ticker chart modal can
-- draw a real overnight LINE (20:00-04:00 ET) instead of the single
-- "heartbeat dot" it shows today. Populated by the `overnight-record`
-- Edge Function on a pg_cron schedule (see migration 0016), read by
-- `overnight-fetch`.
--
-- Why server-side: T212 only returns one realtime point per call, and
-- Yahoo has NO overnight bars at all (its tape skips 20:00-04:00 ET).
-- So the only way to get an overnight trend line is to sample T212
-- every few minutes — and that has to run even when no browser tab is
-- open, hence a cron worker rather than the client polling loop.
--
-- Multi-ticker (vs the single-symbol pattern): T212's
-- `/equity/positions` returns currentPrice for EVERY holding in one
-- call, so a single cron tick captures the whole portfolio. Primary
-- key (ticker, bucket_time) lets the recorder upsert-on-conflict
-- (merge-duplicates) so repeated writes within the same 5-min window
-- collapse to one row per (ticker, bucket) without an
-- UPDATE-vs-INSERT branch. The composite PK index also serves the
-- common read pattern (`ticker = … and bucket_time >= cutoff`).
--
-- Retention: 30-day rolling window via the prune job in migration
-- 0016 ("keep ~1 month" per the feature request). The chart only
-- renders the current overnight session, but a month of buffer covers
-- the 1W / 1M views' recent-day overnight detail plus post-mortem
-- debugging.
--
-- RLS: anon + authenticated may SELECT (the table only holds price
-- snapshots, and `overnight-fetch` serves them to every client on
-- each refresh). Writes are service-role only — no INSERT/UPDATE/
-- DELETE policy means PostgREST refuses anon writes by default; the
-- `overnight-record` Edge Function uses the service-role key which
-- bypasses RLS.
--
-- To apply: paste into Supabase Dashboard → SQL Editor → Run, OR let
-- the `migrations.yml` workflow run `supabase db push` on merge to
-- main (requires SUPABASE_DB_PASSWORD in the production Environment).

create table if not exists public.overnight_intraday_points (
  ticker      text        not null,
  bucket_time timestamptz not null,
  price       numeric     not null,
  recorded_at timestamptz not null default now(),
  primary key (ticker, bucket_time)
);

alter table public.overnight_intraday_points enable row level security;

-- NOTE: this anon-read policy is REVOKED by migration 0018 (it leaked the
-- holdings ticker list via direct PostgREST). It's kept here, made
-- idempotent, only so a `db push --include-all` replay against an
-- existing DB doesn't fail on "policy already exists" before 0018 runs —
-- CREATE POLICY has no IF NOT EXISTS form, so guard it with a drop.
drop policy if exists "anon_select_overnight_points" on public.overnight_intraday_points;
create policy "anon_select_overnight_points"
  on public.overnight_intraday_points
  for select
  to anon, authenticated
  using (true);
