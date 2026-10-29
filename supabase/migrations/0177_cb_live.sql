-- 0177: "Stablecoin quotes USDC/GBP", the Coinbase live executor (agents/cb_live.ts), in DRY-RUN and UNARMED
-- (docs/agents/reviews/2026-10-29-cb-live-design.md; reference §4 items 67 and 68).
--
-- On whose word. Davies, 2026-10-29: "Coinbase做好实盘搭建并且准备with Euros - 2这个策略的live上线", then "目前没有太多钱，我刚往
-- 我这个coinbase账户转了120磅，先把"with Euros - 2"用120磅资金上限，上线后live策略名字叫Stablecoin quotes USDC/GBP" (£120 in the
-- account; "with Euros - 2" at a £120 cap; on LIVE it is "Stablecoin quotes USDC/GBP").
--
-- The executor carries the paper arm "with Euros - 2" (`coinbasenudge`, cb_nudge.ts) order for order to the Coinbase account
-- the key `COINBASE_API_KEY_NAME` / `COINBASE_API_PRIVATE_KEY` trades: USDC-GBP, six rungs of £20 (three bids from GBP, three
-- asks from USDC), post-only good-til-date orders re-placed before they end (Coinbase itself takes every order off within 20
-- minutes if the executor stops), its exits at the paper's fair, the 24-hour stop an IOC within 50 bps of fair. Which paper
-- arm it follows is `paper` (a row of `CB_LIVE_PAPERS`): a better rule is a new paper arm and that one word.
--
-- It goes in DRY-RUN and UNARMED: `dry_run` true, `armed_at` null. In dry-run it calls no order endpoint: every order it would
-- send is a row ('dry'), written when the decision changes; it may read the account (balances, the touch) when the key is
-- stored. The go is the design doc's guarded statement, run only in the conversation where Davies says go:
--
--   update public.cb_live_config set dry_run = false, armed_at = now(), updated_at = now() where id = 1 and dry_run and armed_at is null;
--
-- `armed_at` cleared is the kill switch (live entries cancelled, exits and stops stay armed); `agent_risk.global_pause`
-- cancels every open order, exits included. Positions and P&L are derived from the fills read back from Coinbase
-- (`cb_live_fills`), never stored.
--
--   cb_live_config  one row: the paper arm, the mode, the arm, £20 a rung and £120, the daily loss stop (1 % of capital),
--                   the POST governor (entries off at 1,500 a UTC day, only stops at 1,800; CB-LIVE-RULES counted about
--                   211 placements and re-prices a day, and re-placing before an order's end adds about 600), the USDC
--                   top-up's daily cap (£70: the asks' £60 at the start, bought post-only at the bid).
--   cb_live_orders  every order sent (`live`) or that would have been (`dry_run`): one row a POST, written before the call.
--   cb_live_fills   every fill read back, by Coinbase's entry id, with the trip it belongs to.
--   cb_live_events  what a turn met (a skip, a refusal, an unknown order, the governor, the loss stop); 60 days.
--   cb_live_state   one row: the last turn's report, the fault last reported to `ops_errors` (`agents.cb_live`).
--
-- Its call, `agents?action=cblive`, a row of `edge_calls` every minute under the watchdog (its beat first, as every agents
-- action's), `retry` false: a lost run is not run again in its minute (the next minute's turn reconciles by client id). Its
-- lease `cb-live`. Like every row since 0104 it waits 15 minutes for the function's deploy.
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` out.
--
-- ⚠️  As 0075: the job's URL is the PRODUCTION project's Edge host.

create table if not exists public.cb_live_config (
  id                   integer primary key check (id = 1),
  paper                text not null default 'coinbasenudge' check (paper in ('coinbasenudge', 'coinbaseusdc', 'coinbasehold')),
  dry_run              boolean not null default true,
  armed_at             timestamptz,
  rung_gbp             numeric not null default 20 check (rung_gbp > 0),
  capital_gbp          numeric not null default 120 check (capital_gbp > 0),
  daily_loss_pct       numeric not null default 0.01 check (daily_loss_pct > 0 and daily_loss_pct <= 0.05),
  gov_entry_posts      integer not null default 1500 check (gov_entry_posts > 0),
  gov_stops_only_posts integer not null default 1800,
  convert_max_gbp_day  numeric not null default 70 check (convert_max_gbp_day >= 0),
  updated_at           timestamptz not null default now(),
  -- Armed only out of dry-run; the rungs within the capital.
  check (armed_at is null or not dry_run),
  check (rung_gbp * 6 <= capital_gbp),
  check (gov_stops_only_posts >= gov_entry_posts)
);
insert into public.cb_live_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.cb_live_orders (
  id               bigserial primary key,
  client_order_id  uuid not null unique,
  venue_order_id   text,
  mode             text not null check (mode in ('dry_run', 'live')),
  leg              text not null check (leg in ('entry', 'exit', 'stop', 'convert')),
  trip             uuid,
  rung_side        text check (rung_side in ('bid', 'ask')),
  k                numeric,
  side             text not null check (side in ('BUY', 'SELL')),
  price            numeric not null check (price > 0),
  base_size        numeric not null check (base_size > 0),
  end_time         timestamptz,
  state            text not null check (state in ('pending', 'open', 'cancelling', 'filled', 'cancelled', 'expired', 'rejected', 'refused', 'dry', 'dry_withdrawn')),
  paper_key        text,
  fair             numeric,
  filled_size      numeric not null default 0,
  avg_price        numeric,
  fees_gbp         numeric not null default 0,
  reason           text,
  request          jsonb,
  response         jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((leg = 'convert') = (rung_side is null))
);
-- One live order in flight a rung, at most: a replacement waits for the cancel to be read back.
create unique index if not exists cb_live_orders_one_per_rung on public.cb_live_orders (rung_side, k)
  where mode = 'live' and state in ('pending', 'open', 'cancelling') and rung_side is not null;
create index if not exists cb_live_orders_created on public.cb_live_orders (created_at);

create table if not exists public.cb_live_fills (
  entry_id         text primary key,
  trade_id         text not null,
  order_id         text not null,
  client_order_id  uuid not null references public.cb_live_orders (client_order_id),
  trip             uuid,
  leg              text not null check (leg in ('entry', 'exit', 'stop', 'convert')),
  rung_side        text check (rung_side in ('bid', 'ask')),
  k                numeric,
  side             text not null check (side in ('BUY', 'SELL')),
  price            numeric not null check (price > 0),
  size             numeric not null check (size > 0),
  commission       numeric not null default 0,
  liquidity        text,
  trade_time       timestamptz not null
);
create index if not exists cb_live_fills_time on public.cb_live_fills (trade_time);

create table if not exists public.cb_live_events (
  id      bigserial primary key,
  at      timestamptz not null,
  kind    text not null,
  detail  jsonb not null default '{}'::jsonb
);
create index if not exists cb_live_events_at on public.cb_live_events (at);

create table if not exists public.cb_live_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz,
  last_error  text
);

alter table public.cb_live_config enable row level security;
alter table public.cb_live_orders enable row level security;
alter table public.cb_live_fills  enable row level security;
alter table public.cb_live_events enable row level security;
alter table public.cb_live_state  enable row level security;

insert into public.agent_locks (name) values ('cb-live') on conflict (name) do nothing;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=cblive', 30000, 1, 23, false) on conflict (path) do nothing;

-- Daily: events older than 60 days (orders and fills are the record and stay).
select cron.schedule(
  'cb-live-events-prune',
  '47 10 * * *',
  $cron$delete from public.cb_live_events where at < now() - interval '60 days';$cron$
);
