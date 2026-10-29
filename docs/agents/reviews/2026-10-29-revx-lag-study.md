# Revolut X's lag against the fair: can LIVE's rules use it? (REVX-LAG, 2026-10-29)

Davies, 2026-10-29, after FX-SPEED-RX found that Revolut X's lever is the venue's own minutes-long lag against the fair
rather than the FX source (`2026-10-29-fx-second-sources.md` §9.6): "这个有办法解决吗？有的话仔细研究" (can this be solved? If so,
study it carefully).

Paper money only, no figure of Davies' accounts. No engine, rule, row or frozen file changed. Not blind: every record
was read for research (no no-peek rule since 2026-10-04).

## 0. Answers first

1. **The book is predictable, but not in a way a maker can sell.**
   - From what LIVE knows when it decides, the level of Revolut X's next prints over the coming hour is forecast with an
     out-of-sample R² of 0.42 (USDC-GBP) and 0.26 (USDT-GBP). Forecasts over 2 bps get the sign right 72 % and 68 % of the
     time.
   - Almost all of it is Coinbase's premium over the book's last prints, plus a slow pull back toward fair. It says where
     the next print will land against a stale last print, not where the touch is going.
2. **Every way of leaning on that forecast loses money, on every row, by £60–330 a year.** Leaning means quoting around the
   forecast (families 1 and 4), quoting one side only (family 2), or Coinbase's lead (family 3).
   - Example, LIVE's rules at £600 out of sample: −£80 (predicted mid, w 0.5), −£155 (one-sided, 6 bps), −£71 (Coinbase's
     lead, w 0.5).
   - They give up the uninformed flow that pays LIVE's ~16 bps a trip: trips fall 24–35 %. They earn back at most 3–4 bps
     a trip on the trips left.
3. **Variant-7's own Coinbase nudge does not hold over the long history.** Run exactly as it runs (a 24-hour EMA basis,
   half the deviation), it made +£17 a year in sample for LIVE's rules and −£5 out of sample [−£17, +£7].
   - On USDC-GBP alone it is +£0.05 out of sample.
   - Variant-7 keeps running as pre-registered. This is a further, non-blind read for its reading to name.
4. **Taking the lag never pays.**
   - On the recorded books (09-26 → 10-29), buying the touch when the forecast says up, and the reverse, loses 20–42 bps a
     trade with both legs taker.
   - It still loses 8–27 bps with a free exit at the mid.
   - The touch is 5–7 bps wide and the fee 9 bps a side. The forecast moves are smaller than one fee.
5. **One thing passes the bar on every row: resting every exit one tick beyond fair** (`exit1`, family 4's static form).
   - Out of sample, against today's rule, £ a year [90 %]: live600 **+£26 [+£16, +£37]**, live1200 **+£48 [+£31, +£65]**,
     take50's maker side **+£22 [+£15, +£30]**, variant-5 **+£31 [+£19, +£43]**. P(≤ 0) 0.000 on each, 11–12 months of 12
     positive.
   - It holds under every fill assumption tried: PR5's through-only +£23; a quarter of each at-price print +£28.
   - Its gain has shrunk lately: about +£0.45 a month in September and October against +£2.5–5.7 before.
   - It conflicts with the 2026-10-09 F3 replay, which found the same offset losing under at-price fills over 16 days (§5).
6. **Recommendation:**
   - **A paper twin of LIVE's rules with `exitOffset` 1 tick, beside the LIVE twin as its control, pre-registered.** The rule
     extension already exists (`TWIN_RULES.exitOffset`, `QuoteLiveInstance.exitOffset`), so it is a migration and a
     pre-registration, no engine change.
   - Nothing for LIVE until that twin has run its window and Davies says so. LIVE's own exits changed on 10-29
     (`exitTicksOnBook`), which the replay does not model.
   - Nothing else from this study is worth a twin.

## 1. The data, and when each input is known

- **Revolut X UK's every public print**: the committed tape (`backtests/inputs/pr5_2026-09-23`, prints from 2025-10-01; scored
  from the listings, USDC-GBP 2025-11-26 and USDT-GBP 2025-12-16, to 09-23) and the recorded prints of 09-26 → 10-29
  (REVX-FAIR's `fair_price/data`).
  - The recorded books from 09-26 (`book_*.txt`, LIVE's own orders taken out with its order pull) are used for the taker
    test only. The tape has no book.
- **The fair** is PR5's minute record as the engine reads it: fairU (the USD book's 24 h median of hourly closes) over X (the
  tape's Exness minute close; Yahoo's stored bar on the recorded window).
- **GBP/USD** at minute starts: FX-SPEED-RX's Exness file.
- **Coinbase's USDC-GBP and USDT-GBP**: each minute's last print to 2026-10-08 (SCQ-VENUES' bars, stamped at the minute's
  end), then the recorder's touch from 10-10.
- **Timing.** The paper call decides minute t at t + 85 s, and LIVE's executor rests its orders from about t + 90 s
  (production: a median 32.4 s after `paper_live` = t + 60 s, §9.3 of the FX review).
  - Every input of the forecast is taken as of T = t + 60 s: stamped before it.
  - The engine's paper orders for minute t live from t + 60 s and the executor's from t + 90 s. Nothing a candidate reads
    is later than the fills it faces.
- **Split, fixed before any run** (as FX-SPEED-RX): in sample from the listings to 2026-05-12, out of sample 05-12 → 10-29. Every
  fitted number (the forecast's coefficients, a family's parameter) comes from the in-sample half alone.

## 2. The mechanism (`scripts/signals.py` → `results/signals.json`)

**The gap.** G = the book's print level (VWAP of the last 15 minutes' prints, else its last print within 2 h) against fair,
on every open minute:

| book | median | p10 | p90 | \|G\| > 10 bps | persistence (hourly samples): 1 h / 4 h / 24 h |
|---|---|---|---|---|---|
| USDC-GBP | −5.6 bps | −23.7 | +16.9 | 58 % of minutes | 0.34 / 0.15 / 0.08 |
| USDT-GBP | +1.8 bps | −25.9 | +29.5 | 61 % of minutes | 0.44 / 0.26 / 0.10 |

The book sits more than 10 bps off fair most of the time, and that gap is noisy rather than slow. An hour later a third of
it is left on average, and a day later almost none.

**The forecast.** The book's next prints over h minutes (their VWAP from T + 30 s against its level at T), fitted on G, dX
(GBP/USD's last 15 minutes) and D (Coinbase's price of the coin against fair, less G):

| book, horizon | coefficients in sample: G / dX / D | R², in / out of sample | sign right where the forecast is over 2 bps, out of sample |
|---|---|---|---|
| USDC-GBP, 15 min | −0.21 / +0.16 / +0.60 | 0.44 / 0.41 | 68 % |
| USDC-GBP, 60 min | −0.19 / +0.06 / +0.65 | 0.42 / 0.42 | 72 % |
| USDC-GBP, 240 min | −0.17 / +0.03 / +0.70 | 0.43 / 0.41 | 76 % |
| USDT-GBP, 15 min | −0.13 / +0.16 / +0.46 | 0.31 / 0.20 | 61 % |
| USDT-GBP, 60 min | −0.11 / +0.14 / +0.52 | 0.37 / 0.26 | 68 % |
| USDT-GBP, 240 min | −0.11 / +0.02 / +0.59 | 0.42 / 0.37 | 73 % |

- **Coinbase leads**: the next prints close 46–70 % of Coinbase's premium over the book's last prints.
- **The book reverts toward fair** by 11–21 % of the gap per horizon.
- **GBP/USD adds little**: 0.03–0.16 of the last 15 minutes' move.
- **What the forecast is not.** Revolut X USDC-GBP printed about 45 times a day over its history (79 a day in October), so
  the "book level" is often a print an hour old. The forecast is mostly that the next print will be near where Coinbase
  says the coin is.
  - That is real, but the quotes in the book are usually already there. The taker test (§4) shows the touch does not move
    by the forecast.

**Who trades these books** (all prints since the listings):

