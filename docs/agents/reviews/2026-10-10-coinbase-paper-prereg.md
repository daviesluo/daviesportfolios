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

### Deviation 2 (2026-10-13, before the reading): the minute record's lost extremes, fixed and repaired

**On whose word.** Davies, 2026-10-13: "Coinbase修复同意", on the review `2026-10-12-coinbase-first-days.md` §2.

**What was wrong.** `cbMinuteRow` stored null for an aggressor side's lowest and highest print whenever that side printed
more than once in a minute (`xs.reduce(Math.min)` hands `Math.min` the index and the array too). Of the 12,802 minutes with
prints to 2026-10-12 23:50 UTC, 7,216 had all four extremes null, every one of them a minute with two prints or more. The
engine never read these columns: its rungs, fills and trips came from the prints. Bar 1's replay (`replay.py`) builds its
prints from them, and on the first lit day it reproduced 3 of the engine's 8 trips as stored and all 8, with the engine's
P&L, once the extremes were rebuilt from `cb_trades` (`docs/agents/backtests/cbreview/results/replay_check.json`).

**What changes.**

- `cb_quotes.ts`: `xs.reduce((a, b) => f(a, b))`; `cb_quotes.test.ts` pins several prints a side on a GBP and a EUR book,
  one print, and none (it fails on the old code).
- The stored minutes from 2026-10-11 00:00 UTC are rebuilt from `cb_trades` by a migration that runs after the fixed
  function is deployed (the update of `docs/agents/backtests/cbreview/sql/repair_minute_bars.sql`), before the prune takes
  the window's first prints on 2026-10-21 23:01 UTC.
- The engine, `stepMinute`, `replay.py`, the window and every bar are unchanged. The reading says the record was repaired.

### Deviation 3 (2026-10-15, before the reading): a blackout around the scheduled releases

**On whose word.** Davies, 2026-10-15 (the message reached this session before 03:03 UTC, when it began the work; it carries no
clock), after the first days' loss of 2026-10-14 (`reviews/2026-10-15-coinbase-fast-move.md`): "目前的两个Coinbase 测试采用发布前后暂停的规则吧，你想办法找到准确的CPI 和非农等的历史发布日期，可以用网站本身的api和数据接口；另外revolut x的规则不需要加这个吗？" — both Coinbase tests take the
rule of pausing around each release, and the dates are to be found exactly.

**What changes.** In the seven minutes from one minute before to five minutes after each scheduled US CPI, Employment Situation (NFP),
FOMC statement, ECB decision and BoE announcement (`cb_releases.ts`: `CB_RELEASES`, UTC instants to 2026-12-31, `cbInBlackout`), the
minute's `fairU` is null. `stepMinute` (quotes.ts, unchanged) then does what it does in any dark minute: the entry rungs are withdrawn and
none is placed; an exit order already resting stays and can fill; an exit that falls due in the window is placed at the first lit minute,
so inventory is held for at most those minutes longer and never stranded; the 24-hour stop runs; and the stored minute's `fair` is null
(`x` is kept), so `replay.py` reproduces the engine without knowing about releases. Nothing else changes: the books, the prints, the
ten-minute rate lookback, £100 / €100 a rung, the stop cost and the pounds conversion are as before.

- **From which minute.** From the first minute decided after the deploy of the commit that adds these bytes. A minute is judged by its own
  start, never by when the engine got to it, and the first listed release is 2026-10-28 18:00 UTC, so no minute decided before 17:59 that day
  differs from the rule as it ran. The CPI of 2026-10-14 (12:30 UTC, the minute that lifted seven asks) is not in the list: both tests'
  records of it stand as they ran.
- **The list.** FOMC, ECB and BoE dates are from their own calendars (fetched 2026-10-15, `backtests/cbreview/scripts/release_calendar.py`,
  `inputs/release_calendar.json`, which also logs every URL tried). **The BLS dates are not from the BLS**: bls.gov refused this machine
  (HTTP 403) and FRED did not connect, so the NFP of 2026-11-06 (also on tradingeconomics.com's calendar and what BLS's third-Friday rule gives) and
  the CPI of 2026-11-10 and 2026-12-10 and NFP of 2026-12-04 are the published schedule as recalled, marked UNCONFIRMED in the module. A wrong
  BLS date costs the blackout, not the rule: a minute not in the list is decided as before. Within the base test's window (to 2026-11-08) the list
  holds four releases: FOMC 10-28, ECB 10-29, BoE 11-05, NFP 11-06.
