-- 0066: the three paper strategy rows at ten times their size: capital, paper book and paper caps.
--
-- On Davies' word, 2026-09-27 ("我想把这几个测试策略的所有资金和数字全部乘10"): on TESTING the three crypto rows
-- ($100 / $40 / $40) were a sliver of VENUES beside the quote tests' $1,000–$1,200 each. It touches PAPER only: the
-- live row `trend-4h-live` ($100, four $25 slots), its orders and the live caps are not touched.
--
-- WHAT IT DOES
--
--   * `trend-4h` $100 → $1,000 (five $200 slots), `trend-1h` and `momentum-1d` $40 → $400. An entry is one slot of its
--     row (capital ÷ the positions it can hold), so every entry from here on is ten times the size.
--   * Their paper book, as if it had been that size from its first order: every paper order's `base_size`,
--     `filled_base` and `fee_usd` × 10, and each maker probe's `base_size`. A paper fill is taken at the touch whatever its
--     size, so the rows' prices, decisions and percentages are exactly what they were, and every dollar figure is ten
--     times. Each order's `request` stays as it was written (its `base` is the size before this migration); the
--     decisions' `numbers.orderUsd` likewise.
--   * The paper caps: `paper_exposure_usd` $300 → $3,000, and a new `paper_daily_loss_limit_usd` of $50. Until now the
--     paper books shared the live row's $5 daily loss limit; at ten times the size an ordinary day would spend it and
--     refuse the paper rows' entries, which would stop them recording their rule. The tick reads the paper number for
--     paper books only (`limitsFor`, pinned in `tick.test.ts`); the live row keeps $25 of exposure and $5 a day.
--
-- What it cannot change: at $200 a slot a real order on Revolut X's thinner UK books (SOL, AVAX, SUI) could walk past the
-- touch, which a paper fill does not; the live row is where fills are real.
--
-- Dry-run on production before pushing, inside a block that raised at the end to roll itself back: 3 strategy rows,
-- 19 orders and 10 probes updated; every open position ten times its size; `agent_risk` 3,000 / 50 on paper,
-- 25 / 5 live.

alter table public.agent_risk add column if not exists paper_daily_loss_limit_usd numeric
  check (paper_daily_loss_limit_usd is null or paper_daily_loss_limit_usd > 0);

update public.agent_risk
   set paper_exposure_usd = paper_exposure_usd * 10, paper_daily_loss_limit_usd = daily_loss_limit_usd * 10
 where id = 1;

update public.agent_strategies set capital_usd = capital_usd * 10
 where id in ('trend-4h', 'trend-1h', 'momentum-1d') and mode = 'paper';

update public.agent_orders set base_size = base_size * 10, filled_base = filled_base * 10, fee_usd = fee_usd * 10
 where strategy_id in ('trend-4h', 'trend-1h', 'momentum-1d') and mode = 'paper';

update public.agent_maker_probes set base_size = base_size * 10
 where strategy_id in ('trend-4h', 'trend-1h', 'momentum-1d') and mode = 'paper';
