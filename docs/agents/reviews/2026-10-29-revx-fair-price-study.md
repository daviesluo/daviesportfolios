# Revolut X stablecoin quotes: is the fair price the best it can be? (2026-10-29)

Davies, 2026-10-29: "感觉所有的stablecoin quotes的策略里最重要的就是合理价这个价格，目前实盘和测试的这么多这类策略里，你仔细深度研究下这个价格的计算还有没有优化和改进的空间，所有数据都可以看，不同币所和币也可以结论不同".
This is the Revolut X half: LIVE (PR5's executor), its weekend replica, every twin, and PR5's paper engine, on USDC-GBP and
USDT-GBP. Coinbase and OKX are a second study's; their recorded books are used here only as a reference.

**Not blind.** Every record was read for research (no no-peek rule since 2026-10-04). No pre-registered reading was run or
pre-empted: QUEUE (11-02), PR5-W (11-25), the LIVE-rule twins (11-11, 11-23, 11-25) run as written, and each should name this
review as a further non-blind read. Nothing was changed in production: no order, config row, twin, engine, migration or frozen
file.

**Public repository.** LIVE appears only in counts and in basis points of price. Every pound figure is a replay's (paper money).

**Sources.** Production read 2026-10-29 05:40–05:50 UTC, SELECT only (`backtests/fair_price/sql/pulls.sql`), rows to 2026-10-29
00:00 UTC, md5-checked into `backtests/fair_price/data/` (`MANIFEST.json`):
- PR5's minute record (`agent_quote_minutes`: the X and fairU every minute was decided on, 09-25 → 10-29), every stored UK print
  (16,808), the USD books' hourly closes (1,744);
- Revolut X's book snapshots, five levels a side, about one a minute (`agent_book_levels`: USDC-GBP 37,267, USDT-GBP 36,470,
  USDC-USD 13,546, USDT-USD 16,763; from 09-26);
- Coinbase's touch on USDC-GBP and USDT-GBP (`cb_touch`, 27,091 each, from 10-10 01:47);
- LIVE's own orders (`agent_quote_live_orders`, 9,522 rows), **not committed** (they carry the live account's sizes): the
  scripts read them from a local file (`$FP_LIVE`). They are used to take LIVE's own resting orders out of the book snapshots
  (3,875 USDC-GBP and 4,417 USDT-GBP orders) and to place LIVE's fills in time.

The replay engine is PR5-OPT's (`backtests/pr5_opt/scripts/sim.py`), imported unchanged. On its own window it gives 501 trips and
12.97 bps of capital a day against that review's 502 and 12.98 (its rows ended 10-27), and on the committed tape 6.66 / 5.33 bps
a day ("at" / "through") against its 6.638 / 5.329.

## 0. Answers first

1. **Every Revolut X row prices off the same fair**: fairU ÷ X, where fairU is the median of the last 24 hourly closes of
   Revolut X's own USD book (USDC-USD or USDT-USD) and X is Yahoo's GBP/USD one-minute bar, about a minute old. Inside an FX
   closure the last live X is held. Quotes sit 0.1 / 0.2 / 0.3 % either side; exits rest at fair. Details in §1.
2. **The fair is well placed.**
   - On weekdays the venue's own book (its clean mid, LIVE's orders taken out) sits a median −1.4 bps (USDC-GBP) and +0.8 bps
     (USDT-GBP) from it. Its median touch is 5–7 bps wide.
   - LIVE's 380 entry fills earned +12.5 bps against fair (90 % 11.2 to 13.7) and +8.3 bps against the book's mid at the fill
     (7.6 to 9.0). 60 minutes on they are still +6.9 bps against the mid and +8.7 against Coinbase's.
   - So about 4 bps of each fill's edge is the market already leaning toward the quote: that is the adverse selection. After
     the fill it barely grows.
