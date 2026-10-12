-- LP-ADVERSE (2026-10-12): every live fill of "Reward quotes live-prep" with the order it filled, read-only.
-- pm_lp_fills (CONFIRMED trades where our order was a maker) joined to pm_lp_orders (mode 'live') on the order hash:
-- the order's post time `ts`, its price/size/gate/reason, the book it was decided on (`book_seen`), and from the trade
-- record the taker's whole size and how many maker orders and price levels it took (a sweep or a single hit), and each
-- maker order it took (outcome, side, price, shares, whether it was ours).
-- The reply is padded so the connector saves it to a file; it holds no secret and no URL.
select jsonb_build_object('pad', repeat('x', 200000), 'rows', (select jsonb_agg(jsonb_build_object(
  'trade_id', f.trade_id, 'hash', f.hash, 'cond', f.cond, 'token', f.token, 'side', f.side, 'price', f.price, 'size', f.size,
  'status', f.status, 'match_time', f.match_time,
  'taker_size', (f.detail->'trade'->>'size')::numeric, 'taker_side', f.detail->'trade'->>'side', 'taker_price', (f.detail->'trade'->>'price')::numeric,
  'taker_outcome', f.detail->'trade'->>'outcome', 'trader_side', f.detail->'trade'->>'trader_side',
  'fee_bps', f.detail->'trade'->>'fee_rate_bps',
  'n_makers', jsonb_array_length(coalesce(f.detail->'trade'->'maker_orders', '[]'::jsonb)),
  'maker_prices', (select jsonb_agg(distinct (m->>'price')) from jsonb_array_elements(coalesce(f.detail->'trade'->'maker_orders', '[]'::jsonb)) m),
  'makers', (select jsonb_agg(jsonb_build_array(m->>'outcome', m->>'side', (m->>'price')::numeric, (m->>'matched_amount')::numeric, (m->>'order_id') = f.hash)) from jsonb_array_elements(coalesce(f.detail->'trade'->'maker_orders', '[]'::jsonb)) m),
  'o_id', o.id, 'o_ts', o.ts, 'o_outcome', o.outcome, 'o_side', o.side, 'o_price', o.price, 'o_size', o.size, 'o_state', o.state,
  'o_matched', o.size_matched, 'o_filled_at', o.filled_at, 'o_gate', o.gate, 'o_reason', o.reason, 'o_book', o.book_seen
) order by f.match_time) from public.pm_lp_fills f left join public.pm_lp_orders o on o.hash = f.hash and o.mode = 'live')) payload
