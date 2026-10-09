# Pre-registration TAKE: "Stablecoin quotes variant-2", variant-1 plus a taker entry when the book rests through a rung

Written 2026-10-03 and frozen by the commit that adds it, which must reach `main` before 2026-10-05 00:00 UTC. If it
lands later, the window starts at the first Monday 00:00 UTC after it lands and every date below moves by the same
whole number of weeks. Nothing below changes after the freeze; a change is a recorded deviation (this file, the
reference, the ledger). Davies approved the study and a forward test if it held up ("可以 批准研究后上线测试…你决定吧");
the names are his of 2026-10-03: the base, PR5's rule at £50 a rung, is "Stablecoin quotes variant-1"; this test is
"Stablecoin quotes variant-2" (internal id `take50`); rule D's twin is "variant-3".

## What was seen before the freeze

* The study (reference §4 item 52, `docs/agents/backtests/take/`): Revolut X's recorded UK books, PR5's minute records and
  prints, 2026-09-26 18:30 → 10-03 02:00 UTC (lit Monday 09-28 to Friday 10-02). The touch was through PR5's 0.1 % rung
  in 841 book-minutes (USDT-GBP bids 578, its asks 126, USDC-GBP bids 137) in 33 episodes; 6 reached 19 bps.
* **The rule below** (a take keeps, after its 0.09 % fee, at least the k its rung's maker fill keeps): 6 IOCs, 1 unfilled,
  5 round trips, 4 won, +£0.40 at £50 a rung (16.0 bps a trip), +£0.87 at £100 (17.5); median hold 6 h, no 24-hour
  stop. Net of the one maker trip of PR5's paper rung it displaced (+£0.22 at £50): +£0.18. Halves (split at the median
  lit minute, 09-30 10:20): 3 trips +£0.07, 2 trips +£0.33, both of 10-01.
* The sensitivity, at £50: the IOC at the rung's own price (k − 9 bps kept) 17 trips, 8 won, +£0.35, first half −£0.11,
  net of displaced trips +£0.09; fixed margins over the fee of 5 / 10 / 15 bps +£0.60 / +£0.66 / +£0.49, net +£0.39 /
  +£0.44 / +£0.27. The order matters: the rung's-own-price reading was priced first, then the margins, then the
  principle's reading frozen here. The principle is the one the study was given before any data ("the rung itself"); the
  rule frozen here is not the in-sample best (the 10 bps margin is).
* Random-minute takes at the touch with the same exit lose 11–14 bps a trip; 5 of them sum to −£0.29 on average (95th
  percentile −£0.07) against the rule's +£0.40. That null is weak: a take is costly whenever the book is not through fair.
* Fair mostly holds: from the 33 episodes' first minutes (gap 12.8 bps) the book's mid closes 6.2 bps in an hour and
  9.4 in four, while fair moves 2.8 and 0.2 bps toward the book; at 24 hours fair has moved 5.6 bps toward it on the mean
  and 5.0 away on the median. The first hour's drift is about all that a take keeping 1–3 bps after its fee has to
  spare, and those takes lost.
* Disclosure: inspecting the twins' input file printed its first 200 characters of rule D's decisions (three order
  placements of 2026-09-28 00:00 UTC, no fill or P&L). Nothing else of rule D, PR5V or rule D's twin was read.

## The rule

Variant-2 is variant-1's twin (PR5's rule carried out by the live executor's code on a simulated account, £600, £50 a
rung, migration `0088`) with one addition, active from 2026-10-05 00:00 UTC (`take.from`); before then it is variant-1.

At each turn, for each of the twelve rungs (book, side, k ∈ 0.1 / 0.2 / 0.3 %):

1. **Eligible** when the executor's rung holds nothing and has no exit or stop open, PR5's paper rung is not in a position,
   the book's entry guards are clear (caught up, fair present, USD hour fresh, both de-peg checks), the governor is at
   "all", no loss stop holds, and entries go to the instance's live book.
2. **The book** is the last `agent_book_levels` row of the book read at or before the turn and seen at most 90 s before
   it; with none, no take.
3. **Trigger**: a bid rung when the best ask ≤ L = floor(f × (1 − k − 0.0009) / 0.0001) ticks; an ask rung when the best
   bid ≥ L = ceil(f × (1 + k + 0.0009) / 0.0001); f is the executor's own fair for the paper minute (`inputs[b].f`).
