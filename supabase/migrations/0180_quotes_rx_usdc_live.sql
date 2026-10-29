-- 0180: "Stablecoin quotes USDC/GBP" on Revolut X, a second live executor of PR5's paper engine's decisions, built dry-run and
-- unarmed, and its paper twin "Stablecoin quotes USDC/GBP LIVE twin" (docs/agents/reviews/2026-10-29-rx-usdc-live.md, the rules;
-- docs/agents/reviews/2026-10-29-rx-usdc-live-design.md, the design, the go and its undo; the twin's pre-registration
-- docs/agents/reviews/2026-10-29-rx-usdc-live-prereg.md).
--
-- On whose word. Davies, 2026-10-29 ~22:05 UTC: "我也不想完全放弃revolut x的usdc盘，你用最新的"Stablecoin quotes USDT/GBP"的rules+之前测试的与
-- coinbase价格联动的那个优化（…确保最终上线的策略一切最优）也上线一个revolut x的Stablecoin quotes USDC/GBP 策略，账户api用之前叫你退役的那个trend 4h的
-- api，我把那个账户改为了120磅你专门拿来做revolut x的usdc盘…同时testing列表中Stablecoin quotes USDT/GBP LIVE twin底下也做一个usdc的twin".
--
-- 1. The executor's tables, LIVE's own shape (0052 and the columns and kinds added since: `take_mode`, `weekend_mode`; the
--    events' `deadman`, `take_shadow`, `weekend_shadow`): `agent_quote_rxu_config` (one row: dry_run true, live_confirmed_at
--    null, £120, take_mode 'off', weekend_mode 'off'), `_orders`, `_events`, `_state`, and its lease `quotes-live-rxu`. Row level
--    security on, no grant and no policy. The executor (`QUOTE_RXU_INSTANCE`, agents/quotes_live.ts) runs inside PR5's minute
--    call (`agents?action=quotes`, beside LIVE's turn), not a call of its own: it carries out the minute the paper engine has
--    just saved, which a call of its own could reach before the engine has; that call is already a row of `edge_calls` and of
--    the watchdog, so nothing joins them. The dead-man (`monitor?action=deadman`) runs its own beside PR5's (`RXU_TARGET`).
-- 2. Its twin, `rxu120` "Stablecoin quotes USDC/GBP LIVE twin", right under the USDT/GBP LIVE twin: the executor's rules on a
--    simulated account of £120 from 2026-10-30 00:00 UTC (a later apply catches up from it on PR5's own record). The £1,200
--    twin gives place 13 to it (to 14, guarded on 13). Its tables are 0087's template.
--
-- What it leaves alone: LIVE's executor, config and tables, PR5's paper engine, every other twin, `edge_calls` and every cron job.

create table if not exists public.agent_quote_rxu_config (
  id                integer primary key check (id = 1),
  dry_run           boolean not null default true,
  live_confirmed_at timestamptz,
  capital_gbp       numeric not null default 120 check (capital_gbp > 0),
  updated_at        timestamptz not null default now(),
  take_mode         text not null default 'off' check (take_mode in ('off', 'shadow', 'live')),
  weekend_mode      text not null default 'off' check (weekend_mode in ('off', 'shadow', 'live'))
);
insert into public.agent_quote_rxu_config (id, dry_run, live_confirmed_at, capital_gbp) values (1, true, null, 120) on conflict (id) do nothing;

create table if not exists public.agent_quote_rxu_orders (
  id                  bigserial primary key,
  ts                  timestamptz not null default now(),
  mode                text not null check (mode in ('dry_run', 'live')),
  book                text not null check (book in ('USDC-GBP', 'USDT-GBP')),
  rung_side           text check (rung_side in ('bid', 'ask')),
  k                   numeric,
  leg                 text not null check (leg in ('entry', 'exit', 'stop', 'convert')),
  side                text not null check (side in ('buy', 'sell')),
  price               numeric not null check (price > 0),
  base_size           numeric not null check (base_size > 0),
  client_order_id     uuid not null unique,
  venue_order_id      text,
  state               text not null default 'pending'
                      check (state in ('pending', 'new', 'partially_filled', 'filled', 'cancelled', 'rejected')),
  filled_base         numeric not null default 0 check (filled_base >= 0),
  avg_fill_price      numeric,
  fee_gbp             numeric not null default 0,
  paper_oid           integer,
  paper_live          timestamptz,
  fair                numeric,
  request             jsonb,
  response            jsonb,
  book_seen           jsonb,
  cancel_requested_at timestamptz,
  cancel_reason       text,
  filled_at           timestamptz,
  cancelled_at        timestamptz,
  updated_at          timestamptz not null default now(),
  check ((leg = 'convert') = (rung_side is null)),
  check ((rung_side is null) = (k is null))
);
create unique index if not exists agent_quote_rxu_orders_one_open_per_rung
  on public.agent_quote_rxu_orders (mode, book, rung_side, k)
  where state in ('pending', 'new', 'partially_filled') and rung_side is not null;
create index if not exists agent_quote_rxu_orders_open on public.agent_quote_rxu_orders (state) where state in ('pending', 'new', 'partially_filled');
create index if not exists agent_quote_rxu_orders_ts on public.agent_quote_rxu_orders (ts);

create table if not exists public.agent_quote_rxu_events (
  mode      text not null check (mode in ('dry_run', 'live')),
  minute    timestamptz not null,
  book      text not null check (book in ('USDC-GBP', 'USDT-GBP', '-')),
  rung_side text not null check (rung_side in ('bid', 'ask', '-')),
  k         numeric not null,
  kind      text not null check (kind in ('skip', 'guard', 'stop_unfilled', 'loss_stop', 'deadman', 'take_shadow', 'weekend_shadow')),
  detail    jsonb not null default '{}'::jsonb,
  primary key (mode, minute, book, rung_side, k, kind)
);

create table if not exists public.agent_quote_rxu_state (
  id         integer primary key check (id = 1),
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  last_error text
);

alter table public.agent_quote_rxu_config enable row level security;
alter table public.agent_quote_rxu_orders enable row level security;
alter table public.agent_quote_rxu_events enable row level security;
alter table public.agent_quote_rxu_state  enable row level security;

insert into public.agent_locks (name) values ('quotes-live-rxu') on conflict (name) do nothing;

update public.agent_quote_twin_specs
   set display_order = 14
 where id = 'live1200' and display_order = 13;

insert into public.agent_quote_twin_specs
select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[
  { "id": "rxu120", "display_name": "Stablecoin quotes USDC/GBP LIVE twin", "display_order": 13, "engine": "pr5", "capital_gbp": 120, "gov": "account", "start": "2026-10-30T00:00:00Z", "table_prefix": "agent_quote_twin_rxu120", "lease": "quotes-twin-rxu120", "rules": { "fill": { "model": "at", "from": "2026-10-30T00:00:00Z" }, "weekend": { "from": "2026-10-30T00:00:00Z" }, "holdMin": { "from": "2026-10-30T00:00:00Z", "gbp": 1 }, "weights": { "from": "2026-10-30T00:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 0 }, "k": { "0.001": 1, "0.002": 1, "0.003": 0 } }, "exitOffset": { "from": "2026-10-30T00:00:00Z", "ticks": 1 } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-29-rx-usdc-live-prereg.md", "migration": "0180", "enabled": true, "hidden": false }
]$json$::jsonb)
on conflict (id) do nothing;
select public.create_quote_twin_tables('rxu120');
