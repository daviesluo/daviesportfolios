# The fair price of the Coinbase and OKX stablecoin quotes: how it is made, how good it was, what would be better (2026-10-29)

Davies, 2026-10-29: "感觉所有的stablecoin quotes的策略里最重要的就是合理价这个价格，目前实盘和测试的这么多这类策略里，你仔细深度研究下这个价格的计算还有
没有优化和改进的空间，所有数据都可以看，不同币所和币也可以结论不同" (the fair price is the most important number in every stablecoin quotes
strategy; study deeply whether its calculation can be improved, using all the data; conclusions may differ by venue and coin).
This part covers the Coinbase rows ("with Euros", "- 1", "- 2") and the OKX rows (USDG/EUR, EURC/USDC). Revolut X is studied
apart.

**Not blind, and no reading.** Every record was read for research (no no-peek rule since 2026-10-04). No pre-registered reading was
run or pre-empted: "with Euros" (11-08), "with Euros - 1" (11-10), "with Euros - 2" (its 14 days from 10-27) and the OKX twins (to
11-25) run as written, and each should name this review as a further non-blind read. Nothing was changed in production, no order
was placed or cancelled, no engine, migration or frozen file was edited. Everything below is a proposal.

**Sources.** Production read 2026-10-29 05:44–06:06 UTC, SELECT only, through the connector (`backtests/fair_price_cb_okx/sql/`), each
pull checked against the database's own md5 and committed gzipped byte for byte (`inputs/prod/`). Coinbase's public USDT-USD
one-minute candles, 2025-11-19 → 2026-10-29, read keylessly (`scripts/fetch_cb_usdt.py`). The history is the committed inputs of
SCQ-VENUES, CJ5, PR5 and OTHERVENUES. Paper money only: no figure of Davies' own accounts appears here.

## 0. Answers first

**How the fair is made today.** On Coinbase, fair = the coin's dollar value ÷ the currency's dollar rate. The coin's dollar value is
the median of Revolut X UK's USDC-USD or USDT-USD hourly closes over the last 24 hours (PR5's F3). The rate is Yahoo's one-minute
GBPUSD=X or EURUSD=X bar of the previous minute. On OKX, fair = Yahoo's EUR/USD (EURC/USDC) or its inverse (USDG/EUR), with every
coin taken at exactly 1. §1 has every detail.

**What happened** (Coinbase 2026-10-10 → 10-29, the paper rows' own record):

1. **The Coinbase fair sat below the market, on every book.** The touch mid stood above the engine's fair by a weekday median of
   **+2.2 bps (USDC-GBP), +5.6 (USDT-GBP), +5.9 (USDC-EUR) and +8.9 (USDT-EUR)**, and +5.8 to +16.3 bps inside closures on the
   weekend arm's held fair (§2.1).
   - **2 to 5 bps of it is a cross-venue mistake.** The fair prices a Coinbase coin at Revolut X's dollar price. Revolut X's USD
     books traded below Coinbase's: USDC at a median 2.0 bps under par (Coinbase converts USDC 1:1), USDT 5.2 bps under Coinbase's
     own USDT-USD.
   - **The gap has widened lately**: −6 bps on both coins from 10-20, the widest month of the year (§2.1, `peg_gap.json`).
   - **The rest is the venue.** Coinbase's EUR books trade +1.7 (USDC-EUR) and +3.8 bps (USDT-EUR) rich against Yahoo's EUR/USD.
2. **That bias, not the market, is why the USDT books lost.** A fair 6–9 bps low puts the 0.1 % ask 1–3 bps above the best
   ask and the 0.1 % bid 15–19 bps under the best bid.
   - So the asks fill and the bids almost never do: **136 of 137 USDT fills were asks**, with an edge of only +2.5 to +2.9 bps
     against the mid at fill.
   - Their exits wait at a fair the market does not come back to, so 32 of 146 base trips ended at the 24-hour stop.
   - The 2026-10-26 review read the USDT losses as a reason to drop the USDT books. §6 qualifies that.
3. **The fills themselves were good.** Across 321 fills of the three arms the fill price stood +7.0 bps better than the mid at the
   fill. One minute later +4.8 bps of it remained, after 60 minutes +5.3, after four hours +3.4: about 2 bps of adverse selection
   in the first minute and little after (§2.3).
   - The exception is 12:00–16:00 UTC (US data hours): +7.6 bps at the fill, −0.5 an hour later, −3.8 four hours later.
   - Weekend fills (21) behave like weekday ones.
4. **Staleness and crossing are small.** The FX bar was two or more minutes old in 2.2 % of lit minutes. 3 of 147 base fills
   (−£0.30) and 4 of 138 weekend-arm fills (−£0.36) were through the fair recomputed on the next FX bar. Post-only refusals were
   0.3–0.7 % of orders (§2.4–2.5).
5. **Yahoo's minute bar is partly late.** Minute changes of Coinbase's implied rate correlate 0.50 with Yahoo's bar of the same
   minute and 0.30–0.33 with its next bar: roughly 40 % of a minute's move reaches the engine a minute late (§2.6).

**What would be better.** Each candidate was replayed with the paper rows' own fill model (PR5's frozen simulator, which reproduces
the engine's trips exactly, §3). It was chosen on 2025-11-21 → 2026-05-15 and judged on 2026-05-15 → 10-09, then on the 19
production days. Figures are £ a year on the £2,400 test, paired against today's fair with a day-block bootstrap (5th–95th
percentile).

| change | history, out of sample | production, 10-10 → 10-29 | stops, history OOS | verdict |
|---|---|---|---|---|
| Coinbase's own coin price (`cb_live`: USDC 1, USDT Coinbase USDT-USD's last minute) | **+£6.1** [−14.5, +27.5]; weekend arm +£13.0 [−9.2, +36.4] | +£13.8 [−39, +73]; weekend arm +£17.9 [−45, +90] | 60 → 7; worst day −£3.10 → −£1.40 | **adopt in the next Coinbase arm** (paper twin first) |
| the same plus a 6-hour trailing basis (`cb_own+b6h_1.0`) | +£9.4 [−11.7, +31.7]; weekend arm −£0.9 | +£10.4; weekend arm +£39.7 | 60 → 1 | as good, one parameter more: optional |
| FX read a minute later (one minute staler) | −£11.2 [−25.4, +2.4] | | | a faster rate matters… |
| FX of the minute being decided (look-ahead bound) | **+£38.3** [+16.3, +62.7] | | | …and up to this much: worth a recorded feed first |
| Coinbase-implied FX from the sibling book (no Yahoo) | −£6.6 [−34.1, +20.7] | +£35.3 [−26, +107] | | no |
| the venue's own price, no FX anchor (blend at weight 1) | −£16 to −£53 | −£103 to +£8 | | no: the FX anchor IS the edge |
| inventory skew, 0.5–3 bps a rung held | −£4.9 to +£1.3 (in sample up to +£16) | | | no |
| weekend: drift the held fair with the venue (1 h basis) | +£8.4 [−14.4, +32.7] | | | no change |

