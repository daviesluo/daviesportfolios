# Pre-registration FUND: funding crowding as a BTC spot trade at Revolut X's costs

Written 2026-09-26 (UTC). No return of this trade has been computed on any day of the two windows it is judged on.
Frozen by the commit that adds this file; nothing below may change after it, and any deviation is reported as a
deviation. It trades nothing, arms nothing and changes nothing that runs.

## Why

fp5's Binance search froze eight funding rules on 2026-09-25 and screened them on 2023 only. Two read BTCUSDT's
perpetual funding and passed: **UZERO**, the last settled funding rate is below zero, and **USOFR**, it is below the
eight-hour SOFR carry. Each bought the USD-M perpetual at the daily open and held it two days. Both were set aside
before any later year was scored (§3.369 on that branch: neither could say how many basis points cheap the price paid
was), and this account could not trade them anyway: it holds spot, long only, on Revolut X. The fp5 review
(`2026-09-26-fp5-review.md`, item 3 of what is worth running) keeps what is left of them: the same two signals as a
BTC spot long at Revolut X's cost, on data no test of them has used.

The idea: when funding is negative, or below what cash earns, shorts are paying longs to keep their positions. Shorts
are crowded. If a crowded short is squeezed more often than it is right, BTC does better in the 48 hours after such a
day than on other days. This file fixes how that is tested. The signals are the frozen ones, word for word. Only the
trade changes.

## What was seen before the freeze (disclosed)

* **fp5's 2023 screens of all eight funding rules** (the Binance branch, tip `b348842e`; rules frozen at `24e60b7a`
  before any return). Each rule bought its own contract's daily open for two days on every signal day, the spans
  overlapping, 10 bp a side, funding cash not added. The "edge-off" trade is the same hold on the days the signal was
  off.

  | Rule | Contract | Signal days | Mean net | Edge-off mean (days) | That null's p95 | Screen |
  |---|---|---:|---:|---:|---:|---|
  | UZERO | BTCUSDT perpetual | 36 | +154.58 bp | +23.87 bp (328) | +84.35 bp | pass |
  | CZERO | BTCUSD_PERP | 37 | +148.19 | +25.20 (321) | +100.55 | pass |
  | EZERO | ETHUSD_PERP | 40 | +77.26 | +15.01 (318) | +91.03 | fail |
  | BZERO | BNBUSDT | 102 | −13.03 | +3.48 (262) | +39.62 | fail |
  | USOFR | BTCUSDT perpetual | 126 | +85.97 | +10.77 (238) | +43.45 | pass |
  | CSOFR | BTCUSD_PERP | 76 | +78.01 | +27.11 (282) | +81.49 | fail |
  | ESOFR | ETHUSDT | 120 | +28.82 | +17.07 (244) | +53.78 | fail |
  | MSOFR | ETHUSD_PERP | 84 | +86.50 | +2.18 (274) | +43.36 | pass |

  That null drew without replacement and treated overlapping spans as independent, so it is narrower than it
  should be. The fp5 review's summary of the three that stand well clear of their edge-off trade (UZERO +154.6
  against +23.9, USOFR +86.0 against +10.8, MSOFR +86.5 against +2.2) was read too, as were the branch's pre-freeze
  span counts (§3.360 there), its §3.369, and the protocols and scripts quoted below. No file on the branch scores
  any of the eight outside 2023: their only outputs are `backtests/fp313/` … `fp320/screen_2023.json`. The branch
  also screened some twenty other funding-derived rules on 2023 alone (§3.132–§3.252 there: the day's funding range,
  its jump, its curvature, a sign change on the coin-margined book, and so on); none cleared, and none was scored
  outside 2023.
