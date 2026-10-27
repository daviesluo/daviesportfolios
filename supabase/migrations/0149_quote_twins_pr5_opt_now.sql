-- 0149: PR5-OPT's twins start now, not on 10-29, and two more: USDT-GBP 3:1 and USDT-GBP only
-- (docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md; the first three's pre-registration's deviation 1,
-- docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md §7).
--
-- On whose word. Davies, 2026-10-27: "variant-4、5、6是在实盘rules的基础上建的吧？为啥要等到29？现在就开始…你再在实盘rules的基础上开variant-7和8测试这两个"
-- (variant-4, 5 and 6 are built on LIVE's rules, aren't they? Why wait until the 29th? Start now… and open variant-7 and 8 on
-- LIVE's rules to test these two: the 3:1 and USDT-only weightings).
--
-- Why new ids rather than moving 0148's start. 0148's three rows have been turning since 04:20 UTC with their start on 10-29:
-- each twin built its replica of PR5's engine from that start (`newTwinPaper`: its last minute 2026-10-28 23:59), and its
-- driver state counts turns already taken. Moving `start` in place would leave that replica waiting for 10-29, and a reset of
-- their tables could race the minute call. So the three are switched off (their tables keep the inert minutes they ran: no
-- order, only guard events) and the same three rules start again under ids of their own, beside the two new ones, all from
-- 2026-10-27 06:00 UTC. A twin whose start is in the past when this applies catches up from it, as every twin does.
--
-- What it does, in this order (page names are unique, so each rename frees the name a new row takes):
--   1. 0148's three give up "variant-4", "-5" and "-6" and are switched off.
--   2. Five rows, each LIVE's rules at £600 (PR5's engine, one key, LIVE's fill rule and weekend from their start, no take)
--      with one change, flat from 2026-10-27 06:00 UTC, the operator's maker conversions at their first turn. The USDT-GBP
--      weightings sit together, last, in rising order (Davies, 2026-10-27: "做好后variant-4和5与5和6替换，这样的话usdt比例大的放一起",
--      and his final numbering the same day):
--        `o600no03`  "Stablecoin quotes variant-4": `weights.k`, no entry on the 0.3 % rungs (£75 on the other eight);
--        `o600hold1` "Stablecoin quotes variant-5": `holdMin` £1;
--        `o600usdt2` "Stablecoin quotes variant-6": `weights.book` USDC 1 : USDT 2 (£33.33 and £66.66 a rung);
--        `o600usdt3` "Stablecoin quotes variant-7": `weights.book` USDC 1 : USDT 3 (£25 and £75 a rung);
--        `o600usdt`  "Stablecoin quotes variant-8": `weights.book` USDC 0 : USDT 1 (USDT-GBP alone, £100 a rung; the USDC book
--                    quotes nothing, converts nothing and tops nothing up).
--
-- Its time. No new call: 0087's `agents?action=quotestwins` runs the enabled rows, twelve after this (0148's three off, five on).
-- Measured 2026-10-26 05:00 → 10-27 04:40 UTC from the function's own logs: the call sleeps to :38 and then works a median 6–11 s
-- and at most 19.4 s on seven twins; a call has run past pg_net's 58 s and still finished (10-20, 59.8 s, 200), and its lease is
-- 55 s. Fresh twins cost little (two added at 10-27 00:00 moved nothing measurable). So `pr5`, `p50` and `d` keep running to their
-- 10-28 readouts (the pre-registration's §6).
--
-- What it leaves alone: the live executor, its config and its tables; PR5's paper engine and every reading of it; every other
-- twin's row; the Coinbase tests; `edge_calls` and every cron job. No grant and no policy.

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes USDT 2:1 from 10-29'
 where id = 'live600usdt2' and display_name = 'Stablecoin quotes variant-4';
update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes no 0.3 % from 10-29'
 where id = 'live600no03' and display_name = 'Stablecoin quotes variant-5';
update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes hold £1 from 10-29'
 where id = 'live600hold1' and display_name = 'Stablecoin quotes variant-6';
update public.agent_quote_twin_specs
   set enabled = false
 where id = 'live600usdt2';
update public.agent_quote_twin_specs
   set enabled = false
 where id = 'live600no03';
update public.agent_quote_twin_specs
   set enabled = false
 where id = 'live600hold1';

insert into public.agent_quote_twin_specs
select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[
  { "id": "o600no03", "display_name": "Stablecoin quotes variant-4", "display_order": 41, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-27T06:00:00Z", "table_prefix": "agent_quote_twin_o600no03", "lease": "quotes-twin-o600no03", "rules": { "fill": { "model": "at", "from": "2026-10-27T06:00:00Z" }, "weekend": { "from": "2026-10-27T06:00:00Z" }, "weights": { "from": "2026-10-27T06:00:00Z", "k": { "0.001": 1, "0.002": 1, "0.003": 0 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md", "migration": "0149", "enabled": true },
  { "id": "o600hold1", "display_name": "Stablecoin quotes variant-5", "display_order": 42, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-27T06:00:00Z", "table_prefix": "agent_quote_twin_o600hold1", "lease": "quotes-twin-o600hold1", "rules": { "fill": { "model": "at", "from": "2026-10-27T06:00:00Z" }, "weekend": { "from": "2026-10-27T06:00:00Z" }, "holdMin": { "from": "2026-10-27T06:00:00Z", "gbp": 1 } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md", "migration": "0149", "enabled": true },
  { "id": "o600usdt2", "display_name": "Stablecoin quotes variant-6", "display_order": 43, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-27T06:00:00Z", "table_prefix": "agent_quote_twin_o600usdt2", "lease": "quotes-twin-o600usdt2", "rules": { "fill": { "model": "at", "from": "2026-10-27T06:00:00Z" }, "weekend": { "from": "2026-10-27T06:00:00Z" }, "weights": { "from": "2026-10-27T06:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 2 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md", "migration": "0149", "enabled": true },
  { "id": "o600usdt3", "display_name": "Stablecoin quotes variant-7", "display_order": 44, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-27T06:00:00Z", "table_prefix": "agent_quote_twin_o600usdt3", "lease": "quotes-twin-o600usdt3", "rules": { "fill": { "model": "at", "from": "2026-10-27T06:00:00Z" }, "weekend": { "from": "2026-10-27T06:00:00Z" }, "weights": { "from": "2026-10-27T06:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 3 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md", "migration": "0149", "enabled": true },
  { "id": "o600usdt", "display_name": "Stablecoin quotes variant-8", "display_order": 45, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-27T06:00:00Z", "table_prefix": "agent_quote_twin_o600usdt", "lease": "quotes-twin-o600usdt", "rules": { "fill": { "model": "at", "from": "2026-10-27T06:00:00Z" }, "weekend": { "from": "2026-10-27T06:00:00Z" }, "weights": { "from": "2026-10-27T06:00:00Z", "book": { "USDC-GBP": 0, "USDT-GBP": 1 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md", "migration": "0149", "enabled": true }
]$json$::jsonb)
on conflict (id) do nothing;
select public.create_quote_twin_tables('o600no03');
select public.create_quote_twin_tables('o600hold1');
select public.create_quote_twin_tables('o600usdt2');
select public.create_quote_twin_tables('o600usdt3');
select public.create_quote_twin_tables('o600usdt');
