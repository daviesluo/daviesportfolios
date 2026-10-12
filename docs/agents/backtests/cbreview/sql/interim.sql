-- The Coinbase paper test's interim figures and the by-hand checks of its rule, read-only (select only), as run on 2026-10-12
-- ~23:20 UTC for docs/agents/reviews/2026-10-12-coinbase-first-days.md, sections 2-3. Not blind, descriptive, no verdict.
-- The window is 2026-10-11 00:00 -> 11-08 00:00 UTC; the engine was dark until 10-11 23:01 (the interbank closure).

-- per book: round trips, won, P&L in pounds (a EUR book's at its pounds per euro when the trip closed), mean hold
select book, count(*) trips, count(*) filter (where pnl_gbp > 0) won, round(sum(pnl_gbp)::numeric, 4) pnl_gbp, round(sum(notional_gbp)::numeric, 2) notional_gbp,
       round(avg(extract(epoch from t_exit - fill_ts) / 3600)::numeric, 2) mean_hold_h
from public.cb_quote_trips group by 1 order by 1;
-- per rung (side, k)
select book, side, k, count(*) trips, round(sum(pnl_gbp)::numeric, 4) pnl_gbp from public.cb_quote_trips group by 1, 2, 3 order by 1, 2, 3;
-- every trip
select book, side, k, t_entry, fill_ts, fill_trade_id, entry, qty, x_entry, fair_entry, t_exit, exit, how, exit_trade_id, notional_gbp, pnl_gbp
from public.cb_quote_trips order by t_entry;
-- the events by kind, and the days view (the page's)
select kind, count(*), min(minute), max(minute) from public.cb_quote_events group by 1 order by 1;
select * from public.cb_quote_days order by day;
-- what is held now (inventory): every rung's mode; 'position' is a held rung
select b.key as book, r->>'side' side, r->>'k' k, r->>'mode' mode, r->'o'->>'ticks' ticks, r->'o'->>'state' order_state
from public.cb_quote_state s, jsonb_each(s.state->'books') b, jsonb_array_elements(b.value->'rungs') r order by 1, 2, 3;

-- entry orders placed in the window, counted as each (book, rung, price) lifetime between placements: how many met a print
-- through them, and how many only a print AT their price (which the rule, and so the engine, does not fill)
with ev as (
  select book, side, k, minute, ticks, case when book = 'USDT-EUR' then ticks / 100000.0 else ticks / 10000.0 end px,
         lead(minute) over (partition by book, side, k, detail->>'leg' order by minute) next_min
  from public.cb_quote_events where kind = 'order' and detail->>'leg' = 'entry'),
iv as (select *, coalesce(next_min, now()) endm from ev where minute >= '2026-10-11 23:01'),
f as (select iv.*,
        (select count(*) from public.cb_trades c where c.product = iv.book and c.ts >= iv.minute + interval '1 minute' and c.ts < iv.endm + interval '1 minute' and c.price = iv.px) at_prints,
        (select coalesce(sum(c.size), 0) from public.cb_trades c where c.product = iv.book and c.ts >= iv.minute + interval '1 minute' and c.ts < iv.endm + interval '1 minute' and c.price = iv.px) at_size,
        (select count(*) from public.cb_trades c where c.product = iv.book and c.ts >= iv.minute + interval '1 minute' and c.ts < iv.endm + interval '1 minute'
           and ((iv.side = 'ask' and c.price > iv.px) or (iv.side = 'bid' and c.price < iv.px))) thru_prints
      from iv)
select book, count(*) order_lifetimes, count(*) filter (where thru_prints > 0) with_print_through, count(*) filter (where at_prints > 0 and thru_prints = 0) with_print_at_only,
       round(sum(at_size) filter (where at_prints > 0 and thru_prints = 0)::numeric, 0) coins_at_price_only
from f group by 1 order by 1;

-- BY HAND: each entry fill must be the first print strictly through the resting price after the order went live (the minute
-- after its last placement at that price); each exit likewise, after the position was filled. `same` must be true on every row.
with tr as (select t.*, case when book = 'USDT-EUR' then 100000 else 10000 end sc from public.cb_quote_trips t),
ent as (select tr.book, tr.side, tr.k, tr.t_entry, tr.fill_trade_id, tr.entry,
          (select max(e.minute) from public.cb_quote_events e where e.book = tr.book and e.side = tr.side and e.k = tr.k and e.kind = 'order'
             and e.ticks = round(tr.entry * tr.sc) and e.detail->>'leg' = 'entry' and e.minute <= tr.t_entry) placed
        from tr)
select ent.book, ent.side, ent.k, ent.placed, ent.t_entry, ent.fill_trade_id,
       (select c.trade_id from public.cb_trades c where c.product = ent.book and c.ts >= ent.placed + interval '1 minute'
          and ((ent.side = 'ask' and c.price > ent.entry) or (ent.side = 'bid' and c.price < ent.entry)) order by c.trade_id limit 1) first_through_id
from ent order by t_entry;
with tr as (select t.*, case when book = 'USDT-EUR' then 100000 else 10000 end sc from public.cb_quote_trips t),
ex as (select tr.*, (select max(e.minute) from public.cb_quote_events e where e.book = tr.book and e.side = tr.side and e.k = tr.k and e.kind = 'order'
         and e.ticks = round(tr.exit * tr.sc) and e.detail->>'leg' = 'exit' and e.minute <= tr.t_exit and e.minute >= tr.t_entry) placed from tr)
select ex.book, ex.side, ex.k, ex.placed, ex.t_exit, ex.exit_trade_id,
       (select c.trade_id from public.cb_trades c where c.product = ex.book and c.ts >= greatest(ex.placed + interval '1 minute', ex.fill_ts)
          and ((ex.side = 'ask' and c.price < ex.exit) or (ex.side = 'bid' and c.price > ex.exit)) order by c.trade_id limit 1) first_through_id
from ex order by t_exit;
-- the prints through each entry price, in coins, in the fill's minute, 10 minutes and an hour, against the rung's own coins
select t.book, t.side, t.k, t.fill_ts, t.entry, round(t.qty::numeric, 1) rung_coins,
       (select round(sum(c.size)::numeric, 2) from public.cb_trades c where c.product = t.book and c.ts >= t.fill_ts and c.ts < t.fill_ts + interval '1 minute'
          and ((t.side = 'ask' and c.price > t.entry) or (t.side = 'bid' and c.price < t.entry))) through_coins_1m,
       (select round(sum(c.size)::numeric, 2) from public.cb_trades c where c.product = t.book and c.ts >= t.fill_ts and c.ts < t.fill_ts + interval '10 minutes'
          and ((t.side = 'ask' and c.price > t.entry) or (t.side = 'bid' and c.price < t.entry))) through_coins_10m
from public.cb_quote_trips t order by t.fill_ts;

-- where the prints sit against the engine's fair, in bps, since the first lit minute (the book's standing offset and how far it strays)
select t.product, count(*) n, round((avg(t.price / m.fair - 1) * 10000)::numeric, 2) mean_bps,
       round((percentile_cont(0.05) within group (order by t.price / m.fair - 1) * 10000)::numeric, 2) p05,
       round((percentile_cont(0.5) within group (order by t.price / m.fair - 1) * 10000)::numeric, 2) p50,
       round((percentile_cont(0.95) within group (order by t.price / m.fair - 1) * 10000)::numeric, 2) p95,
       round((max(t.price / m.fair - 1) * 10000)::numeric, 1) mx, round((min(t.price / m.fair - 1) * 10000)::numeric, 1) mn
from public.cb_trades t join public.cb_quote_minutes m on m.book = t.product and m.minute = date_trunc('minute', t.ts) and m.fair is not null
where t.ts >= '2026-10-11 23:01' group by 1 order by 1;
-- the same for Revolut X's two books (PR5's minute record has the pair as fair_u and x)
select t.book, count(*) n, round((avg(t.price / (m.fair_u / m.x) - 1) * 10000)::numeric, 2) mean_bps,
       round((percentile_cont(0.5) within group (order by t.price / (m.fair_u / m.x) - 1) * 10000)::numeric, 2) p50,
       round((max(t.price / (m.fair_u / m.x) - 1) * 10000)::numeric, 1) mx, round((min(t.price / (m.fair_u / m.x) - 1) * 10000)::numeric, 1) mn
