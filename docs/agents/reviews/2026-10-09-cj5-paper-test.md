# CJ5 on paper: PR5's rule on CoinJar UK's GBP stablecoin books, over their whole history (2026-10-09)

Davies, 2026-10-09: "现在就用历史数据给 CJ5 做纸面测试". CJ5 is PR5's frozen rule run on CoinJar UK's USDC/GBP and USDT/GBP
books. PR5 rests 0 % maker quotes 0.1 / 0.2 / 0.3 % either side of interbank fair, exits at fair, and stops at 24 hours.
It was second on the first stat-arb search (`2026-10-09-stat-arb-search.md` §5.2). This is research only, on keyless public data.
Nothing was traded, opened or signed up for. No key was read, no production table was read, and nothing was frozen.

## 0. The verdict

**There is an edge, it has shrunk, and today it is small.** PR5's frozen rule made money on CoinJar in every calendar
year from 2021 to 2026 and in both halves of the record. It was positive in 72 of 79 months, and the day bootstrap's
index 100 is above zero in every window measured. The edge has fallen most years.

| on CoinJar's two books, fills strictly through the quote | £10 a rung (£120) | £50 a rung (£600) | £100 a rung (£1,200) |
|---|---:|---:|---:|
| whole record, 2020-04-02 → 2026-10-09, £ a year | £83 (78 %/yr) | £324 (60 %/yr) | £554 (52 %/yr) |
| first half, to 2023-07-06, £ a year | £104 | £412 | £721 |
| second half, from 2023-07-06, £ a year | £63 | £235 | £388 |
| **last 12 months** (2025-10-09 → 2026-10-09) | **£24.87 (20.7 %)** | **£103.40 (17.2 %)** | **£177.66 (14.8 %)** |
| bootstrap index 100 of those 12 months (2,000 day draws) | £20.48 | £85.20 | £146.15 |
| the same 12 months, one tick deeper and double stop cost (stress) | £14.72 | £64.85 | £112.43 |
| the same 12 months, fills AT our price too (the optimistic bound) | £31.35 | £129.83 | £221.11 |
| last 28 days (09-11 → 10-09), at a yearly rate | £56 | £205 | £311 |

**Confidence.**

- **High that the record shows an edge under PR5's fill model.** The rule was not fitted to CoinJar; PR5 froze it on
  Revolut X in September. It beats PR5's own random-time null in every window. Over the last 12 months at £100 it made
  £177.66, where the null's p95 was −£9.79 and its best draw £6.16. It survives the stress arm.
- **Only moderate that the forward rate will be that size.** The fill model has never been tested on CoinJar: our
  quote would sit inside a touch 28–34 bps wide, at the front of the book. The last 12 months had weak spells: £2.80 in
  June and −£0.41 in July at £100.

**What breaks it.**

