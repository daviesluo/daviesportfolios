# CRYPTOBOOKS: is there money for us in Revolut X's crypto books? (2026-10-31)

Davies, 2026-10-31: "加密货币盘继续深度研究" (keep studying the crypto books, in depth), after MAKER-OTHER-BOOKS
(`reviews/2026-10-31-maker-other-books.md`) found automated symmetric ladders on them. Any method; the 1,000 orders a day
count per account or sub-account of his own.

**Research only, not blind.** Every record was read. Nothing in production changed: no order, config, migration, executor or
frozen file. Public market data only (keyless GETs: Revolut X's UK books, tickers and trade history; Binance's public
one-second klines and book tickers; Kraken's and Coinbase's tickers) and read-only SQL. No balance of Davies' accounts
appears: every pound below is a replay's (paper) or a public market figure. The USD stablecoin books are another agent's
study and are left out. Scripts, inputs and results: `docs/agents/backtests/cryptobooks/` (`MANIFEST.json`; `scripts/show.py`
prints the tables below from `results/`).

## 0. Answers first

**The books (Q1).** Revolut X lists 387 UK books (300 against USD, 64 GBP, 23 USDC); 65 traded $20k or more in the last 24 h
and 19 $100k or more (the venue's tickers, 06:38 UTC). Through 2026-10-28 the majors were tight, and tight because of one
automated layer near the outside price: takers on BTC, ETH, SOL and XRP (GBP and USD) paid a median **0.5–4 bps** over
Binance's price of the second before, the loop's own reads of the USD touch were 1.5 (BTC), 1.8 (ETH) and 3.7 bps (SOL)
every day of October, and the takers were uninformed: Binance's price moved 0.0–0.8 bps their way over the next 1–300 s.
That layer has been leaving: **XRP-GBP's from 2026-10-28 16:00 UTC** (its takers have paid 13–37 bps since), SOL-GBP's
partly on 10-29/30 and from 01:00 today (the GBP stablecoin maker left at 00:58), ETH-GBP's from about 03:00 today; this morning's poll read SOL-GBP 34 bps wide,
XRP-GBP 57, ETH-GBP 16, SOL-USD 22, ETH-USD 10, BTC-USD 6. What is left is slow: the visible ladders follow half of an
outside move in a median **7 s (SOL-GBP), 21 s (ETH-GBP) and 63 s (XRP-GBP)**, and the stale quotes the tape shows being
taken had stood a median **36–200 s** behind Binance (57 s on SOL-GBP, 90 s on SUI-GBP, 114 s on XRP-GBP).

**What pays (Q2–Q5), ranked** (paper, £600 unless named; "out" is 2026-10-24 → 10-30, chosen on 10-17 → 10-23; "10-31" is
today's 00:00 → 06:39 UTC, after every parameter was fixed):

| # | method | book | out £/day | P(mean ≤ 0) | 10-31 | what it needs | verdict |
|---|---|---|---|---|---|---|---|
| 1 | **(a) 0 % maker, 12 bps either side of Binance's second price, re-priced on a 10 bps move, sells only what it bought** | **XRP-GBP** | **£6.1** (£2.2 a day in the tight hours, £0.60 an hour in the wide ones); £8.5 at £1,200 | **0.000** | **+£2.87** (£0.44 an hour) | a 1 s loop, 800 orders a day, coin carried (mean £67, max £616) | **clears the bar: paper test drafted (§7)** |
| 2 | the same | SOL-GBP | £1.07 | 0.12 | +£6.56 (£1.00 an hour) | as 1 | second arm of the paper test |
| 3 | (c) take a quote Binance has left 15 bps behind, close 5 min later | SUI-GBP (also SUI-USD, NEAR-USD) | wk 1 £1.9–3.6, wk 2 £48–53 (10-29's crash); SUI-USD £1.7–2.0 and £3.0–4.3, NEAR-USD £1.4–6.4 and £6.4–8.7 | not bootstrapped | no take | a 1 s Binance read and one IOC | positive both weeks on three books; its own study next (§4.3) |
| 4 | (c) the same | XRP-GBP | wk 1 £0 (no take), wk 2 £4.8–8.4 | | 4 takes (£2.2 a day's pace) | as 3 | only in the wide regime |
| 5 | (a) at the loop's minute | XRP-GBP | £0.65 | 0.34 | +£2.45 | today's loop | no: the speed is the edge |
| 6 | (a) on the books still tight | ETH-GBP, BTC-GBP, BTC-USD, SOL-USD, XRP-USD, ETH-USD | −£3.3 to +£0.4 | 0.23–0.97 | −£4.7 to +£0.5 | | no |
| 7 | (a) on the other alt books | 16 books | −£3.3 to +£5.0 (QNT-USD +£5.0, P 0.12; AAVE-GBP +£3.3, P 0.20) | 0.025 (HYPE-GBP)–0.80 | SUI-GBP −£4.8, HYPE-GBP −£2.3 | | none clears; HYPE's and PEPE's fair is not usable |
| 8 | (b) (a) hedged at once as a Binance taker (10 bps) | 23 books; NEAR-USD | −£5.8 to −£0.1; NEAR-USD +£1.26 | 0.66–1.00; NEAR-USD 0.000 | | a Binance account usable from the UK, coin on both venues | no, but for NEAR-USD (86 bps wide): small, and the hedge venue is unverified |
| 9 | (d) quote only while the GBP stablecoin maker is away | XRP-GBP, SOL-GBP, ETH-GBP | −£0.3 to +£2.4 | 0.07–0.76 | | | no: the crypto layer is not switched with it |
| 10 | Kraken (80 bps taker) or Coinbase (≥ 40 bps, unconfirmed) as the hedge | | | | | | no, before any replay |

For scale: LIVE's rules, replayed on USDT-GBP at £600, earn about £0.9–2.9 a day with no coin risk (MAKER-ABSENT, paper).

**In five lines.** Revolut X's crypto majors were made tight by one fast layer that gave takers Binance's price within a few
bps, and it is withdrawing book by book (XRP-GBP since 10-28 16:00 UTC, SOL-GBP and ETH-GBP this morning), leaving slow
ladders 16–60 bps wide that take 7–60 s to follow Binance, and retail takers who pay that width and are not informed.
A 0 % maker 12 bps from Binance's second price on XRP-GBP earned £6.1 a day at £600 out of sample (P = 0.000, the only one of
24 books to clear, Bonferroni included) and +£2.87 in this morning's 6.6 fresh hours, with a pessimistic arbitrageur on.
At the loop's minute it earns almost nothing; hedged on Binance it loses (NEAR-USD aside, +£1.26); books still tight lose.
Next: a 28-day minute-batched paper replay on XRP-GBP and SOL-GBP (§7), and a study of taking SUI's and NEAR's stale ladders.

## 1. Data and method

- **Revolut X's tape**: every UK print of 24 books, 2026-10-17 00:00 → 10-31 00:00 UTC (`scripts/trades.py`, keyless
  `trades/all`, a day a window, 100 a page, `data/tape_<BOOK>.txt.gz`), and today's to 06:39 for twelve of them
  (`data/tape1031_*`). A print's side is the taker's (checked: in the poll, each buy printed at the ask read beside it).
  Prints of one millisecond and side are one taker order. The 10-20 06:00 → 16:35 halt (MAKER-OTHER-BOOKS §1.4) is left out.
- **The outside fair**: Binance's last trade of COIN-USDT in each second (`scripts/binance_1s.py`, data.binance.vision's daily
  one-second klines; today's from the public klines endpoint), × Coinbase's USDT-USD minute (MMCOMP's
  `mmcomp/data/other_cb_usdt_usd.txt.gz`), ÷ GBP/USD for a GBP book (Yahoo's minutes to 10-28 23:57, REVX-FAIR's
  `fair_price/data/fx.txt.gz`; then TrueFX's minutes from the production FX recorder, `data/fx_truefx_gbpusd.txt.gz`). A book
  sits a few bps off that (its basis, `basis_by_day` in `results/tape.json`); the replays use the trailing
  three hours' centre of the book's own prints before the second, so nothing is fitted to the future (−2.4 to +4.0 bps a day on
  the books with a usable fair). Binance's one-second
  data is not committed (16 coins × 15 days); the zips stay public and the script rebuilds it.
- **The poll** (`scripts/poll.py`, `data/poll_*.jsonl.gz`): 2026-10-31 05:03:55 → 06:38:23 UTC, a Saturday, 94.5 minutes, no
  error. One Revolut X request every 1.4 s (the public bucket is about a token a second; production reads from another
  address): SOL-GBP, XRP-GBP, ETH-GBP and PEPE-GBP every 7 s (810 reads each), twenty other books in rotation (33–34 reads
  each), and the 387 UK tickers every 42 s; beside it Binance's book ticker for 16 coins about every 2 s, Kraken's (GBP books,
  GBP/USD, USDT/USD) and Coinbase's USD tickers every 2 s.
- **SQL** (read-only, 2026-10-31 05:00–06:00 UTC): `fx_ticks`, `agent_maker_minutes`, `agent_maker_events` and `agent_basis`
  (the retired trend loop's own touch reads, every 5 minutes, to 10-29), each statement in the data file it filled.
- **The replay** (`scripts/replay.py`): every second it holds a bid at fair × (1 − d − k) and an ask at fair × (1 + d − k),
  k = κ·d × (inventory ÷ capital), with the fair of the second before (one second of latency); a side is re-priced when the
  fair has moved θ bps from the price it was set at, or after a fill (U = 1), or only at each minute (U = 60: the loop as it
  runs). It is filled only by the public takers: a taker buy fills our ask when the ask is below the first price it paid
  (we would have been first in the book), else by the part it paid above our ask; never more than the order, at our price.
  Capital is cash; it buys first and sells only what it bought (target 0); a quote is £200 at £600 of capital. Each placed
  side is an order; a day's 950 spent, nothing rests until midnight. The **arbitrageur** (on in every headline figure) takes
  the whole of any of our quotes that sits more than 10 bps beyond the true fair of the second, at once. P&L is marked to
  the fair; P(mean ≤ 0) is a circular block bootstrap of the hourly P&L, 12-hour blocks (3-hour on today's 6.6 hours).
  `scripts/best.py` chooses d × θ × κ on the first week and reads the second; `scripts/today.py` reads today.

## 2. The books (Q1)

| book | prints/day | $ volume/day (median day) | order $ p50 / p90 | taker buys | paid over fair, bps (eff. half-spread) | inner on / off | taker gain 1s/5s/30s/300s | picks >9 bps $/day (age p50 s) | visible spread now | depth ±25 bps $ (bid/ask) | mid follows half a move, s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BTC-GBP | 1369 | 2,618,494 (2,366,523) | 68.0 / 6,055.7 | 58% | 1.0 | 0.7 / 0.7 | -0.35 / -0.21 / -0.23 / -0.05 | 13.09 (200) | 5.1 | [1284087, 1288979] | 0.0 (1) |
| BTC-USD | 1323 | 1,981,717 (2,222,914) | 5.5 / 4,018.0 | 39% | 0.5 | 0.4 / 0.7 | 0.04 / 0.24 / 0.35 / 0.56 | 1.66 (112) | 5.9 | [9307576, 14371683] | 0.0 (1) |
| ETH-GBP | 716 | 1,264,917 (1,164,863) | 13.4 / 7,081.7 | 61% | 2.0 | 1.9 / 2.2 | -1.48 / -1.44 / -1.71 / -1.84 | 12.28 (61) | 16.1 | [1205178, 91429] | 21.0 (6) |
| ETH-USD | 776 | 793,562 (750,852) | 0.1 / 4,453.6 | 56% | 0.9 | 0.8 / 1.2 | -0.51 / -0.46 / -0.65 / -0.7 | 4.14 (2) | 10.1 | [8419181, 8446076] | None (0) |
| XRP-GBP | 819 | 787,398 (834,503) | 32.3 / 1,337.5 | 64% | 3.7 | 3.4 / 17.3 | -5.08 / -5.11 / -5.24 / -5.2 | 23.93 (114) | 57.0 | [0, 0] | 63.0 (9) |
| SOL-GBP | 805 | 774,951 (511,261) | 51.0 / 1,216.6 | 72% | 2.5 | 2.4 / 5.3 | -2.12 / -2.05 / -2.11 / -2.05 | 16.64 (57) | 33.9 | [85631, 514411] | 7.0 (37) |
| SOL-USD | 774 | 615,676 (327,331) | 0.1 / 1,493.1 | 57% | 1.7 | 1.8 / 2.0 | -1.35 / -1.33 / -1.5 / -1.42 | 4.66 (6) | 21.8 | [1033146, 1037545] | 0.0 (6) |
| QNT-USD | 708 | 605,807 (370,554) | 0.1 / 383.8 | 52% | 13.0 | 12.0 / 21.2 | -12.91 / -12.7 / -12.58 / -12.61 | 16.38 (28) | 64.4 | [0, 0] | 0.0 (14) |
| XRP-USD | 739 | 493,391 (442,342) | 0.1 / 1,326.2 | 54% | 2.5 | 2.4 / 2.6 | -2.24 / -2.17 / -2.1 / -2.33 | 0.15 (4) | 14.5 | [96204, 555526] | None (0) |
| PEPE-GBP | 569 | 344,872 (307,219) | 0.1 / 133.6 | 51% | 7.2 | 6.6 / 27.8 | -8.86 / -8.78 / -8.92 / -8.56 | 38.59 (7) | 61.3 | [0, 0] | 28.0 (55) |
| AVAX-GBP | 572 | 248,984 (124,916) | 0.1 / 0.1 | 51% | 6.0 | 5.5 / 23.5 | -6.92 / -6.91 / -7.03 / -7.23 | 20.43 (39) | 25.2 | [84, 19459] | 0.0 (7) |
| NEAR-USD | 605 | 184,193 (182,771) | 0.1 / 27.1 | 52% | 36.6 | 36.8 / 33.9 | -34.5 / -34.41 / -34.33 / -34.15 | 66.13 (104) | 86.6 | [0, 0] | 0.0 (8) |
| SUI-GBP | 568 | 175,351 (130,733) | 0.1 / 133.8 | 53% | 12.2 | 12.1 / 30.0 | -11.21 / -11.09 / -11.03 / -10.72 | 149.61 (90) | 23.9 | [84, 11300] | 0.0 (7) |
| PEPE-USD | 637 | 131,099 (89,884) | 0.1 / 109.7 | 52% | 5.5 | 5.4 / 9.5 | -5.9 / -5.65 / -5.38 / -5.69 | 15.54 (6) | 20.1 | [14968, 65040] | 0.0 (12) |
| HYPE-USD | 581 | 123,763 (37,215) | 0.1 / 72.3 | 52% | 11.8 | 12.0 / 8.2 | -11.29 / -11.25 / -11.27 / -11.37 | 6.72 (186) | 25.8 | [19658, 133586] | 0.0 (8) |
| SUI-USD | 272 | 116,069 (97,064) | 0.1 / 504.5 | 56% | 10.8 | 10.8 / 2.0 | -9.6 / -9.6 / -9.79 / -9.08 | 15.99 (137) | 22.3 | [2749, 11301] | 0.0 (10) |
| LINK-GBP | 561 | 76,477 (27,134) | 0.1 / 6.7 | 53% | 5.5 | 5.3 / 24.3 | -6.95 / -6.94 / -6.86 / -6.86 | 10.24 (28) | 71.0 | [0, 0] | 168.0 (6) |
| HYPE-GBP | 576 | 58,057 (25,838) | 0.1 / 1.3 | 52% | 25.7 | 25.8 / 20.5 | -24.12 / -24.15 / -24.04 / -24.4 | 15.95 (163) | 47.2 | [489, 2779] | 0.0 (11) |
| LINK-USD | 618 | 51,222 (19,352) | 0.1 / 2.3 | 53% | 4.0 | 3.9 / 8.3 | -4.26 / -4.21 / -4.09 / -4.12 | 1.73 (50) | 47.3 | [49364, 49613] | 0.0 (7) |
| DOGE-GBP | 560 | 47,236 (40,630) | 0.1 / 0.1 | 52% | 4.8 | 4.6 / 9.0 | -5.23 / -5.23 / -5.32 / -5.13 | 0.21 (6) | 32.0 | [300172, 25626] | None (0) |
| BCH-GBP | 578 | 31,051 (31,119) | 0.1 / 0.1 | 51% | 11.1 | 10.7 / 24.2 | -11.49 / -11.47 / -11.53 / -11.58 | 7.32 (53) | 27.8 | [84, 6317] | 0.0 (3) |
| ADA-GBP | 549 | 30,225 (21,719) | 0.1 / 2.7 | 53% | 5.4 | 4.8 / 23.2 | -6.52 / -6.54 / -6.54 / -6.6 | 0.66 (36) | 29.8 | [337, 1207] | 0.0 (11) |
| AAVE-GBP | 576 | 29,306 (29,107) | 0.1 / 0.1 | 50% | 3.6 | 3.6 / 11.2 | -4.21 / -4.22 / -4.17 / -4.26 | 1.06 (18) | 38.6 | [16718, 16784] | 0.0 (10) |
| XLM-USD | 592 | 28,961 (22,966) | 0.1 / 0.1 | 52% | 4.2 | 4.1 / 4.8 | -4.33 / -4.32 / -4.26 / -4.27 | 0.11 (38) | 26.0 | [65128, 15178] | 0.0 (6) |

Columns: prints and dollar volume a day over the 14 days (the median day in brackets); a taker order's size; the share of
taker orders that bought; what takers paid over the basis-corrected fair (the effective half-spread), in hours the
stablecoin maker was on and off USDT-GBP (`scripts/inner.py`); the taker's gain against the fair 1, 5, 30 and 300 s later
(negative: the taker lost, the maker gained); the picks: taker orders that beat the fair by more than the 9 bps fee, their
dollar gain over the fee a day and how many seconds before the outside price had stood at their price; this morning's
visible spread, the depth within 25 bps of its mid, and how long the mid took to follow half of a 5 bps outside move
(events in brackets). HYPE's Binance price is not Revolut X's reference (its takers "pay" 24 bps and its picks never
converge on Revolut X), and Binance's PEPE tick is 20 bps: both books' fair-based columns are not evidence.

### 2.1 One fast layer made the majors tight, and it is leaving

- **The prints.** On every major book, through 10-28, takers paid a median 0.5–4 bps over the fair, with orders of $13–68 at
  the median on the GBP majors (the USD books' median print is a $0.10 dust print, MMCOMP's bot) and $1.2–7k at the 90th
  percentile; 39–72 % of them bought. The loop's touch reads agree (`agent_basis`,
  `data/agent_basis_spreads.json`): BTC-USD's daily median spread 1.4–2.6 bps every day from 10-01 to 10-28, ETH-USD 1.6–2.4,
  SOL-USD 3.0–4.3, AVAX-USD 8.9–10.2, SUI-USD 20–23.
- **Not the stablecoin maker's switch.** In the 673 five-minute reads from 10-01 when the GBP stablecoin maker was away from
  USDT-GBP, those spreads were unchanged (BTC-USD 1.5 against 1.6 bps, SOL-USD 3.9 against 3.7). On the GBP books the
  effective half-spread rose in its absent hours (XRP-GBP 3.4 → 17.3 bps, SOL-GBP 2.4 → 5.3, `results/inner.json`), but the
  15 absent hours of the tape are nearly all 10-29 21:17 → 10-30 11:06, when XRP-GBP had been wide since 10-28 16:00: the
  timing does not match. Quoting only while it is away (method d, `scripts/absence.py`) earns −£0.3 to +£2.4 a day.
- **The withdrawal.** XRP-GBP's takers paid a median 3–5 bps an hour on 10-28 to 15:00, 13–16 bps from 16:00, a daily median
  of 15 and 17 bps on 10-29 and 10-30, and 18–31 bps an hour today. SOL-GBP's 90th percentile widened on 10-29/30 (to 10 bps);
  today its hourly median is 7–14 bps from 01:00 (3.8 bps 00:00–00:59), ETH-GBP's 6–10 bps from 03:00. The USD majors were
  tight to 10-30 (a median 0.4–2.6 bps with the stablecoin maker on and off alike) and are visibly wider this morning (§2's
  table), their prints still near the fair.
- **What is left.** The visible ladders (MAKER-OTHER-BOOKS §2.1's families) are slow. Against the fair, the poll's mid
  regressed on the outside move of the last k seconds has a slope of −0.77 to −0.88 on XRP-GBP for every k from 5 to 60 s
  (it had not moved at all), −0.62 → −0.24 on SOL-GBP from 5 to 60 s, about 0 on ETH-GBP (`results/poll.json`). Nothing in the
  94 minutes sat 9 bps or more beyond the fair on the four focus books (HYPE-GBP 3 of 34 reads): on a quiet Saturday morning
  there was no lag arbitrage to take.

### 2.2 Adverse selection: none to speak of

A maker's fill is a taker's order with the sign turned. On every book with a usable fair but BTC-USD the takers lost to the
fair and kept losing: Binance moved their way by at most 0.5 bps in the next second and 0.8 bps in the next 300 s
(`markout_taker_gain_mean`, `move_after_mean`, `results/tape.json`). BTC-USD's takers are the one sign of information (+0.04 bps
after 1 s, +0.56 after 300 s), and, weighted by size, SOL-GBP's largest orders (+0.8 bps after 300 s against −2.9 at the print). The replay's own fills say the same: XRP-GBP's maker
edge is +8.1 bps at the fill and +7.3 bps after 300 s; today +11.8 and +11.3.

## 3. Risk (Q3)

| coin | sd 1 min bps | 1 h | 1 day | worst hour bps | worst day bps | £300 worst hour / day |
|---|---|---|---|---|---|---|
| AAVE | 11.5 | 88.12 | 349.27 | -650.8 | -1190.9 | 18.9 / 33.68 |
| ADA | 10.07 | 72.42 | 279.6 | -663.5 | -918.5 | 19.26 / 26.33 |
| AVAX | 9.76 | 75.95 | 261.48 | -599.4 | -862.4 | 17.45 / 24.79 |
| BCH | 10.32 | 79.96 | 267.52 | -584.5 | -839.7 | 17.03 / 24.16 |
| BTC | 4.75 | 35.28 | 159.88 | -292.7 | -534.9 | 8.65 / 15.62 |
| DOGE | 8.04 | 59.95 | 222.7 | -557.1 | -671.3 | 16.26 / 19.48 |
| ETH | 6.97 | 49.9 | 174.02 | -391.6 | -622.1 | 11.52 / 18.09 |
| HYPE | 10.74 | 85.83 | 327.33 | -381.2 | -551.6 | 11.22 / 16.1 |
| LINK | 9.45 | 72.85 | 336.7 | -618.3 | -1131.6 | 17.99 / 32.1 |
| NEAR | 16.2 | 117.93 | 546.29 | -579.2 | -1561.9 | 16.88 / 43.38 |
| PEPE | 23.65 | 142.01 | 550.48 | -1102.8 | -1440.1 | 31.33 / 40.24 |
| QNT | 16.49 | 114.97 | 490.44 | -537.6 | -1149.5 | 15.7 / 32.58 |
| SOL | 7.74 | 56.58 | 213.32 | -460.9 | -793.9 | 13.51 / 22.9 |
| SUI | 11.04 | 80.35 | 314.05 | -675.8 | -938.5 | 19.6 / 26.87 |
| XLM | 8.46 | 60.64 | 231.8 | -459.0 | -673.5 | 13.46 / 19.54 |
| XRP | 7.62 | 53.99 | 251.55 | -434.1 | -757.1 | 12.75 / 21.87 |

Binance's one-second closes, 10-17 → 10-31 (`scripts/risk.py`, `results/risk.json`); PEPE's figures carry its 20 bps tick.
10-29 was a sell-off (XRP −7.4 %, SOL −7.4 %, ETH −5.2 % on the day). A maker that sells only what it bought carries coin
only between fills: XRP-GBP's held a mean £67 (max £616, the cap) out of sample, its worst hour −£1.95 and worst day −£0.07;
at £1,200 the mean was £174, worst hour −£5.64 and day −£1.26. Today the books that lost did so on inventory, with positive
markouts: SOL-USD −£4.73 (worst hour −£3.68), SUI-GBP −£4.79, HYPE-GBP −£2.30. The cap is the stop: no bid rests while the
coin is worth the capital, and the skew lowers the ask toward the fair as the coin grows. A hard stop would sell on
Revolut X as a taker: 9 bps plus the 1–3 bps a selling taker pays against the fair (tape), about £0.7 on a full £600, before
any gap; at the worst rolling hour of these two weeks (XRP −4.3 %) a full £600 of XRP loses about £26.

## 4. The methods (Q2, Q4)

| book | chosen in-sample (d, theta, kappa) | out £/day £600 | P(<=0) | £1,200 | minute loop | no arb | half fills | Binance hedge | tight £/day | wide £/hour | orders/day | fills/day | inventory mean / max £ | 10-31 £/hour (600) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AAVE-GBP | 12, 8, 0.5 | 3.347 | 0.1985 | 7.002 | -10.417 | 2.217 | 3.496 | -1.646 | -1.063 | 1.099 | 950.9 | 14.0 | 204.9 / 415.8 | None |
| ADA-GBP | 20, 8, 0.5 | -3.337 | 0.6993 | -8.075 | -3.564 | -3.035 | -4.036 | -0.101 | 0.0 | -0.417 | 937.8 | 5.0 | 45.2 / 417.2 | None |
| AVAX-GBP | 16, 15, 0.5 | -0.206 | 0.544 | -1.482 | -3.211 | -1.347 | -0.977 | -1.331 | 1.285 | -0.136 | 742.7 | 81.8 | 182.9 / 600.5 | -0.002 |
| BCH-GBP | 25, 8, 0.5 | 1.898 | 0.2042 | 3.714 | -4.612 | 0.007 | 1.862 | -0.723 | -3.261 | 0.083 | 950.6 | 13.3 | 166.6 / 408.8 | None |
| BTC-GBP | 12, 8, 0.5 | 0.376 | 0.3912 | 0.946 | -1.81 | 0.896 | 0.473 | -0.483 | 0.355 | 0.162 | 635.2 | 8.7 | 191.0 / 602.6 | 0.047 |
| BTC-USD | 16, 15, 1.0 | 0.407 | 0.232 | 0.425 | -0.47 | 0.407 | 0.213 | -0.885 | 0.406 | None | 232.1 | 7.9 | 26.9 / 237.2 | -0.0 |
| DOGE-GBP | 25, 8, 0.5 | 0.669 | 0.3525 | 1.333 | -3.989 | 0.002 | 0.666 | -0.093 | -1.041 | 0.369 | 950.5 | 1.4 | 187.1 / 213.2 | None |
| ETH-GBP | 12, 10, 0.5 | -0.363 | 0.6095 | -0.894 | -3.173 | 1.324 | -0.452 | -1.753 | -0.363 | -0.017 | 729.9 | 17.2 | 84.3 / 400.0 | 0.069 |
| ETH-USD | 8, 10, 0.5 | -3.265 | 0.9653 | -4.661 | -3.766 | -1.203 | -2.331 | -5.032 | -3.266 | None | 773.4 | 49.0 | 130.3 / 404.8 | 0.0 |
| HYPE-GBP | 20, 15, 0.5 | 3.177 | 0.0248 | 4.334 | 0.441 | 7.584 | 0.891 | -0.537 | 25.252 | 0.116 | 950.5 | 250.4 | 124.4 / 478.6 | -0.347 |
| HYPE-USD | 12, 10, 0.5 | 1.682 | 0.2938 | 2.904 | 1.165 | 4.336 | -0.022 | -3.175 | 26.027 | -0.059 | 951.0 | 141.9 | 117.4 / 600.5 | None |
| LINK-GBP | 5, 8, 0.5 | -2.553 | 0.769 | -1.238 | -14.047 | 2.553 | -0.756 | -5.437 | -3.045 | -0.036 | 950.8 | 137.8 | 148.8 / 493.1 | None |
| LINK-USD | 12, 10, 0.5 | -3.0 | 0.788 | -8.049 | -5.952 | -2.043 | -4.033 | -2.545 | -1.607 | -0.61 | 939.3 | 23.3 | 124.0 / 403.0 | None |
| NEAR-USD | 25, 10, 1.0 | -1.568 | 0.7017 | -2.843 | -6.64 | -4.147 | -1.206 | 1.26 | -0.154 | -0.066 | 950.8 | 126.9 | 113.7 / 400.8 | None |
| PEPE-GBP | 25, 8, 0.5 | 2.413 | 0.448 | 1.588 | -18.16 | 0.977 | 0.794 | -3.227 | 12.761 | -0.461 | 950.6 | 11.9 | 156.7 / 661.7 | 0.641 |
| PEPE-USD | 25, 8, 0.5 | -0.716 | 0.5833 | -11.135 | -20.011 | 6.498 | -5.567 | -3.187 | -8.841 | 0.983 | 950.8 | 8.9 | 222.7 / 423.7 | None |
| QNT-USD | 25, 8, 0.5 | 4.982 | 0.1182 | 10.214 | -2.442 | -2.24 | 5.107 | -0.469 | 3.131 | 0.209 | 950.6 | 7.0 | 150.6 / 240.2 | None |
| SOL-GBP | 12, 10, 0.5 | 1.069 | 0.1217 | 1.558 | -3.94 | 0.908 | 0.779 | -1.745 | 0.981 | 0.164 | 789.8 | 16.2 | 42.0 / 280.6 | 0.997 |
| SOL-USD | 8, 8, 1.0 | -0.603 | 0.684 | -1.355 | -7.035 | 0.45 | -0.671 | -3.04 | -0.602 | None | 879.6 | 28.7 | 33.7 / 244.0 | -0.717 |
| SUI-GBP | 16, 15, 0.5 | 1.721 | 0.2008 | 1.371 | -4.989 | 0.566 | 0.69 | -3.111 | -44.318 | 0.193 | 868.9 | 115.8 | 71.5 / 532.7 | -0.72 |
| SUI-USD | 20, 15, 1.0 | 2.017 | 0.1338 | -1.902 | -4.551 | 2.563 | -0.965 | -1.007 | -1.606 | 0.218 | 752.2 | 18.6 | 101.3 / 405.1 | None |
| XLM-USD | 12, 10, 1.0 | -1.315 | 0.8045 | -2.701 | -5.885 | -0.272 | -0.848 | -1.175 | -1.188 | -0.097 | 930.9 | 29.7 | 85.0 / 204.7 | None |
| XRP-GBP | 12, 10, 0.5 | 6.1 | 0.0 | 8.498 | 0.654 | 6.591 | 4.249 | -1.162 | 2.17 | 0.6 | 800.7 | 75.8 | 66.9 / 616.3 | 0.436 |
| XRP-USD | 5, 8, 1.0 | -2.98 | 0.958 | -5.901 | -7.89 | -0.634 | -2.743 | -5.834 | -2.983 | None | 950.8 | 102.8 | 61.1 / 578.8 | -0.275 |

### 4.1 (a) the maker

The headline cell on XRP-GBP: d = 12 bps, θ = 10 bps, κ = 0.5, the best of 36 cells on the first week (+£2.46 a day there).
Out of sample: +£6.10 a day at £600, 75.8 fills and 801 orders a day, P(mean ≤ 0) = 0.000 over 168 hours; the 114 tight hours
earned £10.31 (£2.17 a day, P = 0.002) and the 54 wide ones £32.39. Robustness, all on the out-of-sample week at £600:
without the arbitrageur +£6.59; with half of every eligible fill (queue, a competitor) +£4.25; with two of Davies'
sub-accounts (1,900 orders) +£8.62; at the loop's minute +£0.65 (P = 0.34: stale quotes, 113 arbitrage fills); hedged on
Binance −£1.16. At d = 8 and 16 the week was +£10.2 and +£11.8 (θ = 15, no order budget), so 12 bps is not a knife-edge. Of the 24 books'
makers it is the only one under P = 0.10 with a usable fair (HYPE-GBP's 0.025 rests on a Binance price that is not Revolut
X's reference); with 24 books, chance gives about 2.4 such, so the bar that matters is Bonferroni's 0.004, which it clears
(0 of 4,000 resamples ≤ 0).
Days: +4.35, +2.64, −0.07, +2.39, +4.57, +13.91, +14.92.

SOL-GBP (same cell): +£1.07 a day, P = 0.12, 16 fills a day; today +£6.56 in 6.6 hours as its layer left. Every book whose
layer stayed lost or broke even (ETH-USD −£3.27, XRP-USD −£2.98, SOL-USD −£0.60, ETH-GBP −£0.36, BTC-GBP +£0.38).

What the replay cannot see: whether takers would trade more against a tighter quote (fewer fills assumed, not more),
whether the slow ladders would re-price against us, and whether the fast layer comes back. It also assumes our order rests
at once and that Revolut X counts only placements toward 1,000 a day.

### 4.2 (b) hedging every fill

Binance at 10 bps a side (Davies' tier, reference §3.22; 7.5 with BNB; whether his UK account may still trade there is not
checked) costs more than the 8–12 bps a fill earns on 23 books: −£0.1 to −£5.8 a day (XRP-GBP −£1.2). The exception is NEAR-USD,
86 bps wide, whose takers pay 34 bps over the fair: hedged, its in-sample cell (d = 25 bps) earned +£1.26 a day out of sample
(P = 0.000), unhedged −£1.57 (the coin fell while held). Small, one book, and it needs coin on two venues. Kraken's 80 bps taker and
Coinbase's (not confirmed for this account; MAKER-OTHER-BOOKS put it at 40–60 bps) are out before any replay.

### 4.3 (c) taking the stale ladder

`scripts/stale.py`: a public taker order that beat the fair by more than T bps proves a stale quote stood there; we take it
L seconds after its stale run began (if before that taker did), at the 9 bps fee, and close it 5 minutes later, as a taker
(9 + 2.5 bps) or at Revolut X's own later mid (the check that our fair is not wrong). T15, L1, £600 a take:

| book | take T15 L1 H300 £600: week 1 at take / RX-mid exit / taker exit | week 2 | 10-31 |
|---|---|---|---|
| AAVE-GBP | 1 takes: 0.0 / -0.0 / -0.0 | 2 takes: 0.0 / 0.0 / 0.0 | - |
| ADA-GBP | 0 takes: None / None / None | 21 takes: 0.516 / 2.712 / 3.949 | - |
| AVAX-GBP | 1 takes: 0.006 / None / 0.034 | 23 takes: 0.746 / -0.219 / -0.823 | - |
| BCH-GBP | 1 takes: 0.098 / 0.508 / 0.357 | 22 takes: 1.089 / 0.849 / 0.526 | - |
| BTC-GBP | 9 takes: 0.321 / -0.15 / -0.185 | 1 takes: 0.055 / -0.073 / -0.036 | - |
| BTC-USD | 35 takes: 1.969 / -0.464 / 1.128 | 1 takes: 0.001 / 0.002 / 0.001 | - |
| ETH-GBP | 2 takes: 0.151 / 0.284 / 0.179 | 4 takes: 0.545 / 0.265 / 1.865 | - |
| ETH-USD | 0 takes: None / None / None | 2 takes: 0.226 / 0.019 / -0.084 | - |
| HYPE-GBP | 38 takes: 0.561 / 0.497 / 1.316 | 136 takes: 4.048 / 5.011 / 6.385 | 26 takes: 28.462 / 8.18 / 23.653 |
| HYPE-USD | 38 takes: 0.827 / 0.945 / 1.049 | 42 takes: 0.825 / 0.925 / -0.546 | - |
| LINK-GBP | 14 takes: 0.725 / -0.539 / -1.761 | 18 takes: 0.804 / 1.107 / -0.022 | - |
| LINK-USD | 1 takes: 0.023 / -0.174 / -0.196 | 3 takes: 0.119 / 0.503 / 0.244 | - |
| NEAR-USD | 72 takes: 4.009 / 1.413 / 6.421 | 104 takes: 3.24 / 8.738 / 6.403 | - |
| PEPE-GBP | 101 takes: 1.18 / -0.162 / -0.158 | 157 takes: 6.183 / -0.711 / 10.849 | 3 takes: 0.002 / -0.005 / -0.0 |
| PEPE-USD | 126 takes: 1.102 / -3.833 / -3.71 | 194 takes: 10.593 / 6.501 / 18.869 | - |
| QNT-USD | 23 takes: 1.736 / -0.975 / -2.137 | 38 takes: 4.789 / 2.201 / 1.316 | - |
| SOL-GBP | 3 takes: 0.15 / -0.385 / -0.185 | 30 takes: 1.635 / -4.461 / -10.302 | 1 takes: 0.162 / None / 0.373 |
| SOL-USD | 0 takes: None / None / None | 2 takes: 0.104 / 0.0 / 1.151 | 5 takes: 7.989 / -0.134 / -20.842 |
| SUI-GBP | 149 takes: 5.633 / 3.596 / 1.886 | 205 takes: 11.602 / 48.502 / 53.395 | - |
| SUI-USD | 77 takes: 1.968 / 1.775 / 1.694 | 87 takes: 4.024 / 2.993 / 4.33 | - |
| XLM-USD | 0 takes: None / None / None | 1 takes: 0.031 / 0.045 / 0.02 | - |
| XRP-GBP | 0 takes: None / None / None | 157 takes: 5.674 / 8.405 / 4.793 | 4 takes: 1.573 / 5.483 / 2.245 |
| XRP-USD | 0 takes: None / None / None | 1 takes: 0.019 / -0.003 / -0.031 | - |

SUI-GBP, SUI-USD and NEAR-USD pay in both weeks, by the taker exit and by Revolut X's own later mid: SUI-GBP's ladder is taken
stale a median 90 s after Binance moved, $150 a day over the fee by the takers who do it, and a 1 s taker would have been
first in 149 (week 1) and 205 (week 2) of those. XRP-GBP pays only in its wide week (157 takes, £4.8–8.4 a day). BTC-USD's
35 week-1 takes lost at Revolut X's later mid. PEPE's and HYPE's rows rest on a fair that is not usable. On SOL-GBP the later Revolut X mid went against the takes (−13 bps): its "stale" quotes
were often right. A take needs Binance at 1 s and one IOC, no book read; it is the next study, not a pre-registration here.

### 4.4 Speed (Q4)

pg_cron at 1 s is enough: the edge comes from re-pricing within a second or two of Binance, while the takers who pick the
ladders wait a median 36–200 s. At the minute the maker's quotes are the stale ones (XRP-GBP +£0.65 a day, 113 arbitrage
fills; SOL-GBP −£3.94). A Worker would add little the replay can price (it is built on one-second data), but it would read
Binance without Supabase's isolate start. The binding limits are the 1,000 orders a day per account (one per 86 s on
average) and the public Revolut X bucket (a token a second for the whole project address: a 1 s reader of one book would
starve the recorder and PR5's reads). A live version would read Binance's book ticker every second and its own orders from
the private API, never the public book.

## 5. Per day at £600 and £1,200 (Q4)

XRP-GBP's maker: £6.1 and £8.5 a day out of sample; £2.2 and £2.8 a day in hours the fast layer was there; today £0.44 and
£0.65 an hour. SOL-GBP's: £1.1 and £1.6 a day; today £1.00 and £1.36 an hour. LIVE's rules replayed on USDT-GBP: £0.9–2.9 a day at £600 (MAKER-ABSENT, paper), no coin carried.

## 6. Not checked

- Who the fast layer is, why it is leaving, and whether it comes back (the paper test's regime column will say).
- How the slow ladders would react to a quote inside them; whether takers trade more against a tighter book.
- Whether Revolut X counts cancels toward 1,000 a day; the private API's rate limit for a 1 s loop.
- Whether Davies' Binance account may trade from the UK; Coinbase's crypto taker fee for his account.
- HYPE and PEPE against a better fair (Hyperliquid's own price; a finer PEPE quote).
- The stale take beyond the tape's evidence: stale quotes nobody took are not in it (more takes), quotes repriced before
  their run began are (fewer); overlapping takes were not netted against the capital.
- The 363 books beyond the 24 with a tape: only the tickers' spread and 24-hour volume (`results/poll.json`).

## 7. Pre-registration draft: "Crypto quotes XRP/GBP" (paper)

**Status: DRAFT, superseded** by `reviews/2026-10-31-xrp-gbp-strategy.md` §8 (the same day: the rule card's numbers, the
regime column and the bar changed there). Kept as written.

1. **What it tests.** Whether method (a) on XRP-GBP earns on live data it has not seen, and how much of that needs the fast
   layer to be away. SOL-GBP runs beside it as a second book, judged apart.
2. **The rule** (`backtests/cryptobooks/scripts/replay.py`'s `run`, at its sha in `MANIFEST.json`): fair = Binance's last trade
   of COIN-USDT in the second before × Coinbase's USDT-USD minute ÷ GBP/USD (the production FX recorder's TrueFX read, its
   fallbacks as `cb_fx.ts` has them) × exp(the trailing three hours' centre of the book's own prints); d = 12 bps, θ = 10 bps,
   κ = 0.5, £200 a quote, £600 of capital a book in cash, target 0, the arbitrageur on (10 bps), 950 orders a day.
3. **How it runs without a 1 s loop.** One call a minute (a row of `edge_calls`, under the watchdog) reads each book's public
   trades since its last read (`trades/all`, one request a book) and Binance's one-second klines for the last 120 s (one a
   coin), and steps the replay through the closed minute, second by second, writing fills, orders and the hour's P&L to its
   own tables. It is the replay on tomorrow's data; it does not test queue position or anyone's reaction.
4. **Window.** 28 days from the first 00:00 UTC after it first runs.
5. **The bar.** XRP-GBP PASSES when its 28-day sum > 0, the circular 3-day block bootstrap of the daily mean (10,000
   resamples, `random.Random(20261031)`) gives P(mean ≤ 0) < 0.10, and it has at least 300 fills. SOL-GBP is read the same way.
6. **Also reported, not judged.** Each hour's regime (takers' median paid over the fair ≥ 8 bps: wide); the minute-loop arm
   (U = 60) on the same data; orders a day; inventory mean and max; markouts at 1/5/30/300 s; the arbitrage fills.
7. **Void** if Binance's or Revolut X's public data is missing for more than 10 % of the window's minutes, or Revolut X halts
   for more than a day; the window then restarts.
8. **What a pass would lead to.** A live design for Davies: a 1 s executor (pg_cron at 1 s or a Worker), a sub-account of his
   own for it alone (never the loop's or PR5's), post-only orders, the cap as the stop, its own dead-man. Nothing goes live
   without his word.

## 8. Sources

- Revolut X keyless public endpoints, UK region: `/api/1.0/public/trades/all` (24 books, 10-17 → 10-31, and today),
  `/api/2.0/public/order-book/{SYM}?region=UK&limit=50`, `/api/1.0/public/tickers?region=UK`, `/api/1.0/public/configuration/pairs`.
- Binance: `data.binance.vision/data/spot/daily/klines/{COIN}USDT/1s/`, `data-api.binance.vision/api/v3/klines?interval=1s`,
  `/api/v3/ticker/bookTicker`. Kraken `/0/public/Ticker`. Coinbase Exchange `/products/{P}/ticker`.
- SQL (read-only, Supabase flmvxigozjuizpckllvk, 2026-10-31): `fx_ticks`, `agent_maker_minutes`, `agent_maker_events`,
  `agent_basis`; the statements of `data/maker_events.json` and `data/agent_basis_spreads.json` are in those files; GBP/USD is
  `select string_agg((extract(epoch from minute)*1000)::bigint || '|' || round((mid[array_length(mid,1)])::numeric,6), ',' order by minute) from fx_ticks where source='truefx' and pair='GBPUSD' and minute >= '2026-10-28 23:00' and array_length(mid,1) > 0`
  (the mid is stored × 10⁶; the minute's last read); the hourly presence is
  `select date_trunc('hour', minute), avg(case when present <> 'none' then 1 else 0 end) from agent_maker_minutes where book = 'USDT-GBP' and minute >= '2026-10-17' group by 1`.
- Committed inputs of other studies: `fair_price/data/fx.txt.gz` (REVX-FAIR), `mmcomp/data/other_cb_usdt_usd.txt.gz` (MMCOMP).