None of these beats today's fair on P&L with confidence: the effects are 0–1.6 % a year on £2,400 and the intervals include zero.
`cb_live` is still worth adopting:
- it removes a cross-venue bias that has grown to 6 bps since 10-20;
- it cuts the stops by 88 % and halves the worst day;
- it takes the Coinbase rows off PR5's Revolut X inputs.

**OKX** (§4; the paper record began 2026-10-28 22:00: one round trip, so it can support no verdict):
- **USDG/EUR** trades +4.4 bps (prints) and +2.2 bps (mid) above its par fair, and buyers' prints +6.7. On OKX's history (PR5's
  simulator, OTHERVENUES' fill model, not the twins') a fair moved half-way to the book's trailing 24-hour basis adds **+£0.070 a
  day on a £300 book out of sample** [+0.039, +0.102] (07-01 → 10-27, +13 %), and every L and weight tried was positive there.
  **Recommended as a paper twin** of the USDG row.
- **EURC/USDC**: par sits on the book (mid −1.8 bps), the 0.001 step is 9 bps, and every basis term loses (history −£0.03 to
  −£0.10 a day; the exact engine on 8 days of tape −0.07 to −0.09 USDC a day). **Keep par.**

**Ranked recommendations** (§5): (1) a Coinbase paper twin on `cb_live`, or `cb_live` as a day-one rule of whatever Coinbase arm
is funded after 11-08 / 11-10; (2) an OKX USDG/EUR paper twin with the half-weight 24-hour basis; (3) record a sub-minute interbank
feed beside Yahoo before deciding anything about FX speed; (4) keep everything else. Nothing changes in a running row before its
reading.

## 1. How the fair is computed today

### 1.1 Coinbase: "with Euros" (`agents/cb_quotes.ts`), "- 1" (`cb_hold.ts`), "- 2" (`cb_usdc.ts`)

All three call PR5's frozen `stepMinute` (`quotes.ts`) once a minute per book, one minute behind the recorder (`cb_rec.ts`).

| input | what it is | where it comes from | how fresh |
|---|---|---|---|
| fairU, the coin's dollar value | the median of Revolut X UK's USDC-USD or USDT-USD **hourly closes** whose hour started in [t − 24 h, t − 1 h] (PR5's F3; `fairHours`, `median`) | `agent_quote_inputs` kind `fair:USDC-USD` / `fair:USDT-USD`, written by **PR5's paper engine** (`runQuotes` → `fetchHours`), re-written on every fetch | lags the coin by about 12 hours by construction; a 24-hour median |
| X, the currency's dollar rate | Yahoo's 1-minute close of GBPUSD=X (GBP books) or EURUSD=X (EUR books): the latest bar that **started in [t − 10 min, t − 1 min]** (`fxBarAt`) | GBP/USD from `agent_quote_inputs` kind `fx` (PR5's engine); EUR/USD from `cb_quote_inputs` (stored by this call) | the bar of t − 1 at 97.8 % of lit minutes; Yahoo's own bar is partly a minute late (§2.6) |
| the book's fair | fairU ÷ X (from Deviation 4, 2026-10-29: X is the dollar rate and fairU the coin's dollar fair, the same number) | | |
| peg assumption | **the coin is worth on Coinbase what it is worth on Revolut X's USD book**; the euro or pound is worth Yahoo's interbank rate | | |

- **Dark minutes.** No FX bar in the last ten minutes means no fair. Entry rungs are withdrawn and none is placed; a resting exit
  stays and can fill; a new exit waits for the next lit minute. That is Friday ~21:00–22:00 to Sunday ~23:00 UTC, 29 % of minutes,
  on "with Euros".
- **"- 1" and "- 2" hold the rate.** `cbHoldBarAt` uses the newest bar for up to 60 hours, so through a closure the fair is the
  coin's (still moving) F3 over Friday's last rate.
- **Release blackout** (since 2026-10-15, `cb_releases.ts`). The fair is null from one minute before to five after each listed CPI,
  NFP, FOMC, ECB and BoE release; the first one fell on 2026-10-28 18:00 UTC.
- **No other fallback.** There is no staleness check on the hourly closes beyond the 24-hour window, no check that the FX bar moved,
  and no de-peg guard. If PR5's paper engine stops writing its inputs, every Coinbase row goes dark (noted since 2026-10-12).
- **How the quote is placed off it.**
  - Rungs: bids at floor(fair × (1 − k)) and asks at ceil(fair × (1 + k)) on the book's step, k = 0.1 / 0.2 / 0.3 % (USDT-EUR's
    step is 0.00001; its prices go in ×10).
  - Re-pricing: when the fair has moved more than 0.05 % since the rung was priced. An order is live the next minute.
  - Post-only: refused when the last print is through it (`blocks`).
  - Fills: a print strictly through the price, for at most the rung (100 of the book's currency, $100 from 10-29; "- 2" a quarter
    of it) or 10 % of the minute's volume.
  - Exit and stop: the exit rests at the fair (a long's rounded up, a short's down). After 24 hours the position is stopped at
    the last print ± (Coinbase's 0.0045 % taker + half the touch).

### 1.2 OKX: "Stablecoin quotes OKX USDG" and "OKX EURC" (`agents/okx_quotes.ts`)

| input | today |
|---|---|
| fair | USDG-EUR: 1 / EUR/USD euros a USDG; EURC-USDC: EUR/USD dollars a EURC (`okxFair`): **USDG, EURC and USDC at exactly 1 USD or 1 EUR** |
| EUR/USD | the Coinbase test's stored Yahoo minute (`cb_quote_inputs`), `fxBarAt` (ten minutes) |
| weekend | inside PR5-W's closures (Friday 21:00 → Sunday 21:00 UTC and two holidays) a dark minute holds the book's last X (`okxXAt`); outside one, dark |
| releases | **no blackout** |
| guards | no entry while dark, while the last print is more than 50 bps from fair (de-peg), or after the day's trips lost 1 % of capital |

- **How the quote is placed off it.**
  - Rungs: 0.1 / 0.2 / 0.3 % on the book's own step: USDG-EUR 0.0001 (1.1 bps); **EURC-USDC 0.001, about 9 bps, as wide as a
    rung**. So a refinement of EURC/USDC's fair below ~5 bps mostly does not move its quotes.
  - Re-pricing on a 0.05 % move. Post-only against the recorded book when one is at most two minutes old, else the last print.
  - LIVE's "at" fill by the print's own size. The exit rests at fair. The 24-hour stop crosses the recorded touch at 0.10 %.

## 2. Measured against what happened (Coinbase, 2026-10-10 → 10-29)

`scripts/measure.py` → `results/measure.json`, from the paper rows' own minute record (`cb_quote_minutes`, the weekend arm's fair
from `cb_hold_minutes`), the recorder's touch read at the top of each minute (`cb_touch`), the stored rates, the three arms' 325
round trips and their order logs.

