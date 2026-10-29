-- 0176: variant-4's £1 holding line on every running stablecoin twin from 2026-10-29 22:00 UTC, as on LIVE; variant-4 retired and
-- the variants after it numbered down by one (docs/agents/reviews/2026-10-29-holdmin-verdict.md, the verdict;
-- docs/agents/reviews/2026-10-29-holdmin-deviation.md, the deviation of every pre-registration it touches).
--
-- On whose word. Davies, 2026-10-29: "那你研究下variant-4的结果，如果基本可以肯定效果正面的话，加入实盘live的规则里和所有测试策略包括所有
-- variant里，并且把variant-4删了，之后的数字都-1" (study variant-4's result; if it is basically certain to be positive, add it to LIVE's
-- rules and every test strategy including every variant, delete variant-4, and number the rest down by one). The verdict found it
-- so on USDT-GBP and harmless on USDC-GBP.
--
-- What it does, in this order:
--   1. The rule `holdMin {gbp: 1, from: 2026-10-29T22:00:00Z}` (PR5-OPT's, `TWIN_RULES.holdMin`; a rung counts as held only
--      above £1 of coin) on each enabled twin that has none, each statement guarded on its absence, as 0141 added the weekend:
--      `live600` (LIVE twin), `live1200` (variant-1), `take50` (variant-2), `n600no03` (variant-3), `n600usdt2` (hidden),
--      `n600usdt3`, `n600usdt`, `u300nudge` and its control `u300ctl`, `live600x1` and its control `live600ctl`. The instant is
--      LIVE's own (`QUOTE_LIVE_HOLD_MIN_FROM`, agents/quotes_live.ts, the same push): every twin keeps mirroring LIVE, and both
--      arms of every paired test (variant-7 and its control, variant-8 and its control, PR5-OPT's against `live600`, variant-1
--      against `live600`) take it at the same minute, so their paired readings stay like for like. A twin first turns on its
--      new rule at its first turn from 22:00; applied after 22:00, it takes the rule from its next turn.
--   2. Variant-4 (`n600hold1`, the rule's own twin) stops (`enabled = false`, as 0149, 0152 and 0167 stop theirs) and leaves the
--      page (`hidden`): its question is answered and its rule is now everyone's, so its 11-25 reading is superseded. It is named
--      for what it was, "Stablecoin quotes hold £1 from 10-28", so its name no longer holds a number. Its row, tables and record
--      stay.
--   3. Page names, each rename following the one that frees its name: variant-5 (`n600usdt3`) → variant-4, variant-6
--      (`n600usdt`) → variant-5, variant-7 (`u300nudge`) → variant-6, variant-8 (`live600x1`) → variant-7. Ids, places, tables,
--      capital and other rules are untouched: an id never names a variant number.
--
-- Its order with the function. LIVE's line ships in agents/quotes_live.ts with this push (edge-functions.yml) while this applies
-- (migrations.yml); the twins' rule needs no new code (`holdMin` has been a twin rule since 0148).
--
-- What it leaves alone: the live executor's config and tables, PR5's paper engine, every twin's record, every disabled twin,
-- `edge_calls` and every cron job. No grant and no policy; nothing is dropped.

update public.agent_quote_twin_specs
   set rules = rules || '{"holdMin": {"from": "2026-10-29T22:00:00Z", "gbp": 1}}'::jsonb
 where id = 'live600' and not (rules ? 'holdMin');

update public.agent_quote_twin_specs
   set rules = rules || '{"holdMin": {"from": "2026-10-29T22:00:00Z", "gbp": 1}}'::jsonb
 where id = 'live1200' and not (rules ? 'holdMin');

update public.agent_quote_twin_specs
   set rules = rules || '{"holdMin": {"from": "2026-10-29T22:00:00Z", "gbp": 1}}'::jsonb
 where id = 'take50' and not (rules ? 'holdMin');

update public.agent_quote_twin_specs
   set rules = rules || '{"holdMin": {"from": "2026-10-29T22:00:00Z", "gbp": 1}}'::jsonb
 where id = 'n600no03' and not (rules ? 'holdMin');

update public.agent_quote_twin_specs
   set rules = rules || '{"holdMin": {"from": "2026-10-29T22:00:00Z", "gbp": 1}}'::jsonb
 where id = 'n600usdt2' and not (rules ? 'holdMin');

update public.agent_quote_twin_specs
   set rules = rules || '{"holdMin": {"from": "2026-10-29T22:00:00Z", "gbp": 1}}'::jsonb
 where id = 'n600usdt3' and not (rules ? 'holdMin');

update public.agent_quote_twin_specs
   set rules = rules || '{"holdMin": {"from": "2026-10-29T22:00:00Z", "gbp": 1}}'::jsonb
 where id = 'n600usdt' and not (rules ? 'holdMin');

update public.agent_quote_twin_specs
   set rules = rules || '{"holdMin": {"from": "2026-10-29T22:00:00Z", "gbp": 1}}'::jsonb
 where id = 'u300nudge' and not (rules ? 'holdMin');

update public.agent_quote_twin_specs
   set rules = rules || '{"holdMin": {"from": "2026-10-29T22:00:00Z", "gbp": 1}}'::jsonb
 where id = 'u300ctl' and not (rules ? 'holdMin');

update public.agent_quote_twin_specs
   set rules = rules || '{"holdMin": {"from": "2026-10-29T22:00:00Z", "gbp": 1}}'::jsonb
 where id = 'live600x1' and not (rules ? 'holdMin');

update public.agent_quote_twin_specs
   set rules = rules || '{"holdMin": {"from": "2026-10-29T22:00:00Z", "gbp": 1}}'::jsonb
 where id = 'live600ctl' and not (rules ? 'holdMin');

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes hold £1 from 10-28'
 where id = 'n600hold1' and display_name = 'Stablecoin quotes variant-4';

update public.agent_quote_twin_specs
   set enabled = false
 where id = 'n600hold1';

update public.agent_quote_twin_specs
   set hidden = true
 where id in ('n600hold1');

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-4'
 where id = 'n600usdt3' and display_name = 'Stablecoin quotes variant-5';

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-5'
 where id = 'n600usdt' and display_name = 'Stablecoin quotes variant-6';

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-6'
 where id = 'u300nudge' and display_name = 'Stablecoin quotes variant-7';

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-7'
 where id = 'live600x1' and display_name = 'Stablecoin quotes variant-8';
