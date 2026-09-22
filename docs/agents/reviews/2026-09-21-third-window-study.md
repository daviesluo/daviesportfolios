# Third-window study — two windows are two single draws, so here is a third

Script `supabase/functions/agents/backtest_windows.ts`; raw output
`docs/agents/backtests/windows.json`. It extends §3.7 / §3.8 / §3.10 / §3.11
and re-runs none of them: the universe is not re-searched and no new rule is
invented. What is new is a **third walk-forward window** the existing studies
could not have, built by extending the price history backwards, and the live
candidate, the one-window cohort and the two written-down rule candidates
scored on it.

**No wall clock is written into the output.** Re-running over the same two
data directories reproduces `windows.json` byte for byte — verified, twice.
The run is identified instead by the SHA-256 of `backtest.ts`,
`31d27c7d82f8a94c…`, because that file is an input to this study and it
changed while the study was running.

---

## 0. The stop rule changed under this study, so every number is reported twice

Half-way through, commit `eff6ca8` removed the intra-bar ATR trail from
`backtest.ts` (reference §3.13): it duplicated the trail `ruleDecision`
already applies to the **close** — same high-water anchor, same multiplier —
and the per-minute copy always fired first. `SHIPPED_STOPS.atrStop` went from
`3` to `null` and `stopsForKind` now returns the 8 % floor alone for every
rulebook. `tick.ts` carries the same change, so it is what the live loop runs.

That is a change to the **rule**, not to this study's arithmetic, and it moves
everything. So the study prices both, the same grid, windows and bar under
each, and **never averages them**:

| id in `windows.json` | stops | what it is |
|---|---|---|
| **`shipped`** | 8 % floor, no intra-bar trail | what `backtest.ts` ships now and `tick.ts` runs. **The live decision is about this one, so it is this report's headline.** |
| **`trail`** | 8 % floor + 3×ATR(14) intra-bar trail | what §3.7 / §3.8 / §3.10 / §3.11 were computed under. The only rule on which windows A and B are comparable to their published selves. |

Both are in the JSON under `perStopRule.shipped` and `perStopRule.trail`, and
**every table below says which rule produced it.** Nothing was adjusted by
hand; the second rule is a second full run of the whole study.

The size of the change, measured rather than asserted — this harness's window
A and B against **reference §3.8's own published table**, 33 comparable rows:

| stop rule | worst \|Δ\| vs §3.8 | median \|Δ\| | rows within 0.1 of a point |
|---|---|---|---|
| `trail` | **0.0004** | 0.0003 | **33 of 33** |
| `shipped` | 0.1766 | 0.0553 | 0 of 33 |

`trail` reproduces §3.8 to the document's own rounding — that is the evidence
the harness is faithful. `shipped`'s column is not a failure: it is what
removing the trail did to the published record.

---

## 1. The data — where the third window comes from, and how it was checked

