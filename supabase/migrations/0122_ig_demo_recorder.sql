-- 0122: IG's demo API, read-only, for the FXW / WKND verification (`supabase/functions/ig/`; review
-- docs/agents/reviews/2026-10-15-ig-verification.md; spec docs/agents/backtests/ig_deepdive/SPEC-for-verification.md).
--
-- On whose word. Davies, 2026-10-15: "ig我的账户开好了，api也加了" (demo and live keys stored as Edge secrets, each tested
-- by him) and "FXW-AUD你继续验证研究并记录，除此之外你再深度研究下ig的spread betting和cfd的策略". That meets the spec's
-- starting condition for the demo read-only work, and is the separate ask its hard rule 3 reserved a production build
-- for. Nothing here can trade: the function's client refuses every IG call but login, the switch between the two demo
-- accounts and a fixed list of GETs, on the demo host only, before anything is sent (pinned in its Deno test).
--
-- What it keeps:
--   ig_facts        one row per `?action=facts` call (G1): an account's session and account list with every balance
--                   stripped, IG's search answers, the epic chosen for each role with every candidate seen, and each
--                   chosen epic's `/markets/{epic}` details (dealing rules, margin bands, hours, rollover). Kept.
--   ig_price_pulls  one row per `/prices` request of `?action=history` (G2): the frozen window it asked for, the raw
--                   answer (bid/ask/last OHLC per HOUR bar, as served) and the allowance IG reported after it. Kept: the
--                   committed CSVs are parsed from these answers.
--   ig_quotes       G4's recorder by REST: each demo account's quote for each epic of the weekend windows, a row when
--                   bid, offer or market status changes, extended (`seen_until`, `reads`) while it does not
--                   (`public.ig_quotes_record`). Received time is this function's clock; IG's own `updateTime` is kept as
--                   served, never replaced.
--   ig_quote_runs   every recorder run: its windows, snapshots, requests, logins, account switches, IG's `Date` header
--                   against the function's clock, its error. Uptime is read from here.
--   ig_action_log   the report of each `facts` and `history` call: they answer 202 at once and run on under `waitUntil`
--                   (a call fired through pg_net must not hold the one-minute job's next batch), so the report lands here.
--
-- Its size. A weekend is ~2,465 minutes of the WKND window (7 weekend markets on 2 accounts), ~1,515 of SUN (2 on 2) and
-- ~250 of SUNIDX (4 on 2): at most ~85,000 quote rows a weekend if every snapshot changed, ~120 bytes each, ~10 MB; the
-- spec's twelve weekends ~120 MB at most. Runs: ~4,000 rows a weekend, ~1 MB. History: the frozen plans are ~600 requests
-- of ~10 KB raw. The database was 1.29 GB on 2026-10-09. Nothing is pruned: the study reads all of it, and the tables go
-- once its write-up is landed, by a migration of their own.
--
-- The row. `ig?action=quotes`, every minute, 55 s (two snapshots, at the minute and 30 s in), switched on and off by
-- `public.ig_quotes_toggle()` every five minutes (at :03, :08 …, off the batch's :X0 and the response prune's :X5): on
-- from Friday 21:35 to 22:20 and from Saturday 07:40 to Monday 22:20, UK time (`public.ig_quotes_window`), so it is called
-- around the spec's windows only; the function itself records only inside the exact windows (`windows.ts`, which its
-- Deno test checks lie inside this one with ten minutes to spare). Its beat is the `ig` function's, written before its
-- work. `retry` true: a second run in a minute adds one more snapshot, and a quote that did not change only extends its
-- row. Like every row since 0104 it waits 15 minutes for the function's deploy.
--
-- Not among the monitor's health readings: a research recorder that stops trades nothing; a failing run goes to the
-- errors box (`ig.quotes`, the first of a streak and then hourly) and the watchdog reruns a call that never started.
--
-- No grant to anon or authenticated, no policy: row level security is on, and 0082's default privileges keep them out.
-- The service role (the function) writes; postgres runs the toggle.
--
-- ⚠️  As 0075: the job's URL is the PRODUCTION project's Edge host, so this row makes any database it is applied to call
-- production.

set lock_timeout = '3s';

create table if not exists public.ig_facts (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  account_kind    text not null check (account_kind in ('sb', 'cfd')),
  account_id      text,
  ok              boolean not null,
  selected        jsonb not null default '{}'::jsonb,   -- role → epic
  payload         jsonb not null default '{}'::jsonb,   -- session, accounts (no balances), searches, candidates, details
  errors          jsonb not null default '[]'::jsonb,
  requests        integer,
  clock_offset_ms integer                               -- IG's Date header against the function's clock
);
create index if not exists ig_facts_kind_id on public.ig_facts (account_kind, id desc);

create table if not exists public.ig_price_pulls (
  id                  bigint generated always as identity primary key,
  at                  timestamptz not null default now(),
  account_kind        text not null check (account_kind in ('sb', 'cfd')),
  account_id          text,
  plan                text not null check (plan in ('probe', 'fxw', 'wknd', 'esg')),
  role                text not null,
  epic                text not null,
  resolution          text not null check (resolution = 'HOUR'),
  window_key          text not null,                    -- plan:role:friday
  from_param          text not null,                    -- as sent, yyyy-MM-ddTHH:mm:ss (UTC; padded two hours)
  to_param            text not null,
  ok                  boolean not null,
  status              integer,
  points              integer,
  remaining_allowance integer,
  total_allowance     integer,
  allowance_expiry_s  integer,
  raw                 jsonb,                            -- IG's answer as served
  error               text
);
create unique index if not exists ig_price_pulls_done on public.ig_price_pulls (account_kind, epic, window_key) where ok;