### 2.1 The fair against the book (bps; + means the market above the fair)

| book | weekday mid − base fair: median (p10, p90) | closure mid − held fair | peg gap (Coinbase coin price vs Revolut X F3) | the rest |
|---|---|---|---|---|
| USDC-GBP | **+2.2** (−1.3, +9.3) | +5.8 | +2.0 | −1.1 |
| USDT-GBP | **+5.6** (+1.0, +10.2) | +10.1 | +5.2 | +0.7 |
| USDC-EUR | **+5.9** (+1.6, +11.6) | +12.9 | +2.0 | +1.7 |
| USDT-EUR | **+8.9** (+3.7, +13.2) | +16.3 | +5.2 | +3.8 |

- **The bias is not steady.** By day it ran from −1.5 to +13 bps. USDC-GBP went from −1.5 to +1.4 bps (10-19 → 10-23) to +8.3 to
  +9.7 (10-26 → 10-28), and USDC-EUR from +1.7 to +6.7 to +9.3 to +12.6. Over those last days Revolut X's USDC-USD hourly closes
  sat mostly at 0.9983–0.9990, while Coinbase's USDC stayed at par.
- **By month, the peg gap was never zero.** Revolut X's F3 against Coinbase's coin price over the year (`scripts/peg_gap.py`):
  - USDC: Revolut X's F3 ran −4 to +4 bps from par month by month, then −6 bps over 10-20 → 10-28.
  - USDT: Revolut X against Coinbase's USDT-USD ran −3.8 to +3.9 bps a month, then −3.5 (10-10 → 10-19) and −6.1 (10-20 → 10-28).
  - Coinbase's USDT itself sat 12–13 bps under the dollar from 10-10 (and 9–11 bps in January and June to August). That is a
    real discount, which a par fair would miss.
- **The FX part is the venue's.** Coinbase's EUR books trade a few bps rich against Yahoo's EUR/USD, and OKX's USDG/EUR does the
  same (§4). That is a venue-level premium, not an FX error.

**Error of candidate fairs against the mid later** (mean |mid(m + N) / fair(m) − 1|, bps, lit weekday minutes; each fair uses only
what ended before m):

| book | engine, N = 0 / 60 | par | Coinbase's own (`cb_live`) | engine + 6 h basis | `cb_live` + 24 h basis |
|---|---|---|---|---|---|
| USDC-GBP | 3.83 / 6.11 | 1.85 / 4.96 | 1.85 / 4.96 | 1.06 / 4.63 | 1.27 / 4.76 |
| USDT-GBP | 5.63 / 7.24 | 11.85 / 12.64 | 1.53 / 4.88 | 1.44 / 4.78 | 1.23 / 4.79 |
| USDC-EUR | 6.21 / 7.66 | 2.43 / 4.95 | 2.43 / 4.95 | 1.03 / 4.65 | 1.16 / 4.56 |
| USDT-EUR | 8.67 / 9.50 | 8.70 / 9.52 | 3.78 / 5.69 | 1.43 / 4.76 | 1.16 / 4.64 |

As a forecast of the mid, the engine's fair is the worst of these on every book. That is not the same as earning less (§3): the rule
earns when prints stray from fair and come back, and a fair that hugs the mid quotes the same distance from a market that moves less
relative to it.

### 2.2 Which side fills

The 0.1 % rungs against the touch at the top of each lit minute (median bps behind the touch; share of minutes the 0.1 % ask sat at
or below the best bid, so that placing it then would have crossed):

| book | 0.1 % bid under the best bid | 0.1 % ask over the best ask | ask would cross |
|---|---|---|---|
| USDC-GBP | 12.0 | 6.6 | 9 % |
| USDT-GBP | 15.9 | 2.7 | 13 % |
| USDC-EUR | 15.6 | 3.4 | 28 % |
| USDT-EUR | 18.8 | 0.9 | 42 % |

The bid was never inside the touch. The fills followed:

| book (base arm) | trips | bids / asks | P&L, £ | bps a trip | stops |
|---|---|---|---|---|---|
| USDC-GBP | 48 | 16 / 32 | +4.45 | +11.1 | 7 |
| USDT-GBP | 28 | 0 / 28 | −0.18 | −0.9 | 5 |
| USDC-EUR | 34 | 7 / 27 | +3.28 | +9.7 | 11 |
| USDT-EUR | 36 | 0 / 36 | −0.62 | −1.7 | 9 |

### 2.3 Markouts of the fills

Signed so that **positive is in our favour**: for a bid, (mid later − fill) / fill; for an ask, the reverse. "At fill" is against
the mid read at the top of the fill's minute. Means in bps over the 321 fills of the three arms (`markouts` in `measure.json`,
which stores the negative, "adverse", sign):

| group | n | at fill | 1 min | 5 min | 15 min | 60 min | 240 min |
|---|---|---|---|---|---|---|---|
| all | 321 | +7.0 | +4.8 | +5.0 | +4.7 | +5.3 | +3.4 |
| asks | 273 | +4.7 | +2.4 | +2.5 | +2.3 | +2.8 | +0.9 |
| bids | 48 | +20.0 | +19.9 | +19.5 | +18.7 | +20.1 | +17.7 |
| USDC-GBP | 112 | +10.8 | +8.7 | +8.8 | +8.8 | +9.1 | +4.3 |
| USDT-GBP | 61 | +2.9 | −0.2 | +1.6 | +0.7 | +1.6 | +1.0 |
| USDC-EUR | 72 | +9.2 | +7.7 | +6.9 | +6.7 | +7.2 | +6.1 |
| USDT-EUR | 76 | +2.6 | +0.7 | +0.4 | +0.3 | +1.2 | +1.3 |
| 0.1 % rung | 229 | +3.2 | +1.9 | +2.6 | +2.4 | +3.1 | +2.9 |
| 0.3 % rung | 26 | +25.1 | +17.9 | +16.5 | +15.1 | +16.5 | +6.7 |
| 08:00–12:00 UTC | 67 | +8.7 | +7.4 | +8.4 | +8.5 | +11.3 | +5.3 |
| **12:00–16:00 UTC** | 110 | +7.6 | +2.9 | +2.2 | +0.9 | **−0.5** | **−3.8** |
| weekday | 300 | +7.2 | +4.9 | +5.0 | +4.8 | +5.4 | +3.2 |
| weekend | 21 | +4.8 | +3.6 | +4.8 | +4.3 | +4.4 | +5.3 |

- **Adverse selection is about 2 bps, in the first minute** (7.0 → 4.8), then flat.
- **The bids are sweeps.** Their prints come 20 bps under the mid and the book snaps back.
- **The asks earn little** because they sit near the mid (§2.2).
- **The one band where fills end against us is 12:00–16:00 UTC**, the US data hours. It is the release blackout's premise and
  argues for keeping it.

