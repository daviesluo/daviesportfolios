# Revolut X's GBP stablecoin books: who tightened them, the £0.10 bot, and what we could copy (2026-10-30)

Davies, 2026-10-30 ~00:50 UTC: "另外，我这边有一个大胆的推测，就是你之前不是说 Revolut X 的盘口在九月份，一下给收紧了吗？有没有可能是之前它的盘口很宽，
然后有其他人像我们一样来做这种类似的策略，因为他们也在做市，所以把这个盘口才给收紧了。所以我们现在做的其实是他们做完剩下的相当于。然后你又说，有一个机器人，最近在打那种很小的单，
那这种小单的机器人是不是专门就是为了收割像我们这种做市的人来打造的？那我们能不能做类似的策略？coinbase等平台也一样，你仔细深度研究一下".

The four questions: (1) did another market maker tighten the books, so that we now quote what it leaves? (2) is the bot that
prints tiny trades built to harvest makers like us? (3) can we run something like it? (4) the same on Coinbase and the
other venues. His idea is treated as a hypothesis and tested against the alternatives.

**Superseded in part by `reviews/2026-10-30-mmcomp-2.md`:** A's figures here count no inventory limit and no transfer
cost; with both, A earns about £0.7–1.1 a day on £600–1,200 (USDT-GBP), and B, re-run without LIVE's own prints, clears nothing.

**Not blind, research only.** Every record was read; no pre-registered reading was run or pre-empted (QUEUE 11-02, PR5-W
11-25, the LIVE-rule twins). Nothing was changed in production: no order, config, twin, migration or frozen file.
**Public repository:** LIVE appears only in counts, shares and basis points. Every pound figure is a replay's (paper money).

## 0. Answers first