- The touch narrowing. PR5's rate on Revolut X fell four- to sixfold when its books tightened in the week of 2026-08-24
  (PR5's study; the first search's S1b; §7's months).
- Volume falling further. Both books together trade about £34k a day in 2026, against £3.6m a day in 2021.
- GBP/USD on the coins behind the asks. Half the capital is held in coins, and at £1,200 that inventory moved −£42.80 in
  2025 and +£71.25 in 2022: the size of a year's edge (§5).
- Stops. They were 13.5 % of trips in the last 12 months, against 3.7 % over the whole record.
- Fees. 0 % maker is CoinJar's stablecoin rate today.

**Against PR5 on Revolut X, the same days.** Over Revolut X's whole overlap (2025-11-26 → 10-09), PR5 made five times
CJ5's figure: £672.57 against £132.92 at £100. Since Revolut X tightened (2026-08-24), CJ5 is ahead: £36.32 against
£25.84, and £23.85 against £15.39 over the last 28 days. That lead is significant at £10 and £50 a rung, but not at £100,
where the index 100 is −£1.60. The two venues' daily P&Ls are almost unrelated (correlation 0.08), so running both would
diversify.

**What it would need.**

- A forward paper test on the recorder's prints, drafted in §10 and not frozen.
- Then a CoinJar UK account and a trades-scope key that Davies makes himself.
- An order path using CoinJar's post-only "Maker Or Cancel", which does not exist yet.

## 1. What was run

- **The rule is PR5's own code.** `docs/agents/scripts/pr5/pr5_sim.py`'s `simulate` and `exit_only` were imported
  read-only and run unchanged on a book built from CoinJar's prints (`backtests/cj5/scripts/vbook.py`).
- **Calibration first.** The same adaptor, on PR5's committed Revolut X inputs, reproduces `pr5_run1.json` field for
  field (`results/calibration.json`, `reproduces_published: true`):
  - PRIMARY: 8,192 trips, $707.9028;
  - the stress arm;
  - the by-book split.
- **Pounds.** In pounds (£100 rungs) the same Revolut X record is £650.38. Sizing in pounds sets the book's X to 1.0
  wherever interbank X exists. Fair uses the real X, so `size` and every P&L the simulator writes are in pounds.
- **The prints.** CoinJar's whole public history, keyless:
  `data.exchange.coinjar.com/products/{USDCGBP,USDTGBP}/trades?after=<s>&limit=1000`.
  - USDC/GBP: 1,390,026 prints from 2020-04-02.
  - USDT/GBP: 186,416 prints from 2021-08-27.
  - Both run to 2026-10-09 00:00 UTC.
  - The pull was paged at a request a second, in segments joined by `tid`.
- **Spot check.** 24 pages re-read live afterwards, 24,000 prints on 12 random days a book, were all present and
  identical field for field (`results/spot_check.json`).
- **Auction prints.** Some sit between ticks: 115 in 2020, 283 in 2021, 74 in 2022 and 1 in 2023 on USDC/GBP. They are
  kept at their price.
- **Window.** Each book is simulated from its first print day, starting flat. Results are by entry day.

## 2. Choices fixed before any P&L was read

| | PR5 (Revolut X) | CJ5 here |
|---|---|---|
| interbank X | Exness minute-close mid (EXN) | EXN from Exness's monthly archive, 2020-04 → 2026-09, built again and equal to PR5's committed EXN on all 329,386 common minutes (max difference 2e-16); Yahoo's 1-minute closes for 2026-10-01 → 10-09, which Exness has not yet published (Yahoo against EXN in September: median \|dev\| 0.40 bps) |
| fairU | median of the venue's own USD-book hourly closes over [t−24 h, t−1 h] (F3) | the same median on deep external USD books. **USDC:** Kraken USDC/USD (hour's last print) until Bitstamp's hourly OHLC begins on 2020-10-19, then Bitstamp. **USDT:** Coinbase USDT-USD. CoinJar's own USD books start in 2023 and are thin |
| rungs, re-price, post-only refusal, exit at fair, 24-hour stop, 10 % of the minute's volume | as frozen | unchanged |
| maker fee | 0 % | 0.00 % (coinjar.com/uk/fees) |
| stop cost | 0.09 % taker + 0.0067 % half-spread | 0.001 % taker + half CoinJar's touch: 13.9 bps (USDC/GBP), 17.2 bps (USDT/GBP), from the recorder's fixture of 2026-10-09 |
| size | $100 a rung | £10, £50, £100 a rung: 12 rungs, so £120 / £600 / £1,200 |

**Why the half-touch.** Adjacent BUY and SELL prints within 60 s sit only 1–6 bps apart, so their half-gap (1.4–2.1 bps)
would understate what a stop crossing at a random time pays. That measure is kept in `inputs/config.json`, unused.

**The fair source is not what makes the result.** On the overlap, CJ5 run with Revolut X's own F3 fair made £125.56,
against £132.92 with the chosen fair (§7). The chosen fairU sits a median 3.1 bps (USDC) and 3.4 bps (USDT) from
Revolut X's F3 (`fx_check.json`).

## 3. By year, at each size (fills strictly through)

