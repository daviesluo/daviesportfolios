# Allocation study — what is the best configuration of the whole set, and is it good enough for real money?

Run 2026-09-21T20:04Z. Script `supabase/functions/agents/backtest_allocation.ts`; raw output `docs/agents/backtests/allocation.json`. It extends `docs/agents/reviews/2026-09-21-portfolio-study.md` (reference §3.10) and does not repeat it: §3.7 / §3.8's universe is not re-run and §3.9's regime filter is not re-tested. What is new is the money — how a row's capital is split between its coins, how the book is split between the rows, what a Kraken round trip has to earn, and one priced recommendation for the whole set.

**Two windows, never averaged.** *Window A* = parameters on the first two thirds, the LAST third out of sample (2025-09 → 2026-09, a bear year). *Window B* = parameters on the first third, the MIDDLE third out (2024-09 → 2025-09, a bull year). Each coin is split on its own bar count.

**Fidelity.** The three things `run` cannot express — per-entry sizing, the per-trade log, the stop distance at each entry — are written in a `runSized` copied from `run` line by line. With the weight switched off it reproduces `run` exactly: **40 checks (five coins × two windows × two rulebooks × both venues' costs), worst |Δreturn| 0, |ΔmaxDD| 0, |Δtrades| 0.**

**One correction to §3.10.** The portfolio study called `runRotation` **without** the stops, so its rotation figures are §3.4's *bare rank rule*, not the rule the loop runs. Every rotation number here is the shipped rule — the 8 % floor under each slot and the two-day cooldown:

| window | venue | shipped (floor + cooldown) | bare rank rule (what §3.10 priced) |
|---|---|---|---|
| A | Revolut X | **−16.2 %**, DD 32.7 %, 63 trades, 8 stops | −14.4 %, DD 31.7 % |
| A | Kraken (7-day hold) | **−13.2 %**, DD 35.2 %, 45 trades, 11 stops | −16.1 %, DD 37.0 % |
| B | Revolut X | **+199.1 %**, DD 41.3 %, 88 trades, 8 stops | +237.7 %, DD 38.8 % |
| B | Kraken (7-day hold) | **+86.8 %**, DD 42.8 %, 68 trades, 9 stops | +96.3 %, DD 45.7 % |

The set-level effect is small (window A −5.3 % here against §3.10's −5.4 %; window B +36.9 % against +38.8 %) because the two rotation rows move in opposite directions in window A. The rotation row's own record changes materially, and question 4 uses it.

**Slot convention** (`tick.ts`: `min(capital_usd / slots, agent_risk.max_order_usd = 20)`). A sleeve's dollar P&L is its fractional return applied to a FIXED slot, summed daily — which is what a live row earns, since it re-sizes every entry to the same dollars rather than compounding. A sleeve that triples therefore shows less P&L here than its own compounded return (`rotation-1d·revx` window B: +199.1 % compounded, +$51.42 on a $40 slot = +128.5 % as a live row earns it).

**The weighting rule that keeps the evidence arms honest.** A slot weighted by a coin's past is a result only if that past is not the window it is scored on. The **prior segment** of a window is the third immediately before it — for window A the middle third, for window B the first third. For window A the prior segment *is* window B's out-of-sample third, so "weighted on the other window" and "weighted on the preceding year" are the same arm. For window B they are not: the other window's third is the FUTURE, and that variant is reported separately and labelled.

---

## 1. Capital per coin — how a row's capital is split between its coins

Every arm keeps each row's deployable capital where it is and moves money only between the coins inside it, so questions 1 and 2 do not confound. The whole shipped set, $400:

| window | arm | return | max DD | ret/DD | deployment | turnover | worst day | best day | biggest order |
|---|---|---|---|---|---|---|---|---|---|
| A | **equal slots (shipped)** | **−5.3 %** | 24.5 % | **−0.22** | 19.4 % | 28.3×/y | −$12.94 | +$29.40 | $20.00 |
| A | inverse volatility (slots) | −7.0 % | 25.2 % | −0.28 | 20.1 % | 29.5×/y | −$12.58 | +$28.49 | $32.56 |
| A | vol-scaled per entry (§3.10's arm) | −4.5 % | 23.6 % | −0.19 | 19.4 % | 27.2×/y | −$12.74 | +$29.40 | $20.00 |
| A | evidence, prior segment | −10.3 % | 28.5 % | −0.36 | 20.5 % | 30.3×/y | −$13.86 | +$40.39 | $89.34 |
| A | concentrated (bar-clearers only) | −9.6 % | 26.2 % | −0.37 | 19.8 % | 30.0×/y | −$13.41 | +$32.29 | $40.00 |
| A | equal risk at the stop | −7.5 % | 25.9 % | −0.29 | 19.9 % | 29.6×/y | −$12.94 | +$28.58 | $32.28 |
| A | evidence, other window *(= prior segment here)* | −10.3 % | 28.5 % | −0.36 | 20.5 % | 30.3×/y | −$13.86 | +$40.39 | $89.34 |
| B | **equal slots (shipped)** | **+36.9 %** | 12.3 % | **3.00** | 34.8 % | 38.6×/y | −$16.77 | +$25.13 | $20.00 |
| B | inverse volatility (slots) | +39.9 % | 12.0 % | 3.32 | 35.3 % | 39.9×/y | −$16.01 | +$28.81 | $28.80 |
| B | vol-scaled per entry (§3.10's arm) | +33.2 % | 11.8 % | 2.82 | 34.8 % | 34.9×/y | −$15.35 | +$21.55 | $20.00 |
| B | evidence, prior segment | +31.3 % | 13.9 % | 2.25 | 35.7 % | 39.5×/y | −$25.87 | +$30.19 | $49.53 |
| B | concentrated (bar-clearers only) | +35.7 % | 12.1 % | 2.95 | 35.2 % | 39.1×/y | −$21.45 | +$27.97 | $40.00 |
| B | equal risk at the stop | +39.3 % | 12.3 % | 3.20 | 35.4 % | 39.8×/y | −$16.14 | +$28.03 | $28.56 |
| B | evidence, other window **(LOOK-AHEAD — weights from the last third)** | +34.5 % | 11.2 % | 3.10 | 32.6 % | 36.6×/y | −$21.66 | +$23.62 | $52.29 |

**Nothing beats equal slots on both windows.** Inverse volatility and equal risk beat it in B (3.32 / 3.20 against 3.00) and lose to it in A (−0.28 / −0.29 against −0.22). Vol-scaling per entry does the reverse (−0.19 in A, 2.82 in B). Evidence weighting and concentration are beaten by equal slots on **both**.

### The same, inside one row

| window | row | equal | inverse vol | equal risk | evidence (prior) | concentrated | vol-scaled/entry |
|---|---|---|---|---|---|---|---|
| A | trend-4h | **−0.3 % / −0.03** | −3.0 % / −0.23 | −3.1 % / −0.24 | −10.2 % / −0.52 | −9.9 % / −0.66 | −0.0 % / 0.00 |
| A | trend-1h | **+0.5 % / 0.02** | −2.0 % / −0.10 | −2.0 % / −0.10 | −5.1 % / −0.22 | −5.1 % / −0.22 | +0.4 % / 0.02 |
| A | momentum-1d | −8.1 % / −0.20 | −5.3 % / −0.14 | −8.1 % / −0.20 | **+0.2 % / 0.00** | −8.1 % / −0.20 | −4.9 % / −0.13 |
| B | trend-4h | +12.6 % / 1.24 | **+17.4 % / 1.71** | +17.3 % / 1.71 | +6.9 % / 0.47 | +13.3 % / 1.10 | +7.7 % / 0.85 |
| B | trend-1h | +4.0 % / 0.23 | +6.4 % / 0.36 | **+6.4 % / 0.37** | −11.4 % / −0.54 | −14.2 % / −0.61 | +1.8 % / 0.13 |
| B | momentum-1d | +62.4 % / 3.66 | **+65.1 % / 3.74** | +62.4 % / 3.66 | +58.2 % / 3.22 | +64.6 % / 2.89 | +55.1 % / 3.72 |

### Why the evidence arm loses — the weights themselves

| window | row | evidence (prior segment) | what those coins then did |
|---|---|---|---|
| A | trend-4h | BTC 24.5 %, **ETH 71.1 %**, SOL 0 %, AVAX 0 %, SUI 4.3 % | ETH −10.3 %, while the two it zeroed made +13.3 % and +12.1 % |
| A | trend-1h | BTC 0 %, **ETH 100 %**, SOL 0 % | ETH −6.9 %, SOL +14.1 % |
| A | trend-4h (concentrated) | BTC 33.3 %, ETH 33.3 %, SUI 33.3 % | −13.6 %, −10.3 %, −10.5 % — every one of the three |
| B | trend-4h | BTC 0.8 %, ETH 21.0 %, **SOL 48.7 %**, AVAX 29.5 %, SUI 0 % | SOL −10.9 %, AVAX −3.3 %, while ETH made +49.4 % |
| B | momentum-1d | BTC 15.1 %, ETH 9.6 %, **SOL 75.3 %** | SOL +52.9 %, ETH +116.0 % |

The prior segment's winner is the scored window's loser in four of the five rows shown. The look-ahead variant — weights taken from the *other* window's out-of-sample third instead of the preceding one — does not rescue it either (window B +34.5 % against equal slots' +36.9 %): the ranking does not persist in either direction.

### Equal risk is not a separate idea

The binding stop distance at entry is `min(8 % floor, 3×ATR(14)/close)`. Median at the in-sample entries:

| row | BTC | ETH | SOL | AVAX | SUI | what binds |
|---|---|---|---|---|---|---|
| trend-4h (window A) | 3.52 % | 5.09 % | 6.84 % | 7.75 % | 8.00 % | the ATR trail, except SUI |
| trend-1h (window A) | 1.89 % | 2.62 % | 3.56 % | — | — | the ATR trail, always |
| momentum-1d (window A) | 8.00 % | 8.00 % | 8.00 % | — | — | the floor, always (no trail) |

So on `momentum-1d` equal risk **is** equal dollars — a percentage floor risks the same fraction of every slot — and its arm is identical to equal slots to the digit. On the trend rules equal risk is inverse volatility with a cap, which is why the two arms' weights differ by under a point and their returns by under 0.1 of a point.

---

## 2. Capital per row — how the book is split between the rows

### Each row on its own, at the live slot sizes

| window | row | capital | P&L | return | max DD | ret/DD | deployment | turnover | worst day |
|---|---|---|---|---|---|---|---|---|---|
| A | trend-4h · revx | $100 | −$0.33 | −0.3 % | 11.8 % | −0.03 | 6.5 % | 19.0×/y | −$3.79 |
| A | trend-1h · revx | $40 | +$0.19 | +0.5 % | 20.4 % | 0.02 | 6.6 % | 69.3×/y | −$0.78 |
| A | momentum-1d · revx | $40 | −$3.22 | −8.1 % | 41.0 % | −0.20 | 44.3 % | 39.3×/y | −$3.73 |
| A | rotation-1d · revx | $40 | −$5.32 | −13.3 % | 37.0 % | −0.36 | 30.3 % | 26.1×/y | −$3.88 |
| A | trend-4h · kraken | $100 | −$0.41 | −0.4 % | 14.3 % | −0.03 | 6.6 % | 18.8×/y | −$3.98 |
| A | momentum-1d · kraken | $40 | −$8.05 | −20.1 % | 51.3 % | −0.39 | 44.3 % | 39.3×/y | −$3.81 |
| A | rotation-1w · kraken | $40 | −$3.94 | −9.8 % | 41.5 % | −0.24 | 35.5 % | 16.3×/y | −$3.09 |
| B | trend-4h · revx | $100 | +$12.64 | +12.6 % | 10.2 % | 1.24 | 11.3 % | 25.9×/y | −$4.62 |
| B | trend-1h · revx | $40 | +$1.61 | +4.0 % | 17.3 % | 0.23 | 9.3 % | 87.2×/y | −$2.19 |
| B | momentum-1d · revx | $40 | +$24.97 | +62.4 % | 17.1 % | 3.66 | 56.8 % | 28.6×/y | −$2.63 |
| B | rotation-1d · revx | $40 | +$51.42 | +128.5 % | 22.5 % | 5.72 | 83.1 % | 74.9×/y | −$5.17 |
| B | trend-4h · kraken | $100 | +$4.82 | +4.8 % | 11.7 % | 0.41 | 11.3 % | 25.9×/y | −$4.88 |
| B | momentum-1d · kraken | $40 | +$21.46 | +53.6 % | 19.4 % | 2.76 | 56.8 % | 28.6×/y | −$2.63 |
| B | rotation-1w · kraken | $40 | +$30.78 | +77.0 % | 26.8 % | 2.87 | 85.8 % | 48.7×/y | −$4.85 |

### Leave one row out

| window | row | own P&L | set ret/DD without it | Δ | set P&L without it | set DD without it |
|---|---|---|---|---|---|---|
| A | momentum-1d · kraken | −$8.05 | −0.17 | **−0.05** | −$13.04 | 21.5 % |
| A | rotation-1d · revx | −$5.32 | −0.19 | −0.03 | −$15.77 | 23.4 % |
| A | rotation-1w · kraken | −$3.94 | −0.21 | −0.01 | −$17.15 | 22.7 % |
| A | momentum-1d · revx | −$3.22 | −0.22 | +0.00 | −$17.87 | 22.7 % |
| A | trend-4h · revx | −$0.33 | −0.23 | +0.01 | −$20.76 | 29.5 % |
| A | trend-1h · revx | +$0.19 | −0.23 | +0.01 | −$21.28 | 25.2 % |
| A | trend-4h · kraken | −$0.41 | −0.25 | +0.03 | −$20.68 | 28.1 % |
| B | rotation-1w · kraken | +$30.78 | 3.37 | **−0.37** | +$116.91 | 9.6 % |
| B | trend-4h · kraken | +$4.82 | 3.29 | −0.29 | +$142.87 | 14.5 % |
| B | trend-1h · revx | +$1.61 | 3.18 | −0.18 | +$146.07 | 12.7 % |
| B | trend-4h · revx | +$12.64 | 3.07 | −0.07 | +$135.05 | 14.7 % |
| B | momentum-1d · kraken | +$21.46 | 2.88 | +0.12 | +$126.23 | 12.2 % |
| B | momentum-1d · revx | +$24.97 | 2.75 | +0.25 | +$122.72 | 12.4 % |
| B | rotation-1d · revx | +$51.42 | 2.64 | +0.36 | +$96.27 | 10.1 % |

**One row's removal improves the set on both windows: `rotation-1w·kraken`** (−0.01 in A, −0.37 in B) — the only one of the seven. Removing a row improves the set's return over drawdown in three of seven cases in window A (`momentum-1d·kraken`, `rotation-1d·revx`, `rotation-1w·kraken`; `momentum-1d·revx` is neutral) and four of seven in window B (`rotation-1w·kraken`, `trend-4h·kraken`, `trend-1h·revx`, `trend-4h·revx`), and the two lists share one member. No row's removal costs the set on both windows: `trend-4h·kraken`, `trend-4h·revx` and `trend-1h·revx` each help in one window and hurt in the other, and `rotation-1d·revx` and `momentum-1d·kraken` do the reverse (`momentum-1d·revx` is neutral in A and costs the set in B).

### Row correlations (daily P&L per $1 of row capital)

| window | pair | correlation |
|---|---|---|
| A | momentum-1d · momentum-1d-kraken | 0.999 |
| A | trend-4h · trend-4h-kraken | 0.958 |
| A | rotation-1d · rotation-1w-kraken | 0.905 |
| A | momentum-1d · rotation-1d | 0.722 |
| B | momentum-1d · momentum-1d-kraken | 1.000 |
| B | trend-4h · trend-4h-kraken | 0.999 |
| B | rotation-1d · rotation-1w-kraken | 0.939 |
| B | rotation-1d · momentum-1d-kraken | 0.640 |

Every venue pair is a twin (0.905–1.000). The highest correlation between two rules that are not twins is 0.72 (momentum · rotation, window A) and 0.64 (window B).

### Row plans, priced

`_sameBook` plans keep the whole $400 at work by scaling the rows that remain; the plain ones drop a row and leave its money in cash. `on $400` is the P&L over the book the owner would otherwise have committed, so a smaller set is not flattered by a smaller denominator.

| plan | capital | A return | A on $400 | A DD | A ret/DD | B return | B on $400 | B DD | B ret/DD | biggest order | peak open |
|---|---|---|---|---|---|---|---|---|---|---|---|
| shipped | $400 | −5.3 % | −5.3 % | 24.5 % | −0.22 | +36.9 % | +36.9 % | 12.3 % | 3.00 | $20.00 | $400 |
| **trend4h only (revx)** | **$100** | **−0.3 %** | −0.1 % | **11.8 %** | **−0.03** | **+12.6 %** | +3.2 % | **10.2 %** | 1.24 | $20.00 | $100 |
| trend4h only, scaled to the book | $400 | −0.3 % | −0.3 % | 11.8 % | −0.03 | +12.6 % | +12.6 % | 10.2 % | 1.24 | $80.00 | $400 |
| trend4h both venues | $200 | −0.4 % | −0.2 % | 13.0 % | −0.03 | +8.7 % | +4.4 % | 10.9 % | 0.80 | $20.00 | $200 |
| revx, no rotation | $180 | −1.9 % | −0.8 % | 18.5 % | −0.10 | +21.8 % | +9.8 % | 9.0 % | 2.43 | $20.00 | $180 |
| **trend4h + momentum (revx)** | **$140** | −2.5 % | −0.9 % | 18.7 % | −0.14 | +26.9 % | +9.4 % | 8.1 % | **3.31** | $20.00 | $140 |
| drop both rotations | $320 | −3.7 % | −3.0 % | 21.2 % | −0.17 | +20.5 % | +16.4 % | 9.4 % | 2.18 | $20.00 | $320 |
| revx only, $180 redeployed | $400 | −4.0 % | −4.0 % | 21.8 % | −0.18 | +41.2 % | +41.2 % | 11.2 % | 3.68 | $36.37 | $400 |
| revx only, $180 in cash | $220 | −4.0 % | −2.2 % | 21.8 % | −0.18 | +41.2 % | +22.7 % | 11.2 % | 3.68 | $20.00 | $220 |
| kraken only | $180 | −6.9 % | −3.1 % | 28.3 % | −0.24 | +31.7 % | +14.3 % | 13.7 % | 2.32 | $20.00 | $180 |
| **row capital by prior-segment evidence** | $400 | **−11.2 %** | −11.2 % | **37.3 %** | **−0.30** | +37.4 % | +37.4 % | 12.1 % | 3.09 | $67.73 | $400 |

The row-evidence plan is the same failure as the per-coin one, one level up. In window A it puts **$135.46 of $400 into `rotation-1d`** (which had made +199.1 % on the middle third) and $86.68 into `momentum-1d`; both then lost, and the set's drawdown goes from 24.5 % to 37.3 %. In window B it correctly gives the rotation rows nothing — and beats equal capital by 0.09 of a point.

Ranked by the **worse** of the two windows' return over drawdown — the only ranking an all-or-nothing decision can use — the order is: trend4h-only (−0.03), trend4h-both-venues (−0.03), revx-no-rotation (−0.10), trend4h+momentum (−0.14), drop-rotations (−0.17), revx-only (−0.18), shipped (−0.22), kraken-only (−0.24), row-evidence (−0.30).

---

## 3. The venue split

### The arithmetic, before any backtest

| pair | Revolut X round trip | Kraken round trip | extra, per round trip | gross move a Kraken round trip needs |
|---|---|---|---|---|
| BTC/USD | 19.50 bps | 80.01 bps | **60.51 bps** | 0.800 % |
| ETH/USD | 20.10 | 80.04 | 59.94 | 0.800 % |
| SOL/USD | 21.10 | 80.92 | 59.82 | 0.809 % |
| XRP/USD | 23.80 | 81.00 | 57.20 | 0.810 % |
| LINK/USD | 26.40 | 80.10 | 53.70 | 0.801 % |
| AVAX/USD | 27.60 | 81.70 | 54.10 | 0.817 % |
| SUI/USD | 41.94 | 83.82 | 41.88 | 0.838 % |
| POL/USD | 53.52 | 95.93 | 42.41 | 0.959 % |

At each row's measured turnover, the extra fee alone is: `trend-4h` 19.0 fills/y per slot = 9.5 round trips × 60.5 bps = **5.8 % of the row a year**; `momentum-1d` 39.3 fills = 19.6 round trips = **11.9 % a year**; `trend-1h` 69.3 fills = 34.7 round trips = **21.0 % a year** (27.7 % a year in absolute Kraken fees, which is §3.4's figure reproduced). The measured twin drag below is 3.0–16.8 points a window, which brackets these.

**The break-even hold.** A round trip pays for itself when the drift over the hold covers it. At a 30 %-a-year drift (0.082 % a day) a Revolut X round trip on a major is paid back in **2.4 days** and a Kraken one in **9.7 days**; at 100 % a year, 0.7 and 2.9 days. Measured median holds: `trend-4h` **2.29 days**, `momentum-1d` **3.42 days**, `trend-1h` **0.60 days**. Revolut X's majors are paid back inside the hold the rules actually take; Kraken's are not, on any rule. (SUI on Revolut X needs 5.1 days at a 30 % drift and is held 1.0–1.25 days — its 42 bps round trip is the one Revolut X cost that its own hold does not cover.)

### What each round trip actually caught, out of sample

| rulebook | coin-windows | median of the MEAN gross per round trip | median of the MEDIAN gross | median hold | coin-windows whose mean gross beat Revolut X's 19.5 bps | … beat Kraken's 82 bps |
|---|---|---|---|---|---|---|
| trend-4h | 10 | **+0.64 %** | −1.15 % | 2.29 d | 5 of 10 | **5 of 10** |
| momentum-1d | 6 | +0.91 % | −1.54 % | 3.42 d | 3 of 6 | **3 of 6** |
| trend-1h | 6 | +0.06 % | −0.82 % | 0.60 d | 2 of 6 | **1 of 6** |

The **median** round trip loses money before any fee on every rulebook in both windows — trend following pays for many small losses with a few large wins, which is what it is supposed to do. The number that decides a venue is the mean, and it clears a Kraken round trip in half the trend-4h coin-windows, half the momentum ones and one of six for trend-1h.

### The twins, measured

| window | Kraken row | twin | correlation | Kraken | twin | cost drag |
|---|---|---|---|---|---|---|
| A | trend-4h·BTC | trend-4h·revx·BTC | 0.993 | −21.6 % | −13.6 % | 7.97 pts |
| A | trend-4h·ETH | … | 0.998 | −16.5 % | −10.3 % | 6.23 |
| A | trend-4h·SOL | … | 0.998 | +8.0 % | +13.3 % | 5.29 |
| A | trend-4h·AVAX | … | 0.999 | +9.1 % | +12.1 % | 2.99 |
| A | trend-4h·SUI | … | **0.830** | +12.2 % | −10.5 % | **−22.68** |
| A | momentum·BTC / ETH / SOL | … | 0.997 / 0.999 / 0.999 | −27.6 / +0.0 / −37.8 % | −17.0 / +10.4 / −29.2 % | 10.56 / 10.43 / 8.58 |
| A | rotation-1w | rotation-1d·revx | 0.905 | −13.2 % | −16.2 % | −2.99 |
| B | trend-4h·BTC / ETH / SOL / AVAX / SUI | … | 0.996–1.000 | +3.7 / +37.4 / −19.7 / −9.3 / +0.8 % | +17.0 / +49.4 / −10.9 / −3.3 / +3.0 % | 13.34 / 12.02 / 8.86 / 6.08 / 2.24 |
| B | momentum·BTC / ETH / SOL | … | 0.999–1.000 | +24.4 / +99.1 / +41.9 % | +38.7 / +116.0 / +52.9 % | 14.33 / 16.83 / 11.06 |
| B | rotation-1w | rotation-1d·revx | 0.939 | +86.8 % | +199.1 % | 112.22 |

Eight of nine twins in window A and nine of nine in window B are correlated 0.90 or above; seven of nine in window A and eight of nine in window B are at 0.99 or above. The Kraken side earns less on every pair except the two whose *paths* diverge rather than their costs — `trend-4h·SUI` in window A (r 0.83: the only twin whose fills differ enough to separate them, on 8 round trips) and `rotation-1w` in window A (a different rule — a seven-day minimum hold).

### Kraken, four ways

| window | Kraken configuration | capital | return | max DD | ret/DD |
|---|---|---|---|---|---|
| A | every Kraken row (the same rules as Revolut X) | $180 | −6.9 % | 28.3 % | −0.24 |
| A | the slowest rows only (trend-4h + rotation-1w) | $140 | −3.1 % | 21.5 % | −0.14 |
| A | trend-4h only | $100 | −0.4 % | 14.3 % | −0.03 |
| A | *the Revolut X rows, for comparison* | $220 | −4.0 % | 21.8 % | −0.18 |
| B | every Kraken row | $180 | +31.7 % | 13.7 % | 2.32 |
| B | the slowest rows only | $140 | +25.4 % | 13.7 % | 1.85 |
| B | trend-4h only | $100 | +4.8 % | 11.7 % | 0.41 |
| B | *the Revolut X rows, for comparison* | $220 | +41.2 % | 11.2 % | 3.68 |

Every Kraken configuration is beaten by its Revolut X counterpart on both windows.

### Kraken-only coins — §4.16's candidates, on the parameters a row would run

| coin | window | Kraken seeded | Revolut X seeded | plateau on Kraken | numbers pass | UK book | Kraken book |
|---|---|---|---|---|---|---|---|
| POL *(2.05 y)* | A | **+33.0 %**, DD 17.7 %, 7 trades | +35.0 % | 100 % | yes | $11k ✗ | **never measured** |
| POL | B | **−5.2 %**, DD 19.3 %, 14 trades | −2.3 % | 51.9 % | **no** — negative on both venues | $11k ✗ | never measured |
| LINK | A | **−1.3 %**, DD 16.0 %, 19 trades | +3.8 % | 44.4 % | **no** — negative, plateau < 50 % | $693k | never measured |
| LINK | B | +20.5 %, DD 15.8 %, 20 trades | +27.2 % | 88.9 % | yes | $693k | never measured |

§3.10 called POL a Kraken-only candidate on the parameters **chosen in sample** (+6.6 % / +14.2 %). On the **seeded** parameters a row would actually run it is +33.0 % / −5.2 % and fails window B on both venues. Separately, §4.16 requires a book of at least $100k a day **on the venue the coin would run on**, and Kraken's 24-hour volume has only ever been measured for BTC, ETH and SOL (reference §2b, probe 2026-09-20): POL's Kraken book is unmeasured, so the liquidity half of the bar cannot be applied to it at all.

---

## 4. Which rulebooks earn their place

Seeded parameters, out of sample, with the plateau (share of the rule's own grid positive out of sample) and §3.7's four tests from each venue's point of view.

| member | A return / DD / plateau / Kraken / passes | B return / DD / plateau / Kraken / passes |
|---|---|---|
| trend-4h · BTC | −13.6 % / 21.1 % / 0 % / −21.6 % / no | +17.0 % / 14.6 % / 93 % / +3.7 % / **yes** |
| trend-4h · ETH | −10.3 % / 19.9 % / 7 % / −16.5 % / no | +49.4 % / 21.7 % / 100 % / +37.4 % / **yes** |
| trend-4h · SOL | +13.3 % / 17.6 % / 100 % / +8.0 % / **yes** | −10.9 % / 36.7 % / 22 % / −19.7 % / no |
| trend-4h · AVAX | +12.1 % / 9.1 % / 85 % / +9.1 % / **yes** | −3.3 % / 23.7 % / 67 % / −9.3 % / no |
| trend-4h · SUI | −10.5 % / 25.4 % / 85 % / +12.2 % / no | +3.0 % / 25.7 % / 70 % / +0.8 % / **yes** |
| trend-1h · BTC | −9.3 % / 17.9 % / 0 % / −28.4 % / no | −7.3 % / 21.7 % / 19 % / −32.3 % / no |
| trend-1h · ETH | −6.9 % / 21.6 % / 41 % / −24.5 % / no | +33.0 % / 19.1 % / 96 % / +4.0 % / **yes** |
| trend-1h · SOL | +14.1 % / 22.6 % / 93 % / −6.3 % / no (Kraken) | −15.8 % / 25.2 % / 0 % / −34.1 % / no |
| momentum-1d · BTC | −17.0 % / 33.3 % / 0 % / −27.6 % / no | +38.7 % / 31.9 % / 100 % / +24.4 % / **yes** |
| momentum-1d · ETH | +10.4 % / 35.1 % / 100 % / +0.0 % / no (DD, Kraken) | +116.0 % / 25.3 % / 100 % / +99.1 % / **yes** |
| momentum-1d · SOL | −29.2 % / 56.5 % / 0 % / −37.8 % / no | +52.9 % / 32.0 % / 100 % / +41.9 % / **yes** |
| rotation-1d · revx | −16.2 % / 32.7 % / 0 % / (kraken −13.2 %) / no | +199.1 % / **41.3 %** / 100 % / +86.8 % / **no — drawdown ≥ 35 %** |
| rotation-1w · kraken | −13.2 % / **35.2 %** / 0 % / (revx −16.2 %) / no | +86.8 % / **42.8 %** / 100 % / +199.1 % / **no — drawdown ≥ 35 %** |

### Feedback speed — the claim trend-1h is kept for

| window | row | fills | over | fills per 30 days | days to 10 fills |
|---|---|---|---|---|---|
| A | trend-1h · revx | 214 | 375 d | **17.1** | 18 |
| A | momentum-1d · revx | 121 | 375 d | 9.7 | 31 |
| A | trend-4h · revx | 98 | 375 d | 7.8 | 38 |
| A | rotation-1d · revx | 63 | 366 d | 5.2 | 58 |
| B | trend-1h · revx | 268 | 375 d | **21.4** | 14 |
| B | trend-4h · revx | 137 | 375 d | 11.0 | 27 |
| B | momentum-1d · revx | 88 | 375 d | 7.0 | 43 |
| B | rotation-1d · revx | 88 | 366 d | 7.2 | 42 |

### Verdict per rulebook

| rulebook | A / B ret/DD (own row) | plateau in both windows | keep, shrink or drop |
|---|---|---|---|
| **trend-4h · revx** | −0.03 / 1.24 | AVAX 85/67 %, SUI 85/70 % — two of five | **keep, at its shipped $100** |
| **momentum-1d · revx** | −0.20 / 3.66 | uninformative (no free parameter) | **shrink to zero for a live set; keep in paper.** The largest bull-year contributor in the set and a 41 % row drawdown in the bear year |
| **trend-1h · revx** | 0.02 / 0.23 | no coin | **drop.** It contributes $0.19 and $1.61 on $40, turns over 69–87×/y — three times any other row — and is on a plateau on no coin in either window. Its feedback-speed case survives only weakly: 17–21 fills a month against trend-4h's 8–11, so it halves the time to a judgement rather than transforming it, and trend-4h alone reaches ten fills in 27–38 days |
| **rotation-1d / rotation-1w** | −0.36 / 5.72 and −0.24 / 2.87 | seeded point at 0 % of the grid in A, 100 % in B | **drop.** It fails the bar on both windows on both venues, and for different reasons each time: it loses in the bear year and it breaches the 35 % drawdown limit in the bull year (41.3 % and 42.8 %). Its own stops make it worse in three of the four window × venue cells. `rotation-1w·kraken` is the **only row of the seven whose removal improves the set on both windows** (−0.01 in A, −0.37 in B) |
| **every Kraken row** | −0.24 / 2.32 as a group | — | **drop from a live set.** 0.905–1.000 correlated with their Revolut X twins, 3.0–16.8 points worse per twin per window, and beaten by the Revolut X side on both windows in every configuration tried |

---

## 5. Coin changes

Leave one coin out of a row and re-split the row's capital equally between the coins that remain — what `tick.ts` does when a symbol leaves a row. A positive Δ means the row's return over drawdown improved without that coin.

| row | coin | own A return | Δ ret/DD (A) | own B return | Δ ret/DD (B) | improves both? |
|---|---|---|---|---|---|---|
| trend-4h · revx | BTC | −13.6 % | +0.29 | +17.0 % | −0.17 | no |
| trend-4h · revx | ETH | −10.3 % | +0.20 | +49.4 % | −0.92 | no |
| trend-4h · revx | **SUI** | −10.5 % | **+0.13** | +3.0 % | **+0.05** | **yes** |
| trend-4h · revx | AVAX | +12.1 % | −0.25 | −3.3 % | +0.22 | no |
| trend-4h · revx | SOL | +13.3 % | −0.30 | −10.9 % | +0.44 | no |
| trend-1h · revx | BTC | −9.3 % | +0.22 | −7.3 % | +0.28 | **yes** |
| trend-1h · revx | ETH | −6.9 % | +0.14 | +33.0 % | −0.73 | no |
| trend-1h · revx | SOL | +14.1 % | −0.38 | −15.8 % | +0.51 | no |
| momentum-1d · revx | **BTC** | −17.0 % | **+0.10** | +38.7 % | **+0.46** | **yes** |
| momentum-1d · revx | ETH | +10.4 % | −0.21 | +116.0 % | −0.77 | no |
| momentum-1d · revx | SOL | −29.2 % | +0.23 | +52.9 % | −0.77 | no |
| trend-4h · kraken | BTC | −21.6 % | +0.42 | +3.7 % | −0.02 | no |
| trend-4h · kraken | SUI | +12.2 % | −0.24 | +0.8 % | −0.01 | no |

Four of the nineteen coin × row pairs tested (the table above shows thirteen of them) improve their row on both windows: **SUI out of `trend-4h·revx`** (+0.13 / +0.05 — and the same removal *hurts* the Kraken row on both windows, −0.24 / −0.01), **BTC out of `trend-1h·revx`** (+0.22 / +0.28, a row this study recommends dropping whole), and **BTC out of `momentum-1d`** on both venues (+0.10 / +0.46 on Revolut X, +0.10 / +0.51 on Kraken; the Revolut X row without BTC is +1.0 % / DD 35.2 % in A and +74.4 % / DD 18.1 % in B against −8.1 % / 41.0 % and +62.4 % / 17.1 %).

**Nothing is changed.** Nineteen leave-one-out tests scored on the same two windows they are chosen on produce three or four two-window passes by chance; SUI's margin is 0.13 and 0.05 of a point and reverses on the other venue; BTC out of momentum is the one worth writing down for the paper record to settle, and momentum is not in the recommended live set anyway. **No coin joins:** POL fails window B on the seeded parameters on both venues, and its Kraken 24-hour book has never been measured, so §4.16's liquidity test cannot be applied to it.

**On market cap** (Davies asked whether SUI at $4.3B and AVAX at $5B are too small): nothing in this study bears on market cap, and everything in it bears on the book. SUI's Revolut X UK book is $942k a day and AVAX's $1.9M, both comfortably over §4.15's $100k; SUI's *spread* is what costs it — a 42 bps round trip against the majors' 20, which needs 5.1 days at a 30 %-a-year drift to pay for itself and is held 1.0–1.25 days. POL's problem is $11k a day on the UK book, and separately that its Kraken book has never been measured at all. The constraint is venue liquidity, as the answer on file says; this study adds that for SUI the binding cost is the spread rather than the depth.

---

## 6. The whole recommended set, priced

| | row | venue | coins | row capital | slot | parameters |
|---|---|---|---|---|---|---|
| **recommended** | `trend-4h` | Revolut X (UK book) | BTC, ETH, SOL, AVAX, SUI | **$100** | **$20 × 5, equal** | unchanged — fast 20 / slow 100 / breakoutUp 55 / breakoutDown 20 / atrN 14 / atrStop 3 / volN 42; 8 % floor under cost, 3×ATR(14) trail, two-bar cooldown |
| | *everything else* | — | — | **$0 of real money** | — | `trend-1h`, `momentum-1d`, `rotation-1d` and all three Kraken rows stay in paper at their paper capital |

| | capital | A P&L | A return | A on $400 | A DD | A ret/DD | A turnover | B P&L | B return | B on $400 | B DD | B ret/DD | B turnover |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **recommended** (trend-4h · revx, $100, equal $20) | $100 | **−$0.33** | −0.3 % | −0.1 % | **11.8 %** | **−0.03** | 19.0×/y | **+$12.64** | +12.6 % | +3.2 % | **10.2 %** | 1.24 | 25.9×/y |
| the alternate (+ momentum-1d · revx $40) | $140 | −$3.55 | −2.5 % | −0.9 % | 18.7 % | −0.14 | 24.8×/y | +$37.61 | +26.9 % | +9.4 % | 8.1 % | 3.31 | 26.4×/y |
| (a) the shipped set | $400 | −$21.09 | −5.3 % | −5.3 % | 24.5 % | −0.22 | 28.3×/y | +$147.69 | +36.9 % | +36.9 % | 12.3 % | 3.00 | 38.6×/y |
| (b) equal-weight BTC/ETH/SOL/XRP, held | $400 | −$186.64 | **−46.7 %** | −46.7 % | — | — | 0 | +$712.32 | **+178.1 %** | +178.1 % | — | — | 0 |
| (c) cash | $400 | $0.00 | 0.0 % | 0.0 % | 0 % | — | 0 | $0.00 | 0.0 % | 0.0 % | 0 % | — | 0 |

Monthly equity of the recommended set, window A: $100.15, $100.90, $99.28, $99.28, $99.28, $99.55, $99.55, $95.32, $93.11, $94.67, $94.67, $92.05, $99.81. Window B: $100.00, $100.00, $99.25, $97.01, $107.50, $103.06, $103.09, $103.09, $103.09, $109.15, $109.01, $107.70, $114.14, $110.48. Worst day −$3.79 (A) and −$4.62 (B); best +$6.15 and +$5.41.

**Caps.** The recommendation fits `agent_risk` exactly as it stands: the biggest order is **$20** (`max_order_usd` = 20) and the peak simultaneous open notional is **$100** (`max_exposure_usd` = 100), reached on the one day all five coins were in position; the 95th percentile is $60 and the median $0. **Nothing has to be raised.** The alternate needs `max_exposure_usd` raised from $100 to $140. Running trend-4h at four times the size (the whole $400 in one row) would need `max_order_usd` 80 and `max_exposure_usd` 400. Placeability: Revolut X's minimum is $0.10 of quote, so a $20 slot clears it by 200×; nothing is recommended on Kraken, whose `ordermin` has only ever been read for XBT / ETH / SOL (§2b) and is unverified for AVAX, SUI and POL.

**Would I put this live with real money?** Yes — at this size, and knowing exactly what is being bought. What the two windows say about this configuration is that it is the flattest thing in the set: it lost $0.33 in the year crypto fell 47 % and made $12.64 in the year crypto rose 178 %, with drawdowns of 11.8 % and 10.2 %, and no allocation arm, no extra row and no coin change improved it on both windows. What they do **not** say is that it has an edge: of the 21 shipped members not one clears the bar on both windows, this row's own coins clear it in exactly one window each and disagree about which, and the seeded parameters sit on a plateau in both windows on two of the five coins. So the live question at $100 is not "what will this return" — the two windows say −$0.33 and +$12.64 on the $100 deployed — it is "does the live settlement path work", and paper cannot answer that: Revolut X's fill fields are still an assumption (§4.17, B4), and the first live order is the test. What would change my mind, in either direction: a quarter of paper in which `trend-4h·revx` makes fills whose prices differ materially from the backtest's touch; a Revolut X UK book that widens under stress (every spread here is one twenty-minute snapshot, and the thin-book guard is not built); any live order whose outcome the loop cannot establish; or, the other way, a paper quarter in which `momentum-1d·revx` without BTC does what §5 suggests, which would make the alternate the better set.

---

## Verdicts

1. **Capital per coin: equal slots, because nothing beat it out of sample on both windows.** Inverse volatility (ret/DD −0.28 / 3.32) and equal risk (−0.29 / 3.20) beat it in the bull year and lose in the bear; per-entry vol-scaling (−0.19 / 2.82) does the reverse; equal slots is −0.22 / 3.00. Weighting by a coin's own record on the preceding third is beaten by equal slots on **both** windows (−0.36 / 2.25), and so is concentrating on the coins that cleared the bar there (−0.37 / 2.95): in four of five rows the prior segment's best coin is the scored window's worst. Taking the weights from the *other* window instead of the preceding one does not help either (+34.5 % against +36.9 % in B). **Equal risk is not a separate idea** — under a percentage floor it is equal dollars exactly (momentum-1d), and under the ATR trail it is inverse volatility with a cap (the two arms' weights differ by under a point).
2. **Capital per row: everything into `trend-4h` on Revolut X, and nothing anywhere else.** Ranked by the worse of the two windows, trend-4h alone (−0.03 / 1.24) beats every other arrangement including the shipped set (−0.22 / 3.00) and the honest "drop what does not earn its place" alternatives (revx-only −0.18 / 3.68; drop-the-rotations −0.17 / 2.18). Row capital by prior-segment evidence is the worst plan tried (−0.30 / 3.09): in the bear window it puts a third of the book into the rotation row on the strength of a +199 % middle third.
3. **The venue split: Kraken should run no real money at all, and should keep doing exactly what it already does — supply the signal.** A Kraken round trip costs 80–96 bps against Revolut X's 19.5–53.5, needs a 0.80–0.96 % gross move, and is paid back only after ~9.7 days at a 30 %-a-year drift where Revolut X's majors are paid back in 2.4; the rules hold 0.6–3.4 days. The twins are 0.905–1.000 correlated with their Revolut X counterparts and 3.0–16.8 points worse per window; every Kraken configuration — all rows, the slowest rows, trend-4h alone — is beaten by its Revolut X counterpart on both windows. There is no Kraken-only coin: POL fails window B on the seeded parameters on both venues, and its Kraken book has never been measured.
4. **Rulebooks: keep `trend-4h`, drop `rotation-1d` and `rotation-1w`, drop `trend-1h`, and shrink `momentum-1d` to paper.** The rotation fails the bar on both windows on both venues — negative in the bear year, over the 35 % drawdown limit in the bull (41.3 % and 42.8 %) — and its own stops make it worse in three of four cells. trend-1h earns $0.19 and $1.61 on $40 while turning over 69–87×/y, is on a plateau on no coin in either window, and its feedback-speed case is 17–21 fills a month against trend-4h's 8–11: a factor of two, not the order of magnitude the argument needs. momentum-1d is the set's biggest bull-year contributor and carries a 41 % row drawdown in the bear year; it is the one row a larger live set should add, and the one that costs most when the year goes the other way.
5. **No coin changes.** Four of nineteen leave-one-out tests improve a row on both windows — SUI out of `trend-4h·revx` (+0.13 / +0.05, reversing on the Kraken row), BTC out of `trend-1h·revx` (+0.22 / +0.28, a row being dropped whole) and BTC out of `momentum-1d` on each venue (+0.10 / +0.46 and +0.10 / +0.51) — and nineteen tests scored on the windows that chose them produce that many by chance. Nothing joins: POL fails the seeded-parameter test on window B and its Kraken book is unmeasured. Market cap is not the constraint on SUI or AVAX; SUI's constraint is its 42 bps round trip against a 1.0–1.25-day hold.
6. **The set: `trend-4h` on Revolut X, five coins, five equal $20 slots, $100 — live; everything else paper at zero real money.** Window A −0.3 % (DD 11.8 %), window B +12.6 % (DD 10.2 %), against the shipped set's −5.3 % / +36.9 %, against holding the majors' −46.7 % / +178.1 %, against cash's 0 % / 0 %. It fits `max_order_usd` = 20 and `max_exposure_usd` = 100 with nothing to change.

---

## Caveats — all of them

- **Window A is one bear year and window B is one bull year.** Nothing here estimates a return; each column is one draw, and the two windows disagree about almost every member — which is the finding, not a defect.
- **The recommendation is chosen by the worse of two windows,** which is one number from each of two single draws. A third window could reorder the whole table.
- **Every allocation arm is scored on the same two windows it is compared on.** Seven arms × two windows × nine row plans is ~130 looks; "equal slots wins" survives that only because equal slots is the *null*, not a search result. The arms that won a single window (inverse volatility, equal risk, per-entry vol-scaling) are exactly what that many looks produces.
- **The leave-one-out tests are chosen and scored on the same window.** Nineteen coin × row pairs and seven rows, twice; three or four two-window passes is what chance gives.
- **Sample sizes are small.** trend-4h fires 5–20 closed round trips per coin per window; AVAX and SUI fire 5–12. Nothing under about twenty round trips separates a rule from luck, and the per-trade means in §3 rest on 5–52 trades each.
- **The coins move together.** Five long-only crypto trend sleeves are closer to one bet than five; the venue twins are 0.905–1.000 correlated and the non-twin rows 0.54–0.72.
- **The evidence arms depend on how the weight is formed.** Weights here are proportional to the prior segment's return, clipped at zero, and the concentrated arm is the bar applied to that segment. A different functional form (rank weights, a shrinkage estimator, a longer look-back than one third) might behave differently; what is shown is that the natural form loses on both windows, not that no form could win.
- **The rotation sleeve is identical in every per-coin arm** — it is a basket decision whose slot is already capped at $20 — so question 1 understates whatever a per-coin weight would do to the basket rule.
- **A row's dollar P&L here does not compound.** It is the fixed-slot sum a live row earns, which is why `rotation-1d·revx`'s window B reads +128.5 % on its slot where its own curve compounds to +199.1 %.
- **The rotation's open-notional flag is a proxy** — a day whose basket equity moved is counted as a day it held something. The per-coin sleeves' flags are exact.
- **Spreads are one twenty-minute snapshot** (reference §3.8) and the UK-book volumes for §4.15's $100k test come from that same snapshot. Kraken's 24-hour book has only ever been measured for BTC, ETH and SOL, which is why no Kraken-only coin can pass §4.16 today.
- **Kraken's `ordermin` / `costmin` are known for XBT, ETH and SOL only.** Nothing is recommended on Kraken, but a Kraken row on AVAX, SUI or POL would need the probe's pair-config read before a $20 slot could be called placeable.
- **The model is not in the backtest.** Jev's veto can only remove entries, so every figure here is an upper bound on what the live rule would have traded, and the difference is unmeasured until paper measures it.
- **The break-even hold arithmetic assumes a constant drift** (30 % and 100 % a year) applied to a median hold. Real trend returns are not a drift; the figure is a scale, not a forecast.
- **§3.10's rotation figures were the bare rank rule.** This study corrects them, and the correction is small at the set level and large at the row level — anything downstream that quoted `rotation-1d·revx` at −14.4 % in window A should now read −16.2 %.

---

## Commands run

```
deno check --quiet supabase/functions/agents/backtest_allocation.ts
deno run --allow-read --allow-write supabase/functions/agents/backtest_allocation.ts \
    --data <scratchpad>/ohlcv --out docs/agents/backtests
```

Run time 28.6 s for 8 coins, 2 windows, 7 rows, 7 allocation arms and 13 row plans. `latest.json` and `summary.json` were not touched.

## Files written

- `supabase/functions/agents/backtest_allocation.ts` — the study script (new).
- `docs/agents/backtests/allocation.json` — its distilled output (new).
- `docs/agents/reviews/2026-09-21-allocation-study.md` — this file (new).

No other repository file was touched; nothing was committed or pushed.