1. **Davies' guess is right in substance, wrong on the month.** The books tightened in the week of **2026-08-24**, not
   September (the date PR5's study found, `reviews/2026-09-23-pr5-study.md`). The tightening came with one new
   participant:
   - **An automated market maker arrived on both GBP books in the same days.** Its orders are one order of about 5,000 coins a
     level (5,000.05 → 5,007.5, the decimals drifting slowly), and it quotes a fixed width around fair, both sides, every hour
     of the day. A print of exactly one of its orders (5,000.0005–5,010 coins: a taker took the whole order) appears **twice on
     USDC-GBP in the 47 weeks to 08-23 and 9 times on USDT-GBP in 37 weeks, then 5–24 times a week from the week of 08-24**.
     The first ones are 08-20/08-22 on USDT-GBP and 08-27 on USDC-GBP.
   - **Its quote is a parameter, not a person.** In the book record (09-26 →) its own spread is exactly 5 ticks on both books
     every weekday to 10-12, and exactly **12 ticks on both books from 10-13**, the same day: one algorithm changed one setting.
     It sits at the touch about 55 % of the time on USDC-GBP and 25 % on USDT-GBP, evenly across the hours.
   - **The alternatives do not fit.** The flow did not grow: USDT-GBP traded about £890k a week in the 12 weeks before and
     £650k after. Revolut's fees did not change (0 % maker, 0.09 % taker, the same published schedule). We were not there:
     LIVE started 2026-10-01, five weeks later, and before 10-13 it was at the touch in under 5 % of the snapshots on most days. Nothing on
     Revolut's news pages matches the week (its AI-assistant link to Revolut X was June/July; EURR, a euro coin, 08-08).
   - **What cannot be told from public data:** whether the maker is an outside firm or Revolut's own liquidity desk. Its orders
     rest in the public book like anyone's.
   - **"We quote what they leave": yes, mechanically.** It quotes ±3 bps of fair (±8 bps since 10-13); our entries rest 10, 20
     and 30 bps away, so a taker fills us only after taking its orders first. That is why PR5's rate fell four- to sevenfold at
     08-24. It is not "like us": it competes at the touch with £3,700 orders, we wait behind it for sweeps.
   - **Since 10-13 the room inside its quote doubled** (USDC-GBP's touch on weekdays mostly 3–5 → 7–12 ticks; depth within 10 bps
     about 40,000 → 10,000 coins). Our exits at fair now often ARE the touch on USDC-GBP (LIVE at the touch in 17–35 % of snapshot-sides on most
     weekdays from 10-13, against 0–5 % before).

2. **The small-print bot is not hunting us. It pays makers, us included.**
   - From 2026-10-08, one counterparty trades the venue's minimum, **£0.10**, about **450 times a day** on USDT-GBP (9,084
     prints to 10-29), around the clock. It works in pairs: a sell at the best bid and a buy at the best ask **within 30 s**
     (4,219 pairs, 2,540 of them within 10 s), one pair about every **4.6 minutes** (median 276 s), buys 4,554 and sells 4,530. It crosses the whole
     spread every pair: it **loses** about 4 bps plus the 9 bps taker fee each print, about **£0.05 a day** in all.
   - **It carries no information**: fair 1, 5 and 30 minutes after its prints moved 0.00 ± 0.02, 0.00 ± 0.02 and −0.01 ± 0.06 bps
     in its favour (other prints of £1+: +0.06, +0.09, +0.04).
   - **It is venue-wide, not aimed at our book**: on 10-28 00:00–06:00 the same 0.10-of-the-quote-currency prints were 142 of 151
     on USDT-GBP, 150 of 153 on USDT-USD, 110 of 143 on ETH-GBP and 57 of 211 on BTC-GBP (none on USDC-GBP or USDC-USD). It looks
     like something that keeps a last-trade price or a volume figure alive, or an account kept active; which one cannot be told.
   - **What it does to us:** LIVE's USDT-GBP fills by a £0.10 print (10-08 → 10-29: 140 entries, 148 exits) then moved **+4.9 to
     +6.0 bps in LIVE's favour** at 30 minutes, about what LIVE's real fills do. Real fills that came within 120 s after a bot
     print did no worse: entries +6.0 ± 1.4 bps against +7.1 ± 0.8 without one (27 and 91 fills; the difference is inside the
     noise). Its only cost was mechanical: the dust trips' pennies (fixed by F1, 10-09) and rungs held by £0.10 of coin (fixed by
     the £1 holding line, live since 10-29 22:00). In money it is a few pence a month, in our favour.

