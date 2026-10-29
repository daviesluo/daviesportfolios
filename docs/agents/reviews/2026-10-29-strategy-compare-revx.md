# STRATEGY-COMPARE, the Revolut X half: LIVE, variant-7, variant-8 and both, one book at a time at £600, £1,200 and £2,400 (2026-10-29)

Davies, 2026-10-29: "测一下目前最新的revolut x的live以及variant7和8以及7和8的结合，与最新的coinbase的 with euros和with euros-2的这几个的
表现对比，每个策略都按单币种分开测，分别按600磅和1200磅 2400磅测三轮看对比（按年化收益率，需真实反映未来12个月的期待）" (test LIVE, variant-7,
variant-8 and 7+8 together on Revolut X against Coinbase's "with Euros" and "with Euros - 2", each strategy on one coin at a
time, at £600, £1,200 and £2,400, by annual return, honestly reflecting what to expect over the next 12 months). This is the
Revolut X half; the Coinbase half runs the same method (§1) and the two are merged by the main session. Not blind: every
record was read (no no-peek rule since 2026-10-04).

Scripts and results: `docs/agents/backtests/compare/revx/` (`scripts/compare.py`, `scripts/haircut.py`, `scripts/pairs.py`,
`sql/`, `inputs/`, `results/`). The engine is the PR5-OPT simulator unchanged.

## 0. The answers

1. **What to expect over the next 12 months on Revolut X, % a year on capital** (the headline: the days since 2026-09-01, after
   the live haircut; [80 %]):

   | rule set | USDC-GBP £600 | £1,200 | £2,400 | USDT-GBP £600 | £1,200 | £2,400 |
   |---|---|---|---|---|---|---|
   | LIVE | +18.7 [+14.8, +22.7] | +16.4 [+13.0, +19.9] | +13.6 [+10.6, +16.5] | +34.7 [+26.2, +43.6] | +32.0 [+24.9, +39.6] | +28.0 [+21.8, +34.5] |
   | variant-7 | +17.6 [+14.2, +21.0] | +16.4 [+13.2, +19.6] | +13.5 [+10.6, +16.4] | +32.4 [+24.6, +40.4] | +30.6 [+23.4, +38.0] | +26.9 [+20.6, +33.5] |
   | variant-8 | **+19.1** [+15.0, +23.4] | +16.4 [+12.6, +20.4] | **+14.1** [+11.0, +17.2] | **+36.4** [+27.6, +45.7] | **+33.7** [+26.1, +41.7] | **+29.4** [+23.2, +35.9] |
   | 7 + 8 | +19.0 [+15.3, +22.7] | **+17.4** [+14.0, +20.8] | +14.3 [+11.3, +17.4] | +35.2 [+27.1, +43.6] | +33.2 [+25.6, +41.0] | +28.6 [+21.9, +35.5] |

   P(year < 0) is 0.000 on every row, before the USDT-GBP dust risk (point 4) and the inventory's GBP/USD swing (§4).
2. **Not the shared blend.** The shared formula (½ out of sample + ½ the last three months) gives LIVE +20.8 % on USDC-GBP and
   **+84.7 %** on USDT-GBP at £600. Revolut X's GBP books changed at the end of August (reference §3.27: the market tightened in
   the week of 2026-08-24): LIVE's rules on USDT-GBP at £600 made 120–200 % a year in every month from December to July, 108 % in August, then
   **39 % in September and 31 % in October** (every row and size the same shape); USDC-GBP declined more gradually, from 50–95 %
   in its first months and 30 % in June to 14 % and 23 %. The last-three-months block still holds August. The next twelve months
   look like September and October, not the year before, so the headline is those two months alone (55 days); both are in the
   table (§2).
3. **Size cuts the return, not the pounds.** From £600 to £2,400 the headline falls by about a quarter (USDC-GBP 18.7 → 13.6 %,
   USDT-GBP 34.7 → 28.0 %), because a bigger rung waits for prints big enough to fill it; in pounds a year it still grows about
   threefold (USDT-GBP LIVE about £208 → £672).
