# MAKER-OTHER-BOOKS: which other Revolut X books the GBP stablecoin maker makes, and whether there is room for us (2026-10-31)

Davies, 2026-10-31: "你可以研究下这个做市商除了gbp/usdc和usdt以外还做哪些盘吗？我们有没有机会？" and, while it ran: "不一定是我们现在的方法，别的有用的
方法也行" (any useful method, not only ours), with the 1,000 orders a day counted per account or sub-account: one more sub-account
of his own is a cost, not a wall.

**Research only, not blind.** Every record was read. Nothing in production changed: no order, config, migration, executor or
frozen file. Public market data only (keyless GETs) and read-only SQL. No balance of Davies' accounts appears; every dollar or
pound below is a replay's (paper) or a public market figure. Scripts, inputs and results: `docs/agents/backtests/mmcomp/`
(`scripts/other_books_*.py`, `data/other_*`, `results/other_*.json`). Follows `reviews/2026-10-30-revx-mm-competition.md`
(MMCOMP) and `reviews/2026-10-30-maker-absent.md`.

## 0. Answers first

**1. Which books it makes.** The maker the watch follows (one order of about $5,000 near the touch, both sides) is one
algorithm across all of Revolut X's stablecoin books:

| book | region | evidence | strength |
|---|---|---|---|
| USDT-GBP, USDC-GBP | UK | the watch (MMCOMP) | known |
| **USDT-USD** | UK | the very same order quantity, to the last decimal, at the same minutes as USDT-GBP; gone in the same minute in the four long absences, back in the same minute in the three that ended; its width moved to the same number of bps in the same half-hour on 10-13 and 10-28 | **certain** |
| **USDC-USD** | UK | the same, against USDC-GBP | **certain** |
| **USDC-EUR** | EEA | its deep ladder holds the exact quantities of USDC-GBP's and USDC-USD's (100,051.27875; 300,153.83625; 600,307.6725; 1,000,512.7875 USDC) | strong; its near-touch order not seen (the maker was away all through the poll) |
| SOL-GBP, SOL-USD (and other crypto books) | UK | a $5,000 order built the same way (the coin's dollar price; the same quantity on the GBP and USD book), but it kept quoting through the stablecoin maker's 10-29/30 absence and through today's | **not shown**: the same kind of engine, maybe the same firm, a different switch |

There is no USDT or other stablecoin book against EUR in either region, and every EUR book is EEA-only (reference §4.14), so
the UK books it makes are exactly the four the recorder already records.

**2. Is there an opportunity for us? Not a new one.** Ranked by what the data say (paper, before any transfer cost):

| # | method | book | paper result | verdict |
|---|---|---|---|---|
| 1 | what we already run: LIVE's rules | USDT-GBP | ~£0.9–1.1 a day at £600 with the maker there, £2.9 while it is away (MAKER-ABSENT) | keep; nothing below beats it |
| 2 | MMCOMP's A: rest inside the touch on Revolut X, close at once elsewhere | USDC-USD (close at par through Coinbase) | **$1.6–1.8 a day at $100 a fill, $7.1–7.9 at $500**, positive on every day with a fill (30–34 of 34), 6–12 bps a fill; but one-sided: $800–5,000 of USDC a day piles up on Revolut X | paper only, after A on the GBP books, and only if transfers are cheap |
| 3 | the same | USDT-USD (close on Coinbase USDT-USD) | $1.0 a day at $100, $3.5–3.6 at $500, 34 of 34 days, 4–6 bps a fill; $950–4,000 of USDT a day to move | as 2, smaller |
| 4 | LIVE's rules on the USD books | USDT-USD, USDC-USD | **$0.02–0.06 a day at $600** (0.4–0.9 bps of capital a day, 10–23 round trips in 32 days); $1,200 no better per dollar | no: about 20–40 times less than USDT-GBP |
| 5 | one order a tick inside the maker | USD books | $0.002–0.04 a day at $100 | no |
| 6 | quote only while it is away | USD books | about $0 (its absences there are 45–49 hours in 32 days, few prints) | no |
| 7 | the cross-book loop GBP → USDT → USD → USDC → GBP inside Revolut X | four books | four taker legs cost 36 bps; the best loop beat that in 9 of 9,758 five-minute reads | no |
| 8 | GBP → USD through a stablecoin, back through Revolut's FX | USDT-GBP + USDT-USD | two taker legs (18 bps) beaten in 267 of 7,038 five-minute reads (3.8 %), USDC 1; it needs an FX leg at interbank to close, which depends on Davies' plan | no, as a strategy |
| 9 | quoting the crypto books it may make | SOL-GBP 33 bps, XRP-GBP 51, LINK-GBP 71 wide | not replayed: price risk on every held coin, and a hedge on Coinbase or Kraken costs about 40–60 bps a side for non-stable coins | not without its own study |

Orders a day, against one account's 1,000: LIVE's rules on a USD book about 5, an inside order 57–80, A about 100–150 (an
order a side re-priced with the touch, plus one Coinbase order a fill). None needs a further sub-account.

**3. One correction to the record.** The "absence" of 2026-10-20 06:06–16:34 UTC was a venue-wide halt, not the maker's choice:
no print on any Revolut X book we pulled (BTC-GBP, ETH-USD, LINK-GBP, SOL-GBP, SOL-USD, XRP-GBP, USDT-USD, USDC-USD) from
07:00 to 13:59 UTC in the venue's own public trade history, the £0.10 bot included (§1.4): trading stopped, or at least the
venue recorded none. MAKER-ABSENT's absences list counts it as one of the maker's.

**In five lines.** The maker is one algorithm on Revolut X's four UK stablecoin books (GBP and USD) and the EEA's USDC-EUR: the
same $5,000 order on a coin's GBP and USD book, switched off and on in the same minute, its width set in bps for all books at
once. Its USD books are thin ($50–75k a day, 50 real prints a day) and LIVE's rules earn cents there. The only positive thing
on them is MMCOMP's A again (Revolut X's dollar books sit a median 1.5–3 bps under par and Coinbase, 12 in the last week),
worth a few dollars a day before transfers and one-sided. Crypto books carry similar automated ladders, but not switched with it. Nothing should change live.

