# Each paper row's own Jev question, measured and priced

Written 2026-09-23 from two pricing runs at 08:08–08:25 UTC. The
pre-registration is `docs/agents/reviews/2026-09-23-jev-row-questions-prereg.md`
(sha256 `7c64b4c0…`, frozen 07:37:58 UTC, before the model saw either
question). The wordings are `supabase/functions/agents/jev_rows.ts`. The
replies are `docs/agents/backtests/jev_answers_rows.json`. The script is
`supabase/functions/agents/backtest_jev_rows.ts`, a copy of
`backtest_jev_other.ts` that takes a wording and a threshold per row. It
writes `docs/agents/backtests/jev_rows.json`: two runs wrote identical bytes,
sha256 `4a9d3e2853d5aef7db4352abdec39882bf73a07985d7170a58c0a63f9038e1e9`.

The v2 gate fails the bar on both paper rows (reference §4.21, review
`2026-09-23-jev-gates-paper-rows.md`). Davies chose option (c): each row gets
a question of its own, measured on every entry state and priced before the
loop asks it. He added that every strategy's Jev may have its own design. This
is that study, run as pre-registered.

## 0. The answer

**Neither row's own question clears the bar.** Nothing changes in production:
both paper rows keep asking v2 at 0.45. The choice between keeping that gate
and shadowing the two rows goes back to Davies (pre-registration §7).

The bar is the paper-rows study's, unchanged. The gate must not lower the
worst window in any of the four evaluations, and must beat a same-size random
veto there (P ≤ 0.05). momentum-1d is judged once a day, as the loop runs it.

| row | evaluation | rulebook's worst window | gate's worst window | lowers it? | P(null's worst ≥ gate's worst) | clears the bar? |
|---|---|---|---|---|---|---|
| trend-1h (`v3-trend-1h`, 0.47) | shipped · Coinbase | +3.8 % (A) | +2.9 % (A) | **yes** | 0.895 | **no** |
| trend-1h | shipped · Kraken | +8.2 % (B) | +1.9 % (B) | **yes** | 0.961 | **no** |
| trend-1h | trail · Coinbase | +0.5 % (A) | −2.7 % (B) | **yes** | 0.969 | **no** |
| trend-1h | trail · Kraken | +5.3 % (B) | +1.7 % (B) | **yes** | 0.884 | **no** |
| momentum-1d, once a day (`v3-momentum-1d`, 0.77) | shipped · Coinbase | −9.0 % (A) | −0.1 % (A) | no | 0.050 | yes |
| momentum-1d, once a day | shipped · Kraken | −10.9 % (A) | +0.1 % (A) | no | 0.039 | yes |
| momentum-1d, once a day | trail · Coinbase | −10.9 % (A) | −7.4 % (B) | no | 0.968 | **no** |
| momentum-1d, once a day | trail · Kraken | −11.0 % (A) | −7.0 % (B) | no | 0.959 | **no** |

- **trend-1h's own wording decides every state exactly as v2 does.** It trades
  the same path, so its price is v2's, cell for cell: it lowers the worst
  window in all four evaluations.
- **momentum-1d's own question, at the threshold its replies allow, refuses
  almost every entry.** Once a day it keeps 2–7 of the rulebook's 30–55
  entries a window. It holds the coins 4–24 % of the time, where the rulebook
  holds them 39–56 %. That removes the bear year's loss (A −9.0 → −0.1 %) and
  most of the bull years' gains (B +70.1 → +31.4 %, C +104.4 → +7.1 %). It
  never lowers the worst window. It beats a same-size random veto under the
  shipped stop, at P = 0.050 and 0.039, and loses to it under the trail, at P
  = 0.968 and 0.959. The bar asks for all four evaluations, so it fails.
- **One reported reading would pass it.** On §3.17's reading, momentum never
  carried the trail, so its shipped evaluations are its only ones; there the
  gate clears, at P = 0.050 and 0.039. That reading is reported by the script,
  not named by the pre-registration as the decision. It is not taken as a
  pass (§4).

## 1. What the model said

Both wordings were asked on the entry states the v2 replies cover, five
calls each, through the production endpoint at 07:46–07:48 UTC: the model the
loop calls, `typesafe/jev-1.13-20260917` through OpenRouter. That was 1,215
calls, with no missing answer, no failed echo, and $0.047 spent. No state's
five replies were more than 0.04 apart. Caution never came near the 1.75 veto
(at most 1.01).

- **trend-1h** (`v3-trend-1h`):
  - a weak trend in high volatility: 0.40–0.45;
  - a weak trend otherwise: 0.48–0.55;
  - a moderate trend in high volatility: 0.51–0.57;
  - everything else: 0.60–0.78.

  The deterministic bands are 0.46–0.48, 0.58–0.60 and 0.70–0.72 (three grid
  points each) and 0.76. The rule takes the lowest of the three widest:
  **0.47**. It vetoes the six weak-trend, high-volatility states and passes the
  other 48.
