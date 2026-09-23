# The Jev gate on the two paper rows: trend-1h and momentum-1d, priced

Written 2026-09-23 from two runs at 05:26–05:39 UTC. The script is
`supabase/functions/agents/backtest_jev_other.ts`. It is new. It imports its
machinery from `backtest_jev.ts` and does not modify it. The output is
`docs/agents/backtests/jev_v2_other.json`: two runs wrote identical bytes,
sha256 `e4958cbb411b2615f24d617bdb576507a807a3d446c2201a50712aae74eff91f`. The
model's replies come from `docs/agents/backtests/jev_answers_v2_other.json`.

This finishes a study that a usage limit cut off. The earlier draft was a
`--replay other` mode inside `backtest_jev.ts`. That file's SHA-256 is now
pinned by `sizing.json`, so the mode moved into its own file. The move
reproduces every line the earlier run printed before it was killed (§9).

Since migration 0047, all three rows ask the v2 question and refuse an entry
when P(healthy) < 0.45. Only the live candidate's gate had been priced
(`jev_v2.json`). This study prices the two paper rows' gates the same way. It
runs the rulebook against the rulebook ∧ the gate on windows A–D, under the
four evaluations §3.19 requires. At each historical entry, the model's answer
is drawn from the five replies it gave to that exact state. Each gate is then
judged against a random veto calibrated to take the same number of entries.

## 0. The answer

**Neither paper row's gate clears the bar.** The bar: do not lower the worst
window in any of the four evaluations, and beat a same-size random veto there.

| row | evaluation | rulebook's worst window | gate's worst window | lowers it? | P(null's worst ≥ gate's worst) | clears the bar? |
|---|---|---|---|---|---|---|
| trend-1h | shipped · Coinbase | +3.8 % (A) | +2.9 % (A) | **yes** | 0.895 | **no** |
| trend-1h | shipped · Kraken | +8.2 % (B) | +1.9 % (B) | **yes** | 0.961 | **no** |
| trend-1h | trail · Coinbase | +0.5 % (A) | −2.7 % (B) | **yes** | 0.969 | **no** |
| trend-1h | trail · Kraken | +5.3 % (B) | +1.7 % (B) | **yes** | 0.884 | **no** |
| momentum-1d | shipped · Coinbase | −8.1 % (A) | −6.1 % (A) | no | 0.341 | **no** |
| momentum-1d | shipped · Kraken | −9.8 % (A) | −4.9 % (A) | no | 0.295 | **no** |
| momentum-1d | trail · Coinbase | −21.7 % (D) | −22.8 % (D) | **yes** | 0.980 | **no** |
| momentum-1d | trail · Kraken | −21.7 % (D) | −22.8 % (D) | **yes** | 0.985 | **no** |
| momentum-1d·daily | shipped · Coinbase | −9.0 % (A) | −15.8 % (A) | **yes** | 0.778 | **no** |
| momentum-1d·daily | shipped · Kraken | −10.9 % (A) | −15.1 % (A) | **yes** | 0.753 | **no** |
| momentum-1d·daily | trail · Coinbase | −10.9 % (A) | −26.0 % (A) | **yes** | 0.999 | **no** |
| momentum-1d·daily | trail · Kraken | −11.0 % (A) | −23.7 % (A) | **yes** | 0.995 | **no** |

- **trend-1h.** The gate refuses one kind of entry: a weak trend in high
  volatility. That is 9.7 % of the rulebook's entry signals on the primary
  evaluation. It lowers the worst window in all four evaluations, by 0.85,
  6.32, 3.16 and 3.61 points. A random veto that takes the same number of
  entries does as well or better on the worst window in 88–97 % of draws. So
  its choice of which entries to refuse is worse than most random choices,
  though not proven worse than random.
- **momentum-1d, decided on every 4-hour bar.** This is how every published
  table prices it. Under the shipped stop, the gate raises the worst window,
  the bear year: A goes from −8.1 to −6.1 % on the Coinbase tape and from −9.8
  to −4.9 % on Kraken's. But a same-size random veto does as well or better
  there in 34.1 % and 29.5 % of draws. Under the trail, the gate lowers the
  worst window: D goes from −21.7 to −22.8 %.
- **momentum-1d, decided once a day.** This is how `tick.ts` runs it. The gate
  lowers the worst window in all four evaluations, by 4.2 to 15.1 points. On
  the primary evaluation, A goes from −9.0 to −15.8 %.
- **momentum-1d's refused signals.** Weighted by how often each state occurs,
  the gate refuses 65.5 % of the rulebook's historical entry signals. That is
  63.2 % once a day, and 51–56 % under the trail. **It does not switch the row
  off.** A refused momentum signal is asked again at the next decision for as
  long as momentum stays positive. Under the shipped stop, the gate removes
  33–47 % of entries but keeps 76–95 % of the rulebook's time in the market.
  In effect it turns the rule into "30-day momentum positive, and the 4-hour
  picture not against it." On history, every momentum entry made in a 4-hour
  downtrend is refused, and 35 % of those made in an uptrend inside the range.

No threshold is recommended (§8).

## 1. What was priced

- **The rows**, as migrations 0037 and 0047 leave them:
  - BTC / ETH / SOL on Revolut X, $40 in three equal slots
  - the seeded trend parameters, `lookbackDays` 30
  - the 8 % floor
  - `enterMin` 0.45 (`JEV_ENTER_MIN`), and `tick.ts`'s caution veto at 1.75
- **trend-1h** runs on 1-hour bars. It is decided every hour, with a two-bar
  cooldown. This is how `backtest.ts` and §3.17 price it and how `tick.ts`
  runs it.
