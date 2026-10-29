-- 0181: variant-6's exit a tick beyond fair on every running stablecoin twin on LIVE's rules from 2026-10-30 00:00 UTC, as on
-- LIVE; variant-6 and its control switched off (docs/agents/reviews/2026-10-29-usdt-no03.md, the study;
-- docs/agents/reviews/2026-10-29-live-exit-tick-deviation.md, the deviation of every pre-registration it touches).
--
-- On whose word. Davies, 2026-10-29 ~23:00 UTC, asked "要把这条加进 LIVE（Stablecoin quotes USDT/GBP）吗？" on USDT-NO03's verdict
-- (the exit a tick beyond fair alone: +1.49 % a year at £600 since 09-01, P(≤ 0) 0.048; out of sample +4.63, P 0.000): "加进 LIVE".
--
-- What it does, in this order:
--   1. The rule `exitOffset {ticks: 1, from: 2026-10-30T00:00:00Z}` (p50x1's, `TWIN_RULES.exitOffset`; every exit, placed or
--      re-priced, a tick beyond the rule's price in the position's favour; the 24-hour stop not moved) on each enabled twin on
--      LIVE's rules that has none, each statement guarded on its absence, as 0176 added the holding line: `live600` (USDT/GBP
--      LIVE twin), `live1200` (variant-1), `take50` (variant-2), `n600no03` (variant-3), `n600usdt2` (hidden), `n600usdt`
--      (variant-4) and `n600nudge` (variant-5). The instant is LIVE's own (`QUOTE_LIVE_EXIT_OFFSET_FROM`, agents/quotes_live.ts,
--      the same push): every twin keeps mirroring LIVE, and both arms of every paired test (variant-5 and its control
--      variant-4, PR5-OPT's against `live600`, variant-1 against `live600`) take it at the same minute. A twin first turns on
--      the rule at its first turn from 00:00; applied after 00:00, it takes it from its next turn.
--   2. Variant-6 (`live600x1`, the rule's own twin) and its hidden control (`live600ctl`) stop (`enabled = false`, as 0176
--      stopped variant-4): with the rule on LIVE, variant-6 is the LIVE twin and its control is LIVE's rules of yesterday.
--      Its pre-registration closes early, adopted on Davies' word. Variant-6 leaves the page (`hidden`) under the name of what
--      it was, "Stablecoin quotes exit +1 tick from 10-29"; it was the last variant, so no other name moves. Their rows, tables
--      and records stay. They take no exitOffset of their own here: neither turns again.
--   `rxu120` (the USDC/GBP LIVE twin) has had the rule since its start (0180) and is left as it is.
--
-- Its order with the function. LIVE's offset ships in agents/quotes_live.ts with this push (edge-functions.yml) while this
-- applies (migrations.yml); the twins' rule needs no new code (`exitOffset` has been a twin rule since 0108).
--
-- What it leaves alone: the live executors' config and tables, PR5's paper engine, every twin's record, every disabled twin,
-- `edge_calls` and every cron job. No grant and no policy; nothing is dropped.

update public.agent_quote_twin_specs
   set rules = rules || '{"exitOffset": {"from": "2026-10-30T00:00:00Z", "ticks": 1}}'::jsonb
 where id = 'live600' and not (rules ? 'exitOffset');

update public.agent_quote_twin_specs
   set rules = rules || '{"exitOffset": {"from": "2026-10-30T00:00:00Z", "ticks": 1}}'::jsonb
 where id = 'live1200' and not (rules ? 'exitOffset');

update public.agent_quote_twin_specs
   set rules = rules || '{"exitOffset": {"from": "2026-10-30T00:00:00Z", "ticks": 1}}'::jsonb
 where id = 'take50' and not (rules ? 'exitOffset');

update public.agent_quote_twin_specs
   set rules = rules || '{"exitOffset": {"from": "2026-10-30T00:00:00Z", "ticks": 1}}'::jsonb
 where id = 'n600no03' and not (rules ? 'exitOffset');

update public.agent_quote_twin_specs
   set rules = rules || '{"exitOffset": {"from": "2026-10-30T00:00:00Z", "ticks": 1}}'::jsonb
 where id = 'n600usdt2' and not (rules ? 'exitOffset');

update public.agent_quote_twin_specs
   set rules = rules || '{"exitOffset": {"from": "2026-10-30T00:00:00Z", "ticks": 1}}'::jsonb
 where id = 'n600usdt' and not (rules ? 'exitOffset');

update public.agent_quote_twin_specs
   set rules = rules || '{"exitOffset": {"from": "2026-10-30T00:00:00Z", "ticks": 1}}'::jsonb
 where id = 'n600nudge' and not (rules ? 'exitOffset');

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes exit +1 tick from 10-29'
 where id = 'live600x1' and display_name = 'Stablecoin quotes variant-6';

update public.agent_quote_twin_specs
   set enabled = false
 where id = 'live600x1';

update public.agent_quote_twin_specs
   set enabled = false
 where id = 'live600ctl';

update public.agent_quote_twin_specs
   set hidden = true
 where id in ('live600x1');
