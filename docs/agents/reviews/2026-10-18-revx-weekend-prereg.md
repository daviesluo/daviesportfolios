# Pre-registration DRAFT: "Stablecoin quotes weekend", PR5's rule on Revolut X with GBP/USD held through the closure, on paper (2026-10-18)

**Status: DRAFT, not frozen.** Nothing here is built, deployed or armed. It freezes only at the commit that adds its code and
migration, on Davies' word; until then every line may change, and the dates below move with the deploy (§3 says how). Written by
the stablecoin quotes review of 2026-10-18 (`2026-10-18-stablecoin-quotes-review.md`, §5), whose figures were all seen first: this
test is designed after a non-blind read of PR5-W's first forward weekends, and says so (§6).

## 0. On whose word

- Davies, 2026-10-18: "我看coinbase周末表现不错要不要给revolut也加一个周末的策略测试" (Coinbase looks good at weekends; should
  Revolut X get a weekend strategy test too?). The review's answer is yes, as this paper row, beside PR5-W.
- Not yet given: his word to build it. Until he gives it, this file is a plan.

## 1. The one change, and everything else equal

PR5's frozen rule (`stepMinute` in `agents/quotes.ts`, called unchanged) goes dark when its newest GBP/USD bar started more than ten
minutes before the minute, so from Friday ~21:40 to Sunday ~23:00 UTC it quotes nothing and LIVE, which carries out its decisions,
quotes nothing either. **The change is PR5-W's rule exactly** (`2026-09-28-pr5-weekend-prereg.md`, "The rule"): inside the weekly FX
closure, Friday 21:00 → Sunday 21:00 UTC (and 24-25 December, 31 December - 1 January, 21:00 → 21:00), a minute whose X is dark takes
the last live X the engine recorded before it; from Sunday 21:00 until a live X returns the minute is dark, as in PR5. A live X inside
a closure is used, and later dark minutes of that closure take its close. Nothing else differs:

| | PR5's paper engine (`agents?action=quotes`) | "Stablecoin quotes weekend" |
|---|---|---|
| X in a dark minute inside the closure | none: dark | the last live X before it (PR5-W's case 2) |
| inputs | Yahoo GBP/USD, the USD books' hourly closes, Revolut X's UK prints | **the same rows, read, never fetched**: `agent_quote_minutes` (x, fair_u) and `agent_quote_prints` as PR5's engine stored them |
| rule | `stepMinute`: 0.1 / 0.2 / 0.3 % either side of fair, $100 a rung, 10 % of the minute's volume, post-only refusal, exits at fair, 0.05 % re-price, 24-hour taker stop | the same call |
| capital | $1,200 (12 rungs), paper | the same, paper |
| tables | `agent_quote_*` | its own, `agent_quotew_*` (state, events, trips, days) |
| call | `agents?action=quotes` | its own row of `edge_calls`, `agents?action=quotesw`, `retry` true (every write upserts on natural keys) |

It reads PR5's stored minutes and prints only; it changes none of `stepMinute`, `agent_quote_minutes`, `agents/books.ts` or
`agent_book_levels`, so QUEUE's and PR5-W's freeze lines hold. A weekday minute is PR5's minute: on a record with no closure it writes
PR5's paper trips trip for trip (the pin below).

## 2. Why

Seen before this draft (`backtests/scq_review/2026-10-18/`, `results/experiments.json` and `results/weekends.json`; the replay
reproduces PR5's 180 paper trips from 2026-09-26 to the cent):

| record | weekends | held − dark, by weekend (trips entered Fri 21:00 → Mon 00:00) | positive | worst | per day, all days |
|---|---:|---|---:|---:|---|
| committed tape, 2026-01-01 → 09-23 | 38 | +£112.69 | 37 | −£0.09 | +£0.42 [+0.33, +0.51] |
| the same, 2026-08-26 → 09-23 (the tightened market) | 4 | +£3.05 | 4 | +£0.18 | +£0.11 [+0.04, +0.18] |
| PR5's own record, 2026-09-26 → 10-18 | 4 (the last partial) | +£6.59 | 4 | +£0.01 | +£0.30 [+0.11, +0.55] |
| the same, fills at our own price too | 4 | +£9.12 | 4 | +£0.18 | +£0.41 [+0.17, +0.69] |

At $100 a rung (£1,200), 90 % intervals by 10,000 day resamples. Revolut X's books keep trading at weekends at about half the weekday
pounds an hour, with wider touches (USDT-GBP 11.4 bps against 5.3) and two to five times as many prints beyond 20 bps of fair (§5 of
the review). PR5-W (frozen 2026-09-28) reads exactly this rule offline on eight forward weekends on 2026-11-25. What this row adds
that PR5-W does not: the engine run forward on the record as it is stored, on the page, minute by minute, so that a later live change
would carry out decisions an engine has already made, not a replay's.

## 3. Window, reading and bar

- **Window.** From the first Friday 21:00 UTC after its first run to 2026-11-23 00:00 UTC (the Monday after PR5-W's eighth forward
  weekend). Deployed by 2026-10-23 it holds the four whole weekends of 10-23/25, 10-30/11-01, 11-06/08 and 11-13/15, and that of
  11-20/22. Fewer than three whole weekends: the reading is descriptive, not judged.
- **Reading.** On or after 2026-11-25 00:30 UTC, after PR5-W's own reading of the same day, never before it (a variant of a rule
  under its own verdict is not read first), by `backtests/scq_review/2026-10-18/scripts/replay.py` (`xhold=True`) and a reading
  script committed before the window starts. Not blind.
- **Bar** (all must hold):
  1. **Faithful.** The replay of its window on `agent_quote_minutes` and `agent_quote_prints` reproduces its trips within 5 % in
     number and 10 % in money, and its weekday trips equal PR5's paper trips over the same span.
  2. **Better than dark, weekend by weekend.** Its P&L less PR5's paper engine's, over trips entered from each whole weekend's Friday
     21:00 to the Monday 00:00 after it, is positive in all but at most one whole weekend, and its sum is positive.
  3. **No bad reopen.** No whole weekend's difference is below −$3.00 (about the largest gap PR5-W's committed series shows, 54 bps,
     on half the rungs held).
  4. **Not one weekend.** The best weekend is at most 60 % of the summed difference.
