# Pre-registration WX: Polymarket's daily temperature markets against a free public forecast (fp4, test WX)

Written 2026-09-24 (UTC) before any forecast was set against any outcome or any price, and before any
price or print of these markets was read. Frozen by the commit that adds this file; its sha256 is
recorded in the study. Nothing below may change after the freeze; any deviation is reported as a
deviation.

## Why this is Polymarket's own

Polymarket lists a daily market on the highest (and, since 2026, the lowest) temperature at one
weather station in each of some fifty cities, resolved on Weather Underground's whole-degree reading
(the Hong Kong Observatory's for Hong Kong). The buckets are one or two degrees wide, the books are
thin (M1: median depth within 1 ¢ of the midpoint $3.7, within 3 ¢ $25), the category pays large
reward pools, and the flow is retail. Numerical weather prediction is free: Open-Meteo archives what
its default blend predicted 24 and 48 hours before every hour (documented; January 2024 on). A model
that turns the 48-hour forecast into bucket probabilities is information a small, slow account can
hold. The claim tested: buying the bucket (YES or NO) the forecast says is mispriced by at least
10 points, the day before, and holding it to resolution, earns more than every cost, beyond what
calibrated prices would give, on events the model never saw.

## What was seen before the freeze (disclosed)

M1 (the live weather books and pools), the question formats and resolution sources of the closed
temperature markets (to write the parser), the monthly count of events (NYC and London from 2025-01,
about sixty a month; twelve to fourteen cities from 2025-12), Open-Meteo's documentation and one
request (LaGuardia, 2025-01-15, to confirm the archive), aviationweather.gov's station list (three
stations). No forecast was compared with any outcome; no market price was read.

## Data (keyless, public)

* Events and payouts: the closed-market pulls, parsed by `wx_events.py` (city, highest or lowest,
  unit, each bucket as a continuous interval: "between 45-46°F" is [44.5, 46.5), "34°C" [33.5, 34.5),
  "44°F or below" (−∞, 44.5); the station from the resolution URL's ICAO code, LaGuardia and London
  City where the 2025 markets' source field is empty, the Hong Kong Observatory's site for Hong Kong).
* Station coordinates: `aviationweather.gov/api/data/stationinfo`.
* Forecasts: Open-Meteo Previous Runs, `temperature_2m_previous_day2` (48 hours before valid time) at
  the station's coordinates, local time, reduced to each local day's maximum or minimum
  (`wx_forecasts.py`), °C (×9/5 + 32 for °F markets).
* Prices at the decision time: the CLOB's batch price history (hourly, the last point at or before
  `T_d`). Prints: `/v2/trades?condition=` for the markets the rule would trade.

## Universe and windows

Every resolved temperature event whose station has coordinates, target date `D` in
[2025-01-01, 2026-09-10). IS: `D` before 2026-03-01. OOS1: 2026-03-01 → 2026-05-31. OOS2:
2026-06-01 → 2026-09-10. Every payout counts, void or not, when trading; the model is fitted on IS
events with exactly one winning bucket.

## Model (fitted on IS only)

`T ~ Normal(F + μ, σ)`, `F` the forecast's daily maximum (highest-temperature events) or minimum
(lowest), in the market's unit. Bucket probability `π = Φ((U − F − μ)/σ) − Φ((L − F − μ)/σ)`.
`(μ, σ)` maximise the likelihood of the winning buckets, by grid (`μ` −5 … 5 step 0.1, `σ` 0.5 … 8
step 0.05, market units), per city and highest/lowest when that group has at least 40 IS events;
otherwise the pooled fit of its unit and highest/lowest; otherwise the pooled fit of its unit.

## Rule

* Decision time `T_d` = 12:00 UTC on the day before `D`. A bucket is tradable when its market was open
  then (`startDate < T_d < closedTime`) and has a price: `p` = the last hourly point of its YES token at
  or before `T_d`. `F` from `temperature_2m_previous_day2` is causal at `T_d` for every station (its
  latest valid hour, local midnight ending `D`, was forecast at most 48 hours before, which is before
  `T_d` in every time zone of the list).
* Edge `e = π − p` for each tradable bucket with `0.02 ≤ p ≤ 0.98`. The event's trade is the bucket with
  the largest `|e|`, when `|e| ≥ 0.10`: buy YES if `e > 0`, buy NO if `e < 0` (NO's shown price `1 − p`,
  its model value `1 − π`). One trade per event.
* Entry: $5 of cost from the buy-equivalent taker prints of that token in `(T_d, T_d + 60 min]` (a BUY
  of the token, or a SELL of its complement at `1 − q`), each used for at most its size, at
  `max(print price, shown price + one tick)`, never above the token's model value − 0.05 nor above
  0.99. Less than $1 filled → no trade (counted).
* Fee: `0.05 × price × (1 − price)` a share (the weather schedule), on history before it too.
* Hold to resolution; payout = the token's final payout; P&L = shares × (payout − price) − fees.
* Capital: each trade's cost from its first fill to `closedTime`.

## Arms

1. Primary: as written.
2. Stress (must stay > 0): each fill one tick worse, fees doubled.
3. Descriptive, no bar: thresholds 0.05 and 0.20; YES and NO trades apart; by city; the model's and the
   market's Brier score on every OOS bucket at `T_d`; the fitted `(μ, σ)`.

## Null (chance comparison)

Calibration null: each OOS trade's payout redrawn as Bernoulli(its average fill price), same shares and
fees; 10,000 draws, `random.Random(20260924)`. The primary's OOS P&L must exceed the 95th percentile.

## The bar (primary, OOS = OOS1 ∪ OOS2, all of)

1. OOS P&L > 0, and OOS1 > 0 and OOS2 > 0.
2. OOS P&L > the null's 95th percentile.
3. Stress OOS P&L > 0.
4. At least 200 OOS trades.
5. No calendar month holds more than 40 % of the OOS P&L, and OOS without its best month > 0.
6. The OOS P&L, annualised, on the peak capital held at once, exceeds 4 % a year.

## Determinism

`wx_test.py` run twice from the committed inputs; byte-identical JSON, sha256 recorded.

## What this cannot show

The ask at the decision instant (a later print, floored at one tick over the shown price, stands in);
the depth behind a print; forecasts other than Open-Meteo's default blend; whether the UK account may
trade at all (close-only; outside this test).
