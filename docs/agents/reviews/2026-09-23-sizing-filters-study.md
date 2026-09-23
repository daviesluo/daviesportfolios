# Sizing and entry filters for trend-4h: a pre-registered study (2026-09-23)

Three ideas from the Binance and Deribit research, priced on the row
recommended for live before any of them could reach it. **All three fail
the project's bar; the live row stays as it is.**

- Pre-registration: [`2026-09-23-sizing-filters-prereg.md`](2026-09-23-sizing-filters-prereg.md),
  frozen at 03:04:07 UTC before any arm ran (sha256 at freeze
  `9deb30e6c529e0ab…`); one dated correction below it changes a date
  label and no definition.
- Script: `supabase/functions/agents/backtest_sizing.ts`, which imports
  `backtest_jev.ts`'s machinery (exported for it, with the data loader
  lifted into `loadMeasuredSeries`; nothing else changed, and the committed
  `jev_v2.json` re-runs byte for byte, sha256 `672ae9a2…`).
- Result: `docs/agents/backtests/sizing.json`, sha256
  `197b3585dd44b873e2a644855ee909cd3184526def4ccade68553965e8c76b08`, written
  identically by the study's two runs and by the main session's independent
  re-run on the committed tree.
- Inputs added for it: `docs/agents/backtests/inputs/deribit_dvol_1d_2026-09-23.json`
  (Deribit's public DVOL, daily, BTC and ETH from 2021-03-24, sha256
  `30bfd643…`) and `binance_funding_daily_2026-09-23.json` (Binance's public
  USDⓈ-M funding files, summed per UTC day, to 2026-08-31, sha256 `a5c25f58…`).

## The incumbent

`trend-4h` on Revolut X, BTC/ETH/SOL/AVAX/SUI, five equal $20 slots,
seeded parameters, Revolut X's costs, on windows A (bear), B (bull),
C (strong bull) and D (sideways), under the four evaluations of §3.19
(Coinbase-spliced tape and Kraken's own 4h tape × the shipped 8 % floor and
the retired 3×ATR trail). Rebuilt from `backtest_jev.ts`'s exported code, it
equals `set2.json`'s `equal` row on all 16 cells and the published sleeve:
A +8.03 / B +20.08 / C +55.64 / D −7.81 %, worst |Δ| 0; `runGated` equals
`run` on 72 cells.

## The three hypotheses

- **H1, volatility-sized slots.** Each entry deploys f = min(1, 0.7405 / vol)
  of its $20, where vol is the coin's 30-day realised volatility at the
  entry. The target is the median of that measure pooled over the five coins
  in window A's in-sample span, fixed from volatility alone. Null: the same
  sizing driven by the coin's own volatility 365–730 days earlier (2,000
  draws).
- **H2, a DVOL gate.** Refuse an entry when DVOL (BTC's for every coin but
  ETH, which uses its own) is in the top third of its trailing 365 days on
  the last closed day. Null: refuse the same number of entries at random,
  by whole breakout episodes (1,000 draws with the entry count matched
  exactly).
- **H3, a funding gate.** Refuse an entry when the coin's 7-day Binance
  perpetual funding is in the top fifth of its trailing 365 days. Same null.
  Funding data ends 2026-08-31, so H3 is judged on B, C and D only.

**The bar**, the same for all three: in each of the four evaluations, the
arm's worst window beats the incumbent's, and beats the null's 95th
percentile there.

## Results

Each cell: incumbent / arm / the null's 95th percentile, return in %.

**H1**

| | shipped·cb | shipped·kr | trail·cb | trail·kr |
|---|---|---|---|---|
| A | +8.0/+8.5/+9.2 | +9.2/+8.8/+8.8 | −0.3/−0.0/+0.9 | +6.5/+6.0/+5.8 |
| B | +20.1/+18.9/+21.7 | +22.5/+21.3/+24.0 | +12.6/+11.4/+14.7 | +13.8/+12.7/+15.8 |
| C | +55.6/+50.2/+50.8 | +50.9/+46.1/+46.9 | +47.1/+42.5/+41.4 | +38.3/+33.6/+33.7 |
| D | −7.8/−6.5/−4.1 | −7.8/−6.5/−4.1 | −3.2/−2.0/−0.5 | −3.2/−2.0/−0.6 |

