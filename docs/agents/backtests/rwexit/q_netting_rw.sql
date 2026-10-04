with g as (
  select cond, minute, count(*) n, sum(case when side='bid' then size else 0 end)::float8 bq, sum(case when side='ask' then size else 0 end)::float8 aq
  from public.pm_rw_fills where minute >= '2026-09-25' and minute < '2026-10-04' group by cond, minute
)
select count(*) fill_minutes, sum(case when bq > 0 and aq > 0 then 1 else 0 end) both_sides, round(sum(least(bq, aq))::numeric, 1) offsetting_shares,
  round(sum(bq + aq)::numeric, 1) all_shares, round(avg(n)::numeric, 2) fills_per_minute, max(n) max_fills_minute from g;
-- result: 2220 | 69 | 581.9 | 32865.0 | 1.20 | 15
-- RW state (pm_rw_state, read 2026-10-04 ~00:31, 149 markets incl. a few minutes past 10-04 00:00): sum firstCap 2854.44, sum maxInvCost 2759.03
