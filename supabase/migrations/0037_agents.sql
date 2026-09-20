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
               check (kind in ('trend-4h', 'trend-1h', 'momentum-1d', 'rotation-1d', 'dislocation-1m')),   -- which rulebook
  venue        text not null default 'revx'
               check (venue in ('revx', 'kraken')),           -- where it trades
  -- Where its candles come from. Kraken's book is ~100× tighter and its
  -- history complete, so a strategy that executes on Revolut X can still
  -- read Kraken's candles: the venue for the signal, the venue for the fill.
  signal_venue text not null default 'revx'
               check (signal_venue in ('revx', 'kraken')),
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
  max_exposure_usd      numeric not null default 100,   -- per venue, live
  paper_exposure_usd    numeric not null default 300,   -- per venue, paper: the twins measure independently and must not crowd each other out
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
  bar_start     timestamptz not null, -- the closed bar this decision is about
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

-- One decision per strategy, symbol and bar. The INSERT is the claim: two
-- ticks overlapping on the same bar (cron plus an admin call) cannot both
-- pass a read-then-write, so the second insert fails and that tick skips
-- the bar — the only way a duplicate live order for one bar is impossible
-- rather than unlikely.
create unique index if not exists agent_decisions_one_per_bar
  on public.agent_decisions (strategy_id, symbol, bar_start);

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
  -- `pending` is the row written BEFORE a live order is sent: if the venue
  -- accepts it and the isolate dies before the reply is recorded, the next
  -- tick still knows an order may exist and looks for it by client id.
  state            text not null default 'new'
                   check (state in ('pending', 'new', 'partially_filled', 'filled', 'cancelled', 'rejected')),
  request          jsonb,              -- the order as placed (venue-neutral shape), live or paper
  response         jsonb,              -- the venue's reply (wire request + result), or the paper fill's candle
  filled_base      numeric not null default 0,
  avg_fill_price   numeric,
  fee_usd          numeric not null default 0,
  requotes         integer not null default 0,   -- how many times this decision's order was re-placed at a moved touch
  filled_at        timestamptz,
  cancelled_at     timestamptz,
  updated_at       timestamptz not null default now()
);

create index if not exists agent_orders_strategy_symbol_ts_idx
  on public.agent_orders (strategy_id, symbol, ts);
create index if not exists agent_orders_open_idx
  on public.agent_orders (state) where state in ('pending', 'new', 'partially_filled');

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

-- ── observations: the state, every minute, written when it changes ─────
--
-- The loop runs every minute and rebuilds each strategy's categorical
-- state on the FORMING bar from live candles. A row is written only when
-- the words change, so the table is a timeline of regime changes, not a
-- heartbeat log: this is how the page shows what the market is doing
-- between decisions, and how a later review can see what the rule saw
-- before it acted. Decisions still happen on closed bars; a protective
-- exit is the one action taken between them.

create table if not exists public.agent_observations (
  strategy_id   text not null references public.agent_strategies (id),
  symbol        text not null,
  ts            timestamptz not null,
  bar_start     timestamptz not null,   -- the forming bar the state was read on
  state         jsonb not null,
  numbers       jsonb not null,
  primary key (strategy_id, symbol, ts)
);

-- ── the cross-venue basis, every tick ──────────────────────────────────
--
-- Revolut X's mid against Kraken's for every symbol the strategies read,
-- written each turn from the keyless public quotes. The arbitrage question
-- ("is there ever a spread worth crossing after Kraken's fee?") is answered
-- by this table, not by opinion: reference §2c measured 60 hours and found
-- nothing near 80 bps; this keeps measuring. Pruned to 30 days.

