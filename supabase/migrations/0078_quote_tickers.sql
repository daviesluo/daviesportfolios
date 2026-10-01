-- 0078: Revolut X's own price for the live stablecoin quotes' coins.
--
-- On whose word. Davies, 2026-10-01, about 19:30 UTC, comparing the live page with his Revolut X account page:
-- "这两个地方的UNREALIZED G/L为什么不一样". His account values USDC and USDT at the public ticker's `index_price` (read at
-- 19:34 UTC: USDT/GBP index 0.7570, mid 0.7573, bid 0.7571; his page showed 0.7570), and the live page valued them at the
-- book's last trade. The books recorder (agents/books.ts, `agents?action=books`, a row of `edge-calls-every-minute`
-- already) reads the two GBP tickers once a minute after its books, inside its own budget, and keeps the latest here,
-- one row a book; the dashboard values the live account's coins at it while it is fresh. Keyless public data; nothing
-- trades on it, and the executor never reads it.
create table if not exists public.agent_quote_tickers (
  book        text primary key check (book in ('USDC-GBP', 'USDT-GBP')),
  index_price numeric not null check (index_price > 0),
  bid         numeric,
  ask         numeric,
  mid         numeric,
  last_price  numeric,
  ts          timestamptz not null
);

alter table public.agent_quote_tickers enable row level security;
