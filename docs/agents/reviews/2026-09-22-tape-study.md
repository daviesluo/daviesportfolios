# Tape study — the tables price a signal the loop does not compute, so here is the same rule on the tape it reads

Script `supabase/functions/agents/backtest_tape.ts`; raw output
`docs/agents/backtests/tape.json`. It re-prices §3.11's live candidate and
§4.15's bar on **Kraken's own candles**, because `signal_venue` is `kraken` on
every `agent_strategies` row (`0037`) while every published table in
`reference.md` is priced on **Coinbase** candles. §3.14 measured that gap on 36
comparisons and said the fix was a study rather than an edit. This is that
study.

It invents no rule, searches no universe and moves no recommendation on its
own. It changes exactly one thing — the price series — and reports what moves.

**No wall clock is written into the output.** Re-running over the same three
data directories reproduces `tape.json` byte for byte; verified by two
consecutive runs. The run is identified instead by the SHA-256 of
`backtest.ts`, `31d27c7d82f8a94c…`, which is an input to this study and is the
same hash §3.15 recorded.

---

## 0. What is being compared, and what cannot be

Two arms, same calendar, same rule, same fills, same fees, same stops, same
cooldown. Only the price series differs.

| arm | series |
|---|---|
| **`coinbase`** | exactly what `backtest_windows.ts` builds — Kraken's quarterly bundle spliced strictly **before** the Coinbase Exchange series' first bar, Coinbase's from there. The tape every published table used. |
| **`kraken`** | Kraken's own 4-hour tape end to end — the same quarterly bundle resampled to 4 h, plus Kraken's public keyless `OHLC` endpoint for 2026-07-01 → 2026-09-21, which the bundle predates. |

**Three things follow before any number, and they matter.**

**1. Windows C and D are already Kraken-priced, in part.** §3.15's four windows
were built by splicing Kraken's history in front of Coinbase's. So window C
*chooses* its parameters on Kraken bars and scores on Coinbase bars, and window
**D is Kraken end to end on both arms**. Only windows A, B and C's
out-of-sample spans can differ between the arms at all, and window D must come
out bit-identical. It does — that is fidelity check 3 below, and a non-zero
there would have meant the harness was wrong.

**2. The window boundaries are defined once and mapped by timestamp.** Each
coin's own Coinbase series cut in thirds, exactly as §3.7 / §3.8 / §3.10 /
§3.11 / §3.15 cut it; the Kraken arm's indices are found by **timestamp**,
never by bar index, because the two arms do not have the same bars. Kraken has
no candle for a 4-hour period in which its own venue was down — 0 to 5 bars a
coin over the three years (2024-01-20, 2024-04-14 and 2025-11-01 hit every
pair). Those gaps are left in. They are a property of the tape the loop reads,
not an error to paper over, and they are counted per coin in the JSON.

**3. The Kraken-tape coverage rule, written down before the numbers.** A window
is priced on the Kraken arm only when Kraken's tape spans the whole of it —
first bar at or before the in-sample start, last bar at or after the
out-of-sample end — and still leaves more bars than the widest lookback at each
end. A window either arm cannot see is dropped from **both**, because a
comparison between two different calendars is not a comparison. One coin loses
windows this way:

| coin | windows on the published arm | priced here | why |
|---|---|---|---|
| **HBAR/USD** | A, B | **none** | Kraken listed HBAR on 2025-07-10, after HBAR's Coinbase series began (2023-09-22) |
| HYPE/USD | none | none | already unscored in §3.15 — its in-sample is under the 180-day floor, on either tape |

So the population is **26 coins with at least one priced window and 22 with all
of A, B and C** — and the 22 are **exactly** the 22 §3.15's counts run on,
checked coin for coin against `windows.json`. HBAR, the one coin this study
drops that §3.15 kept, had no window C there either, so it was never in that
count; it only leaves the 23- and 24-coin A∩B lists, which §4.3 handles
explicitly.

**The splice inside the Kraken arm is not two tapes averaged.** Over the 222
4-hour bars the quarterly bundle and the live `OHLC` endpoint share, they agree
to **0.0000 bps median and 0.0000 bps maximum on all 27 coins**. They are the
same tape, joined.

**How far apart the two tapes actually are**, bar for bar, over each window's
own span: median **1.21 – 11.81 bps**, p95 **4.85 – 46.55 bps** (median across
cells 5.60 and 19.93). Over the whole three years: median 1.71 – 11.27 bps,
p95 6.75 – 46.14. Tightest on BTC (1.7 bps), widest on ETC (11.3).

---

## 1. Fidelity — five checks, all reported

**1. The one copy, against the original.** `run` samples its equity curve every
sixth bar at a phase that depends on where the array starts — which is exactly
what changes between the two arms — so the sleeve arithmetic cannot use it. One
copy exists, `runMarked`, taken from `run` line by line, adding a mark at every
bar and the traded weight. It must **be** `run`:

| arm | cells | worst \|Δreturn\| | worst \|ΔmaxDD\| | worst \|Δtrades\| |
|---|---|---|---|---|
| `shipped`·coinbase | 186 | **0** | **0** | **0** |
| `shipped`·kraken | 186 | **0** | **0** | **0** |
| `trail`·coinbase | 186 | **0** | **0** | **0** |
| `trail`·kraken | 186 | **0** | **0** | **0** |

744 cells, zero difference. (186 = every coin × every priced window × both
venues' costs, seeded parameters.)

**2. The published arm reproduces `windows.json`, cell for cell.** This is the
check that makes the other arm mean anything. Every coin × window × venue ×
stop rule, comparing return, drawdown and trade count of the chosen point, the
seeded point, own venue and other venue, against
`docs/agents/backtests/windows.json` (SHA-256 `f93c9cec4a65cf3f…`):

| stop rule | cells compared | cells that differ | worst \|Δ\| |
|---|---|---|---|
| `shipped` | 2,232 | **0** | **0** |
| `trail` | 2,232 | **0** | **0** |

4,464 cells, not one difference. The published arm is not "close to" the
third-window study; it **is** it.

**3. Window D is identical on both arms.** D's in-sample and out-of-sample both
sit before the splice, where both arms are the same Kraken bars:

| stop rule | cells | worst \|Δreturn\| | worst \|ΔmaxDD\| | worst \|Δtrades\| |
|---|---|---|---|---|
| `shipped` | 84 | **0** | **0** | **0** |
| `trail` | 84 | **0** | **0** | **0** |

**4. The Kraken arm's own splice.** Bundle against live endpoint, 222 shared
4-hour bars a coin: **0.0000 bps median, 0.0000 bps max, all 27 coins**.

**5. Determinism.** Two consecutive runs over the same three data directories
produced **byte-identical** `tape.json`. Every null is computed exactly
(hypergeometric intersections, exact binomial sign tests), so there is no seed
to trust. `backtest.ts` is hashed at the start of the run and again at the end;
a run that straddled an edit throws rather than writing a half-result.

---

## 2. T1 — what the tape is worth

A **cell** is one coin × one window × one venue's costs × one stop rule, over
windows A, B and C. 288 cells, and every one is reported twice: with the
parameters **seeded** (fast 20 / slow 100 / ATR 3 — the tape and nothing else
differs) and with each tape allowed to **choose** its own grid point in sample,
which is what a published table actually does.

### 2.1 The distribution

| | seeded | chosen |
|---|---|---|
| comparisons | 288 | 288 |
| **median \|Δreturn\|** | **4.03 points** | **4.80 points** |
| p95 \|Δreturn\| | **31.3 points** | **41.3 points** |
| max \|Δreturn\| | **70.4 points** | **540.0 points** |
| sign flips | **26 (9.0 %)** | **43 (14.9 %)** |
| median \|Δtrades\| / max | 0 / 6 | 0.5 / 16 |
| median \|Δmax-drawdown\| / max | 1.3 pts / 18.4 pts | 2.2 pts / 23.3 pts |
| **§4.15 verdict flips** | **17 of 288 (5.9 %)** | **38 of 288 (13.2 %)** |

§3.14's spot check said median 2.5 and max 68 on 36 comparisons. On 288 it is
**median 4.0 and max 70** — the same picture, slightly worse. Its worst case
reproduces here exactly: **ALGO window B, 12 trades on both tapes, +79.9 % on
Kraken against +147.9 % on Coinbase** at Kraken's costs (and +85.7 % against
+156.1 % at Revolut X's). Two more of the same size that §3.14 did not see:

| cell | Kraken tape | Coinbase tape | Δ | trades |
|---|---|---|---|---|
| ALGO · B · revx · `shipped` | +85.7 % | +156.1 % | **−70.4** | 12 / 12 |
| XRP · B · revx · `trail` | +17.2 % | +85.4 % | **−68.2** | 22 / 22 |
| **BCH · C · revx · `trail`** | **+15.5 %** | **−31.8 %** | **+47.3, sign flip** | 20 / 22 |
| SOL · C · revx · `trail` | +71.8 % | +113.3 % | −41.5 | 28 / 24 |
| **SUI · A · revx · `trail`** | **+29.4 %** | **−10.5 %** | **+39.9, sign flip** | 15 / 16 |

The trade counts are the point. These are not different rules trading different
amounts — they are the same rule taking almost the same number of trades on
almost the same prices, and ending tens of points apart. §3.14's explanation
holds: a Donchian breakout triggers on prior-N **highs** and an ATR trail on
**lows**, so a one-bar difference in which bar makes the high moves an entry,
and the difference compounds through a year.

### 2.2 Is one tape systematically higher? — **No.**

| test | seeded | chosen |
|---|---|---|
| cells: Kraken higher / Coinbase higher | 149 / 139 | 152 / 136 |
| exact two-sided binomial | **p = 0.596** | **p = 0.377** |
| median signed Δ | +0.15 pts | +0.32 pts |
| mean signed Δ | −0.35 pts | −2.58 pts |
| **coins** (one observation each, the coin's median Δ) | **12 / 13, p = 1.000** | **16 / 9, p = 0.230** |

Neither tape wins. The mean is dragged negative by a handful of enormous
Coinbase-favouring cells; the median is a fifth of a point.

**One apparent exception, and it does not survive the right test.** At cell
level window A looks tilted — 61/39 seeded (p = 0.035) and 65/35 chosen
(p = 0.0035). But the four cells a coin contributes to one window (two venues ×
two stop rules) are near-duplicates of each other, so that p-value counts each
coin four times. With **one observation per coin per window** — the coin's
median Δ in that window — it is:

| window | coins | seeded (Kraken / Coinbase higher) | p | chosen | p |
|---|---|---|---|---|---|
| A | 25 | 15 / 10 | 0.424 | 14 / 11 | 0.690 |
| B | 23 | 9 / 14 | 0.405 | 8 / 15 | 0.210 |
| C | 24 | 13 / 11 | 0.839 | 12 / 12 | 1.000 |

Nothing, in any window. The window-A tilt was pseudo-replication and is
reported here as such rather than quietly dropped.

### 2.3 Is the size of the gap predictable? — **Barely.**

Spearman of \|Δreturn\| against everything that plausibly drives it, over all
288 cells:

| predictor | seeded | chosen |
|---|---|---|
| trade count | **0.21** | 0.14 |
| Kraken bars missing in the span | **0.20** | −0.05 |
| tape disagreement, p95 bps over the span | **0.19** | 0.00 |
| realised volatility (annualised) | 0.18 | **0.23** |
| tape disagreement, median bps | 0.15 | 0.02 |
| Kraken half-spread | 0.15 | 0.02 |
| Revolut X UK book $/day | 0.11 | 0.08 |
| Kraken book $/day | −0.11 | −0.01 |
| tape disagreement, max bps | 0.02 | −0.02 |
| Revolut X half-spread | 0.01 | −0.04 |

The strongest predictor anywhere reaches **ρ = 0.23**, which explains about
5 % of the rank variance. The four that carry any signal at all — trade count,
realised volatility, the tape's own bar-level disagreement, and Kraken's
missing bars — are all signed the way §3.14's mechanism predicts: more trades,
more movement, more bar-level disagreement, more gap. None is large enough to
let you look at a coin and say how much the tape is worth on it.

**The books and the spreads predict nothing, and are not even consistently
signed** (UK book +0.11, Kraken book −0.11, Revolut X half-spread +0.01). The
intuitive story — "thin coin, noisy tape, big gap" — is not what the data
shows. ETC has the widest tape disagreement of the 27 (11.3 bps median) and its
median cell moves 4.7 points; BTC has the tightest (1.7 bps) and its worst cell
still moves 13.5.

### 2.4 The tape moves the parameter CHOICE as much as the return

| window | cells | chosen point identical on both tapes |
|---|---|---|
| A | 100 | **46 %** |
| B | 92 | **55 %** |
| C | 96 | **100 %** (by construction — C chooses on the extension, which is the same bars on both arms) |

On the two windows where the choice is actually made on different tapes, the
two tapes pick a different grid point **about half the time**. That is where
the 540-point outlier comes from: **XLM window B**, where Coinbase's tape picks
10/150/4 and returns +544.8 % while Kraken's picks 30/50/2 and returns +4.9 %.
Nothing about the year changed; the in-sample chose differently.

### 2.5 T1's answer

**The disagreement is random in direction and only weakly structured in size.**
There is no tape bias to correct for — a wholesale re-pricing would not move any
recommendation in a predictable direction. What the tape is, is **noise of a
size nobody had measured**: a per-coin, per-window out-of-sample return in this
repository is a **±4-point (median), ±31-point (p95) quantity** depending on
which exchange's candles you read, and one time in eleven it does not even keep
its sign.

That is a much more useful statement than "the tables are wrong". The tables
are not biased. They are **over-precise**, at exactly the level — one coin, one
window — where §4.15 already says not to read them.

---

## 3. T2 — the live candidate on the tape the loop reads

`trend-4h` · Revolut X costs · BTC/ETH/SOL/AVAX/SUI · $100 · five equal $20
slots · seeded parameters · **the shipped stops, which is what `tick.ts` runs**.

### 3.1 The sleeve

| window | regime | Coinbase tape (published) | **Kraken tape (the loop's signal)** | Δ |
|---|---|---|---|---|
| **C** | +243 % | +55.6 %, DD 7.3 %, ret/DD **7.57** | +50.9 %, DD 7.7 %, ret/DD **6.58** | **−4.7 pts** |
| **B** | +72 % | +20.1 %, DD 10.5 %, ret/DD **1.92** | +22.5 %, DD 10.0 %, ret/DD **2.25** | **+2.4 pts** |
| **A** | −39 % | +8.0 %, DD 11.3 %, ret/DD **0.71** | +9.2 %, DD 10.9 %, ret/DD **0.84** | **+1.1 pts** |
| **D** | −6 % | −7.8 %, DD 15.5 %, ret/DD **−0.50** | **−7.8 %, DD 15.5 %, ret/DD −0.50** | **0.0 — identical by construction** |

**The recommendation does not change.** Same sign in every window; the bear
window is *better* on the tape the loop reads, not worse; and the window the
rule is ranked by — D, the sideways year, where it loses — is bit-identical
because it is Kraken's own bars on both arms. Under §3.11's own rule (rank by
the worse window, never average) the live candidate's worst number is
**−7.8 % / −0.50 on both tapes**, and nothing about the go-live brief's §4
moves.

**Under the published stop rule (`trail`), the bear window flips sign**: −0.3 %
on Coinbase's tape against **+6.5 %** on Kraken's. §3.11's headline figure —
"−0.3 % in the bear window" — was therefore a tape artefact as much as a stop
artefact. The stop correction (§3.13) already moved it to +8.0 %; the tape
moves the old number to +6.5 % on its own. Both corrections point the same way,
which is the only reason the old figure did not mislead the decision.

### 3.2 Per coin — and here nothing is robust

Window A (bear), seeded, Revolut X costs, shipped stops:

| coin | Coinbase tape | **Kraken tape** | Δ | Δ trades |
|---|---|---|---|---|
| BTC | −10.7 % | −10.1 % | +0.5 | 0 |
| ETH | −8.0 % | −6.8 % | +1.3 | 0 |
| SOL | +17.6 % | +13.2 % | −4.4 | +2 |
| **AVAX** | **+34.1 %** | **+12.6 %** | **−21.4** | −1 |
| **SUI** | **+1.4 %** | **+29.1 %** | **+27.7** | +1 |

§3.11's re-run said "in the bear window AVAX now returns +34.1 % on its own
slot and is the most expensive coin to remove". On the tape the loop reads it
returns **+12.6 %**, and the most expensive coin to remove is **SUI**:

| leave one out, window A (positive = better without it) | Coinbase | **Kraken** |
|---|---|---|
| ETH | +0.44 | +0.51 |
| BTC | +0.41 | +0.46 |
| SUI | −0.17 | **−0.60** |
| SOL | −0.18 | 0.00 |
| AVAX | **−0.56** | −0.26 |

Same two coins at the top — ETH and BTC both *hurt* the row on either tape —
and **the bottom two swap**: AVAX, the coin §3.11's leave-one-out says is most
expensive to lose, is beaten to that place by SUI, and SOL lands exactly on
zero where the Coinbase tape had it slightly negative. In window B the order is identical on both
tapes; in window C it moves again (Coinbase: BTC, SOL, ETH, AVAX; Kraken: BTC,
ETH, SOL, AVAX). Sign flips inside the sleeve: **SOL window B** (+3.0 % →
−0.2 %) and **BTC window C** (+0.3 % → −6.2 %).

**This is §3.14's finding confirmed at full size and it is the sharp one.** The
sleeve moves a point or two; the coins inside it move twenty or thirty and
reorder. The five slots cancel what the individual coins cannot agree on —
which, as §3.14 put it, is the case for holding five of them, made by accident.

---

## 4. T3 — §4.15's bar, re-run on the tape the loop reads

The four tests, per coin per window, exactly as §3.8 applied them, plus the
$100k-a-day book floor. Population: **23 coins with both A and B, 22 with all
of A, B and C** — HBAR is the one coin §3.15's 24 had that this study drops,
and it is dropped from both arms.

### 4.1 Membership — stable on the seeded arm, unrecognisable on the chosen one

**`shipped` · Revolut X · seeded parameters** — the arm the live row actually
runs:

| | Coinbase tape | **Kraken tape** |
|---|---|---|
| clears BOTH A and B | **AVAX** | **AVAX** |
| clears A only | DOT, ICP, SOL, SUI, UNI | DOT, ICP, SOL, SUI, UNI |
| clears B only | ADA, ALGO, BTC, **DOGE**, ETH, LINK, NEAR, PEPE, XLM, XRP | ADA, ALGO, BTC, ETH, LINK, NEAR, PEPE, XLM, XRP |
| clears C | ALGO, AVAX, ETH, NEAR, PEPE, SOL, UNI | ALGO, AVAX, **BCH**, ETH, NEAR, PEPE, SOL, UNI |

One coin in and one out, across the three windows' verdict lists. §3.15's
re-derived two-window answer — "under `shipped` it is SOL (chosen) / **AVAX** (seeded)" — is
**unchanged for AVAX on the tape the loop reads**.

**`shipped` · Revolut X · chosen parameters** — and here it falls apart:

| | Coinbase tape | **Kraken tape** |
|---|---|---|
| clears BOTH A and B | **SOL** | **AVAX, PEPE** |

The two-window list shares nothing. That is not a contradiction of §4.15, it is
§4.15's own point arriving from a new direction: a membership list built on
chosen parameters is a list of what a search found, and the search finds
different things on different tapes.

Verdict flips across all 288 cells: **17 seeded (5.9 %), 38 chosen (13.2 %)**.
On the live arm specifically (`shipped` · revx · seeded, 72 cells) it is
**2** — BCH window C (−34.9 % → +9.4 %, in) and DOGE window B (+9.4 % → +2.8 %,
out).

### 4.2 Does §3.15's central finding survive? — **Yes, on every arm.**

Zero to two coins of 22 clear the bar on all three windows, against a null of
**0.33 – 1.50** across the sixteen venue × parameter × stop-rule × tape arms —
**0.66 – 1.43 on Kraken's tape alone**. The
null is stated exactly, not sampled: each window's clearers are an independent
uniform subset of the size that window actually produced, and the intersection
distribution is hypergeometric.

**On Kraken's tape** (the eight arms; the Coinbase arm's figures are beside
them, and reproduce §3.15 exactly):

| stop · venue · parameters | clearers A / B / C | all three | null expects | P(≥ observed) |
|---|---|---|---|---|
| `shipped` · revx · chosen | 6 / 10 / 6 | **2** (AVAX, PEPE) | 0.74 | 0.152 |
| `shipped` · revx · seeded | 5 / 10 / 8 | **1** (AVAX) | 0.83 | 0.617 |
| `shipped` · kraken · chosen | 7 / 13 / 7 | **1** (AVAX) | 1.32 | 0.804 |
| `shipped` · kraken · seeded | 7 / 11 / 9 | **1** (AVAX) | 1.43 | 0.832 |
| `trail` · revx · chosen | 5 / 8 / 8 | **0** | 0.66 | 1 |
| `trail` · revx · seeded | 5 / 10 / 8 | **0** | 0.83 | 1 |
| `trail` · kraken · chosen | 7 / 10 / 5 | **0** | 0.72 | 1 |
| `trail` · kraken · seeded | 7 / 11 / 5 | **0** | 0.80 | 1 |

The best any arm manages is **2 against 0.74 expected, P = 0.152** — inside
chance, and that on the arm whose parameters were chosen. The whole
windows-cleared histogram matches the null on every arm too (e.g. `shipped` ·
revx · seeded: observed {0: 7, 1: 8, 2: 6, 3: 1} against {5.90, 10.02, 5.25,
0.83}).

**§3.15's answer to "if one window earns a seat, why not the other ten" is
unchanged by the tape.**

### 4.3 Does a one-window pass predict the next window? — **Still no, and still backwards.**

For every coin: did clearing window A predict clearing window B? Read off the
membership lists on the population that has **both** windows, which is how
§3.15's own four-row table was read. Revolut X costs, n = 23:

| stop rule · parameters | tape | cleared A → also cleared B | did NOT clear A → cleared B |
|---|---|---|---|
| `shipped` · seeded | Coinbase | 1 of 6 = 0.167 | 10 of 17 = 0.588 |
| `shipped` · seeded | **Kraken** | **1 of 6 = 0.167** | **9 of 17 = 0.529** |
| `shipped` · chosen | Coinbase | 1 of 5 = 0.200 | 9 of 18 = 0.500 |
| `shipped` · chosen | **Kraken** | **2 of 7 = 0.286** | **8 of 16 = 0.500** |
| `trail` · seeded | Coinbase | 0 of 5 = 0.000 | 10 of 18 = 0.556 |
| `trail` · seeded | **Kraken** | **1 of 6 = 0.167** | **10 of 17 = 0.588** |
| `trail` · chosen | Coinbase | 1 of 5 = 0.200 | 8 of 18 = 0.444 |
| `trail` · chosen | **Kraken** | **1 of 6 = 0.167** | **8 of 17 = 0.471** |

**The Coinbase rows reproduce reference §3.15's four-row table exactly, minus
HBAR** — which that table counted (its n was 24) and this study drops because
Kraken's tape cannot price it. §3.15 read `shipped`·seeded as 1 of 6 = 0.167
against 11 of 18 = 0.611; without HBAR, which cleared B and not A, that is
1 of 6 against 10 of 17. Every other row matches the same way, so the table
above is like for like.

The table shows the four Revolut X-cost arms. Counting Kraken's costs too there
are **eight Kraken-tape arms, and eight more on the three-window population —
sixteen in all. In every single one, a coin that cleared window A was less
likely to clear window B than a coin that failed it.** No contingency test
comes close on either tape (Fisher one-sided 0.92 – 1.00 throughout). The A→B
return correlation is negative on both tapes and if anything more negative on
Kraken's: Pearson **−0.251 to −0.460** against Coinbase's **−0.247 to −0.414**
across the eight venue × parameter × stop-rule arms.

**Both of §3.15's central findings survive being re-priced on the tape the loop
reads.** Neither was a property of Coinbase's candles.

---

## 5. T4 — what should actually be done

Three options were on the table. The numbers pick between them.

### Option A — re-price the whole reference on Kraken's tape. **No, and it has largely been done.**

The two things in the reference that money rests on are §3.11's sleeve and
§4.15's bar. **Both are re-priced above and neither verdict moves**: the sleeve
is +1.1 / +2.4 / −4.7 / 0.0 points different and ranks the same on its worse
window; the bar's three-window count and its A→B predictiveness come out the
same on both tapes. Re-running §3.3a–§3.12 wholesale would consume the
document's continuity and, because T1 shows the disagreement has **no
direction**, would not move a single recommendation in a predictable way. It
would only replace one set of over-precise per-coin numbers with another.

### Option B — change `signal_venue` to `revx` so the loop matches the tables. **No, and the cost is specific.**

This is the option that sounds like the clean fix, and it is the expensive one.
Priced rather than assumed:

1. **It destroys two of the four windows outright.** Revolut X's own history
   reaches back to **2023-08-19 / 2023-09-05 / 2023-09-11** for BTC / ETH / SOL
   (§2.3) — roughly the Coinbase series' own start, and `backtest.ts`'s own
   header claims less than that ("one year of intraday history"). Even on the
   more generous of the two readings, windows **C and D do not
   exist on Revolut X's tape at all**, and with them goes §3.15 — the entire
   answer to "does a one-window pass mean anything", which is currently the
   repository's strongest statement about its own numbers. Kraken's quarterly
   bundle is the only source in this system that reaches back before 2023.
   Matching the tables to the loop by deleting half the evidence is not a fix.
2. **It moves the decision onto the thinner book.** Revolut X UK: BTC $1.47 M,
   ETH $0.72 M, SOL $0.59 M a day (§2.2). Kraken: BTC $416 M, ETH $211 M, SOL
   $90 M (§3.12) — **100 to 300× deeper**. A 4-hour candle from a thin book is
   built from fewer trades, so its highs and lows are noisier — and highs and
   lows are precisely what this rulebook triggers on. §2c's own conclusion,
   that "Kraken's quotes and candles are the cleaner signal (a 0.01 bps spread
   against 1.7)", is a measurement, and nothing in this study contradicts it.
3. **It re-opens the region trap.** Revolut X keeps two books per pair and
   `/public/candles` without `region` returns the **EEA** book (§4.14). The one
   dislocation trade this repository ever made came from reading the wrong one.
   Every entry decision would ride on a call with that failure mode. Kraken has
   one book.
4. **It cannot be tested.** This study has no Revolut X candle series — the
   endpoint is signed, so it is not reachable from a study harness the way
   Coinbase's and Kraken's are. "Switch to `revx`" can be costed, as above, but
   it cannot be *measured*, and this repository does not adopt untested things.

### Option C — leave the loop alone and fix what the tables CLAIM. **Yes. This is the recommendation.**

The mismatch is real but it is not a bug in the loop; it is over-precision in
the document. Four concrete edits, each supported by a number above:

1. **§3.14's open item is closed with a measurement, not a re-run.** Record
   that the tape is worth a **median 4.0 / p95 31 / max 70 points per coin-
   window**, with **no systematic direction** (149/139 cells, p = 0.60;
   12/13 coins, p = 1.00) and **no usable predictor** (best Spearman 0.23).
2. **§3.11 and `go-live.md` §4 carry both tapes for the sleeve.** The Kraken-
   tape figures are the ones the loop's signal produces and they are
   *slightly better* in the two windows that matter: A +9.2 % against +8.0 %,
   B +22.5 % against +20.1 %, C +50.9 % against +55.6 %, D identical.
3. **§4.15 gains one sentence, which strengthens what it already says.** A
   single coin's single-window return is a ±4-point (median), ±31-point (p95)
   quantity depending on the exchange it was read from, and flips sign one time
   in eleven — so a member's own pass is not evidence, which is already §4.15's
   position, now with a number behind it. **AVAX's seat survives this**: under
   the shipped stop rule on seeded parameters it is the one coin of 22 that
   clears all three windows on *both* tapes (under `trail`, no coin clears
   three on any arm), and its
   leave-one-out cost in the bear window is −0.56 on one tape and −0.26 on the
   other, with SUI taking its place at the bottom. The seat rests on the sleeve,
   as §4.15 says, and the tape is one more reason it has to.
4. **Every per-coin figure quoted anywhere in the reference should name its
   tape.** That is a documentation rule, not a study.

One thing worth building rather than writing: `backtest.ts` has no way to be
pointed at a second tape, so this study had to construct the Kraken 4-hour
series itself. A `--tape` flag on the backtester would let the next study price
both arms for free. That is a code change and is **not** made here — this study
touched three files and no shipped code.

---

## 6. The multiple-comparisons control

**Arms looked at: 20,088**, across **372 coin-windows**. An arm is one
parameter point run out of sample on one coin, one window, one venue's costs,
one stop rule and one tape — §3.7's 27-point grid, unchanged, so the plateau
column means what it means everywhere else in this repository.

**This study searches for nothing.** It re-prices a fixed rule on a second
tape, and every cell reports **both** the seeded point and the chosen point, so
no arm is selected for reporting after the fact. That is why the arm count
above is context rather than a control. There are exactly two places where a
control is load-bearing, and both nulls are exact:

**1. The three-window count (§4.2).** Null: each window's clearers are an
independent uniform subset of the 22-coin population, of the size that window
actually produced; the intersection distribution is hypergeometric, computed
exactly, never sampled. **16 arms examined** (2 tapes × 2 stop rules × 2
venues' costs × 2 parameter sets). Observed all-three clearers: **0 to 2**.
Null expectation: **0.33 to 1.50**. Smallest P(≥ observed) over all 16 arms:
**0.152**, on `shipped` · revx · chosen. Corrected for 16 looks that is
**0.93** (Šidák). Nothing is significant, and nothing is close.

**2. The sign tests (§2.2).** Null: the two tapes are exchangeable, so each
non-zero difference is a fair coin and the count of positives is Binomial(m,
½); the p-value is the exact two-sided tail. **Looks: 2 overall (seeded,
chosen), 6 per-window at cell level, 6 per-window at coin level.** The only
look below 0.05 is window A at cell level (p = 0.0035 on chosen parameters),
and it is discarded not by a correction but by the right test — at coin level,
where a coin's four near-duplicate cells cannot vote four times, it is
p = 0.690. No corrected claim is made from any of the twelve.

**What "arms passed" means here.** The §4.15 bar admits 4 to 13 coins per
window per arm; those counts are the `ks` inside each null, so the number that
passed and the number chance would give are in the same table rather than
beside it. Nothing in this study is promoted, added, removed or recommended on
the strength of an arm passing.

---

## Verdicts

| question | answer |
|---|---|
| Is the tape disagreement systematic or random? | **Random in direction** — 149/139 cells (p = 0.596), 12/13 coins (p = 1.000). **Weakly structured in size**: trade count, volatility and bar-level tape disagreement all correlate the way §3.14's mechanism predicts, at Spearman ≤ 0.23. |
| How big is it? | Median **4.0 points**, p95 **31 points**, max **70 points** per coin-window on seeded parameters; sign flips **9.0 %**; §4.15 verdict flips **5.9 %**. With parameters chosen per tape: median 4.8, p95 41, max 540, flips 14.9 %, verdict flips 13.2 %. |
| Does the live recommendation change? | **No.** `trend-4h` · revx · BTC/ETH/SOL/AVAX/SUI · five $20 slots is **+9.2 % / +22.5 % / +50.9 % / −7.8 %** on Kraken's tape against **+8.0 % / +20.1 % / +55.6 % / −7.8 %** on Coinbase's. Same sign everywhere, better in the bear window, and the worse window (D) is bit-identical. |
| Do the per-coin numbers change? | **Completely.** AVAX's bear window +34.1 % → +12.6 %; SUI's +1.4 % → +29.1 %; SOL's window B and BTC's window C flip sign; the leave-one-out order in window A swaps its bottom two. |
| Does §3.15 survive? | **Yes, both findings.** All-three-window clearers: **0–2 of 22** against a null of **0.66–1.43** on the eight Kraken-tape arms (0–1 against 0.33–1.50 on the Coinbase arms), best P = 0.152. A one-window pass still predicts *backwards*: cleared-A → cleared-B **0.167–0.286** against failed-A → cleared-B **0.500–0.588** (Revolut X costs), and the direction holds in **all sixteen** Kraken-tape arms. |
| Should `signal_venue` change to `revx`? | **No.** It deletes windows C and D (Revolut X has no history before 2023-08), moves the decision onto a book 100–300× thinner, re-opens the EEA/UK region trap, and cannot be tested from a study harness. |
| Should the reference be re-priced wholesale? | **No.** The two load-bearing tables are re-priced here and neither verdict moves; with no directional bias there is nothing a wholesale re-run would correct. |
| What should change? | The document, in four specific places (§5, Option C) — not the loop and not the tables' arithmetic. |

---

## What this study did NOT establish

- **It did not price the fill.** Both arms fill at their own tape's next-bar
  open ± the half-spread. The live loop decides on Kraken's candles and fills on
  **Revolut X's** book, so the true simulation reads one tape for the signal and
  the other for the price. Neither arm here does that, and neither does any
  published table. §2c measured the basis at ≤ 3 bps at the touch against a
  9 bps taker fee, so the error is likely small — but "likely small" is not
  measured, and it is the obvious next study.
- **It did not measure Revolut X's tape.** The candle endpoint is signed. Every
  statement in §5 Option B about Revolut X's history depth and book is quoted
  from §2.2 / §2.3 / §3.8, not re-measured here. §2.3 says three years of
  hourly; `backtest.ts`'s own header says one year. **Those two statements in
  this repository disagree and this study cannot settle it** — a probe with the
  key can.
- **It did not test whether Kraken's tape is *right*.** It is the tape the loop
  reads, which is the only claim made for it. Both tapes are real exchanges'
  prints and there is no third source here to arbitrate.
- **It did not re-run the rotation, momentum or 1-hour rulebooks**, the wide
  variant, or §3.9's regime gate on the second tape. Only `trend-4h` — the rule
  the live candidate runs and the rule §4.15's bar is applied with. A slow
  rule should be far less tape-sensitive (§3.14 measured the ma-200 hold at
  median 0.44 points), and a faster one far more, but neither is measured here.
- **HBAR is not in any count.** Kraken listed it on 2025-07-10, after its
  Coinbase series began, so neither of its windows can be priced on Kraken's
  tape at all. HYPE was already unscored in §3.15.
- **Kraken's missing bars are left in, not analysed.** 0–5 four-hour bars a coin
  over three years, from venue outages. They correlate with \|Δ\| at 0.20
  (seeded), which is the second-strongest predictor in the table — and with
  n = 288 and ρ = 0.20 that is a hint, not a finding.
- **The null in §4.2 bounds manufactured passes; it does not match the arms'
  trade counts.** Same caveat §3.15 stated about itself.
- **Jev is not in the backtest**, and nothing about spreads, books or fees was
  re-measured — the cost tables are `backtest.ts`'s own, unchanged.

---

## Caveats — all of them

- **n = 22.** "Not significant" means "not detectable at 22 coins", never
  "absent". Every chance column in §4.2 is a bound on manufactured passes, not
  a power calculation.
- **The 288 cells are not 288 independent observations.** A coin contributes up
  to twelve (three windows × two venues × two stop rules), and the two venues'
  cells differ only by a fee schedule. That is why the coin-level sign test is
  reported beside the cell-level one everywhere it matters, and why §2.2's
  window-A "tilt" is called pseudo-replication rather than a finding.
- **The two stop rules are not independent either**, and neither are seeded and
  chosen on the same cell. Nothing is averaged between any of them.
- **Windows C and D are partly the same bars on both arms** by construction, so
  T1's 288 cells understate what a fully independent tape swap would do: C's
  parameter choice cannot differ and D is excluded entirely.
- **Window D's identity is a fidelity check, not a result.** It says the
  harness maps timestamps correctly. It does not say the sideways year is
  tape-independent — nothing does, because no Coinbase tape exists there.
- **The Kraken tail comes from a live endpoint.** 498 4-hour bars a coin
  (2026-07-01 → 2026-09-21) come from `api.kraken.com/0/public/OHLC`, fetched
  once into a data directory so the study is reproducible. It agrees with the
  bundle to 0.0000 bps on the 222 bars they share, but a future re-fetch would
  extend it and the outputs would then differ — the data directory, not the
  endpoint, is what makes this deterministic.
- **POL's Kraken series is two pairs.** `MATICUSD` to 2025-03-31 and `POLUSD`
  after, spliced at the rename. §3.15 needed only the pre-2023 half and so used
  `MATICUSD` alone; this study needs the whole span, so the join is new here
  and is a place a silent error could hide.
- **One snapshot of spreads and books**, inherited unchanged from §3.8 / §3.12.
  The `$100k a day` test in §4 uses those numbers, so a coin sitting near the
  floor is decided by one evening's measurement.
- **Neither window contains a gap-down crash** (§3.13's caveat, still true), so
  nothing here says what either tape does when a book empties.
- **Paper decides.** Every number in this report is a backtest.

---

## Commands run

```bash
# 1. the Kraken 4-hour tape over the whole Coinbase span (built in the
#    scratchpad, not committed): w3/ext's 60-minute bundle series resampled to
#    4 h — the exact bars windows.json already uses before the splice — plus
#    Kraken's post-rename POLUSD 60-minute CSV for POL, spliced with Kraken's
#    public keyless OHLC 240 endpoint for 2026-07-01 → 2026-09-21. Bundle and
#    endpoint agree to 0.0000 bps median AND max on the 222 bars they share,
#    all 27 coins.
python3 prep_ktape.py        # → <scratch>/ktape/<COIN>-USD_4h_kraken.json + provenance.json

# 2. the study, run TWICE to separate scratch directories
deno run --allow-read --allow-write \
  supabase/functions/agents/backtest_tape.ts \
  --data    <scratch>/ohlcv \
  --ext     <scratch>/w3/ext \
  --ktape   <scratch>/ktape \
  --windows docs/agents/backtests/windows.json \
  --out     <scratch>/tapeout2          # and again with --out <scratch>/tapeout3

cmp <scratch>/tapeout2/tape.json <scratch>/tapeout3/tape.json   # byte-identical
cp  <scratch>/tapeout2/tape.json docs/agents/backtests/tape.json
# sha256 837dcce62cdfff7d06a048bd7d29db0e85381625e1e586a0d220ed198ef04af3

# 3. the gates
deno check --quiet supabase/functions/agents/backtest_tape.ts   # clean
deno test  --allow-env supabase/functions/                      # 320 passed, 0 failed
```

Each run takes about 350 s: 20,088 parameter-point evaluations across 372
coin-windows, two tapes × two stop rules. Nothing in the repository is read
except `windows.json` (for fidelity check 2) and `backtest.ts` (imported, and
hashed at both ends of the run).

## Files written

| file | what |
|---|---|
| `supabase/functions/agents/backtest_tape.ts` | the study |
| `docs/agents/backtests/tape.json` | its raw output — every cell, both arms, both stop rules, both venues, both parameter sets |
| `docs/agents/reviews/2026-09-22-tape-study.md` | this report |

Nothing else in the repository is touched. No migration, no Edge Function, no
shipped rule, no `agent_strategies` row.