4. **USDT-GBP's figure carries one large risk: dust trips** (§3). A print of the venue's minimum (0.133 coin, about £0.10) at a
   rung's price makes the rung held, and its exit costs about two pennies of rounding. The haircut charges the replay's own count of
   these (1.9–2.6 a day on one USDT-GBP book since September); in their first 20 hours PR5-OPT's £600 twins weighted to USDT-GBP
   ran about 8 a day a book at 6p each. At that rate USDT-GBP's headline falls to about **+7 % at £600, +18 % at £1,200, +21 % at
   £2,400** (LIVE's rules). PR5-OPT's £1 holding line (`n600hold1`, variant-4 on the page) booked its two dust trips at £0.000:
   it is the rule that removes this cost (point 5).
5. **The fix is variant-4's rule, not a new one: `holdMin {gbp: 1}`** (`TWIN_RULES.holdMin`, `holdLineBase` in
   `agents/quotes_live.ts`; PR5-OPT's pre-registration, `n600hold1` since 2026-10-28 22:00, read on 11-25). A rung counts as
   held only above £1 of coin, so a minimum-size print fills part of the entry, which keeps resting, and no exit follows. LIVE does
   not run it. Replayed as **"LIVE + holdMin £1"** (the engine's `hold_min_gbp` 1.0), since 09-01, % a year
   (`results/pairs.json`, against LIVE on the same days, [80 %]):
   - **USDT-GBP: +5.3 [+3.0, +7.6] at £600, +3.0 [+1.7, +4.4] at £1,200, +1.9 [+0.9, +3.1] at £2,400** (P(≤ 0) 0.000 each;
     about £31, £36 and £47 a year). Dust trips fall from 2.4 a day to 0.02. Of the +5.3 at £600, 3.6 is the penny charge the
     haircut no longer books (all of it) and the rest is the entry that keeps resting its full size (+2.1 before the haircut).
     Under the stress of point 4 the line takes all of the extra dust cost too: its own twin's dust trips booked £0.000.
   - **USDC-GBP: +0.2 at every size** (+0.23 [+0.03, +0.44] at £600; P 0.04): there is almost no dust there to recover.
   - **With the variants** it recovers the same (USDT-GBP at £600: variant-7 +5.4, variant-8 +5.1, 7+8 +4.6 against the same
     rule set without it; USDC-GBP +0.03 to +0.19), and the variants' order is unchanged, so they are reported with it too: in
     `compare.json` and `pairs.json` as `v7_h1`, `v8_h1`, `v78_h1` (variant-8 + holdMin £1 on USDT-GBP: +41.5, +36.7, +31.4 %).
6. **The variants against LIVE, the same book, size and days** (`scripts/pairs.py`; the days since 09-01, % a year, [80 %],
   P(≤ 0)):
   - **variant-8 is ahead on both books at every size, clearly only on USDT-GBP.** USDT-GBP +1.7 [+0.5, +2.9] P 0.03 at £600,
     +1.7 at £1,200 (P 0.06), +1.4 at £2,400 (P 0.05); USDC-GBP +0.4, +0.05, +0.5 (P 0.16–0.46). Out of sample it is ahead on all
     six (P ≤ 0.004).
   - **variant-7 is behind on USDT-GBP** (−2.4, −1.4, −1.1; out of sample −4.9, −3.0, −1.7, P 0.90–1.00) and level on USDC-GBP
     (−1.1, 0.0, −0.1 since September; out of sample +1.2 to +1.4, P 0.09–0.12). The nudge acted on 98.5 % of USDC-GBP's minutes
     and 96.5 % of USDT-GBP's (Coinbase's price was stale on 0.6 % and 2.6 %).
   - **7 + 8** is variant-8 with variant-7's drag: +0.3 to +1.1 since September (P 0.24–0.43).
   - Every difference since September is a fraction of the interval of each row: on these figures the choice of book and size
     moves the return ten times more than the choice of variant.
7. **What it means.** On Revolut X the best expected return a year is USDT-GBP alone, with variant-8's exit a little better,
   about +28 to +36 % on paper after the haircut, falling with size; but that book is also where the dust risk sits, and where
   LIVE's October record fell furthest short of the replay (§3) at £10 rungs. The £1 holding line (variant-4's rule) both removes
   that risk and adds 2–5 points on USDT-GBP, more than variant-8 does. USDC-GBP alone is about +14 to +19 %, with almost no dust
   risk. Variant-8 is the one change of the two Davies named worth its twin's 28 days (running from 10-29 19:00); variant-7 is
   not, on either book. Nothing here is a change to LIVE: that is Davies' decision, each on its own record (variant-4's reading
   is due on 11-25).

