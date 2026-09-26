# Pre-registration USLATE: take what the losing side still offers after a US station's report has decided a temperature bucket (PMLATE)

Written 2026-09-26 (UTC), before any price or print of the test period (target dates 2026-03-01 → 2026-08-31) was
read. Frozen by the commit that adds this file; nothing below may change after it, and any deviation is reported as a
deviation. It is the one hypothesis PMLATE's phase 1 left standing (Holm over one: α = 0.05). Scripts, results and the
pull manifest are in `docs/agents/backtests/pmlate/`.

## Why

Davies (2026-09-26): RW's paper quotes lose in the markets that end the day they are quoted — by the afternoon the
outcome is largely known, the traders who hit the quotes know it, and the side that fills is the losing side. Turn it
round: once the day's result is determined, be the taker of the stale liquidity quoters still rest on the losing side.

Phase 1 measured the mechanism (the numbers are in `results/phase1_*.json` and `rw_mechanism.json`):

* **It is real, and it is fast.** On September's 2,537 temperature market-days, 1,150 buckets the market still gave
  at least 5 ¢ of chance were then decided by a report whose verdict held. The first sale at under half the previous
  price came a
  median 273 s BEFORE aviationweather.gov received the report (p75 −92 s, p90 −11 s): 94.8 % before the report was
  public there, 97.9 % before a loop acting two minutes after it. Of the stale side's net edge after the observation,
  89.5 % was taken before the receipt, 1.9 % in the first minute after it, 0.3 % in the second, 8.2 % later. On RW's
  own Austin 94–95 °F bucket (24 Sep) the YES went 0.29 → 0.010 between 20:50:20 and 20:54:11 UTC; the report that
  decided it was observed at 20:53 and received at 20:56:33; nothing traded above 0.001 afterwards.
* **What is left late is mostly a trap.** After the receipt + 120 s, the stale side's liquidity is concentrated where
  the resolution source did not show what the reports said: 12 September buckets the reports had decided resolved
  the other way (9 on 2026-09-20, when NOAA's time series showed a different extreme at eight stations across Asia
  and Europe), and those 12 carried $36,316 of the late stale-side cost against $8,271 of net edge on every other
  bucket. Over 12,874 market-days (2025-01 → 2026-09-26) the reports' final extreme missed the winning bucket on
  1.8 % (Weather Underground 2.2 %, NOAA 0.7 %; US stations 0.65 %, the rest 2.2 %), in clusters (2026-05-17 → 05-21:
  50 market-days; 2026-09-20: 8).
* **US stations were the exception in the exploration month.** The rule below, run on September (the exploration,
  not the test), made +$194.31 at US stations (54 bucket-deaths on 14 dates, no trap) and −$699.87 elsewhere (12
  traps at the $100 cap). The split was chosen after seeing that; the months below have not been read.

Why a mechanism could leave something at US stations: their reports are ASOS observations NOAA publishes reliably, so
the late liquidity there is less often a price of resolution risk; and a late print at 1–5 ¢ on a bucket the report has
killed is the reward farmers' and lottery buyers' bids that nobody has cleared yet.

## What was seen before the freeze (disclosed)

* RW's paper record of 2026-09-24 → 09-26 (every table, read with the Supabase connector, SELECT only, nothing after
  2026-09-27 00:00 UTC), and the prints of the ten events behind RW's same-day temperature market-days.
* September's temperature universe (2,644 events, Gamma tag 103040), every print of its 2,585 closed events, every
  METAR/SPECI of its 50 METAR stations (IEM; it holds none for Jinan) with AWC's receipt instants: the exploration,
  whose numbers are above.
  `results/uslate_exploration_2026-09.json` is `uslate_test.py` run on it (US stations) from the committed
  `inputs/uslate_exploration_2026-09.json.gz` (sha256 `9746aeb1cf4ed8d6d3a15d0fb50558df719dd8992542de9b572f378e835a87a9`),
  byte-identical twice (`f65ccf41c8bce1301c34f4f4eec05eccf9a557bf663cc7eeb63d3925ea0d3fbf`).
* The basis check over every market-day since 2025-01 (`results/phase1_basis.json`): each event's winning bucket
  against the station's reports — **including the test period's outcomes, but none of its prices or prints**. In the
  test period's US market-days, a bucket the reports had ruled out won on 9 (6 by three degrees or more, all on
  2026-05-19/20, Weather Underground days).
* The count of market-days by month and region (`results/phase1_universe.json`), and the post-count family's
  measurement (`results/phase1_counts.json`), which registers nothing.

No price, print or book of a market with a target date in 2026-03-01 → 2026-08-31 was read.

## Data (keyless, public)

* Events: Gamma's "Daily Temperature" events (tag 103040) by scheduled end, `universe.py 2026-03-01 2026-09-01`,
  first; then fp4's committed WX list (`polymarket/inputs/wx_inputs.json.gz`) through `universe_wx.py`, for any event
  the tag does not list. An event is kept once (the first file that has it). Buckets are whole degrees
  (`common.parse_market`); the station is the ICAO code in the resolution URL.