- **momentum-1d is priced at two cadences.**
  - Every published table (`backtest.ts`, §3.17, `set2.json`) decides it on
    every closed 4-hour bar, with a two-bar cooldown.
  - `tick.ts` decides it once a day. The state comes from the 4-hour bar that
    closes at 00:00 UTC, there is one decision per daily candle, and the
    cooldown is two days (12 four-hour bars).
  - The 12 bars are exact after a floor stop. After a rule exit, the loop may
    re-enter at 48 h, depending on seconds; the replay waits the extra day.
  - A refused entry is asked again four hours later at the first cadence, and
    a day later at the second. That difference is most of what a gate on this
    rule does.
- **The draw.** The model is consulted at every entry signal where `tick.ts`
  would ask it: flat, the rulebook says enter, and not cooling down (and, once
  a day, on the 00:00 UTC bar). There, one of the five replies the model gave
  to that exact state is drawn uniformly and put through the live
  `combineDecision`. There are 2,000 seeded draws.
- **The null** is §4.21's correction. It refuses whole episodes, where an
  episode is a run of consecutive decisions on which the rulebook wants in.
  - Its refusal probability is calibrated by bisection (10 steps × 100 draws),
    so that it takes the same mean number of entries as the gate. It is then
    run for 1,000 draws.
  - The null's entries land within 0.4 of the gate's on trend-1h, and within
    2.4 entries (at most 2.1 %) on momentum-1d.
  - **P(null ≥ gate)** is the share of (null draw, gate draw) pairs in which
    the null did as well or better; ties count against the gate. The gate
    "beats the null" when P ≤ 0.05.
  - On the worst window, each gate draw's worst is compared with each null
    draw's worst.
- **The four evaluations** are the Coinbase-spliced tape and Kraken's own
  tape, each under the shipped 8 % floor and under the 3×ATR(14) intra-bar
  trail (§3.19).
  - Under the trail rule, momentum-1d carries the trail, as `set2.json` priced
    it.
  - trend-1h has no Kraken-tape window A: Kraken's hourly bundle ends
    2026-06-30. Its Kraken worst window is taken over B, C and D.
- **The gate's worst window** is the worst of its per-window means, as
  `backtest_jev.ts` reads it. The other reading, the mean over draws of each
  draw's worst, gives the same number in every cell.
- **Fills** are the next bar's open at the touch, plus Revolut X's 9 bps.
  Nothing here measures execution.

## 2. What the replies decide at 0.45, from the answers file alone

| rule | states | replies | refused on every call | call by call | never refused | thresholds in 0.30–0.85 that decide every state the same way on every call |
|---|---|---|---|---|---|---|
| trend-1h | 54 | 270 | 6 | 0 | 48 | 0.30, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.64, 0.65, 0.66, 0.81, 0.82, 0.83, 0.84, 0.85 |
| momentum-1d | 189 | 945 | 128 | 7 | 54 | 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.70, 0.71, 0.74, 0.77, 0.78, 0.82, 0.83, 0.84, 0.85 |

- **trend-1h.** The refused states are exactly the weak-trend, high-volatility
  ones: 6 of 54 (3 coins × momentum positive or unknown), refused on every
  call. This is the same band as trend-4h's, and 0.45 sits in it.
- **momentum-1d.** 128 of its 189 states are refused on every call: a 4-hour
  downtrend, a flat (and so weak) trend, or a close below the range. Seven are
  decided call by call; each is a close below the 20-bar low inside a 4-hour
  uptrend, with replies of 0.42–0.47. The scan covers 0.30–0.85, and in that
  range no threshold below 0.64 decides every momentum state the same way on
  every call. Its lowest reply is 0.16, so anything at or below 0.16 refuses
  nothing.
- **Caution** never reaches the 1.75 veto on either rule (at most 1.01 and
  1.02). Every echo was correct.

| state | the five replies | share refused at 0.45 |
|---|---|---|
| BTC/USD · up · strong · below_range · low · positive | 0.46, 0.45, 0.45, 0.46, 0.44 | 20 % |
| BTC/USD · up · strong · below_range · normal · positive | 0.44, 0.45, 0.46, 0.45, 0.44 | 40 % |
| ETH/USD · up · moderate · below_range · low · positive | 0.42, 0.45, 0.43, 0.44, 0.42 | 80 % |
| ETH/USD · up · moderate · below_range · normal · positive | 0.46, 0.43, 0.44, 0.44, 0.45 | 60 % |
| SOL/USD · up · moderate · below_range · low · positive | 0.44, 0.44, 0.45, 0.42, 0.44 | 80 % |
| SOL/USD · up · moderate · below_range · normal · positive | 0.45, 0.46, 0.43, 0.46, 0.46 | 20 % |
| SOL/USD · up · strong · below_range · normal · positive | 0.46, 0.47, 0.47, 0.46, 0.44 | 20 % |

Under the shipped stop, none of these seven states occurs on the rulebook's
own path, or on the gate's. So every historical momentum entry is decided the
same way on every draw, and the result is one number. Under the trail, they
make up 6 of 732 signals at the 4-hour cadence and none once a day.

## 3. trend-1h

