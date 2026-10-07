-- 0096: TB1's two arms in the variants' replays (pre-registration `docs/agents/reviews/2026-10-07-polymarket-rw-tb1-prereg.md`,
-- `agents/pmrw_x.ts`; Davies, 2026-10-07: "TB1"紧盘口"：两个版本"). Each is x1 — RW-E with no weather market — plus what it
-- does in a minute whose raw touch is at most a tick wide: tb1-skip rests nothing, tb1-back rests both quotes a tick
-- behind RW's. They start flat: on RW's minutes from 2026-10-08 00:00 UTC (shown, not judged), on RW-C's from its first
-- minute, 2026-10-09 00:00 UTC, where their test is.
--
-- Their day rows go beside the seven arms already in RW's replay (`pm_rw_x_days`) and RW-C's (`pm_rwc_x_days`), so each
-- table's arm check takes the two new names. Nothing else changes: no table, no lease, no row of `edge_calls` (both
-- replays already run every minute, `agents?action=pmrw-x` and `pmrwc-x`), and no existing row.

alter table public.pm_rw_x_days drop constraint if exists pm_rw_x_days_arm_check;
alter table public.pm_rw_x_days add constraint pm_rw_x_days_arm_check
  check (arm in ('rw', 'e', 'x1', 'x2', 'x3', 'x4', 'x5', 'tb1-skip', 'tb1-back'));

alter table public.pm_rwc_x_days drop constraint if exists pm_rwc_x_days_arm_check;
alter table public.pm_rwc_x_days add constraint pm_rwc_x_days_arm_check
  check (arm in ('rw', 'e', 'x1', 'x2', 'x3', 'x4', 'x5', 'tb1-skip', 'tb1-back'));
