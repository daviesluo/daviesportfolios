-- 24/7 5-minute portfolio snapshots, same machinery as overnight-record:
-- pg_cron POSTs to an Edge Function gated by Vault `cron_secret`, and a
-- daily job then thins the table so only the 24H window stays at 5-minute
-- density.
--
-- Why a server job: the original sampler wrote `portfolio_snapshots` from
-- the admin tab, and only while that tab was visible. A day of "every
-- five minutes" therefore recorded the hours the page was open, not the
-- hours the book actually moved. Overnight prices already sample on the
-- server; the portfolio total needs the same so recorded points can
-- replace ledger-derived history on every range, not just when someone
-- is looking.
--
-- Prune is NOT a 30-day wipe (that's what overnight-points does, because
-- the overnight chart only ever fetches ~26 h). Investment Performance
-- still needs real samples on 1W / 1M / 3M / YTD — just not at 5-minute
-- density. Keep:
--   last 26 h     every 5-minute row  (24H window + overlap)
--   26 h → 8 d    last sample per 30 min   (1W bucket)
--   8 d  → 35 d   last sample per 1 hour   (1M)
--   35 d → 100 d  last sample per 4 hours  (3M)
--   100 d → 400 d last sample per day      (YTD)
--   older         drop
-- The read path (`portfolio_snapshot_series`) already returns last-per-
-- bucket; this just stops the table growing at 288 rows/day forever.
-- Keep the predicate in lockstep with `pruneSnapshotTimestamps` in
-- `supabase/functions/snapshot-record/index.ts`.
--
-- Auth: same Vault `cron_secret` overnight-record already uses (0021).
-- The plaintext never lives in this file. If that secret is missing the
-- job 403s and records nothing — same failure mode 0016 hit before Vault.
--
-- ⚠️  CROSS-ENVIRONMENT WARNING: the `url` below is the PRODUCTION
-- project's Edge Function host, hardcoded (same as 0016/0021). Applying
-- this to any other database will make THAT database POST to production
-- every 5 minutes. Change the host per environment.
--
-- Applied automatically: `migrations.yml` runs `supabase db push` on
-- every push to main that touches this directory. Do NOT also apply it
-- by hand.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Last-per-bucket coarsen + 400-day drop. `_now` is injectable so a
-- pin test (or a one-off SQL check) can freeze the clock.
create or replace function public.prune_portfolio_snapshots(_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
  k int;
begin
  delete from public.portfolio_snapshots s
  where s.ts < _now - interval '400 days';
  get diagnostics k = row_count;
  n := n + k;

  delete from public.portfolio_snapshots s
  where s.ts < _now - interval '100 days'
    and s.ts >= _now - interval '400 days'
    and s.ts not in (
      select max(x.ts) from public.portfolio_snapshots x
      where x.ts < _now - interval '100 days'
        and x.ts >= _now - interval '400 days'
      group by floor(extract(epoch from x.ts) / 86400)
    );
  get diagnostics k = row_count;
  n := n + k;

  delete from public.portfolio_snapshots s
  where s.ts < _now - interval '35 days'
    and s.ts >= _now - interval '100 days'
    and s.ts not in (
      select max(x.ts) from public.portfolio_snapshots x
      where x.ts < _now - interval '35 days'
        and x.ts >= _now - interval '100 days'
      group by floor(extract(epoch from x.ts) / 14400)
    );
  get diagnostics k = row_count;
  n := n + k;

  delete from public.portfolio_snapshots s
  where s.ts < _now - interval '8 days'
    and s.ts >= _now - interval '35 days'
    and s.ts not in (
      select max(x.ts) from public.portfolio_snapshots x
      where x.ts < _now - interval '8 days'
        and x.ts >= _now - interval '35 days'
      group by floor(extract(epoch from x.ts) / 3600)
    );
  get diagnostics k = row_count;
  n := n + k;

  delete from public.portfolio_snapshots s
  where s.ts < _now - interval '26 hours'
    and s.ts >= _now - interval '8 days'
    and s.ts not in (
      select max(x.ts) from public.portfolio_snapshots x
      where x.ts < _now - interval '26 hours'
        and x.ts >= _now - interval '8 days'
      group by floor(extract(epoch from x.ts) / 1800)
    );
  get diagnostics k = row_count;
  n := n + k;

  return n;
end;
$$;

revoke execute on function public.prune_portfolio_snapshots(timestamptz) from public;
grant  execute on function public.prune_portfolio_snapshots(timestamptz) to postgres;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'snapshot-record-every-5min') then
    perform cron.unschedule('snapshot-record-every-5min');
  end if;
  if exists (select 1 from cron.job where jobname = 'snapshot-points-daily-prune') then
    perform cron.unschedule('snapshot-points-daily-prune');
  end if;
end $$;

-- 24/7, unlike overnight-record's `*/5 0-9 * * *`. The function has no
-- session window — crypto and FX move around the clock, and the 24H
-- chart is a trailing 24 h, not a US cash session.
select cron.schedule(
  'snapshot-record-every-5min',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url     := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/snapshot-record',
      headers := jsonb_build_object(
        'Authorization',
        concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 25000
    );
  $cron$
);

-- After the overnight prune (10:00 UTC). Cheap: a few DELETEs on a
-- ts-keyed table, not a rewrite.
select cron.schedule(
  'snapshot-points-daily-prune',
  '5 10 * * *',
  $cron$
    select public.prune_portfolio_snapshots();
  $cron$
);
