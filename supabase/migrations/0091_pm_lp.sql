-- 0091: "Reward quotes live-prep": the best Polymarket reward strategy the record supports, run through the order path
-- and its paper layer as a third instance, in dry-run and unarmed; and the one Polymarket account's rule that only one
-- path is ever armed, extended to its three configs.
--
-- On whose word. Davies, 2026-10-04, verbatim:
--
--   以现在知道的所有信息，选出来一个最佳的reward区间+市场+rules等一切最优的策略，不考虑其他一切因素，做出一个策略组合加到测试列表中叫它
--   Reward quotes live-prep，然后你验证后确保一切都没问题后做上线准备
--
-- and, about 17:00 UTC: "验证没问题就直接落地TESTING STRATEGIES列表，把mini-pool的检验窗口全关了，目前上线live的最大candidate是这个
-- live-prep策略". In English: with everything known now, choose the best reward band, markets and rules, considering
-- nothing else; make it a strategy on the testing list called "Reward quotes live-prep", verify it and prepare it to go
-- live; then: once verified, land it on TESTING STRATEGIES, close mini-pool's check windows; live-prep is the lead
-- candidate to go live. (Mini-pool's windows were closed by its pre-registration's Addendum 7; nothing here touches
-- mini-pool's or mid-pool's tables, but the trigger function they share.)
--
-- What runs. The order path (agents/pm_live.ts) and its paper layer (agents/pm_prep.ts), each given live-prep's instance
-- (agents/pm_lp.ts): `agents?action=pmlp&forceFunctionRegion=eu-west-1` every minute from eu-west-1 (the path) and
-- `agents?action=pmlpprep` every minute (its paper layer, two minutes behind). Its tables below are mid-pool's final
-- shapes (0081, 0084) under `pm_lp_*` and `pm_lpprep_*`; its band, a total daily reward rate of $10 and over with no
-- ceiling (RW's universe), is a CHECK on the day's markets and on every minute. Its sizes are S2's: ten markets a UTC
-- day and $200 of first quotes, $320 in all, $100 a market, a total stop of -$75 on the fills plus what was paid, NO day
-- stop (`loss_day_usd` is null and must stay null), GTD orders of 600 s. Its rules (RW's prices, a sell of what is held
-- before a buy, 5N, x2's pause, exits from the markets it carries, no end-date horizon, no weather market) are the
-- instance's; its pre-registration, frozen before its first full UTC day:
-- docs/agents/reviews/2026-10-04-polymarket-lp-prereg.md, with its day-1 check docs/agents/backtests/pmlp/lp_check.sql.
--
-- Unarmed. Its config is the lock, as mini-pool's and mid-pool's are: `dry_run` true and `live_confirmed_at` null. Its
-- action loads the signing key for the stored signer and reads the account's pUSD every minute (agents/index.ts, as
-- mini-pool's and mid-pool's), so the go-time statement (the design doc's step 8lp) can set its cap from the balance it
-- read. Only Davies arms it, in the conversation where he says go; no session and no routine runs that statement.
--
-- One account, one armed path. Mini-pool, mid-pool and live-prep sign for the same funder and signer and read the same
-- pUSD. 0084's trigger function refused arming mini-pool or mid-pool while the other was armed; it is replaced here by
-- one that refuses arming any of the three configs while another is armed, and live-prep's config gets the trigger too.
-- The same transaction-scoped advisory lock makes two arming transactions take turns. "Armed" is `live_confirmed_at`:
-- with it cleared a path opens nothing and still sells what it holds.
--
-- The Ireland attestation. The config carries Davies' standing attestation as mini-pool's row holds it when this runs
-- (copied, never made; a revocation already recorded there is carried too). A later revocation is recorded in all three
-- rows: `update public.pm_live_config set ireland_until = now() where id = 1;` and the same on pm_mid_config and
-- pm_lp_config.
--
-- The watchdog (0075). Both rows' `retry` is TRUE, as mini-pool's and mid-pool's: a second run in the same minute changes
-- nothing a first did (the `pm-lp` and `pm-lpprep` leases; one selection a day; one open order per market, token and
-- side; every record upserted on its key; the layer decides a minute once, from records two minutes old). The watchdog
-- runs again only a call that wrote no beat, so a pause's last mid is never read twice in one minute. The `agents`
-- function writes its beat before its work (`serveRequest`).
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (as 0037): the one-minute job's URL is the PRODUCTION project's Edge Function host,
-- hardcoded. Applying this to any other database makes THAT database POST to production every minute.

-- ── the path's tables: mid-pool's shapes after 0084, live-prep's band and sizes ─────────────────────────────────────
create table if not exists public.pm_lp_config (
  id                  integer primary key check (id = 1),
  dry_run             boolean not null default true,
  live_confirmed_at   timestamptz,
  ireland_attested_at timestamptz,
  ireland_until       timestamptz,
  cap_total_usd       numeric not null default 320 check (cap_total_usd > 0 and cap_total_usd <= 320),
  cap_market_usd      numeric not null default 100 check (cap_market_usd > 0 and cap_market_usd <= 100),
  -- Live-prep has no day stop (S2): the column is the path's shape, and null is the only value it takes.
  loss_day_usd        numeric check (loss_day_usd is null),
  loss_total_usd      numeric not null default 75 check (loss_total_usd > 0 and loss_total_usd <= 75),
  max_posts_day       integer not null default 6000 check (max_posts_day >= 0 and max_posts_day <= 6000),
  gtd_lifetime_s      integer not null default 600 check (gtd_lifetime_s >= 180 and gtd_lifetime_s <= 600),
  max_markets         integer not null default 10 check (max_markets >= 0 and max_markets <= 12),
  select_budget_usd   numeric not null default 200 check (select_budget_usd > 0 and select_budget_usd <= 320),
  -- When this file made the row, never updated: the pre-registration's window opens on the first UTC day after it.
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (ireland_until is null or ireland_attested_at is not null)
);
insert into public.pm_lp_config (id, dry_run, live_confirmed_at, ireland_attested_at, ireland_until, cap_total_usd, cap_market_usd,
                                 loss_day_usd, loss_total_usd, max_posts_day, gtd_lifetime_s, max_markets, select_budget_usd)
select 1, true, null,
       (select c.ireland_attested_at from public.pm_live_config c where c.id = 1),
       (select c.ireland_until from public.pm_live_config c where c.id = 1 and c.ireland_attested_at is not null),
       320, 100, null, 75, 6000, 600, 10, 200
on conflict (id) do nothing;

create table if not exists public.pm_lp_markets (
  day            date not null,
  kind           text not null check (kind in ('standard', 'neg_risk')),
  cond           text not null,
  yes_token      text not null,
  no_token       text not null,
  neg_risk       boolean not null,
  tick           numeric not null check (tick > 0),
  min_size       numeric not null check (min_size > 0),
  reward_rate    numeric not null check (reward_rate >= 10),
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

create table if not exists public.pm_lp_orders (
  id                  bigserial primary key,
  ts                  timestamptz not null default now(),
  mode                text not null check (mode in ('dry_run', 'live')),
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
create unique index if not exists pm_lp_orders_one_open_per_slot
  on public.pm_lp_orders (mode, cond, token, side) where state in ('pending', 'live');
create index if not exists pm_lp_orders_open on public.pm_lp_orders (state) where state in ('pending', 'live');
create index if not exists pm_lp_orders_ts on public.pm_lp_orders (ts);

create table if not exists public.pm_lp_fills (
  trade_id   text not null,
  hash       text not null references public.pm_lp_orders (hash),
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

create table if not exists public.pm_lp_events (
  mode   text not null check (mode in ('dry_run', 'live')),
  minute timestamptz not null,
  kind   text not null check (kind in ('gates', 'selection', 'loss_stop_day', 'loss_stop_total', 'governor', 'alert', 'condition', 'readout')),
  detail jsonb not null default '{}'::jsonb,
  primary key (mode, minute, kind)
);

create table if not exists public.pm_lp_state (
  id         integer primary key check (id = 1),
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  last_error text
);

create table if not exists public.pm_lp_minutes (
  mode        text not null check (mode in ('dry_run', 'live')),
  minute      timestamptz not null,
  cond        text not null,
  rate        numeric not null check (rate >= 10),
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

create table if not exists public.pm_lp_reward_days (
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

create table if not exists public.pm_lp_settlements (
  cond        text primary key,
  yes_token   text not null,
  no_token    text not null,
  payout      numeric not null check (payout >= 0 and payout <= 1),
  closed_time text,
  settled_at  timestamptz not null default now(),
  detail      jsonb not null default '{}'::jsonb
);

-- ── the paper layer's tables: 0077's shapes ──────────────────────────────────────────────────────────────────────────
create table if not exists public.pm_lpprep_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);

create table if not exists public.pm_lpprep_prints (
  id    text primary key,
  cond  text not null,
  ts    timestamptz not null,
  side  text not null check (side in ('BUY', 'SELL')),
  oi    integer not null,
  price numeric not null,
  size  numeric not null
);
create index if not exists pm_lpprep_prints_cond_ts on public.pm_lpprep_prints (cond, ts);

create table if not exists public.pm_lpprep_minutes (
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

create table if not exists public.pm_lpprep_fills (
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

create table if not exists public.pm_lpprep_days (
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

create table if not exists public.pm_lpprep_settlements (
  cond        text primary key,
  yes_token   text not null,
  no_token    text not null,
  payout      numeric not null check (payout >= 0 and payout <= 1),
  closed_time text,
  settled_at  timestamptz not null,
  detail      jsonb not null default '{}'::jsonb
);

create table if not exists public.pm_lpprep_events (
  minute timestamptz not null,
  kind   text not null check (kind in ('loss_stop_day', 'loss_stop_total', 'settlement')),
  detail jsonb not null default '{}'::jsonb,
  primary key (minute, kind)
);

alter table public.pm_lp_config          enable row level security;
alter table public.pm_lp_markets         enable row level security;
alter table public.pm_lp_orders          enable row level security;
alter table public.pm_lp_fills           enable row level security;
alter table public.pm_lp_events          enable row level security;
alter table public.pm_lp_state           enable row level security;
alter table public.pm_lp_minutes         enable row level security;
alter table public.pm_lp_reward_days     enable row level security;
alter table public.pm_lp_settlements     enable row level security;
alter table public.pm_lpprep_state       enable row level security;
alter table public.pm_lpprep_prints      enable row level security;
alter table public.pm_lpprep_minutes     enable row level security;
alter table public.pm_lpprep_fills       enable row level security;
alter table public.pm_lpprep_days        enable row level security;
alter table public.pm_lpprep_settlements enable row level security;
alter table public.pm_lpprep_events      enable row level security;

-- ── one account, one armed path: 0084's function, for three configs ─────────────────────────────────────────────────
-- Fired after a row of any of the three configs is written armed: refuses it while another config's row is armed.
create or replace function public.pm_one_account_one_armed() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  other_armed text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pm_one_account_one_armed', 0));
  select x.name into other_armed
    from (select 'pm_live_config'::text as name from public.pm_live_config l where l.live_confirmed_at is not null
          union all
          select 'pm_mid_config'::text from public.pm_mid_config m where m.live_confirmed_at is not null
          union all
          select 'pm_lp_config'::text from public.pm_lp_config p where p.live_confirmed_at is not null) x
   where x.name <> tg_table_name
   order by x.name
   limit 1;
  if other_armed is not null then
    raise exception '% cannot be armed while % is armed: mini-pool, mid-pool and live-prep trade one Polymarket account', tg_table_name, other_armed
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;

drop trigger if exists pm_lp_config_one_armed on public.pm_lp_config;
create trigger pm_lp_config_one_armed
  after insert or update on public.pm_lp_config
  for each row when (new.live_confirmed_at is not null)
  execute function public.pm_one_account_one_armed();

-- ── the leases and the one-minute job's two rows (0075's table; every other row unchanged) ───────────────────────────
insert into public.agent_locks (name) values ('pm-lp'), ('pm-lpprep') on conflict (name) do nothing;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=pmlp&forceFunctionRegion=eu-west-1', 58000, 1, 23, true), ('agents?action=pmlpprep', 58000, 1, 23, true) on conflict (path) do nothing;
