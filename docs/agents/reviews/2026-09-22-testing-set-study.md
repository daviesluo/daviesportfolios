# The testing-set study — four windows, seven rows, and the sideways year

*Run 2026-09-22 by an independent agent as
`supabase/functions/agents/backtest_testingset.ts`. Raw output:
`docs/agents/backtests/testingset.json` (361 KB, byte-identical on a
re-run). Nothing in this report changes a rule, a row or a migration; it
is a measurement and a recommendation.*

---

## 0. What was asked, and the short answers

| | question | answer |
|---|---|---|
| **S1** | does anything fix the sideways year (window D) without costing A, B and C? | **No.** 0 of 33 gate arms, under either stop rule. Everything that helps D helps by being out of the market, and the same act costs window C: Pearson(how much a gate refuses, ΔC) = **−0.85**. |
| **S2** | keep / delete / change, for each of the seven rows, on four windows | keep 4 (one of them a **change** from §3.14), delete 3. Table in §3. |
| **S3** | what is worth adding | **Nothing.** Three candidates were priced; the best of them is inside chance and the other two are already measured without a row. |
| **S4** | the final testing set and its capital | live `trend-4h·revx` $100; paper `trend-1h·revx` $40, `momentum-1d·revx` $40, `trend-4h·kraken` $100. Row capital falls $440 → $280. Fits every cap with nothing raised. |

---

## 1. The harness, and the proof it is the same arithmetic

Everything that costs money is **imported** from `backtest.ts`: `run`,
`runRotation`, `resample`, `COSTS`, `SHIPPED_STOPS`, `stopsForKind`,
`spreadOf`, and the live rulebooks in `_shared/agents_strategy.ts`.

**One copy exists**, `runGate`: `backtest_windows.ts`'s `runGated` with
`backtest_kraken2.ts`'s trade log folded in. It adds an entry gate, a mark
at every bar, an open flag and a per-round-trip log — three things `run`
cannot express — and nothing else. Its fidelity is reported as cells
compared and worst absolute difference:

| check | cells | worst \|Δreturn\| | worst \|Δdrawdown\| | worst \|Δtrades\| |
|---|---|---|---|---|
| `runGate` with `gate = null` vs `run`, **shipped** stops | 44 | **0** | **0** | **0** |
| `runGate` with `gate = null` vs `run`, **trail** stops | 44 | **0** | **0** | **0** |
| `runGate` with a gate that never refuses, **shipped** | 44 | **0** | **0** | **0** |
| `runGate` with a gate that never refuses, **trail** | 44 | **0** | **0** | **0** |

The second pair matters as much as the first: a study whose only check is
the *null branch* has not checked the branch it actually uses.

Two further checks are against published work rather than against this
study's own code:

- **`windows.json`'s live sleeve, all four windows, shipped stops:**
  A, B, C, D reproduced with **zero difference** in return, drawdown and
  return-over-drawdown. This harness reaches those numbers by a different
  route (calendar-mapped windows, a runner that also logs trades, a
  `combine` that also counts fills), so agreement is evidence about the
  arithmetic, not about running the same code twice.
- **§3.11's whole seven-row table, under the `trail` stop rule it was
  computed under: 14 cells, worst \|Δ\| = 0.0005**, which is that
  document's own rounding to three decimal places. Every row, both
  windows.

The windows are `backtest_windows.ts`'s, reused: Kraken's quarterly
OHLCVT history spliced strictly before each coin's Coinbase series, the
same overlap thresholds (median ≤ 25 bps, p95 ≤ 100 — all six coins pass,
median 1.83–5.71, p95 6.88–38.51), the same four windows, the same
180-day in-sample floor, the same exact hypergeometric null. SUI has
windows A and B only; it did not exist before 2023-05 and no source can
supply the rest.

`backtest.ts` is SHA-256'd at both ends of the run and the hash is in the
output: `31d27c7d82f8a94c1a8d71248ace8e5ded611190a77d06043460b469ccae845a`,
matching the committed file. There is no wall-clock field anywhere; two
consecutive runs produced byte-identical files.

