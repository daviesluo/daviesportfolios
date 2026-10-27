# PER-BOOK: each stablecoin book on its own, and USDT on one venue beside USDC on the other (2026-10-27)

Davies, 2026-10-27, verbatim: "用这个口径对比一下revolut x上usdt和usdc跟coinbase的这两个分别的单独收益率，如果一个光做usdt和一个光做usdc会更好吗？正好抵消币的风险"
(on this basis, compare the standalone returns of USDT and USDC on Revolut X and of the two on Coinbase; would one venue doing
only USDT and the other only USDC be better? It would offset the coin risk).

Read-only. Scripts and data: `backtests/pr5_opt/` (`scripts/per_book.py`, `sql/cb_pulls.sql`, `data_cb/`,
`results/per_book.json`). Reference §3.54. Not blind, nothing in production changed.

## 0. The answer first

- **Each book alone.** With the whole £600 on one book (£100 a rung), under LIVE's "at" fill, over 2026-10-17 → 10-27:
  - Revolut X USDT-GBP makes **16.3 bps of capital a day** and Revolut X USDC-GBP **8.6**.
  - Coinbase USDC-GBP makes **9.4**, USDC-EUR **6.7**, USDT-GBP **0.4** and USDT-EUR **−0.5**.
  - On Coinbase it is the reverse of Revolut X: USDC earns and USDT does not. That is the 10-26 review's §6 again, on LIVE's
    basis.
- **Davies' split, Revolut X USDT-only beside Coinbase USDC-only:**
  - **At LIVE's £600 it loses.** £300 a venue makes 13.97 bps a day. All £600 on Revolut X makes 16.26 under USDT alone and
    15.75 at 3:1. The split is 14 % below USDT alone and 11 % below 3:1.
  - **At £1,200 in all it roughly ties.** £600 a venue makes 12.82. £1,200 on Revolut X makes 13.49 under USDT alone and 12.44
    at 1:1.
  - The reason is Revolut X's size decay. Its USDT-GBP book earns 18.4 bps a day at £300, 16.3 at £600 and 13.5 at £1,200.
    Coinbase's USDC-GBP barely decays: 9.6 at £300 and 9.4 at £600.
  - **The reverse (Revolut X USDC beside Coinbase USDT) is the worst arrangement measured:** 5.2 bps a day at £600.
- **Splitting by coin does not offset what it seems to.**
  - **It halves the issuer risk** (a USDT or a USDC de-peg). LIVE's 1:1 already does that on Revolut X alone, and the running
    twins variant-6 to -8 measure exactly what giving it up earns.
  - **It does nothing for GBP/USD.** Both coins are dollars, so the coin inventory is the same long-dollar position either
    way.
  - **What a second venue does add is venue diversification**: an outage, a freeze or a failure of one exchange.
- **Recommendation.**
  - At £600, no. Revolut X USDT-heavy dominates on return per pound, and the issuer hedge is already priced by variant-6 to -8.
  - A two-venue paper twin is not needed. The combination is the sum of two standalone records that already run or are
    measured: variant-8 (`o600usdt`, Revolut X USDT-GBP alone) and Coinbase's USDC record (the "with Euros" rows; "- 2" is the
    USDC arm, read 11-10). It can be read offline.
  - A second venue becomes worth building only when Revolut X's capital outgrows its book, about £1,200 and up, and only as a
    live path built for it (§5).

## 1. Basis

- **The replay.** PR5-OPT's (`2026-10-27-pr5-rules-optimisation.md`): PR5's paper engine carried out by LIVE's executor.
  - It fills on prints by their own quantity, LIVE's "at" rule or "through".
  - It has the 24-hour stop and the de-peg guard on the book's print.
  - Weekends are quoted: on Revolut X on the held X, and on Coinbase on the fair "with Euros - 2" holds through a closure
    (`cb_hold_minutes`).
- **Coinbase's run is the same code** (`sim.py`) on Coinbase's record, with these inputs:
  - its aggressor prints (`cb_trades`), summed by 30-second bucket, price and side so that the executor's turn at :30 sees each
    print on the right side;
  - its tick (USDT-EUR 0.00001);
  - its taker fee (0.0045 %) and half-touch for a stop (`agents/cb_quotes.ts`).
