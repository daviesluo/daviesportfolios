-- 0163: CXBOT, "Crypto analyst": an outside Grok agent forecasting and trading BTC, ETH and SOL perpetuals, long and short,
-- ON PAPER, against a venue's live PUBLIC market data. Grok proposes; the `cxbot` function checks every request against
-- CXBOT_RULES (`cxbot/rules.ts`), journals it, and fills it on paper by a conservative model; it also assigns the questions
-- the reading scores (brackets every four hours, Polymarket's daily strikes) and records the tape they resolve on.
--
-- On whose word. Davies, 2026-10-28: "我打算把币所的买卖交易也做成一套类似于用grokbot交易polymarkt/ig的系统…并且最好long和short都可以做";
-- 2026-10-29: "…只判断对策略来说最优的币所，给grok的prompt里也需要提供具体的数据和概率推断来源等，确保一切设定最佳", and his standing
-- instruction that a verified audit is built and shown in TESTING. The research is
-- docs/agents/reviews/2026-10-29-crypto-grok-bot-research.md, the audit docs/agents/reviews/2026-10-29-crypto-grok-bot-audit.md,
-- the pre-registration a DRAFT (docs/agents/reviews/2026-10-29-cxbot-phase1-prereg.md), frozen only on his word.
--
-- No key, no wallet, no session at any venue: every read is public (`cxbot/client.ts` knows a fixed list of public hosts
-- and refuses anything else before `fetch`). There is no live mode: `mode` is 'dry_run' or 'paper' under a check; a live
-- phase is a new pre-registration, Davies' word and a migration.
--
-- What it keeps (row level security on, no grant, no policy; only the service role, the function, touches them):
--   cxbot_config      one row: `mode` 'dry_run' (the default: the recorder runs, an order is checked and journalled and
--                     answered with the fill it would get, no question is issued) or 'paper' (the test: questions issued,
--                     orders filled on paper); `venue` the tape's ('hyperliquid', or 'binance' / 'okx' if `reach` finds
--                     Hyperliquid unreachable from this project's region); `started_at` (the go), `ended_at`; the notional
--                     budget ($1,000), the day stop (−$20), the total stop (−$100), the orders a UTC day (30).
--   cxbot_tape        the recorder: each complete minute's candle (open, high, low, close, volume, trades) of each coin on
--                     the venue, and, on the minute it was read, the book's touch, the mark, the index, funding (per hour),
--                     open interest and premium. The questions, the paper fills and the reading resolve on it.
--   cxbot_ctx         the context handed to the agent, by kind and time (Deribit's vol, Polymarket's daily questions,
--                     Binance's spot, funding predictions, liquidations, flows, realised vol).
--   cxbot_questions   every assigned question (layer A: a bracket; layer B: a Polymarket strike) with the server's numbers.
--   cxbot_forecasts   the agent's answer to each question, one per question.
--   cxbot_decisions, cxbot_cycles, cxbot_daily, cxbot_requests   the journal, as GROKPM's and IGBOT's.
--   cxbot_orders      every open, close, amend and cancel the server accepted (or, in dry-run, would have).
--   cxbot_positions   each paper position: its bracket as opened and as amended, leverage, liquidation price, fees, funding,
--                     how it closed and its P&L.
--   cxbot_snapshots   the paper equity each five minutes: the test's money.
--   cxbot_reach       the `reach` probe's reads from this project's region (audit §2.2).
--   cxbot_exec_state  one row: the engine's minute, the day's opening equity, the stops' latches, the lease, the last fault.
--
-- The call. `cxbot?action=tick`, every minute, 50 s at most, `retry` true: it records the tape (upserts on the venue,
-- coin and minute), then moves the paper engine forward from the minute it last decided (kept in `cxbot_exec_state`), so a
-- second run in its minute decides nothing twice. It writes its beat first (`beatKeyOfRequest("cxbot", req.url)`). Like
-- every row since 0104 it waits 15 minutes (`active_from`) for the function's deploy. Not among the monitor's health
-- readings: a paper path moves no money (a live phase adds one).
--
-- The go (the test's start, the prereg's §3; run only on Davies' word):
--   update public.cxbot_config set mode = 'paper', started_at = now(), ended_at = null
--    where id = 1 and mode = 'dry_run' returning mode, venue, started_at;
-- The end (the main session, at the prereg's end): update public.cxbot_config set mode = 'dry_run', ended_at = now() where id = 1;
-- A venue change after `reach` (before the go only): update public.cxbot_config set venue = 'binance' where id = 1 and mode = 'dry_run';
--
-- ⚠️  As 0075: the job's URL is the PRODUCTION project's Edge host, so this row makes any database it is applied to call
-- production.

set lock_timeout = '3s';

create table if not exists public.cxbot_config (
  id              integer primary key check (id = 1),
  mode            text not null default 'dry_run' check (mode in ('dry_run', 'paper')),
  venue           text not null default 'hyperliquid' check (venue in ('hyperliquid', 'binance', 'okx')),
  started_at      timestamptz,
  ended_at        timestamptz,
  budget_usd      numeric not null default 1000 check (budget_usd > 0 and budget_usd <= 100000),
  day_stop_usd    numeric not null default 20 check (day_stop_usd > 0),
  total_stop_usd  numeric not null default 100 check (total_stop_usd > 0),
  max_orders_day  integer not null default 30 check (max_orders_day >= 0 and max_orders_day <= 200),
  created_at      timestamptz not null default now(),
  constraint cxbot_config_started_check check (mode <> 'paper' or started_at is not null)
);
insert into public.cxbot_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.cxbot_tape (
  venue       text not null,
  coin        text not null check (coin in ('BTC', 'ETH', 'SOL')),
  t           timestamptz not null,
  o           numeric,
  h           numeric,
  l           numeric,
  c           numeric,
  v           numeric,
  n           integer,
  bid         numeric,
  ask         numeric,
  mark        numeric,
  idx         numeric,
  funding     numeric,
  oi          numeric,
  premium     numeric,
  fetched_at  timestamptz not null default now(),
  primary key (venue, coin, t)
);

create table if not exists public.cxbot_ctx (
  kind  text not null check (kind in ('deribit', 'polymarket', 'spot', 'vol', 'liquidations', 'flows', 'stablecoins')),
  at    timestamptz not null,
  data  jsonb not null,
  primary key (kind, at)
);

create table if not exists public.cxbot_questions (
  id           text primary key check (id ~ '^[A-Za-z0-9._:-]{1,96}$'),
  layer        text not null check (layer in ('A', 'B')),
  issued_at    timestamptz not null,
  deadline     timestamptz not null,
  coin         text not null check (coin in ('BTC', 'ETH', 'SOL')),
  direction    text check (direction in ('long', 'short')),
  sd24         numeric,
  stop_frac    numeric,
  limit_frac   numeric,
  hold_ms      bigint,
  start_at     timestamptz,
  entry        numeric,
  stop         numeric,
  limit_px     numeric,
  m            numeric,
  pm_slug      text,
  pm_market    text,
  pm_strike    numeric,
  pm_question  text,
  pm_end       timestamptz,
  pm_mid       numeric,
  pm_last      numeric,
  deribit_p    numeric,
  numbers      jsonb not null default '{}'::jsonb,
  state        text not null default 'open' check (state in ('open', 'scoring', 'resolved', 'void')),
  y            numeric check (y >= 0 and y <= 1),
  y_alt        numeric check (y_alt >= 0 and y_alt <= 1),
  how          text,
  resolved_at  timestamptz
);
create index if not exists cxbot_questions_issued on public.cxbot_questions (issued_at);

create table if not exists public.cxbot_forecasts (
  question_id  text primary key references public.cxbot_questions (id),
  received_at  timestamptz not null default now(),
  p            numeric not null check (p > 0 and p < 1),
  reason       text not null,
  sources      jsonb not null default '[]'::jsonb,
  raw          jsonb not null
);

create table if not exists public.cxbot_decisions (
  id            text primary key check (id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  received_at   timestamptz not null default now(),
  ts            timestamptz not null,
  action        text not null check (action in ('open', 'close', 'amend', 'cancel', 'no_action')),
  category      text check (category in ('E', 'N', 'R', 'C')),
  coin          text check (coin in ('BTC', 'ETH', 'SOL')),
  direction     text check (direction in ('long', 'short')),
  size          numeric check (size > 0),
  entry         numeric,
  stop          numeric,
  limit_px      numeric,
  p             numeric check (p > 0 and p < 1),
  m_base        numeric,
  event_at      timestamptz,
  position_id   bigint,
  sources       jsonb not null default '[]'::jsonb,
  reason        text not null,
  invalidation  text,
  raw           jsonb not null
);
create index if not exists cxbot_decisions_ts on public.cxbot_decisions (ts);

create table if not exists public.cxbot_cycles (
  id              text primary key check (id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  received_at     timestamptz not null default now(),
  ts              timestamptz not null,
  kind            text not null check (kind in ('full', 'pm', 'event', 'light')),
  equity_usd      numeric not null,
  open_positions  integer not null check (open_positions >= 0),
  open_risk_usd   numeric not null,
  answered        integer not null check (answered >= 0),
  actions         integer not null check (actions >= 0),
  notes           text,
  raw             jsonb not null
);
create index if not exists cxbot_cycles_ts on public.cxbot_cycles (ts);

create table if not exists public.cxbot_daily (
  id             text primary key check (id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  received_at    timestamptz not null default now(),
  day            date not null,
  equity_usd     numeric not null,
  pnl_day_usd    numeric not null,
  pnl_total_usd  numeric not null,
  trades         integer not null check (trades >= 0),
  summary        text not null,
  lessons        text,
  raw            jsonb not null
);

create table if not exists public.cxbot_requests (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  status  integer not null,
  rows    integer not null default 0 check (rows >= 0),
  action  text,
  error   text
);
create index if not exists cxbot_requests_at on public.cxbot_requests (at);

create table if not exists public.cxbot_orders (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  mode         text not null check (mode in ('dry_run', 'paper')),
  decision_id  text not null unique references public.cxbot_decisions (id),
  kind         text not null check (kind in ('open', 'close', 'amend', 'cancel', 'auto_close')),
  coin         text not null check (coin in ('BTC', 'ETH', 'SOL')),
  direction    text check (direction in ('long', 'short')),
  entry_type   text check (entry_type in ('market', 'limit', 'stop')),
  size         numeric,
  entry        numeric,
  stop         numeric,
  limit_px     numeric,
  p            numeric,
  good_till    timestamptz,
  position_id  bigint,
  state        text not null check (state in ('dry_run', 'resting', 'filled', 'cancelled', 'expired', 'done')),
  fill_price   numeric,
  filled_at    timestamptz,
  fee_usd      numeric,
  leverage     numeric,
  checks       jsonb
);
create index if not exists cxbot_orders_created on public.cxbot_orders (created_at);

create table if not exists public.cxbot_positions (
  id             bigserial primary key,
  order_id       bigint not null references public.cxbot_orders (id),
  decision_id    text not null,
  coin           text not null check (coin in ('BTC', 'ETH', 'SOL')),
  direction      text not null check (direction in ('long', 'short')),
  size           numeric not null check (size > 0),
  entry          numeric not null,
  stop           numeric not null,
  limit_px       numeric not null,
  stop0          numeric not null,
  limit0         numeric not null,
  p              numeric,
  leverage       numeric not null,
  liq_price      numeric not null,
  opened_at      timestamptz not null,
  fee_open_usd   numeric not null default 0,
  funding_usd    numeric not null default 0,
  state          text not null check (state in ('open', 'closed')),
  closed_at      timestamptz,
  close_price    numeric,
  close_how      text check (close_how in ('stop', 'limit', 'agent', 'server', 'liquidation')),
  fee_close_usd  numeric,
  pnl_usd        numeric,
  updated_at     timestamptz not null default now()
);

create table if not exists public.cxbot_snapshots (
  slot            timestamptz primary key,
  at              timestamptz not null,
  equity_usd      numeric not null,
  realised_usd    numeric not null,
  unrealised_usd  numeric not null,
  fees_usd        numeric not null,
  funding_usd     numeric not null,
  open_risk_usd   numeric not null,
  positions       integer not null
);

create table if not exists public.cxbot_reach (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  region  text,
  target  text not null,
  url     text not null,
  status  integer,
  ms      integer,
  ok      boolean not null,
  note    text
);

create table if not exists public.cxbot_exec_state (
  id           integer primary key check (id = 1),
  state        jsonb not null default '{}'::jsonb,
  lease_until  timestamptz,
  lease_owner  text,
  updated_at   timestamptz,
  last_error   text
);
insert into public.cxbot_exec_state (id) values (1) on conflict (id) do nothing;

alter table public.cxbot_config      enable row level security;
alter table public.cxbot_tape        enable row level security;
alter table public.cxbot_ctx         enable row level security;
alter table public.cxbot_questions   enable row level security;
alter table public.cxbot_forecasts   enable row level security;
alter table public.cxbot_decisions   enable row level security;
alter table public.cxbot_cycles      enable row level security;
alter table public.cxbot_daily       enable row level security;
alter table public.cxbot_requests    enable row level security;
alter table public.cxbot_orders      enable row level security;
alter table public.cxbot_positions   enable row level security;
alter table public.cxbot_snapshots   enable row level security;
alter table public.cxbot_reach       enable row level security;
alter table public.cxbot_exec_state  enable row level security;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('cxbot?action=tick', 50000, 1, 23, true) on conflict (path) do nothing;

reset lock_timeout;
