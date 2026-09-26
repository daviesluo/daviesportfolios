# Pre-registration fp6-H2 CARRY-Q: ETH spot against its USDⓈ-M quarterly, one package at a time, held to delivery

Written 2026-09-26 (UTC), before any return, basis level or P&L of this rule was computed on any day of its window.
Frozen by the commit that puts this file on `main`; nothing below may change after it, and any deviation is reported
as a deviation. It is hypothesis H2 of fp6's family of five (`2026-09-26-fp6-prereg-family.md`), Holm-corrected across
the five.

**Access comes first**: the short leg is a derivative; the sources and what they allow are in the family file. A pass
would not make it available to a UK-registered retail account.

## Why

A quarterly delivers at the settlement price on the last Friday of its quarter at 08:00 UTC, so a package long spot and
short the quarterly locks the basis at entry, less four fills. fp5's SPQTR did this on BTC with a $100 package on every
day the previous close basis was at least 100 bp: all 395 out-of-sample packages were positive, and the fp5 review
put the result at about 8.4 % a year on the capital the overlapping packages tie up, falling to about cash by 2026.
ETH's quarterly is "the same sentence with the coin changed" (SPQTR's protocol) and was never scored. This test asks the
question a person with capital would ask: one package at a time, entered only when its annualised net basis is at
least the worth-money line and held to delivery — is that worth money on the capital it ties up, and is it still?

## What was seen before the freeze (disclosed)

* SPQTR's protocol, 2023 screen and 2024–26 result on BTC (the Binance branch `b348842e`, `backtests/fp332/`), the fp5
  review, and the FUND study.
* The withdrawn H1's counts of BTC and ETH perpetual funding settlements (the family file).
* In this session: the list of BTC and ETH quarterlies in the archive, the days each has a bar (`quarterly_1d.json.gz`),
  and the counts of this rule (packages, days held, by half and in the last twelve months; `measurements.json` → `h2`).
  Counting needs the rule's entry test (the annualised net basis at the previous closes against 8 %), so which days
  the ETH basis cleared 8 % is known as a count; no basis level, return or P&L was written or printed.

## Data (`docs/agents/backtests/fp6/`, keyless, hashes in `manifest.json`)

* `inputs/quarterly_1d.json.gz`: daily klines of every ETHUSDT (and BTCUSDT) USDⓈ-M quarterly delivered or listed from
  ETHUSDT_220930 to ETHUSDT_261225, `data.binance.vision` monthly zips (checked against their published sha256), plus
  `www.binance.com/fapi/v1/klines` for September 2026. Bars a contract keeps after its delivery are never read.
* `inputs/spot_1d.json.gz`: Binance spot ETHUSDT (and BTCUSDT) daily klines.
* Half-spreads: spot from `inputs/books.json.gz` (ETHUSDT 0.019 bp, BTCUSDT 0.0006 bp); the quarterlies from
  `inputs/qbooks.json.gz` (twenty bookTicker samples, 60 s apart, 2026-09-26 21:17–21:36 UTC), the median, half the full
  spread: the nearer quarterly ETH 0.442 bp (BTC 0.346), the farther ETH 5.191 bp (BTC 3.680). A fill in a contract that
  is the nearest-delivery quarterly listed that day pays the nearer figure; any other pays the farther one.

## The rule (`rules.py` `h2_pick`, frozen with this file)

Decisions at 00:00 UTC on each day d from 2023-01-01 to 2026-09-24:

* **Flat**: among the ETH quarterlies with a close on d − 1, a bar on d, and at least 14 days from d to their delivery
  day, take the one with the highest y = ((F / S − 1) − 40 bp) × 365 / days to delivery, F and S the quarterly's and
  spot's closes on d − 1 (ties to the nearer delivery). If y ≥ 8 %, open at d's opens: buy q of spot (0.10 % spot
  taker, + half-spread), sell q of that quarterly (0.05 % USDⓈ-M taker, − half-spread). q is chosen so the spot costs
  $1,000 / 1.1 with its fee; the other tenth stays as USDT in the futures wallet, where the spot is also held as
  Multi-Assets collateral (Binance's own mode; transfers are free).
* **Holding**: nothing until the contract's delivery day, whose 00:00 opens close it (SPQTR's exit: the quarterly's and
  spot's opens that day, eight hours before settlement): buy back the quarterly and sell the spot, same costs. On that
  same day the flat rule runs again; if it picks a contract, the spot is kept (no spot trades, no spot fees) and only
  the new quarterly is sold. A package open on 2026-09-25 is closed at that day's opens.
* **Marks**: at every day's open, equity = USDT + q × spot open + q × (quarterly entry − quarterly open). Idle capital
  earns nothing.

The window is the 1,363 days from 2023-01-01 to 2026-09-25. Halves by day: 2023-01-01 → 2024-11-12 and
2024-11-13 → 2026-09-25; the last twelve months: 2025-09-25 → 2026-09-25; P&L is counted on the day it accrues.
Capital $1,000; annualised = P&L / $1,000 × 365 / days.

## The bar (a PASS needs every condition)

1. Annualised return on the $1,000 over the window ≥ 8 %.
2. Circular block bootstrap of the daily P&L (30-day blocks, 10,000 resamples, seed `fp6-carry-quarterly`), H0 "the
   annualised mean ≤ 8 %": p = (1 + #{m*_b − m̂ ≥ m̂ − 0.08}) / (1 + 10,000), clearing its Holm step among the five.
3. Each half ≥ 4 % a year.
4. The last twelve months ≥ 4 % a year.
5. Condition 1 with every fee and half-spread doubled.
6. The best calendar month at most 40 % of the P&L, the rest positive.
7. Maximum drawdown of the daily marks at most 10 % of capital.

## Descriptive, not in the bar

* BTC under the same rule (seen, through SPQTR), and SPQTR's own rule (a $100 package every day the previous close basis
  is at least 100 bp) on ETH, annualised on the peak capital its overlapping packages tie up.
* The days held, the packages, the entry y's distribution, SOFR's mean over the window.

## Power check (`measurements.json` → `h2`)

* **Counts**: the rule opens 5 ETH packages (ETHUSDT_240329, _240628, _240927, _250328 and _251226) and holds them on
  568 of the window's 1,363 days: 299 of the first half's 682, 269 of the second half's 681, and 92 of the last twelve
  months' 365 (one package). It opens nothing in 2026. BTC under the same rule: 5 packages, 641 days (372, 269, 92).
* **What the bar needs, from the counts alone.** A package earns, to delivery, about its entry y (net of the 40 bp)
  on notional, which is capital / 1.1, and idle days earn nothing. So condition 1 needs the day-weighted mean entry y
  over the 568 held days to be at least 8 % × 1.1 × 1,363 / 568 ≈ 21 %; condition 3 needs ≥ 10.0 % in the first half
  and ≥ 11.1 % in the second; condition 4 needs the one package held in the last twelve months to have been entered
  at y ≥ 17.5 % (4 % × 1.1 × 365 / 92). The entry test guarantees only y ≥ 8 %.
* **Power**: a quarterly's return is fixed at entry up to the basis at the exit open (a few basis points), so the
  bootstrap's p will sit near 0 or near 1; the test is decided by the level of the basis on the days the rule held it,
  not by noise. There is no smaller effect for it to miss.

## Determinism, and what it cannot show

`score_carry.py` (phase 2) reads only `inputs/`, recomputes every count above from them and stops if one differs,
checks the sha256 of this file and of `rules.py`, writes `carry_quarterly.json` with sorted keys, fixed rounding and no
clock, and runs twice, byte-identical. It cannot show access, custody risk, or that Binance keeps listing quarterlies;
and a quarterly's return is fixed at entry, so this test measures how often and how richly the basis was worth taking,
which the future need not repeat.
