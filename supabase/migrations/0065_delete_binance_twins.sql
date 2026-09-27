-- 0065: delete the three Binance paper twins (`trend-4h-binance`, `trend-1h-binance`, `momentum-1d-binance`).
--
-- On Davies' word, 2026-09-27: keep them only if they have an advantage over the Revolut X rows, otherwise delete them,
-- and take Binance off VENUES until a strategy of Binance's own is found. It touches PAPER records only: no real money,
-- nothing at a venue.
--
-- WHY (reference §4 item 29's addendum, measured on production 2026-09-27)
--
--   * They make no decision of their own. Joined on symbol and bar start, trend-1h's twin matches 315 of 315 decisions;
--     trend-4h's 132 of 135 and momentum-1d's 12 of 15, and every one of the six that differ is the Revolut X row
--     acting on a position it held before the twins existed (three trailing-stop exits, three holds where the twin,
--     flat, entered). Same rulebook, parameters, coins, capital and signal venue (Kraken's candles).
--   * Their fills are no better. On the four paired fills since they began (all SOL), Binance's touch was 2.5, 2.5 and
--     1.2 bps better and 10.1 bps worse (the two books' levels apart at that second), −1.0 bps a fill on average,
--     and its fee is 10 bps against Revolut X's 9. One round trip each: −$0.124 against −$0.127 on $13.
--   * They cannot become money: a Binance row is paper or paused by constraint (`agent_strategies_binance_paper_only`,
--     `0049`), and the page is all they were for (§4 item 29: "for the page, not evidence").
--
-- With no row on Binance the tick asks Binance for nothing, and the page draws no Binance card: a venue card is its
-- rows' book. The venue checks keep 'binance' allowed, for the day a Binance strategy of its own returns.
--
-- ORDER OF DELETION: children first, all of them (`0044`, `0046`). Dry-run on production before pushing, inside a block
-- that raised at the end to roll itself back: 7 probes, 7 orders, 465 decisions, 1,263 observations, 0 backtests and
-- 3 strategy rows, nothing refused; left `momentum-1d`, `trend-1h`, `trend-4h`, `trend-4h-live`.

delete from public.agent_maker_probes  where strategy_id in ('trend-4h-binance', 'trend-1h-binance', 'momentum-1d-binance');
delete from public.agent_orders        where strategy_id in ('trend-4h-binance', 'trend-1h-binance', 'momentum-1d-binance');
delete from public.agent_decisions     where strategy_id in ('trend-4h-binance', 'trend-1h-binance', 'momentum-1d-binance');
delete from public.agent_observations  where strategy_id in ('trend-4h-binance', 'trend-1h-binance', 'momentum-1d-binance');
delete from public.agent_backtests     where strategy_id in ('trend-4h-binance', 'trend-1h-binance', 'momentum-1d-binance');
delete from public.agent_strategies    where id in ('trend-4h-binance', 'trend-1h-binance', 'momentum-1d-binance');
