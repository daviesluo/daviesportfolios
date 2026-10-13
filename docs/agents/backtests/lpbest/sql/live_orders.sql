-- LP-BEST (2026-10-13): every live order of "Reward quotes live-prep" with its resting interval, read-only: when it
-- was posted (`ts`), when its cancel was asked and done, when it filled, its state, outcome, side, price and size. The
-- simulator's replay of live rests exactly these orders. Padded so the connector saves the reply to a file; no secret.
select jsonb_build_object('pad', repeat('x', 200000), 'rows', (select jsonb_agg(jsonb_build_array(
  cond, extract(epoch from ts)::numeric(14,3), outcome, side, price, size, state, size_matched,
  extract(epoch from filled_at)::numeric(14,3), extract(epoch from cancel_requested_at)::numeric(14,3),
  extract(epoch from cancelled_at)::numeric(14,3), extract(epoch from updated_at)::numeric(14,3), expiration, hash) order by ts)
  from public.pm_lp_orders where mode = 'live')) payload