3. **Can we do something like it? Two ideas are worth paper, the rest are not.** (Spoofing, layering, wash trading, quote
   stuffing and anything that trades with ourselves are excluded: none was considered.)

   | idea | what the recorded data say (2026-10-10 → 10-29, paper) | verdict |
   |---|---|---|
   | **A. Rest inside the other maker's quote on Revolut X, sell or buy back at once on Coinbase** | Revolut X's GBP books sit **5.3 bps (USDC) and 4.7 bps (USDT) under Coinbase's** in the median minute. A post-only bid one tick above Revolut X's best bid, filled by the prints, its coins sold at Coinbase's next bid (≤ 60 s): 40–77 fills a day a book, **+6.3 to +10.3 bps a fill after Coinbase's fee, positive on 19 of 19 days**, £2.8–3.6 a day a book at £100 a fill, £9.7–11.4 at £500. Before transfers. | **Paper, first.** Big if real; three unknowns could erase it (§4.2). |
   | **B. One more rung inside the other maker's quote, on LIVE's rules (Revolut X alone)** | LIVE's rules at £600 plus a 0.05 % rung: the committed tape (08-26 → 09-23) **+0.56 bps of capital a day under through-only fills (P ≤ 0 0.013) and +1.87 under at-price fills (P 0.000)**; the stored record 09-26 → 10-29 +0.10 / +0.45 (P 0.44 / 0.27), **+0.53 / +1.16 since the maker widened (10-13 →)**. The inner rung's trips earn 4.9–5.9 bps each. | **Paper twin.** Cheap: it is LIVE's code with one rung more. |
   | C. Take Revolut X's stale quote when GBP/USD moves (FX lead-lag) | 45–163 chances in 19 days by our one-minute fair; **−6 to −10 bps a trade net** of the 9 bps taker fee; 9–14 of them won. | No. |
   | D. Take both sides at once, Revolut X against Coinbase (pure arbitrage) | Revolut X's ask under Coinbase's bid by more than both taker fees (9.45 bps) against both Coinbase reads around it: 1,126 minutes on USDC-GBP and 2,197 on USDT-GBP (plus 682 the other way) of ~26,700. One trade every 5 minutes at most, £500: £1.5 (USDC) and £9.6 (USDT) a day before transfers, median 1.3 and 5.3 bps over the fees. | Second to A: A earns the same basis without paying 9 bps, and both need the same transfers. |
   | E. Small probe orders to find hidden size or our queue place | Revolut X shows the whole book (levels, size, order count); there is no hidden size to find. | No. |
   | F. Copy the £0.10 bot | It pays the spread on every pair. | No. |

   **What A needs before any money** (§4.2): Coinbase's taker fee on USDC-GBP / USDT-GBP for this account (the published stable
   pair tier is 0.10–0.45 bps; at a normal 0.6 % it is dead), moving coins from Revolut X to Coinbase and pounds back (Revolut
   X's published external withdrawal fee is £3 plus the network fee; USDC-GBP's flow is one-sided, about £8,300 a day of coins
   into Revolut X at £500 a fill, so two transfers a day would eat most of it; USDT-GBP's is near balanced), and Revolut X's
   1,000 orders a day.

4. **Coinbase and the others.**
   - **Coinbase's GBP stablecoin books are already one tick wide** (1.3 bps) in 70–97 % of minutes (by week), with about
     15,000–22,000 coins on each side's best level, 1–4 orders. A big maker owns them already; there is no room inside the touch.
   - **No £0.10 bot there**: 1.6 % (USDC-GBP) and 2.1 % (USDT-GBP) of Coinbase's prints are under £1 (10-19 → 10-30); its most
     common print sizes are round pound or dollar amounts (49, 1,200, 15, 16 USDT; 48.93, 16.74, 13.37 USDC).
   - **Coinbase and Kraken did not tighten in August: they were one tick wide (1.32–1.36 bps) in every week sampled from June
     to October** (§2.6). The change was Revolut X's alone, which supports a participant arriving there rather than a market-wide
     move.
   - Coinbase's role in A is the hedge venue: it is where Revolut X's discount is cashed.

**What should change in the live strategies now: nothing.** The bot costs LIVE nothing since the £1 holding line. The maker's
width change of 10-13 helps LIVE (wider room, exits at the touch). A and B go to Davies as paper proposals (§5).

## 1. Sources and method

- **Revolut X prints**: PR5's committed UK tape (`backtests/inputs/pr5_2026-09-23/trades/`: USDC-GBP from 2025-10-01, USDT-GBP
  from 2025-12-10, to 09-22) joined by id with REVX-FAIR's stored prints (`backtests/fair_price/data/prints.txt.gz`, to 10-29
  00:00 UTC). The database's `agent_quote_prints` was checked against the venue: 15,010 USDT-GBP and 2,495 USDC-GBP prints
  09-22 → 10-30, the £0.10 prints counted by day (221 on 10-08, then 298–484 a day).
- **Revolut X book**: REVX-FAIR's committed snapshots of `agent_book_levels` (five levels a side, read about :40 each minute,
  stored when changed; 09-26 → 10-29). There is no book record before 09-26, so the August change is read from prints alone.
- **Coinbase**: REVX-FAIR's committed `cb_touch` (10-10 → 10-29), and SQL on `cb_touch` and `cb_trades` (`sql/coinbase_books.sql`).
- **LIVE**: SQL only, counts and bps (`sql/ours_at_touch.sql`, `sql/live_fills_vs_bot.sql`); no LIVE order is committed.
- **Fair**: Revolut X's USD book's 24-hour median close ÷ GBP/USD (Exness minute mids to 09-22, then Yahoo's minute bars as PR5
  stored them), as PR5's engine prices it.