### 2.4 Stale inputs

- **FX bar age.** On the GBP books, of 18,566 lit minutes the FX bar was 1 minute old in 18,151, 2 in 223, 3 in 100, and 5–10 in
  under 0.3 %: 2.2 % two minutes or more, 1.0 % three or more. The EUR books are the same.
- **Stale fills.** 3 of 147 base fills (−£0.30 together) and 4 of 138 weekend-arm fills (−£0.36) were through the fair recomputed on
  the bar of the fill's own minute, which is known only a minute later.
- **Inputs revised after the decision.** Recomputing the fair from the stored inputs differs from the fair the engine stored by more
  than 0.5 bp in 8.7 % of minutes on the USDC books and 29 % on the USDT books (mean 0.09 and 0.25 bp; `revisions.json`).
  - The hourly closes are re-written on every fetch; the bar read was the newest stored in 98.2 % (GBP) and 100 % (EUR) of minutes.
  - Small as that is, it moves a 19-day replay by £0.83: the recomputed fair makes £6.11 where the stored one made £6.94.
  - So a difference of a pound over these 19 days is noise.

### 2.5 Crossed and refused

Post-only refusals per order placed or re-placed (order logs): base 0.31–0.66 % by book, weekend arm 0.29–0.66 %, USDC arm 0–0.84 %.
§2.2 shows why so few. The 0.1 % ask that would cross is usually already filled and waiting to exit, not being placed.

### 2.6 Yahoo's lag

Coinbase's own implied rate at the end of each minute is the USDT-USD candle close ÷ the USDT book's mid read just after. Its
minute changes, correlated with Yahoo's (17,800 weekday minutes):

| shift of Yahoo's bar | −1 | 0 | +1 | +2 |
|---|---|---|---|---|
| USDT-GBP (GBP/USD) | 0.02 | **0.50** | **0.30** | −0.00 |
| USDT-EUR (EUR/USD) | 0.03 | **0.51** | **0.33** | 0.01 |

About 40 % of a minute's move shows up in Yahoo's next bar. The 2026-10-15 review aligned the levels and found the best shift at
zero; the changes, correlated minute by minute, show the part that comes late.

## 3. Candidate fairs replayed (Coinbase)

**The harness.**
- **The simulator.** PR5's frozen `pr5_sim.simulate`, imported read-only and called unchanged: the paper rows' fill model (through
  the quote, 10 % of the minute, £100 a rung, Coinbase's stop cost). Only the book's fair array differs between candidates; the dark
  minutes are the engine's (or the held rate's on the weekend arm).
- **Reproduction checks.**
  - On production (`scripts/prod.py`), the replay of the stored fair reproduces the engine's trips on all eight book-arms, count for
    count and P&L to four decimals (`reproduce` in `results/summary.json`).
  - On history (`scripts/hist.py`), the engine's fair rebuilt here equals the one `BarBook` builds at every minute (asserted).
  - The skew engine with s = 0 equals the frozen simulator trip for trip (asserted).
- **No look-ahead.** Every input at minute t is a bar or close that ended before t: the FX bar of t − 1, hourly closes of hours that
  ended, the last USDT-USD candle, the book's own last prints of earlier minutes. The one exception is the row marked foresight, a
  bound.
- **The split.** History is SCQ-VENUES' Coinbase minute bars with the engine's own coin source, Revolut X's hourly closes, which
  start 2025-11-20.
  - In sample: 2025-11-21 → 2026-05-15. Out of sample: 2026-05-15 → 10-09.
  - Then production, 2026-10-10 (10-13 for the weekend arm) → 10-29, in halves at 10-20.
  - FX is Exness minute closes to 2026-09-30 and Yahoo's after (the engine's), so the history's FX is better timed than production's.
- **The selection rule** (fixed in `analyze.py` before its output was read): the family's best in-sample total over the four books,
  read out of sample and on production without re-choosing.
- **The bootstrap.** Day blocks, 2,000 draws, seed 20261029, of the paired daily difference against today's fair.

### 3.1 History, "with Euros"' rule (£ on £2,400; IS 175 days, OOS 147 days)

| candidate (family pick in bold) | IS £/yr | OOS £/yr | OOS Δ vs engine £/yr [p5, p95] | trips OOS | bps a trip | stops OOS | worst day | max drawdown |
|---|---|---|---|---|---|---|---|---|
| engine (today) | 223.1 | 115.4 | — | 953 | 5.19 | 60 | −3.10 | 3.10 |
| par (coins at 1) | 198.4 | 90.1 | −25.3 [−53.4, +4.0] | 798 | 4.81 | 139 | −3.16 | 6.67 |
| screen (Bitstamp USDC, Coinbase USDT F3) | 223.1 | 123.5 | +8.2 [−11.0, +27.3] | 735 | 6.93 | 12 | −2.14 | 2.14 |
| **`cb_live`** (USDC 1, Coinbase USDT-USD last minute) | 227.1 | 121.5 | **+6.1 [−14.5, +27.5]** | 733 | 6.78 | 7 | −1.40 | 1.40 |
| **`cb_own+b6h_1.0`** | 232.3 | 124.8 | +9.4 [−11.7, +31.7] | 642 | 7.93 | 1 | −1.85 | 1.85 |
| **`engine+b24h_0.5`** | 222.2 | 113.1 | −2.2 [−20.1, +16.9] | 816 | 5.83 | 18 | −1.38 | 1.38 |
| engine + 1 h basis | 213.8 | 129.8 | +14.4 [−6.1, +36.4] | 640 | 8.34 | 3 | −1.80 | 1.80 |
| **`xbook+b6h_0.5`** (sibling-implied FX) | 223.9 | 113.2 | −2.2 [−29.5, +24.8] | 677 | 6.83 | 0 | −2.03 | 2.03 |
| xbook | 222.8 | 108.8 | −6.6 [−34.1, +20.7] | 817 | 5.60 | 1 | | |
| **`venue_6h`** (no FX) | 189.1 | 99.2 | −16.2 [−84.8, +47.3] | 2,075 | 2.22 | 34 | −9.46 | 12.17 |
| engine, FX one minute older | 207.5 | 104.2 | −11.2 [−25.4, +2.4] | 1,208 | 3.79 | 55 | | |
| engine, FX of minute t (bound) | 279.2 | 153.7 | **+38.3 [+16.3, +62.7]** | 620 | 10.62 | 60 | −0.68 | 0.68 |

The full grid is in `results/summary.json`: engine and `cb_own` × basis over 1 / 6 / 24 / 72 h × weight ½ / 1, and venue medians
over 1 / 6 / 24 h.

- **The coin's dollar source matters only through the stops.** Engine, screen, `cb_own` and `cb_live` earn within ±£10 a year in
  both halves. The venue-consistent ones have a fifth to a tenth of the engine's stops and half its worst day.
