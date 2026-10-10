# Pre-registration: "Stablecoin quotes Coinbase", PR5's rule on paper on Coinbase's four books (2026-10-10)

**Frozen at the commit that adds this file.** Any later change is a deviation, written in §7 with its date and reason.
The companion note, `2026-10-10-coinbase-vs-revolutx.md`, compares the two venues on history and gives the budget split.
It is not part of the bar.

## 0. On whose word

- Davies, 2026-10-10: "先建起来吧，并且和Revolute X对比看哪个更好，投入的话资金该如何安排" — build it, compare it with Revolut
  X, and say how money should be split.
- The venue screen that chose Coinbase: `2026-10-09-stablecoin-venues.md`.
- This is a paper test. Going live needs a Coinbase account and a trade-only key that Davies makes himself, and his word
  in the conversation where he says go.

## 1. What runs, and what differs from PR5

**Code.** The recorder is `agents/cb_rec.ts` and the engine `agents/cb_quotes.ts`, both on migration `0112`, behind
`agents?action=cbrec`. Every minute it does three things:

- records every Coinbase print of the four books by trade id, with no gap;
- records each book's touch;
- runs PR5's own `stepMinute` from `quotes.ts`, unchanged, one minute behind the recorder.

| | PR5 (`quotes.ts`, its twins) | This test |
|---|---|---|
| books | Revolut X UK USDC-GBP, USDT-GBP | Coinbase USDC-GBP, USDT-GBP, USDC-EUR, USDT-EUR (the books a UK account can quote; §5 of the note says what is unconfirmed) |
| prints | Revolut X's UK public trades | Coinbase Exchange's public trades (`cb_trades`), the aggressor taken as the side other than the maker's Coinbase serves |
| interbank X, fairU | Yahoo GBP/USD; the median of Revolut X's USD-book hourly closes over [t−24 h, t−1 h] | the same stored GBP/USD and the same stored hourly closes (`agent_quote_inputs`); for the EUR books, also Yahoo EUR/USD (`cb_quote_inputs`) |
| sizing | $100 a rung (the paper engine), £100 (the twin "Stablecoin quotes") | £100 a rung, six a book: £600 a book, £2,400 in all. X is passed as the pounds per unit of the book's currency, so every rung, cap and P&L is pounds |
| maker / stop cost | 0 % / 0.09 % + 0.0067 % | 0 % / 0.0045 % + half the book's touch read 2026-10-09: 0.66, 0.66, 0.56 and 0.11 bps |
| price step | 0.0001 | 0.0001; USDT-EUR 0.00001 (its prices go into `stepMinute` ×10 and its sizes ÷10, so the money is unchanged; pinned in `cb_quotes.test.ts`) |
| fills | a print strictly through | the same |
| rungs, re-price, post-only refusal by the last print, exit at fair, 24-hour stop, 10 % of the minute's volume | as frozen | unchanged |

**Dependence.** It reads PR5's paper engine's stored GBP/USD and hourly closes. If that engine stops, the test goes dark
with it. That is written as a deviation; nothing is substituted.

## 2. Why

- **History** (`2026-10-09-stablecoin-venues.md` and the companion note), the same rule on Coinbase's own prints, at
  £100 a rung, as % a year on £2,400:

  | last 12 months | last 90 days | since 2026-08-24 | last 28 days |
  |---:|---:|---:|---:|
  | 8.0 % | 6.0 % | 9.7 % | 13.1 % |

  The history's returns grow in proportion to rung size up to £1,000 a rung. PR5's on Revolut X does not.
- **Diversification.** The two venues' daily P&L correlate at 0.09 over 2025-11-26 → 2026-10-08.
- **What history cannot say.** Whether the engine, fed by the minute recorder, decides as the history simulator does.
  Whether the forward weeks look like the history's. That is what this test reads.

## 3. Window, reading and bar

**Window.** 28 UTC days, from the first 00:00 UTC after the engine's first decided minute (`cb_quote_state.state.startedAt`).

**Reading.** On the 29th day, from 00:30 UTC. Every condition is read on the window alone: trips by entry minute,
money in pounds.

**Bar.** All must hold for Coinbase to be worth funding:

1. **Faithful.** `backtests/cbpaper/scripts/replay.py` runs PR5's frozen `pr5_sim.simulate` on the window's own minute
   records (`cb_quote_minutes`). It must reproduce the engine's round trips (`cb_quote_trips`) to within 5 % in number
   and 10 % in pounds, over all four books.
2. **Positive.** Realised P&L is above zero, and so is the day bootstrap's index 100: `random.Random(20261023)`, 2,000
   draws of the window's days with replacement, sums sorted, the 101st.
3. **Enough.** At least 6 % a year on the £2,400, taken as the window's realised P&L × 365 / 28.
4. **Not one day.** The best day is at most 40 % of the total.
5. **Against Revolut X, the same days.** Its % a year is at least half that of PR5's realistic twin "Stablecoin quotes"
   (£100 a rung, £1,200; its realised P&L from its own tables) over the same 28 days.

**Reported beside the bar, not part of it.**

- PR5 LIVE's realised % a year on its capital over the same days.
- The daily-P&L correlation with the twin and with LIVE.
- Each book's figures.
- The stops.
- What the coins behind the asks moved against the pound (GBP/USD, and EUR/GBP for the EUR books).
- How many minutes were dark.
- How many minutes the recorder left a hole open (`cb_rec_state`).

**If it passes.** The split of a budget between the two venues is the companion note's simple-split rule, recomputed on
the window's own rates for Coinbase and on Revolut X's latest 28 days. If it fails any condition, Coinbase is not funded,
and the record keeps running only on Davies' word.

**Until the reading, health only.** That means the call's beats, `cb_rec_state.last_error`,
`cb_rec_state.last_report.reached`, `cb_quote_state.last_minute` and `ops_errors` (`agents.cb_rec`). There is no
no-peek rule (Davies, 2026-10-04): the page shows the test as it runs. This reading is not blind, and its report says so.

## 4. Its record before now

- `backtests/scq_venues/` covers 2024-10-01 → 2026-10-09, all four books, at £10–£1,000 a rung.
- `backtests/cbpaper/results/compare.json` covers Revolut X against Coinbase by window, rung and budget.
- Both are in sample.

## 5. Frozen files

- `supabase/functions/agents/cb_rec.ts`, `cb_quotes.ts`, `cb_view.ts` and their tests.
- `supabase/migrations/0112_cb_recorder_paper.sql`.
- `quotes.ts`'s `stepMinute`, already under PR5-W's freeze line.
- `docs/agents/backtests/cbpaper/scripts/replay.py`.

## 6. Disclosures before the freeze

- Every figure in `2026-10-09-stablecoin-venues.md` and in the companion note was seen, to 2026-10-09 00:00 UTC.
- The bar was set after seeing them. The 6 % floor sits at the 90-day rate and below the others. The half-of-Revolut-X
  floor holds on history since 2026-08-24 (9.7 % against 17.1 %) and in the last 28 days (13.1 % against 16.8 %), and
  fails over the last 90 days (6.0 % against 37.1 %).
- Not yet confirmed from an account: that a UK Coinbase account trades all four books. If a book is not available, it
  stays in the paper test and is reported apart, and the split leaves it out.

## 7. Deviations

None yet.
