-- Q2-TRIPS (2026-10-14 ~16:15 UTC): the live record again, read-only, for scripts/q2trips.py. The same three replies as
-- sql/q2pm_live.sql #1-#3 (its #1 here leaves the `condition` events out: q2trips reads the fills, picks, reward days and
-- settlements), and the archive objects past Q2-PM's download, the URLs never printed or committed.
-- 1. live_aux.json: sql/q2pm_live.sql #1 with "and e.kind <> 'condition'" added to its events
-- 2. live_minutes.json.gz: sql/q2pm_live.sql #2, unchanged
-- 3. live_orders.json.gz: sql/q2pm_live.sql #3, unchanged
-- 4. the archive objects of 10-14 02:00 -> 15:00 (scripts/fetch.py)
select jsonb_build_object('pad', repeat('x', 200000), 'rows', (select jsonb_agg(jsonb_build_object('hour', hour, 'kind', kind,
  'sha256', sha256, 'bytes', bytes, 'url', url) order by kind, hour) from public.pm_rec_archive
  where (kind in ('books', 'prints', 'universe') and hour >= '2026-10-14 02:00'))) payload;
-- 5. the stop's own reading at the time of the read
select now(), (select restarted_at from pm_lp_config), (select count(*) from pm_lp_fills f where f.match_time >= '2026-10-13 13:25:32'),
  (select sum(size) from pm_lp_fills f where f.match_time >= '2026-10-13 13:25:32' and status = 'CONFIRMED'),
  (select state->'lp'->'stop' from pm_lp_state), (select max(hour) from pm_rec_archive where kind = 'books');
