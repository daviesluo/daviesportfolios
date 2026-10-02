-- 0083: pg_cron's run history keeps seven days.
--
-- cron.log_run is on, and nothing pruned cron.job_run_details: on 2026-10-02 it held 57,762 runs back to 2026-05-13,
-- 115 MB, growing by about 1,440 rows (2.2 MB) a day from the one-minute job alone, as the speed study had noted
-- (docs/agents/backtests/speed/results/architectures.json). Davies emptied it and net._http_response that afternoon
-- (Davies: "没用的话就清理掉吧"), and the database fell from 634 MB to 315 MB. Nothing reads the run history but a person
-- auditing a recent day; seven days covers every audit the ledger records. pg_net prunes its own responses after six
-- hours, so it needs no job of its own.
--
-- Daily at 10:45 UTC, after the other housekeeping jobs (10:00 to 10:35). By start time, which every run has.
select cron.schedule(
  'cron-run-details-prune',
  '45 10 * * *',
  $cron$ delete from cron.job_run_details where start_time < now() - interval '7 days'; $cron$
);
