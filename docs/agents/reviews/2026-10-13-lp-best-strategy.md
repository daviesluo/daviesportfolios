# LP-BEST: the best Polymarket reward strategy on all the evidence, and whether it is worth running

Research only (2026-10-13, read 00:10–01:30 UTC). The live path stays stopped: no order was placed or cancelled, no
config row changed, nothing deployed. Every database read was a read-only `select`; every Polymarket read was a keyless
public GET. Scripts, SQL and outputs are in `docs/agents/backtests/lpbest/` (`MANIFEST.json`). The pm-rec archive
(books, prints and the 15-minute programme listing, 2026-10-04 19:00 → 10-12 23:59 UTC, 197 hours a kind, every object's
sha256 checked) was downloaded to a scratch folder and is not committed. Code read at `f55e67a2`: `pm_lp.ts`,
`pm_live.ts`, `pmrw.ts` (hashes in the manifest). Not blind: LP-ADVERSE and LP-SPEED were read first. Nothing here is
applied: Davies decides.

Davies, 2026-10-13, verbatim:

> live rewards继续停止，并继续研究最好的策略，所有地方都可以改，所有数据都可以用，然后给我讲讲我再评估下

In English: keep live rewards stopped and keep studying the best strategy; anything may be changed and all data may be
used; then explain it to me and I will evaluate.

## The answer in plain words

- **What lost money was not bad luck.** Quoting a tick inside the touch of Polymarket's reward markets loses money
  across the whole reward universe, not only in live-prep's picks. Over 4,815 market-days the rewards cover about 60 %
  of what the fills lose in the next hour, and about 45 % of what they lose in four hours. The markets that promise the
  most reward lose the most, so ranking by reward per dollar picks the worst first.
- **The best thing found is small and different: quote only quiet books.** These are markets where at most 50 shares
  changed hands in the last 24 hours and the touch is at least 4 ¢ wide. Rest RW's quote of N a side there, about
  eleven markets a day, and nothing in busy books.
- **Why it should work where live-prep failed.**
  - The one-shot takers who did 97 % of the damage (LP-SPEED) trade where the news and the volume are, not in books
    nobody trades.
  - A wide, quiet book pays rewards at a better share for the same N.
  - Live-prep was paid 0.66 ¢ a filled share. This rule earns about 2.9 ¢ a filled share in the simulator.
- **How much, and how sure.** At the $316 equity it makes about **+$3.6 a day** in the simulator: 5–95 % over
  market-days +$1.4 to +$6.0.
  - Chosen on 10-05 → 10-08 (+$4.10), it made +$4.23 on 10-09 → 10-12, the live days, where live-prep's own rule made
    −$20.38.
  - Its worst day was −$10.34 and its days swing by about $6.
  - It does not grow with money: at $400 about the same, at $1,000 worse, because there are only about a dozen good
    quiet books a day.
  - It is eight days of record. The R Polymarket pays in quiet books has never been measured, and pm-rec recorded these
    markets for about half of each day. **I would not call it proven.**
- **What it risks.** About $230 of capital in resting quotes and a little stock, $10 on a bad day, and a stop.
- **What would decide it.** A dry-run day, then 14 live days at the current size, judged on three things:
  - the total ≥ $0;
  - rewards ≥ 1.5 ¢ a filled share;
  - no day worse than −$15, with a −$25 stop.
  Its expected 14-day result is about +$50.
- **The honest alternative is to stop.** At this size Polymarket rewards are worth at most about $3–4 a day, and only
  in quiet books. The rule that ran (−$21 a day live) should not come back in any form. If $100 a month is not worth a
  build and a two-week test, ending Polymarket rewards is a sound decision.

## Verdicts

| question | answer |
|---|---|
| Can one simulator reproduce live? | Yes, within the tolerance set first (±$5 a day): the engine runs live-prep's own rule on live's own picks at **−$24.96 a day**, live made **−$21.77**; out of sample in time −$78.02 against −$75.13 for 10-11 + 10-12 (section 1) |
| Is the loss specific to live-prep's picks? | No. Over the universe, quotes a tick inside lose −$108 a day at 60 minutes and −$230 at 240; break-even needs R 0.68–0.96 where live got 0.42 (section 2) |
| Do the structural ideas fix it? | Band edge, paired quoting with merges, tighter inventory, size, toxicity-weighted selection, far-from-resolution: none is positive in busy books (section 3) |
| What is the best strategy? | **Quiet books** (section 4): +$3.62 a day [+$1.38, +$6.02] at $316; TEST +$4.23 [+$1.57, +$7.12]; worst day −$10.34 |
| Is it worth running? | **Marginal.** Positive on TRAIN, on TEST, with R and fill volume moved and without its best market; small in dollars; three things only live can measure. A 14-day test, or stop |