3. **The peg term matters a lot, and only on USDT.** Pricing each coin at exactly $1 ("par") instead of its USD book's own
   median costs −3.06 bps of capital a day (90 % −4.56 to −1.59). All of that is USDT-GBP's: Revolut X's USDT-USD trades about
   20 bps under par. Today's fair already prices it.
4. **No change to the formula beats today's on both books.** Sixteen candidates were replayed on LIVE's rules at £600 (§4).
   None was ahead under both fill rules, in both halves, out of sample. The ones that look best in-sample fall back in the
   later half:
   - a 25 % blend with the book's own mid: +0.50, then −0.21 out of sample;
   - a 60-minute EMA of the book's basis at half weight: +0.15, −0.04 under the stricter fill.
   Several candidates are clearly worse:
   - a faster or extrapolated GBP/USD: −0.5 to −0.9 here, and −0.9 to −1.0 on the committed tape (P ≤ 0 ≥ 0.95);
   - a live USD-book mid instead of the 24-hour median: −0.4 to −1.0;
   - a shorter peg median: −0.35 to −0.49;
   - a microprice blend: −0.72 / −1.24.
5. **One lead, on USDC-GBP alone: nudge its fair by Coinbase's USDC-GBP** (§5). The nudge is how far Coinbase's mid has moved
   off its usual (24-hour EMA) gap to our fair, at half weight.
   - On 18 days (10-11 → 10-29) it adds +0.64 bps of capital a day under "at" (90 % −0.16 to +1.46, P ≤ 0 0.09) and +0.58
     under "through" (−0.12 to +1.26, P ≤ 0 0.08), ahead in both halves.
   - All 42 settings and fill rules checked are positive (+0.15 to +1.41). It holds on weekdays alone and in closures alone.
   - The same nudge on USDT-GBP loses in 12 of 12.
6. **Recommendation** (§6):
   - keep the fair as it is on LIVE and every twin, both books;
   - if Davies wants it, test the USDC-GBP Coinbase nudge as one paper twin against `live600` for 28 days, never straight to live.
     The expected gain is small, about +5 % of today's replayed return, and it makes a Revolut X row depend on the Coinbase recorder.

## 1. How the fair is computed today

**One fair for every Revolut X row.** PR5's paper engine (`agents/quotes.ts`, `stepMinute`) computes it each minute and
records what it was given (`agent_quote_minutes`). Every other row reads that record:
- LIVE carries out the engine's decisions (`quotes_live.ts`) and re-reads the same inputs for its guards (`bookInputs`);
- LIVE's weekend replica (`quotes_live_weekend.ts`) and the twins (`quotes_twin.ts`: `live1200`, `take50`, `n600*`, the hidden
  `n600usdt2`) replay PR5's stored minutes;
- PR5V and rule D (`quotes_variant.ts`, `quotes_ruled.ts`, their calls off since `0156`) did the same.

| input | what it is | when it is known |
|---|---|---|
| fairU (the coin in dollars) | the median of Revolut X's USD book's hourly closes (`/public/candles/USDC-USD` or `USDT-USD`, `interval=60`, UK region) whose hour started in [t − 24 h, t − 1 h]: up to 24 closes (`fairHours`, `fairUAt`) | each hour after it closes; it moves slowly by design |
| X (GBP/USD) | Yahoo's `GBPUSD=X` one-minute bar, the close of the latest bar that started in [t − 10 min, t − 1 min] (`fxBarAt`); none in that window is "dark" | 98.6 % of lit minutes use the bar of the minute before (33,630 of 34,106 book-minutes); the 09-28 study found Yahoo's bar itself sits nearer Dukascopy's previous minute, so X is about 1–2 minutes behind |
| fair | fairU ÷ X, in GBP per coin | at the turn for minute t, on data to t − 1; LIVE acts on it about 90 s later (its turn 30 s into the next minute) |
| peg | none assumed: fairU is the coin's own dollar price on the venue (USDC ≈ 0.9999, USDT ≈ 0.998 this month) | as fairU |
| venue mid, index | not used. Revolut X's index is stored only as the latest ticker (`agent_quote_tickers`) | — |

