## Primary window

| | round trips | P&L $ | win rate | worst trip $ | max DD $ | taker exits (P&L $) | median hold (min) |
|---|---|---|---|---|---|---|---|
| **primary** | 8192 | +707.90 | 0.9436 | -0.56 | 0.96 | 44 (-1.08) | 35.0 |
| stress | 7181 | +618.96 | 0.9382 | -0.56 | 0.96 | 52 (-3.15) | 36.0 |
| side_aware_fills | 8058 | +694.65 | 0.9425 | -0.56 | 0.96 | 44 (-1.08) | 36.0 |
| no_post_only_block | 9398 | +793.57 | 0.9458 | -0.43 | 0.96 | 41 (-0.68) | 31.0 |
| full_100_fills | 8192 | +1359.73 | 0.9436 | -0.70 | 1.83 | 44 (-2.86) | 35.0 |

Null (random-time twins, 2000 draws, seed 20260923): mean +20.84, p50 +20.91, **p95 +43.68**, max +66.76; share of draws ≥ primary 0.0.

## The bar

* 1_pnl_gt_0: PASS
* 2_pnl_gt_null_p95: PASS
* 3_stress_gt_0: PASS
* 4_at_least_60_round_trips: PASS
* 5_positive_in_two_thirds_of_months: PASS
* 6_no_month_over_40pct: PASS
* PASS: PASS
* detail: {'max_month_share': 0.1727, 'months': 10, 'positive_months': 10}

## By month (entry month)

| month | round trips | P&L $ | share of total | win rate | taker exits |
|---|---|---|---|---|---|
| 2025-11 | 72 | +6.85 | 1 % | 0.9306 | 0 |
| 2025-12 | 755 | +62.49 | 9 % | 0.947 | 0 |
| 2026-01 | 856 | +74.73 | 11 % | 0.9428 | 7 |
| 2026-02 | 804 | +71.96 | 10 % | 0.9353 | 6 |
| 2026-03 | 1438 | +122.28 | 17 % | 0.9117 | 1 |
| 2026-04 | 1048 | +84.15 | 12 % | 0.9552 | 4 |
| 2026-05 | 904 | +81.98 | 12 % | 0.9491 | 3 |
| 2026-06 | 933 | +83.34 | 12 % | 0.9593 | 7 |
| 2026-07 | 843 | +74.49 | 11 % | 0.9549 | 11 |
| 2026-08 | 539 | +45.65 | 6 % | 0.9629 | 5 |

PR3 period, recomputed on prints (fresh from 2026-08-26):

| month | round trips | P&L $ |
|---|---|---|
| 2026-08 | 18 | +1.94 |
| 2026-09 | 84 | +9.73 |

## By book, rung, side (primary)

| | round trips | P&L $ | win rate | worst trip $ | max DD $ | taker exits (P&L $) | median hold (min) |
|---|---|---|---|---|---|---|---|
| USDC-GBP | 1901 | +131.24 | 0.8927 | -0.56 | 0.96 | 25 (-1.39) | 80.0 |
| USDT-GBP | 6291 | +576.66 | 0.959 | -0.52 | 0.76 | 19 (+0.30) | 28.0 |
| k=0.1% | 4517 | +239.90 | 0.9196 | -0.56 | 0.56 | 24 (-1.08) | 35.0 |
| k=0.2% | 2672 | +291.22 | 0.9712 | -0.33 | 0.33 | 14 (-0.26) | 35.0 |
| k=0.3% | 1003 | +176.79 | 0.9781 | -0.27 | 0.27 | 6 (+0.26) | 39.0 |
| ask | 4017 | +349.85 | 0.9515 | -0.56 | 1.11 | 14 (-0.18) | 36.0 |
| bid | 4175 | +358.06 | 0.936 | -0.34 | 1.07 | 30 (-0.90) | 34.0 |

## PR3's own period on prints

| | round trips | P&L $ | win rate | worst trip $ | max DD $ | taker exits (P&L $) | median hold (min) |
|---|---|---|---|---|---|---|---|
| PR3_period_all_28d | 102 | +11.67 | 0.9412 | -0.13 | 0.13 | 1 (-0.02) | 43.0 |
| PR3_period_IS | 52 | +5.99 | 0.9423 | -0.13 | 0.13 | 1 (-0.02) | 42.0 |
| PR3_period_OOS | 50 | +5.68 | 0.94 | -0.03 | 0.03 | 0 (+0.00) | 62.0 |
| stress OOS | 35 | +3.70 | 0.9143 | -0.03 | 0.03 | 0 (+0.00) | 87.0 |
| side_aware_fills OOS | 50 | +5.68 | 0.94 | -0.03 | 0.03 | 0 (+0.00) | 62.0 |
| no_post_only_block OOS | 62 | +5.80 | 0.9032 | -0.08 | 0.12 | 0 (+0.00) | 76.0 |

## Capacity (primary window, same 10 % cap)

| rung | round trips | P&L $ | P&L/day $ | %/yr on locked capital | fill notional/day $ |
|---|---|---|---|---|---|
| $100 | 8192 | +707.90 | +2.5931 | 81.87 | 1514.21 |
| $1000 | 8192 | +2793.50 | +10.2326 | 32.31 | 5766.95 |
| $300 | 8192 | +1471.35 | +5.3896 | 56.72 | 3103.04 |
| $3000 | 8192 | +4144.93 | +15.1829 | 15.98 | 8368.82 |

Economics: {'cash_rate_pct': 4.0, 'order_budget_per_day': 1000, 'orders_per_day_max': 1856, 'orders_per_day_mean': 390.7, 'pnl_per_capital_year_pct': 81.871}
Coverage: {'USDC-GBP': {'minutes': 433440, 'minutes_with_fair': 306738, 'minutes_with_fx': 306738, 'minutes_with_prints': 10189}, 'USDT-GBP': {'minutes': 404640, 'minutes_with_fair': 286684, 'minutes_with_fx': 286684, 'minutes_with_prints': 27174}}
