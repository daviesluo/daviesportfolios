-- LP-SPEED: every live fill of live-prep with its order's post time, the book it was quoted on, the minute books
-- around it (pm_lp_minutes: the turn's own read, ~:01-:05 into each minute) and the taker trade's shape.
-- Read-only. One CSV line a fill; the header is the first line. Saved as data/fills.csv (scratchpad, then committed).
with f as (
  select f.trade_id, f.hash, f.cond, f.token, f.side as fside, f.price, f.size, f.match_time,
         o.id as oid, o.side as oside, o.outcome, o.gate, o.reason, o.ts,
         (o.response->'readBack'->>'created_at')::bigint as created_s,
         (o.book_seen->>'bestBid')::numeric as seen_bb, (o.book_seen->>'bestAsk')::numeric as seen_ba,
         f.detail->'trade' as tr
  from pm_lp_fills f join pm_lp_orders o on o.hash = f.hash and o.mode = 'live'
), mm as (
  select cond, minute, (bb + ba) / 2 as mid, bb, ba from pm_lp_minutes where mode = 'live'
)
select string_agg(line, E'\n' order by k) from (
select 0 as k, 'trade,rec_id,cond,oid,oside,outcome,gate,reason,price,size,match_s,created_s,ts_s,seen_bb,seen_ba,m0bb,m0ba,m1,m5,m15,m60,makers,maker_prices,taker_side,taker_outcome,taker_price' as line
union all
select extract(epoch from f.match_time)::bigint, concat_ws(',', left(f.trade_id, 8), coalesce(r.id::text, ''), left(f.cond, 12), f.oid, f.oside, f.outcome, f.gate, replace(coalesce(f.reason, ''), ',', ';'), f.price, f.size,
  extract(epoch from f.match_time)::bigint, coalesce(f.created_s::text, ''), round(extract(epoch from f.ts)::numeric, 2), f.seen_bb, f.seen_ba,
  coalesce(m0.bb::text, ''), coalesce(m0.ba::text, ''), coalesce(round(m1.mid, 4)::text, ''), coalesce(round(m5.mid, 4)::text, ''), coalesce(round(m15.mid, 4)::text, ''), coalesce(round(m60.mid, 4)::text, ''),
  jsonb_array_length(f.tr->'maker_orders'),
  (select count(distinct case when x->>'outcome' = 'Yes' then round((x->>'price')::numeric, 3) else round(1 - (x->>'price')::numeric, 3) end) from jsonb_array_elements(f.tr->'maker_orders') x),
  f.tr->>'side', f.tr->>'outcome', round((f.tr->>'price')::numeric, 4))
from f
left join pm_rec_markets r on r.cond = f.cond
left join mm m0 on m0.cond = f.cond and m0.minute = date_trunc('minute', f.match_time)
left join mm m1 on m1.cond = f.cond and m1.minute = date_trunc('minute', f.match_time) + interval '1 minute'
left join mm m5 on m5.cond = f.cond and m5.minute = date_trunc('minute', f.match_time) + interval '5 minute'
left join mm m15 on m15.cond = f.cond and m15.minute = date_trunc('minute', f.match_time) + interval '15 minute'
left join mm m60 on m60.cond = f.cond and m60.minute = date_trunc('minute', f.match_time) + interval '60 minute'
) x;