| evaluation | window | rulebook | gate (mean; 5th–95th where the draws differ) | max drawdown, rule → gate | entries, rule → gate | model asks refused / asked, on the gate's path | P(null ≥ gate) |
|---|---|---|---|---|---|---|---|
| shipped · Coinbase | A | +3.8 % | +2.9 % | 18.8 → 19.4 % | 96 → 95 | 6 / 101 | 0.926 |
| shipped · Coinbase | B | +10.3 % | +4.2 % | 16.9 → 15.5 % | 117 → 109 | 31 / 140 | 0.949 |
| shipped · Coinbase | C | +39.7 % | +35.9 % | 6.8 → 7.0 % | 103 → 101 | 15 / 116 | 0.954 |
| shipped · Coinbase | D | +16.2 % | +17.3 % | 5.6 → 5.0 % | 64 → 61 | 6 / 67 | 0.103 |
| shipped · Kraken | B | +8.2 % | +1.9 % | 15.3 → 13.5 % | 126 → 118 | 31 / 149 | 0.961 |
| shipped · Kraken | C | +43.5 % | +30.8 % | 5.8 → 8.4 % | 110 → 105 | 15 / 120 | 0.933 |
| shipped · Kraken | D | +16.2 % | +17.3 % | 5.6 → 5.0 % | 64 → 61 | 6 / 67 | 0.096 |
| trail · Coinbase | A | +0.5 % | −0.8 % | 20.4 → 21.3 % | 107 → 106 | 6 / 112 | 0.970 |
| trail · Coinbase | B | +4.0 % | −2.7 % | 17.3 → 15.7 % | 134 → 126 | 29 / 155 | 0.969 |
| trail · Coinbase | C | +13.3 % | +10.2 % | 6.7 → 6.9 % | 122 → 119 | 15 / 134 | 0.903 |
| trail · Coinbase | D | +9.4 % | +9.0 % | 3.6 → 3.1 % | 73 → 70 | 6 / 76 | 0.394 |
| trail · Kraken | B | +5.3 % | +1.7 % | 17.2 → 14.7 % | 142 → 132 | 31 / 163 | 0.885 |
| trail · Kraken | C | +22.4 % | +16.2 % | 5.2 → 9.9 % | 126 → 121 | 15 / 136 | 0.901 |
| trail · Kraken | D | +9.4 % | +9.0 % | 3.6 → 3.1 % | 73 → 70 | 6 / 76 | 0.422 |

| evaluation | windows priced | rulebook's worst | gate's worst | lowers it? | P(null's worst ≥ gate's worst) | beats the null? | on return ÷ drawdown: rule → gate worst, P(null) | clears the bar? |
|---|---|---|---|---|---|---|---|---|
| shipped · Coinbase | A, B, C, D | +3.8 % (A) | +2.9 % (A) | **yes** | 0.895 | no | +0.20 (A) → +0.15, 0.900 | **no** |
| shipped · Kraken | B, C, D | +8.2 % (B) | +1.9 % (B) | **yes** | 0.961 | no | +0.54 (B) → +0.14, 0.958 | **no** |
| trail · Coinbase | A, B, C, D | +0.5 % (A) | −2.7 % (B) | **yes** | 0.969 | no | +0.02 (A) → −0.17, 0.973 | **no** |
| trail · Kraken | B, C, D | +5.3 % (B) | +1.7 % (B) | **yes** | 0.884 | no | +0.31 (B) → +0.11, 0.866 | **no** |

| trend strength · volatility at the entry | signals | refused |
|---|---|---|
| weak · normal | 120 | 0 % |
| weak · low | 74 | 0 % |
| moderate · normal | 74 | 0 % |
| moderate · high | 43 | 0 % |
| weak · high | 37 | 100 % |
| moderate · low | 20 | 0 % |
| strong · high | 7 | 0 % |
| strong · normal | 5 | 0 % |

Per coin, primary evaluation:

| window | BTC, rule → gate (entries) | ETH | SOL |
|---|---|---|---|
| A | −14.1 % → −14.1 % (37 → 37) | +8.2 % → +9.7 % (30 → 29) | +13.1 % → +8.8 % (29 → 29) |
| B | +0.3 % → −1.8 % (45 → 43) | +25.1 % → +29.5 % (37 → 34) | −1.1 % → −17.5 % (35 → 32) |
| C | +7.9 % → +7.9 % (38 → 38) | −9.4 % → −9.4 % (37 → 37) | +202.5 % → +171.2 % (28 → 26) |
| D | +33.2 % → +24.9 % (24 → 24) | +22.6 % → +20.7 % (28 → 28) | −4.9 % → +6.8 % (12 → 9) |

The gate refuses 9.7 % of the rulebook's entry signals on the primary
evaluation (4.2–16.2 % per window). Every one of them is a weak trend in high
volatility: 37 of 380. It removes 1 to 10 entries per window. It keeps 91–99 %
of the rulebook's time in the market, and the null holds the coins within 0.4
points of the gate everywhere, so the null comparison is clean here.

