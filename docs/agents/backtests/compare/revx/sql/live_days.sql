-- The realised round trips of one executor instance, by the UTC day each closes, per book: what haircut.py reads as
-- LIVE_DAYS (on `agent_quote_live_orders`) and TWIN_DAYS (the same on `agent_quote_twin_live_orders`, from 2026-10-01
-- 16:29:53, and `agent_quote_twin_live600_orders`). Read-only. A rung's trip closes at the fill that leaves it holding
-- £0.10 or less (the venue's minimum order, the simulator's MIN_GBP); its P&L is the rung's cash since its last close,
-- fees in, plus the remnant at that fill's price. LIVE's output is real money and is never committed: haircut.py writes
-- only ratios.
with f as (
  select id, book, rung_side, k, filled_at, leg,
         case when side = 'buy' then filled_base else -filled_base end as dq,
         case when side = 'buy' then -filled_base * avg_fill_price else filled_base * avg_fill_price end - coalesce(fee_gbp, 0) as cash,
         avg_fill_price as p
    from public.agent_quote_live_orders
   where mode = 'live' and leg in ('entry', 'exit', 'stop') and filled_base > 0 and filled_at < '2026-10-29'),
r as (select *, sum(dq) over w as held, sum(cash) over w as cc
        from f window w as (partition by book, rung_side, k order by filled_at, id)),
c as (select *, abs(held) * p <= 0.10 as flat from r),
z as (select *, lag(cc) over (partition by book, rung_side, k order by filled_at, id) as prev_cc from c where flat)
select book, to_char(filled_at, 'YYYY-MM-DD') as d, count(*) as trips,
       round(sum(cc - coalesce(prev_cc, 0) + held * p)::numeric, 4) as pnl,
       sum(case when leg = 'stop' then 1 else 0 end) as stops
  from z group by 1, 2 order by 1, 2;
