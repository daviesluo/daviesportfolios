# Strategy comparison, the Coinbase half: "with Euros" and "with Euros - 2", one book at a time, at £600, £1,200 and £2,400 (CMP-CB, 2026-10-29)

Davies, 2026-10-29, verbatim: "测一下目前最新的revolut x的live以及variant7和8以及7和8的结合，与最新的coinbase的 with euros和with euros-2的这几个
的表现对比，每个策略都按单币种分开测，分别按600磅和1200磅 2400磅测三轮看对比（按年化收益率，需真实反映未来12个月的期待）". This is the Coinbase half.
The Revolut X half (LIVE and variants 7 and 8) is a sibling study on the same method, and the coordinator merges the two.

**What changes in production: nothing.** No engine, row, pre-registration or frozen file was touched. Everything here is paper
money. The money figures are backtest results, not any account's.

## 1. Answers first

The forward 12-month expectation, in % a year of the pounds put on that one book. Every figure carries the live factor
e = 0.825 (§2):

| book | £600 | £1,200 | £2,400 | blend at £600 | what the months say (§4.3, §4.4) |
|---|---|---|---|---|---|
| USDC-GBP, "with Euros" | **29.6 %** [26.8, 32.5] | 29.1 % [26.3, 31.9] | 28.4 % [25.7, 31.3] | 14.2 % [11.7, 16.6] | a step up from early September: 15 trips in August, 116 in September, 100 in October |
| USDC-GBP, "with Euros - 2" | **29.7 %** [26.9, 32.6] | 29.1 % [26.3, 32.0] | 28.4 % [25.7, 31.3] | 14.2 % [11.8, 16.7] | the same: the nudge differs only from 10-09 on |
| USDT-GBP, "with Euros" | **1.7 %** [1.4, 2.0] | 1.6 % [1.3, 2.0] | 1.6 % [1.3, 1.9] | 11.9 % [10.0, 14.0] | a step down at the same time: 44 trips in August, 13 in September, 10 in October |
| USDC-EUR, "with Euros" | **10.2 %** [8.8, 11.6] | 10.2 % [8.8, 11.6] | 10.1 % [8.7, 11.6] | 5.5 % [4.3, 6.7] | up from September (7 trips in August, 54 in September, 30 in October) |
| USDT-EUR, "with Euros" | **6.6 %** [5.0, 8.2] | 6.5 % [4.9, 8.1] | 6.0 % [4.5, 7.6] | 4.3 % [3.0, 5.6] | September high, then about 1 % a year after 09-22 |

- **The headline is the rate since 2026-09-01**, the comparison's regime date (58 days). The Revolut X half found its books
  tightened in the week of 08-24.
  - Coinbase shows a break of its own at the same time (§4.4), so its headline uses the same window.
  - The 50/50 blend (½ OOS + ½ last three months) stands beside it.
  - The 80 % band is the spread of a realised year if the next one is like that window. P(year < 0) is 0.000 on every line.
  - The band carries no allowance for the regime changing again. On these books it has changed twice in a year (§4.4).
- **The break runs opposite ways on the two coins.** From September, flow on Coinbase's GBP books moved from USDT to USDC:
  - USDC-GBP went from 3.2 % a year (June–August) to 35.9 %;
  - USDT-GBP went from 21.1 % to 2.0 % (both before e).
  - The two together, at £600 each, went from about 12 % a year to about 19 %.
  - The EUR books follow USDC-GBP's direction, but USDT-EUR fell back to about 1 % a year after 09-22.
  - October is the engines' own production record, not the bars, so the change is not an artefact of the data switching source.
- **Size barely matters on Coinbase.** Going from £600 to £2,400 costs 0.0–1.2 points a year. The 10 %-of-printed-value cap
  rarely binds, because Coinbase prints large values in the minutes that fill a quote. This is the opposite of Revolut X, where
  the cap binds.
  - The model has no queue (a print through the quote fills the rung up to the cap), so the true size cost is understated.
    The size step is the result to trust least (§5).
- **"with Euros - 2" is "with Euros" on USDC-GBP until 10-09.** Its nudge needs Revolut X's USDC-GBP book, which is recorded
  only from then.
  - Over the 20 days it could act, it nudged 8,640 minutes and moved the figures by +0.0–0.1 points.
  - Nothing over the two years separates the two rows.
