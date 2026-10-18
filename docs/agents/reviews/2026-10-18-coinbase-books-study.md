# Coinbase's order books put to work: queue, fills, Revolut X and the weekend (CBBOOKS-1, 2026-10-18)

Davies, 2026-10-18: "cbbooks留着并利用起来，和revolut x的订单簿一样可以做策略研究" (keep the Coinbase book recorder and use it for
strategy research, as the Revolut X books were). This is the first study that reads `cb_book_levels`.

**Not blind, and no reading.** Every record was read for research (no no-peek rule since 2026-10-04). Its rules, the date split,
the costs and every bar were frozen in `backtests/cbbooks/params.json` (commit `836c6922`, sha256 `8866a1f7…eff1`) before any pull
was analysed; what was read before freezing is listed there (counts, schemas, sample rows, and the 2026-10-18 stablecoin review,
which quotes Coinbase's weekend touch). No pre-registered reading was run or pre-empted: "with Euros" (11-08), "with Euros - 2"
(11-10), QUEUE (11-02) and PR5-W (11-25) run as written. Nothing was changed in production; no order was placed or cancelled; no
code, migration or frozen file was edited. Every change below is a proposal.

**Sources.** Production read 2026-10-18 04:21–04:26 UTC, SELECT only, through the connector: `backtests/cbbooks/sql/` (books per
product and half, prints summed by second, Revolut X's books, prints and PR5's minutes, both Coinbase paper rows' order logs and
trips), each pull checked by the database's own md5 (`scripts/grab.py`, `MANIFEST.json`). The raw pulls (about 15 MB) are not
committed; their hashes are. **They cannot be re-pulled in full after about 10-20**: `cb_trades` is kept ten days. Scripts:
`describe.py` (D, Q7), `queue.py` (Q1, Q5, Q6), `paper.py` (Q2), `cross.py` (Q3, Q4); results in `results/`. Window 2026-10-10 03:00
→ 10-18 03:00 UTC; **train** 10-10 03:00 → 10-14 03:00 (Sat, Sun, Mon, Tue), **test** 10-14 03:00 → 10-18 03:00 (Wed, Thu, Fri, Sat);
weekend Friday 21:00 → Sunday 21:00 UTC. Costs: Coinbase's stable pairs 0.00 % maker, 0.0045 % taker at every tier (stable-pair
volume does not count toward tiers; Davies has no Coinbase account yet, so this schedule is the one his would get); Revolut X 0 %
maker, 0.09 % taker. Bootstraps: 2,000 resamples of whole UTC hours, seed 20261018, 90 % intervals.

