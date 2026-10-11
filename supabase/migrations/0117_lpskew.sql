-- 0117: LP-SKEW-FT, a paper forward test of inventory-skewed quoting for live-prep (its pre-registration
-- `docs/agents/reviews/2026-10-11-lp-skew-ft-prereg.md`).
--
-- Why. Davies, 2026-10-11 20:35 UTC, verbatim: "同意，做 LP-SKEW-FT 纸面前向测试" (agreed: run the LP-SKEW-FT paper forward
-- test), and 20:37 UTC: "同意迁移，全部做 LP-SKEW-FT（独立模块 + 迁移）" (agreed to the migration: do all of LP-SKEW-FT, a
-- standalone module and a migration).
--
-- What this does, and nothing else:
--   1. `pm_lpskew_state`, one row: the replay's cursor and each arm's paper inventory and cash. `pm_lpskew_days`, a row a
--      UTC day and arm: fills, shares, cash, the reward formula, settlements, holdings, the marked value, the kill.
--      Written by `agents?action=pmlpskew` (agents/lpskew.ts), which reads `pm_lp_minutes` and `pm_lp_settlements` and
--      writes nothing else. Service role only: RLS on, no policy, no grant (0082).
--   2. Its lease, `pm-lpskew`, and its call: every minute, all day, run again by the watchdog when its worker never
--      started (`retry`).
-- No other table, row or call changes. Nothing of the order path (no order, no config, no live table) is touched.

create table if not exists public.pm_lpskew_state (
  id         integer primary key check (id = 1),
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.pm_lpskew_days (
  day          date not null,
  arm          text not null check (arm in ('base', 'cap40', 'skew')),
  fills        integer not null default 0,
  buys_shares  numeric not null default 0,
  sells_shares numeric not null default 0,
  cash_usd     numeric not null default 0,
  formula_usd  numeric not null default 0,
  settled      integer not null default 0,
  held         jsonb not null default '{}'::jsonb,
  marked_usd   numeric not null default 0,
  killed_at    timestamptz,
  detail       jsonb,
  updated_at   timestamptz not null default now(),
  primary key (day, arm)
);

alter table public.pm_lpskew_state enable row level security;
alter table public.pm_lpskew_days  enable row level security;

insert into public.agent_locks (name) values ('pm-lpskew') on conflict (name) do nothing;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=pmlpskew', 58000, 1, 23, true) on conflict (path) do nothing;
