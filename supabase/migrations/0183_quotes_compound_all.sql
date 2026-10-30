-- 0183: what every Stablecoin quotes strategy realises is put back to work (capital compounding), on the twins from
-- 2026-10-31 00:00 UTC and on the three live executors behind a switch each, OFF until Davies turns it on.
-- docs/agents/reviews/2026-10-30-compounding.md; agents/quotes_compound.ts; agents/cb_live.ts.
--
-- On whose word. Davies, 2026-10-30 ~01:35 UTC: "另外再确认一下目前所有的live和testing的Stablecoin quotes都能有效做到盈利金额再利用吗？
-- 如果不能请研究实现" (confirm whether every LIVE and TESTING Stablecoin quotes reinvests its profit; if not, research and build it).
-- The audit (the design doc §1): none did. Every executor and twin sizes its rungs from a fixed capital (`capital_gbp`, or the
-- Coinbase executor's `rung_gbp`); LIVE's 0146 rule was built and never turned on.
--
-- The rule (0146's, unchanged, now for all): once a UTC day the capital is the base (what was put in) plus every rung's
-- realised P&L, fees included, and what each conversion that sold coin realised, from `from` to the day's 00:00 UTC; in whole
-- units, between a floor (half the base) and a cap (twice it), moved only when a step or more away. The loss stop, the
-- conversion caps and the asks' coin follow the capital as they always have.
--
--   agent_quote_rxu_config   "Stablecoin quotes USDC/GBP" on Revolut X: 0146's columns, and its unit, £4 (its four £30 rungs:
--                            a pound a rung); cap £240, floor £60, step £4. OFF.
--   agent_quote_live_config  LIVE: 0146's columns as they are (£12 unit and step, £300 floor, £1,200 cap). OFF.
--   cb_live_config           "Stablecoin quotes USDC/GBP" on Coinbase: the same columns, unit and step £6 (six £20 rungs: a
--                            pound a rung), cap £240, floor £60; the rung a sixth of the capital, the top-up cap in proportion.
--                            OFF.
--   agent_quote_twin_compound one row a twin: every enabled twin compounds from 2026-10-31 00:00 UTC on its live strategy's
--                            rule (its unit and step a pound a funded rung of LIVE's twelve, £12 a £600; the USDC/GBP twin
--                            £4), its base its capital now, cap twice it, floor half. Each twin's pre-registration records
--                            it as a deviation, apart (the design doc §5).
--
-- Turning a live executor on (one statement each, only in the conversation where Davies says so; `compound_from` is the
-- twins' instant, so LIVE and its twin set the same capital from the same record whenever each is turned on):
--
--   update public.agent_quote_live_config set compound_mode = 'realised', compound_base_gbp = 600,
--          compound_from = '2026-10-31T00:00:00Z', updated_at = now()
--    where id = 1 and compound_mode = 'off' and capital_gbp = 600 returning capital_gbp, compound_mode, compound_from;
--   update public.agent_quote_rxu_config set compound_mode = 'realised', compound_base_gbp = 120,
--          compound_from = '2026-10-31T00:00:00Z', updated_at = now()
--    where id = 1 and compound_mode = 'off' and capital_gbp = 120 returning capital_gbp, compound_mode, compound_from;
--   update public.cb_live_config set compound_mode = 'realised', compound_base_gbp = 120,
--          compound_from = '2026-10-31T00:00:00Z', updated_at = now()
--    where id = 1 and compound_mode = 'off' and capital_gbp = 120 and rung_gbp = 20 returning capital_gbp, rung_gbp, compound_mode;
--
-- Off (the capital stays where it is): the same tables, `set compound_mode = 'off'`. After a deposit or a withdrawal of £D:
-- `set compound_base_gbp = compound_base_gbp + D` (− for a withdrawal). A twin: `update public.agent_quote_twin_compound set
-- mode = 'off' where twin_id = '<id>'`.
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` out. No call,
-- cron job or lock: the compounding runs inside the quotes call (LIVE, the USDC/GBP executor), the twins' call and Coinbase's
-- executor's own call.

alter table public.agent_quote_rxu_config
  add column if not exists compound_mode text not null default 'off',
  add column if not exists compound_base_gbp numeric,
  add column if not exists compound_from timestamptz,
  add column if not exists compound_cap_gbp numeric not null default 240,
  add column if not exists compound_floor_gbp numeric not null default 60,
  add column if not exists compound_step_gbp numeric not null default 4,
  add column if not exists compound_unit_gbp numeric not null default 4,
  add column if not exists compound_on date,
  add column if not exists compound_last jsonb;
alter table public.agent_quote_rxu_config drop constraint if exists agent_quote_rxu_config_compound_check;
alter table public.agent_quote_rxu_config add constraint agent_quote_rxu_config_compound_check check (
  compound_mode in ('off', 'realised')
  and compound_cap_gbp > 0 and compound_floor_gbp > 0 and compound_floor_gbp <= compound_cap_gbp and compound_step_gbp > 0 and compound_unit_gbp > 0
  and (compound_mode = 'off' or (compound_base_gbp > 0 and compound_from is not null))
);

alter table public.cb_live_config
  add column if not exists compound_mode text not null default 'off',
  add column if not exists compound_base_gbp numeric,
  add column if not exists compound_from timestamptz,
  add column if not exists compound_cap_gbp numeric not null default 240,
  add column if not exists compound_floor_gbp numeric not null default 60,
  add column if not exists compound_step_gbp numeric not null default 6,
  add column if not exists compound_unit_gbp numeric not null default 6,
  add column if not exists compound_on date,
  add column if not exists compound_last jsonb;
alter table public.cb_live_config drop constraint if exists cb_live_config_compound_check;
alter table public.cb_live_config add constraint cb_live_config_compound_check check (
  compound_mode in ('off', 'realised')
  and compound_cap_gbp > 0 and compound_floor_gbp > 0 and compound_floor_gbp <= compound_cap_gbp and compound_step_gbp > 0 and compound_unit_gbp > 0
  and (compound_mode = 'off' or (compound_base_gbp > 0 and compound_from is not null))
);

create table if not exists public.agent_quote_twin_compound (
  twin_id    text primary key check (twin_id ~ '^[a-z][a-z0-9]{0,15}$'),   -- a twin's id, as its spec row's
  mode       text not null default 'off' check (mode in ('off', 'realised')),
  base_gbp   numeric not null check (base_gbp > 0),
  from_at    timestamptz not null,
  cap_gbp    numeric not null,
  floor_gbp  numeric not null,
  step_gbp   numeric not null check (step_gbp > 0),
  unit_gbp   numeric not null check (unit_gbp > 0),
  on_day     date,
  last       jsonb,
  days       jsonb not null default '{}'::jsonb,   -- each UTC day's capital, as set: a reading divides that day's trips by it
  check (floor_gbp > 0 and floor_gbp <= base_gbp and base_gbp <= cap_gbp)
);
alter table public.agent_quote_twin_compound enable row level security;

-- Every enabled twin, from 2026-10-31 00:00 UTC (its first change at 11-01 00:00 at the earliest: a day's realised): its capital
-- now as the base, twice it and half it, a pound a funded rung of LIVE's twelve (£12 on £600), the USDC/GBP twin £4 (its four).
insert into public.agent_quote_twin_compound (twin_id, mode, base_gbp, from_at, cap_gbp, floor_gbp, step_gbp, unit_gbp) values
  ('live600',   'realised',  600, '2026-10-31T00:00:00Z', 1200, 300, 12, 12),
  ('live1200',  'realised', 1200, '2026-10-31T00:00:00Z', 2400, 600, 24, 24),
  ('take50',    'realised',  600, '2026-10-31T00:00:00Z', 1200, 300, 12, 12),
  ('n600no03',  'realised',  600, '2026-10-31T00:00:00Z', 1200, 300, 12, 12),
  ('n600usdt',  'realised',  600, '2026-10-31T00:00:00Z', 1200, 300, 12, 12),
  ('n600nudge', 'realised',  600, '2026-10-31T00:00:00Z', 1200, 300, 12, 12),
  ('n600usdt2', 'realised',  600, '2026-10-31T00:00:00Z', 1200, 300, 12, 12),
  ('rxu120',    'realised',  120, '2026-10-31T00:00:00Z',  240,  60,  4,  4)
on conflict (twin_id) do nothing;