## Ranked: one line a rule set × book × size, by the headline

The headline is since 2026-09-01 after the haircut (e 0.825 and the dust cost); £ a year is the headline × the capital; P(year
< 0) is 0.000 on every line; the dust stress is §0 point 4 (USDT-GBP rows without the holding line). From `results/pairs.json`
`ranked`, which also holds variant-7, variant-8 and 7+8 with the holding line.

| # | rule set | book | capital | headline %/yr [80 %] | P(yr<0) | £/yr | shared blend | OOS | dust stress |
|---|---|---|---|---|---|---|---|---|---|
| 1 | LIVE + holdMin £1 | USDT-GBP | £600 | **+40.0** [+31.1, +49.3] | 0.000 | £240 | +87.3 | +108.0 |  |
| 2 | variant-8 | USDT-GBP | £600 | **+36.4** [+27.6, +45.7] | 0.000 | £218 | +88.6 | +110.7 | +8.0 |
| 3 | variant-7+8 | USDT-GBP | £600 | **+35.2** [+27.1, +43.6] | 0.000 | £211 | +85.9 | +107.5 | +6.7 |
| 4 | LIVE + holdMin £1 | USDT-GBP | £1,200 | **+35.0** [+27.6, +42.9] | 0.000 | £420 | +73.0 | +89.5 |  |
| 5 | LIVE | USDT-GBP | £600 | **+34.7** [+26.2, +43.6] | 0.000 | £208 | +84.7 | +106.0 | +6.6 |
| 6 | variant-8 | USDT-GBP | £1,200 | **+33.7** [+26.1, +41.7] | 0.000 | £404 | +74.7 | +92.1 | +19.4 |
| 7 | variant-7+8 | USDT-GBP | £1,200 | **+33.2** [+25.6, +41.0] | 0.000 | £398 | +73.7 | +91.2 | +18.8 |
| 8 | variant-7 | USDT-GBP | £600 | **+32.4** [+24.6, +40.4] | 0.000 | £194 | +80.4 | +101.1 | +4.5 |
| 9 | LIVE | USDT-GBP | £1,200 | **+32.0** [+24.9, +39.6] | 0.000 | £384 | +71.5 | +88.4 | +17.9 |
| 10 | variant-7 | USDT-GBP | £1,200 | **+30.6** [+23.4, +38.0] | 0.000 | £367 | +68.6 | +85.4 | +16.6 |
| 11 | LIVE + holdMin £1 | USDT-GBP | £2,400 | **+29.9** [+23.6, +36.6] | 0.000 | £718 | +58.8 | +71.7 |  |
| 12 | variant-8 | USDT-GBP | £2,400 | **+29.4** [+23.2, +35.9] | 0.000 | £706 | +60.6 | +74.2 | +22.2 |
| 13 | variant-7+8 | USDT-GBP | £2,400 | **+28.6** [+21.9, +35.5] | 0.000 | £685 | +59.6 | +73.5 | +21.3 |
| 14 | LIVE | USDT-GBP | £2,400 | **+28.0** [+21.8, +34.5] | 0.000 | £671 | +57.8 | +71.0 | +20.8 |
| 15 | variant-7 | USDT-GBP | £2,400 | **+26.9** [+20.6, +33.5] | 0.000 | £646 | +55.8 | +69.2 | +19.8 |
| 16 | variant-8 | USDC-GBP | £600 | **+19.1** [+15.0, +23.4] | 0.000 | £115 | +22.5 | +24.4 |  |
| 17 | variant-7+8 | USDC-GBP | £600 | **+19.0** [+15.3, +22.7] | 0.000 | £114 | +23.8 | +25.4 |  |
| 18 | LIVE + holdMin £1 | USDC-GBP | £600 | **+18.9** [+15.0, +23.0] | 0.000 | £114 | +20.9 | +22.5 |  |
| 19 | LIVE | USDC-GBP | £600 | **+18.7** [+14.8, +22.7] | 0.000 | £112 | +20.8 | +22.4 |  |
| 20 | variant-7 | USDC-GBP | £600 | **+17.6** [+14.2, +21.0] | 0.000 | £105 | +22.1 | +23.8 |  |
| 21 | variant-7+8 | USDC-GBP | £1,200 | **+17.4** [+14.0, +20.8] | 0.000 | £209 | +20.3 | +20.7 |  |
| 22 | LIVE + holdMin £1 | USDC-GBP | £1,200 | **+16.6** [+13.1, +20.1] | 0.000 | £199 | +17.8 | +18.5 |  |
| 23 | variant-8 | USDC-GBP | £1,200 | **+16.4** [+12.6, +20.4] | 0.000 | £197 | +18.9 | +19.9 |  |
| 24 | variant-7 | USDC-GBP | £1,200 | **+16.4** [+13.2, +19.6] | 0.000 | £197 | +19.1 | +19.6 |  |
| 25 | LIVE | USDC-GBP | £1,200 | **+16.4** [+13.0, +19.9] | 0.000 | £197 | +17.7 | +18.4 |  |
| 26 | variant-7+8 | USDC-GBP | £2,400 | **+14.3** [+11.3, +17.4] | 0.000 | £344 | +16.5 | +16.4 |  |
| 27 | variant-8 | USDC-GBP | £2,400 | **+14.1** [+11.0, +17.2] | 0.000 | £337 | +15.5 | +15.7 |  |
| 28 | LIVE + holdMin £1 | USDC-GBP | £2,400 | **+13.7** [+10.8, +16.7] | 0.000 | £329 | +14.5 | +14.6 |  |
| 29 | LIVE | USDC-GBP | £2,400 | **+13.6** [+10.6, +16.5] | 0.000 | £326 | +14.4 | +14.5 |  |
| 30 | variant-7 | USDC-GBP | £2,400 | **+13.5** [+10.6, +16.4] | 0.000 | £323 | +15.6 | +15.7 |  |

