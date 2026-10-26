-- 2026-10-26 stablecoin quotes review: every read, SELECT only, through the Supabase connector, 2026-10-26 00:59-01:06 UTC.
-- [A] -> data/live_orders.json.gz (the j array): LIVE's filled orders and conversions.
select json_agg(json_build_object('id',id,'ts',ts,'mode',mode,'book',book,'rung_side',rung_side,'k',k,'leg',leg,'side',side,'price',price,
  'base_size',base_size,'state',state,'filled_base',filled_base,'avg_fill_price',avg_fill_price,'fee_gbp',fee_gbp,'filled_at',filled_at) order by id) j
from public.agent_quote_live_orders where mode='live' and (filled_base>0 or leg='convert');

-- [B] -> data/twin_orders.json.gz (the j object): every realistic twin's filled orders and conversions, and each one's dust.
with f as (
 select 'pr5' t, * from public.agent_quote_twin_pr5_orders where mode='live' and (filled_base>0 or leg='convert')
 union all select 'live', * from public.agent_quote_twin_live_orders where mode='live' and (filled_base>0 or leg='convert')
 union all select 'p50', * from public.agent_quote_twin_p50_orders where mode='live' and (filled_base>0 or leg='convert')
 union all select 'take50', * from public.agent_quote_twin_take50_orders where mode='live' and (filled_base>0 or leg='convert')
 union all select 'take50wk', * from public.agent_quote_twin_take50wk_orders where mode='live' and (filled_base>0 or leg='convert')
 union all select 'd', * from public.agent_quote_twin_d_orders where mode='live' and (filled_base>0 or leg='convert'))
select json_build_object(
 'orders', (select json_agg(json_build_object('t',t,'id',id,'ts',ts,'mode',mode,'book',book,'rung_side',rung_side,'k',k,'leg',leg,'side',side,'price',price,
   'filled_base',filled_base,'avg_fill_price',avg_fill_price,'fee_gbp',fee_gbp,'filled_at',filled_at,'state',state,'take',request->'take')) from f),
 'dust', json_build_object('pr5',(select state->'dust' from public.agent_quote_twin_pr5_state),'live',(select state->'dust' from public.agent_quote_twin_live_state),
   'p50',(select state->'dust' from public.agent_quote_twin_p50_state),'take50',(select state->'dust' from public.agent_quote_twin_take50_state),
   'take50wk',(select state->'dust' from public.agent_quote_twin_take50wk_state),'d',(select state->'dust' from public.agent_quote_twin_d_state))) j;

-- [C] -> data/fairs.txt: each book's fair (fairU / X) at the marks; the last line is the read's instant (2026-10-26 00:58).
select json_agg(json_build_object('at',t.at,'book',b.book,'fair',x.fair_u/x.x) order by t.at, b.book)
from generate_series('2026-10-02 00:00Z'::timestamptz,'2026-10-26 00:00Z','1 day') t(at) cross join (values ('USDC-GBP'),('USDT-GBP')) b(book)
cross join lateral (select fair_u, x from public.agent_quote_minutes q where q.book=b.book and q.minute<=t.at and q.x is not null and q.fair_u is not null
  order by minute desc limit 1) x;

-- [D] the paper engines' days (results/aggregates.json "paper").
select 'pr5' src, null arm, sum(trips) trips, sum(won) won, sum(realised_usd) filter (where day >= '2026-10-02' and day < '2026-10-26') r_since1002,
  sum(realised_usd) filter (where day >= '2026-10-12' and day < '2026-10-26') r_14, sum(realised_usd) filter (where day >= '2026-10-19' and day < '2026-10-26') r_7
from public.agent_quote_days
union all select 'pr5v', arm, sum(trips), sum(won), sum(realised_usd) filter (where day >= '2026-10-02' and day < '2026-10-26'),
  sum(realised_usd) filter (where day >= '2026-10-12' and day < '2026-10-26'), sum(realised_usd) filter (where day >= '2026-10-19' and day < '2026-10-26') from public.agent_quotev_days group by arm