Even so, the gate lowers the return in A, B and C in every evaluation that
prices them (Kraken's tape has no A). In D, which is never the worst window,
it raises the return under the shipped stop (+16.2 to +17.3 %) and lowers it a
little under the trail (+9.4 to +9.0 %). Most of the change is SOL's: on the
primary evaluation B goes from −1.1 to −17.5 % and C from +202.5 to +171.2 %.

A refused signal on an hourly rule is asked again an hour later. So the gate
shifts entries as well as removing them: in B it refuses 31 asks for 8 fewer
entries.

## 4. momentum-1d, decided on every 4-hour bar (as the published tables price it)

| evaluation | window | rulebook | gate (mean; 5th–95th where the draws differ) | max drawdown, rule → gate | entries, rule → gate | model asks refused / asked, on the gate's path | P(null ≥ gate) |
|---|---|---|---|---|---|---|---|
| shipped · Coinbase | A | −8.1 % | −6.1 % | 41.0 → 34.5 % | 62 → 33 | 613 / 646 | 0.567 |
| shipped · Coinbase | B | +62.4 % | +66.7 % | 17.1 → 14.3 % | 45 → 29 | 349 / 378 | 0.015 |
| shipped · Coinbase | C | +106.2 % | +105.7 % | 10.0 → 8.9 % | 37 → 22 | 228 / 250 | 0.044 |
| shipped · Coinbase | D | −7.2 % | −4.2 % | 27.9 → 23.3 % | 56 → 33 | 667 / 700 | 0.563 |
| shipped · Kraken | A | −9.8 % | −4.9 % | 43.0 → 33.6 % | 62 → 33 | 606 / 639 | 0.490 |
| shipped · Kraken | B | +62.6 % | +69.0 % | 16.2 → 13.6 % | 45 → 29 | 330 / 359 | 0.007 |
| shipped · Kraken | C | +106.2 % | +107.5 % | 10.0 → 8.9 % | 37 → 22 | 225 / 247 | 0.034 |
| shipped · Kraken | D | −7.2 % | −4.2 % | 27.9 → 23.3 % | 56 → 33 | 667 / 700 | 0.585 |
| trail · Coinbase | A | −9.5 % | −11.3 % (−11.4 % … −11.0 %) | 34.4 → 23.9 % | 187 → 108 | 1190.5 / 1298.5 | 0.962 |
| trail · Coinbase | B | +42.8 % | +31.4 % (+31.0 % … +31.7 %) | 18.0 → 11.5 % | 187 → 125.4 | 1087 / 1212.4 | 0.461 |
| trail · Coinbase | C | +34.5 % | +32.4 % (+32.0 % … +32.7 %) | 18.0 → 11.9 % | 177 → 116 | 979.8 / 1095.8 | 0.258 |
| trail · Coinbase | D | −21.7 % | −22.8 % | 28.3 → 27.5 % | 181 → 101 | 1199 / 1300 | 0.980 |
| trail · Kraken | A | −6.9 % | −7.0 % (−7.1 % … −6.7 %) | 33.8 → 22.4 % | 190 → 109 | 1159.5 / 1268.5 | 0.846 |
| trail · Kraken | B | +51.4 % | +38.3 % (+37.9 % … +38.6 %) | 16.2 → 9.6 % | 191 → 128.4 | 1066.8 / 1195.2 | 0.346 |
| trail · Kraken | C | +20.6 % | +23.3 % (+23.2 % … +23.4 %) | 21.3 → 13.6 % | 190 → 127 | 972.4 / 1099.4 | 0.291 |
| trail · Kraken | D | −21.7 % | −22.8 % | 28.3 → 27.5 % | 181 → 101 | 1199 / 1300 | 0.987 |

| evaluation | windows priced | rulebook's worst | gate's worst | lowers it? | P(null's worst ≥ gate's worst) | beats the null? | on return ÷ drawdown: rule → gate worst, P(null) | clears the bar? |
|---|---|---|---|---|---|---|---|---|
| shipped · Coinbase | A, B, C, D | −8.1 % (A) | −6.1 % (A) | no | 0.341 | no | −0.26 (D) → −0.18, 0.261 | **no** |
| shipped · Kraken | A, B, C, D | −9.8 % (A) | −4.9 % (A) | no | 0.295 | no | −0.26 (D) → −0.18, 0.258 | **no** |
| trail · Coinbase | A, B, C, D | −21.7 % (D) | −22.8 % (D) | **yes** | 0.980 | no | −0.77 (D) → −0.83, 0.959 | **no** |
| trail · Kraken | A, B, C, D | −21.7 % (D) | −22.8 % (D) | **yes** | 0.985 | no | −0.77 (D) → −0.83, 0.969 | **no** |

Per coin, primary evaluation:

| window | BTC, rule → gate (entries) | ETH | SOL |
|---|---|---|---|
| A | −17.0 % → −18.6 % (23 → 14) | +10.4 % → −3.8 % (17 → 10) | −29.2 % → −7.6 % (22 → 9) |
| B | +38.7 % → +61.9 % (18 → 11) | +116.0 % → +142.8 % (14 → 7) | +52.9 % → +37.1 % (13 → 11) |
| C | +84.6 % → +77.0 % (17 → 9) | +53.9 % → +56.2 % (13 → 8) | +420.9 % → +434.0 % (7 → 5) |
| D | +17.6 % → +18.5 % (17 → 9) | −20.4 % → −14.4 % (22 → 12) | −33.1 % → −28.0 % (17 → 12) |

## 5. momentum-1d, decided once a day (as `tick.ts` runs it)

| evaluation | window | rulebook | gate (mean; 5th–95th where the draws differ) | max drawdown, rule → gate | entries, rule → gate | model asks refused / asked, on the gate's path | P(null ≥ gate) |
|---|---|---|---|---|---|---|---|
| shipped · Coinbase | A | −9.0 % | −15.8 % | 42.4 → 36.0 % | 55 → 31 | 99 / 130 | 0.836 |
| shipped · Coinbase | B | +70.1 % | +69.0 % | 13.4 → 9.9 % | 35 → 23 | 64 / 87 | 0.025 |
| shipped · Coinbase | C | +104.4 % | +108.4 % | 10.9 → 7.9 % | 30 → 20 | 38 / 58 | 0.049 |
| shipped · Coinbase | D | +5.8 % | −0.9 % | 23.9 → 20.0 % | 43 → 26 | 112 / 138 | 0.509 |
| shipped · Kraken | A | −10.9 % | −15.1 % | 44.6 → 35.6 % | 55 → 31 | 99 / 130 | 0.820 |
| shipped · Kraken | B | +69.3 % | +68.2 % | 13.3 → 9.9 % | 36 → 24 | 64 / 88 | 0.033 |
| shipped · Kraken | C | +104.4 % | +110.2 % | 10.9 → 8.0 % | 30 → 20 | 36 / 56 | 0.029 |
| shipped · Kraken | D | +5.8 % | −0.9 % | 23.9 → 20.0 % | 43 → 26 | 112 / 138 | 0.508 |
| trail · Coinbase | A | −10.9 % | −26.0 % | 36.5 → 27.9 % | 122 → 68 | 205 / 273 | 0.999 |
| trail · Coinbase | B | +48.3 % | +26.9 % | 8.9 → 6.7 % | 124 → 75 | 211 / 286 | 0.696 |
| trail · Coinbase | C | +37.8 % | +36.5 % | 16.1 → 11.8 % | 115 → 79 | 175 / 254 | 0.162 |
| trail · Coinbase | D | −9.4 % | +0.0 % | 21.8 → 15.6 % | 106 → 55 | 207 / 262 | 0.629 |
| trail · Kraken | A | −11.0 % | −23.7 % | 35.4 → 25.7 % | 124 → 68 | 205 / 273 | 0.997 |
| trail · Kraken | B | +55.4 % | +31.7 % | 8.9 → 7.7 % | 125 → 77 | 209 / 286 | 0.605 |
| trail · Kraken | C | +18.5 % | +24.9 % | 20.8 → 14.6 % | 122 → 84 | 176 / 260 | 0.080 |
| trail · Kraken | D | −9.4 % | +0.0 % | 21.8 → 15.6 % | 106 → 55 | 207 / 262 | 0.654 |

| evaluation | windows priced | rulebook's worst | gate's worst | lowers it? | P(null's worst ≥ gate's worst) | beats the null? | on return ÷ drawdown: rule → gate worst, P(null) | clears the bar? |
|---|---|---|---|---|---|---|---|---|
| shipped · Coinbase | A, B, C, D | −9.0 % (A) | −15.8 % (A) | **yes** | 0.778 | no | −0.21 (A) → −0.44, 0.556 | **no** |
| shipped · Kraken | A, B, C, D | −10.9 % (A) | −15.1 % (A) | **yes** | 0.753 | no | −0.24 (A) → −0.42, 0.530 | **no** |
| trail · Coinbase | A, B, C, D | −10.9 % (A) | −26.0 % (A) | **yes** | 0.999 | no | −0.43 (D) → −0.93, 0.998 | **no** |
| trail · Kraken | A, B, C, D | −11.0 % (A) | −23.7 % (A) | **yes** | 0.995 | no | −0.43 (D) → −0.92, 0.996 | **no** |

Per coin, primary evaluation:

| window | BTC, rule → gate (entries) | ETH | SOL |
|---|---|---|---|
| A | −20.0 % → −26.1 % (20 → 13) | +6.6 % → −11.9 % (17 → 9) | −25.9 % → −15.8 % (18 → 9) |
| B | +43.2 % → +68.2 % (14 → 9) | +141.2 % → +104.1 % (10 → 6) | +68.0 % → +76.1 % (11 → 8) |
| C | +70.8 % → +91.1 % (13 → 8) | +71.9 % → +66.6 % (9 → 7) | +379.3 % → +407.9 % (8 → 5) |
| D | +27.6 % → +26.1 % (14 → 8) | −11.6 % → −9.9 % (17 → 11) | −13.9 % → −28.0 % (12 → 7) |

The rulebook alone reads differently at the two cadences. On shipped ·
Coinbase, every 4 hours against once a day:

| window | every 4 hours | once a day |
|---|---|---|
| A | −8.1 % | −9.0 % |
| B | +62.4 % | +70.1 % |
| C | +106.2 % | +104.4 % |
| D | −7.2 % | +5.8 % |

The published momentum-1d numbers price a cadence the loop does not run. The
once-a-day arm rests on one modelling choice in §1: after a rule exit it waits
three days, where the loop may wait two.

## 6. momentum-1d's refused signals, and whether the gate switches the row off

What the gate refuses of the rulebook's own entry signals, weighted by how
often each state occurs. On the rulebook's own path every signal is an entry,
and a state refused on k of its five replies counts k/5.

Every 4 hours:

| evaluation | signals the gate refuses (weighted) | refused on every call / call by call / never | A | B | C | D |
|---|---|---|---|---|---|---|
| shipped · Coinbase | 131 of 200 = **65.5 %** | 131 / 0 / 69 | 71.0 % of 62 | 57.8 % of 45 | 67.6 % of 37 | 64.3 % of 56 |
| shipped · Kraken | 130 of 200 = **65.0 %** | 130 / 0 / 70 | 71.0 % of 62 | 55.6 % of 45 | 67.6 % of 37 | 64.3 % of 56 |
| trail · Coinbase | 377.2 of 732 = **51.5 %** | 375 / 6 / 351 | 52.6 % of 187 | 47.6 % of 187 | 49.6 % of 177 | 56.4 % of 181 |
| trail · Kraken | 383.6 of 752 = **51.0 %** | 381 / 6 / 365 | 52.3 % of 190 | 48.1 % of 191 | 47.6 % of 190 | 56.4 % of 181 |

Once a day:

| evaluation | signals the gate refuses (weighted) | refused on every call / call by call / never | A | B | C | D |
|---|---|---|---|---|---|---|
| shipped · Coinbase | 103 of 163 = **63.2 %** | 103 / 0 / 60 | 69.1 % of 55 | 54.3 % of 35 | 60.0 % of 30 | 65.1 % of 43 |
| shipped · Kraken | 103 of 164 = **62.8 %** | 103 / 0 / 61 | 69.1 % of 55 | 52.8 % of 36 | 60.0 % of 30 | 65.1 % of 43 |
| trail · Coinbase | 260 of 467 = **55.7 %** | 260 / 0 / 207 | 56.6 % of 122 | 54.8 % of 124 | 51.3 % of 115 | 60.4 % of 106 |
| trail · Kraken | 263 of 477 = **55.1 %** | 263 / 0 / 214 | 56.5 % of 124 | 54.4 % of 125 | 50.0 % of 122 | 60.4 % of 106 |

Which signals, shipped · Coinbase, every 4 hours:

| the 4-hour picture at the entry (trend · breakout) | signals | refused |
|---|---|---|
| up · inside_range | 91 | 35 % |
| down · inside_range | 83 | 100 % |
| flat · inside_range | 10 | 100 % |
| up · above_range | 9 | 0 % |
| down · above_range | 3 | 100 % |
| down · below_range | 2 | 100 % |
| flat · above_range | 2 | 50 % |

And once a day:

| the 4-hour picture at the entry (trend · breakout) | signals | refused |
|---|---|---|
| up · inside_range | 80 | 34 % |
| down · inside_range | 67 | 100 % |
| up · above_range | 7 | 0 % |
| flat · inside_range | 5 | 100 % |
| down · above_range | 3 | 100 % |
| flat · above_range | 1 | 100 % |

Counted once per state, the answers refuse 128 of 189 states (67.7 %).
Weighted by how often the rulebook meets each state, the gate refuses **65.5 %
of momentum-1d's historical entry signals** (65.0 % on Kraken's tape). Once a
day it refuses 63.2 % (62.8 %), and under the trail 51.0–55.7 %. On history,
every entry taken in a 4-hour downtrend is refused: 88 of the 200 signals
every 4 hours. So is 35 % of those taken in an uptrend inside the range.