## 1. The maker on the USD books

### 1.1 The same order, to the last decimal (`agent_book_levels`, SQL)

The recorder keeps the top five levels a side of all four UK stablecoin books from 2026-09-26. On 2026-10-30 at 14:59 UTC
USDT-GBP's best bid was one order of **5,008.01282** USDT at 0.7451 and USDT-USD's best bid one order of **5,008.01282** USDT at
0.9981; the watch's 15:00 row has USDT-GBP's ask at 5,007.93758, and USDT-USD's ask was one order of **5,007.93758**. Over the
minutes the watch saw the maker on a GBP book, the USD book of the same coin held a level of exactly that quantity:

| week from | USDC: exact match | within 1 coin | USDT: exact match | within 1 coin |
|---|---|---|---|---|
| 09-28 | 29 % | 85 % | 45 % | 61 % |
| 10-05 | 51 % | 88 % | 52 % | 65 % |
| 10-12 | 62 % | 74 % | 56 % | 71 % |
| 10-19 | 76 % | 89 % | 44 % | 61 % |
| 10-26 | 50 % | 74 % | 50 % | 68 % |

(Only five levels are stored; on a crowded USD book its order is often deeper.) A quantity like 5,008.01282 is $5,000 at a
dollar price of 0.99840: the order is $5,000 of coin at the coin's current dollar price, put on both books.

Its deep ladder is the same on every book of a coin: USDC 100,051.27875 / 300,153.83625 / 400,205.115 / 600,307.6725 /
1,000,512.7875 ($100,000 at a fixed 0.999488 a coin, times 1, 3, 4, 6, 10), USDT 100,182.33505 / 300,547.00515 / 400,729.3402 /
601,094.0103 / 1,001,823.3505 / 1,602,917.3608 (0.998180 a coin, times 1, 3, 4, 6, 10, 16). That ladder rests about 17–67 bps
from the mid on the GBP books and 20–30 on the USD books, and **stays in the book while the $5,000 layer is away** (it is there now, on all four books).