**Sample limits, plainly.** Eight days: five weekdays, one whole weekend and one partial. Books are read once a minute, at about :30
(the recorder's design), so a queue position between two reads is not observed. The test half holds a steady fall in the dollar
against the pound and the euro, which biases bids' markouts down and asks' up. One scheduled release (US CPI 10-14). Every number
below is an eight-day number.

**Deviations from `params.json`** (`MANIFEST.json`): (1) its conventions line says `cb_trades.side` is the maker's side; **it is
the aggressor's**: Coinbase serves the maker's side and the recorder flips it on write (`agents/cb_rec.ts` lines 17–18 and 72).
Found by the descriptive pass before any candidate was run (prints stored "buy" sat at a fresh ask for 83–91 % of their coins), and
the scripts read it correctly from then on; no rule changed. The paper engine is consistent: `cb_quotes.ts` hands `stepMinute` the
stored aggressor side, which `blocks()` reads as the aggressor. (2) Six Revolut X book reads stored both sides empty and are
skipped. (3) Q4's resting order fills at most once a minute a side; the file did not say.

## 0. Answers first

| rank | candidate | result (test half unless said) | verdict |
|---|---|---|---|
| 1 | **Q2. Are the Coinbase paper rows' fills real?** | Every one of 61 ("with Euros") and 53 ("- 2") entry fills had a print strictly beyond the rung in its second, and every one would have rested post-only at go-live. The through rule is **conservative**: a queue rule at the rung's price would have added 5 entry fills and 6 exit fills (of 61 and 51) and brought 9 and 4 earlier; 16 % of fills were cut below 100 by the 10 %-of-volume cap where a real through fill is whole | **The paper rows' fills are real; nothing to fix.** The 11-08 / 11-10 readings can cite this as a non-blind check |
| 2 | **Q4 (ii). A Revolut X maker hedged at once on Coinbase** | Margin 10 bps (chosen on train): USDC-GBP **+£0.52 a day** (90 % +£0.34 to +£0.69), 14 fills a day, 98 % won; USDT-GBP **+£1.00 a day** (+£0.74 to +£1.28), 101 fills a day, 100 % won; the train half the same sign (+£0.49, +£0.62). **But 88–100 % of fills buy on Revolut X and sell on Coinbase**: about 630–1,270 coins a day must move from Revolut X to Coinbase, and the bar did not price that transfer | **Passes its frozen bar on both books. Draft paper reading** (`reviews/2026-10-18-cross-venue-maker-prereg.md`, DRAFT, not frozen); the transfer cost decides it and is not measured |
| 3 | Q3. Who leads, and is Coinbase a better fair for PR5? | **Coinbase leads**: a gap between the venues' mids is closed by Revolut X (USDC-GBP slope −0.26 at 5 min, 90 % −0.33 to −0.21; Coinbase −0.02, −0.06 to +0.01), in both halves and both books. Revolut X trades a median **4.7 bps (USDC-GBP) and 5.3 bps (USDT-GBP) below Coinbase**. As a fair an hour ahead, Coinbase's mid plus its trailing gap beats PR5's fair by 3 % and 12 % in test, 10 % and 6 % in train | Coinbase leads (bar passed). **No better fair** (bar: ≥ 10 % in both halves and both books; failed). Nothing to propose for PR5's fair |
| 4 | Q5. Touch imbalance | A real one-minute signal on three books: IC of L1 imbalance with the next mid change 0.11–0.24 train, 0.11–0.17 test (USDT-EUR 0.07 / 0.045, under the bar). As a join filter it helps the touch maker's markouts by +0.33 bp (USDT-GBP) and +0.42 bp (USDT-EUR) keeping 62–63 % of fills; still below zero | Signal real (3 of 4 books), filter useful (2 of 4) **but it only serves a touch maker, which loses**. Not for PR5's rungs 10–30 bps out. Dead as a strategy |
| 5 | Q6. Weekend against weekday | Every print's maker markout over 60 min: no weekend effect that holds (USDC-GBP weekend − weekday +1.96 bps, 90 % −0.28 to +4.28; USDT-GBP −1.21, −2.53 to +0.08; EUR books within ±0.15). The touch maker on **USDC-GBP at weekends** made +0.20 bp (train, 90 % +0.003 to +0.37) and +0.33 bp (test, +0.20 to +0.45) under the pessimistic rule | No Coinbase weekend maker effect. The USDC-GBP weekend slice is post hoc and worth about **£1 a weekend per £1,000 quoted**: not worth a row |
| 6 | Q1. Joining the touch on Coinbase (the queue model) | 100 coins at the back of the touch fill within an hour 70–87 % of the time (pessimistic), but the fills are adverse: 60-min markout **−0.48 bp** USDC-GBP (90 % −0.79 to −0.17), −0.77 USDT-GBP, −0.16 USDC-EUR, −0.46 USDT-EUR; train −0.05 to −0.36. The optimistic bound (cancellations ahead counted) reads +0.30, +0.05, +0.40, −0.39 | **Dead** (bar failed on all four books). The answer lies between the two bounds, and minute reads cannot say where |
| 7 | Q4 (i). Taker-taker arbitrage | Coinbase's bid sat above Revolut X's ask by more than both taker fees (0.0945 %) in **12.9 % of USDT-GBP minutes** and 2.4 % of USDC-GBP's (median 6.4 and 2.5 bps over fees, about 1,300–5,200 coins at the smaller touch), in episodes up to **592 minutes** long; the other way almost never (28 and 1 minutes) | **Dead on the screen**: a crossing that lasts ten hours is not being taken, so something (moving coins between the venues) costs more than it pays. The same friction as rank 2 |
| 8 | Q7. Release windows | One release (US CPI 10-14 12:30). In its first five minutes prints ran 4–6× the same minutes on other weekdays; USDT-EUR's spread went 0.40 → 5.43 bps, the GBP books' 1.33 → 1.85; depth did not vanish | **No study possible on one event**; consistent with the blackout already priced on two 12-month spans |

**In one line:** the Coinbase books confirm that the paper rows' fills are honest, show Coinbase leading Revolut X, and point to one
new idea worth a paper reading, a Revolut X maker hedged on Coinbase, whose fate rests on what it costs to move coins from Revolut X to
Coinbase. Everything that lives at Coinbase's touch is too thin to matter: its spread is one tick (1.1–1.3 bps) almost all the time.

## 1. What is recorded (D; `results/describe.json`)

- **Four books**: USDC-GBP, USDT-GBP, USDC-EUR, USDT-EUR (no other crosses), ten levels a side, prices in each book's step (0.0001; USDT-EUR
  0.00001), sizes in hundredths of a coin, the touch's order count. One read a minute at about :30; a row only when the levels changed.
