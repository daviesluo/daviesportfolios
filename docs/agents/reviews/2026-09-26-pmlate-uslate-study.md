# USLATE: the late taker on US temperature markets fails on one date (PMLATE study, 2026-09-26)

Pre-registered in `2026-09-26-pmlate-prereg-uslate.md` (sha256 `bd124d00…9e00`, frozen by commit `ad6ec6e3` at
22:19:47 UTC) and run as frozen, with one deviation (below). The input was committed before the test read it
(`fc213355`). Scripts, input and results are in `backtests/pmlate/`. Nothing was placed: every read was a keyless GET.

**Verdict: USLATE fails, on condition 6 of 7.** The rule made **+$715.73** on 611 fills: 131 buckets on 55 dates,
$7,481 spent, a peak of $949 at work. It beat its null, both halves were positive, the stress arm was positive, and
the date bootstrap's 5th percentile was above zero. But one date made 57.6 % of it, and the bar allows 40 %. On
2026-05-06, a special report at 23:48 local put New York's low at 57°F. Nearly seven minutes after the loop could
have seen it, the dead 58–59°F bucket's YES was still trading at 93–94¢. That one bucket made +$412.31 at the $100
cap. As the pre-registration says, **a fail closes PMLATE**.

Added after the freeze, at Davies' standing one-second pricing: at a 1 s loop the same rule makes +$735.24, $19.51
more, and the same date is still 56.1 % of it. The delay that decides the result is AWC's delivery of the report, not
the loop's.

## The bar

| # | Condition | Required | Result | |
|---|---|---|---|---|
| 1 | Total, and each half | all > 0 | +$715.73; 03-01 → 05-31 +$404.53; 06-01 → 08-31 +$311.20 | pass |
| 2 | Against the null | total > its p95 | p95 +$240.57 (mean −$23.52); no draw of 10,000 reached the total | pass |
| 3 | Stress: one tick worse, fees doubled | > 0 | +$652.98 | pass |
| 4 | Enough of it | ≥ 60 bucket-deaths on ≥ 25 dates | 131 on 55 | pass |
| 5 | Date bootstrap | p5 > 0 | p5 +$9.53 (p50 +$675.11) | pass |
| 6 | Not one date | best date ≤ 40 % of the total, and the rest > 0 | 2026-05-06, +$412.31 = **57.6 %**; the rest +$303.42 | **fail** |
| 7 | Worth money | > 4 % a year on peak capital | +$715.73 on a $948.85 peak over 184 days: 149.6 % a year | pass |

Seven conditions, all required; one hypothesis, so Holm changes nothing.

## What happened