## 1. The one simulator, and how it was checked against live

**What it is** (`scripts/lib.py`, `scripts/engine.py`). A minute-by-minute engine over pm-rec's whole reward record:
every recorded book of every market whose minimum was 50 shares or less on some day (16,926 markets, 31.1 million
market-minutes, 2026-10-04 19:00 → 10-12 23:59 UTC), every taker print (598,585), and the programme the listing
showed every 15 minutes (13.8 million readings, `universe` objects; `results/extract.txt`). One pot of capital, every
market a policy holds or quotes, in rank order each minute:

- **Reward**: Polymarket's own rule (docs, read 2026-10-13): `S = ((v − s)/v)²` from the size-cutoff midpoint, our
  bid side `Q1` and ask side `Q2`, `Q_min = max(min(Q1, Q2), max(Q1, Q2)/3)` inside 0.10–0.90, else `min`. Others'
  score from the recorded book, as live's code scores it. The programme in force each minute, not the 00:00 one.
- **Fills**: a taker print meets what rests from about t+7 s to t+67 s (the live turn's cancel-and-post cycle). A
  quote better than the touch is hit by every taker of its side whose price reaches it; one at or behind the touch fills
  only after the size ahead of it, with price-time priority from the book it was posted into.
- **Money**: cash, position and cost per market; marks at the raw midpoint; rebates on the published schedule, scaled
  to what live was paid (0.85).

**Calibration on live's own orders** (`scripts/calib.py`, `results/calib.txt`). Live's 21,527 orders (each with its
resting interval, `sql/live_orders.sql`; 16 rejected left out) through the fill rule on pm-rec's tape, live's orders
taken out of the book:

| | live | simulator |
|---|---:|---:|
| fills | 436 | 330 |
| shares | 6,966 | 5,430 |
| 60-minute markout | −$194.71 (−2.80 ¢ a share) | −$148.41 (−2.73 ¢ a share) |

- 313 of the simulator's 330 fills are live's own (same market, side and price, within 15 s). The 17 it adds lost
  2.89 ¢ a share; the 123 live fills it misses lost 3.20 ¢. The rule finds the right fills at the right price and sees
  78 % of the volume, so **k_vol = 1.283** scales every simulated fill.
- **No extra flow at the touch.** Live's fills a minute while it rested better than the touch, against what the same
  rule fills on the same markets when nothing of ours was there: k = 0.81 [0.41, 2.25]. Improving the touch by a tick
  did not bring takers who would not have come.
- **What Polymarket pays.** Over 99 live market-days (10-10 → 10-12), paid = 0.51 × the two-sided formula + 0.05 × the
  one-sided third (least squares). The one-sided third earned nothing measurable, so the engine pays two-sided minutes
  only. Paid over the two-sided formula: 0.614 [0.543, 0.746].

**Validation: live-prep's own rule on live's own selections** (`scripts/validate.py`, `results/validate.txt`). The
engine runs the rule as it stood addendum by addendum (RW's price, N, 5N, TB1, the pause, the reward check from
Addendum 9, AI out from Addendum 12, the loss guard from Addendum 14, $320, the stop at 07:30) on the markets live
picked and refilled each day, 10-09 01:33 → 10-12 22:49:

| | live | engine |
|---|---:|---:|
| fills / shares | 436 / 6,966 | 407 / 6,954 |
| 60-minute markout | −$194.71 | −$164.68 |
| fills marked to 22:49 | −$129.43 | −$139.66 |
| a quoting day: fills + rewards + rebates | **−$21.77** | **−$24.96** at R 0.420 (−$18.40 at 0.614) |

- The engine quotes more two-sided minutes than live managed: live lost minutes to its cancel-and-post gap, funding,
  rejected orders and missed turns. Live's payout over the engine's own formula is **R = 0.420**, every friction of the
  live path in it, and every strategy below is priced at it.
- **The tolerance I set before pricing anything was ±$5 a day; the gap is $3.19.** The engine's market bootstrap of
  live's rule runs −$37 to −$2 a day around it.
- **Out of sample in time**: R from 10-10 alone (0.452), then the engine's 10-11 + 10-12: −$78.02 against live's
  −$75.13.
- **The engine on its own selection** (RW's ranking, the same rule, $236 of cap) reads −$20.38 a day on 10-09 → 10-12
  (`results/ranking_api.txt`): live-prep unchanged loses about what it lost, whoever picks the markets.

**What the record cannot see.**

- Books between minute snapshots; queue position beyond the rule; anything Polymarket does not show in the book and
  the tape.
- pm-rec records a market's book only while it is in the recorded set (paying $10 or more, under a cap ranked by
  rate). Within a recorded minute the tape is about complete: of the data API's 43,605 prints for the section 4
  candidates (10-05 → 10-12 22:00), 27,117 (62 %) fall in minutes pm-rec recorded the book, and pm-rec holds 26,286
  prints for those markets (`results/tapecheck.txt`).
- The rest happened while pm-rec was not recording the market: no book, so the engine quotes nothing then, and earns
  and fills nothing then.

## 2. Where the reward money is, over the whole universe

`scripts/daytable.py` takes every market-day of live-prep's universe at 00:00 (rate ≥ $10, N ≤ 20, no weather, no AI,
no game within two days): **4,815 market-days over 2,335 markets**. Each is quoted two-sided with N a side, every
minute the touch is at least two ticks wide, statelessly (no cap, no stock), at five places, and priced at R 0.42
(`results/universe.txt`; $ a day over the 8 days):