- **Settlement.** Coinbase does not round settlement the way Revolut X does, so Revolut X's "dust" cost is not applied here.
  - Its public product and trade data (read keylessly 2026-10-29 ~18:25 UTC) give sizes in 0.01 coin steps
    (`base_increment` 0.01 on all four books), prices in 0.0001 steps (0.00001 on USDT-EUR), and printed sizes to 8 decimals
    (`"69.51000000"` at `"0.74810000"`).
  - An order's size is rounded to 0.01 coin, at most £0.004 of notional, which the engines do not book.
  - The authenticated fill fields (fee decimals) were not read: no key is used.

## 2. The shared method (identical in both halves)

1. **Window**: 2024-10-01 → 2026-10-28 (758 days), by the UTC day of each trip's exit, a day with no trip counting zero.
   - **In sample**: 2024-10-01 → 2025-11-20 (416 days).
   - **Out of sample (OOS)**: 2025-11-21 → 2026-10-28 (342 days), as in FX-SPEED-LONG (`2026-10-29-fx-second-sources.md` §8).
   - **Recent**: the last three months, 2026-07-29 → 10-28 (92 days).
   - **Since 2026-09-01**: 2026-09-01 → 10-28 (58 days), the regime date the Revolut X half found (§4.4).
2. **Forward 12-month expectation**, % a year of capital (P&L ÷ capital, × 365 ÷ days, simple, not compounded):
   - **a. Base**: the OOS daily mean.
   - **b. Decay and the headline.** The headline is the rate since 2026-09-01: both venues changed regime about then (§4.4).
     The blend stands beside it: ½ × the OOS rate + ½ × the last three months' rate (the recent days sit inside the OOS days
     too, so they carry about 63 % of its weight). The OOS, recent and in-sample rates are given as well.
   - **c. Live factor e = 0.825**, applied to every figure: the headline, the blend, OOS, recent, in sample and the bands.
     - Coinbase has no live record. e is the Revolut X half's measure: LIVE's realised P&L ÷ its replay on the same days,
       10-01 → 10-28, both books pooled.
     - A multiplier leaves P(year < 0) as it is.
     - The figures before e are in `results/cb_compare.json`; `cb_compare_stats.py --haircut` sets another factor.
     - Revolut X's penny-rounding "dust" cost is its own settlement and is not applied (§1).
   - **d. Costs**, as the engines book them:
     - no maker fee: the engines book none on Coinbase's `fx_stablecoin` pairs;
     - on a 24-hour stop, the taker's 0.0045 % plus half the touch (read 2026-10-09);
     - no conversion fee, because the paper engines book no conversion;
     - no fixed cost;
     - no interest on idle cash.
   - **e. Uncertainty**: an 80 % interval and P(year < 0) from 10,000 simulated years (seed 20261029). Each year is 365 days
     of 3-day circular blocks. For the headline, every block is drawn from the days since 09-01. For the blend, every block is
     drawn from the OOS days or the recent ones with equal odds.
3. **Also, over the OOS year**: trips a day, bps a trip (P&L ÷ notional), stops a year, worst day, deepest drawdown of the
   cumulative daily P&L, and the capital deployed on average (each position's notional × its time held, ÷ capital × the window).

## 3. The rows as run

**The engine is PR5's frozen `pr5_sim.simulate`, imported unchanged**: the function `stepMinute` is pinned to. It runs on one
continuous Coinbase record per book:
- SCQ-VENUES' minute bars, 2024-10-01 → 10-08, which replay as the prints do;
- then the engines' own minute record, 10-10 → 10-28, from the CB/OKX study's pulls;
- 2026-10-09 has no prints in either source, so orders rest and nothing fills that day.

**Check**: on the history the combined record is SCQ-VENUES' `BarBook`, trip for trip. All 1,721 USDC-GBP trips closed before
10-08 match at £600 (`meta.USDC-GBP.check_barbook`).

**The rules, as they run from 2026-10-29 10:00 UTC:**
- **"Stablecoin quotes with Euros"** (`cb_hold.ts`, the weekend variant, renamed that day). PR5's rule, with the rates held
  through an FX closure for up to 60 hours.
- **"Stablecoin quotes with Euros - 2"** (`cb_nudge.ts`). The same rule on USDC-GBP, its fair nudged inside FX closures by
  Revolut X's USDC-GBP mid (½ of the mid's deviation from its 24-hour EMA against the fair; `nudgeStep`, ported in
  `fx_speed/scripts/cb_long.py`).
  - **The stand-in, explicitly:** Revolut X's book (`agent_book_levels`, REVX-FAIR's `rx_mid_USDC-GBP.txt.gz`) starts
    2026-10-09. Before that this row runs without the nudge, which makes it exactly "with Euros" on USDC-GBP. From 10-09 it runs
    with the nudge on the recorded mid.
  - The Revolut X prints (about 45 a day) are not its mid, so they were not used as a proxy.
  - Its rule needs a Revolut X book of the same pair. Revolut X has none for the EUR books, and none was recorded for USDT-GBP,
    so on the other three books "- 2" would be "with Euros" and was not run.
