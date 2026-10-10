-- 0115: the programme factor. TESTING's Reward quotes rows priced on the reward programme as the listing read it each 15
-- minutes, not on the one their selection read at 00:00 (`agents/pm_prog.ts`, `agents?action=pmprog`, `pm_prog_refresh`).
--
-- On whose word. Davies, 2026-10-10: "之前testing的每一个不都赚了很多吗" (didn't every one of the TESTING rows make a lot?).
-- The coordinating session, on his delegation, the same night: make TESTING honest, display only, without touching any
-- frozen replay or pre-registered reading. The rows price every rewarded minute at the rate their 00:00 selection read,
-- all day; LP-ALLOC (docs/agents/reviews/2026-10-10-lp-capital-allocation.md) found the 00:00 top ten off for 51 % of
-- their minutes, and since Addendum 10 the page prices those formulas at the live R (0.807), which was measured against
-- the CORRECTED formula (lpcfg/results/rtrue.txt). So each row's formula is rescaled here first:
--
--   factor(row, day, market) = sum over the row's rewarded minutes of formula x (the listing's rate then / the rate the row
--                              used) / sum of formula
--
-- the definition of lpcfg/scripts/rtrue.py and of LP-ALLOC's record. "The listing's rate then" is the last pm-rec
-- reading at or before the minute (each market is read every 15 minutes, in the universe frame whose phase is its pm-rec
-- id modulo 15), else the first within 30 minutes after it; a reading that does not list the market is a programme ended,
-- rate 0. A minute no reading covers keeps factor 1 and is counted (`uncovered`), and the page says so.
--
-- What it keeps:
--   pm_prog_reads    the listing's reading of each market a TESTING row selected that day or the next, at each universe
--                    frame of its phase: rate, max spread and minimum, or null where the frame does not list it. Written
--                    by `agents?action=pmprog` from pm-rec's archive (the universe objects, through their signed URLs, each
--                    checked against its sha256), four archived hours a run; about 100 markets x 96 readings a day.
--   pm_prog_factors  a row per source, day and market: the formula as priced, the same at the rate then, minutes, minutes
--                    uncovered, the last reading used. Sources: 'rwc' (RW-C's minutes: "Reward quotes"; variant-1 and the
--                    RW-X arms replay them, so the page applies RW-C's factors to them too), 'prep' (mini-pool's paper
--                    layer), 'midprep' (mid-pool's), 'lpprep' (live-prep's). Recomputed by `pm_prog_refresh` for every
--                    day with a reading ingested since its last run, and for today.
--   pm_prog_state    the job's cursor (the last archived universe hour read), the lost hours it stepped over, its report.
--
-- The rate a row used: RW-C's minute rewards are its engine's at its day's selection rate (`pm_rwc_selection.rate`); a
-- paper layer prices its minute at its path's minute row (`pm_live_minutes`, `pm_mid_minutes`, `pm_lp_minutes`, dry-run),
-- `pm_prep.ts`'s `rate`. The minute tables are pruned at 14 days (0101); a factor row outlives them.
--
-- Nothing it writes is read by any decision, stop, replay or pre-registered reading: only the dashboard's TESTING rows
-- (`atProgramme` before `atLiveR`, agents/index.ts) read `pm_prog_factors`.
--
-- The row. `agents?action=pmprog` every 5 minutes, 30 s at most, run again by the watchdog when its worker never started
-- (`retry`): a second run reads the same hours and upserts the same readings on their key, so it changes nothing the
-- first did. Its beat is the `agents` function's, written before its work; like every row since 0104 it waits 15 minutes
-- (`active_from`'s default) for the function's deploy. Not among the monitor's health readings: nothing trades on it.
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` from
-- the new tables. Only the service role (the function) and postgres (the refresh) touch them.
--
-- ⚠️  As 0075: the job's URL is the PRODUCTION project's Edge host, so this row makes any database it is applied to call
-- production.

create table if not exists public.pm_prog_reads (
  cond        text not null,
  minute      timestamptz not null,                   -- the universe frame's minute
  rate        numeric check (rate is null or rate >= 0),   -- null: the frame does not list the market (no programme)
  max_spread  numeric,
  min_size    numeric,
  ingested_at timestamptz not null default now(),
  primary key (cond, minute)
);
create index if not exists pm_prog_reads_ingested on public.pm_prog_reads (ingested_at);

create table if not exists public.pm_prog_factors (
  source       text not null check (source in ('rwc', 'prep', 'midprep', 'lpprep')),
  day          date not null,
  cond         text not null,
  formula      numeric not null,                      -- the row's rewards at R = 1 as it priced them
  formula_true numeric not null,                      -- the same at the listing's rate then
  minutes      integer not null check (minutes >= 0),
  uncovered    integer not null check (uncovered >= 0 and uncovered <= minutes),
  read_through timestamptz,                           -- the last reading the day's minutes used
  computed_at  timestamptz not null default now(),
  primary key (source, day, cond)
);

create table if not exists public.pm_prog_state (
  id         integer primary key check (id = 1),
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz,
  last_error text
);
insert into public.pm_prog_state (id, state, updated_at) values (1, '{"cursor": "2026-10-04T18:00:00.000Z"}'::jsonb, now()) on conflict (id) do nothing;
insert into public.agent_locks (name) values ('pm-prog') on conflict (name) do nothing;

alter table public.pm_prog_reads   enable row level security;
alter table public.pm_prog_factors enable row level security;
alter table public.pm_prog_state   enable row level security;

-- The listing's rate in force at `t` for `c`: the last reading at or before it (within a day), else the first within 30
-- minutes after it; 0 where that reading lists no programme; null where no reading covers `t` (the minute keeps factor 1).
create or replace function public.pm_prog_rate_at(c text, t timestamptz)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select coalesce(r.rate, 0) from public.pm_prog_reads r where r.cond = c and r.minute <= t and r.minute > t - interval '1 day' order by r.minute desc limit 1),
    (select coalesce(r.rate, 0) from public.pm_prog_reads r where r.cond = c and r.minute > t and r.minute <= t + interval '30 minutes' order by r.minute limit 1))
$$;
revoke all on function public.pm_prog_rate_at(text, timestamptz) from public, anon, authenticated;

-- One source's factors for one UTC day, from its rewarded minutes and the rate each was priced at.
create or replace function public.pm_prog_day(src text, d date)
returns integer
language plpgsql
set search_path = ''
as $$
declare n integer;
begin
  delete from public.pm_prog_factors f where f.source = src and f.day = d;
  with m as (
    select x.cond, x.minute, x.reward::numeric reward, s.rate::numeric used from public.pm_rwc_minutes x
      join public.pm_rwc_selection s on s.day = d and s.cond = x.cond
      where src = 'rwc' and x.minute >= (d::timestamp at time zone 'UTC') and x.minute < ((d + 1)::timestamp at time zone 'UTC') and x.reward > 0
    union all
    select x.cond, x.minute, x.reward, p.rate from public.pm_prep_minutes x
      join public.pm_live_minutes p on p.mode = 'dry_run' and p.minute = x.minute and p.cond = x.cond
      where src = 'prep' and x.minute >= (d::timestamp at time zone 'UTC') and x.minute < ((d + 1)::timestamp at time zone 'UTC') and x.reward > 0
    union all
    select x.cond, x.minute, x.reward, p.rate from public.pm_midprep_minutes x
      join public.pm_mid_minutes p on p.mode = 'dry_run' and p.minute = x.minute and p.cond = x.cond
      where src = 'midprep' and x.minute >= (d::timestamp at time zone 'UTC') and x.minute < ((d + 1)::timestamp at time zone 'UTC') and x.reward > 0
    union all
    select x.cond, x.minute, x.reward, p.rate from public.pm_lpprep_minutes x
      join public.pm_lp_minutes p on p.mode = 'dry_run' and p.minute = x.minute and p.cond = x.cond
      where src = 'lpprep' and x.minute >= (d::timestamp at time zone 'UTC') and x.minute < ((d + 1)::timestamp at time zone 'UTC') and x.reward > 0
  ), r as (
    select m.*, public.pm_prog_rate_at(m.cond, m.minute) now_rate from m
  )
  insert into public.pm_prog_factors (source, day, cond, formula, formula_true, minutes, uncovered, read_through, computed_at)
  select src, d, r.cond, sum(r.reward),
         sum(case when r.now_rate is null or not (r.used > 0) then r.reward else r.reward * r.now_rate / r.used end),
         count(*), count(*) filter (where r.now_rate is null or not (r.used > 0)),
         (select max(x.minute) from public.pm_prog_reads x where x.cond = r.cond and x.minute < ((d + 1)::timestamp at time zone 'UTC')), now()
  from r group by r.cond;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.pm_prog_day(text, date) from public, anon, authenticated;

-- Every day a reading was ingested for since the last refresh, and today: each source's factors again. The minute
-- tables keep 14 days (0101), so a day older than that keeps the factors it had.
create or replace function public.pm_prog_refresh()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  since timestamptz := coalesce((select (s.state->>'refreshedAt')::timestamptz from public.pm_prog_state s where s.id = 1), '-infinity'::timestamptz);
  started timestamptz := now();
  d date;
  src text;
  done jsonb := '{}'::jsonb;
  n integer;
begin
  for d in
    select distinct (r.minute at time zone 'UTC')::date from public.pm_prog_reads r where r.ingested_at > since
    union select (now() at time zone 'UTC')::date
    order by 1
  loop
    if d < (now() at time zone 'UTC')::date - 14 then continue; end if;
    foreach src in array array['rwc', 'prep', 'midprep', 'lpprep'] loop
      n := public.pm_prog_day(src, d);
      done := done || jsonb_build_object(src || ' ' || d::text, n);
    end loop;
  end loop;
  update public.pm_prog_state s set state = s.state || jsonb_build_object('refreshedAt', started, 'refreshed', done), updated_at = now() where s.id = 1;
  return done;
end $$;
revoke all on function public.pm_prog_refresh() from public, anon, authenticated;

-- Every 15 minutes, five minutes after the job's runs at :00/:05/... have had time to read a newly archived hour.
select cron.schedule('pm-prog-refresh', '7,22,37,52 * * * *', $$ select public.pm_prog_refresh(); $$);

-- Daily: readings older than 30 days (the factors they made stay).
select cron.schedule('pm-prog-prune', '41 4 * * *', $$ delete from public.pm_prog_reads where minute < now() - interval '30 days'; $$);

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=pmprog', 30000, 5, 23, true) on conflict (path) do nothing;
