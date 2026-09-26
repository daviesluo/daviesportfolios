# Pre-registration PR6: 0 % maker quotes at par on Revolut X's USDC/USD and USDT/USD books

Written 2026-09-26 (UTC), before any fill, order, position or P&L of this rule was computed on these books, and before
any of their prints was compared with par, with a quote or with another print. Frozen by the commit that adds this file;
nothing below may change after it, and any deviation is reported as a deviation. It is one hypothesis, with both books
pooled as in PR5, so no correction for multiple tests applies.

## Why

The fp5 review ranks this second of what is worth running (`2026-09-26-fp5-review.md`). The rule rests 0 % bids and asks
1, 2 and 3 ticks either side of 1.0000 on Revolut X's UK USDC-USD and USDT-USD books. It is scored on the venue's
keyless public prints with PR5's frozen simulator.

It is the mechanism that passed as PR3 and PR5: resting 0 % quotes around a fair value on a thin stablecoin book. Here
the fair value does not move. On a coin book, a quote refreshed once a minute loses to adverse selection, because the
price moves more in a minute than the spread pays (fp2's h/σ₁ₘ < 2.7; the loop's maker probes). On these books the
fair value is pinned at par, so that cause should be absent.

Three earlier looks at these books left the question open:

* **PR4** (2026-09-23) quoted them 10–30 bps from their own 24-hour median. It made 7 round trips in 13 days, because
  the books sit on the peg. It measured the distance, not this rule.
* **Idea 5 of the first-principles study**, "peg ping-pong" (bid 0.9999 / ask 1.0000 on USDC/USD), was killed by
  arithmetic without reading a print: 1 bp a trip on a book trading about $22k a day is $0.28 a day at a 25 % share,
  and a fill strictly through 1.0000 needs a print at 1.0001.
* **fp5's `rxpar`** (pass 76) scored a bid at 0.9999 and a sell at 1.0000 on hourly candle closes. It was voided,
  because a close is not a fill: the first exit hour's only prints were two sells at 0.9994.

This test answers the question on the venue's own prints, with the house's fill rules. It is small by construction:
1–3 bp a round trip, on at most $100. The question is whether it is reliably positive and worth running beside PR5.

## What was seen before the freeze (disclosed)

* **The mechanism's record.** PR3, PR4, PR5 and their studies; PR5's paper-test spec; reference §3.26–§3.27 and §4
  items 31 and 35; the first-principles study's idea 5; PR4's result (+$0.44 on 7 trips, all on USDT/USD, 13.25 days).
  What PR4's pre-registration disclosed about these books: over 2026-08-26 → 09-23, 23 % of USDC/USD's $1.03 M and
  32 % of USDT/USD's $1.47 M traded more than 10 bps from each book's 24-hour median; the live touch then was
  USDC/USD 0.9999 / 1.0000 and USDT/USD 0.9995 / 0.9997. PR5's region count: every USDT-USD print UK; 10.7 % of
  USDC-USD's prints UK over 30 days.
* **fp5's Revolut X branch** (`cursor/revolut-x-search-d133`). Pass 76's rule text and summary: 525 USDC-USD and
  454 USDT-USD one-tick "trips" on hourly closes, all after each book's candles begin, voided. Its hourly candle files
  (8,758 and 8,772 hours; 3,809 and 5,541 with volume). The two sells at 0.9994 in the first exit hour. The UK tickers
  read on 2026-09-25 21:23 UTC: USDC-USD bid 1.0000 / ask 1.0001, last 1.0001; USDT-USD bid 0.9998 / ask 1.0002,
  last 1.0002. Passes 78–80 were on coin books, not these.
* **The fp5 review's reading of these books**: about $34k a day on USDC-USD and $64k on USDT-USD, quoted 1–4 ticks
  wide. Those are averages over 366 days of hourly candles, and the candles carry no volume before late November and
  mid-December 2025. Since the candles begin, the same files give about $40.7k and $82.3k a day (volume only,
  computed here).
