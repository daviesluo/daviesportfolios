-- Mid-pool's overlap audit: docs/agents/reviews/2026-10-02-polymarket-mid-pool-prereg.md. For each UTC day d1–d14 (d1 is
-- the first full UTC day after pm_mid_config.created_at), how many of mid-pool's picks RW's and RW-C's own selections took
-- on the same UTC day: counts only, never a market. Read-only. Run it once, no earlier than 2026-10-23 00:05 UTC, when
-- RW-C's verdict is computed and both no-peek rules (RW's to 2026-10-09, RW-C's to 10-23) have ended. Run earlier, it
-- reads no row of either selection: each is read in a MATERIALIZED common table expression whose one condition is the
-- clock, which Postgres plans as a one-time filter, and while it is false the table's scan never executes (EXPLAIN
-- ANALYZE: "never executed", PGlite 16, 2026-10-02; inlined, the condition became a join filter applied after the
-- rows were read). The first row says which.
with
w as (select (date_trunc('day', c.created_at at time zone 'utc') + interval '1 day')::date as d1 from public.pm_mid_config c where c.id = 1),
days as (select (w.d1 + k)::date as day from w, generate_series(0, 13) k),
rw as materialized (select r.day, r.cond from public.pm_rw_selection r where now() >= timestamptz '2026-10-23 00:05:00+00'),
rwc as materialized (select x.day, x.cond from public.pm_rwc_selection x where now() >= timestamptz '2026-10-23 00:05:00+00'),
rows as (
  select days.day::text as day, count(m.cond) as mid_picks, count(r.cond) as also_rw, count(x.cond) as also_rwc
    from days
    left join public.pm_mid_markets m on m.day = days.day
    left join rw r on r.day = m.day and r.cond = m.cond
    left join rwc x on x.day = m.day and x.cond = m.cond
   group by days.day)
select day, mid_picks, also_rw, also_rwc from (
  select 0 as part, case when now() >= timestamptz '2026-10-23 00:05:00+00' then 'open: RW''s and RW-C''s selections read'
                         else 'not open before 2026-10-23 00:05 UTC: no row of RW''s or RW-C''s selection read' end as day,
         null::bigint as mid_picks, null::bigint as also_rw, null::bigint as also_rwc
  union all
  select 1, day, mid_picks, also_rw, also_rwc from rows
  union all
  select 2, 'total', sum(mid_picks), sum(also_rw), sum(also_rwc) from rows) t
order by part, day;
