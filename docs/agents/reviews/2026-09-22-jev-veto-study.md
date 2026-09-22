# Jev veto study — the model asked, and the three ways the live row can run

Script `supabase/functions/agents/backtest_jev.ts`, run as `--replay measured`;
output `docs/agents/backtests/jev.json`; the model's own replies
`docs/agents/backtests/jev_answers.json`. This replaces the afternoon study of
the same name (commit `944c36d`), which mapped twelve recorded answers onto
history and ASSUMED the rest from the question's wording; §2 re-derives that
study from its own code and says what survives.

Every backtest in this repository prices the RULEBOOK. The account runs the
rulebook AND a decision model that can veto an entry (`combineDecision`:
P(healthy) < `enterMin` 0.60, caution ≥ 1.75, or no answer). This study prices
the veto on the REAL model's answers, for the three configurations the go-live
decision has to choose between, on four windows under the four evaluations
§3.19 requires of a change, each against a random veto of the same size.

No wall clock is written into the output: two runs over the same inputs wrote
byte-identical `jev.json` (sha256 `0e03c844c54a96ef…`).

---

## 0. The answer

Primary evaluation — the Coinbase-spliced tape and the shipped stop (the 8 %
floor), which is what every published number uses. Sleeve = `trend-4h` on
Revolut X, BTC / ETH / SOL / AVAX / SUI, five equal $20 slots, seeded
parameters; windows C and D have four members and $80 because SUI's history
does not reach them. (ii) is the mean of 2,000 seeded draws; each null is 1,000.

| | A (bear) | B (bull) | C (strong bull) | D (sideways) | worst window |
|---|---|---|---|---|---|
| **(i)** rule, model in shadow | **+8.0 %** | +20.1 % | +55.6 % | −7.8 % | −7.8 % (D) |
| **(ii)** rule ∧ model, as it runs | **−1.0 %** | +14.6 % | +55.7 % | −2.3 % | −2.3 % (D) |
| (ii) 5th … 95th percentile | −4.4 … +2.3 % | +10.2 … +18.2 % | +52.5 … +58.5 % | −5.1 … +1.0 % | −5.1 … −0.2 % per draw |
| (ii) share of draws that LOSE money | 66 % | 0 % | 0 % | 88 % | |
| **(iii)** rule + the weak-trend clause as code | +0.6 % | +14.9 % | +56.7 % | −3.3 % | −3.3 % (D) |
| random veto of equal size ≥ (ii), share of draws | 0.928 | 0.745 | 0.176 | 0.347 | **0.391** |
| random veto of equal size ≥ (iii), share of draws | 0.934 | 0.791 | 0.152 | 0.333 | **0.329** |

The bar (§3.11, §3.19): a change must beat the incumbent — here (i), the
configuration every published number prices — on its WORST window in all four
evaluations, and beat a random veto of the same size on that worst window (the
null does as well or better in at most 5 % of draws).

| evaluation | (i) worst | (ii) worst | beats (i)? | null ≥ (ii) | (iii) worst | beats (i)? | null ≥ (iii) |
|---|---|---|---|---|---|---|---|
| shipped stop · Coinbase tape | −7.8 % (D) | −2.3 % (D) | yes | 0.391 | −3.3 % (D) | yes | 0.329 |
| shipped stop · Kraken tape | −7.8 % (D) | −2.3 % (D) | yes | 0.301 | −3.3 % (D) | yes | 0.323 |
| 3×ATR trail · Coinbase tape | −3.2 % (D) | −6.6 % (A) | **no** | 0.813 | −5.8 % (A) | **no** | 0.803 |
| 3×ATR trail · Kraken tape | −3.2 % (D) | −0.7 % (A) | yes | 0.428 | −0.7 % (D) | yes | 0.306 |

