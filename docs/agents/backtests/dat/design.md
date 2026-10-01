# DAT: design, fixed before any statistic relates a predictor to a future return

Written 2026-10-01, finished 04:07 UTC, by the DAT research agent, before any price was pulled. Nothing below was chosen
after looking at a relation between mNAV (or anything else) and a later return. Every screen script records this
file's sha256 in its output, so a later edit shows. Davies' question (2026-10-01): "另外关于美股研究可不可以深入研究下mstr和
比特币之间，还有bmnr和以太坊之间的套利机会或者其他类似的？有希望吗？"

## 1. Split, fixed now

* **SCREEN**: from MSTR's first bitcoin purchase, announced in an 8-K accepted 2020-08-11 11:12:54 UTC (07:12 ET,
  before the open), so the first mNAV is the close of **2020-08-11**, to the close of **2024-12-31**. A screen
  statistic that uses a return over h days uses only predictors at t with t + h ≤ 2024-12-31: no return after
  2024-12-31 enters any screen number. Price pulls for the screen request period2 = 2024-12-31 23:59:59 UTC (Yahoo)
  and end = 2025-01-01 00:00 UTC (Coinbase); every reader also cuts at 2024-12-31 as it parses and asserts that no
  later row survives.
* **HELD-OUT**: 2025-01-02 → the latest close. Not looked at for any predictor-to-return relation. Its pull script
  (`scripts/pull_heldout.py`) is written but not run by this study.
* **BMNR** (an ether treasury since mid-2025) lies wholly in the held-out years and is too short for a split:
  descriptive only. It is described only after the MSTR screen's verdict is written down (§8), and if any MSTR
  candidate survives, only levels (no return after a predictor) are computed for BMNR and for the "similar" events.

## 2. Definitions

Day t is a row of Yahoo's daily MSTR bars (Nasdaq). All prices in USD.

* **P_t**: MSTR's close, split-adjusted (Yahoo v8 chart `close`; MSTR paid no common dividend in the screen; the 10-for-1
  split of 2024-08-08 is adjusted by Yahoo). **O_t**: MSTR's official open.
* **B_t**: BTC-USD at the US close of day t: the close of Coinbase Exchange's 15-minute candle that ends at 16:00 ET
  (13:00 ET on the NYSE early-close days in the screen: 2020-11-27, 2020-12-24, 2021-11-26, 2022-11-25, 2023-07-03,
  2023-11-24, 2024-07-03, 2024-11-29, 2024-12-24). **B°_t**: BTC-USD at 09:30 ET (the candle ending then). A missing
  candle takes the last close before it.
* **H_t** (coins held): the latest holdings statement published before 16:00 ET on day t (the US close). Sources: SEC
  filings (8-K, 10-Q, 10-K and the EX-99 press releases filed with 8-Ks), by EDGAR acceptance time; and the three press
  releases with no filing that day (2020-12-21, 2021-02-24, 2021-06-21; `notes/sources.md`), taken as known before
  that day's close (sensitivity: one day later). A statement's as-of date can precede its publication; publication is
  what counts.
* **N_t** (shares, basic): class A + class B. Point in time: the latest 10-Q/10-K cover count published before 16:00
  ET on t, plus the at-the-market (ATM) shares sold that 8-Ks published after the cover's count date and before 16:00
  ET on t report. Counts dated before 2024-08-08 are multiplied by 10 (the split). Conversions of notes and option
  exercises between covers are not tracked (the cover-to-cover residual is reported). **Diluted** counts (in-the-money
  convertibles as shares) are not used as a predictor; the EV-based measure carries the convertibles at par instead.
* **D_t** (debt): principal outstanding, from an instrument table built from the 8-Ks that announced each closing
  (items 1.01/2.03) and each redemption or repayment, each instrument counted from the publication of its closing to
  the publication of its retirement. **Pref_t**: preferred liquidation preference; MSTR had none before 2025.
  **C_t**: cash and cash equivalents, the latest quarter-end XBRL value (`CashAndCashEquivalentsAtCarryingValue`)
  published before t.
* **mNAV simple** = P_t N_t / (H_t B_t). **mNAV EV** = (P_t N_t + D_t + Pref_t − C_t) / (H_t B_t).
  The software business is in neither denominator (both measures overstate the premium on the coins by its value).
* **x_t** = log mNAV simple (the **primary** predictor); **x^EV_t** = log mNAV EV (secondary, reported beside it, not
  a second chance to pass).
* **Relative return** over h trading days: d_{t,h} = [log P_{t+h} − log P_t] − [log B_{t+h} − log B_t].

## 3. Hypotheses and statistics (screen)

**H1, does the premium predict MSTR against BTC?** d_{t,h} = a + β x_t + e_t, h = 20 and 60 trading days;
the hypothesis is β < 0.
* Non-overlapping: t = first screen day, then every h days, with t + h ≤ 2024-12-31. OLS β̂ and its t; the mean of β̂
  over the h possible starting offsets is reported beside it.
