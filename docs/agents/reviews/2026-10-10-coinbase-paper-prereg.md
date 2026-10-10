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

### Deviation 1 (2026-10-10, written before 2026-10-11 00:00 UTC): €100 a rung on the EUR books, and a new name

**On whose word.** Davies, 2026-10-10: "Coinbase的测试策略…子页面仿照目前Revolut X的，测试名字就叫Stablecoin quotes - with
Euro吧，列表里放在Stablecoin quotes variant-3 后面，每一档100磅/100欧元" — its page modelled on Revolut X's, its row right
after "Stablecoin quotes variant-3", and each rung £100 or €100. Then, the same night and before this deviation was
committed: "策略名字也改为Stablecoin quotes with Euros" — its name is "Stablecoin quotes with Euros" ("Stablecoin quotes
Coinbase" before; "Stablecoin quotes - with Euro" was never deployed).

**What changes.**

- **Rung size.** £100 a rung on the GBP books, as before, and **€100 a rung on the EUR books** (until now £100's worth of
  euros). `stepMinute` is still called unchanged: X is passed as 1 on every book, and fairU as the book's own fair (the
  coin's dollar fair over GBP/USD, or over Yahoo's EUR/USD for the EUR books). So a rung, the 10 % volume cap and every
  P&L `stepMinute` writes are in the book's own currency. The driver turns each round trip into pounds at the book's
  pounds per unit (EUR/USD ÷ GBP/USD) when it closes, and keeps the rate each rung filled at for its cost
  (`cbTripInPounds`, the state's `xGbp` and `xEntry`). `cb_quote_minutes.x` stays the pounds per unit, as 0112 says; it
  is no longer the X `stepMinute` was given. A GBP book is unchanged in every respect.
- **Capital.** £1,200 on the two GBP books and €1,200 on the two EUR books: **£1,200 + €1,200 × EUR/GBP**, £2,216 at
  the rates last stored before this was written (EUR/USD 1.12057, GBP/USD 1.32331, 2026-10-09 21:29 UTC).
- **Name and page.** TESTING's row and its page are "Stablecoin quotes with Euros" (code ids stay `coinbase`); the page
  is the twins' page. It has no INVENTORY: a paper test holds no coin of its own, and what a rung holds is in BOOKS.
- **Files.** `cb_quotes.ts`, `cb_view.ts` and `cb_quotes.test.ts`, all frozen by §5, change for this alone. The test pins
  one €100 trip on USDT-EUR worked out by hand: €100 at €0.90818 is 110.1103 USDT; sold at €0.90910 it makes
  100 × 0.00092 / 0.90818 = €0.101301, which is £0.089145 at £0.88 a euro, on a notional of £88.

**The bar, read with it.**

- **Window.** By §3's words the window began 2026-10-10 00:00 UTC: the engine's first decided minute,
  `startedAt` 2026-10-09 23:14 UTC, came from the prints the recorder's first page reached back to, though the engine
  first ran at 2026-10-10 01:46 UTC. This deviation moves the window to **2026-10-11 00:00 UTC → 2026-11-08 00:00 UTC**,
  read on 2026-11-08 from 00:30 UTC, so that every one of its 28 days runs on the rule as it stands now. A rung entered
  before 2026-10-11 is not in the window (trips count by entry minute); one still held then closes in pounds at the rate
  it closes at, as every trip does.
- **Bar 1 (faithful).** `replay.py` is run unchanged, on an export that gives it the rule's own money. The minutes'
  `x` is 1 on every book (`case when x is null then null else 1 end as x`): the simulator then sizes 100 of the book's
  currency a rung, as the engine does. Each trip's `pnl_gbp` is replaced by its P&L in the book's currency
  (`pnl_gbp * qty * entry / notional_gbp`, the same on a GBP book). So the GBP books compare in pounds and the EUR books
  in euros, the engine's and the simulator's alike, and the 5 % and 10 % bounds are read as written.
- **Bar 3 (enough).** At least 6 % a year on **£1,200 + €1,200**, the euros at EUR/GBP at the window's last minute that
  had both rates (EUR/USD ÷ GBP/USD from the stored bars that minute read), taken as the window's realised P&L in
  pounds × 365 / 28 over that capital.
- **Bars 2, 4 and 5** are unchanged; their P&L is the trips' `pnl_gbp`, in pounds.

**Does the history change?** Not materially. Coinbase's yearly rate does not move with rung size from £10 to £1,000
(the companion note, §4), so a €100 rung earns the £100 rung's figure × EUR/GBP on each EUR book. At 0.8468, the
companion note's rates on the new capital are 8.3 % over 12 months (8.0 % before), 6.2 % over 90 days (6.0 %), 9.8 %
since 2026-08-24 (9.7 %) and 13.4 % over the last 28 days (13.1 %). §6's comparisons with Revolut X come out the same
way: the half-of-Revolut-X floor holds since 08-24 (9.8 % against 17.1 %) and over 28 days (13.4 % against 16.8 %), and
fails over 90 days (6.2 % against 37.1 %). The companion note's figures are left as they were, with a line saying so.