## 1. The method (shared with the Coinbase half)

- **The rule sets** (each LIVE's rules as the LIVE twin `live600` runs them: rungs 0.1 / 0.2 / 0.3 % a side of fair, exits at
  fair, the 0.05 % re-price, the 24-hour stop, the 50 bps de-peg guard, LIVE's "at" fill, the weekend on the held GBP/USD):
  - **LIVE** as it is;
  - **variant-7**: plus the Coinbase nudge exactly as `agents/quotes_nudge.ts` (half the deviation of Coinbase's price of the coin
    over fair from its 24-hour-half-life EMA; none when Coinbase's price is over 5 minutes old or the deviation is 50 bps or more;
    the book's first 72 hours only warm the EMA). Variant-7 runs it on USDC-GBP; here it runs on whichever book is tested, with
    Coinbase's own price of that coin in pounds: its last print of each minute to 2026-10-08 (SCQ-VENUES' bars, from 2024-10, so
    the whole Revolut X history is covered, USDT-GBP included), then the recorder's touch from 10-10;
  - **variant-8**: plus every exit one tick beyond fair (`exitOffset` 1);
  - **7+8**: both;
  - and each of the four **+ holdMin £1** (added at the main session's ask): variant-4's £1 holding line (`rules.holdMin`),
    the engine's `hold_min_gbp` 1.0 (§0 point 5).
- **One book at a time**, all the capital on it: six rungs (3 a side), each a sixth of the capital, so **£100, £200 and £400 a
  rung** at £600, £1,200 and £2,400 (LIVE's £600 over both books is £50 a rung). The engine fills a resting order by the size of
  the prints that reach it, so a bigger rung does not fill proportionally more.
- **Data:** Revolut X UK's every public print, from each listing (USDC-GBP 2025-11-26, USDT-GBP 2025-12-16) to 2026-09-23 on the
  committed tape, then the recorded prints of 09-26 → 10-29; PR5's own minute record (fair = the USD book's 24-hour median of
  hourly closes over GBP/USD). The three days 09-23 → 09-26 between the two are not in any window.
- **Windows:** in sample to 2026-05-12, out of sample from it (167 days on each book), and **recent = the last three months**,
  07-29 → 10-28 (89 days).
- **The shared blend**, % a year on capital, simple: 365 × (½ the out-of-sample mean day + ½ the recent mean day) ÷ capital,
  after the live haircut.
- **The headline on Revolut X:** the same over the days since 2026-09-01 alone (55 days). Why not the blend: the books changed
  at the end of August (§0 point 2) and the blend's two halves both hold months that ran two to four times September's and
  October's rate on USDT-GBP. The cost: 55 days is a short sample, partly LIVE trading against itself (its fills are in the tape
  since 10-01); its interval is correspondingly wider. Both figures are in §2, so the merge can put either beside Coinbase's.
- **Days** are marked to market: the trips closed that day plus the change, midnight to midnight, in what the held rungs were
  worth at the last print.
- **The live haircut** (§3), applied trip by trip: every trip of £1 or more of entry × **e = 0.825**; every "dust" trip (under
  £1) **− £0.0242**.
- **Costs:** maker fills 0 %, the 24-hour stop as a taker (0.09 % + half the measured spread), the asks' coin bought by maker
  conversions (0 %), no interest on idle cash. **Not in P&L:** the asks' coin inventory is a GBP/USD position (about half the
  capital in coin); §4 sizes it.