create table if not exists public.ig_quotes (
  account_kind    text not null check (account_kind in ('sb', 'cfd')),
  account_id      text not null,
  epic            text not null,
  ts              timestamptz not null,                 -- received: the first snapshot with these values
  seen_until      timestamptz not null,                 -- the last snapshot that found them unchanged
  reads           integer not null default 1 check (reads >= 1),
  bid             numeric,
  offer           numeric,
  market_status   text not null,                        -- TRADEABLE, CLOSED, EDITS_ONLY, OFFLINE, ON_AUCTION, SUSPENDED, UNKNOWN …
  update_time     text,                                 -- IG's snapshot updateTime, as served
  update_time_utc text,                                 -- and updateTimeUTC, when served
  delay_time      integer,
  primary key (account_kind, epic, ts)
);

create table if not exists public.ig_quote_runs (
  id              bigint generated always as identity primary key,
  started_at      timestamptz not null,
  windows         text[] not null,
  ok              boolean not null,
  snapshots       integer not null,
  samples         integer not null,
  changed         integer,
  requests        integer not null,
  logins          integer not null,
  switches        integer not null,
  clock_offset_ms integer,
  ms              integer not null,
  error           text,
  reported        boolean not null default false
);
create index if not exists ig_quote_runs_started on public.ig_quote_runs (started_at);

create table if not exists public.ig_action_log (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  action  text not null check (action in ('facts', 'history')),
  params  jsonb not null default '{}'::jsonb,
  result  jsonb
);

alter table public.ig_action_log  enable row level security;
alter table public.ig_facts       enable row level security;
alter table public.ig_price_pulls enable row level security;
alter table public.ig_quotes      enable row level security;
alter table public.ig_quote_runs  enable row level security;

-- One call a minute's snapshots in one statement: a quote whose bid, offer and status are the newest row's extends that
-- row; any change starts a new one. Returns how many rows were started.
create or replace function public.ig_quotes_record(samples jsonb)
returns integer
language plpgsql
set search_path = ''
as $fn$
declare
  s jsonb;
  last_row public.ig_quotes;
  t timestamptz;
  started integer := 0;
begin
  for s in select * from jsonb_array_elements(samples) loop
    t := (s->>'received_at')::timestamptz;
    select * into last_row from public.ig_quotes q
      where q.account_kind = s->>'account_kind' and q.epic = s->>'epic'
      order by q.ts desc limit 1;
    if found and last_row.ts <= t
       and last_row.bid is not distinct from (s->>'bid')::numeric
       and last_row.offer is not distinct from (s->>'offer')::numeric
       and last_row.market_status = s->>'market_status' then
      update public.ig_quotes set seen_until = greatest(seen_until, t), reads = reads + 1
        where account_kind = last_row.account_kind and epic = last_row.epic and ts = last_row.ts;
    else
      insert into public.ig_quotes (account_kind, account_id, epic, ts, seen_until, bid, offer, market_status, update_time, update_time_utc, delay_time)
      values (s->>'account_kind', s->>'account_id', s->>'epic', t, t, (s->>'bid')::numeric, (s->>'offer')::numeric,
              s->>'market_status', s->>'update_time', s->>'update_time_utc', (s->>'delay_time')::integer)
      on conflict (account_kind, epic, ts) do nothing;
      started := started + 1;
    end if;
  end loop;
  return started;
end $fn$;
revoke all on function public.ig_quotes_record(jsonb) from public, anon, authenticated;
grant execute on function public.ig_quotes_record(jsonb) to service_role;

-- The wider window, UK time: Friday 21:35–22:20, Saturday 07:40 to Monday 22:20.
create or replace function public.ig_quotes_window(t timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select case extract(isodow from l)::int
    when 5 then l::time >= time '21:35' and l::time < time '22:20'
    when 6 then l::time >= time '07:40'
    when 7 then true
    when 1 then l::time < time '22:20'
    else false
  end
  from (select t at time zone 'Europe/London' as l) as x;
$fn$;
revoke all on function public.ig_quotes_window(timestamptz) from public, anon, authenticated;

create or replace function public.ig_quotes_toggle()
returns boolean
language plpgsql
set search_path = ''
as $fn$
declare
  want boolean := public.ig_quotes_window(now());
begin
  update public.edge_calls set enabled = want where path = 'ig?action=quotes' and enabled is distinct from want;
  return want;
end $fn$;
revoke all on function public.ig_quotes_toggle() from public, anon, authenticated;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('ig?action=quotes', 55000, 1, 23, true) on conflict (path) do nothing;
update public.edge_calls set enabled = false where path in ('ig?action=quotes');

select cron.schedule(
  'ig-quotes-window',
  '3-58/5 * * * *',
  $$ select public.ig_quotes_toggle(); $$
);

select public.ig_quotes_toggle();

reset lock_timeout;
