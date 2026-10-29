# RX-USDC: the rules for a £120 live book on Revolut X's USDC-GBP alone (2026-10-29)

Davies, 2026-10-29 ~22:05 UTC: "我也不想完全放弃revolut x的usdc盘，你用最新的"Stablecoin quotes USDT/GBP"的rules+之前测试的与coinbase价格联动的那个
优化（具体我忘了，你也可以再仔细研究下还有没有针对revolut x的usdc盘做出的优化选择，确保最终上线的策略一切最优）也上线一个revolut x的Stablecoin quotes
USDC/GBP 策略，账户api用之前叫你退役的那个trend 4h的api，我把那个账户改为了120磅…同时testing列表中Stablecoin quotes USDT/GBP LIVE twin底下也做一个
usdc的twin". Every record was read (no no-peek rule since 2026-10-04); not blind.

## Verdict: LIVE's rules with no 0.3 % rung and every exit a tick beyond fair; not the Coinbase nudge

- **Recommended rule set** (the build, `QUOTE_RXU_INSTANCE`): LIVE's rules as they run (PR5's paper engine's decisions, LIVE's
  fills, the £1 holding line, the weekend quoting from LIVE's weekend replica, exits meeting the book) on USDC-GBP alone, with
  **the 0.3 % rungs quoting nothing** (`weights.k` 1 / 1 / 0: £30 on each 0.1 % and 0.2 % rung at £120) and **every exit a
  tick beyond fair** (`exitOffset` 1). Against LIVE's rules on the same book at £120, since 09-01: **+11.5 % a year
  [80 % +8.6, +14.5], P(≤ 0) 0.000, 44 days ahead and 8 behind**; out of sample +14.2 (P 0.000); last 30 days +13.8 (P 0.000).
  Its own figure: **36.3 % a year since 09-01** [80 % 28.4, 44.6] after the live haircut (LIVE's rules on the book: 24.8).
- **The Coinbase nudge is not in it.** On the longest data it loses: −2.1 % a year since 09-01 at £120 (P(≤ 0) 0.83, 18 days
  ahead, 32 behind), −1.3 out of sample (P 0.80), −1.8 over the last 30 days. It wins only on the 18 days Coinbase's touch was
  recorded (10-11 → 10-29, REVX-FAIR's own window): +4.4 (P 0.06). Before 10-10 the replay's Coinbase price is a last print a
  minute, not a touch, which weakens the long test, but the result is not "basically certain positive"; with the two rules
  above it lowers the gain since 09-01 (+9.3 against +11.5). `n600nudge` (variant-5) keeps measuring it on both books.
- Nothing else helps: the holding line at £0.50 or £2 changes nothing (±0.0); dropping the weekend quoting costs −8.3 % a
  year (P 1.00).

## 1. The replay (`backtests/compare/revx/scripts/rx_usdc.py` → `results/rx_usdc.json`)

STRATEGY-COMPARE's method unchanged (the PR5-OPT engine, every Revolut X UK print since USDC-GBP's listing on 2025-11-26, LIVE's
"at" fill, the weekend on the held X, days marked to market, the live haircut of `results/haircut.json`), on USDC-GBP alone, six
rungs (capital ÷ 6) unless the arm says otherwise, the £1 line in every arm. Each arm paired by day with LIVE's rules on the
book ("base"): mean difference, % a year on capital, circular 3-day block bootstrap (10,000, seed 20261029), P(≤ 0), days
ahead / behind.

**£120** (base: 24.81 % a year since 09-01 [19.5, 30.4], 33.3 out of sample, 27.2 the last three months; 4.3 trips a day,
12.3 bps a trip):

| arm | since 09-01 (55 d) | out of sample (167 d) | last 30 d | touch days (18) | its % a year since 09-01 |
|---|---|---|---|---|---|
| nudge | −2.08, P 0.83, 18 / 32 | −1.28, P 0.80 | −1.80, P 0.65 | +4.36, P 0.06 | 22.7 |
| x1 (exit +1 tick) | +0.94, P 0.088, 38 / 9 | +2.29, P 0.005 | +0.60, P 0.30 | −0.17 | 25.7 |
| no03 | +10.26, P 0.000, 42 / 7 | +11.21, P 0.000 | +13.11, P 0.000 | +13.63 | 35.1 |
| **x1 + no03** | **+11.50, P 0.000, 44 / 8** | **+14.18, P 0.000** | **+13.77, P 0.000** | +13.18 | **36.3** |
| nudge + no03 | +7.37, P 0.002 | +11.64 | +10.88 | +20.03 | 32.2 |
| nudge + x1 + no03 | +9.29, P 0.000, 32 / 20 | +14.47 | +12.81 | +21.82 | 34.1 |
| k1 (0.1 % rungs alone, £60) | +13.29, P 0.000, 36 / 13 | +13.37 | +13.10, P 0.002 | +22.02 | 38.1 |
| x1 + k1 | +13.69, P 0.001, 38 / 14 | +17.34 | +10.99, P 0.039 | +17.60 | 38.5 |
| holding line £0.50 / £2 | 0.00 / −0.01 | −0.27 / +0.01 | 0.00 / −0.02 | 0.00 / −0.03 | 24.8 / 24.8 |
| no weekend | −8.29, P 1.00 | −7.19 | −12.90 | −7.93 | 16.5 |

**£600** (for reference; base 18.94): x1 + no03 +7.83 (P 0.000), no03 +7.52, nudge + x1 + no03 +8.37, k1 +6.01 (P 0.014),
nudge −1.23 (P 0.78), x1 +0.36 (P 0.29), no weekend −6.17.

**Why no 0.3 % rung and not the 0.1 % rung alone.** All the capital on the 0.1 % rungs (k1) is about as good at £120 (+13.3
against +11.5 since 09-01) but it is noisier (13 days behind against 8, the last 30 days +11.0 with x1 at P 0.039) and clearly
worse at £600 (+6.0 against +7.8): one rung a side at £60 leans on the size of the prints that reach it. No 0.3 % keeps two
rungs a side and wins at both sizes; the margin between the two at £120 is inside their noise.

**Why the 0.3 % rung costs so much at £120.** It fills least, and its pounds are idle while the inner rungs, which fill most
often, are capped by their size: at £20 a rung most prints that reach the 0.1 % rung are larger than it. Moving the 0.3 %
rung's pounds inward is a bigger rung where the fills are.

## 2. The account, the venue and the comparison

- The account is the sub-account the retired trend loop traded (`Revolut_X_API_kEY` / `REVOLUT_X_PRIVATE_KEY`, the
  function's `REVX_KEY_NAMES.revx`; not PR5's `_2`), which Davies set to £120 (his word; the probe reads the balance before
  the go). USDC-GBP's minimums (£0.10, 0.00001 USDC) leave a £30 rung far above them.
- It compares with LIVE's USDT-GBP book (`Stablecoin quotes USDT/GBP`, same venue) and with Coinbase's USDC-GBP live executor
  (`Stablecoin quotes USDC/GBP` on Coinbase, "with Euros - 2"'s rule at £20 a rung): three books of one rule family, each on
  its own account.

## 3. What it means

Phase B builds it as `QUOTE_RXU_INSTANCE`, dry-run and unarmed, with the rules above; its twin "Stablecoin quotes USDC/GBP
LIVE twin" runs the same rules at £120 on paper. Davies arms it. **A finding beside the brief:** the 0.3 % rung's cost is large
on USDC-GBP at £20 a rung; `n600no03` (variant-3) measures the same rule on LIVE's USDT-GBP at £100 a rung, and no study here
priced it on LIVE's book.