- **The interval:** the expected year's 80 % interval from a circular 3-day block bootstrap (10,000 times, seed 20261029) of the
  days since 09-01 (the headline), or of the out-of-sample and the recent days each (the blend). **P(year < 0)** adds to each
  draw's expected year a year of the same days (demeaned, block-resampled) as its noise.
- **Also reported:** trips a day, dust trips a day, bps a trip, 24-hour stops a year and the capital held in positions (mean %),
  since 09-01 in §2 and out of sample in `compare.json` (the replay before the haircut); the worst day and the deepest drawdown
  (whole history, after the haircut, % of capital); each variant against LIVE on the same days (`scripts/pairs.py`).
- **Not modelled:** LIVE's exits meeting the book (`exitTicksOnBook`, from 2026-10-29): the tape has no book, and the engine
  refuses an exit that the last print shows crossing and tries again the next minute; the governor, the −1 % daily loss stop,
  outages and the dead-man (as in PR5-OPT).

## 2. The table

Each row's figures (`results/compare.json`): **headline** = since 2026-09-01 after the haircut [80 %], P(year < 0) (no row
above 0.000), the dust stress (point 4 of §0, `results/pairs.json`: the headline if dust trips run 8.24 a day at £0.0634, USDT-GBP only), the
**shared blend** [80 %], out of sample (05-12 → 10-28), the last three months (07-29 → 10-28), in sample; then since 09-01:
trips a day, dust trips a day, bps a trip, 24-hour stops a year (the replay before the haircut), and the capital held in positions
(mean %); and over the whole history, after the haircut: the worst day and the deepest drawdown (% of capital). Days are marked to
market each midnight. The haircut is the same on every row: trips of £1+ × 0.825, dust trips − £0.0242.

