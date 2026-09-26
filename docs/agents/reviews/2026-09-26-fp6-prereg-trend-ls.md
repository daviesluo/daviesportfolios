# Pre-registration fp6-H4 TREND-LS: the live trend rule long AND short on Binance USDⓈ-M perpetuals

Written 2026-09-26 (UTC), before any return, fee, funding payment or P&L of a short leg — or of the long leg on
perpetuals — was computed on any window. Frozen by the commit that puts this file on `main`; nothing below may change
after it, and any deviation is reported as a deviation. It is hypothesis H4 of fp6's family of five
(`2026-09-26-fp6-prereg-family.md`), Holm-corrected across the five.

**Access comes first.** A perpetual is a derivative. For a UK-registered retail account the FCA bans firms from selling,
distributing or marketing crypto derivatives to retail clients (PS20/10, in force 2021-01-06; COBS 22.6.5R); Binance has
restricted UK users' derivatives since 2021–22 and has offered existing UK users no new product since 2023-10-16. For an
Irish-registered account, Binance has offered USDⓈ-M futures to "users in eligible regions" in Credits Trading Mode
since 2024, but told EU users it would stop providing its services from 2026-07-01 while it has no MiCA licence, and
what that leaves an Irish account is not public. The sources and their dates are in the family file
(`2026-09-26-fp6-prereg-family.md`). Nothing below says this account may trade the rule; it says whether the rule would
be worth it if it could.

## Why

The live row (`trend-4h-live`: BTC/ETH/SOL/AVAX, four equal slots, long only on Revolut X) loses in the sideways year,
window D (−7.81 % on the primary evaluation). A long-only trend rule sits in cash in a falling market and whipsaws in a
flat one. A short leg can earn in the first and may whipsaw worse in the second. The venue survey (§4) left exactly this
open: "run the symmetric version through `backtest.ts` on all four windows, with funding history as carry … before
opening any derivatives account". Davies said on 2026-09-26 that his Binance account supports futures. The question is
whether the same rule, long and short on perpetuals, would have been better.

## What was seen before the freeze (disclosed)

* Everything published about the long rule: reference §3.3a–§3.31, the incumbent's four windows and four evaluations
  (A +8.51 / B +25.05 / C +55.64 / D −7.81 % on the primary evaluation, `btc_regime.json`), the entries per coin
  (`btc_regime.json` `perCondition`), and §3.17/§3.21/§3.30 (entry gates help the year they sit out).
* In this session, counts only (`docs/agents/backtests/fp6/trend_ls.ts --stage counts`, output kept in
  `backtests/fp6/trend_ls_counts.json`, sha256 `fe966d60e4ce9f909430ffa300efa7771d849c7fc111628fa2baff7c44ed8c40`):
  with the short leg off, the decision code reproduces the incumbent's published
  entries in all 64 coin × window × evaluation cells (0 mismatches); with it on, the number of short entries, the bars
  held short and the short stops; and each coin's unconditional 4-hour volatility over each scored span. No price
  return of any trade, long or short, and no funding payment was computed.
* Binance's USDⓈ-M filters today (`inputs/exchangeinfo_2026-09-26.json.gz`): BTCUSDT's minimum order is $50,
  ETHUSDT's $20, SOLUSDT's and AVAXUSDT's $5; a limit order may sit at most 5 % from the mark (10 % on AVAX).
* Two BTCUSDT funding prints read while testing the endpoint on 2026-09-26: +0.0049 % and −0.0005 % per 8 h.

## Data

* **The tapes** are the house's, loaded by `backtest_jev.ts` `loadMeasuredSeries` exactly as §3.19–§3.30 load them:
  Coinbase Exchange hourly (`--data`), Kraken's quarterly OHLCVT bundle (`--ext`) spliced before it, and Kraken's own
  4-hour tape (`--ktape`). The copies used (sha256 of the file):

  | coin | `_1h_3y.json` (Coinbase) | `_1h_kraken.json` (bundle) | `_4h_kraken.json` (Kraken 4h) |
  |---|---|---|---|
  | BTC | c773e6ff…9d84 | 59d4c1fd…eea2 | a1109d82…34c9 |
  | ETH | 5d922a8b…8c85 | cc48c300…88dd | 614d5c26…1013 |
  | SOL | 8a23665b…9e4d | a0c55179…81f0 | 3fe74401…156c |
  | AVAX | 8713037a…f7cf | b4d01720…df2c | 99482cd1…fc3 |
  | SUI (loaded, not traded) | f0af6761…d5e4 | 9006035a…a3a3 | 033672f4…8186 |

  (full hashes in `backtests/fp6/manifest.json` under `tapes`). The phase-2 run refuses to start unless every hash
  matches and the incumbent's entries reproduce as they did here.
