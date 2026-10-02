-- 0081: "Reward quotes mid-pool": Polymarket's order path and its paper layer run again, on rewarded markets of $10 to
-- under $50 a day, in DRY-RUN only, and only ever a dry-run from this file.
--
-- On whose word. Davies, 2026-10-02, verbatim:
--
--   把目前Reward quotes live-prep改名为Reward quotes small-pool，再做一个Reward quotes mid-pool只做10-50，同时也不打扰其他的Reward
--   quotes，也是400美元funded测试
--
-- In English: rename "Reward quotes live-prep" to "Reward quotes small-pool"; build a "Reward quotes mid-pool" that only
-- does $10–50, without disturbing the other Reward quotes, also tested as funded with $400.
--
-- What runs. The same code as small-pool (agents/pm_live.ts, agents/pm_prep.ts), each given mid-pool's instance
-- (agents/pm_mid.ts): `agents?action=pmmid&forceFunctionRegion=eu-west-1` every minute from eu-west-1 (the path) and
-- `agents?action=pmmidprep` every minute (its paper layer, two minutes behind). Its tables below are small-pool's final
-- shapes (0074 and 0076 for the path, 0077 for the layer) under `pm_mid_*` and `pm_midprep_*`; its band, a total daily
-- reward rate of at least $10 and under $50, is a CHECK on the day's markets and on every minute. Its sizes are
-- small-pool's at the $400 deposit (0080): eight markets a UTC day and $160 of first quotes, $320 in all, $60 a market,
-- -$25 a day and -$75 in all, GTD orders of 600 s. Every filter of the selection but the band, RW's ranking, RW's quoting
-- rule as RW-E applies it, the gates, the caps and the stops are the path's own.
--
-- Never live from here. The config refuses `dry_run` false and any `live_confirmed_at`, and the orders table refuses
-- every mode but `dry_run`, so not even the pending row a live order must have before its POST can be written. Its
-- action loads no signing key and its wire refuses every POST and DELETE (agents/index.ts). One Polymarket account cannot
-- carry two live paths: mid-pool going live would be a later migration, on Davies' own word.
--
-- The other Reward quotes. RW (to 10-09), RW-E and RW-X (replays on RW's minutes) and RW-C (10-09 -> 10-23, warm-up
-- 10-08) quote, on paper, the markets RW's frozen selection takes from rates of $10 and over, which holds this band.
-- Mid-pool reads none of their tables. At its own selection it recomputes RW's rule from public data, with RW's own
-- functions and reads, and leaves out of its universe every market scoring at least 0.33 of the last market that rule
-- takes (a margin of 0.67), recording how many it left out, never which (agents/pm_mid.ts). Its pre-registration,
-- frozen before its first full UTC day: docs/agents/reviews/2026-10-02-polymarket-mid-pool-prereg.md, with its day-1
-- check docs/agents/backtests/pmlive/mid_check.sql.
--
-- The Ireland attestation. The config carries Davies' standing attestation as small-pool's row holds it when this runs
-- (copied, never made: no attestation there is none here, and a revocation already recorded there is carried too), so
-- the dry-run shows what the gates would allow a funded mid-pool. It opens nothing. A later revocation is recorded in
-- both rows, `update public.pm_live_config set ireland_until = now() where id = 1;` and the same on pm_mid_config.
--
-- The watchdog (0075). Both rows' `retry` is TRUE, as small-pool's (0074's pmlive, 0077's pmprep): a second run in the
-- same minute changes nothing a first did. The path: the `pm-mid` lease keeps two runs apart; a day is selected once
-- (markets upserted on (day, cond), no selection while the day has any, or within five minutes of a try); one open order
-- per market, token and side (a unique index); a minute's formula upserted on (mode, minute, cond), events on (mode,
-- minute, kind), the readout ten minutes apart on (mode, day, cond). And no rule of mid-pool's reads a minute's book at
-- `t`, the reason 0075 gives RW's and RW-C's engines no second run: a minute the platform failed to boot is quoted 13 s
-- late, as small-pool's is. The layer: the `pm-midprep` lease; a minute decided once (`lastDecided`), from records and
-- prints at least two minutes old; every row upserted on its key. The `agents` function writes its beat before its work
-- (`serveRequest`), so neither call is run twice a minute.
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (as 0037): the one-minute job's URL is the PRODUCTION project's Edge Function host,
-- hardcoded. Applying this to any other database makes THAT database POST to production every minute.

