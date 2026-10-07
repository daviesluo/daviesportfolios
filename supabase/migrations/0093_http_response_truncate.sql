-- 0093: pg_net's response table is emptied every ten minutes, because its own pruning leaves dead space nothing reclaims.
--
-- pg_net 0.20 keeps each response six hours and deletes it itself, from its one background worker. Those deletes never
-- reach the statistics autovacuum reads (n_dead_tup stays 0; the last autovacuum of net._http_response was 2026-10-02
-- 14:12, before the restart), so the heap only grows: 206 MB for ~4.7k live rows on 10-02, when Davies emptied it by
-- hand ("没用的话就清理掉吧"), and 297 MB for ~6.4k on 10-07. From 10-07 02:55 UTC the worker's own delete took 40–180 s
-- at a time reading that heap, the instance (Micro, 1 GB) went IO-bound, the one-minute job started late or not at all
-- (27 "job startup timeout" rows), PostgREST reads timed out, and PR5 live's dead-man switch, reading through them,
-- cancelled every resting order 45 times while the executor was alive. Nothing reads the table (the watchdog reads
-- `edge_call_beats`; the Jev replies once read from it are in `backtests/jev*.json`), so emptying it loses nothing.
--
-- A TRUNCATE needs the table's exclusive lock, which pg_net's insert and delete hold while they run: the job waits at
-- most 30 s for it and otherwise gives up quietly until the next run, so it never queues pg_net behind it for long.
-- Every ten minutes keeps the table to minutes of responses, where the six-hour pruning has nothing left to scan.
select cron.schedule(
  'http-response-truncate',
  '*/10 * * * *',
  $cron$
    do $do$
    begin
      perform set_config('lock_timeout', '30s', true);
      truncate net._http_response;
    exception when lock_not_available then
      raise notice 'net._http_response busy; the next run tries again';
    end
    $do$;
  $cron$
);
