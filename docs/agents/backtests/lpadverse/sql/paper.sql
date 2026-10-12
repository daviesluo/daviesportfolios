-- LP-ADVERSE (2026-10-12): the paper records the live one is compared with, read-only. Live-prep's paper layer
-- (pm_lpprep_*, 10-04 -> the go on 10-09) and RW-C (pm_rwc_*, 10-08 ->, RW's rule on RW's universe, still running):
-- their closed days and every fill (a paper fill is a public print strictly through the quote, at the quote's price).
-- RW-C's minutes come from sql/rwc_minutes.sql and live-prep paper's from sql/lpprep_minutes.sql. Padded; no secret.
select jsonb_build_object('pad', repeat('x', 200000),
 'lpprep_days', (select jsonb_agg(to_jsonb(d) - 'detail') from public.pm_lpprep_days d),
 'rwc_days', (select jsonb_agg(to_jsonb(d) - 'detail') from public.pm_rwc_days d),
 'lpprep_fills', (select jsonb_agg(jsonb_build_array(cond, extract(epoch from minute)::bigint, extract(epoch from ts)::bigint, side, price, size, token_side, token_price, close_only)) from public.pm_lpprep_fills),
 'rwc_fills', (select jsonb_agg(jsonb_build_array(cond, extract(epoch from minute)::bigint, extract(epoch from ts)::bigint, side, price, size)) from public.pm_rwc_fills),
 'rwc_sel', (select jsonb_agg(jsonb_build_array(day, cond, rank, rate, v, min_size, tick, q, end_date)) from public.pm_rwc_selection),
 'lp_dry_sel', (select jsonb_agg(jsonb_build_array(day, cond, rank, reward_rate, max_spread, min_size, tick, question, end_date)) from public.pm_lp_markets where day < '2026-10-09')
) payload