-- ── the path's tables: 0074's and 0076's shapes, mid-pool's band, never live ─────────────────────────────────────────
create table if not exists public.pm_mid_config (
  id                  integer primary key check (id = 1),
  dry_run             boolean not null default true check (dry_run),
  live_confirmed_at   timestamptz check (live_confirmed_at is null),
  ireland_attested_at timestamptz,
  ireland_until       timestamptz,
  cap_total_usd       numeric not null default 320 check (cap_total_usd > 0 and cap_total_usd <= 320),
  cap_market_usd      numeric not null default 60 check (cap_market_usd > 0 and cap_market_usd <= 60),
  loss_day_usd        numeric not null default 25 check (loss_day_usd > 0 and loss_day_usd <= 25),
  loss_total_usd      numeric not null default 75 check (loss_total_usd > 0 and loss_total_usd <= 75),
  max_posts_day       integer not null default 6000 check (max_posts_day >= 0 and max_posts_day <= 6000),
  gtd_lifetime_s      integer not null default 600 check (gtd_lifetime_s >= 180 and gtd_lifetime_s <= 600),
  max_markets         integer not null default 8 check (max_markets >= 0 and max_markets <= 12),
  select_budget_usd   numeric not null default 160 check (select_budget_usd > 0 and select_budget_usd <= 320),
  -- When this file made the row, never updated: the pre-registration's window opens on the first UTC day after it.
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (ireland_until is null or ireland_attested_at is not null)
);
insert into public.pm_mid_config (id, dry_run, live_confirmed_at, ireland_attested_at, ireland_until, cap_total_usd, cap_market_usd,
                                  loss_day_usd, loss_total_usd, max_posts_day, gtd_lifetime_s, max_markets, select_budget_usd)
select 1, true, null,
       (select c.ireland_attested_at from public.pm_live_config c where c.id = 1),
       (select c.ireland_until from public.pm_live_config c where c.id = 1 and c.ireland_attested_at is not null),
       320, 60, 25, 75, 6000, 600, 8, 160
on conflict (id) do nothing;

create table if not exists public.pm_mid_markets (
  day            date not null,
  kind           text not null check (kind in ('standard', 'neg_risk')),
  cond           text not null,
  yes_token      text not null,
  no_token       text not null,
  neg_risk       boolean not null,
  tick           numeric not null check (tick > 0),
  min_size       numeric not null check (min_size > 0),
  reward_rate    numeric not null check (reward_rate >= 10 and reward_rate < 50),
  rank           integer not null check (rank > 0),
  question       text,
  detail         jsonb not null default '{}'::jsonb,
  selected_at    timestamptz not null default now(),
  max_spread     numeric,
  n_size         numeric,
  per_dollar_day numeric,
  capital        numeric,
  formula_day    numeric,
  end_date       timestamptz,
  game_start     timestamptz,
  primary key (day, cond),
  check ((kind = 'neg_risk') = neg_risk)
);

create table if not exists public.pm_mid_orders (
  id                  bigserial primary key,
  ts                  timestamptz not null default now(),
  mode                text not null check (mode = 'dry_run'),
  cond                text not null,
  token               text not null,
  outcome             text not null check (outcome in ('yes', 'no')),
  side                text not null check (side in ('BUY', 'SELL')),
  price               numeric not null check (price > 0 and price < 1),
  size                numeric not null check (size > 0),
  order_type          text not null check (order_type = 'GTD'),
  post_only           boolean not null check (post_only),
  expiration          bigint not null check (expiration > 0),
  neg_risk            boolean not null,
  hash                text not null unique check (hash ~ '^0x[0-9a-f]{64}$'),
  state               text not null default 'pending'
                      check (state in ('pending', 'live', 'filled', 'cancelled', 'expired', 'rejected')),
  size_matched        numeric not null default 0 check (size_matched >= 0),
  gate                text not null check (gate in ('open', 'reduce')),
  reason              text,
  book_seen           jsonb,
  request             jsonb,
  response            jsonb,
  cancel_requested_at timestamptz,
  cancel_gate         text,
  cancel_reason       text,
  filled_at           timestamptz,
  cancelled_at        timestamptz,
  updated_at          timestamptz not null default now()
);
create unique index if not exists pm_mid_orders_one_open_per_slot
  on public.pm_mid_orders (mode, cond, token, side) where state in ('pending', 'live');