**Does it switch the row off? No.** What the gate's own path does:

Every 4 hours:

| evaluation | window | entries kept | time in the market, rule → gate (kept) | the null's time in the market | model asks refused, on the gate's path |
|---|---|---|---|---|---|
| shipped · Coinbase | A | 53 % (62 → 33) | 44.3 → 35.3 % (80 %) | 24.1 % | 95 % |
| shipped · Coinbase | B | 64 % (45 → 29) | 56.8 → 51.6 % (91 %) | 35.7 % | 92 % |
| shipped · Coinbase | C | 60 % (37 → 22) | 58.1 → 54.7 % (94 %) | 37.3 % | 91 % |
| shipped · Coinbase | D | 59 % (56 → 33) | 42.2 → 32.1 % (76 %) | 26.2 % | 95 % |
| shipped · Kraken | A | 53 % (62 → 33) | 44.2 → 35.3 % (80 %) | 23.4 % | 95 % |
| shipped · Kraken | B | 64 % (45 → 29) | 56.7 → 51.7 % (91 %) | 35.6 % | 92 % |
| shipped · Kraken | C | 60 % (37 → 22) | 58.1 → 54.8 % (94 %) | 37.0 % | 91 % |
| shipped · Kraken | D | 59 % (56 → 33) | 42.2 → 32.1 % (76 %) | 26.2 % | 95 % |
| trail · Coinbase | A | 58 % (187 → 108) | 38.2 → 22.8 % (60 %) | 21.8 % | 92 % |
| trail · Coinbase | B | 67 % (187 → 125.4) | 49.2 → 34.8 % (71 %) | 32.7 % | 90 % |
| trail · Coinbase | C | 66 % (177 → 116) | 45.3 → 32.6 % (72 %) | 29.7 % | 89 % |
| trail · Coinbase | D | 56 % (181 → 101) | 35.5 → 19.7 % (56 %) | 20.3 % | 92 % |
| trail · Kraken | A | 57 % (190 → 109) | 38.0 → 23.1 % (61 %) | 21.5 % | 91 % |
| trail · Kraken | B | 67 % (191 → 128.4) | 48.9 → 34.8 % (71 %) | 31.4 % | 89 % |
| trail · Kraken | C | 67 % (190 → 127) | 44.3 → 31.8 % (72 %) | 29.1 % | 88 % |
| trail · Kraken | D | 56 % (181 → 101) | 35.5 → 19.7 % (56 %) | 20.3 % | 92 % |