* **The branch's closest cousin, out of sample on the primary window's own dates** (§3.34 there): LS-FADE bought BTC
  at the next daily open for one day when Binance's retail long/short account ratio was under its own trailing
  90-day 10th percentile, that is when retail was short-heavy. Crowding counted in accounts rather than paid in
  funding. It passed its 2023 screen thinly and failed on 2024-01-01 → 2026-09-24: +$5.07 on 146 trades (+3.5 bp a
  trade against a null p95 of +21.6 bp), −$24.11 at double fee, 1.85 % a year. Also read there: SPQTR, the front
  quarterly's cash-and-carry, positive in all 395 of its out-of-sample packages, which says futures stood above spot
  through most of 2024–26.
* **On `main`**, read in full: the fp5 review, and §3.21, §3.22 and §3.29 of the reference. §3.21's H3 read
  BTCUSDT's daily summed funding, 2020-01 → 2026-08
  (`backtests/inputs/binance_funding_daily_2026-09-23.json`), to refuse trend-4h entries when seven-day funding sat
  in its top fifth: the other end of the same series, as a filter on another rule; it failed its null. §3.29's CB bid
  5–15 % under the price two minutes earlier on ten coins, 2023-01 → 2026-09: buying after forced selling, a cousin
  of this idea, +$488.99 on 462 trips, most of it in 2023–24, and −$108.98 on 60 trips since 2026-04-01. fp3's B8
  measured spot drift in the 30 minutes before each funding settlement, with no sign condition: −0.6 to −1.9 bp.
* **Done for this file, 2026-09-26, 17:45–18:15 UTC.** Pulled the whole BTCUSDT funding history (7,721 settlements,
  2019-09-10 08:00 → 2026-09-26 16:00 UTC) and compared it with the public monthly archive (7,305 settlements,
  2020-01 → 2026-08: every stamp and every rate match); SOFR 2019-06-03 → 2026-09-24; and Binance BTCUSDT spot daily
  opens 2019-08-01 → 2026-09-26. Computed from them: the counts in the power check below (signal days, entries, days
  held, by window, half, year and month); how much a shifted rule's held days overlap the actual ones; and, over every
  day of each window with no signal involved, the standard deviation of the daily open-to-open return, its lag-1
  autocorrelation and the ratio of the two-day to the one-day standard deviation. The power formula was checked on
  synthetic random returns. No mean return of any kind was computed or printed. No return on a signal day, a held
  day or a shifted day was computed. Two opening prices were printed while checking the spot file (2019-08-01 and
  2026-08-31), nothing else about prices.
* **What anyone who follows the market knows**: BTC's broad path from 2019 to 2026 (the March 2020 crash, the 2021
  top, the 2022 bear market, the rise above $100k in 2024–25, the top in late 2025 and the fall after it), and that
  funding tends to turn negative after a fall.

## The signals (frozen, unchanged)

**UZERO**, from `docs/agents/reviews/2026-09-25-fp313-protocol.md` on the Binance branch:

> The signal is the latest settled funding rate whose `fundingTime` is strictly earlier than the daily open.
> (lines 12–13)

> A stamp that is not strictly earlier than the entry is not used. The row stamped on the entry hour, including a
> stamp a few milliseconds after the hour, is not used. (lines 68–70)

> **UZERO.** Fair value is the price index inside Binance's funding formula for BTCUSDT. The last settled funding
> rate is negative, so that contract finished below the index. Buy the USDT book for two days. (line 80)

Code: `docs/agents/scripts/fp313/common.py`, `_latest` (lines 72–82) and `_cheap` (lines 85–98):
`if FAIR_KIND == "index": return rate < 0.0`. Source (protocol lines 55–57): `GET /fapi/v1/fundingRate` on
`https://www.binance.com`, symbol `BTCUSDT`. "The USDT book" there is the USD-M perpetual (`fetch.py` reads
`data/futures/um/monthly/klines/BTCUSDT/1d/`).

**USOFR**, from `docs/agents/reviews/2026-09-25-fp317-protocol.md`: lines 12–13 and 68–70 as above, and