- **Public reads**: Revolut X's trades for six books (`scripts/bot_elsewhere.py`), Coinbase Exchange's and Kraken's public trades
  (`scripts/venues_hist.py`), web pages for Revolut news and fees (§6).
- Everything is in `docs/agents/backtests/mmcomp/` (scripts, SQL, results; `MANIFEST.json`).

## 2. The tightening (question 1)

### 2.1 From the prints, week by week (`scripts/tape_long.py` → `results/tape_long.json`)

`gap60` is PR5's study's measure: a buy print's price minus the sell print next to it within 60 s. `hspread` is each hour's
median buy against fair minus its median sell against fair (the median hour). `follow`: of two same-side prints 1–30 minutes
apart with fair moved ≥ 3 bps, the share whose price moved a tick or more the same way (a quote re-priced with GBP/USD).

| book | span | prints ≥ £1 a week | £ a week | gap60 bps | hspread bps | follow |
|---|---|---|---|---|---|---|
| USDC-GBP | 12 weeks before (W23–W34) | 292 | 510k | 18.2 | 19.9 | 0.71 |
| USDC-GBP | after, 5-tick maker (W36–W41) | 399 | 395k | 4.7 | 5.7 | 0.77 |
| USDC-GBP | after, 12-tick maker (W42–W43) | 599 | 537k | 11.0 | 13.6 | 0.78 |
| USDT-GBP | 12 weeks before (W23–W34) | 1,059 | 894k | 16.8 | 19.2 | 0.32 |
| USDT-GBP | after, 5-tick maker (W36–W41) | 988 | 654k | 4.7 | 4.0 | 0.53 |
| USDT-GBP | after, 12-tick maker (W42–W43) | 917 | 481k | 9.4 | 10.1 | 0.51 |

(medians of the weekly values.) The step is in one week on both books: USDT-GBP's hourly spread 23.9 bps in W34, 5.8 in W35,
5.8 in W36; USDC-GBP's 17.1, 7.3, 4.7. By day: USDT-GBP 21–29 bps on 08-18 → 08-21, 9.6 on 08-24, 11.1 on 08-25, 4.9 on 08-26;
USDC-GBP mostly 14–26 bps to 08-24 (3.7 on 08-20, from two hours), 11.4 on 08-25, 9.5 on 08-26, 4.2 on 08-27. The pound flow did not rise with it.

USDC-GBP's quotes already followed GBP/USD before (follow 0.71): some algorithm quoted it, wide. USDT-GBP's did not (0.32) and
started to (0.53): consistent with a GBP/USD-tracking quoter arriving there.

### 2.2 The maker's signature (`scripts/maker5k.py`, `scripts/book_now.py`)

- **Whole-order prints** of 5,000.0005–5,010 coins, by ISO week: USDC-GBP 2 in the 47 weeks to W34, then 9, 19, 8, 9, 20, 8, 14,
  9, 8 (W35–W43); USDT-GBP 9 scattered in the 37 weeks to W34, then 5, 18, 18, 18, 22, 24, 19, 14, 9. The first: USDT-GBP 08-20
  12:59 and 08-22 10:47, then 08-26/27; USDC-GBP 08-27 10:29. A plain 5,000.000000 print (a taker typing 5,000) is as rare after
  as before; the new prints carry the maker's decimals.
- **The same sizes rest in the book** (09-26 →): the commonest touch sizes over the window are 5,000.4–5,000.9 (USDC-GBP) and
  5,000.9–5,007.5 (USDT-GBP), one order each, and 5,000.78–5,000.83 on Revolut X's USDC-USD book too.
- **Its own spread** (best such ask minus best such bid): 5 ticks on every day 09-26 → 10-12 on both books (6 on Sunday 10-04
  on USDC-GBP), 12 ticks on every day 10-13 → 10-27 that showed both sides, on both, 5 / 8 ticks on 10-28. Its ladder: about two such orders in the five levels shown.