### 1.2 Gone and back in the same minute

The watch's absences of an hour or more, against the USD book's own order (one order of 4,950–5,060 coins in the top five):

| absence (watch, UTC) | GBP book's last minute with it | USDT-USD | USDC-USD | back on the GBP book | USDT-USD | USDC-USD |
|---|---|---|---|---|---|---|
| 10-12 21:02 → 10-13 04:17 (USDC-GBP) | 21:01 | last 21:01:40 | last 21:01:43 | 04:17 | 04:17:40 | 04:17:43 |
| 10-20 06:06 → 16:34 (venue halt, §1.4) | 06:05 | 06:05:40 | 06:05:43 | 16:34 | 16:34:43 | 16:34:42 |
| 10-29 21:17 (USDT-GBP) → 10-30 11:06 | 21:16 | 21:17:40 | 21:16:40 | 11:06 | 11:06:43 | 11:06:42 |
| 10-31 00:58 → (both GBP books) | 00:57 | 00:57:40 | 23:59:41 (10-30) | not back by 04:39 | | |

(The recorder reads each book 40–52 s into the minute, so 21:01:40 is the minute 21:01.) Through each of the first three the
USD books held no such order at all (0.00 of their seen minutes, against 0.68–0.98 in the two hours before and 0.95–1.00 after).

Twelve other GBP absences of an hour or more (1.0–5.8 hours) did **not** reach the USD books, which kept the order throughout
(0.97–1.00 of their minutes): USDC-GBP 09-26 22:15, 10-04 03:41 / 05:27 / 19:02, 10-24 11:08; USDT-GBP 09-27 15:11, 10-03 21:33,
10-07 07:45 and 15:57, 10-14 15:01, 10-19 06:10, 10-26 13:44. So the GBP quotes can stop alone. Seven of the twelve fall in the
FX weekend closure (Fri 21:00 → Sun 21:00 UTC), which fits GBP quotes that need a live GBP/USD price; that is a guess the data
allow, not a finding. Today's absence (a Saturday) is on all four books, so it is not that.

### 1.3 One width, set in bps

On the USD books a tick is 1 bp; on the GBP books 1.33 bps. Its median width on the USD books: 6 ticks (USDC-USD) and 4–6
(USDT-USD) a day to 10-12, **16 ticks from 10-13** (USDT-USD in the half-hour from 08:30, USDC-USD from 09:00 UTC; the watch
dated the GBP books' step 09:12 and 09:45, its first readings after the change), and 5–6 again from **10-28 15:00** (USDT-USD,
USDT-GBP and USDC-GBP in the same half-hour). 12 GBP ticks are 16 bps; 5 GBP ticks 6.7 bps. One width in bps, for all books,
changed by one setting.

In the 16-bps regime (10-13 10:00 → 10-28 14:00) on the USD books, against PR5's fairU: its bid 7.0 bps under and its ask 8.8
over (USDT-USD), 11.0 and 4.0 (USDC-USD). Others quote inside it there: the touch is 3 bps from fair on each side on USDT-USD,
3 under and 1 over on USDC-USD.

### 1.4 2026-10-20 was a venue halt

Prints per hour on 10-20 UTC (`other_books_trades.py`): every pulled book printed 17–47 an hour from 00:00 to 05:59, 0–17 in
06:00, **none from 07:00 to 13:59**, and was back by 15:00 (BTC-GBP 66, SOL-GBP 46). `agent_quote_prints` has no USDT-GBP or
USDC-GBP print from 06:xx to 14:xx either, the £0.10 bot included. The maker's orders vanished with the halt. The other long
absences were not halts: in 10-12 21:02 → 10-13 04:17 and 10-29 21:17 → 10-30 11:06 the GBP books printed as usual (180 and
400 USDT-GBP prints, the longest gap 9 minutes), and so did the crypto books.

