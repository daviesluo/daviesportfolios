# PR5's rules: is LIVE running the best known set, and what to test next (2026-10-27)

Davies, 2026-10-27: "你在做一些策略优化的研究，看看目前live的策略是所有已知信息和推算所得出的最佳rules吗，还有没有哪些可以优化的地方，还有哪些可以值得研究和测试的地方（比如每个%不同的档挂单钱数不同？不同的档位%？不同的细分rules等等）".
"Stablecoin quotes LIVE" is moving the same day from £120 (£10 a rung) to £600 (£50 a rung).

**Not blind, and no reading.** Every record was read for research (no no-peek rule since 2026-10-04). No pre-registered reading
was run or pre-empted: PR5V and rule D (10-28), QUEUE (11-02), TAKE (to 11-30), the LIVE-rule size twins (11-11), the LIVE twin
(11-23) and PR5-W (11-25) run as written. Each should name this review as a further non-blind read. Nothing was changed in
production: no order, no config row, no twin, no engine, no migration and no frozen file. The twins in §4 are specs for the main
session to build, on Davies' word.

**Public repository.** LIVE appears here only in bps of its own capital and in counts. Every pound figure is a replay's or a twin's
(paper money).

**Sources.** Production read 2026-10-27 03:07–03:45 UTC, SELECT only (`backtests/pr5_opt/sql/pulls.sql`): PR5's stored minutes
(X and fairU for every minute since 09-25 00:05) and every stored UK print to 10-27 00:00, md5-checked into `backtests/pr5_opt/data/`.
LIVE's filled orders are the 2026-10-26 review's committed pull (`backtests/scq_review/2026-10-26/data/live_orders.json.gz`). The
committed nine-month tape (`backtests/inputs/pr5_2026-09-23`) is read through `scripts/pr5/pr5_sim.py`. Every script and result is
in `backtests/pr5_opt/` (`MANIFEST.json`).

**One correction to the brief.** LIVE re-prices at **0.05 %**, not 0.03 %: `QUOTE_REPRICE = 0.0005` in `agents/quotes.ts`, and the
executor's exit step is the same constant (`QUOTE_LIVE_INSTANCE.exitReprice`). 0.03 % is rule D's and PR5V's step.

## 0. Answers first

1. **LIVE's rules are the best known on most counts, but not on two that were never tested: how the capital is split.**
   - Every rule that was tested before (rungs, re-price, exit, stop, guards, weekend) still holds up when it is re-tested here.
   - Two choices were never tested at all:
     - **equal pounds in every rung**: capital ÷ 12, the executor's `rungGbp`;
     - **a £0.10 fill makes a rung "held"**: the venue's minimum order, used as the executor's dust line.
   - Both now look improvable:
     - USDT-GBP earns about 1.4–2.2× what USDC-GBP earns per pound, on every record;
     - since 10-08 a bot has printed about 450 £0.10 trades a day on USDT-GBP. 142 of LIVE's 232 USDT-GBP entry fills since then
       were under £1, and each one withdrew the rest of its rung's order.
   - The rung distances were chosen by PR3 on 13 days of the tight market and never optimised since. They are close to the best,
     but the 0.3 % rung earns the least per pound.
2. **Candidates replayed: 55.** Each was replayed LIVE-realistic at £600 (LIVE's fill rule, sizes as LIVE would fill them, weekends
   on) on three records under up to three fill rules (§3).
   - **Robust on every record:** putting more of the £600 on USDT-GBP. At 2:1 the gain is +1.24 bps of capital a day (90 % +0.35 to
     +2.24) on PR5's own record, +0.51 on the four weeks before it, and +5.03 over nine months. It was ahead in 39 of 39
     weeks of the long tape.
   - **Good, with a fatter tail:** moving the 0.3 % rungs' money to 0.1 % and 0.2 % (£75 / £75 / £0). +1.15 a day on PR5's record,
     +0.99 before it, +1.26 over nine months, but behind in 8 of 39 weeks: the 0.3 % rungs are what earn on the rare wide day.
   - **LIVE-specific:** a rung that holds under £1 keeps its entry resting. +0.48 a day under LIVE's own fill rule since the bot
     appeared, nothing before it.
   - **Not worth it:** wider or 4-rung ladders, outer-weighted sizes, a different re-price step, an exit away from fair, a shorter
     stop, time-of-day or release blackouts, inventory skew, a basis-adjusted fair, a tighter de-peg guard, and anything that
     narrows or widens the weekend.
   - **Strongly confirmed:** the weekend. Switching it off costs −5.4 bps of capital a day.
3. **Recommended twins: three, each one change against the £600 LIVE-rules twin (`live600`), 28 days each** (§4):
   - **T1 `live600usdt2`**: USDT-GBP rungs £66.67, USDC-GBP £33.33;
   - **T2 `live600no03`**: no 0.3 % rungs, £75 on each of the other eight;
   - **T3 `live600hold1`**: a rung holding £1 or less is not "held".
   - T1 and T2 need one small rule extension (`weights`), T3 another (`holdMin`). LIVE's own instance does not change.
   - Build them after the 10-28 readouts retire `pr5`, `p50` and `d`, so the twins' 12 s call budget has room.

## 1. The tool: a LIVE-realistic replay, and how far to trust it

`backtests/pr5_opt/scripts/sim.py` has two layers, as production has them.

**The paper engine.** `stepMinute` line for line, from the 2026-10-18 review's `replay.py`, with a few added knobs.
- On this pull it reproduces **all 273 of PR5's paper trips** entered 09-26 → 10-26, closed by 10-27: same book, side, rung, entry
  and exit minute, +$18.8879 both, 4 stops both (`results/check_paper.json`).