> **USOFR.** Fair value is the price index grossed up by the already-published SOFR carry. The last settled BTCUSDT
> funding rate is strictly below that eight-hour SOFR rate, so the contract finished cheap to the cash-and-carry. Buy
> the USDT book for two days. […] SOFR is an actual/360 overnight rate. The eight-hour equivalent is
> `percent / 100 * (8 / 24) / 360`. […] It is cheap when the last settled funding is strictly below that eight-hour
> rate. (line 80)

> This screen does not treat `effectiveDate` as the publication time. Publication is 13:00 UTC on the next
> `effectiveDate` in the series, which is that next business morning. […] A Friday print whose next effective date
> is Tuesday is not available on Monday. (line 72)

Code: `docs/agents/scripts/fp317/common.py`, `PUBLISH_HOUR = 13`, `publication_ms`, `sofr_eight` and `pair_sofr`
(lines 45–77) and `_cheap` (lines 121–134): `return rate < sofr_eight(sofr[pub])`, with `pub` the latest publication
strictly before the open; `docs/agents/scripts/fp317/fetch.py`, `pull_sofr` (lines 152–175), the New York Fed's
`api/rates/secured/sofr/search.json?type=rate`.

These files are as committed in `24e60b7a` and unchanged since. Their sha256 (`acd52dc2…` and `37f6a4df…` for the
two protocols, `8273c38c…` and `6a3a9b96…` for the two `common.py`) are the ones the branch's screen outputs record.

In this study's terms, for a decision at 00:00 UTC on day D:

* f(D) is the `fundingRate` of the BTCUSDT settlement with the latest `fundingTime` strictly before D 00:00 UTC.
  On every day of both windows that is the D−1 16:00 UTC settlement.
* **UZERO** is on for D when f(D) < 0.
* **USOFR** is on for D when f(D) < p / 100 × (8 / 24) / 360, where p is the SOFR percent whose publication time
  (13:00 UTC on the next `effectiveDate` in the New York Fed's series) is the latest strictly before D 00:00 UTC.

Checks on the series pulled for this file: every settlement stamp is 0 to 1 second after its 8-hour boundary, none
before it, and none is missing from 2019-09-10 08:00 to 2026-09-26 16:00; no rate a decision uses is exactly zero;
the SOFR print a decision uses was published 11 to 83 hours earlier. The 2023 counts reproduce the frozen ones
exactly: 36 UZERO days and 126 USOFR days, entries 2023-01-01 → 2023-12-30. SOFR was above zero throughout, so every
UZERO day is also a USOFR day: the two rules are nested, not independent.

Not tested here: **CZERO**, UZERO's sentence on the coin-margined BTC contract (§3.369 there: copying a funding sign
onto another contract is not a new rule), and **MSOFR**, USOFR's sentence on ETH's coin-margined contract, whose
trade is ETH: a third hypothesis that would need its own power check. EZERO, BZERO, CSOFR and ESOFR failed their
screens and stay dead.

## The trade (what changes)

* BTC spot, long only, $100 a position, one position at a time. Each rule is its own $100 and is scored on its own.
* **Entry**: at 00:00 UTC on a signal day, if flat, buy at that day's open and set the exit to the open two days
  later (48 hours).
* **A signal while holding**: buy nothing more; move the exit to the open two days after this signal day.
* **Exit**: sell at the exit open, unless that day is itself a signal day (then the exit moves, as above).

In steps, for a window with entry days 0 … N−1 (days N and N+1 carry exits only):

```
flat
for d in 0 .. N+1:
    on = d < N and signal[d]
    if holding:
        if on:            exit = d + 2
        elif d == exit:   sell at open[d]; flat
    elif on:              buy at open[d]; exit = d + 2
```