| placement | formula | rewards | filled shares | fills at 60 min | net at 60 min | net at 240 min |
|---|---:|---:|---:|---:|---:|---:|
| a tick inside the touch (RW, live's) | $424.7 | $178.4 | 19,092 | −$286.9 (−1.50 ¢) | **−$108.4** | −$229.6 |
| at the touch | $267.4 | $112.3 | 9,688 | −$235.9 (−2.43 ¢) | −$123.5 | −$259.2 |
| 1 tick behind | $147.8 | $62.1 | 3,048 | −$79.1 (−2.59 ¢) | −$17.0 | −$50.5 |
| 2 ticks behind | $83.3 | $35.0 | 1,896 | −$55.1 (−2.91 ¢) | −$20.1 | −$36.1 |
| 3 ticks behind | $55.0 | $23.1 | 1,415 | −$35.1 (−2.48 ¢) | −$12.0 | −$15.7 |

- **Quoting reward markets near the mid loses money at the R live was paid, and not only in live-prep's picks.**
  - At RW's price the rewards cover 62 % of the 60-minute adverse move and 44 % of the 240-minute one.
  - Break-even needs R 0.68 (60 minutes) or 0.96 (240) in the engine's units. Live got 0.42, and 0.61 with no friction
    at all.
- **By what was knowable at 00:00** (RW's price; net at 60 minutes a market-day):
  - **type**: elections +$0.03 (1,912 market-days), earnings/econ −$0.06, sports −$0.11, news/geo −$0.20 (2,064);
    view-count −$3.52, box office −$3.55, statements −$4.50.
  - **the prior 24 hours' taker volume** (pm-rec's tape): none −$0.02 (2,515 market-days); 1,000–5,000 shares −$1.52.
  - **the prior day's range**: 3–6 ¢ +$0.00; over 20 ¢ −$0.76.
  - **days to the end**: under 3 −$3.83; 30–90 −$0.03.
  - **the formula estimate at 00:00**: the more a market promises, the more it loses (over $30 a day: −$6.23 a
    market-day). RW's per-dollar ranking puts the worst first: its top fifth lost $593 of the $868 all five lost over
    the eight days.
  - **our share of the pool at 00:00**: 30 % and over −$0.65; under 1 % −$0.05.
  - **the mid**: near zero at the extremes, where only two-sided quotes score: under 0.05 +$0.14 (100 market-days),
    0.05–0.10 +$0.03 (249), 0.90–0.95 −$0.10 (89), over 0.95 +$0.57 (11).
- **Persistence is weak.**
  - A market's taker volume one day against the next: correlation 0.29.
  - The takers' markout a share one day against the next: 0.10. Yesterday's toxicity says little about today;
    yesterday's volume says more.
- **A search of 8,260 rules** of up to three conditions at five placements, chosen on 10-05 → 10-08 and read on
  10-09 → 10-12 (`results/search.txt`):
  - The 25 best on TRAIN all lose on TEST. They are high-share markets at RW's price.
  - TRAIN and TEST agree only weakly: correlation 0.38 over every pair.
  - What is positive on both is small and in one place: **quiet books** (little traded the day before, a wide touch),
    quoted at RW's price or behind the touch.
- The same tables with the data API's tape for the 1,195 quiet-rule candidates (`results/universe_api.txt`,
  `results/search_api.txt`) read the same: −$108.8 a day at RW's price.