Once a day:

| evaluation | window | entries kept | time in the market, rule → gate (kept) | the null's time in the market | model asks refused, on the gate's path |
|---|---|---|---|---|---|
| shipped · Coinbase | A | 56 % (55 → 31) | 41.4 → 33.9 % (82 %) | 22.5 % | 76 % |
| shipped · Coinbase | B | 66 % (35 → 23) | 55.1 → 48.9 % (89 %) | 32.5 % | 74 % |
| shipped · Coinbase | C | 67 % (30 → 20) | 56.0 → 53.3 % (95 %) | 37.9 % | 66 % |
| shipped · Coinbase | D | 60 % (43 → 26) | 38.8 → 30.0 % (77 %) | 22.0 % | 81 % |
| shipped · Kraken | A | 56 % (55 → 31) | 41.4 → 33.9 % (82 %) | 23.1 % | 76 % |
| shipped · Kraken | B | 67 % (36 → 24) | 54.8 → 48.7 % (89 %) | 33.4 % | 73 % |
| shipped · Kraken | C | 67 % (30 → 20) | 56.0 → 53.4 % (95 %) | 36.7 % | 64 % |
| shipped · Kraken | D | 60 % (43 → 26) | 38.8 → 30.0 % (77 %) | 22.2 % | 81 % |
| trail · Coinbase | A | 56 % (122 → 68) | 23.5 → 12.9 % (55 %) | 13.3 % | 75 % |
| trail · Coinbase | B | 60 % (124 → 75) | 33.4 → 21.7 % (65 %) | 20.0 % | 74 % |
| trail · Coinbase | C | 69 % (115 → 79) | 30.7 → 21.0 % (68 %) | 21.1 % | 69 % |
| trail · Coinbase | D | 52 % (106 → 55) | 21.9 → 12.2 % (56 %) | 11.8 % | 79 % |
| trail · Kraken | A | 55 % (124 → 68) | 23.1 → 12.9 % (56 %) | 12.5 % | 75 % |
| trail · Kraken | B | 62 % (125 → 77) | 33.0 → 21.3 % (64 %) | 19.5 % | 73 % |
| trail · Kraken | C | 69 % (122 → 84) | 28.8 → 19.6 % (68 %) | 19.8 % | 68 % |
| trail · Kraken | D | 52 % (106 → 55) | 21.9 → 12.2 % (56 %) | 11.7 % | 79 % |