- **Both rows:**
  - **The coin at Coinbase's own value** (`cb_live`): USDC at 1; USDT at Coinbase USDT-USD's newest one-minute close of
    [t − 10, t − 1] min (596,584 minutes fetched for 2024-09-29 → 2025-11-19, the CB/OKX study's files after that).
  - **The 50 bps de-peg guard** against Revolut X's F3, from 2025-11-22, when Revolut X's USD hours exist. Before that there is
    no reference and no guard. USDT books had 852 minutes with no value in 2024-10 → 10-08 (FX-SPEED-LONG's count).
  - **The release blackout** [T − 1, T + 5] around every scheduled CPI, NFP, FOMC, ECB and BoE release in
    `cbreview/inputs/release_calendar.json`.
- **The rate as the switch of 2026-10-29 reads it** (`cb_fx.ts`, `0173`): the newest `fx_ticks` read that arrived by t + 58 s,
  at its own (TrueFX's) level.
  - Modelled as Exness's last tick at t + 57 s, with 1 s of source age (FX-SPEED-LONG's `L3_raw`, review §8.3).
  - It is held through a closure on the last value.
- **One book at a time, all the capital on it**: £600, £1,200 or £2,400 in six rungs of a sixth each (£100, £200, £400),
  capped at 10 % of the minute's printed value.
  - A EUR book's rung is its pounds in euros at the minute's EUR/GBP (the simulator's X is the pounds per unit of the book's
    currency, from Exness). Its P&L comes back in pounds at the exit minute's rate.
  - The capital is in pounds on every book.

**Runs**: 15 (5 row-books × 3 capitals), about 1.09 million minutes each. About five minutes on four cores.

## 4. Results

### 4.1 The table (strategy × book × size; every figure × e = 0.825)

| row | book | capital (rung) | **since 2026-09-01 %/yr [80 %], P(year < 0)** | blend ½ OOS + ½ last 3 months %/yr [80 %], P(year < 0) | OOS %/yr | last 3 months %/yr | in sample %/yr | £/yr since 09-01 | £/yr blend | before e: since 09-01 / blend |
|---|---|---|---|---|---|---|---|---|---|---|
| "with Euros" | USDC-GBP | £600 (£100) | **29.6 [26.8, 32.5], 0.000** | 14.2 [11.7, 16.6], 0.000 | 8.6 | 19.8 | 21.3 | £178 | £85 | 35.9 / 17.2 |
| "with Euros" | USDC-GBP | £1,200 (£200) | **29.1 [26.3, 31.9], 0.000** | 13.9 [11.5, 16.4], 0.000 | 8.4 | 19.4 | 20.9 | £349 | £167 | 35.2 / 16.9 |
| "with Euros" | USDC-GBP | £2,400 (£400) | **28.4 [25.7, 31.3], 0.000** | 13.7 [11.3, 16.1], 0.000 | 8.3 | 19.0 | 20.5 | £682 | £328 | 34.5 / 16.6 |
| "with Euros" | USDT-GBP | £600 (£100) | **1.7 [1.4, 2.0], 0.000** | 11.9 [10.0, 14.0], 0.000 | 19.3 | 4.6 | 50.5 | £10 | £72 | 2.0 / 14.5 |
| "with Euros" | USDT-GBP | £1,200 (£200) | **1.6 [1.3, 2.0], 0.000** | 11.8 [9.9, 13.8], 0.000 | 19.0 | 4.5 | 50.2 | £20 | £141 | 2.0 / 14.3 |
| "with Euros" | USDT-GBP | £2,400 (£400) | **1.6 [1.3, 1.9], 0.000** | 11.4 [9.6, 13.3], 0.000 | 18.5 | 4.3 | 49.8 | £39 | £274 | 2.0 / 13.8 |
| "with Euros" | USDC-EUR | £600 (£100) | **10.2 [8.8, 11.6], 0.000** | 5.5 [4.3, 6.7], 0.000 | 4.5 | 6.4 | 18.4 | £61 | £33 | 12.4 / 6.6 |
| "with Euros" | USDC-EUR | £1,200 (£200) | **10.2 [8.8, 11.6], 0.000** | 5.5 [4.3, 6.7], 0.000 | 4.5 | 6.4 | 18.3 | £122 | £66 | 12.3 / 6.6 |
| "with Euros" | USDC-EUR | £2,400 (£400) | **10.1 [8.7, 11.6], 0.000** | 5.5 [4.3, 6.7], 0.000 | 4.5 | 6.4 | 18.1 | £243 | £132 | 12.3 / 6.7 |
| "with Euros" | USDT-EUR | £600 (£100) | **6.6 [5.0, 8.2], 0.000** | 4.3 [3.0, 5.6], 0.000 | 4.4 | 4.2 | 8.2 | £39 | £26 | 8.0 / 5.2 |
| "with Euros" | USDT-EUR | £1,200 (£200) | **6.5 [4.9, 8.1], 0.000** | 4.3 [3.0, 5.6], 0.000 | 4.4 | 4.1 | 8.1 | £78 | £51 | 7.9 / 5.2 |
| "with Euros" | USDT-EUR | £2,400 (£400) | **6.0 [4.5, 7.6], 0.000** | 4.0 [2.8, 5.3], 0.000 | 4.2 | 3.8 | 7.9 | £145 | £97 | 7.3 / 4.9 |
| "with Euros - 2" | USDC-GBP | £600 (£100) | **29.7 [26.9, 32.6], 0.000** | 14.2 [11.8, 16.7], 0.000 | 8.6 | 19.8 | 21.3 | £178 | £85 | 36.0 / 17.2 |
| "with Euros - 2" | USDC-GBP | £1,200 (£200) | **29.1 [26.3, 32.0], 0.000** | 13.9 [11.5, 16.4], 0.000 | 8.4 | 19.4 | 20.9 | £349 | £167 | 35.3 / 16.9 |
| "with Euros - 2" | USDC-GBP | £2,400 (£400) | **28.4 [25.7, 31.3], 0.000** | 13.7 [11.3, 16.1], 0.000 | 8.3 | 19.0 | 20.5 | £683 | £328 | 34.5 / 16.6 |

### 4.2 How each book trades (out of sample, 2025-11-21 → 2026-10-28; pounds before e)

| row | book | capital | trips/day | bps a trip | stops/yr | worst day £ | max drawdown £ (% of capital) | deployed % |
|---|---|---|---|---|---|---|---|---|
| "with Euros" | USDC-GBP | £600 | 1.44 | 12.5 | 44 | −0.83 | 1.31 (0.22 %) | 4.1 |
| "with Euros" | USDC-GBP | £1,200 | 1.44 | 12.5 | 44 | −1.65 | 2.59 (0.22 %) | 4.0 |
| "with Euros" | USDC-GBP | £2,400 | 1.44 | 12.7 | 44 | −3.31 | 4.93 (0.21 %) | 3.8 |
| "with Euros" | USDT-GBP | £600 | 3.41 | 11.9 | 34 | −0.75 | 0.75 (0.12 %) | 5.0 |
| "with Euros" | USDT-GBP | £1,200 | 3.41 | 12.0 | 34 | −1.18 | 1.18 (0.10 %) | 4.9 |
| "with Euros" | USDT-GBP | £2,400 | 3.41 | 12.2 | 34 | −2.29 | 2.29 (0.10 %) | 4.6 |
| "with Euros" | USDC-EUR | £600 | 0.87 | 10.6 | 38 | −1.36 | 1.50 (0.25 %) | 3.2 |
| "with Euros" | USDC-EUR | £1,200 | 0.87 | 10.6 | 38 | −2.68 | 2.98 (0.25 %) | 3.1 |
| "with Euros" | USDC-EUR | £2,400 | 0.87 | 10.9 | 38 | −4.97 | 5.36 (0.22 %) | 3.0 |
| "with Euros" | USDT-EUR | £600 | 1.16 | 7.9 | 42 | −0.98 | 1.21 (0.20 %) | 3.7 |
| "with Euros" | USDT-EUR | £1,200 | 1.16 | 8.2 | 42 | −1.51 | 2.31 (0.19 %) | 3.4 |
| "with Euros" | USDT-EUR | £2,400 | 1.16 | 8.3 | 42 | −3.03 | 4.58 (0.19 %) | 3.0 |
| "with Euros - 2" | USDC-GBP | £600 | 1.44 | 12.5 | 44 | −0.83 | 1.31 (0.22 %) | 4.1 |
| "with Euros - 2" | USDC-GBP | £1,200 | 1.44 | 12.6 | 44 | −1.65 | 2.59 (0.22 %) | 4.0 |
| "with Euros - 2" | USDC-GBP | £2,400 | 1.44 | 12.8 | 44 | −3.31 | 4.93 (0.21 %) | 3.8 |

- **Trips and stops do not change with size.** A rung fills on any print through it, and size only scales the fill up to the
  cap. That is also why a drawdown scales almost exactly with capital.
- **"Deployed" is the share of the capital held in open positions, averaged over time.** It is 3–5 %. The rest sits in resting
  quotes, which must be funded all the same (the bids in pounds or euros, the asks in the coin).

### 4.3 By month, out of sample, % a year at £600 (each full calendar month, annualised; before e)

| book | 2025-12 | 2026-01 | 2026-02 | 2026-03 | 2026-04 | 2026-05 | 2026-06 | 2026-07 | 2026-08 | 2026-09 | 2026-10 (to 10-28) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| USDC-GBP ("with Euros" and "- 2") | 8.2 | 15.8 | 12.6 | −0.3 | −0.8 | 0.8 | 4.4 | 1.5 | 3.9 | 40.1 | 31.4 (31.5 with the nudge) |
| USDT-GBP | 21.9 | 27.4 | 37.6 | 24.4 | 31.7 | 46.2 | 30.3 | 22.6 | 10.6 | 2.4 | 1.6 |
| USDC-EUR | 9.2 | 15.2 | 5.2 | 2.2 | −1.6 | −0.1 | 4.9 | 1.7 | −0.1 | 17.7 | 6.7 |
| USDT-EUR | 3.7 | 4.6 | 14.7 | 8.3 | 4.9 | 3.9 | 3.7 | −0.1 | 0.1 | 14.4 | 1.1 |

**What the months say about the next twelve.**
- Every book earned 1.9 to 4 times as much in sample (2024-10 → 2025-11) as out of sample.
- Within the last year, USDC-GBP and USDC-EUR ran near 0–5 % a year until August, then stepped up in September. October,
  from the engines' production record, kept USDC-GBP there.
- USDT-GBP did the opposite: 22–46 % a year through June, then down to 2 % by September.
- The median OOS month (3.5–4.3 % a year on three books, about 26 % on USDT-GBP) describes the year before the step, not the
  regime since. That is why the headline is the rate since 09-01 (§4.4).

### 4.4 Does Coinbase break at 2026-09-01? (at £600, before e)

| book (£600) | Jun–Aug %/yr | since 09-01 %/yr | difference [80 %], P(not lower) | single best split, whole window: date, t, before → after %/yr | single best split, OOS: date, t, before → after | t at 09-01 (whole / OOS) |
|---|---|---|---|---|---|---|
| USDC-GBP | 3.2 | 35.9 | +32.7 [+24.2, +41.7], 1.000 | 2025-04-15, -6.8, 38.1 → 12.2 | 2026-09-06, +5.0, 5.2 → 39.0 | +2.9 / +4.8 |
| USDT-GBP | 21.1 | 2.0 | -19.0 [-23.8, -14.5], 0.000 | 2026-09-22, -16.1, 46.3 → 1.2 | 2026-09-22, -10.6, 26.1 → 1.2 | -15.9 / -10.5 |
| USDC-EUR | 2.1 | 12.4 | +10.3 [+5.8, +14.8], 1.000 | 2026-02-10, -8.3, 20.6 → 3.5 | 2026-02-10, -3.2, 11.8 → 3.5 | -0.8 / +2.7 |
| USDT-EUR | 1.2 | 8.0 | +6.8 [+1.9, +12.0], 0.973 | 2026-09-22, -4.6, 8.2 → 1.0 | 2026-09-22, -2.9, 5.9 → 1.0 | +0.0 / +0.9 |

- **Yes, at the same time as Revolut X, in both directions.**
  - **USDT-GBP** falls at 09-01: Welch t −15.9 over the whole window at that date. The single best split anywhere is 09-22,
    t −16.1, so a step in September.
  - **USDC-GBP** rises: the best out-of-sample split is 09-06 (t +5.0), and t is +4.8 at 09-01.
  - **USDC-EUR and USDT-EUR** also rise from September. USDT-EUR falls again after 09-22.
  - A scan's largest t is not a p-value: it is read against the t at the date named in advance (09-01) and against the months.
- **Coinbase has an earlier break of its own, a slow decline from 2025.**
  - USDC-GBP's best split over the whole window is 2025-04-15: 38 % a year before, 12 % after.
  - USDC-EUR's is 2026-02-10: 21 % before, 3.5 % after.
  - USDT-GBP's slide ran from May to August, before its September step.
- **What it means for the next twelve months.** Since 09-01 the GBP books' flow sits on USDC. A single book bet on USDT-GBP's
  past (the blend, 14.5 % before e) or on USDC-GBP's past (OOS, 10.4 %) would both have been wrong by a factor of several within
  two months.
  The headline takes the regime as it stands. On these books it has changed twice in a year.

## 5. What this does not show

- **No queue.** A print strictly through a resting quote fills the whole rung up to 10 % of the minute's value, whoever else
  rests at that price.
  - At £400 a rung the paper fills what a real order behind other makers might not. The size effect (0.0 to 1.2 points from
    £600 to £2,400, after e) is therefore a floor on the true cost of size, not an estimate of it.
  - The Revolut X half fills by print size (LIVE's "at" rule) and will show a steeper fall. The two halves differ in this, not
    only in venue.
- **No live record and no live fill rule on Coinbase.** e = 0.825 is Revolut X's LIVE against its replay, on another venue's
  fill rule; it stands in for both.
- **The coin the asks hold is not marked.** Half the capital of a book sits in the coin, for the three ask rungs:
  - On USDC-GBP and USDC-EUR that half is a dollar position against pounds or euros.
  - A year's typical GBP/USD move of 7–8 % on half the capital is ±3.5–4 % of capital: as large as the smaller headlines here, with no
    expected sign.
  - The paper engines, Coinbase's and Revolut X's alike, book none of it. The same holds for USDT.
- **The nudge's history is 20 days.** Over the two years "- 2" is "with Euros" on USDC-GBP. The table cannot rank the nudge;
  its own pre-registration (`2026-10-29-cb-usdc-nudge-prereg.md`) does.
- **The rate is modelled, not replayed.** Exness stands in for TrueFX (FX-SPEED-LONG §8.7). The month table shows that any error
  of that model is small beside the regime.
- **The release calendar's BLS dates are recalled** (`cb_releases.ts`' header). A wrong date costs a blackout, not the rule.

## 6. Files

`docs/agents/backtests/compare/cb/`:
- `scripts/cb_compare.py`: the runs. It imports `fx_speed/scripts/cb_long.py`, `exness_long.py` and the CB/OKX study's
  loaders; nothing in them changed. It reads the derived Exness file that `fx_speed/scripts/exness_long.py build` writes,
  pinned in `fx_speed/MANIFEST_long.json`, and writes the runs (not committed).
- `scripts/cb_compare_stats.py` → `results/cb_compare.json`. Per row, book and capital: the headline, its band and P(year < 0),
  the since-09-01, in-sample, OOS and recent rates, the months, the breaks, the OOS trading figures, and every figure × e.

To run it again:

    python3 -I fx_speed/scripts/exness_long.py build <zips> X.txt.gz
    python3 -I compare/cb/scripts/cb_compare.py X.txt.gz runs.json.gz
    python3 -I compare/cb/scripts/cb_compare_stats.py runs.json.gz compare/cb/results/cb_compare.json [--haircut R]

`--haircut R` sets another live factor (0.825 by default).