**Weekends.** The closures are fixed in UTC: Friday 21:00 → Sunday 21:00, plus 24–25 and 31 Dec – 1 Jan. Inside one, a dark
minute takes the last live X (`quotes_weekend.ts`, `weekendX`), so fair is fairU (still updating hourly) over Friday's rate.
From Sunday 21:00 until a live bar, the minute is dark. LIVE quotes the weekend from this replica since 2026-10-23 21:00
(`weekend_mode` 'live').

**Stale and guarded.** No entry is quoted while any of these holds (exits keep their price):
- X is dark;
- the USD book's newest hour ended more than 2 hours ago;
- its last hourly close is more than 50 bps from its 24-hour median;
- the GBP book's last print is more than 50 bps from fair (`entryGuards`).

**How a quote is placed off it** (`quoteTicks`, `exitTicks`, 0.0001 ticks):
- **Entries.** A bid at floor(fair × (1 − k)) and an ask at ceil(fair × (1 + k)), k = 0.1 / 0.2 / 0.3 %, re-priced when fair has
  moved more than 0.05 % since. A post-only order the market is already through is refused, and placed again once the last print
  is not through it.
- **Exits.** At fair, rounded in the position's favour, re-priced past the same 0.05 %. From 2026-10-29 an exit the book shows
  crossing rests one tick inside the opposite best (`exitTicksOnBook`).
- **Stop.** After 24 hours, a taker IOC within fair ± 50 bps.

## 2. Where fair stands against the markets (`results/measure.json`, part A, B, D)

**The book's clean mid.** LIVE's resting orders are taken out of each snapshot. The touch is the first level with ≥ 50 coin;
14 USDC-GBP snapshots with an emptied book (13 of them on 10-08) are dropped. Each figure is (reference ÷ fair − 1), in bps:

| | USDC-GBP weekday | USDC-GBP closure | USDT-GBP weekday | USDT-GBP closure |
|---|---|---|---|---|
| Revolut X clean mid: median (10th / 90th pct) | −1.40 (−9.1 / +4.9) | −1.38 (−8.0 / +6.1) | +0.76 (−11.1 / +9.3) | +2.14 (−15.9 / +8.1) |
| Revolut X clean microprice: median | −1.54 | −0.05 | +0.26 | +1.41 |
| Revolut X touch width: median | 6.6 | 10.7 | 5.3 | 6.7 |
| Coinbase mid: median | +2.21 | +4.57 | +5.51 | +8.49 |
| Revolut X mid − Coinbase mid: median | −5.27 | −4.67 | −3.99 | −5.96 |
| USD book's live mid ÷ fairU: median (10th / 90th) | −0.5 (−3.5 / +1.5) | −0.5 | −0.5 (−4.0 / +3.0) | 0.0 |

- **In the median, fair is where Revolut X trades.** Revolut X's GBP books sit 4–6 bps under Coinbase's on both coins.
  Our fair sits between the two, nearer Revolut X.
- **But the book wanders off fair for days.** USDC-GBP's daily median gap ran from −8.6 bps (10-21) to +6.8 (10-28); it
  was −5.9 to −8.6 every day 10-19..23 and +4.1 to +6.8 every day 10-24..28. USDT-GBP's ran from −21.1 (09-27) to +19.0 (10-22).
  - In 3.3 % of USDC-GBP snapshots the whole clean book stood more than 10 bps from fair, and in 11.4 % of USDT-GBP's.
    Each time, the inner rung on one side is through the book: refused, or filled at once.
  - **When the gap passes 10 bps, the book closes it, not fair** (part D). Four hours later the median gap left is 49 % on
    USDC-GBP and 65 % on USDT-GBP. The book's move closed 32 % / 12 % of it, fair's 3 % / 0 %.
  - So fair works as an anchor the book returns to, slowly. It does not lag a market that has moved on.
