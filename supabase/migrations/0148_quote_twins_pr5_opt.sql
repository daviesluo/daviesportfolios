-- 0148: PR5-OPT's three twins on LIVE's rules, each one change against the £600 LIVE twin (`live600`)
-- (docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md; the study, docs/agents/reviews/2026-10-27-pr5-rules-optimisation.md §4).
--
-- On whose word. Davies, 2026-10-27: "你在做一些策略优化的研究，看看目前live的策略是所有已知信息和推算所得出的最佳rules吗，还有没有哪些可以优化的地方，
-- 还有哪些可以值得研究和测试的地方（比如每个%不同的档挂单钱数不同？不同的档位%？不同的细分rules等等）" (is LIVE's rule set the best
-- known, what could be improved, and what is worth researching and testing: different pounds at each %, different rungs, finer
-- rules); the study's three recommended twins, built the same day.
--
-- What it does, in this order (page names are unique, so the rename frees the name the first new row takes):
--   1. Rule D's twin (`d`, hidden since 0141, its readout after 2026-10-28) gives up "variant-4": "Stablecoin quotes rule-D twin".
--      Nothing else of it changes.
--   2. Three rows, each LIVE's rules at £600 (PR5's engine, one key, LIVE's fill rule and weekend from their start, no take) with
--      one change, starting flat at 2026-10-29 00:00 UTC (after the 10-28 readouts), the operator's maker conversions at the first
--      turn:
--        `live600usdt2` "Stablecoin quotes variant-4": `weights.book`, USDT-GBP's rungs twice USDC-GBP's (£66.66 and £33.33 a
--                       rung, each floored to the penny);
--        `live600no03`  "Stablecoin quotes variant-5": `weights.k`, no entry on the 0.3 % rungs, £75 on each of the other eight;
--        `live600hold1` "Stablecoin quotes variant-6": `holdMin`, a rung counts as holding only above £1 of coin.
--      The rules `weights` and `holdMin` are code of agents/quotes_twin.ts and options of agents/quotes_live.ts that the live
--      account's instance does not have (pinned in quotes_live_instance.test.ts).
--
-- Its time. No new call: 0087's `agents?action=quotestwins` runs the enabled rows, nine with these three until the 10-28 readouts
-- switch `pr5`, `p50` and `d` off, under the same lease and budget.
--
-- What it leaves alone: the live executor, its config and its tables; PR5's paper engine and every reading of it; every other
-- twin's row; the Coinbase tests; `edge_calls` and every cron job. No grant and no policy.

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes rule-D twin'
 where id = 'd' and display_name = 'Stablecoin quotes variant-4';

insert into public.agent_quote_twin_specs
select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[
  { "id": "live600usdt2", "display_name": "Stablecoin quotes variant-4", "display_order": 31, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-29T00:00:00Z", "table_prefix": "agent_quote_twin_live600usdt2", "lease": "quotes-twin-live600usdt2", "rules": { "fill": { "model": "at", "from": "2026-10-29T00:00:00Z" }, "weekend": { "from": "2026-10-29T00:00:00Z" }, "weights": { "from": "2026-10-29T00:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 2 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md", "migration": "0148", "enabled": true },
  { "id": "live600no03", "display_name": "Stablecoin quotes variant-5", "display_order": 32, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-29T00:00:00Z", "table_prefix": "agent_quote_twin_live600no03", "lease": "quotes-twin-live600no03", "rules": { "fill": { "model": "at", "from": "2026-10-29T00:00:00Z" }, "weekend": { "from": "2026-10-29T00:00:00Z" }, "weights": { "from": "2026-10-29T00:00:00Z", "k": { "0.001": 1, "0.002": 1, "0.003": 0 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md", "migration": "0148", "enabled": true },
  { "id": "live600hold1", "display_name": "Stablecoin quotes variant-6", "display_order": 33, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-29T00:00:00Z", "table_prefix": "agent_quote_twin_live600hold1", "lease": "quotes-twin-live600hold1", "rules": { "fill": { "model": "at", "from": "2026-10-29T00:00:00Z" }, "weekend": { "from": "2026-10-29T00:00:00Z" }, "holdMin": { "from": "2026-10-29T00:00:00Z", "gbp": 1 } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md", "migration": "0148", "enabled": true }
]$json$::jsonb)
on conflict (id) do nothing;
select public.create_quote_twin_tables('live600usdt2');
select public.create_quote_twin_tables('live600no03');
select public.create_quote_twin_tables('live600hold1');
