-- 0170: variant-7 (`u300nudge`), its hidden control (`u300ctl`) and Coinbase "Stablecoin quotes with Euros - 3" (`cb_nudge`)
-- start at 2026-10-29 08:00 UTC instead of 2026-10-30 00:00 (docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md and
-- docs/agents/reviews/2026-10-29-cb-usdc-nudge-prereg.md, each its Deviation 1).
--
-- On whose word. Davies, 2026-10-29 about 07:20 UTC: "你新做好的两个测试策略现在就上线" (the two new test strategies go live now).
--
-- The twins, in place as 0154 moved PR5-OPT's five: they have not turned (read at 07:25 UTC, `agent_quote_twin_u300nudge_state`
-- and `_u300ctl_state` empty), and the driver turns no twin before the minute after its start, reading each row's start and rules
-- afresh every minute. Each row's `start` and each of its rules' `from` move; each statement is guarded on the value it replaces.
-- Applied after 08:00, both catch up from 08:00 on PR5's record. variant-7's EMA is warmed on the 72 hours before its start, as
-- before. The window is the 28 days 2026-10-29 08:00 → 2026-11-26 08:00 UTC, its days 08:00 → 08:00; bar and reading as frozen.
--
-- Coinbase "- 3": its record was opened at its first run (07:22 UTC) with `startedAt` the next 00:00 (`cbHoldStart`), flat books
-- and `fed` the newest trade id each book had then; its first decided minute is `lastMinute` + 1. Both move to 08:00 / 07:59,
-- guarded on the old start, so the run decides from 08:00 (catching up if later) on prints after `fed`. Its nudge's EMA starts
-- with its first lit minute, as before; nothing else in the state is set yet. Its 28 days run 08:00 → 08:00, compared with
-- "- 2"'s USDC-GBP book over the same days.
--
-- What it leaves alone: every other twin's row, "- 2" and every other Coinbase row, the live executor, its config and tables,
-- `edge_calls` and every cron job. No grant and no policy.

update public.agent_quote_twin_specs
   set start = '2026-10-29T08:00:00Z'
 where id = 'u300nudge' and start = '2026-10-30T00:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{fill,from}', '"2026-10-29T08:00:00Z"'::jsonb)
 where id = 'u300nudge' and rules->'fill'->>'from' = '2026-10-30T00:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weekend,from}', '"2026-10-29T08:00:00Z"'::jsonb)
 where id = 'u300nudge' and rules->'weekend'->>'from' = '2026-10-30T00:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights,from}', '"2026-10-29T08:00:00Z"'::jsonb)
 where id = 'u300nudge' and rules->'weights'->>'from' = '2026-10-30T00:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{fairNudge,from}', '"2026-10-29T08:00:00Z"'::jsonb)
 where id = 'u300nudge' and rules->'fairNudge'->>'from' = '2026-10-30T00:00:00Z';
update public.agent_quote_twin_specs
   set start = '2026-10-29T08:00:00Z'
 where id = 'u300ctl' and start = '2026-10-30T00:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{fill,from}', '"2026-10-29T08:00:00Z"'::jsonb)
 where id = 'u300ctl' and rules->'fill'->>'from' = '2026-10-30T00:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weekend,from}', '"2026-10-29T08:00:00Z"'::jsonb)
 where id = 'u300ctl' and rules->'weekend'->>'from' = '2026-10-30T00:00:00Z';
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights,from}', '"2026-10-29T08:00:00Z"'::jsonb)
 where id = 'u300ctl' and rules->'weights'->>'from' = '2026-10-30T00:00:00Z';

update public.cb_nudge_state
   set state = state || jsonb_build_object('startedAt', 1793260800000::bigint, 'lastMinute', 1793260740000::bigint)
 where id = 1 and (state->>'startedAt')::bigint = 1793318400000;
