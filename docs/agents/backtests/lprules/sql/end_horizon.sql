-- LP-RULES: how close to its scheduled end a market was when live-prep's fills and rewards came, on its paper record
-- (pm_lpprep_*, 2026-10-04 18:00 -> 10-09 01:01 UTC, the dry-run's own fills of the path's orders) and its live record
-- (pm_lp_*, from 10-09 01:32 UTC). Live-prep has no end horizon, only RW-E's same-day rule (a market whose end falls in
-- the UTC day is not selected that day). Buckets: hours from the fill (or the minute) to the market's end_date.
-- Per bucket: the fills, their shares, and their P&L held to the end: the payout once the market settled (each path's
-- own settlements), else the latest adjusted mid either path recorded (live detail.m, paper's mark); and the formula of
-- the minutes in the bucket (paper: its `reward`, the formula at the selection's programme; live: formula_usd from
-- 10-10, the first day with the reward check). BUYs only are what an end-horizon rule would stop, so they are apart.
-- Read-only.
with mk as (select distinct on (cond) cond, yes_token, end_date from pm_lp_markets where end_date is not null order by cond, day desc),
lm as (
  select distinct on (cond) cond, mark from (
    select cond, (detail->>'m')::numeric mark, minute from pm_lp_minutes where mode = 'live' and detail->>'m' is not null
    union all select cond, mark, minute from pm_lpprep_minutes where mark is not null) u
  order by cond, minute desc),
pay as (
  select cond, payout::numeric payout from pm_lp_settlements
  union select cond, payout::numeric from pm_lpprep_settlements where cond not in (select cond from pm_lp_settlements)),
fills as (
  -- paper: side bid = long YES (a YES bought or a NO sold), ask = short YES; buy = the token bought
  select 'paper' src, p.cond, p.ts t, (p.side = 'bid') long_yes, p.price::numeric px_yes, p.size::numeric s, (p.token_side = 'BUY') is_buy
  from pm_lpprep_fills p
  union all
  select 'live', f.cond, f.match_time, ((f.token = mk.yes_token) = (f.side = 'BUY')),
    case when f.token = mk.yes_token then f.price::numeric else 1 - f.price::numeric end, f.size::numeric, f.side = 'BUY'
  from pm_lp_fills f join mk on mk.cond = f.cond where f.status = 'CONFIRMED'),
b as (
  select fills.*, extract(epoch from (mk.end_date - fills.t)) / 3600 h, coalesce(pay.payout, lm.mark) fin
  from fills join mk on mk.cond = fills.cond left join pay on pay.cond = fills.cond left join lm on lm.cond = fills.cond),
bk as (
  select src, case when h < 12 then '0-12 h' when h < 24 then '12-24 h' when h < 48 then '24-48 h' when h < 168 then '2-7 d' else '> 7 d' end bucket,
    is_buy, s, case when long_yes then s * (fin - px_yes) else s * (px_yes - fin) end pnl
  from b where fin is not null),
fr as (
  select src, bucket, count(*) filter (where is_buy) buys, round(sum(s) filter (where is_buy), 0) buy_sh,
    round(sum(pnl) filter (where is_buy), 2) buy_pnl_to_end, round(sum(pnl), 2) all_pnl_to_end
  from bk group by src, bucket),
mins as (
  select 'paper' src, m.cond, m.minute, m.reward::numeric f from pm_lpprep_minutes m
  union all select 'live', cond, minute, formula_usd::numeric from pm_lp_minutes where mode = 'live' and minute >= '2026-10-10'),
mr as (
  select src, case when h < 12 then '0-12 h' when h < 24 then '12-24 h' when h < 48 then '24-48 h' when h < 168 then '2-7 d' else '> 7 d' end bucket,
    round(sum(f), 2) formula
  from (select mins.*, extract(epoch from (mk.end_date - mins.minute)) / 3600 h from mins join mk on mk.cond = mins.cond) x group by 1, 2)
select coalesce(fr.src, mr.src) src, coalesce(fr.bucket, mr.bucket) bucket, fr.buys, fr.buy_sh, fr.buy_pnl_to_end, fr.all_pnl_to_end, mr.formula
from fr full join mr on mr.src = fr.src and mr.bucket = fr.bucket
order by 1, case coalesce(fr.bucket, mr.bucket) when '0-12 h' then 1 when '12-24 h' then 2 when '24-48 h' then 3 when '2-7 d' then 4 else 5 end;
