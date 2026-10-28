-- 0154: PR5-OPT's five twins (variant-4 to -8, 0152's `n600*`) start at 2026-10-28 22:00 UTC instead of 2026-10-29 06:00
-- (docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md §7, deviation 2).
--
-- On whose word. Davies, 2026-10-28 about 21:00 UTC, once 0152's fix was in: "修好了的话现在就开始" (if it is fixed, start now).
--
-- Why in place, where 0149 and 0152 took new ids. Those moved twins that had already turned: a replica built from the old start
-- and a driver state counting its turns, which a change of start would have left behind. These five have not turned. 0152 applied
-- at about 20:15 UTC; read then, their `_orders` and `_sim` tables were empty, and the driver (`quotes_twin.ts`, since 0152) turns
-- no twin before the minute after its start: it returns before it builds a replica or a driver state. So nothing holds the old
-- start, and the call reads each row's start and rules afresh every minute. Each statement is guarded on the value it replaces,
-- so a row already moved, or not 0152's, is left alone.
--
-- What it does: each row's `start` and each of its rules' `from` (its `fill`, its `weekend`, and its `weights` or `holdMin`)
-- move from 2026-10-29T06:00:00Z to 2026-10-28T22:00:00Z. Applied before 22:00, the five wait for 22:01; applied after it, each catches up from 22:01 on PR5's
-- record, as a twin whose start is behind it does, and its start conversions go out at that first turn under its rules. The
-- window is the 28 days 2026-10-28 22:00 → 2026-11-25 22:00 UTC, its days 22:00 → 22:00; bar and reading as frozen.
--
-- What it leaves alone: every other twin's row, 0149's five (off), the live executor, its config and tables, `edge_calls` and
-- every cron job. No grant and no policy.

update public.agent_quote_twin_specs
   set start = '2026-10-28T22:00:00Z'
 where id = 'n600no03' and start = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{fill,from}', '"2026-10-28T22:00:00Z"'::jsonb)
 where id = 'n600no03' and rules->'fill'->>'from' = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weekend,from}', '"2026-10-28T22:00:00Z"'::jsonb)
 where id = 'n600no03' and rules->'weekend'->>'from' = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights,from}', '"2026-10-28T22:00:00Z"'::jsonb)
 where id = 'n600no03' and rules->'weights'->>'from' = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set start = '2026-10-28T22:00:00Z'
 where id = 'n600hold1' and start = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{fill,from}', '"2026-10-28T22:00:00Z"'::jsonb)
 where id = 'n600hold1' and rules->'fill'->>'from' = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weekend,from}', '"2026-10-28T22:00:00Z"'::jsonb)
 where id = 'n600hold1' and rules->'weekend'->>'from' = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{holdMin,from}', '"2026-10-28T22:00:00Z"'::jsonb)
 where id = 'n600hold1' and rules->'holdMin'->>'from' = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set start = '2026-10-28T22:00:00Z'
 where id = 'n600usdt2' and start = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{fill,from}', '"2026-10-28T22:00:00Z"'::jsonb)
 where id = 'n600usdt2' and rules->'fill'->>'from' = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weekend,from}', '"2026-10-28T22:00:00Z"'::jsonb)
 where id = 'n600usdt2' and rules->'weekend'->>'from' = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights,from}', '"2026-10-28T22:00:00Z"'::jsonb)
 where id = 'n600usdt2' and rules->'weights'->>'from' = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set start = '2026-10-28T22:00:00Z'
 where id = 'n600usdt3' and start = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{fill,from}', '"2026-10-28T22:00:00Z"'::jsonb)
 where id = 'n600usdt3' and rules->'fill'->>'from' = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weekend,from}', '"2026-10-28T22:00:00Z"'::jsonb)
 where id = 'n600usdt3' and rules->'weekend'->>'from' = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights,from}', '"2026-10-28T22:00:00Z"'::jsonb)
 where id = 'n600usdt3' and rules->'weights'->>'from' = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set start = '2026-10-28T22:00:00Z'
 where id = 'n600usdt' and start = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{fill,from}', '"2026-10-28T22:00:00Z"'::jsonb)
 where id = 'n600usdt' and rules->'fill'->>'from' = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weekend,from}', '"2026-10-28T22:00:00Z"'::jsonb)
 where id = 'n600usdt' and rules->'weekend'->>'from' = '2026-10-29T06:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights,from}', '"2026-10-28T22:00:00Z"'::jsonb)
 where id = 'n600usdt' and rules->'weights'->>'from' = '2026-10-29T06:00:00Z';