* **In this session, before freezing, only event counts and the data's plumbing:**
  * how the endpoint behaves: `region=UK` filters on the server, pages run newest first, one day a window; and UK
    prints on sampled days back to 2025-09-26 (counts only);
  * the pull below. Of it, only these were computed: prints, minutes with a print, and USD volume by day, week and
    month; daily prints and volume, USDC-USD from 2025-09-25 and USDT-USD from 2025-10-25, to 2025-12-20, to find
    where USDC-USD's UK flow changed; the size cap min($100, 10 % of the minute's USD volume) over minutes with a
    print; each book's total prints by aggressor side, which the extraction audit prints (USDC-USD 8,971 buys and
    9,506 sells; USDT-USD 17,244 buys and 13,604 sells, over the whole pull); the tape's completeness against the
    venue's UK hourly candle volume; and a region cross-check on ten days a book (ids and region counts);
  * the pair configuration: tick 0.0001 and minimum order $0.10 on both books;
  * PR5's simulator, run on made-up prints only, to check that it takes a fair of 1.0000 and rungs of 1–3 ticks.

  No print's price was compared with par, with a quote or with another print. No fill, order, position or P&L was
  computed on these books.

## Data

**Source.** Revolut X's public trade tape, no key:
`GET https://revx.revolut.com/api/1.0/public/trades/all?symbol={USDC-USD|USDT-USD}&start_date=<ms>&end_date=<ms>&limit=100&region=UK[&cursor=…]`.
One UTC day a window, [D 00:00:00.000, D 23:59:59.999]. Both bounds are inclusive, so the windows do not overlap. Every
page is followed to the end, one request every 1.1 s. Pulled on 2026-09-26 for 2025-09-25 00:00 → 2026-09-26 00:00 UTC,
de-duplicated by id, and any row not labelled UK dropped. The UK hourly candles the fetcher also pulls are used only for
the completeness check and the power check.

| | USDC-USD | USDT-USD |
|---|---:|---:|
| days pulled; failed | 366; 0 | 366; 0 |
| UK prints | 18,477 | 30,848 |
| duplicates; rows outside their window; rows not UK | 0; 0; 0 | 0; 0; 0 |
| region cross-check, ten days: UK ids with and without `region=UK` | identical (476 UK among 2,940 prints) | identical (882 UK among 882) |
| completeness, primary window: hours whose UK candle volume equals the prints' | 7,246 of 7,248 | 6,773 of 6,782 |

In the 11 hours that differ, the prints carry more than the candle (at most 243 USDC and 1,500 USDT); in none does the
candle carry more. The completeness check counts a print from a minute's first 1,000 ms in the minute before, as PR5
measured the candle builder does.