**The executor.** As the LIVE twin simulates it (`quotes_live.ts` on `revx_sim.ts` with `fill` "at"):
- It turns once a minute, 30 s into the minute after the paper minute it carries out.
- A flat rung rests the paper rung's entry while the paper rung quotes.
- **Fills:**
  - a print through the price fills it, and so does a print at it whose aggressor is on the other side;
  - each fills by the print's own quantity, shared best price first. A £50 rung therefore fills in part more often than a £10 one.
- **Holding:**
  - any fill over £0.10 of coin makes the rung held, and the rest of its entry is withdrawn at the next turn;
  - the exit rests at fair for the whole holding, re-priced past 0.05 %;
  - the 24-hour stop is a taker at the last print;
  - the GBP-print de-peg guard is applied.
- **Weekends:** quoted on the held X (PR5-W's rule, LIVE's `weekend_mode` 'live').
- **Left out:**
  - the governor (LIVE sends about 283 POSTs a day against 900);
  - the daily loss stop (no replayed day comes near −1 %);
  - the USD-book half of the de-peg guard (the hourly closes are not in the minute record);
  - the asks' coin (assumed there, as the executor tops it up);
  - venue outages and the dead-man.

**Calibrated against LIVE's own life at £10 a rung, 10-02 → 10-26** (`scripts/calibrate.py`, `results/calibration.json`):