| rule set | book | capital | headline %/yr [80 %] | P(yr<0) | dust stress | shared blend [80 %] | OOS | last 3 mo | IS | trips/day | dust/day | bps/trip | stops/yr | worst day % | max DD % | held % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LIVE | USDC-GBP | £600 | **+18.7** [+14.8, +22.7] | 0.000 |  | +20.8 [+18.7, +22.9] | +22.4 | +19.2 | +44.5 | 3.9 | 0.07 | 12.0 | 40 | -0.20 | -0.20 | 6.8 |
| LIVE | USDC-GBP | £1,200 | **+16.4** [+13.0, +19.9] | 0.000 |  | +17.7 [+15.8, +19.5] | +18.4 | +16.9 | +36.6 | 3.7 | 0.07 | 12.2 | 46 | -0.17 | -0.18 | 7.3 |
| LIVE | USDC-GBP | £2,400 | **+13.6** [+10.6, +16.5] | 0.000 |  | +14.4 [+12.8, +16.1] | +14.5 | +14.3 | +27.9 | 3.4 | 0.07 | 12.1 | 46 | -0.17 | -0.21 | 7.8 |
| LIVE | USDT-GBP | £600 | **+34.7** [+26.2, +43.6] | 0.000 | +6.6 | +84.7 [+75.2, +93.9] | +106.0 | +63.4 | +155.7 | 8.0 | 2.44 | 15.2 | 26 | -0.23 | -0.23 | 8.0 |
| LIVE | USDT-GBP | £1,200 | **+32.0** [+24.9, +39.6] | 0.000 | +17.9 | +71.5 [+63.8, +79.1] | +88.4 | +54.6 | +123.9 | 7.7 | 2.35 | 15.1 | 33 | -0.23 | -0.23 | 8.1 |
| LIVE | USDT-GBP | £2,400 | **+28.0** [+21.8, +34.5] | 0.000 | +20.8 | +57.8 [+51.6, +63.9] | +71.0 | +44.6 | +93.9 | 7.2 | 2.20 | 15.2 | 33 | -0.23 | -0.23 | 7.6 |
| variant-7 | USDC-GBP | £600 | **+17.6** [+14.2, +21.0] | 0.000 |  | +22.1 [+20.2, +24.1] | +23.8 | +20.4 | +47.0 | 3.8 | 0.09 | 11.4 | 46 | -0.40 | -0.40 | 7.5 |
| variant-7 | USDC-GBP | £1,200 | **+16.4** [+13.2, +19.6] | 0.000 |  | +19.1 [+17.4, +20.8] | +19.6 | +18.6 | +39.0 | 3.6 | 0.09 | 12.3 | 46 | -0.31 | -0.31 | 7.7 |
| variant-7 | USDC-GBP | £2,400 | **+13.5** [+10.6, +16.4] | 0.000 |  | +15.6 [+14.0, +17.2] | +15.7 | +15.5 | +30.7 | 3.3 | 0.07 | 12.3 | 46 | -0.17 | -0.20 | 8.0 |
| variant-7 | USDT-GBP | £600 | **+32.4** [+24.6, +40.4] | 0.000 | +4.5 | +80.4 [+71.5, +89.1] | +101.1 | +59.7 | +160.5 | 7.9 | 2.64 | 14.9 | 20 | -0.15 | -0.15 | 7.5 |
| variant-7 | USDT-GBP | £1,200 | **+30.6** [+23.4, +38.0] | 0.000 | +16.6 | +68.6 [+61.2, +75.8] | +85.4 | +51.8 | +126.0 | 7.7 | 2.53 | 14.9 | 20 | -0.15 | -0.15 | 7.6 |
| variant-7 | USDT-GBP | £2,400 | **+26.9** [+20.6, +33.5] | 0.000 | +19.8 | +55.8 [+49.9, +61.7] | +69.2 | +42.4 | +97.0 | 7.2 | 2.36 | 14.9 | 20 | -0.15 | -0.15 | 7.3 |
| variant-8 | USDC-GBP | £600 | **+19.1** [+15.0, +23.4] | 0.000 |  | +22.5 [+20.2, +24.7] | +24.4 | +20.5 | +47.2 | 3.7 | 0.04 | 12.5 | 46 | -0.19 | -0.19 | 8.1 |
| variant-8 | USDC-GBP | £1,200 | **+16.4** [+12.6, +20.4] | 0.000 |  | +18.9 [+16.9, +21.0] | +19.9 | +17.9 | +38.7 | 3.5 | 0.04 | 12.6 | 53 | -0.15 | -0.15 | 8.6 |
| variant-8 | USDC-GBP | £2,400 | **+14.1** [+11.0, +17.2] | 0.000 |  | +15.5 [+13.8, +17.2] | +15.7 | +15.2 | +29.2 | 3.2 | 0.04 | 12.7 | 60 | -0.12 | -0.16 | 8.9 |
| variant-8 | USDT-GBP | £600 | **+36.4** [+27.6, +45.7] | 0.000 | +8.0 | +88.6 [+78.7, +98.2] | +110.7 | +66.5 | +165.6 | 7.6 | 2.25 | 16.2 | 33 | -0.23 | -0.23 | 9.0 |
| variant-8 | USDT-GBP | £1,200 | **+33.7** [+26.1, +41.7] | 0.000 | +19.4 | +74.7 [+66.6, +82.7] | +92.1 | +57.4 | +131.7 | 7.4 | 2.18 | 16.1 | 33 | -0.23 | -0.23 | 9.0 |
| variant-8 | USDT-GBP | £2,400 | **+29.4** [+23.2, +35.9] | 0.000 | +22.2 | +60.6 [+54.0, +67.0] | +74.2 | +47.0 | +99.4 | 7.0 | 2.07 | 16.4 | 33 | -0.23 | -0.23 | 8.3 |
| 7 + 8 | USDC-GBP | £600 | **+19.0** [+15.3, +22.7] | 0.000 |  | +23.8 [+21.8, +25.9] | +25.4 | +22.3 | +49.7 | 3.7 | 0.09 | 12.6 | 46 | -0.40 | -0.40 | 7.9 |
| 7 + 8 | USDC-GBP | £1,200 | **+17.4** [+14.0, +20.8] | 0.000 |  | +20.3 [+18.6, +22.1] | +20.7 | +20.0 | +41.1 | 3.4 | 0.09 | 13.6 | 46 | -0.31 | -0.31 | 8.0 |
| 7 + 8 | USDC-GBP | £2,400 | **+14.3** [+11.3, +17.4] | 0.000 |  | +16.5 [+14.9, +18.1] | +16.4 | +16.6 | +32.2 | 3.1 | 0.07 | 13.6 | 46 | -0.17 | -0.19 | 8.3 |
| 7 + 8 | USDT-GBP | £600 | **+35.2** [+27.1, +43.6] | 0.000 | +6.7 | +85.9 [+76.4, +95.3] | +107.5 | +64.3 | +169.3 | 7.3 | 2.15 | 15.9 | 26 | -0.19 | -0.19 | 9.5 |
| 7 + 8 | USDT-GBP | £1,200 | **+33.2** [+25.6, +41.0] | 0.000 | +18.8 | +73.7 [+65.7, +81.5] | +91.2 | +56.1 | +133.9 | 7.1 | 2.02 | 16.1 | 26 | -0.19 | -0.19 | 9.6 |
| 7 + 8 | USDT-GBP | £2,400 | **+28.6** [+21.9, +35.5] | 0.000 | +21.3 | +59.6 [+53.1, +66.0] | +73.5 | +45.7 | +103.3 | 6.6 | 1.89 | 16.1 | 26 | -0.19 | -0.19 | 8.4 |