- **Its hours**: at the touch 49–63 % of weekday snapshots in every UTC hour on USDC-GBP, 16–35 % on USDT-GBP. No human gap.
- **It tracks GBP/USD**: the book's mid against fair over 10-minute steps has a slope of 0.4–0.8 on most weekdays (USDC-GBP; a
  tick is 1.3 bps, so small moves round away), and the touch re-prices in 350–840 minutes a weekday on USDC-GBP and 130–730 on USDT-GBP.

### 2.3 The touch since the record began (`results/book_now.json`)

| | USDC-GBP 09-28 → 10-12 | USDC-GBP 10-13 → 10-28 | USDT-GBP 09-28 → 10-12 | USDT-GBP 10-13 → 10-28 |
|---|---|---|---|---|
| touch, ticks (weekday medians) | 1–5 | 7–12 | 1–4 | 4–11 |
| coins within 10 bps of mid (weekday medians) | 21,000–103,000, mostly ~40,000 | 6,500–33,500, mostly ~10,000 | 27,000–60,000 | 7,000–27,000 |

### 2.4 How much of the touch is LIVE's (`sql/ours_at_touch.sql`)

LIVE's resting orders at the best bid or ask in each stored snapshot: USDC-GBP 0–5 % of snapshot-sides on every day to 10-12
(10.8 % once, 10-07), then 17–35 % on most weekdays from 10-13 (the exits at fair inside the widened quote); USDT-GBP 0–15 %
throughout. LIVE's share of the touch's coins never passed 0.22 %. LIVE did not tighten anything; it began five weeks after.

### 2.5 The alternatives, scored

| explanation | evidence | holds? |
|---|---|---|
| a new automated maker | whole-order prints from that week, fixed-width two-sided quote, all hours, one setting moved on both books on one day | **yes, strongly** |
| Revolut's own liquidity desk (internalisation) | indistinguishable from the above in public data | cannot be told |
| a fee change | the published 0 % / 0.09 % unchanged (§6) | no |
| more retail flow | flow flat or lower after | no |
| our orders | LIVE from 10-01, at the touch < 5 % before 10-13 | no |
| a market-wide change in GBP stablecoins | Coinbase and Kraken one tick wide before and after (§2.6) | no |

### 2.6 Did Coinbase and Kraken tighten too? No: they were one tick wide all along (`scripts/venues_hist.py`)

Two samples a week (Monday and Wednesday from 12:00 UTC, 1,000 trades each) of each venue's public trades, 2026-06-01 → 10-27,
the same `gap60`: **Coinbase USDT-GBP and USDC-GBP and Kraken USDTGBP and USDCGBP read 1.32–1.36 bps in every one of the 22
weeks**, which is one tick (0.0001 at £0.74–0.76), before and after 08-24 alike (136–761 pairs a sample). Their books were
already as tight as a tick allows; Revolut X's gap was about 13 ticks (17–18 bps) until 08-24 and about 3–4 ticks (4.7 bps) after.
So the change was Revolut X's alone, which fits one participant arriving there, not a market-wide shift in GBP stablecoins.

## 3. The £0.10 bot (question 2) (`scripts/bot.py` → `results/bot.json`, `scripts/bot_elsewhere.py`)

- **Size**: £0.09987–£0.10403, median £0.10000; the coins follow the price (0.13246 at 0.7550).
- **When**: 221 prints on 10-08, then 298–484 a day, weekends included; 307–467 an hour-of-day bucket over the window, busiest
  01:00–05:00 UTC. Pairs: 4,219 two-print bursts (a sell then a buy or the reverse, within 30 s, 2,540 within 10 s, never at the same price), 643
  single prints; the gap between bursts: 10th–90th percentile 246–564 s, median 276 s.
- **Where**: of those with a snapshot within 90 s, buys at the best ask 3,398, inside 157, through 143; sells at the best bid 3,290,
  inside 186, through 181. A buy and its paired sell are 1–10 ticks apart: it pays the touch.