| fill rule | sim ÷ LIVE, all days | sim ÷ LIVE, clean days | daily correlation with LIVE |
|---|---|---|---|
| "at" (LIVE's own rule, the LIVE twin's) | 1.42 | **1.20** | 0.94 |
| "at", a queue taking half of every at-price print | 1.41 | 1.20 | 0.94 |
| "through" (PR5's paper rule) | 1.10 | **0.91** | 0.92 |

- **"Clean"** leaves out LIVE's four operational days:
  - 10-02, the database stall and the go-live conversions;
  - 10-07, the governor at 950 and the dead-man cancels;
  - 10-08, the stops of what 10-07 left held;
  - 10-20, Revolut X's 6 h 25 min outage.
  - On those four days the replay made 50 of its 74 bps over LIVE.
- **So LIVE sits between "at" and "through"**, closer to "at". Every candidate below is run under both, and under the half-queue
  as well.
- **Levels in this review are about 20 % above LIVE's.** Differences between candidates are what the review uses.

**The records.**
- **FWD:** PR5's own record, 2026-09-26 → 10-27. 31 days and five closures, with the £0.10 bot from 10-08.
- **HIST:** the committed tape, 08-26 → 09-23. 28 days of the tight market before the bot.
- **LONG:** the committed tape, 01-01 → 09-23. 265 days, mostly the wide market before 08-24. A sign check only.

**Statistics.**
- Each candidate is paired with LIVE's rules by day: realised by exit day, and a holding at the end marked at the last print.
- The interval is a circular 3-day block bootstrap, 10,000 resamples, seed 20261027, 90 % band.
- Also reported: the two halves of FWD, week by week (`scripts/robust.py`), and drawdown on the rungs' holdings marked at each
  midnight.

**The verdict rule was written before the first full run.**
- **BETTER:** ahead on FWD under all three fill rules, on HIST under both, in both halves, with FWD's bootstrap at most 10 % at or
  below 0, and LONG not behind.
- **WORSE:** behind on FWD "at", FWD "through" and HIST "at".
- **UNCLEAR:** anything else.
- The rows marked "added after the first run" in `experiments.py` were added after the first printout and are labelled so.

## 2. Rule by rule: what chose it, and whether it still holds

| LIVE's rule | chosen by | tested since live data? | this review | verdict |
|---|---|---|---|---|
| Revolut X USDC-GBP and USDT-GBP, 0 % maker | first-principles search (reference §3.26), PR5 on 9 months (§3.27) | 10-18 replay: either book alone is worse | both books stay; per pound USDT earns 1.4–2.2× USDC on every record | **keep both, weight USDT (T1)** |
| **equal size in every rung** (capital ÷ 12) | the executor's design ("equal slots"); never tested | **no** | USDT 2:1 better on every record and in 39 of 39 long-tape weeks; inner-weighted sizes unclear; outer-weighted worse | **thin: test T1** |
| fair = USD book's 24 h median of UK hourly closes ÷ Yahoo GBP/USD | matching PR3's fair (PR5 study: 94.7 / 86.8 % of minutes), not optimised | fast-X study (09-28): a faster X is worth ~0; 10-18 nothing | a basis-adjusted fair (the book's own 24 h median gap to fair) is worse at ½ and full weight | keep |
| rungs 0.1 / 0.2 / 0.3 % | **PR3 on 13 days** of the tight market; PR5 passed them on the wide market, which preferred 0.15–0.20 % | PR5V (09-28): 0.05–0.15 % earn most per $ alone; 10-18: nothing better per pound | 0.3 % rung weakest per pound in the tight market; £75/£75/£0 +1.15 bps/day; wider, 0.4 % and "Davies' 0.075/0.15/0.25/0.4" worse; 0.05 % inner rungs flip sign on LONG | **thin: test T2**; distances otherwise kept |
| exit at fair, rounded in the position's favour | PR3/PR5, frozen | F3 replay (10-09), 10-18: an offset's sign flips | a tick inside fair: worse on every record; a tick beyond: +0.34 "at", −0.28 "through" | keep |
| re-price 0.05 % (entries and exits) | PR3's, frozen | PR5V: 0.05 % best for this set; 10-18 and the 10-21 budget draft: same | 0.03 % and 0.10 % worse, entries or exits alone or both | keep |
| 24-hour taker stop (IOC within fair ± 50 bps) | live design | 10-18: no effect | 6 h and 12 h worse; 48 h or none +0.23 bps/day, P≤0 0.07 | keep (the gain is a rounding error against the tail it removes) |
| daily loss stop −1 % of capital | live design | never reached (worst LIVE day −0.19 %) | not binding in any replay | keep |
| de-peg guard 50 bps | live design | fired on 10-20 | 25 bps costs −0.18/day (−4.8 on LONG); 100 bps changes nothing | keep |
| governor 900 / 950 POSTs | design, Davies (10-01) | LIVE ~283 POSTs a day | not binding at any size (size changes no order count) | keep |
| placement ~30 s into the minute | the executor | 10-21: earlier is worse (0 s −£0.25, 10 s −£0.20 on LIVE's replay) | 10 s ≈ 30 s here | keep |
| **a fill over £0.10 makes the rung held** | the venue's minimum (`dustBase`); never a choice | **no** | the £0.10 bot since 10-08: 142 of 232 USDT entry fills under £1 (§3.4); hold-min £1 +0.48/day under "at" | **test T3** |
| weekend quoting on the held X | PR5-W (10-18 replay: 37 of 38 weekends), live since 10-23 | first live weekend 63 bps of capital | off: −5.41 bps/day on FWD, −2.05 HIST, −6.23 LONG; rungs ×1.5 or ×0.75 at weekends worse | **keep: the strongest rule** |
| take (in shadow) | TAKE pre-registration | variant-3 (`take50`) ~33 % ahead of `p50` per pound (10-26); LIVE's shadow: 0 events in five weekdays | not replayable here (needs the recorded books) | TAKE's reading decides |
| capital £600 (£50 a rung) | 10-26 review; Davies | `live600` twin, bar 11-11 | per pound £300 0.92×, £600 0.85× ("at") / 0.86× ("through") of £120; £1,200 0.75× | consistent with `live600`'s 80 % bar; it decides |

## 3. Every candidate, replayed

LIVE's rules at £600, one change at a time; bps of capital a day; "vs" is the paired difference against LIVE's rules
(`results/experiments.json`, `results/table.md`, `results/robust.json`). Trips, win rate, stops and drawdown are FWD under "at".
"MTM max DD" marks the rungs' holdings at each midnight; the asks' coin inventory is the same in every row and left out.

| candidate | verdict | FWD at: bps/day | vs LIVE rules (90 %), P≤0 | halves | FWD at50 / through | HIST at / through | LONG | trips (won) | stops | worst day, MTM max DD (bps) |
|---|---|---|---|---|---|---|---|---|---|---|
| **LIVE's rules at £600 (base)** | — | 12.98 | — | — | 12.98 / 10.27 | 6.64 / 5.33 | 33.70 | 502 (95 %) | 3 | 0.65, 0.00 |
| **book_usdt_2to1** | BETTER | 14.22 | +1.24 (+0.35 to +2.24), 0.010 | +1.31 / +1.18 | +1.15 / +1.22 | +0.51 / +0.37 | +5.03 | 497 (95 %) | 3 | 0.73, 0.00 |
| book_usdt_3to2 | BETTER | 13.74 | +0.76 (+0.26 to +1.31), 0.006 | +0.80 / +0.72 | +0.74 / +0.71 | +0.33 / +0.23 | +3.14 | 499 (95 %) | 3 | 0.88, 0.00 |
| book_usdt_3to1 | BETTER | 14.62 | +1.64 (+0.41 to +3.04), 0.014 | +1.83 / +1.46 | +1.64 / +1.77 | +0.73 / +0.54 | +7.21 | 496 (95 %) | 4 | 0.55, 0.00 |
| book_usdt_only | BETTER | 15.36 | +2.38 (−0.15 to +5.14), 0.060 | +2.77 / +2.02 | +2.42 / +3.02 | +1.10 / +0.77 | +12.43 | 326 (97 %) | 3 | −2.34, 2.34 |
| book_usdc_2to1 (control) | WORSE | 11.58 | −1.40 (−2.39 to −0.51), 0.996 | −1.40 / −1.40 | −1.46 / −1.54 | −0.57 / −0.50 | −5.93 | 505 (95 %) | 3 | 0.27, 0.00 |
| book_usdt_2to1_inner | BETTER | 14.52 | +1.54 (+1.01 to +2.10), 0.000 | +1.36 / +1.71 | +1.47 / +1.90 | +1.09 / +0.54 | +4.55 | 492 (95 %) | 4 | 1.10, 0.00 |
| **size_75_75_0** (0.3 % rungs' money to 0.1 / 0.2 %) | BETTER | 14.13 | +1.15 (−0.17 to +2.32), 0.075 | +1.14 / +1.15 | +0.99 / +1.09 | +0.99 / +0.47 | +1.26 | 447 (95 %) | 3 | −0.17, 0.34 |
| size_inner_75_50_25 | UNCLEAR | 13.52 | +0.54 (−0.29 to +1.22), 0.131 | +0.26 / +0.80 | +0.40 / +0.67 | +0.77 / +0.34 | +0.06 | 487 (95 %) | 3 | −0.18, 0.35 |
| size_inner_100_50_0 | UNCLEAR | 13.91 | +0.93 (−0.67 to +2.25), 0.151 | +0.38 / +1.44 | +0.69 / +1.34 | +1.43 / +0.60 | −0.21 | 439 (94 %) | 3 | −1.84, 2.06 |
| size_0.1_only | UNCLEAR | 13.19 | +0.21 (−2.08 to +2.25), 0.431 | −0.86 / +1.21 | −0.29 / +1.37 | +2.02 / +0.66 | −4.13 | 339 (93 %) | 2 | −2.28, 2.62 |
| size_outer_25_50_75 | WORSE | 12.19 | −0.79 (−1.51 to +0.00), 0.949 | −0.39 / −1.16 | −0.80 / −1.02 | −0.84 / −0.44 | −0.57 | 513 (96 %) | 3 | 0.33, 0.05 |
| rungs_0.1_0.2 (engine; = size_75_75_0) | BETTER | 14.13 | +1.15 (−0.17 to +2.32), 0.075 | +1.14 / +1.15 | +0.99 / +1.09 | +0.99 / +0.47 | +1.26 | 447 (95 %) | 3 | −0.17, 0.34 |
| rungs_0.1_0.15_0.2_0.3 | BETTER | 13.74 | +0.76 (+0.29 to +1.20), 0.004 | +0.88 / +0.64 | +0.68 / +0.41 | +0.28 / +0.16 | +1.57 | 646 (95 %) | 3 | 0.83, 0.41 |
| rungs_usdc_0.075_0.15_0.25 (per-book k) | BETTER | 14.25 | +1.27 (+0.45 to +2.11), 0.005 | +0.99 / +1.53 | +1.16 / +0.70 | +0.56 / +0.19 | +0.94 | 569 (95 %) | 3 | 0.43, 0.00 |
| rungs_0.08_0.15_0.25 | BETTER | 13.93 | +0.95 (−0.04 to +2.01), 0.057 | +0.75 / +1.14 | +0.79 / +0.03 | +0.11 / +0.15 | +0.13 | 620 (94 %) | 2 | −6.70, 6.95 |
| rungs_0.075_0.15_0.3 | UNCLEAR | 13.55 | +0.57 (−0.39 to +1.60), 0.178 | +0.54 / +0.59 | +0.50 / −0.14 | +0.65 / +0.26 | −2.92 | 632 (94 %) | 2 | −3.72, 3.97 |
| rungs_0.05_0.1_0.2 | UNCLEAR | 14.34 | +1.36 (−0.59 to +3.12), 0.121 | +0.35 / +2.29 | +1.03 / +0.49 | +2.15 / +0.77 | −4.15 | 914 (90 %) | 4 | −0.47, 0.58 |
| rungs_0.05_0.1_0.2_0.3 | UNCLEAR | 13.31 | +0.33 (−0.69 to +1.34), 0.300 | −0.44 / +1.06 | +0.18 / −0.20 | +1.26 / +0.39 | −3.96 | 955 (91 %) | 4 | 1.92, 0.00 |
| rungs_usdt_0.075_0.15_0.25 | WORSE | 12.88 | −0.10 (−1.27 to +0.98), 0.545 | +0.21 / −0.40 | −0.17 / −0.62 | −0.15 / −0.10 | −1.29 | 579 (95 %) | 2 | −6.38, 7.07 |
| rungs_0.15_0.25_0.35 | WORSE | 11.76 | −1.23 (−2.77 to +0.35), 0.894 | −1.05 / −1.40 | −1.44 / −1.36 | −1.94 / −1.44 | −1.36 | 267 (97 %) | 2 | −0.81, 0.55 |
| rungs_0.1_0.2_0.3_0.4 | WORSE | 11.41 | −1.57 (−2.14 to −0.87), 0.999 | −1.53 / −1.60 | −1.53 / −1.37 | −1.43 / −1.18 | −5.08 | 526 (96 %) | 3 | 0.49, 0.00 |
| rungs_0.075_0.15_0.25_0.4 | WORSE | 12.27 | −0.71 (−1.73 to +0.39), 0.853 | −0.82 / −0.60 | −0.76 / −1.32 | −1.08 / −1.09 | −5.14 | 675 (95 %) | 2 | −5.26, 5.59 |
| rungs ×1.5 inside closures | WORSE | 11.75 | −1.23 (−2.17 to −0.35), 0.991 | −1.66 / −0.83 | −1.32 / −1.01 | −0.30 / −0.33 | −1.42 | 439 (95 %) | 2 | 0.00, 0.00 |
| rungs ×0.75 inside closures | WORSE | 12.62 | −0.36 (−1.00 to +0.17), 0.847 | −1.01 / +0.24 | −0.46 / −0.23 | −0.10 / −0.21 | −0.14 | 509 (96 %) | 3 | 1.10, 0.00 |
| exit a tick inside fair | WORSE | 11.85 | −1.13 (−1.48 to −0.79), 1.000 | −1.10 / −1.16 | −1.11 / −0.36 | −0.75 / −0.21 | −2.24 | 502 (95 %) | 1 | 0.54, 0.11 |
| exit a tick beyond fair | UNCLEAR | 13.32 | +0.34 (−0.16 to +0.80), 0.132 | +0.42 / +0.26 | +0.17 / −0.28 | +0.27 / +0.17 | +1.97 | 479 (95 %) | 6 | 1.10, 0.00 |
| exit 1 tick inside after 2 h | UNCLEAR | 12.84 | −0.14 (−0.24 to −0.05), 0.997 | −0.13 / −0.15 | −0.14 / +0.01 | −0.18 / +0.08 | −0.39 | 500 (96 %) | 3 | 0.65, 0.00 |
| exit 2 ticks inside after 6 h | UNCLEAR | 12.95 | −0.03 (−0.15 to +0.12), 0.659 | −0.13 / +0.07 | −0.02 / −0.09 | +0.00 / −0.03 | −0.25 | 502 (95 %) | 2 | 1.10, 0.00 |
| exits re-priced at 0.03 % | UNCLEAR | 12.76 | −0.22 (−0.59 to +0.14), 0.832 | −0.13 / −0.31 | −0.22 / +0.13 | −0.15 / −0.04 | −0.35 | 495 (96 %) | 4 | 0.65, 0.00 |
| exits re-priced at 0.10 % | WORSE | 12.34 | −0.65 (−1.03 to −0.28), 0.999 | −0.52 / −0.76 | −0.63 / −0.47 | −0.27 / −0.09 | +0.01 | 489 (95 %) | 5 | 0.65, 0.00 |
| re-price 0.03 % (engine) | WORSE | 12.61 | −0.37 (−1.17 to +0.42), 0.768 | −0.44 / −0.30 | −0.82 / −0.30 | −0.47 / −0.96 | −0.38 | 458 (96 %) | 3 | −2.82, 4.03 |
| re-price 0.10 % (engine) | WORSE | 11.47 | −1.51 (−2.62 to −0.48), 0.996 | −2.09 / −0.97 | −1.67 / −0.53 | −0.98 / −1.03 | −0.80 | 461 (93 %) | 5 | −0.35, 0.00 |
| stop 6 h | WORSE | 11.59 | −1.39 (−2.06 to −0.78), 1.000 | −1.37 / −1.41 | −1.37 / −1.70 | −0.41 / −0.62 | −3.29 | 502 (92 %) | 35 | −0.13, 0.00 |
| stop 12 h | WORSE | 12.70 | −0.29 (−0.73 to +0.07), 0.912 | −0.05 / −0.51 | −0.27 / −0.43 | −0.28 / −0.41 | −1.05 | 502 (94 %) | 15 | −0.02, 0.00 |
| stop 48 h | BETTER | 13.21 | +0.23 (+0.00 to +0.61), 0.070 | +0.42 / +0.05 | +0.23 / +0.21 | +0.08 / +0.08 | +0.30 | 501 (96 %) | 0 | 0.90, 0.00 |
| no stop | BETTER | 13.21 | +0.23 (+0.00 to +0.61), 0.070 | +0.42 / +0.05 | +0.23 / +0.21 | +0.08 / +0.09 | +0.33 | 501 (96 %) | 0 | 0.90, 0.00 |
| release blackout T−1 → T+5 min | UNCLEAR | 13.29 | +0.31 (+0.00 to +0.91), 0.109 | +0.01 / +0.59 | +0.30 / +0.30 | −0.06 / −0.06 | −0.02 | 499 (96 %) | 3 | 0.65, 0.00 |
| release blackout T−5 → T+30 min | UNCLEAR | 13.28 | +0.30 (−0.01 to +0.91), 0.353 | −0.01 / +0.59 | +0.30 / +0.30 | −0.12 / −0.14 | −0.11 | 498 (96 %) | 3 | 0.65, 0.00 |
| weekend off | WORSE | 7.57 | −5.41 (−8.60 to −2.47), 1.000 | −6.58 / −4.31 | −5.48 / −4.65 | −2.05 / −1.69 | −6.23 | 341 (94 %) | 2 | 0.00, 0.00 |
| no entries Sun 19:00–21:00 (before the reopen) | WORSE | 12.75 | −0.23 (−0.60 to −0.00), 1.000 | −0.41 / −0.06 | −0.23 / −0.23 | −0.23 / −0.20 | −0.21 | 498 (95 %) | 3 | 0.65, 0.00 |
| no entries 00:00–07:00 UTC | WORSE | 11.16 | −1.82 (−2.98 to −0.86), 1.000 | −2.78 / −0.91 | −1.88 / −1.90 | −0.70 / −0.71 | −4.39 | 418 (96 %) | 1 | 0.65, 0.00 |
| de-peg guard 25 bps | WORSE | 12.80 | −0.18 (−0.40 to +0.02), 0.925 | −0.05 / −0.30 | −0.18 / −0.15 | −0.26 / −0.24 | −4.82 | 498 (95 %) | 3 | 0.65, 0.00 |
| de-peg guard 100 bps | UNCLEAR | 12.98 | +0.00 | +0.00 / +0.00 | +0.00 / +0.00 | +0.00 / +0.00 | +0.03 | 502 (95 %) | 3 | 0.65, 0.00 |
| inventory skew 3 bps a held rung (max 3) | WORSE | 12.96 | −0.02 (−0.59 to +0.57), 0.536 | −0.46 / +0.38 | −0.13 / −0.29 | −0.04 / −0.27 | −2.54 | 524 (94 %) | 3 | 1.10, 0.00 |
| inventory skew 5 bps a held rung | UNCLEAR | 13.11 | +0.12 (−0.73 to +0.93), 0.396 | −0.33 / +0.55 | −0.08 / −0.50 | −0.02 / −0.41 | −5.29 | 591 (93 %) | 3 | 0.76, 0.00 |
| **hold_min £1** | UNCLEAR | 13.46 | +0.48 (+0.14 to +0.90), 0.001 | +0.08 / +0.86 | +0.28 / +0.05 | −0.00 / −0.00 | +0.04 | 389 (94 %) | 3 | 1.10, 0.00 |
| hold_min £5 | UNCLEAR | 13.50 | +0.52 (+0.14 to +0.97), 0.000 | +0.10 / +0.91 | +0.34 / +0.06 | −0.00 / +0.00 | +0.10 | 372 (94 %) | 3 | 1.10, 0.00 |
| fair + ½ the book's 24 h basis | WORSE | 11.68 | −1.30 (−3.65 to +0.42), 0.853 | −2.94 / +0.24 | −1.30 / −1.02 | −0.03 / +0.25 | +0.06 | 468 (96 %) | 4 | 1.10, 0.00 |
| fair + the book's 24 h basis | WORSE | 12.41 | −0.57 (−1.66 to +0.48), 0.803 | −0.73 / −0.42 | −0.64 / −0.63 | −0.95 / −0.52 | −3.37 | 484 (95 %) | 3 | 0.76, 0.00 |
| combo: USDT 2:1 + hold_min £1 | BETTER | 14.85 | +1.87 (+0.74 to +3.06), 0.003 | +1.41 / +2.30 | +1.56 / +1.28 | +0.50 / +0.37 | +5.08 | 387 (94 %) | 3 | 0.73, 0.00 |
| combo: USDT 2:1 + £75/£75/£0 | BETTER | 14.71 | +1.73 (+0.83 to +2.62), 0.001 | +1.85 / +1.62 | +1.68 / +2.14 | +1.13 / +0.54 | +5.50 | 450 (95 %) | 3 | 1.10, 0.00 |
| combo: USDT 2:1 + USDC rungs 0.075/0.15/0.25 | BETTER | 15.07 | +2.08 (+0.73 to +3.53), 0.006 | +1.87 / +2.29 | +2.00 / +1.75 | +0.87 / +0.49 | +5.72 | 572 (95 %) | 3 | 0.88, 0.00 |
| capital £120 (per pound) | BETTER | 15.28 | +2.29 (+1.48 to +3.21), 0.000 | +2.46 / +2.14 | +2.26 / +1.62 | +1.02 / +0.57 | +11.34 | 538 (96 %) | 3 | 1.10, 0.00 |
| capital £300 (per pound) | BETTER | 14.10 | +1.11 (+0.69 to +1.56), 0.000 | +1.06 / +1.17 | +1.16 / +0.79 | +0.38 / +0.21 | +5.25 | 517 (96 %) | 3 | 0.66, 0.00 |
| capital £1,200 (per pound) | WORSE | 11.51 | −1.47 (−2.05 to −0.91), 1.000 | −1.49 / −1.45 | −1.59 / −1.12 | −0.41 / −0.41 | −5.36 | 472 (95 %) | 5 | 0.65, 0.00 |

Scale: 1 bps of capital a day is 3.65 % a year, or £0.06 a day on £600.

### 3.1 Per-book allocation: the one change that holds everywhere

- **The records agree.**
  - With USDT-GBP at twice USDC-GBP's pounds (£66.67 and £33.33 a rung), the gain is +1.24 bps a day on FWD. It is +1.22 under
    "through" and +1.15 with the half queue.
  - It is +0.51 / +0.37 on HIST and +5.03 on LONG.
  - By week it was ahead in 5 of 6 on FWD, 4 of 5 on HIST and **39 of 39 on LONG**, where its worst week was +0.16
    (`results/robust.json`).
  - It wins on weekdays (+1.06 a day) and in closures (+1.62).
- **The gain rises the further it goes**: 3:2 +0.76, 2:1 +1.24, 3:1 +1.64, USDT only +2.38. And the reverse, USDC 2:1, loses
  −1.40 on every record.
- **Why.**
  - USDT-GBP prints far more: 13,207 stored prints against 2,329 since 09-22, though 8,238 of them are the bot's £0.10.
  - Retail crosses it from both sides; 237 of LIVE's first 330 round trips were on it.
  - Per pound of its own rungs, USDT earns about 1.4× USDC on FWD and HIST and 2.2× on LONG (USDT-only against the base).
  - USDC-GBP's asks are the weakest rungs: 9.0, 5.1 and 1.1 bps a rung-day at 0.1, 0.2 and 0.3 %. Its 0.3 % bid did not trade
    on FWD at all.
- **The cost is concentration, not FX.**
  - The coins behind the asks stay half the capital, so the GBP/USD exposure is unchanged.
  - The USDT share of it rises from £150 to £200 at £600. A Tether de-peg of 10 % would cost about £20 instead of £15 before the
    guard stops the entries.
  - This is why the twin is at 2:1, not "USDT only".

### 3.2 Rung sizes and distances

- **The 0.3 % rung is the weakest per pound** in the tight market. It holds money for the rare wide print.
  - Moving its £100 a book to the inner rungs (£75 / £75 / £0) gains +1.15 a day on FWD, +0.99 on HIST and +1.26 on LONG.
  - That is exactly what an engine without the 0.3 % rungs gives (`robust.json` checks the two are identical), so it needs no new
    engine.
  - The cost is the tail: it was behind in 8 of 39 long-tape weeks, its worst week −18.9 bps and −11.0 on FWD. Those are the
    weeks a wide print reaches 0.3 %.
- **Ladders and distances.**
  - Wider ladders, a 0.4 % rung, and Davies' example (0.075 / 0.15 / 0.25 / 0.4 %) are worse on every record.
  - Rungs inside 0.1 % (0.05 %) add trips, but LONG turns against them (−4 bps/day). They pay in a tight week and lose in a wide
    one.
  - A 0.15 % rung added (four rungs, £37.50 each) is mildly better everywhere (+0.76, +0.28, +1.57). It needs a new engine.
- **Per-book distances.** USDC at 0.075 / 0.15 / 0.25 % is BETTER by the rule (+1.27 on FWD), but weaker underneath: HIST ahead
  in only 2 of 5 weeks, LONG's worst day −14 bps, and "through" on FWD weekdays −0.08. It also needs a new engine. It is next, not
  now.
- **Sizes by rung.** Inner-weighted sizes (75 / 50 / 25) are unclear (LONG +0.06; 22 weeks ahead, 17 behind). Outer-weighted
  sizes are worse.
- **Weekend distances.** Wider or narrower rungs inside the closures are worse.

### 3.3 Exits, re-price, stops

None beats LIVE's.
- **Exit offset.** A tick inside fair gives the edge away (−1.13). A tick beyond flips sign between fill rules, as F3 found.
- **Moving the exit in after 2 or 6 hours** costs a little.
- **Re-price.** 0.05 % is best for entries and exits, alone or together; 0.03 % and 0.10 % are both worse.
- **Stops.**
  - A shorter stop sells good positions: 6 h gives 35 stops and −1.39 a day.
  - A longer stop or none gains +0.23 a day, which is three stops in 31 days.

### 3.4 Sub-rules

- **The £0.10 bot, and holding.**
  - Since 10-08 USDT-GBP prints £0.10 trades about 450 times a day, both sides, at the touch (`data/prints.txt`: 8,238 of 13,207).
  - Under LIVE's rule a £0.10 fill makes the rung held: the rest of a £10 (now £50) entry is withdrawn, and the rung spends its
    time exiting £0.10.
  - **LIVE's own record shows it** (`results/dust_fills.json`): since 10-08, 142 of 232 USDT-GBP entry fills were under £1. They
    made 142 trips that held their rung 1,174 minutes in all.
  - Letting a rung hold up to £1 before it counts as held gains +0.48 a day under "at" (P≤0 0.001), +0.28 with the half queue
    and +0.05 under "through". It is zero on HIST and LONG, before the bot existed.
  - So it is real only as long as the bot is, and only under at-price fills, which are LIVE's.
- **Release blackouts.**
  - FWD's +0.31 is one event: the CPI of 10-14 12:30, when LIVE's USDC asks lost 9 bps of capital.
  - On HIST and LONG (dozens of releases) it is −0.02 to −0.14.
  - The Coinbase study's Revolut X replay (`backtests/cbreview/results/cbfast_revx.json`) found ±$3 a year on $1,200 with the sign
    flipping by span.
  - Not worth a rule.
- **Time of day.** No gate helps: every UTC hour made money on FWD.
- **Before Sunday's reopen.** Pausing in the two hours before it costs.
- **Inventory skew** (moving both sides' entries away from the side held) is worse on LONG at both strengths.
- **The fair.** A basis-adjusted fair is worse, and faster GBP/USD was priced at about nothing in September.
- **De-peg guard.** 25 bps costs, and 100 bps changes nothing in these records.

## 4. Recommended: three twins on LIVE's rules, one change each

**All three:**
- engine `pr5`, gov `account`, £600;
- LIVE's fill rule and weekend from their start, no take, no backfill;
- each read against `live600` ("Stablecoin quotes variant-1": the same rules with equal rungs) over the same minutes.

**Display names.** "variant-4" is still `d`'s name (hidden). Once `d` is switched off after 10-28, the three can take "variant-4",
"variant-5" and "variant-6"; the ids below name no variant number.

**Start, window and reading.**
- **Start:** the first 00:00 UTC after their deploy, no earlier than 2026-10-29 00:00 (after the 10-28 readouts retire `pr5`, `p50`
  and `d`; seven twins already share the call's 12 s).
- **Window:** 28 days from the start (four closures). The reading is on or after its end.

**The bar, the same for each.** By UTC day over the window:
- d = the twin's realised per pound of capital (the page's walk, `liveRungs` / `liveRungTrips`) minus `live600`'s, in bps of
  capital.
- **B1:** the mean of d > 0.
- **B2:** a circular 3-day-block bootstrap of d (Python `random.Random(20261128)`, 10,000 resamples) puts at most 10 % at or
  below 0.
- **What a pass means:** the change goes to Davies as a proposal for LIVE.
- **Reported beside the bar:**
  - each twin's marked-to-market per pound;
  - trips, entry fills and their sizes, stops;
  - weekday and closure shares;
  - the share of `d` from its best day.

**Power.** On FWD's own daily differences, 28-day windows resampled (`results/power.json`):

| twin | the replay's effect | pass at that effect | pass at half of it | false pass at zero |
|---|---|---|---|---|
| T1 | +1.24 bps/day (sd 2.75) | 0.85 | 0.45 | 0.11 |
| T2 | +1.15 (sd 3.43) | 0.63 | 0.41 | 0.19 |
| T3 | +0.48 (sd 1.00) | 0.97 | 0.43 | 0.11 |

A twin fills by LIVE's "at" rule, so the twins measure the "at" world. LIVE sits between "at" and "through" (§1). T1 and T2 hold
under both; T3 does not (§3.4).

### T1 `live600usdt2`: USDT-GBP at twice USDC-GBP's pounds

```json
{ "id": "live600usdt2", "display_name": "Stablecoin quotes variant-4", "display_order": 13, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "<S>", "table_prefix": "agent_quote_twin_live600usdt2", "lease": "quotes-twin-live600usdt2", "rules": { "fill": { "model": "at", "from": "<S>" }, "weekend": { "from": "<S>" }, "weights": { "from": "<S>", "book": { "USDC-GBP": 1, "USDT-GBP": 2 } } }, "backfill": null, "prereg": "docs/agents/reviews/<date>-pr5-opt-twins-prereg.md", "migration": "<NNNN>", "enabled": true }
```

- **Rung sizes:** each USDT-GBP rung £66.67 and each USDC-GBP rung £33.33.
- **The twin's start conversions:** £200 of USDT and £100 of USDC, its asks' worth.
- **Replay:**
  - FWD +1.24 bps/day ("at"), +1.22 ("through");
  - HIST +0.51, LONG +5.03; 39 of 39 long-tape weeks ahead.
- **Risk:** the USDT inventory a third larger.

### T2 `live600no03`: the 0.3 % rungs' money on the 0.1 % and 0.2 % rungs

```json
{ "id": "live600no03", "display_name": "Stablecoin quotes variant-5", "display_order": 14, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "<S>", "table_prefix": "agent_quote_twin_live600no03", "lease": "quotes-twin-live600no03", "rules": { "fill": { "model": "at", "from": "<S>" }, "weekend": { "from": "<S>" }, "weights": { "from": "<S>", "k": { "0.001": 1, "0.002": 1, "0.003": 0 } } }, "backfill": null, "prereg": "docs/agents/reviews/<date>-pr5-opt-twins-prereg.md", "migration": "<NNNN>", "enabled": true }
```

- **Rung sizes:** eight rungs of £75. The 0.3 % rungs quote no entry, as a `retired` rung, but unlike `retired` their capital goes
  to the others.
- **Replay:**
  - FWD +1.15 ("at"), +1.09 ("through");
  - HIST +0.99 (5 of 5 weeks), LONG +1.26 (31 of 39 weeks);
  - worst week −11 / −19 bps.
- **What the reading must also show:** whether a wide day came in the window. Without one, T2 is flattered, so the reading reports
  the base's 0.3 % rung P&L over the window beside the bar.

### T3 `live600hold1`: a rung holding £1 or less is not "held"

```json
{ "id": "live600hold1", "display_name": "Stablecoin quotes variant-6", "display_order": 16, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "<S>", "table_prefix": "agent_quote_twin_live600hold1", "lease": "quotes-twin-live600hold1", "rules": { "fill": { "model": "at", "from": "<S>" }, "weekend": { "from": "<S>" }, "holdMin": { "from": "<S>", "gbp": 1 } }, "backfill": null, "prereg": "docs/agents/reviews/<date>-pr5-opt-twins-prereg.md", "migration": "<NNNN>", "enabled": true }
```

- **The rule.** A rung counts as holding only above max(the venue's £0.10, £1) of coin.
- **Under it:**
  - the rung keeps carrying out its paper rung's entry;
  - its coin is carried into the trip;
  - once over £1, the exit sells the whole holding;
  - the 24-hour stop counts from that crossing.
- **Replay:** FWD +0.48 ("at"), +0.05 ("through"); HIST and LONG 0 (no bot then).
- **What the reading also reports:** the count of £0.10 prints a day, because if the bot leaves, so does the effect.

### Code they need (the main session's; none written here)

1. **`quotes_live.ts`: two instance options, default absent.** LIVE's instance has neither, so `quotes_live_instance.test.ts`'s
   comparison with `quotes_live_frozen.ts` must still hold.
   - **`weights`** (`{from, book?, side?, k?}`):
     - a rung's pounds are the capital × w(book) × w(side) × w(k) ÷ Σ over the instance's rungs, instead of `rungGbp`;
     - a rung of weight 0 is treated as `retired`;
     - `asksNeedOf`, `planTopUps` and `runQuotesConvert`'s cap use each book's asks' sum instead of a quarter of the capital
       (equal weights give the same numbers).
   - **`holdMin`** (`{from, gbp}`): `holding` is the rung's coin × price above max(`dustBase`, gbp), and `rungBook`'s dust is the
     same threshold for `openedAt`.
2. **`quotes_twin.ts`.**
   - `TWIN_RULES.weights` and `TWIN_RULES.holdMin`, each refusing settings it cannot read.
   - The twin's start conversions per book become its asks' worth.
   - `ENGINES` is unchanged.
3. **Pins.**
   - A counterfactual for each: equal weights give the twin's bytes as before; a £0.10 fill under `holdMin` keeps the entry
     resting.
   - `src/twin_specs.test.js` for the rows.
4. **Deviations.** `quotes_twin.ts` is pinned by five pre-registrations: the realistic twins, the size twin, the LIVE twin, the
   weekend twin and the LIVE-rule size twins. Changing it is a code-only deviation in each (no existing row's behaviour changes),
   as their earlier deviations were.
5. **One pre-registration file** for the three, from `TEMPLATE-variant-prereg.md` (whose "no code changes" line does not hold
   here: say so), with this section's bar, frozen before the start.

**Not recommended as twins now.**
- **Per-book distances** (USDC 0.075 / 0.15 / 0.25 %): an engine of its own, and weaker under "through" and on HIST.
- **The combinations:** first see which single changes survive.
- **A 0.15 % rung:** a new engine for +0.76.
- **USDT beyond 2:1:** after T1.

## 5. Not worth it, and why

- **Time-of-day gates, a pause before the Sunday reopen, release blackouts.** Each is no better or worse on the longer records.
  FWD's one CPI loss is not a rule.
- **Wider, narrower or four-rung ladders, a 0.4 % rung, 0.05 % inner rungs.**
  - They are worse, or they flip between the tight market and the wide one.
  - The current distances sit near the top of every set tried.
- **Exit offsets, timed exits, other re-price steps.** They are worse or flip sign. 0.05 % stays best: in PR5V, on 10-18, and here.
- **Shorter stops** are worse. **Longer or no stop** is +0.23 bps a day: three stops a month, against the one guard on a position
  the market has left.
- **Tighter de-peg, inventory skew, a basis-adjusted fair** are worse. A faster GBP/USD was priced at about nothing on 09-28.
- **Changing the weekend** in any direction is worse. The weekend itself is the largest single source: a third of FWD's P&L.
- **Larger size per pound** (£1,200) loses 11 % per pound against £600. £600 already keeps about 0.85× of £120's rate. `live600`
  answers this forward on 11-11.

## 6. Overfitting, sample size, and what this cannot show

- **55 candidates were tried.** At P≤0 ≤ 0.10 on one record, about five would pass by chance.
  - The rule asks for agreement on two other records and three fill rules, which chance rarely gives.
  - Of the BETTER rows, the per-book allocation passes it on independent data (HIST, LONG and 39 of 39 weeks).
  - The 0.3 % reallocation passes on all three records. Its long-tape weeks are mixed (31 of 39).
  - The rest are thinner.
- **FWD is 31 days and five closures.** HIST is 28 days. LONG is mostly a market that no longer exists, a sign check only.
- **Levels are about 20 % above LIVE's** (§1). The replay's money is not a forecast; the differences are what it reads.
- **Not modelled:**
  - the queue ahead of us at our own price, bracketed by "at", the half queue and "through";
  - the governor and the loss stop (neither binds);
  - the USD-book de-peg check;
  - the asks' coin running short (the executor tops it up, at most £5 a book a day);
  - venue outages;
  - the take.
- **Not checked:**
  - LIVE's own record after 10-26 00:58;
  - the twins' records (none was read for this);
  - whether the bot's £0.10 prints fill at our price ahead of a queue, which QUEUE (11-02) can measure.

## 7. Files

`docs/agents/backtests/pr5_opt/` (`MANIFEST.json`):
- `sql/pulls.sql` and `data/`: the inputs.
- `scripts/sim.py`: the replay.
- `scripts/check_paper.py`: 273 of 273 paper trips.
- `scripts/calibrate.py`: the replay against LIVE.
- `scripts/experiments.py`: every candidate, and the verdict rule.
- `scripts/robust.py`: weeks, parts, the equivalence check, combinations.
- `scripts/dust_fills.py`: LIVE's sub-£1 fills.
- `scripts/power.py`: the bar's power.
- `scripts/table.py`: §3's table.