## 2. The other books (the poll and the prints)

### 2.1 What the poll read (`other_books_poll.py`, `other_books_scan.py` → `results/other_books_scan.json`)

Twenty-one UK books and three EEA ones, fifty levels a side, every 150 s from 2026-10-31 02:38 to 04:37 UTC (48 rounds, 1,152
reads, no error; one request every 1.4 s), with the UK tickers. Spread is the median over the reads; the ladder counts single orders whose exact quantity sat on both
sides in most reads; "shared" names another book holding the same exact quantities; the 24-hour volume is the venue's.

| book | spread, bps | depth within 25 bps of mid, $ | symmetric ladder (orders, $) | shared with | 24h volume (quote) |
|---|---|---|---|---|---|
| BTC-USD | 6.0 | 18.7 M | 8: $5k, 15k, 35k, 55k, 476k, 717k, 1.5M, 5M | | $2.05 M |
| BTC-GBP | 5.1 | 2.6 M | 5: $5.8k, 5.8k, 63k, 1.2M, 5.4M | BTC-EUR | £3.13 M |
| ETH-USD | 9.9 | 12.4 M | 8 (the same multiples as BTC-USD) | | $0.77 M |
| ETH-GBP | 16.5 | 1.3 M | 4 | ETH-EUR, ETH-USDC | £0.99 M |
| SOL-GBP | 33.1 | 0.65 M | 6: $4.8k, 9.6k, 19k, 48k, 479k, 957k | SOL-USD | £0.69 M |
| SOL-USD | 20.5 | 1.6 M | 6 (the same quantities) | SOL-GBP | $0.46 M |
| XRP-GBP | 50.6 | 0 | 3 | XRP-USD | £0.54 M |
| XRP-USD | 14.5 | 0.65 M | 5 | XRP-GBP | $0.39 M |
| PEPE-GBP | 60.2 | 0 | 6 | | £0.34 M |
| SUI-GBP | 22.4 | 11 k | 6 | | £0.14 M |
| AVAX-GBP | 25.1 | 20 k | 3 | | £0.08 M |
| ADA-GBP | 29.7 | 1 k | 6 | | £0.05 M |
| BTC-USDC, ETH-USDC | 50.5, 76.7 | 0 | 6, 7 (a family of their own) | | $0.05 M, $0.01 M |
| LINK-GBP, LTC-GBP, DOGE-GBP | 71.1, 70.1, 31.0 | 0, 0, 0.43 M | 6, 6, 1 | | £16k, £8k, £23k |
| USDC-USD, USDT-USD | 1.0, 5.0 | 2.2 M, 3.0 M | the deep ladder | USDC-GBP, USDC-EUR | $78k, $61k |
| USDC-GBP, USDT-GBP | 29.5, 36.1 (maker away) | 2.5 M, 2.0 M | the deep ladder | USDC-USD, USDC-EUR | £72k, £88k |

Every crypto book carries a symmetric ladder of single orders sized in round dollars at a reference price. They fall into
families by the multiples they use: BTC-USD and ETH-USD (1, 3, 7, 11, 95, 143, 300, 1,000 units); the GBP alt books (ADA,
AVAX, SUI, LINK, LTC, DOGE, PEPE: 1, 2, 10, 21, 50, 100 units of about $5,000); SOL and XRP on GBP and USD (1, 2, 4, 10, 100,
200, the same quantities on both books); BTC and ETH on GBP and EUR (0.07521, 0.821343, 15.58412, 70 BTC; 3.063, 30.15086,
500 ETH, the same on the UK and the EEA book); BTC-USDC and ETH-USDC. Revolut X's crypto books are made by automated ladders,
much like its stablecoin books. Which of them is the stablecoin maker cannot be told from sizes alone.

### 2.2 The $5,000 layer on the crypto books