- **Paid against fair**: a median 4.0 bps (other prints of £1+: 5.2).
- **Markouts**, + in the bot's favour, mean ± s.e.: on fair 1 / 5 / 30 min −0.004 ± 0.012, +0.001 ± 0.024, −0.006 ± 0.059; on the
  book's mid +0.03 ± 0.02, +0.03 ± 0.03, +0.02 ± 0.05. Other prints of £1+ on the mid: +1.49, +1.64, +1.37 (a sweep moves the
  mid). The bot moves nothing and knows nothing.
- **LIVE's fills, USDT-GBP 10-08 → 10-29** (`sql/live_fills_vs_bot.sql`), the book's mid 5 and 30 minutes after the fill against
  its price, + in LIVE's favour:

| leg | kind | a bot print in the 120 s before | fills | 5 min bps | 30 min bps (± s.e.) |
|---|---|---|---|---|---|
| entry | £0.10 fill | no / yes | 63 / 77 | +4.5 / +5.5 | +4.9 ± 0.8 / +6.0 ± 0.8 |
| entry | real | no / yes | 91 / 27 | +6.2 / +5.2 | +7.1 ± 0.8 / +6.0 ± 1.4 |
| exit | £0.10 fill | no / yes | 87 / 61 | +3.7 / +5.7 | +3.9 ± 0.6 / +5.7 ± 1.0 |
| exit | real | no / yes | 78 / 72 | +5.8 / +5.3 | +5.1 ± 0.8 / +5.4 ± 0.9 |

- **Elsewhere on Revolut X**, 10-28 00:00–06:00 UTC: prints worth exactly 0.10 of the quote currency were 142 of 151 on USDT-GBP,
  150 of 153 on USDT-USD, 110 of 143 on ETH-GBP, 57 of 211 on BTC-GBP, none on USDC-GBP (5 prints) or USDC-USD (10).

## 4. Can we do something like it? (question 3)

### 4.1 The books, recorded (`scripts/xvenue.py` → `results/xvenue.json`; 2026-10-10 02:00 → 10-29 00:00 UTC, 18.9 days)

Revolut X's mid against Coinbase's: median −5.31 bps on USDC-GBP (10th–90th percentile −11.4 to +0.7), −4.67 on USDT-GBP (−11.9 to
+6.7), over ~26,700 minutes. Revolut X's snapshot is read at about :40; Coinbase's at :00 and the next :00 bracket it.

### 4.2 A: rest inside the maker on Revolut X, hedge on Coinbase

The rule replayed: a post-only bid one tick above Revolut X's best bid (never at or through its ask), and never above Coinbase's
bid less m bps; the same on the ask side. A print at or through it fills it first in the queue (a print only at a price we would
have joined fills it only if it traded through), up to Q pounds and what Coinbase's touch holds. The coins go back at Coinbase's
next read (≤ 60 s later) at its bid or ask, paying 0.45 bps (the dearest published stable-pair taker tier). No transfer cost.

| book | m | Q | fills a day (bid / ask) | edge a fill, mean (10th pct) | £ a day | days > 0 | halves, £ a day | net coins into Revolut X, £ a day |
|---|---|---|---|---|---|---|---|---|
| USDC-GBP | 0 | 100 | 52.3 (734 / 254 in all) | +6.78 (−0.45) | 2.77 | 19 / 19 | 1.47, 4.07 | 2,194 |
| USDC-GBP | 2 | 100 | 45.4 | +8.05 (+2.21) | 2.83 | 19 / 19 | 1.53, 4.13 | 2,450 |
| USDC-GBP | 2 | 500 | 45.4 | +8.05 | 9.87 | 19 / 19 | 5.37, 14.36 | 8,947 |
| USDT-GBP | 0 | 100 | 76.8 (762 / 689) | +6.33 (−0.45) | 3.47 | 19 / 19 | 2.51, 4.44 | 83 |
| USDT-GBP | 2 | 100 | 56.9 | +8.90 (+2.21) | 3.63 | 19 / 19 | 2.58, 4.68 | 1,143 |
| USDT-GBP | 2 | 500 | 56.9 | +8.90 | 11.42 | 19 / 19 | 8.95, 13.90 | 4,843 |