* Overlapping daily: OLS β̂ with a Newey-West (Bartlett) standard error at lag 2h.
* **Stambaugh**: on the non-overlapping sample, x_{k+1} = μ + ρ x_k + v_{k+1}. Bias-corrected slope
  β_c = β̂ + (σ̂_uv / σ̂_v²)(1 + 3ρ̂)/n (Stambaugh 1999, first order; u the return residual). The p-value is a null
  bootstrap: β = 0, x simulated as an AR(1) at the Kendall-corrected ρ_c = ρ̂ + (1 + 3ρ̂)/n (capped at 0.999), the
  innovations (û, v̂) resampled as pairs, 10,000 draws, `numpy.random.default_rng(20261001)`; p = share of simulated β̂
  at or below the observed β̂ (one-sided). The family is H1 at 20 and 60 days on x (Holm, α = 0.05). x^EV is reported
  with the same statistics and must carry the same sign; it cannot rescue a fail.

**H2, a long-only switch.** At the close of t: w_{t+1} = 1 (hold MSTR) if x_t ≤ the median of x over the trailing 252
trading days [t−252, t−1] (expanding from 126 days until 252 exist), else w_{t+1} = 0 (hold BTC). Executed at the next
open: both legs at 09:30 ET of t+1 (MSTR's open, BTC's 09:30 price), held open to open. The BTC leg stands for a
London-listed bitcoin ETN in the USD Invest account (none was sold to UK retail before 2025-10-08; the screen uses
spot as its proxy, less the ETN's fee).
* **Costs**, Trading 212 Invest (USD primary): MSTR in USD (no FX, no commission, spread about 1-3 bps a side, used
  2.5); the ETN on its GBP line (IB1T, FBTG, BTCX are GBP; WXBT GBp), so every switch pays one 0.15 % FX conversion,
  plus an ETN half-spread (assumed 10 bps, unmeasured) and MSTR's half-spread: **30 bps a switch, central; 60 bps,
  stress**; plus the ETN's fee while in BTC (0.15 % a year, IB1T's waived rate to 2026-12-31; 0.25 % after). The
  cross-venue variant (BTC on a separate Revolut X sub-account, never the loop's own): 9 bps taker, Revolut's FX
  (0-1 %), Trading 212's 0.15 %, and up to three business days uninvested on each Trading 212 withdrawal; priced as
  100 bps a switch and a three-day lag on switches out of MSTR.
* **Benchmarks**: hold BTC (the ETN, its fee paid), hold MSTR, and the static mix with the switch's average MSTR
  weight, rebalanced daily (the switch's timing value is its return over that mix).
* **Statistics**: annualised return of each, net; the switch's daily excess over each benchmark with a Newey-West t
  (lag 10); **timing skill**: the mean open-to-open relative return (MSTR − BTC) on w = 1 days minus that on w = 0 days,
  with a Newey-West t (lag 10); number of switches. Robustness, reported not selected: trailing 126-day median; trailing
  252-day 25th percentile; x^EV in place of x.

**H3, long BTC and short MSTR when the premium is high**, run only because a short MSTR position exists for UK retail
as a CFD (Trading 212 lists an MSTR CFD; FCA rules: 5:1 on single equities, 50 % margin close-out). Davies has no CFD
account and the financing of Trading 212's MSTR CFD is shown only in its app, so H3 is a screen with an assumed
financing. At the close of t: in (long the BTC ETN and short MSTR, equal notional) if x_t ≥ the 75th percentile of x
over [t−252, t−1], else flat; next open to next open. Short financing, IG's published shape as the reference:
(3 % − RF) a year when positive, plus a 0.5 % borrow charge, credited RF − 3 % when RF > 3 % (RF: Ken French's daily
one-month T-bill, cut at 2024-12-31); CFD spread 10 bps a round trip; the long leg's ETN costs as H2; the margin cash
(20 % of notional plus an equal buffer) earns nothing. Reported: annualised return on the margin posted, its Newey-West
t, the worst peak-to-trough loss of the pair against the margin, and the number of days the 50 % close-out would have
fired without the buffer.

**H4, BTC overnight → MSTR at the open (exploratory).** i_t = log(P_t / O_t) (MSTR open to close) and
i_t − log(B_t / B°_t) (against BTC over the same hours) regressed on BTC's overnight move n_t = log(B°_t / B_{t−1});
Newey-West lag 5. The gap g_t = log(O_t / P_{t−1}) on n_t is reported as a description. A non-zero slope on i_t would
mean the opening auction under- or over-reacts to BTC's night. Whether it is tradable for this account is §6's.

**Descriptive, screen only**: the decomposition of mNAV's change over h days into the relative return and the
issuance term Δlog N − Δlog H (how the premium closes: through the price or through the company issuing at a premium);
the level and dispersion of x and x^EV; the daily AR(1) of x and its half-life.

## 4. What counts as surviving the screen

A candidate survives only if all hold:
1. **H1**: β_c < 0 and its Holm-adjusted bootstrap p ≤ 0.05 at 20 or 60 days, with x^EV of the same sign;
2. **H2 or H3 makes money**: at the central cost, the switch beats the static mix with its own average weight and the
   timing skill's t ≥ 2.0 (H2); or H3's return on margin > 0 at the assumed financing with t ≥ 2.0;
3. **a mechanism**: named a priori in §5, not inferred from the result;
4. **power ≥ 0.5** for the held-out test it implies (§6), at an economically meaningful effect.
If none survives, no pre-registration is drafted, and the study says so with the power numbers.

## 5. Mechanism, stated before looking

mNAV is not bounded by arbitrage: there is no creation or redemption, so no one can deliver coins for new shares or
shares for coins at NAV. The only forces that pull the premium toward 1 are the company's own actions (ATM issuance and
convertibles at a premium, which buy coins and lower mNAV by construction; buybacks, coin sales, tenders or a
liquidation at a discount) and investors' willingness to hold. A short-seller can bet on the premium, but there is no
convergence date, the borrow can be recalled, and the premium can widen without bound (closed-end fund literature:
Lee, Shleifer & Thaler 1991; limits to arbitrage: Shleifer & Vishny 1997; discounts close at open-ending events). So a
premium can mean-revert through issuance while the price never "corrects", and only the part that goes through the
price is a return to an investor. The hypothesis of H1-H3 is that some of it goes through the price.

## 6. Power, planned before looking

* Persistence: the daily AR(1) of x and its half-life ln 0.5 / ln ρ; the effective number of independent observations
  of a persistent mean, T(1 − ρ)/(1 + ρ), and T / half-life, both reported.
* Stambaugh bias of β̂ for the screen's and the held-out's non-overlapping sample sizes.
* The held-out test it would propose: the H1 regression at 20 and 60 days on 2025-01-02 → 2026-09-30 (about 438
  trading days: 21 and 7 non-overlapping observations), and H2's timing skill. Power by Monte Carlo at the screen's
  estimated σ_u, σ_v, ρ and corr(u, v), at three effect sizes: the screen's bias-corrected β_c, a **large** effect
  (one screen-SD of x moves the 60-day relative return by 10 %) and a **moderate** one (5 %).
* **What was seen before** (disclosed, from general knowledge to mid-2026): MSTR's premium was high in early 2021, its
  simple mNAV fell below 1 at times in 2022, it rose through 2024 to a peak around November 2024, and it compressed
  during 2025 toward about 1; MSTR rose far more than BTC over 2020-2024 and fell far more than BTC in the second half
  of 2025 as the treasury-company wave of mid-2025 reversed; several treasury companies traded below their holdings in
  late 2025 and 2026. So a held-out test of "a high premium predicts underperformance" on 2025-2026 has an outcome the
  drafter largely knows: a pass there is weak evidence, a fail a real fail. The screen years are not unseen either:
  the screen is exploration. Only a forward test from 2026-10-01 is clean, and §6's numbers say how long it would take.

## 7. Accessibility, per account (sources in `notes/sources.md`)

| Account | MSTR | BTC leg | Short MSTR | Notes |
|---|---|---|---|---|
| Trading 212 Invest (USD) | yes, USD, no FX | London bitcoin ETNs after the approval steps; GBP lines (0.15 % FX a conversion) | no (Invest is long-only); the -3x daily short MSTR ETP (SMST, GBp) is holdable but decays at about (k² − k)σ²/2 = 6σ² a year | API: orders only in the primary currency, not idempotent, no client order id |
| Trading 212 Stocks ISA (GBP) | yes, 0.15 % FX each way | none: no new cETN purchase since 2026-04-06 (HMRC); Trading 212 offers no IFISA | no | — |
| Trading 212 CFD (not held) | CFD | — (crypto CFDs banned for UK retail) | MSTR CFD listed; financing shown in-app only | a separate account; the API does not serve it |
| Revolut X | — | spot, but the account is the live loop's alone: never traded by hand | — | a new sub-account would be Davies' |
| Kraken / Binance / Deribit | — | Kraken signal only; Binance, Deribit unfunded | crypto derivatives banned for UK retail | — |

## 8. Order of work

1. Pulls: SEC filings to 2024-12-31 (done before this file), MSTR and BTC prices to 2024-12-31, RF cut at 2024-12-31.
2. Build the point-in-time mNAV series (levels only) and check it against the filings.
3. Run H1-H4 and the descriptive decomposition on the screen; each output records this file's sha256.
4. Power (§6). Write down the verdict.
5. Only then: BMNR (descriptive) and the "similar" events (discount-closing actions, 2025-2026, from public sources).
6. Only if a candidate survives §4: draft the pre-registration and its scorer; never run on held-out data.
