-- 0038: retire the dislocation-1m paper strategy — in place, not deleted.
--
-- The 1-minute study that suggested an edge here measured stale
-- last-trade prints, not quotes (docs/agents/reference.md §3.5). Read
-- against the live touch the rule waited seven hours, then fired once,
-- at 01:26 UTC on 2026-09-21, and lost 68 bps all-in inside a minute.
-- That trade was not even a trade this account could have made: Revolut
-- X publishes two books per pair (region UK / EEA) and the venue client
-- kept whichever ticker row came last, so the "cheap" ask it lifted and
-- the bid its stop hit were the EEA book's — thin that night — while the
-- UK book this account trades on sat 0.1–6 bps wide (fixed the same
-- night: `REVX_REGION`). Davies had already asked for the rule to go
-- rather than sit on the page doing nothing.
--
-- The row stays, retired: its decisions, orders and observations
-- reference it by foreign key and are the record of what it saw and did.
-- `retired_at` is what the dashboard hides on and the tick already skips
-- a paused row; the rulebook stays in the code and its tests, and
-- un-retiring is a migration. The first version of this file deleted
-- the row, was refused by `agent_decisions_strategy_id_fkey`, and never
-- applied. `agent_basis` keeps being written every fifth minute (rows
-- before the region fix mix the two books).

alter table public.agent_strategies
  add column if not exists retired_at timestamptz;

comment on column public.agent_strategies.retired_at is
  'Set when a strategy is retired: hidden from the page, never ticked, its records kept under their foreign keys.';

update public.agent_strategies
   set mode = 'paused', retired_at = now(), updated_at = now()
 where id = 'dislocation-1m';
