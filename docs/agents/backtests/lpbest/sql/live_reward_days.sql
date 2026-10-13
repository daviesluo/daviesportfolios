-- LP-BEST (2026-10-13): live-prep's live reward days with 10-12's payout (read at 10-13 00:05), whether any live fill
-- came after LP-ADVERSE's "now" (10-12 22:49), and the settlements, read-only. Padded so the connector saves the reply.
select jsonb_build_object('pad', repeat('x', 200000),
 'reward_days', (select jsonb_agg(jsonb_build_object('day', day, 'cond', cond, 'minutes', minutes, 'two', minutes_two_sided,
   'scored', minutes_scored, 'formula', formula_usd, 'formula_scored', formula_scored_usd, 'rate', rate, 'paid', actual_usd,
   'sponsored', actual_sponsored_usd, 'rebate', rebate_usd, 'read_at', read_at)) from public.pm_lp_reward_days where mode = 'live'),
 'fills_after', (select count(*) from public.pm_lp_fills where match_time > '2026-10-12 22:49'),
 'settlements', (select jsonb_agg(to_jsonb(s)) from public.pm_lp_settlements s)) payload
