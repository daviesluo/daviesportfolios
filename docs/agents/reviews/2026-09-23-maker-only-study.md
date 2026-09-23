# Maker-only rules on Revolut X: pre-registered study (2026-09-23)

**Verdict: no.** None of the six candidates passes. Every window-A cell is
negative except one (+0.1 %), and that cell fails the null and plateau tests.
The 0 % fee is worth 7.6–96.2 points of sleeve return a window (maker minus
the same fills at taker cost), and these rules still lose in the bear year.

**Pre-registration.**
- `docs/agents/reviews/2026-09-23-maker-only-prereg.md`, frozen 07:07:00Z before any candidate read a
  real price; sha256 `0eb9236f…`, recorded in `maker.json`. No corrections.
- Before the freeze, only `definitions` (no candidate) and a `smoke` run on a
  seeded synthetic walk had run.

**Reproduction.**
- The incumbent equals `set2.json`'s `equal` row on 16 cells, worst |Δ| 0.
  Window A, primary evaluation: +8.03 %, DD 11.28 %.
- The new simulator in market mode equals `run` on 72/72 cells.
- Fill-rule unit checks: 10/10.
- An independent Python re-implementation matches 10 sampled cells to 4 dp.
- Two runs gave the same sha256, `b979aa54…`; the committed `maker.json`, written with the repository's paths, is `ead3d844…` and differs only in those strings.

**Design.**
- Post-only orders on the tick grid, one-bar life. A bid fills only if the
  bar trades ≥ 1 tick through it, fee 0. Stops are taker, checked first.
