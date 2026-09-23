-- 0049: Binance runs the same three strategies as Revolut X, on paper.
--
-- Davies, 2026-09-23: "目前在网页端先给Binance安排一样的策略和paper capital先挂着
-- （如果这套策略在Binance可行的话），可以先给人展示" — give Binance the same
-- strategies and paper capital on the page for now, if the strategies work
-- there, so they can be shown.
--
-- WHETHER THEY WORK THERE (reference §4.29)
--
--   The five coins trade on Binance against USDT, every one with a $5
--   minimum notional (a slot here is $13.33 or $20), and Binance's books are
--   tighter than Revolut X's on all five (measured 2026-09-23: BTC one tick,
--   SUI ~1 bp against ~25 bps on Revolut X's UK book). The fee is 0.10 % a
--   side against Revolut X's 0.09 % taker, and §3.22 priced the live row at
--   Binance's cost: no verdict changes. So the same rule runs there at about
--   the same cost.
--
-- WHAT EACH ROW IS
--
--   The twin of its Revolut X row, copied from it here so nothing can drift at
--   the start: the same kind, parameters, coins and capital, and the same
--   signal (Kraken's candles). It is filled at Binance's own touch plus its
--   10 bps by `binancePaperVenue`, which reads Binance's PUBLIC market data
--   (data-api.binance.vision, reachable from wherever the tick runs) and holds
--   no key. So its DECISIONS are its Revolut X row's decisions; what differs
--   is the fill and its cost. It is for the page, not new evidence.
--
-- WHAT IT DOES TO PRODUCTION
--
--   Three paper rows, $180 of paper capital, in their own venue × mode bucket:
--   `agent_risk`'s paper_exposure_usd ($300), orders per day (40) and daily
--   loss limit ($5) apply to Binance paper on their own, so nothing about the
--   Revolut X rows changes. No real money, no key, no order at Binance.
--
-- 1. Binance is a venue the loop's tables accept (its paper rows' decisions,
--    orders, maker probes and any cached candle).
alter table public.agent_strategies   drop constraint agent_strategies_venue_check;
alter table public.agent_strategies   add  constraint agent_strategies_venue_check   check (venue in ('revx', 'kraken', 'binance'));
alter table public.agent_decisions    drop constraint agent_decisions_venue_check;
alter table public.agent_decisions    add  constraint agent_decisions_venue_check    check (venue in ('revx', 'kraken', 'binance'));
alter table public.agent_orders       drop constraint agent_orders_venue_check;
alter table public.agent_orders       add  constraint agent_orders_venue_check       check (venue in ('revx', 'kraken', 'binance'));
alter table public.agent_candles      drop constraint agent_candles_venue_check;
alter table public.agent_candles      add  constraint agent_candles_venue_check      check (venue in ('revx', 'kraken', 'binance'));
alter table public.agent_maker_probes drop constraint agent_maker_probes_venue_check;
alter table public.agent_maker_probes add  constraint agent_maker_probes_venue_check check (venue in ('revx', 'kraken', 'binance'));

-- 2. A Binance row is paper or paused, never live. Its venue holds no key, so
--    the tick would refuse a live order anyway; this makes the label itself
--    impossible, and going live at Binance a decision of its own.
alter table public.agent_strategies add constraint agent_strategies_binance_paper_only
  check (venue <> 'binance' or mode in ('paper', 'paused'));

-- 3. The twins, copied from the rows they mirror.
insert into public.agent_strategies (id, kind, venue, signal_venue, name, description, symbols, mode, capital_usd, params)
select s.id || '-binance', s.kind, 'binance', s.signal_venue, replace(s.name, 'Revolut X', 'Binance'),
       'Paper twin of ' || s.id || ' on Binance (Davies, 2026-09-23): the same rule, parameters, coins, capital and signal, '
         || 'filled at Binance''s own touch plus its 0.10 % fee from public market data. Its decisions are '
         || s.id || '''s; what differs is the fill and its cost. For the page, not new evidence (reference §4.29).',
       s.symbols, 'paper', s.capital_usd, s.params
from public.agent_strategies s
where s.id in ('trend-4h', 'trend-1h', 'momentum-1d') and s.venue = 'revx' and s.retired_at is null;
