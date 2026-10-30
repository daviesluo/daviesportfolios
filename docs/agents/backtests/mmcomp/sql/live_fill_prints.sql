-- MMCOMP-2 part B (2026-10-30, SELECT only, through the Supabase connector): the stored public prints that filled LIVE's own
-- orders on Revolut X (agent_quote_live_orders, mode 'live', filled_base > 0), so the inner-rung replay can take them out of
-- the tape. A print fills an order when it is on the other side, at the order's price, inside the order's life, and the
-- order's prints are taken in time order until they cover its filled size. The answer (print ids, one payload) is NOT
-- committed: with the tape it would give LIVE's fill sizes. It is saved outside the repository and handed to
-- scripts/inner_rung2.py as $MM_LIVE_PRINTS. Rows to 2026-10-29 00:00 UTC.
with o as (
  select id, book, side, price, filled_base, ts, coalesce(filled_at, cancelled_at, updated_at) + interval '5 seconds' te
  from agent_quote_live_orders where mode = 'live' and coalesce(filled_base, 0) > 0 and ts < '2026-10-29'),
c as (
  select o.id oid, o.filled_base, p.id pid, p.qty,
         sum(p.qty) over (partition by o.id order by p.ts, p.id) - p.qty before_qty
  from o join agent_quote_prints p
    on p.book = o.book and p.price = o.price and p.side = case when o.side = 'buy' then 'sell' else 'buy' end
   and p.ts >= o.ts and p.ts <= o.te)
select json_build_object('table', 'live_prints', 'n', count(*), 'md5', md5(string_agg(pid, E'\n' order by pid)),
                         'text', string_agg(pid, E'\n' order by pid)) payload
from (select distinct pid from c where before_qty < filled_base - 1e-9) s;
