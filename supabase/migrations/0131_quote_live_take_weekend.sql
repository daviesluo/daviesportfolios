-- 0131: two switches for PR5's live executor, both OFF, each with a shadow mode: TAKE's taker entry (variant-2's rule)
-- and PR5-W's weekend quoting (variant-3's rule). Nothing here trades; the switches stay 'off' until Davies says go.
--
-- On whose word. Davies, 2026-10-18, answering the stablecoin quotes review: "live的策略有主动吃单吗？没有的话你觉得加上会更好吗？会的话
-- 就加上，然后加上周末的挂单，一定验证好没问题再推上实盘部署" (does LIVE take? if adding it would be better, add it, and add weekend
-- quoting; verify it is right before it goes live). The replay on LIVE's own record says both are better at its £10 a rung
-- (docs/agents/backtests/livetw/; the live design's addendum of 2026-10-18, docs/agents/reviews/2026-09-24-pr5-live-design.md).
--
-- `agent_quote_live_config.take_mode`, 'off' | 'shadow' | 'live', default 'off':
--   off     as before: no take is checked.
--   shadow  each turn checks every rung that may enter (the twins' own test, `takeTriggered` at k + 0.09 % from fair on the
--           book recorder's read at most 90 s old) and records what it WOULD send as a `take_shadow` event: the IOC's
--           limit, size, the read it met, whether the funds would cover it. Nothing is sent and the rung's paper entry goes on.
--   live    the take is sent: the rung's entry is cancelled and one taker IOC goes at the limit (the twins' code path).
-- `agent_quote_live_config.weekend_mode`, 'off' | 'shadow' | 'live', default 'off':
--   off     as before: GBP/USD dark at weekends, no entries.
--   shadow  a replica of PR5's engine (`agent_quote_live_wkpaper`, below) is copied in the hour before each closure and
--           stepped inside it with PR5-W's weekend rule, and each turn there records the entries it WOULD rest, when they change, as `weekend_shadow`
--           events (a book's six rungs: price, size, fair at the held rate, whether LIVE holds the rung). Nothing is sent.
--   live    inside a closure the executor carries out that replica's decisions, at fair on the held rate; outside a
--           closure it carries out PR5's engine's, as before.
-- Every other limit stands in every mode: the governor, the daily loss stop, the de-peg and stale-input guards, the post-only
-- check at the book, the 24-hour stop, the dead-man switch and its watch, `live_confirmed_at` and `global_pause`.
--
-- `agent_quote_live_wkpaper`: one row, the replica's state (agents/quotes_live_weekend.ts: PR5's engine's state copied in the
-- hour before a closure, then `stepTwinPaper` of quotes_twin.ts with the weekend rule inside it) and its last decided minute.
-- It is written only while `weekend_mode` is not 'off'. Row level security on, no policy, no grant
-- (0082's default privileges keep `anon` and `authenticated` out); the service role writes it.
--
-- The events' kinds gain `take_shadow` and `weekend_shadow`. The twins' event tables (0087's template) are not changed: the
-- switches are the live account's alone.
--
-- Undo: the switches back to 'off' stop both at the next turn (`update public.agent_quote_live_config set take_mode = 'off',
-- weekend_mode = 'off', updated_at = now() where id = 1;`).

alter table public.agent_quote_live_config
  add column if not exists take_mode text not null default 'off' check (take_mode in ('off', 'shadow', 'live')),
  add column if not exists weekend_mode text not null default 'off' check (weekend_mode in ('off', 'shadow', 'live'));

alter table public.agent_quote_live_events drop constraint if exists agent_quote_live_events_kind_check;
alter table public.agent_quote_live_events add constraint agent_quote_live_events_kind_check
  check (kind in ('skip', 'guard', 'stop_unfilled', 'loss_stop', 'deadman', 'take_shadow', 'weekend_shadow'));

create table if not exists public.agent_quote_live_wkpaper (
  id          integer primary key check (id = 1),
  state       jsonb not null,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);
alter table public.agent_quote_live_wkpaper enable row level security;