The same fills closed on Revolut X instead, at its mid 30 minutes later (no hedge, no fee; an upper bound): +4.4 to +5.8 bps a
fill, £1.6–2.5 a day at £100.

**Why to doubt it.**
- **Transfers.** Buying on Revolut X and selling on Coinbase leaves coins on Revolut X and pounds on Coinbase. USDC-GBP's flow is
  one-sided (bids 734, asks 254): at £500 a fill about £8,300–8,900 of coins a day must move. Revolut X's published external
  withdrawal fee is £3 plus the network fee (§6; whether it applies to USDC and USDT, and to this account, is not confirmed). Two
  transfers a day at ~£4 is ~£8, nearly the whole £9.9. USDT-GBP's flow is near balanced at £100 (£83 a day net), so it would
  need few. Pounds from Coinbase back to Revolut X go through a bank.
- **Coinbase's taker fee for this account on these pairs is not read** (`agents?action=cblive&mode=probe` reads
  `transaction_summary`; reference §4 item 67). The 0.45 bps here is the dearest stable-pair tier; at a non-stable 0.6 % every
  row is negative.
- **Order budget.** Revolut X allows 1,000 orders a day; re-pricing one tick above a touch that moves in 130–840 minutes a day,
  two sides, two books, needs more. One book and one side, or a lazier re-price, fits.
- **The other maker can answer** a quote one tick inside its own; nothing here models that.
- **Nineteen days** of one regime, at minute resolution. The hedge's price is a minute-old read.
- Why the basis persists at all is the open question: a 5 bps discount anyone with both accounts could take suggests the
  frictions above are real.

### 4.3 B: one more rung inside the maker, on LIVE's rules (`scripts/inner_rung.py` → `results/inner_rung.json`)

PR5-OPT's LIVE-realistic engine (`backtests/pr5_opt/scripts/sim.py`, unchanged), LIVE's rules at £600 (exits a tick beyond fair,
the £1 holding line), with a rung at 0.03 % or 0.05 % added on both sides of both books, the £600 spread over all the rungs.
Paired by UTC day, bps of capital a day, circular 3-day block bootstrap (seed 20261030), 90 % band and P(≤ 0):

| window | fill | base bps/day | +0.05 % rung: Δ, [90 %], P(≤ 0) | its trips, bps each | +0.03 % rung: Δ, P(≤ 0) |
|---|---|---|---|---|---|
| HIST 08-26 → 09-23 (tape) | through | 5.51 | **+0.56** [+0.13, +0.99], 0.013 | 205, 4.85 | +0.25, 0.13 |
| HIST | at | 6.86 | **+1.87** [+1.22, +2.49], 0.000 | 313, 5.73 | +1.81, 0.000 |
| HIST | at, half the print | 6.76 | +1.69 [+1.05, +2.29], 0.000 | 308, 5.70 | +1.61, 0.000 |
| FWD 09-26 → 10-29 (stored) | through | 10.34 | +0.10 [−1.10, +1.18], 0.44 | 318, 5.32 | −0.48, 0.75 |
| FWD | at | 14.06 | +0.45 [−0.65, +1.62], 0.27 | 444, 5.89 | +0.24, 0.38 |
| FWD | at, half the print | 13.77 | +0.56 [−0.55, +1.73], 0.22 | 434, 5.78 | +0.33, 0.32 |

FWD split at the maker's widening: the 0.05 % rung −0.31 / −0.22 / −0.09 before 10-13 and **+0.53 / +1.16 / +1.25 from 10-13**
(through / at / half). FWD's prints include LIVE's own fills; the engine does not take them out. Rule D's 0.03 % rungs (arm `d`,
`reviews/2026-10-28-pr5v-ruled-readings.md`) made about 4 bps a trip on $100 and failed its day-by-day bar (P 0.18): the same
direction, small.

