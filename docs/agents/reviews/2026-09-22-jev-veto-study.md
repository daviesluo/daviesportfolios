# Jev veto study — every published number prices the rulebook, and the account runs `rule ∧ Jev`

Script `supabase/functions/agents/backtest_jev.ts`; raw output
`docs/agents/backtests/jev.json`. It prices the gap reference §4.21 opened and
could not close: the model vetoes entries, no backtest has ever modelled that,
and `enterMin = 0.6` is a seeded parameter that gates every entry the live row
will make.

It invents no rule and moves no recommendation on its own. It changes exactly
one thing — whether the model's vote is applied to an entry — and reports what
moves, on the four walk-forward windows, never averaged.

**No wall clock is written into the output.** Re-running over the same two data
directories reproduces `jev.json` byte for byte; verified by two consecutive
runs. The run is identified instead by the SHA-256 of `backtest.ts`, which is
an input to this study.

---

## 0. The headline, before the method

| | A (bear) | B (bull) | C (strong bull) | D (sideways) | **worst window** |
|---|---|---|---|---|---|
| `rule` — every published table, go-live §4 | **+8.0 %** | +20.1 % | +55.6 % | −7.8 % | −7.8 % (D) |
| `rule ∧ Jev` — what the account actually runs | **−2.5 %** | +15.8 % | +52.4 % | −1.5 % | **−2.5 % (A)** |
| difference | **−10.5 pts** | −4.3 pts | −3.2 pts | **+6.4 pts** | +5.3 pts |

Sleeve = `trend-4h` on Revolut X, BTC/ETH/SOL/AVAX/SUI, five equal $20 slots,
seeded parameters, the shipped stop rule (8 % floor, no intra-bar trail).
Windows C and D have four members and $80, because SUI's history does not
reach them — the same as every published table.

**Two things are true at once and both have to be said.**

1. **The veto flips the sign of the bear year.** go-live §4's sentence —
   "roughly +8 % in a bad year and +20 % in a good one" — is the rulebook's
   number, and with the model in the loop the bad year is a **loss**:
   +$8.03 becomes −$2.47 on $100. That is a material error in the published
   expectation, on the window the go/no-go decision leans on hardest.
2. **By this repository's own ranking rule the veto makes the row better.**
   An arm is ranked by its WORST window (§3.11). The rulebook's worst window is
   D at −7.8 %; `rule ∧ Jev`'s worst window is A at −2.5 %. The model costs
   money in the three windows that go somewhere and saves it in the one that
   does not, which is what a filter that reduces exposure does.

Neither sentence is the whole answer, and a brief that carries only one of them
is wrong.

---

## 1. What could NOT be done, and why it matters

**This study does not call Jev.** It replays Jev's own recorded answers.

The keys live in Supabase's Edge secret store. `pg_net` can call the deployed
`agents` function from inside Postgres with the vault's `cron_secret` — that is
how the probe runs, and it was run this way at **2026-09-22 15:17 UTC**, which
confirms Jev is up on **both** transports today:

| transport | model | P(uptrend) on the probe's state | caution | latency | cost |
|---|---|---|---|---|---|
| OpenRouter | `typesafe/jev-1.13-20260917` | 0.99 | 0.07 | 607 ms | $0.0000184 |
| TypeSafe direct | `jev-1.13.0` | 0.98 | 0.10 | 751 ms | $0.0000184 |

But `?action=probe` asks its own hard-coded trivial state, and the deployed
function exposes **no action that answers an arbitrary one**. Reaching Jev with
historical states therefore needs either a secret inside this process or new
code deployed to production, and this study does neither.

**A live replay is small and should be run.** At an entry the rulebook has
already forced `trend_4h = up`, `breakout_4h = above_range`,
`momentum_30d ≠ negative` and `volatility ≠ extreme`, and a flat position
forces `unrealised`, `time_in_position` and `drawdown_from_high` to `none`. So
the model is only ever shown

> symbol (5) × trend_strength (3) × volatility (3) × momentum_30d (2) = **90 states**

— and `askJev` is a function of the state and nothing else, so 90 questions ×
5 repeats = **450 calls, about $0.008**, settles this exactly. The script
already does it: `--replay live` with `OPENROUTER_API_KEY` or
`TYPESAFE_API_KEY` in the environment and `--allow-net`. Everything below is
what can be said without it.

---