## 3. Each structural idea, with its mechanism and its number

Priced in the engine at the current equity ($316; cap $236, the equity less the $80 the stop keeps), chosen each UTC
day at 00:00. TRAIN = 10-05 → 10-08, TEST = 10-09 → 10-12 (the live days). $ a day [5 %, 95 % over market-days]
(`results/runs_base.txt`).

**Quoting at the edge of the band.**

- **The mechanism.** Polymarket scores `((v − s)/v)²`. At v = 4.5 ¢ a quote 1 ¢ from the midpoint scores 0.60 of the
  best, at 2.5 ¢ 0.20, at 3.5 ¢ 0.05. A quote behind the touch fills only when a taker has already gone through
  everyone ahead of it, which is exactly the one-shot taker LP-SPEED found doing 97 % of the damage.
- **Over the universe** (section 2) one tick behind nets −$17 a day against RW's −$108, but only because it barely
  trades. Its fills lose 2.6 ¢ a share, more than RW's 1.5 ¢.
- **In the engine:** entries 1 tick behind −$6.47 TRAIN / −$10.18 TEST; 2 ticks −$6.64 / −$8.24; at the touch
  −$13.23 / −$21.80. **No placement is positive in busy books.**
- **In quiet books** (section 4) a tick behind stays positive but small: +$0.46 a day on the whole span, against
  +$3.62 at RW's price (`results/ranking_api.txt`, Q4). There the fills were cheap anyway, and the reward lost is the
  larger number.

**Paired quoting and merging.**

- A BUY of NO at 1 − a is an ask at a in the one book (reference §2d), and Polymarket scores it as one: `Q_two` takes
  asks of YES and bids of NO alike. Bidding YES and NO is the two-sided book live-prep already quoted.
- A filled pair merges to $1, but the money is the same. Selling YES at a, or buying NO at 1 − a and merging, both
  leave a in cash. Merging frees capital only.
- On the live record the pairs held peaked at 24.4 ($24.42 a merge would have returned). Held at cost peaked at
  $310, so a merge frees at most 8 % of it (`results/merge.txt`). **No edge; a small capital tool.**

**Inventory that frees the cap.** Live-prep's carried stock held the cap (LP-ADVERSE: 68 % of its market-minutes were
carried).

- Tighter caps cut the loss but do not make it positive in busy books: 1N −$3.38 / −$17.52, 2N +$0.74 / −$20.63,
  against 5N's +$7.45 / −$20.23 (TRAIN / TEST).
- Never exiting at all (a diagnostic) gives +$14.55 / −$5.87. The exits are picked off, as LP-ADVERSE found, but
  holding trades that for the luck of the carry.
- In quiet books the cap barely matters: 1N, 2N and 5N read +$3.83, +$4.10 and +$4.10 on TRAIN
  (`results/choose_api.txt`), because they fill little. 2N is the safer one.

**Market selection by measured toxicity.**

- From the tape, the prior day's taker volume is the one signal that holds (section 2). The takers' markout a share
  does not persist (correlation 0.10).
- Selection on reward less the prior day's volume, or less the takers' markout: +$12.46 to +$15.95 TRAIN, −$16.69 to
  −$20.76 TEST. It only moves the same busy markets around.
- **What works is leaving the busy markets out altogether** (section 4).
- "Rate per unit of toxicity" instead of rate per dollar: RW's per-dollar ranking picks the most toxic fifth first
  (section 2). Within quiet books the per-dollar ranking is fine, because the toxic ones are no longer candidates.

