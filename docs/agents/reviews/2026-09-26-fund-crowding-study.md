# FUND: funding crowding as a BTC spot trade at Revolut X's costs — both rules FAIL (2026-09-26)

The test of fp5's two frozen funding signals, UZERO (the last settled BTCUSDT funding rate below zero) and USOFR (below
the eight-hour SOFR carry), as a BTC spot long bought at 00:00 UTC and held 48 hours, one position at a time, at
Revolut X's cost. Pre-registered in `2026-09-26-fund-crowding-prereg.md`, frozen on `main` at `98862d04` (sha256
`a0a85db1…a2ab8`) before any return of the trade was computed. At the review before the freeze one change was made
to the draft: the shift null is asked of the primary window only, and the second window is a replication by sign.

## Order of work

* 17:45–18:15 UTC: the pre-registration was drafted from event counts only (signal days, entries, days held) and the
  unconditional daily volatility. No return of the trade was computed.
* The pre-registration was reviewed, changed as above, and frozen at `98862d04`.
* 18:20–18:23 UTC: `fetch.py` pulled the four inputs keylessly and checked them. The funding history on
  www.binance.com and the public monthly archive agree on every stamp and every rate of the 7,305 settlements they
  share (2020-01 → 2026-08). Every spot zip matched the sha256 the archive publishes beside it. Coinbase had a candle
  for all 2,572 days.
* 18:26 UTC: the 19 pin tests of `test_score.py` passed. `score.py` checked the pre-registration's sha256, then
  recomputed the power check's counts from the stored funding and SOFR before it read any price. Every count equals
  the frozen table. It then scored.
* 18:27 UTC: two more runs. All three wrote `fund.json` byte for byte.
* After the runs: a second implementation that shares no code with `score.py` rebuilt the signals, the trades, S at
  both costs, the halves, every shift p and the Coinbase line for all six rule-and-window cells. All matched to four
  decimals. A second pull of all four inputs reproduced their sha256 exactly.
* 18:35 UTC: a pagination variable in `fetch.py` was renamed, which changes nothing it does. The inputs were pulled
  again with it and came out byte for byte the same. The scorer then ran twice more, byte-identical, sha256
  `3964e667…04cc1fc2`. Against the earlier runs only the recorded hash of `fetch.py` differs.

## Answer first

**Both rules fail.** Neither beats the shift null in the primary window, 2024-01-01 → 2026-09-25, and neither makes
money in the second half of it. Both made money, a lot of it, in 2019–2022, the second window.

| Condition | UZERO | USOFR |
|---|---|---|
| 1. S > 0 in each window | pass (+$36.73, +$166.71) | pass (+$11.36, +$150.50) |
| 2. S > 0 in each of the four halves | **fail**: primary second half −$0.88 | **fail**: primary second half −$15.17 |
| 3. Shift null, primary window, Holm | **fail**: p = 199/879 = 0.226 | **fail**: p = 685/879 = 0.779 |
| 4. S > 0 at double cost in each window | pass (+$28.26, +$152.10) | **fail**: primary −$4.19 |
| 5. Without the best month > 0, and it ≤ 40 % | pass (39.0 % and 25.3 %) | **fail**: 2024-05 is 151 % of the primary total; without it −$5.82 |
| 6. Over 4 % a year on $100, primary | pass (13.43 %) | pass, barely (4.15 %; S $11.36 against $10.94) |
| 7. At least 30 entries in each window | pass (40, 68) | pass (74, 72) |
| **Verdict** | **FAIL** | **FAIL** |

Holm needs the smaller p at 0.025 or below. The smaller is UZERO's, 0.226, so neither rule clears. The verdict would
be the same under the draft's stricter version, the null in both windows: the primary window decides it.

## The numbers

S is the P&L in dollars with $100 in each trade, not compounded, at 10.5 bp a side (the stress arm 21 bp). Prices are
Binance BTCUSDT spot daily opens.