- **Coverage, 10-10 03:00 → 10-18 03:00 (11,520 minutes):** 11,514–11,518 reads a book; 7–12 gaps over 90 s a book, each one missing
  read (the longest 121 s); 98–100 % of reads changed something in the ten levels (USDC-GBP 1.9 %, USDT-GBP 4.1 % unchanged).
  `cb_trades` holds every print by trade id (34k–203k a book in the window); `cb_touch` a touch a minute at :00; `cb_quote_minutes`
  the paper rows' minute record.
- **Books** (weekday / weekend, by read):

| book | tick in bps | spread, bps | one-tick share | L1 coins (bid, median) | orders at L1 | five-level depth (coins) | ten bid levels span |
|---|---|---|---|---|---|---|---|
| USDC-GBP | 1.33 | 1.48 / 1.37 | 89 % / 98 % | 15,003 / 14,320 | 1.7 / 2.3 | 72,977 / 97,833 | 29 / 31 bps |
| USDT-GBP | 1.33 | 1.66 / 1.36 | 75 % / 98 % | 28,614 / 18,013 | 3.6 / 3.9 | 255,469 / 242,639 | 33 / 28 bps |
| USDC-EUR | 1.12 | 1.17 / 1.12 | 95 % / 100 % | 33,263 / 50,717 | 5.4 / 8.7 | 115,189 / 203,373 | 12 / 15 bps |
| USDT-EUR | 0.11 | 0.29 / 0.32 | 25 % / 16 % | 10,011 / 9,381 | 1.5 / 1.3 | 96,395 / 79,542 | 2.7 / 3.1 bps |

  By hour the profiles are flat: on weekdays the spread moves within 1.41–1.61 bps (USDC-GBP), 1.37–1.81 (USDT-GBP), 1.14–1.23
  (USDC-EUR), widest in the London and New York overlap (11:00–15:00 UTC) and tightest 21:00–00:00; depth is thinnest 20:00–23:00.
  The weekend books are **not thinner** at the touch: tighter (the one-tick share rises to 98–100 % on three books), deeper on
  USDC-EUR and USDC-GBP, with far fewer prints.
- **Queue dynamics at the touch:** between two rows the best bid moved 26 % (USDC-GBP), 29 % (USDT-GBP), 26 % (USDC-EUR) and 69 %
  (USDT-EUR) of the time; the touch's size changed 87–100 % of the time. Prints came between 64–99 % of consecutive rows.
- **Prints against book changes:** the mid moved in 32 % of row-to-row steps with prints between and 26 % without on USDC-GBP; 41 %
  against 28 % on USDT-GBP; 28 % against 2 % on USDC-EUR (99 % of its steps have prints); 91 % against 52 % on USDT-EUR. So on the
  GBP books a quarter of touch moves happen with no print at all: quotes are pulled and re-placed, not traded through.
- **Prints:** weekday / weekend per minute 3.2 / 2.6 (USDC-GBP), 3.9 / 1.4 (USDT-GBP), 22.1 / 10.1 (USDC-EUR), 15.2 / 1.2 (USDT-EUR);
  coins an hour 116k / 79k, 212k / 38k, 2.33 M / 0.40 M, 1.70 M / 0.13 M. Buyers and sellers split about evenly (48–51 % of coins hit bids).

