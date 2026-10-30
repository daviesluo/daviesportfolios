-- MMCOMP part 5b (2026-10-30, SELECT only, through the Supabase connector): LIVE's own fills on Revolut X USDT-GBP from
-- 2026-10-08 (the GBP 0.10 prints' first day) to 2026-10-29 00:00 UTC, split by whether a GBP 0.10 print filled them ("dust",
-- the fill worth GBP 0.11 or less) or one came in the 120 s before the fill ("after_bot"), with each fill's markout: the book's
-- mid (agent_book_levels) 5 and 30 minutes after the fill against the fill price, in bps, signed so + is in LIVE's favour.
-- The fill's time is the first stored print at the order's price, on the other side, inside the order's life. Counts and bps
-- only; no account size is returned.
with f as (
  select o.id, o.leg, o.side, o.price, o.filled_base, o.filled_base * o.avg_fill_price gbp,
         (select min(p.ts) from agent_quote_prints p
           where p.book = o.book and p.price = o.price and p.side = case when o.side = 'buy' then 'sell' else 'buy' end
             and p.ts >= o.ts and p.ts <= coalesce(o.filled_at, o.cancelled_at, o.updated_at) + interval '5 seconds') fts
  from agent_quote_live_orders o
  where o.mode = 'live' and o.book = 'USDT-GBP' and coalesce(o.filled_base, 0) > 0
    and o.ts >= '2026-10-08' and o.ts < '2026-10-29'),
g as (
  select f.*,
    exists (select 1 from agent_quote_prints p where p.book = 'USDT-GBP' and p.price * p.qty between 0.095 and 0.105
             and p.ts < f.fts and p.ts >= f.fts - interval '120 seconds') after_bot,
    (select ((b.bids->0->>0)::numeric + (b.asks->0->>0)::numeric) / 2 from agent_book_levels b
      where b.book = 'USDT-GBP' and b.ts <= f.fts + interval '5 minutes' order by b.ts desc limit 1) m5,
    (select ((b.bids->0->>0)::numeric + (b.asks->0->>0)::numeric) / 2 from agent_book_levels b
      where b.book = 'USDT-GBP' and b.ts <= f.fts + interval '30 minutes' order by b.ts desc limit 1) m30
  from f where f.fts is not null)
select leg, case when gbp <= 0.11 then 'dust' else 'real' end kind, after_bot, count(*) n,
  round(avg(case when side = 'buy' then 1 else -1 end * 1e4 * ln(m5 / price)), 2) mk5_bps,
  round(avg(case when side = 'buy' then 1 else -1 end * 1e4 * ln(m30 / price)), 2) mk30_bps,
  round((stddev(case when side = 'buy' then 1 else -1 end * 1e4 * ln(m30 / price)) / sqrt(count(*)))::numeric, 2) mk30_se
from g group by 1, 2, 3 order by 1, 2, 3;
