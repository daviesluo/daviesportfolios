-- 0103: mini-pool's two calls leave the one-minute job now, and RW's four the moment the last day their pre-registered
-- readings read is closed, never before.
--
-- Why (Davies, 2026-10-08: "按你说的停掉mini-pool的两个调用 … 另外正好"Round 1: RW's own fourteen days from 25 Sep 01:00
-- BST."马上就要结束了把你觉得前台和后台不需要和没必要再继续测的策略都可以关掉"). RW's rows go only when no reading still to
-- run needs another minute of them; mini-pool's go now, on his word, at the one cost named below. The tables are kept whole: every verdict and audit reads them, and nothing here deletes
-- or prunes a row (no retention job reaches RW's tables; 0101's `pm_paths_prune` keeps mini-pool's day, fill, settlement,
-- event and state rows whole and prunes only its dry-run minutes and ended dry-run orders, which no reading reads).
--
--   agents?action=pmrw, agents?action=pmrw-select  RW's engine and its daily selection ("Reward quotes", round 1;
--       `reviews/2026-09-24-polymarket-rw-paper-spec.md`, reference §4 item 36). Its fourteen days end 2026-10-09 00:00
--       UTC (`RW_RUN_END`); its engine decides 23:59 two minutes later and closes 2026-10-08's row in `pm_rw_days`, and
--       from then both calls return "the fourteen days are over" by design. Off once that row exists. This is step (e)
--       of RW's verdict (the ledger's item 2), written before the verdict so it cannot be forgotten and cannot run early.
--   agents?action=pmrw-e  RW-E's replay of RW's minutes (`reviews/2026-09-26-polymarket-rw-end-prereg.md`, its twelve
--       days to 10-09 00:00). Off once `pm_rw_e_days` holds 2026-10-08 for every arm that has 2026-10-07.
--   agents?action=pmrw-x  the variants' replay of RW's minutes (RW-X1–X3, `reviews/2026-09-27-polymarket-rw-variants-
--       prereg.md`; x4/x5's Test 1, `reviews/2026-10-02-polymarket-rw-rest-prereg.md`, 10-03 → 10-08). Off once
--       `pm_rw_x_days` holds 2026-10-08 for every arm that has 2026-10-07. x4/x5's Test 2 and TB1 read RW-C's replay
--       (`pmrwc-x`), which stays, as do RW-C's other three calls, to RW-C's verdict on 10-23.
--   agents?action=pmlive&forceFunctionRegion=eu-west-1, agents?action=pmprep  mini-pool's order path in dry-run and its
--       paper layer. Every check window of its pre-registration closed by Addendum 7 (2026-10-04,
--       `reviews/2026-10-01-polymarket-live-prep-prereg.md`, which kept them running "as a comparison until Davies says
--       otherwise"; he said so on 2026-10-08); not a go-live candidate. Off when this file is applied. The cost, which
--       Davies accepted: mid-pool's fourteen-day readout (`backtests/pmlive/mid_readout.sql`,
--       `reviews/2026-10-02-polymarket-mid-pool-prereg.md`, at or after 2026-10-17 00:10 UTC) sets mini-pool's paper day
--       (`pm_prep_days`) beside mid-pool's for each of d1–d14, 2026-10-03 → 10-16, and from the day this lands (10-09)
--       mini-pool's column is empty: those days are missing, never zero, as the frozen readout reads a day its layer did
--       not close, and the readout names it as a deviation (Davies' word, 2026-10-09). Mid-pool's own columns and its
--       audit are untouched. Its config row is not touched, so nothing arms: `dry_run` true, `live_confirmed_at` null.
--
-- How. Mini-pool's two rows by one plain statement. RW's by `public.retire_after_rw()`, which turns each group off when its
-- condition holds (`enabled = false`, never a delete; a row already off stays off), and once all four are off
-- unschedules its own job. The job `edge-calls-retire-after-rw`
-- runs it every five minutes, at :02, :07 … (off the one-minute batch's :X0 and the response prune's :X5), and this file
-- runs it once, so a push after a condition holds acts at once. Its answer (which groups it turned off) is the job's
-- return message in `cron.job_run_details` (kept 7 days).
--
-- Safe while the job runs. The one-minute job reads the list in one plain SELECT, which an UPDATE's row locks do not
-- block; a row turned off after that minute's read is called once more, as it was due, and the watchdog never runs a
-- disabled row again. `lock_timeout` keeps this from waiting behind a long reader in the lock queue.
--
-- What stays (the ledger's item 2, 4, 5a and 9): every other row. tick and quotes (live); quotesv, quotesd (PR5V and
-- rule D, read 10-28); quotestwins (TAKE to 11-02, the twins' readouts 10-21 and 10-28); books (QUEUE's and PR5-W's
-- freeze line); views and pmrec/pmrec-meta (recorders whose study or horizon is Davies'); pmrwc, pmrwc-e, pmrwc-x,
-- pmrwc-select (RW-C to 10-23); pmmid, pmmidprep (mid-pool's readout 10-17, its audit 10-23, a go-live candidate);
-- pmlp, pmlpprep (live-prep, the lead candidate); snapshot-record, overnight-record, orders-sync, edge-watchdog.

set lock_timeout = '3s';

update public.edge_calls set enabled = false where path in ('agents?action=pmlive&forceFunctionRegion=eu-west-1', 'agents?action=pmprep');

create or replace function public.retire_after_rw()
returns jsonb
language plpgsql
set search_path = ''
as $fn$
declare
  rw_done boolean := exists (select 1 from public.pm_rw_days where day = date '2026-10-08');
  rwe_done boolean := exists (select 1 from public.pm_rw_e_days where day = date '2026-10-08')
    and not exists (select 1 from public.pm_rw_e_days a where a.day = date '2026-10-07'
                      and not exists (select 1 from public.pm_rw_e_days b where b.day = date '2026-10-08' and b.arm = a.arm));
  rwx_done boolean := exists (select 1 from public.pm_rw_x_days where day = date '2026-10-08')
    and not exists (select 1 from public.pm_rw_x_days a where a.day = date '2026-10-07'
                      and not exists (select 1 from public.pm_rw_x_days b where b.day = date '2026-10-08' and b.arm = a.arm));
  done jsonb := '{}'::jsonb;
  n bigint;
begin
  if rw_done then
    update public.edge_calls set enabled = false where enabled and path in ('agents?action=pmrw', 'agents?action=pmrw-select');
    get diagnostics n = row_count; done := done || jsonb_build_object('rw', n);
  end if;
  if rw_done and rwe_done then
    update public.edge_calls set enabled = false where enabled and path in ('agents?action=pmrw-e');
    get diagnostics n = row_count; done := done || jsonb_build_object('rw-e', n);
  end if;
  if rw_done and rwx_done then
    update public.edge_calls set enabled = false where enabled and path in ('agents?action=pmrw-x');
    get diagnostics n = row_count; done := done || jsonb_build_object('rw-x', n);
  end if;
  if not exists (select 1 from public.edge_calls where enabled and path in ('agents?action=pmrw', 'agents?action=pmrw-select',
       'agents?action=pmrw-e', 'agents?action=pmrw-x')) then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'edge-calls-retire-after-rw';
    done := done || jsonb_build_object('unscheduled', true);
  end if;
  return done;
end $fn$;
revoke all on function public.retire_after_rw() from public, anon, authenticated;

select cron.schedule(
  'edge-calls-retire-after-rw',
  '2-57/5 * * * *',
  $$ select public.retire_after_rw(); $$
);

select public.retire_after_rw();

reset lock_timeout;
