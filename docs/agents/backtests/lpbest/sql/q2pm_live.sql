-- Q2-PM (2026-10-14): live-prep's live record over Q2's first day, read-only, for scripts/q2pm.py. Each reply is padded so
-- the connector saves it to a file; LP-ADVERSE's scripts/unwrap.py turns it into JSON (no secret, no signed URL). Run
-- 2026-10-14 ~02:35 UTC. The live orders' reply keeps three columns past sql/live_orders.sql's fourteen (q2pm_data.py's
-- folder takes the first fourteen for the engine).
-- 1. live_aux.json: the fills since 13:00, the picks of 10-13 and 10-14, the events, the gates, the reward days, the settlements
select jsonb_build_object('pad', repeat('x', 200000),
 'fills', (select jsonb_agg(to_jsonb(f) - 'detail' || jsonb_build_object('trader_side', f.detail->'trade'->>'trader_side', 'fee_bps', f.detail->'trade'->>'fee_rate_bps')) from pm_lp_fills f where f.match_time >= '2026-10-13 13:00'),
 'markets', (select jsonb_agg(to_jsonb(m) - 'detail') from pm_lp_markets m where m.day >= '2026-10-13'),
 'events', (select jsonb_agg(to_jsonb(e)) from pm_lp_events e where e.minute >= '2026-10-13 13:20' and e.kind <> 'gates'),
 'gates', (select jsonb_agg(jsonb_build_object('minute', e.minute, 'blocked', e.detail->>'openBlockedBy')) from pm_lp_events e where e.minute >= '2026-10-13 13:20' and e.kind = 'gates'),
 'reward_days', (select jsonb_agg(to_jsonb(r) - 'detail') from pm_lp_reward_days r where r.day >= '2026-10-13'),
 'settlements', (select jsonb_agg(to_jsonb(s) - 'detail') from pm_lp_settlements s)) payload;
-- 2. live_minutes.json.gz: every live minute since the restart, one row a market
select jsonb_build_object('pad', repeat('x', 200000), 'rows', (select jsonb_agg(jsonb_build_array(extract(epoch from minute)::bigint, cond, rate,
  max_spread, min_size, tick, bb, ba, ab, aa, bid_price, bid_size, ask_price, ask_size, bid_scoring, ask_scoring, formula_usd, pct,
  detail->'lp'->>'state', detail->'lp'->'held', detail->'reward'->>'out', detail->'lp'->>'pausedUntil', detail->'lp'->>'exitThroughPause',
  detail->'orders', detail->'reward'->>'rate') order by minute, cond) from pm_lp_minutes where mode = 'live' and minute >= '2026-10-13 13:25')) payload;
-- 3. live_orders.json.gz: every live order
select jsonb_build_object('pad', repeat('x', 200000), 'rows', (select jsonb_agg(jsonb_build_array(
  cond, extract(epoch from ts)::numeric(14,3), outcome, side, price, size, state, size_matched,
  extract(epoch from filled_at)::numeric(14,3), extract(epoch from cancel_requested_at)::numeric(14,3),
  extract(epoch from cancelled_at)::numeric(14,3), extract(epoch from updated_at)::numeric(14,3), expiration, hash, gate, cancel_gate, cancel_reason) order by ts)
  from public.pm_lp_orders where mode = 'live')) payload;
-- 4. the archive objects past Q2-AGE's download (scripts/fetch.py), the URLs never printed or committed
select jsonb_build_object('pad', repeat('x', 200000), 'rows', (select jsonb_agg(jsonb_build_object('hour', hour, 'kind', kind,
  'sha256', sha256, 'bytes', bytes, 'url', url) order by kind, hour) from public.pm_rec_archive
  where (kind in ('books', 'prints', 'universe') and hour >= '2026-10-13 13:00') or (kind = 'markets' and hour >= '2026-10-14'))) payload;