**Kraken's free quarterly OHLCVT bundle, pulled for the first time.**
`assets.kraken.com/marketing/institutions/Kraken_OHLCVT_Full_2026Q2.zip.part00-04`
— five parts, **8,972,380,104 bytes**, **12,037 CSV entries**, every pair from
its first trade to **2026-06-30** at 1/5/15/60/240/720/1440 minutes. Reachable
from this container; no key, no rate limit. The 60-minute `*USD` series is what
this study reads, converted to the `[t_s, o, h, l, c, v]` shape the backtester
already takes. Kraken's public `OHLC` endpoint was **not** used and could not
have been: its 720-row ceiling is absolute ("older data cannot be retrieved,
regardless of `since`"), which is 120 days of 4-hour bars.

**The splice, not a mix.** Kraken's bars strictly **before** the coin's
Coinbase series begins; Coinbase's from there on. Windows A and B are
therefore priced on exactly the candles every published table used, and only
the new history is Kraken's.

**The overlap check, on the ~2.7 years the two sources share.** Threshold
written down before the comparison: median ≤ 25 bps and p95 ≤ 100 bps on 4-hour
closes (§3.12 measured 0.93–6.11 median / 3.2–22.9 p95 on eight coins over 120
days). **All 27 coins passed; none was dropped.**

| coin | Kraken pair | overlap (4h bars) | median bps | p95 | max | extension | windows |
|---|---|---|---|---|---|---|---|
| BTC | XBTUSD | 6,261 | 1.83 | 6.88 | 70.2 | 9.88 y (2013-10) | A B C D |
| ETH | ETHUSD | 6,260 | 1.87 | 7.40 | 138.5 | 8.05 y | A B C D |
| XRP | XRPUSD | 6,109 | 1.96 | 8.82 | 113.4 | 6.33 y | A B C D |
| SOL | SOLUSD | 6,260 | 2.40 | 9.77 | 153.2 | 2.18 y | A B C D |
| LTC | LTCUSD | 6,071 | 3.05 | 11.48 | 217.4 | 9.92 y | A B C D |
| DOGE | XDGUSD | 6,072 | 3.08 | 11.93 | 373.6 | 3.76 y | A B C D |
| BNB | BNBUSD | 1,506 | 3.17 | 12.10 | 66.8 | 0.50 y | A · C · |
| HBAR | HBARUSD | 2,130 | 3.36 | 14.22 | 133.0 | **0 y** | A B · · |
| ADA | ADAUSD | 6,071 | 3.81 | 13.90 | 1153.6 | 4.99 y | A B C D |
| XLM | XLMUSD | 6,071 | 4.28 | 17.02 | 113.9 | 6.68 y | A B C D |
| LINK | LINKUSD | 6,071 | 4.31 | 16.07 | 153.3 | 3.99 y | A B C D |
| HYPE | HYPEUSD | 872 | 4.81 | 18.05 | 100.7 | 0.02 y | **none** |
| DOT | DOTUSD | 6,071 | 4.96 | 17.62 | 128.6 | 3.10 y | A B C D |
| AVAX | AVAXUSD | 6,071 | 5.61 | 21.03 | 329.2 | 1.75 y | A B C D |
| SUI | SUIUSD | 6,069 | 5.71 | 38.51 | 201.5 | **0.39 y** | A B · · |
| BCH | BCHUSD | 6,071 | 5.77 | 23.68 | 108.7 | 6.14 y | A B C D |
| ATOM | ATOMUSD | 6,071 | 6.25 | 25.60 | 516.0 | 4.42 y | A B C D |
| UNI | UNIUSD | 6,071 | 6.76 | 27.78 | 222.4 | 2.94 y | A B C D |
| AAVE | AAVEUSD | 6,071 | 6.87 | 28.11 | 147.1 | 2.77 y | A B C D |
| PEPE | PEPEUSD | 3,563 | 7.07 | 23.81 | 135.1 | 1.50 y | A B C D |
| ICP | ICPUSD | 6,068 | 7.21 | 27.89 | 1040.9 | 1.51 y | A B C D |
| SHIB | SHIBUSD | 6,071 | 7.56 | 24.33 | 131.0 | 1.81 y | A B C D |
| ALGO | ALGOUSD | 6,071 | 7.62 | 28.71 | 991.6 | 3.67 y | A B C D |
| TON | TONUSD | 1,346 | 7.68 | 31.17 | 166.2 | 1.10 y | A · C · |
| NEAR | NEARUSD | 6,071 | 7.80 | 29.94 | 401.6 | 1.27 y | A B C · |
| POL | **MATICUSD** | 1,249 | 8.16 | 34.82 | 282.3 | 3.30 y | A B C D |
| ETC | ETCUSD | 6,069 | 11.30 | 46.24 | 887.4 | 7.16 y | A B C D |

Three things in that table are worth saying out loud:

- **POL's pre-rename history is Kraken's `MATICUSD`.** Kraken's own `POLUSD`
  exists from 2023-12-21 but is a thin parallel listing until MATIC stops on
  2025-04-01: over their 5,665 shared hours the two closes differ by a median
  of 10.8 bps, a p95 of 418 bps and a maximum of 1,134,558 bps — a stale book,
  not a price. (That comparison is a pre-study measurement over the extracted
  CSVs, not part of `windows.json`.) What *is* in the study is `MATICUSD`
  against **Coinbase's POL-USD** over their seven-month overlap: median
  8.16 bps, p95 34.8, inside the same thresholds every other coin passed —
  which is what says it is the same asset. The substitution is measured, not
  assumed, and a reader who rejects it should read POL's windows C and D as
  MATIC's.
- **HBAR has no extension at all**: Coinbase lists it from 2023-09 but Kraken
  only from 2025-07. No source this container can reach has HBAR before the
  existing series starts.
- **SUI's extension is 142 days**, because SUI did not exist before 2023-05.
  That is under the 180-day in-sample floor declared before the run, so **SUI
  has no window C** — see §5.4, it is the sharpest limitation here.

---

## 2. The windows — and what regime each actually was

Each coin's own Coinbase series is cut in thirds **on its own bar count**,
exactly as §3.7 / §3.8 / §3.10 / §3.11 cut it. The third window is the one
those studies could not have: the **first** third, with parameters chosen on
the two years of extended history immediately before it. The three then tile
the whole existing series, each with parameters taken strictly from earlier
data:

| window | parameters chosen on | scored on | for a three-year coin |
|---|---|---|---|
| **C** | the 24 months before the series starts (extension) | the FIRST third | 2023-08 → 2024-08 |
| **B** | the first third | the MIDDLE third | 2024-08 → 2025-09 |
| **A** | the first two thirds | the LAST third | 2025-09 → 2026-09 |
| *D* | *the 24 months before those* | *the 12 months before the series* | *2022-08 → 2023-08* |

**What each window's year did** — holding BTC, ETH and SOL equally, close over
open, no costs (`regimes` in the JSON):

| window | span | BTC | ETH | SOL | equal-weight |
|---|---|---|---|---|---|
| A | 2025-09-10 → 2026-09-20 | −28.0 % | −40.1 % | −50.2 % | **−39.4 %** — a bear year |
| B | 2024-08-31 → 2025-09-09 | +88.7 % | +70.6 % | +57.4 % | **+72.3 %** — a bull year |
| **C** | 2023-08-22 → 2024-08-30 | +126.3 % | +51.5 % | +551.1 % | **+243.0 %** — a *much stronger* bull |
| *D* | *2022-08-22 → 2023-08-21* | *+21.4 %* | *+3.0 %* | *−41.9 %* | ***−5.8 % — the sideways year*** |

**Read this before anything else.** The brief asked for "a third window of a
different regime". Window C is a third independent draw, but it is **not a
different regime from B — it is a more extreme version of it.** The regime
§3.12 actually asked for ("a sideways year") is **window D**, which is why D is
computed and reported even though it is a fourth window and is never folded
into a three-window count. D is also the window on which the most things break.

**Window D is not a fourth independent draw.** Its scored year sits inside
window C's in-sample, which is what a rolling walk-forward always does; it is
said here rather than hidden.

**Coverage.** 22 of the 27 coins have all of A, B and C — that is the
population every count and correlation below uses. BNB and TON have A and C but
not B (their middle third is 111 and 102 days, under the floor); HBAR and SUI
have A and B but not C; HYPE has none (its whole series is 227 days). 21 coins
also have D.

---

## 3. Fidelity — five checks, all reported

**1. The one copy, against the original.** `run` cannot express a cross-asset
entry gate (§3.9's BTC-regime filter), and its equity curve is sampled every
sixth bar at a phase that moves when the array is extended, which the sleeve
arithmetic cannot use. One copy exists, `runGated`, taken from `run` line by
line, adding an optional entry gate and a mark at every bar. With the gate off
it must **be** `run`:

| stop rule | cells | worst \|Δreturn\| | worst \|ΔmaxDD\| | worst \|Δtrades\| |
|---|---|---|---|---|
| `shipped` | 190 | **0** | **0** | **0** |
| `trail` | 190 | **0** | **0** | **0** |

(190 = every accepted coin × every scored window × both venues' costs.)
`trend-4h-wide` needs no copy at all — it is `run` with wider `TrendParams`,
which is how `backtest_kraken.ts` ran it.

**2. The splice leaves windows A and B alone.** The seeded rule on A and B,
priced on the **Coinbase-only** series at the boundaries every published table
used, against the same window on the **spliced** series at the boundaries this
study uses:

| stop rule | cells | worst \|Δreturn\| | worst \|ΔmaxDD\| | worst \|Δtrades\| |
|---|---|---|---|---|
| `shipped` | 100 | **0** | **0** | **0** |
| `trail` | 100 | **0** | **0** | **0** |

**3. The harness reproduces the study it extends.** §0's table: `trail`, worst
\|Δ\| 0.0004 against §3.8's published figures on 33 of 35 rows. The two
uncompared rows are HYPE window A and BNB window B, which this study does not
score because their in-samples (152 and 111 days) are under its floor; §3.8
scored them at −3.9 % and −12.1 %.

**4. One methodological asymmetry, measured.** Windows A and B choose their
parameters the way every published table chose them — on the coin's own
Coinbase array from bar 0, where the first weeks have no 30 daily closes for
the momentum gate and so block entries. Windows C and D choose on the combined
series, where that history exists. Re-choosing A and B *with* the warm-up:

| stop rule | cells | chosen point moves | worst \|Δ out-of-sample return\| | median |
|---|---|---|---|---|
| `shipped` | 100 | 24 | 0.4601 | **0** |
| `trail` | 100 | 17 | 0.1530 | **0** |

The median cell is unaffected and a fifth to a quarter are not. This is the one
respect in which window C had a slightly better hand than A and B, and it is
worth keeping in mind whenever C looks better than they do.

**5. Determinism.** Two consecutive runs over the same inputs produced
byte-identical `windows.json`. The null distribution is computed exactly
(hypergeometric intersections) rather than sampled, so there is no seed to
trust. `backtest.ts` is hashed at the start of the run and again at the end; a
run that straddled an edit throws rather than writing a half-result.

---

## 4. W2 — the live candidate on a third window

`trend-4h` · Revolut X · BTC/ETH/SOL/AVAX/SUI · $100 · five equal $20 slots ·
**seeded parameters** (fast 20 / slow 100 / ATR 3), which is what §3.11 and
`go-live.md` recommend and what a live row would run.

### 4.1 The sleeve, under the stops the loop runs now (`shipped`)

| window | regime | members | return | max DD | ret/DD | deployment | turnover |
|---|---|---|---|---|---|---|---|
| **C** | +243 % bull | 4 (no SUI) | **+55.6 %** | 7.3 % | **7.57** | 17.3 % | 21.4×/y |
| B | +72 % bull | 5 | **+20.1 %** | 10.5 % | 1.92 | 14.4 % | 21.8×/y |
| A | −39 % bear | 5 | **+8.0 %** | 11.3 % | 0.71 | 8.8 % | 16.5×/y |
| *D* | *−6 % sideways* | *4 (no SUI)* | ***−7.8 %*** | *15.5 %* | ***−0.50*** | *7.9 %* | *14.8×/y* |

**Like for like** — the same row restricted to the four coins every window has
(BTC/ETH/SOL/AVAX, $80), so the three are comparable: C **+55.6 % / 7.57**,
B **+25.1 % / 2.19**, A **+8.5 % / 0.54**, D **−7.8 % / −0.50**.

Under `trail` (the published rule) the same rows read C +47.1 % / 8.14,
B +12.6 % / 1.24, A −0.3 % / −0.03, D −3.2 % / −0.29 — A and B reproducing
§3.11's headline exactly.

**Ranked by the worst window it has, the recommended set is positive on all
three and negative on the fourth.** Its worst of A/B/C is +8.0 % (ret/DD 0.71)
under the shipped stops and −0.3 % (−0.03) under the published ones. Adding the
sideways year makes its worst **−7.8 % / −0.50**.

### 4.2 Per coin, `shipped`, seeded parameters

| window | AVAX | SOL | ETH | BTC | SUI |
|---|---|---|---|---|---|
| C | **+126.7 %** (19 t) ★ | +69.8 % (24 t) ★ | +81.5 % (16 t) ★ | +0.3 % (34 t) | — |
| B | +6.8 % (20 t) ★ | +3.0 % (29 t) | +80.1 % (20 t) ★ | +12.4 % (36 t) ★ | −2.5 % (10 t) |
| A | **+34.1 %** (9 t) ★ | +17.6 % (14 t) ★ | −8.0 % (22 t) | −10.7 % (28 t) | +1.4 % (12 t) ★ |
| *D* | *−29.5 % (16 t)* | *−8.3 % (4 t)* | *−6.3 % (24 t)* | *+14.5 % (20 t)* ★ | *—* |

★ = clears §4.15's four tests **on that window**, book included.

### 4.3 Leave one coin out — does AVAX pay for its seat?

Row capital re-split equally between the coins that remain, exactly as
`allocation.json`'s `question5_coinChanges` does. **A positive delta means the
row was better without that coin.**

| window | BTC | ETH | SUI | SOL | AVAX |
|---|---|---|---|---|---|
| C (`shipped`) | **+4.82** | −1.94 | — | −1.61 | **−2.35** |
| B (`shipped`) | +0.07 | −1.27 | +0.27 | +0.59 | **+0.13** |
| A (`shipped`) | +0.41 | +0.44 | −0.17 | −0.18 | **−0.56** |
| *D* (`shipped`) | *−0.25* | *−0.26* | *—* | *+0.06* | ***+0.57*** |
| C (`trail`) | +1.55 | −0.45 | — | −2.78 | **0.00** |
| B (`trail`) | −0.17 | −0.92 | +0.05 | +0.44 | **+0.22** |
| A (`trail`) | +0.29 | +0.20 | +0.13 | −0.30 | **−0.25** |
| *D* (`trail`) | *−0.39* | *−0.17* | *—* | *+0.05* | ***+1.03*** |

### 4.4 Does AVAX still pay for its seat when a third regime is asked? — **Yes on the third, no on the fourth.**

Under the stops the loop now runs, AVAX is the **only coin of the five that
clears the bar on all three windows** on seeded parameters (A, B and C; §5.2),
it is the row's biggest contributor on two of the three, and removing it makes
the row worse on **both bull windows and the bear one** (−2.35, +0.13, −0.56 —
the window-B figure is a rounding-scale improvement, +0.13 on a ret/DD of 1.92).
Its window-C return of +126.7 % is the largest single-coin number in the study.

**And it is the worst member of the sleeve in the sideways year**: −29.5 % in
window D, where taking it out improves the row's ret/DD by +0.57 (by +1.03 under
the published stops). The coin that earns its seat in a trend earns it *because*
it trends, and window D is the year nothing did.

So: **AVAX's seat survives a third window and does not survive a fourth.** That
is a stronger record than §3.8's "fails the second window" — which was measured
under the old stop and does not reproduce under the new one — and a weaker one
than "clears the bar", because the fourth window exists and says otherwise.

---

## 5. W3 — the one-window cohort, which is the actual question

> *"If one window earns a coin a seat, a lot of other coins also cleared one
> window — why aren't they all in?"*

### 5.1 First, the part that is true before any number is computed

A coin that cleared **exactly one** of A and B cannot clear all three windows —
it has already failed one. The cohort's three-window count is zero by
construction. The question the numbers can answer is different and sharper:
**does window C reverse a one-window verdict, or does it behave like a coin
flip?**

### 5.2 Cohort membership moved when the stop changed, so both are given

§3.8 / §3.12's recorded cohort was computed under the old stop. Re-derived from
this run's own windows A and B — Revolut X, the bar including the $100k book:

| | `shipped` (what the loop runs) | `trail` (what §3.8 used) |
|---|---|---|
| clears **both** A and B, chosen params | SOL | SUI |
| clears both, seeded params | **AVAX** | *(none)* |
| clears **one**, chosen params | AVAX, ICP, SUI, UNI *(A)*; ADA, ALGO, DOGE, ETH, HBAR, LINK, NEAR, PEPE, XLM, XRP *(B)* | AVAX, ICP, SOL, UNI *(A)*; ADA, BTC, ETH, LINK, NEAR, PEPE, XLM, XRP *(B)* |
| clears neither | 9 coins | 11 coins |
| not scorable (floor) | BNB, HYPE, TON | BNB, HYPE, TON |

The movement is real and large: **SUI drops out of the two-window list and AVAX
enters it** (on seeded parameters); SOL enters it on chosen parameters. §3.8's
"only SUI and POL cleared both windows" is a statement about the old stop.

### 5.3 How many clear all three, and how many would chance give?

**The null, stated explicitly.** Each window's clearers are an independent
uniform subset of the 22-coin population, of the size that window actually
produced. Expected number clearing all three = 22 × (k_A/22) × (k_B/22) ×
(k_C/22). The distribution is computed exactly (hypergeometric intersections),
not sampled, so `P(≥ observed)` is exact.

| stop rule · venue · params | pop | pass A | pass B | pass C | **observed all three** | **chance expects** | P(≥ obs) |
|---|---|---|---|---|---|---|---|
| `shipped` · revx · chosen | 22 | 4 | 10 | 4 | **1** (SOL) | 0.33 | 0.30 |
| `shipped` · revx · seeded | 22 | 5 | 11 | 7 | **1** (AVAX) | 0.80 | 0.60 |
| `shipped` · kraken · chosen | 22 | 6 | 12 | 4 | **0** | 0.60 | 1.00 |
| `shipped` · kraken · seeded | 22 | 7 | 13 | 8 | **1** (AVAX) | 1.50 | 0.85 |
| `trail` · revx · chosen | 22 | 4 | 8 | 6 | **0** | 0.40 | 1.00 |
| `trail` · revx · seeded | 22 | 5 | 9 | 7 | **0** | 0.65 | 1.00 |
| `trail` · kraken · chosen | 22 | 6 | 12 | 4 | **0** | 0.60 | 1.00 |
| `trail` · kraken · seeded | 22 | 7 | 10 | 6 | **0** | 0.87 | 1.00 |

**Arithmetic, worked, for the headline row** (`shipped` · revx · seeded):
5/22 = 0.227, 11/22 = 0.500, 7/22 = 0.318. 22 × 0.227 × 0.500 × 0.318 = **0.80**.
Observed: 1. P(at least 1) = 0.60. **One pass where chance gives 0.8 is not a
finding.**

The whole shape, not just the tail — how many windows each coin cleared
(`shipped` · revx · chosen):

| windows cleared | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| observed | 9 | 9 | 3 | 1 |
| the null expects | 8.03 | 10.26 | 3.37 | 0.33 |

The observed distribution is the null distribution. Whatever separates these
coins, three windows of a four-part bar do not detect it.

**The fourteen recorded cohort members, scored on window C** — each on the
venue it would run on, `shipped` stops, chosen / seeded returns and whether
each clears the whole bar there:

| member | venue | C chosen | C seeded | plateau | clears C? |
|---|---|---|---|---|---|
| AVAX | revx | **+125.4 %** | **+126.7 %** | 100 % | **yes / yes** |
| SOL | revx | **+90.8 %** | **+69.8 %** | 100 % | **yes / yes** |
| LINK | revx | +21.9 % | +25.6 % | 81 % | no / no (Kraken leg) |
| PEPE | revx | +5.8 % | +13.5 % | 74 % | **yes / yes** |
| AAVE | revx | +6.1 % | +13.3 % | 52 % | no / no ($54k book) |
| UNI | revx | +1.3 % | +7.5 % | 96 % | no / **yes** |
| BNB | revx | −8.1 % | −4.4 % | 0 % | no / no |
| ICP | revx | −23.6 % | +29.5 % | 67 % | no / no |
| HBAR | revx | — | — | — | **no window C** |
| TON | kraken | +6.1 % | −3.8 % | 70 % | **yes** / no |
| BNB | kraken | −9.1 % | −5.4 % | 0 % | no / no |
| ETC | kraken | −17.7 % | −10.6 % | 11 % | no / no |
| SHIB | kraken | +187.0 % | −18.5 % | 44 % | no / no |
| POL | kraken | −20.6 % | −18.8 % | 0 % | no / no |

**Four of the fourteen clear the third window on chosen parameters and four on
seeded** — against a population base rate on Revolut X of 4 of 22 (chosen) and
7 of 22 (seeded). Having cleared one of the first two windows did not raise a
coin's chance of clearing the third; it is the same rate.

### 5.4 Is a one-window pass predictive of the next window? — **No.**

Tested directly, across all 22 coins that have all three windows
(`shipped` · Revolut X):

| pair | Pearson (chosen) | Spearman (chosen) | Pearson (seeded) | Spearman (seeded) | 2×2 (pp/pf/fp/ff) | P(clears b \| cleared a) | P(clears b \| failed a) | Fisher p |
|---|---|---|---|---|---|---|---|---|
| A → B | **−0.262** | −0.137 | −0.414 | −0.375 | 1/3/9/9 | 0.25 | **0.50** | 0.93 |
| A → C | +0.438 | +0.519 | +0.417 | +0.303 | 2/2/2/16 | 0.50 | 0.111 | 0.14 |
| B → C | −0.151 | +0.212 | −0.201 | +0.060 | 3/7/1/11 | 0.30 | 0.083 | 0.23 |

Under `trail` the same three pairs read −0.264 / +0.180 / −0.166 and the A → B
contingency is **0 / 4 / 8 / 10** — *not one coin that cleared window A also
cleared window B*, and P(clears B | cleared A) = 0.00 against 0.44 for the coins
that failed A.

**The sentence the brief asked for: across the 27-coin universe, one window's
result carries no usable information about the next — the correlations are
−0.41 to +0.52 depending on which pair and which parameter set you pick, the
sign flips between pairs, not one of the six contingency tests reaches p < 0.05
at n = 22, and in the one pair that repeats across both stop rules (A → B) a
coin that cleared the earlier window was *less* likely to clear the later one
than a coin that failed it. A paper seat earned by one window is a coin flip.**

### 5.5 Where do SUI and POL land on the third window?

**SUI — there is no third window, because there was no SUI.** Its Kraken
history begins 2023-05-03, 142 days before its Coinbase series, which is under
the 180-day in-sample floor. Priced anyway and **counted nowhere**
(`shortInSampleProbe`): window C reads **−17.2 % chosen / −12.8 % seeded with a
0 % plateau** under `shipped`, −12.3 % / −7.9 % / 0 % under `trail`. Under the
stops the loop now runs SUI does not even clear **two** windows: A yes
(+29.6 % chosen, +1.4 % seeded), B no (−2.5 %).

**POL — it fails the third window on every reading.** On Revolut X it fails the
bar on all four windows on the **book** test alone ($11k a day against the
$100k floor); the four numeric tests it does pass on A (+23.1 % chosen /
+29.5 % seeded, plateau 100 %) and on no other window. On **Kraken**, where
§4.16 would let it run, it clears window A (+21.1 % chosen, +27.6 % seeded,
plateau 100 %) and **fails B, C and D**: window B −2.3 % / +3.5 % on a 44 %
plateau, **window C −20.6 % / −18.8 % on a 0 % plateau**, window D −16.3 % /
−4.7 % on 41 %. §3.8's "POL clears the numbers and waits" is a one-window
statement, and the third window does not support it.

**So the pair §3.8 singled out as the only two-window clearers ends up: one
that cannot be asked a third question, and one that answers it no.**

---

## 6. W4 — the two written-down candidates, on three windows

### 6.1 `trend-4h-wide` — clears three windows on SOL and AVAX, and dies in the fourth

§3.12's one rulebook whose mean round trip clears a Kraken cost at t > 2: slow
200/300, breakout 100/200, 4/6×ATR, parameters chosen per window (8 grid
points). Under `shipped`:

| venue | pass A | pass B | pass C | clears all three | chance expects | P(≥ obs) |
|---|---|---|---|---|---|---|
| Revolut X | 4 | 11 | 11 | **AVAX, SOL** | 1.00 | 0.25 |
| Kraken | 7 | 15 | 11 | **AVAX, SOL** | 2.39 | 0.79 |

Under `trail`: the same two coins, expected 0.79 (revx, P = 0.17) and 1.56
(Kraken, P = 0.50). **Two coins clearing three windows where chance gives one
is not significant**, but it is the strongest single result in this study, and
it is the same two coins under both stop rules and on both venues.

**Then window D.** `shipped`: SOL **−0.9 %** on **2 trades** in the year;
AVAX **−35.0 %** with a **37 % drawdown** — over §4.15's limit — on 12 trades.
`trail`: SOL +0.1 % on 2 trades, AVAX −28.8 % / 31 %.

The rule is wide enough to hold for weeks, which is exactly what made it
attractive against Kraken's 80 bps; the same width means it fires twice a year
on SOL, and a rule with two trades in a year cannot be distinguished from
nothing. **Verdict: it survives the third window and fails the fourth, and its
passes rest on trade counts too small to separate from luck.** §3.12's "what
would change this" named this rulebook and a sideways year together; the
sideways year has now been run, and it says no.

### 6.2 The BTC-regime entry gate — one coin of four survives, inside chance

§3.9's idea 1 / §3.10 point 6, which cleared both existing windows on LINK,
NEAR, SUI and ALGO. 27-point grid (BTC SMA 100/150/200 × fast × slow), Revolut
X costs with Kraken as the cross-venue test.

| stop rule | pass A | pass B | pass C | clears all three | chance expects | P(≥ obs) |
|---|---|---|---|---|---|---|
| `shipped` | 9 | 9 | 8 | **NEAR, UNI** | 1.34 | 0.40 |
| `trail` | 8 | 8 | 8 | **NEAR** | 1.06 | 0.71 |

§3.10's four, on three windows (`shipped` / `trail`): **NEAR A B C / A B C** ·
ALGO B C / A B · LINK A B / B · **SUI A / A B** (no window C).

**Verdict: two-window luck, for three of the four.** NEAR is the one coin that
clears three windows under both stop rules — and one or two passes where chance
gives 1.06–1.34 is exactly what §3.9 and §3.10 said about it the first two
times. The filter still does what it always did: it holds less. Nothing here
justifies a paper twin that §3.10's evidence did not already justify, and
nothing here removes the reason it was never adopted.

---

## 7. The multiple-comparisons control, for the study as a whole

- **Arms looked at: 11,915 per stop rule, 23,830 in total.** An arm is one
  parameter point run out of sample on one coin, one window and one venue's
  costs (trend 27 + wide 8 + regime 27 per coin × window × venue, plus the
  warm-up re-choice on A and B).
- **Coin-windows scored: 95 per stop rule** across 27 coins.
- **Arms that passed, and what a null gives**, all in the tables above:
  baseline trend-4h **0 or 1** coin of 22 clearing three windows against a null
  of 0.33–1.50 on every venue × parameter × stop-rule combination;
  `trend-4h-wide` **2** against 0.79–2.39; the regime gate **1–2** against
  1.06–1.34. **Not one arm in this study clears three windows more often than
  chance alone would put it there.**
- The null is deliberately generous to the alternative: it conditions on how
  many coins cleared each window, so the "more coins clear the bull windows"
  effect is already inside it and cannot be mistaken for a finding.
- The one place a count exceeds its null (`trend-4h-wide`, 2 against 1.00,
  P = 0.25) is also the place where the trade counts are 2–12 a year and the
  fourth window is a 35 % drawdown.

---

## Verdicts

1. **A third window exists now, and it is a second bull year, not a sideways
   one.** Kraken's quarterly bundle reaches back to 2013 for BTC; all 27 coins
   cleared the overlap check against Coinbase (median 1.8–11.3 bps on 4-hour
   closes over up to 6,261 bars). Window C's scored year is +243 % for the
   majors. The sideways year the question really wanted is **window D** (−5.8 %),
   which the same data supports for 21 coins and which is reported throughout.
2. **AVAX pays for its seat on the third window and loses it on the fourth.**
   Under the stops the loop now runs it is the only member of the five that
   clears the bar on A, B and C on seeded parameters, and the row is worse
   without it on all three; in the sideways year it returns −29.5 % and the row
   is **better** without it (+0.57 ret/DD). The honest answer to "does AVAX
   deserve its seat" is *in three of the four regimes we can measure, yes.*
3. **Zero to one coin of twenty-two clears the bar on all three windows,
   against a null of 0.33 to 1.50.** Under the published stop rule it is zero on
   all four venue × parameter combinations. Under the current one it is SOL
   (chosen parameters) or AVAX (seeded), each a single pass where chance expects
   0.33 and 0.80. The full histogram of "windows cleared" matches the null
   almost exactly.
4. **A one-window pass predicts nothing.** Correlations between windows run
   −0.41 to +0.52 with the sign flipping between pairs; no contingency test
   reaches p < 0.05; and for A → B — the only pair both stop rules agree on —
   clearing the earlier window made a coin *less* likely to clear the later one.
   **The reason the other one-window coins are not all in is not that they are
   worse than the ones that are; it is that "cleared one window" is not
   evidence about anything.** That cuts both ways: it is also not a reason to
   remove AVAX, and it is the reason §4.15's own sentence — *the bar governs
   additions, the sleeve number governs money* — is the right rule.
5. **SUI cannot be asked a third question and POL answers it no.** SUI did not
   exist before 2023-05, so it has no window C from any source; with the floor
   relaxed its window C is −17.2 % on a 0 % plateau. POL fails window C on both
   venues on both parameter sets with a 0 % plateau. §3.8's "only SUI and POL
   cleared both windows" does not survive either a third window or the stop
   change.
6. **Both written-down candidates are two-window luck by the fourth window.**
   `trend-4h-wide` clears three windows on SOL and AVAX on both venues — the
   study's strongest single result, and still inside chance (P = 0.17–0.79) —
   then loses 35 % on AVAX with a 37 % drawdown in the sideways year and fires
   twice a year on SOL. The BTC-regime gate keeps one of §3.10's four coins
   (NEAR) where chance expects 1.06–1.34.
7. **The recommended set is the one thing that comes out of this stronger.**
   Not because any member clears the bar — that is still a coin-level question
   with a coin-level answer — but because the **sleeve** is positive on all
   three windows (+8.0 %, +20.1 %, +55.6 % under the shipped stops; −0.3 %,
   +12.6 %, +47.1 % under the published ones) while its members disagree about
   which window they clear, which is the entire argument §4.15 makes for it. Its
   worst window of the four is **−7.8 % with a 15.5 % drawdown**, in a year when
   holding the majors returned −5.8 % and the rule was in the market 7.9 % of
   the time.

---

## What this study did NOT establish

- **It did not find a coin that deserves a seat on its own record.** Zero to
  one of twenty-two, against a null of 0.33–1.50, is not a finding in either
  direction.
- **It did not test the live rule.** Jev is not in the backtest, the fills are
  the backtester's assumption, and paper is still the only thing that measures
  either.
- **It did not give SUI a third window**, and no data source reachable from
  here can. The same is true of HYPE (no window at all), and of BNB and TON for
  window B.
- **It did not settle whether the stop change is right.** It prices both rules
  and reports both; §3.13 owns that question. What it does show is that the
  change moves the cohort itself — SUI leaves the two-window list, AVAX joins
  it — so anything downstream that quoted §3.8's membership needs re-reading.
- **It did not make window C a *different* regime.** C is a stronger bull than
  B. The sideways year is window D, which 21 coins have and 6 do not, and which
  is therefore a weaker test with a smaller population.
- **It did not re-derive the venue split, the allocation, or any rulebook other
  than trend-4h, trend-4h-wide and the regime gate.** §3.11 and §3.12 stand
  as they are, except where the stop change touches them.
- **It did not measure a spread or a book.** Every cost and every liquidity
  figure is §3.8's and §3.12's, unchanged, including their own one-snapshot
  caveats.

---

## Caveats — all of them

- **Window C is one year and window D is one year.** Three windows are three
  draws, not a distribution. The study replaces "two single draws" with "three
  single draws and a fourth for contrast", which is better and is not enough.
- **Windows C and D use a different exchange's prices for their in-sample.**
  The splice is verified on the overlap (median 1.8–11.3 bps on 4-hour closes)
  and the fidelity check shows it leaves A and B untouched, but the years
  2021–2023 are Kraken's book, not Coinbase's, and no Coinbase data exists to
  check them against.
- **Windows A and B choose parameters with a handicap C and D do not have** —
  the first weeks of their in-sample have no 30 daily closes for the momentum
  gate. Measured: 17–24 of 100 cells change their chosen point when the warm-up
  is supplied, median effect zero, worst 0.15–0.46 of return. It is the one
  respect in which C had a better hand.
- **Window D's scored year is inside window C's in-sample.** That is what a
  rolling walk-forward does; it means D and C are not independent of each other.
- **The population for every count is 22 coins, not 27.** HYPE, BNB, TON, HBAR
  and SUI lack at least one of the three windows. With n = 22 a contingency test
  needs a very large effect to reach p < 0.05, so "not significant" here means
  "not detectable at this size", not "zero".
- **The coins move together.** Twenty-two long-only crypto trend sleeves in the
  same three years are far fewer than twenty-two independent tests, so the null
  above — which assumes independence across coins — is if anything too
  *generous* to the alternative.
- **Trade counts are small.** The trend rule fires 4–40 closed round trips per
  coin per window; `trend-4h-wide` fires 2–12. Nothing under about twenty round
  trips separates a rule from luck.
- **POL's third and fourth windows are MATIC's.** The rename is checked against
  Coinbase over seven months and the numbers agree to 8 bps median, but the
  ticker substitution is a judgement the reader should be able to reject.
- **POL's, BNB's, TON's, HYPE's and PEPE's windows are elsewhere on the
  calendar** than everyone else's, because each coin is split on its own bar
  count, as every earlier study split it. Two coins "in the same window" may
  share no days.
- **`windows.json` summarises each parameter grid by its plateau block**
  (share positive, median, worst, best, rank of the chosen point) rather than
  dumping all 27 per-point returns per cell; the grids themselves are in
  `grids`. Dumping every point would multiply a 2.5 MB file by about ten.
- **The in-sample floor of 180 days is this study's own rule**, declared before
  it ran. It excludes six coin-windows that §3.8 scored or would have scored;
  all six are priced in `shortInSampleProbe` and counted nowhere.
- **The overlap thresholds (25 bps median, 100 bps p95) are this study's own
  too**, and nothing came close to failing them — the worst was ETC at 11.3 /
  46.2. A threshold nothing fails has not been tested.
- **Costs and books are §3.8's and §3.12's snapshots** — one twenty-minute
  window on a Monday afternoon for the Revolut X UK book and eleven samples over
  ten minutes for Kraken's. §4.15's $100k test, which decides POL, rests on one
  of those numbers.
- **Everything here is a search scored on the windows it searched.** 23,830
  arms. The chance column is the control, and it is the reason the answer to
  almost every question in this report is "no".

---

## Commands run

```
# 1. the extension — Kraken's quarterly OHLCVT bundle, five parts, concatenated
for i in 0 1 2 3 4; do
  curl -sS "https://assets.kraken.com/marketing/institutions/Kraken_OHLCVT_Full_2026Q2.zip.part0$i" >> full.zip
done
# 8,972,380,104 bytes, 12,037 CSV entries, every pair to 2026-06-30

# 2. the 60-minute USD series for the 27 coins in COSTS (POL ← MATICUSD),
#    written as <ext>/<COIN>-USD_1h_kraken.json in the [t_s,o,h,l,c,v] shape
#    backtest.ts already reads, plus <ext>/provenance.json naming each pair

# 3. the study
deno check --quiet supabase/functions/agents/backtest_windows.ts
deno run --allow-read --allow-write supabase/functions/agents/backtest_windows.ts \
    --data <scratchpad>/ohlcv --ext <scratchpad>/w3/ext --out docs/agents/backtests
```

Run time 349 s for 27 coins × up to 4 windows × 2 venues × 3 rulebooks × **2
stop rules**. Re-run to a scratch directory: byte-identical. `latest.json`,
`summary.json`, `allocation.json`, `kraken.json` and every other study's file
were not touched.

## Files written

- `supabase/functions/agents/backtest_windows.ts` — the study script (new).
- `docs/agents/backtests/windows.json` — its raw output (new).
- `docs/agents/reviews/2026-09-21-third-window-study.md` — this file (new).

No other repository file was touched; nothing was committed or pushed.