| Rule | Window | Entries | Days held | S | S at double cost | First half · second half | Best month (share) | Without it | Annualised on $100 |
|---|---|---:|---:|---:|---:|---|---|---:|---:|
| UZERO | Primary | 40 | 200 | +$36.73 | +$28.26 | +$37.61 · −$0.88 | 2024-05 +$14.33 (39.0 %) | +$22.40 | 13.43 % |
| UZERO | Second | 68 | 264 | +$166.71 | +$152.10 | +$112.52 · +$54.19 | 2020-03 +$42.14 (25.3 %) | +$124.57 | 50.37 % |
| UZERO | 2023 (reported) | 20 | 63 | +$42.81 | +$38.52 | +$43.42 · −$0.61 | 2023-03 +$26.59 (62.1 %) | +$16.22 | 42.81 % |
| USOFR | Primary | 74 | 496 | +$11.36 | −$4.19 | +$26.53 · −$15.17 | 2024-05 +$17.18 (151.2 %) | −$5.82 | 4.15 % |
| USOFR | Second | 72 | 317 | +$150.50 | +$135.08 | +$112.65 · +$37.85 | 2020-03 +$42.14 (28.0 %) | +$108.35 | 45.47 % |
| USOFR | 2023 (reported) | 29 | 175 | +$76.07 | +$69.83 | +$46.83 · +$29.25 | 2023-10 +$25.64 (33.7 %) | +$50.43 | 76.07 % |

The shift null: the same position rule on the window's signal-day sequence rotated by every k from 60 to N − 60 days.
The last column is arithmetic on the reported numbers, not a pre-registered statistic: (S − the null's mean) over the
days held.

| Rule | Window | Shifts | S | Null mean | Null p95 · p97.5 | Shifts at or above S | p | Excess over the null mean, a held day |
|---|---|---:|---:|---:|---|---:|---:|---:|
| UZERO | Primary | 878 | +$36.73 | +$14.08 | +$60.73 · +$69.12 | 198 | 199/879 = 0.226 | +11.3 bp |
| UZERO | Second | 1,088 | +$166.71 | +$18.26 | +$106.29 · +$120.00 | 6 | 7/1089 = 0.006 | +56.2 bp |
| UZERO | 2023 (reported) | 245 | +$42.81 | +$16.12 | +$42.99 · +$47.94 | 14 | 15/246 = 0.061 | +42.4 bp |
| USOFR | Primary | 878 | +$11.36 | +$39.40 | +$99.03 · +$109.00 | 684 | 685/879 = 0.779 | −5.7 bp |
| USOFR | Second | 1,088 | +$150.50 | +$25.61 | +$133.33 · +$153.94 | 31 | 32/1089 = 0.029 | +39.4 bp |
| USOFR | 2023 (reported) | 245 | +$76.07 | +$52.64 | +$86.91 · +$89.06 | 40 | 41/246 = 0.167 | +13.4 bp |

The second window's p is reported, as frozen; it is not part of the bar. So is 2023's.

**Descriptive lines**

* **Coinbase BTC-USD opens**, the same trades at the same cost. UZERO +$36.62 (primary), +$165.78 (second) and
  +$42.57 (2023); USOFR +$10.64, +$149.91 and +$76.08. The halves have the same signs as on Binance, and no trade was
  left out. The USDT quote changes no sign, so the "What follows" caveat about it does not arise.
* **Buy and hold**, one round trip: +$99.21 on $100 over the primary window, +$63.47 over the second and +$155.08 in
  2023.
* **Mean net**: UZERO earned 91.8 bp a trade and 18.4 bp a held day in the primary window, against 245.2 and 63.2 in
  the second. USOFR earned 15.4 bp a trade and 2.3 a held day in the primary window, against 209.0 and 47.5 in the
  second.
* **Days in the market**: UZERO 20.0 % in the primary window and 21.9 % in the second; USOFR 49.7 % and 26.2 %.
* **The power check**, recomputed from the stored inputs, equals the frozen one. The daily sd is 2.473 % in the
  primary window, 3.908 % in the second and 2.28 % in 2023. The smallest edge at 80 % power is 219, 231, 148 and 232 bp
  a trade, or 43.8, 59.6, 22.1 and 52.8 bp a held day. Every other count the text states also holds: the signal days by
  year, the 55 of UZERO's 140 primary-window days in February–April 2026, the trade lengths, 40–41 (and 74–75, 68–69,
  72–73) entries over every shift, and every UZERO day being a USOFR day.