**Both stop rules, never averaged.** `shipped` is the 8 % floor alone
(what `tick.ts` runs since §3.13); `trail` adds the 3×ATR(14) intra-bar
trail **to the trend rulebooks only** — momentum and the rotation never
carried it (§3.3a), so those three rows are identical under the two
rules, which is a fact about the rules and not a copy-paste.

---

## 2. S1 — the sideways year, attacked and not fixed

### 2.1 What was tried

Six families of **entry gate**, 33 points in all. A gate may only refuse
an entry: it never forces one and never causes an exit, so the rulebook,
the stops and the cooldown are untouched and the gate is the only thing
that varies. Every arm runs the live row's five coins at their $20 slots
on all four windows under both stop rules.

| family | points | the idea |
|---|---|---|
| `efficiency-ratio` | 6 | net move ÷ path length over 55 or 100 bars ≥ 0.15 / 0.25 / 0.35 — the most direct measure of "directionless" there is |
| `atr-breakout-margin` | 6 | the close must clear the prior 55-bar high by 0.25–2.0 × ATR(14), not by a tick |
| `trend-slope` | 6 | the 20-bar average must have risen 0–5 % over the last 30 or 60 bars |
| `volatility-band` | 6 | realised volatility inside a percentile band of its **own** last 540 bars (90 days) |
| `confirmation-bars` | 6 | the close has been above its own prior 55-bar high on each of the last 2–8 bars |
| `btc-regime` | 3 | §3.9's idea 1 — BTC's daily close above its 100/150/200-day average — applied to the whole row |

The gates bite: they refuse 26–81 entries per window out of a sleeve that
fills 64–115 times.

### 2.2 The result

**Zero of 33 arms improve window D without giving back A, B or C**, under
either stop rule. The exact null — each test's passers an independent
uniform subset of the arms, of the size that test actually produced —
expects 0.275 (shipped) and 0.538 (trail). The search produced *fewer*
than chance.

That is not because the gates do nothing. **26 of 33 improve D under
`shipped`** (23 under `trail`); of those, the median arm gives back
**18.4 points of window C** (20.5 under `trail`).

### 2.3 The mechanism, measured rather than asserted

Across the 33 arms, under `shipped` (trail in brackets):

| statistic | value |
|---|---|
| Pearson(ΔD, ΔC) | **−0.62** (−0.52) |
| Pearson(share of entries refused, ΔC) | **−0.85** (−0.88) |
| Pearson(share of entries refused, ΔD) | +0.60 (+0.43) |
| arms improving **both** D and C | **2 of 33** (1 of 33) |
| median deployment given up in window C | 5.1 points (3.7) |

The two arms that improve both are the nearly inert ones
(`volband-0-0.8`, `slope-60-0.02`). The reading is direct: **in this
rulebook, standing down in a directionless market and standing down in a
trending one are the same act**, and the correlation of −0.85 says how
tightly the bill scales with the benefit. The sideways year is not a
defect in the entry condition. It is the price of the rule.

### 2.4 The honest tension, and why it does not survive

By the repository's own ranking rule — rank by the worst window — two
arms beat the ungated live row on **both** stop rules:

| arm | A | B | C | D | worst ret/DD |
|---|---|---|---|---|---|
| ungated (the live row) | +8.0 % | +20.1 % | **+55.6 %** | −7.8 % | **−0.50** |
| `atrmargin-1.5` | +17.9 % | +14.9 % | **+7.8 %** | +6.4 % | **1.28** |
| `atrmargin-1` | +11.4 % | +16.9 % | +36.0 % | +5.6 % | **1.11** |

They are positive in all four windows. `atrmargin-1.5` costs **47.9
points of window C** and `atrmargin-1` costs 19.6 to get there.

Three things stop this being a finding:

1. **The in-sample choice does not find them.** When the family's point is
   chosen on data strictly before each window — the only version that is
   not hindsight — it picks 1.0, 1.0, 0.75 and **0.25**, and its worst
   window is **−0.59** (shipped) and **−0.46** (trail): *worse* than the
   ungated rule's −0.50 and −0.29. The point that works is not the point
   the choice lands on. That is the whole game, and it is lost.
2. **Ten of 33 arms are positive in all four windows against a null of
   7.0** (P ≥ observed = 0.015; trail: 8 against 5.4, P = 0.071) — and
   those nulls are generous, because 33 arms in six nested families are
   nowhere near independent.
