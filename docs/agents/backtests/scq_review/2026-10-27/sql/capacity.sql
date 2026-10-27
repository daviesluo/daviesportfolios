-- LIVE's next size (docs/agents/reviews/2026-10-26-stablecoin-quotes-review.md §8): how much of a larger order LIVE's own orders
-- could have filled, from 2026-10-01 16:29 UTC (go-live) to 2026-10-27 03:00 UTC. Read in production, SELECT only, 2026-10-27
-- ~03:30 UTC, through the Supabase connector.
--
-- For each live entry and exit that rested (filled, cancelled, partly filled or still new), the prints of the other side that
-- met its price while it rested (at it, or through it) are what a taker sent at or beyond our price; the queue already resting at
-- our price when we posted (the recorder's newest read of the book in the 3 minutes before) fills before us. So an order of
-- size S could have filled min(S, max(0, met - ahead)) pounds. Orders queued behind us do not matter; orders ahead that cancel
-- before the prints make this conservative (at £10 it gives 0.86x of LIVE's real entry fills and 0.88x of its exits).
-- The efficiency at S is (sum over orders / S) against the same at £10.
set statement_timeout = '58s';
with o as materialized (
  select id, leg, book, side, price::float8 p, base_size::float8 base, filled_base::float8 filled, ts, coalesce(cancelled_at, filled_at, least(ts + interval '60 min', now())) te
  from agent_quote_live_orders where mode='live' and leg in ('entry','exit') and ts >= '2026-10-01 16:29' and state in ('filled','cancelled','partially_filled','new')
), pr as materialized (select book, ts, price::float8 p, qty::float8 q, side from agent_quote_prints where ts >= '2026-10-01 16:29'),
j as materialized (
select o.id, o.leg, o.book, o.side, o.ts, o.p, o.base, o.filled,
  coalesce(sum(pr.q) filter (where (o.side='buy' and pr.p <= o.p) or (o.side='sell' and pr.p >= o.p)),0) met_q
from o left join pr on pr.book=o.book and pr.ts > o.ts and pr.ts <= o.te and pr.side <> o.side
group by 1,2,3,4,5,6,7,8),
k as (select j.*, case when met_q > 0 then coalesce((select (select sum((l->>1)::float8) from jsonb_array_elements(case when j.side='buy' then b.bids else b.asks end) l where abs((l->>0)::float8 - j.p) < 1e-9)
       from agent_book_levels b where b.book=j.book and b.ts <= j.ts and b.ts > j.ts - interval '3 min' order by b.ts desc limit 1),0) else 0 end ahead from j)
select leg, count(*) n, count(*) filter (where met_q>0) met_n, count(*) filter (where filled>0) filled_n,
  round(sum(least(met_q*p, 10))::numeric,1) ub10, round(sum(least(met_q*p, 50))::numeric,1) ub50, round(sum(least(met_q*p, 100))::numeric,1) ub100,
  round(sum(least(greatest(0, met_q - ahead)*p, 10))::numeric,1) qa10, round(sum(least(greatest(0, met_q - ahead)*p, 25))::numeric,1) qa25,
  round(sum(least(greatest(0, met_q - ahead)*p, 50))::numeric,1) qa50, round(sum(least(greatest(0, met_q - ahead)*p, 75))::numeric,1) qa75,
  round(sum(least(greatest(0, met_q - ahead)*p, 100))::numeric,1) qa100, round(sum(least(greatest(0, met_q - ahead)*p, 125))::numeric,1) qa125,
  round(sum(least(greatest(0, met_q - ahead)*p, 150))::numeric,1) qa150, round(sum(least(greatest(0, met_q - ahead)*p, 200))::numeric,1) qa200,
  round(sum(least(greatest(0, met_q - ahead)*p, 300))::numeric,1) qa300
from k group by leg;
