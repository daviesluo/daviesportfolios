-- Recorded 5-minute PRICES, replacing the recorded 5-minute portfolio
-- VALUE that `0022_portfolio_snapshots.sql` introduced.
--
-- Why the change of subject. `portfolio_snapshots` stored the answer —
-- one USD value and one USD deposit figure per bucket — which meant the
-- server had to compute the book's worth for itself. It ended up with a
-- full second implementation of the ledger maths in TypeScript, running
-- beside the browser's copy in JavaScript, both writing the same primary
-- key. They disagreed. In the ~40 hours the pair was live the recorded
-- `deposit_usd` moved between 71,391 / 75,828 / 129,138 / 132,359 with
-- no money entering or leaving the account, and `value_usd` stepped
-- between ~167k and ~182k in the same hour. Neither series is usable as
-- history, because it isn't one series.
--
-- Recording the INPUTS removes the possibility. A price is a fact the
-- server can observe and nobody has to interpret; the portfolio's value
-- is then computed in exactly one place — `computeAt` in `src/ytd.js`,
-- the same call the vs-S&P chart makes — from Yahoo's bars where they
-- exist and from these rows where they don't. The two panels draw the
-- same number because they run the same function, not because two
-- implementations were carefully kept in step.
--
-- It is also strictly more useful. Yahoo will not sell 5-minute bars
-- going back a month, and it has no bars at all for a CN fund or a
-- `.PVT` holding; these rows do, for every holding, around the clock.
-- Both charts get them.
--
-- `portfolio_snapshots` and its RPC are deliberately left in place —
-- unread, unwritten, and documented as retired in README. Dropping a
-- table is not something a migration should do on the strength of "I
-- believe nothing needs it".
--
-- Applied automatically: `migrations.yml` runs `supabase db push` on
-- every push to main that touches this directory. Do NOT also apply it
-- by hand — a second, out-of-band apply records a version no local file
-- matches and every later push then fails outright. See
-- `supabase/migrations/README.md`.

create extension if not exists pg_cron with schema extensions;

create table if not exists public.price_snapshots (
  -- Floored to the 5-minute bucket, so a re-run inside the same bucket
  -- upserts one row instead of stacking two near-identical ones.
  ts          timestamptz primary key,
  -- { "NVDA": 187.23, "VUAA.L": 112.4, … } in each ticker's NATIVE
  -- currency, exactly as the quote arrived. No FX is applied here: the
  -- client converts at read time with the same `fxToUSD` it uses for
  -- Yahoo's bars, so a recorded bar and a fetched bar go through
  -- identical treatment. This is also why a missing FX pair can no
  -- longer corrupt the table — there is no currency conversion in it to
  -- get wrong.
  prices      jsonb       not null,
  created_at  timestamptz not null default now()
);

comment on table public.price_snapshots is
  'Server-recorded 5-minute native-currency prices per held ticker. '
  'Written only by the snapshot-record Edge Function on pg_cron.';

alter table public.price_snapshots enable row level security;
-- No policies: RLS-denied to anon and authenticated. Every read goes
-- through the token-gated `data` Edge Function with the service-role
-- key, the same way board_data does — the row keys enumerate the
-- holdings, which is exactly what the token gate exists to protect.

-- Bucketed read. Reading the raw table does not work for a long window:
-- at 5-minute sampling a YTD range is ~60k rows, and a plain ascending
-- LIMIT returns January and drops everything recent. Returning the LAST
-- sample per bucket makes the row count follow the chart's point count
-- instead of the sampling rate.
create or replace function public.price_snapshot_series(
  _since timestamptz,
  _bucket_seconds int
)
returns table (ts timestamptz, prices jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (floor(extract(epoch from s.ts) / greatest(_bucket_seconds, 1)))
         s.ts, s.prices
  from public.price_snapshots s
  where s.ts >= _since
  order by floor(extract(epoch from s.ts) / greatest(_bucket_seconds, 1)),
           s.ts desc
$$;

revoke execute on function public.price_snapshot_series(timestamptz, int) from public;
grant  execute on function public.price_snapshot_series(timestamptz, int) to service_role;

-- Coarsen with age, then drop. Same bands as the chart's read buckets:
--   last 26 h      every 5-minute row   (the 24H window plus overlap)
--   26 h → 8 d     last per 30 min      (1W)
--   8 d  → 35 d    last per 1 h         (1M)
--   35 d → 100 d   last per 4 h         (3M)
--   100 d → 400 d  last per day         (YTD)
--   older          drop
-- Deliberately NOT a 30-day wipe like overnight-points: the whole point
-- of recording is that the longer ranges stop being reconstructions, and
-- a wipe would send them straight back to being one.
create or replace function public.prune_price_snapshots(_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
  k int;
begin
  delete from public.price_snapshots s
  where s.ts < _now - interval '400 days';
  get diagnostics k = row_count;
  n := n + k;

  delete from public.price_snapshots s
  where s.ts < _now - interval '100 days'
    and s.ts >= _now - interval '400 days'
    and s.ts not in (
      select max(x.ts) from public.price_snapshots x
      where x.ts < _now - interval '100 days'
        and x.ts >= _now - interval '400 days'
      group by floor(extract(epoch from x.ts) / 86400)
    );
  get diagnostics k = row_count;
  n := n + k;

  delete from public.price_snapshots s
  where s.ts < _now - interval '35 days'
    and s.ts >= _now - interval '100 days'
    and s.ts not in (
      select max(x.ts) from public.price_snapshots x
      where x.ts < _now - interval '35 days'
        and x.ts >= _now - interval '100 days'
      group by floor(extract(epoch from x.ts) / 14400)
    );
  get diagnostics k = row_count;
  n := n + k;

  delete from public.price_snapshots s
  where s.ts < _now - interval '8 days'
    and s.ts >= _now - interval '35 days'
    and s.ts not in (
      select max(x.ts) from public.price_snapshots x
      where x.ts < _now - interval '8 days'
        and x.ts >= _now - interval '35 days'
      group by floor(extract(epoch from x.ts) / 3600)
    );
  get diagnostics k = row_count;
  n := n + k;

  delete from public.price_snapshots s
  where s.ts < _now - interval '26 hours'
    and s.ts >= _now - interval '8 days'
    and s.ts not in (
      select max(x.ts) from public.price_snapshots x
      where x.ts < _now - interval '26 hours'
        and x.ts >= _now - interval '8 days'
      group by floor(extract(epoch from x.ts) / 1800)
    );
  get diagnostics k = row_count;
  n := n + k;

  return n;
end;
$$;

revoke execute on function public.prune_price_snapshots(timestamptz) from public;
grant  execute on function public.prune_price_snapshots(timestamptz) to postgres;

-- Repoint the daily prune. The 5-minute recorder job from `0026` keeps
-- its schedule and its name — the function behind it now writes prices
-- instead of a value, which is a deploy, not a cron change.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'snapshot-points-daily-prune') then
    perform cron.unschedule('snapshot-points-daily-prune');
  end if;
end $$;

select cron.schedule(
  'snapshot-points-daily-prune',
  '5 10 * * *',
  $cron$
    select public.prune_price_snapshots();
  $cron$
);