Judged on return over drawdown instead (the set study's metric) the verdict is the same: the null does as well or better on the worst window in 0.276–0.800 of draws. **Neither (ii) nor (iii) passes — on either metric.**

1. **The worst-window gain is the refusal rate, not the model.** Both arms lift the sideways year (D), the rulebook's worst, in 3 evaluations of four. But a veto that refuses the same NUMBER of entries at random does as well or better on the worst window in 30 %–43 % of draws for (ii) and 31 %–33 % for (iii). Refusing 25 %–30 % of the entries in the one year the rule loses money loses less money; the worst window shows that and nothing more. On the fourth evaluation (3×ATR trail · Coinbase tape) both arms make the BEAR year the new worst window and lose to the incumbent outright.
2. **In the bear year the selection is worse than random.** Window A, primary: the model as it runs takes the sleeve from +8.0 % to a mean of −1.0 %, a loss in 66 % of draws; a random veto refusing the same number of entries does as well or better in 92.8 % of draws, and against the weak-trend clause alone in 93.4 %. That is short of the 5 % tail, so it is not proof the model chooses badly — but it is the opposite of evidence that it chooses well, on the window the go/no-go leans on hardest. The one window where both arms beat most random vetoes is C, the strong bull (P = 0.152–0.275); no window reaches the tail on any evaluation (all 32 cells: 0.152–0.934).
3. **(ii) is (iii) plus a coin flip, and the coin flip is noise.** On a historical entry the model's answer is deterministic everywhere except the high-volatility states, where the real model answered 0.55–0.64 against a threshold of 0.60 and vetoed 28 % (moderate trend) and 48 % (strong) of calls. Layered on (iii), that coin flip is indistinguishable from refusing the same number of (iii)'s entries at random (P = 0.40–0.84 in every window and evaluation).

**Recommendation: run (i) — the model in shadow — on the live row AND on its
paper control** (§9, with the labels). One reason has nothing to do with
return: with both rows gating, the model's call-to-call noise alone leaves 7 %–10 % of the live row's entries with no same-bar entry on the control, which defeats the one thing the control exists to measure (§8).

---

## 1. The measurement — saved, and cross-checked

The raw replies lived in Postgres `net._http_response`, ids **26655** and
**26656**, a table pruned after about six hours. They were extracted with
`execute_sql` and written to `docs/agents/backtests/jev_answers.json`:

| | |
|---|---|
| requested | 2026-09-22 18:29:05 UTC; answered 18:29:16–17 UTC |
| endpoint | `POST agents?action=jev` — read-only: asks the model, places nothing, writes nothing |
| transport · model | openrouter · `typesafe/jev-1.13-20260917`, provider `openrouter` on all 450 replies |
| calls | 225 + 225 = 450 (90 states × 5 repeats), $0.0126 |
| failures | 0 missing answers, 0 echo failures, 0 reply errors |
| forced fields | trend_4h up, breakout_4h above_range, position flat, unrealised none, time_in_position none, drawdown_from_high none — identical in all 90 states |

**Integrity.** One SQL query rendered the 90 states as one canonical line each
(request id, result index, the four free words, the five P values and five
caution values in call order, whether every echo was right) and took the md5 of
the whole: `27e554e8c50da0219f3180f8e4f86d38`. The file was generated from that
text, and the same md5 recomputed from the written file's rows matches. The
file carries its provenance (request ids, times, cost, transport, model,
repeats) and the canonical form, so the check can be re-run.

**Cross-check against the table this study was given — every row reproduces:**

| strength \| vol \| momentum | P(healthy) mean [min–max] | vetoed at 0.60 | caution |
|---|---|---|---|
| weak \| low \| positive | 0.128 [0.12–0.14] | 25/25 | 0 |
| weak \| normal \| positive | 0.116 [0.10–0.13] | 25/25 | 0 |
| weak \| high \| positive | 0.073 [0.06–0.08] | 25/25 | 1 |
| moderate \| low \| positive | 0.940 [0.93–0.95] | 0/25 | 0 |
| moderate \| normal \| positive | 0.950 [0.94–0.96] | 0/25 | 0 |
| **moderate \| high \| positive** | **0.600 [0.55–0.62]** | **7/25** | 1 |
| strong \| low \| positive | 0.962 [0.96–0.97] | 0/25 | 0 |
| strong \| normal \| positive | 0.970 [0.97–0.97] | 0/25 | 0 |
| **strong \| high \| positive** | **0.598 [0.56–0.64]** | **12/25** | 1–1.01 |
| any \| any \| unknown | per-coin state means 0.038–0.210; single replies **0.03–0.23** | 225/225 | 0, or 1–1.01 at high volatility |

Per coin, the high-volatility vetoes reproduce exactly — moderate|high AVAX 0/5, BTC 4/5, ETH 0/5, SOL 1/5, SUI 2/5; strong|high AVAX 1/5, BTC 4/5, ETH 2/5, SOL 2/5, SUI 3/5 — and so does the flip the brief quotes (ETH strong|high, in call order 0.58, 0.63, 0.58, 0.61, 0.64). Caution never exceeds **1.01**, so the 1.75 caution veto cannot fire on an entry. **One refinement**: "0.04–0.21" for unknown momentum is the range of the per-coin state MEANS (0.038–0.210); single replies run 0.03–0.23, which puts the lower edge of the deterministic band at **0.23**, not 0.21 (§5). It moves nothing on history, where momentum is never unknown.

---

## 2. The earlier study — what reproduced, and what did not

**Reproduced exactly.**

- Its script, re-run unchanged over the same two data directories, rewrote the committed `jev.json` byte for byte (sha256 `2e3ec025…`), and after this study's changes `--replay recorded` still does.
- Its `rule` row is the published live sleeve to the last digit — A +8.03 % (DD 11.28 %), B +20.08 % (DD 10.47 %), C +55.64 % (DD 7.35 %), D −7.81 % (DD 15.52 %) — and this study's rule arm equals `set2.json`'s incumbent on all FOUR evaluations, every window, return and drawdown (worst |Δ| = 0).
- Its `entryStateCensus`: 180 historical entry signals, the same per cell and per window (A 43, B 58, C 47, D 32), re-counted by its own code. An independent count of what `tick.ts` would actually show the model — flat, the rulebook says enter, and NOT inside the re-entry cooldown, where the tick holds before asking — is also 180: no signal falls in a cooldown. On every coin-window that count equals the rulebook's entries and ⌈`run`'s trades / 2⌉, which ties the census to `run` itself. Momentum is `unknown` on 0 of 180.
- Its null and its central arm, re-run from its own code with its own seeds, reproduce to the digit: per-signal refusal 0.535 / 0.500 / 0.426 / 0.438, null means +5.51 / +18.36 / +47.47 / −3.57 %, central arm −2.47 / +15.77 / +52.41 / −1.45 %, percentiles 0.048 / 0.292 / 0.823 / 0.762.

**Did not survive measurement.**

| the earlier study | measured |
|---|---|
| moderate\|high: P = 0.59 from two recorded answers → **always vetoed** (26 of 180 signals) | vetoed on **28 %** of calls (7 of 25); per coin 0 %–80 % |
| strong\|high: P = 0.61 from one recorded answer → **never vetoed** (21 signals) | vetoed on **48 %** of calls (12 of 25); per coin 20 %–80 % |
| weak (60 signals, 46 on cells never asked): assumed 0.15 → vetoed | 0.06–0.14 on every call → vetoed. **The assumption was right in outcome.** |
| calm states: 0.92–0.95 → passed | 0.93–0.97 → passed |
| veto rate on historical entry signals **47.8 %** (86 of 180) | **40.0 %** expected (72.0 of 180) |
| headline A −2.5 %, B +15.8 %, C +52.4 %, D −1.5 % | (ii) mean A **−1.0 %**, B **+14.6 %**, C **+55.7 %**, D **−2.3 %** |

So the earlier study had the weak-trend veto right and the high-volatility veto
wrong in both directions: it refused the moderate states the model mostly
passes and passed the strong ones the model refuses half the time. The
bear-year sign flip survives measurement (−1.0 % mean, a loss in 66 % of draws); its C figure was 3.3 points too pessimistic and its D figure 0.9 too optimistic.

**Its null was not matched to the arm it tested.** It refused each entry
SIGNAL independently at the arm's per-signal rate, and a refused signal is
asked again on the next bar whenever the breakout still holds. The entries
each actually removed from the rulebook's:

| window | rulebook's entries | central arm removed | earlier null removed (mean) |
|---|---|---|---|
| A | 43 | 7 | 11.5 |
| B | 58 | 13 | 12.0 |
| C | 47 | 10 | 7.2 |
| D | 32 | 11 | 8.5 |

Mismatched in both directions. Its A finding ("worse than random at the 5 %
tail") compared the arm with a null that refused MORE entries than the arm
did. The null this study reads takes the same number of entries as its arm
(§4) and reaches the same reading in A, without the tail (P(null ≥ (ii)) = 0.928). With four windows looked at, the earlier study's own caution stands: a 5 %-tail result somewhere has probability 0.19 under the null.

**What else carries over.** Its out-of-sample threshold test (choose on B, C, D by the worst window; score on A) chose 0.65, which the measured answers put in the deterministic band (0.64, 0.93] — the band of the 0.80 row in §5, A −6.6 % — so the test still fails, for the same reason.

---

## 3. The three configurations, on all four evaluations

(i) is run WITH real draws through `combineDecision(…, gate = false)` — the branch `tick.ts` takes when `params.jevGate === false` — and is identical to the rulebook in 320 of 320 evaluation-window-draws (sleeve return, drawdown, entries, every coin's return and trades); the gate it bypassed would have refused 5,940 of the 15,500 entries it was shown (38 %). (iii) with the prompt's momentum clause added is identical to (iii) without it on every evaluation-window (0 differences).

**shipped stop · Coinbase tape** (primary)

| | A (bear) | B (bull) | C (strong bull) | D (sideways) | worst |
|---|---|---|---|---|---|
| (i) | +8.0 % | +20.1 % | +55.6 % | −7.8 % | −7.8 % (D) |
| (ii) mean [5th, 95th] | −1.0 % [−4.4, +2.3] | +14.6 % [+10.2, +18.2] | +55.7 % [+52.5, +58.5] | −2.3 % [−5.1, +1.0] | −2.3 % (D) |
| (iii) | +0.6 % | +14.9 % | +56.7 % | −3.3 % | −3.3 % (D) |
| entries (i) / (ii) / (iii) | 43 / 35.7 / 37 | 58 / 50.3 / 52 | 47 / 39.7 / 41 | 32 / 22.6 / 24 | |

**shipped stop · Kraken tape**

| | A (bear) | B (bull) | C (strong bull) | D (sideways) | worst |
|---|---|---|---|---|---|
| (i) | +9.2 % | +22.5 % | +50.9 % | −7.8 % | −7.8 % (D) |
| (ii) mean [5th, 95th] | +1.4 % [−4.1, +5.6] | +15.4 % [+10.5, +19.1] | +49.8 % [+46.7, +52.5] | −2.3 % [−4.9, +1.0] | −2.3 % (D) |
| (iii) | +5.5 % | +15.8 % | +51.0 % | −3.3 % | −3.3 % (D) |
| entries (i) / (ii) / (iii) | 44 / 34.7 / 36 | 60 / 52.3 / 54 | 48 / 39.7 / 41 | 32 / 22.5 / 24 | |

**3×ATR trail · Coinbase tape**

| | A (bear) | B (bull) | C (strong bull) | D (sideways) | worst |
|---|---|---|---|---|---|
| (i) | −0.3 % | +12.6 % | +47.1 % | −3.2 % | −3.2 % (D) |
| (ii) mean [5th, 95th] | −6.6 % [−9.9, −3.2] | +9.1 % [+4.9, +12.6] | +44.7 % [+42.0, +46.9] | −0.5 % [−3.0, +2.6] | −6.6 % (A) |
| (iii) | −5.8 % | +8.6 % | +46.1 % | −0.7 % | −5.8 % (A) |
| entries (i) / (ii) / (iii) | 49 / 37.5 / 40 | 69 / 59.5 / 62 | 51 / 43.7 / 45 | 33 / 23.5 / 25 | |

**3×ATR trail · Kraken tape**

| | A (bear) | B (bull) | C (strong bull) | D (sideways) | worst |
|---|---|---|---|---|---|
| (i) | +6.5 % | +13.8 % | +38.3 % | −3.2 % | −3.2 % (D) |
| (ii) mean [5th, 95th] | −0.7 % [−6.0, +3.7] | +9.3 % [+4.4, +13.0] | +35.9 % [+31.9, +39.6] | −0.6 % [−3.2, +2.3] | −0.7 % (A) |
| (iii) | +2.6 % | +9.0 % | +36.9 % | −0.7 % | −0.7 % (D) |
| entries (i) / (ii) / (iii) | 50 / 37.5 / 40 | 70 / 60.5 / 63 | 56 / 47.0 / 49 | 33 / 23.6 / 25 | |

**Per coin, primary, window A** — where the bear year goes: AVAX +34.1 % → +12.1 % under (ii) and +12.1 % under (iii); ETH −8.0 % → −13.9 % / −12.9 %; BTC −10.7 % → −13.7 % / −13.7 %; SOL +17.6 % → +12.2 % / +12.2 %; SUI +1.4 % → −5.6 % / −1.2 %. Every coin is worse. In D the veto helps ETH most (−6.3 % → +15.7 % / +12.3 %).

Deployment (primary) falls with the entries: (i) 8.8 % / 14.4 % / 17.3 % / 7.9 %, (ii) 6.6 % / 12.7 % / 15.5 % / 5.8 %, (iii) 7.0 % / 13.1 % / 16.0 % / 6.3 %. Drawdown falls with it in B, C and D and RISES in the bear year (11.3 % → 12.9 % under (ii), 12.2 % under (iii)).

---

## 4. The nulls

**Construction.** A veto always changes the return, so the only question with
content is whether it refuses the RIGHT entries. The null refuses whole
breakout EPISODES — a maximal run of consecutive bars on which the rulebook
wants in — decided on the episode's first bar and held to its last,
independent of anything the market does next. Its refusal probability is
calibrated per evaluation × window by bisection (10 steps × 100 draws) so that it takes the same number of entries, on average, as the arm it controls, then run for 1,000 draws. The match on the primary evaluation, arm / null mean entries: A (iii) 37 / 37.0, (ii) 35.7 / 35.7; B (iii) 52 / 52.1, (ii) 50.3 / 50.5; C (iii) 41 / 41.0, (ii) 39.7 / 39.5; D (iii) 24 / 24.2, (ii) 22.6 / 22.6. Deployment matches to within 0.6 points everywhere.

**P(null ≥ arm)** — the share of equal-size random vetoes that did as well or better:

| evaluation | arm | A | B | C | D | worst window |
|---|---|---|---|---|---|---|
| shipped stop · Coinbase tape | (ii) | 0.928 | 0.745 | 0.176 | 0.347 | 0.391 |
|  | (iii) | 0.934 | 0.791 | 0.152 | 0.333 | 0.329 |
| shipped stop · Kraken tape | (ii) | 0.756 | 0.766 | 0.251 | 0.291 | 0.301 |
|  | (iii) | 0.512 | 0.824 | 0.215 | 0.333 | 0.323 |
| 3×ATR trail · Coinbase tape | (ii) | 0.919 | 0.685 | 0.275 | 0.348 | 0.813 |
|  | (iii) | 0.930 | 0.789 | 0.211 | 0.313 | 0.803 |
| 3×ATR trail · Kraken tape | (ii) | 0.827 | 0.689 | 0.214 | 0.321 | 0.428 |
|  | (iii) | 0.716 | 0.776 | 0.203 | 0.334 | 0.306 |

Not one cell reaches 0.05. The pattern is the same on all four evaluations: the vetoes cost the bear and bull years MORE than random vetoes of the same size would (A and B: the null does as well or better in 51 %–93 % of draws), help the strong bull a little more than random (C: 15 %–28 %), and do in the sideways year what any refusal does (D: 29 %–35 %).

**The earlier construction agrees** (each signal refused independently and re-asked next bar, at the measured rates, primary): P(null ≥ (ii)) = 0.920 / 0.861 / 0.102 / 0.284 and P(null ≥ (iii)) = 0.907 / 0.915 / 0.058 / 0.219 in A / B / C / D. (iii) in C at 0.058 is the closest any cell comes to the tail — on the construction this study argues against, in one window of four.

**The coin flip on its own.** (ii) is (iii) plus random vetoes of high-volatility entries. Against a random episode veto layered on (iii) at the same extra rate, P(null ≥ (ii)) = 0.673 / 0.501 / 0.494 / 0.451 (primary) and 0.40–0.84 everywhere: the high-volatility veto is exactly as good as refusing the same number of entries at random, which is what a coin flip is. On the (ii) path 10–24 model calls a year land in a coin-flip state and 4–5 of them are refused. Head to head, (ii) ≥ (iii) in 25 % / 49 % / 29 % / 69 % of draws (primary).

**Sensitivity.** With each (strength, volatility, momentum) cell's 25 replies pooled across coins instead of each coin's own five, (ii)'s means move by at most 2.3 points (A −1.6 %, B +14.1 %, C +53.4 %, D −0.2 %) and the bear-year loss stands.

---

## 5. The threshold, as a structure

`combineDecision` vetoes when P < `enterMin`, so a reply EQUAL to the threshold
passes and every band's upper edge is inclusive. With the measured replies the
surface has these exact bands:

| `enterMin` | on all 90 states | on history (momentum always positive) | sleeve at a point inside, A / B / C / D |
|---|---|---|---|
| [0, 0.03] | nothing vetoed | [0, 0.06]: nothing vetoed | 0: = (i), +8.0 / +20.1 / +55.6 / −7.8 % |
| (0.03, 0.23] | part of weak / unknown vetoed | (0.06, 0.14]: part of weak vetoed | 0.10 (deterministic on history: only weak\|high refused): +9.6 / +19.5 / +58.2 / −7.8 %; 0.12 (stochastic): +6.9 / +18.2 / +56.1 / −5.1 % |
| **(0.23, 0.55]** | **deterministic: weak and unknown vetoed, everything else passes** | (0.14, 0.55] | 0.40: **≡ (iii)** cell for cell, +0.6 / +14.9 / +56.7 / −3.3 % |
| **(0.55, 0.64]** | **the coin flip: high-volatility states vetoed call by call** | same | 0.60 (shipped) = (ii), −1.0 / +14.6 / +55.7 / −2.3 %; 0.62: −2.9 / +13.9 / +48.8 / +0.5 % |
| **(0.64, 0.93]** | **deterministic: weak, unknown AND every high-volatility state vetoed** | same | 0.80: ≡ "strength ≠ weak and volatility ≠ high" as code, −6.6 / +8.9 / +42.9 / +7.2 % |
| (0.93, 0.97] | part of the calm states vetoed too | same | 0.95 (stochastic): −7.1 / +8.8 / +35.8 / +5.4 % |
| (0.97, 1] | everything vetoed | same | 0.98: no entries |

Every deterministic band equals its code arm cell for cell (12 checks, 0 failures). The shipped 0.60 sits inside the only band where the gate is random on a historical entry — the high-volatility replies run 0.55–0.64 — and close to its middle.

**Nothing here recommends a threshold.** Every row is scored on the windows that
would choose it, which §3.11, §3.19 and the earlier study's own out-of-sample
test have measured to be worse than the seeded point. The 0.10 row — which refuses only the weak|high states, 9 of the rulebook's 180 entry signals in four years — is better than (i) in A and C, and is exactly the kind of result that protocol exists to discount: it was not written down before the numbers, and it is one threshold of 9 looked at.

---

## 6. §4.15's four tests, applied to the sleeve

Primary evaluation. Revolut X return > 0 · drawdown < 35 % · at least half of
§3.7's 27-point grid positive (for (ii), each grid point's mean over 100 draws) ·
Kraken-cost return > 0. The book test is a property of the coins, which all
five pass, and is not re-applied.

| window | (i) | (ii) | (iii) |
|---|---|---|---|
| A | clears — +8.0 %, DD 11.3 %, plateau 100 %, Kraken +8.6 % | **fails** — −1.0 %, DD 12.9 %, plateau 52 %, Kraken −1.7 % | clears — +0.6 %, DD 12.2 %, plateau 59 %, Kraken +1.9 % |
| B | clears — +20.1 %, DD 10.5 %, plateau 100 %, Kraken +13.6 % | clears — +14.6 %, DD 9.4 %, plateau 100 %, Kraken +9.0 % | clears — +14.9 %, DD 9.6 %, plateau 100 %, Kraken +9.0 % |
| C | clears — +55.6 %, DD 7.3 %, plateau 100 %, Kraken +48.9 % | clears — +55.7 %, DD 5.1 %, plateau 100 %, Kraken +50.1 % | clears — +56.7 %, DD 4.9 %, plateau 100 %, Kraken +50.8 % |
| D | **fails** — −7.8 %, DD 15.5 %, plateau 4 %, Kraken −12.4 % | **fails** — −2.3 %, DD 11.2 %, plateau 7 %, Kraken −5.7 % | **fails** — −3.3 %, DD 11.8 %, plateau 7 %, Kraken −6.8 % |

(i) clears 3 windows of four, (iii) 3, (ii) 2. No configuration clears D — the sideways year is the rule's, not the model's — and the model as it runs turns the bear year from a clear into a fail.

---

## 7. The live record, recomputed

Every `agent_decisions` row with `rule_action = 'enter'`: 12, read 18:45 UTC
(the loop's last decision was 18:19 UTC and it had made 17 in the previous six
hours, so "no new entry" is a live loop reporting none, not a dead one).

| id | row | coin | state | live P | the measured replies for that state | inside? | recomputes? |
|---|---|---|---|---|---|---|---|
| 1 | momentum-1d | BTC | weak\|low\|positive \| **inside_range** | 0.15 | 0.13 0.12 0.14 0.13 0.13 (at above_range) | — | yes (hold) |
| 2 | momentum-1d | ETH | moderate\|normal\|positive \| **inside_range** | 0.92 | 0.95 0.95 0.95 0.95 0.95 (at above_range) | — | yes (enter) |
| 3 | momentum-1d | SOL | moderate\|normal\|positive \| **inside_range** | 0.93 | 0.95 0.96 0.95 0.95 0.95 (at above_range) | — | yes (enter) |
| 45 | momentum-1d | BTC | moderate\|low\|positive \| **inside_range** | 0.92 | 0.94 0.95 0.94 0.94 0.95 (at above_range) | — | yes (enter) |
| 69 | trend-1h | ETH | moderate\|normal\|positive | 0.95 | 0.95 0.95 0.95 0.95 0.95 | yes | yes (enter) |
| 83 | trend-4h | ETH | moderate\|normal\|positive | 0.94 | 0.95 0.95 0.95 0.95 0.95 | **0.01 below** | yes (enter) |
| 106 | trend-1h | BTC | moderate\|normal\|positive | 0.95 | 0.95 0.95 0.95 0.95 0.95 | yes | yes (enter) |
| 108 | trend-1h | SOL | moderate\|high\|positive | 0.59 | 0.58 0.61 0.60 0.62 0.60 | yes | yes (hold) |
| 118 | trend-4h | BTC | moderate\|normal\|positive | 0.95 | 0.95 0.95 0.95 0.95 0.95 | yes | yes (enter) |
| 120 | trend-4h | SOL | strong\|high\|positive | 0.61 | 0.60 0.60 0.58 0.63 0.58 | yes | yes (enter) |
| 131 | trend-1h | SOL | moderate\|high\|positive | 0.59 | 0.58 0.61 0.60 0.62 0.60 | yes | yes (hold) |
| 174 | trend-1h | SOL | moderate\|normal\|positive | 0.95 | 0.95 0.96 0.95 0.95 0.95 | yes | yes (enter) |

- **12 of 12 decisions recompute** through `combineDecision` from their recorded answers.
- **7 of the 8 in-space P values lie inside the measured range**; the other is 0.01 below it (0.94 against five 0.95s).
- The 4 `momentum-1d` rows are outside the measured space: that rulebook enters without a breakout, so the model is shown `inside_range`. Against the same words at `above_range` their P differs by 0.02–0.03 — lower for the moderate states, higher for the weak one — so the breakout word moves the answer a little and never across 0.60.
- **The one tension**: SOL moderate|high was answered 0.59 twice on 2026-09-21 and vetoed both times, where the measured per-call veto rate for that state is 1 in 5 (7 in 25 pooled). Two in two has probability 0.04 (0.08 pooled). Either chance, or the answers drift between days; the live record is too short to say, and it is the reason the per-coin rates carry the pooled sensitivity in §4.

---

## 8. The live row and its paper control

The paper row `trend-4h` exists to be the live row's control: the same rulebook
on the same signal, so that the only difference between them is the fill.
`tick.ts` asks the model separately for each row — there is no answer cache —
so if both rows gate, each gets its own draw. Paired simulation, primary
evaluation, 1,000 simulated years per window:

| window | joint entry signals | decided differently | …in coin-flip states (closed form 2q(1−q)) | live entries with no same-bar control entry | years the two sleeves differ | mean \|Δ\| sleeve return (95th) |
|---|---|---|---|---|---|---|
| A | 65,420 | 5.4 % | 37.9 % (37.6 %) | 7.1 % | 99.4 % | 2.3 pts (5.3) |
| B | 82,182 | 7.5 % | 26.7 % (26.3 %) | 9.8 % | 99.8 % | 2.5 pts (6.8) |
| C | 59,462 | 7.5 % | 27.2 % (26.9 %) | 9.3 % | 99.5 % | 2.0 pts (5.1) |
| D | 40,567 | 8.2 % | 29.5 % (29.5 %) | 9.8 % | 99.1 % | 2.1 pts (5.1) |

The simulation matches the closed form to within 0.4 points. With both rows gating, about one live entry in ten has no matching control entry, and in nearly every year the two rows' returns differ by about two points from the model's noise alone. For scale: at `set2.json`'s turnover for this sleeve's incumbent (15.0–30.5 turns of capital a year — the same sleeve, since the rule arm here equals it on every cell) and about 13 bps a side (9 bps of taker plus the five coins' mean half-spread of 4.0 bps), the sleeve's WHOLE fee-and-spread bill is about 2–4 points a year. The control's job is to measure the part of that the paper assumption gets wrong, and the model's noise alone is about two points. Under (i) or (iii) the two rows are deterministic and cannot part.

---

## 9. Recommendation

1. **Run (i) on the live row — `params.jevGate = false`: the model asked and
   recorded, never gating — and the same on its paper control.**
   *Supported by the bar.* (i) is the configuration every published number
   prices, go-live §4's expectation included; the bar as §3.19 writes it keeps
   the incumbent unless a change beats it on its worst window in all four
   evaluations AND beats its null there, and neither alternative does either.
   Two further reasons, each measured here: the gate as it runs is an untested
   prose rule plus a coin flip at the threshold (§1, §5), and gating both rows
   breaks the control (§8). The shadow switch exists (`e6c30af`) and defaults
   to gating, so this is a params change on the live row and on `trend-4h`;
   the go-live draft's params for the new row would carry `"jevGate": false`.
2. **Do not ship (iii), the weak-trend clause as code.** *Not supported* — a
   result only, and not the one that matters: it lifts the worst window in
   3 evaluations of four, but a random veto of the same size does as well in 31 %–33 % of draws; it
   loses to the incumbent outright on the fourth; and it costs the bear year 7.4
   points (+8.0 % → +0.6 %) where 93 % of equal-size random vetoes cost less.
3. **Do not keep (ii), the model gating as it runs.** *Not supported*: §0's
   three findings, a bear year that loses money in 66 % of draws, and the control.
4. **`enterMin`: no threshold is recommended.** If the model is ever put back
   in the gate, 0.60 is inside the only random band, and every deterministic
   alternative in §5 would be chosen on the windows that score it. The
   structure is the finding: (0.23, 0.55] IS (iii), (0.64, 0.93] is (iii) plus a
   high-volatility ban, and (0.55, 0.64] is a coin flip.
5. **What the expectation should say.** Under (i), go-live §4's numbers stand
   as written (+8.0 % bear, +20.1 % bull, −7.8 % sideways). The earlier study's replacement
   ("flat to slightly negative in a bad year") describes (ii), and is only
   right if the gate stays on.

---

## 10. What this cannot say, and what was not done

1. **The answers are today's model.** Asking it about a 2023 state is
   legitimate — the state is ten words and carries no date — but it is what
   `typesafe/jev-1.13-20260917` says on 2026-09-22, not what it would have said
   then, and an alias move changes it. In shadow mode every answer is still
   recorded, so drift is measurable from the live rows themselves.
2. **Five replies per state.** A coin's high-volatility veto rate is known to
   within a fifth. Pooling the replies moves (ii) by at most 2.3 points and changes no
   verdict; the SOL tension in §7 is why it was run.
3. **Calls are treated as independent.** The measurement shows one state
   flipping across calls seconds apart. If the provider cached per state,
   consecutive bars would be correlated and (ii) would behave more like a
   deterministic rule per episode — nearer one of the two deterministic bands,
   neither of which passes.
4. **No missing answer and no echo failure is modelled** — none in 450 calls,
   none in §4.19's 137 live decisions. Each would be a veto in production, so
   (ii) as priced is its best case.
5. **The four evaluations are near-duplicates, not four independent tests**
   (§3.19), and window D is the same on both tapes. The third tape — Revolut
   X's own UK book, window A only — exists (`set2.json`) and was not run here.
6. **Nothing here measures execution.** Fills are the next open at the touch
   plus 9 bps; the maker probe is the instrument for the rest.
7. **Not done, by instruction**: no edit to README, LEDGER, the reference, the
   go-live brief or the draft migration; no commit, push, migration or order.
   §4.21's promised next entry and go-live §9.6 are for the main session to
   write from this file.

---

## 11. Reproducing this

```
deno run --allow-read --allow-write supabase/functions/agents/backtest_jev.ts \
  --replay  measured \
  --answers docs/agents/backtests/jev_answers.json \
  --data    <dir with BTC-USD_1h_3y.json …> \
  --ext     <dir with BTC-USD_1h_kraken.json …> \
  --ktape   <dir with BTC-USD_4h_kraken.json …> \
  --set2    docs/agents/backtests/set2.json \
  --out     docs/agents/backtests
```

Writes `jev.json` and nothing else, in about eight minutes on one core. Seeded; two runs wrote byte-identical files (sha256 `0e03c844c54a96ef7d42cb060934cf80a054161b450605a85a8866f376aef9c8`). Inputs are hashed at both ends of the run and a run that straddles an edit throws: `backtest.ts` `31d27c7d82f8a94c…`, `agents_strategy.ts` `d16b704017c082fd…`, `jev_answers.json` `14e382dec694fa12…`. `--replay recorded` (with `--data` and `--ext` only) reproduces the earlier study's file (sha256 `2e3ec025…`).

**Fidelity, from the same run.** `runGated` through the flat-bar cache, and through a decider that rebuilds the snapshot on every bar, against `backtest.ts`'s `run`: 144 cells (every coin × priced window × evaluation × both venues' costs), 0 mismatches over return, drawdown, trades, days, exposure, realised, fees and stops; 0 of 53,264 equity points off; 0 of 285,628 flat bars off the cache. The rule arm equals `set2.json`'s incumbent on all four evaluations (worst |Δ| 0); shadow mode equals the rulebook (0 differences); the deterministic threshold bands equal their code arms (0 failures).

`npx deno check --quiet supabase/functions/` passes.