create index if not exists pm_mid_orders_open on public.pm_mid_orders (state) where state in ('pending', 'live');
create index if not exists pm_mid_orders_ts on public.pm_mid_orders (ts);

create table if not exists public.pm_mid_fills (
  trade_id   text not null,
  hash       text not null references public.pm_mid_orders (hash),
  cond       text not null,
  token      text not null,
  side       text not null check (side in ('BUY', 'SELL')),
  price      numeric not null check (price > 0 and price < 1),
  size       numeric not null check (size > 0),
  status     text not null check (status in ('MATCHED', 'MINED', 'CONFIRMED', 'RETRYING', 'FAILED')),
  match_time timestamptz,
  tx_hash    text,
  detail     jsonb,
  updated_at timestamptz not null default now(),
  primary key (trade_id, hash)
);

create table if not exists public.pm_mid_events (
  mode   text not null check (mode in ('dry_run', 'live')),
  minute timestamptz not null,
  kind   text not null check (kind in ('gates', 'selection', 'loss_stop_day', 'loss_stop_total', 'governor', 'alert', 'condition', 'readout')),
  detail jsonb not null default '{}'::jsonb,
  primary key (mode, minute, kind)
);

create table if not exists public.pm_mid_state (
  id         integer primary key check (id = 1),
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  last_error text
);

create table if not exists public.pm_mid_minutes (
  mode        text not null check (mode in ('dry_run', 'live')),
  minute      timestamptz not null,
  cond        text not null,
  rate        numeric not null check (rate >= 10 and rate < 50),
  max_spread  numeric not null check (max_spread >= 0),
  min_size    numeric not null check (min_size >= 0),
  tick        numeric not null check (tick > 0),
  bb          numeric,
  ba          numeric,
  ab          numeric,
  aa          numeric,
  q1          numeric,
  q2          numeric,
  bid_price   numeric,
  bid_size    numeric,
  ask_price   numeric,
  ask_size    numeric,
  bid_scoring boolean,
  ask_scoring boolean,
  ours        numeric not null default 0 check (ours >= 0),
  others      numeric not null default 0 check (others >= 0),
  formula_usd numeric not null default 0 check (formula_usd >= 0),
  pct         numeric,
  detail      jsonb not null default '{}'::jsonb,
  primary key (mode, minute, cond)
);

create table if not exists public.pm_mid_reward_days (
  mode                 text not null check (mode in ('dry_run', 'live')),
  day                  date not null,
  cond                 text not null,
  minutes              integer not null default 0 check (minutes >= 0),
  minutes_two_sided    integer not null default 0 check (minutes_two_sided >= 0),
  minutes_scored       integer not null default 0 check (minutes_scored >= 0),
  formula_usd          numeric not null default 0 check (formula_usd >= 0),
  formula_scored_usd   numeric not null default 0 check (formula_scored_usd >= 0),
  rate                 numeric,
  actual_usd           numeric,
  actual_sponsored_usd numeric,
  rebate_usd           numeric,
  read_at              timestamptz not null default now(),
  detail               jsonb not null default '{}'::jsonb,
  primary key (mode, day, cond),
  check (mode = 'live' or (actual_usd is null and actual_sponsored_usd is null and rebate_usd is null))
);

create table if not exists public.pm_mid_settlements (
  cond        text primary key,
  yes_token   text not null,
  no_token    text not null,
  payout      numeric not null check (payout >= 0 and payout <= 1),
  closed_time text,
  settled_at  timestamptz not null default now(),
  detail      jsonb not null default '{}'::jsonb
);

-- ── the paper layer's tables: 0077's shapes ──────────────────────────────────────────────────────────────────────────
create table if not exists public.pm_midprep_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);

