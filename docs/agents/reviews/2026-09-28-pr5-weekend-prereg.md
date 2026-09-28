# Pre-registration PR5-W: PR5's GBP stablecoin quotes at weekends, priced on the last interbank close

Written 2026-09-28 00:30 UTC and revised the same night after an independent review, and again after that review's
second pass. Frozen by the commit that adds it, which should land before 2026-10-02 21:00 UTC. A later freeze moves
every forward date and instant in this file by the same whole number of weeks: the eight weekends and the data's end,
arm 3b's exports and their deadlines, the count script's deadline, the reading date and its latest, the ledger's dates
and the reminders. Nothing else moves: not the backward replay's span or its scored closures, not the dates of what was
seen before the freeze or of the dry runs before the first forward weekend, not the power section's, and not PR5's own
dates (its 2026-10-21 verdict). The seed stays 20260928. It was written before any profit or loss of PR5's rule was
computed on any weekend, on the committed tape or on production data. Nothing below may change after the freeze; any
deviation is reported as a deviation. One hypothesis, both books pooled as in PR5, so no correction for multiple tests
applies. It changes nothing that runs: PR5's paper engine, its dry-run executor, their tables, PR5's spec and its
2026-10-21 review are untouched. The replay reads production by SELECT and writes only the study's own files. No key is
read, no signed call is made and nothing is placed.

Davies, 2026-09-27, choosing every addition the TESTING review ranked: "MX-1 挂单执行 (推荐), RW-NEXT + 建 RW-C,
QUEUE 排队模型, PR5-R 等低优先级" (MX-1, resting execution, recommended; RW-NEXT, and build RW-C; QUEUE, the queue
model; PR5-R and the rest at low priority). PR5-W is one of the rest.

## Before the first forward weekend

1. **The export statements, run once without showing a value.** The page statements this file uses ("Exports" below)
   are each run once on production with their last column (`page`) left out. Their `sha256` column shows nothing of
   the rows and is kept, so that everything but the page is run on production. There are fifteen:
   * arm 3b's book statement for the closure of 2026-09-25 21:00 → 09-27 21:00, with START − 2 min at 2026-09-25 20:58
     and END + 2 min at 2026-09-27 21:02, once for each book: two;
   * the replay's statements for the day 2026-09-28, run after 2026-09-29 00:00 UTC so that the day is whole: the
     selects of `agent_quote_minutes`, `agent_quote_prints`, `agent_quote_trips`, `agent_quote_events` and
     `agent_quote_live_orders` once for each book, and that of `agent_quote_inputs` once for each of its three kinds
     (`fx`, `fair:USDC-USD`, `fair:USDT-USD`): thirteen.

   Their row counts, byte counts and hashes are written into the ledger's PR5-W item, and nothing else is read. That
   shows each statement runs as written and how large a page is. 3b's statement and the replay's six were run on
   made-up rows in this revision, in a local Postgres 16 (PGlite), in a session whose time zone is not UTC. Each
   sha256 returned matches the decoded page, and each statement without its `page` column returns the same `n`, byte
   count and sha256.

   The fifteen run after this file is frozen and before the first forward weekend's closure begins, 2026-10-02 21:00
   UTC. They were meant for before the freeze, but thirteen read a day that closes only at 2026-09-29 00:00 UTC, and
   the session that froze the file had no database connector. PR5-R is frozen, so the counts of `agent_quote_trips`
   and `agent_quote_events` for 2026-09-28 may be taken. If a statement needs any change, the change is made before
   that closure begins and recorded as a deviation of this file, with the result that showed the need. No weekend the
   test judges has begun then, so no change can be fitted to one.

The freeze commit also:

* writes into the ledger's PR5-W item the dry runs of "Before the first forward weekend", due before 2026-10-02 21:00
  UTC, and the dates the test keeps: arm 3a's backward candles pulled within seven days of the freeze; arm 3b's first
  export after 2026-11-01 21:02 and before 2026-11-05 10:25 UTC; the count script committed before 2026-11-25 00:05
  UTC; the reading, with 3b's second export, on 2026-11-25 from 00:05 UTC (2026-12-23 at the latest); and, at PR5's
  2026-10-21 verdict, the question to Davies of keeping PR5's paper engine and its minute record running to the
  reading;
* writes the freeze line into the same item: until the reading, none of `stepMinute` in `agents/quotes.ts`, its minute
  record (`agent_quote_minutes`), `agents/books.ts`, the table `agent_book_levels` or its prune job changes, except a
  longer retention on Davies' word, and any change is a deviation;
