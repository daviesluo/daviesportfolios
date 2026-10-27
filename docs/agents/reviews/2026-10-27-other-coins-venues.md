# OTHERVENUES: other coins and other venues for PR5's rule (2026-10-27)

Davies, 2026-10-27, verbatim:

> 研究下还有别的币和别的币所可以做类似策略吗？

In English: are there other coins, and other exchanges, where a strategy like PR5 would work?

"Like PR5" means: 0 % maker quotes 0.1 / 0.2 / 0.3 % either side of a fair value on a pegged coin against a currency,
exit at fair, a 24-hour stop. The edge comes from the spread on a coin whose fair is known exactly from interbank FX.

**Research only.** Read 2026-10-27, 05:04–06:00 UTC.

- Every venue read was a keyless public GET. Revolut X's pair list came through the read-only connector.
- Two SELECTs read stored FX minutes through the Supabase connector (`backtests/othervenues/sql/fx.sql`).
- Nothing was opened, signed up for, funded, placed or cancelled. No key was read. Nothing in production changed, and
  no frozen file was edited.
- **Not blind.** Every earlier study was read first (§1).
- **Public repository.** No figure here is Davies' money. Every pound below is a backtest of £50 a rung.

Scripts, inputs and results are in `docs/agents/backtests/othervenues/` (`MANIFEST.json`). The raw pulls (about
140 MB) stayed in the scratch folder and were deleted after the build. Every page's sha256 is in
`inputs/raw_pages.json.gz`.

## 0. The answer

**Yes, but only one venue is new and worth it: OKX Europe, for an Irish resident.** Its two small books earned more per
pound than Revolut X over the last 28 days. Everything else is already running, earns less, or cannot be reached.

The verdict, ranked. Figures are PR5's frozen simulator at £50 a rung (£300 a book), with fills strictly through the
quote.

| # | venue · book | account | last 28 days (09-29 → 10-27): % a year on £300 | longer window | £ traded a day | verdict |
|---|---|---|---:|---|---:|---|
| 1 | **OKX EEA · USDG-EUR** | OKX Europe as an Irish resident, spot only | **73.4 %** (464 trips, 0 stops) | 31.9 % since listing 02-23; 104 % since 08-24 | £26k | **record and paper-test** |
| 2 | **OKX EEA · EURC-USDC** (new, listed 2026-09-21) | the same account | **36.8 %** (88 trips) | 40.0 % over its 36 days | £22k | **record and paper-test beside #1** |
| 3 | Coinbase UK · EURC-USDC | Coinbase, UK (not opened) | −0.6 % (61 trips) | **8.2 % over 12 months**, 11 of 13 months positive | £4.5m | an extra book for the Coinbase paper test, low priority |
| — | Coinbase UK · USDC-GBP (reference) | Coinbase, UK | 25.3 % (85 trips) | (already in the "with Euros" tests) | £2.6m | already being tested; the reason to open Coinbase |
| — | Revolut X · USDT-GBP (reference) | live | 23.0 % (177 trips) | — | £88k | live |
| — | Revolut X · USDC-GBP (reference) | live | 9.6 % (77 trips) | — | £65k | live |
| — | Coinbase UK · TGBP-USDC (the only GBP stablecoin with a book) | Coinbase, UK | 0.0 % | −0.5 % since listing 04-22 | £32k | **dead**: market makers hold it within 1–2 bps of GBP/USD |
| — | Bitstamp · EURCV/USDC | Bitstamp | −0.4 % | −0.0 % over 12 months (5 trips) | £4k | **dead**: 250 traded minutes in a year |
| — | Kraken · EURC/EUR, EURC/USD, EURC/USDC, TGBP/USD, EUROP, EURQ, EURR, RLUSD, USDS | Kraken (open) | not run | — | £0–£0.7m | **dead on fee**: 0.20 % maker (§2) |
| — | Gemini, Crypto.com, Bitfinex, Bitvavo, KuCoin, Bybit EU, Bitpanda, One Trading, Luno | — | not run | — | — | no book, no 0 % maker, or closed to UK individuals (§2) |
| — | dollar against dollar (USDS, USD1, PAX, PYUSD, USDG/USD, USDT-USDC) | — | not run | — | — | no FX gap; PR6 and SCQ-VENUES already answered (§2) |

