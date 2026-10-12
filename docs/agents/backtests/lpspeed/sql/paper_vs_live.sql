-- LP-SPEED (a): paper against live on the SAME market-minutes. RW-C's paper (pm_rwc_*) quotes the same kind of rule on
-- a minute grid and fills on the data API's prints; live-prep live quotes for real. In the minutes both quoted the
-- same market (2026-10-09 01:33 to 2026-10-12 07:30 UTC), each one's fills: count, shares, seconds into the minute,
-- and markouts against the live turn's mid one and sixty minutes on (YES-book terms). Read-only.
-- Paper's `ts` is the print's data-API stamp (about 3 s after its match: scripts/tape.py); live's is the match.
with lm as (
  select cond, minute from pm_lp_minutes
  where mode = 'live' and (bid_price is not null or ask_price is not null) and minute < '2026-10-12 07:30+00'
), rm as (
  select cond, minute from pm_rwc_minutes where quoting and minute >= '2026-10-09 01:33+00' and minute < '2026-10-12 07:30+00'
), both_ as (select cond, minute from lm join rm using (cond, minute)),
paper as (
  select 'paper RW-C' as who, p.cond, p.minute, extract(epoch from p.ts - p.minute) as sec,
         case when p.side = 'bid' then 1 else -1 end as dir, p.price as qy, p.size
  from pm_rwc_fills p join both_ b on b.cond = p.cond and b.minute = p.minute
), live as (
  select 'live LP' as who, f.cond, date_trunc('minute', f.match_time) as minute,
         extract(epoch from f.match_time - date_trunc('minute', f.match_time)) as sec,
         case when (o.side = 'BUY') = (o.outcome = 'yes') then 1 else -1 end as dir,
         case when o.outcome = 'yes' then f.price else 1 - f.price end as qy, f.size
  from pm_lp_fills f join pm_lp_orders o on o.hash = f.hash and o.mode = 'live'
  join both_ b on b.cond = f.cond and b.minute = date_trunc('minute', f.match_time)
), u as (select * from paper union all select * from live),
mk as (
  select u.*, (select (bb + ba) / 2 from pm_lp_minutes x where x.mode = 'live' and x.cond = u.cond and x.minute = u.minute + interval '1 minute') as m1,
              (select (bb + ba) / 2 from pm_lp_minutes x where x.mode = 'live' and x.cond = u.cond and x.minute = u.minute + interval '60 minute') as m60
  from u
)
select (select count(*) from both_) as both_minutes, (select count(distinct cond) from both_) as both_markets,
  string_agg(concat_ws(',', who, n, round(sh, 1), p10, p50, p90, le5, round(mo1, 2), round(mo1 / sh * 100, 2), round(mo60, 2), round(mo60 / sh60 * 100, 2), n60), E'\n') as rows
from (
  select who, count(*) n, sum(size) sh,
         percentile_disc(0.1) within group (order by sec) p10, percentile_disc(0.5) within group (order by sec) p50,
         percentile_disc(0.9) within group (order by sec) p90, count(*) filter (where sec <= 5) le5,
         sum(dir * (m1 - qy) * size) mo1, sum(dir * (m60 - qy) * size) mo60, sum(size) filter (where m60 is not null) sh60, count(m60) n60
  from mk group by who
) z;
-- rows: who, fills, shares, seconds into the minute p10 / p50 / p90, fills in the first 5 s, markout $ at +1 min,
-- cents a share at +1 min, markout $ at +60 min, cents a share at +60 min, fills with a +60 min mid.