* schedules one-shot reminders for 2026-11-02 00:15 UTC (3b's first export) and 2026-11-25 00:05 UTC (the reading).

## Why

* **PR5's rule is dark at weekends.** Its interbank rate X has no quote from Friday evening to Sunday evening: Yahoo's
  GBPUSD=X in the paper engine, Exness's archive in the backtest. Without X the rule withdraws its entry quotes. So the
  $1,200 its quotes lock sits idle two days in seven.
* **The two GBP books keep trading.** Over the committed tape's weekends, about a fifth of each book's volume printed
  while X was dark (counted below). On the weekend of 09-26/27, USDT-GBP printed 146 and 136 times, £97k and £130k
  (appendix B).
* **Appendix B ranked this first of PR5's possible arms** (`2026-09-27-testing-review-b-quote-tests.md` §3): the frozen
  rule while X is dark, with X held at the last interbank close. It needs no signed call (its reads are keyless) and no
  new capital. The upside is about 30 % of PR5's P&L.
* **The risk is the reopen.** GBP/USD moves while the rule's X stands still. A position priced on Friday's close meets
  the new rate on Sunday evening. The committed Exness series has 48 such gaps: median about 4.6 bps, the largest 54.1,
  five over 30.
* **An earlier finding answers a different question.** First-principles idea 22 found no weekend premium to take. This
  test asks something else: whether the deviation PR5 harvests on weekdays can be harvested at weekends on a stale X,
  after the reopen.

## What was seen before the freeze (disclosed)

* **PR5's record.** PR5's pre-registration, study and paper-test spec. PR3. The paper test's record to 2026-09-27 21:38
  UTC: 9 round trips, all opened on weekdays; one Friday position exited on Saturday 09-26 (appendix B). The
  first-principles study, idea 22.
* **Appendix B.**
  * Weekend prints and volume against weekday's, on the committed tape's weekends after the books tightened: prints 79 %
    (USDT-GBP) and 67 % (USDC-GBP) of a weekday's, volume 71 % and 63 %.
  * Both books printed through the weekend of 09-26/27.
  * That weekend's GBP-book prints against the fair from Friday's close and the engine's weekend fairU: USDT-GBP a
    median −4.6 bps (range −44 to +6), USDC-GBP −0.3 (−28 to +8).
  * The 48 GBP/USD gaps of the committed Exness series: median 4.7 bps, p90 30.6, max 54.1, five over 30.
* **Here, before this file was written: counts and GBP/USD only.**
  * **The Exness series' dark stretches**, by PR5's rule: a minute t is dark when no minute close started in
    [t − 10 min, t − 1 min].
    * 62 stretches in all. 48 last at least 12 hours: every weekend from 2025-11-07, and Christmas and New Year, about a
      day each. The other 14 last 1–4 minutes.
    * 44 of the 48 lie in 2025-12-01 → 2026-09-21.
    * The absolute gap, from the last close before a stretch to the close its first live minute reads: median 4.6 bps,
      p90 30.6 (nearest rank), max 54.1, five over 30 bps. All five were falls of GBP/USD: 2026-02-27 −50.5 bps, 03-06
      −47.3, 04-10 −51.0, 05-08 −54.1, 06-19 −30.6. The four weekends from 2026-08-28 moved −0.2, +1.3, −1.3 and
      −2.7 bps.
    * **The two medians.** This file's 4.6 and appendix B's 4.7 are the same 48 gaps with the same endpoints (the last
      close before the dark and the first close after it; recomputed in this revision). This file takes the median as
      `statistics.median` does, the mean of the 24th and 25th of the 48 sorted (4.58 bps); appendix B's `fx_gaps.py`
      takes the 25th alone (4.67).
    * On that series, weekends go dark at 21:09 on Friday (UTC) while New York keeps summer time, and at 22:09
      otherwise. They typically come back at 21:06–21:27 on Sunday in summer and 22:06–22:17 in winter, and once on a
      Monday at 00:01; the closure below is fixed in UTC, so the spread does not move it. Christmas and New Year:
      Wednesday 22:09 → Thursday 22:06.
  * **The committed tape in the closures defined below**, while X is dark, 2025-12-01 → 2026-09-21, each book from its
    PR5 start. Against the live minutes of the same span:

    | | USDC-GBP | USDT-GBP |
    |---|---|---|
    | while dark, in a closure | 3,155 prints in 2,390 minutes, £3.69 M | 9,953 prints in 6,651 minutes, £6.49 M |
    | live minutes | 10,040 prints, £15.24 M | 30,384 prints, £26.32 M |
    | dark outside a closure | 47 prints, £0.42 M | 99 prints, £0.06 M |

  * **PR5's engine record for 2026-09-25 18:00 → 09-28 00:00 UTC, counted.** 3,240 minutes a book, every one with a
    fairU, 279 with an X. X was dark from Friday 21:40 to Sunday 23:00, and live again from Sunday 23:01: two hours
    after the FX market's scheduled reopen at 21:00 UTC.
* **The sign of the tail was seen.** The five gaps over 30 bps were all falls of GBP/USD. A fall raises fair =
  fairU / X, which pays a long stablecoin position. On the one weekend seen, the weekend prints sat under the fair from
  Friday's close, so weekend fills are likely to be mostly bids, which are longs. The backward replay's reopen tail
  therefore favours the position the rule most likely held (condition 7 below).
* **The independent review of this draft, 2026-09-28 before 01:10 UTC, by SELECT only:** `information_schema` for the
  `agent_quote_*` tables and `agent_book_levels`; `cron.job` and `cron.timezone`; `agent_book_levels` counts and
  timestamps; `agent_quote_minutes` counts for 09-25 18:00 → 09-28 00:00, and its last and first minutes with an `x`.
  It recomputed the Exness figures and the closure table above from committed files. It read no fill, trip, event or
  print inside either window, and no weekend P&L.
* **Another review that night, of five other drafts,** read PR5's events and prints (re-price checks) and the live
  executor's orders (lags), all before the first forward weekend.
* **The two revisions** read the repository. The first also read the committed Exness series for the two medians above
  (GBP/USD only); the second ran the page statements on made-up rows. No production data. The review's second pass
  made no production read.
* **The export statements' dry runs** ("Before the first forward weekend" item 1) had not been run at the freeze.
  They run after it, before the first forward weekend, and their results go into the ledger's PR5-W item.
* **No weekend fill, order, position or P&L of PR5's rule has been computed by anyone.** `agent_book_levels` has been
  counted, never read.

## The rule

**PR5's frozen rule exactly, with one input changed.** The rule is `simulate()` in `docs/agents/scripts/pr5/pr5_sim.py`
(sha256 56fbad85ee4df6292f596188d091ad064d030180f33cefe3bd09089d7e772a1a), imported unchanged. It is the rule
`stepMinute` in `agents/quotes.ts` runs minute by minute, which `quotes.test.ts` replays trip for trip. The one input
that changes is the interbank rate X.

For each minute t, the arm's rate Xw(t) (w for weekend) is:

1. **X(t), when X(t) is live.** That is PR5's own X: the close of the latest interbank minute bar whose minute started
   in [t − 10 min, t − 1 min]. None means dark. The engine applied this rule when it recorded `x`.
2. **The last close before the dark, when X(t) is dark and minute t lies inside an FX closure.** The closures are fixed
   in UTC:
   * every week, Friday 21:00 → Sunday 21:00;
   * 24 December 21:00 → 25 December 21:00;
   * 31 December 21:00 → 1 January 21:00.

   The last close before the dark is the X the rule last read live. In the forward replay it is the latest non-null `x`
   the engine recorded before t on that book. On 2026-09-25, for example, Yahoo's last bars started 21:25–21:29 and
   repeated the close, and X went dark at 21:40: case 2 would have taken the close the engine read at 21:39. In the
   backward replay it is the close of the latest Exness minute that started at or before t − 1 min.
3. **Dark, otherwise**, exactly as in PR5.

**Fair(t) = fairU(t) / Xw(t).** Nothing else changes:

* the rungs, 0.1, 0.2 and 0.3 % either side of fair;
* $100 a rung, and the 10 % cap on the minute's printed volume;
* the post-only refusal by the last print, and fills only on prints strictly through;
* the 0.05 % re-price, and exits at fair;
* the 24-hour taker stop at 0.09 % + 0.0067 %;
* orders counted as PR5 counts them;
* P&L converted at Xw of the exit minute, or the last one known.

**What follows from it**, stated so nobody has to derive it:

* **Inside a closure the rule keeps quoting**, priced on the last close. Quotes and exits re-price by the 0.05 % step as
  the USD books' hourly fairU moves.
* **A closure ends at Sunday 21:00 UTC, whether or not X is live.** That is the FX market's scheduled reopen while New
  York keeps summer time, and an hour before it otherwise.
  * From then until X is live again, the minutes are dark, as in PR5: entry quotes are withdrawn, exits stay as they
    were placed, and the stop runs.
  * Why not wait for X: on 2026-09-27 Yahoo's feed came back at 23:01 UTC, two hours after the market reopened.
    Quoting Friday's close in those two hours would quote a stale rate to a market that has moved.
* **This is how appendix B's "entries withdrawn when the live X returns" is made exact:** the entries are withdrawn no
  later than the market's reopen. When X is live again, the rule places them afresh at the live fair. It re-prices the
  weekend's exits by its 0.05 % step, as on any weekday.
* **A live X inside a closure** (a stray bar) is used as live. Later dark minutes of that closure then take its close.
* **A dark minute outside a closure stays dark.** The short gaps of a weekday are PR5's, unchanged.

**Definitions used below.**

* **A weekend** is one closure. Christmas and New Year count as one weekend each.
* **A weekend trip** is a round trip whose entry filled in a minute where Xw came from case 2.
* **A closure's first case-2 minute** is its first minute in which Xw came from case 2.
* **The reopen** of a closure is the first minute at or after its end whose X is live.

## The primary replay: forward, the eight weekends after the freeze

**The weekends** are the eight closures that begin after the commit that freezes this file. If it lands before
2026-10-02 21:00 UTC, they are the weekends that begin on Friday 10-02, 10-09, 10-16, 10-23, 10-30, 11-06, 11-13 and
11-20.

**Inputs**, by SELECT only, each exported to files as "Exports" below says and never printed:

* X(t) and fairU(t): `agent_quote_minutes.x` (null is dark) and `agent_quote_minutes.fair_u`. These are the inputs PR5's
  engine decided each minute on (`0055`). They are used rather than `agent_quote_inputs`, whose rows each later fetch
  re-writes; that table serves only to rebuild a minute with no record. The engine records `fair_u` in dark minutes
  too: all 3,240 minutes a book of 09-25 18:00 → 09-28 00:00 have one.
* Case 2's close: the latest non-null `x` recorded before t on the same book.
* **Prints:** `agent_quote_prints`. For each closure's days they are compared with a keyless pull of the UK tape
  (`GET https://revx.revolut.com/api/1.0/public/trades/all?symbol=…&start_date=…&end_date=…&limit=100&region=UK`, one
  UTC day a window, every page, one request every 1.1 s, sorted by `ts`, then by id as a string in code-point order).
  The union is used: a print the store lacks is added, and a print the store holds and the pull lacks is kept. Both
  kinds are listed.
* **PR5's own live fills are taken out of the tape.** If PR5's live path is armed after 2026-10-21, its bids rest in
  the GBP books and its fills print, and its exits keep their price when its inputs are stale (reference §4 item 35),
  so they can rest and fill at weekends. A print is the account's own fill when an order of mode `live` in
  `agent_quote_live_orders` on that book was at its price, the order's side is the other side of the print's aggressor
  (a SELL for the account's bid), the print is stamped after the order's `ts` and at or before its `updated_at`, and,
  the prints so matched being taken in time order, its quantity fits in what is left of the order's `filled_base`. A
  print that does not fit is not taken. The window ends at `updated_at`, which every settlement read sets, and not at
  `filled_at`, which keeps the time the first fill was read (`fillStamp`), so a fill completed later would fall outside
  it. Such prints are taken out and listed.
* **A minute with no row** in `agent_quote_minutes` is rebuilt from `agent_quote_inputs` with the engine's `fxBarAt`,
  `fairHours` and `median`, ported to Python and pinned on those functions' cases in `quotes.test.ts`, and listed.
* **The fresh start.** Each run starts at the first closure's start (Friday 2026-10-02 21:00 UTC), every rung idle.
  Its first minutes read their last print from the tape (the store and the pull) before 21:00 on that book. X and
  fairU are the engine's records from 21:00 on; `lastX` starts empty, as `simulate()` starts it.
* **If the engine's record stops before the reading.** PR5's paper test ends on 2026-10-21, and this file needs the
  engine's minute record to the reading, 2026-11-25 (2026-12-23 at the latest). Before any change to PR5's paper engine
  after its 10-21 verdict, Davies is asked to keep the engine and its minute record running to the reading. If he
  declines, or the record stops for any other reason, the missing minutes are rebuilt as the backward replay builds
  them, from the first missing minute on: the tape, Exness's archive (X by PR5's rule) and the venue's UK hourly candles
  of USDC-USD and USDT-USD (fairU by F3). Exness's darkness differs from Yahoo's (on 2026-09-27 Yahoo came back at
  23:01 UTC; Exness is typically back from 21:06). So the first rebuilt minute is named, check 5 covers only the minutes
  the engine recorded, and W is reported apart for the weekends the engine recorded and for the rebuilt ones. Exness
  publishes a month's file on the 1st of the next, so the reading then waits for the month it needs: November's on
  2026-12-01.

**Runs.** Two runs of `simulate()` on both books, each on a book object built from the inputs, as PR6's `pr6_sim.py`
builds one: the prints by minute, each minute's GBP volume, X by minute and F = fairU / X.

* the arm, with X = Xw;
* the baseline, with PR5's X.

Each starts fresh at the first closure's start, as above. Each runs on data to the Wednesday 00:00 UTC after the last
weekend read. Positions count if they opened before the Tuesday 00:00 UTC after it, so each reaches its exit or its
24-hour stop inside the data.

* **W** is the P&L of the arm's weekend trips.
* **D** is the P&L of the arm's other trips, less the P&L of the baseline's trips, over the same span. It holds two
  effects of opposite sign:
  * what weekend quoting takes from the weekdays: a rung holding a weekend position on Sunday night or Monday cannot
    quote;
  * what it adds to them: a position opened before a closure's first case-2 minute and still open at it is managed on
    the case-2 fair in the arm, its exit placed or re-priced, while the baseline has no fair in the dark, so an exit not
    yet placed waits (`simulate()`: `if o is None: if f is not None:`) and a re-price is skipped, and the position waits
    for the reopen or its 24-hour taker stop. The usual case is a position filled in the last live minutes before the
    dark: on 2026-09-25, X was live until 21:39. Part of this effect is a gain by construction: a Friday position the
    baseline would leave to a taker stop exits as a maker.

  Reported apart: **D's carry-in part**, the P&L of the trips of each run that were open at a closure's first case-2
  minute (entry minute before it, exit minute at or after it), the arm's less the baseline's, summed over the closures;
  and the rest of D.
* **I = W + D** is the increment.

**Faithfulness.** The baseline is PR5's rule on the engine's own inputs, so it must reproduce the engine's trips
(`agent_quote_trips`) opened from the first reopen on.

* The fresh start and the engine agree from there. By Sunday the engine holds nothing: its Friday positions are
  stopped within 24 hours, and it places no entry in the dark. Neither does the baseline.
* The match is on what `simulate()` emits: book, side, k, t_entry, fill_ts, entry and exit at `simulate()`'s rounding
  (6 and 8 decimals), t_exit, how, and notional_usd and pnl_usd to $0.000001. Every engine trip must be matched, and no
  baseline trip left unmatched.
* Allowed, and each listed:
  * any minute whose inputs differ between the engine and the replay: its `prints_n` differs from the replay's count of
    that minute's prints, in either direction (a minute from which an own fill was taken out is one), or it was rebuilt;
  * every difference that follows from such a minute on that book, until the first minute at the end of whose step
    both runs have every rung of that book idle (the engine's, as its event log in `agent_quote_events` shows).
* **Idle** is read at the end of a minute's step, after its turn, its go-live checks, its prints and its stop: the rung
  holds no quote and no position. A rung whose position closes in a minute is idle at the end of it, and is placed
  again at the next turn. In a live minute every idle rung is quoted at the turn, so, short of every rung's position
  closing in the same minute, the rungs of a book are all idle only at the end of a dark minute (no fair) in which
  neither run holds a position. So one input difference on a weekday allows every difference that follows on that
  book for the rest of that week, unless such a dark minute comes sooner: the check is waived there until then.
* A failure because of the scorer's code may be fixed and every check run again; the failed run and the fix are
  reported. Any other difference voids the forward result, and is reported. If the engine stops, the check covers the
  days it ran.

## The secondary replay: backward, on the committed tape (the reopen tail)

* **Inputs.** PR5's committed inputs in `docs/agents/backtests/inputs/pr5_2026-09-23/`, hashed as PR5's
  pre-registration lists them: the tape, Exness's minute closes and the USD books' UK hourly candles. X is PR5's rule on
  Exness; fairU is F3, as `pr5_sim.py` builds it.
* **Runs.** `simulate()`, arm and baseline, over each book's PR5 span: USDC-GBP from 2025-11-26 00:00 and USDT-GBP from
  2025-12-16 00:00, both to 2026-09-23 00:00 UTC. Case 2 applies in every closure.
* **Scored:** positions opened 2025-12-01 00:00 → 2026-09-21 00:00 UTC. That holds 44 closures: 42 weekends, Christmas
  and New Year. USDT-GBP is in the 42 of them from 2025-12-19 on. The start is the first whole calendar month of
  USDC-GBP's span, the span on which the closures above were counted before any P&L. So the closure of 2025-11-28, two
  days after USDC-GBP's start, is left out of the score, and reported apart.
* **Reported:** W, D and I; the reopen table for every closure; the four closures from 2026-08-28 apart (the tight
  market); and, beside W_bt, the reopen marks (ii) with each gap's sign reversed, each position marked at
  X_close × (1 − gap), as a bound on what the same gaps would have cost the other way.
* **Why it is secondary.** It is the only place the reopen tail can be priced: 5 of its 44 gaps are over 30 bps. But
  most of its W will come from the wide market before the week of 2026-08-24, which is gone, and the sign of its tail
  was seen (above).

## The reopen, and positions open at it

At each reopen, every weekend position still open is marked at that minute's fair, fairU / X with X live, in USD at
that X:

* a long (from a bid): qty × (fair − entry) × X;
* a short (from an ask): qty × (entry − fair) × X.

For each weekend three parts are reported apart:

* (i) the weekend trips closed before the reopen;
* (ii) the marks at the reopen;
* (iii) what the positions open at the reopen then realized, less their marks.

W = (i) + (ii) + (iii). The bar reads W whole: after the reopen losses. The gap, X at the reopen over case 2's close,
less 1, in bps, is reported beside each weekend.

## Arms

1. **Primary:** the forward replay (W, D and I).
2. **Stress** (W must stay > 0): PR5's stress. Taker exits cost 0.18 % + the full spread (0.0134 %), and every fill,
   entry and exit, needs a print one more tick through.
3. **Descriptive**, never in the bar:
   * a. **The coin-implied rate in case 2**, instead of the last close.
     * It is the median over BTC, ETH, SOL and XRP (the mean of the middle two) of close(C-USD) / close(C-GBP).
     * Both closes of a coin come from the same hour: the latest hour lying wholly before t (start + 60 min ≤ t) for
       which the venue returned both its C-USD and its C-GBP candle, from
       `GET https://revx.revolut.com/api/1.0/public/candles/{SYM}?interval=60&since=<ms>&until=<ms>&region=UK`
       (keyless), for BTC-USD, BTC-GBP, ETH-USD, ETH-GBP, SOL-USD, SOL-GBP, XRP-USD and XRP-GBP.
     * A coin with no such hour is left out. With none left, case 2 takes the last close.
     * It is run forward and backward. The venue drops hourly candles after about a year (PR6 committed its candles for
       that reason; on 2026-09-22 the 4-hour bars reached back 376 days), and a missing hour would quietly fall back to
       the last close. So the backward candles are pulled within seven days of the freeze, for 2025-11-25 → 2026-09-23,
       gzipped and hashed; the forward ones at the reading.
   * b. **Post-only against the recorded book.** For each weekend fill, the book its order met at go-live L. The rule is
     restated from QUEUE (`2026-09-28-queue-prereg.md`) so that this arm stands alone:
     * A row of `agent_book_levels` with an empty side, or whose best bid is at or above its best ask, counts as not
       read.
     * The book at L is the valid row with the greatest `ts` at or before L, if its `seen_until` is at least L − 120 s.
     * Accepted: a bid below that book's best ask, an ask above its best bid. At the best price: a bid at or above the
       best bid, an ask at or below the best ask.
     * It judges the fills whose go-live lies in their closure's export range (below). A weekend fill's order may have
       gone live before it, while X was still live on Friday; such fills are counted as "went live before the closure".
     * Reported: the share accepted, and the share at the best price; the fills whose go-live had no book; the fills
       that went live before the closure; and the go-live books in which an order of PR5's live account rested (mode
       `live` in `agent_quote_live_orders`).
     * The rows are read only after QUEUE's pre-registration is frozen. Inside QUEUE's window they are read only after
       QUEUE's scorer has passed its checks 1–3, or after the end of QUEUE's export (2026-11-06 10:25 UTC at QUEUE's
       present dates) if those checks have not passed by then, so that 3b is not blocked for good if QUEUE never
       passes them.
     * The exports, and when they are taken, are under "Exports" below.
   * c. **Strict size** (appendix B §2.4b). Each weekend trip's P&L × min(1, s / q), where q is its entry size in
     coins and s the quantity printed strictly through its entry price on its taking side in its fill minute (a SELL
     below a bid, a BUY above an ask).
   * d. **Splits.** By book, side, rung and weekend. Orders on each weekend day, against the live executor's governor
     (600 / 700). The reopen table.
   * e. **The backward replay's stress and nulls**, built as the forward ones are: the shift in case-2 time, and PR5's
     random-time null with a generator of its own, `random.Random(20260928)`.
   * f. **PR5's random-time null**, forward, beside condition 2's shift (below).

## Exports

Every input read from production is written to a file by script and never printed. Each page is one SELECT through the
connector that returns the page's row count, its byte length, its sha256 and the page itself in base64, the rows as
JSON lines, as QUEUE's page statement does; a script decodes each page, checks its sha256 and writes it. The session
that takes them states what it saw: base64 strings, counts and hashes only.

* **Arm 3b's book rows**, one page per book and closure:

      with r as (
        select ts, json_build_object(
                 'book', book,
                 'ts', to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'seen_until', to_char(least(coalesce(seen_until, ts), timestamptz '<END + 2 min>')
                                       at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'reads', reads, 'bids', bids, 'asks', asks)::text as line
        from public.agent_book_levels
        where book = '<USDC-GBP or USDT-GBP>'
          and coalesce(seen_until, ts) >= timestamptz '<START − 2 min>' and ts < timestamptz '<END + 2 min>'),
      p as (select count(*) as n, coalesce(string_agg(line, E'\n' order by ts), '') as body from r)
      select n, octet_length(convert_to(body, 'UTF8')) as bytes,
             encode(sha256(convert_to(body, 'UTF8')), 'hex') as sha256,
             encode(convert_to(body, 'UTF8'), 'base64') as page
      from p;

  with START and END a closure's start and end (for the first, 2026-10-02 21:00 and 10-04 21:00 UTC). The table keeps
  35 days. The closures of 10-02 → 10-30 are exported after 2026-11-01 21:02 and before 2026-11-05 10:25 UTC: the 11-05
  prune deletes the rows first read before 10-01 10:25, and the 11-06 prune those before 10-02 10:25, near the first
  closure's start. The closures of 11-06 → 11-20 are exported on 2026-11-25, with condition 4's count; a weekend added
  after that, on the final reading date. PR5-W takes these exports itself whatever QUEUE takes, so the arm depends on no
  other file.
* **The replay's inputs**, on the reading date, one page per table, book (or kind) and UTC day, each from 2026-10-01
  00:00 UTC to the data's end, in the order of the table's key. These tables are not pruned. Every page is this
  statement, with `<R>` one of the six selects below, `<DAY>` the page's UTC day, and `<BOOK>` or `<KIND>` its book or
  kind:

      with r as (<R>),
      p as (select count(*) as n, coalesce(string_agg(line, E'\n' order by o), '') as body from r)
      select n, octet_length(convert_to(body, 'UTF8')) as bytes,
             encode(sha256(convert_to(body, 'UTF8')), 'hex') as sha256,
             encode(convert_to(body, 'UTF8'), 'base64') as page
      from p;

  Each select numbers its rows in the order of the table's key (`o`) and writes each row as one JSON line (`line`),
  its timestamps in the form 3b's statement uses.
  * `agent_quote_minutes`: book, minute, x, x_t, fair_u, hours_n and prints_n.

        select row_number() over (order by minute) as o, json_build_object(
                 'book', book,
                 'minute', to_char(minute at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'x', x,
                 'x_t', to_char(x_t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'fair_u', fair_u, 'hours_n', hours_n, 'prints_n', prints_n)::text as line
        from public.agent_quote_minutes
        where book = '<BOOK>'
          and minute >= timestamptz '<DAY> 00:00:00+00'
          and minute < timestamptz '<DAY> 00:00:00+00' + interval '1 day'

  * `agent_quote_prints`: id, book, ts, price, qty and side, by id compared in code-point order.

        select row_number() over (order by id collate "C") as o, json_build_object(
                 'id', id, 'book', book,
                 'ts', to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'price', price, 'qty', qty, 'side', side)::text as line
        from public.agent_quote_prints
        where book = '<BOOK>'
          and ts >= timestamptz '<DAY> 00:00:00+00'
          and ts < timestamptz '<DAY> 00:00:00+00' + interval '1 day'

  * `agent_quote_trips`: every column, one page per day of `t_entry`.

        select row_number() over (order by side collate "C", k, t_entry) as o, json_build_object(
                 'book', book, 'side', side, 'k', k,
                 't_entry', to_char(t_entry at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'fill_ts', to_char(fill_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'fill_print_id', fill_print_id, 'entry', entry, 'qty', qty, 'x_entry', x_entry,
                 'fair_entry', fair_entry, 'entry_oid', entry_oid,
                 't_exit', to_char(t_exit at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'exit', exit, 'how', how, 'exit_print_id', exit_print_id, 'exit_oid', exit_oid,
                 'notional_usd', notional_usd, 'pnl_usd', pnl_usd)::text as line
        from public.agent_quote_trips
        where book = '<BOOK>'
          and t_entry >= timestamptz '<DAY> 00:00:00+00'
          and t_entry < timestamptz '<DAY> 00:00:00+00' + interval '1 day'

  * `agent_quote_events` other than kind `book`: every column.

        select row_number() over (order by minute, side collate "C", k, kind collate "C") as o, json_build_object(
                 'book', book,
                 'minute', to_char(minute at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'side', side, 'k', k, 'kind', kind, 'ticks', ticks, 'detail', detail)::text as line
        from public.agent_quote_events
        where book = '<BOOK>' and kind <> 'book'
          and minute >= timestamptz '<DAY> 00:00:00+00'
          and minute < timestamptz '<DAY> 00:00:00+00' + interval '1 day'

  * `agent_quote_inputs`: kind, t and value, one page per kind and day of `t`.

        select row_number() over (order by t) as o, json_build_object(
                 'kind', kind,
                 't', to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'value', value)::text as line
        from public.agent_quote_inputs
        where kind = '<KIND>'
          and t >= timestamptz '<DAY> 00:00:00+00'
          and t < timestamptz '<DAY> 00:00:00+00' + interval '1 day'

  * `agent_quote_live_orders` of mode `live`: every column but `request`, `response` and `book_seen`. `book_seen` is
    the GBP book each order met, inside QUEUE's window, and the replay does not need it.

        select row_number() over (order by id) as o, json_build_object(
                 'id', id,
                 'ts', to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'mode', mode, 'book', book, 'rung_side', rung_side, 'k', k, 'leg', leg, 'side', side,
                 'price', price, 'base_size', base_size, 'client_order_id', client_order_id,
                 'venue_order_id', venue_order_id, 'state', state, 'filled_base', filled_base,
                 'avg_fill_price', avg_fill_price, 'fee_gbp', fee_gbp, 'paper_oid', paper_oid,
                 'paper_live', to_char(paper_live at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'fair', fair,
                 'cancel_requested_at',
                 to_char(cancel_requested_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'cancel_reason', cancel_reason,
                 'filled_at', to_char(filled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'cancelled_at', to_char(cancelled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'updated_at', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text as line
        from public.agent_quote_live_orders
        where mode = 'live' and book = '<BOOK>'
          and ts >= timestamptz '<DAY> 00:00:00+00'
          and ts < timestamptz '<DAY> 00:00:00+00' + interval '1 day'

## The null

**Condition 2: a circular shift in case-2 time.**

* **The line.** For each book, the minutes of the weekends read in which Xw came from case 2, laid end to end in time
  order: C minutes, H = floor(C / 60) whole hours. The **pool** is the minutes on the line in which the book printed at
  least once.
* **The twins.** Each forward weekend trip has a place on its book's line, its entry minute. For a shift δ of whole
  hours, δ = 1 … H − 1 with H the smaller of the two books' H, its twin starts δ × 60 places after that place, wrapping
  at the line's end. It enters at the last print of the first pool minute at or after its start, searching forward and
  wrapping, with its trip's own `notional_usd`. That is `simulate()`'s field: the trip's nq × the X `simulate()` last
  knew at the trip's exit, which in the arm is Xw.
* **Exit.** From there it runs PR5's `exit_only(B, i0, side, usd, lastX0)` on the arm's inputs, with `usd` that
  `notional_usd` and `lastX0` the Xw of the twin's entry minute: the exit at fair from the next turn, the refusal rule,
  the strictly-through fill, the 24-hour stop and the end of the data.
* **A value** is the sum of every twin's P&L for one δ, with the same δ on both books. The p95 is the value at index
  int(0.95 × (H − 2)) of the H − 1 values sorted ascending. No seed is needed.

**Why a shift, and not PR5's random-time twins.** Weekend trips cluster: one sweep fills three rungs, and on the one
weekend seen USDT-GBP's prints sat a median 4.6 bps under the stale fair, so the bids fill together. PR5's null draws
each trip's twin independently, which makes it narrower than the data and errs toward a pass, the reason PR6's frozen
pre-registration gave for leaving it; and a twin sized from a random traded minute carries less money than a fill,
which narrows it too. A shift moves the whole weekend schedule together, so each twin keeps its neighbours and its
trip's size. QUEUE, frozen beside this, uses a shift for the same reason.

**PR5's random-time null (descriptive, arm 3f),** reported beside the shift, not in the bar. It errs toward a pass.

* For each forward weekend trip, a twin on the same book and side enters at the last print of a minute drawn from that
  book's pool. Its size is min($100, 10 % of that minute's printed quote volume × Xw). It exits by `exit_only()` as
  above, with `usd` that size and `lastX0` the Xw of that minute.
* 2,000 draws, with `rng = random.Random(20260928)`. In each draw, for each weekend trip in the order (book, entry
  minute, side, rung), one pool minute by `rng.randrange`. A draw's value is the sum of its twins' P&L.
* Reported: the mean, the maximum and the p95, the value at index int(0.95 × 1,999) = 1,899 of the 2,000 sorted
  ascending.

## The bar (all seven must hold)

1. W > 0. The reopen marks, and what followed them, are in it.
2. W > the shift's p95.
3. Stress W > 0.
4. **At least 60 weekend round trips, over at least 8 weekends.** If the eight weekends hold fewer than 60, the reading
   waits a weekend at a time, to at most twelve. The count is produced by a script committed before 2026-11-25 00:05
   UTC whose only output is the count, on inputs exported as "Exports" says. Before the reading, no other figure of the
   forward weekends is computed.
5. No single weekend holds more than 40 % of W.
6. **Worth it as an increment.** The $1,200 is already locked for the weekday test and idle at weekends. So the
   increment must add at least 2 %/yr on it over the weeks read: I ≥ $1,200 × 0.02 × 7N / 365 for N weekends. For eight
   weekends that is $3.6822, compared at full precision.
7. **The backward replay's weekends:** W_bt > 0, after their reopen losses. The sign of its tail was seen before the
   freeze and favours the position the rule most likely held, so this condition is close to certain to hold. It is not
   read as pricing the tail; the sign-reversed marks beside it are the bound.

Reported with the bar:

* the three parts of W, and D (its carry-in part and the rest) and I;
* I as a return a year on $1,200;
* trips a weekend;
* orders on each weekend day;
* the reopen table;
* arms 3a–3c and 3f.

## The reading date

**2026-11-25, from 00:05 UTC.** The data run to 11-25 00:00 and positions count if opened before 11-24 00:00. This
holds if the file is frozen before 2026-10-02 21:00 UTC.

With condition 4's wait, the reading moves to the Wednesday after the last weekend added. The latest is 2026-12-23,
after the weekend of 12-18.

Before the reading, nothing of the forward weekends is computed except: data completeness (prints stored, minutes
recorded), the exports' counts and hashes, and, at the reading date, condition 4's count.

## Checks before anything is scored

Checks 1, 2, 3, 4 and 6 gate everything: if one fails, nothing is scored, and the report names it. Check 5 gates the
forward result. A check that fails because of the scorer's code may be fixed and every check run again; the failed run
and the fix are reported. A check that fails on the data voids what it gates. The scorer is written after the freeze,
in `docs/agents/backtests/pr5w/`, and imports `pr5_sim.py` unchanged.

1. **Hashes.** Recorded and checked: this file; `pr5_sim.py` (56fbad85…), unchanged; `test_sim_logic.py`
   (7dedbaa189febaf2d712c7e809d62da79be0375edf1ae620ac1b73245e888243); PR5's committed inputs; and every input of this
   run.
2. **PR5's own checks.** `test_sim_logic.py` passes.
3. **The committed run.** With case 2 switched off (Xw = X), the scorer's inputs reproduce PR5's committed primary run
   exactly: the 8,192 primary round trips in `backtests/pr5/pr5_run1.json.gz`, every field it stores, at the precision
   it stores it.
4. **Made-up inputs pin the substitution.**
   * A dark minute inside a closure takes the last close; one outside stays dark.
   * Friday 20:59 UTC is outside a closure; Sunday 21:00 UTC ends one whether X is live or not.
   * A stray live bar inside a closure is used, and its close is carried to the later dark minutes.
   * The reopen mark has the right sign for a long and for a short, and so does the sign-reversed mark.
   * D is zero when no position is open in any case-2 minute and no weekend trip exists. A fill in a closure's last
     live minute, the minute before its first case-2 minute, moves D's carry-in part off zero when a print inside the
     closure later goes through the arm's exit: the arm places that exit at the next turn, the first case-2 minute,
     and closes as a maker; the baseline, with no fair in the dark, places no exit and closes by its 24-hour stop.
   * A twin δ hours along its book's case-2 line wraps at the line's end, and enters at the first pool minute at or
     after its place.
   * An own fill (a SELL print at a live bid's price, after the order's `ts` and at or before its `updated_at`, that
     fits in what is left of its `filled_base`) is taken out of the tape, one stamped after the order's `filled_at`
     included; a print one tick away, with the same side as the order, or larger than what is left, is not.
   * Arm 3b: a faulty row is not the book at L, and a book seen last 121 s before L is none.
   * The ported `fxBarAt`, `fxAt`, `fairHours`, `fairUAt` and `median` give the answers of their cases in
     `quotes.test.ts`.

   Each check must also fail on a copy with its rule broken.
5. **Faithfulness.** The forward baseline reproduces the engine, as above.
6. **Two runs** of the scorer write byte-identical JSON.

## Power (appendix B's numbers; seen data)

**The rates.** In the 28 days after the books tightened (2026-08-26 → 09-23 on the committed tape), PR5 made:

* about 3.1 round trips a weekday on USDT-GBP and 2.0 on USDC-GBP;
* $0.114 a trip, SD $0.103;
* $0.417 a calendar day, SD $0.569.

Weekend prints run at 79 % (USDT-GBP) and 67 % (USDC-GBP) of a weekday's. Scaled, that is about 3.8 weekend trips a
closure day. A closure is two days, so eight weekends hold about 61 trips and about $6.9 before the reopen, give or
take about $1.6 (B). That is about $0.12 a calendar day, some 30 % of PR5's plan of $0.42.

**Against the bar:**

* **Condition 4 is the likeliest to fail by chance.** 60 trips is the expected count, so at the planning rate eight
  weekends fall short about half the time. That is why the reading may wait, on the count alone, up to four more
  weekends. At the same rate twelve weekends hold about 91. The wait depends on the count and never on P&L. The count is
  not independent of the outcome, though: a one-sided weekend fills more.
* **Condition 6** needs $3.68 for eight weekends, about half the expected $6.9. The reopen losses and D come out of the
  rest.
* **The reopen.**
  * B's one weekend was one-sided: USDT-GBP printed a median 4.6 bps under the fair from Friday's close. So weekend
    positions may be mostly longs from bids. A long loses when GBP/USD rises at the reopen, and gains when it falls.
    The five large gaps in the series were all falls, which is why condition 7 is close to certain to hold; the sign of
    the next one is not known.
  * Per $100 held at a reopen, a median gap moves about 5 cents and the largest about 54.
  * At 5 gaps over 30 bps in 48, eight reopens hold none of them about 42 % of the time. So they cannot price the tail.
    The backward replay's 44 reopens can, a little, and only with their sign seen.
* **Condition 2** is weak evidence. Twins enter at traded prices and the rule at limits, and PR5's null sat far under
  its result: p95 +$43.68 against +$707.90. The shift keeps the weekend's clusters, so it is less narrow than PR5's.

**So** the forward test can say whether weekend quoting earns about what the planning rate says, on a trip count near
60. It cannot tell $5 from $8. It cannot price a reopen shock larger than the backtest's 54 bps.

## What a pass allows

* **A pass allows a paper arm.** That is PR5's rule quoting at weekends by this file, beside PR5's paper engine, into
  tables of its own, proposed to Davies and built only on his word. It changes nothing in PR5's own paper test or its
  2026-10-21 review.
* **The live path quotes at weekends only on his word**, after that paper arm has run. It needs a change first: its
  stale-input guard (GBP/USD older than ten minutes) withdraws the entries in the dark today, and the exits keep their
  price (reference §4 item 35).
* **A fail:** the report names the condition that failed. Weekend quoting is not tried again with another rate,
  closure, rung or size without a new pre-registration. A descriptive arm that would have passed (the coin-implied
  rate, say) is a hypothesis for one, not a pass.

## What it cannot show

* **Whether a post-only order would be accepted at weekends.** The last print decides, as in PR5; the recorded book is
  read beside it, descriptively.
* **The queue at weekends.** That is QUEUE's question, and weekend queues may differ.
* **A reopen larger than the backtest's 54 bps**, a run of them, a reopen of the other sign at that size, or a weekend
  de-peg of USDC or USDT.
* **Whether the last close is the rate the book's other makers use at weekends.** On the one weekend seen, USDT-GBP
  printed 4.6 bps under it at the median.
* **The account's own prints, exactly.** They are matched by time, price, quantity and side, not by an id, so a
  stranger's print at the same price and moment can be taken for one.
* **More than eight weekends of one regime:** the tight books since the week of 2026-08-24.
* **What a live executor would get.** At the live path's £50, the dollars are about a twentieth of the paper's.

Deviations are recorded in the review, the reference and the ledger.