## 2. Q2: the paper rows' fills (`results/paper.json`)

`stepMinute` fills a resting order only on a print **strictly beyond** its price, for at most £100 / €100 or 10 % of the minute's
printed money. On a price-time-priority book a print beyond a price means every order at that price was filled first, so a through
fill is certain if the order was resting. The books let that be checked for the first time:

| check | "with Euros" (base) | "with Euros - 2" (hold) |
|---|---|---|
| entry fills in the window (trips; the hold arm's five open weekend positions are not trips) | 61 (USDC-EUR 18, USDC-GBP 16, USDT-EUR 16, USDT-GBP 11) | 53 |
| (a) a print strictly beyond the rung in the fill's second | 61 of 61 | 53 of 53 |
| (b) post-only would have rested at go-live (against the book read standing then) | 61 of 61 | 53 of 53 |
| (c) the rung inside the ten recorded levels at the fill | 55 of 61; median 2 ticks behind the touch (−90 to +101) | 49 of 53; median 1 tick |
| (d) paper size the full 100 of the book's currency | 83.6 % (the rest cut by the 10 % cap) | 83.0 % |
| (e) entry orders: with a print AT their price before any through print | 52 of 3,881 | 49 of 3,389 |
| … of which a queue rule (back of the displayed size at go-live) fills: never filled by the paper / filled earlier | **5 / 9** (3 beyond the ten levels, unknown) | 5 / 6 (3 unknown) |
| exit orders: with an at-price print / queue fills never filled / earlier | 56 of 506; **6 / 4** (1 unknown) | 43 of 484; 6 / 4 (1 unknown) |

**Reading.** The paper rows' fills happened: each had a print through it, and each order would have been accepted. The rule leaves
some money on the table, not the other way round: about 8 % more entries and 12 % more exits under a queue rule, some fills sooner,
and a sixth of fills smaller than a real through fill would have been. "Median 2 ticks behind the touch, minimum −90" also says most
fills come when the book walks onto the rung (the dollar moved), which is the rule's design, not a quirk.

## 3. Q1, Q5, Q6: the touch (`results/queue.json`)

**Q1, the queue model.** At each read, 100 coins join the back of the best bid (and, apart, the best ask) behind the displayed size
(median 15,003 coins USDC-GBP, 19,312 USDT-GBP, 34,135 USDC-EUR, 10,009 USDT-EUR). Pessimistic: filled when the coins printed at that
price against our side pass the queue ahead plus ours, or on any print beyond. Optimistic: the queue ahead also shrinks to the
smallest size the level later shows (cancellations ahead of us).

| book | fill within 1 / 5 / 15 / 60 min (pess.) | median minutes to fill | 60-min markout, pess. (90 %) | optimistic | train, pess. / opt. |
|---|---|---|---|---|---|
| USDC-GBP | 11 / 35 / 53 / 75 % | 5.7 | −0.48 (−0.79 to −0.17) | +0.30 (+0.12 to +0.52) | −0.05 / +0.39 |
| USDT-GBP | 7 / 30 / 50 / 70 % | 6.4 | −0.77 (−1.11 to −0.45) | +0.05 (−0.12 to +0.21) | −0.18 / +0.36 |
| USDC-EUR | 21 / 46 / 62 / 82 % | 3.7 | −0.16 (−0.41 to +0.09) | +0.40 (+0.31 to +0.50) | −0.17 / +0.30 |
| USDT-EUR | 32 / 58 / 74 / 87 % | 1.9 | −0.46 (−0.63 to −0.29) | −0.39 (−0.56 to −0.24) | −0.36 / −0.30 |

The frozen bar (test fill ≥ 10 % within an hour, 60-min markout above 0 with its 90 % lower bound above 0, train above 0) fails on
every book. The two bounds differ by about 0.5–0.8 bp, which is the whole question for a maker at a one-tick touch, and only reads
finer than a minute (or Coinbase's full order feed) could settle it. Even at the optimistic bound the money is small: +0.3 bp on a
£75 order is £0.002 a fill. In the test half bids fared far worse than asks (USDC-GBP −0.97 against −0.01): the dollar fell, so
resting bids were the ones hit.

**Q5, imbalance.** L1 imbalance predicts the next minute's mid change: IC 0.24 / 0.11 (USDC-GBP train / test), 0.23 / 0.17
(USDT-GBP), 0.12 / 0.16 (USDC-EUR), 0.07 / 0.045 (USDT-EUR, under the 0.05 bar). Five-level imbalance carries less
(0.01–0.12). As a filter on the touch maker (do not join a side the imbalance leans against, θ from train: 0.75, 0.25, 0.25, 0.25),
it lifts test markouts by +0.14, +0.33, +0.11 and +0.42 bp, keeping 95 %, 63 %, 64 % and 62 % of fills: the bar (≥ 0.2 bp, ≥ half
the fills) passes on USDT-GBP and USDT-EUR. Every filtered result is still below zero. PR5's rungs sit 10–30 bps from fair, far beyond
a one-minute, sub-tick signal; nothing here applies to them.

**Q6, weekends.** Every print's maker markout, size-weighted, over 60 minutes, weekday / weekend: USDC-GBP −0.03 / +1.93 bps (difference
+1.96, 90 % −0.28 to +4.28), USDT-GBP +1.73 / +0.52 (−1.21, −2.53 to +0.08), USDC-EUR −0.09 / +0.06 (+0.15, −0.10 to +0.38), USDT-EUR
−0.03 / −0.01 (+0.02, −0.26 to +0.26). Over 5 minutes makers earn +0.2 to +1.9 bps on the GBP books either way. No weekend effect
holds across books or halves. The touch maker's weekend slice is positive in both halves on USDC-GBP only (+0.20 and +0.33 bp,
fills 55–65 % within the hour), found after the fact; at that rate a £1,000 quote earns about £1 a weekend. Not a candidate.
"With Euros - 2" (the weekend arm of PR5's rule) stays its own question, read on 11-10.

## 4. Q3 and Q4: Coinbase against Revolut X (`results/cross.json`)

Both venues list USDC-GBP and USDT-GBP. At each minute (:40, after both recorders' reads) the gap is Revolut X's mid less Coinbase's,
in bps: median **−4.7** (USDC-GBP; 10th–90th percentile −12.6 to −0.7) and **−5.3** (USDT-GBP; −17.2 to −1.3). Revolut X's touch is
wide (median 11.9 and 6.6 bps against Coinbase's 1.1–1.7).

**Who leads (Q3).** The change of each venue's mid over the next k minutes, regressed on the gap:

| book, half | Revolut X slope, 1 / 5 / 15 / 60 min | Coinbase slope, 1 / 5 / 15 / 60 min |
|---|---|---|
| USDC-GBP, train | −0.07 / −0.09 / −0.12 / −0.20 | +0.01 / +0.02 / +0.05 / +0.11 |
| USDC-GBP, test | −0.12 / **−0.26** (−0.33 to −0.21) / −0.41 / −0.88 | −0.00 / −0.02 (−0.06 to +0.01) / −0.05 / −0.26 |
| USDT-GBP, train | −0.02 / −0.03 / −0.06 / −0.14 | +0.00 / +0.01 / +0.03 / +0.07 |
| USDT-GBP, test | −0.04 / **−0.13** (−0.18 to −0.08) / −0.27 / −0.66 | −0.00 / −0.02 (−0.05 to +0.02) / −0.05 / −0.08 |

Revolut X moves to close a gap; Coinbase barely moves (small positive slopes in train: it closes a little of it too). **Coinbase leads**, in both
halves and both books (the frozen bar). The closing is slow (8–26 % in five minutes) and the basis itself persists.

**A better fair? No.** The Revolut X mid an hour ahead, RMSE in bps (minutes where PR5's fair is lit; test / train): no change 9.9 /
4.5 (USDC-GBP), 9.4 / 3.4 (USDT-GBP); PR5's fair 9.7 / 7.5, 9.9 / 9.3; Coinbase's mid 10.4 / 9.4, 11.2 / 11.0; Coinbase's mid plus
the trailing 24-hour median gap 9.4 / 6.8, 8.7 / 8.8. The adjusted Coinbase mid beats PR5's fair by 3 % and 12 % in test and 10 % and
6 % in train, short of the bar's 10 % in both halves and both books. Coinbase's raw mid is worse than PR5's fair, because of the
basis. (PR5's fair is an anchor its far prints revert to, not an hour-ahead forecast: no predictor beats "no change" in train.)

**Arbitrage (Q4).**
- *(i) Taker-taker.* Coinbase's bid above Revolut X's ask by more than 0.09 % + 0.0045 %: USDT-GBP 1,491 of 11,520 minutes in 44
  episodes (median 6 minutes, longest 592), median 6.4 bps over the fees, about 5,200 coins at the smaller touch, 29 % at weekends;
  USDC-GBP 274 minutes in 30 episodes (longest 68), 2.5 bps over the fees. Revolut X's bid above Coinbase's ask: 28 and 1 minutes.
  Episodes that last hours are not being taken. Each one leaves the coins at Coinbase and the pounds at Revolut X, so it needs coins
  moved back; no transfer cost is measured here.
- *(ii) Maker on Revolut X, taker on Coinbase.* A Revolut X bid at Coinbase's best bid less 0.0045 % less m (an ask likewise),
  re-priced each read, filled by a Revolut X print strictly through it for min(£100, 10 % of that minute's printed pounds), hedged at
  the next Coinbase read's touch with its taker fee:

| book, m | train £ a day (fills) | test £ a day (90 %) | fills a day, won | bought on Revolut X | net coins to move a day | about £ traded a day |
|---|---|---|---|---|---|---|
| USDC-GBP, 1 bp | 0.20 (20) | 0.25 (0.18 to 0.31) | 29.5, 97 % | 74 % | 886 | 1,083 |
| USDC-GBP, 5 bps | 0.34 (11) | 0.59 (0.44 to 0.73) | 23.3, 99 % | 91 % | 1,107 | 916 |
| **USDC-GBP, 10 bps** (train's choice) | **0.49 (9.5)** | **0.52 (0.34 to 0.69)** | 14.0, 98 % | 88 % | 628 | 507 |
| USDT-GBP, 1 bp | 0.29 (213) | 0.37 (0.24 to 0.49) | 276, 97 % | 91 % | 1,468 | 1,947 |
| USDT-GBP, 5 bps | 0.51 (117) | 0.95 (0.76 to 1.15) | 221, 100 % | 99 % | 1,898 | 1,490 |
| **USDT-GBP, 10 bps** (train's choice) | **0.62 (86)** | **1.00 (0.74 to 1.28)** | 101, 100 % | 99 % | 1,266 | 966 |

  It passes its frozen bar on both books (test above 0 with the 90 % lower bound above 0, at least one fill a day). It is PR5's
  idea with Coinbase's touch as the fair and an immediate hedge instead of a wait for the exit: about 10 bps on each pound traded.
  Three things the screen does not price: **(1) the flow runs one way** (Revolut X is the cheap venue), so coins pile up at Revolut X
  and pounds at Coinbase; at 10 bps a transfer must cost under about 10 bps of what it moves (a £1 fee is 20 bps on £500 and 2 bps on
  £5,000), and Revolut X's withdrawal fees are not in our docs; (2) many USDT-GBP fills are pennies (321 of 403 under £1: the £0.10
  prints of the 10-14 review); (3) it would quote in the same Revolut X books as PR5's LIVE, ahead of LIVE's rungs. It also needs a
  Coinbase account, which Davies does not have.

## 5. Q7: the one release (`results/describe.json`, `q7_cpi_2026_10_14`)

US CPI, 2026-10-14 12:30 UTC (not in `CB_RELEASES`, which starts 10-28). In 12:30–12:35 against the same minutes of 10-12, 10-13, 10-15
and 10-16: prints 107 against 23 (USDC-GBP), 136 against 25, 515 against 255, 163 against 216 (USDT-EUR); coins 4–6× on the GBP
books; spread 1.85 against 1.33 bps (USDC-GBP), 1.85 against 1.79, 1.56 against 1.12, **5.43 against 0.40 (USDT-EUR)**; five-level
depth within a fifth of normal. One event: nothing to estimate. It agrees with the blackout's premise (the 2026-10-15 reviews).

## 6. Recommendations

**Become a paper test (draft, NOT frozen; Davies' word to freeze):**
1. **XV-1, "Revolut X maker hedged on Coinbase"**, as an offline dated reading on the recorded books and prints, not a new engine:
   `reviews/2026-10-18-cross-venue-maker-prereg.md`. Window 2026-10-18 03:00 → 11-15 03:00 UTC, read by 11-19 (the books are kept 35
   days), margin 10 bps fixed, with a transfer cost charged on the net flow. Before it can be frozen, the cost of moving USDC and USDT
   from Revolut X to Coinbase (and pounds back) must be read from both venues' fee pages; if a weekly transfer costs more than about
   5 bps of a week's flow, it is dead before it starts. It costs nothing to run: no key, no order, no new call.

**Improve an existing engine (proposals needing Davies' word):**
2. **None to the running Coinbase rows.** Their fill rule is honest and slightly conservative (§2); their 11-08 and 11-10 readings can
   cite §2 as a non-blind check. If a Coinbase engine is ever built for live, its fill model should use the books: a through fill
   is whole (not capped at 10 % of the minute), and a print at the price fills behind the displayed size.
3. **No change to PR5's fair.** Coinbase leads Revolut X, but its mid is not a better hour-ahead fair (§4). An untested idea that
   follows, for a later study, not a proposal: never post a Revolut X bid above Coinbase's bid (or an ask below its ask) less fees.

**Dead on this record:** joining Coinbase's touch (Q1), the imbalance filter as a strategy (Q5), a Coinbase weekend maker effect
(Q6), taker-taker arbitrage (Q4 i), release windows (Q7, one event).

**The recorder (`cbbooks`): KEEP (Davies, 10-18).** Proposals, each Davies' call:
- **R1. Keep the prints as long as the books.** `cb_trades` is pruned at 10 days while `cb_book_levels` keeps 35, so a study more
  than ten days back has books without prints (this study's first day goes on about 10-20). Either keep `cb_trades` 35 days (about
  6 MB a day, about 200 MB) or, cheaper, a prints-by-second table like this study's pull (about 0.5 MB a day, all four books). The
  XV-1 reading needs only Revolut X's prints and Coinbase's books, so it does not depend on R1.
- **R2. Ten levels are enough.** The paper rungs sat inside the ten levels for 55 of 61 and 49 of 53 fills; no more levels needed.
- **R3. Faster touch reads only if the touch maker is wanted.** The queue question (§3) needs reads every few seconds (`/book?level=1`,
  within Coinbase's 10 a second) or the full order feed; the money at a one-tick touch is too small to justify it now.
- **R4. No new products** for anything found here.

## 7. What this study did not check

- Revolut X's and Coinbase's withdrawal and deposit fees, and transfer times: they decide XV-1.
- Queue positions between reads (minute reads only), hidden or iceberg orders, and self-trade rules.
- Whether XV-1's Revolut X order would have been the touch, and so filled at its own price more often than the through rule
  allows (conservative), or would have changed the prints it relies on (not modelled).
- Coinbase's books before 10-10 (not recorded), the paper rows' unrealised marks, and anything about PR5's LIVE money.

## 8. In plain words (for Davies)

- The Coinbase order books are now in use. Eight days of them say three useful things.
- The two Coinbase paper tests fill honestly: every simulated fill had a real trade through its price, and if anything they fill a
  little less than reality would.
- Coinbase's price leads Revolut X's, and Revolut X's USDC and USDT trade about 5 bps cheaper than Coinbase's. That gives one new
  idea: buy on Revolut X when someone sells cheaply there and sell at once on Coinbase. On paper it made about £0.50 a day on USDC and
  £1.00 a day on USDT over the last four days, winning almost every time. The catch: it always buys on Revolut X and sells on
  Coinbase, so coins must be moved from Revolut X to Coinbase regularly, and those transfer fees are not known yet. It would also need
  a Coinbase account. I drafted a paper test (not frozen) that runs on the recordings, with no account and no money.
- Trading at Coinbase's best price itself is not worth it: the spread there is one tick, about 1.3 bps, and what you earn there is a
  fraction of that.
- Keep the recorder. One cheap improvement: keep Coinbase's trades as long as its order books (10 days now, against 35).
