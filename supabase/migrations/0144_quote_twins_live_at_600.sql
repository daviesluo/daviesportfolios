-- 0144: LIVE went to £600 (2026-10-27 03:09 UTC), so its twin is the £600 one, and variant-1 tests the next step, £1,200
-- (docs/agents/reviews/2026-10-27-live-next-size-prereg.md; the size twins' pre-registration's deviation 1,
-- docs/agents/reviews/2026-10-26-live-size-twins-prereg.md §7; the reasoning, docs/agents/reviews/2026-10-26-stablecoin-quotes-review.md §8).
--
-- On whose word. Davies, 2026-10-27: "我已经加到600了，你验证下并检查确保策略所有细节都没问题，然后把测试的Stablecoin quotes LIVE twin改为600，
-- Stablecoin quotes variant-1改为你仔细研究下下次加仓的目标仓位本金的测试，所有数据都可以看" (I have added up to 600; check every detail of the
-- strategy, then make the LIVE twin in testing 600, and make variant-1 a test of the capital for the next step, researched with
-- every record).
--
-- What it does, in this order (page names are unique, so each rename frees the name the next row takes):
--   1. The £300 twin (`live300`) is renamed "Stablecoin quotes 300 twin" and switched off: LIVE went from £120 straight to
--      £600, so nothing reads a £300 row. Its rows, tables and record (2026-10-27 00:00 to this migration) stay.
--   2. The £600 twin (`live600`, LIVE's rules at £50 a rung since 2026-10-27 00:00) is renamed "Stablecoin quotes LIVE twin".
--      It is LIVE's size now. Nothing else of it changes: its capital, rules, start and record are as 0141 made them, and its
--      own reading (per pound at least 80 % of the £120 twin's, 10-28 to 11-11) runs as registered.
--   3. A new twin on LIVE's rules at the next step, "Stablecoin quotes variant-1" (`live1200`, £1,200, £100 a rung): the £600
--      twin's row but for the id, name, place, capital, tables, lease, start, rules' dates and pre-registration. It starts flat
--      at 2026-10-28 00:00 UTC, the operator's maker conversions at its first turn, with LIVE's fill rule from its start and
--      LIVE's weekend from the closure of 2026-10-30 21:00, as the £600 twin.
-- No twin is resized: a row's capital never changes inside its record, so each reading stays the one its rows registered.
--
-- Its time. No new call: 0087's `agents?action=quotestwins` runs the enabled rows, seven before and seven after (one off, one
-- added), under the same lease and budget.
--
-- What it leaves alone: the live executor, its config (capital, take_mode, weekend_mode) and its tables; PR5's paper engine and
-- every reading of it; every other twin; the Coinbase tests; `edge_calls` and every cron job. No grant and no policy.

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes 300 twin'
 where id = 'live300' and display_name = 'Stablecoin quotes LIVE twin';
update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes LIVE twin'
 where id = 'live600' and display_name = 'Stablecoin quotes variant-1';

update public.agent_quote_twin_specs
   set enabled = false
 where id = 'live300';

insert into public.agent_quote_twin_specs
select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[
  { "id": "live1200", "display_name": "Stablecoin quotes variant-1", "display_order": 13, "engine": "pr5", "capital_gbp": 1200, "gov": "account", "start": "2026-10-28T00:00:00Z", "table_prefix": "agent_quote_twin_live1200", "lease": "quotes-twin-live1200", "rules": { "fill": { "model": "at", "from": "2026-10-28T00:00:00Z" }, "weekend": { "from": "2026-10-30T21:00:00Z" } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-live-next-size-prereg.md", "migration": "0144", "enabled": true }
]$json$::jsonb)
on conflict (id) do nothing;
select public.create_quote_twin_tables('live1200');