**Size.** The score is linear in size, so a larger quote takes a larger share of the pool. The fills are not linear:
the takers who go through a larger order are the large, informed ones (LP-ADVERSE: −6.65 ¢ a share at 5–20 times our
size, −11.3 ¢ at 20 times and more).

- In busy books: 2N −$7.31 / −$34.16; 2N a tick behind −$8.85 / −$17.21; 3N two ticks behind −$12.94 / −$19.54.
- In quiet books 2N reads +$4.07 TRAIN / +$6.61 TEST against N's +$4.10 / +$4.23 (`results/proxy_api.txt`). That is
  more on TEST, but its TRAIN range runs below zero ([−0.28, +9.52]) and it holds twice the stock, so the bound picks N.
- **In busy books N, the programme's minimum, is the right size. In quiet books 2N may pay more at twice the risk: a
  later step, only if the test passes.**

**Competition.** Our share of the pool at 00:00 against what quoting there did: under 1 % −$0.05 a market-day, over
30 % −$0.65. A pool we would own is a thin book, and a thin book is where one taker sweeps us. The R we are paid
already counts the others: it is our share of each minute's scores.

**Far from resolution, the mid's extremes, the hours.**

- Days to the end under 3: −$3.83 a market-day, the worst bucket. But "at least 14 days" as a filter reads −$5.91 /
  −$14.97.
- Mids under 0.10 or over 0.90 net about zero over 449 market-days (section 2): nothing to build on, and one
  resolution there costs the whole side.
- The hour of the day was not split here.

**Speed.** LP-SPEED: one-shot takers did 97 % of the markout loss; a 1–30 s loop is worth +$0.3 to +$2.0 a day at
most. Not repeated.

**Other ways to earn from the venue.**

- Maker rebates come with fills: 0.19 ¢ a filled share on the live record ($12.96 on 6,966 shares). They follow
  fills, not the other way round.
- Holding rewards pay 4 % a year on 309 markets (reference §3.33): $0.03 a day on $316.
- Single-sided quotes score a third, but on the live record that third was paid at 0.05 of its formula (section 1).
  Nothing to build on.

## 4. The best strategy found: quiet books

**The rule** (`results/choose_api.txt`, `results/detail_api.txt`):

- **Universe:** live-prep's at 00:00 (rate ≥ $10, N ≤ 20, no weather, no AI, no game within two days), and:
  - **at most 50 shares traded in the last 24 hours**, read from Polymarket's data API (every print, recorded by pm-rec
    or not; `scripts/apitape.py`);
  - **a touch of at least 4 ¢** at 00:00.
- **Rank:** RW's reward per dollar of first quotes. Whole markets inside 90 % of the cap, about eleven a day at $236.
- **Quote:** RW's price (a tick inside the touch), N a side. Entries only while the raw touch is at least 4 ¢ (this
  replaces TB1's one-tick skip); exits always rest.
- **Inventory cap 2N.** Stage 2 below picked 5N by a cent of the bound. 2N reads the same within a cent at $316,
  better at $1,000, and holds less.
- **Keep:** the reward check, the pause, the loss guard and AI out, as now.

**How it was chosen.** On TRAIN only, in two stages, each by the highest 5 % bound of the market-day bootstrap:

- 48 choices of which books (volume threshold × touch × neg-risk × ranking), then 72 of how to quote (placement ×
  inventory cap × size × the 10 ¢ hour × markets).
- Picking by the mean instead chooses the luckiest carried stock: +$19.77 on TRAIN, +$1.13 on TEST
  (`results/choose_by_mean_api.txt`).
- **First run, on pm-rec's own tape**, where "quiet" meant no print recorded the day before: the same procedure chose
  "no print, touch ≥ 4 ¢" and read +$2.79 TRAIN, +$2.97 TEST, +$2.82 the whole span (`results/choose.txt`). But
  pm-rec's tape has no prints while a market is out of its recorded set: of the data API's trades in those picks'
  markets it held 41 %, against 85 % in busy markets (`results/tapecheck.txt`). Gaps looked like quiet. So the rule
  was chosen again with quietness read from the data API (`scripts/apitape.py`), as a live path would read it.
- The bound picks the steady one. Read once on TEST:

| span | $ a day [5 %, 95 %] | rewards | fills | rebates | filled shares a day | worst day | peak capital |
|---|---|---:|---:|---:|---:|---:|---:|
| TRAIN 10-05 → 10-08 | +4.10 [+1.67, +7.12] | 4.02 | −0.15 | 0.23 | 149 | +2.25 | $217 |
| **TEST 10-09 → 10-12** | **+4.23 [+1.57, +7.12]** | 3.92 | +0.09 | 0.21 | 111 | −4.61 | $229 |
| the whole span | +3.62 [+1.38, +6.02] | 3.97 | −0.58 | 0.23 | 136 | −10.34 | $234 |

- **Day by day** (the whole span): +5.00, +3.08, +6.08, +2.25, +6.95, +7.28, −10.34, +8.64. Mean +$3.62, standard
  deviation $6.03.
- **Concentration.** 87 markets over the span. The best is 18 % of the total and the best five 54 %. Without the best
  five it is still +$1.66 a day. By type: news/geo +$17.85, elections +$7.27, econ +$2.82, sports +$1.98, box office
  +$1.85, statements −$0.89, view-count −$1.93 (over 8 days).
- **Its neighbours on TEST**: 10 of the 12 nearby thresholds (volume ≤ 0.5 / 20 / 50 / 200 shares × touch ≥ 3 / 4 / 5 ¢)
  are positive, +$1.63 to +$4.84. The two that are not keep a 3 ¢ touch, at −$0.98 and −$0.29.
- **R and fill volume moved** (the whole span): R 0.30 → +$2.48; R 0.61 → +$5.41; fills × 1.0 or × 1.6 → +$3.96,
  +$4.03. It does not hang on either calibration.
- **What the path itself would see.**
  - Gamma's `volume24hr`, which the selection already reads, does not identify these books. Of the books the data
    API calls quiet, Gamma puts only 29 % at $50 or less of 24-hour volume. Selecting on Gamma's figure reads −$0.41
    a day (`results/proxy_api.txt`).
  - The data API does: one keyless GET per candidate (`/trades?market=<condition>`).
  - The path's own $2.50 formula floor at 00:00 changes nothing: every pick clears it (+$4.10 TRAIN, +$4.23 TEST).
- **Not counted, either way.** pm-rec recorded the picked markets for 56 % of each day on average (median 52 %), and
  the engine quotes only those minutes. A live path quotes all day. If the other half of the day is like the recorded
  half, rewards and fills both about double. That is an upside, not part of the estimate.

**Why it should hold, mechanically.**

- A book that barely traded yesterday is a book the informed takers are not watching.
- A touch of 4 ¢ or more means our quote a tick inside it stands at least 1 ¢ from the midpoint. A taker who does
  come pays real spread. The quote still scores: 0.60 of the best at 1 ¢ with v = 4.5 ¢, less further out.
- Live-prep was paid 0.66 ¢ a filled share; this earns 2.92 ¢. The fills lose 0.2 ¢ a share at 60 minutes, against
  live's 2.8 ¢.

**What it cannot show.**

- **R in quiet books.** R was measured on live's markets, which were busy. A thin book may score us more or less than
  the formula says, and others may move in once we are there.
- **Eight days of record.** The test would be 14.
- **Only half of each day recorded** (above).

## 5. The ranking

Every candidate in the same engine at R 0.42 (`results/ranking_api.txt`). The quiet rule is chosen as section 4 says;
the others are LP-ADVERSE's packages and the rule that ran. $ a day [5 %, 95 % over market-days]; the cap is equity less
$80; markets scale with the cap.