- **The reading's bars, read on the record as it ran.** The five bars are read on `cb_quote_minutes` and `cb_quote_trips` as the engine wrote them,
  blackout minutes included, and `replay.py` is run unchanged on that record (bar 1 is the check that it still reproduces the engine:
  `cb_quotes.test.ts` has a world with a release in it, worked by hand, and the fair is null in exactly seven minutes). Bar 3's 6 % a year
  and bar 4's 40 % are read on the trips as they were made; the window and every threshold are unchanged. Bar 5 (against the Revolut X twin,
  which has no blackout) now compares a blackout test with one that has none; the report says so.
- **The paired comparison of the two arms is unaffected**: "Stablecoin quotes with Euros - 2" gets the same blackout from the same list
  (its Deviation 2), so bar 6 of its pre-registration, which pairs it with this test's rule by weekend, compares two arms that both sit out the
  releases; they differ only in the closure, as before (`cb_hold.test.ts` pins that the two write the same rows on a world with a release).

**Why.** In sample, on two 12-month spans of Coinbase's history, with the parameters chosen on one and read on the other: +£25.96 a year on
2024-25 and +£7.89 on 2025-26, on the screen's £2,400 (day-bootstrap 5th percentile +5.1 and +0.2), keeping 97 % and 94 % of the trips, and positive in
all 75 variants of the blackout tried; on 2026-10-14 itself −£2.70 becomes −£1.17. No reactive guard (print against fair, tape range, fair move, wider
rungs, a shorter stop) was positive in both spans. `reviews/2026-10-15-coinbase-fast-move.md`, `2026-10-15-coinbase-blackout.md`.

**Frozen bytes this deviation names** (`docs/agents/backtests/cbwk/MANIFEST.json`, group "the release blackout's, changed or added 2026-10-15", held
by `src/cb_hold_prereg.test.js`; `cb_quotes.ts` and its test moved there from "the base test's, unchanged by 0118"):

| file | sha256 |
|---|---|
| `supabase/functions/agents/cb_quotes.ts` | `3929d8a9a47d0ac240d865fec3fd56c4b08e6912b10c72e6fe8d7ee31eebd808` |
| `supabase/functions/agents/cb_quotes.test.ts` | `76a02c0dbaac0254089731db120da86c8069e4dc013483b16764b71f231dbe2f` |
| `supabase/functions/agents/cb_releases.ts` | `fa882d0559d90828d9e4530bf4a640db3454a6be1be70b94ada42bd0ca0b5a63` |
| `supabase/functions/agents/cb_releases.test.ts` | `6290bd94df15293e4b9e653d176fc68ead8625d68819bcb0369141e8e699d0e2` |
| `supabase/functions/agents/cb_blackout_world.ts` | `779d556a8c0040dbc1faaf45b06f8ec3a6afcc9e6d39d8ee9ac271e5252147cd` |
| `docs/agents/backtests/cbreview/inputs/release_calendar.json` | `c16d1bbf3408fe66d201ec97c7f4563dcf1e87a03f33d0632eb9729c5fbf98a9` |

### Deviation 4 (2026-10-29, before the reading): $100 a rung, the record counted in dollars

**On whose word.** Davies, 2026-10-29, verbatim. First, on the OKX rows, "C，coinbase的也是改用美元" (Coinbase's rows in dollars too). The
page then showed this test's FUNDED as £1,200 + €1,200 in dollars, an odd figure (about $2,937 at the day's rates), and he wrote:

> Coinbase策略中funded数字怎么那么奇怪，都改成整数调整