- Shapes on 1h and 4h: `rsi2` (§3.6's RSI(2) pullback and its grid), `band`
  (lower Bollinger band to the mean) and `dip` (a·ATR under the close in an
  uptrend).
- BTC, ETH and SOL decide; AVAX is secondary.
- Null: the arm's entry count and holding times at random times, 1,000 draws.
- Bar: on window A AND window B, in every evaluation priced there, the
  three-coin sleeve needs return > 0, drawdown < 35 %, P(null ≥ arm) ≤ 0.05,
  and ≥ 50 % of its grid positive.

**Incumbent**, return %:

| win | shipped·cb | shipped·kr | trail·cb | trail·kr |
|---|---|---|---|---|
| A | +8.0 | +9.2 | −0.3 | +6.5 |
| B | +20.1 | +22.5 | +12.6 | +13.8 |
| C | +55.6 | +50.9 | +47.1 | +38.3 |
| D | −7.8 | −7.8 | −3.2 | −3.2 |

**Candidates**: each cell is maker / same fills at taker cost / null p95, three-coin sleeve %.
**Bold** = the cell passes all four tests. — = unpriced (Kraken's hourly
bundle ends 2026-06-30).

| cand · win | shipped·cb | shipped·kr | trail·cb | trail·kr |
|---|---|---|---|---|
| rsi2-1h A | −10.6/−96.7/+3.2 | — | −24.6/−107.3/−7.2 | — |
| rsi2-1h B | **+32.6/−63.6/+27.6** | −20.5/−106.5/−7.6 | **+20.8/−72.9/+3.7** | −29.0/−111.2/−28.3 |
| rsi2-1h C | +30.8/−58.2/+33.0 | −3.2/−87.6/+1.3 | +15.0/−72.8/+16.2 | −8.3/−90.7/−17.4 |
| rsi2-1h D | −15.3/−89.8/−9.1 | — | −25.7/−96.8/−23.1 | — |
| rsi2-4h A | −13.0/−32.1/+11.6 | −19.5/−39.0/+5.5 | −16.2/−34.7/+5.4 | −22.1/−39.7/+2.0 |
| rsi2-4h B | −19.1/−44.5/+29.2 | −19.4/−41.0/+21.8 | −19.4/−43.0/+22.4 | −19.2/−41.2/+18.4 |
| rsi2-4h C | +11.5/−13.4/+35.7 | +7.4/−16.3/+29.2 | +16.3/−8.1/+29.5 | +12.3/−10.9/+19.4 |
| rsi2-4h D | −18.1/−38.5/+10.8 | −18.1/−38.5/+13.2 | −28.7/−46.5/+7.4 | −28.7/−46.5/+6.9 |
| band-1h A | −48.7/−91.2/+7.2 | — | −39.1/−73.5/+2.2 | — |
| band-1h B | −19.5/−78.7/+37.9 | +19.9/−6.2/+27.7 | −20.2/−91.5/+15.4 | +22.3/−5.4/+5.5 |
| band-1h C | +5.6/−17.7/+37.6 | +12.2/−10.7/+28.4 | −9.7/−40.9/+24.4 | −10.6/−40.5/+11.4 |
| band-1h D | −9.2/−36.6/+19.2 | — | −39.3/−68.6/−0.7 | — |
| band-4h A | −29.7/−37.7/+13.4 | −44.4/−57.4/+5.7 | −43.2/−56.8/+4.6 | −41.2/−54.8/+4.2 |
| band-4h B | +7.1/−9.4/+41.1 | +1.1/−15.3/+34.5 | +20.0/+2.8/+35.4 | +15.6/+1.5/+27.4 |
| band-4h C | +20.4/+11.7/+45.7 | +7.0/−1.6/+41.3 | +9.2/−0.0/+36.2 | −0.1/−9.0/+30.2 |
| band-4h D | −33.9/−41.5/+24.8 | −33.9/−41.5/+27.0 | −29.9/−39.3/+18.4 | −29.9/−39.3/+18.3 |
| dip-1h A | −12.9/−78.1/+3.1 | — | −20.0/−81.8/−5.9 | — |
| dip-1h B | +13.0/−72.7/+36.1 | −23.2/−93.6/+8.5 | −4.9/−95.9/+7.7 | −31.2/−90.7/−10.4 |
| dip-1h C | +42.7/−31.7/+72.8 | +3.0/−71.5/+42.9 | +6.3/−36.8/+21.2 | −17.3/−62.6/+2.9 |
| dip-1h D | −40.1/−94.9/+10.4 | — | −53.0/−101.7/−8.3 | — |
| dip-4h A | −22.1/−38.9/+7.6 | −15.5/−30.1/+5.1 | −13.2/−26.9/+6.7 | +0.1/−11.5/+4.8 |
| dip-4h B | +26.9/+10.3/+42.2 | −2.1/−18.8/+43.3 | +30.3/+13.9/+37.9 | +26.1/+13.2/+32.5 |
| dip-4h C | +6.1/−11.6/+43.9 | −14.5/−31.7/+37.7 | −6.1/−25.9/+33.4 | −16.5/−36.2/+21.2 |
| dip-4h D | −3.0/−17.9/+29.3 | −3.0/−17.9/+29.3 | −15.6/−30.5/+14.5 | −15.6/−30.5/+11.9 |

`combine` holds each slot at a fixed notional, which is why a sleeve can read
below −100 %.

**Against the bar.**
- rsi2-1h passes window B on Coinbase's tape (P 0.022 and 0.003) but loses
  there on Kraken's, and it fails window A.
- band-1h, band-4h, dip-1h and dip-4h are each positive in window B on some
  evaluations. Every one of those cells fails the null or the plateau.
- Per coin (§4.15): 0 of 24 coin-cells clear window A and 1 clears window B.
  That is 0 two-window passes, against 0.00 expected by chance. The chance
  count is 0 because nothing clears A at all.
- AVAX changes no verdict.

**Why.**
- **The fill rule.** Two ticks through changes returns by ≤ 1.1 points (a
  tick is 0.002–0.5 bps). Requiring 10 bps through turns three of the four
  positive A/B primary sleeves negative (rsi2-1h B +32.6 → −58.8) and cuts
  dip-4h B from +26.9 to +7.9.
- **The tape** (post-hoc). rsi2-1h in window B, same parameters on each tape:

  | coin | Coinbase tape | Kraken tape |
  |---|---|---|
  | BTC | +41.2 % | −8.1 % |
  | ETH | +35.8 % | −3.9 % |
  | SOL | +22.6 % | −22.6 % |

  The two tapes' hourly lows differ by a median of only 3–4 bps. The edge is
  no larger than that disagreement.
- **Binance.** At 10 bps a side, the result stays within 1.5 points of the
  taker-cost arm. Neither venue can run these rules.

**The UK book, window A, 4h, descriptive.**
- Three-coin sleeves: −14.9, −26.3 and −11.5 % (Kraken's tape: −19.5, −44.4
  and −15.5 %).
- AVAX alone: +1,937 % and +536 %, where Kraken's tape gives −30.1 and −22.5 %.
  **UNVERIFIED, likely a candle artefact:**
  - its UK wicks are about twice Kraken's;
  - its UK lows sit a median 20 bps from Kraken's (p90 280), against 2.8 bps
    for BTC.
  - AVAX's 0042 probe record can test it.

**Combination** (best candidate by min(A, B) = rsi2-1h, primary evaluation).
Daily correlation with the incumbent: 0.25 / 0.42 / 0.42 / 0.32. Each cell is
return % / max drawdown %:

| win | incumbent | rsi2-1h | half each |
|---|---|---|---|
| A | +8.0/11.3 | −10.6/28.3 | −1.3/19.0 |
| B | +20.1/10.5 | +32.6/9.5 | +26.3/8.6 |
| C | +55.6/7.3 | +30.8/6.5 | +43.2/5.9 |
| D | −7.8/15.5 | −15.3/21.6 | −11.6/15.0 |

- Half each makes the worst window worse (D: ret/DD −0.77 against the
  incumbent's −0.50).
- Against the four-coin incumbent the picture is the same.
- band-4h is uncorrelated with the incumbent (ρ ≈ 0) but loses −29.7 % in
  window A and −33.9 % in window D.

**Orders.**
- At most 100 a day (a 1h shape on four coins), 24 for the 4h shapes.
- Re-quoting every minute would breach the 1,000 cap.

**What follows.** Seed no maker rule on Revolut X; a zero fee is not an edge.
The live 0042 maker-probe record is what could reopen this.

**What does not follow.**
- That resting orders are useless for the trend rule (§3.13 owns that).
- That no maker rule could ever work.
- An AVAX opportunity.

**Reproduce, from the repository root.** The frozen pre-registration is
`docs/agents/reviews/2026-09-23-maker-only-prereg.md` (sha256 `0eb9236f…`) and
Revolut X's pair configuration the run checked its ticks against is
`docs/agents/backtests/inputs/revx_pairs_2026-09-23.json`. The price data are
not in the repository: Coinbase hourly (`--data`), Kraken's hourly extension
(`--ext`), Kraken's own 4 h tape (`--ktape`), the inputs every sibling study
uses, and Revolut X's public UK 4 h candles (`--revx`, window A only).

```sh
deno run --allow-read --allow-write supabase/functions/agents/backtest_maker.ts \
  --data <dir with BTC-USD_1h_3y.json …> --ext <dir with BTC-USD_1h_kraken.json …> \
  --ktape <dir with BTC-USD_4h_kraken.json …> --revx <dir with BTC-USD_4h_revx.json …> \
  --pairs docs/agents/backtests/inputs/revx_pairs_2026-09-23.json \
  --set2 docs/agents/backtests/set2.json \
  --prereg docs/agents/reviews/2026-09-23-maker-only-prereg.md --out docs/agents/backtests
```

`--stage definitions` prints the facts the pre-registration used. The study
ran twice with the same bytes; the main session re-ran it on a clean tree with
the same bytes, then once more from the repository with the paths above, which
changed only the pre-registration's path string and the file's own hash in
`maker.json` — every number is the same. The independent Python
re-implementation that matched ten sampled cells was a session script and is
not kept.
