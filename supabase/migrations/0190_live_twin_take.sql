-- 0190: "Stablecoin quotes USDT/GBP LIVE twin" (`live600`) takes as LIVE takes, from the minute LIVE's take went live.
-- docs/agents/reviews/2026-10-31-live-twin-take-drain-deviation.md; agents/quotes_live.ts (the shared take path).
--
-- On whose word. Davies, 2026-10-31 ~03:55 UTC: "同意", on the agents audit's N1: LIVE's `take_mode` has been 'live' since
-- 2026-10-31 02:10:43 UTC (Davies: "RX USDT/GBP上"), and its twin, which carries out the same paper decisions on a simulated
-- account to mirror it, had no take rule, so from LIVE's first live take the twin would stop mirroring it.
--
-- The rule is variant-2's (`rules.take`, the twin driver's option since 0089) from 02:10:43, and the shared take path applies
-- to it what governs LIVE's take today: TAKE-DEPTH from 04:00 UTC (`takeDeep`), no take inside an FX closure (`takeClosed`),
-- the limit at k + the 0.09 % fee from fair. Nothing is replayed: 02:10:43 to 04:00 was inside the weekend closure (Friday
-- 21:00 to Sunday 21:00 UTC), where neither LIVE nor the twin may take, so the twin's minutes from then are what they would
-- have been. The first take either can make is Sunday 2026-11-01 21:00 UTC.

update public.agent_quote_twin_specs
   set rules = rules || '{"take": {"from": "2026-10-31T02:10:43Z"}}'::jsonb
 where id = 'live600' and not (rules ? 'take');