| | the whole span $316 | TEST $316 | worst day ($316, span) | capital used | $400 (span) | $1,000 (span) | go / no-go |
|---|---|---|---:|---:|---|---|---|
| **Q quiet books** | **+3.62 [+1.38, +6.02]** | **+4.23 [+1.57, +7.12]** | −10.34 | $234 | +2.64 [−0.41, +5.50] | −1.48 [−9.98, +5.60] | **go for a 14-day test, or stop** |
| Q2 quiet books, 2N cap (proposed) | +3.61 [+1.38, +6.02] | +4.23 [+1.57, +7.12] | −10.34 | $234 | +2.64 | +1.41 [−3.62, +5.92] | the version to test |
| Q3 neighbour: no trade at all in 24 h | +2.31 [+1.12, +3.49] | +1.72 [−0.23, +3.59] | | | +2.13 | −0.08 | weaker |
| Q4 quiet books, a tick behind | +0.46 [−0.03, +0.85] | +0.53 [+0.32, +0.73] | −1.29 | $207 | +0.64 | −0.14 | not worth a build |
| P1 (LP-ADVERSE: 10 ¢ hour, touch ≥ 3 ¢) | +3.92 [−10.36, +24.22] | −10.13 [−23.40, +0.46] | −37.60 | $190 | +4.28 | +8.69 | no: a coin toss with a −$38 day |
| P2 (P1, view-count and statements out) | −2.46 | −7.83 | −40.09 | $154 | −1.43 | +4.76 | no |
| P4 (P1, entries a tick behind) | −2.41 | −3.72 | −17.90 | $113 | −2.41 | +0.45 | no |
| A0 live-prep unchanged | −6.05 [−20.35, +11.09] | −20.38 [−38.96, −5.11] | −58.77 | $236 | −9.75 | −6.85 | no |
| not restarted | 0 | 0 | 0 | 0 | 0 | 0 | the default |

- **On RW-C's record** (its own picks, 10-08 → 10-12): live-prep's rule −$46.08 a day; P1 +$1.33 [−11.53, +13.57].
  Only 2 of RW-C's 70 picks were quiet books, so RW-C's record cannot test the quiet rule.
- **Days of live record each conclusion needs.**
  - "Live-prep's rule loses": already shown, by 3.25 live days and by the engine on 8.
  - "The quiet rule is not negative": with a mean of $3.62 and a daily spread of $6.03, about 8 days to see it at 95 %
    if the simulator is right, and 17 days for an 80 % chance of seeing it.
  - "R in quiet books": three or four daily readouts give it to about ±30 %.
  - So 14 days.

## 6. Go or no-go, and what else the money could do

- **Not worth it at this size, in any busy-book form.** Every variant of the rule that ran loses or is a coin toss, at
  $316, $400 and $1,000.
- **The quiet rule is the one positive result, and it is small.**
  - About +$3.6 a day at $316, and no more at $1,000: there are only so many quiet books.
  - It is positive on TRAIN, TEST, the whole span, under R 0.30–0.61 and fill volume × 1.0–1.6, without its best
    market, and on 10 of its 12 neighbours.
  - What it has not met is the money itself: the R a quiet book pays, and the other half of the day.
- **What else the same capital could do** (existing studies, no new venue):
  - Cash, or Polymarket's 4 % holding reward: $0.03 a day.
  - PR5's stablecoin quotes plan on about 12.7 % a year on the capital they lock (reference §3.27): about $0.11 a day
    on $316.
  - Nothing studied here earns $3 a day on $316. That is a reason to test the quiet rule, and also a reason to doubt
    it until live shows it: about 400 % a year would be extraordinary, and it rests on eight days.
- **Recommendation.** Keep live stopped now. If Davies wants to try once more: build the quiet rule, run one dry-run
  day, then 14 live days at the current equity under the bar below. If not: end Polymarket rewards and move the $316
  to whatever Davies prefers. Both are sound; a restart of anything like the rule that ran is not.

## 7. The design, as a proposal (nothing here is built)

What changes, against `pm_lp.ts` and `pm_live.ts` at `f55e67a2`:

1. **Selection** (`pm_live.ts`):
   - `PmCandidateRules` gains `quiet?: { maxShares24h: number; minTouchCents: number }`, set only by
     `PM_LP_CANDIDATE`, as `{ maxShares24h: 50, minTouchCents: 4 }`.
   - `scoreBook` passes over a candidate whose raw touch (the book without our orders) is narrower than
     `minTouchCents`.
   - After RW's ranking, `selectMarkets` reads the data API's trades for each ranked candidate in order:
     `GET https://data-api.polymarket.com/trades?market=<condition>&limit=500&takerOnly=true`, with a fresh query
     parameter so CloudFront's cache does not answer, and a plain User-Agent (the API answers 403 to a bare client).
     It sums the sizes of the last 24 hours and passes over a market above 50, until the budget is spent. At most
     about 40 GETs a selection.
   - A failed read takes nothing, as every other read of the selection does.
   - This is a new keyless route in the public client (`_shared/polymarket_public.ts`); it is GET-only.
   - The refill's reserve (`pm_lp_reserve.ts`) uses the same rules.
