-- 0159: IGBOT's independent audit (2026-10-29), before Davies gives the prompt to his Grok agent. Davies, 2026-10-28:
-- "有任何问题或漏洞的话指出并修复，确保一切细节完美我再发grokbot". Nothing here arms anything; the config stays dry-run and
-- demo-only (0157's checks are untouched). What the database needed:
--
--   igbot_requests.ig_calls   the IG requests each authenticated request made, and one row a minute for the scheduler's sync
--                             (action 'sync'): the function holds IG's per-account allowance across every isolate by the last
--                             minute's sum (`IGBOT_IG_CALLS_PER_MINUTE`, `igbot/ingest.ts`). Until now each request's client
--                             counted from zero, so nothing held the minute's total.
--   igbot_bars                IG's own HOUR bars (bid and ask, open/high/low/close) of each whitelisted market, read by the
--                             minute's sync once an hour (`GET /prices/{epic}`, v3, the last two hours). The pre-registration
--                             resolves its shadow brackets on these; until now nothing recorded IG's prices and the client
--                             could not read them, so the reading could not have been run. `fetched_at` says whether a bar was
--                             read after its hour closed. Row level security on, no grant, no policy, like 0157's tables.
--
-- No new call: the bars ride the sync's existing `edge_calls` row (0157).

set lock_timeout = '3s';

alter table public.igbot_requests add column if not exists ig_calls integer not null default 0 check (ig_calls >= 0);

create table if not exists public.igbot_bars (
  epic        text not null,
  hour        timestamptz not null,
  fetched_at  timestamptz not null,
  bid_open    numeric,
  bid_high    numeric not null,
  bid_low     numeric not null,
  bid_close   numeric,
  ask_open    numeric,
  ask_high    numeric not null,
  ask_low     numeric not null,
  ask_close   numeric,
  primary key (epic, hour)
);

alter table public.igbot_bars enable row level security;

reset lock_timeout;
