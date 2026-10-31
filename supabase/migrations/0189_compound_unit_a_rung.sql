-- 0189: the compounding moves in whole pounds a rung the strategy quotes, from 2026-11-01 00:00 UTC.
-- docs/agents/reviews/2026-10-31-compound-unit-deviation.md; agents/quotes_compound.ts (`compoundUnitOf`); agents/cb_live.ts.
--
-- On whose word. Davies, 2026-10-31 ~03:05 UTC: "a和b都改； c也改" (c: LIVE's unit £12 → £6), on the audit's finding that LIVE's
-- compounding moved in whole £12, the twelve rungs it was built with, while it quotes USDT-GBP's six alone since 2026-10-29 22:30
-- UTC (£2 a rung, where the rule says a pound a rung); and "live复利不仅是usdt吧，另外两个呢？": the USDC/GBP executor's £4 (four
-- rungs) and Coinbase's £6 (six) were already a pound a rung.
--
-- From 2026-11-01 00:00 UTC the code takes each unit, and the step with it, from the rungs the strategy quotes at the day's
-- 00:00 (`compoundUnitOf`, `cbLiveRungCount`), so a later change of rungs cannot leave it stale. The stored columns below are
-- set to the same values, so what the database says is what runs; nothing else changes (base, floor, cap, start, capital).
--
--   agent_quote_live_config   LIVE: step £12 → £6 (its unit had no column: the code's £12, now £6).
--   agent_quote_twin_compound live600 £12 → £6, live1200 £24 → £6, take50 £12 → £6 (USDT-GBP's six rungs each), n600no03
--                             £12 → £4 (USDT-GBP without its 0.3 % rung: four); n600usdt, n600nudge, n600usdt2 (both books,
--                             twelve rungs) and rxu120 (four) are unchanged.
-- The USDC/GBP executor (£4) and Coinbase's (£6) are unchanged.

update public.agent_quote_live_config set compound_step_gbp = 6 where id = 1 and compound_step_gbp = 12;

update public.agent_quote_twin_compound set unit_gbp = 6, step_gbp = 6 where twin_id in ('live600', 'live1200', 'take50');
update public.agent_quote_twin_compound set unit_gbp = 4, step_gbp = 4 where twin_id = 'n600no03';