| year | days | trips (£100) | win rate | stops | £10 | £50 | £100 | %/yr at £100 | £100 at price | median hold, min | max DD £100 | worst day £100 | fills £/day at £100 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2020 (Apr–) | 274 | 355 | 69.3 % | 95 | £3.52 | £11.20 | £15.83 | 3.5 % | £21.38 | 258 | £3.38 | −£1.23 | £64 |
| 2021 | 365 | 14,520 | 96.7 % | 108 | £217.99 | £890.96 | £1,574.05 | 194.6 % | £1,851.74 | 10 | £11.83 | −£6.23 | £2,613 |
| 2022 | 365 | 5,387 | 84.6 % | 186 | £74.75 | £303.19 | £545.32 | 45.4 % | £639.92 | 66 | £9.31 | −£8.31 | £968 |
| 2023 | 365 | 6,181 | 85.7 % | 209 | £90.28 | £303.75 | £472.98 | 39.4 % | £502.62 | 138 | £9.51 | −£4.41 | £751 |
| 2024 | 366 | 7,323 | 90.7 % | 288 | £105.44 | £383.70 | £635.91 | 52.8 % | £720.40 | 62 | £6.75 | −£2.99 | £1,075 |
| 2025 | 365 | 3,128 | 78.2 % | 293 | £35.33 | £147.33 | £252.64 | 21.1 % | £319.23 | 175 | £8.81 | −£3.52 | £568 |
| 2026 (to 10-09) | 281 | 1,716 | 78.2 % | 265 | £17.33 | £70.90 | £119.92 | 13.0 % | £150.34 | 285 | £5.20 | −£3.93 | £351 |

- **Capital.** "%/yr" is on the capital the rungs lock: 6 × £100 a book, per book-year. USDT/GBP joins in August 2021.
- **2021 was a different market.** USDC/GBP printed 2,964 times a day for £3.06m a day, in bursts (§8). The rule's
  median hold was 10 minutes, and that year is 44 % of the whole record's P&L.
- **The second half alone, from mid-2023, is £388 a year at £100.**
- **2026 by month at £100:** £14.90, 27.67, 7.15, 12.47, 13.07, 2.80, −0.41, 13.08, 25.33, then £3.87 for October to the 9th.
- **The whole record at £100:**
  - 38,610 trips, a win rate of 89.5 % and 1,444 stops (−£181.23 in all);
  - median hold 44 minutes (p90 612);
  - max drawdown £11.83 and worst day −£8.31;
  - the best day 1.7 % of the total;
  - 72 of 79 months positive, the largest 13.7 % of the total.
- **Rungs and sides.** The three rungs share the P&L evenly (£1,113 / £1,307 / £1,197 at 0.1 / 0.2 / 0.3 %). Asks made
  £2,290 and bids £1,326: CoinJar's GBP prices sit above fair more often than below.

**Other fill arms at £100, whole record / last 12 months.**

- Side-aware fills, where the print's aggressor must be the one that hits us: £3,190.14 / £164.56.
- No 10 % volume cap: £6,023.11 / £266.97.

## 4. Confidence: the null, the bootstrap, the halves

- **PR5's random-time null** (its `exit_only` twins, seed 20260923, 2,000 draws, £100):
  - whole record: £3,616.65 against a null mean of £274.38, p95 £355.41 and max £451.81;
  - last 12 months: £177.66 against mean −£25.23, p95 −£9.79 and max £6.16;
  - no draw reached the rule in either window.