(the Coinbase strategies' funded figures look odd; adjust them all to whole numbers).

**What changes.** From the switch, a rung is **$100** of the book's currency (`CB_RUNG_USD`), six a book: **$2,400 on the four books**
(£1,200 + €1,200 before). $100 keeps Deviation 1's "100 a rung", now in the page's currency.
- `stepMinute` (quotes.ts) is not touched. Each book's X becomes its currency's dollar rate (GBP/USD, or EUR/USD), and its fairU the coin's
  dollar fair (`cbMinuteInputs(…, usd)`). So its rung of 100 is $100, and its 10 % cap is a tenth of the minute in dollars.
- The fair it quotes around (fairU / X) is the same number as before, so no order is re-priced at the switch.
- Sizes are set at the fill, so a resting order needs no re-size.
- The trips are still kept in pounds (`cbTripInPounds` reads the X a trip closed at from the trip). The minute record is unchanged, its `x`
  still the book's pounds per unit. Nothing else changes: the books, the prints, the lookback, the blackout, the stop and its cost.

- **The instant.** The first minute the deployed code decides at or after 2026-10-29 00:00 UTC (`CB_USD_NOT_BEFORE`) with both rates known,
  the run's first minute (`cbUsdSwitch`).
  - It is written once into `cb_quote_state.state` as `usdFrom`, with the GBP/USD and EUR/USD bars that minute is decided on (`usdGbpusd`,
    `usdEurusd`) and the factors they give (`usdFactor`).
  - The deploy follows the push, so this text cannot name them. The reading quotes all four from the state.
- **The factor.** For each book: the new $100 rung ÷ the old rung's dollars at the instant. That is **1 / GBP/USD on a GBP book** and
  **1 / EUR/USD on a EUR book**.
  - At the last stored rates when this was written, GBP/USD 1.3324 (`agent_quote_inputs`, 2026-10-29 04:06 UTC) and EUR/USD 1.1151
    (`cb_quote_inputs`, 04:07 UTC), the factors are 0.7505 and 0.8968.
  - Over the whole test that is $2,400 ÷ ($1,598.93 + $1,338.09) = **0.817**.
  - Book by book because a GBP rung and a EUR rung moved by different amounts.
- **The assumption.** Fills and fees scale linearly with size.
  - The page shows every amount entered before the instant × its book's factor: a round trip by its entry, a held rung by its fill, in
    P&L, cost and size.
  - The factors are under 1, so a smaller rung fills a smaller share of each print: no fill is assumed that the book did not print.
  - It still ignores that 10 % of a minute capped some old fills below £100 / €100, where the scaled trip is smaller than a $100 rung would
    have filled.
  - Prices, counts and percentages are never scaled.
  - The stored rows are not changed (no migration).
- **The reading, read in dollars on that scaled record.**
  - A trip's dollars are its pounds (`cb_quote_trips.pnl_gbp`) × the window's mean GBP/USD (`agent_quote_inputs`, kind `fx`), × its book's
    factor if it was entered before the instant.
  - Bars 2 and 4 read those dollars.
  - Bar 3 is at least 6 % a year on **$2,400**.
  - Bar 5 compares percentages and is unchanged.
  - Bar 1 compares `replay.py`, which sizes a rung at 100 of the book's currency, with the engine's trips at that size: a trip entered from
    the instant ÷ its book's factor. It still counts every trip, since size never decides whether a rung fills.
  - The window, the seed and every threshold are unchanged.
- **The paired comparison** with "with Euros - 1" is unaffected: that arm switches the same way at its own first minute (its Deviation 3).
  `cb_hold.test.ts` pins that on a world after the switch the two still write the same rows.

**Frozen bytes this deviation names** (`docs/agents/backtests/cbwk/MANIFEST.json`, whose groups keep their names; held by
`src/cb_hold_prereg.test.js` and `src/cb_usd_prereg.test.js`):

| file | sha256 |
|---|---|
| `supabase/functions/agents/cb_quotes.ts` | `fe88387e54abad68ff3fe5a02fb8f2a768a09ccea860b4ab4a46cbbdd262c465` |
| `supabase/functions/agents/cb_quotes.test.ts` | `393a844cd3070c5e5e0b110a85e071454a57b06372df6c9aafdb87dfe0072981` |

### Deviation 5 (2026-10-29, before the reading): Coinbase's own coin price, with a de-peg guard

**On whose word.** Davies, 2026-10-29, verbatim, after the CB/OKX fair-price study:

> 目前coinbase的测试策略全部直接改用coinbase自己的币价而不是revolutx的

(every Coinbase test strategy switches straight to Coinbase's own coin price instead of Revolut X's).

- **The change.** From the switch the coin's dollar value (fairU) is the CB/OKX fair-price study's `cb_live`
  (`reviews/2026-10-29-cb-okx-fair-price-study.md` §3, `backtests/fair_price_cb_okx/scripts/prod.py` and `hist.py`), in place of
  the median of Revolut X UK's USDC-USD or USDT-USD hourly closes (F3). The FX bar, the rungs, the fill rule, the stop and the
  release blackout are unchanged; `stepMinute` (quotes.ts) is not touched, so Revolut X's rows are byte for byte as they were.
  - **USDC is 1** (Coinbase converts USDC to dollars 1:1 and lists no USDC-USD book).
  - **USDT is Coinbase USDT-USD's own price**: the close of the latest one-minute candle that started in [t − 10 min, t − 1 min]
    (`fxBarAt`, the study's `bar_at`). The base test's call fetches Coinbase's public candles each minute (keyless,
    `api.exchange.coinbase.com/products/USDT-USD/candles?granularity=60`, completed minutes only, `fetchCbUsdtUsd`). It stores them
    in `cb_quote_inputs` (kind `cb:USDT-USD`), and every Coinbase arm reads them there.
  - **Stale:** with no candle in those ten minutes, the USDT book's minute is dark, as the study's fair was None. No last value is
    held longer, even on the weekend arm, whose study replay also read USDT for ten minutes and held only the FX bar.
- **The de-peg guard (not in the study, which modelled no de-peg; its stated risk).** A coin value more than **50 bps** from an
  outside reference darkens the minute, and so does a missing reference (`cbCoinFair`, `CB_DEPEG`).
  - The reference is Revolut X's F3, the value the fair used before the switch.
  - A dark minute places no entry. A resting exit stays and can fill, a due exit waits for a lit minute, and the 24-hour stop
    runs, as in a release blackout.
  - USDC is guarded too: |1 ÷ F3 − 1| > 50 bps is a USDC de-peg.
  - F3 is a 24-hour median, so it survives an outage of PR5's paper inputs of up to about a day. Only then do the rows go dark,
    as they would have before.
  - On the study's own production inputs (2026-10-10 → 10-29, 27,360 minutes) the guard would never have fired: the largest gap
    was 13.5 bps for USDT and 14.0 for USDC. A USDT candle was within ten minutes in every minute. So on that record this rule is
    the study's `cb_live` exactly.
- **The instant.** The first minute each row decides at or after 2026-10-29 08:00 UTC (`CB_LIVE_NOT_BEFORE`): in practice the
  first minute after the deploy. It is written once into the row's state as `liveFrom` (`cbLiveSwitch`). There is no backfill: the
  record before it stays as it ran, and nothing on the page is rescaled (sizes did not change).
- **Why** (the study, in sample and out):
  - The fair had sat below the market on every book (weekday median of the touch mid over the fair: +2.2 bps USDC-GBP, +5.6
    USDT-GBP, +5.9 USDC-EUR, +8.9 USDT-EUR). 2 to 5 bps of that was Revolut X's dollar price, which traded under Coinbase's.
  - That is why 136 of 137 USDT fills were asks, and why 32 of 146 base trips ended at the stop.
  - `cb_live` on history out of sample: +£6.1 a year on £2,400 [−14.5, +27.5]; the weekend arm +£13.0 [−9.2, +36.4]. Stops fell
    60 → 7 and the worst day went −£3.10 → −£1.40. On the 19 production days: +£13.8 a year [−39, +73] and +£17.9 [−45, +90],
    stops 32 / 40 → 0 / 4.
  - None of these is significant. The case is the bias removed, the stops, and the rows no longer reading PR5's Revolut X inputs
    for their price.
- **The reading is read on the record as it ran.** The minute record's `fair` is the fair the minute was decided on (the new one
  from the switch). So the replay of bar 1 reproduces the engine without knowing the rule changed, and every threshold, window and
  seed is unchanged. The report says where the switch fell and what share of the window it covered.
