# PR5V fast X: what a faster GBP/USD and more keys are worth (2026-09-28)

Davies asked (2026-09-28) whether "Stablecoin quotes - variant" (PR5V) should switch to the fastest GBP/USD source there
is, and to a higher call limit by opening more Revolut X sub-accounts, because he feels it would earn much more. This
measures both on the PR5V study's own days (`2026-09-28-pr5-variant-study.md`) and says which live sources could supply
a faster rate.

Public data only: Dukascopy's keyless GBP/USD ticks, the prints and USD hours the study committed, two 16-minute live
reads of keyless sources, and the public documentation of the rest. No key, no signed call, no order, no sign-up. No
production table was read, and nothing of PR5's or the variant's paper record. Weekend quoting is not priced: every run
is dark whenever the study's own GBP/USD is dark. The frozen files are unchanged. Every number below is in
`backtests/pr5v/fastx.json` (the live reads in `backtests/pr5v/fastx_live.json`).

## Answer first

* **A faster X is worth about nothing on the calm days, and on today's four keys it costs money.** Over the 28 days,
  today's minute bar makes $1.026 a day on Dukascopy's ticks (the study's Exness bar: $1.029). On four keys, 5 s bars
  and faster make $0.920–0.945 (1 s bars −$0.106 a day against the minute bar, 7-day block 95 % −$0.210 to −$0.000):
  they re-price more, so a key reaches the 600-POST line on 56 of 112 key-days instead of 19, at a median 15:16 UTC
  instead of 18:56. With the governor lifted, the fast rows gain between −$0.003 and +$0.065 a day (at most +0.7 %/yr
  on $3,600), and no interval excludes zero. The stale fills a faster X removes are 8 in 28 days with the minute bar,
  and together they made +$0.01: the stale window inside the minute bar costs nothing measurable. The frozen set gains
  nothing either.
* **More keys matter only on busy days.** On the 28 days, eight keys (no key then reaches 600) change nothing: −$0.004
  a day on the study's X (−$0.019 to +$0.009), +$0.019 on Dukascopy's. On the five fresh days, which were busier (GBP/USD
  moved 3 bps 50–53 times a day against 40–42), every key of the study's Yahoo X reached 600 on every weekday (median
  16:57 UTC), and eight keys add +$0.36 a day ($0.502 → $0.863, +3.7 %/yr). A faster X needs eight keys to pay at all
  (1 s bars: +$0.181 a day against four keys). Sixteen keys add nothing over eight on the 28 days and at most $0.05 a
  day on the fresh days. The busiest second is 9 POSTs a key on four keys, 5 on eight and 3 on sixteen, all under the
  venue's 10.
* **A re-price rule buys what the extra keys buy, with the keys Davies has.** Rule D, declared before it ran (a rung
  re-prices when fair moves more than max(0.03 %, k/3)), cuts a key's POSTs by 40 % (388 → 237 a day on average, the
  busiest day 793 → 458), so four keys never reach 600. On four keys it makes $1.049 over the 28 days on today's X
  (+$0.023, −$0.026 to +$0.071) and $0.700 on the fresh days (+$0.13); on the study's own X, $1.043 and $0.802 (+$0.30 a
  day on the fresh days, of the +$0.36 that eight keys give). Rules A and DA cut POSTs further and cost $0.07–0.11 a day.
* **The best combination, by the rule declared before the runs, is 15 s bars with rule A on four keys**: $1.057 a day
  (10.7 %/yr) over the 28 days (IS $1.139, OOS $0.965) and $0.894 (9.1 %/yr) on the fresh days, no key above 496 POSTs
  a day (554 on the fresh days). Against today's minute bar on four keys: +$0.031 a day (−$0.068 to +$0.127) and +$0.32
  on the fresh days; against today's bar with rule D: +$0.008 (−$0.062 to +$0.082) and +$0.19. The same bars with rule
  D tied it in IS ($1.134, not chosen) and did better after ($1.114 over the 28 days, $0.969 fresh); picking D now
  would be picking on OOS.