* **The input.** 2,256 US market-days (12 stations; Weather Underground 2,058, NOAA's time series 198), every print
  walk complete, 12,711 buckets the reports decided (12,458 dead, 253 locked). 7,212 of those buckets saw a
  stale-side print at some point after their report was observed. Only 131 saw one worth at least 1¢ after the loop
  could have acted (the report's observation + the station's 90th-percentile AWC delay + 90 s). The power check had
  expected about 220 on 60 dates and +$800, with the null's p95 near +$230.
* **One bucket.** New York's lowest temperature on 2026-05-06 (KLGA, Weather Underground). The day's low had stood
  at 58°F since 02:51 EDT. At 23:48 EDT (03:48 UTC on 05-07), twelve minutes before the day ended, a special report
  gave the temperature in whole degrees Celsius only: 14°C, which is 57.2°F, so 57. The routine report three minutes
  later carried tenths, 14.4°C, which is 58°F. The reports cannot say whether the air really touched 57°F. The
  market resolved on 57: 56–57°F won.
  * The loop could act from 03:56:46 UTC (KLGA's p90 delay is 436 s). From 03:57:50 to 04:03:31, 37 prints sold the
    58–59°F bucket's YES at 93–94.5¢, and half of them fill 359 NO shares for $23.18. At 04:04:50 the bids fell to
    50–52¢, and four more fills take 156 shares for the remaining $76.82. The NO paid: +$412.31, 57.6 % of the total.
  * So the date that carries the result turned on one special report read in whole degrees, which the source
    followed. The bidders at 93–94¢ were betting the low would stay 58.
* **The rest is thin.** Without that date the total is +$303.42; without the best two, +$151.00. The ten best
  buckets make 119 % of the total. 52 of the 55 dates made money, most of them cents to a few dollars. The median
  fill came 68 minutes after its report's observation (p10 12 minutes, p90 7 hours), at a median gross edge of 2.5¢.
* **The three verdict failures lost the cap.** The reports' final extreme missed the winning bucket, and the rule
  bought the loser's NO at the cap on each. All three were among the nine the pre-registration named. Together they
  cost −$301.89, 42 % of the total.

| Date | Market | Source | Reports' extreme | Bucket bought dead | Won | Avg price paid | P&L |
|---|---|---|---:|---|---|---:|---:|
| 2026-03-24 | Denver high (KDEN) | Weather Underground | 80°F | 78–79 | 78–79 | 93.0¢ | −$100.00 |
| 2026-05-27 | Miami low (KMIA) | Weather Underground | 79°F | 80–81 | 80–81 | 63.3¢ | −$101.37 |
| 2026-08-27 | Atlanta low (KATL) | NOAA time series | 71°F | 72–73 | 72–73 | 79.0¢ | −$100.52 |

### By month

| Month | Market-days | Bucket-deaths with a fill | P&L |
|---|---:|---:|---:|
| 2026-03 | 216 | 11 | −$86.00 |
| 2026-04 | 348 | 3 | +$6.76 |
| 2026-05 | 409 | 46 | +$483.78 |
| 2026-06 | 379 | 20 | +$86.32 |
| 2026-07 | 402 | 18 | +$156.90 |
| 2026-08 | 502 | 33 | +$67.98 |

May holds the best date (+$412.31) and 27 small bucket-deaths on 05-19, the day of phase 1's cluster of
disagreements (+$92.25 here).

### Arm 5, descriptive (no bar)

| Arm | Total | Bucket-deaths | Dates | Peak capital | Best date's share |
|---|---:|---:|---:|---:|---:|
| Primary (p90 + 90 s, g ≥ 1¢, half, $100) | +$715.73 | 131 | 55 | $948.85 | 57.6 % |
| Lag: station median + 60 s | +$2,149.14 | 320 | 115 | $948.85 | 19.2 % |
| Lag: p90 + 300 s | +$618.73 | 123 | 49 | $948.85 | 63.1 % |
| Lag: p90 + 600 s | +$88.11 | 106 | 39 | $948.85 | 150.1 % (the rest −$44.14) |
| g ≥ 0.5¢ | +$729.84 | 198 | 76 | $1,038.81 | 56.5 % |
| g ≥ 2¢ | +$691.65 | 61 | 39 | $508.26 | 59.6 % |
| g ≥ 5¢ | +$661.09 | 35 | 23 | $401.00 | 62.4 % |
| No $100 cap | +$9,735.59 | 131 | 55 | $51,362.76 | 70.8 % (03-07) |
| The whole print | +$1,306.45 | 131 | 55 | $1,345.30 | 55.7 % |
| Weather Underground markets | +$809.37 | 108 | 50 | $948.85 | |
| NOAA time-series markets | −$93.64 | 23 | 5 | $263.20 | |
| Buckets whose verdict failed | −$301.89 | 3 | 3 | | |
| Non-US stations (a separate input; a report, not a test) | +$1.11 | 1,404 | 170 | $4,582.54 | 05-12 +$1,781.02; the rest −$1,779.91 |

* **The median-delay arm's extra is two stations.** At the station's median delay + 60 s the same rule makes three
  times as much (+$2,149.14 over 115 dates). But $1,414 of the $1,433 extra comes from KBKF and KLGA, whose AWC
  receipt delays have long tails (next section). Timed to each station's median arrival, the arm acts before AWC
  has received some of the reports, so it is not a rule. At p90 + 10 minutes almost nothing is left.
* **The concentration is not an artefact of the parameters.** Every arm that acts at p90 + 90 s or + 300 s puts
  55.7–63.1 % of its total on 05-06. At + 600 s the total is +$88.11 and lives on 08-13. Uncapped, one date (03-07)
  holds 70.8 %.
* **Weather Underground made money, NOAA lost.** That is not what the basis rates would predict; with five NOAA
  dates it is noise.
* **Outside the US the rule breaks even, and the settlement failures are why.** On the same months, over 7,241
  non-US market-days (32 of Jinan's have no METAR at IEM), it makes +$1.11 on 1,404 buckets over 170 dates. 83
  buckets whose reports' verdict failed cost −$7,895.63; the other 1,321 made +$7,896.74. As a test it would fail six
  of the seven conditions (only the count passes): halves +$906.61 and −$905.50, null p95 +$665.11, stress −$708.49,
  bootstrap p5 −$2,827.90. That is phase 1's September finding again, on six months: the US-only split was right.

## Speed at one second (added after the freeze; descriptive, no bar)

Davies' standing rule (2026-09-26): a study prices speed at one second, because pg_cron on the project runs a job
every 1–59 s. The frozen rule's + 90 s is a one-minute loop. This section runs the same rule at a 1 s loop and asks
which delay binds, the loop's or the source's. It was added after the freeze and computed on the test months; it
carries no bar and changes no verdict.

Every arm is the frozen test's own `run` on the committed input: the same prints, half of each, the $100 cap, each
market's fees, held to the payout (`scripts/uslate_speed.py`; `results/uslate_speed_2026-03_2026-08.json`, sha256
`7578390c79bb0e10177e0aa318b6f79d429cadeca931ba05b196e64954abb41c`, two runs byte-identical, with every arm's total
by station). Its frozen arm reproduces the primary to the cent, null and bootstrap included.

| The loop may act at the report's observation + | At the median station | Total | Bucket-deaths | Dates | Best date's share | Null p95 | Bootstrap p5 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Frozen: the station's p90 receipt delay + 90 s | 360 s | +$715.73 | 131 | 55 | 57.6 % | +$240.57 | +$9.53 |
| (a) a 1 s loop: p90 delay + 2 s | 272 s | +$735.24 | 139 | 60 | 56.1 % | +$246.94 | +$31.32 |
| (b) a 1 s loop at the median delay: p50 + 2 s | 217 s | +$2,681.79 | 412 | 132 | 16.3 % | +$534.67 | +$1,770.13 |
| Bound: a source with no delay, + 2 s | 2 s | +$22,040.30 | 3,122 | 182 | 2.8 % | +$1,059.52 | +$20,163.98 |

"At the median station" is the median over the market-days: the station's p90 delay 269.6 s, its p50 214.6 s.

* **A 1 s loop gains $19.51.** Cutting the loop's 88 s (a one-minute poll and the order) to 2 s adds 2.7 %: eight
  more buckets on five more dates. The one date still holds 56.1 % of the total (the rest +$322.93), so at 1 s the
  rule would still fail condition 6. At the median US station the loop is 25 % of the frozen delay (90 s of 360) and
  0.7 % of the 1 s delay (2 s of 272).
* **The source binds.** At ten of the twelve stations, what the rule makes barely depends on when it acts after AWC
  has the report. Over six months those ten give +$65.17 frozen, +$84.56 at 1 s, +$141.76 at the median delay + 2 s,
  and +$15,137.57 with no source delay. By the time AWC has a typical report there, the stale side is gone.
  * Arm (b)'s larger total is two stations whose AWC delivery has a long tail. KBKF (Denver's Buckley; p50 622 s,
    p90 3,600 s) adds $1,383.47 over arm (a), and KLGA (p50 197 s, p90 436 s) $505.88; the other ten add $57.20.
  * At those two stations the p90 model acts long after a typical report arrives, so what a real poller would find
    turns on each report's actual receipt. Either way it is the source's delay that decides the result, not the
    loop's.
  * The no-delay row is a bound, not a rule: it acts at the observation's nominal time, which no public feed
    delivers, and it puts our order beside the fastest takers' own prints.
* **The takers already read a faster source.** In phase 1's September data for US stations, the first cut on a
  bucket the market still priced came a median 60 s after the report's observation time. That was 163 s before AWC
  had the report, and 97 % of first cuts came before it (273 s before, across all stations). They are not faster
  pollers of AWC: they read the observation from something nearer the station.
* **So a faster loop does not rescue the rule.** At 1 s, the rule on AWC is decided by when AWC receives each
  report. If every report had reached AWC at its station's median delay, the same rule would make +$2,681.79 over
  132 dates, nearly all of the gain at KBKF and KLGA. That is not a result. It was seen after the freeze, on the
  test months.
  * A real 1 s poller acts at each report's own receipt instant, and AWC no longer holds those for these months (it
    keeps about thirty days). Such a poller would land roughly between arms (a) and (b).
  * The next question is the source: which feed delivers a US station's report first, and how much sooner than AWC.
    Phase 1 found that `api.weather.gov` answers keylessly for US stations; its latency is unmeasured.