| book | prints | median print | p90 | share that buy | share that buy, by tercile of dX (GBP/USD's 15-min move) | by tercile of D (Coinbase premium) |
|---|---|---|---|---|---|---|
| USDC-GBP | 15,262 | £118 | £2,171 | 43 % | 45.8 / 43.4 / 40.3 % | 45.4 / 45.1 / 39.0 % |
| USDT-GBP | 51,574 | £99 | £1,331 | 57 % | 58.9 / 57.5 / 56.7 % | 57.8 / 57.1 / 58.2 % |

- **The flow is retail-sized and one-way by book.** USDC-GBP's takers sell on balance and USDT-GBP's buy.
- **It barely follows the signals.** Buying moves by 0–6 points across the terciles of GBP/USD's move or Coinbase's premium.
- **Nobody here races interbank or Coinbase.** That is why LIVE's quotes are filled at a profit (about 16 bps a trip in the
  replay), and why leaning away from that flow costs what it saves.

## 3. The candidates, replayed (`scripts/lag_engine.py` → `results/lag_engine.json`)

**The engine and the rows.** PR5-OPT's LIVE-realistic replay is imported unchanged, with each candidate entering through
the engine's own hooks: `fair_adj`, the per-side `gate`, `exit_off`. The rows, as `agent_quote_twin_specs` has them:
- `live600`: LIVE's rules, £600, "at".
- `live1200`: the same at £1,200.
- `take50`: PR5's paper rules, through-only fill, no weekend. Its taker leg needs recorded books, so only its maker side
  is here.
- `n600usdt3` (variant-5): USDT 3:1.
- Variant-7 is §3.2's nudge.

**The bar, written before any run.** Against today's rule on the same row:
- out of sample, mean > 0 with P(≤ 0) < 0.10 (3-day circular blocks, 10,000 draws, seed 20261029);
- in sample, mean > 0;
- at least two thirds of the calendar months positive.

A family's parameter was chosen on live600's in-sample mean alone. Every candidate is outside FX closures; inside one, the
engine's fair.

### 3.1 Results, £ a year against today's rule (out of sample [90 %], P(≤ 0); in sample; months positive)