The same rule on Revolut X's books, over the same 28 days, is the yardstick. It made 23.0 % (USDT-GBP) and 9.6 %
(USDC-GBP) a year at £50 a rung.

That is PR5's base rule: no weekend, through fills. LIVE's own rules differ, as PR5-OPT measured.

**Why OKX first.**

- Per pound it beat every book measured.
- It held after SCQ-VENUES flagged it on 2026-10-09:
  - USDG-EUR made £14.35 at £50 from 10-01 to 10-26;
  - it had 0 stops since 08-24;
  - 20 of the last 28 days were positive.
- Its second book, EURC-USDC, is new. It earns the same way, and the two are one account.

**What OKX does not do.**

- **It does not scale.** USDG-EUR made 58.6 % a year at £10 a rung, 31.9 % at £50, 8.9 % at £300 and 3.2 % at
  £1,000 (whole window). At £50 a rung the two books together make about £0.9 a day, about £330 a year, on £600.
- **USDG-EUR is one-sided.** Its prints sit a median +5 to +8 bps above EUR/USD every month since March. The asks made
  £57.73 of its £64.41, so it is a premium that retail pays for USDG in euros.
- **EURC-USDC is five weeks old.** Its tick is 0.001 USDC, about 9 bps at a price of 1.117, as wide as a rung. Its
  through-fill result (40 %) moves to 77 % with at-price fills and to 16 % under stress, so its fill model matters most.
- **It needs an EEA account.** That means an Irish address, a spot-only account (the 0 % maker is for accounts with no
  derivatives), and EUR by SEPA.
  - USDT cannot be traded in the EEA.
  - Whether OKX Europe lists EURC-USDC, and whether it counts as a 0 % "stablecoin pair", could not be confirmed
    keylessly: OKX serves one instrument list to every host (§2).

## 1. What was already studied (nothing here repeats it)

| study | venues · books | verdict then | where |
|---|---|---|---|
| PR5 (live since 10-01) | Revolut X UK USDC/GBP, USDT/GBP | live, £600 since 10-27 | reference §3.27, §3.51, §3.52 |
| PR6 | Revolut X UK USDC/USD, USDT/USD at par | makes money, not enough | §3.35 |
| CJ5 | CoinJar UK USDC/GBP, USDT/GBP | edge, shrunk; the app is hard and the account was under review | `2026-10-09-cj5-paper-test.md` |
| SCQ-VENUES (10-09) | Coinbase 4 books; OKX USDC-EUR, USDT-EUR, USDG-EUR; Kraken USDG/USD, USDe/EUR; Bitstamp USDC, USDT, RLUSD/EUR; Hyperliquid; a fee screen of 15 more | Coinbase UK first, OKX EEA second ("paper first"), the rest dead | `2026-10-09-stablecoin-venues.md` |
| "with Euros", "- 1", "- 2" (paper since 10-11) | Coinbase USDC-GBP, USDT-GBP, USDC-EUR, USDT-EUR; the USDC books at £25 | running; readings 11-08, 11-10 | `2026-10-10-coinbase-paper-prereg.md`, `2026-10-26-cb-usdc-prereg.md` |
| CBBOOKS-1, XV-1 (10-18) | Coinbase books against Revolut X; a cross-venue hedge | XV-1 not recommended as designed | `2026-10-18-coinbase-books-study.md` |
| QUEUE (Kraken book as a second fill check) | Revolut X books | reading 11-02 | `2026-09-28-queue-prereg.md` |
| the 10-26 and 10-27 stablecoin reviews | LIVE and every twin; PR5-OPT's rule set | USDT 2:1, no 0.3 % rung, £1 hold line twins running | `2026-10-26-stablecoin-quotes-review.md`, `2026-10-27-pr5-rules-optimisation.md` |