- **Fair is smooth.** It moved more than 5 bps from one minute to the next in 70 and 71 of 48,275 minutes, and more than 10 bps
  in 10 each. Stale X is rare: 98.6 % of lit minutes use the previous minute's bar.
- **As a forecast of the market** (part B; mean absolute error in bps, from 10-11, every 5 minutes):
  - The book's own mid best foretells the book's mid later (USDC-GBP weekday +60 min: 4.38, fair 7.08). Coinbase's mid best
    foretells Coinbase's (4.59 against fair's 6.05).
  - That is persistence, not value. §4 finds that pricing nearer either book does not earn more.

## 3. LIVE's fills (`results/measure.json`, part C)

800 fills (380 entries, 420 exits). 777 were placed in time by the first print through or at their price, the rest at the
executor's read-back. Price is the order's limit: a maker fill is at it. `avg_fill_price` carries F1's £0.11 penny on tiny
buy-backs and is not used.

Each figure is a mean in bps, **positive for us**. The band is a day-block bootstrap, 90 %.

| entries | n | edge vs fair | edge vs book mid | markout vs book mid +5 / +60 / +240 min | vs Coinbase mid +60 | vs fair +240 |
|---|---|---|---|---|---|---|
| all | 380 | +12.5 (11.2 to 13.7) | +8.3 (7.6 to 9.0) | +6.3 / +6.9 (6.0 to 8.0) / +6.1 (3.9 to 8.4) | +8.7 (7.3 to 10.2) | +10.2 |
| USDC-GBP | 103 | +12.0 | +9.8 | +8.0 / +8.6 / +8.6 | +10.5 | +10.2 |
| USDT-GBP bids | 95 | +9.6 | +6.8 | +5.4 / +5.6 / +1.0 | +10.7 | +1.3 (−4.6 to +8.7) |
| USDT-GBP asks | 182 | +14.3 | +8.2 | +5.8 / +6.6 / +7.4 | +6.8 | +14.9 |
| closures | 69 | +15.5 | +7.9 | +5.5 / +6.1 / +6.0 | +9.0 | +15.7 |
| weekdays | 311 | +11.8 | +8.4 | +6.5 / +7.0 / +6.1 | +8.7 | +9.0 |
| 0.1 % rung | 293 | +9.8 | +6.8 | +5.2 / +5.3 / +3.9 | +6.4 | +6.9 |

- **The fills are not picked off.** About 4 bps of the designed edge is gone when the fill happens: the book has leaned toward
  the quote. After the fill the mid gives back about 2 bps in 5 minutes and nothing more over 4 hours.
