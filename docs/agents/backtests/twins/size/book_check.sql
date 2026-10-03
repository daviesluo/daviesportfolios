-- The PR5 twin's post-only entries and exits against Revolut X's recorded UK books (agent_book_levels, 0057), read
-- 2026-10-03 ~01:45 UTC on Davies' word ("这个研究本来就是为了测试记录的，有用的话就用，之后都用这个来辅助判断"):
-- rows before QUEUE's window (which opens 2026-10-04) only. The book an order met is taken twice: the last row stored
-- at or before its instant (a row is stored when the book changed, each read about 42 s into its minute), and the
-- first stored within 60 s after it. An order "crosses" when a buy's price is at or above the best ask, a sell's at or
-- below the best bid: the post-only order the venue refuses.

-- 1. Refused (never sent) and sent, by leg: how often the recorded book agrees.
with o as (
  select id, ts, book, leg, side, price::numeric p, coalesce((response->>'wouldBeRefused')::boolean, false) nb
  from agent_quote_twin_pr5_orders
  where mode='live' and leg in ('entry','exit') and (request->>'postOnly')::boolean is true
    and ts >= '2026-09-26 18:30+00' and ts < '2026-10-03 00:00+00'),
c as (
  select o.*, b1.bid bid_b, b1.ask ask_b, b2.bid bid_a, b2.ask ask_a
  from o
  left join lateral (select (bl.bids->0->>0)::numeric bid, (bl.asks->0->>0)::numeric ask from agent_book_levels bl
                     where bl.book=o.book and bl.ts <= o.ts and bl.ts > o.ts - interval '5 minutes' order by bl.ts desc limit 1) b1 on true
  left join lateral (select (bl.bids->0->>0)::numeric bid, (bl.asks->0->>0)::numeric ask from agent_book_levels bl
                     where bl.book=o.book and bl.ts > o.ts and bl.ts <= o.ts + interval '60 seconds' order by bl.ts asc limit 1) b2 on true)
select nb as twin_refused, leg,
  count(*) n,
  count(*) filter (where bid_b is not null) with_book_before,
  count(*) filter (where (side='buy' and p >= ask_b) or (side='sell' and p <= bid_b)) real_cross_before,
  count(*) filter (where (side='buy' and p >= ask_a) or (side='sell' and p <= bid_a)) real_cross_after,
  count(*) filter (where ((side='buy' and p >= ask_b) or (side='sell' and p <= bid_b)) and ((side='buy' and p >= ask_a) or (side='sell' and p <= bid_a))) cross_both
from c group by nb, leg order by nb, leg;

-- 2. Each refused entry with the recorded touch before it, and its fair as the rung implies it (price / (1 ∓ k)).
with o as (
  select id, ts, book, rung_side, k::numeric k, side, price::numeric p, base_size::numeric q
  from agent_quote_twin_pr5_orders
  where mode='live' and leg='entry' and coalesce((response->>'wouldBeRefused')::boolean,false)
    and ts >= '2026-09-26 18:30+00' and ts < '2026-10-03 00:00+00')
select o.id, o.ts, o.book, o.rung_side, o.k, o.side, o.p,
  round(o.p / (case when o.rung_side='bid' then 1 - o.k else 1 + o.k end), 5) fair_est,
  b1.bid, b1.ask, b1.bidq, b1.askq, b1.ts book_ts
from o left join lateral (
  select bl.ts, (bl.bids->0->>0)::numeric bid, (bl.asks->0->>0)::numeric ask, (bl.bids->0->>1)::numeric bidq, (bl.asks->0->>1)::numeric askq
  from agent_book_levels bl where bl.book=o.book and bl.ts <= o.ts and bl.ts > o.ts - interval '5 minutes' order by bl.ts desc limit 1) b1 on true
order by o.ts;