* **Outside the US, the same pattern with longer delays** (the median station's p90 395.6 s, p50 293.9 s):
  +$1.11 frozen, +$677.73 at 1 s (without 05-12, −$1,105.14), +$3,900.87 at the median delay, +$78,032.83 at the
  bound. The 83 verdict failures cost about −$7,900 in every arm (`results/uslate_speed_nonus_2026-03_2026-08.json`,
  sha256 `b31e45b2…a424`, two runs byte-identical).

## Determinism

* The input rebuilds byte-identical under its own name: `inputs/uslate_2026-03_2026-08.json.gz`, sha256
  `98ecd9a2144f4980ff06e1b08b99bbc7218ac29bdd98519aaee01deb447b1803`, committed in `fc213355` before the test ran.
* `uslate_test.py` ran twice from it with `--split 2026-06-01`. The two JSONs are byte-identical:
  `results/uslate_2026-03_2026-08.json`, sha256 `1aec3e0ffe1a67fef7915eb8e30e8029e3f55aac692b99b15f982c53144cf7f8`.
* `uslate_check.py` (committed with the input) drew twenty fills from the primary arm with `random.Random(20260926)`.
  All 20 trace to their input print. All 20 match a print in a fresh, cache-busted `/v2/trades?condition=` walk: the
  same second, the stale side, the same YES-equivalent price, the same size. All 20 payouts agree with Gamma, and the
  largest P&L difference is $0. Every one of the 131 markets with a fill has its payout read again from Gamma, and
  all 131 agree (`results/uslate_check_2026-03_2026-08.json`).
* The non-US report's input is the same frozen command with `nonus`. At 7.1 MB it stays out of git with the raw
  pulls: `uslate_nonus_2026-03_2026-08.json.gz`, sha256
  `3089f3e76516804adec55369a8fa1919b129c26331b301d1ecb9515701ea6613`, recorded in `MANIFEST.json`. `uslate_test.py`
  on it, run twice, gives byte-identical output: `results/uslate_nonus_2026-03_2026-08.json`, sha256
  `6d355bd113353b301b670f9d9242a569d157ace96369ced3eaa5ae168d92fe1d`.

## Deviations

1. **Four archived events are left out.** NYC's and Miami's lows of 2026-05-22 and 05-23 (events 497099, 497100,
   500779, 500780) were archived by Polymarket on 05-18 and 05-19, four days before their target dates. Every market
   stayed `closed: false` with no payout, and $5–$60 had traded. The pre-registration's universe is every *resolved*
   event. The frozen input script reads only the event's `closed` flag, which Gamma left set, and the frozen test
   stops at `1.0 - None` on such a market's dead bucket. So `scripts/uslate_events.py`, which lists the events the
   print pull walks, leaves out any event with a bucket that has no payout. The input script then counts them under
   `no_prints_file` (4). The universe is otherwise the frozen command's: 2,260 US events, 2,256 of them resolved,
   against the 2,256 the power check expected.
2. For the non-US report the same filter leaves out nine archived events (Cape Town 05-19; Paris, Seoul and
   Shanghai 05-22; London, Paris, Seoul, Shanghai and Tokyo 05-23).

Not deviations: the print pull walked the list `uslate_events.py` writes (exactly the events the input script
reads) rather than the whole event files; KDEN, the one station with no September measurement, took the frozen
default delay of 250.8 s; one US event came from fp4's list, the rest from the tag.

## What follows

PMLATE is closed, as the pre-registration says: nothing goes to paper and nothing is built. The mechanism is real,
but what a one-minute loop can reach after a report is public is thin and lumpy. In six months the result rested on
one special report read in whole degrees, which the source followed, less three disagreements with the source that
went the other way and each cost the cap. What is left late is a bet on how the source reads the reports, not a race
the loop can win. The money is in the minutes before a loop that waits for AWC can move.

At one second, which is how any next study is priced: a 1 s loop on AWC does not change the verdict (+$735.24, one
date 56.1 %). The source decides it. If the idea is taken up again, it is a new pre-registration that assumes a
1 s loop from the start. It would be a forward paper test on months not yet seen (from 2026-09-27), polling every
second and recording each report's actual AWC receipt instant and the book at the instant the loop could act. It
would answer the source question before any rule: which keyless feed delivers a US station's report first, and how
much sooner than AWC.

None of the descriptive arms is a finding to trade. Each was seen on these months, and a variant chosen from them (a
faster lag, the median delay, Weather Underground only) would need new months and a new pre-registration. The live
questions the pre-registration listed stay open, and are now moot: the book at the instant, queue position, the
order path, and whether this account may open a position at all.