**What Davies can reach** (the record and today's reads):

- **Revolut X.** Open and live. Its UK list has exactly four stablecoin books, USDC and USDT against GBP and USD
  (connector, 2026-10-27: 391 pairs). There is no EUR book in the UK region and no other stablecoin. The only other
  "pegged" books are PAXG/GBP and XAUT/GBP, which are gold: their fair moves about 1 % a day, so they are not this
  strategy.
- **Kraken.** An account is open. Its stablecoin, pegged and FX pairs cost 0.20 % maker at $0+, which is fatal to a
  10 bps rung (kraken.com fee schedule, read today). Only USDG-base pairs pay 0 % maker (USDG/USD: dead, SCQ-VENUES).
  The USDe 0 % campaign ended 2026-06-30.
- **Coinbase.** Not opened as of 10-18 (CBBOOKS-1). As a UK customer: GBP and EUR balances, every `fx_stablecoin`
  pair at 0 % maker.
- **CoinJar.** Registered 10-09, under review then. Its status is not in the record since.
- **OKX Europe.** Open to EEA residents. Davies is resident in the UK and Ireland (his word, 2026-09-24).
- **Bitfinex.** Zero fees since December 2025, but its pages and third parties say it does not take UK individuals,
  and it holds no MiCA licence for Ireland: out.

## 2. The screen (2026-10-27)

Every venue's keyless instrument list was filtered to stablecoin-against-currency books and stablecoin crosses
(`scripts/screen.py` → `results/listings.json`, read 05:04 UTC). Then three snapshots, 20 s apart, of each candidate's
book and 24-hour volume were taken (`scripts/snapshot.py` → `results/snapshot_2026-10-27.json`, 05:06–05:09 UTC).

The fair in the snapshot is FX with every peg at 1. USDT's own −14 bps against the dollar therefore shows as an offset
on the USDT books.

| venue · book | £ traded in 24 h | touch, bps | mid vs FX fair, bps | maker fee | note |
|---|---:|---:|---:|---|---|
| Coinbase EURC-USDC | 6.8m | 0.9 | +0.5 | 0 % (`fx_stablecoin`) | deep; earns on sweeps (§3) |
| Coinbase TGBP-USDC | 13k | 1.5 | −0.2 | 0 % (`fx_stablecoin`) | listed 2026-04-22; £172k bid within 10 bps of fair |
| Coinbase XSGD-USDC, AUDD-USDC | XSGD £250k; AUDD not read | 2.6 (XSGD) | — | 0 % | about 50 prints a day; SGD or AUD inventory; not run |
| Coinbase USDS-USD, USD1-USD, PAX-USD, USDT-USDC | 3k–6.1m | 1–6 | — | 0 % | dollar against dollar: no FX gap (PR6) |
| Kraken EURC/EUR, EURC/USD, EURC/USDC, TGBP/USD | 476k, 692k, 46k, 10k | 2.0, 5.6, 5.7, 0.5 | +1.0, −0.3, +0.1, −2.6 | **0.20 %** | dead on fee |
| Kraken EUROP, EURQ, EURR, RLUSD, USDS against EUR | 0–17k | 2–12,000 | — | 0.20 % | dead |
| Bitstamp EURC/EUR, EURC/USDC, EURCV/EUR, EURCV/USDC | 0, £375, 0, 50k (one print; 4k a day over the year) | 2–98 | — | not verified (the fee page renders nothing) | dead on volume |
| OKX EURC-USDC | 8k (22k a day over its 36 days) | 9.0 | +2.8 | 0 % if a "stablecoin pair" on an EEA spot-only account | **candidate** |
| OKX USDG-EUR | 31k | 10.1 | +1.6 | 0 % (EEA spot-only, since 2026-09-25) | **candidate** (SCQ-VENUES' second) |
| Gemini GUSD/GBP, EUR/USDC | £176, 0 (empty book) | 10.1, — | — | 0 % on stable pairs | dead |
| Crypto.com EUR_USDT, EURC_USD | 295k, 4k | 0.09, 61 | +12.6, +24 | not found for stable pairs; 0.075–0.25 % quoted by third parties | dead: a 0.09 bps touch leaves nothing to quote inside |
| Bitfinex EURUST, GBPUST, EURR, EURQ | 1.2m, £1k, 0, 2k | 9.8, 106, … | +20, −28 | 0 % (since 12-2025) | closed to UK individuals; no MiCA licence |
| Bitvavo, KuCoin, Bybit EU, Bitpanda, One Trading | — | — | — | 0.10–0.25 % at the entry tier | dead on fee (SCQ-VENUES) |

**Coins asked about, by name:**

- **EURC.** The live candidate is Coinbase's and OKX's EURC-USDC. Coinbase retired its EURC-EUR and EURC-USD books in
  August 2024, and announced free 1:1 conversion between EUR and EURC in place of them (The Block, 2024-08-22).
- **EURCV** (SG-Forge). Only Bitstamp lists it, with no volume.
- **PYUSD.** Dollar books only; Coinbase delisted PYUSD-USD.
- **USDS / DAI.** Dollar books only, apart from Kraken's 0.20 % USDS/EUR, which trades £17 a day.
- **RLUSD.** Kraken's EUR book at 0.20 %; Bitstamp's EUR book (SCQ-VENUES: £0.27 a year at £100).
- **FDUSD.** No GBP or EUR book anywhere reachable.
- **USDe.** Kraken's EUR book lost even at 0 % (SCQ-VENUES), and its campaign has ended.
- **GBP stablecoins.** tGBP (BCP Technologies, FCA-registered) is the only one with a book: Coinbase TGBP-USDC and
  Kraken TGBP/USD. No GBPT, VGBP or GBPA book was found.

## 3. The edge where it could be run (`scripts/ov_sim.py`)

**The rule.** PR5's frozen `pr5_sim.simulate`, imported read-only through CJ5's `VBook` and SCQ-VENUES' minute
`BarBook` (proven equal to the prints in `scq_venues/scripts/calibrate_bars.py`). Rungs 0.1 / 0.2 / 0.3 %, re-price on
a 0.05 % move of fair, exit at fair, a 24-hour taker stop, a fill at most 10 % of the minute's printed value. Each book
starts flat.

**Fair.**

- A pegged cross (EURC-USDC, EURCV/USDC, TGBP-USDC) is priced at EUR/USD or GBP/USD divided by USDC's dollar value.
  USDC's dollar value is PR5's F3 on Bitstamp USDC/USD hourly closes.
- EURC, EURCV and TGBP are taken at exactly 1 EUR or 1 GBP.
- USDG is taken at exactly $1.
- Coinbase's GBP books use F3 on Bitstamp USDC/USD and Coinbase USDT-USD.
- Revolut X uses PR5's own stored minute (X and fairU from `agent_quote_minutes`, PR5-OPT's committed pull), which is
  LIVE's fair.

**When it quotes.** X is dark outside FX hours, so no book quotes at weekends: 71 % of minutes are lit.

**FX sources.**

- Before 2026-10-09: CJ5's GBP/USD and SCQ-VENUES' EUR/USD (Exness, then Yahoo).
- From 2026-10-09: PR5's stored GBP/USD and the Coinbase test's stored EUR/USD.

**Costs.**

- Maker is 0 % on every book. Bitstamp's is not verified, so it is scored at its best case.
- The stop pays the taker fee plus half the touch read today: Coinbase 0.0045 %, OKX 0.05 %, Bitstamp 0.01 %
  (assumed), Revolut X 0.09 %.

**Windows.** All end 2026-10-27 00:00 UTC.

- 12 months, or from the book's first print.
- Since 2026-08-24.
- The last 28 days (09-29 → 10-27): the only window Revolut X's and Coinbase's GBP books were run on.

**Reproducibility.** `ov.json` and `daily_50.json` come out byte-identical on a second run.

### 3.1 At £50 a rung, through the quote (`results/table.md` A)

| book | from (days) | trips | stops | bps a trip | £ a day on £300 | bps of capital a day | % a year | days + / − | day bootstrap p05–p95, £ a day |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| OKX USDG-EUR | 02-23 (246) | 1,732 | 12 | 18.2 | 0.262 | 8.73 | 31.9 % | 118 / 23 | 0.198 – 0.334 |
| OKX USDG-EUR | 08-24 (64) | 1,419 | 0 | 19.2 | 0.855 | 28.51 | 104.1 % | 46 / 2 | — |
| OKX USDG-EUR | 09-29 (28) | 464 | 0 | 18.8 | 0.603 | 20.10 | 73.4 % | 20 / 1 | 0.363 – 0.875 |
| OKX EURC-USDC | 09-21 (36) | 111 | 4 | 23.1 | 0.329 | 10.96 | 40.0 % | 20 / 1 | 0.203 – 0.466 |
| OKX EURC-USDC | 09-29 (28) | 88 | 4 | 21.2 | 0.302 | 10.07 | 36.8 % | 15 / 1 | 0.179 – 0.432 |
| Coinbase EURC-USDC | 2025-10-27 (365) | 711 | 20 | 7.0 | 0.067 | 2.24 | 8.2 % | 147 / 56 | 0.051 – 0.084 |
| Coinbase EURC-USDC | 08-24 (64) | 112 | 4 | 4.8 | 0.041 | 1.38 | 5.0 % | 23 / 10 | — |
| Coinbase EURC-USDC | 09-29 (28) | 61 | 4 | −0.5 | −0.005 | −0.17 | −0.6 % | 7 / 10 | −0.037 – 0.028 |
| Coinbase TGBP-USDC | 04-22 (188) | 49 | 2 | −4.8 | −0.004 | −0.13 | −0.5 % | 12 / 14 | −0.008 – −0.001 |
| Bitstamp EURCV/USDC (candle-grade) | 2025-11-03 (358) | 5 | 5 | −3.3 | −0.000 | −0.01 | −0.0 % | 1 / 3 | — |
| Coinbase USDC-GBP | 09-29 (28) | 85 | 0 | 14.1 | 0.208 | 6.93 | 25.3 % | 14 / 3 | 0.110 – 0.313 |
| Coinbase USDT-GBP | 09-29 (28) | 17 | 1 | 2.1 | 0.006 | 0.20 | 0.7 % | 6 / 2 | −0.015 – 0.029 |
| **Revolut X USDT-GBP** | 09-29 (28) | 177 | 5 | 13.2 | 0.189 | 6.31 | 23.0 % | 18 / 2 | 0.106 – 0.275 |
| **Revolut X USDC-GBP** | 09-29 (28) | 77 | 1 | 10.2 | 0.079 | 2.63 | 9.6 % | 15 / 2 | 0.039 – 0.121 |

The bootstraps draw 2,000 resamples of days, `random.Random(20261027)`.

### 3.2 Fill model and size (% a year, whole window; `table.md` B)

| book | £10 | £50 | £100 | at price £50 | stress £50 | £300 | £1,000 |
|---|---:|---:|---:|---:|---:|---:|---:|
| OKX USDG-EUR | 58.6 | 31.9 | 20.5 | 36.1 | 28.4 | 8.9 | 3.2 |
| OKX EURC-USDC | 40.2 | 40.0 | 39.3 | 77.2 | 16.4 | 34.7 | 25.1 |
| Coinbase EURC-USDC | 8.2 | 8.2 | 8.2 | 11.6 | 6.9 | 8.1 | 7.8 |
| Coinbase USDC-GBP (28 d) | 25.9 | 25.3 | 25.0 | 32.5 | 18.5 | 24.5 | 23.9 |
| Revolut X USDT-GBP (28 d) | 29.5 | 23.0 | 19.8 | 30.6 | 19.0 | 15.3 | 9.3 |
| Revolut X USDC-GBP (28 d) | 12.9 | 9.6 | 9.2 | 15.1 | 6.8 | 7.0 | 4.7 |

**How often each rung fills** (whole window, £50 through: trips / £; `table.md` C):

| book | k 0.1 % | k 0.2 % | k 0.3 % |
|---|---|---|---|
| OKX USDG-EUR | 814 / £13.62 | 497 / £20.73 | 421 / £30.07 |
| OKX EURC-USDC | 55 / £3.91 | 31 / £3.70 | 25 / £4.23 |
| Coinbase EURC-USDC | 557 / £9.35 | 93 / £7.34 | 61 / £7.89 |
| Revolut X USDT-GBP | 130 / £2.64 | 33 / £1.53 | 14 / £1.13 |
| Revolut X USDC-GBP | 62 / £1.24 | 13 / £0.73 | 2 / £0.24 |

On OKX's books the far rungs earn the most: those books are wide, and retail crosses them.

### 3.3 The pegs held

Prints against fair, by month (`table.md` D, the minute's last print):

- **Coinbase EURC-USDC** sat a median −1.4 to −4.9 bps below fair every month. Either EURC trades a touch under par
  or Yahoo's EUR/USD sits a hair high. The rule's bids and asks earned alike (£11.08 / £13.50), so the offset does not
  drive the result.
- **TGBP-USDC** sat at −1 to −2 bps.
- **OKX USDG-EUR** sat at +5 to +11 bps: the one-sided premium of §0.
- **No de-peg.** No month's 10th or 90th percentile went past 22 bps on any book but Bitstamp's.

### 3.4 Alongside what runs (`results/pairing.json`)

Coinbase EURC-USDC's daily P&L, 2025-11-26 → 10-08 (317 days), against PR5 on Revolut X correlates 0.09 daily and
−0.06 weekly. Against Coinbase's GBP books it is −0.02 and 0.13, and against Coinbase USDC-EUR 0.28.

Over the same days it made 2.04 bps of its capital a day, against PR5-on-Revolut-X's 17.7 and Coinbase USDC-EUR's 1.21.

### 3.5 The inventory's currency (`results/fx_risk.json`)

A cross held from pounds keeps all its capital abroad, half in euros and half in dollars. A GBP book keeps half.

The pound value of that inventory moved, over 259 weekdays:

- 25.4 bps of the capital a day (sd) for EURC-USDC;
- 19.2 bps for a GBP book;
- edge for EURC-USDC: 2.24 bps a day.

OKX's EUR books hold euros and dollar coins, so they carry the same kind of swing as EURC-USDC.

The edge is 8–20 bps a day on OKX's books and 2 bps on Coinbase's EURC-USDC. On Coinbase's cross the swing is ten
times the edge.

## 4. Recommended next steps (nothing built; each is Davies' call)

### R1. OKX-REC and OKX-PAPER: USDG-EUR and EURC-USDC

**Recorder.** A keyless recorder, built like `cb_rec.ts`:

- every print of both books, from `GET /api/v5/market/history-trades?instId=…` paged by `tradeId`;
- the top 20 levels each minute, from `/api/v5/market/books`.

It needs its own tables, an `edge_calls` row and the watchdog's beat. The daily archive at `static.okx.com` is the
completeness check: every trade id of a UTC day must be present.

**Paper twin.** PR5's `stepMinute`, unchanged, on both books. A new adaptor gives it the fair:

- EUR/USD from `cb_quote_inputs`;
- USDG at $1 (or Kraken USDG/USD's F3, chosen before the window opens);
- USDC's F3 for EURC-USDC.

It runs at €50 a rung on USDG-EUR and 50 USDC on EURC-USDC, counted in pounds. A second arm runs the weekend on the held
rates, as "with Euros - 1" does. Booked fills come only from prints strictly through the quote.

**Window.** 28 days from the first 00:00 UTC after the recorder's first whole day.

**Bar** (to freeze before the window opens):

1. P&L > 0 on each book.
2. At least 150 trips on USDG-EUR and 40 on EURC-USDC.
3. Stops at most 10 % of trips.
4. The day bootstrap's 5th percentile ≥ 0 on the two books together.
5. At least 5 bps of the capital a day on the two together. That is a quarter of USDG-EUR's last 28 days, and about
   Revolut X USDC-GBP's level.

**Account (Davies).** OKX Europe as an Irish resident:

- ID, an Irish proof of address, and a tax self-certification naming both residences;
- spot only, never a derivatives account;
- EUR by SEPA;
- for live, a trade-only key with no withdrawal, made and stored by him;
- before any of that, check in the app that EURC-USDC is listed for the account and charged 0 % maker.

**Why paper first.** These books are young and thin. Their edge is one-sided (USDG) or five weeks old (EURC-USDC).
Revolut X's books tightened four- to sixfold in one week in August.

### R2. Coinbase EURC-USDC as a fifth Coinbase book (low priority)

Add EURC-USDC to the Coinbase recorder's product list. That needs a migration to widen the `cb_*` tables' book check.

Then run a "with Euros - 3" arm on it alone, at 50 USDC a rung, with the cross's fair from a new adaptor beside
`cb_usdc.ts`. `cb_quotes.ts` is frozen.

Its case is that it is the deepest pegged cross there is (£4.5m a day), scales flat to £1,000 a rung (7.8 %), and
moves apart from PR5 (0.09). Its case against: 8 % a year at best, nothing in the last 28 days, and a currency swing
ten times its edge.

Only worth it once Coinbase is opened for USDC-GBP, which already earns more on the same account.

### Not recommended

- TGBP-USDC.
- Kraken's EURC and TGBP books, while the fee is 0.20 %.
- Bitstamp, Gemini, Crypto.com, Bitfinex.
- Any dollar-against-dollar book.
- XSGD and AUDD: thin prints, and an SGD or AUD inventory for no measured edge.

**Standing rules, unchanged.** Never trade by hand in the loop's Revolut X account or in PR5's sub-account (key `_2`):
each books that account's balance as its own. Nothing goes live without Davies' word in the conversation where he says
go.

## 5. What was not done or not checked

- **No fee was confirmed from inside an account.**
  - Coinbase's 0 % maker for EURC-USDC and TGBP-USDC rests on their `fx_stablecoin` flag and Coinbase's stable-pair
    schedule; coinbase.com answers this machine 403.
  - OKX's 0 % is its notice's "stablecoin pairs" with no list.
  - Bitstamp's fee page renders nothing here.
  - Crypto.com's stable-pair fee was not found.
- **UK access was not confirmed for EURC on Coinbase.** It is MiCA-authorised, and Coinbase UK's asset list was not
  readable here.
- **OKX Europe's pair list was not confirmed.** Its API serves one global list.
- **Through-the-quote fills on prints** are the fill model. No queue was modelled.
  - OKX's books are 9–10 bps wide and would put our quote at the front.
  - Coinbase EURC-USDC holds £75k–£318k ahead of a 0.1 % rung.
- **The OKX archive's side is taken as the taker's**, as SCQ-VENUES did; it was not confirmed.
- **Weekends were not quoted.** LIVE quotes them on held rates, and PR5-OPT found the weekend its strongest rule. The
  pegged crosses trade 24/7, so a held-rate arm could add to each; it was not run.
- **Revolut X and Coinbase's GBP books were run on the last 28 days only.** The 12-month comparison is SCQ-VENUES' and
  CJ5's, to 10-09 (§3.4).
- **Not pulled:** USDC-EUR and USDT-EUR on any venue (SCQ-VENUES has them to 10-09); XSGD-USDC and AUDD-USDC (no SGD
  or AUD minute series).
- **The touch was read once** (three snapshots in three minutes, a Tuesday 05:06 UTC). It sets every stop's cost.
- **No API rate limit was read.** The rule sends about 150 orders a book a day.

## Files

`docs/agents/backtests/othervenues/` (sha256 of each in `MANIFEST.json`):

- **`scripts/`**
  - the screen and snapshot: `screen.py`, `snapshot.py`;
  - the pulls: `cb_bisect.py`, `pull_coinbase.py`, `pull_okx.py`, `pull_bitstamp.py` (SCQ-VENUES' pullers with a new
    window), `pull_usd.py`, `grab_text.py`;
  - the inputs: `ov_inputs.py`;
  - the rule's run: `ov_sim.py`;
  - `table.py`, `pairing.py`, `fx_risk.py`, `manifest.py`.
- **`inputs/`**: the minute bars of every book run, the stored FX minutes, the hourly USD and EURC series, and each
  raw page's sha256.
- **`results/`**: `listings.json`, `snapshot_2026-10-27.json`, `ov.json`, `daily_50.json`, `table.md`, `pairing.json`,
  `fx_risk.json`.
- **`sql/fx.sql`**: the two SELECTs.
