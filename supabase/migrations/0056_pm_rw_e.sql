-- 0056: RW-E beside RW (pre-registration docs/agents/reviews/2026-09-26-polymarket-rw-end-prereg.md).
--
-- RW's paper run put its whole stress loss in the markets that end on the day they are chosen. RW-E is RW without
-- those market-days, and it is judged on 2026-09-27 → 2026-10-08 by replaying what RW's engine stored. Davies
-- (2026-09-26): fix it where it can be fixed. RW's own test is frozen, so the fix runs beside it, not in it:
-- `agents?action=pmrw-e` replays RW's stored minutes every five minutes (`agents/pmrw_e.ts`) in two arms, RW itself
-- (whose days must equal `pm_rw_days`, the check that the replay is one) and RW-E, and keeps them here. It reads only
-- `pm_rw_*`, writes only these two tables, reads no key and calls nothing outside the database.

create table if not exists public.pm_rw_e_state (
  id          integer primary key check (id = 1),
  -- Both arms' running accounts, the UTC day being accumulated, the last minute replayed, the markets RW-E had to run
  -- through the rule itself, and the largest gap between the rw arm and RW's own days.
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);

-- Each arm's running totals as each UTC day ended, as `pm_rw_days` keeps RW's: the day totals are the differences.
create table if not exists public.pm_rw_e_days (
  day          date not null,
  arm          text not null check (arm in ('rw', 'e')),
  total        numeric not null,
  stress_total numeric not null,
  reward       numeric not null,
  fills        integer not null check (fills >= 0),
  capital      numeric not null check (capital >= 0),
  markets      integer not null check (markets >= 0),
  detail       jsonb not null default '{}'::jsonb,  -- per market; the markets RW-E left out that day; the rw arm's gap to RW
  closed_at    timestamptz not null default now(),
  primary key (day, arm)
);

alter table public.pm_rw_e_state enable row level security;
alter table public.pm_rw_e_days  enable row level security;

insert into public.agent_locks (name) values ('pmrw-e') on conflict (name) do nothing;

-- Every five minutes: replay what RW has decided since the last run. After 2026-10-09 00:00 UTC a run does nothing; a
-- migration unschedules it with RW's own jobs and the verdict.
select cron.schedule(
  'agents-pmrw-e',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url     := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/agents?action=pmrw-e',
      headers := jsonb_build_object(
        'Authorization',
        concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 110000
    );
  $cron$
);
