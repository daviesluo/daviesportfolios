# Pre-registration USLATE-FAST: USLATE acted on the second the fastest keyless source publishes the report (SPEED)

Written 2026-09-27 (UTC), before any minute of the period it is judged on exists: that period starts only once its
recorder has run, and the recorder is not built. Frozen by the commit that adds this file; nothing below may change
after it, and any deviation is reported as a deviation. It is the one rule the speed study
(`docs/agents/backtests/speed/`) left standing: the same bet as USLATE (`2026-09-26-pmlate-prereg-uslate.md`), acted
on as soon as a keyless source can show the report instead of at a modelled worst case.

## Why

Davies (2026-09-26) asked why the loop runs once a minute, how fast it could run and whether faster would pay. The
study priced it at one second, as the standing rule now asks:

* **The report is public at tgftp.nws.noaa.gov first.** Polled live on 2026-09-26 22:48 → 09-27 01:18 UTC (20 US and
  10 other stations, fifteen keyless sources, `results/source_latency.json`), NOAA's tgftp server wrote a US station's
  METAR a median 159 s after its observation time, a median 7.7 s before aviationweather.gov's own receipt of the same
  report (p10 52 s before, p90 0.1 s after), and was the first source on 104 of 115 reports. AWC's API showed a report
  3.7 s after its receipt at the median, its cache file 49 s, the Iowa Mesonet 63 s, api.weather.gov 20 minutes.
* **Most of the edge is gone by then, but not all, and the rest decays.** On September's own US buckets (the
  exploration, `results/edge_vs_latency.json`), 10.65 % of the stale side's post-observation net edge was still there
  at AWC's receipt, 13.1 % 30 s before it, 24.2 % 60 s before it. USLATE acts at the observation + the station's 90th
  percentile AWC delay + 90 s, after the receipt on nine reports in ten.
* **At one second the same bet may take more.** Under USLATE's own fill model, September's US buckets give +$194.31
  at USLATE's instant (its committed exploration result, $7.47 a day) and between +$7.0 and +$12.7 a day at the tgftp
  publication + a one-second loop (`results/speed_answer.json`, tgftp's lead drawn from the live reports): +$12.7 if
  tgftp's rare long leads over AWC (4 of 67 US reports by more than a minute) are leads for us alone, +$8.7 without
  them, +$7.0 at AWC's own receipt. Whether the fast instant beats the slow one is therefore the question, and only
  real publication instants can answer it. The study found nothing faster that is keyless, and nothing that makes a
  loop faster than a second worth more here.

## What was seen before the freeze (disclosed)

Everything PMLATE's pre-registration discloses, and this study's reads: September's exploration (target dates
2026-09-01 → 09-26: every print of its closed temperature events, every METAR of their stations, AWC's receipts), the
live poll above, the post-count exploration, Polymarket's public socket and REST endpoints for fifteen minutes, and the
project's own logs and cron tables (SELECT only). No price, print or book of a market with a target date after
2026-09-26 was read.

## Data (keyless, public)

* **The recorder** (to be built, on Davies' word; nothing it does is keyed and it places nothing): an Edge action that
  reads the current hour's METAR cycle file `https://tgftp.nws.noaa.gov/data/observations/metar/cycles/<HH>Z.TXT`
  (the hour of now + 15 minutes, where a report observed from :45 lands) once a second by byte range, and the previous
  hour's every ten seconds — run either by pg_cron's one-second schedule or as one call a minute looping each second
  under a lease, which the study measured at the same speed — and writes, for every METAR or SPECI of a US station
  (ICAO beginning with K), the instant its read returned it for the first time (`pub`). Every interval of more than 10 s without a read
  is a gap and is written down; a bucket whose deciding report the recorder never saw has no `pub`.
* Everything else is USLATE's: events from Gamma's "Daily Temperature" tag (103040); reports from IEM's archive
  (report types 3 and 4); prints from the data API (`/v2/trades?event_id=`, every page cache-busted); payouts and fee
  schedules from Gamma; the input built by `uslate_inputs.py` (sha256
  `388ce2d14ea4a9e9a6638580cc5c7ecd85478e174b81f5d8c6c6a48ef880783e`), with each bucket's `pub` added by matching its
  deciding report to the recorder's sighting by station and observation minute.

## Universe and period

Every resolved daily highest- or lowest-temperature event whose station is a US ASOS station (ICAO beginning with K),
with a target date in the 28 UTC days that start at the first 00:00 UTC after the recorder has run 24 hours without a
gap. The halves: the first 14 days and the last 14. The period is not extended for later gaps; their buckets simply
have no `pub`, and their count is reported.

## The rule (`docs/agents/backtests/speed/scripts/uslate_fast_eval.py`, sha256 `2a6c7823c2ecd1fafe28c4eb2f61ff662435f5c4a594a717f09c89a6a56045f1`, governs)

USLATE's rule exactly (`uslate_test.py`, sha256 `e3c2ac24c9a138a0fb8d453e836207c81813f3bd3278a1787017c367244725ae`,
imported unchanged: the decided buckets, the half-print fills from g >= 1 ¢, $100 a bucket, each market's own fee,
held to resolution, traps included), except the instant the loop may act:

* **When.** The recorder's first sighting of the deciding report (`pub`) + 0.25 s (a one-second loop's dispatch and
  the order).