## 2. The evidence: Jev's own answers, as the loop recorded them

Every `agent_decisions` row with `rule_action = 'enter'`, read 2026-09-22.
All twelve are `provider = openrouter`, model `typesafe/jev-1.13-20260917`,
every echo correct, every state `trend_4h = up` / `position = flat`.

| trend_strength | volatility | breakout | n | P(healthy) | caution | outcome at `enterMin` 0.60 |
|---|---|---|---|---|---|---|
| weak | low | inside_range | 1 | **0.15** | 0 | **vetoed** |
| moderate | low | inside_range | 1 | 0.92 | 0 | entered |
| moderate | normal | inside_range | 2 | 0.92, 0.93 | 0 | entered |
| moderate | normal | above_range | 5 | 0.94, 0.95 ×4 | 0 | entered |
| moderate | high | above_range | 2 | **0.59, 0.59** | 1 | **vetoed** |
| strong | high | above_range | 1 | **0.61** | 1 | entered |

Four facts fall straight out of that table.

- **The answer is nearly a function of (trend_strength, volatility).** The same
  state gives the same number across symbols and across strategy rows.
- **It is repeatable to about ±0.01.** One identical state — ETH, moderate,
  normal, above_range — was answered **0.94** on `trend-4h` and **0.95** on
  `trend-1h` minutes apart.
- **`enterMin = 0.60` sits in a 0.02-wide gap.** The two high-volatility cells
  are 0.59 and 0.61. The threshold is *inside* the model's own repeatability.
  In a high-volatility regime the row's behaviour is decided by a hundredth.
- **`cautionExit = 1.75` never binds.** The recorded caution scores are 0 and
  1. `volatility = extreme` is already blocked by the rulebook, so the caution
  gate is, on this evidence, dead code on entries.

§4.21 counts fifteen signals and three vetoes (20 %). Migration `0044` has
since deleted three of those rows with their strategies, so the **surviving
record is 12 and 3 — 25 %**.

### The surface, and its two inferences

Resolution order, fixed before any window was scored: exact cell → the same
cell ignoring `breakout_4h` (the question's own text treats `above_range` and
`inside_range` identically) → the question **as written**, which for an unseen
cell says `momentum ≠ positive → no`, `trend_strength = weak → no`,
otherwise yes.

Two inferences carry almost the whole result, so each is priced on its own:

- **weak → veto.** One recorded answer (0.15, at weak / low) plus the
  question's explicit text ("Answer yes only if … `trend_strength` is moderate
  or strong"). It decides **a third of all historical entry signals.**
- **high volatility → ?** Two recorded answers at 0.59, one at 0.61. Both sides
  of the threshold are run.

---

## 3. The entry-state census — what the model is actually shown

180 entry signals on the rulebook's own path across the four windows:

| cell (strength \| volatility \| momentum) | n | share | P | from | at 0.60 |
|---|---|---|---|---|---|
| moderate \| normal \| positive | 44 | 24.4 % | 0.95 | recorded | pass |
| **weak \| normal \| positive** | **37** | **20.6 %** | 0.15 | the question as written | **veto** |
| moderate \| high \| positive | 26 | 14.4 % | 0.59 | recorded | **veto** |
| strong \| high \| positive | 21 | 11.7 % | 0.61 | recorded | pass |
| **weak \| low \| positive** | **14** | 7.8 % | 0.15 | recorded (loose) | **veto** |
| moderate \| low \| positive | 13 | 7.2 % | 0.92 | recorded (loose) | pass |
| strong \| normal \| positive | 13 | 7.2 % | 0.95 | the question as written | pass |
| **weak \| high \| positive** | **9** | 5.0 % | 0.15 | the question as written | **veto** |
| strong \| low \| positive | 3 | 1.7 % | 0.95 | the question as written | pass |

`momentum_30d = unknown` never occurs: the combined series is long enough that
30 daily closes always exist by the time a window starts.

**60 of 180 signals (33.3 %) are weak-strength, and 46 of those 60 sit on a
cell nobody has asked Jev about.** That is the single largest uncertainty in
this study and the single cheapest thing to remove.

---

## 4. Fidelity — the copy is `run`, and the rule arm is the published sleeve

