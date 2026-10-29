-- 0179: the USDT-only switch at 2026-10-29 22:30 UTC, not 2026-10-30 00:00 (0178's instant): every 0178 instant moved in place,
-- each guarded on the value it replaces (docs/agents/reviews/2026-10-29-usdt-only-2230-deviation.md).
--
-- On whose word. Davies, 2026-10-29 21:59 UTC: "现在就生效吧 或者22:00生效" (make it take effect now, or at 22:00). 22:00 could not be
-- reached with CI, the migration and the Edge deploy; 22:30 is the first half hour that could. LIVE's instant moves with it in
-- agents/quotes_live.ts (`QUOTE_LIVE_USDT_ONLY_FROM`, `QUOTE_LIVE_REBOOK_SINCE`), the same push.
--
-- What it does: the `weights.from` of the seven rows 0178 gave or replaced weights (`live600`, `live1200`, `take50`, `live600x1`,
-- `live600ctl`, `n600no03`, `n600usdt`), and the new variant-5 (`n600nudge`)'s start and its five rules' `from`, each from
-- 2026-10-30T00:00:00Z to 2026-10-29T22:30:00Z, guarded on the old value.
--
-- Applied after 22:30. A twin turns forward from its last turn and reads its rules at each turn, so a rule whose instant is
-- already past takes effect from the twin's next turn, as 0176's did; no turn is redone. `n600nudge` has not turned (its start
-- was ahead), so it catches up from 22:30 on PR5's own record, as 0169's and 0175's twins did from a start behind their apply.
--
-- What it leaves alone: every other field and row, the live executor's config and tables, `edge_calls` and every cron job.

update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights,from}', '"2026-10-29T22:30:00Z"'::jsonb)
 where id = 'live600' and rules->'weights'->>'from' = '2026-10-30T00:00:00Z';

update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights,from}', '"2026-10-29T22:30:00Z"'::jsonb)
 where id = 'live1200' and rules->'weights'->>'from' = '2026-10-30T00:00:00Z';

update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights,from}', '"2026-10-29T22:30:00Z"'::jsonb)
 where id = 'take50' and rules->'weights'->>'from' = '2026-10-30T00:00:00Z';

update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights,from}', '"2026-10-29T22:30:00Z"'::jsonb)
 where id = 'live600x1' and rules->'weights'->>'from' = '2026-10-30T00:00:00Z';

update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights,from}', '"2026-10-29T22:30:00Z"'::jsonb)
 where id = 'live600ctl' and rules->'weights'->>'from' = '2026-10-30T00:00:00Z';

update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights,from}', '"2026-10-29T22:30:00Z"'::jsonb)
 where id = 'n600no03' and rules->'weights'->>'from' = '2026-10-30T00:00:00Z';

update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights,from}', '"2026-10-29T22:30:00Z"'::jsonb)
 where id = 'n600usdt' and rules->'weights'->>'from' = '2026-10-30T00:00:00Z';

update public.agent_quote_twin_specs
   set start = '2026-10-29T22:30:00Z'
 where id = 'n600nudge' and start = '2026-10-30T00:00:00Z';

update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{fill,from}', '"2026-10-29T22:30:00Z"'::jsonb)
 where id = 'n600nudge' and rules->'fill'->>'from' = '2026-10-30T00:00:00Z';

update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weekend,from}', '"2026-10-29T22:30:00Z"'::jsonb)
 where id = 'n600nudge' and rules->'weekend'->>'from' = '2026-10-30T00:00:00Z';

update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{holdMin,from}', '"2026-10-29T22:30:00Z"'::jsonb)
 where id = 'n600nudge' and rules->'holdMin'->>'from' = '2026-10-30T00:00:00Z';

update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights,from}', '"2026-10-29T22:30:00Z"'::jsonb)
 where id = 'n600nudge' and rules->'weights'->>'from' = '2026-10-30T00:00:00Z';

update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{fairNudge,from}', '"2026-10-29T22:30:00Z"'::jsonb)
 where id = 'n600nudge' and rules->'fairNudge'->>'from' = '2026-10-30T00:00:00Z';
