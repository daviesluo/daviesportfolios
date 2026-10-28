-- 0157: IGBOT, "IG analyst (Grok)": an outside Grok agent trading IG spread bets through this project's server, on IG's
-- DEMO environment only. Grok proposes; the `igbot` function checks every request against IGBOT_RULES (`igbot/rules.ts`)
-- and the agent's own book, journals it, and only then sends it to IG's demo gateway.
--
-- On whose word. Davies, 2026-10-28: "我觉得grokbot做polymarket的这个策略不错，你仔细深度研究下是否可以做个类似的做ig的cfd/options/
-- spread betting的trading bot并搭建架构，做好了给我发prompt". The research is docs/agents/reviews/2026-10-29-igbot-research.md;
-- the pre-registration is a DRAFT (docs/agents/reviews/2026-10-29-igbot-prereg.md), frozen only on his word.
--
-- What it keeps (row level security on, no grant, no policy; only the service role, the function, touches them):
--   igbot_config       one row: `environment` 'demo' under a check that allows nothing else (the code knows no live host
--                      either), `mode` 'dry_run' (checked and journalled, nothing sent) or 'demo' (sent to IG's demo
--                      gateway), `armed_at` (set exactly when the mode is 'demo'), `started_at`, the notional budget
--                      (£1,000), the day stop (−£20), the total stop (−£100) and the orders a UTC day (40).
--   igbot_instruments  the whitelist: the spread-bet epics the bot may open, each read on IG's demo spread-bet account by the
--                      `ig` function's `facts` (ig_facts id 3, 2026-10-15). A market joins by a migration.
--   igbot_decisions    the journal's decisions (open, close, amend, cancel, no_action), with the bracket's driftless m the
--                      server computed beside the agent's p.
--   igbot_cycles, igbot_daily, igbot_requests   a wake's row, a day's summary, every authenticated request (the limits).
--   igbot_orders       every request the server accepted and sent (or, in dry-run, would have sent): its decision, kind,
--                      bracket, deal reference (written before the send), IG's confirmation and the server's checks.
--   igbot_positions    each position the account held, from IG's own lists: opened, amended, closed, the close's level and
--                      how (stop, limit, the bot, the server's 5-day limit), and its P&L in pounds from the levels.
--   igbot_snapshots    one row a five-minute slot: the demo account's equity, balance, unrealised P&L, margin and what is
--                      open, as IG reports it. The test's money is read from here, never from the agent's word.
--   igbot_exec_state   one row: the day's opening equity, the start's, the stops' latches, the lease that keeps two
--                      requests from deciding on one book, the last fault.
--
-- The call. `igbot?action=sync`, every minute, 30 s at most, `retry` true: a second run in its minute reads IG's lists again
-- and upserts the same rows on their keys. It writes its beat first (`beatKeyOfRequest("igbot", req.url)`). Like every row
-- since 0104 it waits 15 minutes (`active_from`'s default) for the function's deploy. Without the demo secrets it answers
-- that it is not configured and reads nothing. Not among the monitor's health readings: a demo path moves no money.
--
-- Going to IG's LIVE environment is not a switch here: it needs a new pre-registration, Davies' word, a migration that
-- drops the environment check and code that knows the live host. Arming the demo path is one statement, run only on his
-- word (play money, but his account and his API key):
--   update public.igbot_config set mode = 'demo', armed_at = now(), started_at = coalesce(started_at, now())
--    where id = 1 and mode = 'dry_run' and armed_at is null returning mode, armed_at, started_at;
-- Its undo (the minute's sync then cancels the bot's working orders; positions keep their guaranteed stops and limits):
--   update public.igbot_config set mode = 'dry_run', armed_at = null where id = 1;
--
-- ⚠️  As 0075: the job's URL is the PRODUCTION project's Edge host, so this row makes any database it is applied to call
-- production.

set lock_timeout = '3s';

create table if not exists public.igbot_config (
  id              integer primary key check (id = 1),
  environment     text not null default 'demo' check (environment = 'demo'),
  mode            text not null default 'dry_run' check (mode in ('dry_run', 'demo')),
  armed_at        timestamptz,
  started_at      timestamptz,
  budget_gbp      numeric not null default 1000 check (budget_gbp > 0 and budget_gbp <= 10000),
  day_stop_gbp    numeric not null default 20 check (day_stop_gbp > 0),
  total_stop_gbp  numeric not null default 100 check (total_stop_gbp > 0),
  max_orders_day  integer not null default 40 check (max_orders_day >= 0 and max_orders_day <= 200),
  created_at      timestamptz not null default now(),
  constraint igbot_config_armed_check check ((mode = 'demo') = (armed_at is not null) and (armed_at is null or started_at is not null))
);
insert into public.igbot_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.igbot_instruments (
  epic     text primary key check (epic ~ '^[A-Za-z0-9._]{6,30}$'),
  name     text not null,
  kind     text not null check (kind in ('index', 'fx', 'commodity')),
  enabled  boolean not null default true,
  added_at timestamptz not null default now()
);
insert into public.igbot_instruments (epic, name, kind) values
  ('IX.D.SPTRD.DAILY.IP', 'US 500', 'index'),
  ('IX.D.NASDAQ.CASH.IP', 'US Tech 100', 'index'),
  ('IX.D.DOW.DAILY.IP', 'Wall Street', 'index'),
  ('IX.D.FTSE.DAILY.IP', 'FTSE 100', 'index'),
  ('IX.D.DAX.DAILY.IP', 'Germany 40', 'index'),
  ('CS.D.AUDUSD.TODAY.IP', 'AUD/USD', 'fx')
on conflict (epic) do nothing;

create table if not exists public.igbot_decisions (
  id            text primary key check (id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  received_at   timestamptz not null default now(),
  ts            timestamptz not null,
  action        text not null check (action in ('open', 'close', 'amend', 'cancel', 'no_action')),
  category      text check (category in ('E', 'N', 'R', 'C')),
  epic          text,
  direction     text check (direction in ('BUY', 'SELL')),
  size          numeric check (size > 0),
  level         numeric,
  stop_level    numeric,
  limit_level   numeric,
  p_target      numeric check (p_target > 0 and p_target < 1),
  m_base        numeric,
  event_at      timestamptz,
  deal_id       text,
  sources       jsonb not null default '[]'::jsonb,
  reason        text not null,
  invalidation  text,
  raw           jsonb not null
);
create index if not exists igbot_decisions_ts on public.igbot_decisions (ts);

create table if not exists public.igbot_cycles (
  id              text primary key check (id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  received_at     timestamptz not null default now(),
  ts              timestamptz not null,
  kind            text not null check (kind in ('light', 'full', 'event')),
  equity_gbp      numeric not null,
  open_positions  integer not null check (open_positions >= 0),
  open_risk_gbp   numeric not null,
  actions         integer not null check (actions >= 0),
  notes           text,
  raw             jsonb not null
);
create index if not exists igbot_cycles_ts on public.igbot_cycles (ts);

create table if not exists public.igbot_daily (
  id             text primary key check (id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  received_at    timestamptz not null default now(),
  day            date not null,
  equity_gbp     numeric not null,
  pnl_day_gbp    numeric not null,
  pnl_total_gbp  numeric not null,
  trades         integer not null check (trades >= 0),
  summary        text not null,
  lessons        text,
  raw            jsonb not null
);

create table if not exists public.igbot_requests (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  status  integer not null,
  rows    integer not null default 0 check (rows >= 0),
  action  text,
  error   text
);
create index if not exists igbot_requests_at on public.igbot_requests (at);

create table if not exists public.igbot_orders (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  mode            text not null check (mode in ('dry_run', 'demo')),
  decision_id     text not null unique references public.igbot_decisions (id),
  kind            text not null check (kind in ('open', 'working', 'close', 'amend', 'cancel', 'auto_close')),
  epic            text not null,
  direction       text check (direction in ('BUY', 'SELL')),
  size            numeric,
  level           numeric,
  stop_level      numeric,
  limit_level     numeric,
  entry           text check (entry in ('market', 'limit', 'stop')),
  good_till       timestamptz,
  deal_reference  text not null unique check (deal_reference ~ '^[A-Za-z0-9_-]{1,30}$'),
  deal_id         text,
  state           text not null check (state in ('dry_run', 'pending', 'accepted', 'rejected', 'unknown')),
  reason          text,
  request         jsonb,
  confirm         jsonb,
  checks          jsonb
);
create index if not exists igbot_orders_created on public.igbot_orders (created_at);

create table if not exists public.igbot_positions (
  deal_id      text primary key,
  epic         text not null,
  direction    text not null check (direction in ('BUY', 'SELL')),
  size         numeric not null,
  open_level   numeric not null,
  stop_level   numeric,
  limit_level  numeric,
  guaranteed   boolean not null,
  premium      numeric not null default 0,
  opened_at    timestamptz not null,
  order_id     bigint references public.igbot_orders (id),
  decision_id  text,
  state        text not null check (state in ('open', 'closed')),
  closed_at    timestamptz,
  close_level  numeric,
  close_how    text check (close_how in ('stop', 'limit', 'bot', 'server', 'unknown')),
  pnl_gbp      numeric,
  updated_at   timestamptz not null default now()
);

create table if not exists public.igbot_snapshots (
  slot           timestamptz primary key,
  at             timestamptz not null,
  ok             boolean not null,
  equity_gbp     numeric,
  balance_gbp    numeric,
  upl_gbp        numeric,
  margin_gbp     numeric,
  available_gbp  numeric,
  open_risk_gbp  numeric,
  positions      jsonb not null default '[]'::jsonb,
  working        jsonb not null default '[]'::jsonb,
  error          text
);

create table if not exists public.igbot_exec_state (
  id           integer primary key check (id = 1),
  state        jsonb not null default '{}'::jsonb,
  lease_until  timestamptz,
  lease_owner  text,
  updated_at   timestamptz,
  last_error   text
);
insert into public.igbot_exec_state (id) values (1) on conflict (id) do nothing;

alter table public.igbot_config      enable row level security;
alter table public.igbot_instruments enable row level security;
alter table public.igbot_decisions   enable row level security;
alter table public.igbot_cycles      enable row level security;
alter table public.igbot_daily       enable row level security;
alter table public.igbot_requests    enable row level security;
alter table public.igbot_orders      enable row level security;
alter table public.igbot_positions   enable row level security;
alter table public.igbot_snapshots   enable row level security;
alter table public.igbot_exec_state  enable row level security;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('igbot?action=sync', 30000, 1, 23, true) on conflict (path) do nothing;

reset lock_timeout;
