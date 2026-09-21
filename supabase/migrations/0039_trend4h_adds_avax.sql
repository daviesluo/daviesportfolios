-- 0039: AVAX/USD joins the 4-hour trend rule, paper, on both venues.
--
-- The first widening of the universe past BTC / ETH / SOL, and the only
-- candidate of four (DOGE, LINK, ADA, AVAX — the Revolut X UK pairs with
-- spreads under 10 bps and real volume) that cleared the bar written down
-- before the numbers were looked at (docs/agents/reference.md §3.7): the
-- rule positive out of sample on Revolut X costs, drawdown under 35 %,
-- at least half of the 27-point parameter grid positive out of sample
-- (a plateau, not a fitted spike), and positive on Kraken costs too.
-- AVAX: OOS +40 % on the chosen parameters and +12 % on the seeded ones
-- (the row runs the seeded ones), drawdown 12 %, 85 % of the grid positive
-- (median +14 %), on Kraken costs +37 % chosen / +9 % seeded, in a year
-- when holding it lost 65 %. Nine trades — thin, which is why it is paper
-- and why the record has to earn the rest.
--
-- The rows' paper capital goes from 60 to 80 so each of the four symbols
-- keeps a $20 slot, the per-order cap; nothing else about the rows moves.
-- Un-adding is the reverse update. LINK cleared three of the four
-- (Kraken costs left it −1.5 %) and stays a watch; DOGE and ADA fail
-- outright; the 8-coin rotation basket was worse than the 4-coin one.

update public.agent_strategies
   set symbols = array_append(symbols, 'AVAX/USD'),
       capital_usd = 80,
       updated_at = now()
 where id in ('trend-4h', 'trend-4h-kraken')
   and not ('AVAX/USD' = any(symbols));