### 4.4 C and D (`results/xvenue.json`)

- **C, FX lead-lag taker** (Revolut X's ask more than 9 + m bps under fair, or its bid over; closed at the mid 30 minutes later,
  one trade per 30 minutes at most): USDC-GBP 88 trades, −8.1 bps mean, 12 won (m 0); 45, −6.1, 9 won (m 3). USDT-GBP 162, −10.2,
  14 won; 111, −9.1, 13 won. The "stale" quote is usually our fair being a minute late, not the book. FX-SPEED found the same for
  quoting (`reviews/2026-10-29-fx-second-sources.md` §7).
- **D, taker both sides at once**: in §0's table. Excess over the fees in the qualifying minutes is small on USDC-GBP (median
  1.3 bps) and larger on USDT-GBP (5.3 bps), whose Revolut X book is the wider one.

### 4.5 What is excluded

Spoofing (orders not meant to trade), layering, quote stuffing, wash trades or anything that trades with ourselves, and
"momentum ignition" were not considered. A post-only order one tick inside the best price that we are ready to have filled is
ordinary price improvement; A and B are only that.

## 5. Recommendation: two paper tests, nothing live

1. **B first (cheap).** A twin on LIVE's rules with a 0.05 % rung both sides, USDT-GBP alone at £600 as LIVE now trades, against
   LIVE's own twin from the same minute. Sketch of its pre-registration (`reviews/TEMPLATE-variant-prereg.md`): 28 days;
   primary: paired daily bps of capital, block bootstrap P(≤ 0) < 0.10; report the inner rung's trips and bps each, the other
   maker's width each day (5 or 12 ticks, from `agent_book_levels`), dust trips and the POST count against the governor. It
   needs the paper engine to quote a fourth rung, a new engine variant like rule D's instance, so it is a build, not two
   statements.
2. **A as a recorder-backed paper engine** (no keys): each minute, from `agent_book_levels`, `agent_quote_prints` and `cb_touch`,
   the bid and ask of §4.2 at m = 2, £100 a fill, one book at a time (USDT-GBP first: balanced flow), the hedge at Coinbase's next
   read plus 0.45 bps, and a transfer cost of £4 for every £5,000 the inventory drifts. 28 days; continue only if P&L after
   transfers > 0 with a day bootstrap P(≤ 0) < 0.10. **Before any money, Davies checks three things in the apps**: Coinbase's
   taker fee on USDT-GBP / USDC-GBP for his account, Revolut X's withdrawal fee and networks for USDT and USDC, and that he wants
   coins on two venues at once.

D is A's riskier cousin and waits on the same three answers. C, E and F: no.

## 6. Web sources

- Revolut X fees: 0 % maker, 0.09 % taker, external crypto withdrawal £1 or £3 plus network
  (https://www.revolut.com/legal/crypto-exchange-fees/, https://cdn.revolut.com/terms_and_conditions/pdf/revolut_x_fees_e1faa627_1.0.3_1754040368_en.pdf).
- Revolut X with AI assistants, June–July 2026 (https://www.revolut.com/blog/post/revolut-x-connects-with-your-ai-assistant-uk/,
  https://theblock.co/post/407865/revolut-integrates-its-crypto-exchange-with-ai-assistants-as-agentic-trading-spreads).
- Revolut's 1:1 USD–stablecoin swaps, October 2025 (https://cointelegraph.com/news/revolut-launches-1-to-1-usd-to-stable-swaps).
- No page found on a Revolut X market-maker programme or a 2026 fee change.

## 7. Not checked

- Who the maker is; whether it also quotes the EEA books.
- The book before 09-26 (no record); the maker's August quote width is inferred from prints.
- Coinbase's real taker fee for this account; Revolut X's withdrawal fee for USDC/USDT on this account.
- A's fills against our own queue on Coinbase, the other maker's reaction, sub-minute timing.
- B with LIVE's own orders taken out of the FWD prints.
