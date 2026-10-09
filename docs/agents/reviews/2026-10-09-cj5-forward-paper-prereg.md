# DRAFT, not frozen: CJ5's forward paper test (PR5's rule on CoinJar UK's GBP stablecoin books)

**Status: a draft.** It follows `TEMPLATE-variant-prereg.md`'s sections, but CJ5 is not a twin row. It needs a venue
engine that does not exist: CoinJar's prints and its book, recorded by `agents/cj_rec.ts` (`0110`), fed to PR5's
`stepMinute`. The design, and Davies' word, come before any freeze. Nothing here changes PR5, its twins, RW or the
recorder.

## 0. On whose word

- Davies, 2026-10-09, on the recorder: "建起来".
- Davies, 2026-10-09, on the history test: "现在就用历史数据给 CJ5 做纸面测试". It found an edge
  (`2026-10-09-cj5-paper-test.md`).
- The freeze and the build wait for his word.

## 1. What differs from its base

| | PR5 (`quotes.ts`, `reviews/2026-09-23-pr5-paper-test-spec.md`) | CJ5 forward |
|---|---|---|
| venue, books | Revolut X UK USDC-GBP, USDT-GBP | CoinJar Exchange UK USDCGBP, USDTGBP: prints from `cj_trades`, the book from `cj_book` (both `0110`) |
| fair | the venue's USD book's 24-hour median of hourly closes ÷ interbank GBP/USD (Yahoo, one minute) | the same median on Bitstamp USDC/USD and Coinbase USDT-USD hourly closes (CoinJar's own USD books are thin); X as PR5's loop reads it |
| maker / taker fee | 0 % / 0.09 % | 0.00 % / 0.001 % (coinjar.com/uk/fees) |
| stop cost | 0.09 % + 0.0067 % | 0.001 % + half the touch `cj_book` shows at the stop's minute |
| rungs, re-price, exits, 24-hour stop, 10 % of the minute's volume | as frozen | unchanged |
| rung size | £100 | £50 (£600), the capital of PR5's variant-1 twin (p50); £10 and £100 beside as arms of the same engine |
| post-only | Revolut X's post-only | CoinJar's `MOC` ("Maker Or Cancel"); the go-live check also reads `cj_book`: refused when the quote would cross its touch |

## 2. Why

- **History.** PR5's frozen rule on CoinJar's whole print history made money in every year from 2021 and in both halves.
  - Last 12 months at £50 a rung: £103.40 (17.2 %/yr), bootstrap index 100 £85.20.
  - Since 2026-08-24 it ran ahead of PR5 on Revolut X on the same days.
- **What history cannot say.** Whether a quote sitting inside CoinJar's 28–34 bps touch fills the way the prints imply,
  and what the book does around it. `cj_book` now records that.

## 3. Window, reading and bar

- **Window.** 28 days from the first minute after the freeze, after `cj_trades` and `cj_book` have run 7 days clean.
- **Reading.** On the 29th day. Every condition is read on the window alone; the history is reported beside it.
- **Bar.** All must hold:
  1. Faithful: the history simulator (`backtests/cj5/scripts/cj5_sim.py` on the window's recorded prints) reproduces the
     engine's trips to within 5 % and its P&L to within 10 %.
  2. P&L is above zero, and above the random-time null's p95 (PR5's null, seed 20260923).
  3. The day bootstrap's index 100 is above zero (`random.Random(20261023)`, 2,000 draws).
  4. At least 8 %/yr on the £600.
  5. At least 90 % of fills had a go-live `cj_book` reading in which `MOC` would have rested.
  6. The best day is at most 40 % of the total.
- **Reported, not part of the bar.**
  - The paired difference against PR5's live twin on the same days.
  - The coins' GBP/USD mark.
  - The share of fills where our quote was the best price.
- **Until then, health only.** The engine's state row, its beats and `ops_errors`.

## 4. Its record before now

`backtests/cj5/` (in sample): the whole history and the last 12 months, by size and by arm.

## 5. Frozen files (none yet)

- The engine's module and its test.
- Its migration (tables, an `edge_calls` row with its `retry` stated).
- `cj5_sim.py` and `vbook.py` with the inputs' builder.

## 6. Disclosures before the freeze

Every figure in `2026-10-09-cj5-paper-test.md` was seen, including the last 28 days to 2026-10-09.