- **momentum-1d** (`v3-momentum-1d`): 0.24–0.81, ordered by the 4-hour words
  much as v2's replies were:
  - a 4-hour downtrend: 0.24–0.48;
  - flat: 0.34–0.54;
  - up: 0.35–0.81.

  At v2's 0.45 it would veto 94 % of the downtrend replies, where v2 vetoed
  93 %. The new wording says the rule enters on a 30-day signal and holds for
  days to weeks. It lifted the uptrend replies: 14 % of them fall under 0.45,
  against v2's 44 %. It did not move the model off the 4-hour words. The
  states overlap everywhere below 0.66. The deterministic bands are 0.66, 0.68
  and 0.76–0.78, and the rule takes **0.77**. That vetoes 183 of 189 states and
  passes six: a strong 4-hour uptrend above its range, in low or normal
  volatility, on each coin.

**trend-1h's wording decides every state exactly as v2 does.** At 0.47 the new
replies veto the same six states v2 vetoes at 0.45, and pass the same 48,
state for state (checked from the two answers files).

## 2. trend-1h, priced

A gate that makes the same decision on every state trades the same path. The
pricing confirms it: all 1,843 of trend-1h's cells in `jev_rows.json` equal
`jev_v2_other.json`'s. That covers every evaluation × window, the refused
signals, the entries kept, the per-coin table and the verdict. So the paper-rows
review's §3 is this row's result too:
- The gate refuses the weak-trend, high-volatility entries: 9.7 % of the
  rulebook's entry signals on the primary evaluation.
- It lowers the worst window in all four evaluations, by 0.85–6.32 points.
- A random veto of the same size does as well or better there in 88–97 % of
  draws.

The row's own wording changed the words the model read, not a decision it made.

## 3. momentum-1d, priced

Every state is decided the same way on every call at 0.77, so every draw
takes the same path. Each gate cell below is one number, not a mean over
differing draws.

### 3.1 Once a day, as `tick.ts` runs it (this decides)

