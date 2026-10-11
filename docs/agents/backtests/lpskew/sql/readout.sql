-- LP-SKEW-FT readout export (read-only). Run on or after the readout time the pre-registration names; save the result
-- of each statement as JSON: the first to days.json, the second to marks.json.
select day, arm, fills, buys_shares, sells_shares, cash_usd, formula_usd, settled, marked_usd, killed_at, detail
from public.pm_lpskew_days order by day, arm;

select cond, extract(epoch from minute)::bigint as t,
       case when ab is not null and aa is not null then (ab + aa) / 2.0 else (bb + ba) / 2.0 end as mid
from public.pm_lp_minutes
where mode = 'live' and minute >= '2026-10-12T00:00:00Z' and bb is not null and ba is not null
order by cond, minute;