* **Which prints.** Only prints whose data-API time is at least 3 s after that instant: the data API stamps a print
  2–3 s after the match (`results/print_time_lag.json`: p50 1.96 s, p90 2.96 s on 406 socket trades), so an earlier
  stamp may be a match we could not have been first to.

## Arms

1. Primary: as written.
2. Stress (must stay > 0): each fill one tick worse and fees doubled, as USLATE's.
3. Null (calibration): each fill's token pays 1 with probability equal to its price; 10,000 draws,
   `random.Random(20260927)`.
4. Date bootstrap: the distinct target dates with a fill, drawn with replacement; 2,000 draws, same seed.
5. **USLATE on the same days** (the comparison the speed is for): `uslate_test.run` on the same input.
6. Descriptive, no bar: the instant + 1 s and + 5 s; no print-time margin; the whole print; no $100 cap.

## The bar (all of, on the period)

1. Total > 0, and each half > 0.
2. Total > the null's 95th percentile.
3. Stress total > 0.
4. At least 15 bucket-deaths with a fill, on at least 8 distinct dates.
5. The date bootstrap's 5th percentile > 0.
6. No single date holds more than 40 % of the total, and the total without its best date > 0.
7. Worth money: the total over the peak capital, annualised (× 365 / 28), exceeds 4 % a year.
8. The total beats USLATE's on the same days (arm 5): the speed is what is being paid for.

## Power check (from the exploration, before any minute of the period)

At September's US rate the rule would fill about 60 bucket-deaths on about 15 dates in 28 days, for about +$195 to
+$355, against about +$210 for USLATE on the same days; September's per-date standard deviation (about $20) puts the
date bootstrap's 5th percentile above zero once the total passes about $130. Condition 8 is the one most likely to
fail: at the low end of the range the fast rule takes what USLATE takes. Traps set the other side, as for USLATE: a
trapped bucket costs up to $100 to both rules, and the basis check counts US trap market-days at 0.40 % (9 of 2,256
in March–August), about one every two weeks at September's 21 US market-days a day. A pass needs four weeks with at
most one trap; even then it is small — $7–13 a day before traps.

## Determinism

`uslate_fast_eval.py` runs twice from the committed input; byte-identical JSON; sha256 recorded. Twenty fills (fixed
seed) are re-read from a fresh `/v2/trades?condition=` pull and each payout from Gamma, as USLATE's.

## What this cannot show

Whether our order would have been first in the second after publication (the prints stand in for the book, halved,
and the socket's own timestamps are not recorded); whether a source ahead of NOAA's publication exists that the
informed takers read (in September the first stale print at a US station came a median 64 s after the observation,
while tgftp published US reports a median 159 s after it in the live poll — none of the fifteen keyless sources polled
comes close); non-US stations (September's traps there cost more than the fast rule takes); and whether this account
may open a position at all: Polymarket's order path does not exist, and when built it may open a position only from
Supabase's `eu-west-1` while Davies' attestation that he is in Ireland is current (`CLAUDE.md`).

## What follows

A pass is a live proposal at USLATE's $100 a bucket, preceded by a paper month that stores the CLOB's book at each
`pub` beside the fills. A fail closes the temperature taker at every keyless speed: what the late side leaves after
NOAA's publication is too little, however fast the loop.
