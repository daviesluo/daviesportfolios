# The Coinbase paper tests on 2026-10-14: no bug, and what a fast-move guard is worth (2026-10-15)

Davies, 2026-10-15: "stablecoinwitheuros的两个策略怎么今天亏了，有问题就修复改好". Exploratory and in sample except where a
column says otherwise. Nothing here changes a running test, a frozen file or a config. Scripts, inputs and results are in
`docs/agents/backtests/cbreview/` (`cbfast*.py`, `calendar_events.py`, `fxlag.py`; §9 lists them and the order to run).

## 0. The answer

1. **There is nothing to fix.** Both tests lost on 2026-10-14 (base −£2.695, "- 2" −£2.553; 18 trips, 4 won each) because the rule
   did what it is written to do into the US CPI release at 12:30 UTC. PR5's frozen `simulate`, run on the engine's own minute
   record, gives the engine's 10-14 to the penny (18 trips, 4 won, −£2.696 against −£2.695) and its whole record (28 trips,
   −£2.121 against −£2.120), so no code defect hides in the numbers (§1).
2. **Where the £2.70 came from:** seven asks filled in the release minute itself, −£1.52 (57 %); five trips entered before it
   and carried through the move, −£1.33 (49 %); the six trips after it, +£0.16.
3. **The fair was not stale.** The engine's fair follows the exchange-implied EUR/USD to 0.8 bp RMS over 3 days of production
   (best alignment: the freshest candle, no lag) and to 2.3 bp across the CPI half hour; the history's Yahoo series is also lined up
   with Coinbase's own rate (shift 0 of ±5 minutes). A faster FX feed has nothing to buy (§2).
