-- Cash movements from Trading 212 (deposits, withdrawals, fees,
-- interest). Complements `0023_t212_orders` (fills): orders say when
-- money was deployed into a ticker; this table says when money entered
-- or left the brokerage. The Investment Performance deposit line is
-- "money paid in", and for a book that's mostly T212 that question is
-- answered here, not by summing lot costs.
--
-- `/equity/history/transactions` is rate limited like the orders
-- history (a handful of calls a minute), and a deposit from 2024 is
-- never going to change, so the same page-at-a-time backfill applies.
--
-- Applied automatically: `migrations.yml` runs `supabase db push` on
-- every push to main that touches this directory. Do NOT also apply it
-- by hand — a dashboard paste records nothing in
-- `supabase_migrations.schema_migrations`, and the MCP connector records
-- a version under its own name; either one desyncs the history and the
-- next push fails outright.

create table if not exists public.t212_transactions (
  -- T212's own reference, scoped per account so invest + ISA can share
  -- a reference without colliding. Being the primary key is what makes
  -- the backfill idempotent.
  id           text primary key,
  -- 'invest' | 'isa'.
  account      text not null,
  -- T212's type, lowercased: deposit / withdraw / transfer / fee /
  -- interest_on_free_cash / lending_interest. The deposit line only
  -- sums deposit minus withdraw; the rest is stored so a later reading
  -- can use it without re-fetching.
  type         text not null,
  -- In `currency`, as T212 reported it. Sign is NOT normalised here —
  -- the type carries direction for deposit/withdraw (amounts are stored
  -- as reported, often positive for both).
  amount       double precision not null,
  currency     text not null,
  occurred_at  timestamptz not null,
  created_at   timestamptz not null default now()
);

create index if not exists t212_transactions_occurred_idx
  on public.t212_transactions (occurred_at);

alter table public.t212_transactions enable row level security;
-- No policies → anon / authenticated are denied. The `trading212` Edge
-- Function uses the service-role key, which bypasses RLS.

create table if not exists public.t212_transactions_sync (
  account     text primary key,
  cursor      text,
  complete    boolean not null default false,
  fetched     integer not null default 0,
  last_error  text,
  updated_at  timestamptz not null default now()
);

alter table public.t212_transactions_sync enable row level security;