- **Day-block bootstrap** (a fresh `random.Random(20261023)`, 2,000 draws of the window's days, sums sorted, index 100),
  £ a year at £10 / £50 / £100:

  | window | £10 | £50 | £100 | draws > 0 |
  |---|---:|---:|---:|---:|
  | whole record | £77.14 | £296.06 | £504.73 | 100 % |
  | first half | £92.92 | £362.46 | £628.21 | 100 % |
  | second half | £57.21 | £214.64 | £354.96 | 100 % |
  | last 12 months | £20.48 | £85.20 | £146.15 | 100 % |
  | since 2026-08-24 (46 days) | £33.14 | £131.84 | £204.55 | 100 % |
  | last 28 days | £39.38 | £138.88 | £196.20 | 100 % |

- **Walk-forward.** Nothing is fitted, so both halves are out of sample for the rule. The second half earns 60 % of the
  first half's yearly rate at £10 and 54 % at £100.

## 5. Inventory and GBP/USD mark risk (£100 a rung)

- **Open positions.** At most £956 of the £1,200 was in open trips at once. The time-weighted mean was £116.
- **Worst mark of a trip.** The worst a single trip was ever marked at fair while open was −£4.41 (p1 −£0.41).
- **Trips carry their own GBP/USD move.** P&L is in pounds, so the move during a hold is in the trip's figure.
- **The coins behind the six asks are not.** That is half the capital, held in USDC and USDT, so it is marked in pounds by
  GBP/USD. At £1,200 that mark was, by year:

  | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 to date |
  |---:|---:|---:|---:|---:|---:|---:|
  | −£56.53 | +£6.00 | +£71.25 | −£29.92 | +£10.48 | −£42.80 | +£11.10 |

  It is the same size as a recent year's edge. PR5 live has the same exposure (its coins are marked against cost). It is
  currency risk, not edge. Holding the coin half smaller than six asks needs, or hedging it, is a design choice for a live
  version.

## 6. Capacity

- **Our size against the books.**
  - 2026: CoinJar's two books traded £20,009 + £13,629 a day.
  - At £100 a rung the rule's fills were £391 a day over the last 12 months, 1.2 % of that.
  - At £1,000 a rung they were £1,075 a day, 3.2 %.
- **Last 12 months by rung size, through fills:**

  | rung | capital | last 12 months | %/yr | whole record |
  |---:|---:|---:|---:|---:|
  | £100 | £1,200 | £177.66 | 14.8 % | £3,616.65 |
  | £300 | £3,600 | £345.23 | 9.6 % | £7,884.44 |
  | £1,000 | £12,000 | £543.89 | 4.5 % | £16,903.28 |

  The 10 % volume cap binds, so the money saturates near £500 a year. The ceiling is a few hundred pounds a year.
- **Orders.** 471.8 orders a day on average, with a maximum of 6,539 on a 2021 burst day. CoinJar's trading-API rate
  limits were not read.

## 7. Paired with PR5 on Revolut X, the same days

**Set-up.**

- Both venues start flat on Revolut X's first day per book (USDC-GBP 2025-11-26, USDT-GBP 2025-12-16) and run to
  2026-10-09.
- Each runs at the same rung in pounds and on the same EXN / Yahoo X.
- Revolut X: PR5's committed prints joined with the stat-arb search's committed UK tapes to 10-09. Its own F3 candles come
  from `inputs/revx_usd_hours_…`, pulled keyless. Its stop costs are PR5's.
- Daily P&L is by entry day. The paired difference uses the same day bootstrap.

| £100 a rung | PR5 on Revolut X | CJ5 on CoinJar | CJ5 with Revolut X's fair | CJ5 − PR5 | index 100 | days CJ5 / PR5 ahead |
|---|---:|---:|---:|---:|---:|---|
| 2025-11-26 → 10-09 (317 days) | £672.57 (8,388 trips, 51 stops, 94.4 % won) | £132.92 (1,915, 281, 78.1 %) | £125.56 | −£539.65 | −£609.91 | 50 / 220 |
| since 2026-08-24 (46 days) | £25.84 | £36.32 | £36.38 | +£10.48 | −£1.60 (91.7 % > 0) | 24 / 15 |
| last 28 days | £15.39 | £23.85 | £25.27 | +£8.45 | −£2.46 (89.3 % > 0) | 16 / 7 |

- **At £10 and £50.** Since 08-24 CJ5 leads by £2.95 and £9.52, and the index 100 is above zero: £0.95 and £2.43.
- **Overlap, by month, at £100.** PR5 / CJ5:
  - 2026-03: £111.79 / £7.15
  - 2026-07: £69.67 / −£0.41
  - 2026-08: £44.24 / £13.08
  - 2026-09: £16.87 / £25.33
- **Correlation.** The two daily P&Ls correlate at 0.08.
- **Why this differs from the main run.** The CJ5 overlap figure here (£132.92) is not §0's "since 2025-11-26" (£136.54):
  here USDT/GBP starts flat on 12-16, as Revolut X's book did.

## 8. The books and the references (descriptive, `regime.json`, `fx_check.json`)

| CoinJar book, year | prints / day | £ volume / day | median \|print − fair\| bps | share of £ ≥ 10 / 20 / 30 bps from fair | median adjacent BUY–SELL gap bps |
|---|---:|---:|---:|---|---:|
| USDC/GBP 2021 | 2,964 | £3,056,782 | 11.3 | 43 / 19 / 12 % | 4.2 |
| USDC/GBP 2023 | 72 | £24,577 | 31.0 | 83 / 68 / 50 % | 6.3 |
| USDC/GBP 2025 | 235 | £57,091 | 11.1 | 63 / 37 / 18 % | 1.3 |
| USDC/GBP 2026 | 78 | £20,009 | 12.2 | 69 / 41 / 22 % | 2.7 |
| USDT/GBP 2022 | 106 | £396,954 | 17.8 | 43 / 21 / 14 % | 9.5 |
| USDT/GBP 2024 | 130 | £49,908 | 25.0 | 81 / 65 / 41 % | 2.6 |
| USDT/GBP 2026 | 35 | £13,629 | 16.2 | 72 / 49 / 31 % | 2.7 |

**Interbank X.** EXN against FXCM's 1-minute mid, on one week a quarter from 2020-W19 to 2026-W06: median |dev| 0.07–0.28
bps. Against Yahoo's hourly closes over two years: median |dev| 0.46 bps, p99 2.79.

**De-peg check.**

- **USDC** hourly closes reached 0.8627 in March 2023 (SVB). That weekend was dark (no X), so the rule placed no entries.
  The week 03-09 → 03-15 made +£1.29 at £100, with 10 stops.
- **Bitstamp's USDC/USD** closes were noisy in their first weeks (late 2020: single hours at 0.99 and 1.1). The 24-hour
  median absorbs them.
- **USDT** fell to 0.972 on 2022-05-12. That week made +£49.72.
- **The GBP mini-budget week** (2022-09-22 → 29) made −£5.24.
- **Coinbase's USDT-USD against Bitstamp's** USDT/USD: median |dev| 0.6 bps.

## 9. What was not done or not checked

- **Queue and refusals are modelled only from prints.** The simulator models refusal by the last print, as PR5's does;
  CoinJar's book has no history before the recorder. Whether a quote inside the touch fills as the prints imply, and how
  the resident maker answers, is what a forward test measures.
- **The stop's half-spread is today's touch for every year.** The touch was probably narrower in 2021–22, so stops there
  are charged more than they cost.
- **No order budget or rate limit was applied for CoinJar.** Its trading-API limits and its MOC behaviour on a live
  account were not read.
- **Kraken's 2020 USDC/USD tape** was used only to 2020-10-19. Bitstamp's USDC/USD is thinner than Revolut X's own USD
  book. The paired run with Revolut X's fair bounds that.
- **Yahoo stands in for EXN for October 2026 only.**
- **No production table was read; nothing was placed or cancelled.** `fx_check.py` reads the raw FXCM and Yahoo files,
  which are not committed. Their sha256 are in `inputs/raw_manifest.json`.

## 10. Next step: a draft forward paper test (not frozen)

The history shows an edge, so a draft forward pre-registration is at `2026-10-09-cj5-forward-paper-prereg.md`. It is not
frozen. It needs a design first: CoinJar's prints feeding PR5's engine, which is not a twin row. It also needs Davies' word.

## Files

`docs/agents/backtests/cj5/`:

- `scripts/`: the pulls, `inputs.py` (builder and loaders), `vbook.py`, `calibrate.py`, `cj5_sim.py`, `paired.py`,
  `regime.py`, `fx_check.py`, `spot_check.py` and `build_manifest.py`;
- `inputs/`: CoinJar's prints, EXN / Yahoo X, the USD hourly closes, Revolut X's late USD candles, `config.json` and the
  raw files' sha256;
- `results/`;
- `MANIFEST.json`.

`calibrate.py`, `cj5_sim.py`, `paired.py` and `regime.py` were run twice from the committed inputs to the same bytes.
