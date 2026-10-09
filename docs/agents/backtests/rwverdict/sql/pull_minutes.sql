-- RWC-OPT: one UTC day of a run's stored minutes, as islands (one line per run of identical rows of a market), read-only.
-- Replace {{minutes}} with pm_rw_minutes (RW) or pm_rwc_minutes (RW-C), {{day}} and {{next}} with the day and the day after
-- (YYYY-MM-DD). Run through the Supabase connector; scripts/grab.py cuts the payload out of its saved reply.
with r as (
  select cond, (extract(epoch from minute)/60)::bigint mi,
    concat_ws('|', case when quoting then '1' else '0' end, coalesce(tick::text,''), coalesce(bb::text,''), coalesce(ba::text,''), coalesce(ab::text,''), coalesce(aa::text,''), coalesce(q1::text,''), coalesce(q2::text,''), coalesce(m::text,''), coalesce(b::text,''), coalesce(a::text,''), coalesce(reward::text,'')) f
  from public.{{minutes}} where minute >= '{{day}}' and minute < '{{next}}'),
g as (select cond, mi, f, mi - row_number() over (partition by cond, f order by mi) grp from r),
isl as (select cond, f, min(mi) m0, count(*) cnt from g group by cond, f, grp),
cs as (select cond, (row_number() over (order by cond) - 1) ci from (select distinct cond from r) z)
select jsonb_build_object('lo','{{day}}T00:00:00Z','queried',now(),'rows',(select count(*) from r)::text,'islands',(select count(*) from isl)::text,
  'conds',(select jsonb_agg(cond order by ci) from cs),
  'data',(select string_agg(cs.ci||','||isl.m0||','||isl.cnt||','||isl.f, ';' order by cs.ci, isl.m0) from isl join cs using (cond))) payload