**Why the extension.** The hypothesis says each crowded day is followed by 48 hours in which BTC does better. Moving
the exit holds exactly the hours that lie within 48 hours after some signal day's open. That is the exposure the 2023
screen measured with overlapping spans, but with one $100 instead of a stack of them, so the capital is $100 and the
annualisation cannot repeat fp5's error. The two alternatives each measure something else. Selling at the exit open
and buying again at the same open pays 21 bp for nothing. Ignoring signals while holding leaves the market in the
middle of a crowded stretch and comes back on its next signal, a round trip each time. So a run of signal days, or of
signal days one day apart, is one trade; two days in a row without a signal close it.

* **Prices**: Binance BTCUSDT spot daily opens (`data.binance.vision`, 1d klines, open only). Revolut X's own
  BTC-USD history covers only the last year; Binance's spot book is the longest clean record of the same coin. A
  Binance open is not a Revolut X fill; the costs are Revolut X's.
* **Costs**: Revolut X's taker fee, 9 bp a side, plus half of BTC-USD's spread (at most 3 bp, so 1.5 bp): 10.5 bp a
  side, 21 bp a round trip. A trade's net return is
  `open[exit] × (1 − 0.00105) / (open[entry] × (1 + 0.00105)) − 1`. **Stress arm**: double, 21 bp a side (0.0021).
* **No funding cash**: a spot position neither pays nor receives funding.
* **The result** of a rule in a window, **S**, is its P&L in dollars with $100 in each trade: 100 × the sum of its
  trades' net returns, not compounded.

## Windows

| Window | Entry days | Last open used | Entry days N | Halves, by entry day |
|---|---|---|---:|---|
| Primary | 2024-01-01 → 2026-09-23 | 2026-09-25 | 997 | 2024-01-01 → 2025-05-12 · 2025-05-13 → 2026-09-23 |
| Second | 2019-09-11 → 2022-12-30 | 2023-01-01 | 1,207 | 2019-09-11 → 2021-05-05 · 2021-05-06 → 2022-12-30 |
| 2023, reported, not scored | 2023-01-01 → 2023-12-30 | 2024-01-01 | 364 | 2023-01-01 → 2023-07-01 · 2023-07-02 → 2023-12-30 |

Entry days stop two days before the last open, so every exit falls inside its window, and the signals of a window's
last two days are not read. 2019-09-11 is the first day whose 00:00 UTC follows a settlement (the first is 2019-09-10
08:00). The second window's last exit is the 2023-01-01 00:00 open, the close of 2022; a signal on 2022-12-31 would
need a price from the screen year, and is not read. The first half of a window is its first ⌊N/2⌋ entry days. A
trade belongs to the half, and to the calendar month (UTC), of its entry day. 2023 is where the signals were found:
it is reported beside the result and scored for nothing.

## Power check (event counts only)

Counts, from the funding and SOFR series alone ("in the market" is days held over the window's N + 1 days, from its
first open to its last):

| Rule | Window | Signal days | Entries (one position) | Days held | In the market | Entries by half | Signal days by half |
|---|---|---:|---:|---:|---:|---|---|
| UZERO | Primary | 140 | 40 | 200 | 20.0 % | 21 · 19 | 53 · 87 |
| UZERO | Second | 171 | 68 | 264 | 21.9 % | 21 · 47 | 65 · 106 |
| USOFR | Primary | 366 | 74 | 496 | 49.7 % | 33 · 41 | 157 · 209 |
| USOFR | Second | 211 | 72 | 317 | 26.2 % | 21 · 51 | 66 · 145 |
| UZERO | 2023 | 36 | 20 | 63 | 17.3 % | 11 · 9 | 14 · 22 |
| USOFR | 2023 | 126 | 29 | 175 | 47.9 % | 21 · 8 | 60 · 66 |

Signal days by year, UZERO · USOFR: 2019 (from 09-11) 22 · 22; 2020 43 · 44; 2021 29 · 29; 2022 77 · 116; 2024
29 · 88; 2025 41 · 145; 2026 (to 09-23) 70 · 133. They bunch: 55 of UZERO's 140 primary-window days fall in
February–April 2026. A trade lasts 2 to 20 days for UZERO in the primary window and 2 to 48 for USOFR (2 to 13 and 2
to 18 in the second). Every scored window has at least 30 entries for both rules, the house minimum; 2023 has 20 and
29.