Near the touch some crypto books hold a single order of $5,000 at the coin's current dollar price, re-sized as the price
moves, exactly like the stablecoin maker's: on SOL-GBP (15–19 bps from mid) and SOL-USD (10–11 bps), in every read, often the
same quantity on both books (51.681344 SOL at 02:39, 51.64624 at 02:48, 51.681973 at 02:53, 51.70552 at 02:56 …); on BTC-GBP
and BTC-USD most reads, LINK-GBP, PEPE-GBP and SUI-GBP some.

**It is not switched with the stablecoin maker.**
- **Now.** The stablecoin $5,000 orders are off on all four books from 00:58 UTC; in the poll's 48 rounds after that, a
  crypto $5,000 order was on SOL-GBP in 46, PEPE-GBP and LINK-GBP in 48, BTC-GBP in 26.
- **On 10-29/30** (`other_books_5k.py` → `results/other_5k.json`). A taker who takes one whole prints $5,000 ± 0.3 % of coin.
  SOL-GBP printed 12 such fills inside the stablecoin maker's 13.8-hour absence of 10-29 21:17 → 10-30 11:06, spread through
  the night, against 7 in the same hours a day before; SOL-USD 12 (9 of them one sweep) against 2. The sweep shows the engine
  at work: at 22:16:00 SOL-USD printed nine $5,000 fills at 96.694 whose quantities fall by 0.000002 each (51.694079,
  51.694077, … 51.694063), an order re-posted at once each time it was taken.
- BTC-GBP's $5,000 prints come in bursts of one taker (117 in one hour of 10-28), so they test nothing. ETH-USD, LINK-GBP and
  XRP-GBP had almost none in any window.
- What takers paid against Coinbase's minute close, and the buy-minus-sell gap within 60 s, did not separate the absences from
  the days around them on any book, the positive control USDT-USD included (7–44 prints a window): that test had no power
  (`other_books_crypto.py`, `results/other_crypto.json`).

So: the same kind of engine (or the same firm with a separate switch for its stablecoin books), not shown to be the same
operator. If Revolut runs its own liquidity on every book, this is what it would look like; it cannot be told from public data.

### 2.3 The synchronisation test, live

The poll ran from 02:38 to 04:37 UTC, two hours, while the stablecoin maker stayed away (since 00:58; the watch still read
'none' at 04:39, a Saturday). No transition happened while it ran, so the live test is the negative one above: the crypto
ladders and $5,000 orders stayed on while it was off, and no stablecoin book, USDC-EUR included, showed a $5,000 order in any
of the 48 rounds (the deep ladders were there).

## 3. What each method earns

### 3.1 LIVE's rules, an inside order, absence-only, on the USD books (`other_books_usd.py` → `results/other_usd.json`)

