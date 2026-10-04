-- RW's 3N cap in the record: decided quoting minutes with a side stopped, and the reward RW's own quotes would have
-- earned there with both sides counted (others' score as recorded), 2026-09-25 00:00 -> 2026-10-04 00:00 UTC.
with mn as (
  select mm.cond, mm.minute, mm.m::float8 m, mm.b::float8 b, mm.a::float8 a, mm.others::float8 others, mm.reward::float8 reward, mm.qb, mm.qa,
         sel.v::float8 v, sel.rate::float8 rate, greatest(sel.min_size::float8, 5) n
  from public.pm_rw_minutes mm
  join public.pm_rw_selection sel on sel.day = (mm.minute at time zone 'UTC')::date and sel.cond = mm.cond
  where mm.minute >= '2026-09-25 00:00:00+00' and mm.minute < '2026-10-04 00:00:00+00' and mm.quoting and mm.b is not null
),
cf as (
  select mn.*,
    n * least(case when (m - b)*100 >= 0 and (m - b)*100 < v then ((v - (m - b)*100)/v)^2 else 0 end,
              case when (a - m)*100 >= 0 and (a - m)*100 < v then ((v - (a - m)*100)/v)^2 else 0 end) ours2
  from mn
)
select count(*) decided_minutes, sum(case when not qb or not qa then 1 else 0 end) capped_minutes,
  sum(case when not qb then 1 else 0 end) bid_capped, sum(case when not qa then 1 else 0 end) ask_capped,
  count(distinct case when not qb or not qa then cond end) capped_markets,
  round(sum(reward)::numeric, 2) reward_recorded,
  round(sum(case when (not qb or not qa) and ours2 > 0 then rate/1440*ours2/(ours2 + others) else 0 end)::numeric, 2) reward_foregone,
  round(sum(case when qb and qa then reward else 0 end)::numeric, 2) reward_in_uncapped
from cf;
-- result: 130534 | 24344 | 11161 | 13183 | 77 | 1876.06 | 436.57 | 1876.06
