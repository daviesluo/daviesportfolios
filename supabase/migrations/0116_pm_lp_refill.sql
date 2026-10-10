-- 0116: live-prep's refill and its live reserve (the pre-registration's Addendum 13, 2026-10-10).
--
-- Why. Davies, verbatim: "现在就做补选吧，不然资金利用率太低了，研究出一套最合理的机制" (build the refill now, capital use is too
-- low; research the most sensible mechanism), then "这个候补名单也要在当天中实时更新比如每分钟之类的" (the reserve list must be
-- updated through the day, every minute or so), and the path must not sit with every market of the day "全部被…挡住了…
-- 拿不到任何奖励". On 2026-10-10 the reward check had taken out all ten of the 00:00 markets by 10:04 UTC, and the path
-- quoted nothing.
--
-- What this does, and nothing else:
--   1. `pm_lp_reserve`, one row: the day's reserve of candidates in RW's order (the selection's own rows and scores), each
--      with its programme as last read; when it was last fully re-ranked and refreshed, and that run's report. Written by
--      `agents?action=pmlpreserve` (agents/pm_lp_reserve.ts), read by live-prep's turn (its refill). Service role only:
--      RLS on, no policy, no grant (0082).
--   2. Its lease, `pm-lp-reserve`, and its call: every minute, all day, run again by the watchdog when its worker never
--      started (`retry`). Its heavy re-rank runs every five minutes inside it, never in the quoting turn.
--   3. `pm_lp_events`' kinds also allow 'refill': each refill is one (until this runs, a refill's event is refused and
--      nothing is refilled).
-- No other table, row or call changes.

create table if not exists public.pm_lp_reserve (
  id           integer primary key check (id = 1),
  day          date,
  ranked_at    timestamptz,
  refreshed_at timestamptz,
  rows         jsonb not null default '[]'::jsonb,
  note         jsonb,
  report       jsonb,
  updated_at   timestamptz not null default now()
);
alter table public.pm_lp_reserve enable row level security;

insert into public.agent_locks (name) values ('pm-lp-reserve') on conflict (name) do nothing;

alter table public.pm_lp_events drop constraint if exists pm_lp_events_kind_check;
alter table public.pm_lp_events add constraint pm_lp_events_kind_check
  check (kind in ('gates', 'selection', 'loss_stop_day', 'loss_stop_total', 'governor', 'alert', 'condition', 'readout', 'funding', 'refill'));

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=pmlpreserve', 58000, 1, 23, true) on conflict (path) do nothing;
