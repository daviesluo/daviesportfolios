-- 0085: two more arms in the variants' replays, x4 and x5 (pre-registration
-- `docs/agents/reviews/2026-10-02-polymarket-rw-rest-prereg.md`, `agents/pmrw_x.ts`; Davies, 2026-10-02: one or two more
-- variants on the best one so far, x1). Each is x1 — RW-E with no weather market — plus where its quotes rest from
-- 2026-10-03 00:00 UTC: x4 both quotes further from the mid while the minute keeps nine tenths of RW's reward, x5 the
-- quote that would add to what it holds a tick further for every whole N it holds.
--
-- Their day rows go beside the five arms already in RW's replay (`pm_rw_x_days`) and RW-C's (`pm_rwc_x_days`), so each
-- table's arm check takes the two new names. Nothing else changes: no table, no lease, no row of `edge_calls` (both
-- replays already run every minute, `agents?action=pmrw-x` and `pmrwc-x`), and no existing row.

alter table public.pm_rw_x_days drop constraint if exists pm_rw_x_days_arm_check;
alter table public.pm_rw_x_days add constraint pm_rw_x_days_arm_check
  check (arm in ('rw', 'e', 'x1', 'x2', 'x3', 'x4', 'x5'));

alter table public.pm_rwc_x_days drop constraint if exists pm_rwc_x_days_arm_check;
alter table public.pm_rwc_x_days add constraint pm_rwc_x_days_arm_check
  check (arm in ('rw', 'e', 'x1', 'x2', 'x3', 'x4', 'x5'));
