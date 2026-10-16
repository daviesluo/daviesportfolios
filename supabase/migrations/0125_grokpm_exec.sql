-- 0125: GROKPM trades through this project's server in Ireland, on the account live-prep used, and live-prep is disarmed.
--
-- On whose word. Davies, 2026-10-16: "之前的live reward卖完了吗，可以用目前这个polymarket跑吗" (is the live reward book sold?
-- can it run on the current Polymarket account?) and "让grok用我们搭好的爱尔兰服务器下单，不是网页端" (Grok places its orders
-- through the Ireland server we built, not the website). The pre-registration's Deviation D2
-- (docs/agents/reviews/2026-10-15-grokpm-prereg.md §9) is the rule; this file is its schema.
--
-- So the agent never holds a key. It calls the `grokpm` function (`grokpm/exec.ts`), forced to eu-west-1, which checks every
-- request against the frozen rules, journals it, and only then signs and sends the order on the shared account with the
-- order path's own client (`_shared/polymarket_orders.ts`). What this adds:
--
--   grokpm_config      `dry_run` (true), `armed_at` (null): the lock. Disarmed, every request is checked and journalled and
--                      answers what it would have sent; nothing is signed or sent. `ireland_attested_at`, `ireland_until`:
--                      a copy of Davies' standing attestation, as each order path's config holds one (a revocation sets
--                      `ireland_until = now()` here too). `max_orders_day` (50): orders a UTC day, dry-run's included.
--                      `started_at` is no longer stamped by the recorder: the go statement sets it, and it is the baseline
--                      from which the agent's own fills count.
--   grokpm_orders      every order the agent asked for and the server accepted: its decision (`decision_id`, the journal
--                      row stored in the same request), market, token, side, price, size, post-only or not, expiry, hash,
--                      theme, mode (`dry_run` or `live`) and state, as the venue reads it back.
--   grokpm_fills       each trade of a live order, read back from the CLOB by order hash: price, size, fee, status and
--                      its transaction hash, which is how the keyless recorder tells the agent's trades from the rest of
--                      the shared account's.
--   grokpm_exec_state  one row: the day's opening equity of the agent's own book (for its −$10 day stop), the last good
--                      geoblock reading, and the last fault.
--   the one-armed rule 0091's trigger function, extended: mini-pool, mid-pool, live-prep and GROKPM sign for one account,
--                      and no two are ever armed (GROKPM is armed while `armed_at` is set).
--   a call            `grokpm?action=sync&forceFunctionRegion=eu-west-1`, every minute: reads back the agent's live
--                      orders and their trades. GETs only, retry true (a second run upserts the same fills on their key).
--   live-prep         disarmed (`live_confirmed_at = null`) only where it holds nothing an order can sell (every token it
--                      still holds is under the venue's 5-share minimum, settled markets aside) and nothing rests: its
--                      dust waits to settle and be redeemed, and its liquidation's record stays as it is.
--
-- Read 2026-10-16 15:0x UTC, read-only: live-prep's largest unsettled holding was 4.2791 shares (0x0608b79b), no order of
-- it rested, and it was armed (`dry_run` false, `live_confirmed_at` set, `liquidate_at` set). This file disarms it.
--
-- The go statement (NOT run here; only in the conversation where Davies says go, after the dry-run check):
--   update public.grokpm_config set dry_run = false, armed_at = now(), started_at = now()
--    where id = 1 and dry_run = true and armed_at is null and started_at is null and wallet is not null
--      and ireland_attested_at is not null and (ireland_until is null or ireland_until > now())
--      and (select p.live_confirmed_at from public.pm_lp_config p where p.id = 1) is null
--    returning dry_run, armed_at, started_at;
-- Its undo (exits stay possible: a disarmed path sends nothing, and the agent's resting orders expire within the hour):
--   update public.grokpm_config set dry_run = true, armed_at = null where id = 1;
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` out.
-- ⚠️  As 0075: the call's URL is the PRODUCTION project's Edge host.

set lock_timeout = '3s';

alter table public.grokpm_config add column if not exists dry_run boolean not null default true;
alter table public.grokpm_config add column if not exists armed_at timestamptz;
alter table public.grokpm_config add column if not exists ireland_attested_at timestamptz;
alter table public.grokpm_config add column if not exists ireland_until timestamptz;
alter table public.grokpm_config add column if not exists max_orders_day integer not null default 50 check (max_orders_day >= 0 and max_orders_day <= 200);
alter table public.grokpm_config drop constraint if exists grokpm_config_armed_check;
alter table public.grokpm_config add constraint grokpm_config_armed_check check (armed_at is null or (dry_run = false and started_at is not null and wallet is not null));
alter table public.grokpm_config drop constraint if exists grokpm_config_ireland_check;
alter table public.grokpm_config add constraint grokpm_config_ireland_check check (ireland_until is null or ireland_attested_at is not null);
update public.grokpm_config g
   set ireland_attested_at = p.ireland_attested_at, ireland_until = p.ireland_until
  from public.pm_lp_config p
 where g.id = 1 and p.id = 1 and g.ireland_attested_at is null;

create table if not exists public.grokpm_orders (
  id                  bigserial primary key,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  mode                text not null check (mode in ('dry_run', 'live')),
  decision_id         text not null unique references public.grokpm_decisions (id),
  cond                text not null check (cond ~ '^0x[0-9a-f]{64}$'),
  token               text not null check (token ~ '^[0-9]{1,80}$'),
  outcome             text,
  side                text not null check (side in ('BUY', 'SELL')),
  price               numeric not null check (price > 0 and price < 1),
  size                numeric not null check (size > 0),
  post_only           boolean not null,
  expiration          bigint not null,
  neg_risk            boolean not null,
  hash                text not null unique check (hash ~ '^0x[0-9a-f]{64}$'),
  theme               text,
  category            text check (category in ('A', 'B', 'C')),
  state               text not null check (state in ('pending', 'live', 'filled', 'cancelled', 'rejected', 'expired')),
  size_matched        numeric not null default 0 check (size_matched >= 0),
  request             jsonb not null default '{}'::jsonb,
  response            jsonb not null default '{}'::jsonb,
  cancel_requested_at timestamptz,
  cancelled_at        timestamptz,
  filled_at           timestamptz,
  -- A BUY always rests (post-only); only a SELL may take, and only to exit a broken thesis (category C).
  check (post_only or (side = 'SELL' and category = 'C'))
);
create index if not exists grokpm_orders_open on public.grokpm_orders (state) where state in ('pending', 'live');

create table if not exists public.grokpm_fills (
  trade_id   text not null,
  hash       text not null references public.grokpm_orders (hash),
  cond       text not null,
  token      text not null,
  side       text not null check (side in ('BUY', 'SELL')),
  price      numeric not null check (price > 0 and price < 1),
  size       numeric not null check (size > 0),
  fee_usd    numeric not null default 0 check (fee_usd >= 0),
  taker      boolean not null default false,
  status     text not null check (status in ('MATCHED', 'MINED', 'CONFIRMED', 'RETRYING', 'FAILED')),
  match_time timestamptz,
  tx_hash    text,
  detail     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (trade_id, hash)
);

create table if not exists public.grokpm_exec_state (
  id         integer primary key check (id = 1),
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz,
  last_error text
);
insert into public.grokpm_exec_state (id) values (1) on conflict (id) do nothing;

alter table public.grokpm_orders     enable row level security;
alter table public.grokpm_fills      enable row level security;
alter table public.grokpm_exec_state enable row level security;

-- ── one account, one armed path: 0091's function, with GROKPM's config ───────────────────────────────────────────────
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
          select 'pm_lp_config'::text from public.pm_lp_config p where p.live_confirmed_at is not null
          union all
          select 'grokpm_config'::text from public.grokpm_config g where g.armed_at is not null) x
   where x.name <> tg_table_name
   order by x.name
   limit 1;
  if other_armed is not null then
    raise exception '% cannot be armed while % is armed: mini-pool, mid-pool, live-prep and GROKPM trade one Polymarket account', tg_table_name, other_armed
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;

drop trigger if exists grokpm_config_one_armed on public.grokpm_config;
create trigger grokpm_config_one_armed
  after insert or update on public.grokpm_config
  for each row when (new.armed_at is not null)
  execute function public.pm_one_account_one_armed();

-- ── live-prep: disarmed, only with nothing left to sell and nothing resting ──────────────────────────────────────────
update public.pm_lp_config c
   set live_confirmed_at = null, updated_at = now()
 where c.id = 1 and c.live_confirmed_at is not null
   and not exists (select 1 from public.pm_lp_orders o where o.mode = 'live' and o.state in ('pending', 'live'))
   and coalesce((
     select max(h.net) from (
       select f.token, sum(case when f.side = 'BUY' then f.size else -f.size end) as net
         from public.pm_lp_fills f
        where f.status <> 'FAILED' and not exists (select 1 from public.pm_lp_settlements s where s.cond = f.cond)
        group by f.token) h), 0) < 5;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('grokpm?action=sync&forceFunctionRegion=eu-west-1', 30000, 1, 23, true) on conflict (path) do nothing;

reset lock_timeout;