**Volatility**, over every day of each window, open to open, no signal involved: primary 2.47 % a day (47 % a year),
lag-1 autocorrelation −0.05; second 3.91 % a day (75 % a year), −0.08; 2023 2.28 % a day (44 % a year), +0.01. The
two-day standard deviation is 0.96–1.01 times √2 times the one-day.

**The smallest edge the null test can see.** Under the null, S moves with the returns of the days it holds, while
the number of trades, and so the cost, barely moves between shifts (40–41 entries for UZERO in the primary window,
over every shift; 74–75, 68–69 and 72–73 in the other cells). With H days held of N, daily volatility σ and returns
close to uncorrelated, the shifted totals have a standard deviation of about $100 × σ √(H (1 − H/N)). On synthetic
independent returns with these exact signal patterns, the shifts' standard deviation came out at 1.00–1.02 times that
formula at the median, 0.86–1.25 across paths. An edge of ε a trade, over what the same way of trading earns on other
days, raises S by $100 × T ε for T entries. With 80 % power at one-sided 2.5 %, the first step of Holm for two rules,
the smallest ε is (1.960 + 0.842) × σ √(H (1 − H/N)) / T, and the smallest edge a held day is T ε / H:

| Rule | Window | SD of S under the null | Smallest edge a trade | Per held day |
|---|---|---:|---:|---:|
| UZERO | Primary | $31.3 | 219 bp | 44 bp |
| UZERO | Second | $56.1 | 231 bp | 60 bp |
| USOFR | Primary | $39.0 | 148 bp | 22 bp |
| USOFR | Second | $59.7 | 232 bp | 53 bp |

At one-sided 5 %, Holm's second step, each is 11 % smaller.

Against the 2023 screen, per held day: its excess over its edge-off trade was +130.7 bp a two-day span for UZERO,
about 65 bp a day, and +75.2 bp, about 38 bp a day, for USOFR. The chance of clearing the shift null at the Holm-first
level, in each window and in both:

| Edge a held day | UZERO: primary · second · both | USOFR: primary · second · both |
|---|---|---|
| As large as 2023's (65 · 38 bp) | 0.99 · 0.87 · 0.86 | 1.00 · 0.51 · 0.51 |
| Half of 2023's (33 · 19 bp) | 0.55 · 0.34 · 0.19 | 0.67 · 0.17 · 0.11 |
| 15 bp | 0.16 · 0.10 · 0.02 | 0.48 · 0.12 · 0.06 |
| 10 bp | 0.09 · 0.07 · 0.01 | 0.25 · 0.08 · 0.02 |

For scale, an edge worth money is small. With no drift at all, 4 % a year on $100 over the primary window needs about
10 bp a held day from UZERO ((1,094 bp + 40 × 21 bp) / 200 days) and 5 bp from USOFR ((1,094 + 74 × 21) / 496).
**So the test can see an edge the size 2023 showed; at half that size it has about one chance in five (UZERO) or
nine (USOFR) if the null is asked in both windows, and about 0.55 and 0.67 under the bar below, which asks the null of
the primary window and the sign of the second; and it cannot see an edge that would merely be worth money.** Most of
the power is lost in the second window, where BTC moved 3.9 % a day. A pass would be strong evidence. A failure means
there is no large edge; it does not rule out a small one, and this rule's daily history cannot.

## The null

A circular shift of the window's signal-day sequence. For a shift k, entry day i takes the signal of entry day
(i − k) mod N. The same position rule runs on the shifted sequence, on the same opens at the same cost, and gives
S_k; the actual result is S_0. The window is a circle: days pushed past its end come back at its start. A shift keeps
how many signal days there are and how they bunch, and moves them to other dates of the same window. It asks the
hypothesis's own question, whether buying on these days beats buying the same way on other days, without treating
bunched signal days as independent and without sampling.

