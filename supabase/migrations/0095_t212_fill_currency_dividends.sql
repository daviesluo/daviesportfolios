-- 0095: every stored Trading 212 fill carries its instrument's trading currency, and the dividends the two accounts
-- received are stored beside the fills (Davies, 2026-10-07: "这两件都做"; "分红的盈利也算起来，直接算在average cost里").
--
-- Why the currency: the client guessed it from the board ticker's suffix, and `.L` says nothing. JEQP.L fills in pence
-- (GBX), CSPX.L and QQQ3.L in dollars, and the realized total was wrong by both until a hand-checked table fixed it
-- (b107f2c0). Trading 212 states it on every fill (`order.instrument.currency`) and in its instrument metadata
-- (`currencyCode`), both read by the read-only probe on 2026-10-07. It is stored as T212 says it, GBX kept as GBX, so
-- the raw fact survives; the client turns GBX into pounds. Rows written before this column get it from the metadata
-- (`backfillOrderCurrencies` in the `trading212` function), never by SQL here.
--
-- Why the dividends: a dividend received comes off the average cost, on the board and in the Transaction history.
-- `/api/v0/history/dividends` answers both keys (the probe: 200, items `amount`, `currency`, `quantity`, `paidOn`,
-- `reference`, `grossAmountPerShare`, `instrument{currency}`, `amountInEuro`, `type`). `amount` is the NET cash credited,
-- in the ACCOUNT's currency; the gross per share is in the instrument's. `amount_holding` is the net in the holding's
-- currency (GBX instrument → GBP): the amount itself when the account pays in it, otherwise the amount at that day's
-- close of the account→holding pair (`fx_rate`, `fx_source`), filled in by the function. Null until it is.
--
-- No new recurring Edge call: the dividends walk rides on the `orders-sync` the admin page already calls, one page per
-- account per call, as the orders walk does. Nothing joins `public.edge_calls`.
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` from
-- the new tables. Only the `trading212` function reads and writes them, with the service role.

alter table public.t212_orders add column if not exists currency text;

-- When the function last filled missing fill currencies from the instrument metadata, so a ticker the metadata no
-- longer lists does not cost a metadata call (one per 50 s at T212) on every sync.
alter table public.t212_orders_sync add column if not exists currency_backfill_at timestamptz;

create table if not exists public.t212_dividends (
  -- `<account>:<reference>`: T212's own reference, so a re-read page upserts the same rows.
  id               text primary key,
  account          text not null,
  t212_ticker      text not null,
  -- The board's symbol (`_shared/t212_tickers.ts`); null for a code nothing reads, the row still stored.
  ticker           text,
  paid_on          timestamptz not null,
  quantity         double precision,
  -- The net cash credited, in the account's currency (`currency`).
  amount           double precision not null,
  currency         text not null,
  -- The instrument's trading currency as T212 states it (GBX kept), and the gross per share in it.
  instrument_currency text,
  gross_per_share  double precision,
  type             text,
  -- The net in the holding's currency, how it was converted, and the rate used.
  amount_holding   double precision,
  holding_currency text,
  fx_rate          double precision,
  fx_source        text,
  created_at       timestamptz not null default now()
);

create index if not exists t212_dividends_ticker_paid_idx on public.t212_dividends (ticker, paid_on);

alter table public.t212_dividends enable row level security;

-- Where the dividends walk has got to, per account, as `t212_orders_sync` for the fills.
create table if not exists public.t212_dividends_sync (
  account     text primary key,
  cursor      text,
  complete    boolean not null default false,
  fetched     integer not null default 0,
  last_error  text,
  updated_at  timestamptz not null default now()
);

alter table public.t212_dividends_sync enable row level security;