PR5-OPT's executor through run2.py, unchanged, a USD book fed as the GBP book of its coin with X = 1: fair is PR5's own fairU
(24-hour median of the USD book's closes), LIVE's rungs 0.1 / 0.2 / 0.3 %, exit a tick beyond fair, the £1 (here $1) holding
line, the 24-hour stop. Prints: every public print 09-27 → 10-29 (USDT-USD 13,355, of which 11,686 are the £0.10-style bot's;
USDC-USD 1,476). The maker's presence from the USD book's own snapshots (gone after 15 minutes).

| book | rule | fill | $ a day | bps of capital a day | trips (32 days) | bps a trip | days > 0 | orders a day |
|---|---|---|---|---|---|---|---|---|
| USDT-USD | LIVE's, $600 | at / through | 0.055 / 0.023 | 0.92 / 0.39 | 23 / 17 | 9.0 / 4.9 | 17 / 11 | 5 |
| USDT-USD | LIVE's, $1,200 | at / through | 0.091 / 0.040 | 0.76 / 0.33 | 22 / 17 | | | 5 |
| USDT-USD | a tick inside the maker, $100 | at / through | 0.034 / 0.011 | | 51 / 28 | 4.0 / 2.0 | 17 / 12 | 57–64 |
| USDT-USD | LIVE's + inside | at / through | 0.081 / 0.032 | | 67 / 45 | | | 58–66 |
| USDT-USD | LIVE's, only while it is away | at / through | 0.006 / −0.004 | | 5 / 3 | | | 13 |
| USDC-USD | LIVE's, $600 | at / through | 0.040 / 0.021 | 0.66 / 0.35 | 17 / 10 | 7.8 / 6.1 | 10 / 7 | 5 |
| USDC-USD | a tick inside, $100 | at / through | 0.044 / 0.002 | | 41 / 16 | 4.5 / 0.5 | 15 / 8 | 78–79 |
| USDC-USD | LIVE's + inside | at / through | 0.082 / 0.023 | | 56 / 26 | | | 78–80 |

For scale, the same rules on USDT-GBP earn about 15–17 bps of capital a day with the maker there (MAKER-ABSENT). The USD books
trade $74k (USDT) and $48k (USDC) a day in about 50 real prints each; PR6 already found par quotes there not worth running
(`reviews/2026-09-26-pr6-study.md`). The maker was away 49 and 45 hours of the 768.

### 3.2 A on the USD books (`other_books_xhedge.py` → `results/other_xhedge.json`)

Revolut X's dollar books trade under the outside price, like its pound books (MMCOMP §4.1): USDT-USD's mid sat a median 3.0 bps
under Coinbase's USDT-USD (10th–90th percentile −9.0 to −0.3; weekly medians −0.9, −2.2, −1.5, −5.1, −7.3, −4.8), and its best
ask was under Coinbase's minute close in 65 % of snapshots; USDC-USD's mid a median 1.5 bps under par (−12 in the last week),
its ask under par in 37 %. The rule: one post-only order a tick inside the touch; a print of $1+ whose taker sold at or below it
(or bought at or above our ask) fills it at the print's price, up to Q; the coins are closed at once, USDT at Coinbase's next
minute close less 0.5 bp of spread and 0.45 bp of fee (the dearest published stable-pair taker tier), USDC at par (Coinbase
turns USDC into dollars 1:1). m = how far under the far price a bid must be. 2026-09-27 → 10-31, 34 days.

| book | m | Q | fills a day | edge a fill, bps | $ a day | days > 0 | coins to move a day |
|---|---|---|---|---|---|---|---|
| USDC-USD | 0 | $100 | 35.7 (777 buys, 437 sells) | 5.9 | 1.84 | 34 / 34 | $824 |
| USDC-USD | 0 | $500 | 35.7 | 5.9 | 7.88 | 34 / 34 | $3,035 |
| USDC-USD | 2 | $500 | 15.3 (490 / 30) | 12.0 | 7.05 | 30 / 30 | $4,974 |
| USDT-USD | 0 | $100 | 32.6 (778 / 332) | 4.1 | 1.03 | 34 / 34 | $947 |
| USDT-USD | 0 | $500 | 32.6 | 4.1 | 3.61 | 34 / 34 | $3,117 |
| USDT-USD | 2 | $500 | 23.2 (661 / 128) | 5.5 | 3.47 | 34 / 34 | $3,975 |

Why to doubt it, beyond MMCOMP §4.2's list (Coinbase's real fee for this account; Revolut X's withdrawal fee, £1 or £3 plus the
network's; the other maker's answer; minute-old hedge prices): the fill is at the print's price, a tick better for us than one
tick inside would give; the flow is one-sided (Revolut X's users sell dollar coins), so coins pile up on Revolut X and dollars
on Coinbase, and **a UK Coinbase account's way back for dollars is not checked**. Orders: one order a side re-priced with the
touch, which moves a median 55 (USDT-USD) and 27 (USDC-USD) times a day, plus one Coinbase order a fill: about 100–150 a day,
inside one account's 1,000.

### 3.3 Cross-book relations (SQL on `agent_book_levels` and `agent_quote_minutes`)

- **The four-book loop** GBP → USDT (USDT-GBP ask) → USD (USDT-USD bid) → USDC (USDC-USD ask) → GBP (USDC-GBP bid), and back:
  median −5.4 bps, 90th percentile +7.7, 99th +21.5, over 9,758 five-minute reads from 09-27. Above the four taker fees
  (36 bps): 9 reads. With one leg as a maker (27 bps of fees): still rare. No.
- **The pound-dollar rate the books imply** (USDC-USD mid ÷ USDC-GBP mid against PR5's X): median +0.9 bps, 10th–90th −6.9 to
  +9.1; for USDT −1.2, −12.2 to +9.1. Buying the coin with pounds and selling it for dollars (or back) as a taker beat X by more
  than two fees (18 bps) in 1 (USDC) and 267 (USDT) of 7,038 reads. That is a cheaper way to change pounds into dollars at
  those moments, not a profit: closing it needs an FX conversion in Revolut's app at interbank, which depends on Davies' plan's
  allowance and is not available on weekends without a mark-up.
- **USDC-EUR** (EEA) cannot be traded from this account.

### 3.4 The crypto books

Wide books (SOL-GBP 33 bps, XRP-GBP 51, LINK-GBP 71, PEPE-GBP 60) look like room for a 0 % maker, but every fill holds a coin
that moves 2–5 % a day, so a quote 15 bps from mid is filled mostly when the price is about to run through it. Hedging on
Coinbase or Kraken costs about 40–60 bps a side for these coins at their base taker tiers. Neither the fill rate nor the adverse
selection was replayed here; that is its own study (a per-print markout of Revolut X's crypto tape against Coinbase, at
seconds, which a minute candle cannot give: §2.2's minute-level test had no power even on a stablecoin).

## 4. Recommendation

1. **Nothing changes live.** LIVE on USDT-GBP is the best of these by 20 times or more.
2. **If A goes to paper on the GBP books** (MMCOMP §5.2), add USDC-USD as a second book on the same engine: it needs only the
   recorder's books (already recorded), the prints (a new read of `trades/all`, one call a minute) and no hedge price (par).
   It is worth it only once the three questions of MMCOMP §5.2 are answered; for USDC-USD add a fourth: how dollars get from
   Coinbase back to Revolut X for this account, and at what cost.
3. **Record USDC-EUR's book** only if Davies ever trades from an EEA account; for the UK account it is evidence, not a market.
4. **Fix the record**: the 10-20 06:06 → 16:34 "absence" was a venue halt. A future reading of the watch's absences should
   leave it out, or count it apart.

## 5. Not checked

- Who the maker is (an outside firm or Revolut's own desk).
- Whether the crypto ladders are the stablecoin maker's: no transition happened while the poll ran.
- The near-touch $5,000 order on USDC-EUR (the maker was away for the whole poll).
- Coinbase's taker fee for this account, Revolut X's withdrawal fee for USDC / USDT, and the dollar route back from Coinbase.
- A crypto-book markout at seconds; any replay of quoting on a crypto book.

## 6. Sources

- SQL (read-only, Supabase project flmvxigozjuizpckllvk, 2026-10-31 02:36–04:41 UTC): `agent_book_levels` (four books, 09-26 →),
  `agent_maker_events`, `agent_maker_minutes`, `agent_maker_state`, `agent_quote_minutes`, `agent_quote_prints`.
- Revolut X keyless public endpoints: `/api/2.0/public/order-book/{SYM}?region=UK|EEA&limit=50`, `/api/1.0/public/tickers?region=UK`,
  `/api/1.0/public/configuration/pairs`, `/api/1.0/public/trades/all` (one-day windows). Coinbase Exchange `/products/{P}/candles`.
- Committed inputs: `fair_price/data/book_USDT-USD.txt.gz`, `book_USDC-USD.txt.gz`, `minutes.txt.gz` (REVX-FAIR).
- The poll: 2026-10-31 02:38 → 04:37 UTC, raw reads in `data/other_poll.jsonl.gz`, summary in `results/other_books_scan.json`.
