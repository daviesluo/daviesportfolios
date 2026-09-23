# Jev's question fixed — the model kept, the configuration changed

Davies' reading of the 2026-09-22 study, which recommended running the model
in shadow: "这不就相当于把jev模型给实际retire了？听起来像是jev模型的规则配置问题而不是jev本身，请修复并验证"
— that retires Jev; it sounds like a configuration problem, not the model; fix
it and verify it. He was right about the cause. This is the fix and its price.

Scripts: `supabase/functions/_shared/agents_strategy.ts` (`jevQuestionsV2`,
`JEV_ENTER_MIN`), `supabase/functions/agents/backtest_jev.ts` (`--enter-min`,
`--out-name`). Measurements: `docs/agents/backtests/jev_answers_v2.json` (the
live candidate's 90 entry states), `jev_answers_v2_other.json` (trend-1h's 54
and momentum-1d's 189). Pricing: `backtests/jev_v2.json` (the chosen threshold,
0.45) and `backtests/jev_v2_063.json` (the other deterministic band, 0.63).

## 0. The answer

| | before (v1, 0.60) | after (v2, 0.45) |
|---|---|---|
| what the question asks | "answer yes only if" trend_strength is moderate or strong, momentum_30d is positive, … | what the rule already checked, what each word means, and "is this move more likely to continue than to fail?" |
| what the model does with it | follows the list: every weak trend 0.04–0.14, every unknown momentum 0.10–0.21 | judges: 0.35–0.80, graded by strength and volatility |
| states decided differently from call to call | 8 of 90 (high-volatility states answered 0.54–0.64 around 0.60) | **0 of 90** |
| what the gate refuses on a trend entry | every weak trend, every unknown momentum, a coin flip on high volatility | **a weak trend in high volatility (P 0.35–0.41), nothing else** |
| share of the rulebook's historical entries the gate would refuse, per window | 35–52 % | 0–9 % |
| windows A / B / C / D, primary evaluation | −1.0 / +14.6 / +55.7 / −2.3 % | **+9.6 / +19.5 / +58.2 / −7.8 %** |
| the rulebook alone | +8.0 / +20.1 / +55.6 / −7.8 % | (the same) |

The fixed gate leaves the worst window (D, the sideways year) exactly where the
rulebook has it, because it refuses nothing there. It improves windows A and C
in all four evaluations and B in two of four, and lowers the drawdown or leaves
it equal in every cell. The improvement is suggestive, not proven: a random
veto of the same number of entries does as well in 6.5–9 % of draws on the
shipped stop and 19–27 % on the trail. By the bar every change here is held to
— beat the incumbent's worst window in all four evaluations and beat a random
veto there — it does not "pass", because the worst window does not move; it
also costs nothing on it. It is switched on (migration `0047`), because the
gate as it ran was worse than the rulebook in the bear year and random at its
threshold, and this one is neither.

## 1. What was wrong

The v1 question (verbatim in `jevQuestionsV1`) read: "Answer yes only if it
reads as a healthy, established uptrend that a trend-following rule should be
long in: trend_4h is up, trend_strength is moderate or strong, breakout_4h is
above_range or inside_range, momentum_30d is positive, and volatility is not
extreme." The rulebook enters on a close above the prior 55-bar high with the
averages up and momentum not negative. It never reads strength, and a breakout
is usually the START of a trend, when the fast average has only just crossed
the slow one — which is exactly what "weak" means. So the question asked the
model to refuse the rulebook's typical entry, and the model did, every time.
That was a filter written in prose and never backtested (reference §4.21: the
same clause written as code cost the bear year 7.4 points).

The threshold, 0.60, sat in the middle of the only band where the model's
answers varied from call to call: its high-volatility replies ranged 0.54–0.64.
One state on one coin answered 0.58, 0.58, 0.61, 0.63, 0.64 to five identical
calls.

## 2. The fix

`jevQuestionsV2` keeps the same question name, type and criteria shape (a noul
with both criteria, as OpenRouter requires) and the same caution and echo
questions. What changed is the instruction:

1. **It says what the rule already checked** ("the trend is up, the close is
   above the highest close of the previous 55 bars, 30-day momentum is not
   negative and volatility is not extreme. Those checks are already done and
   are not the question.").
2. **It defines the words without saying what to conclude** (weak strength is
   what a trend looks like when it is starting, strong is a mature one;
   unknown momentum means less than 30 days of history, not a direction), and
   says no single word decides the answer on its own.
3. **It asks one symmetric question**: "Answer yes if continuing looks more
   likely than failing, and no if failing looks more likely."
4. **It is worded for the rule that asks** — 4-hour or 1-hour candles for the
   trend rules, the 30-day momentum reason for momentum-1d.

The rules that follow are in CLAUDE.md: a question never lists conditions the
rulebook does not have; a threshold sits where the measured replies are
deterministic; a new wording is measured and priced before the loop asks it.

## 3. The measurement

`POST agents?action=jev` now takes `version` and `kind`, so the new wording was
put to the real model (OpenRouter, `typesafe/jev-1.13-20260917`) BEFORE the
loop used it: every entry state five times, 2026-09-23 00:21–00:25 UTC.

| rule | states | calls | cost | no answer | echo failures |
|---|---|---|---|---|---|
| trend-4h (the live candidate) | 90 | 450 | $0.016 | 0 | 0 |
| trend-1h | 54 | 270 | $0.010 | 0 | 0 |
| momentum-1d | 189 | 945 | $0.033 | 0 | 0 |

**A control in the same minute.** The same 90 trend-4h states were asked once
each with the v1 wording. Every answer fell inside the range the 2026-09-22
measurement recorded for its state. The model had not moved; the difference
between the two files is the wording alone.

Each file carries the md5 of its canonical form, computed once in SQL over the
raw responses and again over the file, and the two agree.

**What the model says now, on a trend-4h entry** (per cell, all five coins):

| strength \ volatility | low | normal | high |
|---|---|---|---|
| weak | 0.51–0.56 (unknown momentum 0.47–0.50) | 0.53–0.57 (0.47–0.51) | **0.38–0.41 (0.35–0.38)** |
| moderate | 0.70–0.73 (0.64–0.68) | 0.71–0.75 (0.66–0.70) | 0.52–0.56 (0.49–0.53) |
| strong | 0.75–0.80 (0.71–0.76) | 0.77–0.80 (0.73–0.76) | 0.57–0.62 (0.54–0.59) |

The answers now rise with trend strength and fall with volatility, which is a
judgment and not a checklist. The one combination the model calls more likely
to fail than to continue is a weak trend in high volatility. Coins barely
matter (within 0.03 of each other on every cell).

## 4. The threshold, chosen before any backtest

A threshold is deterministic when every state's five replies sit on the same
side of it. On the 90 trend-4h states that holds for thresholds up to 0.35
(nothing refused), **0.42–0.47 (a weak trend in high volatility refused,
nothing else)**, 0.63–0.64 (every weak trend and every high volatility
refused) and 0.81 and above (everything refused). Everything between is a coin
flip on some state.

**0.45 was chosen from these replies alone, before the replay ran**: it is the
middle of the band that refuses exactly the states the model calls likely
failures. The nearest refused reply is 0.41; the nearest passed one is 0.47 (a
weak trend with unknown momentum, a state history never reaches) and 0.51 on
the states it does reach. The natural
0.50 ("more likely to fail than to continue") falls where the weak
unknown-momentum and moderate high-volatility states straddle it, so it is not
deterministic. `JEV_ENTER_MIN` carries 0.45 and a pin test fails if the
threshold moves to any value at which a measured reply straddles it or the
refused set changes (0.60, 0.50 and 0.63 each fail it).

trend-1h's 54 states give the same bands and the same refused set at 0.45.
momentum-1d's 189 states have no deterministic threshold below 0.64 — its
states vary the 4-hour trend and breakout too — and at 0.45 it refuses 128 of
them (a 4-hour downtrend, a flat and weak one, or a breakdown) with 7 rare ones
(a close below the 20-bar low inside a 4-hour uptrend, P 0.42–0.47) decided
call by call.

## 5. The price

`backtest_jev.ts --replay measured` on the v2 replies at 0.45: the live
candidate (trend-4h, Revolut X, five equal $20 slots), four walk-forward
windows, the four evaluations §3.19 requires (Coinbase-spliced and Kraken's own
tape × the shipped 8 % floor and the 3×ATR trail). At each historical entry
signal the model's answer is one of the five replies it gave to that exact
state, through the live `combineDecision`. At 0.45 every reply decides the same
way, so the 2,000 draws are identical and the result is one number.

Return, rulebook → rulebook with the fixed gate (maximum drawdown, entries):

| evaluation | A (bear) | B (bull) | C (strong bull) | D (sideways) |
|---|---|---|---|---|
| shipped · Coinbase (primary) | +8.0 → **+9.6** (11.3 → 11.1; 43 → 42) | +20.1 → +19.5 (10.5 → 9.5; 58 → 57) | +55.6 → **+58.2** (7.3 → 5.0; 47 → 45) | −7.8 → −7.8 (32 → 32) |
| shipped · Kraken | +9.2 → +10.7 | +22.5 → +21.9 | +50.9 → +53.5 | −7.8 → −7.8 |
| trail · Coinbase | −0.3 → +0.4 | +12.6 → +13.9 | +47.1 → +48.0 | −3.2 → −3.2 |
| trail · Kraken | +6.5 → +7.2 | +13.8 → +15.0 | +38.3 → +39.1 | −3.2 → −3.2 |

**Against chance.** A random veto calibrated to refuse the same number of whole
breakout episodes does as well or better than the fixed gate in A in 9 %, 8 %,
25 % and 27 % of draws (the four evaluations), in C in 9 %, 6.5 %, 19 % and
19 %, and in B in 68 %, 62 %, 25 % and 22 %. None reaches the 5 % tail. Two to
four entries a window is too few to prove a selection.

**What else it changes.** The live row and its paper control now make the same
decision on every bar (0 disagreements in 1,000 paired runs per window, against
7–10 % of live entries with no same-bar control entry under v1), so the control
measures what it is for. §4.15's four tests give the same verdicts as the
rulebook's (A, B and C clear, D fails). Shadow mode was re-checked on the new
replies and is still exactly the rulebook.

## 6. The other band: 0.63

At 0.63 the gate refuses every weak trend and every high-volatility state —
55–63 % of entries. It turns the sideways year from −7.8 % to **+7.2 %**, and
that is better than a random veto of the same size in 98.9–99.5 % of draws on
all four evaluations: the only significant result in either file. It also turns
the bear year from +8.0 % to −6.6 % (worse than random in 93–98 % of draws) and
cuts B and C by 5–18 points. It moves the worst window to A, and its worst is
better than the rulebook's on the shipped stop (−6.6 against −7.8) and worse on
the trail. A filter that is right in sideways markets and wrong in falling ones
is a regime bet, not a better rule, and it is not adopted. It is recorded
because it is the first clean evidence of where a strictness filter helps.

## 7. What this cannot say

- **The pricing covers the live candidate only.** trend-1h refuses the same
  states and is paper. momentum-1d is paper and unpriced here, as it was under
  v1; its paper record is the measurement.
- **The model is today's.** The answers are what `typesafe/jev-1.13-20260917`
  says now to ten categorical words; an alias move changes them. Re-measure on
  any model change (the control in §3 is the cheap check: 90 calls, $0.0025).
- **Five replies per state.** The refused replies top out at 0.41 and the
  passed ones start at 0.47. A model update that moved the weak-trend
  high-volatility replies up by 0.04, or the unknown-momentum ones down by
  0.03, would change what is refused; the pin test catches it the next time
  the answers file is refreshed, not before.
- **Nothing refused in D means nothing learned there.** The fixed gate is
  silent in the year the rulebook loses; §6 is the only evidence about D.

## 8. Reproducing this

The measurement: `POST agents?action=jev` with `{"version":"v2","kind":…,"repeats":5,"states":[…]}`,
fired through `pg_net` with the Vault `cron_secret` (the SQL built the state
lists with cross joins; the request ids and md5s are in each file's provenance).

The pricing, from the repository root, with the three tape directories the
2026-09-22 study used:

```
deno run --allow-read --allow-write supabase/functions/agents/backtest_jev.ts \
  --replay measured \
  --answers docs/agents/backtests/jev_answers_v2.json \
  --enter-min 0.45 --out-name jev_v2.json \
  --data <dir with BTC-USD_1h_3y.json …> \
  --ext <dir with BTC-USD_1h_kraken.json …> \
  --ktape <dir with BTC-USD_4h_kraken.json …> \
  --set2 docs/agents/backtests/set2.json \
  --out docs/agents/backtests
```

`--enter-min 0.63 --out-name jev_v2_063.json` writes the second file. Two
0.45 runs in parallel on the committed tree (2026-09-23, 00:42:24–00:50:47 UTC)
wrote byte-identical files, sha256 `672ae9a24a1face1bf3c2397037f26c28b8b7d918fc1e3e470aa12e54ac96a9e`;
the 0.63 run wrote `2e8c2ac90c003917…`. Every input
was hashed before and after and none changed: `backtest_jev.ts`
`2900ab35ae067513…`, `agents_strategy.ts`
`097c9519e65aca13…`, `jev_answers_v2.json`
`1ace71bad0361962…`. Fidelity from the same run:
144 cells of `runGated` against `run`, 0 mismatches; the rule arm equals
`set2.json`'s incumbent on all four evaluations; shadow mode equals the
rulebook. Without
the two new flags the script is the 2026-09-22 study: re-run on the current
tree it reproduces the committed `jev.json` field for field, except the SHA-256
it records for `agents_strategy.ts`, which has changed since (the question
versioning and `stepDecimals`, neither of which the replay reads).
