-- LP-ADVERSE (2026-10-12): the two paper paths' minutes, one compact array a market-minute, read-only, one UTC day per
-- run (:day replaced by each day of the record; one reply of the whole table is more than the connector carries):
-- (1) RW-C, every minute (pm_rwc_minutes: epoch, cond, quoting, tick, raw touch bb/ba, adjusted touch ab/aa, m, our b/a,
--     ours, others, the minute's formula `reward`, qb, qa);
-- (2) live-prep's paper layer (pm_lpprep_minutes: epoch, cond, class, bb, ba, b, a, n, qb, qa, close_only, reward, fills,
--     yes_held, no_held, mark). Padded so the reply is saved to a file.
-- (1)
select jsonb_build_object('pad', repeat('x', 200000), 'rows', (select jsonb_agg(jsonb_build_array(extract(epoch from minute)::bigint, cond, quoting, tick, bb, ba, ab, aa, m, b, a, round(ours::numeric, 3), round(others::numeric, 2), round(reward::numeric, 8), qb, qa) order by minute) from public.pm_rwc_minutes where minute >= :day::date and minute < :day::date + 1)) payload;
-- (2)
select jsonb_build_object('pad', repeat('x', 200000), 'rows', (select jsonb_agg(jsonb_build_array(extract(epoch from minute)::bigint, cond, class, bb, ba, b, a, n, qb, qa, close_only, round(reward::numeric, 8), fills, yes_held, no_held, mark) order by minute) from public.pm_lpprep_minutes where minute >= :day::date and minute < :day::date + 1)) payload;