The worst window (D) beats the incumbent in all four evaluations, but the
placebo does as well or better in 59 / 60 / 34 / 41 % of draws. A second
null that keeps the arm's own multipliers and shuffles their timing
(reported only) also fails: 0.11 / 0.11 / 0.07 / 0.08. Only 5–22 entries a
window were scaled (mean f 0.95–0.99); the smallest order was $11.54, far
above Revolut X's $0.10 minimum. Drawdown falls 0–1.2 points, idle capital
rises 0–0.8 points, and D's Sharpe goes from −0.69 to −0.59.

**H2**

| | shipped·cb | shipped·kr | trail·cb | trail·kr |
|---|---|---|---|---|
| A | +8.0/+11.4/+11.0 | +9.2/+11.6/+11.4 | −0.3/+3.4/+3.1 | +6.5/+9.5/+9.4 |
| B | +20.1/+21.7/+24.6 | +22.5/+24.0/+26.7 | +12.6/+18.8/+18.4 | +13.8/+19.5/+19.0 |
| C | +55.6/+41.7/+53.6 | +50.9/+35.2/+50.4 | +47.1/+32.1/+39.0 | +38.3/+23.7/+31.6 |
| D | −7.8/−7.8/−7.8 | −7.8/−7.8/−7.8 | −3.2/−3.2/−3.2 | −3.2/−3.2/−3.2 |

D is untouched: the gate refused none of its entries (BTC's gate was on for
9 of 397 days in D and ETH's for 36, with no entry on any of them, checked
by a separate recomputation), so the worst window cannot improve and H2
fails in all four evaluations.

**H3**

| | shipped·cb | shipped·kr | trail·cb | trail·kr |
|---|---|---|---|---|
| A | not judged | not judged | not judged | not judged |
| B | +20.1/+22.0/+24.8 | +22.5/+22.7/+26.9 | +12.6/+19.5/+18.1 | +13.8/+19.4/+19.1 |
| C | +55.6/+41.0/+55.1 | +50.9/+41.1/+50.7 | +47.1/+28.0/+41.2 | +38.3/+18.8/+30.5 |
| D | −7.8/−1.8/+1.8 | −7.8/−1.8/+1.9 | −3.2/+2.8/+3.7 | −3.2/+2.8/+3.2 |

D beats the incumbent in all four evaluations (on the primary it refuses 12
of 32 entries and drawdown falls from 15.5 % to 5.9 %), but refusing the
same number of entries at random does as well or better in 34 / 34 / 7.4 /
5.6 % of draws.

## Verdicts

- **H1 fails, H2 fails, H3 fails.** Return over drawdown, reported beside
  each and never deciding, fails too (its best cell 0.038, with all four
  evaluations required).
- Three hypotheses were tested; the lowest deciding p is 0.056, against a
  Bonferroni family level of 0.0167.
- This is the fourth pricing of per-entry volatility scaling here (§3.10,
  §3.11, §3.19), and H2 and H3 join §3.17's 33 entry gates. None has cleared
  the bar.

## What follows, and what does not

- No change to the live row: equal $20 slots, no DVOL gate, no funding gate.
- H1 is a small dial: +1.2 to +1.3 points in D, −1.1 to −5.4 in B and C.
- H3 repairs the sideways year by holding less, §3.17's finding again, at
  9.8–19.5 points of C, and random refusal matches it.
- It does not follow that DVOL or funding carry no information: H2 beat its
  null in window A in all four evaluations (p 0.030–0.042), but one window
  is what §3.15 found predicts nothing. H3's bear year becomes priceable
  once Binance publishes September's file. A new threshold would be a new
  hypothesis, not a tuning of this one. The Jev gate is outside these runs.

## Reproduce

From the repository root, with the three tape directories every study since
§3.15 has used (about 18 minutes on one core):

```
deno run --allow-read --allow-write supabase/functions/agents/backtest_sizing.ts \
  --data <dir with BTC-USD_1h_3y.json …> \
  --ext <dir with BTC-USD_1h_kraken.json …> \
  --ktape <dir with BTC-USD_4h_kraken.json …> \
  --dvol docs/agents/backtests/inputs/deribit_dvol_1d_2026-09-23.json \
  --funding docs/agents/backtests/inputs/binance_funding_daily_2026-09-23.json \
  --set2 docs/agents/backtests/set2.json \
  --out docs/agents/backtests
```

`--stage definitions` prints the incumbent's reproduction, H1's target, the
gates' coverage and the placebo donors, and writes nothing.
