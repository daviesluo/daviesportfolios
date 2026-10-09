-- 2026-10-09 stablecoin quotes review: mark-outs of every entry and exit fill of the live account and the four twins
-- since the live account's first order (2026-10-01 16:29:53 UTC), at 1, 5, 15 and 60 minutes, in bps of the fill price,
-- signed so that positive is in the fill's favour (a buy: the later price above it). Two marks: the recorded book's mid
-- (agent_book_levels, the newest row at or before the instant and seen at most 120 s before it), and PR5's fair
-- (fair_u / x of the minute record). A fill's instant is filled_at (the turn that read it: up to a minute late for the
-- live account). A recorded book with one side missing or a mid more than 2 % from fair (the recorder keeps a level of
-- 0.0001 or 100 now and then on a thin side) is not a mark: such rows are left out. SELECT only.
with f as (
  select 'live' t, id, book, rung_side, k, leg, side, filled_base, coalesce(avg_fill_price, price) px, price lim, coalesce(filled_at, ts) at from public.agent_quote_live_orders where mode = 'live' and filled_base > 0 and leg in ('entry','exit')
  union all select 'pr5', id, book, rung_side, k, leg, side, filled_base, coalesce(avg_fill_price, price), price, coalesce(filled_at, ts) from public.agent_quote_twin_pr5_orders where mode = 'live' and filled_base > 0 and leg in ('entry','exit') and ts >= '2026-10-01 16:29:53'
  union all select 'p50', id, book, rung_side, k, leg, side, filled_base, coalesce(avg_fill_price, price), price, coalesce(filled_at, ts) from public.agent_quote_twin_p50_orders where mode = 'live' and filled_base > 0 and leg in ('entry','exit') and ts >= '2026-10-01 16:29:53'
  union all select 'take50', id, book, rung_side, k, leg, side, filled_base, coalesce(avg_fill_price, price), price, coalesce(filled_at, ts) from public.agent_quote_twin_take50_orders where mode = 'live' and filled_base > 0 and leg in ('entry','exit') and ts >= '2026-10-01 16:29:53'
  union all select 'd', id, book, rung_side, k, leg, side, filled_base, coalesce(avg_fill_price, price), price, coalesce(filled_at, ts) from public.agent_quote_twin_d_orders where mode = 'live' and filled_base > 0 and leg in ('entry','exit') and ts >= '2026-10-01 16:29:53'),
h as (select unnest(array[0, 1, 5, 15, 60]) hm),
m as (
  select f.*, h.hm,
    (select ((bl.bids->0->>0)::numeric + (bl.asks->0->>0)::numeric) / 2 from public.agent_book_levels bl
      where bl.book = f.book and bl.ts <= f.at + make_interval(mins => h.hm) and bl.seen_until >= f.at + make_interval(mins => h.hm) - interval '120 seconds'
      order by bl.ts desc limit 1) mid0,
    (select qm.fair_u / qm.x from public.agent_quote_minutes qm where qm.book = f.book and qm.minute = date_trunc('minute', f.at + make_interval(mins => h.hm)) - interval '1 minute' and qm.x > 0) fair
  from f cross join h),
m2 as (select m.*, case when abs(m.mid0 / nullif(m.fair, 0) - 1) < 0.02 then m.mid0 end mid,
  (select bool_or(o.filled_base > 0) from public.agent_quote_twin_pr5_orders o where m.t = 'live' and o.paper_oid = lo.paper_oid and o.paper_live = lo.paper_live and o.book = lo.book and o.rung_side = lo.rung_side and o.k = lo.k and o.leg = 'entry') twin_filled
  from m left join public.agent_quote_live_orders lo on m.t = 'live' and lo.id = m.id)
select t || case when t = 'live' and leg = 'entry' then case when filled_base * lim < 1 then ':dust' when twin_filled then ':twin-too' else ':live-only' end else '' end t, leg, hm, count(*) n, count(mid) n_mid,
  round(avg(1e4 * (case when side = 'buy' then mid - lim else lim - mid end) / lim), 2) mo_mid_bps,
  round(avg(1e4 * (case when side = 'buy' then fair - lim else lim - fair end) / lim), 2) mo_fair_bps,
  round(sum((case when side = 'buy' then mid - lim else lim - mid end) * filled_base), 4) mo_mid_gbp,
  round((percentile_cont(0.5) within group (order by 1e4 * (case when side = 'buy' then mid - lim else lim - mid end) / lim))::numeric, 2) med_mid_bps
from m2 group by 1, 2, 3 order by 1, 2, 3;