| check | cells | worst difference |
|---|---|---|
| `runGated` with the shipped decider vs `backtest.ts`'s `run` | 18 (5 coins × their scored windows) | **0 / 0 / 0** on return, drawdown, trades |
| the rule arm's sleeve vs `windows.json` `perStopRule.shipped.w2_liveCandidate` | 4 windows | **0.000000** on return and drawdown |
| `enterMin = 0` vs the rule arm | 4 windows | identical by construction, and it comes out identical |

The rule arm reproduces go-live §4's table to the last digit: A +8.03 %
DD 11.28 %, B +20.08 % DD 10.47 %, C +55.64 % DD 7.35 %, D −7.81 % DD 15.52 %.
Every difference below is the model and nothing else.

---

## 5. (a) The veto rate on historical entry signals

Measured on the rulebook's OWN path — the direct analogue of the live
3-of-12 count.

| window | signals | vetoed | rate | on an inferred cell |
|---|---|---|---|---|
| A (bear) | 43 | 23 | **53.5 %** | 16 |
| B (bull) | 58 | 29 | **50.0 %** | 19 |
| C (strong bull) | 47 | 20 | **42.6 %** | 18 |
| D (sideways) | 32 | 14 | **43.8 %** | 9 |
| **all four** | **180** | **86** | **47.8 %** | 62 |

Per coin, central surface, `enterMin = 0.60`:

| coin | A | B | C | D |
|---|---|---|---|---|
| BTC | 6/14 (43 %) | 7/18 (39 %) | 5/17 (29 %) | 4/10 (40 %) |
| ETH | 6/11 (55 %) | 5/10 (50 %) | 3/8 (38 %) | 5/12 (42 %) |
| SOL | 3/7 (43 %) | 9/15 (60 %) | 5/12 (42 %) | 2/2 (100 %) |
| AVAX | 3/5 (60 %) | 5/10 (50 %) | 7/10 (70 %) | 3/8 (38 %) |
| SUI | 5/6 (83 %) | 3/5 (60 %) | — | — |

Across windows the rate is **42.6–53.5 %** on the central surface,
**55.3–62.5 %** if every high-volatility state is vetoed, and
**19.1–44.2 %** if none is.

**The historical rate is roughly twice the live one, and the reason is
composition, not disagreement.** The live record is four days of a trending
September: one of its twelve entry states was weak-strength where the
historical mix is a third. Under the historical mix, seeing ≤ 3 vetoes in 12
signals has probability **0.097**, and seeing ≤ 1 weak state in 12 has
probability **0.054**. Neither tail is small enough to call the live rate
wrong; both are small enough that **the live 20–25 % must not be projected
forward**. The live candidate's "0 of 3" is, as §4.21 says, three bars: under
the historical rate it has probability 0.14 and means nothing.

---

## 6. (b) `rule` vs `rule ∧ Jev`, all four windows, never averaged

| arm | A (bear) | B (bull) | C (strong bull) | D (sideways) | worst |
|---|---|---|---|---|---|
| `rule` | +8.0 % DD 11.3 | +20.1 % DD 10.5 | +55.6 % DD 7.3 | −7.8 % DD 15.5 | −7.8 % (D) |
| **`rule ∧ Jev` (central)** | **−2.5 %** DD 13.0 | +15.8 % DD 7.5 | +52.4 % DD 5.6 | −1.5 % DD 10.9 | **−2.5 % (A)** |
| … every high-vol state vetoed | −6.6 % DD 13.2 | +8.9 % DD 5.2 | +42.9 % DD 3.6 | +7.2 % DD 4.3 | −6.6 % (A) |
| … every high-vol state passed | +0.6 % DD 12.2 | +14.9 % DD 9.6 | +56.7 % DD 4.9 | −3.3 % DD 11.8 | −3.3 % (D) |
| *attribution:* weak veto alone | +0.6 % | +14.9 % | +56.7 % | −3.3 % | −3.3 % (D) |
| *attribution:* high-vol veto alone | +8.9 % | +20.4 % | +51.8 % | −5.9 % | −5.9 % (D) |
| *floor:* only cells Jev has literally answered | +6.4 % | +18.1 % | +52.7 % | −6.6 % | −6.6 % (D) |

(The "high-vol passed" and "weak veto alone" arms coincide at `enterMin` 0.60
by construction — both pass every high-volatility state and veto every weak
one. They would separate above 0.61.)