4. **Action**: the rung's open entry, if any, is cancelled and read back (a frozen cancel waits); then one IOC, taker,
   limit L, for `rungBase(£50, L, pair, side)`, after the entry's free-GBP or free-coin check. Recorded as leg `entry`
   with `paper_oid` null and `request.take: true`, the book row's `ts` and touch beside it. One take a rung a turn.
5. **The fill** walks the first recorded read after the turn (the same row when its `seen_until` is after the turn, else
   the next row within 60 s), up to L; with none, nothing fills. 0.09 % taker fee, a buy's in the coin; pennies as
   `revx_sim.ts` moves them. The position is then any entry fill's: exit at `exitTicks(fair)`, re-priced past 0.05 %, the
   24-hour stop, all unchanged.

## Window, reading and bar

* **Window**: take trips opened 2026-10-05 00:00 → 2026-11-02 00:00 UTC (20 weekdays). If fewer than 15 have closed by
  then, it extends a week at a time, to 2026-11-30 00:00 at most; it ends with the first week that brings 15. A trip
  is closed by its maker exit or its stop; one still open at the reading is marked at the book's last print.
* **Reading**: on or after the window's end + 2 days, by a script committed before the window ends, from
  `agent_quote_twin_take50_*` and variant-1's tables. Until then a session reads only health (`last_error`,
  `updated_at`, the replica check, check K1); variant-2's trips, fills and P&L stay unread by sessions (the page is
  Davies').
* **Checks before scoring**: K1, variant-2's tables equal variant-1's to the penny for everything before
  2026-10-05 00:00 UTC; K2, each take's fill recomputed from its recorded read. K1 failing voids C4 (reported); K2 failing
  is a deviation, rescored with the recomputed fills.
