# DEADLINE-NO: the 2024 test, and the deep check — it is noise

Research only (2026-10-13, 13:45–14:30 UTC). Nothing was placed, armed or built. Every read was a keyless public GET:
Gamma's keyset, CLOB `/prices-history`, and the data API's `/trades`. Scripts and outputs are in
`docs/agents/backtests/pmopps/` (`MANIFEST.json`).

The pre-registration, `reviews/2026-10-13-deadline-no-2024-prereg.md`, was frozen in commit
`74a6833b52ce25ecd4ec3ff90d96bc06cc9f3f37` at 2026-10-13 13:45:25 UTC. The script is `deadline_no.py`, sha256
`a8d664e4…2cde`. Its first read of a 2024 market came after that: `pull_closed.py 2024-01 2024-12` wrote its first 2024 file at 13:45:32 UTC, seven seconds after the freeze.

Davies, 2026-10-13, verbatim:

> 好的 继续深度检验和验证这两个

In English: good, keep testing and verifying these two in depth.

## The answer in plain words

- **2024 fails the frozen bar.**
  - Only 71 trades in 59 events met the rule, where the bar asks for 150 in 100.
  - The mean was +5.6 % a trade, but its 5 % bound was −6.2 %.
  - One event was 29.9 % of the total.
- **The deep check says the edge is not there.**
  - **The 2026 "held out" read was half-sample luck.** PMOPPS read 2026 on a one-in-two sample, at +7.1 %. Every 2026
    market reads +1.8 % [−6.1 %, +9.3 %].
  - **Only the exact entry day works.** The edge appears at T − 7 days and nowhere near it: pooled over 2024–2026,
    T − 5, 6, 8, 9 and 10 days read between −3.7 % and +0.8 % a trade.
  - **Real fills take it away.** With the price takers really paid on the tape and today's fees, it falls to +2.2 % at
    the tape's median price and −0.2 % at its 75th percentile.
- **DEADLINE-NO is closed.** There is no paper test to draft, because the pre-registration says a FAIL closes it.

## 1. The frozen run (`results/deadline_no_2024.txt`)

| bar | 2024 | verdict |
|---|---|---|
| 1. ≥ 150 trades in ≥ 100 events | 71 trades in 59 events (971 markets in the universe, 632 with a price at T − 7 d) | **FAIL** |
| 2. mean > 0, 5 % event-bootstrap bound > −0.02 | +0.0558 [−0.0618, +0.1737]; won 73.2 % | **FAIL** |
| 3. each half-year > 0 | H1 +0.1313 (19 trades); H2 +0.0283 (52) | PASS |
| 4. no event over 25 % of the total | the Trump–Harris polling margin of Oct 25: +1.184 of +3.964 (29.9 %) | **FAIL** |
| **verdict** | | **FAIL** |

**Reported with the verdict.**

- **T − 14 days (sign check):** +0.1716 [+0.0223, +0.3024] on 52 trades. The check holds.
- **Today's taker rates by category:** +0.0423.
- **The tape.** 66 of 71 entries had NO buyers (or YES sellers) within 6 hours.
  - They paid a median 1.50 ¢ over 1 − YES (p10 −1.00, p90 +10.00); the rule assumed 1.00 ¢.
  - They took a median 804 shares within 2 ¢ of our price (p10 12). So $20–50 a trade would have found a seller.

## 2. The deep check (`deadline_robust.py`, `results/deadline_robust.txt`; reported apart, read once, description only)

The same universe, prices and trade, on every market of 2024, 2025 and 2026, with no sample. The full-year frozen runs
are in `results/deadline_no_2025_full.txt` and `results/deadline_no_2026_full.txt`.

- **2025** (the year the rule was chosen on): +0.0848 [+0.0089, +0.1561], 189 trades. It also fails the halves (H1
  −0.027).
- **2026**: +0.0182 [−0.0608, +0.0927], 234 trades. One event (who meets with Iran by April 30) is 63.7 % of the
  total.

**The entry day** (YES 0.20–0.50, return per $1 [event bootstrap 5–95 %]):

