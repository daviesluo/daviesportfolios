# Portfolio study — is the shipped set the best set?

Run 2026-09-21T15:08:04.428Z. Script `supabase/functions/agents/backtest_portfolio.ts`; raw output `docs/agents/backtests/portfolio.json`.

**Two windows, never averaged.** *Window A* = parameters on the first two thirds, the LAST third out of sample (2025-09 → 2026-09, the bear year every earlier table reports). *Window B* = parameters on the first third, the MIDDLE third out (2024-09 → 2025-09, a bull year). Each coin is split on its own bar count, as §3.7/§3.8 split it, so a coin with a shorter history has its thirds elsewhere on the calendar — each table prints the dates.

**Fidelity.** The two things `run` cannot express (§3.9's regime gate, per-entry sizing) run through a `runSized` copied from `run` line by line. With the weight switched off it reproduces `run` exactly: 20 checks, worst |Δreturn| 0, |ΔmaxDD| 0, |Δtrades| 0; and 68 sleeve-mark checks, all zero. The baseline table also reproduces §3.8's published figures to the digit (BTC −16.5 %, ETH −1.0 %, SOL +17.3 %, XRP −11.2 %, AVAX +40.3 %, SUI +14.5 %, UNI +46.8 %, ICP +12.4 %, POL +9.4 %, BNB +8.8 %, AAVE +8.5 %) and §3.9's regime figures (BTC −4.6 %, ETH +5.7 %, SOL +12.3 %, XRP −16.9 %, AVAX +30.7 %).

**Live slot sizes** (`tick.ts`: `min(capital_usd / slots, agent_risk.max_order_usd = 20)`):

| row | venue | symbols | capital | slots | slot | deployable |
|---|---|---|---|---|---|---|
| trend-4h | Revolut X | BTC ETH SOL AVAX SUI | $100 | 5 | $20.00 | $100 |
| trend-1h | Revolut X | BTC ETH SOL | $40 | 3 | $13.33 | $40 |
| momentum-1d | Revolut X | BTC ETH SOL | $40 | 3 | $13.33 | $40 |
| rotation-1d | Revolut X | BTC ETH SOL XRP | $60 | 2 (topN) | $20.00 | **$40** |
| trend-4h | Kraken | BTC ETH SOL AVAX SUI | $100 | 5 | $20.00 | $100 |
| momentum-1d | Kraken | BTC ETH SOL | $40 | 3 | $13.33 | $40 |
| rotation (7-day hold) | Kraken | BTC ETH SOL XRP | $60 | 2 (topN) | $20.00 | **$40** |

Row capital totals $440; the most the set can ever have at risk is **$400**, because `max_order_usd = 20` caps each rotation slot at $20 and the rotation rows hold two slots — $20 of each rotation row's $60 can never be deployed. Every dollar figure below is on that $400.

## 1. Is the shipped set the best set?

### (a) The shipped set's combined curve

| | window A (2025-09 → 2026-09) | window B (2024-09 → 2025-09) |
|---|---|---|
| members | 21 | 21 |
| capital | $400 | $400 |
| P&L | $-21.54 | $+155.21 |
| return on capital | -5.4 % | +38.8 % |
| max drawdown | 25 % | 12 % |
| return / drawdown | -0.22 | 3.19 |
| mean deployment | 20.0 % | 35.3 % |
| turnover | 27.5×/y | 37.9×/y |
| best / worst day | $+29.40 / $-13.39 | $+25.13 / $-16.96 |
| Revolut X rows only ($220) | $-7.81 (-3.5 %, DD 22 %, r/DD -0.16) | $+95.79 (+43.5 %, DD 11 %, r/DD 4.09) |
| Kraken rows only ($180) | $-13.73 (-7.6 %, DD 29 %, r/DD -0.26) | $+59.42 (+33.0 %, DD 14 %, r/DD 2.34) |
| equal-weight buy & hold, BTC/ETH/SOL/XRP | -46.7 % | +178.1 % |

Monthly equity, window A: 2025-09 $400, 2025-10 $394, 2025-11 $375, 2025-12 $375, 2026-01 $375, 2026-02 $350, 2026-03 $350, 2026-04 $336, 2026-05 $328, 2026-06 $321, 2026-07 $321, 2026-08 $308, 2026-09 $366.

Monthly equity, window B: 2024-08 $400, 2024-09 $400, 2024-10 $385, 2024-11 $384, 2024-12 $498, 2025-01 $482, 2025-02 $489, 2025-03 $470, 2025-04 $456, 2025-05 $472, 2025-06 $493, 2025-07 $486, 2025-08 $529, 2025-09 $538.

**Every shipped strategy × coin × venue, both windows** — return and P&L are the **seeded** parameters (what the row runs); the bar column is §3.7's four tests, which for a shipped row are applied to those same seeded numbers.

| member | slot | A: ret / DD / r-DD / P&L / trades / plateau / bar | B: ret / DD / r-DD / P&L / trades / plateau / bar |
|---|---|---|---|
| trend-4h·revx·BTC | $20.00 | -13.6 % / 21 % / -0.65 / $-2.73 / 32 / 0 % / fails | +17.0 % / 15 % / 1.17 / $+3.40 / 40 / 93 % / **clears** |
| trend-4h·revx·ETH | $20.00 | -10.3 % / 20 % / -0.52 / $-2.05 / 24 / 7 % / fails | +49.4 % / 22 % / 2.27 / $+9.88 / 28 / 100 % / **clears** |
| trend-4h·revx·SOL | $20.00 | +13.3 % / 18 % / 0.75 / $+2.65 / 16 / 100 % / **clears** | -10.9 % / 37 % / -0.30 / $-2.18 / 35 / 22 % / fails |
| trend-4h·revx·AVAX | $20.00 | +12.1 % / 9 % / 1.33 / $+2.42 / 10 / 85 % / **clears** | -3.3 % / 24 % / -0.14 / $-0.65 / 24 / 67 % / fails |
| trend-4h·revx·SUI | $20.00 | -10.5 % / 25 % / -0.41 / $-2.10 / 16 / 85 % / fails | +3.0 % / 26 % / 0.12 / $+0.60 / 10 / 70 % / **clears** |
| trend-1h·revx·BTC | $13.33 | -9.3 % / 18 % / -0.52 / $-1.24 / 78 / 0 % / fails | -7.3 % / 22 % / -0.34 / $-0.97 / 104 / 18 % / fails |
| trend-1h·revx·ETH | $13.33 | -6.9 % / 22 % / -0.32 / $-0.92 / 70 / 41 % / fails | +33.0 % / 19 % / 1.73 / $+4.40 / 82 / 96 % / **clears** |
| trend-1h·revx·SOL | $13.33 | +14.1 % / 23 % / 0.62 / $+1.88 / 66 / 93 % / fails | -15.8 % / 25 % / -0.63 / $-2.10 / 82 / 0 % / fails |
| momentum-1d·revx·BTC | $13.33 | -17.0 % / 33 % / -0.51 / $-2.27 / 45 / 0 % / fails | +38.7 % / 32 % / 1.22 / $+5.16 / 36 / 100 % / **clears** |
| momentum-1d·revx·ETH | $13.33 | +10.4 % / 35 % / 0.30 / $+1.39 / 33 / 100 % / fails | +116.0 % / 25 % / 4.58 / $+15.46 / 27 / 100 % / **clears** |
| momentum-1d·revx·SOL | $13.33 | -29.2 % / 56 % / -0.52 / $-3.90 / 43 / 0 % / fails | +52.9 % / 32 % / 1.65 / $+7.06 / 25 / 100 % / **clears** |
| rotation-1d·revx | $40.00 | -14.4 % / 32 % / -0.45 / $-5.74 / 64 / 0 % / fails | +237.7 % / 39 % / 6.13 / $+95.08 / 86 / 100 % / fails |
| trend-4h·kraken·BTC | $20.00 | -21.6 % / 27 % / -0.81 / $-4.32 / 32 / 0 % / fails | +3.7 % / 20 % / 0.19 / $+0.74 / 40 / 93 % / **clears** |
| trend-4h·kraken·ETH | $20.00 | -16.5 % / 24 % / -0.68 / $-3.30 / 24 / 7 % / fails | +37.4 % / 24 % / 1.54 / $+7.47 / 28 / 100 % / **clears** |
| trend-4h·kraken·SOL | $20.00 | +8.0 % / 20 % / 0.40 / $+1.60 / 16 / 100 % / **clears** | -19.7 % / 41 % / -0.48 / $-3.95 / 35 / 22 % / fails |
| trend-4h·kraken·AVAX | $20.00 | +9.1 % / 10 % / 0.95 / $+1.82 / 10 / 85 % / **clears** | -9.3 % / 26 % / -0.36 / $-1.87 / 24 / 67 % / fails |
| trend-4h·kraken·SUI | $20.00 | +12.2 % / 25 % / 0.48 / $+2.44 / 15 / 85 % / fails | +0.8 % / 27 % / 0.03 / $+0.16 / 10 / 70 % / **clears** |
| momentum-1d·kraken·BTC | $13.33 | -27.6 % / 40 % / -0.69 / $-3.68 / 45 / 0 % / fails | +24.4 % / 37 % / 0.67 / $+3.25 / 36 / 100 % / **clears** |
| momentum-1d·kraken·ETH | $13.33 | +0.0 % / 39 % / 0.00 / $+0.00 / 33 / 100 % / fails | +99.1 % / 27 % / 3.66 / $+13.22 / 27 / 100 % / **clears** |
| momentum-1d·kraken·SOL | $13.33 | -37.8 % / 62 % / -0.61 / $-5.04 / 43 / 0 % / fails | +41.9 % / 32 % / 1.29 / $+5.58 / 25 / 100 % / **clears** |
| rotation-1w-kraken·kraken | $40.00 | -16.1 % / 37 % / -0.43 / $-6.44 / 40 / 0 % / fails | +96.3 % / 46 % / 2.11 / $+38.52 / 66 / 100 % / fails |

**Every candidate the studies have produced** — trend-4h and trend-1h returns are the **seeded** parameters (what a row would run if the coin were added); the bar column is §3.7's test on the parameters chosen in sample, which is how AVAX and SUI were judged. The regime-filtered rows carry their in-sample-chosen parameters in both columns, because that rule has no seeded set.

| member | slot | A: ret / DD / r-DD / P&L / trades / plateau / bar | B: ret / DD / r-DD / P&L / trades / plateau / bar |
|---|---|---|---|
| trend-4h·revx·UNI | $20.00 | +25.5 % / 21 % / 1.21 / $+5.09 / 14 / 74 % / **clears** | -15.3 % / 21 % / -0.73 / $-3.06 / 12 / 30 % / fails |
| trend-4h·revx·ICP | $20.00 | +5.5 % / 24 % / 0.23 / $+1.10 / 13 / 70 % / **clears** | -17.4 % / 28 % / -0.61 / $-3.48 / 14 / 0 % / fails |
| trend-4h·revx·POL | $20.00 | +35.0 % / 17 % / 2.02 / $+7.00 / 7 / 100 % / fails | -2.3 % / 18 % / -0.13 / $-0.46 / 14 / 52 % / fails |
| trend-4h·revx·BNB | $20.00 | +9.8 % / 6 % / 1.73 / $+1.95 / 7 / 100 % / fails | -15.2 % / 15 % / -1.00 / $-3.04 / 10 / 0 % / fails |
| trend-4h·revx·AAVE | $20.00 | -4.4 % / 19 % / -0.23 / $-0.87 / 8 / 63 % / fails | +4.4 % / 27 % / 0.16 / $+0.87 / 18 / 37 % / fails |
| trend-1h·revx·XRP | $13.33 | +7.1 % / 8 % / 0.93 / $+0.95 / 26 / 89 % / fails | +5.2 % / 15 % / 0.36 / $+0.69 / 50 / 93 % / fails |
| trend-1h·revx·LINK | $13.33 | +7.2 % / 17 % / 0.43 / $+0.96 / 59 / 78 % / fails | +18.0 % / 18 % / 0.98 / $+2.40 / 68 / 67 % / fails |
| trend-1h·revx·AVAX | $13.33 | +3.9 % / 23 % / 0.17 / $+0.52 / 48 / 85 % / **clears** | +18.5 % / 22 % / 0.84 / $+2.47 / 72 / 67 % / fails |
| trend-1h·revx·BNB | $13.33 | +16.5 % / 3 % / 3.31 / $+2.20 / 20 / 100 % / fails | -4.4 % / 11 % / -0.40 / $-0.58 / 26 / 15 % / fails |
| trend-1h·revx·HYPE | $13.33 | +1.4 % / 10 % / 0.14 / $+0.19 / 13 / 74 % / fails | +16.0 % / 9 % / 1.86 / $+2.13 / 20 / 100 % / **clears** |
| trend-1h·revx·DOT | $13.33 | +11.2 % / 12 % / 0.91 / $+1.49 / 22 / 100 % / **clears** | +16.0 % / 29 % / 0.56 / $+2.14 / 54 / 67 % / fails |
| trend-1h·revx·HBAR | $13.33 | +2.3 % / 13 % / 0.17 / $+0.31 / 34 / 37 % / fails | -6.7 % / 20 % / -0.34 / $-0.89 / 28 / 7 % / fails |
| trend-1h·revx·AAVE | $13.33 | +10.4 % / 16 % / 0.63 / $+1.38 / 34 / 37 % / fails | -33.4 % / 37 % / -0.90 / $-4.45 / 64 / 0 % / fails |
| trend-1h·revx·ETC | $13.33 | +2.4 % / 13 % / 0.18 / $+0.32 / 28 / 30 % / fails | +2.7 % / 17 % / 0.15 / $+0.35 / 50 / 96 % / fails |
| trend-1h·revx·ALGO | $13.33 | +5.8 % / 16 % / 0.36 / $+0.77 / 30 / 37 % / fails | -7.1 % / 25 % / -0.29 / $-0.95 / 42 / 11 % / fails |
| regime-trend-4h·revx·SOL | $20.00 | +12.3 % / 8 % / 1.59 / $+2.47 / 6 / 100 % / **clears** | +9.9 % / 27 % / 0.37 / $+1.97 / 27 / 41 % / fails |
| regime-trend-4h·revx·LINK | $20.00 | +2.0 % / 17 % / 0.12 / $+0.40 / 7 / 93 % / **clears** | +27.2 % / 15 % / 1.82 / $+5.44 / 20 / 100 % / **clears** |
| regime-trend-4h·revx·AVAX | $20.00 | +30.7 % / 9 % / 3.38 / $+6.14 / 8 / 89 % / **clears** | -13.4 % / 30 % / -0.45 / $-2.68 / 24 / 4 % / fails |

### (b) The best combination under the bar

**Window A** — 11 members clear the bar on this window: trend-4h·revx·SOL, trend-4h·revx·AVAX, trend-4h·kraken·SOL, trend-4h·kraken·AVAX, trend-4h·revx·UNI, trend-4h·revx·ICP, trend-1h·revx·AVAX, trend-1h·revx·DOT, regime-trend-4h·revx·SOL, regime-trend-4h·revx·LINK, regime-trend-4h·revx·AVAX.

| combination | capital | P&L | return | DD | ret/DD | deployment | turnover |
|---|---|---|---|---|---|---|---|
| all bar-clearers, equal slots | $206.67 | $+28.41 | +13.8 % | 6 % | 2.36 | 4.1 % | 13.8×/y |
| best subset by ret/DD (exhaustive) | $20.00 | $+6.04 | +30.2 % | 5 % | **5.5** | 3.7 % | 8.0×/y |
| the shipped set | $400 | $-21.54 | -5.4 % | 25 % | -0.22 | 20.0 % | 27.5×/y |

Best subset: regime-trend-4h·revx·AVAX.

**Window B** — 15 members clear the bar on this window: trend-4h·revx·BTC, trend-4h·revx·ETH, trend-4h·revx·SUI, trend-1h·revx·ETH, momentum-1d·revx·BTC, momentum-1d·revx·ETH, momentum-1d·revx·SOL, trend-4h·kraken·BTC, trend-4h·kraken·ETH, trend-4h·kraken·SUI, momentum-1d·kraken·BTC, momentum-1d·kraken·ETH, momentum-1d·kraken·SOL, trend-1h·revx·HYPE, regime-trend-4h·revx·LINK. Excluded from any combination because its own window sits elsewhere on the calendar: trend-1h·revx·HYPE (2026-04-22..2026-07-07, overlap 0).

| combination | capital | P&L | return | DD | ret/DD | deployment | turnover |
|---|---|---|---|---|---|---|---|
| all bar-clearers, equal slots | $233.33 | $+79.99 | +34.3 % | 10 % | 3.39 | 26.4 % | 28.2×/y |
| best subset by ret/DD (exhaustive) | $80.00 | $+39.51 | +49.4 % | 9 % | **5.63** | 24.8 % | 32.5×/y |
| the shipped set | $400 | $+155.21 | +38.8 % | 12 % | 3.19 | 35.3 % | 37.9×/y |

Best subset: trend-4h·revx·ETH, trend-1h·revx·ETH, momentum-1d·revx·ETH, momentum-1d·revx·SOL, regime-trend-4h·revx·LINK.

**Members that clear the bar on BOTH windows: regime-trend-4h·revx·LINK** — of 39 members tested (21 shipped, 18 candidates).

### (c) Which shipped members add nothing

**Window A — every pair correlated above 0.9 (daily returns):**

| pair | correlation |
|---|---|
| trend-4h·revx·AVAX · trend-4h·kraken·AVAX | 0.999 |
| momentum-1d·revx·ETH · momentum-1d·kraken·ETH | 0.999 |
| momentum-1d·revx·SOL · momentum-1d·kraken·SOL | 0.999 |
| trend-4h·revx·ETH · trend-4h·kraken·ETH | 0.998 |
| trend-4h·revx·SOL · trend-4h·kraken·SOL | 0.998 |
| momentum-1d·revx·BTC · momentum-1d·kraken·BTC | 0.997 |
| trend-4h·revx·BTC · trend-4h·kraken·BTC | 0.993 |
| rotation-1d·revx · rotation-1w-kraken·kraken | 0.923 |

Highest correlation between two members that are NOT a venue pair: trend-4h·revx·SUI · trend-4h·kraken·SUI 0.83, momentum-1d·kraken·BTC · momentum-1d·kraken·SOL 0.733, momentum-1d·revx·BTC · momentum-1d·kraken·SOL 0.731, momentum-1d·revx·SOL · momentum-1d·kraken·BTC  …

**Window A — leave-one-out:**

| member | own P&L | set ret/DD without it | Δ ret/DD | Δ P&L | set DD without it |
|---|---|---|---|---|---|
| trend-4h·kraken·BTC | $-4.32 | -0.18 | -0.04 | $-4.69 | 25 % |
| trend-4h·kraken·ETH | $-3.30 | -0.19 | -0.03 | $-3.23 | 25 % |
| momentum-1d·kraken·BTC | $-3.68 | -0.19 | -0.03 | $-3.87 | 24 % |
| momentum-1d·kraken·SOL | $-5.04 | -0.19 | -0.03 | $-5.18 | 23 % |
| trend-4h·revx·BTC | $-2.73 | -0.2 | -0.02 | $-2.78 | 25 % |
| trend-4h·revx·SUI | $-2.10 | -0.2 | -0.02 | $-1.38 | 26 % |
| momentum-1d·revx·BTC | $-2.27 | -0.2 | -0.02 | $-2.05 | 25 % |
| momentum-1d·revx·SOL | $-3.90 | -0.2 | -0.02 | $-3.48 | 23 % |
| rotation-1d·revx | $-5.74 | -0.2 | -0.02 | $-4.45 | 24 % |
| rotation-1w-kraken·kraken | $-6.44 | -0.2 | -0.02 | $-5.26 | 23 % |
| trend-4h·revx·ETH | $-2.05 | -0.21 | -0.01 | $-1.81 | 25 % |
| trend-1h·revx·BTC | $-1.24 | -0.21 | -0.01 | $-1.22 | 25 % |
| trend-1h·revx·ETH | $-0.92 | -0.22 | +0.00 | $-0.67 | 25 % |
| trend-1h·revx·SOL | $+1.88 | -0.24 | +0.02 | $+2.08 | 25 % |
| trend-4h·kraken·SOL | $+1.60 | -0.24 | +0.02 | $+1.89 | 26 % |
| trend-4h·kraken·AVAX | $+1.82 | -0.24 | +0.02 | $+2.25 | 26 % |
| momentum-1d·kraken·ETH | $+0.00 | -0.24 | +0.02 | $+1.00 | 25 % |
| trend-4h·revx·SOL | $+2.65 | -0.25 | +0.03 | $+2.85 | 26 % |
| trend-4h·revx·AVAX | $+2.42 | -0.25 | +0.03 | $+2.79 | 26 % |
| momentum-1d·revx·ETH | $+1.39 | -0.25 | +0.03 | $+2.31 | 25 % |
| trend-4h·kraken·SUI | $+2.44 | -0.25 | +0.03 | $+3.37 | 26 % |

**Window A — trend-1h against trend-4h on the same coin:** trend-1h·revx·BTC vs trend-4h·revx·BTC r=0.497, $-1.24 vs $-2.73; trend-1h·revx·ETH vs trend-4h·revx·ETH r=0.532, $-0.92 vs $-2.05; trend-1h·revx·SOL vs trend-4h·revx·SOL r=0.545, $+1.88 vs $+2.65.

**Window A — momentum-1d against trend-4h on the same coin:** momentum-1d·revx·BTC vs trend-4h·revx·BTC r=0.426, $-2.27 vs $-2.73; momentum-1d·revx·ETH vs trend-4h·revx·ETH r=0.577, $+1.39 vs $-2.05; momentum-1d·revx·SOL vs trend-4h·revx·SOL r=0.465, $-3.90 vs $+2.65.

**Window A — the Kraken twins:**

| Kraken row | Revolut X twin | correlation | Kraken P&L | twin P&L |
|---|---|---|---|---|
| trend-4h·kraken·BTC | trend-4h·revx·BTC | 0.993 | $-4.32 | $-2.73 |
| trend-4h·kraken·ETH | trend-4h·revx·ETH | 0.998 | $-3.30 | $-2.05 |
| trend-4h·kraken·SOL | trend-4h·revx·SOL | 0.998 | $+1.60 | $+2.65 |
| trend-4h·kraken·AVAX | trend-4h·revx·AVAX | 0.999 | $+1.82 | $+2.42 |
| trend-4h·kraken·SUI | trend-4h·revx·SUI | 0.83 | $+2.44 | $-2.10 |
| momentum-1d·kraken·BTC | momentum-1d·revx·BTC | 0.997 | $-3.68 | $-2.27 |
| momentum-1d·kraken·ETH | momentum-1d·revx·ETH | 0.999 | $+0.00 | $+1.39 |
| momentum-1d·kraken·SOL | momentum-1d·revx·SOL | 0.999 | $-5.04 | $-3.90 |
| rotation-1w-kraken·kraken | rotation-1d·revx | 0.923 | $-6.44 | $-5.74 |

Set ret/DD with Kraken -0.22, Revolut X rows alone -0.16; the Kraken rows' own P&L is $-13.73 on $180.

**Window B — every pair correlated above 0.9 (daily returns):**

| pair | correlation |
|---|---|
| trend-4h·revx·SUI · trend-4h·kraken·SUI | 1 |
| momentum-1d·revx·ETH · momentum-1d·kraken·ETH | 1 |
| momentum-1d·revx·SOL · momentum-1d·kraken·SOL | 1 |
| trend-4h·revx·ETH · trend-4h·kraken·ETH | 0.999 |
| trend-4h·revx·SOL · trend-4h·kraken·SOL | 0.999 |
| trend-4h·revx·AVAX · trend-4h·kraken·AVAX | 0.999 |
| momentum-1d·revx·BTC · momentum-1d·kraken·BTC | 0.999 |
| trend-4h·revx·BTC · trend-4h·kraken·BTC | 0.996 |
| rotation-1d·revx · rotation-1w-kraken·kraken | 0.94 |

Highest correlation between two members that are NOT a venue pair: trend-4h·revx·ETH · trend-1h·revx·ETH 0.682, trend-1h·revx·ETH · trend-4h·kraken·ETH 0.667, trend-4h·revx·ETH · momentum-1d·revx·ETH 0.646, trend-4h·revx·ETH · momentum-1d·kraken·ETH 0.645, momentum-1 …

**Window B — leave-one-out:**

| member | own P&L | set ret/DD without it | Δ ret/DD | Δ P&L | set DD without it |
|---|---|---|---|---|---|
| rotation-1w-kraken·kraken | $+38.52 | 3.65 | -0.46 | $+33.15 | 9 % |
| trend-4h·kraken·SOL | $-3.95 | 3.39 | -0.20 | $-3.27 | 12 % |
| trend-4h·revx·SOL | $-2.18 | 3.33 | -0.14 | $-1.22 | 12 % |
| trend-1h·revx·SOL | $-2.10 | 3.31 | -0.12 | $-1.90 | 12 % |
| trend-1h·revx·BTC | $-0.97 | 3.3 | -0.11 | $-0.78 | 12 % |
| trend-4h·kraken·AVAX | $-1.87 | 3.26 | -0.07 | $-1.15 | 13 % |
| trend-4h·kraken·BTC | $+0.74 | 3.25 | -0.06 | $+1.18 | 12 % |
| momentum-1d·kraken·BTC | $+3.25 | 3.25 | -0.06 | $+3.68 | 12 % |
| trend-4h·revx·AVAX | $-0.65 | 3.23 | -0.04 | $+0.13 | 13 % |
| momentum-1d·kraken·SOL | $+5.58 | 3.22 | -0.03 | $+6.74 | 12 % |
| trend-4h·kraken·SUI | $+0.16 | 3.21 | -0.02 | $+0.67 | 13 % |
| trend-4h·revx·SUI | $+0.60 | 3.2 | -0.01 | $+1.09 | 13 % |
| momentum-1d·revx·BTC | $+5.16 | 3.19 | +0.00 | $+5.13 | 12 % |
| trend-4h·revx·BTC | $+3.40 | 3.18 | +0.01 | $+3.57 | 13 % |
| momentum-1d·revx·SOL | $+7.06 | 3.18 | +0.01 | $+7.74 | 12 % |
| trend-1h·revx·ETH | $+4.40 | 3.13 | +0.06 | $+4.28 | 12 % |
| trend-4h·kraken·ETH | $+7.47 | 3.09 | +0.10 | $+7.39 | 13 % |
| trend-4h·revx·ETH | $+9.88 | 3.05 | +0.14 | $+9.05 | 13 % |
| momentum-1d·kraken·ETH | $+13.22 | 3 | +0.19 | $+11.03 | 12 % |
| momentum-1d·revx·ETH | $+15.46 | 2.97 | +0.22 | $+12.10 | 12 % |
| rotation-1d·revx | $+95.08 | 2.65 | +0.54 | $+56.57 | 10 % |

**Window B — trend-1h against trend-4h on the same coin:** trend-1h·revx·BTC vs trend-4h·revx·BTC r=0.5, $-0.97 vs $+3.40; trend-1h·revx·ETH vs trend-4h·revx·ETH r=0.682, $+4.40 vs $+9.88; trend-1h·revx·SOL vs trend-4h·revx·SOL r=0.375, $-2.10 vs $-2.18.

**Window B — momentum-1d against trend-4h on the same coin:** momentum-1d·revx·BTC vs trend-4h·revx·BTC r=0.585, $+5.16 vs $+3.40; momentum-1d·revx·ETH vs trend-4h·revx·ETH r=0.646, $+15.46 vs $+9.88; momentum-1d·revx·SOL vs trend-4h·revx·SOL r=0.596, $+7.06 vs $-2.18.

**Window B — the Kraken twins:**

| Kraken row | Revolut X twin | correlation | Kraken P&L | twin P&L |
|---|---|---|---|---|
| trend-4h·kraken·BTC | trend-4h·revx·BTC | 0.996 | $+0.74 | $+3.40 |
| trend-4h·kraken·ETH | trend-4h·revx·ETH | 0.999 | $+7.47 | $+9.88 |
| trend-4h·kraken·SOL | trend-4h·revx·SOL | 0.999 | $-3.95 | $-2.18 |
| trend-4h·kraken·AVAX | trend-4h·revx·AVAX | 0.999 | $-1.87 | $-0.65 |
| trend-4h·kraken·SUI | trend-4h·revx·SUI | 1 | $+0.16 | $+0.60 |
| momentum-1d·kraken·BTC | momentum-1d·revx·BTC | 0.999 | $+3.25 | $+5.16 |
| momentum-1d·kraken·ETH | momentum-1d·revx·ETH | 1 | $+13.22 | $+15.46 |
| momentum-1d·kraken·SOL | momentum-1d·revx·SOL | 1 | $+5.58 | $+7.06 |
| rotation-1w-kraken·kraken | rotation-1d·revx | 0.94 | $+38.52 | $+95.08 |

Set ret/DD with Kraken 3.19, Revolut X rows alone 4.09; the Kraken rows' own P&L is $+59.42 on $180.

## 2. Parameter stability of the shipped rules

Plateau = share of the rule's own grid positive out of sample on that window. The trend grid is §3.7's 27 points (fast 10/20/30 × slow 50/100/150 × ATR stop 2/3/4).

### trend-4h, the five coins it runs

| coin | window | plateau | grid median | seeded OOS (Revolut X) | seeded OOS (Kraken) | chosen in sample | chosen OOS |
|---|---|---|---|---|---|---|---|
| BTC | A | 0 % | -13.8 % | -13.6 % | -21.6 % | 30/100/4 | -16.5 % |
| BTC | B | 93 % | +15.5 % | +17.0 % | +3.7 % | 30/100/4 | +15.5 % |
| ETH | A | 7 % | -10.3 % | -10.3 % | -16.5 % | 30/50/4 | -1.0 % |
| ETH | B | 100 % | +50.6 % | +49.4 % | +37.4 % | 10/50/4 | +90.6 % |
| SOL | A | 100 % | +14.0 % | +13.3 % | +8.0 % | 30/150/3 | +17.3 % |
| SOL | B | 22 % | -9.6 % | -10.9 % | -19.7 % | 20/150/3 | +7.6 % |
| AVAX | A | 85 % | +13.9 % | +12.1 % | +9.1 % | 10/50/4 | +40.3 % |
| AVAX | B | 67 % | +8.8 % | -3.3 % | -9.3 % | 30/100/3 | -11.5 % |
| SUI | A | 85 % | +7.6 % | -10.5 % | +12.2 % | 20/50/3 | +14.5 % |
| SUI | B | 70 % | +3.0 % | +3.0 % | +0.8 % | 10/100/3 | +3.0 % |

### trend-1h, the three coins it runs

| coin | window | plateau | grid median | seeded OOS | chosen in sample | chosen OOS |
|---|---|---|---|---|---|---|
| BTC | A | 0 % | -11.2 % | -9.3 % | 30/50/4 | -15.9 % |
| BTC | B | 18 % | -7.8 % | -7.3 % | 20/150/3 | -16.8 % |
| ETH | A | 41 % | -1.2 % | -6.9 % | 30/50/3 | +4.8 % |
| ETH | B | 96 % | +22.7 % | +33.0 % | 20/50/4 | +22.4 % |
| SOL | A | 93 % | +6.5 % | +14.1 % | 30/150/4 | +14.6 % |
| SOL | B | 0 % | -18.7 % | -15.8 % | 30/50/4 | -23.4 % |

### momentum-1d, the three coins it runs

The shipped momentum rulebook has **no free parameter** — `buildSnapshot` hard-codes the 30-day lookback — so its only neighbourhood is the floor and the cooldown (4 floors × 3 cooldowns = 12 points). Its plateau is therefore 0 % or 100 % everywhere and carries no information about robustness; it is printed so the gap is visible, not because it is comparable with the trend rules'.

| coin | window | plateau (floor × cooldown) | grid median | seeded OOS (Revolut X) | seeded OOS (Kraken) |
|---|---|---|---|---|---|
| BTC | A | 0 % | -17.0 % | -17.0 % | -27.6 % |
| BTC | B | 100 % | +44.0 % | +38.7 % | +24.4 % |
| ETH | A | 100 % | +7.1 % | +10.4 % | +0.0 % |
| ETH | B | 100 % | +122.8 % | +116.0 % | +99.1 % |
| SOL | A | 0 % | -30.4 % | -29.2 % | -37.8 % |
| SOL | B | 100 % | +54.4 % | +52.9 % | +41.9 % |

### rotation, BTC/ETH/SOL/XRP

Grid: lookback 20/30/60 × topN 1/2/3 × slow SMA 50/100/150 (27 points, bear filter on, the venue's own minimum hold).

| window | venue | seeded OOS | DD | turnover | plateau | grid median | seeded rank | best-in-sample choice | its OOS | equal-weight buy & hold |
|---|---|---|---|---|---|---|---|---|---|---|
| A | Revolut X | -14.4 % | 32 % | 21.45×/y | 0 % | -17.2 % | 11/27 | 20d/top1/50d | -27.3 % | -46.7 % |
| A | Kraken (7-day hold) | -16.1 % | 37 % | 13.23×/y | 0 % | -19.9 % | 8/27 | 20d/top1/50d | -39.7 % | -47.0 % |
| B | Revolut X | +237.7 % | 39 % | 71.22×/y | 100 % | +208.0 % | 10/27 | 20d/top1/50d | +649.9 % | +178.1 % |
| B | Kraken (7-day hold) | +96.3 % | 46 % | 44.23×/y | 100 % | +147.3 % | 25/27 | 20d/top1/50d | +694.0 % | +176.2 % |

### The stops: 8 % floor × 3×ATR trail

16 points (floor 6/8/10/12 % × ATR multiple 2/3/4/none), trend-4h at the seeded 20/100, out of sample on Revolut X costs.

| coin | window | shipped (8 %, 3×) | rank of 16 | grid positive | grid median | best point | best return |
|---|---|---|---|---|---|---|---|
| BTC | A | -13.6 % | 9/16 | 0 % | -12.9 % | 6 % / no trail | -10.7 % |
| BTC | B | +17.0 % | 2/16 | 75 % | +10.8 % | 12 % / no trail | +18.2 % |
| ETH | A | -10.3 % | 9/16 | 0 % | -8.7 % | 8 % / no trail | -8.0 % |
| ETH | B | +49.4 % | 10/16 | 100 % | +69.7 % | 8 % / no trail | +80.2 % |
| SOL | A | +13.3 % | 13/16 | 100 % | +17.6 % | 6 % / 4 | +22.0 % |
| SOL | B | -10.9 % | 10/16 | 38 % | -4.4 % | 10 % / no trail | +6.1 % |
| AVAX | A | +12.1 % | 9/16 | 100 % | +27.8 % | 6 % / no trail | +34.1 % |
| AVAX | B | -3.3 % | 14/16 | 62 % | +6.7 % | 6 % / 2 | +10.6 % |
| SUI | A | -10.5 % | 16/16 | 88 % | +5.9 % | 10 % / no trail | +33.7 % |
| SUI | B | +3.0 % | 7/16 | 62 % | +2.0 % | 6 % / 2 | +16.7 % |

Full grids per coin and window are in `portfolio.json` under `question2_stability.stops.<coin>.<window>.grid`.

## 3. §3.9's regime filter on the middle window, 27 coins

§3.9 idea 1: the shipped trend-4h rule with every ENTRY gated by BTC's daily close being above its N-day average (N ∈ {100, 150, 200}); exits untouched. 27 grid points (N × fast × slow), atrStop fixed at the shipped 3.

| coin | A: ret / DD / plateau / Kraken / bar | A baseline | B: ret / DD / plateau / Kraken / bar | B baseline | UK book | two-window verdict |
|---|---|---|---|---|---|---|
| BTC | -4.6 % / 11 % / 78 % / -9.1 % / fails | -16.5 % | +5.7 % / 20 % / 96 % / -5.8 % / fails | +15.5 % | $3,600k | — |
| ETH | +5.7 % / 7 % / 41 % / +3.8 % / fails | -1.0 % | +59.6 % / 22 % / 100 % / +45.9 % / clears | +90.6 % | $3,200k | — |
| SOL | +12.3 % / 8 % / 100 % / +10.3 % / clears | +17.3 % | +9.9 % / 27 % / 41 % / +1.3 % / fails | +7.6 % | $3,300k | — |
| XRP | -16.9 % / 17 % / 15 % / -19.3 % / fails | -11.2 % | +84.2 % / 21 % / 100 % / +73.0 % / clears | +93.7 % | $2,600k | — |
| DOGE | +6.0 % / 14 % / 48 % / +2.8 % / fails | -12.5 % | +12.7 % / 21 % / 100 % / +5.5 % / clears | +5.0 % | $199k | — |
| LINK | +2.0 % / 17 % / 93 % / +0.1 % / clears | +4.3 % | +27.2 % / 15 % / 100 % / +20.5 % / clears | +28.1 % | $693k | **clears both** |
| ADA | -1.4 % / 16 % / 41 % / -3.1 % / fails | -9.4 % | +48.6 % / 21 % / 100 % / +42.7 % / clears | +48.6 % | $122k | — |
| AVAX | +30.7 % / 9 % / 89 % / +27.9 % / clears | +40.3 % | -13.4 % / 30 % / 4 % / -18.9 % / fails | -11.5 % | $1,900k | — |
| BNB *(0.91 y)* | +7.4 % / 5 % / 100 % / +5.9 % / clears | +8.8 % | -11.0 % / 11 % / 0 % / -13.3 % / fails | -12.1 % | $19k ✗ | — |
| HYPE *(0.62 y)* | -1.1 % / 6 % / 56 % / -1.7 % / fails | -3.9 % | -4.4 % / 6 % / 0 % / -4.8 % / fails | -4.8 % | $123k | — |
| XLM | -11.2 % / 13 % / 0 % / -12.6 % / fails | -17.2 % | +14.4 % / 12 % / 78 % / +10.3 % / clears | +558.2 % | $176k | — |
| UNI | +44.8 % / 9 % / 100 % / +43.0 % / clears | +46.8 % | -3.3 % / 18 % / 15 % / -5.7 % / fails | +9.0 % | $159k | — |
| NEAR | +26.6 % / 15 % / 67 % / +24.6 % / clears | -2.0 % | +9.3 % / 20 % / 93 % / +6.8 % / clears | +9.3 % | $2,800k | **clears both** |
| BCH | +0.0 % / 0 % / 0 % / +0.0 % / fails | -26.3 % | -26.9 % / 33 % / 0 % / -31.5 % / fails | -32.9 % | $928k | — |
| LTC | +8.0 % / 10 % / 93 % / +5.3 % / clears | -7.4 % | -12.7 % / 24 % / 0 % / -18.9 % / fails | +31.2 % | $44k ✗ | — |
| SUI | +32.6 % / 17 % / 82 % / +30.1 % / clears | +14.5 % | +3.0 % / 26 % / 89 % / +0.8 % / clears | +3.0 % | $942k | **clears both** |
| DOT | +29.3 % / 13 % / 100 % / +26.3 % / clears | -0.0 % | -8.6 % / 29 % / 0 % / -13.3 % / fails | +6.4 % | $769k | — |
| HBAR | +0.6 % / 13 % / 82 % / -2.6 % / fails | +1.6 % | -22.0 % / 25 % / 0 % / -24.6 % / fails | -9.2 % | $114k | — |
| TON *(0.84 y)* | -6.4 % / 10 % / 0 % / -6.9 % / fails | -5.6 % | +22.4 % / 3 % / 52 % / +22.0 % / clears | +0.0 % | $8k ✗ | — |
| SHIB | -15.7 % / 16 % / 52 % / -17.1 % / fails | -4.8 % | +17.2 % / 23 % / 67 % / +12.9 % / clears | +12.8 % | $11k ✗ | — |
| PEPE *(1.85 y)* | +2.6 % / 15 % / 56 % / +0.2 % / clears | +2.6 % | -7.1 % / 12 % / 0 % / -8.1 % / fails | +20.3 % | $102k | — |
| AAVE | +15.4 % / 9 % / 100 % / +14.7 % / clears | +8.5 % | +15.3 % / 17 % / 96 % / +8.0 % / clears | -7.0 % | $54k ✗ | — |
| ETC | +2.9 % / 8 % / 96 % / +1.5 % / clears | -3.0 % | -2.8 % / 25 % / 56 % / -6.3 % / fails | +57.6 % | $8k ✗ | — |
| ALGO | +11.8 % / 13 % / 74 % / +9.8 % / clears | -9.0 % | +47.4 % / 21 % / 100 % / +41.2 % / clears | +3.1 % | $180k | **clears both** |
| ICP | +20.4 % / 17 % / 52 % / +18.6 % / clears | +12.4 % | -18.3 % / 28 % / 0 % / -20.3 % / fails | -13.2 % | $171k | — |
| POL *(2.05 y)* | +28.1 % / 17 % / 100 % / +26.7 % / clears | +9.4 % | -17.8 % / 18 % / 0 % / -19.2 % / fails | +17.6 % | $11k ✗ | — |
| ATOM | -2.6 % / 20 % / 37 % / -5.8 % / fails | -7.5 % | -4.8 % / 25 % / 7 % / -9.1 % / fails | -11.6 % | $17k ✗ | — |

- Regime filter clears the two-window bar (four tests on both windows + $100k book) on: **LINK/USD, NEAR/USD, SUI/USD, ALGO/USD**.
- The baseline trend-4h clears it on: **SUI/USD**.
- Clears where the baseline does not: **LINK/USD, NEAR/USD, ALGO/USD**.
- AAVE clears the filter's four tests on both windows too, and fails only on liquidity ($54k a day on the UK book).

## 4. Kraken-only candidates

A coin is a Kraken-only candidate when trend-4h clears the bar on **Kraken costs** in both windows and either fails on Revolut X costs or has a UK book under $100k a day.

| coin | UK book | Kraken A (ret/DD) | Kraken B | Revolut X A | Revolut X B | plateau A / B | Kraken clears both | Revolut X clears both | Kraken-only |
|---|---|---|---|---|---|---|---|---|---|
| SUI | $942k | +10.1 % / 28 % | +0.8 % / 27 % | +14.5 % | +3.0 % | 85 % / 70 % | yes | yes | no |
| POL *(2.05 y)* | $11k | +6.6 % / 7 % | +14.2 % / 11 % | +9.4 % | +17.6 % | 100 % / 52 % | yes | yes | **yes** |

Every other coin of the 27 fails the Kraken side of the bar on at least one window.

## 5. Sizing — equal $20 slots vs volatility-scaled slots

Volatility-scaled slot = `min(slot, slot × targetATR% ÷ ATR(14)-at-entry ÷ close)`: the same dollar volatility per position, capped at the slot, so it can only ever deploy less. The target is the median ATR% at the **in-sample** entries of that window — no look-ahead. The rotation sleeve is identical in both arms (a basket decision; its slot is already capped at $20).

| window | arm | capital | P&L | return | max DD | ret/DD | deployment | turnover | worst day |
|---|---|---|---|---|---|---|---|---|---|
| A | equal $20 slots | $400 | $-21.54 | -5.4 % | 25 % | -0.22 | 20.0 % | 27.5×/y | $-13.39 |
| A | volatility-scaled | $400 | $-15.64 | -3.9 % | 22 % | -0.18 | 20.0 % | 24.7×/y | $-12.20 |
| B | equal $20 slots | $400 | $+155.21 | +38.8 % | 12 % | 3.19 | 35.3 % | 37.9×/y | $-16.96 |
| B | volatility-scaled | $400 | $+139.24 | +34.8 % | 11 % | 3.17 | 35.3 % | 31.8×/y | $-13.55 |

Window A: target ATR at entry 1.314 % of price, from 673 in-sample entries. Mean size as a share of the slot: trend-4h/BTC 0.973, trend-4h/ETH 0.823, trend-4h/SOL 0.766, trend-4h/AVAX 0.714, trend-4h/SUI 0.585, trend-1h/BTC 1, trend-1h/ETH 0.994, trend-1h/SOL 0.989, momentum-1d/BTC 0.952, momentum-1d/ETH 0.87, momentum-1d/SOL 0.766.

Window B: target ATR at entry 1.249 % of price, from 311 in-sample entries. Mean size as a share of the slot: trend-4h/BTC 0.914, trend-4h/ETH 0.634, trend-4h/SOL 0.578, trend-4h/AVAX 0.49, trend-4h/SUI 0.455, trend-1h/BTC 0.993, trend-1h/ETH 0.982, trend-1h/SOL 0.931, momentum-1d/BTC 0.834, momentum-1d/ETH 0.745, momentum-1d/SOL 0.542.


## Verdicts, under the bar and nothing further

1. **Is the shipped set the best set?** On the bar as written, **no member of the shipped set clears it on both windows** — not one of the 21. Four shipped members clear window A (trend-4h on SOL and on AVAX, on both venues) and thirteen clear window B; the two lists share nothing. The only member of the 39 tested that clears both windows is a **candidate**: `regime-trend-4h·revx·LINK` (§3.9's filter on LINK — window A +2.0 %, DD 17 %, 93 % plateau, Kraken +0.1 %; window B +27.2 %, DD 15 %, 100 % plateau, Kraken +20.5 %). One pass in 39 members × 2 windows is inside what the bar's own multiple-comparison caveat says to expect, so it is a paper-twin candidate at most, not a replacement set.
2. **The best combination under the bar is not a portfolio.** On window A the exhaustive search over the 11 bar-clearers returns a **single sleeve** (`regime-trend-4h·revx·AVAX`, +30.2 % on $20, DD 5 %, ret/DD 5.50) — every addition dilutes the return faster than it cuts the drawdown, because the members are long-only crypto trend rules that are in the market at the same time. On window B it returns five of the fourteen eligible (trend-4h ETH, trend-1h ETH, momentum ETH, momentum SOL, regime LINK: +49.4 % on $80, DD 9 %, ret/DD 5.63). The two answers share **no member**. Both are chosen on the same window they are scored on, so neither is a result; the honest line is the equal-slot set of everything that cleared — window A ret/DD 2.36 (+13.8 % on $206.67), window B 3.39 (+34.3 % on $233.33), against the shipped set's −0.22 and 3.19.
3. **Redundant members.** Every Kraken twin is correlated **0.92–1.00** with its Revolut X counterpart — eight pairs above 0.9 in window A (seven of them at 0.99 or more; the SUI pair is 0.83, the one twin whose trade counts differ) and nine in window B (eight at 0.99 or more) — and the Kraken side earns strictly less on both: window A −$13.73 on $180 against −$7.81 on $220, window B +$59.42 on $180 (+33.0 %) against +$95.79 on $220 (+43.5 %). They carry 45 % of the capital and reproduce the Revolut X rows' signal at 40 bps a side. **What they measure — Kraken's fill and fee against the same signal — is exactly what the correlation shows they do, and nothing else.**
   - **trend-1h is not redundant with trend-4h**: same-coin daily-return correlations 0.50 / 0.53 / 0.55 (window A, BTC/ETH/SOL) and 0.50 / 0.68 / 0.38 (window B) — related, not duplicated. It is also the only rule in the set that loses on BTC in both windows (−$1.24, −$0.97), and the rule with the most fills by far (66–104 a window against trend-4h's 10–40).
   - **momentum-1d is not redundant with trend-4h either**: same-coin correlations 0.43 / 0.58 / 0.47 (A) and 0.59 / 0.65 / 0.60 (B). It is the largest single contributor in window B (+$15.46 on ETH at a $13.33 slot) and the largest single loser in window A (−$3.90 on SOL).
   - The highest correlation between two members that are **not** a venue twin is 0.73 (momentum BTC · momentum SOL, window A) and 0.68 (trend-4h ETH · trend-1h ETH, window B). Nothing in the set duplicates anything except its own twin.
   - **Leave-one-out.** In window A, removing any one of twelve of the twenty-one members improves the set's return/drawdown, by 0.01 to 0.04 — led by `trend-4h·kraken·BTC` (−0.04). In window B twelve again improve it, led by `rotation-1w-kraken` (3.19 → 3.65), which gives up $33.15 of P&L to do it: it adds more drawdown than return. The members whose removal costs the set most are `rotation-1d·revx` (−0.63 to ret/DD, −$56.57) and `momentum-1d·revx·ETH` (−0.23, −$12.03) in window B, and `trend-4h·revx·AVAX` and `trend-4h·revx·SOL` (+0.03 each) in window A.
4. **Parameter stability.** The seeded parameters are on a plateau (at least half the grid positive out of sample) in **both** windows on **AVAX (85 % / 67 %) and SUI (85 % / 70 %) only**, of the five coins trend-4h runs; BTC (0 % / 93 %), ETH (7 % / 100 %) and SOL (100 % / 22 %) each collapse in one window. trend-1h is on a plateau in both windows on **no coin** (BTC 0 % / 19 %, ETH 41 % / 96 %, SOL 93 % / 0 %). momentum-1d's plateau is uninformative — the rule has no free parameter to vary, so its grid is 0 % or 100 % everywhere. The rotation's seeded point sits at 0 % of its grid in window A and 100 % in window B, ranking 11th and 10th of 27 on Revolut X — mid-grid, neither a spike nor a plateau.
5. **The stops are not on a plateau, and the 8 % floor is mostly inert.** The shipped (8 %, 3×ATR) pair ranks 9, 2, 9, 10, 13, 10, 9, 14, 16 and 7 of 16 across the five coins × two windows — a median rank of about 10 of 16, below the middle of its own neighbourhood. The floor changes nothing at all on BTC and AVAX in window A (all four floors give the identical return: the ATR trail always fires first), and on SUI in window A the shipped pair is the **worst of the sixteen** (−10.5 % where a 10 % floor with no trail gives +33.7 %). At the shipped 8 % floor, a 4× trail or no trail at all beats the 3× trail on **8 of the 10** coin-windows.
6. **The regime filter.** It clears the two-window bar on **LINK, NEAR, SUI and ALGO** (and on AAVE but for its $54k book), where the baseline clears it on **SUI alone**. So yes: it clears where the baseline does not, on three coins. But it does so the way §3.9 already warned — by holding less (2–6 % of bars) — and 27 coins × 27 points × 2 windows is 1,458 looks, so three passes is inside chance. §3.9's own written-down next step was "the middle third agreeing, then a paper twin"; the middle third agrees on LINK, NEAR, ALGO and SUI, which is what a paper twin would now be for.
7. **Kraken-only candidates: one, and it is Kraken-only because of liquidity, not returns.** Across all 27 coins, exactly two clear the Kraken side of the bar on both windows: SUI (which already runs on both venues) and **POL** (+6.6 % / +14.2 % on Kraken costs, +9.4 % / +17.6 % on Revolut X, plateau 100 % / 52 %, drawdown 7 % / 11 %). POL clears the numbers on both venues and fails only the $100k UK-book test ($11k a day), so it is a Kraken-only candidate by liquidity. Its history is 2.05 years, not three, so its "thirds" are 8-month slices. **No coin clears on Kraken costs while failing on Revolut X costs.**
8. **Sizing.** Volatility-scaled slots cut both the loss and the drawdown in window A (−3.91 % against −5.38 %, DD 22.2 % against 24.9 %) and cut both the gain and the drawdown in window B (+34.81 % against +38.80 %, DD 11.0 % against 12.2 %). Return/drawdown is essentially unchanged (−0.18 against −0.22; 3.17 against 3.19) and turnover falls 10–16 % (24.7 against 27.5×/y; 31.8 against 37.9×/y). It is a volatility dial, not an edge: it scales the same curve down, most on SUI and AVAX (mean size 46–59 % of the slot) and least on BTC and the 1-hour sleeves (91–100 %).

## Caveats — all of them

- **Window A is one bear year and window B is one bull year.** Nothing here is an estimate of a rule's return; each column is one draw. The two windows disagree on almost every member, which is the finding, not a defect of the test.
- **The same year judges the point and the plateau.** The plateau share is measured out of sample on the very window the chosen point is scored on, exactly as §3.7 measures it. It says the neighbourhood was positive in that year, not that it will be.
- **Sample sizes are small.** trend-4h fires 7–40 times a window per coin; AVAX, SUI, POL, BNB and the regime-filtered rows fire 6–10. Nothing below about twenty round trips separates a rule from luck.
- **The coins move together.** Eight (window A) and nine (window B) of the shipped set's pairs correlate above 0.9, and those are the venue twins; the rest of the set is a single long-crypto factor gated by different clocks. 27 coins is far fewer than 27 independent tests, and combining more of them cuts return faster than drawdown, which is exactly what §1(b) shows.
- **Multiple comparisons.** This study looked at 27 coins × 27 grid points × 2 windows for the baseline and the same again for the regime filter, plus 27 × 27 × 2 for trend-1h and 16 stop points × 5 coins × 2 windows: on the order of 4,000 looks at two years. One member clearing a five-part bar on both windows is what chance produces.
- **Short histories** are flagged in every table: HYPE 0.62 y, TON 0.84 y, BNB 0.91 y, PEPE 1.85 y, POL 2.05 y. Their "windows" are three- to eight-month slices sitting elsewhere on the calendar — `trend-1h·revx·HYPE` cleared window B on a 2026-04→07 slice and was excluded from every combination for that reason. Read their numbers as anecdotes.
- **XLM's window-B baseline (+558 %) and the rotation's window-B figures (+238 % Revolut X, +96 % Kraken)** are one bull window with the bear filter fully invested; the rotation's 71×/y turnover in that window is three times window A's, which is the number that decides what Kraken's fee costs.
- **Spreads are one twenty-minute snapshot** (reference §3.8), and the UK-book volumes used for the $100k test are from that same snapshot.
- **The model is not in the backtest**, and paper is still the only thing that decides.
- **Sizing arms differ only in the per-coin sleeves**: the rotation sleeve is identical in both, so the sizing comparison understates any effect vol-scaling would have on the basket rule.
- **The bar's fourth test (positive on Kraken costs) is one trend-1h can rarely pass** — it is a Revolut-X-only rule by design (§3.4) at ~70 fills a year, and 40 bps maker takes that. Where a trend-1h row's only failure is the Kraken test, the report says so: `trend-1h·revx·SOL` (A), `trend-1h·revx·AVAX` (B), `trend-1h·revx·DOT` (B), `trend-1h·revx·XRP` (B), `trend-1h·revx·LINK` (A).

## Commands run

```
npm --prefix /tmp/claude-0/-home-user-daviesportfolios/1cf3fb75-5b0c-5fb3-9c44-48af6af85fed/scratchpad/denoinst install deno@2.9.6 --no-save     # deno is not on this container's PATH
deno check --quiet supabase/functions/agents/backtest_portfolio.ts
deno run --allow-read --allow-write supabase/functions/agents/backtest_portfolio.ts \
    --data /tmp/claude-0/-home-user-daviesportfolios/1cf3fb75-5b0c-5fb3-9c44-48af6af85fed/scratchpad/ohlcv --out docs/agents/backtests
```

Run time 83.8 s for 27 coins.

## Files written

- `/home/user/daviesportfolios/supabase/functions/agents/backtest_portfolio.ts` — the study script (new).
- `/home/user/daviesportfolios/docs/agents/backtests/portfolio.json` — its distilled output (new).
- `/tmp/claude-0/-home-user-daviesportfolios/1cf3fb75-5b0c-5fb3-9c44-48af6af85fed/scratchpad/portfolio_results.md` — this file.
- `/tmp/claude-0/-home-user-daviesportfolios/1cf3fb75-5b0c-5fb3-9c44-48af6af85fed/scratchpad/portfolio_run.log` — the run's console output.
- `/tmp/claude-0/-home-user-daviesportfolios/1cf3fb75-5b0c-5fb3-9c44-48af6af85fed/scratchpad/mkmd.py`, `/tmp/claude-0/-home-user-daviesportfolios/1cf3fb75-5b0c-5fb3-9c44-48af6af85fed/scratchpad/smoke/`, `/tmp/claude-0/-home-user-daviesportfolios/1cf3fb75-5b0c-5fb3-9c44-48af6af85fed/scratchpad/smokeout/`, `/tmp/claude-0/-home-user-daviesportfolios/1cf3fb75-5b0c-5fb3-9c44-48af6af85fed/scratchpad/denoinst/` — scaffolding.

No other repository file was touched; nothing was committed or pushed.