- **Capital deployed:** every rung either rests its entry or holds a position whenever the book has a fair, which it did on
  99.7 % of out-of-sample minutes on both books, so the whole capital is committed nearly all the time; 7–10 % of it is held in
  positions on average since September (12–21 % out of sample).
- **Before the haircut** (`compare.json`, `before_haircut`), since 09-01: LIVE USDC-GBP 22.8 / 19.9 / 16.5 %, USDT-GBP 46.4 /
  40.9 / 34.9 %. The haircut takes about a fifth on USDC-GBP and a quarter on USDT-GBP.
- **The worst day and the drawdown are tiny** (under 0.5 % of capital on every row) because positions are held for about an hour
  and closed by the 24-hour stop at the latest; the asks' coin inventory, which moves with GBP/USD, is not in them (§4).

## 3. The live haircut: LIVE's own record against the replay (`scripts/haircut.py` → `results/haircut.json`)

LIVE has traded PR5's `_2` sub-account since 2026-10-01 16:29:53 UTC: £120 (twelve rungs of £10) to 10-27 03:09, then £600. The
replay ran the same engine on the same days with LIVE's schedule (£120, then £600 from 10-27; the weekend rule from 10-23 21:00).
LIVE's figures are real money and are not written here or committed; only ratios and counts are.

- **Over all trips, day by day, LIVE ÷ the replay:** USDC-GBP 0.76 (80 %: 0.60 – 0.89); **USDT-GBP −1.01** (−1.92 – −0.18):
  on USDT-GBP LIVE's month went the other way from the replay's. So did the £120 LIVE twin's (the executor's own code on a
  simulated account, paper).
