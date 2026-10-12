-- LP-ADVERSE (2026-10-12): live-prep's live minutes, one compact array a market-minute, read-only, one UTC day per run
-- (:day replaced by '2026-10-09' .. '2026-10-12'). Fields, in order: epoch minute, cond, raw touch bb/ba, size-cutoff
-- touch ab/aa, our resting bid/ask price and size, Polymarket's scoring flags, the minute's formula $, the programme
-- (rate, max spread, min size), tick, the others' scores q1/q2, ours, RW's adjusted mid `m`, held YES/NO, the lp state
-- ('quote' / 'close' ...), pausedUntil, the formula after the turn. Padded so the reply is saved to a file.
select jsonb_build_object('pad', repeat('x', 200000), 'rows', (select jsonb_agg(jsonb_build_array(
  extract(epoch from minute)::bigint, cond, bb, ba, ab, aa, bid_price, ask_price, bid_size, ask_size, bid_scoring, ask_scoring,
  round(formula_usd::numeric, 8), rate, max_spread, min_size, tick, round(q1::numeric, 2), round(q2::numeric, 2), round(ours::numeric, 3),
  detail->'m', detail->'lp'->'held'->'yes', detail->'lp'->'held'->'no', detail->'lp'->>'state', detail->'lp'->>'pausedUntil',
  detail->'after'->'formula') order by minute, cond)
  from public.pm_lp_minutes where mode = 'live' and minute >= :day::date and minute < :day::date + 1)) payload