create table if not exists public.pm_midprep_prints (
  id    text primary key,
  cond  text not null,
  ts    timestamptz not null,
  side  text not null check (side in ('BUY', 'SELL')),
  oi    integer not null,
  price numeric not null,
  size  numeric not null
);
create index if not exists pm_midprep_prints_cond_ts on public.pm_midprep_prints (cond, ts);

create table if not exists public.pm_midprep_minutes (
  minute     timestamptz not null,
  cond       text not null,
  class      text not null check (class in ('matched', 'dark', 'diverged', 'held')),
  bb         numeric,
  ba         numeric,
  b          numeric,
  a          numeric,
  n          numeric,
  qb         boolean,
  qa         boolean,
  close_only boolean not null default false,
  reward     numeric not null default 0 check (reward >= 0),
  fills      integer not null default 0 check (fills >= 0),
  yes_held   numeric,
  no_held    numeric,
  mark       numeric,
  detail     jsonb not null default '{}'::jsonb,
  primary key (minute, cond)
);

create table if not exists public.pm_midprep_fills (
  cond        text not null,
  minute      timestamptz not null,
  print_id    text not null,
  ts          timestamptz not null,
  side        text not null check (side in ('bid', 'ask')),
  price       numeric not null,
  size        numeric not null check (size > 0),
  token       text not null,
  token_side  text not null check (token_side in ('BUY', 'SELL')),
  token_price numeric not null check (token_price > 0 and token_price < 1),
  close_only  boolean not null default false,
  primary key (cond, minute, print_id)
);

create table if not exists public.pm_midprep_days (
  day              date primary key,
  reward           numeric not null default 0,
  reward_r40       numeric not null default 0,
  fills_pnl_day    numeric not null default 0,
  fills_pnl_total  numeric not null default 0,
  pnl_day_r40      numeric not null default 0,
  held_value       numeric not null default 0,
  fills            integer not null default 0,
  minutes_matched  integer not null default 0,
  minutes_dark     integer not null default 0,
  minutes_diverged integer not null default 0,
  minutes_missing  integer not null default 0,
  stop_day         boolean not null default false,
  stop_total       boolean not null default false,
  markets          integer not null default 0,
  detail           jsonb not null default '{}'::jsonb,
  closed_at        timestamptz not null default now()
);

create table if not exists public.pm_midprep_settlements (
  cond        text primary key,
  yes_token   text not null,
  no_token    text not null,
  payout      numeric not null check (payout >= 0 and payout <= 1),
  closed_time text,
  settled_at  timestamptz not null,
  detail      jsonb not null default '{}'::jsonb
);

create table if not exists public.pm_midprep_events (
  minute timestamptz not null,
  kind   text not null check (kind in ('loss_stop_day', 'loss_stop_total', 'settlement')),
  detail jsonb not null default '{}'::jsonb,
  primary key (minute, kind)
);

alter table public.pm_mid_config          enable row level security;
alter table public.pm_mid_markets         enable row level security;
alter table public.pm_mid_orders          enable row level security;
alter table public.pm_mid_fills           enable row level security;
alter table public.pm_mid_events          enable row level security;
alter table public.pm_mid_state           enable row level security;
alter table public.pm_mid_minutes         enable row level security;
alter table public.pm_mid_reward_days     enable row level security;
alter table public.pm_mid_settlements     enable row level security;
alter table public.pm_midprep_state       enable row level security;
alter table public.pm_midprep_prints      enable row level security;
alter table public.pm_midprep_minutes     enable row level security;
alter table public.pm_midprep_fills       enable row level security;
alter table public.pm_midprep_days        enable row level security;
alter table public.pm_midprep_settlements enable row level security;
alter table public.pm_midprep_events      enable row level security;

-- ── the leases and the one-minute job's two rows (0075's table; every other row unchanged) ───────────────────────────
insert into public.agent_locks (name) values ('pm-mid'), ('pm-midprep') on conflict (name) do nothing;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=pmmid&forceFunctionRegion=eu-west-1', 58000, 1, 23, true), ('agents?action=pmmidprep', 58000, 1, 23, true) on conflict (path) do nothing;