The rule keeps asking while 30-day momentum stays positive. So under the
shipped stop the model refuses 91–95 % of the times it is asked every 4 hours,
and 64–81 % once a day. Many refused episodes still end in an entry once the
4-hour picture turns.

Under the shipped stop, the gated row keeps:
- 53–67 % of the rulebook's entries
- 76–95 % of its time in the market

Under the trail, the stop exits more often and each re-entry is asked again,
so it keeps less:
- 52–69 % of the entries
- 55–72 % of the time in the market

The row still trades. Under the shipped stop, the gated row holds the coins
30–35 % of the time in the bear and sideways windows, and 49–55 % in the bull
windows.

## 7. The verdict against the bar

- **trend-1h fails in all four evaluations.** It lowers the worst window every
  time, and the null does as well or better on it in 88.4–96.9 % of draws.
- **momentum-1d, every 4 hours, fails.**
  - Under the trail it lowers the worst window, on both tapes.
  - Under the shipped stop it raises the worst window (A), but does not beat
    the null there: P = 0.341 and 0.295.
  - On §3.17's reading, momentum never carried the trail, so its shipped
    evaluations are its only ones. It still fails, on the null.
- **momentum-1d, once a day (as the loop runs it), fails in all four
  evaluations.** It lowers the worst window by 4.2–15.1 points, and
  P = 0.753–0.999.
- **Judged on return ÷ drawdown instead**, and **on the stricter reading** that
  the worst window must rise, the verdict is the same for all three rows.

Only one verdict cell rests on the null: momentum-1d's two shipped
evaluations at the 4-hour cadence. Every other cell fails on the rulebook
comparison alone.

## 8. What follows, and what does not

**What follows.**

1. By the bar that kept the gate on the live candidate, the fixed gate is not
   supported on either paper row.
   - On trend-4h it refused nothing in the worst window, so it cost nothing
     there.
   - On trend-1h, the same refused set (a weak trend in high volatility) costs
     the worst window in all four evaluations.
   - On momentum-1d as the loop runs it, the gate costs the bear year 4–15
     points.
2. Since migration 0047, these rows' paper records measure rule ∧ gate. That
   is not the rulebooks the published tables price, so the records are not
   evidence about those rulebooks. For momentum-1d, the published rulebook is
   also priced at a cadence the loop does not run (§5).
3. There are two options for the paper rows, and the choice is Davies'.
   - Leave the gate on. The rows then measure the gate, at the price above.
   - Put the two rows in shadow (`params.jevGate: false`). The model is still
     asked and recorded, and the records measure the rulebooks.

**What does not follow.**

1. **That another threshold would clear the bar.** None was chosen before this
   backtest.
   - For trend-1h, the replies give trend-4h's deterministic band, and 0.45
     sits in it.
   - For momentum-1d, no threshold in 0.30–0.64 decides every state the same
     way on every call.
   - A threshold picked now would be picked on the windows that score it
     (§3.11, §3.19). No threshold is recommended.
2. **That the gate improves momentum-1d's bear year.** At the 4-hour cadence
   under the shipped stop it does: A goes from −8.1 to −6.1 %. But:
   - a same-size random veto does as well or better there in 34.1 % and 29.5 %
     of draws;
   - the loop does not run that cadence;
   - at the cadence it runs, the gate makes the bear year worse: −9.0 to
     −15.8 %.
3. **That the gate beats random in momentum-1d's bull windows.** Eight
   per-window cells have P ≤ 0.05 (0.007–0.049): windows B and C, under the
   shipped stop, at both cadences, on both tapes. In every one of them, the
   entry-matched null holds the coins 15.3–17.8 points less of the time than
   the gate. On the primary evaluation, B is 51.6 % against 35.7 %, and C is
   54.7 % against 37.3 %.
   - The reason: the gate delays a momentum entry until the 4-hour picture
     turns. The null skips a whole momentum episode, which on this rule lasts
     weeks. In a rising window, time in the market is return.
   - Under the trail, the two hold the coins within 3.4 points of each other.
     There the same bull windows give P = 0.080–0.696.
   - So those cells measure exposure, not selection. None of them is a worst
     window.
4. **That the null is a clean test for momentum-1d under the shipped stop.**
   The same gap favours the null in falling windows: in A the gate holds the
   coins 35.3 % of the time and the null 24.1 %.
   - So the one verdict cell that rests on the null is not a clean test in
     either direction.
   - The verdict does not depend on it: the trail evaluations and the daily
     cadence fail on the rulebook comparison alone.
   - trend-1h's null is clean: the gate and the null hold the coins within 0.4
     points.
5. **That the gate switches momentum-1d off.** It does not (§6).
6. **That trend-1h's gate is proven worse than random.** P = 0.884–0.969 on
   the worst window is short of the tail, on four near-duplicate evaluations
   (§3.19).
7. **Anything about the model beyond these rules.**
   - The replies are today's model (`typesafe/jev-1.13-20260917`, measured
     2026-09-23 00:24 UTC), five per state. No missing answer or echo failure
     is modelled; either would be a veto in production.
   - The four evaluations are near-duplicates, and window D is the same on
     both tapes.

## 9. Checks

- **Fidelity.** `runGated` through the flat-bar cache was checked against a
  decider that rebuilds the snapshot and the cadence on every bar. On the rows
  decided every bar, it was also checked against `backtest.ts`'s `run`.
  - 276 cells, 180 of them against `run`
  - 0 field mismatches
  - 0 of 160,736 `run` equity points off
  - 0 of 1,178,756 marks off
  - 0 of 938,642 flat bars off the cache
