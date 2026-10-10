# SCQ-VENUES: where else PR5's rule can run, now that CoinJar is slow to open (2026-10-09)

Davies, 2026-10-09: "coinjar的账户我注册了，但这个app很难用，目前账号资料还在审核中交易不了，还有没有其他平台可以做这种策略的？" He has
registered at CoinJar, finds the app hard to use, and the account is still under review. He asks which other platforms
can run this strategy. He lives in both the UK and Ireland (his word, 2026-09-24), so EEA venues that take Irish
residents are in scope for EUR books.

"This strategy" is PR5's frozen rule. It rests 0 % maker quotes 0.1 / 0.2 / 0.3 % either side of interbank fair on a
stablecoin-against-fiat book, exits at fair, and stops at 24 hours. It is live on Revolut X UK and was tested on CoinJar
as CJ5 (`2026-10-09-cj5-paper-test.md`).

This is research only, on keyless public data. Nothing was opened, signed up for, funded or traded. No key was read and
no production table was read. Nothing here is frozen.

## 0. The verdict

**Open Coinbase Advanced next, as a UK customer. Then consider OKX Europe as an Irish resident, paper first.**

| # | venue and account | books one account trades | fee (maker / taker) | £100 a rung: last 12 months | last 28 days, £ a year | bootstrap index 100, £ a year | £1,000 a rung: 12 months / 28 days, £ a year | ease | verdict |
|---|---|---|---|---:|---:|---:|---:|---|---|
| 1 | **Coinbase Advanced, UK account** | USDC-GBP, USDT-GBP, USDC-EUR, USDT-EUR (£2,400) | 0.00 % / 0.0045 % | **£192.95** (8.0 %/yr) | £315 | £166 | **£1,781 / £3,128** | high: the mainstream app, a full API, Faster Payments, UK residence as today | **open next** |
| 2 | **OKX Europe (EEA), Irish account, spot only** | USDC-EUR, USDG-EUR (£1,200) | 0.000 % / 0.050 % (since 2026-09-25) | £104.69 (USDG-EUR listed 2026-02-23) | **£598** | £82 | £355 / £689 | medium: Irish proof of address, and the account must stay spot-only | **second; record and paper first** |
| 3 | Bitstamp, USDC/EUR | USDC/EUR (£600) | not verified (scored at 0 % / 0.01 %) | £50.06 | £19 | £42 | £483 / £168 | medium | only if its stable-pair fee is 0 %; candle-grade |
| 4 | Coinbase, EEA account | USDC-EUR only (£600) | 0.00 % / 0.0045 % | £35.20 | £96 | £25 | £354 / £954 | high | worse than the UK account: no GBP and no USDT |
| 5 | Kraken (Davies' existing account) | USDG/USD at 0 % maker (£600) | 0.0 % / 0.01 % | £13.51 | £8 | £8 | £135 / £83 | already open | dead; its GBP/EUR stable books pay 0.20 % maker |
| — | Kraken USDe/EUR (0 % campaign) | — | 0 % / 0 %, campaign "until 30 June 2026" | −£6.05 | £8 | −£11 | — | — | dead |
| — | Revolut X EEA USDC/EUR | — | 0 % maker | (first search: the best book) | — | — | — | blocked: one Revolut account per person | blocked |
| — | CoinJar UK (CJ5, for reference) | USDC/GBP, USDT/GBP (£1,200) | 0.00 % / 0.001 % | £177.66 | £311 | £146 | about £544 (saturates) | hard app, under review | in progress |
| — | Bitvavo, Bybit EU, Bitpanda Fusion, One Trading, KuCoin EU, Gemini, Crypto.com, Binance, Luno, Uphold | — | 0.10–0.25 % maker, no book, or closed | — | — | — | — | — | dead (§2) |

Notes on the table:

- **Every figure is PR5's frozen simulator**, `pr5_sim.simulate`, imported read-only. It runs on each book's print
  history from 2024-10-01 (or the book's first print) to 2026-10-09 00:00 UTC.
- **Fills are strictly through the quote.** The pounds are P&L by entry day, at £100 a rung: six rungs a book.
- **"28 days"** is 2026-09-11 → 10-09, at a yearly rate.
- **The bootstrap** draws days of the last 12 months: 2,000 draws, `random.Random(20261023)`, index 100.

**Why Coinbase first.**

- **It is the only candidate that is both easy and scalable.** Its four books trade £37m a day together. On those deep
  books the rule's money grows with rung size: £1,781 a year at £1,000 a rung over the last 12 months. CoinJar's money
  stops near £500 a year whatever the size.
- **It needs no new residence.** A UK Coinbase customer holds GBP and EUR balances, so one account trades all four
  books.
- **It diversifies PR5.** Coinbase's daily P&L correlates 0.09 with PR5's on Revolut X over the same 317 days.
- **The money is spread out.** 243 days positive and 32 negative in the last 12 months. The best day was 2.3 % of the
  total, and the bootstrap's 2,000 draws were all positive.

**What Coinbase does not do.**

- **It does not beat CoinJar per pound at £100 a rung.** On the two GBP books alone, Coinbase made £135.71 in the last
  12 months on £1,200; CJ5 made £177.66 on the same £1,200.
- **Its edge comes from sweeps.** A deep book sits 1–2 bps from fair, so the rule earns only when a large order sweeps
  through 10–30 bps.
- **It has shrunk, like every book measured.** The four books made £755 a year at the 2024 Q4 rate, £427 in 2025, and
  £177 a year in 2026 to date. The last 28 days ran at £315 a year.

**Why OKX second, and only on paper first.**

- **It has the highest recent rate of any venue.** At £100 a rung on £1,200 it ran at £598 a year over the last 28 days,
  and at £438 a year since 2026-09-25, when OKX's 0 % maker for EEA spot-only accounts began.
- **But most of OKX's money comes from one book**, USDG-EUR: 72 % of the 12-month figure and all of the last 28 days'
  (USDC-EUR lost money then). That book was listed on 2026-02-23 and trades about £25k a day. Its P&L was £0.03–£0.72 a month until July, then £13.35 in August, £51.39 in September and £9.63 in October to
  the 9th.
- **It is mostly one side.** Asks made £65.37 and bids £10.02. In September a traded minute's last print sat a median 6.5 bps
  above EUR/USD fair.
- **That is two months of one young, thin book.** It is the shape PR5 lost when Revolut X tightened. A forward test
  should come first.

## 1. What was run

**The rule.** `docs/agents/scripts/pr5/pr5_sim.py`'s `simulate`, imported read-only through CJ5's `VBook` adaptor. CJ5's
adaptor reproduces `pr5_run1.json` figure for figure (`backtests/cj5/results/calibration.json`). Rungs, re-pricing,
post-only refusal, exit at fair, the 24-hour stop and the 10 % of a minute's volume cap are as frozen.

**Minute bars, proven lossless.** Coinbase's four books printed 33 million trades in two years, too many to commit. So
each minute is reduced to what the simulator reads:

- the lowest and highest price each aggressor side printed;
- the last print's price and aggressor;
- the quote volume.

The simulator asks only whether a print went through a price, the minute's volume and the last print before a minute
boundary. A rung filled in a minute leaves the market until the next turn. `calibrate_bars.py` runs CJ5's whole CoinJar
record both ways (`results/calibrate_bars.json`):

- **as bars**, the through, stress and full-size arms at £10 and £100, and the at-price arm at £100, give the same trips
  as the prints. The one exception is the side-aware arm, because CoinJar's auction prints have no side;
- **in the committed encoding** (volume to 0.01, no time inside the minute), £2,827.5667 becomes £2,827.5667 plus
  £0.00004 on USDC/GBP, with the same 28,922 trips.

**The prints.** Each source is keyless:

| venue | books | source | prints (2024-10-01 → 2026-10-09) | check |
|---|---|---|---:|---|
| Coinbase | USDC-GBP, USDT-GBP, USDC-EUR, USDT-EUR | `api.exchange.coinbase.com/products/<ID>/trades`, paged back by trade id (Coinbase's `side` is the maker's; flipped to the aggressor) | 5,524,420 / 3,241,436 / 17,688,965 / 6,724,973 | every trade id from 2024-10-01 to the end is covered, no gap; 32 random pages re-read live, all byte-identical |
| OKX | USDC-EUR, USDT-EUR, USDG-EUR | the daily trade archive `static.okx.com/cdn/okex/traderecords/trades/daily/…` (taker side) | 6,346,595 / 7,350,275 / 50,990 | 10 random day files re-read, identical |
| Kraken | USDe/EUR, USDG/USD (and USDe/USD for fair) | `api.kraken.com/0/public/Trades` | 48,660 / 1,695,481 | 6 pages re-read, identical |
| Bitstamp | USDC/EUR, USDT/EUR, RLUSD/EUR | 1-minute OHLC: Bitstamp serves no print history, so the bars are **candle-grade** (low, high, close, aggressor unknown) | 374,797 / 376,574 / 50,057 minutes | 6 pages re-read, identical |

**The anchor and fair.**

- **GBP/USD** is CJ5's committed series: EXN minute mids, then Yahoo for October.
- **EUR/USD** is built the same way here: Exness's monthly EURUSD tick archive (EXN) to 2026-09-30, then Yahoo's 1-minute
  closes.
- **fairU** is PR5's F3: the median of a deep USD book's hourly closes over [t−24 h, t−1 h]:
  - USDC: Bitstamp USDC/USD;
  - USDT: Coinbase USDT-USD (both CJ5's series);
  - USDG: Kraken USDG/USD;
  - USDe: Kraken USDE/USD;
  - RLUSD: Bitstamp RLUSD/USD.
- **fair = fairU / X.** A minute with no X in the last 10 minutes is dark, so weekends quote nothing. A USD book has no
  anchor and quotes every minute.

**Sizing in pounds.** Each book's X is set to the pound value of one unit of its quote currency, so rung sizes, the 10 %
cap and every P&L are in pounds:

- 1 for GBP;
- EUR/USD ÷ GBP/USD for EUR;
- 1 ÷ GBP/USD for USD.

**Costs.**

- **Maker is 0 %**, the simulator's own.
- **The 24-hour stop** pays the venue's taker fee plus half the book's touch. The touches were read live on 2026-10-09
  around 22:25 UTC (`inputs/touch.json`):
  - Coinbase GBP 1.32 bps; Coinbase USDC-EUR 1.12; Coinbase USDT-EUR 0.22;
  - OKX USDC-EUR 0.22; OKX USDT-EUR 1.12; OKX USDG-EUR 17.9;
  - Kraken USDe/EUR 4.5;
  - Bitstamp 0.45–1.0.
- **Kraken USDe/EUR is also run at Kraken's standard 0.20 %** on each leg: −£25.74 over the last 12 months at £100.

**Arms.**

- Through the quote at £10, £50 and £100 a rung.
- At the price (the optimistic bound) at £100.
- One tick deeper with a double stop cost (stress) at £100.
- £300 and £1,000 a rung for capacity.

**Reproducibility.** `sv_sim.py` was run twice from the committed inputs: `sv.json`, `daily_100.json` and
`trips_100.json.gz` came out byte-identical.

## 2. The venue screen

The fees below come from each venue's own page where this machine could read it. Where it could not, the source is
named.

| venue | entity, licence | who can open | stable–fiat books (keyless listing, 2026-10-09) | maker / taker at the lowest tier | post-only, API | min order | GBP / EUR funding | friction | verdict |
|---|---|---|---|---|---|---|---|---|---|
| **Coinbase Advanced** | UK: CB Payments Ltd, on the FCA cryptoasset register since 2025-02 (ref 900635). EEA: Coinbase's MiCA licence from Luxembourg's CSSF, June 2025 | UK or EEA residents, one account per person; the entity follows the residence given | `fx_stablecoin`: USDC-GBP, USDT-GBP, USDC-EUR, USDT-EUR, EURC-USDC, TGBP-USDC, USDC-CAD/SGD/AUD/BRL/INR, USD1-USD, USDS-USD, PAX-USD. An EEA account has no USDT (delisted 2024-12-30) | **0.00 % maker on stable pairs; 0.0045 % taker** (Coinbase help centre and its Exchange fees page, via search; coinbase.com answers this machine 403). Stable-pair volume does not count toward the tiers | `post_only` on limit orders; REST and WebSocket; keyless public trades, books and candles | notional £0.72 / €0.84 (`min_market_funds`), 0.01 coin | GBP by Faster Payments. A UK customer holds a EUR balance too, funded by SEPA (Coinbase's EMEA funding page). SEPA withdrawal about €0.15 (third party) | low: the mainstream app; the first stat-arb search had left "if sign-up works" open | **1** |
| **OKX** | EEA: OKX Europe Ltd, MiCA via Malta's MFSA since 2025-01-27. UK: not checked | an EEA resident for the EEA entity | USDC-EUR, USDG-EUR. USDT-EUR is listed, but OKX's pages say USDT cannot be traded in the EEA (no MiCA authorisation) | **EEA spot-only accounts from 2026-09-25: stablecoins 0.000 % maker / 0.050 % taker at Regular tier.** Other pairs 0.100 / 0.200 % (OKX notice, published 2026-09-11). An account with derivatives pays 0.08 / 0.10 % | `post_only` order type; v5 REST and WebSocket; daily public trade archive | 1 USDC / USDG | SEPA; OKX says deposits are free. Withdrawal fee not checked | medium: Irish proof of address; keep the account spot-only | **2** |
| **Bitstamp** | UK: Bitstamp Ltd (FCA). EU: Bitstamp Europe S.A., MiCA (CSSF, May 2025); owned by Robinhood | UK or EEA | **EUR only**: USDC/EUR, USDT/EUR, RLUSD/EUR, EURCV/EUR (EURC/EUR without market orders). No GBP stable book | not verified: the fee page renders nothing here. Third parties quote stable pairs at 0.00 / 0.01 % or 0.06 / 0.08 %; standard 0.30 / 0.40 % | REST; post-only not checked; no keyless print history (OHLC only) | €10 | SEPA; Faster Payments not checked | medium | 3, if the fee is 0 % |
| **Kraken** | UK: Payward Ltd (FCA). EEA: MiCA from the Central Bank of Ireland (2025-06-25). **Davies already has an account** | UK or EEA | USDC/GBP, USDT/GBP, USDC/EUR, USDT/EUR, EURC/EUR, USDE/EUR, RLUSD/EUR, USDS/EUR, EUROP/EUR, USDG/USD and others | **stablecoin, pegged and FX pairs: 0.20 % / 0.20 % at $0+**, 0.02 / 0.02 % only from $1m a month, 0.00 / 0.01 % from $10m. **USDG pairs 0.0 / 0.01 %.** USDe pairs 0 / 0 "until the 30th June, 2026", still on the page 2026-10-09 (kraken.com/features/fee-schedule) | post-only; REST signed | 5 coins | already set up | none | dead at 0.20 %; USDG/USD measured (£13.51) |
| Gemini | Gemini Europe (MiCA, Malta); Gemini UK | UK or EEA | GBP: GUSD/GBP only. No USDC/EUR or EUR book with data | stable pairs 0.00 / 0.01 % (RLUSD/USD, USDC/GUSD, GUSD/USD 0 / 0); ordinary pairs 0.60 / 1.20 % | yes | — | — | — | dead: GUSD/GBP traded £108 in 24 h with a 500 bps touch |
| Crypto.com Exchange | MiCA (Malta), UK registration | — | none against GBP or EUR on its public instrument list (EURC_USD, USDT_USD, PYUSD_USD, USD1_USD) | not needed | — | — | — | — | no book |
| Bitvavo | Netherlands, MiCA (AFM) | EEA only, not the UK | USDC/EUR, USDT/EUR, EURC/EUR and others | **stablecoin pairs 0.10 % / 0.10 % at €0+** (0.00 % maker only at high volume, which stable-pair volume does not count toward), via its fee page as quoted by search; bitvavo.com answers 403 here | — | — | SEPA | — | dead on fee |
| Bybit EU | Austria, MiCA | EEA | USDC/EUR, USDT/EUR | non-VIP fiat pairs 0.15 % maker / 0.20 % taker (bybit.eu's fee guide). Its API refuses this machine (CloudFront geo-block) | — | — | — | — | dead on fee |
| Bitpanda Fusion | Austria | EEA, UK | trades against EUR, GBP, USD, USDC, EURC | Level 1: 0.25 %, down to 0.02 % only at high volume (bitpanda.com fees) | API | — | — | — | dead on fee |
| One Trading | ex-Bitpanda Pro; now perpetuals-led | — | USDC_EUR listed (aggregator) | 0.10 % maker under €10k a month (its fee page) | — | — | — | — | dead on fee |
| KuCoin EU | Austria, MiCA (FMA's new-business ban lifted 2026-05-18) | EEA, not the UK | USDC/EUR | at most 0.10 % (launch report) | — | — | — | — | dead on fee |
| Binance | no MiCA licence; EEA deposits, spot orders and sign-ups switched off 2026-07-01 (secondary sources); no new UK users since 2023 | — | — | — | — | — | — | — | closed; and the repo rule says a Binance row cannot be live |
| Luno | — | — | stablecoin books only against ZAR, NGN, KES, IDR (public tickers) | — | — | — | — | — | no book |
| Uphold | a broker | — | no public maker order book | — | — | — | — | — | not applicable |
| LMAX Digital, Archax | institutional | institutions | — | — | — | — | — | — | not checked further |
| Hyperliquid (spot; added 2026-10-10) | an on-chain order book, no licence; a self-custody wallet, with USDC bridged in (its spot is not caught by the FCA's derivatives ban) | anyone with a wallet; no account | dollar against dollar only. USDT0/USDC trades $545k a day; USDe, FEUSD, USDH and USDHL against USDC $0–7k | base 0.040 % / 0.070 %. "Spot pairs between two spot quote assets have 80% lower taker fees, maker rebates, and user volume contribution", and the page's formula scales the maker rate by 0.2 on them: 0.008 % / 0.014 % | post-only (ALO); a keyless `info` API, signed actions | — | crypto only, by bridge | a wallet, a bridge, gas | **dead**: USDT0/USDC's minute closes sit a median 1.0 bps from fair (p90 2.4, max 5.3). Its 15-minute bars reach 10 bps in 0.44 % of 52 days. Two trips in its 3.5 days of 1-minute candles, about 3 %/yr after fees. No FX gap for the rule to quote around (`backtests/scq_venues/results/hl_screen.json`) |
| Revolut X EEA | Revolut Digital Assets Europe (CySEC, MiCA, secondary sources) | one Revolut account per person, tied to the residence country | USDC/EUR | 0 % maker | — | — | — | moving Revolut residence to Ireland closes the UK account that runs PR5 | blocked (first search, §3) |

**The screen's rule.** A book is simulated if its maker fee is at most 0.02 % or has a realistic path to it, and its
history is keyless:

- Coinbase's four GBP and EUR books.
- OKX's three EUR books, at the EEA spot-only fee.
- Kraken: USDG/USD at 0 % maker, and USDe/EUR at its campaign rate.
- Bitstamp's three EUR books, at an assumed 0 %, as a best case.

Kraken's 0.02 % tier needs $1m of 30-day volume. The rule's own volume, £20–£30k a month at £100 a rung, never reaches it.

**Hyperliquid (added 2026-10-10, Davies' question).** It was earlier used as a feed (PMSC), for its funding (STATARB-2) and
for its HLP vault (STATARB), never for PR5's rule on its spot stablecoin books.

- **Keyless history.** `candleSnapshot` serves the newest 5,000 candles of an interval: 1-minute candles reach 3.5 days
  back, 15-minute 52 days, hourly 208 days. `recentTrades` serves the last 10 prints. So the screen is candle-grade
  (`hl_screen.py`).
- **The anchor.** Every book is dollar against dollar, so X is 1.0 and fair is PR5's F3 on the book's own hourly closes.
  The rule runs unchanged, but it loses its reason: PR5's edge is retail paying across an FX gap. Here USDT0/USDC is
  held within a basis point or two by arbitrage.
- **What deciding would need.** A forward recorder of every print (the websocket `trades` feed, since REST keeps ten)
  and of `l2Book`, for 28 days. Nothing here suggests it is worth building.

## 3. By book and by year (£100 a rung, fills strictly through)

The 2024 Q4, 2025, 2026, since-08-24 and last-28-days columns are £ a year (annualised); "last 12 m" is the 12 months'
pounds. Capital is £600 a book (six rungs).

| book | £ volume a day (12 m) | 2024 Q4 | 2025 | 2026 to 10-09 | last 12 m | %/yr | trips (12 m) | stops | since 08-24 | last 28 d | at price (12 m) | stress (12 m) | £1,000 (12 m) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Coinbase USDC-GBP | 7,269,972 | £141 | £89 | £33 | £36.25 | 6.0 % | 571 | 5 | £124 | £186 | £55.97 | £28.77 | £331.68 |
| Coinbase USDT-GBP | 1,547,758 | £400 | £231 | £94 | £99.47 | 16.6 % | 1,163 | 13 | £6 | £6 | £148.92 | £72.60 | £882.02 |
| Coinbase USDC-EUR | 22,155,840 | £111 | £92 | £25 | £35.20 | 5.9 % | 507 | 15 | £78 | £96 | £50.32 | £26.85 | £354.13 |
| Coinbase USDT-EUR | 6,054,223 | £103 | £15 | £25 | £22.03 | 3.7 % | 603 | 19 | £25 | £27 | £24.67 | £20.21 | £213.17 |
| OKX USDC-EUR | 2,970,587 | £18 | £39 | £33 | £29.30 | 4.9 % | 713 | 42 | −£12 | −£14 | £30.31 | £23.25 | £235.16 |
| OKX USDT-EUR (not tradable in the EEA) | 1,246,498 | £12 | £56 | £38 | £41.25 | 6.9 % | 747 | 31 | −£4 | −£4 | £58.01 | £27.09 | £359.31 |
| OKX USDG-EUR (from 2026-02-23) | 20,393 | — | — | £121 | £75.39 | 20.1 % | 1,562 | 17 | £488 | £612 | £85.26 | £67.25 | £119.81 |
| Kraken USDG/USD (from 2024-11-04) | 1,275,739 | £22 | £40 | £5 | £13.51 | 2.3 % | 73 | 0 | £10 | £8 | £17.07 | £11.43 | £135.04 |
| Kraken USDe/EUR (from 2025-09-24) | 39,219 | — | −£2 | −£8 | −£6.05 | −1.0 % | 75 | 27 | £5 | £8 | −£4.99 | −£6.15 | −£29.04 |
| Bitstamp USDC/EUR (candle-grade) | 7,126,098 | £56 | £39 | £51 | £50.06 | 8.3 % | 871 | 16 | £34 | £19 | £50.69 | £44.59 | £483.04 |
| Bitstamp USDT/EUR (candle-grade) | 4,786,689 | £51 | £7 | −£2 | −£0.12 | 0.0 % | 271 | 22 | −£7 | −£13 | −£1.06 | £0.09 | £1.13 |
| Bitstamp RLUSD/EUR (candle-grade) | 163,120 | — | −£1 | −£1 | £0.27 | 0.0 % | 32 | 17 | −£2 | £0 | −£0.53 | −£0.13 | −£2.24 |

**What the table says.**

- **Coinbase's USDT-GBP was the best GBP book until August, then it tightened as Revolut X's UK books did.** It made
  £230.87 in 2025 and £0.71 in the 46 days from 2026-08-24. USDC-GBP moved the other way: £15.67 in the same 46 days,
  with no stop.
- **The deep EUR books pay a few percent a year.** Coinbase USDC-EUR, OKX USDC-EUR and Bitstamp USDC/EUR make £29–£50 a
  year at £100 a rung, but they scale: £235–£483 at £1,000.
- **Kraken has nothing.** USDG/USD trades at $1.0000/1.0001 and rarely reaches 10 bps. USDe/EUR loses even at 0 %: 27 of
  75 trips stopped.
- **Fill rate.** The at-price arm adds 1–54 % to a book's 12-month figure, and about half on Coinbase's two GBP books.
  That half depends on being at the front of the queue at our price, which only a live order can show.
- **Order load.** About 210 orders a day on each deep book.

## 4. Each venue's package, last 12 months

At £10, £50 and £100 a rung, through the quote (`results/venues.json`):

| package | capital at £100 | £10 | £50 | £100 | at price £100 | stress £100 | £300 | £1,000 | trips / stops (£100) | days + / − | best day |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---:|
| Coinbase UK (4 books) | £2,400 | £19.75 | £97.61 | £192.95 | £279.89 | £148.44 | £566.84 | £1,781.00 | 2,844 / 52 | 243 / 32 | 2.3 % |
| Coinbase UK, GBP books only | £1,200 | £13.97 | £68.80 | £135.71 | £204.89 | £101.37 | £395.61 | £1,213.70 | 1,734 / 18 | 236 / 28 | 2.5 % |
| OKX EEA (USDC-EUR + USDG-EUR) | £1,200 | £24.58 | £73.11 | £104.69 | £115.57 | £90.50 | £182.89 | £354.97 | 2,275 / 59 | 202 / 59 | 4.1 % |
| Bitstamp USDC/EUR | £600 | £5.10 | £25.18 | £50.06 | £50.69 | £44.59 | £146.87 | £483.04 | 871 / 16 | 204 / 44 | 4.7 % |
| Coinbase EEA (USDC-EUR) | £600 | £3.52 | £17.63 | £35.20 | £50.32 | £26.85 | £105.91 | £354.13 | 507 / 15 | 112 / 58 | 4.9 % |
| Kraken USDG/USD | £600 | £1.35 | £6.76 | £13.51 | £17.07 | £11.43 | £40.52 | £135.04 | 73 / 0 | 19 / 0 | 17.8 % |
| CJ5 on CoinJar (reference) | £1,200 | £24.87 | £103.40 | £177.66 | £221.11 | £112.43 | £345.23 | £543.89 | — | — | — |

**Coinbase UK by month at £100** (2026): £23.22, 21.39, 9.69, 18.70, 17.97, 7.14, 6.46, 2.98, 22.18, then £6.44 to
October 9.

**OKX EEA by month at £100** (2026): £2.62, 7.41, 9.30, 3.03, 1.91, 2.15, 0.96, 14.21, 51.08, then £8.43.

**Around OKX's fee change (2026-09-25 08:00 UTC), at £100, £ a year:**

| | 08-24 → 09-25 | from 09-25 (14 days) |
|---|---:|---:|
| OKX EEA | £492.64 | £438.01 (393 trips) |
| Coinbase UK | £213.79 | £277.75 |

The 14 days are too few to tell whether more makers at 0 % will close the gap.

## 5. Against PR5 on Revolut X, the same days

**Set-up.** PR5 here is CJ5's paired run, imported: Revolut X's UK prints, its own USD-book fair and PR5's stop cost, at
£100 a rung. It made £672.57 over 2025-11-26 → 2026-10-08 (317 days), as CJ5 found. The figures are correlations of
daily P&L by entry day (`results/pairing.json`):

| package | total, same days | vs PR5, daily | vs PR5, weekly | vs CJ5, daily |
|---|---:|---:|---:|---:|
| Coinbase UK | £154.18 | 0.09 | −0.15 | 0.28 |
| OKX EEA | £104.00 | −0.06 | −0.44 | 0.26 |
| Bitstamp USDC/EUR | £43.57 | 0.21 | 0.27 | 0.14 |
| CJ5 (CoinJar) | £136.54 | 0.08 | −0.27 | — |

**What it says.**

- **No candidate's daily P&L moves with PR5's.** Running one beside PR5 adds return without adding the same days'
  risk.
- **The negative weekly figures are mostly timing.** PR5 earned most before 2026-08-24. OKX's USDG-EUR earned most after
  it.

## 6. Risks and what breaks it

- **The books tightening.** That is how PR5's rate on Revolut X fell four- to sixfold in August, and how Coinbase's
  USDT-GBP went quiet the same weeks.
  - OKX's 0 % maker began on 2026-09-25 for every EEA spot-only account. If other makers move in, USDG-EUR may tighten
    the same way.
- **Thin books.** USDG-EUR trades about £25k a day. In the last 28 days the rule's fills at £100 a rung were £861 a
  day, 3.5 % of the book. At £1,000 a rung its money saturates near £780 a year.
- **Coinbase's money comes in sweeps.** Its books sit 1–2 bps from fair. The rule waits for an order large enough to go
  through 10–30 bps, so months vary: £2.98 in August 2026, £22.18 in September.
- **The fill model is untested on each of these venues.** As in CJ5, a fill needs a print strictly through the quote,
  capped at 10 % of the minute's volume.
- **GBP/USD and EUR/USD on the coins.** Half the capital is held as coins behind the asks; CJ5 §5 measured this risk.
  On the EUR books the pound value of the euros behind the bids also moves with EUR/GBP.
- **Stablecoin risk.** USDG (Paxos) is the coin OKX lists for the EEA beside USDC. USDT books are UK-only. USDe failed.
- **Fees can change.**
  - OKX's stable-pair rate holds only while the account has no derivatives.
  - Coinbase's taker fee is quoted from search, because coinbase.com refused this machine.
  - Bitstamp's fee is unverified.

## 7. What Davies would need to do

**Coinbase, as a UK customer.**

1. If he already has a Coinbase account, use it: it is one account per person. Otherwise sign up at coinbase.com as a
   UK resident: ID, selfie, UK address.
2. Fund GBP by Faster Payments. A EUR balance (SEPA) is needed only for the two EUR books; the GBP books alone made
   £135.71 of the £192.95.
3. Nothing else is needed for a forward paper test. Coinbase's trade tape is public and complete, so the test can start
   before the account exists.
4. **For live**, a Coinbase Developer Platform API key with trade permission only (no transfer), made and stored by him
   in Supabase.
5. **For live**, a new venue client in the repo: JWT-signed requests, `post_only` limit orders and a minute recorder.

**OKX, as an Irish resident (EEA entity).**

1. Open the account with his Irish address. Expect to need ID, an Irish proof of address (a recent utility bill or bank
   statement), and a tax-residence self-certification naming both countries.
   - This was not confirmed with OKX.
   - He should declare both residences truthfully.
2. **Do not open a derivatives (X-Perps) account.** OKX's 0 % stable-pair maker applies to spot-only accounts.
3. Fund EUR by SEPA from a euro account.
4. A trade-only key (no withdrawal), made by him.
5. **Paper first**: a keyless recorder of USDG-EUR's prints for 28 days. The edge is two months old on one thin book.

**Standing rules, unchanged.**

- Never trade by hand in the loop's Revolut X account or in PR5's sub-account (key `_2`): each books that account's
  balance as its own.
- Nothing goes live without his word in the conversation where he says go.

## 8. What was not done or not checked

- **Fees were read from the venues' own pages only for Kraken, OKX and Gemini.**
  - coinbase.com, bitvavo.com and Bitstamp's fee page refused this machine or rendered nothing.
  - Their rates are quoted from the venues' help pages or announcements as returned by search, and say so in §2.
  - Bybit's API refused this machine (geo-block).
- **Which books a UK Coinbase customer can trade on Advanced** (EUR books, USDT) was read from Coinbase's help pages, not
  from an account.
- **What each venue needs from a dual UK/Irish resident was not confirmed with any venue.** Nothing was signed up for.
- **Bitstamp is candle-grade.** There is no print history, so the last print's side is unknown and an equal-price
  post-only refusal never happens: a small optimism. Its stable-pair fee is assumed 0 %.
- **Two years, not the whole record.** Coinbase's books go back to 2021. The rest of their history (about 30 million
  more trades) was not pulled.
- **No null test.** PR5's random-time null was not run here. The day bootstrap and the per-month figures are the
  confidence measures.
- **One reading of the touch.** Each book's touch was read once (five reads, 20 s apart, around 22:25 UTC on a Friday).
  It is used for every year's stops.
- **No API rate limits or order caps were read.** The rule places about 210 orders a day per book.
- **The OKX daily archive's side field** is taken as the taker's, per OKX's API convention, not confirmed for the
  archive.
- **No production table was read; nothing was placed, cancelled or funded.**

## Files

`docs/agents/backtests/scq_venues/` (every file's sha256 in `MANIFEST.json`):

- `scripts/`:
  - the keyless pulls (`pull_coinbase.py`, `pull_okx.py`, `pull_kraken.py`, `pull_bitstamp.py`, `pull_fx_eur.py`,
    `pull_usd_extra.py`, `read_touch.py`);
  - `sv_inputs.py` (builder and loaders);
  - `bars.py` and `calibrate_bars.py` (the minute-bar adaptor and its proof);
  - `sv_sim.py`, `venues.py`, `pairing.py`, `spot_check.py` and `build_manifest.py`.
- `inputs/`: minute bars per book, EUR/USD, the extra USD series, the touch, and each raw page's sha256 (`raw_pages/`).
- `results/`:
  - `sv.json` (every book, arm and window);
  - `venues.json`, `pairing.json`, `pr5_revx_daily_100.json`;
  - `daily_100.json`, `trips_100.json.gz`;
  - `calibrate_bars.json`, `spot_check.json`.