- **The weekend's held X does no harm.** A closure fill's edge against the book is the same as a weekday's (+7.9 against +8.4).
- **By hour of day** (weekday entries, against the book's mid at the fill): +6.8 (00–06 UTC), +8.7 (07–11), +9.0 (12–16) and
  +8.5 (17–23). Nothing to blackout.
- **The one soft spot is USDT-GBP's bids at four hours** (+1.0 against the mid, +1.3 against fair, band through zero).
  - USDT-GBP exits come quickly (median 6 minutes for a long, 9 for a short), so few positions live that long.
  - Three of LIVE's five stops were USDT-GBP longs.
- **Exits** rest at fair and fill when the market comes through it: +0.8 against fair, +5.3 against the book's mid.

## 4. Candidates replayed (`scripts/replay.py`, `results/replay.json`)

**The setup.**
- LIVE's rules at £600, weekends on the held X. One change at a time, the fair through the engine's `fair_adj` hook, so the
  paper engine's quotes, re-pricing, exits and the de-peg guard all move with it.
- Inputs are causal: a snapshot or touch stamped before the minute, an hourly close once its hour has ended.
- Each candidate is paired with the base by UTC day, in bps of the £600 a day. The interval is a circular 3-day block
  bootstrap, 10,000 resamples, seed 20261029, 90 %.
- Out of sample: within each family the parameter is chosen on the first half under "at" and judged on the second.

**Windows.**
- FWD: 09-26 → 10-29, 33 days; halves 09-26 → 10-12 | 10-12 → 10-29.
- CB: 10-11 → 10-29, 18 days; halves 10-11 → 10-20 | 10-20 → 10-29. It starts when Coinbase's touch is recorded.
- HIST: the committed tape, 08-26 → 09-23, for candidates that need only X and the hourly closes.

**Bases.**

| window | "at" | "through" |
|---|---|---|
| FWD | 13.25 bps a day (541 trips, 3 stops) | 10.52 (375 trips) |
| CB | 12.65 | 10.10 |
| HIST | 6.66 | 5.33 |

**The candidates, against the base** (difference in bps of capital a day; band; P ≤ 0):

| candidate | window | "at" | "through" | halves "at" | USDC-GBP / USDT-GBP share, "at" |
|---|---|---|---|---|---|
| fairU at par ($1, no peg term) | FWD | **−3.06** (−4.56 to −1.59) 1.00 | −2.89 (−4.25 to −1.58) 1.00 | −2.37 / −3.71 | −0.03 / **−3.04** |
| fairU = USD book's live mid | FWD | −0.60 (−1.71 to +0.61) 0.81 | −0.05 | −0.92 / −0.31 | −0.64 / +0.04 |
| … its 60-min EMA | FWD | −0.39 | −0.05 | +0.16 / −0.90 | −0.27 / −0.11 |
| … its 6-hour EMA | FWD | −0.99 (−2.08 to +0.03) 0.95 | −0.12 | −0.55 / −1.40 | −0.39 / −0.60 |
| fairU = median of 3 h of closes | FWD | −0.49 0.87 | −0.10 | +0.21 / −1.14 | −0.14 / −0.35 |
| … 6 h | FWD | −0.35 0.85 | −0.58 0.93 | −0.18 / −0.51 | −0.01 / −0.34 |
| … 12 h | FWD | −0.41 0.88 | −0.87 0.98 | −0.24 / −0.57 | −0.04 / −0.37 |
| ¾ fair + ¼ book's clean mid | FWD | +0.50 (−0.72 to +1.71) 0.25 | +0.58 (−0.25 to +1.42) 0.12 | +1.24 / **−0.21** | −0.19 / +0.69 |
| ½ fair + ½ book's clean mid | FWD | −0.56 | −1.16 0.94 | −0.30 / −0.79 | −0.90 / +0.35 |
| ½ fair + ½ book's microprice | FWD | −0.72 0.85 | −1.24 0.96 | +0.01 / −1.40 | −0.45 / −0.27 |
| fair × (1 + ½ EMA60 of the book's basis) | FWD | +0.15 0.42 | −0.04 | −0.26 / +0.53 | −0.47 / +0.61 |
| fair × (1 + EMA60 of the basis) | FWD | −1.53 (−2.80 to −0.30) 0.98 | −1.38 0.99 | −1.28 / −1.76 | −1.09 / −0.44 |
| fair × (1 + ½ EMA360 of the basis) | FWD | −0.05 | +0.16 | −0.19 / +0.07 | −0.66 / +0.61 |
| fair × (1 + EMA360 of the basis) | FWD | −0.15 | −0.57 | −0.34 / +0.03 | −0.84 / +0.69 |
| X extrapolated ½ its last move | FWD | −0.94 0.92 | −0.33 | −1.20 / −0.69 | −0.49 / −0.45 |
| X extrapolated its whole last move | FWD | −0.52 0.76 | −0.05 | −0.28 / −0.75 | −0.51 / −0.01 |
| Coinbase deviation, ½ weight | CB | +0.36 (−0.73 to +1.50) 0.30 | +0.45 (−0.10 to +0.97) 0.09 | −0.84 / +1.55 | **+0.64** / −0.28 |
| Coinbase deviation, full weight | CB | −0.46 | −0.84 | −2.29 / +1.37 | **+0.57** / −1.03 |
| Coinbase deviation, closures only | CB | −0.09 | −0.41 0.97 | −1.07 / +0.89 | +0.59 / −0.68 |
| ½ fair + ½ Coinbase mid | CB | +0.35 | −0.53 | −1.71 / +2.41 | +0.41 / −0.06 |

**On the committed tape** (HIST; "at" / "through"):
- the 6-hour peg median −0.14 / +0.62 (P ≤ 0 0.002 under "through");
- X extrapolated: −1.03 / −0.60 at ½ its move, −0.89 / −0.79 at the whole (each P ≤ 0 ≥ 0.95);
- par −0.48 / −0.08; the 3-hour median +0.04 / −0.35.

**Out of sample** (chosen on the first half under "at", judged on the second; `oos` in the result):

| family | chosen | second half, "at" | second half, "through" |
|---|---|---|---|
| book mid blend | ¼ weight | −0.21 | −0.19 |
| book microprice blend | — | −1.40 | −2.73 |
| book basis EMA | 6 h, ½ weight | +0.07 | −0.81 |
| USD book live mid | 60-min EMA | −0.90 | −1.13 |
| shorter peg median | 3 h | −1.14 | −0.75 |
| X extrapolation | whole move | −0.75 | −0.47 |
| par | — | −3.71 | −4.30 |
| Coinbase deviation | ½ weight | +1.55 (−0.36 to +3.10, P ≤ 0 0.11) | +0.60 (−0.02 to +1.22, 0.06) |
| ½ fair + ½ Coinbase mid | — | +2.41 | −0.87 |
| Coinbase, closures only | — | +0.89 | −0.13 |

Only the Coinbase deviation is ahead out of sample under both fills. Its per-book split says the gain is all USDC-GBP's.

**Why moving toward the book does not pay.** The edge comes from flow that crosses Revolut X's book at prices away from
interbank. A fair that follows the book joins the book's own makers: more fills on the side the book has moved to, and
they are the fills that lose. This is the 2026-10-27 review's basis-adjusted finding again, now on the book rather than on
prints, and at short half-lives as well as 24 hours.

## 5. The lead: USDC-GBP nudged by Coinbase's USDC-GBP (`scripts/lead.py`, `results/lead_usdc_cb.json`)

Added after `replay.py`'s first run, and labelled so.

**The rule.** USDC-GBP's fair × (1 + w × dev), where dev = Coinbase's USDC-GBP mid ÷ fair − 1 − its EMA over hl minutes.
- It reads only the touch stamped before the minute.
- It is skipped when the touch is over 5 minutes old or |dev| ≥ 50 bps.
- USDT-GBP is left as it is.

In effect it is a live GBP/USD read off Coinbase's dollar coin, which Coinbase prices at a dollar. It moves with sterling
inside the minute and through the weekend.

**What the replay finds** (CB window, USDC-GBP's share of the £600 in bps a day):
- **All 42 runs are positive** (w 0.25 / 0.5 / 0.75 / 1, hl 6 h / 24 h / 48 h, three fill rules, weekday-only and
  closure-only), from +0.15 to +1.41.
- **The replay's choice, w ½ and hl 24 h:**

  | fill | difference | band | P ≤ 0 |
  |---|---|---|---|
  | "at" | +0.64 | −0.16 to +1.46 | 0.09 |
  | half-queue | +0.51 | −0.16 to +1.24 | 0.11 |
  | "through" | +0.58 | −0.12 to +1.26 | 0.08 |

  - Trips 111 → 118 under "at", and 9.96 → 10.44 bps a trip: more fills, and better ones.
  - By week: +6.59, +1.37, +3.54 bps in all (the last week is four days).
  - Weekdays alone: +0.42 / +0.27 / +0.46. Closures alone: +0.32 / +0.33 / +0.24.
- **On USDT-GBP the same nudge, measured on the USDC book, loses in 12 of 12** (−0.44 to −2.62). Coinbase's own USDT-GBP nudge
  lost too (§4).
  - So the gain is not GBP/USD speed. If it were, USDT would gain as well, and the 2026-09-28 study priced faster X at about
    nothing.
  - It looks like the tie between the two venues' USDC-GBP books, which arbitrage between them may enforce.

**What it would be worth.** About +0.6 bps of capital a day: some +2 %/yr on capital, against the base's ~13 bps a day in
this replay (about 20 % above LIVE's own level, per PR5-OPT's calibration).

**How far to trust it.**
- 18 days, one regime, three weekends.
- The 42 runs are one window seen through correlated settings, not 42 tests.
- No interval excludes zero at the chosen setting.

It is a reason for a paper twin, not for a live change.

## 6. Recommendations, ranked

1. **Keep today's fair on every Revolut X row and both coins: LIVE, the weekend replica and every twin.**
   - Nothing replayed is robustly better on both books.
   - The peg term (the coin's own USD-book median) is worth about 3 bps of capital a day on USDT-GBP, against par.
   - Leave untried for now: a faster or extrapolated GBP/USD, a shorter peg median, a live USD-book mid, any blend with
     Revolut X's own mid or microprice, any Coinbase input on USDT-GBP, a Coinbase-drift weekend fair on both books. Each
     replays flat or worse.
2. **USDC-GBP: one paper twin, if Davies wants it.** `live600`'s rules with the §5 nudge on USDC-GBP alone (w 0.5, hl 24 h),
   pre-registered from `reviews/TEMPLATE-variant-prereg.md`, 28 days against `live600`, its bar written before it starts.
   - **To build:**
     - a twin-only rule (`rules.fairNudge`) that applies the nudge where the twin's replica decides a minute;
     - a read of `cb_touch`, which the Coinbase recorder already writes every minute. An older touch falls back to today's fair.
   - **The risk** is a Revolut X row leaning on the Coinbase recorder. LIVE's instance would carry none of it.
   - **Not straight to live.** The gain is small (about +5 % of the replayed return), and the evidence is 18 days with no
     interval clear of zero.
3. **Nothing for USDT-GBP's fair.** Its soft spot, the long held past an hour (§3), is the stop's and the exit's question,
   which PR5-OPT priced (the 24-hour stop: keep).
4. **For the watch, no rule change.** The clean book stands wholly more than 10 bps from fair in 11 % of USDT-GBP's snapshots.
   That is when the inner rung is refused, and it is normal: §2 shows the book returns.

**Where this stands against the earlier reviews.** It overturns nothing.
- It confirms PR5-OPT (2026-10-27, §2: the fair, keep; a basis-adjusted fair worse) on two more days and with the book's own
  basis.
- It confirms the fast-X study (2026-09-28: a faster X is worth about nothing): extrapolating X loses on both records.
- It adds:
  - that the peg term is what makes USDT-GBP work;
  - that LIVE's fills keep about 8 bps against the market;
  - the one USDC-GBP lead.

## 7. Limits

- **The book snapshots.** About one a minute and five levels deep. Removing LIVE's own orders is approximate: a partly filled
  order counts at its remainder for its whole life, and the 50-coin touch skips small orders that may be real.
- **The replay.** PR5-OPT's, with its stated omissions: the governor, the daily loss stop, the USD half of the de-peg guard, the
  asks' inventory, outages. Its levels are about 20 % above LIVE's. The "refusals" in the result are blocked checks counted
  each minute, not POSTs.
- **Coinbase from 10-10.** Every Coinbase candidate has 18 days and three closures. No Coinbase USDT-USD or Yahoo-independent
  GBP/USD was recorded, so a cleaner FX test was not possible.
- **Not run.** Inventory skew was not re-run (PR5-OPT: worse). The paper engine's own trips were not re-scored apart (the
  replay's paper layer is that engine). Coinbase and OKX rows are the other study's.
