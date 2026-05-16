-- Server-side cache for per-stock Fundamentals payloads from Yahoo +
-- Finnhub. Mirrors the pattern of `index_fundamentals_cache` (P/E for
-- the four big indices) but for individual stock symbols. The
-- `fundamentals` Edge Function reads this first and only hits live
-- Yahoo/Finnhub on a miss — without it, a single 30-ticker page load
-- with the P/E chart open burns up to ~120 outbound Yahoo calls (4
-- per stock when `ttmEpsHistory=true` is set: quoteSummary + chart
-- price + EPS-history + revenue-history), and Yahoo's per-IP rate
-- limit then ban-storms the whole edge function.
--
-- Cache key is `(symbol, include_eps_hist)` because the
-- `ttmEpsHistory=true` payload contains the ratio-chart history
-- arrays that the lighter (history-off) payload doesn't — the two
-- shapes can't share a row or the lighter version would overwrite
-- the heavier one mid-window.
--
-- TTL is enforced in the Edge Function (currently 2 h). Fundamentals
-- numbers change at quarterly cadence but markets re-rate them
-- throughout the day, so 2 h is the sweet spot between freshness
-- and Yahoo-mercy.
--
-- RLS-denied to anon / authenticated. The service-role key in the
-- Edge Function bypasses RLS; nothing else has any business reading
-- this table.
--
-- To apply: paste this SQL into Supabase Dashboard → SQL Editor → Run.

create table if not exists public.stock_fundamentals_cache (
  symbol            text not null,
  include_eps_hist  boolean not null,
  payload           jsonb not null,
  fetched_at        timestamptz not null default now(),
  primary key (symbol, include_eps_hist)
);

alter table public.stock_fundamentals_cache enable row level security;
-- No policies → anon/authenticated reads/writes denied. The Edge
-- Function uses the service-role key which bypasses RLS.
