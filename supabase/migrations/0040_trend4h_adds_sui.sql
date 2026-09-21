-- 0040: SUI/USD joins the 4-hour trend rule, paper, on both venues.
--
-- The top twenty by market cap (ex-stablecoins), 27 coins with the next
-- tier, were run through the backtester on 2026-09-21 with three years
-- of Coinbase hours, medians of twenty minutes of Revolut X UK-book and
-- Kraken spreads, the loop's own fills, stops and cooldown, and the bar
-- of reference §3.7 (positive out of sample on Revolut X costs, drawdown
-- under 35 %, at least half the parameter grid positive out of sample,
-- positive on Kraken costs). Eight cleared it on the last third. Then
-- the same four tests were run with the MIDDLE third held out — the
-- check the friend's "fitting for out of sample" asks for — and only two
-- cleared both windows: SUI and POL. POL trades $10.7k a day on Revolut
-- X's UK book, too thin to trust the touch, and waits. SUI: last third
-- +14.5 % (drawdown 27 %, 85 % of the grid positive, Kraken +10.1 %),
-- middle third +3.0 % (70 % of the grid positive), still +11.9 % with
-- the spread doubled, in a year when holding it lost 71 %; $940k a day
-- on the UK book. Its spread is wide (median 24 bps, a 42 bps round
-- trip), and that cost is inside every number above.
--
-- The rows' paper capital goes from 80 to 100 so each of five symbols
-- keeps its $20 slot. Idempotent; un-adding is the reverse update.
-- Reference §3.8 has the whole table, including the eight that cleared
-- one window and not the other.

update public.agent_strategies
   set symbols = array_append(symbols, 'SUI/USD'),
       capital_usd = 100,
       updated_at = now()
 where id in ('trend-4h', 'trend-4h-kraken')
   and not ('SUI/USD' = any(symbols));