* **Shifts**: every k from 60 to N − 60, which covers both directions: 878 in the primary window, 1,088 in the
  second, 245 in 2023. All of them are used, not a random draw of them: a window of 997 entry days has only 996
  distinct non-zero shifts, so 1,000 random shifts would only repeat some. Nothing is drawn at random anywhere, so
  there is no seed.
* **Why 60 days**: the signals come in stretches, and a short shift lands the shifted rule on many of the rule's own
  days, which carries any real effect into the null. By 60 days the share of the actual held days that the shifted
  rule also holds is back near chance in all four cells (0.24 against 0.20 for UZERO in the primary window, 0.19
  against 0.22 in the second; 0.54 against 0.50 and 0.29 against 0.26 for USOFR). At 30 days it is still 0.27–0.63.
* **The statistic**: S at the base cost.
* **p** = (1 + the number of shifts with S_k ≥ S_0) / (1 + the number of shifts). A tie counts against the rule.

## The bar

A rule passes only if every one of these holds. Everything is at the base cost unless it says otherwise.

1. **Profit in each window**: S > 0 in the primary window and in the second window.
2. **Profit in each half**: S > 0 in each of the four halves.
3. **Beats the shift null in the primary window, Holm across the two rules.** A rule's p is its primary window's p.
   The rule with the smaller p clears if that p is at most 0.025; the other clears if the first cleared and its own p
   is at most 0.05. Equal p's are treated alike: both clear at 0.025 or below, neither above it. The second window is
   a replication by sign — conditions 1, 2, 4 and 5 hold there as well — and not by the null; its shift p is reported.
4. **Double cost**: S at 21 bp a side > 0 in each window.
5. **Not one month**: in each window, the total without its best month (the calendar month of entry with the largest
   total) is > 0, and that month holds at most 40 % of the window's total.
6. **Worth money**: over the primary window, S on the $100 the rule ties up, annualised (S / $100 × 365 / 998, 998
   being the days from the 2024-01-01 open to the 2026-09-25 open), is above 4 % a year, that is S above $10.937. The
   $100 is tied up the whole window, because the rule may call for it on any day.
7. **Enough trades**: at least 30 entries in each window. The counts above already meet it; the scorer checks it.

Why the 40 % month test in 5, and 7: both come from the "What a pass becomes" section of the two frozen protocols, the
house bar these rules were promised if they passed ("at least 30 trades, no month above 40% of the profit and the
rest positive"). Leaving them out would lower the bar the rules were frozen under. Why 3 reads as it does: the
primary window is the test and the second a replication by sign. That was decided at the review of this file, before
any return was computed, from the power check alone: at 3.9 % a day the second window's null test has little power
(0.34 and 0.17 at half the 2023 effect), so asking the null there as well would leave about one chance in five
(UZERO) or nine (USOFR) of passing an edge half the size 2023 showed; with the second window by sign, about 0.55 and
0.67. A chance null pass in the primary window must also come up positive in every one of the second window's sign
conditions. Holm holds at 5 % the chance that either rule passes the null by luck, however closely the two are tied,
and they are nested.

## Descriptive, not part of the bar

* For each rule and window: every trade (entry, exit, days, gross and net), S at both costs, the mean net a trade and
  a held day, the share of days in the market, the halves, each month's total, and S annualised on $100 (both
  windows).
* The shift null in each window: its mean and its 5th, 50th, 95th and 97.5th percentiles.
* 2023, the year the signals were found: every number above, and its shift p. Reported, not scored.
* The same trades, same days and costs, priced on Coinbase's BTC-USD daily opens
  (`api.exchange.coinbase.com/products/BTC-USD/candles`, one-day candles): a check on the USDT quote, which moved in
  March 2020 and May 2022, both stretches of negative funding. A trade whose Coinbase open is missing is left out of
  this line and counted.
