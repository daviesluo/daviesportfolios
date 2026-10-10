-- LPREFILL (2026-10-10): what 10-10's ten selected markets earned by the formula, hour by hour, live, as the reward check
-- took them out. Read-only; run through the Supabase connector at 2026-10-10 13:55 UTC (the 13:00 hour is partial).
with t as (select cond from public.pm_lp_markets where day = '2026-10-10')
select date_trunc('hour', m.minute) h,
       count(distinct m.cond) filter (where coalesce(m.bid_scoring, false) or coalesce(m.ask_scoring, false)) scoring_today,
       round(sum(m.formula_usd)::numeric, 3) formula_today
from public.pm_lp_minutes m join t using (cond)
where m.mode = 'live' and m.minute >= '2026-10-10'
group by 1 order by 1;