- **Euro books.** A EUR book's rung is £100 in euros (0.842 pounds a euro, the window's mean). Its bps are in euros.
- **Window.** Coinbase's stored prints begin 2026-10-16 10:53 UTC. The common window is **W10: 10-17 00:00 → 10-27 00:00**,
  ten days with two weekends. Revolut X also runs on its own longer records: FWD 09-26 → 10-27, HIST 08-26 → 09-23 and LONG
  01-01 → 09-23.
- **Units.** bps of the book's (or portfolio's) capital a day: realised by exit day, a holding at the end marked at the last
  print. MTM adds the change in held rungs' marks between midnights.
- **Per pound at comparable rungs:** each book at £300 (£50 rungs, LIVE's own size) and at £600 (£100).

## 2. Each book alone

Bps of capital a day. FWD, HIST and LONG are Revolut X only (Coinbase has no record there).

| book, alone | capital (rung) | W10 at | W10 through | FWD at | FWD through | HIST | LONG | worst day / MTM worst day | worst week |
|---|---|---|---|---|---|---|---|---|---|
| **Revolut X USDT-GBP** | £600 (£100) | **16.26** | 16.25 | 15.36 | 13.29 | 7.74 | 46.13 | W10 +0.26 / +0.26; LONG −8.85 / −24.76 | LONG +23.45, FWD +0.26 |
| Revolut X USDT-GBP | £300 (£50) | 18.37 | 18.21 | 16.87 | — | — | — | W10 +0.29 | — |
| Revolut X USDT-GBP | £1,200 (£200) | 13.49 | 12.91 | 13.30 | — | — | — | W10 +0.07 | — |
| **Revolut X USDC-GBP** | £600 (£100) | **8.61** | 5.57 | 7.66 | 5.01 | 4.72 | 10.55 | W10 −0.50 / −0.05; LONG −29.67 / −20.60 | LONG +18.51, FWD +5.65 |
| Revolut X USDC-GBP | £300 (£50) | 9.99 | 6.96 | 9.10 | — | — | — | W10 −0.50 | — |
| **Coinbase USDC-GBP** | £600 (£100) | **9.39** | 7.91 | — | — | — | — | +0.22 / +0.22 | — |
| Coinbase USDC-GBP | £300 (£50) | 9.57 | 8.34 | — | — | — | — | +0.22 / +0.22 | — |
| **Coinbase USDC-EUR** | €713 (€119) | **6.75** | 6.59 | — | — | — | — | −0.94 / −0.94 | — |
| **Coinbase USDT-GBP** | £600 (£100) | **0.43** | 0.19 | — | — | — | — | −2.01 / −4.89 | — |
| **Coinbase USDT-EUR** | €713 (€119) | **−0.50** | −0.32 | — | — | — | — | −10.10 / −4.97 | — |
| *for reference:* Revolut X, LIVE's 1:1 | £600 (£50) | 14.18 | 12.58 | 12.98 | 10.27 | 6.64 | 33.70 | LONG MTM −7.84 | LONG +21.21 |
| Revolut X USDT 2:1 / 3:1 | £600 | 15.53 / 15.75 | 14.12 / 14.88 | 14.22 / 14.62 | 11.49 / 12.04 | 7.14 / 7.37 | 38.74 / 40.92 | LONG MTM −13.4 / −16.3 | — |

W10's weeks are partial (it starts on a Saturday), so a worst week is given only for records of five or more weeks.

**The same question on the paper engines' own records** (`data_cb/engine_books.json`): PR5's `stepMinute`, $100 / £100 / €100 a
rung, "through" fills, at most 10 % of a minute's volume. Bps of the book's six rungs a day:

| book | Revolut X, PR5 paper, 10-11 → 10-27 | Coinbase "with Euros", 10-11 → 10-27 | Coinbase "with Euros - 1" (weekends held), 10-13 → 10-27 |
|---|---|---|---|
| USDT-GBP | **7.10** (131 trips, +14.5 bps a trip) | −0.29 (20, −2.0) | −0.16 (25, −0.7) |
| USDC-GBP | 2.74 (60, +8.8) | 2.83 (38, +8.8) | **5.09** (47, +11.0) |
| USDC-EUR | — | 2.41 (28, +8.3) | 2.02 (29, +5.9) |
| USDT-EUR | — | −0.40 (25, −1.5) | −0.23 (29, −0.7) |

The order is the same: Revolut X USDT-GBP first, then the USDC books on either venue about level, and Coinbase's USDT books at zero
or below.

**Size.**
- Revolut X USDT-GBP's return per pound falls with the rung: 1.00 at £50, 0.89 at £100, 0.73 at £200 (W10, against £300).
  This is the same curve PR5-OPT measured.
- Coinbase's USDC-GBP barely moves: 0.98 at £100 against £50. Its book printed about £29.6 million of USDC-GBP in ten days
  (`cb_trades`), and its prints are large beside a £100 rung.
- The replay is size-aware (prints by their own quantity) and has no queue at the price. LIVE's own queue-aware curve
  (0.90 at £50, 0.82 at £100 per pound against £10) is about as steep, so no further discount is applied.

## 3. The two-venue portfolios

Same days (W10), the same pounds in all. Each part runs as its own book. Bps of the whole capital a day.

| portfolio | in all | W10 at | W10 through | worst day (at) |
|---|---|---|---|---|
| Revolut X USDT-GBP alone | £600 | **16.26** | **16.25** | +0.26 |
| Revolut X USDT 3:1 | £600 | 15.75 | 14.88 | +1.22 |
| Revolut X LIVE's 1:1 | £600 | 14.18 | 12.58 | +0.65 |
| **Revolut X USDT-GBP £300 + Coinbase USDC-GBP £300** | £600 | **13.97** | 13.27 | +3.45 |
| Revolut X USDC-GBP £300 + Coinbase USDT-GBP £300 (the reverse) | £600 | 5.24 | 3.59 | −0.10 |
| Revolut X USDT-GBP alone | £1,200 | **13.49** | **12.91** | +0.07 |
| **Revolut X USDT-GBP £600 + Coinbase USDC-GBP £600** | £1,200 | **12.82** | 12.08 | +3.00 |
| Revolut X USDT 3:1 £600 + Coinbase USDC-GBP £600 | £1,200 | 12.57 | 11.40 | +3.48 |
| Revolut X LIVE's 1:1 | £1,200 | 12.44 | 10.91 | +0.65 |
| Revolut X USDT-GBP £600 + Coinbase USDC-GBP £300 + USDC-EUR £300 | £1,200 | 12.22 | 11.85 | +3.68 |
| Revolut X USDC-GBP £600 + Coinbase USDT-GBP £600 (the reverse) | £1,200 | 4.52 | 2.88 | −0.18 |

- **At £600 the split costs 2.3 bps a day against USDT alone** (14 %, about 8 % of the capital a year). Against 3:1, the
  weighting variant-7 tests, it costs 1.8.
- **At £1,200 the split is within 0.7 bps a day of USDT alone** and ahead of LIVE's 1:1. Two venues smooth the days: its worst
  day is +3.0 against +0.07.
- **These are ten days**, and the Coinbase USDC books were picked after seeing them win (the 10-26 review's §6). The gap at
  £600 (2.3 bps a day) is larger than anything the window can blur. The tie at £1,200 is not a finding.

## 4. What splitting the coins does to the risks

**Issuer risk (a de-peg of one coin).**
- What is exposed is what is held: the asks' coin, three asks' worth (half the capital), plus any long the bids bought, up to
  the other half. So a book holds between none and all of its capital in its coin, about half on average.
- A de-peg of d costs about holding × d:

| arrangement | coin held | a 5 % de-peg | a 13 % de-peg |
|---|---|---|---|
| Revolut X USDT-only £600 | all in USDT | about 250 bps of capital (500 if the bids filled into it) | about 650 (1,300) |
| LIVE's 1:1 | half USDT, half USDC | half of that, whichever coin breaks | half of that |
| two-venue split | half USDT, half USDC | half of that | half of that |

- The two sizes are history: USDT's low in May 2022 was about −5 %, and USDC's in March 2023 about −13% for a weekend.
- 250 bps is about 15 days of USDT-only's 16 bps a day; 650 bps is about 40.
- The de-peg guard stops new entries when the USD book or the GBP print leaves fair by 50 bps. It does not sell what is held.
  A long older than 24 hours is closed by the stop as a taker at the de-pegged price, so the guard turns a mark into a realised
  loss for those rungs.
- **So the split halves the issuer exposure, exactly as LIVE's 1:1 already does on Revolut X alone.** Going USDT-heavy on
  Revolut X gives that hedge up for return. That trade-off is variant-6 (2:1), -7 (3:1) and -8 (USDT alone), now running against
  the LIVE twin to 11-24, and their reading should quote this table beside the bar.
- The replays contain no de-peg (LONG's worst marked day for USDT alone is −24.8 bps), so none of the drawdowns above prices one.

**GBP/USD.** USDT and USDC are both dollars. The coin inventory is a long-dollar position against pounds, whichever coin and
venue holds it, so splitting USDT from USDC offsets no FX at all. Coinbase's EUR books add EUR exposure: their cash is in euros and
their coin in dollars, counted in pounds. That is a second currency risk, not an offset.

**Venue risk.** This is what a second venue does diversify: an exchange outage (Revolut X's of 10-20), an account freeze, or an
exchange failing with the balance on it. Half the capital on each venue halves that loss. Today it is unpriced: neither venue
has failed in the record.

## 5. Practical costs of a second venue

- **Capital.** Either split the £600 (and lose about 2.3 bps a day, §3) or add more. Coinbase's books also need their own asks'
  coin, half their capital, bought there.
- **Fees.** Coinbase's stablecoin pairs: maker 0 %, as Revolut X; taker 0.0045 % (`CB_TAKER`, its Exchange fees page), below
  Revolut X's 0.09 %. Only a stop pays a taker fee, so fees decide nothing here.
- **Funding and moving money.** GBP and EUR deposits and withdrawals on Coinbase, and moving coin between venues, were **not
  checked here**. They are Davies' account terms, and a rebalance between venues would be a manual transfer each time.
- **Operational load.** Coinbase has no live order path today: "with Euros" and "- 1"/"- 2" are paper. Going live there needs all
  of the following:
  - a Coinbase executor of its own: signed orders, post-only, reconcile by client id, the governor, the dead-man through the
    monitor, the daily stop, top-ups;
  - its simulated twin;
  - a trading key held as a Supabase secret;
  - a pre-registration and Davies' go.
  That is several days of work and a second live risk surface, with its own failure modes, for a book that earns about 0.6× of
  Revolut X's USDT-GBP per pound.

## 6. Recommendation

1. **Keep Revolut X, and decide the USDT weighting on variant-6 to -8's readings (11-24).** They measure the return; §4 gives the
   issuer risk each takes on.
2. **Do not add a two-venue paper twin.**
   - Its return is the sum of two standalone records:
     - variant-8 (`o600usdt`, Revolut X USDT-GBP alone at £600);
     - Coinbase's USDC record ("with Euros" and "- 1" run every book; "- 2" is the USDC arm at £25/€25, read 11-10).
   - Both run. If wanted, the combination is read offline on 11-24 from the two, day by day, with the same bar.
   - **Spec, should Davies want it built anyway:** no new engine. A Coinbase row of the USDC-GBP book alone at £600 (£100 a rung),
     "with Euros - 2"'s rule, pre-registered for 28 days. It would be read with variant-8 as one £1,200 portfolio against
     Revolut X USDT-GBP at £1,200 (variant-1's capital).
3. **Revisit a second venue when Revolut X's capital passes about £1,200.** That is where its USDT-GBP return per pound has
   fallen to Coinbase USDC-GBP's level plus the split's smoothing. Revisit only with a live path costed first.

## 7. What this did not do

- Coinbase's window is ten days, against Revolut X's nine months. Its USDC books' edge is in-sample (picked on 10-11 → 10-25).
- Prints summed by 30-second bucket lose their order inside the bucket. Fills inside a bucket go best price first, as the replay
  always does.
- The asks' coin is assumed there (the executor's top-ups), as in PR5-OPT. On Coinbase it would need buying there.
- No de-peg is in any record. §4's losses are arithmetic on the holdings, not a replay.
- LIVE's own per-book record was not read for this (the 10-26 review §6 has it: 237 of LIVE's 330 trips were USDT-GBP).
