-- 0145: LIVE's capital, by when it held (Davies, 2026-10-27: LIVE £120 → £600 at 03:08:37 UTC; the page's "7-day realised,
-- annualised" is to divide each day by that day's capital, not today's).
--
-- `agent_quote_live_capital` keeps one row per capital LIVE has run on, from the instant it took effect. The dashboard reads it
-- (`agents/index.ts`, `dayCapitalGbp`) and gives each of LIVE's DAYS the capital it ran on, weighted over the day, so a week at
-- £120 is read over £120 after the step to £600. A trigger on `agent_quote_live_config` adds a row whenever `capital_gbp`
-- changes, whoever changes it (by hand, or 0146's compounding when Davies turns it on), so the history needs no one to keep it.
--
-- Its seed is LIVE's two capitals so far: £120 from go-live (2026-10-01 16:29:53.51132 UTC, `live_confirmed_at`; `0052` seeded
-- the capital and it did not change before), and £600 from the update Davies ran (`updated_at` 2026-10-27 03:08:37.112067 UTC).
--
-- What it leaves alone: the executor (it reads `capital_gbp` as before and never this table), its config's values, its tables,
-- the twins. No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` out.

create table if not exists public.agent_quote_live_capital (
  from_at timestamptz primary key,
  capital_gbp numeric not null check (capital_gbp > 0)
);
alter table public.agent_quote_live_capital enable row level security;

insert into public.agent_quote_live_capital (from_at, capital_gbp) values
  ('2026-10-01 16:29:53.51132+00', 120),
  ('2026-10-27 03:08:37.112067+00', 600)
on conflict (from_at) do nothing;

create or replace function public.agent_quote_live_capital_log() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.agent_quote_live_capital (from_at, capital_gbp)
  values (pg_catalog.now(), new.capital_gbp)
  on conflict (from_at) do update set capital_gbp = excluded.capital_gbp;
  return null;
end
$$;

drop trigger if exists agent_quote_live_capital_log on public.agent_quote_live_config;
create trigger agent_quote_live_capital_log
  after update of capital_gbp on public.agent_quote_live_config
  for each row when (new.capital_gbp is distinct from old.capital_gbp)
  execute function public.agent_quote_live_capital_log();