* **Funding**: every BTCUSDT, ETHUSDT, SOLUSDT and AVAXUSDT settlement from 2022-06-01 to 2026-09-25, from
  `data.binance.vision`'s monthly archive (each zip checked against its published sha256) and
  `www.binance.com/fapi/v1/fundingRate` for September 2026 (`inputs/funding.json.gz`).
* **Half-spreads**: the median of twenty `bookTicker` samples, 60 s apart, 2026-09-26 21:09–21:28 UTC
  (`inputs/books.json.gz`), half the full spread — one tick on each book: BTC 0.006, ETH 0.019, SOL 0.414, AVAX 0.467
  bps (`trend_ls.ts` `PERP_HALF_SPREAD`).

## Windows and evaluations

The house's: windows A (2025-09-10 → 2026-09-20), B (2024-08-31 → 2025-09-09), C (2023-08-22 → 2024-08-30) and
D (2022-08-22 → 2023-08-21), as `loadMeasuredSeries` cuts them per coin; evaluations `shipped·coinbase` (primary),
`shipped·kraken`, `trail·coinbase` and `trail·kraken` (`backtest_jev.ts` `CONDITIONS`). The seeded parameters only
(`DEFAULT_TREND`); nothing is chosen in sample.

## The rule (frozen in `docs/agents/backtests/fp6/trend_ls.ts`, sha256 `37fdb9c93d07296100f872be284d9f119c6122cc8683f1f5c309e204435ea9cc`)

* **Long leg**: the shipped rulebook exactly as `runGated` runs it — entry and rule exit at the next 4-hour open; the
  8 % floor under cost (plus 3 × ATR(14) under the high-water mark in the `trail` evaluations) read against the next
  bar's low; the two-bar cooldown after any exit.
* **Short leg (the mirror)**: flat, not cooling down, and the long rule not entering → short when the 4-hour trend is
  "down", the close is below the lowest low of the prior 55 bars, the 30-day momentum is not "positive", and the
  volatility is not "extreme". Exit at the next open when the trend is "up", or the close is above the prior 20 bars'
  highest high, or the close is 3 × ATR(14) above the low-water mark. Between closes the floor 8 % above the short's
  cost (plus 3 × ATR(14) above the low-water mark in the `trail` evaluations) is read against the next bar's high. The
  same two-bar cooldown after any exit. A coin is never long and short at once.

## Arms and accounting

* **INC** — the incumbent, long only at Revolut X's cost (`COSTS.revx`, `runGated`), reproduced to the published
  numbers before anything else is priced (a hard stop otherwise).
* **LS-PERP** — the hypothesis: both legs on Binance USDⓈ-M perpetuals, one slot per coin, capital = the slot, 1×
  (notional = the slot's cash at entry, as the incumbent's long is fully deployed).
* **L-PERP** (descriptive) — the long leg alone on perpetuals: separates the venue's cost and the long's funding from
  the short leg.
* **LS-MIX** (descriptive) — INC with the short leg added on perpetuals: the live row plus a Binance short leg, the
  short leg's contribution with the long leg left exactly as it trades. Not a design one account could run without
  keeping each slot's capital on both venues.
* **Costs on perpetuals**: 0.05 % taker a fill (USDⓈ-M regular tier, no BNB — Binance FAQ 360033544231, last updated
  2026-05-01) plus the half-spread above, on every entry, exit and stop.
* **Funding on every perpetual leg**: a leg filled at a bar's open and closed at a later bar's open holds each
  settlement whose bucket (its hour boundary) lies in (fill, exit]; it pays q × mark × rate when long and receives it
  when short (rates below zero reverse the direction). The mark is the evaluated tape's open of the 4-hour bar that
  starts at the bucket. The tape is a spot USD tape, not the perpetual's USDT price; the perpetual's basis to spot
  (a few basis points) is left out, and funding is the carry.
* **Short accounting** mirrors `runGated`: q = cash / (p_e × (1 + fee)) with p_e = open × (1 − hs); equity while short =
  cash / (1 + fee) + q (p_e − close) + funding received; the exit buys q at open × (1 + hs) (a stop at max(level, open)
  × (1 + hs)) and pays the fee.
* **The sleeve** is `backtest_jev.ts` `combine` over the four slots' daily returns (`dailyReturns` of each slot's
  4-hourly marks), as every house study builds it.

## The null (for C2)

