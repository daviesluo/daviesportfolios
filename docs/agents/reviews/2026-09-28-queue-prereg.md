# Pre-registration QUEUE: Revolut X's stablecoin quotes, filled by their place in the queue

Written 2026-09-28 00:30 UTC and revised the same night after an independent review, and again after that review's
second pass. Frozen by the commit that adds it, which should land before 2026-10-04 00:00 UTC. It was written before
anyone had read a bid, an ask, a price level or a quantity of `agent_book_levels` (the table has only been counted and
its timestamps read), and before any fill, order, position or P&L of these rules was computed on any day of the window.
Nothing below may change after the freeze; any deviation is reported as a deviation. Three hypotheses: Q1 and Q2 carry
a bar, with Holm over the two; Q3 is descriptive. It changes nothing that runs: the recorder, its prune, PR5's paper
engine and its dry-run executor are untouched, no key is read and nothing is placed.

**The dates follow the freeze.** The window is the 28 days from the first Sunday 00:00 UTC after the freeze. Frozen
before 2026-10-04 00:00 UTC, that is 2026-10-04 → 11-01, and every forward date and instant below is for it: the window,
its halves and its start, the days of data, the tape and PR5's inputs, Kraken's hours and pulls, the export, its bounds,
its deadline and the prunes that set it, the plan, the ledger's dates and the reminder. A later freeze moves those, and
only those, by the same whole number of weeks. The dates of what was seen before the freeze, of the dry run before the
window, of the committed histories and of the power section do not move, nor do PR5's own dates (its 2026-10-21 review,
and its live path, which may be armed after it). The seed stays 20261004.

Davies, 2026-09-27, choosing every addition the TESTING review ranked: "MX-1 挂单执行 (推荐), RW-NEXT + 建 RW-C,
QUEUE 排队模型, PR5-R 等低优先级" (MX-1, resting execution, recommended; RW-NEXT, and build RW-C; QUEUE, the queue
model; PR5-R and the rest at low priority).

## Before the window