2. **Quoting** (`pm_lp.ts`):
   - `PM_LP_TIGHT = { maxTicks: 1 }` becomes `PM_LP_QUIET_TOUCH = { minCents: 4 }`. In `lpQuotesOn`, while `tb1Skip`,
     return `[]` when `(ba − bb) × 100 < minCents` on the book without our orders.
   - `lpExitQuotes` keeps exits resting in any book (Addendum 16).
   - `PM_LP_INV_CAP` 5 → 2.
3. **Config** (a migration on Davies' word):
   - `select_budget_usd` = 90 % of the cap ($212 at $236). `max_markets` stays 12, which the budget binds first.
   - A total stop of −$25 counted from the restart minute: the stop's sum needs a start of its own. Today it counts
     from the go, and the 10-12 stop event stands.
   - `live_confirmed_at` stays null until Davies' go, in the conversation where he says it.
4. **Pins**:
   - the quiet filter: 49 / 50 / 51 shares; a 3.9 ¢ and a 4.0 ¢ touch;
   - the quoting gate: a 3 ¢ book rests nothing, a 4 ¢ book quotes, exits rest in a 1 ¢ book;
   - the 2N cap;
   - the data API reader on a recorded fixture (including its 403 without a User-Agent);
   - `src/pm_live_hash.test.js` and `src/pm_lp_prereg.test.js` for the bytes and the addendum chain.
5. **Dry-run first.** The engine changes the selection, so one dry-run day:
   - Its paper layer fills by prints.
   - Expect about 11 markets.
   - Read the day: quoting minutes, formula, fills.

## 8. Pre-registration draft (Addendum 19 of `2026-10-04-polymarket-lp-prereg.md`, not frozen, not added there)

**On whose word.** Davies, 2026-10-13: "live rewards继续停止，并继续研究最好的策略…然后给我讲讲我再评估下". This draft
waits for his word; until then nothing changes.

**What changes.** Section 7's selection, quoting gate and inventory cap; the stop at −$25 from the restart. Everything
else is the instance as Addendum 18 left it.

**Window.**

- The dry-run day: the first full UTC day after the deploy.
- The live test: 14 full UTC days from Davies' go.
- The readings: day 7 (descriptive only) and day 14 (the bar).

**The bar, on day 14** (`backtests/lpbest/`'s reading of `pm_lp_*` and the readout's payouts), every condition:

1. The total over the 14 days (fills marked at the venue's mid at the reading, plus what was paid, plus rebates) is
   at least $0.
2. Rewards are at least 1.5 ¢ a filled share. Live-prep's were 0.66 ¢; the simulator's 2.92 ¢.
3. No UTC day below −$15, and the stop (−$25) not reached.

**Meaning.** Pass, and Davies decides whether to keep it running at the same size (the simulator says more money does
not help). Fail any condition, and Polymarket rewards end; the result is recorded, and nothing is re-tuned on the
test's own days.

**What would also be read** (descriptive): R in quiet books (paid over the scored formula), quoting minutes against
the simulator's, the fills' 60-minute markout, how many quiet books each 00:00 finds.

**Disclosures before the freeze.** Every figure in this review (8 days of pm-rec record, chosen on 10-05 → 10-08 and
read on 10-09 → 10-12) was seen before this draft.

## Not checked

- **R in quiet books.** Not measured: R is live's, and live's markets were RW's busy per-dollar picks. The biggest
  unknown.
- **The unrecorded half of each day.** pm-rec recorded the picked markets 56 % of the time. Neither their rewards nor
  their fills in the other half are in any number here.
- **Others' reaction.** Makers who move into a pool once we are in it are not modelled.
- **The 10-12 rebates** are as read at 10-13 00:05 ($2.94). Settlements after 22:49 on 10-12 are not in the live
  P&L.
- **Queue position** beyond the rule (we join behind what was at our price when we posted). Hidden or iceberg size is
  not visible.
- **Resolution risk** is in the marks only through the eight days: a quiet market can still resolve against stock we
  hold. The 2N cap bounds it at 40 shares a market: $40 at the very worst, about $20 at a middling price.
- **The hour of the day** was not split.
