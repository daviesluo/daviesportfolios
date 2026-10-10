-- LP-ALLOC: live-prep's live orders (pm_lp_orders, mode live), read-only, one compact line each: cond, outcome, side,
-- price, size, matched, placed and ended (epoch seconds), state. The builder takes them out of the recorded books so the
-- 10-09 record shows the book without our own orders. Padded so the connector saves the reply; scripts/grab.py drops the pad.
select jsonb_build_object('pad', repeat('x', 200000), 'orders', (select string_agg(concat_ws(',', cond, outcome, side, price, size, coalesce(size_matched,0), extract(epoch from ts)::bigint, extract(epoch from coalesce(cancelled_at, filled_at, case when state='live' then now() else updated_at end))::bigint, state), ';' order by ts) from public.pm_lp_orders where mode='live' and state in ('cancelled','filled','live'))) payload