3. **Window C is what pays for everything.** The live sleeve earns +55.6 %
   there against −7.8 % in D on the same $100. Buying 14 points of D with
   48 points of C is a worse book, not a better one, however the worst
   window ranks.

For completeness, a weaker bar — improve D **and** improve the worst
window — passes 24 of 33 arms. That number is not evidence of anything
and is printed in the JSON only so nobody quotes it as if it were: D *is*
the ungated rule's worst window under both stop rules, so the two tests
are almost the same test.

### 2.5 The walk-forward version, family by family

Point chosen in sample per window, then scored out of sample (Δ return
against the ungated sleeve, shipped stops):

| family | A | B | C | D | windows improved | worst ret/DD |
|---|---|---|---|---|---|---|
| `efficiency-ratio` | −0.045 | +0.015 | −0.127 | **+0.067** | 2 / 4 | −0.11 |
| `atr-breakout-margin` | +0.033 | −0.032 | −0.171 | −0.018 | 1 / 4 | −0.59 |
| `trend-slope` | +0.010 | −0.088 | −0.046 | **+0.015** | 2 / 4 | −0.45 |
| `volatility-band` | +0.000 | −0.091 | +0.024 | **+0.032** | 2 / 4 | −0.36 |
| `confirmation-bars` | −0.022 | −0.029 | −0.206 | **+0.122** | 1 / 4 | **+0.69** |
| `btc-regime` | +0.003 | −0.023 | +0.014 | −0.038 | 2 / 4 | −0.72 |

Four of six improve D. **None leaves A, B and C alone.** The one family
whose worst window beats the baseline, `confirmation-bars`, does it by
paying 20.6 points of window C.

§3.9's BTC-regime gate — the repository's one written-down rule candidate
before §3.15 killed it at coin level — **makes the sideways year worse**
at sleeve level: median ΔD −5.5 points, 0 of 3 points improve D, on both
stop rules. That closes it at row level too.

### 2.6 S1's verdict

**Nothing fixes the sideways year.** The honest statement to carry
forward is stronger than "we did not find one": the search measured *why*
there is nothing to find. The live rule's window-D loss and its
window-C gain are produced by the same entries, and no filter tested here
separates them.

One number belongs in the go-live brief beside this. In window D, **4 %
of the live rulebook's own 27-point parameter grid is positive** — one
point in twenty-seven — against 100 %, 100 % and 100 % in A, B and C. The
sideways year is not a piece of bad luck that fell on the seeded
parameters. The whole neighbourhood loses.

---

## 3. S2 — the seven rows, re-priced on four windows

Every row at its own capital, its own coins and its own bar, seeded
parameters, over the same calendar windows as the live row. Sleeves
combine at fixed slots capped by `max_order_usd`, the way a live row
earns. §3.14 measured that no row's optimisation earns its search, so
only the seeded point is priced.

### 3.1 The table (shipped stops; `trail` in `testingset.json`)