**The attribution is the important row.** The bear year's sign flip is the
**weak** veto: on its own it takes window A from +8.0 % to +0.6 %, and adding
the high-volatility veto takes it to −2.5 %. The high-volatility veto alone
leaves window A *better* than the rulebook (+8.9 %). So the answer to "does the
veto flip the sign of a window" is **yes, and it turns on the one inference
with a single observation behind it**. The floor arm — vetoing only where Jev
has literally answered below the threshold — keeps window A at +6.4 %.

Per coin, central arm, window A: AVAX +34.1 % → +3.6 % (−30.5 pts) and
ETH −8.0 % → −22.1 % (−14.0 pts) are the whole of it; SUI improves
(+1.4 % → +3.4 %). In window D the model helps: ETH −6.3 % → +12.3 %,
AVAX −29.5 % → −21.5 %.

Deployment falls everywhere — A 8.8 % → 6.6 %, B 14.4 % → 11.8 %,
C 17.3 % → 14.8 %, D 7.9 % → 5.5 % — and turnover with it, so the fee bill
falls too. Drawdown falls in three windows of four and rises in the bear year.

---

## 7. The null: is the model refusing the RIGHT entries?

Refusing half the entries changes the return whatever you refuse. The control
is a veto that refuses the **same share** of entry signals and picks which ones
**at random** — 400 seeded draws per window.

| window | rule | Jev | random veto: median [p05, p95] | Jev's percentile | reading |
|---|---|---|---|---|---|
| A | +8.0 % | **−2.5 %** | +5.8 % [−2.5 %, +11.9 %] | **4.8** | worse than random, at the tail |
| B | +20.1 % | +15.8 % | +18.6 % [+9.5 %, +26.8 %] | 29.2 | inside the null |
| C | +55.6 % | +52.4 % | +48.1 % [+37.2 %, +56.0 %] | 82.3 | inside the null |
| D | −7.8 % | −1.5 % | −3.5 % [−8.6 %, +1.9 %] | 76.2 | inside the null |

**Most of the damage is the refusal rate, not the choice.** A random veto at
the same rate already costs 2.2 points in A, 1.4 in B and 7.5 in C, and *gains*
4.3 in D. In three windows of four Jev's specific choices are indistinguishable
from chance.

Window A is the exception and it goes the wrong way: Jev's −2.5 % sits at the
**4.8th percentile** of its own null. **But with four windows looked at, a
5 %-tail result somewhere has probability 1 − 0.952⁴ ≈ 0.18 under the
family-wise null.** So this is *not* evidence that the model picks badly. It is
evidence that the veto is not free, and a flag on the one window where it might
be actively harmful.

---

## 8. (c) The `enterMin` surface — and a warning that is not boilerplate

Because the recorded answers take only a few distinct values, the surface is a
**step function with three steps**, and the shipped point sits between two of
them 0.02 apart.

| `enterMin` | what it refuses | A | B | C | D | **worst** |
|---|---|---|---|---|---|---|
| 0.00 | nothing (= the rulebook) | +8.0 % | +20.1 % | +55.6 % | −7.8 % | −7.8 % |
| 0.50 | weak only | +0.6 % | +14.9 % | +56.7 % | −3.3 % | −3.3 % |
| 0.55 | *(identical to 0.50)* | +0.6 % | +14.9 % | +56.7 % | −3.3 % | −3.3 % |
| **0.60 — shipped** | weak + moderate/high | **−2.5 %** | +15.8 % | +52.4 % | −1.5 % | **−2.5 %** |
| 0.65 | weak + all high | −6.6 % | +8.9 % | +42.9 % | +7.2 % | −6.6 % |
| 0.70 | *(identical to 0.65)* | −6.6 % | +8.9 % | +42.9 % | +7.2 % | −6.6 % |

**Read this as a surface, not a menu.** Two warnings, and the second is the one
that matters:

1. Choosing a threshold on the windows that scored it is in-sample
   optimisation, which §3.11 and §3.19 have already measured to be worse than
   the seeded point in every condition tested.
2. **The scan is not four honest steps.** Everything between 0.16 and 0.58
   gives one answer, everything between 0.60 and 0.61 gives another,
   everything above 0.62 a third — because the recorded probabilities are
   {0.15, 0.59, 0.61, 0.92, 0.95}. A finer scan would produce no new
   information, only more arms.

### The pre-registered out-of-sample test

