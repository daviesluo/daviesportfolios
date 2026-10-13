-- LP-BEST (2026-10-13): pm-rec's market metadata, read-only: question, end date, game start, fee type, category,
-- neg-risk and event for every market, by its pm-rec id (the daily dumps leave the question out of many rows). Padded so
-- the connector saves the reply to a file; no secret.
select jsonb_build_object('pad', repeat('x', 200000), 'rows', (select jsonb_agg(jsonb_build_array(id, question, end_date, game_start,
  fee_type, category, neg_risk, event_slug)) from public.pm_rec_markets)) payload