## What it says

**The edge was there before 2024 and is not there since.** Measured as the excess over the shift null's mean per held
day, UZERO went from +56 bp in 2019–2022 to +42 bp in 2023 and +11 bp in 2024–26. USOFR went from +39 to +13 to −6.
In the primary window UZERO's timing is inside chance (p 0.23). USOFR's is below the middle of the null (p 0.78): its
496 days in the market earned less than the same pattern of days placed at most other dates of 2024–26 (684 of 878
shifts did at least as well). Both lost money from 2025-05-13 on.

Which trades carried the second window (descriptive, after the fact):

* The March 2020 crash: one trade entered 2020-03-13 made +$34.41.
* The 2019-10-25 rally: +$28.27.
* July 2021: an 11-day hold from 07-19 made +$25.66.

The primary window's largest UZERO trades by size:

* 2026-02-25: +$13.20.
* 2025-04-20: +$10.99.
* 2026-02-03: a 16-day hold that lost $15.77.

So in 2019–2023 the days after negative funding were, on average, better than other days of the same window. In
2024–26 they were not.

The power check said a failure would mean "no large edge". That is what this is. UZERO's primary-window estimate,
about 11 bp a held day, is the size the check said this data cannot resolve. It is also well under the 2023 effect
that brought the rules here.

## Deviations from the frozen text

None in the signals, the trade, the windows, the costs, the null or the bar. Additions, none of which changes a number
the bar reads:

* **`test_score.py`**, 19 pins on the position rule, the shift, the cost, the p-value, Holm and the signals. Its
  sha256 is in `fund.json` with the other scripts'.
* **Checksums**: `fetch.py` also checks each archive zip against the sha256 published beside it.
* **Percentile rule**: the frozen text names no rule for the null's descriptive percentiles. `fund.json` uses
  `sorted[int(q × (M − 1))]` and says so.
* **The p string**: p is reported as the unreduced fraction (1 + shifts at or above S) / (1 + shifts).
* **Rounding**: `fund.json` rounds for display, and the bar is decided on unrounded values. No condition sits close
  enough for the rounding to matter. The nearest is condition 6 for USOFR, S $11.3605 against $10.937.
* **Stop checks**: the scorer stops unless the pre-registration's sha256 is the frozen one. Its hard stop on counts
  covers the table the text names. The other counts stated in the power check are recomputed and reported beside it,
  and all agree.

## What follows (as frozen)

Both fail. So funding crowding as a BTC spot trade is closed at this account's cost. It is recorded with the power
statement: no large edge, a small one not ruled out. The four screens §3.369 of fp5's Binance branch set aside (UZERO,
CZERO, USOFR, MSOFR) stay where they are, and nothing further is run on these signals. No paper row is proposed.

## Files

* `docs/agents/backtests/fund/fetch.py`: pulls and checks the inputs.
* `docs/agents/backtests/fund/score.py`: the scorer, which reads only `inputs/`.
* `docs/agents/backtests/fund/test_score.py`: the pins (`python3 docs/agents/backtests/fund/test_score.py`).
* `docs/agents/backtests/fund/inputs/`, gzip, 97 KB in all, sha256 in `fund.json`:
  * `funding_btcusdt.json.gz`: 7,715 settlements, 2019-09-10 08:00 → 2026-09-24 16:00 UTC.
  * `sofr.json.gz`: 1,827 prints, 2019-06-03 → 2026-09-24.
  * `spot_btcusdt_open.json.gz`: 2,572 opens, 2019-09-11 → 2026-09-25.
  * `coinbase_btcusd_open.json.gz`: 2,572 opens, the same days.
* `docs/agents/backtests/fund/fund.json`: every number above, with every trade, each month's total, the null's
  percentiles and the sha256 of the pre-registration, the inputs and the scripts. It is written byte for byte the same
  on every run: sha256 `3964e667baebc3ededb54f53d8f4fa67ed780f4f17ea9db72f75f70904cc1fc2`.
