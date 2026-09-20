-- Agents: strategies that trade crypto on two venue accounts — a Revolut X
-- sub-account and a Kraken account — with TypeSafe's Jev as a decision
-- node inside a deterministic rulebook.
-- Read docs/agents/reference.md before touching any of this; CLAUDE.md's
-- Agents section is the short form of what that evidence decided.
--
-- Design rules this schema enforces:
--
--   * Record INPUTS, never conclusions. Every decision stores the state
--     the model saw, the numbers behind it (which the model never sees),
--     what was asked and what came back. Every order stores its request
--     and the venue's response. Positions and P&L are DERIVED from fills
--     by one function (`positionFromFills` in
--     `supabase/functions/_shared/agents_strategy.ts`) — there is no
--     positions table to drift from the orders.
--   * Paper first. Every strategy is seeded in `paper` mode and stays
--     there until its row is flipped; and no live order can be placed
--     while `agent_risk.live_confirmed_at` is null, which only Davies'
--     explicit go sets. Two switches, both his.
--   * Hard caps live in the database, not in code the model could be
--     talked around: per-order notional, total exposure, a daily loss
--     limit that pauses everything, an order count a long way under the
--     venue's 1,000-per-day bucket, and a global pause. Exposure, order
--     count and the daily loss are tallied PER VENUE — each venue account
--     holds its own funding.
--   * One venue per strategy row. Its candles, its touch, its pair
--     limits, its fee model (paper fills pay the venue's maker fee:
--     0 % on Revolut X, 0.40 % on Kraken at the account's tier), so a
--     paper run on either venue rehearses a live run there and the two
--     can be compared honestly.
--
-- Applied automatically: `migrations.yml` runs `supabase db push` on
-- every push to main that touches this directory. Do NOT also apply it
-- by hand — a dashboard paste records nothing in
-- `supabase_migrations.schema_migrations`, and the MCP connector records
-- a version under its own name; either one desyncs the history and the
-- next push fails outright (see supabase/migrations/README.md).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- ── strategies ─────────────────────────────────────────────────────────

create table if not exists public.agent_strategies (
  id           text primary key,                 -- 'trend-4h', 'momentum-1d-kraken', …
  kind         text not null
               check (kind in ('trend-4h', 'momentum-1d')),   -- which rulebook
  venue        text not null default 'revx'
               check (venue in ('revx', 'kraken')),
  name         text not null,
  description  text not null,                    -- shown on the site: what it does and why
  symbols      text[] not null,                  -- slash form: {'BTC/USD',…}
  mode         text not null default 'paper'
               check (mode in ('paper', 'live', 'paused')),
  capital_usd  numeric not null check (capital_usd >= 0),  -- what it may deploy
  params       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── the caps (one row) ─────────────────────────────────────────────────

-- Every cap is per venue account: each venue holds its own $100.
create table if not exists public.agent_risk (
  id                    integer primary key default 1 check (id = 1),
  global_pause          boolean not null default false,
  max_order_usd         numeric not null default 20,
  max_exposure_usd      numeric not null default 100,   -- per venue
  daily_loss_limit_usd  numeric not null default 5,     -- per venue, realised + unrealised
  max_orders_per_day    integer not null default 40,    -- per venue
  -- Null until Davies says go, in his own words, in the conversation that
  -- places the first live order. The tick refuses every live order while
  -- this is null, whatever a strategy's `mode` says.
  live_confirmed_at     timestamptz,
  updated_at            timestamptz not null default now()
);

-- ── every decision, with what the model saw ────────────────────────────

create table if not exists public.agent_decisions (
  id            bigserial primary key,
  ts            timestamptz not null default now(),
  strategy_id   text not null references public.agent_strategies (id),
  venue         text not null check (venue in ('revx', 'kraken')),
  symbol        text not null,
  mode          text not null,
  state         jsonb not null,      -- the categorical state (words only)
  numbers       jsonb not null,      -- the indicator values behind it
  questions     jsonb,               -- what Jev was asked
  answers       jsonb,               -- what Jev answered, normalised
  provider      text not null,       -- openrouter | typesafe | none
  model         text,
  latency_ms    integer,
  cost_usd      numeric,
  rule_action   text not null,       -- enter | exit | hold — the rulebook alone
  rule_reason   text not null,
  final_action  text not null,       -- after the model's vote
  final_reason  text not null,
  risk_allowed  boolean not null,    -- the last word
  risk_reason   text not null
);

create index if not exists agent_decisions_strategy_ts_idx
  on public.agent_decisions (strategy_id, ts desc);

-- ── every order, paper or live ─────────────────────────────────────────

create table if not exists public.agent_orders (
  id               bigserial primary key,
  ts               timestamptz not null default now(),
  strategy_id      text not null references public.agent_strategies (id),
  decision_id      bigint references public.agent_decisions (id),
  venue            text not null check (venue in ('revx', 'kraken')),
  symbol           text not null,
  mode             text not null check (mode in ('paper', 'live')),
  side             text not null check (side in ('buy', 'sell')),
  order_type       text not null default 'limit',
  price            numeric not null check (price > 0),
  base_size        numeric not null check (base_size > 0),
  client_order_id  uuid not null unique,
  venue_order_id   text,
  state            text not null default 'new'
                   check (state in ('new', 'partially_filled', 'filled', 'cancelled', 'rejected')),
  request          jsonb,              -- the order as placed (venue-neutral shape), live or paper
  response         jsonb,              -- the venue's reply (wire request + result), or the paper fill's candle
  filled_base      numeric not null default 0,
  avg_fill_price   numeric,
  fee_usd          numeric not null default 0,
  filled_at        timestamptz,
  cancelled_at     timestamptz,
  updated_at       timestamptz not null default now()
);

create index if not exists agent_orders_strategy_symbol_ts_idx
  on public.agent_orders (strategy_id, symbol, ts);
create index if not exists agent_orders_open_idx
  on public.agent_orders (state) where state in ('new', 'partially_filled');

-- ── venue candles the loop reads (4h and daily; small) ─────────────────

create table if not exists public.agent_candles (
  venue         text not null check (venue in ('revx', 'kraken')),
  symbol        text not null,
  interval_min  integer not null,
  start         timestamptz not null,
  open          numeric not null,
  high          numeric not null,
  low           numeric not null,
  close         numeric not null,
  volume        numeric not null default 0,
  primary key (venue, symbol, interval_min, start)
);

-- ── backtests shown on the site ────────────────────────────────────────

create table if not exists public.agent_backtests (
  id           text primary key,          -- '<strategy>@<date>'
  strategy_id  text not null references public.agent_strategies (id),
  ran_at       timestamptz not null default now(),
  method       text not null,             -- how it was run, in words
  summary      jsonb not null,            -- the headline numbers
  equity       jsonb                      -- [[ts_ms, equity], …]
);

-- No policies → anon / authenticated denied. The `agents` Edge Function
-- uses the service-role key, which bypasses RLS.
alter table public.agent_strategies enable row level security;
alter table public.agent_risk       enable row level security;
alter table public.agent_decisions  enable row level security;
alter table public.agent_orders     enable row level security;
alter table public.agent_candles    enable row level security;
alter table public.agent_backtests  enable row level security;

-- ── seed: the two rulebooks on each venue, all PAPER, and the caps ─────

insert into public.agent_strategies (id, kind, venue, name, description, symbols, mode, capital_usd, params) values
  ('trend-4h', 'trend-4h', 'revx', 'Trend 4h · Revolut X',
   'Long-only trend following on 4-hour candles. Enters when the 20-bar average is above the 100-bar average, the close breaks the prior 55-bar high and 30-day momentum is positive; exits on a trend cross-down, a close below the prior 20-bar low, or a 3×ATR trailing stop. Jev may veto an entry or advise an exit; it can never open a position the rule would not. Resting post-only limits on Revolut X, where maker fees are 0 %.',
   '{BTC/USD,ETH/USD,SOL/USD}', 'paper', 60,
   '{"fast":20,"slow":100,"breakoutUp":55,"breakoutDown":20,"atrN":14,"atrStop":3,"volN":42,"enterMin":0.6,"exitMax":0.3}'::jsonb),
  ('momentum-1d', 'momentum-1d', 'revx', 'Momentum 30d · Revolut X',
   'Time-series momentum on daily closes, decided once a day: long while the close is above its close 30 days earlier, flat otherwise. The slowest rule that survived costs in the backtests. Jev applies the same veto and exit advice. Revolut X, 0 % maker.',
   '{BTC/USD,ETH/USD,SOL/USD}', 'paper', 40,
   '{"lookbackDays":30,"enterMin":0.6,"exitMax":0.3}'::jsonb),
  ('trend-4h-kraken', 'trend-4h', 'kraken', 'Trend 4h · Kraken',
   'The same 4-hour trend rulebook run against Kraken''s candles and book. Kraken''s maker fee at this account''s tier is 0.40 % a side, so every paper fill here pays it — the point of the twin is to measure what the deeper book gives back against what the fee takes.',
   '{BTC/USD,ETH/USD,SOL/USD}', 'paper', 60,
   '{"fast":20,"slow":100,"breakoutUp":55,"breakoutDown":20,"atrN":14,"atrStop":3,"volN":42,"enterMin":0.6,"exitMax":0.3}'::jsonb),
  ('momentum-1d-kraken', 'momentum-1d', 'kraken', 'Momentum 30d · Kraken',
   'The same 30-day momentum rulebook on Kraken. Its low turnover — a handful of round trips a year — is the shape most likely to carry Kraken''s 0.40 % maker fee.',
   '{BTC/USD,ETH/USD,SOL/USD}', 'paper', 40,
   '{"lookbackDays":30,"enterMin":0.6,"exitMax":0.3}'::jsonb)
on conflict (id) do nothing;

insert into public.agent_risk (id) values (1) on conflict (id) do nothing;

-- ── the loop: every 5 minutes, same machinery as snapshot-record ───────
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (as 0016/0021/0026): the `url` is the
-- PRODUCTION project's Edge Function host, hardcoded. Applying this to
-- any other database makes THAT database POST to production every five
-- minutes. Change the host per environment.

do $$ begin
  if exists (select 1 from cron.job where jobname = 'agents-tick-every-5min') then
    perform cron.unschedule('agents-tick-every-5min');
  end if;
end $$;

select cron.schedule(
  'agents-tick-every-5min',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url     := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/agents?action=tick',
      headers := jsonb_build_object(
        'Authorization',
        concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 25000
    );
  $cron$
);
