-- 0129: `momentum-1d` ("Momentum 30d", Revolut X paper) retires, on Davies' word.
--
-- Davies, 2026-10-18, answering the stablecoin quotes review of that day (its §6, "momentum-1d: RETIRE at the next
-- cleanup", the 2026-10-13 live and testing review's D3): "momentum-1d可以删了". Its own Jev question failed its bar in
-- September and runs in shadow; nothing scheduled reads its record; its return was never read as evidence
-- (docs/agents/CLAUDE.md, the four rows of `0065`).
--
-- Retired in place, as `0043` retired three rows: `mode = 'paused'` and `retired_at` set. Its decisions, orders and
-- observations are kept (they reference the row by foreign key, and are the record of what it did); deleting them would
-- be a separate decision, as `0044` was. The tick takes no entry for a retired row and winds down what it holds: on
-- 2026-10-18 03:5x UTC it held the SOL bought at 00:00 that day (paper), which its own rule exits as before; the page
-- shows it until it is flat, then drops it from TESTING (`index.ts`, `shown`). It is not a row of `edge_calls` (the tick
-- runs every strategy row), so no call changes and the watchdog is untouched. The rulebook stays in the code and its tests.
-- Un-retiring is a migration.

update public.agent_strategies
   set mode = 'paused', retired_at = now(), updated_at = now()
 where id = 'momentum-1d'
   and retired_at is null;
