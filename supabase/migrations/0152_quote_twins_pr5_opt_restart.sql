-- 0152: PR5-OPT's five twins start again, all from 2026-10-29 06:00 UTC, under new ids, because their start conversions were
-- not their rules' (docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md §7, deviation 1).
--
-- On whose word. Davies noticed on 2026-10-28 that "variant-6", "-7" and "-8" (USDT-GBP 2:1, 3:1 and alone) hold the same coin as
-- LIVE, about 200 USDC and 200 USDT each; the coordinating session had them restarted from one common start with the cause fixed.
--
-- The cause. 0149 applied at 04:56 UTC on 10-27 for a 06:00 start. The twins' driver sent a twin whose start was still ahead
-- straight to forward turns, so each turned from 04:56, and its start conversions went out at 05:50:27–05:51:28, once its replica's
-- fair could be read: before its rules' instant (06:00), so `convertCapGbp` sized them without weights, a quarter of the £600 into
-- each coin. From 06:00 the quotes were weighted and the coin was not: variant-8 holds about 200 USDC with no USDC rung, and the
-- USDT asks of variant-6 to -8 run short; variant-4 bought three asks' worth for two rungs. Variant-5 (no weights) was right, and
-- starts again with the others so the five share one window. `quotes_twin.ts` now turns no twin before the minute after its start
-- (pinned in `quotes_twin.test.ts`: a twin whose row lands before its start converts its weighted amounts at its first turn).
--
-- Why new ids rather than a reset in place. As 0149 says of 0148's rows: each twin built its replica of PR5's engine from its
-- start and its driver state counts the turns it took, and a reset of their tables could race the minute call, which reads a
-- twin's state, turns it and writes it back. So the five are switched off (their tables and records stay, read by no reading) and
-- the same five rules start again under ids of their own, each its 0149 row but for the id, its tables and lease, the start and
-- its rules' instants (2026-10-29 06:00 UTC, two days later at the same hour, so the reading's 06:00 days stand) and this
-- migration. The page names "Stablecoin quotes variant-4" to "-8" and their places move to the new rows. The window is the 28
-- days 2026-10-29 06:00 → 2026-11-26 06:00 UTC; bar and reading are as frozen.
--
-- What it does, in this order (page names are unique, so each rename frees the name a new row takes):
--   1. 0149's five give up "variant-4" to "-8" and are switched off.
--   2. Five rows, `n600no03`, `n600hold1`, `n600usdt2`, `n600usdt3`, `n600usdt`, from 2026-10-29 06:00 UTC, and their tables.
--
-- Its order with the function. The driver's fix deploys with this push (edge-functions.yml) while this migration applies
-- (migrations.yml). Should the rows land first, the old driver turns them before their start: inert minutes, since their
-- replicas' fair is unreadable until 05:50 on 10-29 and the executor quotes nothing on a replica not caught up, and the
-- operator's start conversion goes out at the first turn after 06:00 under the fixed driver.
--
-- What it leaves alone: the live executor, its config and its tables; PR5's paper engine; every other twin's row; `edge_calls`
-- and every cron job. No grant and no policy.

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes no 0.3 % from 10-27'
 where id = 'o600no03' and display_name = 'Stablecoin quotes variant-4';
update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes hold £1 from 10-27'
 where id = 'o600hold1' and display_name = 'Stablecoin quotes variant-5';
update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes USDT 2:1 from 10-27'
 where id = 'o600usdt2' and display_name = 'Stablecoin quotes variant-6';
update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes USDT 3:1 from 10-27'
 where id = 'o600usdt3' and display_name = 'Stablecoin quotes variant-7';
update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes USDT only from 10-27'
 where id = 'o600usdt' and display_name = 'Stablecoin quotes variant-8';
update public.agent_quote_twin_specs
   set enabled = false
 where id = 'o600no03';
update public.agent_quote_twin_specs
   set enabled = false
 where id = 'o600hold1';
update public.agent_quote_twin_specs
   set enabled = false
 where id = 'o600usdt2';
update public.agent_quote_twin_specs
   set enabled = false
 where id = 'o600usdt3';
update public.agent_quote_twin_specs
   set enabled = false
 where id = 'o600usdt';

insert into public.agent_quote_twin_specs
select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[
  { "id": "n600no03", "display_name": "Stablecoin quotes variant-4", "display_order": 46, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-29T06:00:00Z", "table_prefix": "agent_quote_twin_n600no03", "lease": "quotes-twin-n600no03", "rules": { "fill": { "model": "at", "from": "2026-10-29T06:00:00Z" }, "weekend": { "from": "2026-10-29T06:00:00Z" }, "weights": { "from": "2026-10-29T06:00:00Z", "k": { "0.001": 1, "0.002": 1, "0.003": 0 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md", "migration": "0152", "enabled": true },
  { "id": "n600hold1", "display_name": "Stablecoin quotes variant-5", "display_order": 47, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-29T06:00:00Z", "table_prefix": "agent_quote_twin_n600hold1", "lease": "quotes-twin-n600hold1", "rules": { "fill": { "model": "at", "from": "2026-10-29T06:00:00Z" }, "weekend": { "from": "2026-10-29T06:00:00Z" }, "holdMin": { "from": "2026-10-29T06:00:00Z", "gbp": 1 } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md", "migration": "0152", "enabled": true },
  { "id": "n600usdt2", "display_name": "Stablecoin quotes variant-6", "display_order": 48, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-29T06:00:00Z", "table_prefix": "agent_quote_twin_n600usdt2", "lease": "quotes-twin-n600usdt2", "rules": { "fill": { "model": "at", "from": "2026-10-29T06:00:00Z" }, "weekend": { "from": "2026-10-29T06:00:00Z" }, "weights": { "from": "2026-10-29T06:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 2 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md", "migration": "0152", "enabled": true },
  { "id": "n600usdt3", "display_name": "Stablecoin quotes variant-7", "display_order": 49, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-29T06:00:00Z", "table_prefix": "agent_quote_twin_n600usdt3", "lease": "quotes-twin-n600usdt3", "rules": { "fill": { "model": "at", "from": "2026-10-29T06:00:00Z" }, "weekend": { "from": "2026-10-29T06:00:00Z" }, "weights": { "from": "2026-10-29T06:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 3 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md", "migration": "0152", "enabled": true },
  { "id": "n600usdt", "display_name": "Stablecoin quotes variant-8", "display_order": 50, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-29T06:00:00Z", "table_prefix": "agent_quote_twin_n600usdt", "lease": "quotes-twin-n600usdt", "rules": { "fill": { "model": "at", "from": "2026-10-29T06:00:00Z" }, "weekend": { "from": "2026-10-29T06:00:00Z" }, "weights": { "from": "2026-10-29T06:00:00Z", "book": { "USDC-GBP": 0, "USDT-GBP": 1 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md", "migration": "0152", "enabled": true }
]$json$::jsonb)
on conflict (id) do nothing;
select public.create_quote_twin_tables('n600no03');
select public.create_quote_twin_tables('n600hold1');
select public.create_quote_twin_tables('n600usdt2');
select public.create_quote_twin_tables('n600usdt3');
select public.create_quote_twin_tables('n600usdt');
