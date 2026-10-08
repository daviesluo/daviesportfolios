-- 0101: the three Polymarket order paths' dry-run record keeps 14 days, their paper layers' ended-orders read goes by
-- an index, and the database's size has a reading and a daily watch.
--
-- Why (review F4, approved by Davies 2026-10-08). The database grew about 120 MB a day (1,144 MB on 10-08, 672 MB on
-- 10-04), and nothing prunes the newer minute and order tables. The three order paths ("Reward quotes mini-pool",
-- "mid-pool" and "live-prep": `pm_live_*`, `pm_mid_*`, `pm_lp_*`, all in dry-run) and their paper layers (`pm_prep_*`,
-- `pm_midprep_*`, `pm_lpprep_*`) run with no end date and wrote about 73 MB a day between them (their minutes and orders
-- 392 MB on 10-08). Each paper layer also read its path's ended orders every minute by `cancelled_at`, which no index
-- covers, so each read scanned the whole orders table: 24,589 rows and 4,290 buffers for pm_live_orders' five matches
-- (EXPLAIN, 10-08), 256, 254 and 206 ms a call on average (pg_stat_statements), about 9,500 calls a path. The instance
-- is Micro (1 GB of memory, 256 MB of shared buffers), and the 10-02 stall was its working set no longer fitting.
--
-- 1. The index. `(mode, cancelled_at)`, partial on an ended order, on each path's orders table: the paper layer's read
--    (`mode=eq.dry_run&cancelled_at=gte.<its first undecided minute>`, pm_prep.ts and its frozen copies, unchanged)
--    reads the few orders that ended since instead of the table. A plain column pair rather than a predicate on the
--    mode, so a plan made for any mode (PostgREST's prepared statements) can use it; `cancelled_at >= $2` implies the
--    index's own predicate for any value.
--
-- 2. The retention: `public.pm_paths_prune(keep)`, daily at 04:23 UTC (off the one-minute batch's :X0 and the response
--    prune's :X5), keep = 14 days. For each path, the cutoff is the earlier of now less 14 days and a day before its
--    paper layer's last decided minute (`pm_*prep_state.last_minute`; no state row, nothing is deleted), and it deletes
--    exactly:
--      a. the path's minutes of mode `dry_run` before the cutoff (`pm_live_minutes`, `pm_mid_minutes`, `pm_lp_minutes`);
--      b. the path's orders of mode `dry_run` in an ended state (`cancelled`, `expired`, `rejected`) placed and ended
--         before the cutoff, never one a fill names (`pm_*_fills.hash` references it; a dry-run order never fills);
--      c. the paper layer's minutes before the cutoff (`pm_prep_minutes`, `pm_midprep_minutes`, `pm_lpprep_minutes`).
--    Why it is safe, reader by reader (read on 10-08):
--      - the paths read today's orders, the open ones and the two days before for the reward readout; the paper layers
--        read from their first undecided minute (two minutes behind), the worst-case replay (0094) only days its table
--        lacks, which it fills daily; the book recorder and the page read the last minutes. None reaches back 14 days,
--        and the cutoff never passes a day before what a paper layer has decided, should one fall behind;
--      - every frozen check that reads these rows has run: mini-pool's day-1 check (its later windows withdrawn by its
--        Addendum 7, 10-04), mid-pool's `mid_check.sql` (10-04 00:18 UTC) and live-prep's `lp_check.sql` (10-07 20:22
--        UTC). What is still to run reads none of what is deleted: `mid_readout.sql` (on or after 10-17) the paper
--        layers' days and the live rows of `pm_live_minutes`, `mid_audit.sql` (on or after 10-23) `pm_mid_markets` and
--        the RW selections, `lp_readout.sql` live rows only, and live-prep's (f) at the go its config and state;
--      - nothing of mode `live` is deleted, nor any fill, day, settlement, event, print, market or state row.
--    Not touched: RW's, RW-C's and the variants' tables (their verdicts and TB1 read them through 10-23 at least),
--    `pm_view_books` (its study has not read it), PR5's and its twins' tables (PR5's paper test to 10-21, TAKE to
--    11-02). What this costs research: the paths' dry-run minutes and orders older than 14 days, which are gone, where
--    the days tables and the live record stay whole. A later migration can lengthen or shorten `keep`.
--
-- 3. The size: `public.db_size_bytes()` for the `monitor` function's health reading (`monitor/health.ts`, shown beside
--    the loop's four readings and never failing them), and `db-size-watch`, daily at 06:17 UTC, which writes one
--    `db.size` row to the errors box while the database is over 4 GB (1.16 GB on 10-08; the plan's disk is 8 GB).
--
-- Applied on PGlite 16 over the paths' tables from 0074, 0076, 0077, 0081 and 0091 (the session's scratchpad check,
-- `paths_retention_check.mjs`): what it deletes and keeps on a planted record is listed in the ledger's entry.

create index if not exists pm_live_orders_mode_cancelled on public.pm_live_orders (mode, cancelled_at) where cancelled_at is not null;
create index if not exists pm_mid_orders_mode_cancelled  on public.pm_mid_orders  (mode, cancelled_at) where cancelled_at is not null;
create index if not exists pm_lp_orders_mode_cancelled   on public.pm_lp_orders   (mode, cancelled_at) where cancelled_at is not null;

create or replace function public.pm_paths_prune(keep interval default interval '14 days')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  -- Each path's cutoff: `keep` before now, and never later than a day before its paper layer's last decided minute.
  cut_live timestamptz := least(now() - keep, coalesce((select s.last_minute from public.pm_prep_state s where s.id = 1) - interval '1 day', '-infinity'::timestamptz));
  cut_mid  timestamptz := least(now() - keep, coalesce((select s.last_minute from public.pm_midprep_state s where s.id = 1) - interval '1 day', '-infinity'::timestamptz));
  cut_lp   timestamptz := least(now() - keep, coalesce((select s.last_minute from public.pm_lpprep_state s where s.id = 1) - interval '1 day', '-infinity'::timestamptz));
  done jsonb := '{}'::jsonb;
  n bigint;
begin
  delete from public.pm_live_minutes where mode = 'dry_run' and minute < cut_live;
  get diagnostics n = row_count; done := done || jsonb_build_object('pm_live_minutes', n);
  delete from public.pm_live_orders o where o.mode = 'dry_run' and o.state in ('cancelled', 'expired', 'rejected')
    and o.ts < cut_live and (o.cancelled_at is null or o.cancelled_at < cut_live)
    and not exists (select 1 from public.pm_live_fills f where f.hash = o.hash);
  get diagnostics n = row_count; done := done || jsonb_build_object('pm_live_orders', n);
  delete from public.pm_prep_minutes where minute < cut_live;
  get diagnostics n = row_count; done := done || jsonb_build_object('pm_prep_minutes', n);

  delete from public.pm_mid_minutes where mode = 'dry_run' and minute < cut_mid;
  get diagnostics n = row_count; done := done || jsonb_build_object('pm_mid_minutes', n);
  delete from public.pm_mid_orders o where o.mode = 'dry_run' and o.state in ('cancelled', 'expired', 'rejected')
    and o.ts < cut_mid and (o.cancelled_at is null or o.cancelled_at < cut_mid)
    and not exists (select 1 from public.pm_mid_fills f where f.hash = o.hash);
  get diagnostics n = row_count; done := done || jsonb_build_object('pm_mid_orders', n);
  delete from public.pm_midprep_minutes where minute < cut_mid;
  get diagnostics n = row_count; done := done || jsonb_build_object('pm_midprep_minutes', n);

  delete from public.pm_lp_minutes where mode = 'dry_run' and minute < cut_lp;
  get diagnostics n = row_count; done := done || jsonb_build_object('pm_lp_minutes', n);
  delete from public.pm_lp_orders o where o.mode = 'dry_run' and o.state in ('cancelled', 'expired', 'rejected')
    and o.ts < cut_lp and (o.cancelled_at is null or o.cancelled_at < cut_lp)
    and not exists (select 1 from public.pm_lp_fills f where f.hash = o.hash);
  get diagnostics n = row_count; done := done || jsonb_build_object('pm_lp_orders', n);
  delete from public.pm_lpprep_minutes where minute < cut_lp;
  get diagnostics n = row_count; done := done || jsonb_build_object('pm_lpprep_minutes', n);

  return done || jsonb_build_object('cutoffs', jsonb_build_object('pm_live', cut_live, 'pm_mid', cut_mid, 'pm_lp', cut_lp));
end $$;
revoke all on function public.pm_paths_prune(interval) from public, anon, authenticated;

select cron.schedule(
  'pm-paths-prune',
  '23 4 * * *',
  $$ select public.pm_paths_prune(); $$
);

create or replace function public.db_size_bytes()
returns bigint
language sql
stable
set search_path = ''
as $$ select pg_catalog.pg_database_size(pg_catalog.current_database()) $$;
revoke all on function public.db_size_bytes() from public, anon, authenticated;
grant execute on function public.db_size_bytes() to service_role;

select cron.schedule(
  'db-size-watch',
  '17 6 * * *',
  $$
    insert into public.ops_errors (kind, message, context)
    select 'db.size',
           'The database is ' || pg_size_pretty(b) || ', over the 4 GB it is watched at: prune or archive what has served its test.',
           jsonb_build_object('bytes', b, 'limit', 4000000000)
      from (select pg_database_size(current_database()) as b) s
     where s.b > 4000000000;
  $$
);
