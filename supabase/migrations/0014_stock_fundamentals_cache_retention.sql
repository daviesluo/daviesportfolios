-- Daily retention sweep for public.stock_fundamentals_cache. The
-- `fundamentals` Edge Function writes one row per `(symbol,
-- include_eps_hist)` on every cache miss, and never deletes — over
-- time the table accumulates rows for every ticker the user has
-- ever held (or even glanced at the modal of), even after they
-- remove the holding. The cache hot-set is whatever the current
-- portfolio touches in the last few days; everything older is dead
-- weight that grows the table and slows the index scans the Edge
-- Function does on every page load.
--
-- Pattern mirrors `0004_ops_errors_retention.sql` — daily pg_cron
-- job at 04:00 UTC (off-peak; avoids the 03:00 UTC slot
-- `ops_errors` already uses, so they don't both ramp at the same
-- minute). 90 days is the sweet spot: long enough that a ticker
-- the user briefly removed and re-added doesn't lose its cached
-- fundamentals; short enough that 99 % of the table at any time
-- is hot data.
--
-- Why `fetched_at`, not `updated_at` / `created_at`: the row
-- is touched (UPSERT) on every cache miss + refresh, so
-- `fetched_at` reflects actual usage. A symbol the user still
-- holds will have its row re-touched on every prefetch tick and
-- survive the sweep indefinitely.
--
-- pg_cron is preinstalled on Supabase; just need to schedule.
--
-- To apply: paste into Supabase Dashboard → SQL Editor → Run.
-- (Or merge through the PR — `migrations.yml` runs `supabase db push`
-- on every push to main that touches `supabase/migrations/**`.)

create extension if not exists pg_cron;

-- Drop the existing schedule if re-running this migration so a
-- second invocation doesn't pile up duplicate cron jobs. `if exists`
-- isn't supported by `cron.unschedule`, hence the wrapper.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'stock-fundamentals-90-day-retention') then
    perform cron.unschedule('stock-fundamentals-90-day-retention');
  end if;
end $$;

select cron.schedule(
  'stock-fundamentals-90-day-retention',
  '0 4 * * *',     -- daily at 04:00 UTC (off-peak; 1h after ops_errors sweep)
  $$delete from public.stock_fundamentals_cache where fetched_at < now() - interval '90 days'$$
);