| row | A (bear) | B (bull) | C (strong bull) | D (sideways) | worst ret/DD | plateau A/B/C/D | fills / 90 d |
|---|---|---|---|---|---|---|---|
| `trend-4h·revx` **(live)** | +8.0 % / DD 11.3 % | +20.1 % / 10.5 % | **+55.6 %** / 7.3 % | −7.8 % / 15.5 % | −0.50 | 100/100/100/**4 %** | 14.6–26.8 |
| `trend-1h·revx` | +3.8 % / 18.8 % | +10.3 % / 16.9 % | +39.7 % / 6.8 % | **+16.2 %** / 5.6 % | **+0.20** | 63/67/100/**96 %** | **31.7–56.1** |
| `momentum-1d·revx` | −8.1 % / **41.0 %** | +62.4 % / 17.1 % | **+106.2 %** / 10.0 % | −7.2 % / 27.9 % | −0.26 | 25/100/100/**0 %** | 17.8–29.0 |
| `momentum-1d·kraken` | −20.1 % / **51.3 %** | +53.6 % / 19.4 % | +98.8 % / 11.6 % | −18.3 % / 31.6 % | −0.58 | 0/100/100/0 % | 17.8–29.0 |
| `trend-4h·kraken` | +8.6 % / 14.1 % | +13.6 % / 11.8 % | +48.9 % / 8.3 % | −12.4 % / 18.9 % | −0.66 | 85/100/100/0 % | 14.6–26.8 |
| `rotation-1d·revx` | −13.3 % / **37.0 %** | **+128.5 %** / 22.5 % | +82.1 % / 27.2 % | **+9.0 %** / 26.5 % | −0.36 | 0/100/100/22 % | 15.5–24.9 |
| `rotation-1w·kraken` | −9.8 % / **41.5 %** | +77.0 % / 26.8 % | +64.2 % / 32.3 % | −9.6 % / **36.7 %** | −0.26 | 0/93/100/11 % | 11.1–20.3 |

Bold drawdowns are at or over §4.15's 35 % limit. "Plateau" is the share
of that row's **own** parameter grid positive out of sample in that
window (27 points for the trend rows, 8 for momentum, 27 for the
rotations).

### 3.2 The correlation matrix, read properly

Maximum over the four windows:

| row | with any other row | with any **non-twin** row | its twin |
|---|---|---|---|
| `trend-4h·revx` | 0.9995 | 0.632 | `trend-4h·kraken` |
| `trend-1h·revx` | **0.630** | **0.630** | — none |
| `momentum-1d·revx` | 0.9998 | 0.854 | `momentum-1d·kraken` |
| `momentum-1d·kraken` | 0.9998 | 0.855 | `momentum-1d·revx` |
| `trend-4h·kraken` | 0.9995 | 0.625 | `trend-4h·revx` |
| `rotation-1d·revx` | 0.9717 | 0.855 | `rotation-1w·kraken` |
| `rotation-1w·kraken` | 0.9717 | 0.824 | `rotation-1d·revx` |

Every venue twin is 0.90–1.00 correlated with its partner in every
window. Against the **live row** specifically: `trend-1h` 0.38–0.55,
`momentum-1d` 0.46–0.63, `rotation-1d` 0.31–0.46. `trend-1h·revx` is the
only row in the set with no near-duplicate anywhere.

### 3.3 Cost sensitivity — the number that decides one of the verdicts

Every spread in `COSTS` is **one snapshot** (§3.7's own caveat), and a row
that turns over 60 times a year pays it 60 times. First-order effect of
the assumed cost being wrong by 5 and 10 bps per fill (window A, shipped):

| row | as priced | +5 bps/fill | +10 bps/fill |
|---|---|---|---|
| `trend-4h·revx` | +8.0 % | +7.2 % | **+6.3 %** |
| `trend-1h·revx` | +3.8 % | +0.6 % | **−2.6 %** |
| `momentum-1d·revx` | −8.1 % | −10.1 % | −12.1 % |
| `rotation-1d·revx` | −13.3 % | −16.4 % | −19.6 % |

The live row keeps three quarters of window A if the cost assumption is
wrong by 10 bps a fill. `trend-1h` loses all of it.

### 3.4 The chance control, before any row is called a discovery

Seven rows, four windows. Nothing was *chosen* here — these are the rows
that already exist — but reading "this row cleared all four" as a finding
still needs the control:

| test | rows passing per window (A/B/C/D) | rows passing all four | null expects | P(≥ observed) |
|---|---|---|---|---|
| positive out of sample, shipped | 3 / 7 / 7 / 2 | **1** (`trend-1h·revx`) | 0.857 | 0.714 |
| positive out of sample, trail | 1 / 7 / 7 / 2 | **1** (`trend-1h·revx`) | 0.286 | 0.286 |
| plateau ≥ 50 %, shipped | 3 / 7 / 7 / 1 | **1** (`trend-1h·revx`) | 0.429 | 0.429 |
| plateau ≥ 50 %, trail | 3 / 7 / 7 / 1 | **1** (`trend-1h·revx`) | 0.429 | 0.429 |

**One row clearing every window is exactly what chance gives.** That
governs everything said about `trend-1h` below.

### 3.5 The verdicts

#### `trend-4h·revx` — **KEEP, unchanged. It is the live row.**

+8.0 / +20.1 / +55.6 / −7.8, no window over the drawdown limit, the least
cost-sensitive row in the set. The **change to the record** is not to the
row but to what is written beside it: window D's plateau is **4 %**, and
S1 says no entry filter repairs it. The go-live brief should carry the
four-window row and that 4 %.

#### `trend-1h·revx` — **CHANGE. §3.14 said delete; keep it, as a measurement row, and stop reading its return either way.**

What is new on four windows: it is **positive in all four under both stop
rules** (+3.8 / +10.3 / +39.7 / +16.2 shipped; +0.5 / +4.0 / +13.3 / +9.4
trail), it has **≥ 50 % of its grid positive in all four** (63/67/100/96
and 52/52/67/100) — the only row of seven for which either is true — it
is the best row in the sideways year, and at **0.63** it is the least
correlated row in the set with a twin-free P&L.

§3.14's stated reason for deleting it was "the worst row on the worse
window… a row that earns nothing". On four windows it is neither: it does
not lose in any window and it is not the worst row in any.

What has **not** changed, and why the return is still not the argument:

- One row of seven positive in all four is what a null gives
  (P = 0.29–0.71, §3.4 above). This is not an edge that has been detected.
- **Its window-A edge is inside the error bar of the one input the study
  is least sure of.** +5 bps a fill takes A from +3.8 % to +0.6 %; +10 bps
  to −2.6 %. It fills 32–56 times per 90 days and turns over 62–76× a
  year, so it pays the spread assumption more often than any other row.
- Its own break-even arithmetic is the least comfortable in the set: a
  0.83-day median hold against a 20.1 bps round trip needs an **88 %-a-year**
  drift to pay for itself (the live row needs 23 %).

So it is kept for the reason it was seeded — **feedback speed** — with a
number: **31.7–56.1 fills per 90 days against the live row's 14.6–26.8**,
ten fills in **16–28 days** against 34–62. With only three paper rows
left, that matters more, not less. And there is a neat closing symmetry
worth recording: the row whose return is most fragile to the spread
assumption is also the row that can **measure** the spread assumption
fastest.

#### `momentum-1d·revx` — **KEEP, do not optimise (§3.14 confirmed).**

−8.1 / +62.4 / +106.2 / −7.2. The set's biggest bull contributor by a
distance, correlated 0.46–0.63 with the live row, so it is genuinely a
second rulebook rather than a restatement. Its price is written down
plainly: **41.0 % drawdown in window A, over the 35 % limit**, and a
**0 % plateau in window D** (not one of its eight grid points is positive
in the sideways year). Those two numbers are why it is a paper row and
can never be the live one.

#### `momentum-1d·kraken` — **DELETE (§3.14 confirmed).**

0.9991–0.9998 correlated with its twin in every window, and worse in all
four (−12.0, −8.8, −7.4, −11.1 points). Drawdown 51.3 % in A. Its
fill-measuring job is the *same signal* as its twin's and is already done
better by `trend-4h·kraken`, on the rulebook that might actually go live.

#### `trend-4h·kraken` — **KEEP, for the fill measurement only (§3.14 confirmed).**

0.9579–0.9995 correlated with the live row; its return is a fill-path
accident (+0.6 point ahead of its twin in A, 6.5 behind in B, 6.7 behind
in C, 4.6 behind in D). **Stated job:** whether a post-only order at the
touch fills on Kraken, which no backtest here can see — §3.13's model says
a resting bid fills with a median delay of zero hours on every coin in
every window, and that is the model's limit rather than a measurement.
**Measurement rate: 14.6–26.8 fills per 90 days; ten fills in 34–62 days.**

#### `rotation-1d·revx` — **DELETE (§3.14 confirmed, for a different reason).**

On four windows it is positive in three (−13.3 / +128.5 / +82.1 / **+9.0**)
and is one of only two rows positive in the sideways year, so §3.14's
stated reason — "fails the bar on both windows" — is not what four
windows say. The reason that *does* survive is the drawdown and the
plateau:

- **37.0 % in window A at row level**, over the 35 % limit;
- at rulebook level, **every one of §3.4's six variants, on both venues,
  breaches 35 % in at least two of the four windows** (the shipped
  variant: B 41.3 %, C 50.9 %), and **every variant is negative in window
  A on both venues**;
- plateau 0 % in A and 22 % in D;
- 0.86 correlated with the momentum rows at its worst, 0.97 with its own
  twin;
- and §3.4's own finding stands: the loop's 8 % floor makes this rulebook
  *worse* on five variants of six, so the row the loop runs is not the
  rule these numbers flatter.

A rule whose good years need a 41–51 % drawdown cannot be sized inside a
$100 book with a $5 daily loss limit. **What is lost by deleting it** is
its +9.0 % in window D — the one thing in the set that was positive there
besides `trend-1h` — and that is worth one line in the record rather than
a row.

#### `rotation-1w·kraken` — **DELETE (§3.14 confirmed).**

0.9047–0.9717 correlated with the row above, worse in all four windows,
**over the drawdown limit in two** (A 41.5 %, D 36.7 %), plateau 0/93/100/11,
and the lowest measurement rate in the set (11.1–20.3 fills per 90 days,
ten fills in 44–81 days) for a job `trend-4h·kraken` already does faster
on the live rulebook.

---

## 4. S3 — what is worth adding: **nothing**

Three candidates were priced properly. None becomes a row.

### 4.1 `trend-4h-wide` at sleeve level — the best-looking candidate, and inside chance

§3.15 killed it at coin level on window D (AVAX −35.0 %, 37 % drawdown).
At **sleeve level** the five coins cancel what the individual coins cannot
agree on, and it looks much better. The eight-point grid (slow 200/300 ×
breakout 100/200 × 4/6 × ATR) on the live row's coins and slots:

| | A | B | C | D | grid positive in D |
|---|---|---|---|---|---|
| seeded rule (baseline), shipped | +8.0 % | +20.1 % | +55.6 % | −7.8 % | 4 % |
| wide, point **chosen in sample**, shipped | **+12.8 %** | **+37.7 %** | **+71.8 %** | −5.4 % | **0 %** |
| seeded rule, trail | −0.3 % | +12.6 % | +47.1 % | −3.2 % | 0 % |
| wide, point **chosen in sample**, trail | **+14.2 %** | **+33.0 %** | **+47.6 %** | **+0.1 %** | 12.5 % |

The in-sample choice lands on only **two distinct points across four
windows** (slow 200 / breakout 100, ATR 4 or 6), which is a plateau in
itself, and the grid is 100 % positive in A, B and C.

**The chance control, which is the line that decides it: 2 of the 8
points beat the seeded sleeve in every window under `shipped`, against a
null of 1.0 (P = 0.214); 1 of 8 under `trail`, against 0.375 (P = 0.375).
Its return case sits inside chance**, and the null used is generous —
eight points sharing two parameters are far from independent, so a null
built this way *understates* how easily a grid sweeps.

It also **does not fix the sideways year**: 0 of 8 points are positive in
window D under `shipped`, 1 of 8 under `trail`.

What paper would measure that a backtest cannot, if it were ever run: a
100-bar breakout with a **7.67-day median hold** (§3.14) means orders
resting for days and a wide trail across weekends, and on some coins two
entries a year — none of which hourly candles can show. That is a real
measurement job. It is not worth a seventh row today, and the condition
for revisiting it should be a window neither it nor the shipped rule has
seen, not another pass over these four.

### 4.2 Maker execution — a positive number that a backtest is not allowed to claim

The same rule, coins and stops with Revolut X's 0 % maker fee instead of
the 9 bps taker (a cost schedule `run` takes directly — no new rule, no
code change):

| | A | B | C | D |
|---|---|---|---|---|
| shipped, Δ vs the live row | +1.5 pt | +2.1 pt | +2.1 pt | +1.4 pt |
| trail, Δ vs the live row | +1.8 pt | +2.4 pt | +2.2 pt | +1.5 pt |

Positive on all four windows under both rules, and consistent with
§3.13's decomposition (+0.9 / +1.2 points from the fee itself). **It
still cannot be claimed**: the whole premise is that a resting bid fills
at the touch with no adverse selection, §3.13's break-even is 10–20 bps
through the bid, and +10 bps a fill is worth about 1.7 points to this row
— the same size as the gain. **Migration `0042`'s `agent_maker_probes`
already measures exactly this on the real UK book, at no cost and without
resting anything.** The answer here is to read that table when it has
data, not to add a row.

### 4.3 S1's gates — nothing

0 of 33 dominate under either stop rule (§2). The one family that looks
good by the worst-window ranking is not the family the in-sample choice
finds.

### 4.4 So: nothing is added

The evidence points at it and it is a legitimate result. Five separate
searches in this repository now agree — §3.5, §3.6, §3.9, §3.15 and this
one — that a new *rule* is not where the remaining value is. The set gets
smaller, not larger.

---

## 5. S4 — the final testing set

### 5.1 The set

| row | venue | coins | capital | slot | mode | why it exists |
|---|---|---|---|---|---|---|
| `trend-4h` | Revolut X | BTC, ETH, SOL, AVAX, SUI | **$100** | 5 × $20 | **live** (Davies' switch) | the go-live brief's row: +8.0 / +20.1 / +55.6 / −7.8 on four windows, no window over the drawdown limit, the least cost-sensitive row in the set |
| `trend-4h-kraken` | Kraken | BTC, ETH, SOL, AVAX, SUI | $100 | 5 × $20 | paper | the only row measuring the LIVE rulebook's post-only fills on the second venue — 14.6–26.8 fills per 90 days; its return is a fill-path accident and is not read |
| `momentum-1d` | Revolut X | BTC, ETH, SOL | $40 | 3 × $13.33 | paper | the second rulebook: 0.46–0.63 with the live row, +62.4 % and +106.2 % in the two bull windows, held in paper by its 41.0 % bear drawdown |
| `trend-1h` | Revolut X | BTC, ETH, SOL | $40 | 3 × $13.33 | paper | feedback speed — 31.7–56.1 fills per 90 days against the live row's 14.6–26.8, ten fills in 16–28 days — and the only row in the set with no near-duplicate (0.63); its return is inside chance and inside the spread error bar, and is not read as evidence |

**Deleted:**

| row | capital freed | why |
|---|---|---|
| `momentum-1d-kraken` | $40 | 0.9991–0.9998 with its twin, worse in all four windows, 51.3 % drawdown in A; its fill job is the same signal its twin already produces and `trend-4h-kraken` does better |
| `rotation-1d` | $60 | 37.0 % drawdown in window A at row level; every one of six variants on both venues breaches 35 % in ≥ 2 of 4 windows and is negative in A; plateau 0 % / 22 %; the loop's own floor makes the rulebook worse on five variants of six (§3.4) |
| `rotation-1w-kraken` | $60 | 0.9047–0.9717 with the row above, worse in all four windows, over the drawdown limit in two, and the slowest measurement rate in the set (11.1–20.3 fills per 90 days) |

### 5.2 The capital, against the caps

| | before | after |
|---|---|---|
| row capital, all rows | $440 | **$280** |
| deployable after the $20 order cap | $400 | **$280** |
| Revolut X **live** exposure | — | **$100** (`max_exposure_usd` = 100 — exactly at the cap) |
| Revolut X **paper** exposure | $220 | **$80** (`paper_exposure_usd` = 300) |
| Kraken **paper** exposure | $180 | **$100** (300) |
| largest single order | $20 | **$20** (`max_order_usd` = 20) |

**Nothing has to move.** Live exposure sits exactly at its $100 cap,
which is the arrangement §3.11 and `go-live.md` already recommend; both
paper books fall well under $300; no order exceeds $20.

### 5.3 The set, priced

The four rows' daily dollar P&L combined at their deployable capital
(shipped stops; windows C and D carry $240 because SUI has no history
there):

| set | A | B | C | D | worst ret/DD |
|---|---|---|---|---|---|
| **the final set** (all four rows) | **+5.3 %** / DD 15.7 % | **+22.4 %** / 9.8 % | **+59.2 %** / 5.5 % | **−5.3 %** / 10.6 % | −0.50 |
| its paper half only (3 rows, $180) | +3.8 % / 19.5 % | +23.7 % / 9.4 % | +60.9 % / 6.2 % | −4.0 % / 10.7 % | −0.37 |
| the live row alone ($100) | +8.0 % | +20.1 % | +55.6 % | −7.8 % / 15.5 % | −0.50 |
| the shipped seven today ($400) | −0.6 % | +41.6 % | +66.7 % | −5.6 % | −0.34 |

Read these as *information*, not as a portfolio recommendation: the live
row is the only one holding money, and paper rows do not share its cap.
The row worth noticing is the last: the shipped seven earn more in the
bull windows and **less in the bear one**, because the two rotation rows
and the Kraken momentum twin are what lose window A.

---

## 6. What this study did NOT establish

Stated as carefully as the findings.

1. **Window D is not a fourth independent draw.** Its scored year sits
   inside window C's in-sample, which is what a rolling walk-forward
   always does. It is a fourth *check* on the same rules, not a fourth
   draw, and every "all four windows" count in this report inherits that.
2. **The tape question is untouched.** §3.14 measured a median 2.5-point
   and maximum 68-point difference between Kraken's and Coinbase's tapes
   at coin level, and `signal_venue` is `kraken` while every table here
   reads the Coinbase series (spliced with Kraken's *older* history for C
   and D). At sleeve level §3.14 put that at about a point; at coin level
   nothing is robust. Re-pricing this study on Kraken's tape is a separate
   study and it was not done.
3. **No coin question was re-opened.** The live row's five coins are
   §3.11's and §3.15's; window D's per-coin split is recorded
   (AVAX −29.5 %, ETH −6.3 %, SOL −8.3 %, BTC +14.6 %) but no
   leave-one-out was run here, and §4.15's rule stands: the sleeve number
   governs money, a member's own pass does not.
4. **The gates were tested only on `trend-4h`.** Whether an efficiency
   ratio or an ATR margin would do something different on `momentum-1d` or
   `trend-1h` is not answered. It was left out deliberately — the sideways
   year is the *live* rule's problem — but it is a gap.
5. **Gates were tested only as entry filters.** A rule that also *exits*
   on a choppiness reading, or that sizes down instead of standing down,
   is a different rule and was not built. S1's finding is about entry
   filters, which is what the brief asked for and is not the whole space.
6. **The cost sensitivity is first-order.** It charges each fill its slot
   times the extra basis points and ignores compounding. It is a robustness
   reading, not a re-run at a different fee.
7. **The spreads themselves were not re-measured.** They are §2.2's,
   §3.7's and §3.12's snapshots, and §3.3's caveat applies to every row —
   most sharply to `trend-1h`, as §3.3 above shows.
8. **The model is not in any backtest.** Jev's contribution is measured
   live, in paper, and nothing here knows what it would have vetoed.
9. **Neither `trend-1h`'s nor the rotation's live fills were considered** —
   the paper record since 2026-09-20 is days old and was not read. Every
   number here is backtest, and the paper record is what settles the
   things a backtest cannot see.
10. **SUI has two windows, not four**, so every C and D figure for the
    live row and its Kraken twin is a four-coin sleeve at $80, not five at
    $100. That is stated in the JSON per window and is not a rounding
    detail: SUI is the sleeve's worst member in window A and its absence
    flatters C and D by an unknown amount.
11. **`agent_risk`'s daily loss limit was not simulated.** Every figure
    assumes the $5 kill switch never fired. In window A the final set's
    worst day is inside it, but a limit that blocks new risk for the rest
    of a day is not in any of these numbers.
12. **Deleting a row deletes a record, not just a number.** The rotation
    is the set's only cross-sectional rule, and after this recommendation
    the repository runs no cross-sectional rule at all. That is a real
    loss of coverage, and it is a choice, not a measurement.

---

## 7. Reproducing this

```
deno run --allow-read --allow-write \
  supabase/functions/agents/backtest_testingset.ts \
  --data <dir with BTC-USD_1h_3y.json …> \
  --ext  <dir with BTC-USD_1h_kraken.json …> \
  --out  docs/agents/backtests
```

Writes `testingset.json` and nothing else. No wall-clock field; two
consecutive runs are byte-identical. `backtest.ts` is hashed at both ends
of the run and a run that straddles an edit throws. Runtime ≈ 50 s.

`npx deno check --quiet supabase/functions/agents/backtest_testingset.ts`
passes; `npx deno test --allow-env supabase/functions/` is **320 passed /
0 failed**, unchanged by this study (it adds no test and no importable
helper to any deployed function).