Protocol, fixed in the script before the scan ran: **choose the `enterMin` with
the best WORST window over B, C and D; score that choice on window A alone**,
which the choice never saw, and require it to beat the shipped 0.60.

| | result |
|---|---|
| chosen on B, C, D | **0.65** (worst window +7.2 %) |
| its window A | **−6.6 %** |
| shipped 0.60 on window A | **−2.5 %** |
| beats the incumbent out of sample? | **No** |

**The test fails, so nothing is recommended.** `enterMin` stays at 0.60. It is
also worth noting that on the full four windows 0.60 *already* has the best
worst window of every threshold scanned — including switching the veto off —
which is a point in the incumbent's favour that costs nothing to accept.

Arms looked at: 7 sleeve arms and 6 threshold points, collapsing to **eight
distinct decision rules** × 4 windows. Nothing is adopted, so there is nothing
to correct for multiplicity; the primary comparison — the rulebook against the
rulebook ∧ the model at the threshold the live rows actually carry — is one
pre-specified pair, and its null is §7.

---

## 9. (d) Is `go-live.md` §4 materially wrong?

**Yes, on the window that decides the case, and the error has a sign.**

| §4 says | with the model in the loop | range over the high-volatility arms | error |
|---|---|---|---|
| "roughly **+8 %** in a bad year" (A) | **−2.5 %** | −6.6 % … +0.6 % | **10.5 points, sign flips** |
| "**+20 %** in a good one" (B) | **+15.8 %** | +8.9 % … +15.8 % | 4.3 points |
| C +55.6 % | +52.4 % | +42.9 % … +56.7 % | 3.2 points |
| D −7.8 %, "the only window this rule loses money in" | **−1.5 %** | −3.3 % … +7.2 % | 6.4 points **better** |
| "the sleeve's own drawdown near 11 %" | 13.0 % in A, 5.6–10.9 % elsewhere | | mixed |
| "deployed only 9–14 % of the time" (A, B) | **6.6 % (A), 11.8 % (B)** | | lower in both |

(The three high-volatility arms are not a strict bracket — the central arm
vetoes `moderate|high` at 0.59 and passes `strong|high` at 0.61, and because a
refused entry moves every bar after it, a mixed rule can land outside both
extremes, as it does in window B. They are three answers, not an interval.)

In dollars on the $100 row: the bear year's **+$8.03 becomes −$2.47**; the bull
year's +$20.08 becomes +$15.77.

The sentence to change is the expectation, not the recommendation. §4's own
framing — "good when the market moves, worst when it does not" — is what the
model *softens*: it takes the edge off the strong windows and takes the edge
off the sideways one, and on this repository's own worst-window ranking that
is an improvement (−7.8 % → −2.5 %). What is no longer true is
"roughly +8 % in a bad year". The honest replacement is **"flat to slightly
negative in a bad year and +16 % in a good one, with the sideways year's loss
roughly a fifth of what the rulebook alone would take"** — and, beside it, the
fact that the bear year's figure turns on an inference with one observation
behind it.

---

## 10. What this study cannot say

1. **It did not ask Jev.** It replayed Jev's recorded answers onto historical
   states through a pre-registered resolution rule. 46 of 180 entry signals
   (25.6 %) are vetoed on a cell the live record has never reached, resolved by
   the question's own text. 450 calls and $0.008 would remove that entirely.
2. **Jev was released 2026-09-17/18 and has no memory.** Asking today's model
   about a state computed from 2023 candles is legitimate — the state is ten
   categorical words and the model cannot see a date — but it is **not** what
   the model would have said then. Nothing here should be read as if it were.
   The model may also change: `jev-latest` is an alias, and the answers above
   are `jev-1.13-20260917`.
3. **`enterMin` sits inside the model's own noise.** 0.59 and 0.61 were both
   observed; the threshold is 0.60. Whatever the replay says about the
   high-volatility cell, it will be a measurement of a coin flip unless the
   repeats agree. That is itself worth measuring, and `--replay live` measures
   it (five repeats per state, spread reported).
4. **One tape.** Everything is the Coinbase-spliced tape every published table
   uses. `signal_venue` is `kraken`, so §3.16 says the per-window figures move
   by up to a point at sleeve level on the loop's own tape. The *difference*
   between the arms is what this study measures, and it shares a tape, but the
   levels are the published tape's levels.
5. **It says nothing about exits.** The model never advises an exit (§4.13),
   so there is nothing to price there.