- **Par is worse.** USDT is not worth a dollar: −£25 a year out of sample, and 139 stops.
- **A trailing basis on top adds nothing that holds.** 1 h is −£9 in sample and +£14 out; 24 h at full weight is −£58 in sample.
- **The FX anchor is the edge.** Every venue-only fair loses, and loses most on its worst day (−£9.46).
- **FX timing is the largest effect measured.** One minute staler costs £11 a year; seeing the decided minute's bar is worth £38
  (`fx_older` and foresight both reproduce the 2026-10-15 review's direction, here out of sample).

### 3.2 History, the weekend arm's rule ("- 1"; "- 2" is its USDC books at a quarter size)

| candidate | IS £/yr | OOS £/yr | OOS Δ [p5, p95] | stops OOS |
|---|---|---|---|---|
| hold: engine (today) | 270.1 | 190.9 | — | 115 |
| hold: `cb_live` | 272.3 | 204.0 | **+13.0 [−9.2, +36.4]** | 54 |
| **hold: screen** (pick) | 275.5 | 196.0 | +5.1 [−16.4, +26.6] | 62 |
| **hold: `cb_own+b6h_1.0`** | 291.2 | 190.1 | −0.9 [−25.0, +25.3] | 2 |
| **hold: engine + 1 h basis** (the "held fair drifts with the venue" candidate) | 280.9 | 199.4 | +8.4 [−14.4, +32.7] | 2 |
| **hold: `xbook+b6h_0.5`** | 297.6 | 184.9 | −6.1 [−36.3, +24.1] | 0 |
| hold: par | 232.4 | 163.8 | −27.2 [−57.3, +4.8] | 191 |
| **hold: `venue_6h`** | 251.9 | 172.1 | −18.9 [−87.1, +43.9] | 15 |

By book, out of sample, `cb_live` against today (base arm / weekend arm, £):
- USDC-GBP: 14.88 vs 14.75 / 24.88 vs 23.92
- USDT-GBP: 24.34 vs 20.17 / 41.89 vs 34.67
- USDC-EUR: 7.14 vs 7.92 / 9.06 vs 10.18
- USDT-EUR: 2.57 vs 3.62 / 6.33 vs 8.13

The GBP books gain and the EUR books lose a little, which is the residual EUR premium of §2.1.

### 3.3 Production, 2026-10-10 → 10-29 (£ in total; Δ in £ a year [p5, p95])

| candidate | base: 10-10 → 10-20 | 10-20 → 10-29 | all, Δ | weekend arm: all, Δ | stops (base / weekend) |
|---|---|---|---|---|---|
| the engine as it ran (stored) | 2.90 | 4.04 | 6.94 | 8.14 | 32 / 40 |
| `cb_live` | 1.93 | 5.72 | 7.65, +13.8 [−39, +73] | 8.92, +17.9 [−45, +90] | 0 / 4 |
| `cb_own+b6h_1.0` | 1.35 | 6.12 | 7.48, +10.4 [−59, +83] | 9.88, +39.7 [−54, +142] | 0 / 0 |
| `engine+b24h_0.5` | 3.50 | 4.70 | 8.21, +24.4 [−33, +85] | 9.28, +26.1 | 3 / 6 |
| xbook | 2.08 | 6.69 | 8.78, +35.3 [−26, +107] | 9.34, +27.5 | 0 / 0 |
| par | 1.69 | 6.56 | 8.25, +25.3 [−59, +118] | 9.07, +21.2 | 26 / 30 |
| venue_6h | −5.53 | 7.13 | 1.60, −102.6 | 4.26, −88.4 | 0 / 0 |

- **19 days separate nothing.** Every venue-consistent fair did worse than the engine in the first half and better in the second,
  when the Revolut X gap was widest.
- **`cb_live` removed the stops.** It made the USDT books flat instead of losing: USDT-EUR +£0.27 (56 trips, all but one asks) and
  USDT-GBP −£0.01 (8 trips).
- **USDT-EUR still fills on one side.** Its remaining one-sidedness is the venue's EUR premium (+3.8 bps), which only a basis term
  removes (`cb_own+b6h_1.0`: 3 bids, 14 asks).

### 3.4 Inventory skew (`scripts/skew.py`)

The entry rungs are priced around fair × (1 − s × net rungs held), where a long pushes both entries down; exits stay at fair.

| s, bps a rung | engine: IS Δ / OOS Δ, £/yr | `cb_own+b6h_1.0`: OOS Δ against engine |
|---|---|---|
| 0.5 | +7.1 / +1.3 | +9.9 |
| 1 | +16.2 [+1.4, +30.9] / −2.9 [−7.5, +1.4] | +10.4 |
| 2 | +8.8 / −4.0 | +7.4 |
| 3 | −2.4 / −4.9 | +3.7 |

What it gains in sample it gives back out of sample. Not worth a rule.

## 4. OKX

**The record supports a description of the books, not a verdict.**
- The twins began 2026-10-28 22:00 and have made one round trip (USDG-EUR, +€0.063). The replay below reproduces it exactly, and
  the books' fills (two USDG, one EURC) (`results/okx_replay_repro.json`).
- The recorder has EURC-USDC prints from 10-19 (509, about 50 a day), USDG-EUR prints from 10-26 (521), and book reads only from
  10-28 19:53.
- So history (OTHERVENUES' bars, PR5's simulator through the quote) carries the comparison, and the exact engine on the short tape
  checks its direction.

**4.1 The fair against the books** (`results/okx.json`, bps):

| book | prints vs par fair: median (p10, p90) | buyers' / sellers' prints | book mid vs par | mid vs Coinbase USDC-EUR fair | spread |
|---|---|---|---|---|---|
| USDG-EUR | **+4.4** (−5.6, +8.9) | +6.7 / +1.1 | **+2.2** | +0.6 | 14.5 |
| EURC-USDC | +1.4 (−30.8, +22.8) | +11.6 / −13.0 | −1.8 | −0.1 | 18.0 |

- **USDG/EUR's premium is a venue premium.** It is about the same as Coinbase's EUR books' against Yahoo (§2.1): against
  Coinbase's USDC-EUR mid it is +0.6 bps. OTHERVENUES' months show +5 to +11 bps.
- **EURC/USDC sits on par.** Its 18 bps spread and 9 bps step dwarf any sub-tick refinement.

**4.2 History** (`okx.py`; £50 a rung on a £300 book; through the quote, and the at-price arm in brackets).

| candidate | USDG-EUR IS 02-23 → 07-01: £ (trips) | USDG-EUR OOS 07-01 → 10-27: £ (trips, bps a trip) | OOS Δ £ a day [p5, p95] |
|---|---|---|---|
| par (the twins') | 0.30 (78) | 64.11 (1,654, 18.5) | — |
| **par + 24 h basis, half weight** (IS pick) | 1.61 (136) | 72.37 (1,876, 17.8) | **+0.070 [+0.039, +0.102]** (at price +0.069 [+0.042, +0.095]) |
| par + 6 h, ½ / 1 | 1.06 / 0.82 | 72.23 / 69.67 | +0.069 / +0.047 |
| par + 24 h, 1 | 1.16 | 74.02 | +0.084 [+0.045, +0.126] |
| par + 72 h, ½ / 1 | 0.75 / 0.14 | 72.28 / 74.24 | +0.069 / +0.086 |
| Coinbase USDC-EUR last print (to 10-09) | −0.58 | 59.83 | +0.022 [+0.001, +0.042] (at price −0.005) |

- **USDG-EUR: every basis variant is positive out of sample.** The in-sample half had almost no volume (78 trips in four months),
  so the choice rests on the out-of-sample window, where all six variants lie between +£0.047 and +£0.086 a day.
- **What the basis does.** At par, USDG's ladder filled 1,425 asks and 229 bids; with the basis, 1,439 and 437. Moving the fair
  up to where the book trades lets the bids fill too.
- **EURC-USDC, 09-21 → 10-27 (36 days).** Par makes £12.51, OTHERVENUES' fair (EUR/USD over Bitstamp USDC's F3) £11.84, and every
  basis variant £8.99–£11.49 (−£0.03 to −£0.10 a day; 24 h at full weight [−0.206, −0.002]).

**4.3 The twins' own engine on the recorded tape** (`okx_replay.ts`: `stepOkxMinute` imported and called unchanged; LIVE's "at"
fill by print size; after a first warm-up day; `results/okx_replay_summary.json`):