* Reports: IEM's archive (`asos.py`, report types 3 and 4, raw METAR), `obs_pull.py`; temperatures by
  `metar.temp_in` (°F from the remarks' tenths of a degree Celsius where present, else the body; °C from the body).
* Receipt delays: `results/awc_receipt_lags.json` (sha256 `6f3509a0ddad414a88b82aea70ca3ae6681f7ef681449978d7e06f859a197501`),
  measured on 2026-09-01 → 09-26; AWC keeps about thirty days, so the test period's own receipts cannot be read.
* Prints: `/v2/trades?event_id=` from the data API, every page cache-busted, walked back to six hours before the local
  day (`prints_pull.py`); payouts, closed times and fee schedules from Gamma.
* The input: `uslate_inputs.py 2026-03-01 2026-09-01 us results/awc_receipt_lags.json
  inputs/uslate_2026-03_2026-08.json.gz <tag events> <WX events>`, committed before the test runs.

## Universe and period

Every resolved daily highest- or lowest-temperature event whose station is a US ASOS station (ICAO beginning with K),
with a target date D in [2026-03-01, 2026-09-01). The halves: D before 2026-06-01, and from it. 184 days.

## The rule (`scripts/uslate_test.py`, sha256 `e3c2ac24c9a138a0fb8d453e836207c81813f3bd3278a1787017c367244725ae`, governs)

* **Decided.** The station's reports of its local civil day D (routine and special), in time order, give a running
  extreme (the maximum for a high, the minimum for a low). A bucket [lo, hi] is **dead** at the first report whose
  running maximum exceeds hi (a high) or whose running minimum is below lo (a low); an open-ended bucket is **locked**
  at the first report whose running maximum reaches lo ("X or higher") or running minimum reaches hi ("X or below").
* **When the loop could act.** The report's observation time + its station's 90th-percentile AWC receipt delay (the
  table; a station with no September measurement takes the median of the US stations' 90th percentiles, 250.8 s) +
  90 s (a one-minute poll and the order).
* **Fills.** From that instant until the market closes, every print on the stale side of that bucket — a taker
  selling the dead bucket's YES or buying its NO; buying the locked bucket's YES or selling its NO — whose gross edge
  g (the dead bucket's YES price y; the locked bucket's 1 − y) is at least 1 ¢ fills us for half its size at its own
  price: we buy the dead bucket's NO at 1 − y, the locked bucket's YES at y. Prints are taken in time order until the
  bucket has cost $100 (the last fill partial). A resting order of ours is never assumed; every fill is a print that
  happened.
* **Fee.** Each market's own schedule: shares × rate × (p × (1 − p)) ** exponent at the fill price p; zero where the
  market charged none.
* **Hold** to resolution; payout from the market's result. P&L = Σ shares × (payout − price) − fees.
* **Capital.** Each fill's cost from its instant to its market's closed time; the peak of the sum.

## Arms

1. Primary: as written.
2. Stress (must stay > 0): each fill one tick worse (0.001 where y < 0.04 or y > 0.96, else 0.01) and fees doubled.
3. Null (calibration): each fill's token pays 1 with probability equal to its price, same shares and fees; 10,000
   draws, `random.Random(20260926)`.
4. Date bootstrap: the distinct target dates with a fill, drawn with replacement as many times as there are, summed;
   2,000 draws, `random.Random(20260926)`.
5. Descriptive, no bar: the lag at the station's median + 60 s, and at the 90th percentile + 300 s and + 600 s;
   g ≥ 0.5 ¢, 2 ¢, 5 ¢; no $100 cap; the whole print instead of half; by resolution source; the fills on buckets
   whose reports' verdict failed; the same rule on non-US stations (a separate input) as a report, not a test.

## The bar (all of, on the test period)

1. Total > 0, and each half > 0.
2. Total > the null's 95th percentile.
3. Stress total > 0.
4. At least 60 bucket-deaths with a fill, on at least 25 distinct dates.
5. The date bootstrap's 5th percentile > 0.
6. No single date holds more than 40 % of the total, and the total without its best date > 0.
7. Worth money: the total over the peak capital, annualised (× 365 / 184), exceeds 4 % a year.

## Power check (from the exploration, before any test-period print)

The test period has 2,256 US market-days against September's 550 analysed (×4.1). At September's rates the rule would
fill about 220 bucket-deaths on about 60 dates (fewer US markets a day than in September, so fewer dates than ×4.1),
for about +$800; the null's 95th percentile would sit near +$230, and the date bootstrap's 5th percentile clears zero
once the total exceeds about $250 (September's per-date standard deviation, $20.4, over 60 dates). So the test sees an edge about a third the size of September's, and no smaller.
Traps set the other side: a trapped bucket costs at most $100, and the basis check already counts 9 US market-days in
the period whose ruled-out bucket won; if each carried late liquidity the rule gives back ~$900. A pass is not the
likely outcome, and even one is small: September's rate is about $2,700 a year at the $100 cap.

## Determinism

`uslate_test.py` runs twice from the committed input; byte-identical JSON; sha256 recorded. A sample of twenty fills
(fixed seed) is re-read from a fresh `/v2/trades?condition=` pull and matched to its print, and each payout re-read
from Gamma, as fp4's `check_samples.py` did.

## What this cannot show

The book at the instant we could act (prints stand in for it, halved); whether our order would have been first; the
test period's real receipt instants (modelled by September's 90th percentile); the resolution source's own page at the
time (neither NOAA's time series nor Weather Underground has a keyless history); outage days unlike those in the data;
and whether this account may open a position at all: Polymarket's Terms of Use name Ireland and the United Kingdom
among the places whose residents may not trade (fp4 §0), and the order path does not exist.

## What follows

A pass is a forward paper test with real receipt instants and the book recorded at the minute the loop would act, and
a US-only confirmation from NOAA's keyless API (`api.weather.gov` answers for US stations only) before any order; a
live version needs everything in the report's last section. A fail closes PMLATE: the stale side after a report is
taken before a one-minute loop can see the report, and what is left is resolution risk.
