-- IGBOT's reading: the export `score.mjs` reads (docs/agents/reviews/2026-10-29-igbot-prereg.md §6). Read-only; run it at
-- the end through the Supabase connector or psql and save the one JSON value it returns as igbot_export.json, then
--   node docs/agents/backtests/igbot/score.mjs igbot_export.json
-- Every row of the igbot_* tables it needs, nothing of any other strategy and no secret.
select json_build_object(
  'started_at', (select started_at from public.igbot_config where id = 1),
  'total_stop_hit', (select coalesce(state -> 'totalStop' is not null and state -> 'totalStop' <> 'null'::jsonb, false) from public.igbot_exec_state where id = 1),
  'decisions', (select coalesce(json_agg(d order by d.ts, d.id), '[]'::json) from (
    select id, ts, action, category, epic, direction, level, stop_level, limit_level, p_target
    from public.igbot_decisions where action in ('open', 'no_action')) d),
  'orders', (select coalesce(json_agg(o order by o.id), '[]'::json) from (
    select id, decision_id, kind, mode, state, deal_id, checks -> 'bid' as bid, checks -> 'offer' as offer
    from public.igbot_orders where kind in ('open', 'working')) o),
  'amended', (select coalesce(json_agg(distinct deal_id), '[]'::json) from public.igbot_orders where kind = 'amend' and state = 'accepted' and deal_id is not null),
  'positions', (select coalesce(json_agg(p order by p.opened_at), '[]'::json) from (
    select deal_id, decision_id, epic, direction, open_level, stop_level, limit_level, opened_at, closed_at, close_how, state
    from public.igbot_positions) p),
  'bars', (select coalesce(json_agg(b order by b.epic, b.hour), '[]'::json) from (
    select epic, hour, fetched_at, bid_open, bid_high, bid_low, ask_open, ask_high, ask_low from public.igbot_bars) b),
  'snapshots', (select coalesce(json_agg(s order by s.slot), '[]'::json) from (
    select slot, equity_gbp from public.igbot_snapshots where ok) s)
) as export;