* **The ceiling is about three times today's dollars, and speed is not what stands between.** On the 28 days the UK
  books printed $197k a day ($157k while PR5's X is lit), so the shared cap allows $15.7k a side. Nine rungs re-priced
  continuously at the tick fair, never waiting for an exit, filled by every print through them under the cap and each
  earning its full distance, would make $2.96 a day on $5.2k of fills; any price at all, 10 % of every minute one tick
  inside each print, $17.8. Today's configuration makes $1.03 on $1.4k of fills: 35 % of the ladder's dollars. The
  ladder already has a perfect X; what it has and the rule lacks is rungs that never sit in a position waiting for
  their exit, and exits that never give back.
* **The fastest usable live source is TrueFX's keyless snapshot, read once a second**: 0.5–0.6 s behind Dukascopy's
  ticks with the polling included, 0.075 bps from them (median), no offset. Kraken's websocket moves 140–280 times a
  minute but its level trails Dukascopy by 1.4–4.4 s and sits 0.1–0.7 bps low; Bitstamp trails by 0.7–2.5 s, 0.1–0.6 bps
  high. Yahoo refused this container (429 on 311 of 316 reads), and its minute bar sits nearer Dukascopy's previous
  minute than its own. A minute-called Edge Function can poll TrueFX every second (SPEED's one-call loop), so 15 s bars
  need no Worker. With a free sign-up, OANDA's practice stream gives four prices a second. Finnhub's free plan has no
  forex REST price (its forex rates and candles are "Premium Access Required"); only its websocket carries forex, and a
  minute-called function cannot hold it. Trading 212 has no FX or quote endpoint, and its API terms bar this use.
* **So neither switch makes the strategy earn much more.** A faster X is worth $0–0.10 a day (0–1 %/yr on $3,600) over
  the 28 days, inside noise, and only with a rule that keeps its POSTs down; on the busy fresh days, with rule D,
  +$0.20–0.27. Keys are worth ~$0.3 a day on busy days and nothing on calm ones, and rule D gets most of that on today's
  four keys. If anything changes, rule D is the cheap one;
  a 15 s bar on top of it (Dukascopy's here; TrueFX's, live) is worth +$0.065 a day (−$0.018 to +$0.141) on the 28
  days and +$0.27 on the fresh days.

## What was checked before any number was believed

* **The study reproduces through this study's code** (`repro`, PASS). With X read from the study's own minute bars
  through the new series (`XS`, `FastMkt`) and engine (`fastx_sim.py`), eight runs reproduce the study's committed
  numbers and the frozen engine's own runs on the study's markets, trip for trip and POST for POST: the recommended
  configuration $1.1022 / $0.9483 / $1.0294 a day (IS / OOS / 28 days) and $0.5019 fresh; without the governor $1.0249;
  the frozen set at 1 s turns $0.3538 / $0.3282; the frozen set as it runs $0.4167 (28 days) and $0.2300 (fresh); PR5V's
  reference timing $1.0540 and $0.5088.
* **The engine is the frozen one plus two marked additions.** `fastx_sim.py` does not retype the simulator. It reads
  `pr5v_sim.simulate`'s own source from the frozen file (sha256 checked) and applies five string edits, each required to
  match exactly once: a key per rung, and a re-price rule for entry quotes. With both off it is the frozen engine: on
  every Dukascopy series below, the four-key run was also made on the frozen engine and matched trip for trip and POST
  for POST.
* **Pins** (`scripts/pr5v/test_fastx.py`, output `backtests/pr5v/test_fastx.txt`), each with a deliberately broken
  version that must fail: the engine equals the frozen one (a step 1 % wider differs); a minute series through the new
  code is the frozen X at 20,000 instants (read 1 s later, it is not); a bar is its last tick, readable after its end (the
  first tick, or readable at its end, fail); the tick series equals a brute-force "latest tick at least L old" at every
  second of two hours (keeping a second's first tick fails); a stale fill is a bid above the tick fair or an ask below
  it; the rules re-price the quotes they say (toward and away swapped fails); keys per rung place what the governor
  allows per key; keys needed adds POSTs day by day (adding each rung's busiest day fails); the mask keeps a fast X dark
  wherever the study's X is dark; the live lag measure finds a 2.5 s lag and not a false one; the ceiling fills and
  prices a print as defined (without the $100 or with a 100 % cap it differs).
* **Dukascopy's ticks agree with the study's sources.** 1,958,520 ticks, every hour from 2026-08-25 23:00 to 09-28
  00:00 fetched (795 files with the live windows' two, none missing), the 240 weekend hours empty and no weekday hour
  empty; about 84,000 ticks a weekday, a median 204 ms apart in London hours. Minute closes (the mid of the minute's last
  tick) against Exness's over the 28 days: median |difference| 0.111 bps, p95 0.296, max 4.28, on 28,494 minutes (134
  only in Dukascopy, 103 only in Exness), best aligned at the same minute. Against Yahoo's fresh pull: median 0.441 bps,
  p95 1.75, Yahoo 0.34 bps higher, and Yahoo's bar lines up better with Dukascopy's minute before (0.361 bps) than with
  its own: it runs up to a minute behind its label. Weekends: Dukascopy dark Friday 20:59 → Sunday 21:00, Exness
  20:58 → 21:05, Yahoo 21:29 → 23:00.
* **The frozen files are unchanged**: `pr5v_sim.py` 54ad4198…, `pr5_sim.py` 56fbad85…, `study.py` 4a5d077e…,
  `ref_timing.py` 7873178a…; `quotes.ts`, every pre-registration and every committed result untouched.

## The model: only X changes

Everything is the study's recommended configuration unless a row says otherwise: nine rungs a side at 0.03, 0.05,
0.075, 0.10, 0.125, 0.15, 0.20, 0.25 and 0.30 %, both books, $100 a rung ($3,600), re-priced when fair moves more than
0.03 %, the shared 10 % cap, a turn every second, an order live 1 s after its turn, a re-price's cancel landing 1 s after
the turn and its replacement 1 s later, four keys (a book and a side each) held to 600/700 POSTs a UTC day. fairU is the
study's (the USD book's hourly closes, median of 24 h to 1 h back). The frozen set is {0.1, 0.2, 0.3} at its 0.05 %
step, the same timing and shared cap, on one key.

**X.** GBP/USD is Dukascopy's public tick feed in every row but the study's own (Exness minutes for the 28 days, Yahoo
minutes for the fresh days), so the rows differ only in how the same ticks are sampled:

| X | what each turn reads |
|---|---|
| minute bar +5 s (today) | the close (mid of the last tick) of the last minute that ended at least 5 s ago |
| minute bar +1 s | the same, 1 s after the minute ends |
| 15 s, 5 s, 1 s bars +1 s | the close of the last 15 s / 5 s / 1 s bar that ended at least 1 s ago |
| tick, 1 s / 0.25 s old | the mid of the latest tick at least 1 s / 0.25 s old |

A value is dark 10 minutes after its interval began, as the frozen minute bar is, and **every Dukascopy row is also dark
whenever the study's own X is dark** at the same timing, so no row quotes an hour PR5 does not (Dukascopy reopens at
21:00 UTC on Sunday, Yahoo at 23:00).

**Keys.** Eight keys: two per book and side, the side's rungs dealt by distance, {0.03, 0.075, 0.125, 0.20, 0.30} and
{0.05, 0.10, 0.15, 0.25}. Sixteen: four per book and side, {0.03, 0.125, 0.30}, {0.05, 0.15}, {0.075, 0.20}, {0.10,
0.25}. A rung's exits and stops go on its key. "Keys needed" is read from the run without a governor: per book and side,
the fewest keys, the nine rungs split any way (every split tried), for which no key sends 600 POSTs on any UTC day.

**Re-price rules**, declared and committed before any of them ran (`49c97b9c`), entry quotes only (exits keep 0.03 %):
D re-prices a rung when fair moves more than max(0.03 %, k/3); A when fair moves toward the quote by more than 0.03 %
or away from it by more than 0.10 %; DA both (toward max(0.03 %, k/3), away 0.10 %).

**A stale fill** is an entry filled while the tick-level fair (fairU over Dukascopy's latest mid at the print, no lag)
was already through the entry price: a bid above it or an ask below it. Beside it, the edge at fill: the entry's
distance from that fair in bps, and how far short of the rung's own distance it fell.

## Q1: the value of a faster X

The recommended configuration on each X (28 days, and the five fresh days on the fresh pull). "Paired" is each row
minus the minute bar +5 s, by UTC day, with the 7-day block 95 % interval.

| X | 4 keys: 28 days | IS / OOS | fresh | no governor: 28 days | fresh | paired, 4 keys | paired, no governor |
|---|---|---|---|---|---|---|---|
| study's minute +5 s (Exness / Yahoo) | $1.029, 10.4 % | $1.102 / $0.948 | $0.502 | $1.025, 10.4 % | $0.863 | - | - |
| minute bar +5 s (today) | $1.026, 10.4 % | $1.082 / $0.964 | $0.574 | $1.045, 10.6 % | $0.713 | - | - |
| minute bar +1 s | $1.045, 10.6 % | $1.084 / $1.003 | $0.574 | $1.065, 10.8 % | $0.713 | +0.019 (−0.005 to +0.058) | +0.020 (−0.005 to +0.060) |
| 15 s bars +1 s | $1.026, 10.4 % | $1.142 / $0.898 | $0.329 | $1.110, 11.3 % | $0.940 | +0.000 (−0.087 to +0.093) | +0.065 (−0.016 to +0.142) |
| 5 s bars +1 s | $0.945, 9.6 % | $1.054 / $0.823 | $0.315 | $1.042, 10.6 % | $0.977 | −0.081 (−0.162 to +0.001) | −0.003 (−0.090 to +0.081) |
| 1 s bars +1 s | $0.920, 9.3 % | $1.056 / $0.769 | $0.255 | $1.099, 11.2 % | $0.949 | −0.106 (−0.210 to −0.000) | +0.054 (−0.011 to +0.114) |
| tick, 1 s old | $0.921, 9.3 % | $1.057 / $0.771 | $0.255 | $1.096, 11.1 % | $0.949 | −0.104 (−0.210 to +0.003) | +0.051 (−0.019 to +0.112) |
| tick, 0.25 s old | $0.927, 9.4 % | $0.988 / $0.860 | $0.262 | $1.087, 11.0 % | $0.940 | −0.099 (−0.162 to −0.040) | +0.042 (−0.048 to +0.126) |

The same runs' orders and fills (four keys; key-days count keys that reached 600 on a UTC day, of 112 on the 28 days
and of 20 on the fresh days, 12 of them weekdays):

| X | trips, won, taker exits | POSTs a key a day, mean / max | key-days at 600 (median time) | fresh | busiest second | keys never to reach 600: 28 days / fresh | stale fills (their P&L) | edge at fill / short of the rung, bps |
|---|---|---|---|---|---|---|---|---|
| study's minute +5 s (Exness / Yahoo) | 596, 83.7 %, 7 | 369 / 632 | 15 (19:15) | 12 (16:57) | 9 | 8 / 8 | 12 (−$0.10) | 6.43 / −0.02 |
| minute bar +5 s (today) | 580, 81.5 %, 4 | 374 / 655 | 19 (18:56) | 10 (15:54) | 9 | 8 / 8 | 8 (+$0.01) | 6.37 / +0.09 |
| minute bar +1 s | 577, 81.6 %, 6 | 373 / 655 | 20 (19:12) | 10 (15:54) | 9 | 8 / 8 | 8 (+$0.01) | 6.41 / +0.06 |
| 15 s bars +1 s | 537, 81.9 %, 5 | 395 / 647 | 39 (16:19) | 12 (14:10) | 9 | 8 / 10 | 1 (−$0.03) | 6.65 / −0.08 |
| 5 s bars +1 s | 516, 81.4 %, 6 | 406 / 676 | 48 (15:25) | 12 (14:26) | 9 | 8 / 9 | 0 | 6.61 / −0.13 |
| 1 s bars +1 s | 477, 81.3 %, 4 | 411 / 686 | 56 (15:16) | 12 (13:53) | 9 | 12 / 11 | 0 | 6.62 / −0.13 |
| tick, 1 s old | 478, 81.2 %, 4 | 411 / 686 | 56 (15:16) | 12 (13:53) | 9 | 12 / 11 | 0 | 6.62 / −0.13 |
| tick, 0.25 s old | 477, 82.0 %, 5 | 409 / 695 | 55 (15:24) | 12 (13:48) | 9 | 12 / 11 | 0 | 6.71 / −0.07 |

* **The stale window inside the minute bar is real but empty.** A faster X removes every stale fill: 8 with the minute
  bar, 0 at 5 s and faster. Those 8 made +$0.01 together over 28 days (the study's Exness bar: 12, −$0.10). Fills keep
  their rung's distance at every resolution: the edge at fill is 6.4–6.7 bps, within 0.13 bps of the rungs' own. A book
  that prints 150–300 times a day rarely prints through a quote in the seconds when fair has moved past it.
* **What a faster X costs is POSTs.** A 1 s X moves 3 bps 62 times a day where the minute bar moves 42 (fresh days: 74
  and 50), and every such move re-prices up to nine rungs. On four keys the extra POSTs put keys over the governor's
  line in the afternoon (median 15:16 UTC), and the entries it withdraws are worth more than the staleness it saves.
* **Without the governor the fast rows gain a little.** −$0.003 to +$0.065 a day on the 28 days, not significant, and
  +$0.23 to +$0.26 a day on the fresh days. The minute bar read 1 s after its end instead of 5 s gains +$0.019
  (−$0.005 to +$0.058): the size of a change that should be worth nothing, and the scale for the rows below it.
* **The source itself moves the result by a few cents.** At today's timing, Dukascopy's minute bar and Exness's make
  $1.026 and $1.029; at PR5V's reference timing (a turn a minute), $0.993 and $1.054 (fresh: $0.458 on Dukascopy, $0.509
  on Yahoo); the frozen set as it runs, $0.411 and $0.417.
* **The frozen set gains nothing from speed.** On one key at 1 s turns: $0.332 a day (10.1 %/yr) on the minute bar,
  $0.307–0.327 on every faster X (paired −$0.005 to −$0.025 a day), no stale fill on any, 215–274 POSTs a day (at most
  418–600).

## Q2: the order budget

**Keys** (28 days / fresh days, $ a day; the busiest second a key is 9 on four keys, 5 on eight, 3 on sixteen in every
row, under the venue's 10):

| X | 4 keys | 8 keys | 16 keys | 8 keys against 4, by day (28 days) | key-days at 600: 4 / 8 / 16 keys (28 days + fresh) |
|---|---|---|---|---|---|
| study's minute +5 s (Exness / Yahoo) | $1.029 / $0.502 | $1.025 / $0.863 | $1.025 / $0.863 | −0.004 (−0.019 to +0.009) | 27 / 0 / 0 |
| minute bar +5 s (today) | $1.026 / $0.574 | $1.045 / $0.713 | $1.045 / $0.713 | +0.019 (−0.016 to +0.065) | 29 / 0 / 0 |
| minute bar +1 s | $1.045 / $0.574 | $1.065 / $0.713 | $1.065 / $0.713 | +0.019 (−0.018 to +0.068) | 30 / 0 / 0 |
| 15 s bars +1 s | $1.026 / $0.329 | $1.110 / $0.940 | $1.110 / $0.940 | +0.084 (+0.017 to +0.159) | 51 / 2 / 0 |
| 5 s bars +1 s | $0.945 / $0.315 | $1.042 / $0.952 | $1.042 / $0.977 | +0.097 (+0.029 to +0.152) | 60 / 2 / 0 |
| 1 s bars +1 s | $0.920 / $0.255 | $1.101 / $0.925 | $1.099 / $0.949 | +0.181 (+0.081 to +0.265) | 68 / 18 / 0 |
| tick, 1 s old | $0.921 / $0.255 | $1.097 / $0.925 | $1.096 / $0.949 | +0.176 (+0.080 to +0.257) | 68 / 18 / 0 |
| tick, 0.25 s old | $0.927 / $0.262 | $1.087 / $0.893 | $1.087 / $0.940 | +0.160 (+0.064 to +0.244) | 67 / 18 / 0 |

On the minute bar, eight keys are the ungoverned run: the governor's cost is the gap to it, nothing on the 28 days and
$0.14–0.36 a day on the fresh days. On a faster X it is $0.08–0.18 a day even on the 28 days. Without any governor the
busiest key-day is 738–793 POSTs on the minute bar and 926–1,674 on the fast rows; the study's X needs 8 keys never to
reach 600, the fastest rows 11–12.

**Re-price rules** (declared before they ran). POSTs and keys are read without the governor; the last column is four
keys against the same X at 0.03 %, by day:

| X | rule | POSTs a key a day, mean / max (28 days) | keys never to reach 600: 28 days / fresh | no governor: 28 days / fresh | 4 keys: 28 days / fresh | 4 keys, against 0.03 % (28 days) |
|---|---|---|---|---|---|---|
| study's minute +5 s (Exness / Yahoo) | 0.03 % | 379 / 738 | 8 / 8 | $1.025 / $0.863 | $1.029 / $0.502 | - |
| | D | 230 / 434 | 4 / 4 | $1.043 / $0.802 | $1.043 / $0.802 | +0.013 (−0.023 to +0.057) |
| | A | 151 / 322 | 4 / 4 | $0.927 / $0.783 | $0.927 / $0.783 | −0.102 (−0.179 to −0.034) |
| | DA | 117 / 282 | 4 / 4 | $0.915 / $0.830 | $0.915 / $0.830 | −0.114 (−0.193 to −0.047) |
| minute bar +5 s (today) | 0.03 % | 388 / 793 | 8 / 8 | $1.045 / $0.713 | $1.026 / $0.574 | - |
| | D | 237 / 458 | 4 / 4 | $1.049 / $0.700 | $1.049 / $0.700 | +0.023 (−0.026 to +0.071) |
| | A | 156 / 378 | 4 / 4 | $0.952 / $0.785 | $0.952 / $0.785 | −0.074 (−0.150 to −0.015) |
| | DA | 123 / 305 | 4 / 4 | $0.946 / $0.753 | $0.946 / $0.753 | −0.080 (−0.160 to −0.020) |
| 15 s bars +1 s | 0.03 % | 452 / 926 | 8 / 10 | $1.110 / $0.940 | $1.026 / $0.329 | - |
| | D | 269 / 566 | 4 / 6 | $1.114 / $0.969 | $1.114 / $0.969 | +0.088 (+0.009 to +0.186) |
| | A | 171 / 496 | 4 / 4 | $1.057 / $0.894 | $1.057 / $0.894 | +0.030 (−0.049 to +0.113) |
| | DA | 133 / 403 | 4 / 4 | $1.030 / $0.893 | $1.030 / $0.893 | +0.004 (−0.108 to +0.131) |
| 1 s bars +1 s | 0.03 % | 573 / 1,602 | 12 / 11 | $1.099 / $0.949 | $0.920 / $0.255 | - |
| | D | 326 / 728 | 8 / 7 | $1.056 / $0.962 | $1.035 / $0.900 | +0.115 (+0.011 to +0.200) |
| | A | 203 / 517 | 4 / 4 | $0.988 / $0.927 | $0.988 / $0.927 | +0.068 (+0.004 to +0.138) |
| | DA | 154 / 458 | 4 / 4 | $1.018 / $0.983 | $1.018 / $0.983 | +0.098 (+0.003 to +0.200) |
| tick, 0.25 s old | 0.03 % | 569 / 1,674 | 12 / 11 | $1.087 / $0.940 | $0.927 / $0.262 | - |
| | D | 325 / 777 | 8 / 7 | $1.064 / $0.964 | $1.065 / $0.900 | +0.138 (+0.068 to +0.222) |
| | A | 201 / 502 | 4 / 4 | $1.020 / $0.804 | $1.020 / $0.804 | +0.092 (−0.024 to +0.189) |
| | DA | 154 / 444 | 4 / 4 | $1.028 / $0.814 | $1.028 / $0.814 | +0.100 (−0.016 to +0.209) |

(The 5 s bars, the minute bar +1 s and the 1 s-old tick are in the JSON.)

* **D keeps the dollars and drops 40 % of the POSTs.** It leaves near rungs at 0.03 % and stops re-posting far ones on a
  0.03 % move. Without the governor it earns what 0.03 % earns (+$0.004 a day on today's X, −$0.029 to +$0.051), and on
  four keys it lifts the busy fresh days (+$0.13 on Dukascopy's X, +$0.30 on the study's Yahoo X) without costing the
  calm ones. A and DA lift the fresh days too, but cost the calm ones.
* **A and DA cost money on the minute bar.** A quote left up to 0.10 % further from fair fills less; on the fast rows the
  POSTs they save are worth more than that, which is why every fast row does better with a rule than without one.
* **With rule D in place a faster X adds little.** On four keys with D on both, against today's minute bar: 15 s bars
  +$0.065 a day (−$0.018 to +$0.141), 5 s −$0.005, 1 s −$0.014, 1 s-old tick −$0.018, 0.25 s-old tick +$0.017; on the
  fresh days +$0.20 to +$0.27.

**The best combination**, by the rule declared before the runs (the highest IS $/day among X × rule, each held to the
keys it needs on the IS days; within 5 %, fewer keys, then the slower X): six candidates came within 5 % of the top
(1 s-old ticks at 0.03 % on 8 keys, $1.190 IS); two of them need only four keys, both on 15 s bars, and A ($1.139) edged
D ($1.134). **15 s bars, rule A, four keys, every rung of a book-side on its one key:**

| | IS | OOS | 28 days | fresh |
|---|---|---|---|---|
| $ a day, %/yr on $3,600 | $1.139, 11.6 % | $0.965, 9.8 % | $1.057, 10.7 % | $0.894, 9.1 % |
| trips, won | 244, 83.6 % | 194, 86.6 % | 438, 84.9 % | 52, 88.5 % |
| POSTs a key a day, mean / busiest | | | 148–171 / 347–496 | 171–239 / 367–554 |
| against today's minute bar on 4 keys, by day | | | +0.031 (−0.068 to +0.127) | +0.320 |
| against today's minute bar with D on 4 keys | | | +0.008 (−0.062 to +0.082) | +0.194 |

No key reached 600 on any day, taker exits 7 (28 days), stale fills 1. Beside it, not chosen: the same bars with D make
$1.134 IS, $1.092 OOS, $1.114 over the 28 days (11.3 %/yr) and $0.969 fresh, two fresh key-days reaching 600 after 18:00.

## Q3: the ceiling

| | 28 days | fresh days |
|---|---|---|
| UK notional a day, both books, every hour | $197,355 | $232,953 |
| the same while PR5's X is lit | $156,601 | $125,598 |
| 10 % a side (the shared cap) | $15,660 | $12,560 |
| ladder ceiling: fills a day, $ a day | $5,153, $2.96 (USDC $1.19, USDT $1.76) | $4,798, $2.85 |
| free ceiling: fills a day, $ a day | $15,842, $17.80 | $12,320, $11.83 |
| today's configuration (minute bar, 4 keys): fills a day, $ a day | $1,425, $1.03 | $691, $0.57 |

Both ceilings use the tick-level fair and count only prints while PR5's X is lit. The **ladder** is the nine rungs a
side, $100 each, re-priced continuously at the tick fair, always available (no waiting for an exit), filled by every
print strictly through them under the shared cap (nearest first, at most the print's own value and 10 % of the minute a
side), each fill earning its full distance to fair. The **free** bound is any price at all: 10 % of the minute a side,
filled from the prints farthest from fair first, one tick inside each print. Neither pays an exit, a stop or a queue.
Today's rule takes 28 % of the ladder's fills and 35 % of its dollars, and the stale-fill count says a perfect X would
add almost nothing to either. The gap is inventory: a rung that has filled waits for its exit and cannot fill again,
and the exits give some back (won 81–84 %).

## Q4: live GBP/USD sources

Two places could read a faster rate. **A Supabase Edge Function** called each minute gets about 2 s of CPU and may run
most of the minute: SPEED (§3.39) measured one call a minute looping each second at ~99 ms of CPU, so it can read a REST
source once a second, or hold a websocket for the minute and reconnect. **An always-on Cloudflare Worker** (a Durable
Object) can hold a websocket all day. Deploying either is Davies' call.

### Keyless, measured

Two 16-minute windows on Monday 2026-09-28 (14:59–15:15 UTC, Dukascopy changing its mid 141 times a minute over a 4.5
bps range; 15:39–15:55, 58 times over 3.6 bps), from this container. REST sources were read once a second (their
documented limits allow it); the websockets pushed. The lag is the shift that brings a source closest to Dukascopy's
ticks for the same minutes, polling included (positive = behind); the deviation is the median distance left at that
shift after the source's own median offset. This container's clock and Bitstamp's agree to tens of milliseconds (its
websocket stamps arrive a median 17–20 ms after their own time).

| source (how read) | changes a minute | median s between changes | vs Dukascopy: offset, lag, deviation | documented limit |
|---|---|---|---|---|
| TrueFX `webrates.truefx.com/rates/connect.html?f=csv` (REST, 1/s) | 27 / 19 | 1.4 / 2.0 | +0.04 / 0.00 bps, 0.5 / 0.6 s, 0.075 bps | none stated for the unauthenticated snapshot (10 pairs) |
| Kraken `wss://ws.kraken.com/v2` ticker, bbo (push) | 280 / 140 | 0.0 / 0.01 | −0.72 / −0.11 bps, 1.4 / 4.4 s, 0.15 bps | none stated |
| Kraken `api.kraken.com/0/public/Ticker?pair=GBPUSD` (REST, 1/s) | 17 / 16 | 2.2 / 2.7 | −0.72 / −0.11 bps, 3.9 / 3.5 s, 0.15 bps | public: "1 per second (or less)" |
| Bitstamp `wss://ws.bitstamp.net` order_book_gbpusd (push) | 11 / 4 | 1.1 / 7.1 | +0.11 / +0.60 bps, 1.4 / 0.7 s, 0.19–0.23 bps | none stated |
| Bitstamp `www.bitstamp.net/api/v2/ticker/gbpusd/` (REST, 1/s) | 7 / 3 | 4.2 / 14.4 | +0.11 / +0.64 bps, 2.5 / 2.3 s, 0.19–0.23 bps | "400 requests per second", "10,000 requests per 10 minutes" |
| Yahoo `query1/2.finance.yahoo.com/v8/finance/chart/GBPUSD=X` (every 3 s, first window only) | - | - | answered 5 of 316 reads (429) | none published |

TrueFX's quotes arrive 0.8–1.5 s (median) after their own timestamp, which is its snapshot's refresh, not the network
(requests took 0.3 s). Its terms license the feed "for Your own internal purpose of viewing and analyzing FX market
data", applications "solely for Your internal business purposes", no redistribution, and call the data "indicative, not
executable" (truefx.com/truefx-terms-and-conditions/, /truefx-market-data-faq/). Dukascopy's own datafeed is history,
published by the hour. Frankfurter (ECB) and open.er-api publish once a day. Coinbase (`GBP-USD`: 404), OKX and
Bitfinex have no GBP/USD book, and Gemini's `gbpusd` "does not have available data yet".

### With a free sign-up or a paid plan, from their own documentation (no sign-up made)

| source | GBP/USD it gives | how fresh (their words) | limits (their words) | cost, terms | sub-minute? |
|---|---|---|---|---|---|
| OANDA, fxTrade Practice (free demo) | `GET /v3/accounts/{id}/pricing` and `/pricing/stream` on `api-fxpractice` / `stream-fxpractice.oanda.com` | the stream sends "at most 4 prices per second (every 250 milliseconds) for each instrument"; heartbeats every 5 s | REST "120 requests per second"; "20 active streams"; "no more than 2 new connections per second" | a free practice account | yes: a 1 s REST poll from an Edge call, or the stream held by a Worker |
| Finnhub (free key; the site holds one) | only the websocket (`wss://ws.finnhub.io`, e.g. `OANDA:GBP_USD`): "real-time trades for US stocks, forex and crypto", a forex update "with volume = 0"; not FXCM, Forex.com or FHFX | real-time, no delay stated | free plan "60 API calls/minute"; "30 API calls/ second" on top of every plan; websocket 50 symbols, "1 API key can only open 1 connection at a time"; no daily cap stated either way | `/forex/rates` and `/forex/candle` "Premium Access Required"; `/quote` is "US stocks"; "Personal Use", no redistribution, not for a business | only by holding the websocket (a Worker, or seconds inside an Edge call); no free REST forex price at all |
| Trading 212 (the site holds a key) | no quote or FX endpoint; `GET /api/v0/equity/positions` gives a USD holding's `currentPrice` (USD) and `walletImpact.currentValue` (GBP), so GBP/USD = quantity × currentPrice ÷ currentValue | not documented; API Terms 5.1: "We do not guarantee their correctness, accuracy, completeness, or timeliness in any way" | positions "1 req / 1s", "applied on a per-account basis, regardless of which API key is used" (shared with the site's `trading212` function) | API Terms 4.2(a) "expressly prohibited from using our API for Algorithmic Trading purposes"; 4.2(h) not "to monitor ... a third-party service or for any similar benchmarking purposes"; 6.2 "only for testing purposes" | no |
| TraderMade | `marketdata.tradermade.com/api/v1/live` | "live sub-second data" | none stated | no free plan on its pricing page; FX & Crypto £599 a month (WebSocket included) | paid only |
| Twelve Data | `/price`, WebSocket | Basic: "Real-time forex market data"; WebSocket only "8 trial WS" | Basic (free) 8 credits a minute, 800 a day (a call every 108 s on average); Grow $79 a month, 377 a minute, "No daily limits" | Basic: "Internal non-display usage" | free: no; Grow: a 1 s poll fits |
| Massive (formerly Polygon.io) | Currencies REST and WebSockets | Basic: "End of Day Data", no WebSockets | Basic "5 API Calls / Minute" | Starter $49 a month: "Real-time Data", "WebSockets" | paid only |
| IG (demo) | Lightstreamer price streaming | MERGE mode "regulate[s] the update rate" | per app 60 non-trading requests a minute, per account 30; 40 subscriptions a connection | a demo key needs a demo account opened with a live account's e-mail | only by holding the stream |
| FXCM (demo) | REST over socket.io, prices pushed after subscribing | push | not stated in the pages read | free demo token | only by holding the socket |
| Alpha Vantage | `CURRENCY_EXCHANGE_RATE` | not stated for FX | "25 API requests per day" free; 75 a minute at $49.99 a month | | no |

Sources: developer.oanda.com/rest-live-v20/pricing-ep/, …/development-guide/, …/best-practices/; finnhub.io/docs/api
(forex-rates, forex-candles, websocket-trades, rate-limit; the flags come from the page's own data), finnhub.io/pricing,
finnhub.io/terms-of-service; docs.trading212.com/api and its spec docs.trading212.com/_spec/api.json,
trading212.com/legal-documentation/API-Terms_EN.pdf; tradermade.com/pricing, tradermade.com/docs/restful-api;
twelvedata.com/pricing; massive.com/pricing?product=currencies; labs.ig.com/faq.html, labs.ig.com/streaming-api-guide.html;
fxcm-rest.readthedocs.io/en/latest/socketrestapispecs.html; alphavantage.co/premium/;
support.kraken.com/articles/206548367-what-are-the-api-rate-limits-; bitstamp.net/api/.

**For the main session's read-only probes.** Finnhub: the one free endpoint that could give GBP/USD under a minute is
the websocket, `wss://ws.finnhub.io` with a subscribe to `OANDA:GBP_USD` (check `/forex/symbol?exchange=oanda` for the
exact symbol); with the site's key it takes the key's one connection. Trading 212: `/equity/positions` is the only
endpoint a rate could be backed out of, at most once a second per account, and 4.2(h) forbids using the API to monitor
a service's performance, which is what a freshness probe is.

## What this cannot show

* **The queue.** A fill is a print strictly through the price, sized by a share of the minute's volume. A real order
  loses its place every time it is re-posted; this model gives a re-posted quote the same chance as one that has
  rested. That flatters every arm that re-posts more: faster X, the 0.03 % step, more keys. QUEUE's pre-registered
  question is this one.
* **Latency.** An order is live 1 s after its turn and a cancel lands 1 s after it; a live executor has its own timing.
  A faster X is only as fast as the whole chain: the read, the turn, the POST.
* **One source for the fast rows.** Dukascopy is one bank-and-ECN aggregate. The source a live engine would read differs
  from it by a fraction of a basis point and of a second (TrueFX by 0.075 bps and 0.5 s here). Its minute bar and
  Exness's differ by a median 0.11 bps, and that alone moves the 28 days by $0.003 at 1 s turns and $0.06 at a turn a
  minute.
* **Few days, one regime.** 28 days, 13 of them out of sample, and five fresh days with a weekend (three weekdays),
  busier than the 28. Every fresh-day number is three weekdays.
* **The choice.** 28 combinations were ranked on IS; the pick and its four-key runner-up differ by 0.4 % in IS and by
  13 % in OOS, the runner-up ahead. Differences this size are noise in either direction.
* **The venue's limits.** Whether 1,000 orders a day is per key or per account is undocumented; four or more keys on one
  account may share one budget. The 10 POSTs a second is modelled per key.
* **The live sources were read for 32 minutes on one Monday afternoon**, from a cloud container; a Supabase function or
  a Worker sees other latencies. Yahoo refused this container, so its live price was not measured here.

## Files

* `docs/agents/scripts/pr5v/`: `fastx.py` (every table here), `fastx_sim.py` (the frozen engine with a key per rung and
  the re-price rules, built from the frozen source), `test_fastx.py` (the pins, output `backtests/pr5v/test_fastx.txt`),
  `fastx_tables.py` (prints the tables from the JSON), `pull_ticks.py` (the paced, resumable Dukascopy pull),
  `live_fx_measure.py` and `wsmini.py` (the live reads), `live_fx_analyze.py` (their analysis and the documented limits).
* `docs/agents/backtests/pr5v/`: `fastx.json` (the declaration committed before the runs in `49c97b9c`, the
  reproduction, every run, the ceiling, the choice, and the sha256 of scripts and inputs), `fastx_live.json`,
  `test_fastx.txt`.
* `docs/agents/backtests/inputs/pr5v_fastx_2026-09-28/`: `dukascopy_SHA256SUMS` (the sha256 and URL of each of the 795
  raw hours; their 8.8 MB are not committed and re-fetch with `pull_ticks.py`), `dukascopy_GBPUSD_1m_closes.json.gz`
  (the minute closes the validation uses), the two live logs, and `SHA256SUMS`.
* Re-run: `PR5V_TICKS=<folder> python3 docs/agents/scripts/pr5v/fastx.py docs/agents/backtests/pr5v/fastx.json` (about
  2.5 minutes on four cores), then `fastx_tables.py docs/agents/backtests/pr5v/fastx.json --doc`.
