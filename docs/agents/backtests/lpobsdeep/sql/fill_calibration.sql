-- LP-OBS-DEEP, item 3: how often a live resting quote of live-prep fills, against the "trade-through" proxy the pause
-- counterfactual uses (the next live minute's book at or through the quote's price). Every live minute with a quote
-- resting on a side (bid_price / ask_price in YES's book), its fills in that minute on that side (a SELL of YES or a BUY
-- of NO is the ask; a BUY of YES or a SELL of NO the bid), CONFIRMED and not, by match_time. Read-only.
with mk as (select distinct on (cond) cond, yes_token, no_token from pm_lp_markets order by cond, day desc),
f as (
  select fl.cond, date_trunc('minute', fl.match_time) mn, fl.size,
    case when (fl.token = mk.yes_token) = (fl.side = 'SELL') then 'ask' else 'bid' end yside
  from pm_lp_fills fl join mk on mk.cond = fl.cond),
fm as (select cond, mn, yside, sum(size) sh from f group by 1, 2, 3),
m as (
  select cond, minute, tick, bid_price, ask_price, bid_size, ask_size,
    lead(bb) over w nbb, lead(ba) over w nba, lead(minute) over w nmin
  from pm_lp_minutes where mode = 'live' window w as (partition by cond order by minute)),
s as (
  select 'ask' yside, m.cond, m.minute, m.ask_size sz,
    (m.nmin = m.minute + interval '1 min' and m.nbb >= m.ask_price - 1e-9) thru, coalesce(fm.sh, 0) sh
  from m left join fm on fm.cond = m.cond and fm.mn = m.minute and fm.yside = 'ask' where m.ask_price is not null
  union all
  select 'bid', m.cond, m.minute, m.bid_size,
    (m.nmin = m.minute + interval '1 min' and m.nba <= m.bid_price + 1e-9), coalesce(fm.sh, 0)
  from m left join fm on fm.cond = m.cond and fm.mn = m.minute and fm.yside = 'bid' where m.bid_price is not null)
select yside, count(*) quote_minutes,
  count(*) filter (where thru) thru_minutes,
  count(*) filter (where sh > 0) fill_minutes,
  count(*) filter (where sh > 0 and thru) fill_and_thru,
  round(sum(sh), 2) fill_shares,
  round(sum(least(sz, sh)) filter (where thru), 2) fill_shares_in_thru,
  round(sum(sz) filter (where thru), 2) proxy_shares,
  round(sum(sh) / nullif(sum(sz) filter (where thru), 0), 3) actual_over_proxy
from s group by rollup (yside) order by yside nulls last;
