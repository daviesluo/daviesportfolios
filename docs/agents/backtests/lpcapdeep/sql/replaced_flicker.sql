-- LP-CAPDEEP: the market 10-11's refill replaced (0x0386c36c), its stored programme rate by stretch: before it went out,
-- out before the refill, and replaced. Read-only.
select case when minute < '2026-10-11 00:06' then 'a 00:00-05' when minute < '2026-10-11 00:22' then 'b 00:06-21 (out, before refill)' else 'c 00:22- (replaced)' end w,
 count(*) n, count(*) filter (where (detail->'reward'->>'rate')::numeric >= 10) rate_ge10, count(*) filter (where (detail->'reward'->>'rate')::numeric < 10) rate_lt10, min(minute), max(minute)
from pm_lp_minutes where mode='live' and cond like '0x0386c36c%' and minute >= '2026-10-11' group by 1 order by 1;