| book, days | par | par + 24 h ½ | par + 24 h 1 | Coinbase USDC-EUR |
|---|---|---|---|---|
| EURC-USDC, 10-21 → 10-29 (8.2 days) | 45 trips, +3.83 USDC, 20.7 bps | 38, +3.22 | 44, +3.00 | 46, +3.82 |
| USDG-EUR, 10-28 → 10-29 (1.2 days) | 5, +€0.24 | 5, +€0.34 | 6, +€0.17 | 4, +€0.20 |

EURC agrees with history: the basis term costs and par is right. USDG's day and a bit is too short to say anything.

**What the OKX record cannot support:**
- any reading of the USDG basis term on OKX's own fill model;
- the release blackout, which OKX's rows do not have and which was not tested here;
- whether a UK account can trade either book at 0 % maker (the pre-registration's §1).

## 5. Recommendations, per row and pair

| row · book | recommendation | expected gain | risk | how |
|---|---|---|---|---|
| "with Euros", "- 1", "- 2" · all four Coinbase books | **Price the coin at Coinbase's own dollar price**: USDC = 1 (Coinbase's 1:1 conversion), USDT = Coinbase USDT-USD's last one-minute close (keyless `/products/USDT-USD/candles`), in place of Revolut X's USD-book F3 | P&L about +£6 a year on £2,400 (+£13 on the weekend arm), not significant; stops −88 %, worst day halved out of sample; removes the 2–6 bps cross-venue bias and the Coinbase rows' dependence on PR5's paper engine | a USDT de-peg on Coinbase moves the fair with it, so a de-peg guard should compare against an outside reference (Revolut X's F3 or par); one more keyless read a minute (Coinbase allows 10 a second; the recorder uses 12 a minute) | **not in the running rows before their readings** (11-08, 11-10, "- 2"'s 14 days). Either a paper twin now ("with Euros - 3": "- 1" with `cb_live`, a one-page variant pre-registration), or a day-one rule of whichever Coinbase arm is funded after the readings |
| the same · EUR books | optionally a 6-hour trailing basis on top (`cb_own+b6h_1.0`) for the EUR premium | +£3 a year more than `cb_live`, not distinguishable | a parameter | only inside the twin above, as a second arm if Davies wants one |
| the same · FX source | **record before deciding**: a keyless sub-minute EUR/USD and GBP/USD (TrueFX's snapshot each second, as the 2026-09-28 study measured) beside Yahoo for 2–4 weeks | bound: one minute of timing is worth £11–38 a year on £2,400 in history; how much a real feed captures is unknown | a new recorder call | a recording, no rule change; replay `prod.py` with it afterwards |
| OKX USDG/EUR | **a paper twin with fair = par × (1 + ½ × the 24-hour trailing median of last print ÷ par − 1)** | history OOS +£0.070 a day on a £300 book (+13 %), +£0.039 to +£0.102 | follows a slow USDG premium or de-peg half-way (the 24-hour median moves slowly, and LIVE's 50 bps de-peg guard should stay against par); history's fill model is not the twins' | a twin row of the OKX file's rule with the one change, pre-registered for 28 days beside the running twin |
| OKX EURC/USDC | **keep par** | — | — | — |
| all · inventory skew, venue blending, sibling-implied FX, weekend drift | **keep today's rule** | none out of sample | — | — |
| all · release blackout | keep on Coinbase (§2.3's 12:00–16:00 band supports it); untested on OKX | — | — | a later study, if the OKX twins pass |

## 6. What this builds on, and where it differs from earlier reviews

- **The pre-registration of 2026-10-10 runs a different fair from its own history.** Its §1 table says the test reads "the same
  stored hourly closes" (Revolut X's); the history in its §2 (SCQ-VENUES) priced USDC at Bitstamp's USDC/USD and USDT at Coinbase's
  USDT-USD. Over 2025-11-21 → 2026-10-09 the two give the same P&L within £10 a year (§3.1: engine £223/£115 against screen
  £223/£124 a year). In the paper weeks the gap opened to 6 bps. Not a fault of the reading, which is on the record as it ran, but
  the reason the forward record diverged from history's look.
- **2026-10-12 review, §6 #4**: "moving the fair by each book's median basis made 7.6 % [against 8.0 %]". This study agrees in
  substance: on a venue-consistent fair a basis term adds nothing that holds (§3.1). The bias seen in production comes from the
  cross-venue coin price, which a basis term removes only as a side effect.
- **2026-10-15 fast-move review, §2**: "the fair was not stale … a faster FX feed has nothing to buy (lag zero)". That is
  **qualified**.
  - The levels align at zero shift, but the minute changes show about 40 % of a move arriving a bar late (§2.6).
  - On history out of sample, one minute of FX timing is worth −£11 to +£38 a year (§3.1).
  - Whether a real feed captures it is open, hence recommendation 3. The 2026-09-28 study's "worth about nothing" was measured on
    Revolut X's books, under its order budget; on Coinbase's books the bound measured here is not small, which is why it is worth
    a recording rather than a rule.
- **2026-10-26 review, §6**: "two weeks of USDT losses on Coinbase argue against the USDT books there". That is **qualified**.
  - The USDT losses were mostly the fair's bias: 136 of 137 fills were asks, and stops took the exits.
  - With Coinbase's own USDT price the two USDT books were flat over the same weeks (+£0.27 and −£0.01), not losing.
  - Over history out of sample they earned £2.6–£24 per book on `cb_live`.
  - The USDC-only arm ("- 2") is still the right forward test of its own question; this changes nothing in it.
- **CBBOOKS-1 (2026-10-18)**: "no better fair for PR5" from Coinbase's mid. Consistent: a venue mid as the fair loses here too (§3.1
  venue rows).

## 7. What this did not do

- **The OKX twins' fill model on history.** OKX's history ran through PR5's simulator, not the twins' fill rule, and the twins' own
  engine has only nine and two days of tape.
- **A faster FX feed.** Only the bounds (one minute either way) were priced. No sub-minute source was recorded.
- **Queue position.** A re-priced quote is treated as if it kept its place, as in every earlier Coinbase study.
- **Revolut X and LIVE.** Studied apart; this review used none of their records beyond the hourly closes the Coinbase engine reads.
- **The release blackout.** Not re-estimated; the 2026-10-15 study stands.
- **The candidate's de-peg behaviour.** Not modelled: no de-peg happened in the windows.
- **Re-checking each fill against post-only.** CBBOOKS-1 did that for 10-10 → 10-18 (all accepted); this review counted only
  where the rungs sat (§2.2).

## 8. Files and how to re-run

`docs/agents/backtests/fair_price_cb_okx/`, every script from that folder with `python3 -I`:

- `sql/pull_minutes.sql` (once per book), `sql/pull_inputs.sql`, `sql/pull_okx.sql`, `sql/pull_tail_1029.sql`: the read-only pulls.
  `scripts/grab.py` cuts them out of a saved connector reply and checks each md5. They are committed in `inputs/prod/`, gzipped
  byte for byte.
- `scripts/fetch_cb_usdt.py`: Coinbase USDT-USD candles, into `inputs/cb_usdtusd_1m.json.gz` (10-08 → 10-29) and
  `inputs/cb_usdtusd_1m_hist.json.gz` (2025-11-19 → 10-08).
- `scripts/fpc.py`: shared loaders, F3, the bootstrap.
- `scripts/measure.py` → `results/measure.json` (§2); `scripts/revisions.py` → `results/revisions.json` (§2.4);
  `scripts/peg_gap.py` → `results/peg_gap.json` (§2.1).
- `scripts/hist.py OUT.json.gz` (about 20 minutes on four cores; its 2 MB output is not committed) and
  `scripts/prod.py ../results/prod_runs.json.gz`, then `scripts/analyze.py HIST PROD ../results/summary.json` (§3.1–3.3).
  `scripts/skew.py` → `analyze.py SKEW - ../results/skew_summary.json` (§3.4).
- `scripts/okx.py` → `results/okx.json` (§4.1–4.2).
- `scripts/okx_replay_prep.py IN.json [repro]`, then from the repository root
  `npx --yes deno@1.46.3 run --allow-read --allow-write docs/agents/backtests/fair_price_cb_okx/scripts/okx_replay.ts IN.json OUT.json`,
  then `scripts/okx_replay_summary.py` (§4.3; `results/okx_replay*.json`).
- `MANIFEST.json`: every file's sha256 and each pull's md5.

## 9. In plain words

- **Coinbase.** The price the Coinbase tests quote around is a few bps too low. It takes the dollar price of USDC and USDT from
  Revolut X, where they trade a little cheaper than on Coinbase, and lately 6 bps cheaper.
  - So the tests mostly sold coins and then waited for a price that did not come back. That, not the market, is why the USDT books
    lost.
  - Using Coinbase's own USDC and USDT prices fixes the bias and removes almost all the 24-hour stops. Over the past year it would
    have earned about the same, a little more. I suggest it for the next Coinbase test, not for the ones being read in November.
- **FX speed.** The FX rate from Yahoo is about half a minute slow. A faster rate could be worth something on Coinbase, up to
  about 1.6 % a year on £2,400 at the very most. It needs a few weeks of recording before anyone can say how much.
- **OKX.** USDG/EUR trades a few bps above the price the test assumes. Letting the fair follow that half-way earned 13 % more over
  the past four months in the history. EURC/USDC's fair is fine as it is. OKX's own record is one day old, so a paper twin is the
  way to check.

## Addendum (2026-10-29, later the same day): the USDG/EUR basis fair on OKX's own engine, and the Coinbase coin price by book

Davies, on §4.2's "+13 %" (it came from PR5's simulator, not OKX's own fill rule): "这个你先按okx的研究下，还成立的话再上线" (study it on
OKX's own rules first; go live only if it still holds). And: "你测试的Coinbase上USDT换成Coinbase价格就更好，那usdc呢？" (Coinbase's own
price helped USDT; what about USDC?). Not blind, like the rest of this review.

### A1. USDG/EUR on the OKX twins' own engine

**The tape.**
- OKX's keyless daily trade archive for USDG-EUR, 2026-02-20 → 10-28: 55,748 prints, 248 of 251 days' files
  (`scripts/fetch_okx_archive.py` → `inputs/okx_usdgeur_archive.json.gz`, every print with its trade id, time, price, size and
  taker side).
- The recorder's own tape (`okx_trades`, 10-26 → 10-29) on top of it, de-duplicated by trade id: 55,837 prints from 2026-02-22.
- EUR/USD: SCQ-VENUES' minutes to 10-08 (Exness, then Yahoo from 10-01), then the stored Yahoo minutes the twins read.
- The recorded book from 2026-10-28 19:53. Before it, a post-only order is judged by the last print, as the engine does without a
  read (`okxCrosses`), in both arms alike.

**The engine.** `stepOkxMinute` (`okx_quotes.ts`), imported read-only and called unchanged, minute by minute
(`scripts/okx_usdg_basis_prep.py`, `scripts/okx_usdg_basis_replay.ts`).
- LIVE's "at" fill by each print's size, $100 a rung, the 24-hour stop, the dark and de-peg guards, the closure holding the last
  rate: all the engine's.
- Three arms on the same tape:
  - **par**: the USDG/EUR row's rule.
  - **basis**: fair = par × (1 + ½ b), the rule a "- 1" row would run. b is the median over the minutes of the last 24 hours with
    a print of (the minute's last print ÷ par − 1); with fewer than five such minutes, b = 0. The rung stays the par arm's euros.
  - **basis_carry**: the same, carrying the last median instead of falling back to par (this review's replay rule).
- The incremental median was checked against a direct scan at 359 minutes; all equal.
- The account's 1 % daily loss stop is left out of all three. No UTC day of any arm closed −1 % of $600, so it would never have
  fired.
- The setting was fixed before this ran (½, 24 hours): nothing was chosen on the earlier half.

**The basis itself.** Over the lit minutes it was +6.8 bps at the median (10th percentile +1.5, 90th +10.2): USDG traded above
par almost all the time.

**Results** (`scripts/okx_usdg_basis_summary.py` → `results/okx_usdg_basis_okxengine.json`; P&L in euros by entry minute; Δ is
the paired day-block bootstrap of basis − par, 2,000 draws, seed 20261029; P(≤ 0) is the share of draws at or below zero):

| window | arm | trips (bids / asks) | € | € a day | bps a trip | stops | worst day € | Δ € a day [p5, p95] | P(≤ 0) | gain on par |
|---|---|---|---|---|---|---|---|---|---|---|
| 02-23 → 07-01 (128 days) | par | 167 (53 / 114) | 4.46 | 0.035 | 5.29 | 41 | −0.47 | | | |
| | basis | 190 (131 / 59) | 4.70 | 0.037 | 5.55 | 25 | −0.59 | +0.002 [−0.017, +0.020] | 0.43 | +5.5 % |
| **07-01 → 10-29 05:30 (121 days)** | par | 1,768 (276 / 1,492) | 77.18 | 0.638 | 16.09 | 22 | −0.22 | | | |
| | **basis** | 2,022 (525 / 1,497) | 97.52 | 0.806 | 16.88 | 7 | −0.13 | **+0.168 [+0.099, +0.234]** | **0.000** | **+26.4 %** |
| second half by date (06-11 12:00 →) | basis | 2,030 | 98.18 | 0.785 | 16.82 | 7 | −0.13 | +0.164 [+0.101, +0.234] | 0.000 | +26.3 % |
| first half by date | basis | 182 | 4.05 | 0.032 | 5.14 | 25 | −0.59 | +0.001 [−0.019, +0.020] | 0.44 | +3.4 % |
| whole span | basis | 2,212 | 102.23 | 0.411 | 15.44 | 32 | −0.59 | +0.083 [+0.048, +0.119] | 0.000 | +25.2 % |

The carry rule gives the same later half to the cent (the window never had fewer than five minutes there). In the thin first half
it gives +13.7 % against the fallback's +5.5 %.

**Verdict: it holds, and more strongly than on PR5's simulator.**
- **The later half** is +€0.168 a day out of sample, P(≤ 0) = 0.000, +26 % on par. §4.2 had +£0.070 a day on a £300 book, +13 %.
- **Per year** that is about €61 on a $600 book, roughly 12 % of its capital.
- **Why.** The basis lets the bids fill (525 against 276) where par sold USDG into the premium and waited. It earns more a trip
  (16.9 against 16.1 bps) and cuts the stops (7 against 22).
- **The earlier half had almost no trading** (0.035 € a day) and is flat: nothing there argues either way.
- **The caveat that remains.** Before 10-28 the replay had no recorded book, so post-only refusals are judged by the last print,
  as the engine does when a read is missing. Both arms carry the same simplification.

### A2. Coinbase's own coin price, book by book (`scripts/cb_live_by_book.py` → `results/cb_live_by_book.json`)

`cb_live` (USDC at 1, USDT at Coinbase USDT-USD's last minute) against today's fair (Revolut X's F3), from §3's history runs.
£ a year per book on its £600; Δ is the paired day-block bootstrap of `cb_live` − today, with P(≤ 0).

| book | arm | IS: today → `cb_live`, Δ [p5, p95] | OOS: today → `cb_live`, Δ [p5, p95], P(≤ 0) | stops OOS | worst day OOS, £ |
|---|---|---|---|---|---|
| USDC-GBP | base | 12.8 → 19.4, +6.7 [−6.9, +20.6] | 36.6 → 36.9, **+0.3 [−8.6, +9.1], 0.52** | 10 → 0 | −1.38 → −0.54 |
| USDC-GBP | weekend | 21.4 → 26.2, +4.8 | 59.4 → 61.8, +2.4 [−8.5, +13.0], 0.39 | 27 → 14 | −1.38 → −0.54 |
| USDC-EUR | base | 34.5 → 32.3, −2.2 | 19.7 → 17.7, **−1.9 [−8.1, +3.9], 0.69** | 16 → 3 | −0.61 → −0.82 |
| USDC-EUR | weekend | 33.0 → 30.2, −2.8 | 25.3 → 22.5, −2.8 [−9.0, +3.3], 0.78 | 27 → 13 | −0.61 → −0.82 |
| USDT-GBP | base | 140.0 → 137.1, −2.8 | 50.1 → 60.4, **+10.3 [−3.1, +26.3], 0.12** | 16 → 0 | −1.66 → −0.27 |
| USDT-GBP | weekend | 176.9 → 174.0, −2.9 | 86.1 → 104.0, **+17.9 [+2.9, +35.0], 0.02** | 30 → 12 | −1.66 → −0.27 |
| USDT-EUR | base | 35.8 → 38.3, +2.4 | 9.0 → 6.4, −2.6 [−11.4, +6.1], 0.70 | 18 → 4 | −1.09 → −0.63 |
| USDT-EUR | weekend | 38.8 → 41.9, +3.2 | 20.2 → 15.7, −4.5 [−13.6, +4.7], 0.80 | 31 → 15 | −1.09 → −0.63 |

**The answer on USDC:** Coinbase's own price (par, which is what USDC is on Coinbase) makes **no difference on USDC-GBP** out of
sample (+£0.3 a year; in sample +£6.7). It **costs a little on USDC-EUR** (−£1.9 to −2.8 a year, both halves).

**Where the gain is:** USDT-GBP (+£10 a year on the base rule, +£18 on the weekend arm, P(≤ 0) 0.12 and 0.02 out of sample). The
EUR books lose a little on every coin: Coinbase's EUR books sit a few bps rich against Yahoo's EUR/USD (§2.1). A fair at the
coin's true dollar price therefore sits under them, as Revolut X's discount used to offset by chance.

**Stops fall on every book**, and the worst day improves on three of four.

**So §5's first recommendation narrows.** Take Coinbase's own coin price on the GBP books, where it gains (USDT-GBP) or costs
nothing (USDC-GBP). Leave the EUR books on today's fair, or give them the venue's own EUR level too (§3.1's basis term), which
this table does not test book by book.

### A3. What follows

- **USDG/EUR.** The condition Davies set holds: the later half is positive with P(≤ 0) < 0.10 on OKX's own engine, and larger than
  on PR5's simulator. The "- 1" paper row goes ahead (its pre-registration, `2026-10-29-okx-usdg-basis-prereg.md`, carries these
  numbers as its expectation).
- **Coinbase.** As above.
- **Files.** `scripts/fetch_okx_archive.py`, `scripts/okx_usdg_basis_prep.py`, `scripts/okx_usdg_basis_replay.ts` (run from the
  repository root with `npx --yes deno@1.46.3 run --allow-read --allow-write`), `scripts/okx_usdg_basis_summary.py`,
  `scripts/cb_live_by_book.py`; `inputs/okx_usdgeur_archive.json.gz`; `results/okx_usdg_basis_okxengine.json`,
  `results/cb_live_by_book.json`.