1. **The export statement, run once without showing a level.** Two statements are run once on production for one
   book-day before the window, and they return counts, a byte length, a hash and timestamps only. The book is
   USDC-GBP, the largest page: it stored 816 distinct books on 2026-09-27 to 21:52 UTC, against USDT-USD's 299. The
   day is 2026-09-28, and they are run after 2026-09-29 00:10 UTC, so that the day is whole.
   * **A** is the page statement of "Data" item 1 with `<BOOK>` USDC-GBP and `<DAY>` 2026-09-28, the window's lower
     bound set to 2026-09-27 22:00, its upper bound and the `seen_until` cap set to 2026-09-29 00:10, and its last
     column (`page`) left out. Its `sha256` column shows nothing of the rows and is kept, so that everything but the
     page is run on production:

         with r as (
           select ts, json_build_object(
                    'book', book,
                    'ts', to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                    'seen_until', to_char(least(coalesce(seen_until, ts), timestamptz '2026-09-29 00:10:00+00')
                                          at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                    'reads', reads, 'bids', bids, 'asks', asks)::text as line
           from public.agent_book_levels
           where book = 'USDC-GBP'
             and ts >= timestamptz '2026-09-28 00:00:00+00'
             and ts < timestamptz '2026-09-28 00:00:00+00' + interval '1 day'
             and coalesce(seen_until, ts) >= timestamptz '2026-09-27 22:00:00+00'
             and ts < timestamptz '2026-09-29 00:10:00+00'),
         p as (select count(*) as n, coalesce(string_agg(line, E'\n' order by ts), '') as body from r)
         select n, octet_length(convert_to(body, 'UTF8')) as bytes,
                encode(sha256(convert_to(body, 'UTF8')), 'hex') as sha256
         from p;

   * **B** is the count that "Complete" in "Data" item 1 takes, on the same predicate, with the least and greatest
     `ts`:

         select count(*) as n, min(ts) as first_ts, max(ts) as last_ts
         from public.agent_book_levels
         where book = 'USDC-GBP'
           and ts >= timestamptz '2026-09-28 00:00:00+00'
           and ts < timestamptz '2026-09-28 00:00:00+00' + interval '1 day'
           and coalesce(seen_until, ts) >= timestamptz '2026-09-27 22:00:00+00'
           and ts < timestamptz '2026-09-29 00:10:00+00';

   A's `n` must equal B's. A's row count, byte count and hash, and B's count and timestamps, are written into the
   ledger's QUEUE item, and nothing else is read: every read of the table before the export is of counts, byte
   lengths, hashes and timestamps. That shows the statement runs as written on the real table, and how large a day of
   the largest book is, so whether one page of it fits the connector. Its base64 and sha256 columns were checked on
   made-up rows ("Data" item 1).

   The two statements run after this file is frozen and before the window opens at 2026-10-04 00:00 UTC. They were
   meant for before the freeze, but the day they read closes only at 2026-09-29 00:10 UTC, and the session that froze
   the file had no database connector. If a statement needs any change, the change is made before the window opens
   and recorded as a deviation of this file, with the result that showed the need. No row of the window exists then,
   so no change can be fitted to one.

The freeze commit also:

* writes into the ledger's QUEUE item the dry run of "Before the window", due before 2026-10-04 00:00 UTC, and the
  dates the run keeps: Kraken's spare pull between 2026-10-18 and 10-25; the scorer and checks 1–3 committed before
  2026-11-02 00:00 UTC; the export after 2026-11-02 00:10 and before 2026-11-06 10:25 UTC; Kraken's main pull on
  2026-11-02 between 00:05 and 19:59 UTC; and the question of a longer retention, put to Davies if check 4 has not
  passed by 2026-11-04 00:00 UTC;
* writes the freeze line into the same item: until the export is taken, none of `agents/books.ts`, the table
  `agent_book_levels`, its prune job `agents-books-prune`, `stepMinute` in `agents/quotes.ts` or its minute record
  (`agent_quote_minutes`) changes, except a longer retention on Davies' word, and any change is a deviation;
* schedules a one-shot reminder for 2026-11-02 00:15 UTC.

## Why

On a pegged book the price hardly moves. So a resting quote there is filled mostly when takers trade AT its price and
use up the orders ahead of it, not when the price moves through it (the fp5 review). Every maker test on Revolut X's
stablecoin books since PR3 (PR4, PR5, PR6 and PR5's paper test) counted only prints strictly through a quote, because
nothing recorded how long the queue was; PR3, before them, counted the closes of minutes that traded, from candles. On a
pegged book a print through the quote is the rarer fill, and the more adverse one.

* PR6 (reference §3.35) quoted 1–3 ticks either side of par on the USD books. On through-fills alone it made +$37.14
  over ten months and failed on stress (−$8.41) and on worth (3.86 %/yr against 8 %).
* The fp5 review found that "no book history" had stopped both fp2 and fp5, and put a recorder on its list (item 5).
  Since 2026-09-26 18:16 UTC, `0057` records the top five levels a side of the four stablecoin books, read 40–45 s into
  each minute since `0058`, stored when they change (`agents/books.ts`, reference §4 item 37).
* Appendix C of the TESTING review (`2026-09-27-testing-review-c-new-tests.md` §3) sketched this test. This file makes it
  exact.

The money is small either way: about $0.25–0.60 a day on $1,200 if it passes (C). Its larger value is the fill model.
It says whether PR5's paper record rests on the right fills, and what a live PR5 test, if Davies starts one after
2026-10-21, should expect. Q3 measures that and nothing else.

## What was seen before the freeze (disclosed)

* **Every earlier result on these books.** PR3, PR4, PR5 and PR6 with their studies. PR5's paper-test spec and its record
  to 2026-09-27 21:38 UTC: 9 round trips, none opened after 09-25 (appendix B). PR6's committed inputs, the UK tape of
  USDC-USD and USDT-USD to 2026-09-26 00:00 UTC. The fp5 review. The first-principles studies.
* **Appendix C's measurements.**
  * On the committed PR6 prints of 2026-08-29 → 09-25: volume by price level and aggressor side, and the prints AT and
    strictly through each of PR6's rungs (the power section below).
  * Kraken's hourly USDT/USD and USDC/USD over the same days, against those prints. The median VWAP was 0.99972 and
    0.99980. The UK prints sat a median −1.2 bps from it on USDT (p10 −4.1, p90 +3.2) and +2.0 bps on USDC. Its Kraken
    pull, made on 2026-09-27, held the 720 hours to that evening.
  * The recorder's coverage on 2026-09-27 00:00 → 21:52 UTC, counted only: each book read 1,310 times in 1,312 minutes;
    distinct books stored: USDC-USD 134, USDT-USD 299, USDC-GBP 816, USDT-GBP 622. The prune job's definition.
* **Appendix B's reads, to 2026-09-27 22:04 UTC:** PR5's engine record to 09-27 21:39 UTC (every minute decided, X dark
  from Friday 09-25 21:40); the USD books' hourly closes the engine stored, read for the fair-lag check; 22 keyless reads
  of USDT-USD's hourly UK candles between 21:45 and 22:04 UTC on 09-27; the GBP books' prints of 09-25 21:40 → 09-27
  21:00, as their range against Friday's close; and the go-live snapshots of PR5's nine fills (`agent_quote_events` of
  kind `book`), all before 09-27.
* **This file's first draft, on 2026-09-28 at about 00:07 UTC:**
  * `select book, count(*), min(ts), max(ts) from public.agent_book_levels group by book`: USDC-GBP 1,190 rows,
    USDC-USD 182, USDT-GBP 1,002, USDT-USD 450. The first rows are from 18:16–18:26 UTC on 09-26, the last from
    00:02–00:06 UTC on 09-28.
  * `cron.job`: `agents-books-prune` is active at `25 10 * * *`; the recorder is a row of `edge-calls-every-minute`.
  * For PR5-W (`2026-09-28-pr5-weekend-prereg.md`), counts of `agent_quote_minutes` for 09-25 18:00 → 09-28 00:00:
    3,240 minutes a book, all with a fairU, 279 with an X (dark from Friday 21:40 to Sunday 23:00).
  * The ledger's note of 2026-09-27 23:43 UTC: PR5's live executor places each paper decision 28.8–33.4 s after the
    paper counts it live (150 orders).
* **The independent review of this draft, 2026-09-28 before 01:10 UTC, by SELECT only:** `information_schema` for the
  `agent_quote_*` tables and `agent_book_levels`; `cron.job` and `cron.timezone` (GMT); `agent_book_levels` per book:
  rows, rows with a null `seen_until` (none), rows before 09-27, the least and greatest `ts`, and the first `ts` not on a
  minute boundary (18:35–19:09 on 09-26); the rows first read since 09-27 00:00, counted by 5-second bucket of their
  `ts`'s second of the minute; `agent_quote_minutes` counts for 09-25 18:00 → 09-28 00:00. Timestamps and counts only:
  no bid, ask, level, quantity, `reads` or `seen_until` value. It also recomputed, from committed files, the figures
  this file quotes.
* **Another review that night, of five other drafts,** read PR5's events and prints (re-price checks) and the live
  executor's orders (lags). All of it is before the window.
* **The two revisions** read the repository. The first also read the committed GBP/USD series for PR5-W's gap medians;
  the second ran statements A and B of "Before the window" on made-up rows. No production data. The review's second
  pass made no production read.
* **The export statement's dry run** ("Before the window" item 1) had not been run at the freeze. It runs after it,
  before the window, and its result goes into the ledger's QUEUE item.
* **No bid, ask, level, quantity or order count of `agent_book_levels` has been read by anyone.** Nothing of the window
  exists at the freeze.

## The window

* **Positions opened 2026-10-04 00:00 → 2026-11-01 00:00 UTC**: 28 days, a Sunday to a Sunday, after the freeze.
* **Halves:** 10-04 00:00 → 10-18 00:00, and 10-18 00:00 → 11-01 00:00.
* **Start and end.** Every rule starts fresh, every rung idle, at 2026-10-04 00:00 UTC. It runs on data to 2026-11-02
  00:00 UTC, so every position opened in the window reaches its exit or its 24-hour stop inside the data. The tape of
  2026-10-03 is read only to give the first minutes their last print.
* **Q3 starts where PR5's engine should stand.** At 2026-10-04 00:00, a Sunday, the engine is normally dark and holds no
  position: no entry is live while X is dark, and the 24-hour stop closes a Friday position by Saturday evening. So a
  fresh start matches it. If its record shows otherwise (an `x` at that minute, or a trip in `agent_quote_trips` opened
  before it and closed after it), Q3 starts at the first later minute at which X is dark and no engine trip is open, and
  says so.

## Data, and when each piece must be taken

Every input is written to a file by script and never printed: the book record and PR5's tables by the page statement
below, the tape and Kraken's bars by the pull scripts. The session that takes them states what it saw: base64 strings,
counts and hashes only.

1. **The book record.** One export, after 2026-11-02 00:10 UTC and before 2026-11-06 10:25 UTC.
   * **Why that deadline.** The daily prune at 10:25 UTC deletes every row first read more than 35 days before: on 11-06
     the rows before 10-02 10:25, on 11-07 those before 10-03 10:25, and on 11-08 it reaches the window itself. The
     export's oldest rows are those still current at 10-03 22:00. Taken before 11-06 10:25, it loses none of them unless
     a book stood unchanged for more than 35 hours. After 11-06 10:25 the export on disk is final.
   * **The pages.** One page per book and UTC day of `ts`, each one SELECT through the connector:

         with r as (
           select ts, json_build_object(
                    'book', book,
                    'ts', to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                    'seen_until', to_char(least(coalesce(seen_until, ts), timestamptz '2026-11-02 00:10:00+00')
                                          at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                    'reads', reads, 'bids', bids, 'asks', asks)::text as line
           from public.agent_book_levels
           where book = '<BOOK>'
             and ts >= timestamptz '<DAY> 00:00:00+00' and ts < timestamptz '<DAY> 00:00:00+00' + interval '1 day'
             and coalesce(seen_until, ts) >= timestamptz '2026-10-03 22:00:00+00'
             and ts < timestamptz '2026-11-02 00:10:00+00'),
         p as (select count(*) as n, coalesce(string_agg(line, E'\n' order by ts), '') as body from r)
         select n, octet_length(convert_to(body, 'UTF8')) as bytes,
                encode(sha256(convert_to(body, 'UTF8')), 'hex') as sha256,
                encode(convert_to(body, 'UTF8'), 'base64') as page
         from p;

     A book's first page is the UTC day of its least `ts` under the same predicate (a timestamp, read first). A page that
     the connector cannot return whole is taken as hours, with the same statement on hour bounds. The statement was run
     on made-up rows before the freeze, in a local Postgres 16 (PGlite): it runs whatever the session's time zone, keeps
     the row still current at 22:00 and drops the one that ended before it, caps `seen_until`, and its sha256 matches the
     decoded page.
   * **Decoding.** A script reads each saved result, drops the line breaks Postgres puts into base64, decodes the page,
     checks its sha256 against the one returned beside it, and writes it. No decoded row is ever shown. The pages are
     joined in (book, `ts`) order, one row a line, into one file, gzipped, whose sha256 is recorded. The run reads only
     that file.
   * **Complete.** The pages' `n` must add up to one `count(*)` of the same predicate, taken right after. If they do not,
     the export is taken again.
   * **The rows still being extended.** `seen_until` is exported no later than 2026-11-02 00:10, so a second export
     gives the same rows. The `reads` of the last row of each book keep growing after that instant; they are exported as
     read and reported. Two exports agree when every row agrees except those `reads`.
   * **No one looks at the rows.** Only the scorer reads them, and only after checks 1–3 below have passed. The one
     other reader is PR5-W's arm 3b (`2026-09-28-pr5-weekend-prereg.md`), which reads the GBP books' rows of its
     weekends. Inside this window it reads them only after checks 1–3 have passed, or after 2026-11-06 10:25 UTC,
     when this export is final, if they have not passed by then. It reads no USD book, so no row that Q1's or Q2's
     bar rests on.
2. **The UK tape**, keyless, for USDC-USD, USDT-USD, USDC-GBP and USDT-GBP:
   `GET https://revx.revolut.com/api/1.0/public/trades/all?symbol={SYM}&start_date=<ms>&end_date=<ms>&limit=100&region=UK[&cursor=…]`.
   * One UTC day a window, [D 00:00:00.000, D 23:59:59.999], days 2026-10-03 → 2026-11-01, pulled after 2026-11-02 00:10
     UTC.
   * Every page is followed to the end, one request every 1.1 s. Prints are de-duplicated by id, and any row not
     labelled UK is dropped.
   * Written as PR6's files are: one print a line, `{"id","price","qty","region","side","ts"}`, sorted by `ts`, then by
     id compared as a string in code-point order (as PR6's `fetch.py` sorts). The files are hashed.
   * For the GBP books, the pull's ids are compared with `agent_quote_prints` over the same days. The union is used: a
     print the store lacks is added, and a print the store holds and the pull lacks is kept. Both kinds are listed.
3. **Kraken's hours (Q2).** `GET https://api.kraken.com/0/public/OHLC?pair=USDTUSD&interval=60` and `pair=USDCUSD`,
   keyless. The reply's keys are `USDTZUSD` and `USDCUSD`, and each bar is [time, open, high, low, close, vwap, volume,
   count].
   * Kraken returns only the 720 most recent bars, the forming one included. The hours needed start at 2026-10-03 21:00
     (the first minute's fair may reach back 180 minutes) and end with the bar that starts at 2026-11-01 22:00 UTC. One
     reply holds them all only if it is pulled between 2026-11-01 23:00 and 2026-11-02 20:59 UTC. The main pull is made
     on 2026-11-02 between 00:05 and 19:59 UTC, and a spare once earlier, between 2026-10-18 and 10-25.
   * The bars used are the union of the pulls. A closed bar in both must agree exactly on vwap and count. If it does
     not, the difference is reported and the later pull is used.
   * If any needed hour is missing, every hour is rebuilt from Kraken's public trades
     (`GET https://api.kraken.com/0/public/Trades?pair=…&since=<ns>`, paged to the end). An hour's VWAP is Σ price ×
     volume / Σ volume over its trades, in exact decimal. The rebuilt hours then replace the OHLC bars for every hour,
     not only the missing ones, and the OHLC bars that exist are compared with them and the differences reported.
4. **PR5's recorded inputs (Q3 only),** by the page statement's method, any time after 2026-11-02 00:10 UTC; these
   tables are not pruned.
   * `agent_quote_minutes`: `x`, `fair_u` and `prints_n` of USDC-GBP and USDT-GBP for 2026-10-04 00:00 → 11-02 00:00. A
     minute with no record is rebuilt from `agent_quote_inputs` (exported from 2026-10-03 00:00) with the engine's
     `fxBarAt`, `fairHours` and `median`, ported to Python and pinned on those functions' cases in `quotes.test.ts`, and
     listed.
   * `agent_quote_trips`: the round trips opened in the window, for check 4, and any opened before 10-04 00:00 and
     closed after it, for Q3's start.
   * `agent_quote_events` in the window: the engine's log, which check 4 reads, and its rows of kind `book`, for check 6.
   * `agent_quote_live_orders` of mode `live`, for PR5's own orders in the GBP books (Q3 below).
   * If PR5's engine stops before 2026-11-02 00:00, Q3 covers the days its record covers and says so.
5. **The plan.** The scorer and checks 1–3 are committed before 2026-11-02 00:00 UTC. The export, the tape and Kraken's
   main pull follow from 11-02 00:10 (00:05 for Kraken). If check 4 has not passed by 2026-11-04 00:00 UTC, a longer
   retention of `agent_book_levels` is put to Davies, so that a faulty export can still be taken again. Nothing here
   assumes one.

## The three rules

**Common to all three: the frozen rules' timing, restated.**

* The loop acts at the start of minute t on data up to t−1. An order placed at t goes live at the start of t+1.
* A fill in minute m is seen at the turn of m+1, where the exit is placed. The exit goes live at the start of m+2.
* A position is not checked for the stop in the minute it was entered. One position per rung at a time; the rung is
  re-placed at the turn after its position closes.
* Every placement, re-price and re-placement counts one order, on the UTC day of the turn that placed it.

**Q1: PR6's frozen rule with two changes: fills by queue position, and a post-only refusal by the recorded book as well
as by the last print** (`2026-09-26-pr6-revx-usd-par-prereg.md`).

* Books USDC-USD and USDT-USD, UK. Prices, sizes and P&L in USD; X = 1.
* Fair = 1.0000, that is 10,000 ticks of 0.0001. Rungs of k = 1, 2 and 3 ticks: bids at 9,999, 9,998 and 9,997; asks at
  10,001, 10,002 and 10,003. $100 a rung. Capital: 2 books × 2 sides × 3 rungs × $100 = $1,200. Nothing is ever
  re-priced, because the fair never moves.
* **Exit:** a post-only order at par. A long exits with an ask at 10,000, a short with a bid at 10,000.
* **De-peg guard.** At the turn of minute t, if the book's last UK print strictly before t is more than 30 ticks from
  par, the minute has no fair on that book. The entry quotes are withdrawn and none is placed. An exit already placed
  stays as it is; an exit not yet placed waits for a minute with a fair. The stop runs as always.
* **24-hour stop.** A position is closed at the last print at or before the end of the minute 24 hours after its fill
  minute, × (1 ∓ (0.0009 + half spread)). The half spread is 0.5 bp on USDC-USD and 2 bps on USDT-USD.
* **Post-only, the frozen test.** When an order goes live, the last print before that instant decides. A bid at p is
  refused if that print was below p, or at p and a BUY. An ask at p is refused if it was above p, or at p and a SELL. The
  queue fill below adds the recorded book to this test, at go-live and at the turn that re-places a refused order.
* **How Q1's bar differs from PR6's.** PR6's bar read ten months: P&L > 0, above a whole-day shift null, stress > 0, at
  least 60 round trips and no day over 1,000 orders, 8 of 11 months positive, no month over 40 %, and 8 %/yr over the
  window and over its last three months. Q1 reads 28 days: P&L > 0 in each half instead of by month; no day over 40 %
  instead of no month; a bootstrap by day under Holm instead of the shift, which is reported; 8 %/yr over the 28 days
  only; a round trip counts only from $1 of entry; and nothing is judged if more than 10 % of a book's minutes are void.
  The 1,000 orders a day is PR6's.

**Q2: the same rungs about Kraken's hourly VWAP instead of par.**

* **Fair.** Fair(t) is the VWAP of Kraken's latest hourly bar of the coin against USD whose end (start + 60 min) is at
  or before t and which has at least one trade (count > 0). In ticks it is the VWAP string read as an exact decimal
  (Python `Decimal`), × 10,000, rounded half up (`ROUND_HALF_UP`). If no such bar started at or after t − 180 min, the
  minute is dark on that book.
* **Rungs.** k = 1, 2 and 3 ticks from that fair: bids at fair − k, asks at fair + k. Exits at fair. Prices are set in
  ticks, not as PR5's fractions of fair, which above 1.0000 would put each rung one tick further out.
* **Re-price.** An entry quote or an exit is re-priced at the turn whenever the fair differs from the fair it was priced
  at. PR5's 0.05 % step would leave a one-tick rung several ticks from a fair that moves a tick or two an hour. A refused
  order takes the new price without an order, as the frozen rule re-targets it.
* **Everything else is Q1's:** the de-peg guard (from par), the stop and its cost, the post-only tests, $100 a rung and
  $1,200.

**Q3: PR5's frozen rule on the GBP books, with the same two changes** (`2026-09-23-pr5-prereg.md`; `simulate()` in
`docs/agents/scripts/pr5/pr5_sim.py`, which `stepMinute` in `agents/quotes.ts` runs minute by minute).

* Books USDC-GBP and USDT-GBP.
* X and fairU are what PR5's engine recorded for each minute in `agent_quote_minutes`: `x`, where null is dark, and
  `fair_u` (a minute with no record is rebuilt, "Data" item 4).
* Rungs of 0.1, 0.2 and 0.3 %: bids floor(fair(1 − k)), asks ceil(fair(1 + k)), in ticks of 0.0001 GBP.
* A quote is re-priced when fair has moved more than 0.05 % since it was priced. Exits at fair: a long's ask rounded
  up, a short's bid rounded down. The stop costs 0.09 % + 0.0067 %. Sizes, and P&L converted at X of the exit minute, as
  PR5's.
* **PR5's own orders in the GBP books.** On Davies' word PR5's live path may be armed after 2026-10-21. From its first
  order of mode `live` in `agent_quote_live_orders`, its bids rest in the books the recorder reads and its fills print
  on the tape. So from that instant Q3 is reported apart, before and after it. After it, the prints that are the
  account's own fills are taken out of the tape, and listed: a print on that book at a live order's price, whose
  aggressor is the other side (a SELL for the account's bid), stamped after the order's `ts` and at or before its
  `updated_at`, taken in time order, each only if its quantity fits in what is left of the order's `filled_base`. The
  window ends at `updated_at`, which every settlement read sets, and not at `filled_at`, which keeps the time the first
  fill was read (`fillStamp`), so a fill completed later would fall outside it. The minutes in which an order of the
  account rested in a book are counted.
* **Q3 is descriptive, and apart from PR5's own test.** It does not touch PR5's paper test, its spec or its 2026-10-21
  review. It is read after 2026-11-02, beside them. Its orders a day are reported against PR5's budget of 700.

## The queue fill (all three rules; the primary is the pessimistic reading)

**How the record maps to the book at an instant.**

* **A row is one book.** The recorder found it first at `ts`, last at `seen_until`, and `reads` times in all, about
  once a minute. Every row has a `seen_until`: `0058` set it to `ts` on the rows written before its code ran. Those rows,
  from 2026-09-26 18:16 UTC to 18:34 at the latest, carry the minute as their `ts`, not the instant of the reading, and
  none is in the export's range. Each book's first row stamped with the instant of its reading is from 18:35–19:09.
* **When the readings fall.** Of the 2,316 rows first read from 2026-09-27 00:00 until the review counted them, 2,310
  were first read 40.0–44.8 s into their minute and 6 at 55.6–58.2 s. So the last reading before an order goes live, at
  a minute's start, is usually 15–20 s old, and the first after it comes 40–45 s later.
* **Two clocks.** A row's `ts` and `seen_until` are the Edge function's clock when a reply arrived (`books.ts` stamps a
  reading after `await res.text()`). A print's `ts` is the venue's. The venue took the snapshot before the reply
  arrived, on a clock the prints do not share. So, against prints, each reading is placed at its instant + 2,000 ms: a
  print stamped at or before that instant is applied before the reading. That is pessimistic both ways: a print before
  a join does not count, and a cap is a min, so a print the snapshot already held is never taken off the queue twice.
  The 2,000 ms applies against prints only: the book at an instant (rule 1) reads `ts` as stored.
* **A row covers every instant from its `ts` to its `seen_until`.** Two readings that found the same book are taken to
  hold that book between them. Between one row's `seen_until` and the next row's `ts`, the book changed at some instant
  and is not known.
* **Faulty rows.** `bookLevels()` stores whatever arrays the venue returns, an empty side included. A row with an empty
  side, or whose best bid is at or above its best ask, counts as not read: it sets no join, no cap and no refusal,
  covers nothing, and a markout against it is missing. Such rows are counted and reported. Every rule below reads the
  other rows, the valid ones, only.
* **Prices and levels.**
  * Prices are ticks: round(price / 0.0001). Quantities are in coins.
  * A side of a row holds at most five levels. If it holds fewer than five, it is the whole side. If it holds five, a
    price is within its recorded depth when it is at or better than the fifth level: a bid at or above the fifth bid's
    price, an ask at or below the fifth ask's.
  * Within the depth, the level quantity at a price is the quantity recorded at that price, or 0 if none is recorded
    there. Beyond the depth, it is unknown.
  * The rule's paper orders are never in the recorded book. PR5's live orders may be (Q3).
* **Minutes a row spans:** the number of UTC minute starts in [minute(`ts`), minute(`seen_until`)]. A row whose `reads`
  is smaller was not read in some of them.
* **Void minutes.** A minute is void on a book when no reading of a valid row fell in it and it does not lie wholly
  inside a valid row's span. A void minute sets no join and no cap. Prints in it apply as in any minute: a print through
  an order fills any live order, and a print at its price moves and fills an order that has already joined. Void
  minutes are counted per book and listed, each with whether the other books were void in the same minute. The
  recorder's own report of a minute, which names a 429, an error or a skipped read, is not stored, so the list can say
  only that much of the cause.

**The rules.**

1. **Going live.** An order the rule places at the turn of minute t goes live at the start of t+1 (call it L), as in
   the frozen rules. It is refused (post-only) in either of two cases:
   * the frozen last-print test refuses it;
   * the book at L shows that it would cross: a bid at or above the best ask, or an ask at or below the best bid.

   The book at an instant T is the valid row with the greatest `ts` at or before T, if its `seen_until` is at least
   T − 120 s. With no such row, the last-print test decides alone.

   **A refused order at a later turn t** takes the new price without an order when the rule re-targets it, as the
   frozen rule does. It is re-placed, as one order, only if the last print before t is not through it AND the book at t
   does not show it crossing; with no book at t, the last print decides alone. The frozen rule looks only at the last
   print. Without the book at the turn, a quote the book refuses and the last print does not would be re-placed every
   minute for as long as that print stood, up to 1,440 orders a rung a day, and condition 4 would fail on a loop the
   model made.
2. **Joining the queue.** An order joins no earlier than the first reading after it went live.
   * If a valid row covers L, its `seen_until` is later than L, and it holds the order's price within its depth, the
     order joins at min(`seen_until`, L + 60 s) + 2,000 ms, behind that row's level quantity at its price. Why that
     instant: the recorder reads each minute at 40–45 s, so a `seen_until` later than L + 60 s means the row was also
     read in (L, L + 60 s], and an earlier one is that reading itself.
   * Otherwise it joins at the `ts` + 2,000 ms of the first valid row after L that holds its price within its depth,
     behind that row's level quantity.
   * Before the join, a print at the order's price neither fills the order nor moves it forward. Only a print through
     it can fill it (rule 5).

   Why not at L. `sameBook` in `books.ts` compares every level's price, quantity and order count, so a row that covers
   L means the readings before and after L found identical books. A print at the order's price between them hit
   liquidity neither reading saw: an order that came after the earlier reading and was gone by the later one, or a level
   refilled to the same quantity and count. If that order came before L, it stood ahead of the rule's order, and the
   print filled it. Joining at L would charge that print to the recorded queue and move the order forward, or, where
   the level was absent, fill the order with it. That is the one case where the record proves there was liquidity it
   cannot place, and joining at L would resolve it in the rule's favour. So everything recorded at the order's price at
   the first reading after L is taken to be ahead of it, and nothing is credited before that reading. Joining at L is
   the middle arm (3h); joining the last book before L is the optimistic arm (3b).

   **The residual risk** is a minute the recorder missed inside a row's span: then the row was not read in
   (L, L + 60 s], and the join at L + 60 s + 2,000 ms comes before the first reading after L. Rows whose `reads` fall
   short of the minutes they span are counted (arm 3g).

   It also settles the other cases:
   * **The level is absent:** no quantity is recorded at the order's price, within the depth. The queue ahead at the
     join is 0. A price that improves on the best level is one such case.
   * **Beyond the five recorded levels:** the order does not join until a row shows its price within the depth. Until
     then only a print through it can fill it.
   * **No valid row covers L:** the book changed between the last reading before L and the first after it, or it was
     not read that minute. The order joins at the next valid row that shows its price, whenever it comes.
3. **Moving forward.** After the join, prints are taken in time order: by `ts`, then by id compared as a string in
   code-point order, with the readings placed among them as above. Each print at the order's price, on the side that
   takes it (a SELL for a bid, a BUY for an ask), first uses up what stands ahead of the order: its queue ahead, and the
   rule's own orders ahead of it (rule 7). The part of the print past that fills the order at its price. A print at the
   order's price with the other aggressor moves nothing.
4. **Readings after the join.** At each later valid row that holds the order's price within its depth, placed at its
   `ts` + 2,000 ms, the queue ahead becomes the smaller of its current value and that row's level quantity at the price.
   Nothing else moves it.
   * A cancellation is taken to come from behind the order, except where the level has become smaller than the queue
     ahead.
   * Orders that join the level after it are behind it, so the queue ahead never grows.
5. **Through.** A print strictly through the order's price fills it as the frozen rules do, whether or not it has
   joined, in any minute, void or not. An entry fills at min($100, 10 % of the minute's printed volume); an exit fills
   what is left of it. The minute's printed volume is Σ qty × price over its prints of both sides: in USD for Q1 and Q2,
   as PR6; in GBP, then × X, for Q3, as PR5.
6. **Size.** An entry fills once, as in the frozen rules.
   * The first print that reaches it (through, or at its price past what stands ahead) sets the position, and the rest
     of the order lapses.
   * An at-price fill is the part of the print past what stands ahead, at most the order's $100 (for Q3, $100 at X).
   * The two sizes differ in kind: a through fill takes the minute's 10 %, an at-price fill one print's excess. So an
     at-price entry can be dust, a real order would have kept filling at the front of the queue, and the model
     understates its dollars. A dust entry would still end the entry and hold the rung, and count as a round trip. So a
     round trip counts toward condition 4 only if its entry notional is at least $1; every round trip is reported. This
     was chosen over sizing an entry from every at-price print of its minute because it leaves the frozen "an entry fills
     once" as it is.

   An exit fills in pieces.
   * Each at-price print that reaches it takes what it can of what is left.
   * A print through it closes what is left, and so does the 24-hour stop.
   * The position closes when nothing is left. Its P&L is the sum of its pieces, each converted at X of its own minute
     (for Q1 and Q2, X = 1). Its exit minute is the minute of its last piece. It counts as stopped if the stop closed
     any of it.
7. **The rule's own orders at one price, on one book and side.** An entry and an exit never share a price: an entry
   sits at least a tick from the exit's price in Q1 and Q2, and several ticks in Q3. The case that happens is several
   positions' exits at one price: one sweep fills three bids, and their three asks at the exit price are placed at the
   same turn and go live together.
   * They form one queue with the recorded quantity, in join order. Order j stands behind its own queue ahead A_j and
     the unfilled remainder of each of the rule's orders at that price that joined before it.
   * A taking-side print of q coins at that price gives order j min(rem_j, max(0, q − A_j − Σ_{i<j} rem_i)), every value
     taken before the print. Then A_j ← max(0, A_j − (q − Σ_{i<j} fill_i)).
   * When join instants are equal, the order placed at the earlier turn goes first, then rung 1, 2, 3.
   * A worked case: queues ahead A = (100, 150) and remainders (50, 50) coins. A print of 120 gives the first order 20
     and the second 0, and leaves A = (0, 50). A second print of 100 completes the first (30) and gives the second 20.

   Why: each order carries its own queue ahead. Taking the first order's queue and handing its excess to the later
   orders would ignore what joined between them, which errs toward fills.
8. **Re-price, re-placement, withdrawal.** Each ends the order's place. A re-priced or re-placed order is a new order:
   it goes live and joins afresh.

**The stress version** is the same with three changes:

* every quantity read from the book for a queue, at the join and at each cap, is multiplied by 1.5;
* a through fill needs a print one more tick through;
* the stop costs twice as much: 0.18 % plus the full spread. That is 1 bp on USDC-USD and 4 bps on USDT-USD for Q1 and
  Q2, and 0.0134 % for Q3.

## Arms

1. **Primary**, for Q1, Q2 and Q3.
2. **Stress**, for all three. For Q1 and Q2 it is in the bar.
3. **Descriptive**, never in the bar:
   * a. **Through only:** the frozen rules' own fills (the last-print test, prints strictly through) on the same days.
     For Q1 that is PR6's fill. For Q3 it is PR5's paper engine's, which check 4 requires it to reproduce.
   * b. **The optimistic queue:**
     * the order joins at L behind the level in the book at L (rule 1's book; with none, as the primary);
     * prints count from L;
     * at each later row, a level that has shrunk by more than the at-price prints since the previous reading moves the
       order forward in proportion. With q_before the level quantity at the previous reading, P the at-price prints on
       the taking side since, and q_now the level quantity now: if q_now < q_before − P, the queue ahead becomes its
       value × q_now / (q_before − P). It is then capped at q_now, as in the primary.
   * c. **The last-print test alone:** the primary without the book's post-only test, at go-live and at the turn. The
     orders the book's refusals add or save are the primary's orders less this arm's, reported by day.
   * d. **The live lag.** PR5's executor places each paper decision 28.8–33.4 s after the paper counts it live. For a
     live queue that means two things. A new order misses the first half-minute of its first minute, and a queue that
     forms then is ahead of it. And an order the rule has already replaced can still be filled at its old price for
     up to 90 s. The arm:
     * every order goes live 30 s after the instant the frozen rule gives it;
     * an order the rule removes at the turn of minute t (re-priced, re-placed or withdrawn) stays live, at its old
       price and place, until 30 s after the start of t+1;
     * if the old order fills in that overlap, the rung takes that position and its new order is withdrawn at that
       instant; if one print reaches both, the old order fills;
     * the post-only tests and the join are read at the delayed instant.
   * e. **Markouts** of entry fills at the queue against entry fills through, at +5 and +60 minutes after the fill print.
     The measure is the mid of the book at that instant (rule 1's book), less the fill price for a bid, or the fill
     price less the mid for an ask, over the fill price, in bps: positive is in the rule's favour. With no book at that
     instant, or a faulty row there, the markout is missing, and counted.
   * f. **The queue at the join**, in coins and as a multiple of the order. The minutes from go-live to join and from
     join to fill.
   * g. **Counts and splits:**
     * orders a day;
     * void minutes a book, and faulty rows a book;
     * rows whose `reads` fall short of the minutes they span;
     * fills from orders whose go-live had no book;
     * round trips whose entry is under $1;
     * everything by book, side, rung, half and week.
   * h. **The middle queue:** this file's first join rule. The order joins at L itself, behind that row's level, if a
     valid row covers L and holds its price within its depth; otherwise as the primary. Prints count from the join.
   * i. **The hourly shift**, the sanity check described under condition 2.

   For Q3, arm a is set beside the primary as the queue model's answer to PR5's fill: trips, fills by kind, P&L and
   markouts.

## Condition 2: a bootstrap by day, with Holm (Q1 and Q2)

**The test.** For each of Q1 and Q2, the primary's P&L is summed by UTC entry day: the P&L of every round trip opened
that day, both books together, 28 values in date order, a day with none counting 0. There are 10,000 resamples. Each
draws 28 days with replacement, one after another, by `rng.randrange(28)` over the 28 in date order. Each hypothesis
has its own generator, `rng = random.Random(20261004)`, so Q1 and Q2 draw the same days. A resample's value is the sum
of its 28 days. p is the share of the 10,000 resamples whose value is at or below 0.

**Holm over Q1 and Q2.** Condition 2 holds for the hypothesis with the smaller p if that p is at most 0.025, and then
for the other if its p is at most 0.05. If the smaller p is above 0.025, condition 2 holds for neither. If the two are
equal, both need 0.025.

**Why a bootstrap and not the shift.** A shifted twin enters at a traded price and the rule at a limit, so the primary
is not exchangeable with any shifted value, and a shift's p is a rank, not a probability. PR6's shift null sat far
under its result (p95 −$130.65 against +$37.14), so here it would give p = 1/672 whenever P&L > 0, and Holm over a
condition that always holds would add nothing: the pass would rest on point estimates of two correlated rules on the
same 28 days, and "if either passes" roughly doubles the chance of a false pass. The bootstrap can fail. Its days are
not quite independent, since a de-peg can span two, and that errs toward a pass. On only 28 days whose P&L is skewed,
the share of resamples at or below zero also runs short of the true chance, which errs toward a pass as well, and a
loss day that is not among the 28 can never be drawn.

**The hourly shift (descriptive, arm 3i).** A circular shift by whole hours, reported as a sanity check, not a test.

* **The twins.** Each primary round trip gets a twin on the same book and side, with the trip's own dollar size (its
  entry notional). For a shift δ of whole hours, δ = 1 … 671, the twin's start is the trip's entry minute plus δ hours,
  wrapped within [2026-10-04 00:00, 2026-11-01 00:00).
* **Entry.** The twin enters at the last print of the first minute at or after its start that has a print and is not
  dark on that book, searching forward and wrapping at the window's end. It enters at that print's price.
* **Exit.** From there it runs the rule's exit with the queue fill: the exit at fair placed at the next turn and live
  the minute after, both post-only tests, the join, at-price pieces and through prints, the 24-hour stop, and the end
  of the data.
* **Each twin runs alone**, as PR6's did: twins share no print with each other or with the primary.
* **One value** is the sum of every twin's P&L for one δ, with the same δ on both books. Reported: the share of the 671
  values at or above the primary P&L, and the p95, the value at index 636 of the 671 sorted ascending.

## The bar (Q1 and Q2, each)

**Coverage first.** If more than 10 % of either USD book's 40,320 window minutes are void, Q1 and Q2 are reported and not
judged. That is neither a pass nor a fail. It leaves open only what a fail leaves open ("What a pass allows"): nothing
is proposed, and the par books and Kraken's fair are tried again only under a new pre-registration.

Otherwise all six must hold:

1. P&L > 0, and P&L > 0 in each half, counting each position in the half it opened in.
2. The day bootstrap, under Holm as above.
3. Stress P&L > 0.
4. At least 60 round trips whose entry notional is at least $1, and no UTC day over 1,000 orders, both books together.
   1,000 is the venue's limit on one account and PR6's frozen number. PR5's paper spec used 700 to keep 300 of PR5's
   account for other rows; the row a pass would propose trades from a sub-account of its own.
5. No single UTC day holds more than 40 % of the P&L, counting each position in the day it opened.
6. Worth money: at least 8 %/yr on $1,200 over the 28 days. That is P&L ≥ $1,200 × 0.08 × 28 / 365 = $7.3644, compared
   at full precision.

Reported with the bar: the return a year on $1,200; P&L and trips a day; fills by kind (queue or through); stops, their
count and cost; orders a day; void minutes and faulty rows; round trips under $1; the halves; and each book apart.

## Checks before anything is scored

Checks 1, 2, 3 and 5 gate everything: if one fails, nothing is scored, and the report names it. Check 4 gates Q3 only.
Check 6 gates nothing. A check that fails because of the scorer's code may be fixed and every check run again; the
failed run and the fix are reported. A check that fails on the data voids what it gates.

1. **Hashes.** Recorded and checked: this file; `pr5_sim.py` (56fbad85ee4df6292f596188d091ad064d030180f33cefe3bd09089d7e772a1a)
   and `test_sim_logic.py` (7dedbaa189febaf2d712c7e809d62da79be0375edf1ae620ac1b73245e888243), both unchanged; PR6's
   and PR5's committed inputs, as their pre-registrations hash them; and every input of this run.
2. **The scorer reproduces the frozen simulator.** The scorer is written after the freeze, in
   `docs/agents/backtests/queue/`. It re-implements PR5's turn with the queue layer on top. With the layer off (the
   last-print test, through fills only), it must reproduce two committed results exactly:
   * PR6's 8,341 primary round trips in `backtests/pr6/pr6.json` (sha256 a9cefc21…), from PR6's committed inputs over
     PR6's windows;
   * PR5's 8,192 primary round trips in `backtests/pr5/pr5_run1.json.gz`, from PR5's committed inputs.

   Exactly means every field those files store for a trip — book, side, rung, entry minute, fill print time, entry,
   exit minute, exit, how it closed, notional and P&L — equal at the precision the file stores it. PR5's own
   `test_sim_logic.py` must also pass.
3. **The queue layer pins its rules on made-up books and prints.** Each check must also fail when its rule is removed or
   altered, shown on a deliberately broken copy, as PR6's checks were.
   * An order live at L inside a valid row that covers L and was read again after it joins at that reading + 2,000 ms,
     behind the whole level. A print at its price, on its taking side, 10 s after L fills nothing and moves nothing.
     After the join, a print of exactly the queue fills nothing; one more coin fills one coin.
   * A print stamped 1.5 s after a reading's instant is applied before that reading: before its cap, and before a join
     at it.
   * An order that goes live in a gap joins at the next valid row's `ts` + 2,000 ms. A print at its price before then
     fills nothing and moves nothing.
   * A print at its price with the other aggressor moves nothing.
   * A later row with a smaller level caps the queue ahead. A larger one does not raise it.
   * A row with an empty side, a row whose best bid equals its best ask, and a crossed row, whose best bid is above its
     best ask, each set no join, no cap and no refusal, and a markout against any of them is missing.
   * In a void minute, a print through fills a live order, a print at the price fills a joined order past its queue,
     and a print at the price does not join an order waiting to join.
   * A price beyond the fifth recorded level joins nothing until a row shows it within the depth. A print strictly
     through it fills at the frozen size.
   * A bid at or above the best ask of the book at L is refused. The same book seen last 121 s before L does not refuse
     it. At the next turn, with the last print not through the bid, it is not re-placed while the book at the turn
     shows it crossing, and is re-placed once it does not.
   * An entry fills once, and the rest of it lapses. An exit fills in pieces, and a through print closes what is left. A
     round trip whose entry is under $1 does not count toward condition 4.
   * Two orders at one price, 50 coins each, with queues ahead of 100 and 150 coins: a print of 120 gives 20 and 0 and
     leaves queues of 0 and 50; a second print of 100 gives 30 and 20. Three exits that join at one instant take their
     turns in rung order.
   * A re-price loses the order's place.
   * Stress: × 1.5 at the join and at every cap; a through fill needs one more tick.
   * Q2's fair: the latest closed bar with a trade; dark after 180 minutes without one; a VWAP of "1.00185" is 10,019
     ticks (binary floating point gives 10,018).
   * Arm 3d: an old order that fills in the overlap takes the rung's position and withdraws its replacement; one print
     that reaches both fills the old order.
   * The day bootstrap on a made-up series of 28 days returns the p computed by hand.
4. **Q3 reproduces PR5's engine.** With the layer off, Q3 must reproduce `agent_quote_trips` opened in the window: every
   engine trip matched, and no replay trip left unmatched. A match means the same book, side, rung, entry minute, fill
   print id, entry, size (to 1e-9), exit minute, exit (to 1e-9) and how it closed, and P&L to $0.000001. Allowed, and
   each listed:
   * any minute whose inputs differ between the engine and the replay: its `prints_n` differs from the replay's count of
     that minute's prints, in either direction (a minute from which the account's own fills were taken out is one), or
     it has no record and was rebuilt;
   * every difference that follows from such a minute on that book, until the first minute at the end of whose step
     every rung of that book is idle in both runs (in the engine, as its event log shows).

   **Idle** is read at the end of a minute's step, after its turn, its go-live checks, its prints and its stop: the
   rung holds no quote and no position. A rung whose position closes in a minute is idle at the end of it, and is
   placed again at the next turn. In a live minute every idle rung is quoted at the turn, so, short of every rung's
   position closing in the same minute, the rungs of a book are all idle only at the end of a dark minute (no fair) in
   which neither run holds a position. So one input difference on a weekday allows every difference that follows on
   that book for the rest of that week, unless such a dark minute comes sooner: check 4 is waived there until then.

   If check 4 finds that PR5's engine did not run its rule, the finding goes into PR5's record. It does not reopen PR5's
   2026-10-21 verdict.
5. **Two runs of the scorer write byte-identical JSON.**
6. **The recorder against PR5's own snapshots** (reported; it gates nothing). Each `agent_quote_events` row of kind
   `book` in the window, passed through `bookLevels` (ported), is set against the valid row that covers its
   `detail.at`. Reported: the share equal level for level, and the count of each kind of difference (no row covers it,
   a price differs, a quantity or order count differs). The report shows no level. It measures how good the recorder is.

The scorer opens the export, the tape and Kraken's hours only after checks 1–3 have passed. Before that they are only
pulled, counted and hashed, and the tape's GBP print ids compared with the store's.

**A second record of the GBP books, fenced.** `agent_quote_events` rows of kind `book` hold the venue's top five levels
of each GBP book, written at every minute a PR5 order goes live, about 25 s after L, since 2026-09-23 and never pruned.
`agent_quote_live_orders.book_seen` holds the book each dry-run or live order met. Inside the window, none of either is
read before the scorer has passed checks 1–3, except what PR5's own 10-21 review reads under its spec (the snapshot of
each of PR5's fills).

## Power: what 28 days can and cannot resolve

**What appendix C measured**, on the committed PR6 prints of 2026-08-29 → 09-25. These are four weeks before the
recorder; nothing of the window was used.

* USDC-USD traded $30.3k a day (1,220 prints in 28 days). USDT-USD traded $52.5k a day (1,723 prints).
* 1,167 prints were AT one of PR6's rung prices: $89.0k, counting at most $100 of each, against $243.9k strictly
  through.
  * On USDC-USD: 118 sells at 0.9999 and 194 buys at 1.0001 (rung 1); 156 sells and 326 buys (rung 2).
  * USDT-USD traded under par, so its par bids were mostly through, which post-only refuses.
* **The ceiling.** Suppose every one of those AT prints had filled a $100 rung at the FRONT of its queue, with no stop.
  They would have added +$16.49 of entry edge in 28 days, $0.59 a day. PR6's through-fills made +$1.54 in the same days.
  The ceiling also assumes the exits cost nothing. Q1's exits join the par level, likely the deepest level on a pegged
  book, so a pass needs fills from the queue on both legs, not only the entries.
* **The bar is $7.36 in 28 days.** So a pass needs roughly (7.36 − 1.54) / 16.49 ≈ 35 % of that ceiling to survive the
  queue, the exits and the stops.

**What the test can resolve.**

* The question it is built for: whether fills at the back of the recorded queue come at a useful rate. At the front of
  the queue the ceiling is about twice the bar. At the back of a deep resident queue that is never used up, the queue
  adds nothing, and the result can fall below PR6's: the book's refusals remove fills, and a dust entry at the order's
  price can take the place of a larger through fill.
* The pessimistic primary and the optimistic arm (3b) bracket the model's answer, with the middle arm (3h) between
  them.
* A result far from the bar, either way.
* **Condition 2.** At condition 6's $0.263 a day, the day bootstrap passes at 0.025 only if the daily P&L's standard
  deviation is under about $0.71 (1.96 standard errors over 28 days). PR5's post-change GBP backtest ran at $0.569 a
  day. So it binds when the losses are lumpy, which is what it is there to catch.

**What it cannot resolve.**

* **A true rate near the bar.** One de-peg day can move 28 days by a dollar or two. In PR6, a stop cost 15.5 bps on
  average, and USDT-USD's guard darkened 553 minutes on 2026-05-28 alone. Conditions 1, 2 and 5 can turn on a few days.
* **Q1 against Q2.** They share the days and the books. A difference of a few dollars between them is noise.
* **The order count.** With the book read at the turn as well as at go-live, a quote the book refuses is not re-placed
  while the book still shows it crossing. Days of many re-placements can still come from Q2: while Kraken's fair sits
  inside the UK book, its quotes cross it. On USDT, the UK prints sat −4.1 to +3.2 bps from Kraken's VWAP, p10 to p90
  (C). Arm 3c shows how many orders the book's test adds or saves.
* **Honest odds.** Appendix C put about 20 % on Q1 or Q2 clearing all six conditions, before condition 2 became a test
  that can fail. It is lower with it, by an amount not computed. If one passes, it earns about $0.25–0.60 a day on
  $1,200.

**Q3** is descriptive. PR5's paper engine made 9 round trips from 6 fill minutes in its first 4.27 days (appendix B),
so 28 days hold a few dozen through-fill trips. Q3 can say how many fills the queue adds, and at what markout. It
cannot say whether PR5 is worth money; that is PR5's own review.

## What a pass allows

* **A pass of Q1 or Q2 allows one thing: a paper row**, "Stablecoin quotes (USD)", proposed to Davies and built only on
  his word. It would be:
  * a second configuration of `agents/quotes.ts`, whose fills read `agent_book_levels` by this file's rule;
  * one more row of `edge-calls-every-minute`, and tables of its own.

  Appendix C §3 lists the build. If both pass all six conditions, condition 2 under Holm, the one with the larger P&L
  goes. No money moves without his explicit go, and the first live order needs his confirmation in the same
  conversation. A live test would also need USD, USDC and USDT on a sub-account.
* **Q3 changes nothing.** It is reported beside PR5's record, after PR5's 10-21 review, as the fill model under it.
* **A fail:** the report names the condition that failed. The par books and Kraken's fair are not tried again with other
  rungs, sizes, guards or queue rules without a new pre-registration. A descriptive arm that would have passed is a
  hypothesis for a new pre-registration, not a pass.

## What it cannot show

* **The venue's priority rule.** Price-time priority at a level is assumed, not measured. If the venue fills a level
  another way, the queue model is wrong in a direction nobody knows.
* **The rule's own order in the book.** A real order at the touch changes what others do: a resident maker may step
  ahead or pull, and an incoming order that would have traded with it rests instead. The model sees none of it. It also
  misses the fill a real order gets when an incoming order crosses to it without a print.
* **The book between readings.** The recorder reads once a minute, 40–45 s in. A level that fills and empties within
  a minute is never seen, and a minute it missed inside a row's span is taken as read (rule 2's residual risk).
* **Hidden or iceberg quantity**, if the venue has any.
* **The account's own prints, exactly** (Q3, from PR5's first live order). They are matched by time, price, side and
  quantity, not by an id, so a stranger's print at the same price and moment can be taken for one.
* **Fills beyond the five recorded levels.** They come only through.
* **A live post-only acceptance.** The book it is judged on is up to 120 s old.
* **More than 28 days, and more than one regime.** These are the tight books since the week of 2026-08-24.
* **Kraken's bar at its close.** A live engine would read the bar seconds or minutes late. Q2 uses it at its close.
* **Whether this account pays 0 % maker on these books.** The venue's schedule says so for every account.

Deviations are recorded in the review, the reference and the ledger.

## Considered and not changed

* **The cause of each void minute.** The review asked that void minutes be listed by cause: a 429, an error or a
  skipped read. The recorder's report of each minute names it, but it is returned to pg_net only, which keeps it for
  hours. Storing it would change `books.ts`, which this file freezes until the export, and the coverage floor does not
  need it. So the list gives each void minute and whether the other books were void in it, and no more.

## Deviation 1 (2026-10-03, Davies' word): the books are read before the export

Told that the realistic twins' crossing refusals could be checked against these books only after the export, Davies
answered: "这个研究本来就是为了测试记录的，有用的话就用，之后都用这个来辅助判断是不是更好？" From 2026-10-03 01:45 UTC
`agent_book_levels` is read for other checks and studies; the first read
(`docs/agents/backtests/twins/size/book_check.sql`) took rows before the window only. Nothing frozen here changes: the
recorder, its table, its prune job, `stepMinute`, the window, the scorer and checks 1–4 stand as written, and the
reading after 11-02 runs as written. It is no longer blind, and its report says so: the books, rows of the window
included from now on, may have been read by then.

