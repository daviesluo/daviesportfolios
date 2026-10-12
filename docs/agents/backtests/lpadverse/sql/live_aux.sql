-- LP-ADVERSE (2026-10-12): live-prep's selections, payouts, settlements and live events, read-only. Padded so the reply
-- is saved to a file. No secret, no URL. pm_rec_markets gives each condition's question, end date and category.
select jsonb_build_object('pad', repeat('x', 200000),
 'markets', (select jsonb_agg(jsonb_build_object('day', day, 'cond', cond, 'rank', rank, 'question', question, 'rate', reward_rate,
   'max_spread', max_spread, 'min_size', min_size, 'n', n_size, 'tick', tick, 'formula_day', formula_day, 'per_dollar_day', per_dollar_day,
   'capital', capital, 'end_date', end_date, 'game_start', game_start, 'selected_at', selected_at, 'refill', detail ? 'refill', 'yes_token', yes_token, 'no_token', no_token)) from public.pm_lp_markets),
 'reward_days', (select jsonb_agg(jsonb_build_object('day', day, 'cond', cond, 'minutes', minutes, 'two', minutes_two_sided, 'scored', minutes_scored,
   'formula', formula_usd, 'formula_scored', formula_scored_usd, 'rate', rate, 'paid', actual_usd, 'sponsored', actual_sponsored_usd, 'rebate', rebate_usd)) from public.pm_lp_reward_days where mode = 'live'),
 'settlements', (select jsonb_agg(jsonb_build_object('cond', cond, 'yes_token', yes_token, 'no_token', no_token, 'payout', payout, 'closed_time', closed_time, 'settled_at', settled_at)) from public.pm_lp_settlements),
 'events', (select jsonb_agg(jsonb_build_object('minute', minute, 'kind', kind, 'detail', detail) order by minute) from public.pm_lp_events where mode = 'live' and kind not in ('post', 'cancel')),
 'event_kinds', (select jsonb_object_agg(kind, n) from (select kind, count(*) n from public.pm_lp_events where mode = 'live' group by kind) k),
 'recmeta', (select jsonb_agg(jsonb_build_object('id', r.id, 'cond', r.cond, 'yes', r.yes, 'no', r.no, 'question', r.question, 'event_slug', r.event_slug, 'end_date', r.end_date, 'category', r.category, 'neg_risk', r.neg_risk, 'volume24hr', r.volume24hr, 'closed', r.closed))
   from public.pm_rec_markets r where r.cond in (select cond from public.pm_lp_markets union select cond from public.pm_lp_fills))
) payload
