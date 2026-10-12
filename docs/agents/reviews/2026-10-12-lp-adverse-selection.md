# LP-ADVERSE: why live-prep's fills lost, why paper did not show it, and what would change it

Research only (2026-10-12, read 23:03–23:40 UTC). No live path, config or migration changed, and the stop was not
touched. Every database read was a read-only `select`; no order was placed or cancelled. SQL, scripts and outputs are in
`docs/agents/backtests/lpadverse/` (`MANIFEST.json`). The pm-rec archive (books and prints, 2026-10-04 19:00 → 10-12
21:59 UTC, 195 hours a kind, every object's sha256 checked) was downloaded to a scratch folder and is not committed.
Code read at `787d878a`: `pm_lp.ts` sha256 `53f7f788…`, `pm_live.ts` `ee96ba0e…` (Addendum 18's bytes), `pmrw.ts`.
Not blind. Nothing here is applied: Davies decides.

Davies, 2026-10-12, verbatim:

> 开始做逆向选择研究，并深度研究优化策略（目前的表现太差了），所有数据都能看，所有文件都能改，策略的实际良好运行更重要

In English: start the adverse-selection study and study how to optimise the strategy in depth (it is doing too badly);
all data may be read, all files may be changed; the strategy actually running well matters more.

A sibling study asks whether reward programmes end around our posting and fills, and whether checking and re-quoting
every second would help. This one does not price speed. Where a finding depends on how old our quote was, it says so.

## Verdicts

| question | answer |
|---|---|
| Where did the −$129.35 go? | Half-spread **+$100.56**, adverse move in the 5 minutes after each fill **−$235.77**, from 5 to 60 minutes **−$69.44**, what was carried after that **+$75.21**: −$129.43 to now (the stop's −$129.35 is reproduced to the cent at 07:30). |
| Is it one market? | No. Without MrBeast wk1 the same split holds per share (+1.53 c, −3.67 c, −0.82 c, +1.21 c). 8 of the 9 market types lose at 60 minutes. |
| Why did paper not show it? | **Paper did show the adverse selection**: its fills marked at 60 minutes lose 2.92 c a share, live's 2.85 c. **What paper got wrong was the reward**: 7.7 c of formula a filled share on paper, 0.70 c paid live. That is 76 % of the paper–live gap. |
| Is there a rule that makes the live record profitable? | Not clearly. The best packages bring −$20.97 a day to between **−$3 and +$2 a day**, with ranges that include zero. The break-even R of what ran is **1.80**: no R Polymarket pays covers it. |
| Recommendation | **Keep it stopped.** If Davies wants it back, restart only with P1 below, sized as now, and judge it after 7 days against $0 a day. The open question that could change this verdict is the sibling's: quotes that had rested over a minute lost 4.6–4.7 c a share at 60 minutes, fresh ones 1.6 c. |

## 1. The live record

- 436 live fills (`pm_lp_fills`, all CONFIRMED, all maker, fee 0): 221 buys and 215 sells, 6,966 shares, 42 markets,
  2026-10-09 01:42 → 10-12 22:48 UTC. Entries stopped at the stop (10-12 07:30); exits went on.
- **The fills P&L is rebuilt exactly** (`scripts/pnl.py`, `results/pnl.txt`): fills and settlements to 07:30, marked at
  each market's book midpoint that minute, give **−129.35**, the `loss_stop_total` event's `totalPnl` −129.35468923.
  At 22:49 it is −129.43.
- Paid: rewards $38.10 (10-09 → 10-11), maker rebates $10.02. 10-12's rewards are not read until 10-13 00:05; this study
  puts them at R 0.75 × the minutes' formula, $10.64, and its rebates at the record's 0.180 c a filled share.
- **Per filled share**: rewards 0.70 c, rebates 0.18 c, fills −1.86 c. At the like-for-like formula ($64.76 over the
  four days) the R that would break even is 1.80 (`results/rules.txt`, header).
- **Per quoting day** (3.25 days, go to stop): fills −$39.82, rewards +$15.00, rebates +$3.86, **−$20.97 a day**.

## 2. The markouts (`scripts/markouts.py`, `results/markouts.txt`)

A fill's markout at h is d × (mid at t + h − y) × size. y is its YES-equivalent price. d is +1 when it added YES
(a BUY of YES or a SELL of NO), −1 otherwise. The mid is the YES touch's midpoint: live-prep's own minute (the book
without our orders) where it watched the market, the pm-rec recorder's book elsewhere. Positive means the fill earned.
Coverage: every fill at the fill, 422 at 60 minutes, 383 at 6 hours.

| | fills | shares | at the fill | 5 min | 60 min | 6 h | now |
|---|---:|---:|---:|---:|---:|---:|---:|
| all | 436 | 6,966 | +$100.56 (+1.44 c) | −$133.61 (−1.94 c) | −$197.10 (−2.94 c) | −$174.46 (−2.83 c) | −$129.43 (−1.86 c) |
| BUY (entries) | 221 | 3,593 | +1.43 c | −1.76 c | −1.97 c | +6.99 c | +5.49 c |
| SELL (exits) | 215 | 3,373 | +1.46 c | −2.13 c | −3.99 c | −14.31 c | −9.69 c |

- **The loss arrives in the first five minutes.** We capture 1.44 c a share against the mid before the fill. Five
  minutes later the mid has moved 3.38 c against us. That is a pick-off, not a slow drift.
- **The exits are picked off too.** An exit is a passive sell a tick inside the ask. Sells lost 3.99 c a share at 60
  minutes. By lot, 228 exit pieces (2,240 shares) were sold under cost for −$197.11. 103 were sold at or over cost for
  +$66.01 (`results/decompose.txt`). Median time from buy to exit: 144 minutes.

### By what was known before the fill (60-minute markout, cents a share; 5–95 % over market-days)

| split | worst | best |
|---|---|---|
| type (this study's, `lib.py`) | view-count −3.80 [−6.68, −2.75], 149 fills; statements −4.24; AI −3.50 [−5.06, −2.53]; elections −3.44 | box office +1.74; earnings/econ −1.47 [−3.04, +0.01]; news/geo −2.12 [−3.92, +0.49] |
| touch width before the fill | 1–2 c wide: −4.59 [−5.62, −3.23], 156 fills | 5–10 c: +0.19 [−1.92, +2.18]; ≥ 10 c: −0.02 |
| our distance from the mid | 0.5–1.5 c: −3.0 to −4.6 | 2.5–5 c: +0.75 [−1.54, +3.47] |
| the mid's range over the hour before | ≥ 6 c: −3.36 [−4.24, −2.43], 282 fills | 0.5–1.5 c: −0.63 (under 0.5 c −2.76: no clean gradient below 6 c) |
| how long our order had rested | 1–3 min −4.71 [−6.42, −2.84]; 3–10 min −4.57 [−6.21, −2.98] | under 60 s: −1.63 [−2.51, −0.36], 234 fills |
| market state | carried (exits): −5.48 [−8.37, −2.77] | quoting: −2.14 [−2.83, −1.13] |
| days to the scheduled end | 3–7 days: −4.84 | 1–2 days: −0.42 (no monotone pattern) |
| programme rate, N, tick, hour, price level | no consistent pattern | |

### By what was learned at the fill (not usable before it, but it explains the loss)

- **The taker's own sweep.** In 324 fills the taker took only our price. They lost 1.73 c a share at 60 minutes. In 112
  the taker went on past our price (a sweep). They lost 5.36 c (`paper_vs_live.txt`, at pm-rec's mid), and the 14 that
  went 5 c or more past lost 10.9 c (`markouts.txt`).
- **The taker's size.** Takers 5–20 times our size: −6.65 c; 20 times or more: −11.3 c.
- **The YES direction.** Fills that removed YES (BUY NO, SELL YES) lost 5.42 c at 60 minutes [−6.75, −3.70]. Fills that
  added YES lost 0.24 c [−2.05, +1.37]. On RW-C's paper the gap is smaller (−2.35 against −1.57) and on the paper layer
  there is none, so no rule is built on it.

## 3. The −$129 taken apart (`scripts/decompose.py`, `results/decompose.txt`)

| | half-spread | adverse 0–5 min | adverse 5–60 min | carried 60 min → now | total |
|---|---:|---:|---:|---:|---:|
| all | +100.56 | −235.77 | −69.44 | +75.21 | **−129.43** |
| entries (BUY) | +51.28 | −113.70 | −5.79 | +265.62 | +197.41 |
| exits (SELL) | +49.28 | −122.06 | −63.65 | −190.41 | −326.84 |
| without MrBeast wk1 | +85.35 | −204.21 | −45.51 | +67.49 | −96.89 |

The four columns sum exactly to the fills P&L. Read them as follows.

- **Adverse selection is −$305** in the hour after the fills, three times the half-spread.
- The carried column is the stock's drift once the hour is over. It came out positive in total. It is negative for the
  exits: what we sold kept rising after we sold it.
- By lot: exits under cost −$197.11, exits at or over cost +$66.01, resolutions −$2.69, still held +$4.36.
- By type, the lots lost: view-count −$41.05 plus MrBeast wk1 −$32.54, statements −$21.25, earnings/econ −$18.93,
  sports −$10.28, elections −$9.17, AI −$2.44, crypto −$1.20. News/geo made +$3.44 and box office +$4.00.

## 4. Live against paper (`scripts/paper_vs_live.py`, `scripts/rewards.py`)

Every path's fills are marked at the same mid (pm-rec's book), so the three are on one footing.

| | fills | shares | at the fill | 60 min | shares per quoted minute | formula a day |
|---|---:|---:|---:|---:|---:|---:|
| live | 436 | 6,966 | +1.44 c | −2.85 c [−3.62, −2.00] | 0.140 | $19.9 (like for like) |
| live-prep's paper layer, 10-04 → go | 504 | 7,501 | +1.67 c | −2.92 c [−3.92, −2.12] | 0.077 | $133.5 |
| RW-C paper, 10-08 → | 1,498 | 21,721 | +1.65 c | −1.95 c | 0.292 | $151.8 |

- **The fill model.** A paper fill needs a public print strictly through the quote. Of the 436 live fills, 202 had one
  within 60 seconds. Those lost 4.86 c a share at 60 minutes [−5.69, −3.89]. The other 234 lost 0.78 c [−1.85, +0.24].
  So **the paper sees the adverse half of the live fills and misses the harmless half**. Its per-share markout was
  therefore as bad as live's, and it saw about half the shares per quoted minute (0.077 against 0.140).
- **Queue position** does not explain it. Live quotes a tick inside the touch, alone at its level, and is hit first by
  any taker. That is the missed harmless half, single takers at our price.
- **The same markets and minutes.** In the 24,499 market-minutes where live and RW-C both quoted the same market, live
  had 253 fills (3,901 shares) and RW-C 301 (5,003 shares). Similar. Live's formula there was $77.59 against RW-C's
  $254.30, 0.305 of it.
- **The rewards** are the difference. Per filled share the paper layer's formula was 7.7 c, RW-C's 3.5 c, live's paid
  0.70 c. The day's selection formula realised as follows (`results/rewards.txt`):
  - paper layer: 11–41 % of the selection's formula a day;
  - live: 1.7 % (10-09), 3.8 %, 2.1 %, 2.5 %.
- **Why live scored so little**, 10-10 → 10-12:
  - Two-sided scoring minutes were 1,833 a day against the paper layer's 7,920, and each was worth $0.0103 of formula
    against $0.0162 (`rewards.txt`).
  - Live recorded 125,424 market-minutes. 85,563 of them (68 %) were carried markets working exits.
  - Of the 29,149 minutes of selected markets quoting, 39.6 % rested nothing. That is the cap held by carried stock (LP-CAPDEEP).
    10.0 % rested both sides that Polymarket read as not scoring, and 6.7 % rested one side.
  - Polymarket's programme cuts after 10-09 explain little: the 10-10+ minutes at the selection's rate would have scored
    0.97× what they did.
- **The gap, per day, at R 0.75.**
  - The paper layer on its own record: +$91.2 a day. That is fills to the end −$8.9 and rewards $100.1.
  - Live: −$21.0 a day.
  - Of the $112 between them, **rewards are $85 (76 %)**, fills $31 (28 %) and rebates −$4.
  - The fills' share is not the markout. Both lost about 2.9 c at 60 minutes. Paper's held stock recovered later. Live's
    exits sold before the recoveries.
- **RW-C at the live account's payout** (k = 0.23 of its formula, the shared-minute ratio × 0.75) loses $42.27 a day on
  its own fills marked at 60 minutes (`results/rules_paper.txt`). RW's rule on RW's universe does not survive the reward
  level the live account actually gets either.

## 5. Rule changes, priced (`scripts/rules.py`, `results/rules.txt`; `scripts/rules_paper.py`, `results/rules_paper.txt`)

### How each is priced

- On the live record, every BUY is a lot. Exits close lots first in, first out. A rule that would not have bought a lot
  drops it and the exits that closed it.
- Each market-day's payout is spread over its minutes by the formula they scored. A rule that rests nothing (or one side)
  in a minute loses that minute's share. Rebates go with filled shares.
- The paper records are priced the same way, with fills marked at 60 minutes and the formula at k = 0.23 (live's payout)
  or 0.75 (paper's own assumption).
- Ranges are 5–95 % over market-days (live 2,000 draws, paper 1,000). "own" is the rule's own record a day, base
  −$20.97.
- **Not credited:** a rule that holds less stock would also quote more minutes. That is the cap LP-CAPDEEP measured. It
  is an upside none of these numbers include, and each extra minute also brings fills.

| change (live record) | Δ $/day | 5 % | 95 % | own $/day [5 %, 95 %] | RW-C Δ at k 0.23 / 0.75 | paper layer Δ at k 0.23 / 0.75 |
|---|---:|---:|---:|---|---|---|
| no quote while the mid ranged ≥ 10 c over the last hour | +16.57 | +3.23 | +31.76 | −4.40 [−15.67, +7.84] | +38.88 / **+18.30** | +9.88 / **+1.81** |
| no quote while it ranged ≥ 6 c | +22.06 | +6.15 | +38.83 | +1.09 [−7.28, +11.14] | +39.47 / +7.04 | +7.34 / −8.24 |
| quote only where the touch is ≥ 3 c wide | +9.77 | −3.35 | +23.10 | −11.20 | +17.27 / −9.08 | +11.37 / −7.07 |
| quote only where the touch is ≥ 4 c wide | +19.02 | +3.96 | +35.25 | −1.95 | +21.37 / −15.94 | +9.11 / −21.43 |
| entries 1 tick further from the mid (fill only if the taker went past) | +22.14 | +1.75 | +42.34 | +1.16 [−2.84, +4.55] | +22.33 / −4.13 | — |
| view-count and statements markets out | +20.55 | +6.84 | +37.20 | −0.42 [−14.88, +16.97] | +13.23 / −2.95 | +1.99 / −10.40 |
| view-count out | +14.50 | +3.68 | +28.50 | −6.48 | +10.93 / +1.11 | −2.24 / −10.84 |
| no buy within 7 days of the end | +6.55 | −12.57 | +24.75 | −14.42 | +24.64 / −17.58 | +0.13 / −23.77 |
| per-market loss guard $5 (now $10) | +7.64 | +0.81 | +16.45 | −13.33 [−29.90, +4.82] | — | — |
| inventory cap 3N / 2N / 1N (now 5N) | +4.96 / +5.95 / +7.80 | | | −16 to −13 | — | — |
| entries adding YES only, one-sided paid ⅓ | +11.67 | −0.45 | +26.10 | −9.30 | — | — |
| leave out a market-day whose mid ranged ≥ 10 c in the 24 h before (97 market-days out) | +20.95 | −1.61 | +42.92 | −0.03 [−1.25, +0.78] | — | — |
| sell what is left 1 / 15 / 60 min after the buy, at the bid (taker fee in) | −15.58 / −20.90 / −15.10 | | | −36 to −42 | — | — |
| hold every lot to the end (no exits): a diagnostic only | +100.61 | −11.92 | +261.11 | +79.64 | — | — |

Three readings from the table:

- **Taker exits are worse.** Crossing the spread costs more than the drift it avoids.
- **Holding to the end** would have earned more on this one path, which says the exits are picked off. It is a single
  draw: it ties up the capital that pays the rewards and has no stop. It is not proposed.
- **Size** cannot go down. N is the programme's reward minimum, and 422 of the 436 fills were at N = 20, where an order
  under the minimum scores nothing.

### The packages (each part has a mechanism and held its sign at the live payout level on the paper samples)

| package | live own $/day [5 %, 95 %] | RW-C own at k 0.23 | paper layer own at k 0.23 |
|---|---|---:|---:|
| as it ran | −20.97 | −42.27 | −10.70 |
| P5: no quote after a 10 c hour | −4.40 [−15.67, +7.84] | −3.39 | −0.82 |
| **P1: P5 + touch ≥ 3 c** | **−2.95 [−8.48, +2.10]** | **+2.76** | **+8.21** |
| P2: P1 + view-count and statements out | −1.70 [−6.32, +2.88] | +5.37 | +6.90 |
| P4: P1 + entries 1 tick further | +2.01 [+1.29, +2.72] | +0.83 | — |
| not restarted | 0 | 0 | 0 |

- **The mechanisms.**
  - Informed flow comes in bursts: a market whose mid has just moved keeps moving, and our quote a tick inside the touch
    is the first thing a news-trader hits.
  - In a 1–2 c book the half-spread we capture is under a cent, and a pick-off of 3–5 c is not covered by it. A wide
    book pays enough of a spread to absorb one.
  - View-count markets follow a public counter that faster traders read live.
- **Overfitting.**
  - Four live days, 436 fills and 42 markets, of which one market is 25 % of the loss. Every threshold above was
    chosen after seeing the record.
  - The bootstrap resamples market-days, so it cannot see a regime that lasts all four days. Read the honest band as
    about twice as wide.
  - P4's narrow band is narrow because it barely trades: about $2.5 a day of rewards and a handful of fills.
  - **Only the 10 c hour filter is positive on all three records at both payout levels.** It is the one finding I would
    carry forward with some confidence.
  - Touch ≥ 3 c and 1 tick further help at the live payout and hurt at paper's. The view-count exclusion is mixed on
    paper. Days-to-end, inventory caps, one-sided quoting and selection by 24-hour volatility need more data.

## 6. Proposals, ranked by expected $ a day at R ≈ 0.75 (PROPOSALS ONLY; Davies decides each)

1. **Keep live-prep stopped (recommended).** $0 a day, no risk added. The strategy as it ran needs an R of 1.80. The best
   packages are centred within a few dollars of zero, and the 5 % day of P1, P2 and P5 is −$6 to −$16. Over a bad week
   that is −$40 to −$110 against a stop of −$75. Its exits stay armed, as now (`closeOnly`), until the carried stock is gone. Nothing changes in
   code. `pm_lp_config.live_confirmed_at` stays null.
2. **If Davies wants it running: P1, live, as now sized.**
   - Expected about −$3 to +$8 a day across the three records (live −2.95 [−8.48, +2.10]).
   - Risk added: the same −$75 stop. P1 gives up about three quarters of the rewards (−$37.32 of $48.74 on the record)
     with most of the fills, so the stop is less likely to be reached than it was.
   - Judge it after 7 live days against $0 a day. The end rule's 0.20 is not the bar that matters.
   - The changes, as an addendum (19) with pins:
     - `pm_lp.ts`: `PM_LP_TIGHT` becomes `{ maxTicks: 1, minCents: 3 }`. In `lpQuotesOn`, while `tb1Skip`, return `[]`
       also when `(row[1] − row[0]) × 100 < PM_LP_TIGHT.minCents`: the raw touch of the book without our orders, as
       `isTight` reads it. `lpExitQuotes` keeps exits in such books (Addendum 16).
     - `pm_lp.ts`: `PM_LP_PAUSE` becomes `{ cents: 15, minutes: 60, rangeCents: 10, rangeMinutes: 60 }`.
     - `pm_live.ts`: `PmPauseState` keeps each market's last 60 minutes of mids (`mids: Record<cond, [t, mid][]>`).
       `pauseAfterJump` also pauses for `minutes` when max − min of the window is ≥ `rangeCents`.
     - The evidence used the raw touch midpoint `(bb + ba) / 2` of the book without our orders. The existing pause uses
       RW's adjusted mid. Either feed the range the raw midpoint or re-price the rule on the adjusted one first.
     - Under `pauseQuotingOnly` a market paused this way still rests its exits, as the study priced it. Today's pause of
       a selected market withholds its sells too, so this needs one line of the addendum.
     - Pins in `pm_lp.test.ts`: a 2 c book rests nothing, a 3 c book quotes, a 10 c hour pauses and a 9 c hour does
       not; the hash chain in `src/pm_live_hash.test.js` and `src/pm_lp_prereg.test.js`.
   - Mid-pool sets neither option and is unchanged.
3. **P2 = P1 + view-count and statements out.** About −$2 to +$7 a day, the same risk.
   - Code: `PM_LP_CANDIDATE.excludeQuestion` takes a second test beside `PM_LP_EXCLUDE_AI`.
   - It needs a question classifier as `lpMarketType` does: this study's `mtype` in `backtests/lpadverse/scripts/lib.py`,
     whose "view-count" and "statements" patterns would go into `pm_lp.ts`.
   - It is weaker evidence than P1. Mixed on paper.
4. **P4 = P1 + entries one tick further from the mid.** About +$1 to +$2 a day on live and RW-C; paper's own payout level
   says no.
   - Code: in `lpQuotesOn`, the BUY prices become `onTick(q.b − k × tick)` and `onTick(1 − (q.a + k × tick))`, with a new
     `PM_LP_DEPTH = { ticks: 1 }`. Sells (exits) stay at RW's prices.
   - The selection's `firstScore` still ranks at RW's price, so the day's formula estimate would read high. Its
     realisation would have to be read again.
5. **Unchanged restart: do not.** −$21 a day on the live record.

What no proposal fixes: the reward per filled share. Live was paid 0.70 c a share. Paper's was 5.8 c: 7.7 c of formula
at R 0.75. A strategy that earns from rewards needs markets where it scores far more minutes per share filled. That means
less stock held, more two-sided minutes and fewer pick-offs. P1 moves all three the right way, but the live record cannot
say by how much once its freed capital is quoted again.

## Depends on the sibling's speed study

- 0–5 minutes is where $236 of the $305 adverse move happens.
- Orders that had rested under 60 seconds lost 1.63 c a share at 60 minutes. Those over a minute lost 4.6–4.7 c.
- If all fills had behaved like the fresh ones, that would be about +$91 over the record (1.31 c × 6,966 shares), +$28 a
  day: as large as any rule here.
- It may be partly selection: a fresh order is often a replacement after the book moved. Whether checking and re-quoting
  every second turns it into money is the sibling's question.
- If that study finds a large effect, P1 should be priced again with it.

## Not checked

- **Capital re-use.** None of the rules re-quotes with the capital it frees. That is an upside, with more fills on it.
- **10-12's payout.** 10-12's rewards and rebates are estimates (R 0.75; 0.180 c a share) until 10-13's readout.
- **Prints.** The pm-rec tape is one record per taker trade at its average price. The deeper-quote counterfactual
  therefore uses the trade records of our own fills (each maker order a taker took), which see only trades that reached
  us.
- **Resolution.** Only 5 of the 42 live markets have resolved. "Now" for the rest is the last mid.
- **Paper resolution.** The paper samples' "end" is the recorder's last mid, not a payout.
- **Fees.** Taker fees on the taker-exit rows use the published category rates (reference §2d), not each market's own
  `feeSchedule`.
- **Speed.** Quote age and re-quoting speed were not studied (the sibling's), nor whether programmes ended around our
  fills.