* Buy and hold over each window, one round trip: the drift the rule sat in, for context.
* The power check above, recomputed from the stored inputs.

## Data and how it is run

* **Scripts** in `docs/agents/backtests/fund/`, Python 3 standard library only: `fetch.py` pulls the inputs
  keylessly and checks them; `score.py` reads only the stored inputs and writes `docs/agents/backtests/fund/fund.json`.
* **Inputs**, gzip, in `docs/agents/backtests/fund/inputs/`, holding only what the scorer reads:
  * BTCUSDT funding (stamp, rate as published) for every settlement from 2019-09-10 08:00 to 2026-09-24 16:00 UTC,
    from `https://www.binance.com/fapi/v1/fundingRate` (the frozen source and the only one before 2020), checked
    against `data.binance.vision`'s monthly archive on every stamp and rate from 2020-01 to 2026-08. One mismatch
    stops the pull.
  * SOFR (effective date, percent as published), 2019-06-03 → 2026-09-24, from the New York Fed's
    `api/rates/secured/sofr/search.json?type=rate`.
  * BTCUSDT spot daily opens, 2019-09-11 → 2026-09-25, from `data.binance.vision`
    (`data/spot/monthly/klines/BTCUSDT/1d/` to 2026-08, then the daily files). The archive stamps in microseconds from
    2025-01-01; the pull converts them to milliseconds. One open per UTC day, no gap.
  * Coinbase BTC-USD daily opens for the same days, for the descriptive line only.
* **Before any price is read**, the scorer recomputes every count in the power check (signal days, entries and days
  held, by window and half) from the stored funding and SOFR, and stops if one differs from this file. It also stops
  if this file is not on disk.
* The scorer computes and writes every number above whatever the verdict, and stops at nothing but a failed check.
* `fund.json` records the sha256 of this file, of each input and of each script; its keys are sorted, its rounding is
  fixed, and it carries no clock. The scorer runs twice, and the two outputs must be byte-identical.
* The write-up is `docs/agents/reviews/2026-09-26-fund-crowding-study.md`: the verdict on each condition, the
  numbers, and any deviation from this text.

## What it cannot show

* **A small edge.** See the power check: an edge worth money, 5–10 bp a held day, has at most two chances in a
  hundred of passing. A failure says there is no large edge.
* **Revolut X's own fill.** The price is Binance's USDT book at its first trade after 00:00 UTC. The account would buy
  BTC-USD on Revolut X in the first minute after it, a few basis points either side, at a moment that is also a
  funding settlement. Revolut X's own history covers one year.
* **Why.** A pass says these days beat the other days of the primary window, and made money in the second. It does
  not say crowded shorts are the cause: negative funding also marks falls, and a fall followed by a bounce would look
  the same.
* **Other coins, contracts or holds.** Nothing here speaks for ETH, the coin-margined contracts or another hold; the
  two-day hold is the frozen one and is not varied.
* **Whether it adds to the live row.** `trend-4h-live` holds BTC too; how the two would overlap is not measured here.
* **After 2026-09-25.** The signal bunches by regime (55 of UZERO's 140 primary-window days fall in February–April
  2026), and the next regime may not look like either window.

## What follows

* **If a rule passes every condition**, it is a candidate for a paper row on Revolut X (BTC-USD, a taker buy in the
  first minute after 00:00 UTC, $100), under a paper spec of its own frozen before it runs, and only on Davies' word.
  Its overlap with `trend-4h-live` is measured first. No money moves on this study. If the Coinbase line disagrees in
  sign with a window the rule passed, the paper spec settles that before anything else.
* **If both fail**, funding crowding as a BTC spot trade is closed at this account's cost, recorded with the power
  statement above: no large edge, a small one not ruled out. The four screens §3.369 set aside stay where they are,
  and nothing further is run on these signals.