union all select 'ruled', arm, sum(trips), sum(won), sum(realised_usd) filter (where day >= '2026-10-02' and day < '2026-10-26'),
  sum(realised_usd) filter (where day >= '2026-10-12' and day < '2026-10-26'), sum(realised_usd) filter (where day >= '2026-10-19' and day < '2026-10-26') from public.agent_quoted_days group by arm;
select 'cb' src, sum(trips), sum(won), sum(realised_gbp) filter (where day >= '2026-10-12' and day < '2026-10-26') r_14,
  sum(realised_gbp) filter (where day >= '2026-10-19' and day < '2026-10-26') r_7, min(realised_gbp) worst from public.cb_quote_days
union all select 'cbhold', sum(trips), sum(won), sum(realised_gbp) filter (where day >= '2026-10-12' and day < '2026-10-26'),
  sum(realised_gbp) filter (where day >= '2026-10-19' and day < '2026-10-26'), min(realised_gbp) from public.cb_hold_days;

-- [E] entry fill rates and order counts, 2026-10-12 -> 10-26 (results/aggregates.json "fill_rates").
with x as (
 select 'LIVE' t, leg, filled_base, ts from public.agent_quote_live_orders where mode='live'
 union all select 'pr5', leg, filled_base, ts from public.agent_quote_twin_pr5_orders where mode='live'
 union all select 'live', leg, filled_base, ts from public.agent_quote_twin_live_orders where mode='live'
 union all select 'p50', leg, filled_base, ts from public.agent_quote_twin_p50_orders where mode='live'
 union all select 'take50', leg, filled_base, ts from public.agent_quote_twin_take50_orders where mode='live'
 union all select 'take50wk', leg, filled_base, ts from public.agent_quote_twin_take50wk_orders where mode='live'
 union all select 'd', leg, filled_base, ts from public.agent_quote_twin_d_orders where mode='live')
select t, count(*) filter (where leg='entry') entries, count(*) filter (where leg='entry' and filled_base>0) entry_filled,
  count(*) filter (where leg='stop') stops, count(*) n_all from x where ts >= '2026-10-12' and ts < '2026-10-26' group by t;

-- [F] capacity: what LIVE's entries (and, with leg='exit', its exits) since 2026-10-12 could have filled at a larger size, from the prints
-- that met their price while they rested (queue ahead ignored: an upper bound). Run once with leg='entry', once with leg='exit'.
with o as (
  select id, book, side, price, base_size, filled_base, ts, coalesce(cancelled_at, filled_at, ts + interval '60 min') te
  from public.agent_quote_live_orders where mode='live' and leg='entry' and ts >= '2026-10-12' and state in ('filled','cancelled','new','partially_filled')
), a as (
  select o.*, coalesce((select sum(p.qty*p.price) from public.agent_quote_prints p where p.book=o.book and p.ts > o.ts and p.ts <= o.te
     and ((o.side='buy' and p.side='sell' and p.price <= o.price) or (o.side='sell' and p.side='buy' and p.price >= o.price))),0) avail_gbp,
     o.filled_base*o.price filled_gbp from o)
select count(*) n, count(*) filter (where avail_gbp>0) with_avail, sum(filled_gbp) filled_gbp, sum(least(avail_gbp,10)) cap10,
  sum(least(avail_gbp,25)) cap25, sum(least(avail_gbp,50)) cap50, sum(least(avail_gbp,100)) cap100 from a;

-- [G] each book's prints a day since 2026-10-12, in pounds.
select book, date_trunc('day', ts)::date d, count(*) prints, sum(qty*price) gbp, percentile_cont(0.5) within group (order by qty*price) med_gbp,
  percentile_cont(0.9) within group (order by qty*price) p90_gbp from public.agent_quote_prints where ts >= '2026-10-12' group by 1,2 order by 1,2;

-- [H] LIVE's entries and exits since 2026-10-12: how much of a filled order's size filled.
select leg, count(*) n, count(*) filter (where filled_base>0) filled, count(*) filter (where filled_base>0 and filled_base < base_size*0.999) partial,
  sum(filled_base)/nullif(sum(base_size) filter (where filled_base>0),0) fill_frac_of_filled
from public.agent_quote_live_orders where mode='live' and ts >= '2026-10-12' and leg in ('entry','exit') and state not in ('rejected','pending') group by 1;
