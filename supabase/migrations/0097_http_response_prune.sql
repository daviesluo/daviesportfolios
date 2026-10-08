-- 0097: pg_net's response table is pruned by a DELETE at minute 5 of every ten, not emptied by a TRUNCATE at minute 0.
--
-- 0093's TRUNCATE takes the table's exclusive lock, and it ran at :00, :10, … :50 — the same minutes the one-minute job
-- (`edge-calls-every-minute`) queues its batch, whose responses pg_net's one worker inserts into this table. From its
-- first run (10-07 20:50 UTC) to 10-08 00:41 that batch reached the Edge Functions a minute late at 18 of 24 :X0 minutes
-- and at none of the 208 others (`edge_call_beats`; the cron job itself started on time): the live tick, PR5's quotes,
-- RW's and RW-C's replays all lost those minutes, and RW-C's first judged minute, 10-09 00:00, is one of them.
--
-- A DELETE takes row locks only, so pg_net's inserts never wait on it, and running it at :05, :15, … keeps it off the
-- minutes the truncate shared with the batch. It removes what is more than ten minutes old, so the table still holds
-- minutes of responses (68 rows, 280 kB on 10-08) and pg_net's own six-hour pruning, whose deletes never reach the
-- statistics, has nothing to read. These deletes run in an ordinary backend and do reach them, so autovacuum
-- reclaims the dead rows they leave — the dead space 0093 was written to stop.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'http-response-truncate') then
    perform cron.unschedule('http-response-truncate');
  end if;
end
$$;

select cron.schedule(
  'http-response-prune',
  '5-59/10 * * * *',
  $cron$
    delete from net._http_response where created < now() - interval '10 minutes';
  $cron$
);