The files the simulation reads (sha256 of the uncompressed file; one print a line,
`{"id","price","qty","region","side","ts"}`, price and quantity as the venue's strings, sorted by time, then id):

* `trades/USDC-USD.jsonl` 91a1287c7be36082ab49604751aea61c92c73553bc7a15b19af0a6f34a8fce7d (18,477 prints)
* `trades/USDT-USD.jsonl` 0568e84ca5d185d29975dbb6fe0d89f579ec67ac930a2116cee8c6402c5ec97c (30,848 prints)

If these files are lost, a new pull of the same days must reproduce both hashes before anything is scored; if it does
not, the difference is reported and nothing is scored.

Scripts that ran before the freeze, and their outputs:
`fetch.py` a9cbb205c713195d5688ae6cd3fc3208aa3ab128945a29a6a2a1e1753181fe72,
`region_check.py` fd7edcb495896a9f5f6b0655c17ddc95e99da0d52b13ca683be814a95420b0e4 (→ `region_check.json`
b6d2bc6c…), `power_check.py` e0f5da19ddb67600043534f265e3a6c4dfc4c8f506ca93172d8a64beb37e85cb (→ `power_check.json`
d908859d…), and the UK hourly candles they read, `candles/USDC-USD_60.json` 0eea071a… and `candles/USDT-USD_60.json`
e98fa873…. Five one-off scripts also ran, all counts or made-up data: the endpoint probes `probe.py` (2ca5bc0b…) and
`probe_depth.py` (5d7ceee8…), the candles' coverage `candle_counts.py` (60797ec2…), fp5's candle volume
`fp5_candle_volume.py` (6c6ccfc4…), and PR5's simulator on made-up prints `feasibility_synthetic.py` (4125dfeb…). They
are committed with the study. The simulator imports `docs/agents/scripts/pr5/pr5_sim.py`
(56fbad85ee4df6292f596188d091ad064d030180f33cefe3bd09089d7e772a1a, the committed copy of PR5's frozen simulator) and
runs PR5's checks `test_sim_logic.py` (7dedbaa189febaf2d712c7e809d62da79be0375edf1ae620ac1b73245e888243).

### Windows

* **PRIMARY (the bar).** USDC-USD 2025-11-27 00:00 → 2026-09-26 00:00 UTC (303 days). USDT-USD 2025-12-17 00:00 →
  2026-09-26 00:00 UTC (283 days). Each book starts fresh, every rung idle, at the first UTC midnight after the first
  hour in which the venue's UK candles carry volume (2025-11-26 16:00 and 2025-12-16 16:00). Prints before the start
  only set the last print that the first go-live check reads. A position counts in the window where it opened. The data
  end at 2026-09-26 00:00; a position still open then is closed as PR5 closes one at the end of its data (the last
  print, as a taker).
* **Why not twelve months.** The tape carries prints labelled UK on both books on every day from 2025-09-26. But the
  venue's UK candles count none of them before those two hours: every earlier hour has zero volume, while the prints
  carry $29.5 M (USDC-USD) and $17.8 M (USDT-USD). Those are the same two instants at which PR5 found the GBP books' UK
  candles begin.
  * On USDC-USD the label changed meaning. The flow labelled UK fell from 142–452 prints a day up to 2025-10-17 to
    9–51 a day from 2025-10-20 to 2025-12-20. On 2025-10-15, 210 of the book's 221 prints were labelled UK; on the
    nine cross-checked days from 2025-11-26 on, 9–61 of 211–593 were.
  * USDT-USD prints only as UK, and its tape looks continuous across its candle start (51–153 prints a day from
    2025-10-25 to 2025-12-20). It is left out of the bar only because the venue's candles do not confirm it, as PR5
    started its USDT/GBP book at the candle start although it printed daily from 2025-12-01.

  So the bar uses the part of the tape that the venue's own candles confirm, as PR5 did.
* **Whole tape (descriptive).** One fresh simulation per book from 2025-09-26 00:00, reported whole and for the
  positions opened before each book's primary start.
* **Last three months (condition 7).** Positions opened 2026-06-26 00:00 → 2026-09-26 00:00 UTC (92 days), in the
  primary simulation.
* **Last four weeks (reported apart, not in the bar).** Positions opened 2026-08-29 00:00 → 2026-09-26 00:00 UTC
  (28 days), in the primary simulation. PR5's GBP books tightened in the week of 2026-08-24, and PR5's rule earned
  about a seventh as much after it. These 28 days lie after that change began. They are the rate a paper test would
  plan with, as PR5's 28 days after the change were.
* **Months.** Every calendar month that overlaps the primary window: 2025-11 … 2026-09, eleven months, the first and
  last partial. A position counts in the month it opened.

## Power check (event counts only)

From `power_check.json`. Every figure is a count of prints, minutes or dollars, never conditioned on a price. The size
cap is what a fill in that minute would carry: min($100, 10 % of the minute's USD volume).

| | USDC-USD primary | last 3 months | last 4 weeks | USDT-USD primary | last 3 months | last 4 weeks |
|---|---:|---:|---:|---:|---:|---:|
| days | 303 | 92 | 28 | 283 | 92 | 28 |
| prints a day (median day) | 36.1 (28) | 49.7 (33) | 43.6 (34.5) | 80.8 (76) | 64.8 (63) | 61.5 (60) |
| minutes with a print, a day | 22.8 | 25.1 | 27.8 | 56.5 | 43.4 | 42.8 |
| USD volume a day | $40,646 | $59,267 | $30,319 | $82,276 | $51,898 | $52,517 |
| size cap, mean / median | $32.55 / $10.00 | $33.90 / $11.10 | $37.20 / $18.51 | $36.43 / $15.00 | $36.36 / $14.99 | $35.42 / $13.59 |
| minutes whose cap is the full $100 | 20 % | 21 % | 21 % | 22 % | 21 % | 20 % |
| ceiling on maker P&L, a day | $0.85 | $0.97 | $1.16 | $2.32 | $1.78 | $1.71 |

No day in any window lacks a print. The counts show no step in the week of 2026-08-24: by week from 2026-06-29,
USDC-USD printed 17–170 times a day and USDT-USD 53–76, with the weeks after that change inside those ranges.
Whether the spread changed, as the GBP books' did, is a price measurement; the report's weekly gap will show it.

**The ceiling** is what the rule could earn if every rung of both sides entered in the busiest half of the book's
minutes with a print, at the size cap, and every exit were a maker exit at par: 12 ticks (1 + 2 + 3 a side) × the sum
of the busiest half's size caps. A rung's entries alternate with its exits, so no rung can enter in more than half of
those minutes. It is not an estimate; it is the most the counts allow.

**What the bar needs.**

* **Condition 7, last three months: $24.20.** At the two books' mean size cap ($35.46), that is 6,825 round trips at
  1 tick, 3,412 at 2 or 2,275 at 3: 74, 37 or 25 a day. The two books have 68.6 minutes with a print a day, and the
  twelve rungs can complete at most about 206 round trips a day. In fills, that is between 0.7 and 2.2 fills in every
  minute that trades, each at the mean size cap, each position exited at par within a day. It is 9.6 % of the ceiling
  ($252.85 over the 92 days).
* **Condition 7, primary window: $77.06.** That is 21,855, 10,927 or 7,285 round trips, and 8.4 % of the ceiling
  ($914.36).
* **Conditions 4 and 5** need 60 round trips, with round trips in at least 8 months. That is small beside condition 7.

So condition 7 decides the test. It passes only if prints go through par ± 1–3 ticks, on both sides, in a large share
of the minutes that trade, and the positions come back to par within a day.

**Against that**, one earlier count says how often these books cross par. Since their candles began, fp5's hourly
closes (a bar counted only when it traded) went from ≤ 0.9999 to ≥ 1.0000 about 979 times on the two books: about 3.3
times a day. That is not a fill count. Prints cross par more often than hourly closes do, and a fill here needs a print
one tick further through. But round trips at that rate, at 1 tick and the mean size cap, would make about $0.012 a
day, a twenty-second of condition 7's $0.263. The test is weak in that direction: condition 7 needs the rungs crossed
tens of times more often than the hourly closes show, and only the prints can say whether they are.

**The smallest edge conditions 1–6 can see.** A maker round trip earns its 1–3 ticks for certain; a 24-hour stop costs
about 10–11 bps plus the move. With N round trips, the null's average a trip varies by about one twin's spread
divided by √N. With hundreds of trips, conditions 1–3 can tell apart an average of a fraction of a tick a trip. So if
the rule trades at all, conditions 1–6 turn on how often its positions are stopped rather than exited at par. At
1 tick a trip and about 11 bps a stop, one stop in eleven round trips on the 1-tick rungs cancels their profit.

## The rule

PR5's rule (`2026-09-23-pr5-prereg.md`, sha256 d4785087…; the simulator above), with these differences only:

1. **Books:** USDC-USD and USDT-USD, UK. Prices, sizes and P&L in USD. There is no exchange rate: X = 1 in every
   minute, so no minute is dark for want of FX, and the quotes run all week.
2. **Fair = 1.0000, fixed.** Rungs n ∈ {1, 2, 3} ticks (tick 0.0001): bids 0.9999, 0.9998 and 0.9997; asks 1.0001,
   1.0002 and 1.0003. PR5's 0.05 % re-price never fires, because fair never moves.
3. **De-peg guard.** At the turn of minute t, if the book's last UK print strictly before t is more than 30 bps from
   par (below 0.9970 or above 1.0030), the minute has no fair value on that book. That is PR5's dark minute: the entry
   quotes are withdrawn and none is placed; an exit order already placed stays as it is; an exit not yet placed waits
   for the first minute with a fair value; the 24-hour stop runs as always. **Mark to market:** the report values every
   open position at its book's last print at each UTC midnight, at no cost, and reports the daily equity that makes
   and its worst drawdown. So a position waiting out a de-peg shows its loss before it is closed.
4. **The 24-hour stop's cost:** the 0.09 % taker fee plus half the book's spread. The spread is taken as the widest
   touch seen before the freeze: USDC-USD 1 tick (half: 0.5 bp), USDT-USD 4 ticks (half: 2 bps).
5. **Capital:** 2 books × 2 sides × 3 rungs × $100 = $1,200. That is $600 of USD for the six bids, and $300 each of
   USDC and USDT for the asks.

Everything else is PR5's, restated so that nothing is left to a reference:

* The loop acts at the start of minute t, on data up to t−1. An order placed at t is live from t+1. A fill in minute m
  is seen at the turn of m+1, where the exit is placed; the exit is live from m+2.
* **Post-only.** When an order goes live, the last print before that instant decides. A bid at p is refused if that
  print was below p, or at p and a BUY. An ask at p is refused if it was above p, or at p and a SELL. A refused order
  cannot fill. At each later turn it is re-placed, as one order, if the last print is no longer through its price; it
  goes live the minute after and is checked again. This holds for entries and exits alike.
* **Fills.** A live bid at p fills only on a print strictly below p; an ask only on a print strictly above p. The
  print's time must be at or after the start of the order's live minute, and the prints of a minute are taken in time
  order. The fill is at p, the quote's own price. Size: min($100, 10 % of the USD volume printed on that book in the
  fill print's minute). Each rung that one print goes through fills at that size.
* **Exit:** a post-only order at fair, i.e. par. A long exits with an ask at 1.0000, a short with a bid at 1.0000,
  filling by the same test: a long's exit needs a print at 1.0001 or above, a short's a print at 0.9999 or below. Like
  any post-only order, the exit is refused while the last print says the market is through par. If it has not filled
  within 24 h of the fill minute, the position is closed at the last print at or before the end of that minute,
  × (1 ∓ (0.0009 + half spread)), as a taker. A position is not checked for the stop in the minute it was entered.
* One position per rung at a time. The rung is re-placed at the turn after its position closes.
* **Orders:** every placement, re-price and re-placement counts one. Revolut X accepts 1,000 a day. The rule does not
  ration them; a day over 1,000 fails condition 4.
* **Fees:** 0 % on a resting fill, 0.09 % on the stop. That is the venue's flat schedule (reference §2), the same for
  every account.

**The simulator is PR5's code.** `simulate()` and `exit_only()` are imported unchanged from `pr5_sim.py`. PR6 supplies
only three things: the book object they read (UK prints by minute, each minute's USD volume, X = 1, fair = 1.0000 or
none under the guard, the last-print look-ups); the rungs as the fractions 0.0001, 0.0002 and 0.0003 of par; and each
book's half spread. The last two are module constants that PR5's functions read; they are set per book before each
call. Before the simulator reads a PR6 print, two sets of checks on made-up data must pass: PR5's own
(`test_sim_logic.py`), and checks of PR6's layer that pin the rung ticks (9999, 9998, 9997; 10001, 10002, 10003), the
exits at 10000, the guard (a last print 31 ticks from par darkens the minute, 30 ticks does not), no fill on a print at
the quote's price, and the size cap. If any fails, nothing is scored and the failure is reported.

## Arms

1. **Primary:** as written.
2. **Stress** (must stay > 0): the stop costs 0.18 % plus the full spread (1 bp on USDC-USD, 4 bps on USDT-USD), and
   every fill, entry and exit, needs a print one more tick (0.0001) through the price.
3. **Descriptive, not in the bar:** by book, rung, side, month and week; fills only from the opposite aggressor (a bid
   only on a SELL print, an ask only on a BUY print); no post-only refusal; full $100 fills; no de-peg guard; rungs of
   $25, $300 and $1,000 with the same 10 % cap; the whole tape from 2025-09-26; orders a day (mean and busiest day);
   the daily mark-to-market equity and its worst drawdown; stops (count and cost); and, per book and week, the median
   gap between adjacent BUY and SELL prints within 60 s (PR5's regime measure, `diagnostics.py`).

## The null: a circular shift by whole days

Each primary round trip gets a twin on the same book and side, with the trip's own dollar size. The twin's start is
the trip's entry minute moved δ whole days later, wrapping within that book's primary window. The twin enters at the
last print of the first minute at or after that start which has a print and is not dark, searching forward and wrapping
at the window's end. From there it follows the rule's exit machinery through PR5's `exit_only()`: a post-only exit at
par placed at the next turn, the refusal rule, the strictly-through fill at par, the 24-hour stop, and the end of the
data. One null value is the sum of every twin's P&L for one δ, with the same δ on both books. Every δ from 1 to 282
days is scored: the shorter window is 283 days, less one. That gives 282 values and needs no seed. The p95 is the
value at index int(0.95 × 281) = 266, counting from 0, of the 282 sorted in ascending order.

Why this null, and not PR5's random-time twins:

* **The rule's trips come in clusters.** One print can fill all three rungs of a side, one print can exit them
  together, and a move away from par reaches both books at once. PR5's null draws each trip's twin independently.
  That makes the null narrower than the data (the fp5 review's "nulls narrower than the data"), which errs toward a
  pass. A shift moves the rule's whole schedule together, so each twin keeps its neighbours.
* **Whole days keep each twin's time of day.** A shift by a random number of minutes would move twins across the
  hours of the day, and these books' flow may differ by hour; whole days rule that out. Only about half of USDC-USD's
  hours carry a print at all, so a twin moved into a quiet hour would also wait for the next print.
* **The twin keeps the trip's size.** PR5's twin took the size of its drawn minute. A fill needs a print through a
  quote, so it tends to come in a busier minute than a random traded one, and a twin sized from a random minute
  carries less money. That would narrow the null too.
* **Every shift is scored**, so there is no sampling error and no seed.

PR5's random-time null is reported beside it, not in the bar, computed as the null loop in `pr5_sim.py`'s `main()`
computes it: each trip's twin at the last print of a uniformly drawn traded minute of its book in the primary window,
sized from that minute; 2,000 draws; `random.Random(20260926)`.

## The bar (PRIMARY; all must hold)

1. P&L > 0.
2. P&L > the circular-shift null's p95.
3. Stress P&L > 0.
4. At least 60 round trips, and no UTC day over 1,000 orders, both books together.
5. Positive in at least two thirds of the calendar months: 8 of the 11. A month with no round trip is not positive.
6. No single month more than 40 % of the total P&L.
7. Worth money, at the size cap, on the capital the quotes tie up: at least 8 %/yr (twice cash, PR5's paper-test bar)
   in both of these:
   * over the primary window, on PR5's capital-years ($600 a book over that book's primary days: $600 × 303 / 365 +
     $600 × 283 / 365 = $963.29), i.e. P&L ≥ 0.08 × $963.29 = $77.06; and
   * on the positions opened in the last three months, on $1,200 for 92 days, i.e. P&L ≥ $1,200 × 0.08 × 92 / 365 =
     $24.20 ($0.263 a day).

   The scorer compares at full precision; the cents here are rounded.

Pass → a paper-test specification beside PR5. Fail → no paper test, and the report names the condition that failed. A
descriptive arm that would have passed (smaller rungs, no guard, another size) is a hypothesis for a new
pre-registration, not a pass.

**Reported with the bar:** the return a year on the capital over the primary window and over the last three months;
the last four weeks' P&L, trips and dollars a day; capacity; orders a day; the mark-to-market drawdown; the weekly gap.

## Determinism

The scorer is run twice, and the two JSON files must be byte-identical. `pr6.json` carries the sha256 of this file, of
the inputs and of the scripts.

## What it cannot show

* **Queue priority at a price.** A print AT our price never fills us, although an order at the touch fills there when
  it is first in line. On a book quoted one tick either side of par, as the touches seen before the freeze were, many
  real fills would come that way, and none of them is counted.
* **Our own effect on the book.** A print strictly through our price stands in for a fill at our price. With our order
  in the book, the aggressor would have traded with us first. The 10 % cap is the only model of how much.
* **Whether a post-only order would have been accepted.** That is judged from the last print, not from the book.
* **A de-peg larger than the window's.** The guard and the stop bound a de-peg's cost only as far as the history tests
  them.
* **What the UK label meant before the candles begin.** The earlier tape is descriptive only.
* **Whether this account pays 0 % maker on these books.** The venue's schedule says so for every account; the first
  paper or live fill would show it.

## What follows

Pass: a paper-test spec beside PR5, planning with the last four weeks' rate. Money moves only on Davies' word. Fail:
the report names the condition, and the par books are not tried again with other rungs, sizes or guards without a new
pre-registration.
