-- Real purchase history from Trading 212, so the lot ledger stops being
-- a guess.
--
-- The broker's `/equity/positions` endpoint reports a POSITION, not how
-- it was built: quantity and average price, no dates. `applyTrading212`
-- therefore collapses each synced ticker to a single synthetic lot, and
-- the date on it can only ever be an approximation — it used to be
-- re-stamped with today's on every sync, which made those positions read
-- as bought this morning, every morning, and anything reconstructing the
-- past from the ledger saw the money arriving today.
--
-- `/equity/history/orders` does have the dates: one row per fill, with
-- the executed timestamp, quantity and fill price. Stored here so the
-- reconstruction has something true to work from.
--
-- Why a table rather than fetching on demand: that endpoint is rate
-- limited far harder than the positions one (single figures per minute,
-- against 1/second), and the history is immutable once written — a fill
-- from 2024 is never going to change. Fetch it once, page by page, and
-- keep it.
--
-- Applied automatically: `migrations.yml` runs `supabase db push` on
-- every push to main that touches this directory. Do NOT also apply it
-- by hand — a dashboard paste records nothing in
-- `supabase_migrations.schema_migrations`, and the MCP connector records
-- a version under its own name; either one desyncs the history and the
-- next push fails outright.

create table if not exists public.t212_orders (
  -- T212's own fill id. Being the primary key is what makes the backfill
  -- idempotent: re-running a page, or two devices syncing at once,
  -- upserts the same rows instead of duplicating the history.
  id           text primary key,
  -- 'invest' | 'isa'. T212 scopes its API per account, so the same
  -- ticker can legitimately appear in both.
  account      text not null,
  -- The broker's internal symbol, e.g. AAPL_US_EQ — kept so a mapping
  -- that's wrong today can be re-derived later without re-fetching.
  t212_ticker  text not null,
  -- The board's symbol, via t212TickerToYahoo. Null when the shape isn't
  -- recognised (a non-US, non-LSE listing); the row is still stored.
  ticker       text,
  executed_at  timestamptz not null,
  side         text not null check (side in ('buy', 'sell')),
  -- Always positive; `side` carries the direction.
  shares       double precision not null check (shares > 0),
  -- Per share, in the fill's own currency (T212 reports the instrument's
  -- currency, same as `averagePricePaid` on the positions endpoint).
  price        double precision not null,
  created_at   timestamptz not null default now()
);

-- The client reads "every fill for these tickers, oldest first" to
-- rebuild lots, so that's the index.
create index if not exists t212_orders_ticker_executed_idx
  on public.t212_orders (ticker, executed_at);

alter table public.t212_orders enable row level security;
-- No policies → anon / authenticated are denied. The `trading212` Edge
-- Function uses the service-role key, which bypasses RLS.

-- Where the backfill has got to, per account.
--
-- The history endpoint pages with an opaque cursor and is rate limited,
-- so the backfill can't run in one request — it fetches one page per
-- invocation and remembers where it stopped. `complete` latches once a
-- page comes back without a next cursor; after that the sync only looks
-- for fills newer than the newest stored one.
create table if not exists public.t212_orders_sync (
  account     text primary key,
  cursor      text,
  complete    boolean not null default false,
  fetched     integer not null default 0,
  last_error  text,
  updated_at  timestamptz not null default now()
);

alter table public.t212_orders_sync enable row level security;