* **The bar, all four**:
  * C1: at least 15 take trips.
  * C2: their realised P&L in pounds (fees and pennies, the twin's own booking) is above zero.
  * C3: a day-block bootstrap of the window's weekdays' take P&L (by entry day; a day with none is 0), Python
    `random.Random(20261102)`, 10,000 resamples of as many days with replacement, sorted: the one at index 499 > 0.
  * C4: variant-2's realised P&L minus variant-1's, over round trips opened in the window, > 0 (the takes net of what
    they displace).
* **Descriptive**: by book, side and rung; halves; IOC fills and partials; the displaced maker trips; the mid and fair
  15 / 60 / 240 / 1,440 minutes after each take; the random-minute null as the study computed it.
* **Power** (`study.py power`: one take a weekday, a trip's spread 15 bps): C2 and C3 pass with probability 0.07 at no
  edge, 0.49 at +5 bps a trip, 0.77 at +8, 0.89 at +10, 0.99 at the study's +16.

## What it allows

A pass is put to Davies: the take for the live executor only at £50 a rung or more (at the live account's £10 a penny is
10 bps, about the margin) and only on his word. A fail drops it; another limit or a single book needs a new
pre-registration. QUEUE's window overlaps; reading its books is QUEUE's deviation 1.

## Build spec (for the main session; not built here)

* `agents/quotes_live.ts`: an instance option `take?: { from: number }` and a dependency that reads the recorded book;
  in step 6, before a rung's paper entry, steps 1–4 above. The live account's instance has no `take`, so
  `quotes_live_instance.test.ts` still finds it equal to `quotes_live_frozen.ts`.
* `agents/revx_sim.ts`: an IOC the executor marks as a take meets the first recorded read after its instant (step 5);
  every other order meets variant-1's book (PR5's snapshot, else the last print's touch). How the mark reaches the sim
  is the builder's choice, pinned by a test.
* `agents/quotes_twin.ts`: TwinSpec `take50`, "Stablecoin quotes variant-2", engine `pr5`, £600, tables
  `agent_quote_twin_take50_*`, lease `quotes-twin-take50`, `take.from` 2026-10-05 00:00 UTC; it starts from variant-1's
  backfill; in forward mode it turns one call behind (a turn waits for the recorder's first read after it, at most
  120 s); `TWIN_READS` gains `agent_book_levels`. The `quotestwins` call turns it; no new `edge_calls` row.
* A migration with its six tables as `0087`'s, RLS on, no policy or grant to `anon` or `authenticated`.
* The TESTING row "Stablecoin quotes variant-2" after variant-1, its page as the twins' (pounds), take trips marked.
* Tests, each with a counterfactual: the trigger at k + 0.09 % (a tick short does not take); every guard and the paper
  position; the read after the turn (same row, next row, none); cancel before take; the POST counted; variant-2 equal to
  variant-1 before `take.from` on the committed inputs; the browser sweep for the row.

## Deviation 1 (2026-10-03): the build, three points the text leaves open, and one left out

The rule above is unchanged. Built as its spec says (`0089`, reference §4 item 52); where the text is silent the build
follows study.py:

1. Two takes on one book side walk the same read: the later one takes what the earlier left (study.py's `taken`), in the
   same turn or a later one while that read stands. K2's recomputation does the same.
2. A take whose funds check fails sends nothing, and its rung quotes no paper entry in that turn (the turn is the take's).
3. A turn waits for the recorder's read after it (at most 120 s) from `take.from` on, catching up as well as forward.

Left out of the build spec: its page does not mark take trips. The row and page are the twins' own, read from its spec
row, and no page code changed (the main session's call); every take is its order row's `request.take`, for the reading.

Check K1 on the committed record: `take50.json.gz` is `p50.json.gz` in every row of every table but the twin's id
(`src/take_twin.test.js`). The counterfactuals, each rule removed and its pin failing: the limit without the fee, the
paper position, `take.from`, the 90 s age, the cancel before the take, a frozen cancel, the POST counted, the same or next
read, the 60 s bound, the read's depletion, the mark, the wait and its 120 s. The files as built (a record; the twins'
pre-registration's deviation 2 and variant-1's deviation 1 freeze the driver and the account):

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | 425def7ed57f1b4e6157cadf7167e7d1711a06ec05fa552df25c35d2adf12e6b |
| `supabase/functions/agents/quotes_twin.ts` | d13b3eebce3dd3e89d8707e7373597b73d7127c5d5692fc36b6fcebe1d1dac0a |
| `supabase/functions/agents/revx_sim.ts` | 4b8f99e925f0ba6e05e188554e4b6bf8a43eead0aaec0b5d946a65664361f8aa |
| `supabase/migrations/0089_quote_twin_take50.sql` | 39da274fb14282574eb2b8c6dd814e5937ae5ee91e18a80808787607f7991e49 |
| `docs/agents/backtests/twins/take50.json.gz` | 8a1d68f9cfe183cf13b387a24103bff3fb6fc7ed3f59b91ca0b29614c051af26 |

## Addendum 1 (2026-10-04, about 13:40 UTC): the rule starts at 2026-10-04 16:00 UTC

Written before the new start. Davies, verbatim: "这个现在就开始吧 为什么要等？". `take.from` moves from 2026-10-05 00:00 to
2026-10-04 16:00 UTC (migration `0090`), an instant still in the future when it lands, so no turn already taken changes.
The window becomes take trips opened 2026-10-04 16:00 → 2026-11-02 00:00 UTC; the bar C1–C4, the seed, the checks and the
reading's date are unchanged. For C3's day blocks, 2026-10-04 is a day of its own (a Sunday, eight hours). K1 reads
variant-2 against variant-1 before 16:00. Nothing of either twin's trips or P&L has been read; K1's interim count
(10-03 05:03) was orders only.

## Addendum 2 (2026-10-09): a buy-back at the venue's minimum buys what its whole penny buys (F1), in both arms

Davies, 2026-10-09, verbatim: "修复 F1，应用所有tablecoin quotes包括live的" (fix F1 on every Stablecoin quotes row, LIVE
included). The live executor's `pennyExit` (`quotes_live.ts`), which both of this test's arms run (variant-2, `take50`,
and its comparator variant-1, `p50`), now sizes a buy-back worth £0.10–£0.11 to what its whole penny buys instead of
paying that penny for a hair under it (the twins' pre-registration's deviation 3, its §14). It touches both arms alike
and only an exit, so C4 (variant-2 above variant-1) compares the same thing before and after; C1–C3 count take trips,
whose exits it touches only when what a take's rung holds is worth under £0.11 (a take is a £50 rung, so only a
remainder that small). The window, bar, seed and reading are unchanged. Not blind: written after the 2026-10-09 review, which read both arms'
records (its F8 counted 5 takes since 10-04 16:00, 3 won, +£0.2926).
