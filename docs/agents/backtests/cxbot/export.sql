-- CXBOT's reading: the export `score.mjs` reads (docs/agents/reviews/2026-10-29-cxbot-phase1-prereg.md §6). Read-only; run it
-- at the end through the Supabase connector or psql and save the one JSON value it returns as cxbot_export.json, then
--   node docs/agents/backtests/cxbot/score.mjs cxbot_export.json
-- Every row of the cxbot_* tables it needs (the tape of the test's venue, from the start to eight days past the end so
-- every bracket can resolve), nothing of any other strategy and no secret.
with cfg as (select * from public.cxbot_config where id = 1)
select json_build_object(
  'started_at', (select started_at from cfg),
  'ended_at', (select ended_at from cfg),
  'budget_usd', (select budget_usd from cfg),
  'total_stop_hit', (select coalesce(state -> 'totalStop' is not null and state -> 'totalStop' <> 'null'::jsonb, false) from public.cxbot_exec_state where id = 1),
  'questions', (select coalesce(json_agg(q order by q.issued_at, q.id), '[]'::json) from (
    select id, layer, issued_at, deadline, coin, direction, hold_ms, start_at, entry, stop, limit_px, m, pm_slug, pm_end, pm_mid, pm_last, deribit_p, state, y, y_alt
    from public.cxbot_questions) q),
  'forecasts', (select coalesce(json_agg(f order by f.question_id), '[]'::json) from (select question_id, p, received_at from public.cxbot_forecasts) f),
  'decisions', (select coalesce(json_agg(d order by d.received_at, d.id), '[]'::json) from (
    select id, ts, received_at, action, category, coin, direction, entry, stop, limit_px, p from public.cxbot_decisions where action in ('open', 'no_action')) d),
  'positions', (select coalesce(json_agg(p order by p.id), '[]'::json) from (
    select id, decision_id, coin, direction, entry, stop0, limit0, p, opened_at, closed_at, close_how, pnl_usd from public.cxbot_positions) p),
  'snapshots', (select coalesce(json_agg(s order by s.slot), '[]'::json) from (select slot, equity_usd from public.cxbot_snapshots) s),
  'tape', (select coalesce(json_agg(t order by t.coin, t.t), '[]'::json) from (
    select coin, t, o, h, l, c from public.cxbot_tape, cfg
    where cxbot_tape.venue = cfg.venue and cxbot_tape.c is not null
      and cxbot_tape.t >= cfg.started_at and cxbot_tape.t < coalesce(cfg.ended_at, now()) + interval '8 days') t)
) as export;