- **Reported beside the bars:** each weekend's trips, stops, the trips that closed after the reopen and their P&L, the books apart,
  orders a day against PR5's 700, the realistic-fill reading (prints at our own price, as LIVE gets them), and the same at LIVE's
  £10 a rung.
- **What a pass allows:** a proposal to Davies that LIVE quotes at weekends, as a pre-registered change of the decisions it carries
  out, at £10 a rung for four weekends first. Only his word arms it. A fail: no weekend quoting on Revolut X; the row stops.
- **Until the reading, health only:** the call's beats, its state's `last_error` and `last_minute` (about two minutes behind PR5's),
  `ops_errors` `agents.quotes_weekend`. Its trips may be read (there is no no-peek rule); any read before the reading is reported.

## 4. What it needs (code, cost, risk)

- **Code**, modelled on `agents/cb_hold.ts` (179 lines) with PR5's stored record in place of Coinbase's: `agents/quotes_weekend.ts`
  (the driver: lease, read PR5's `last_minute`, decide each minute up to it from `agent_quote_minutes`/`agent_quote_prints` with the
  held X, write its tables), `quotes_weekend.test.ts` (pins: with no closure it writes PR5's trips, events and order counts; inside a
  closure it takes the last live X; from Sunday 21:00 it is dark; idempotent re-decide), one action in `index.ts`, a migration
  (four tables, a `_days` view, a reset function, the lease row, the `edge_calls` row), the page's read and TESTING row next to
  "Stablecoin quotes", the browser test's fixture, a row in `docs/map.md` per new file and an item in the reference.
- **Cost.** One more call a minute, a few hundred milliseconds (it reads two tables PR5's engine already wrote and calls no venue);
  tables of a few MB a month; one session of an `opus-high` or `sonnet-high` agent to build and pin.
- **Risk.** None to money: paper, no key, no order path. It reads the minute record PR5-W's reading also reads; it writes nothing
  there. The one dependency is PR5's paper engine running to 11-23 (it runs to 11-10 at least for the Coinbase tests).

## 5. Frozen files (at the freeze)

`agents/quotes_weekend.ts` and its test, its migration, `backtests/scq_review/2026-10-18/scripts/replay.py` and the reading script,
with their sha256 in a MANIFEST. `agents/quotes.ts` (`stepMinute`) is frozen already, by PR5-W's freeze line.

## 6. Disclosures before the freeze

- Every figure of §2 was seen, including PR5-W's first forward weekends (10-03/04 and 10-10/11) replayed by its rule ahead of its
  2026-11-25 reading. PR5-W's reading is not changed by this file; its report should name this review as a further non-blind read.
- The Coinbase weekend test ("with Euros - 2") has one weekend in progress and no closed weekend trip; nothing of it shaped the bars.
- The bars copy the Coinbase weekend test's shape; bar 3's −$3.00 was set after seeing that the worst of 46 historical and forward
  weekends was −£0.09.
