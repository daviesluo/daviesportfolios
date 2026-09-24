-- 0052: PR5's quotes, able to trade on their own Revolut X sub-account, in DRY-RUN
-- (reference §4 item 35, reviews/2026-09-24-pr5-live-design.md).
--
-- The paper test (`0051`) runs PR5's frozen rule every minute and records
-- what it decided. This adds the executor that carries those SAME decisions
-- to the second Revolut X sub-account (`Revolut_X_API_kEY_2`, £50 of GBP),
-- order for order. The executor is `agents/quotes_live.ts`. It runs inside the
-- existing `agents-quotes-every-minute` job, after the paper engine has saved
-- its minute, so this adds no cron job. The paper engine, its tables and its
-- replay tests do not change.
--
-- It goes in in DRY-RUN and UNARMED. While `dry_run` is true, no entry goes to
-- the venue. The executor writes every order it WOULD send as a `dry_run` row:
-- price, size, client id and the order book it met. It never calls an order
-- endpoint for a dry-run row. Going live is two settings, made in the
-- conversation where Davies says go:
--
--   update public.agent_quote_live_config set dry_run = false, live_confirmed_at = now() where id = 1;
--
-- `live_confirmed_at` is also the kill switch, as `agent_risk.live_confirmed_at`
-- is for the strategy rows. When it is cleared, every resting live entry is
-- cancelled and no new one is placed, while exits and the 24-hour stops stay
-- armed. `agent_risk.global_pause` outranks everything: it cancels every open
-- order, exits included, and places nothing.
--
-- Records are inputs, not conclusions. Every order is written as `pending`
-- before the venue is called. It is settled from the venue's read-back:
-- GET /orders/{id}, reached through the active list and then the history by
-- client id. Positions and P&L are derived from those fills and never stored.

create table if not exists public.agent_quote_live_config (
  id                integer primary key check (id = 1),
  dry_run           boolean not null default true,
  -- The go, and the kill switch: live entries need it.
  live_confirmed_at timestamptz,
  -- What the twelve rungs split, in GBP: 50 is twelve £4.17 rungs.
  capital_gbp       numeric not null default 50 check (capital_gbp > 0),
  updated_at        timestamptz not null default now()
);
-- In dry-run and unarmed, whatever the row held before.
insert into public.agent_quote_live_config (id, dry_run, live_confirmed_at, capital_gbp)
values (1, true, null, 50)
on conflict (id) do update set dry_run = true, live_confirmed_at = null, updated_at = now();

-- Every order the executor sent (`live`) or would have sent (`dry_run`). One
-- row is one POST, so the order governor counts these rows.
create table if not exists public.agent_quote_live_orders (
  id                  bigserial primary key,
  ts                  timestamptz not null default now(),
  mode                text not null check (mode in ('dry_run', 'live')),
  book                text not null check (book in ('USDC-GBP', 'USDT-GBP')),
  -- The rung, as the paper engine names it; null for a conversion, which
  -- belongs to no rung.
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
  -- The paper decision this order carries out: the paper order's id, and the
  -- minute it went live. Joined to `agent_quote_events`, these give live and
  -- paper order for order.
  paper_oid           integer,
  paper_live          timestamptz,
  fair                numeric,                   -- the fair value (GBP a coin) the price came from
  request             jsonb,
  response            jsonb,
  book_seen           jsonb,                     -- the order book the order met
  cancel_requested_at timestamptz,               -- a cancel sent and not yet confirmed: the rung is frozen
  cancel_reason       text,
  filled_at           timestamptz,
  cancelled_at        timestamptz,
  updated_at          timestamptz not null default now(),
  check ((leg = 'convert') = (rung_side is null)),
  check ((rung_side is null) = (k is null))
);
-- Never two orders on one rung. An open row is the rung's claim, so an
-- insert beside it is refused.
create unique index if not exists agent_quote_live_orders_one_open_per_rung
  on public.agent_quote_live_orders (mode, book, rung_side, k)
  where state in ('pending', 'new', 'partially_filled') and rung_side is not null;
create index if not exists agent_quote_live_orders_open
  on public.agent_quote_live_orders (state) where state in ('pending', 'new', 'partially_filled');
create index if not exists agent_quote_live_orders_ts on public.agent_quote_live_orders (ts);

-- What the executor decided NOT to send, and why. Kinds:
--   skip           an entry the account's inventory could not cover, once per paper decision
--   guard          a book's reasons for quoting no entries, when they change
--   stop_unfilled  a 24-hour stop that came back unfilled
--   loss_stop      the day's loss limit, which stops entries for the rest of the UTC day
create table if not exists public.agent_quote_live_events (
  mode      text not null check (mode in ('dry_run', 'live')),
  minute    timestamptz not null,
  book      text not null check (book in ('USDC-GBP', 'USDT-GBP', '-')),
  rung_side text not null check (rung_side in ('bid', 'ask', '-')),
  k         numeric not null,                    -- 0.001 / 0.002 / 0.003; 0 for a book-wide row
  kind      text not null check (kind in ('skip', 'guard', 'stop_unfilled', 'loss_stop')),
  detail    jsonb not null default '{}'::jsonb,
  primary key (mode, minute, book, rung_side, k, kind)
);

-- The last turn's summary: the book entries go to, each book's guards, the
-- POSTs counted today and the day's P&L. It is written again every minute.
create table if not exists public.agent_quote_live_state (
  id         integer primary key check (id = 1),
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  last_error text
);

alter table public.agent_quote_live_config enable row level security;
alter table public.agent_quote_live_orders enable row level security;
alter table public.agent_quote_live_events enable row level security;
alter table public.agent_quote_live_state  enable row level security;

insert into public.agent_locks (name) values ('quotes-live') on conflict (name) do nothing;