- **Why: dust trips.** The record splits at £1 of entry (`sql/trip_buckets.sql`):
  - **Dust trips** (under £1): a 0.133-coin print (about £0.10, the venue's minimum) reaches the rung at its price; the rung is
    then held, and its exit follows. Revolut X moves money in whole pennies: a sell of £0.0999 books £0.09, a buy of £0.1004
    costs £0.11. The £120 twin's 132 dust trips on USDT-GBP (5.2 a day) **cost £0.0242 each**; the replay had the same trips
    (5.2 a day) at **+£0.00014** each, because it has no pennies. LIVE had 7.5 a day on USDT-GBP (0.07 on USDC-GBP), at a
    similar cost each. Someone trades the minimum on USDT-GBP many times a day; USDC-GBP barely sees it.
  - **Every other trip:** LIVE's P&L over the replay's on the same days, **e**: USDC-GBP 0.558 (101 trips against 122),
    USDT-GBP 1.004 (125 against 146); pooled **0.825**. The twin's (£120 days only): 0.78 and 0.99.
- **What is applied** (`results/haircut.json` "applied"): every replayed trip of £1 or more × 0.825 (pooled: USDC-GBP's own 0.56
  rests on 101 trips of £10 rungs, where a penny is 10 bps of a trip, and its twin does not confirm it), and every replayed dust
  trip − £0.0242 (the twin's cost less the replay's own, both books pooled; 133 trips). A dust trip's count does not grow with the
  rung (it is a print of the minimum reaching a rung at its price), so its cost is a fixed number of pounds a day: it weighs most
  at £600.
- **Its limits, and the one that matters.** 28 days of LIVE, 26 of them at £10 rungs; two at £50. The dust cost at bigger rungs
  is not settled by the twins either (paper, read 2026-10-29 about 18:20 UTC):
  - the £600 LIVE twin (£50 rungs, USDT-GBP, since 10-27): 14 dust trips in 2.8 days, £0.012 each;
  - the £1,200 twin (£100 rungs, since 10-28): 4 in 1.8 days, **+**£0.025 each;
  - PR5-OPT's four £600 twins with USDT-GBP weighted up (£75–£100 rungs, since 10-28 22:00, the same prints): 28 in 0.85 days
    each, about **8 a day at £0.063 each**, about −£0.52 a day a book;
  - the same family's £1 holding line (`n600hold1`, `rules.holdMin`: a rung is held only above £1 of coin): 2 dust trips, £0.000.
  The replay counts 1.9–2.6 dust trips a day on one USDT-GBP book since September at £100–£400 rungs. If the last 20 hours'
  rate and cost hold instead, USDT-GBP loses about £0.46 a day more than the table books: **about 28 points a year off the
  headline at £600, 14 at £1,200, 7 at £2,400** (§2's stress column). The interval in §2 does not carry the haircut's own
  uncertainty.

## 4. What the table leaves out

- **The asks' coin is a GBP/USD position.** The asks sell coin the account holds (bought by maker conversions and topped up by
  the executor), about half the capital. GBP/USD's daily closes on the tape move 6.27 % a year (annualised standard deviation),
  so that coin's value in pounds moves about **±3.1 % of capital a year (one standard deviation)**, with no expected gain or
  loss. It is not in any figure above, and it is the same share at every size; it is comparable to the whole expected return
  of a USDC-GBP row.
- **LIVE's exits meeting the book** (2026-10-29) are not in the replay; nor are the governor, the −1 % daily loss stop, outages
  or the dead-man.
- **The tape's own LIVE.** Since 10-01 LIVE's fills are among the prints the replay reads (at £10 and £50 rungs, a small share).
- **Further decay.** Nothing here models the September rate falling again; October was below September on every USDT-GBP row.

## 5. Files

- `scripts/compare.py` → `results/compare.json` (every row's figures) and `results/daily.json.gz` (each row's days, before and
  after the haircut).
- `scripts/pairs.py` → `results/pairs.json`: each variant against LIVE, the same book, size and days; each rule set with the
  holding line against itself without it; the dust stress; the ranked lines (`ranked`).
- `scripts/haircut.py` → `results/haircut.json`. It reads LIVE's trips through `sql/live_days.sql` and `sql/trip_buckets.sql`
  (LIVE_DAYS, LIVE_TRIPS: real money, not committed) and the £120 twin's from `inputs/twin_trips.json` (paper).
- `compare.py` and `haircut.py` import REVX-LAG's `lag_data.py` (the engine's inputs and Coinbase's price series, all committed);
  `compare.py` reads `results/haircut.json` and needs nothing else, about half an hour on four cores for its 48 rows; `pairs.py` reads
  `compare.py`'s results.

Production reads (read-only SQL, 2026-10-29): LIVE's and the twins' filled orders, aggregated by the two queries in `sql/`.
