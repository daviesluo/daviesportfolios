-- LP-REFILL (2026-10-10, run about 13:40 UTC): ../lp_alloc/sql/aux.sql unchanged, re-run read-only for the window to 10-10 13:00 UTC.
-- LPSELF: every paper record's settlements (payouts), live-prep's selections and its paper days, read-only. RW-C's tables
-- are not read (RWC-OPT). The reply is cut out with ../rwc_opt/scripts/grab_payload.py into data/aux.json.
with s as (
 select cond, payout, settled_at from public.pm_rw_settlements union all select cond, payout, settled_at from public.pm_lpprep_settlements union all select cond, payout, settled_at from public.pm_prep_settlements
 union all select cond, payout, settled_at from public.pm_midprep_settlements union all select cond, payout, settled_at from public.pm_live_settlements union all select cond, payout, settled_at from public.pm_lp_settlements union all select cond, payout, settled_at from public.pm_mid_settlements)
select jsonb_build_object('pad', repeat('x', 120000), 'settlements', (select jsonb_agg(jsonb_build_object('cond', cond, 'payout', payout, 'settled_at', settled_at)) from (select distinct on (cond) cond, payout, settled_at from s order by cond, settled_at) z),
 'lp_markets', (select jsonb_agg(jsonb_build_object('day', day, 'cond', cond, 'rank', rank, 'kind', kind, 'capital', capital, 'per_dollar_day', per_dollar_day, 'formula_day', formula_day, 'selected_at', selected_at)) from public.pm_lp_markets),
 'lp_days', (select jsonb_agg(to_jsonb(d) - 'detail') from public.pm_lpprep_days d)) payload
