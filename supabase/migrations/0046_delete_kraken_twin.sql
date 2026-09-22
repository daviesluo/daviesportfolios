-- 0046: delete `trend-4h-kraken`.
--
-- Applied on Davies' word, 2026-09-22 ("这三点按照你的建议处理"). It touches
-- PAPER records only: no real money, nothing stranded at a venue.
--
-- WHY
--
-- The row exists for ONE stated job: measuring the live rulebook's
-- post-only fills on the second venue. It does not do that job, and the
-- job has now been done without it (reference §4.22).
--
--   * It makes no decision of its own. Joined on symbol and bar start,
--     50 of 50 paired decisions match `trend-4h` EXACTLY — same
--     final_action, same rule_action — because both rows carry
--     signal_venue = 'kraken', the same rulebook, parameters and coins.
--     It can differ only through the fill path.
--   * Nothing reads the fill path. There is no Kraken equivalent of
--     probeSummary in the tick, the function or the page, and
--     agent_maker_probes holds 3 rows, all revx, none kraken — a probe
--     opens only on a marketable order and only Revolut X orders are
--     marketable.
--   * The fill path is a simulation, and its accuracy is now measured
--     independently: a resting order at Kraken's touch is reached 79 %
--     of the time within a minute and 91 % within five (Depth + trade
--     tape, 95 coin-minute observations), against the loop's candle
--     model's 82 % and 92 %. Accurate to 1.01-1.04x, and repeatable from
--     two public endpoints any afternoon.
--   * It costs 4.44x the fee for the identical fills: $0.1600 against
--     the Revolut X row's $0.0360 on three paired fills. Kraken's PRICE
--     was 1.27 bps better; the fee is the whole of the difference,
--     +29.70 bps a side.
--
-- If a CONTINUOUS Kraken fill record is ever wanted, the instrument is
-- not a strategy row: agent_maker_probes already carries
-- `check (venue in ('revx','kraken'))`.
--
-- ORDER OF DELETION
--
-- Children first, and all of them. `0044` learned this twice: once when
-- it deleted decisions before orders (agent_orders has TWO foreign keys),
-- and once by luck, when it forgot agent_maker_probes entirely and got
-- away with it because the only probe rows belonged to a row that
-- stayed. `0045` made probes cascade, so they are covered now — the
-- explicit delete below is belt and braces and costs nothing.
--
-- The row currently HOLDS BTC, ETH and SOL on paper. Those are notional,
-- so nothing is stranded at a venue by deleting them outright; the
-- retire-then-wind-down path `0043` used is for positions that are real.
--
-- Dry-run before pushing, the way 0044 and the go-live draft were: the
-- whole sequence inside a transaction that raised at the end to roll
-- itself back. It reported 0 probes, 3 orders, 50 decisions, 326
-- observations, 0 backtests and 3 strategy rows left, with nothing
-- refused.

delete from public.agent_maker_probes where strategy_id = 'trend-4h-kraken';
delete from public.agent_orders      where strategy_id = 'trend-4h-kraken';
delete from public.agent_decisions   where strategy_id = 'trend-4h-kraken';
delete from public.agent_observations where strategy_id = 'trend-4h-kraken';
delete from public.agent_backtests   where strategy_id = 'trend-4h-kraken';
delete from public.agent_strategies  where id = 'trend-4h-kraken';
