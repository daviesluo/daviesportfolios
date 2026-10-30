-- MMCOMP part 5a (2026-10-30, SELECT only, through the Supabase connector): how much of Revolut X's touch is LIVE's own.
-- For every stored book snapshot (agent_book_levels, read about :40 each minute, stored when changed) of USDC-GBP and
-- USDT-GBP from 2026-09-26 to 2026-10-29 00:00 UTC, LIVE's live orders (agent_quote_live_orders, mode 'live', accepted by the
-- venue) resting at that instant at the best bid or best ask price: their size (base_size less what had filled, unknown
-- partials counted whole) against the level's size. Day by day: the share of snapshots in which LIVE rests at the touch,
-- the share of snapshots in which LIVE is the whole touch level, and LIVE's share of the touch's coins. Counts and
-- percentages only; no account size is returned.
with snaps as (
  select book, ts,
         (bids->0->>0)::numeric bb, (bids->0->>1)::numeric bq,
         (asks->0->>0)::numeric ba, (asks->0->>1)::numeric aq
  from agent_book_levels
  where book in ('USDC-GBP','USDT-GBP') and ts >= '2026-09-26' and ts < '2026-10-29'
    and jsonb_array_length(bids) > 0 and jsonb_array_length(asks) > 0),
ours as (
  select s.book, s.ts, s.bq, s.aq,
    coalesce(sum(o.base_size) filter (where o.side = 'buy'  and o.price = s.bb), 0) ob,
    coalesce(sum(o.base_size) filter (where o.side = 'sell' and o.price = s.ba), 0) oa
  from snaps s
  left join agent_quote_live_orders o
    on o.book = s.book and o.mode = 'live' and o.venue_order_id is not null
   and o.ts <= s.ts and coalesce(o.filled_at, o.cancelled_at, 'infinity'::timestamptz) > s.ts
   and o.state not in ('rejected','refused')
  group by s.book, s.ts, s.bq, s.aq)
select book, date_trunc('day', ts)::date d, count(*) snaps,
  round(avg(((ob > 0)::int + (oa > 0)::int) / 2.0), 3) at_touch,          -- share of snapshot-sides where LIVE rests at the touch
  round(avg(((ob >= bq * 0.999)::int + (oa >= aq * 0.999)::int) / 2.0), 3) whole_touch,  -- LIVE is the whole level
  round(sum(least(ob, bq) + least(oa, aq)) / nullif(sum(bq + aq), 0), 4) coin_share
from ours group by 1, 2 order by 1, 2;
