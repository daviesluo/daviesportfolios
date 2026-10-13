-- 0119: "Reward quotes live-prep" can be restarted after its total stop, its stop then counting from the restart.
--
-- Why. Davies, 2026-10-13 ~01:40 UTC, verbatim: "做B，不用空跑吧 做好后验证没问题了直接上线吧？" (do B, no dry-run needed; once
-- it is built and verified, go straight live?). B is LP-BEST's quiet-book design (docs/agents/reviews/2026-10-13-lp-best-strategy.md
-- §7–8): a 14-day live test under a total stop of −$25 counted from the restart. The rule and its bar are live-prep's
-- pre-registration, Addendum 19 (docs/agents/reviews/2026-10-04-polymarket-lp-prereg.md). Its total stop of −$75 tripped on
-- 2026-10-12 07:30 UTC and latches for good (`pm_lp_events`, kind `loss_stop_total`): until now only a person deleting that
-- row could clear it, and the restarted stop would then have counted the whole record's loss again.
--
-- What this does, and nothing else.
--   1. `pm_lp_config.restarted_at` (timestamptz, null): the restart. Set, the deployed path (`PmLpOptions.restartable`,
--      agents/pm_live.ts `lpRestartOf`) latches its total stop only on an event written from that minute; counts the
--      stop's fills from then (each holding then from its mark then, kept in `pm_lp_state.state.lp.stop.open`), what
--      was paid for the UTC days from that day and the fees of fills matched since; and, on that UTC day, takes the
--      markets selected before it as carried and selects the day again at once. Null, everything is as before.
--   2. `pm_lp_config.restart_loss_usd` (numeric, null, CHECK 0 < x <= 75): the restarted stop's limit, at most the total
--      stop's $75 (0091's CHECK on `loss_total_usd`). Null takes `loss_total_usd`. `loss_total_usd` itself stays $75,
--      because the cap follows the equity less it and $5 (0106, `lpCapital`): LP-BEST priced the design at a cap of the
--      equity less $80.
-- No row is written: both columns are null until the restart statement of Davies' go (Addendum 19, word for word), which
-- also sets `max_markets` and `select_budget_usd`. The arming trigger (0091) is untouched. Mini-pool's and mid-pool's
-- configs are untouched: neither has the columns, and their code never reads them.
--
-- Safe in either deploy order. This first: the deployed function does not read the columns, and the stop stays tripped.
-- The function first: it reads the columns through `select=*`; with neither there (or both null) it runs as before, its
-- stop tripped. Only both and the restart statement restart it.
--
-- Safe while the path runs. Adding two nullable columns is a catalogue change (no table rewrite); with the CHECK it takes
-- the table's exclusive lock for milliseconds; `lock_timeout` stops it waiting behind a long reader. Applied twice it
-- changes nothing more.

set lock_timeout = '3s';

alter table public.pm_lp_config add column if not exists restarted_at timestamptz;
alter table public.pm_lp_config add column if not exists restart_loss_usd numeric;
alter table public.pm_lp_config drop constraint if exists pm_lp_config_restart_loss_usd_check;
alter table public.pm_lp_config add constraint pm_lp_config_restart_loss_usd_check check (restart_loss_usd > 0 and restart_loss_usd <= 75);

reset lock_timeout;
