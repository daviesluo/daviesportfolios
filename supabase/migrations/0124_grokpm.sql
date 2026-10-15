-- 0124: "Polymarket analyst (Grok)", GROKPM: an outside agent's journal and an independent record of its wallet.
--
-- On whose word. Davies, 2026-10-15: "Polymarket我目前还有些钱，要不让grok bot里开一个trading bot，给他100美元让他每小时或每半小时盯一次，
-- 自己在市场里找机会下单买卖…", then "这些也做到github中也写到prompt里，每天的日志和汇总也都自动化和我们之前网站中rewards策略一样实时更新…
-- 网站中live页也加上策略和子策略页面（仿照之前rewards策略来做）…先让他就用100美元测试". Pre-registered in
-- docs/agents/reviews/2026-10-15-grokpm-prereg.md, frozen at the commit that adds this file.
--
-- An external Grok agent (another platform, not this repository's code) trades a separate Polymarket wallet that Davies funds
-- with $100. Nothing here trades, signs, holds a key or can place an order. Two halves:
--
--   The JOURNAL, what the agent says it did and why, posted by the agent itself to the `grokpm` Edge Function with its own
--   bearer secret (`GROKPM_LOG_TOKEN`), validated there and stored as received:
--     grokpm_decisions  one row a decision (open, close, cancel, no_action) with its market, side, price, size, the agent's
--                       probability p, the market's mid m as it saw it, its category, sources, reason and invalidation.
--     grokpm_cycles     one row a wake: its kind, the cash, positions value and P&L as the agent sees them, its action count.
--     grokpm_daily      one row a daily summary.
--     grokpm_requests   one row an authenticated request (status, rows, error): the hourly rate limit counts it. No body is
--                       kept for a refused request.
--   Every free-text field is untrusted data: stored and shown as text, never executed, never read as an instruction.
--
--   The RECORD, what the wallet actually holds, read keylessly every five minutes by `agents?action=grokpmrec`
--   (agents/grokpm_rec.ts) from Polymarket's public data API and a public Polygon RPC, so the page's money never rests on the
--   agent's word:
--     grokpm_config     one row: the wallet (null until Davies sends it; a later one-line migration sets it, and while it is
--                       null the recorder reads nothing), FUNDED ($100), the agent's stops ($10 a day, $30 in all) as the page
--                       computes their room, and `started_at`, stamped by the recorder at its first snapshot holding at least
--                       90 % of FUNDED (the pre-registration's start).
--     grokpm_snapshots  one row a five-minute slot: the wallet's pUSD, USDC.e and USDC on Polygon, each position with its size,
--                       average price and each held market's mid at that moment (the CLOB's book), the data API's own /value
--                       beside it, and the equity (cash + positions at the mids).
--     grokpm_activity   every item of the wallet's public activity once (trades, redemptions, splits, merges), as served.
--     grokpm_entries    each token the wallet came to hold, once: when it was first seen and the market's mid then, which is
--                       the market's probability the Brier comparison scores (the pre-registration's §5).
--     grokpm_resolutions each market the wallet touched, once Gamma shows it resolved: its tokens and their payouts.
--     grokpm_rec_state  one row: the last fault reported, the newest activity read, the last resolution check.
--
-- Its size: 288 snapshots a day of a few positions (about 1 KB each, 0.3 MB a day); the journal a few hundred rows a day at
-- most (the function refuses more than 200 rows an hour). Kept: it is a four-week experiment's whole record.
--
-- The call. Every five minutes, all day, `retry` true: a second run in its slot changes nothing the first did (the snapshot's
-- key is the slot, activity is keyed on its content, entries and resolutions are written once). 30 s at most, under the
-- minute like every row (0099). It writes its beat first (the `agents` function's, before its work). Like every row since
-- 0104 it waits 15 minutes (`active_from`'s default) for the function's deploy; an insert never names it. Not among the
-- monitor's health readings (a recorder of someone else's trading stops nothing); its faults go to the errors box as
-- `agents.grokpm_rec`.
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` from the
-- new tables and the view. Only the service role (the two functions) touches them.
--
-- ⚠️  As 0075: the job's URL is the PRODUCTION project's Edge host, so this row makes any database it is applied to call
-- production.

create table if not exists public.grokpm_config (
  id               integer primary key check (id = 1),
  wallet           text check (wallet ~ '^0x[0-9a-f]{40}$'),          -- the Polymarket proxy wallet (its profile address), lower case
  funded_usd       numeric not null default 100 check (funded_usd > 0),
  daily_loss_usd   numeric not null default 10 check (daily_loss_usd > 0),
  total_stop_usd   numeric not null default 30 check (total_stop_usd > 0),
  started_at       timestamptz,                                          -- the recorder's first snapshot holding ≥ 90 % of FUNDED
  created_at       timestamptz not null default now()
);
insert into public.grokpm_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.grokpm_decisions (
  id           text primary key check (id ~ '^[A-Za-z0-9._:-]{1,64}$'),   -- the agent's own id: a resend is a duplicate, not a row
  received_at  timestamptz not null default now(),
  ts           timestamptz not null,
  action       text not null check (action in ('open', 'close', 'cancel', 'no_action')),
  market_id    text check (market_id ~ '^0x[0-9a-f]{64}$'),
  token_id     text check (token_id ~ '^[0-9]{1,80}$'),
  outcome      text,
  side         text check (side in ('BUY', 'SELL')),
  price        numeric check (price > 0 and price < 1),
  size         numeric check (size > 0),
  p            numeric check (p >= 0 and p <= 1),
  m            numeric check (m >= 0 and m <= 1),
  category     text check (category in ('A', 'B', 'C')),
  sources      jsonb not null default '[]'::jsonb,
  reason       text not null,
  invalidation text,
  order_id     text,
  raw          jsonb not null
);
create index if not exists grokpm_decisions_ts on public.grokpm_decisions (ts);

create table if not exists public.grokpm_cycles (
  id                  text primary key check (id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  received_at         timestamptz not null default now(),
  ts                  timestamptz not null,
  kind                text not null check (kind in ('light', 'full', 'event')),
  cash_usd            numeric not null,
  positions_value_usd numeric not null,
  pnl_usd             numeric not null,
  open_positions      integer not null check (open_positions >= 0),
  actions             integer not null check (actions >= 0),
  notes               text,
  raw                 jsonb not null
);
create index if not exists grokpm_cycles_ts on public.grokpm_cycles (ts);

create table if not exists public.grokpm_daily (
  id                  text primary key check (id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  received_at         timestamptz not null default now(),
  day                 date not null,
  cash_usd            numeric not null,
  positions_value_usd numeric not null,
  pnl_day_usd         numeric not null,
  pnl_total_usd       numeric not null,
  trades              integer not null check (trades >= 0),
  summary             text not null,
  lessons             text,
  raw                 jsonb not null
);
create index if not exists grokpm_daily_day on public.grokpm_daily (day);

create table if not exists public.grokpm_requests (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  status integer not null,
  rows   integer not null default 0 check (rows >= 0),          -- rows stored (duplicates and refusals count none)
  error  text
);
create index if not exists grokpm_requests_at on public.grokpm_requests (at);

create table if not exists public.grokpm_snapshots (
  slot                timestamptz primary key,                   -- the five-minute slot it was read in
  at                  timestamptz not null,                      -- when the reads finished
  cash_pusd           numeric not null,
  cash_usdce          numeric not null,
  cash_usdc           numeric not null,
  cash_usd            numeric not null,
  positions_value_usd numeric not null,                          -- Σ size × mark: the mid, or the payout once redeemable
  value_api_usd       numeric,                                   -- the data API's /value, beside it
  equity_usd          numeric not null,
  positions           jsonb not null default '[]'::jsonb
);

create table if not exists public.grokpm_activity (
  key          text primary key,                                 -- sha-256 of the item as served
  ts           timestamptz not null,
  type         text not null,
  cond         text,
  asset        text,
  side         text,
  size         numeric,
  price        numeric,
  usdc_size    numeric,
  tx           text,
  outcome_index integer,
  title        text,
  raw          jsonb not null,
  recorded_at  timestamptz not null default now()
);
create index if not exists grokpm_activity_ts on public.grokpm_activity (ts);

create table if not exists public.grokpm_entries (
  asset          text primary key,
  cond           text not null,
  outcome_index  integer,
  title          text,
  first_seen_at  timestamptz not null,
  first_fill_at  timestamptz,
  mid            numeric,                                        -- the market's mid when first seen: its probability, for Brier
  mid_at         timestamptz,
  avg_price      numeric
);

create table if not exists public.grokpm_resolutions (
  cond       text primary key,
  tokens     jsonb not null,                                     -- the market's token ids, in its outcome order
  payouts    jsonb not null,                                     -- each token's payout, 0 or 1
  closed_at  timestamptz,
  read_at    timestamptz not null default now()
);

create table if not exists public.grokpm_rec_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz,
  last_error  text,
  last_report jsonb
);
insert into public.grokpm_rec_state (id) values (1) on conflict (id) do nothing;

-- Each UTC day's first snapshot: the day's opening equity, for DAYS and TODAY.
create or replace view public.grokpm_day_opens with (security_invoker = true) as
  select distinct on ((slot at time zone 'utc')::date) (slot at time zone 'utc')::date as day, slot, equity_usd
  from public.grokpm_snapshots
  order by (slot at time zone 'utc')::date, slot;

alter table public.grokpm_config      enable row level security;
alter table public.grokpm_decisions   enable row level security;
alter table public.grokpm_cycles      enable row level security;
alter table public.grokpm_daily       enable row level security;
alter table public.grokpm_requests    enable row level security;
alter table public.grokpm_snapshots   enable row level security;
alter table public.grokpm_activity    enable row level security;
alter table public.grokpm_entries     enable row level security;
alter table public.grokpm_resolutions enable row level security;
alter table public.grokpm_rec_state   enable row level security;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=grokpmrec', 30000, 5, 23, true) on conflict (path) do nothing;