| candidate | live600 | live1200 | take50 (maker side) | variant-5 |
|---|---|---|---|---|
| **pred_w0.5** (quotes and exits around the forecast, half weight; chosen) | −80 [−102, −60], 1.0; IS −94; 1/12 | −137; IS −149; 1/12 | −67; IS −94; 1/12 | −100; IS −113; 1/12 |
| pred_w1 | −145; IS −209 | −244 | −127 | −181 |
| **gate_th6** (withdraw the side the forecast runs into beyond 6 bps; chosen) | −155 [−193, −117], 1.0; IS −282; 0/12 | −250 | −140 | −187 |
| gate_th3 | −196; IS −335 | −320 | −176 | −237 |
| **cbD_w0.5** (fair moved by half of Coinbase's forecast lead; chosen) | −71 [−91, −52], 1.0; IS −101; 1/12 | −119 | −61 | −88 |
| cbD_w1 | −143 | −233 | −130 | −181 |
| **exit1** (every exit one tick beyond fair) | **+26 [+16, +37], 0.000; IS +50; 12/12** | **+48 [+31, +65]; IS +83; 12/12** | **+22 [+15, +30]; IS +31; 11/12** | **+31 [+19, +43]; IS +60; 12/12** |

**What the leaning does to the record** (live600, out of sample):

| | P&L | trips | stops | bps a trip | median hold |
|---|---|---|---|---|---|
| today's rule | £252.67 | 3,592 | 46 | 16.22 | 0.74 h |
| pred_w0.5 | £215.98 | 2,705 | 58 | 18.92 | 1.06 h |
| gate_th6 | £181.97 | 2,636 | 41 | 16.33 | 0.81 h |
| cbD_w0.5 | £220.15 | 2,719 | 61 | 19.07 | 1.07 h |
| exit1 | £264.67 | 3,516 | 57 | 17.30 | 0.83 h |

- **Leaning cuts a quarter to a third of the fills.** It earns 2.7 bps more on the predicted-mid and Coinbase arms and
  nothing on the one-sided arm.
- **The fills given up were profitable.** The flow that filled them was the uninformed flow of §2.
- **Leaning also holds longer** (0.74 → 1.06 h) and stops more (46 → 58–61): the inventory risk of leaning shows up as
  stops.

### 3.2 Variant-7's nudge over the whole history (`scripts/nudge.py` → `results/nudge.json`)

Exactly `quotes_nudge.ts`: half the deviation of Coinbase / fair − 1 from its 24-hour EMA, none at 0.5 % or more. On both
books (variant-7 runs USDC-GBP alone).

| row | in sample | out of sample [90 %], P(≤ 0) | USDC-GBP alone, out of sample | months |
|---|---|---|---|---|
| live600 | +17.0 | −5.1 [−16.8, +6.8], 0.76 | +0.05 [−6.3, +6.6], 0.50 | 6/11 |
| live1200 | +25.0 | −6.2 [−27.1, +14.5], 0.69 | +4.5 [−7.5, +17.0], 0.28 | 5/11 |
| take50 | +9.4 | +11.0 [−0.6, +23.4], 0.06 | +4.2 [−1.7, +10.7], 0.13 | 5/11 |
| variant-5 | +15.9 | −6.3 [−19.6, +7.7], 0.78 | +0.9 [−3.1, +5.0], 0.37 | 5/11 |

REVX-FAIR's §5 lead (18 days, 10-11 → 10-29) does not survive the out-of-sample half of the history. Variant-7 runs as
pre-registered; its reading should name this study as a further non-blind read.

## 4. Taking the lag (family 5; `scripts/robust.py` → `results/robust.json`)

On the recorded books (2026-09-26 → 10-29, LIVE's own orders removed), at each open minute whose forecast (§3) exceeds θ:
- buy the best ask holding at least 50 coin, as of the decision (t + 85 s), or sell the bid when the forecast is below −θ;
- pay 0.09 %;
- close 60 minutes later at the recorded touch (taker, 0.09 % again) or, as a bound, at the recorded mid with no fee.

| book, θ | trades a day | both legs taker, bps a trade | bound: free exit at the mid | share of trades positive |
|---|---|---|---|---|
| USDC-GBP, 10 bps | 125.6 | −28.9 | −13.8 | 2.0 % |
| USDC-GBP, 20 bps | 8.6 | −31.6 | −16.0 | 2.1 % |
| USDC-GBP, 25 bps | 1.2 | −42.1 | −26.6 | 2.6 % |
| USDT-GBP, 10 bps | 134.2 | −21.2 | −8.9 | 3.2 % |
| USDT-GBP, 20 bps | 8.8 | −21.5 | −8.9 | 7.9 % |
| USDT-GBP, 25 bps | 1.3 | −30.7 | −18.9 | 0 % |

- The touch is a median 6.65 bps (USDC-GBP) and 5.34 bps (USDT-GBP) wide, so the spread alone costs about 6 bps, and the
  fee 9 bps a side.
- The forecast is of the next print, and the touch is already where that print will land. **It never pays, at any
  threshold.**
- An earlier tape-only version (`lag_engine.py`'s `taker`, which bought at the last print) looked profitable at 25 bps. It
  is kept in the results as what the stale last print does to such a test.

## 5. The one pass: exits one tick beyond fair

**Robustness** (live600, each paired with today's rule under the same fill assumption):

| fill assumption | out of sample, £/yr [90 %] | in sample | months | trips (today → exit1), stops, bps a trip |
|---|---|---|---|---|
| LIVE's "at", the whole at-price print (as run) | +26.2 [+15.8, +36.6] | +50.0 | 12/12 | 3,592 → 3,516; 46 → 57; 16.22 → 17.30 |
| "at", half of each at-price print | +27.6 [+18.3, +37.0] | +47.9 | 12/12 | 3,549 → 3,471; 51 → 60 |
| "at", a quarter | +28.4 [+19.9, +37.2] | +46.4 | 12/12 | 3,530 → 3,449; 57 → 62 |
| PR5's through-only | +23.5 [+15.0, +32.2] | +37.9 | 11/12 | 3,102 → 3,002; 59 → 68 |
| two ticks (`exit2`), "at" | +47.8 [+32.3, +63.5] | +89.4 | 11/12 | 3,592 → 3,383; 46 → 66; 16.22 → 18.49 |

- **By book** (live600, out of sample): USDC-GBP +£7.4 [+2.9, +12.0], USDT-GBP +£18.8 [+10.8, +26.6]. Every row is
  positive on both books.
- **By month, live600, £**: Nov 0.44; Dec 2.73; Jan 3.53; Feb 3.29; Mar 5.75; Apr 5.74; May 2.55; Jun 3.31; Jul 3.90;
  Aug 2.75; **Sep 0.45; Oct 0.44**. The gain has nearly gone in the two months LIVE itself has traded these books. Since
  10-01 LIVE's own fills are among the tape's prints, so the replay of those weeks sees its own trades.
- **Why it works in the replay.** The book's prints scatter ±20 bps around fair (§2). An exit one tick (1.33 bps) beyond fair
  is reached by the same uninformed flow minutes later: +1.1 bps a trip for 2 % fewer trips and a few more 24-hour stops.
  Two ticks earn more and stop more (46 → 66).
- **The conflict.** The F3 replay of 2026-10-09 (`backtests/scq_f3/`, the twins' own code over 09-23 → 10-09, its baseline
  equal to the twins' records to the penny) found one tick beyond fair losing −£0.198 on `p50` under at-price fills. LIVE
  then filled 22 of its 44 maker exits at their price with no print through. That is why `p50x1` was withdrawn
  (`reviews/2026-10-09-p50x1-prereg.md` §7).
  - Those 16 days fall in this replay's weakest stretch (+£0.45 a month).
  - The long history says the effect was real and steady until September. The last two months say it may be gone, or may
    be its own trading.
  - **Only a forward twin on the twins' own code can tell which.** The replay alone cannot.

## 6. Recommendation, and what it would mean for LIVE

- **Try: a paper twin "LIVE rules, exit one tick beyond fair"**, with `rules.exitOffset { ticks: 1, from }` on LIVE's rules at
  £600, against the LIVE twin (`live600`) as its control.
  - A migration of a spec row and `create_quote_twin_tables`. `exitOffset` already exists in `quotes_twin.ts` and
    `quotes_live.ts` and their tests.
  - A pre-registration from `TEMPLATE-variant-prereg.md`: 28 days, mean daily difference > 0 with P(≤ 0) < 0.10. It should
    say in advance how it reads beside the 10-29 `exitTicksOnBook` change, which rests a crossing exit one tick inside the
    book on every instance.
  - Optionally a second twin at two ticks, at more stop risk.
- **For LIVE: nothing now.** If the twin passes, the change is one instance option on LIVE's account (`exitOffset`), its own
  deviation, and Davies' word.
  - At LIVE's £600 the replay's long-run gain is about +£26 a year: a tenth of the replay's own P&L. Recently it is close
    to nothing.
- **Do not try:**
  - quoting around a forecast of the book;
  - one-sided quoting;
  - Coinbase's lead on the fair, and variant-7's nudge beyond its running twin;
  - taking the lag.
  
  Each loses out of sample on every row (§3, §4), for one reason. On Revolut X the money is in the flow that does not
  follow the market, and every lean away from it costs more fills than it saves.

## 7. Files

`docs/agents/backtests/revx_lag/`:
- `scripts/lag_data.py`: inputs and timing.
- `scripts/signals.py` → `results/signals.json`: the mechanism, the forecast and the flow.
- `scripts/lag_engine.py` → `results/lag_engine.json`: the forecast's fit, every candidate on every row and book, by month,
  and the tape-only taker.
- `scripts/robust.py` → `results/robust.json`: exit1 under four fill assumptions, exit2, and the taker on the recorded books.
- `scripts/nudge.py` → `results/nudge.json`: variant-7's nudge over the whole history.

They need `RX_EX`, FX-SPEED-RX's derived Exness file (`fx_speed/scripts/revx_long_ex.py`; its sha256 in
`fx_speed/MANIFEST_rx.json`). `robust.py`'s taker also reads `FP_LIVE`, LIVE's order pull (not committed), to take LIVE's own
orders out of the recorded books. Each replay takes 5–10 minutes on four cores.

Production reads: none new beyond the committed pulls and FX-SPEED-RX's order timing.
