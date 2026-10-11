-- LP-CAPDEEP: how much of the selection's formula a TWO-SIDED quoting minute scores, by rank group, 10-10 and 10-11.
-- k_two = the minutes' formula (RW's, as stored) over the selection's formula_day / 1440, over the minutes in state
-- 'quote' with both our orders resting; k_all over every 'quote' minute (LP-CAPINV's k). Read-only.
with mm as (
 select (x.minute at time zone 'utc')::date d, x.cond, x.formula_usd::numeric fu, (x.bid_price is not null and x.ask_price is not null) two, (x.ba-x.bb) <= x.tick+1e-9 tight
 from pm_lp_minutes x where x.mode = 'live' and x.detail->'lp'->>'state' = 'quote' and x.minute >= '2026-10-10')
select mm.d, case when k.rank<=3 then '1-3' when k.rank<=10 then '4-10' else '11+' end grp, count(*) qmm, count(*) filter (where two) two_mm, count(*) filter (where tight) tight_mm,
 round(sum(fu),3) f, round(sum(fu) filter (where two),3) f_two,
 round(sum(fu) filter (where two) / nullif(sum(k.formula_day/1440) filter (where two),0),3) k_two,
 round(sum(fu) / sum(k.formula_day/1440),3) k_all
from mm join pm_lp_markets k on k.cond = mm.cond and k.day = mm.d group by 1,2 order by 1,2;
