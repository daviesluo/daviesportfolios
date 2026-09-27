-- 0067: `trend-1h` and `momentum-1d` at $1,000 each, as `trend-4h` is: capital and paper book × 2.5.
--
-- On Davies' word, 2026-09-27 ("这两个cap也改成1000美元，所有数字全部乘2.5，和Trend 4h一致更好比较一些"): the three paper
-- strategy rows compare more easily on one capital. It touches PAPER only: the live row `trend-4h-live` ($100), its
-- orders and the live caps are not touched, and nor is `trend-4h` ($1,000 since `0066`).
--
-- WHAT IT DOES
--
--   * `trend-1h` and `momentum-1d` $400 → $1,000. An entry is one slot of its row (capital ÷ the positions it can hold),
--     so every entry from here on is 2.5 times the size.
--   * Their paper book, as if it had been that size from its first order: every paper order's `base_size`,
--     `filled_base` and `fee_usd` × 2.5, and each maker probe's `base_size`. A paper fill is taken at the touch whatever
--     its size, so the rows' prices, decisions and percentages are what they were, and every dollar figure is 2.5 times.
--     Each order's `request` and the decisions' `numbers.orderUsd` stay as written, as `0066` left them.
--   * The paper caps move with the paper capital, $1,800 → $3,000: `paper_exposure_usd` $3,000 → $5,000 and
--     `paper_daily_loss_limit_usd` $50 → $100, so neither binds sooner than it did. The live row keeps $25 and $5.
--
-- What it cannot change: at $250 a slot a real order on Revolut X's thinner UK books could walk past the touch, which a
-- paper fill does not; the live row is where fills are real.
--
-- Dry-run on production before pushing, inside a block that raised at the end to roll itself back: 2 strategy rows,
-- 12 orders, 6 probes and the risk row updated; capital then 1,000 for all three paper rows, 100 live.

update public.agent_strategies set capital_usd = 1000
 where id in ('trend-1h', 'momentum-1d') and mode = 'paper';

update public.agent_orders set base_size = base_size * 2.5, filled_base = filled_base * 2.5, fee_usd = fee_usd * 2.5
 where strategy_id in ('trend-1h', 'momentum-1d') and mode = 'paper';

update public.agent_maker_probes set base_size = base_size * 2.5
 where strategy_id in ('trend-1h', 'momentum-1d') and mode = 'paper';

update public.agent_risk set paper_exposure_usd = 5000, paper_daily_loss_limit_usd = 100
 where id = 1;