For each evaluation, window and coin, take LS-PERP's short trades: their number K and their lengths in bars. A null
draw places K short episodes of those same lengths at start bars drawn uniformly, with replacement, from the bars at
which the coin is flat and not cooling down in L-PERP's run; a start whose episode would overlap a long or another null
short is drawn again (at most 10,000 tries, else the draw is dropped and counted). Each null short is priced exactly as a
short (costs, funding), with no stop and no rule exit: it closes after its length. The statistic is the short leg's
contribution to the sleeve summed over the four windows, S = Σ_w (LS-PERP's sleeve return − L-PERP's sleeve return)
in window w; the null gives S* from L-PERP plus the null shorts. p = (1 + #{S* ≥ S}) / (1 + draws), 2,000 draws per
evaluation, `mulberry32(seedOf("fp6-trend-ls", evaluation, draw))`. **H4's p for Holm is the largest of the four
evaluations' p.**

## The bar (ADOPT only if every condition holds)

1. **The worst window improves**: in each evaluation, LS-PERP's lowest window return (A–D) is strictly above INC's.
2. **The short leg's timing beats random shorting**: H4's p (above) clears its Holm step — the smallest p of the five
   hypotheses at 0.05 / 5, and so on up.
3. **The sideways year**: in each evaluation, LS-PERP's window-D return is strictly above INC's.
4. **No window pays beyond chance**: in each evaluation and window, the short leg's contribution is above the 5th
   percentile of that window's null contributions.
5. **Drawdown**: LS-PERP's sleeve drawdown is under 35 % in every window and evaluation (the house limit).

## Power check (counts only; `trend_ls_counts.json`)

Short entries on the primary evaluation: A 48, B 42, C 27, D 48 (165 in all; 165, 173 and 175 on the other three),
held 3,124 of 35,564 coin-bars (8.8 %; 2,390–3,016 on the others), a median of 16 bars (13 under the trail rule). 17
of the 165 end at the floor stop (13 on Kraken's tape); under the trail rule 158–161 of 173–175 end at a stop, because
the intra-bar trail fires first, as §3.13 found for the long. With each coin's unconditional 4-hour volatility in each
window (BTC 0.90–1.04 %, ETH 1.23–1.53 %, SOL 1.42–2.24 %, AVAX 1.57–2.17 % a bar) and random placement (each
episode's return SD taken as the bar SD × √length, a quarter of it reaching the sleeve), the null's standard deviation
of S is about 0.22 of the sleeve on the two `shipped` evaluations and 0.19 on the two `trail` ones, and about 0.10
(0.09–0.11) in one window alone.

* **The smallest effect the test can see** (80 % power at 0.05 / 5 one-sided): S of about 0.60–0.69 — the short leg
  beating random shorting by about 1.4–1.7 % of its slot a trade, on average over 165–175 trades.
* **In window D alone** the null's SD is about 0.10–0.11 of the sleeve, so only a short leg adding 31–36 points to D
  is visible there. Conditions 1 and 3 compare returns directly and need no null; condition 4 is one-sided at 5 %.
* So a pass means a strong, stable short edge; a failure of condition 2 means no large timing edge — it does not rule
  out a short leg that helps D by a few points, which only conditions 1 and 3 can show, and those are not tested
  against chance.

## Determinism

The phase-2 scorer (`backtests/fp6/score_trend_ls.ts`) imports `simulate`, `shortEntry`, `shortExit`,
`PERP_HALF_SPREAD` and `SYMBOLS` from `trend_ls.ts` unchanged, `runGated`, `combine`, `dailyReturns`, `CONDITIONS`,
`stopsOf`, `loadMeasuredSeries`, `seedOf` and `mulberry32` from `backtest_jev.ts`, and `COSTS` from `backtest.ts`. It
checks the hash of this file, `trend_ls.ts`, the tapes and `funding.json.gz` before it prices anything; stops unless INC
reproduces the published returns and entries in all four evaluations and windows, and unless its own long leg, run
with the short leg off at Revolut X's costs, gives INC's marks bar for bar; writes `backtests/fp6/trend_ls.json` with
sorted keys, fixed rounding and no clock; and runs twice, byte-identical.

## What it cannot show

* **Access.** See the top. A pass would not make it legal for this account.
* **Size.** BTCUSDT's $50 minimum order means the live row's $25 slot cannot short BTC at all; the arm needs at least
  $50 a slot (a $200 row).
* **The perpetual's own price.** The fills are the spot tapes' opens; the perpetual trades a few basis points away,
  and in a crash its mark can gap from spot. Liquidation is not modelled: at 1× a short is liquidated only near +100 %,
  far beyond the 8 % floor.
* **A small edge.** See the power check.
* **Binance's price limits.** An order priced more than 5 % from the mark (10 % on AVAX; `PERCENT_PRICE`,
  `marketTakeBound`) is refused or cut, so a stop in a gap can fill worse than the level, or not at once.

## What follows

A pass makes TREND-LS a candidate for a paper twin on Binance's public data only, under a paper spec of its own, and
only if the access question is answered first. A failure closes the symmetric trend rule: "no large short-leg edge",
with the worst-window comparison reported for what it says about window D.
