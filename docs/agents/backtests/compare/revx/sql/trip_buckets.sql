-- One executor instance's realised round trips, 2026-10-01 16:29:53 → 2026-10-29 00:00 UTC (the £120 twin: → 2026-10-27
-- 00:00), split at £1 of entry notional: "dust" trips (a partial fill of a few pence, typically a 0.133-coin print, about
-- £0.10, at the rung's price, then its exit) and the rest. Read as haircut.py's LIVE_TRIPS on `agent_quote_live_orders`
-- (real money: never committed) and as `inputs/twin_trips.json` on `agent_quote_twin_live_orders` (paper). Read-only. Trips
-- are cut as sql/live_days.sql cuts them.
with f as (
  select id, book, rung_side, k, filled_at, leg,
         case when side = 'buy' then filled_base else -filled_base end as dq,
         case when side = 'buy' then -filled_base * avg_fill_price else filled_base * avg_fill_price end - coalesce(fee_gbp, 0) as cash,
         case when leg = 'entry' then filled_base * avg_fill_price else 0 end as eg,
         avg_fill_price as p
    from public.agent_quote_live_orders
   where mode = 'live' and leg in ('entry', 'exit', 'stop') and filled_base > 0
     and filled_at >= '2026-10-01 16:29:53' and filled_at < '2026-10-29'),
r as (select *, sum(dq) over w as held, sum(cash) over w as cc, sum(eg) over w as cg
        from f window w as (partition by book, rung_side, k order by filled_at, id)),
c as (select *, abs(held) * p <= 0.10 as flat from r),
z as (select *, lag(cc) over w2 as prev_cc, lag(cg) over w2 as prev_cg
        from c where flat window w2 as (partition by book, rung_side, k order by filled_at, id)),
t as (select book, cg - coalesce(prev_cg, 0) as gbp, cc - coalesce(prev_cc, 0) + held * p as pnl from z)
select book, case when gbp < 1 then 'dust' else 'normal' end as bucket, count(*) as n, round(sum(pnl)::numeric, 3) as pnl
  from t group by 1, 2 order by 1, 2;
