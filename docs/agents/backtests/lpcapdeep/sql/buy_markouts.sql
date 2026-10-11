-- LP-CAPDEEP: what a live BUY fill was worth 60 minutes and 6 hours on, at the market's mid then (YES at m, NO at
-- 1 - m) or its payout if it settled by then, against its price; MrBeast wk1 apart. Read-only.
with mk as (select distinct on (cond) cond, yes_token from pm_lp_markets order by cond, day desc),
bf as (select f.cond, f.price::numeric p, f.size::numeric s, f.match_time t, (f.token = mk.yes_token) yes from pm_lp_fills f join mk using (cond) where f.status='CONFIRMED' and f.side='BUY'),
mo as (
 select bf.*,
  (select (x.bb+x.ba)/2 from pm_lp_minutes x where x.mode='live' and x.cond=bf.cond and x.minute >= bf.t + interval '60 min' order by x.minute limit 1) m60,
  (select (x.bb+x.ba)/2 from pm_lp_minutes x where x.mode='live' and x.cond=bf.cond and x.minute >= bf.t + interval '360 min' order by x.minute limit 1) m360,
  (select s.payout::numeric from pm_lp_settlements s where s.cond=bf.cond and s.settled_at <= bf.t + interval '360 min') pay360
 from bf)
select case when cond like '0x3090f7aa%' then 'MrBeast wk1' else 'all other' end grp, count(*) n, round(sum(s),1) shares, round(sum(p*s),2) usd,
 count(m60) n60, round(sum(s*((case when yes then m60 else 1-m60 end)-p)) filter (where m60 is not null),2) mo60_usd,
 round(100*sum(s*((case when yes then m60 else 1-m60 end)-p)) filter (where m60 is not null)/sum(p*s) filter (where m60 is not null),2) mo60_pct,
 count(coalesce(pay360,m360)) n360, round(sum(s*((case when yes then coalesce(pay360,m360) else 1-coalesce(pay360,m360) end)-p)) filter (where coalesce(pay360,m360) is not null),2) mo360_usd,
 round(100*sum(s*((case when yes then coalesce(pay360,m360) else 1-coalesce(pay360,m360) end)-p)) filter (where coalesce(pay360,m360) is not null)/sum(p*s) filter (where coalesce(pay360,m360) is not null),2) mo360_pct
from mo group by rollup(1) order by 1;