4. **Reactive guards do not work; a calendar blackout does, a little.** Of 164 variants, none of the reactive families
   (fair-vs-print deviation, tape range, fair move, widening, shorter stop) is positive in both 12-month spans, and the look-ahead
   oracle that withdraws every large-range minute loses £56 to £456 a year, because the rule earns its money in fast minutes. A blackout
   around the scheduled releases (both sides' entries off from 1 minute before to 5 minutes after, the fair withheld) is positive in
   **all 45 and all 30** of its variants in **both** spans: +£25.96 a year (day-bootstrap 5th to 95th percentile +5.1 to +50.7) on
   a base of £554.64 in 2024-25 and +£7.89 (+0.2 to +16.0) on £192.95 in 2025-26, keeping 97 % and 94 % of the trips (§5). Run on
   10-14 it turns −£2.70 into −£1.17 (§6).
5. **Verdict on a "Stablecoin quotes with Euros - 3": not worth a row of its own.** The blackout is worth about 0.3 to 1.1 % a
   year on £2,400 (4 to 5 % of the rule's profit), and it comes from a few shock releases (the five worst of 94 carry 55 % of the avoided
   loss). The 28-day window of a new paper test holds about five releases, expects +£1.7 with a standard deviation of £3.3, and
   would read positive 69 % of the time if the history is right and 36 % of the time if there is no effect: it cannot tell the two
   apart (§7). The evidence for the blackout is the history, not a paper window. If Davies wants it anyway, or wants it as a day-one
   rule of whatever arm is funded after the 11-08 and 11-10 readings, the draft pre-registration, spec and code change are in §8,
   ready and unbuilt.

## 1. What happened on 10-14 (checking the diagnosis)

Source: `cb_quote_trips` (inputs/trips_to_1014.json, `sql/export_trips_to_1014.sql`) and the engine's minute record
(`sql/export_lit_lines_1012_1014.sql`), read 2026-10-15 00:20 UTC. Trips are counted by the day they exit, as the paper day is.

| trips of 10-14 | n | £ | what they are |
|---|---:|---:|---|
| entered before 12:30 and carried | 5 | −1.327 | USDT-EUR ask 10-13 21:22 (−0.559), USDC-EUR ask 03:46 (−0.453), USDT-EUR ask 11:12 (−0.412), USDT-GBP ask 07:02 (−0.009), USDC-GBP ask 11:11 (+0.106): sold the coin before the dollar rose, bought it back after |
| entered in the 12:30 minute | 7 | −1.524 | three asks on USDC-GBP, two on USDT-GBP, one each on USDC-EUR and USDT-EUR: the ladder lifted in one minute |
| entered after 12:30 | 6 | +0.156 | |
| **total** | **18** | **−2.695** | 4 won, the same count as the page |

**The release minute** (the engine's stored record; `inputs/lit_*`):

| book | fair at the 12:30 turn | asks filled in the 12:30 minute (k: price) | highest print in the minute | prints in it (the two minutes before) | fair at the 12:31 / 12:32 turn | bought back at |
|---|---:|---|---:|---:|---|---:|
| USDT-EUR | 0.89169 | .3 %: 0.89458 | 0.89484 (+35 bp) | 44 (1, 8) | 0.89379 / 0.89499 | 0.89805 |
| USDC-EUR | 0.89272 | .2 %: 0.8950 | 0.8953 (+29 bp) | 168 (41, 59) | 0.89482 / 0.89602 | 0.8973 |
| USDC-GBP | 0.75341 | .1 %: 0.7545, .2 %: 0.7551, .3 %: 0.7558 | 0.7560 (+34 bp) | 41 (6, 2) | 0.75482 / 0.75587 | 0.7568 |
| USDT-GBP | 0.75254 | .2 %: 0.7543, .3 %: 0.7551 | 0.7552 (+35 bp) | 69 (4, 1) | 0.75395 / 0.75500 | 0.7559 |

(A rung's price is not the 12:30 fair times 1 + k: the rule re-prices a resting rung only when the fair has moved more than 5 bp from the
one it was set at, so a rung sits at the fair of up to some minutes before.) The coin traded 29 to 35 bp above the fair inside one minute and
every ask resting in the minute that was within reach was lifted; the exit was bought back at the new fair. The orders were where the rule
puts them: placed at the turn of 12:29 or earlier on data to 12:29, live for the minute, and the minute was the news. The loss is adverse selection on a resting ladder plus an unhedged currency position
in the carried inventory (a short coin is short dollars when the dollar rallies). The replay proves the engine ran the frozen rule:

| `inputs/lit_*` replayed by PR5's frozen `simulate` through `cbpaper/replay.py`'s book | trips | won | £ |
|---|---:|---:|---:|
| engine, 10-14 | 18 | 4 | −2.695 |
| replay, 10-14 | 18 | 4 | −2.696 |
| engine, 10-11 23:01 to 10-15 00:00 | 28 | | −2.120 |
| replay, same | 28 | | −2.121 |

Not replayed or checked by me: the hold arm (its −£2.553 and its 18 trips, 4 won, were read from its own tables; it differs from the base only across
a closure, which 10-14 (a Wednesday) is not, and in its start, 10-13 00:00), and the Revolut X side (the main session's "+$0.36, 15 trips, 13 won").

## 2. Is the fair slow? The FX lag (item 3)

The engine's fair is the dollar stablecoin price over the interbank rate (Yahoo 1-minute bars, the last completed one at the turn).
Coinbase's own books give another EUR/USD: USDT-USD over USDT-EUR (minute candles, keyless; USDC-USD is not a Coinbase product).
`fxlag.py` shifts one against the other and finds the alignment that makes the detrended difference smallest (RMS, bp):

| comparison | minutes | best shift | RMS at best | at +1 / at +2 minutes |
|---|---:|---|---:|---|
| history's Yahoo vs implied, 09-09 to 10-08, every minute | 23,636 | 0 | 0.80 | 1.10 / 1.45 |
| same, within 15 min of a release (calendar §4) | 149 | 0 | 2.03 | 3.04 / 4.33 |
| same, minutes where the rate moved over 8 bp in 5 | 194 | 0 | 1.88 | 2.38 / 3.32 |
| **production** stored fair vs implied, 10-11 to 10-14, USDC-EUR | 4,296 | −1 (the freshest candle) | 0.84 | |
| same, USDT-EUR | 4,296 | −1 | 0.88 | |
| same, 10-14 12:15 to 12:45 (the CPI half hour) | 31 | −1 | 2.31 | 8.08 at +1 |

For USDT-EUR the stored fair stood 17.0 bp from the implied rate at the 12:26 turn (the stablecoin's own standing basis), 15.8 bp at 12:30
and 18.2 bp at 12:31: it had moved with the market by the first turn that could see the move (USDC-EUR: 5.5, 4.3 and 6.7 bp). What ran
ahead of the fair was the *coin's price*: at the 12:31 turn the last print of the release minute stood 5 to 17 bp above the fair, and a
turn later it was level. **A faster interbank feed would not have changed 12:30**: the move happened between two turns, inside the minute
the orders rested through.

The `g5_fx` rows of the grid (+£31 to +£147 a year) read the interbank series 1 or 2 minutes sooner than the screen has it. That
is *foresight of the next minute's rate*, not a faster feed: there is none to buy (the measured lag is zero), and the rows are
reported only as the most that perfect FX timing could bring, which also cut the trips kept to 70 to 73 %. A sub-minute cadence for the
rule (a different engine) is the only route to part of it, and is not tested here.

## 3. The harness (items 1, 2 and 4) and how it is kept honest

`cbfast.py` imports `cbk.py` (which builds the venue screen's four Coinbase books from minute bars to 2026-10-09) read-only and
runs `gsim`, a line-for-line copy of `pr5_sim.simulate`'s primary arm with four hooks: entry rungs off on a side at a turn, a rung
width multiplier, the stop's age, and a `dark` turn (no fair at all, which is what `stepMinute` does with a null `fairU`). With
no hook `gsim` equals `pr5_sim.simulate` trip for trip (asserted on every book); the base arm reproduces `cbpaper/results/compare.json`
(192.95 / 143.96 / 232.79 / 315.24 £ a year; the run prints it). A guard decides at the start of minute t on data to t−1, as the
turn does, so it cannot see the minute it tries to avoid.

Families (164 variants besides the base, and 2 shifted-FX builds): **g1_dev** the last print against the fair (X 3 to 20 bp, held H 2 to 10
turns, one side or both); **g2_tape** the tape's own move over Z = 1 or 3 minutes (Y 5 to 40 bp); **g4_fair** the fair's move over 1 or
3 minutes (X 3 to 20 bp; withdraw the asks on a rise, the bids on a fall: "never enter an ask when the fair has just jumped");
**wide** rungs 2 or 3 times as far while g1 trips; **g6_stop** the taker stop after 2, 4, 8 or 12 hours; **g3** the calendar
blackout, 45 variants as a pause of entries and 30 as a dark fair; **g5_fx**; **oracle** (look-ahead, not a guard).

Protocol: two spans of a year each, **2024-10-09 → 2025-10-09** and **2025-10-09 → 2026-10-09**; a family's parameters are the best
P&L on one span and are *reported on the other*, both ways round; deltas are against the base arm in the same span, trips counted by
exit; the day-bootstrap is paired (2,000 resamples of the span's days, the guard's daily P&L minus the base's), annualised. Capital
is the screen's £2,400 (4 books × 6 rungs × £100) for the percentages; the paper tests hold £1,200 + €1,200.

## 4. The release calendar (item 2) and its limits

`calendar_events.py` lists US CPI and NFP (08:30 New York), FOMC statements (14:00 New York), ECB decisions (14:15 Frankfurt) and BoE
decisions (12:00 London) from 2024-10-01 to 2026-10-14, as UTC instants through `zoneinfo`. **Sources, honestly:** the Fed's calendar
page and the BoE's page were fetched (the FOMC days are parsed from the first, the BoE's 2026 dates read from the second); the ECB page
lists one date (10 September 2026); **bls.gov and its mirrors were blocked from this machine (HTTP 403)**, so the CPI and NFP dates,
including the 2025 shutdown's delays, are the published schedule *as I recall it*, and the last CPI (2026-10-14) was confirmed by
tradingeconomics. A recalled date can be wrong, so each is checked against the market: the largest 1-minute rate move within ±2 minutes
of the release against the same clock minutes of the ten weekdays either side. Stands out (above the control's 90th percentile):
**CPI 23 of 24, NFP 22 of 24, FOMC 16 of 16, BoE 16 of 16 (on GBP/USD), ECB 12 of 16** (the ECB seldom moves EUR/USD at the minute); the
unconfirmed are listed in `inputs/events.json` and not dropped. The check caught one error: CPI on 2026-02-11 sat on NFP's instant, and
02-13 08:30 stood out (17.5 bp); fixed. Results are given for all releases and for the checked subset (`checked a0 b2` is the best of
that family on both spans: +£27.22 and +£9.82). **For the freeze of any real use, the dates must be confirmed from bls.gov, ecb.europa.eu
and the Fed page by someone who can reach them.**

## 5. Results

**Table A: the best configuration of each family on one span, read on the other** (Δ £ a year against the base in that span;
bootstrap 5th and 95th percentile of the paired difference in brackets for the read span; "positive in both" counts configurations
whose Δ is above zero in both spans).

| family (n) | chosen on 2024-25 | read on 2025-26 | chosen on 2025-26 | read on 2024-25 | positive in both |
|---|---|---|---|---|---:|
| g1_dev (30) | X20 H2 side: −14.52 | −2.37 [−4.8, −0.4] | X20 H10 side: −1.93 | −28.25 [−44.4, −14.2] | 0 |
| g2_tape (32) | Z3 Y40 H3 side: −4.22 | −0.62 [−1.6, +0.3] | Z1 Y40 H3 both: +0.01 | −10.68 [−18.1, −4.9] | 0 |
| g4_fair (16) | m1 X10 H3 side: +1.62 | −1.96 [−4.5, +0.1] | m3 X20 H3 side: −0.18 | −1.04 [−3.5, +1.3] | 0 |
| wide (4) | X10 w3: +13.51 | −4.30 [−10.4, +2.0] | X10 w2: −2.46 | +3.10 [−9.8, +15.9] | 0 |
| g6_stop (4) | 720 min: −25.72 | +1.23 [−5.6, +8.4] | 480 min: +1.53 | −39.02 [−77.3, −6.0] | 0 |
| oracle (3) | Y40: −167.07 | −56.07 [−72.0, −40.3] | Y40: −56.07 | −167.07 [−198.4, −137.6] | 0 |
| g5_fx (2) | 2 min: +147.11 | +46.46 | 2 min: +46.46 | +147.11 | 2 (foresight) |
| **g3 calendar, pause (45)** | checked a0 b2: +27.22 | **+9.82 [+2.3, +18.0]** | checked a0 b2: +9.82 | **+27.22 [+5.5, +52.8]** | **45** |
| **g3d calendar, dark fair (30)** | all a0 b5: +26.54 | **+7.93 [+0.3, +16.0]** | all a0 b2: +9.84 | **+25.96 [+4.3, +51.8]** | **30** |

Reactive families lose in the median (g1 −122 and −12 a year, g2 −29 and −7, g4 −8 and −2): a rule that stops when the market is
moving stops when it is earning; the oracle shows it directly, and a guard that trips on the print against the fair also trips on the
rule's own good minutes. Only the calendar, which knows *when* the shock is and nothing else, is positive in every variant.

**Table B: the blackout I would draft, `g3d_cal all a1 b5`** (both sides' entries off from 1 minute before the release to 5 minutes
after, the fair withheld; `a1` is a margin for a late cron, `b5` is in the flat part of the grid between `b2` and `b15`; neither was
fitted to a number beyond that; the dark minutes are 0.09 % of all).

| | 2024-10-09 → 2025-10-09 | 2025-10-09 → 2026-10-09 |
|---|---:|---:|
| base £ a year (% on £2,400) | 554.64 (23.1 %) | 192.95 (8.0 %) |
| with the blackout | 580.60 (24.2 %) | 200.83 (8.4 %) |
| Δ £ a year, paired bootstrap 5th / 95th | +25.96 [+5.1, +50.7] | +7.89 [+0.2, +16.0] |
| trips (base → blackout), kept | 7,222 → 7,033 (97.4 %) | 2,844 → 2,675 (94.1 %) |
| taker stops | 166 → 163 | 52 → 50 |
| worst day, by exit (five worst) | −7.77 → −5.15 (−7.77 −5.15 −3.71 −2.69 −2.14 → −5.15 −3.71 −2.69 −2.14 −2.08) | −3.61 → −3.61 (−3.61 −2.46 −1.70 −1.39 −1.19 → −3.61 −2.46 −1.43 −1.09 −0.95) |

The same on the weekend hold's books (the "- 2" rule): +25.93 [+5.0, +50.7] and +7.82 [+0.3, +15.9], trips kept 97.7 % and 95.2 %: the
two changes add, as they share no minute.

**Event by event** (the base arm's trips entered in the 7-minute window T−1 to T+5, which the blackout removes): 94 releases in the two years,
**37 where the removed trips lost, 31 where they won, 26 with none** (11 of 16 ECB, 6 of 16 BoE, 5 of 16 FOMC, 4 of 23 CPI); the removed
trips sum to −£32.34, a mean of −£0.344 a release (bootstrap 5th to 95th −£0.60 to −£0.11) against **−£0.012 for the same clock
minutes on the ten weekdays either side** (1,504 windows): the saving belongs to the releases, not to the hour. By kind, £ removed:
NFP −13.01 (13 lost, 10 won), FOMC −10.60 (6, 5), BoE −5.28 (7, 3), CPI −3.84 (10, 9), ECB +0.39 (1, 4). The worst: NFP 2025-08-01 −8.90,
FOMC 2024-12-18 −8.04, NFP 2025-01-10 −3.70, CPI 2025-02-12 −2.63, NFP 2026-07-02 −2.33; the best for the rule, NFP 2025-02-07 +2.96.
**The five worst releases carry 55 % of the avoided loss**, and 20 of 94 lost over £0.50.

## 6. The 10-14 day itself (out of the history's reach, so on the engine's record)

The history's inputs end 2026-10-09, so the day is replayed on the engine's stored minutes (§1) by the same guards
(`cbfast_lit.py`, `results/cbfast_lit.json`). The release minute is the one the blackout removes and no reactive guard can see.

| guard | 10-14 trips (won) | 10-14 £ | entered in the 12:30 minute | whole window 10-11 → 10-15 £ |
|---|---:|---:|---:|---:|
| base (the engine) | 18 (4) | −2.696 | 7, −1.524 | −2.121 |
| **blackout a1 b5, dark fair** (and a0 b2, and as a pause) | 11 (4) | **−1.172** | 0 | **−0.597** |
| g1 deviation X20 H2 side (chosen on 2024-25) | 18 (4) | −2.696 | 7, −1.524 | −2.121 |
| g1 deviation X8 H5 side | 19 (8) | −2.314 | 10, −2.805 | −1.618 |
| g1 deviation X5 H5 both | 4 (2) | −0.226 | 2, −0.503 | +0.426 |
| g2 tape Z1 Y40 H3 both | 18 (4) | −2.696 | 7, −1.524 | −2.121 |
| g4 fair move m1 X10 H3 side | 18 (4) | −2.696 | 7, −1.524 | −2.121 |
| g6 stop at 4 h / at 8 h | 18 (4) | −2.839 / −2.639 | 9 / 8 | −2.481 / −2.130 |
| wide X10 w3 | 18 (5) | −3.202 | 8, −2.074 | −2.627 |
| oracle: withdraw every minute with range over 20 bp (look-ahead) | 9 (2) | −1.449 | 0 | −1.167 |

The blackout saves £1.52 of £2.70; the other £1.17 is the carried inventory, which no guard here touches (a shorter stop made 10-14
worse and lost £25 to £53 a year in 2024-25). The one reactive row that looks good on this day, g1 X5 H5 both, keeps 10 of 28 trips and
was −£278 a year in 2024-25 and −£52 in 2025-26: a guard fitted to one day. **10-14 is a bad day for the rule but not off its scale: it would be the second worst
of the 12 months to 10-09** (those days: −3.61, −2.46, −1.70) and costs about five days of the rule's average profit (£0.53 a day).

## 7. Is a "- 3" row worth it?

For the blackout, no, for two reasons that do not depend on how good it is:

* **Size.** +£7.9 to +£26 a year on £2,400, 0.3 to 1.1 % a year, 4 to 5 % of the rule's profit. It costs a migration, five tables, an
  Edge call, a cron row, a page row and a pre-registration.
* **A window cannot read it.** The next 28 days hold about five releases (FOMC 10-28, ECB 10-29, BoE 11-05, NFP 11-06 and the October CPI,
  whose date I could not confirm). Resampling the 94 releases, five of them sum to +£1.7 avoided with a 5th to 95th percentile of
  −£1.8 to +£9.0: the sum is positive 69 % of the time if the history's effect is real and 36 % if it is zero (the distribution is skewed). With
  13 releases (84 days) those become 82 % and 41 %; with 26, 91 % and 45 %. A pass bar on the money would be a coin toss.

What a paper arm *can* establish is that the blackout is implemented as designed (bar 1 below: the replay reproduces it; no order or
fill in a blackout minute) and what the paired difference to the base is, reported and not barred. That is a thin return for the
machinery, so my recommendation is: **do not open "- 3" now; keep the draft below; if the 11-08 / 11-10 readings fund an arm, make the
blackout a day-one rule of it** (it needs no data the history lacks and was positive in every variant tried), or ask Davies for a
decision on adopting it without a window, since its evidence is 94 releases. If he prefers a row anyway, §8 is the one-page
pre-registration, spec and code change. The other Davies-proposed fixes are closed: a faster FX feed (§2), a fair-vs-print pause,
widening after a jump and "no asks after the fair moved" (§5, all negative).

What this does not do: hedge the carried inventory. Five of 18 trips (£1.33 of the £2.70) lost to currency drift on inventory held for
up to 17 hours; any cure is a different rule (hedge or net the dollar exposure, or exit the inventory at the entry's FX), not a guard.

## 8. Draft for a "Stablecoin quotes with Euros - 3" (unbuilt; text only, not a frozen file)

### 8.1 Pre-registration (the variant shape, one page)

> **DRAFT. Not frozen. It freezes only at the commit that adds it as its own file with `cb_blackout.ts`, `0119_cb_blackout.sql` and
> `cb_blackout.test.ts`, and only on Davies' word.** The test it varies is "Stablecoin quotes with Euros" (`2026-10-10-coinbase-paper-prereg.md`,
> its Deviations 1 and 2), which it does not touch.
>
> **0. On whose word.** Davies, 2026-10-15: "stablecoinwitheuros的两个策略怎么今天亏了，有问题就修复改好" (the study that recommends this
> variant is `2026-10-15-coinbase-fast-move.md`, §5 to §7). Name: **"Stablecoin quotes with Euros - 3"**. A paper test: nothing trades.
>
> **1. The one change.** In the minutes from 1 minute before to 5 minutes after (inclusive, `[T−1, T+5]` by minute start) each scheduled
> release `T` in a list frozen with the file (`CB_RELEASES`: US CPI and NFP 08:30 New York, FOMC statements 14:00 New York, ECB decisions
> 14:15 Frankfurt, BoE decisions 12:00 London, as UTC instants, from the window's start to 2027-01-31), the minute's `fairU` is null: every
> entry rung is withdrawn and exit orders are neither placed nor re-priced, as in any dark minute (`stepMinute`, unchanged). Everything else
> is the base test's: the same four books, the same recorded prints, ten-minute interbank lookback (not the hold), £100/€100 a rung, the same
> stop, the same pounds. The minute's stored `fair` is null, so `cbpaper/scripts/replay.py` replays it unchanged.
>
> | | base | "- 3" |
> |---|---|---|
> | minutes in a release window | decided as any | fair null (≈ 0.09 % of minutes) |
> | tables / call / lease | `cb_quote_*` / `cbrec` | `cb_blackout_*` / `cbblackout`, own `edge_calls` row, `retry` true / `cb-blackout` |
> | window | 2026-10-11 | 28 UTC days from the first 00:00 UTC after its first run |
>
> **2. Why.** `cbfast.py`, in sample: with this blackout (`g3d_cal all a1 b5`) the rule makes +£25.96 a year more over 2024-25 and +£7.89 over
> 2025-26 (paired bootstrap 5th percentile +5.1 and +0.2), keeping 97 % and 94 % of its trips; the released minutes lose on average £0.34 and the same
> clock minutes on other days £0.01. On 2026-10-14 it would have turned −£2.70 into −£1.17.
>
> **3. Window, reading and bar.** Window: 28 UTC days from `cb_blackout_state.state.startedAt` (about five releases; the report counts them). Reading: the day
> after the window's 28th day from 00:30 UTC, by `docs/agents/backtests/cbreview/scripts/replay_bo.py` (a copy of `cbwk`'s `replay_wk.py` on this arm's
> tables), not blind. **Bars (mechanical):** (1) *Faithful*: the replay reproduces the arm's trips to within 5 % in number and 10 % in money. (2) *The blackout
> holds*: in every minute of a release window the arm has no order placed and no fill (zero entry events in those minutes). **Reported, not barred**: the
> paired difference to the base arm on the same prints (the base arm is the same minute record with the blackout minutes undarkened: the base test's rule),
> per release; the trips removed; the stops. *There is no bar on the money*: five releases cannot decide it (§7), and a bar set after seeing the window would be
> a new pre-registration. **If bars 1 and 2 pass,** the blackout is *implemented correctly* and its worth stays the history's; adopting it in a funded arm is Davies' call.
>
> **4. Its record before now.** None. **5. Frozen files.** `cb_blackout.ts`, `cb_blackout.test.ts`, `0119_cb_blackout.sql`, `replay_bo.py`, with their sha256 in a
> `MANIFEST.json`; the base test's files unchanged. **6. Disclosures.** Every figure in §2 was seen: `cbfast.py` was run on 2026-10-15, in sample, on data to
> 2026-10-09; the day 2026-10-14 was seen. The release dates for CPI and NFP are recalled, not fetched, and **must be confirmed from bls.gov before the freeze.**

### 8.2 Spec (what the arm is made of)

| piece | what |
|---|---|
| engine | `stepMinute` as it stands; the driver is `runCbQuotes`'s steps (as `cb_hold.ts`), one difference: `fairU` is null in a release window |
| inputs | the recorder's prints (`cb_trades`), PR5's stored GBP/USD and hourly closes, EUR/USD from `cb_quote_inputs` (read, not fetched): the same dependencies as "- 2", same stated risk |
| fx lookback | `QUOTE_FX_LOOKBACK_MS` (ten minutes), via the base's `fxBarAt`: the blackout is the *only* change from the base |
| calendar | `CB_RELEASES`, a sorted array of ISO UTC instants with `kind` for the page, frozen; `cbInBlackout(t, releases, lead = 1 min, trail = 5 min)` |
| tables | `cb_blackout_state/events/trips/minutes/days`, same shape as `0118_cb_hold.sql` (`create table … like` its columns) |
| call | `agents?action=cbblackout`, a row of `edge_calls` (retry true, no `active_from`), prune cron minute not divisible by 5 and unique, lease `cb-blackout` |
| page | TESTING row right after "- 2" (`CB_BLACKOUT_ROW_NAME`), Coinbase card totals, `cb_page.ts`'s `readCoinbaseArm` with the new tables, `db.ts` paged keys |
| migration | `0119` (0117 is main's repair, 0118 the hold) |

### 8.3 Code change (sibling arm, frozen files untouched)

`supabase/functions/agents/cb_blackout.ts` is `cb_hold.ts` with the hold removed and the blackout added. The whole of the difference in the
minute loop:

```ts
export const CB_BLACKOUT_LEAD_MS = 1 * M, CB_BLACKOUT_TRAIL_MS = 5 * M;
export function cbInBlackout(t: number, releases: readonly number[], lead = CB_BLACKOUT_LEAD_MS, trail = CB_BLACKOUT_TRAIL_MS): boolean {
  // releases sorted ascending: the first release at or after t − trail; the minute is inside when it starts no later than t + lead
  let lo = 0, hi = releases.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (releases[mid] >= t - trail) hi = mid; else lo = mid + 1; }
  return lo < releases.length && releases[lo] <= t + lead;
}
// in the per-book minute loop, after cbMinuteInputs:
const bar = fxBarAt(t, gbpBars), eb = fxBarAt(t, eurBars);                 // the base test's ten-minute lookback
const io = cbMinuteInputs(b, bar ? bar[1] : null, eb ? eb[1] : null, median(window));
const dark = cbInBlackout(t, CB_RELEASE_MS);
const inp: MinuteInputs = { x: io.x, fairU: dark ? null : io.fairU, prints: mine };
```

`cbMinuteRow` stores `fair` null in a blackout minute (it stores `inp.fairU`), so the record is the engine's decision input and
`replay.py` reproduces it. Tests (`cb_blackout.test.ts`): (1) `cbInBlackout` at each edge (T−1 min inside, T−2 min out, T+5 min inside, T+6 min
out; two releases a day apart; the empty list); (2) with an empty release list the arm's rows equal the base arm's on one synthetic world (every
table); (3) in a blackout minute the rungs are withdrawn and an exit order stays where it was; (4) a world with a release in it: no entry fill in
the window, entries resume no earlier than T+7 (the rung is placed at T+6 and live a minute later); (5) `CB_RELEASES` is sorted, UTC, inside the window and 2027-01-31, with the kinds of §1; (6) a counterfactual
that removes the `dark` line leaves a fill in the window and fails (4). Plus the docs (`docs/map.md` rows, `docs/guide.md` line, the TESTING
row), `src/` for the page row with `dist/`, the browser fixture, and a ledger line.

## 9. Reproducing, and what was not checked

Order (all `python3 -I`, from `docs/agents/backtests/cbreview/scripts/`, keyless and read-only): `pull_cb_candles.py` (public Coinbase
candles; about 2 minutes), `calendar_events.py`, `fxlag.py`, `cbfast.py stage1` (about 25 minutes on four cores → `results/cbfast_grid.json`),
`cbfast_events.py` (3 minutes → `results/cbfast_events.json`), `cbfast_lit.py "config" …` (→ `results/cbfast_lit.json`; the default is the base).
`pack_lines_1014.py` packs the two exports of `sql/export_lit_lines_1012_1014.sql`; `inputs/trips_to_1014.json` is `sql/export_trips_to_1014.sql`.

Not checked or not possible:

* **The BLS dates** (CPI, NFP) are recalled, validated by the market's move at each minute (§4), not read from a source; the ECB's other dates
  likewise. Anything built on the calendar must confirm them first.
* **The history ends 2026-10-09**; 10-14 is covered only on the engine's record, three days (10-11 23:01 to 10-15 00:00), by replay.
* **Coinbase-implied EUR/USD** uses USDT-USD over USDT-EUR candle closes, and USDT-EUR prints in about half the minutes: the lag statistics are on
  forward-filled (five minutes at most) minutes. GBP/USD was not compared with an exchange-implied rate (no matching product), only the euro leg.
* **The hold arm's 10-14 and the Revolut X day** were taken from the main session, not recomputed; the PR5 live book was not looked at.
* **Fills are the screen's through-fills** (strictly through, 10 % volume cap, £100 a rung, 0 % maker): the same approximation as every `cbk`
  figure, and the 10-14 replay shows it matches the engine to the penny on that record.
* **The pause family** (entries off, exits still re-priced) is not what the frozen `stepMinute` can do; it is in the grid beside the dark one and
  is within 0.5 £ a year of it.
* **Sub-minute cadence and an FX hedge** were not tested; they are the only things that could reach the rest of 10-14.
* **The grid's parameters were chosen on one span and read on the other, but both spans were seen**: the 164 variants are not a pre-registration.