- **The rule arms equal the published rows:** 28 cells, worst |Δ| 0, and any
  difference would have thrown.
  - momentum-1d (every 4 hours) against `set2.json`'s
    `momentum-1d·revx (paper)` on all four evaluations, and against
    `testingset.json`'s on shipped · Coinbase
  - trend-1h against `testingset.json`'s `trend-1h·revx` on the Coinbase tape,
    under both stops
- **Window D** is identical on both tapes: 6 row × stop-rule pairs, 0
  differences.
- **Shadow mode** (`combineDecision(…, gate = false)` with real draws) equals
  the rulebook: 920 runs, 0 differences. The gate it bypassed would have
  refused 37,828 of the 92,240 entries it was shown.
- **The hourly bars** trend-1h reads resample to `loadMeasuredSeries`'s 4-hour
  and daily series candle for candle, on all three coins.
- **The daily cadence** was counted over its 24 tape × window × coin cells:
  8,940 days and 8,922 decision bars. On 18 days a missing 20:00 UTC bar
  leaves no decision.
- **The port against the earlier draft.** The earlier run's log ends at
  1,567 s, after 15 lines: the data, fidelity, window-D and shadow lines, and
  eleven priced lines. This file's run prints all 15 identically (`diff`). It
  adds the twelfth priced line (momentum-1d once a day, trail · Kraken) and
  the tables.
- **Determinism.** Two processes wrote to separate output directories: run A
  (05:26:32–05:39:10 UTC, into the worktree's `docs/agents/backtests/`) and run B
  (05:26:35–05:39:13 UTC, into a scratch directory). They wrote byte-identical
  files, and `cmp` agrees. Both sha256s are
  `e4958cbb411b2615f24d617bdb576507a807a3d446c2201a50712aae74eff91f`.
- **An earlier pair of runs.** Before a comment fix in the script's header and
  one added caveat line, an earlier pair (05:01–05:17 UTC, script
  `1950ab4e…`) also wrote byte-identical files, sha256 `6d76bfa6…`. The final
  file equals that one in every field except `caveats` (one line added) and
  the script's own hash in `sourceIntegrity`. Every priced log line of the
  two pairs is identical.
- **Sources.** Each run hashed its sources at the start and at the end; none
  changed. They are recorded in `sourceIntegrity`:

  | file | sha256 |
  |---|---|
  | `backtest.ts` | `31d27c7d82f8a94c…` |
  | `backtest_jev.ts` (unmodified) | `4d5af9e50255e6ff…` |
  | `backtest_jev_other.ts` | `314334d9d584db9b…` |
  | `agents_strategy.ts` | `097c9519e65aca13…` |
  | `jev_answers_v2_other.json` | `0b3ee6bf624268eb…` |
  | `set2.json` | `60a84be43fdb95a1…` |
  | `testingset.json` | `4df302db51f1d38a…` |

  After both runs,
  `sha256sum supabase/functions/agents/backtest_jev.ts supabase/functions/agents/backtest.ts`
  printed `4d5af9e50255e6ffb686ac3704fd97a7a98d5e5219d6b20babf3580beea2d2ed`
  and `31d27c7d82f8a94c1a8d71248ace8e5ded611190a77d06043460b469ccae845a`.
- **Type check.** `deno check --quiet supabase/functions/` passes on Deno
  1.46.3 with the new file in the tree.

## 10. Reproducing it

From the repository root, on Deno 1.46.3 (the Deno CI runs):

```
deno run --allow-read --allow-write supabase/functions/agents/backtest_jev_other.ts \
  --data  <dir with BTC-USD_1h_3y.json …> \
  --ext   <dir with BTC-USD_1h_kraken.json …> \
  --ktape <dir with BTC-USD_4h_kraken.json …>
```

The defaults are:
- `--answers docs/agents/backtests/jev_answers_v2_other.json`
- `--set2 docs/agents/backtests/set2.json`
- `--testingset docs/agents/backtests/testingset.json`
- `--out docs/agents/backtests`
- `--draws 2000`, `--null-draws 1000`

It writes `jev_v2_other.json` and nothing else. The three directories must
also hold AVAX's and SUI's files, because `loadMeasuredSeries` cuts the
windows for all five live-row coins.

Two runs in separate processes wrote identical files, and the main
session's re-run on the committed tree wrote the same bytes again (sha256
above). The tape files those runs read, by sha256 (first 16 hex digits):

| file | sha256 (first 16) |
|---|---|
| `ohlcv/BTC-USD_1h_3y.json` | `c773e6ff90876fe7` |
| `w3/ext/BTC-USD_1h_kraken.json` | `59d4c1fd2cc41f87` |
| `ktape/BTC-USD_4h_kraken.json` | `a1109d82eb9f664c` |
| `ohlcv/ETH-USD_1h_3y.json` | `5d922a8ba568d4a0` |
| `w3/ext/ETH-USD_1h_kraken.json` | `cc48c3001dc09557` |
| `ktape/ETH-USD_4h_kraken.json` | `614d5c26f78ce140` |
| `ohlcv/SOL-USD_1h_3y.json` | `8a23665b70c0f1df` |
| `w3/ext/SOL-USD_1h_kraken.json` | `a0c55179ca0a6d72` |
| `ktape/SOL-USD_4h_kraken.json` | `3fe744017799f283` |
| `ohlcv/AVAX-USD_1h_3y.json` | `8713037a9aaff475` |
| `w3/ext/AVAX-USD_1h_kraken.json` | `b4d01720a8963341` |
| `ktape/AVAX-USD_4h_kraken.json` | `99482cd140ad9fb5` |
| `ohlcv/SUI-USD_1h_3y.json` | `f0af67619e5731a9` |
| `w3/ext/SUI-USD_1h_kraken.json` | `9006035ad389a62c` |
| `ktape/SUI-USD_4h_kraken.json` | `033672f4f7840eb4` |