create table if not exists public.agent_basis (
  ts            timestamptz not null,
  symbol        text not null,
  revx_bid      numeric not null,
  revx_ask      numeric not null,
  kraken_bid    numeric not null,
  kraken_ask    numeric not null,
  basis_bps     numeric not null,   -- (revx mid − kraken mid) / kraken mid × 1e4
  primary key (ts, symbol)
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
alter table public.agent_basis      enable row level security;
alter table public.agent_observations enable row level security;
alter table public.agent_backtests  enable row level security;

-- ── seed: the two rulebooks on each venue, all PAPER, and the caps ─────

insert into public.agent_strategies (id, kind, venue, signal_venue, name, description, symbols, mode, capital_usd, params) values
  -- Revolut X: 0 % maker, so the rules that trade more often live here. Signals read Kraken's candles.
  ('rotation-1d', 'rotation-1d', 'revx', 'kraken', 'Rotation · Revolut X',
   'Relative-strength rotation, decided once a day: rank BTC, ETH, SOL and XRP by 30-day return and hold the top two, equal-weighted, while each is above its 100-day average; a symbol below its average is not held. Capital is deployed whenever anything is trending and sits in cash only in a broad bear. Reads Kraken''s candles (the deeper book), fills on Revolut X (0 % maker).',
   '{BTC/USD,ETH/USD,SOL/USD,XRP/USD}', 'paper', 60,
   '{"lookbackDays":30,"topN":2,"slowDays":100,"bearFilter":true,"minHoldDays":0,"enterMin":0.6,"exitMax":0.3}'::jsonb),
  ('trend-4h', 'trend-4h', 'revx', 'kraken', 'Trend 4h · Revolut X',
   'Long-only trend following on 4-hour candles. Enters when the 20-bar average is above the 100-bar average, the close breaks the prior 55-bar high and 30-day momentum is positive; exits on a trend cross-down, a close below the prior 20-bar low, or a 3×ATR trailing stop. Jev may veto an entry or advise an exit; it can never open a position the rule would not. Reads Kraken''s candles, rests post-only limits on Revolut X.',
   '{BTC/USD,ETH/USD,SOL/USD}', 'paper', 40,
   '{"fast":20,"slow":100,"breakoutUp":55,"breakoutDown":20,"atrN":14,"atrStop":3,"volN":42,"enterMin":0.6,"exitMax":0.3}'::jsonb),
  ('dislocation-1m', 'dislocation-1m', 'revx', 'kraken', 'Dislocation · Revolut X',
   'Illiquidity events, decided every minute from both venues'' quotes. When Revolut X''s thin book prints 15 bps or more under Kraken''s mid while Kraken itself is not moving sharply, buy at Revolut X''s ask at once — the taker fee is the price of being there before the snap-back; a resting bid only fills when the move continues and loses (reference §3.5) — then rest an ask at Kraken''s price once the gap has closed, at 0 % maker. Out after 30 minutes or 40 bps against, whichever comes first. BTC and ETH only: on SOL and XRP Revolut X''s own spread is wider than the edge.',
   '{BTC/USD,ETH/USD}', 'paper', 40,
   '{"entryBps":15,"exitBps":-2,"maxHoldMin":30,"stopBps":40,"sharpMoveBps":15,"cooldownMin":3,"enterMin":0.6,"exitMax":0.3}'::jsonb),
  ('trend-1h', 'trend-1h', 'revx', 'kraken', 'Trend 1h · Revolut X',
   'The 4-hour trend rulebook on 1-hour candles, paper only: the same averages, breakouts and trailing stop, deciding four times as often. In the walk-forward test it kept up with the 4-hour rule on Revolut X''s free maker fee (reference §3.4); it exists to produce decisions and fills fast enough to judge the loop and the model within days rather than weeks.',
   '{BTC/USD,ETH/USD,SOL/USD}', 'paper', 40,
   '{"fast":20,"slow":100,"breakoutUp":55,"breakoutDown":20,"atrN":14,"atrStop":3,"volN":42,"enterMin":0.6,"exitMax":0.3}'::jsonb),
  ('momentum-1d', 'momentum-1d', 'revx', 'kraken', 'Momentum 30d · Revolut X',
   'Time-series momentum on daily closes, decided once a day: long while the close is above its close 30 days earlier, flat otherwise. The slowest rule that survived costs in the backtests. Jev applies the same veto and exit advice.',
   '{BTC/USD,ETH/USD,SOL/USD}', 'paper', 40,
   '{"lookbackDays":30,"enterMin":0.6,"exitMax":0.3}'::jsonb),
  -- Kraken: 0.40 % maker at this account''s tier, so only the slow rules, damped further.
  ('rotation-1w-kraken', 'rotation-1d', 'kraken', 'kraken', 'Rotation · Kraken',
   'The same rotation rulebook on Kraken with a seven-day minimum hold, because every fill there costs 0.40 %. Deployed whenever anything is trending; the paper twin of the Revolut X rotation, so the two venues'' fills and fees can be compared on the same signal.',
   '{BTC/USD,ETH/USD,SOL/USD,XRP/USD}', 'paper', 60,
   '{"lookbackDays":30,"topN":2,"slowDays":100,"bearFilter":true,"minHoldDays":7,"enterMin":0.6,"exitMax":0.3}'::jsonb),
  ('momentum-1d-kraken', 'momentum-1d', 'kraken', 'kraken', 'Momentum 30d · Kraken',
   'The same 30-day momentum rulebook on Kraken. Its low turnover — a handful of round trips a year — is the shape most likely to carry Kraken''s 0.40 % maker fee.',
   '{BTC/USD,ETH/USD,SOL/USD}', 'paper', 40,
   '{"lookbackDays":30,"enterMin":0.6,"exitMax":0.3}'::jsonb),
  ('trend-4h-kraken', 'trend-4h', 'kraken', 'kraken', 'Trend 4h · Kraken',
   'The 4-hour trend rulebook against Kraken''s book, paper only: it trades often enough that the 0.40 % maker fee shows — the point of keeping it is to measure exactly that against the Revolut X twin.',
   '{BTC/USD,ETH/USD,SOL/USD}', 'paper', 40,
   '{"fast":20,"slow":100,"breakoutUp":55,"breakoutDown":20,"atrN":14,"atrStop":3,"volN":42,"enterMin":0.6,"exitMax":0.3}'::jsonb)
on conflict (id) do nothing;

insert into public.agent_risk (id) values (1) on conflict (id) do nothing;

-- ── the loop: every minute, same machinery as snapshot-record ──────────
--
-- One minute is the observation cadence: quotes, basis, order management,
-- protective stops and the state on the forming bar. Entries still wait
-- for a closed bar. pg_cron 1.6 could go to seconds; a minute is where the
-- public rate limits (Revolut X: one token a second) and the Edge Function
-- budget both stay comfortable.
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (as 0016/0021/0026): the `url` is the
-- PRODUCTION project's Edge Function host, hardcoded. Applying this to
-- any other database makes THAT database POST to production every five
-- minutes. Change the host per environment.

do $$ begin
  if exists (select 1 from cron.job where jobname = 'agents-tick-every-5min') then
    perform cron.unschedule('agents-tick-every-5min');
  end if;
  if exists (select 1 from cron.job where jobname = 'agents-tick-every-minute') then
    perform cron.unschedule('agents-tick-every-minute');
  end if;
end $$;

select cron.schedule(
  'agents-tick-every-minute',
  '* * * * *',
  $cron$
    select net.http_post(
      url     := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/agents?action=tick',
      headers := jsonb_build_object(
        'Authorization',
        concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
  $cron$
);

-- Keep the basis, observation and candle tables small.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'agents-prune-daily') then
    perform cron.unschedule('agents-prune-daily');
  end if;
end $$;

select cron.schedule(
  'agents-prune-daily',
  '15 10 * * *',
  $cron$
    delete from public.agent_basis        where ts    < now() - interval '30 days';
    delete from public.agent_observations where ts    < now() - interval '30 days';
    delete from public.agent_candles      where start < now() - interval '120 days';
    delete from public.agent_candles      where interval_min = 1 and start < now() - interval '3 days';
  $cron$
);