| T − d | 2024 | 2025 | 2026 | pooled |
|---|---:|---:|---:|---|
| 5 | +0.105 | +0.037 | −0.048 | +0.008 [−0.038, +0.055] |
| 6 | +0.044 | +0.032 | −0.048 | −0.005 [−0.055, +0.043] |
| **7** | +0.056 | +0.085 | +0.018 | **+0.049 [−0.001, +0.095]**, 494 trades |
| 8 | −0.075 | +0.046 | −0.010 | +0.001 [−0.046, +0.050] |
| 9 | −0.097 | +0.038 | −0.009 | −0.003 [−0.053, +0.046] |
| 10 | −0.053 | +0.004 | −0.062 | −0.037 [−0.087, +0.009] |
| 14 | +0.172 | +0.051 | −0.018 | +0.024 [−0.023, +0.071] |

A real time-value overpricing would not live on one day of the calendar and vanish a day either side. The T − 7 figure
is the best of a scan PMOPPS made on 2025, and its neighbours are what the market does on average: about zero.

**The band at T − 7 days**, pooled:

| YES band | trades | return per $1 [5–95 %] | NO won |
|---|---:|---|---:|
| 0.15–0.20 | 203 | −0.025 [−0.080, +0.028] | 81.8 % |
| 0.50–0.60 | 90 | −0.103 [−0.289, +0.079] | 42.2 % |

**By category** (the frozen rule, pooled):

| category | trades | return per $1 [5–95 %] |
|---|---:|---|
| crypto | 22 | +0.170 [−0.041, +0.359] |
| tech/AI | 36 | +0.128 [−0.063, +0.310] |
| geo/war | 134 | +0.055 [−0.044, +0.156] |
| other | 170 | +0.044 [−0.029, +0.123] |
| politics | 84 | +0.026 [−0.098, +0.150] |
| sports | 48 | −0.025 [−0.148, +0.101] |

No category is significant, and none was chosen in advance.

**Realistic fills** (the frozen rule, pooled):

| fill | trades | return per $1 [5–95 %] |
|---|---:|---|
| as frozen | 494 | +0.049 [−0.001, +0.095] |
| the tape's median NO price + today's fee | 438 | +0.023 [−0.028, +0.075] |
| the tape's 75th percentile + today's fee | 438 | −0.002 [−0.050, +0.050] |

56 trades had no NO taker within 6 hours and are left out of the two tape rows. The 1 ¢ half-spread the rule assumed
was about right at the median and optimistic for a quarter of entries. Today's fees (0.04–0.07 × p × (1 − p)) take a
further 1–2 ¢ a trade that 2024's and early 2025's markets did not charge.

**Clustering.**
- 494 trades fall in 388 events, and 78 events hold two or more trades (184 trades).
- In 37 of those 78, every trade won or every trade lost together.
- The within-event correlation of losses is −0.14: sibling dates in one event tend to split. So the event bootstrap
  is if anything conservative, and clustering is not what hides an edge.
- The worst events cost a whole $1 a trade, for example "Iran military response by" (2025, 2 trades) and "Claude Mythos
  released by" (2026, 2 trades).

## Verdict

- **Noise.** The frozen 2024 test fails three of its four conditions.
- Across three years and every market:
  - the frozen rule makes +4.9 % a trade, with a range touching zero;
  - realistic fills bring it to +2.2 % at best;
  - the days either side of T − 7 are flat.
- At $20 a trade and about 0.75 trades a day, the realistic figure is about +$0.3 a day, inside a range from −$0.4 to
  +$1.1. **DEADLINE-NO is closed. No forward paper test is drafted.**
- **The general point.** Polymarket's deadline markets price time decay about right a week or two out. Earlier work
  found the same of favourites (FAV) and longshots (PMOPPS's buckets under 0.20).

## Not checked

- The book's depth at the ask, which the CLOB does not keep. The tape's prints within ±6 hours are the stand-in.
- Markets under $20,000 of volume.
- Whether a maker bid for NO, instead of a taker, would do better. That is a different rule, with the adverse
  selection LP-ADVERSE measured.