| evaluation | window | rulebook | gate | max drawdown, rule → gate | entries, rule → gate | time in the market, rule → gate (the null's) | model asks refused / asked, on the gate's path | P(null ≥ gate) |
|---|---|---|---|---|---|---|---|---|
| shipped · Coinbase | A | −9.0 % | −0.1 % | 42.4 → 6.2 % | 55 → 3 | 41.4 → 3.6 % (2.2 %) | 457 / 460 | 0.326 |
| shipped · Coinbase | B | +70.1 % | +31.4 % | 13.4 → 7.9 % | 35 → 7 | 55.1 → 23.7 % (8.2 %) | 356 / 363 | 0.030 |
| shipped · Coinbase | C | +104.4 % | +7.1 % | 10.9 → 12.1 % | 30 → 6 | 56.0 → 14.7 % (11.2 %) | 395 / 401 | 0.663 |
| shipped · Coinbase | D | +5.8 % | +8.6 % | 23.9 → 5.0 % | 43 → 2 | 38.8 → 7.2 % (1.5 %) | 373 / 375 | 0.030 |
| shipped · Kraken | A | −10.9 % | +0.1 % | 44.6 → 6.2 % | 55 → 3 | 41.4 → 3.6 % (2.1 %) | 456 / 459 | 0.277 |
| shipped · Kraken | B | +69.3 % | +31.4 % | 13.3 → 7.9 % | 36 → 7 | 54.8 → 23.7 % (9.0 %) | 354 / 361 | 0.040 |
| shipped · Kraken | C | +104.4 % | +7.0 % | 10.9 → 12.1 % | 30 → 6 | 56.0 → 14.7 % (11.3 %) | 394 / 400 | 0.677 |
| shipped · Kraken | D | +5.8 % | +8.6 % | 23.9 → 5.0 % | 43 → 2 | 38.8 → 7.2 % (1.6 %) | 373 / 375 | 0.034 |
| trail · Coinbase | A | −10.9 % | −4.2 % | 36.5 → 4.2 % | 122 → 3 | 23.5 → 0.3 % (0.6 %) | 491 / 494 | 0.999 |
| trail · Coinbase | B | +48.3 % | −7.4 % | 8.9 → 7.4 % | 124 → 10 | 33.4 → 1.7 % (2.2 %) | 578 / 588 | 0.974 |
| trail · Coinbase | C | +37.8 % | −4.3 % | 16.1 → 7.0 % | 115 → 8 | 30.7 → 2.2 % (1.7 %) | 519 / 527 | 0.951 |
| trail · Coinbase | D | −9.4 % | +0.0 % | 21.8 → 1.4 % | 106 → 3 | 21.9 → 0.8 % (0.6 %) | 439 / 442 | 0.428 |
| trail · Kraken | A | −11.0 % | −4.1 % | 35.4 → 4.1 % | 124 → 3 | 23.1 → 0.3 % (0.6 %) | 490 / 493 | 0.997 |
| trail · Kraken | B | +55.4 % | −7.0 % | 8.9 → 7.0 % | 125 → 10 | 33.0 → 1.7 % (2.2 %) | 576 / 586 | 0.982 |
| trail · Kraken | C | +18.5 % | −2.8 % | 20.8 → 6.8 % | 122 → 10 | 28.8 → 2.6 % (2.2 %) | 510 / 520 | 0.860 |
| trail · Kraken | D | −9.4 % | +0.0 % | 21.8 → 1.4 % | 106 → 3 | 21.9 → 0.8 % (0.6 %) | 439 / 442 | 0.443 |

- **What passes the gate.** On the rulebook's own path, the gate refuses 97–100 %
  of the entry signals in every window. A refused signal is asked again the
  next day while momentum stays positive, so the gate enters on the first day
  of an episode on which the 4-hour picture is a strong uptrend above its
  range. In the bear year that happened three times.
- **The worst window rises in all four evaluations**, because a row that
  hardly trades hardly loses. Under the shipped stop, the gate's worst window
  (A, −0.07 % on Coinbase's tape) is compared with the null's worst windows.
  The null is matched on entries and holds the coins even less (2.2 % of window
  A), and its 95th percentile is −0.03 %. P = 0.050 is the share of null draws
  at least as good. The comparison is between two nearly flat books.
- **Under the trail the gate's entries lose.** A strong 4-hour breakout is often
  the top of the move: under the 3×ATR trail the gate loses in B and C (−7.4 %,
  −4.3 %), where the rulebook gains 48 % and 38 %. A random veto of the same size
  does as well or better on the worst window in 96–97 % of draws.

### 3.2 Every 4 hours, as the published tables price it (reported, decides nothing)

| evaluation | rulebook's worst | gate's worst | lowers it? | P(null's worst ≥ gate's worst) |
|---|---|---|---|---|
| shipped · Coinbase | −8.1 % (A) | −10.1 % (A) | **yes** | 0.784 |
| shipped · Kraken | −9.8 % (A) | −9.8 % (A) | **yes** (by 0.03 points) | 0.770 |
| trail · Coinbase | −21.7 % (D) | −8.9 % (A) | no | 0.904 |
| trail · Kraken | −21.7 % (D) | −8.2 % (A) | no | 0.888 |

At the 4-hour cadence the gate keeps 4–12 of the rulebook's 37–62 entries a
window under the shipped stop, and 8–23 of its 177–191 under the trail. It
lowers the bear year under the shipped stop and never beats the null. A
refused signal is asked again four hours later, so the gate finds its strong
breakouts sooner and more often than once a day. They are not better
entries: A goes from −8.1 to −10.1 %.

## 4. What follows, and what does not

**What follows.**

1. **Nothing changes in production.** Both paper rows keep the v2 question at
   0.45. No row's `params.jevQuestion` is set, and `jev_rows.ts` stays
   deployed and asked by no row.
2. **The choice is Davies'** (pre-registration §7), with the paper-rows
   review's two options:
   - Keep the v2 gate on both paper rows. Their records then measure rule ∧
     gate, at the price §4.21 records.
   - Put the two rows in shadow (`params.jevGate: false`). The model is still
     asked and recorded, and the records measure the rulebooks.
3. **trend-1h: a new wording will not change the gate.** The model already
   separates this rule's states the same way whatever the question says. A
   different gate for trend-1h would have to ask about something the state
   does not already decide. That needs a new pre-registration.
4. **momentum-1d: the model reads the 4-hour picture whatever the question
   says**, and at the loop's cadence the only threshold its replies decide the
   same way on every call is one that refuses almost everything. The question
   was not the limit. The state it is shown carries the 4-hour words and a
   30-day momentum that is always positive at an entry, so the model has
   nothing else to go on.

**What does not follow.**

1. **That the shipped-only reading is a pass.**
   - The bar names four evaluations. It was fixed before the pricing.
   - §3.17's reading was reported in the paper-rows study. It was not named
     here as deciding.
   - Choosing between readings after seeing which one passes is the forking
     path the pre-registration exists to close.
   - The primary evaluation sits exactly on the line (P = 0.050), and at 0.051
     on return ÷ drawdown.
2. **That the gate picks better momentum entries.** Mostly it does not trade.
   Its result depends on the stop: under the shipped floor its breakouts gain,
   and under the trail they lose. Under the shipped stop, the null that
   matches its entries holds the coins less of the time than it does (window
   B: 8.2 % against 23.7 %). In a rising window, time in the market is return,
   so the per-window cells where it beats the null (B and D: P 0.030–0.040)
   mix selection with exposure, as they did for v2 (paper-rows review §8).
3. **That switching the gate off would cost Jev its record.** In shadow the
   model is asked on every entry and its answer is stored beside what the gate
   would have done (`combineDecision`, `gate = false`).
4. **Anything about the model beyond these rules.** The replies are today's
   model, five per state. The four evaluations are near-duplicates, and window
   D is the same on both tapes.

## 5. Checks

- **The reproduction (pre-registration §6).** The same file, with the v2
  replies at 0.45 (its defaults) and `--check-against
  docs/agents/backtests/jev_v2_other.json`:
  - compared 8,101 cells (7,380 numbers, 192 booleans, 427 strings, 4 nulls,
    98 array lengths) with 0 differences;
  - in two runs that wrote identical bytes (sha256 `c43e2c36…`).

  The fields it excludes are listed in the output with the reason for each:
  paths, hashes, the answers file's own provenance, and the prose that names
  the script or its wordings. §6 asks that the file reproduce the paper-rows
  study "and refuse to run otherwise". It does that as a run of the same bytes,
  not inside every invocation: the pricing runs used the script whose hash
  passed the reproduction (`ae431f59…`, recorded in `sourceIntegrity`).
- **The counterfactual.** With trend-1h at 0.40 the same check fails: 692 of
  7,812 compared cells differ, and nothing is written. So the check reads the
  threshold-dependent cells.
- **The refusals**, re-run on the final script:
  - the v3 wordings with the v2 answers file, refused before any pricing;
  - the v3 answers file with the default v2 wordings, refused;
  - a misspelt flag (`--enter-mn`), refused.
- **Determinism.** Two pricing runs in separate processes (08:08:51–08:25:17
  and 08:08:51–08:25:31 UTC) wrote byte-identical files, sha256 `4a9d3e28…`.
- **trend-1h against v2.** All 1,843 of its cells equal `jev_v2_other.json`'s:
  `configurations`, `refusedSignals`, `switchedOff`, `perCoinPrimary` and the
  verdict.
- **Fidelity, as in the paper-rows study**, on this run:
  - 276 cells against a decider that rebuilds the snapshot every bar, 0
    mismatches;
  - the rule arms against the published rows, 28 cells, worst |Δ| 0;
  - window D on both tapes, 0 differences;
  - shadow ≡ rule, 920 runs, 0 differences. The gate it bypassed would have
    refused 65,660 of the 92,240 entries it was shown (v2: 37,828).
- **Sources**, hashed at the start and the end of each run, unchanged:

  | file | sha256 |
  |---|---|
  | `backtest.ts` | `31d27c7d82f8a94c…` |
  | `backtest_jev.ts` (unmodified) | `4d5af9e50255e6ff…` |
  | `backtest_jev_rows.ts` | `ae431f59187e68fe…` |
  | `agents_strategy.ts` | `097c9519e65aca13…` |
  | `_shared/jev.ts` | `46f9e8f4cadabca9…` |
  | `jev_answers_rows.json` | `d9e5824de31f58d7…` |
  | the pre-registration | `7c64b4c03e5597eb…` |
  | `set2.json` | `60a84be43fdb95a1…` |
  | `testingset.json` | `4df302db51f1d38a…` |

  `backtest_jev_other.ts` is not modified (`314334d9…`), and neither is any
  other hash-pinned file.
- **Type check and dead-code check.** `deno check` on the new file and knip
  over the Edge Functions both pass.

## 6. Reproducing it

From the repository root, on Deno 1.46.3:

```
deno run --allow-read --allow-write supabase/functions/agents/backtest_jev_rows.ts \
  --data  <dir with BTC-USD_1h_3y.json …> \
  --ext   <dir with BTC-USD_1h_kraken.json …> \
  --ktape <dir with BTC-USD_4h_kraken.json …> \
  --answers docs/agents/backtests/jev_answers_rows.json \
  --versions trend-1h=v3-trend-1h,momentum-1d=v3-momentum-1d \
  --enter-min trend-1h=0.47,momentum-1d=0.77 \
  --prereg docs/agents/reviews/2026-09-23-jev-row-questions-prereg.md \
  --out docs/agents/backtests --out-name jev_rows.json
```

Keep `--answers` and `--prereg` exactly as written: both strings are copied
into the output. The reproduction is the same command with only the three
directories, `--out <a scratch directory>` and `--check-against
docs/agents/backtests/jev_v2_other.json`. The three tape directories are the
ones the paper-rows review's §10 lists, by sha256.