from public.agent_quote_prints t join public.agent_quote_minutes m on m.book = t.book and m.minute = date_trunc('minute', t.ts) and m.x is not null and m.fair_u is not null
where t.ts >= '2026-10-11 23:01' group by 1 order by 1;
-- print counts, both venues, same hours
select 'coinbase' venue, product as book, count(*) prints from public.cb_trades where ts >= '2026-10-11 23:01' group by 2
union all select 'revolut x', book, count(*) from public.agent_quote_prints where ts >= '2026-10-11 23:01' group by 2 order by 1, 2;

-- Revolut X over the same hours: PR5's paper engine, the twins and the live executor (orders by leg and state; the filled ones)
select book, count(*) trips, round(sum(pnl_usd)::numeric, 4) pnl, round(sum(notional_usd)::numeric, 2) notional from public.agent_quote_trips where t_entry >= '2026-10-11 23:01' group by 1;
select kind, book, count(*) from public.agent_quote_events where minute >= '2026-10-11 23:01' group by 1, 2 order by 2, 1;
select 'twin pr5' src, leg, state, count(*) n, round(sum(filled_base * avg_fill_price)::numeric, 2) gbp_filled from public.agent_quote_twin_pr5_orders where ts >= '2026-10-11 23:00' group by 2, 3
union all select 'twin p50', leg, state, count(*), round(sum(filled_base * avg_fill_price)::numeric, 2) from public.agent_quote_twin_p50_orders where ts >= '2026-10-11 23:00' group by 2, 3
union all select 'twin take50', leg, state, count(*), round(sum(filled_base * avg_fill_price)::numeric, 2) from public.agent_quote_twin_take50_orders where ts >= '2026-10-11 23:00' group by 2, 3
union all select 'twin d', leg, state, count(*), round(sum(filled_base * avg_fill_price)::numeric, 2) from public.agent_quote_twin_d_orders where ts >= '2026-10-11 23:00' group by 2, 3
union all select 'live', leg, state, count(*), round(sum(filled_base * avg_fill_price)::numeric, 2) from public.agent_quote_live_orders where ts >= '2026-10-11 23:00' group by 2, 3 order by 1, 2, 3;
select ts, book, rung_side, k, leg, side, price, filled_base, avg_fill_price, fee_gbp, filled_at from public.agent_quote_twin_pr5_orders where state = 'filled' and ts >= '2026-10-11 23:00' order by ts;
select ts, book, rung_side, k, leg, side, price, filled_base, avg_fill_price, fee_gbp, filled_at from public.agent_quote_live_orders where state = 'filled' and ts >= '2026-10-11 23:00' order by ts;
