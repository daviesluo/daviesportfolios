-- 0077: "Reward quotes live-prep": the paper test of exactly what Polymarket's order path would do.
--
-- On whose word. Davies, 2026-10-01, about 18:15 UTC, verbatim:
--
--   Polymarket的准备好的live策略是不是从来没有paper trading测试过？要不要先上线Reward quotes live-prep测试一下？有问题也及时修复，
--   然后我们操作账户和转账问题，纸面测试24小时之后再验证一遍没问题自动上线？
--
-- In English: the prepared Polymarket live strategy has never been paper-traded; put a "Reward quotes live-prep" paper
-- test online first and fix problems promptly; then (after he funds the account) verify again after 24 hours of paper
-- testing and go live automatically if there is no problem. The pre-registration, frozen before its window
-- (2026-10-02 00:00 → 10-03 00:00 UTC): docs/agents/reviews/2026-10-01-polymarket-live-prep-prereg.md; its check, one
-- SQL file that prints PASS or FAIL per condition: docs/agents/backtests/pmlive/prep_check.sql.
--
-- What runs (agents/pm_prep.ts, `agents?action=pmprep`, every minute): the order path's OWN dry-run decisions
-- (`pm_live_minutes` and `pm_live_orders`, mode dry_run, read only) filled on paper from Polymarket's public prints by
-- RW's own rule (`stepRw`, agents/pmrw.ts, frozen and imported), two minutes behind the clock as RW decides a minute;
-- inventory, P&L and settlement by the path's own book-keeping (`tokenBooks`, `bookPnl`, `settlementFills`); the path's
-- loss stops (−$25 a day, −$75 in all) acting on paper as the path acts on them; the formula reward, and at R = 0.40.
-- It writes only the tables below and its lease: nothing the path reads, so the path sends exactly what it would send
-- without it. No key; nothing placed; nothing of RW's, RW-E's, RW-X's or RW-C's read.
--
-- The watchdog (0075): its row's `retry` is TRUE. A second run in the same minute changes nothing a first run did: the
-- `pm-prep` lease keeps two runs apart; a minute is decided once (the state's `lastDecided`), from the path's stored
-- record and prints at least two minutes old, re-read with the read's own millisecond so no cached copy answers; every
-- row is upserted on its key; a held market's book is read at most once a minute (no read while that minute has a
-- `held` row), and only marks a holding — no frozen spec reads it at `t`. The watchdog runs a call again only when the
-- first never started (it wrote no beat), and then the late run is the only run. The `agents` function writes its beat
-- before its work (`serveRequest`), so this call is not run twice a minute.

-- ── the run's state: RW's accounts per market, the stops, the day so far ─────────────────────────────────────────────
create table if not exists public.pm_prep_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);

-- ── the public prints of the markets the path quoted: what decided each fill ────────────────────────────────────────
create table if not exists public.pm_prep_prints (
  id    text primary key,
  cond  text not null,
  ts    timestamptz not null,
  side  text not null check (side in ('BUY', 'SELL')),
  oi    integer not null,
  price numeric not null,
  size  numeric not null
);
create index if not exists pm_prep_prints_cond_ts on public.pm_prep_prints (cond, ts);

-- ── each market-minute as decided: what the path had resting against RW's quote on the row it decided on ─────────────
-- class: matched (RW's quote: stepRw decided it), dark (nothing rested), diverged (something else rested; not quoted on
-- paper), held (this layer's own read of a held market's book, for its mark). b and a are RW's quote in the one book;
-- qb and qa whether each side was quoted on paper; yes_held and no_held the paper's holdings after the minute.
create table if not exists public.pm_prep_minutes (
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

-- ── each paper fill: RW's (side, price, the print that proved it) and the path's booking of it (token, side, price) ──
create table if not exists public.pm_prep_fills (
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

-- ── each UTC day, closed at its first minute after midnight ──────────────────────────────────────────────────────────
-- reward is the formula's, reward_r40 at R = 0.40; fills_pnl_day and fills_pnl_total the path's `bookPnl` of the paper
-- fills at the day's end (the day's: realised today plus every holding marked against cost, as the path's stop reads it);
-- pnl_day_r40 = fills_pnl_day + reward_r40; held_value the holdings at the mid; minutes by class (market-minutes) and
-- minutes_missing (minutes of a day with markets in which the path recorded nothing).
create table if not exists public.pm_prep_days (
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

-- ── the markets that resolved while the paper held them: settled at Gamma's payout, as the path settles its own ──────
create table if not exists public.pm_prep_settlements (
  cond        text primary key,
  yes_token   text not null,
  no_token    text not null,
  payout      numeric not null check (payout >= 0 and payout <= 1),
  closed_time text,
  settled_at  timestamptz not null,
  detail      jsonb not null default '{}'::jsonb
);

-- ── the paper's loss stops and settlements, when they happened ───────────────────────────────────────────────────────
create table if not exists public.pm_prep_events (
  minute timestamptz not null,
  kind   text not null check (kind in ('loss_stop_day', 'loss_stop_total', 'settlement')),
  detail jsonb not null default '{}'::jsonb,
  primary key (minute, kind)
);

alter table public.pm_prep_state       enable row level security;
alter table public.pm_prep_prints      enable row level security;
alter table public.pm_prep_minutes     enable row level security;
alter table public.pm_prep_fills       enable row level security;
alter table public.pm_prep_days        enable row level security;
alter table public.pm_prep_settlements enable row level security;
alter table public.pm_prep_events      enable row level security;

insert into public.agent_locks (name) values ('pm-prep') on conflict (name) do nothing;

-- A row of the one-minute job (0075): every minute, all day, with the other minute calls' timeout; retry true (above).
insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=pmprep', 58000, 1, 23, true) on conflict (path) do nothing;