- **The paired comparison** with "with Euros - 1" (its bar 6) is unaffected: that arm switches by the same rule (its Deviation 4).
  `cb_hold.test.ts` pins that on a world after the switch the two still write the same rows.

**Frozen bytes this deviation names** (`docs/agents/backtests/cbwk/MANIFEST.json`, whose groups keep their names; held by
`src/cb_hold_prereg.test.js` and `src/cb_live_prereg.test.js`):

| file | sha256 |
|---|---|
| `supabase/functions/agents/cb_quotes.ts` | `3d267f849a8aeec704c880dc9a7da20ac19b5653117778cedff828615b468a6c` |
| `supabase/functions/agents/cb_quotes.test.ts` | `d0aa5d86649febcc14af588bbb8208984d3937e7c78ab5ac9c20d745b7087825` |

### Deviation 6 (2026-10-29, before the reading): off the page, kept as the weekend test's control

**On whose word.** Davies, 2026-10-29, verbatim:

> coinbase quotes with euros删了吧，因为加周末表现更好应该已经很明显了吧，然后把-1改成coinbase quotes with euros，-2和-3都减小一个数字

(delete "coinbase quotes with euros", since adding the weekend has clearly done better; rename "- 1" to "coinbase quotes with euros"; take one off "- 2" and "- 3").

- **What changes.** This test leaves the Agents page from today. The dashboard no longer reads it (`index.ts`), so it is in no
  TESTING row, Coinbase card total, VENUES share or FUNDED sum.
- **What does not change.** Its call runs on (the recorder's `agents?action=cbrec` decides its minutes, `runCbQuotes`) with its
  tables, rule and record unchanged. The weekend variant's bar 6 pairs that arm with this rule by weekend, and its reading
  (2026-11-10) also cross-checks against this record.
- **After that reading** this test's deciding is switched off. That needs a code or migration change and a ledger line; until then
  it is the weekend test's control only. What the same call fetches and stores for every Coinbase arm keeps running: Yahoo's
  EUR/USD (`fx:EURUSD`) and Coinbase's USDT-USD minutes (`cb:USDT-USD`, Deviation 5) in `cb_quote_inputs`.
- **This test's own reading** (2026-11-08, §3) is still made on its record as it ran, and its report says the row was off the page
  from 2026-10-29.
- No rule, file or threshold changes, so no bytes are named.
