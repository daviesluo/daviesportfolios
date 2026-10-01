# Pre-registration DFC: the month-end "dash for cash" in US equities, 2016-01 → 2026-08

Drafted 2026-10-01 (UTC) by a research agent (EQ2), revised the same day after an independent review (findings B1–B7
and N1–N10), and again after that review's second pass. Frozen by the commit that adds this file, at that commit's time.
Any change after that is a deviation and is reported as one. It trades nothing, arms nothing and changes nothing that
runs.

Davies, 2026-10-01, on EQ1's turn of the month and post-earnings drift: "这两个方向你觉得要是还值得研究的话可以深度研究下，之后要是可以
live的话我可以给你trading 212的isa 账户有交易授权的api" (if these two are still worth it, research them deeply; if one can
go live, he can give a trading-enabled API key for his Stocks ISA, a GBP account); and on his USD Invest account:
"可以探索研究美元策略，你深度研究下" (USD strategies can be explored; research them deeply). EQ2
(`docs/agents/reviews/2026-10-01-research-round.md` §4 and §8; reference §3.44) found that post-earnings drift
cannot be tested cleanly and that EQ1's turn of the month is the weakest part of the month-end pattern; this file tests
the pattern's stronger, published form. Whether US equities run in either account is Davies' decision; a pass here
decides nothing that trades.

## 1. The question

Etula, Rinne, Suominen and Vaittinen ("Dash for Cash: Monthly Market Impact of Institutional Liquidity Needs", RFS
33(1), 2020; working paper of 2017-12-28, US sample to 2013-12) show that institutions that must pay cash on the morning
of the last business day of a month (T) sell equities by the settlement deadline, T−(s+1) for a settlement cycle of s
days, and buy back once paid. US returns are low over the five days to the deadline (S) and high from the deadline to
the third day of the new month (PB). Since 1995-06 (T+3), they report −37 bp abnormal over S = [T−8, T−4] and +48 bp
over PB = [T−3, T+3] a month.

Two questions, on data no screen of this account has read: does the pattern persist in US equities from 2016-01 to
2026-08, and is the one rule it implies that can beat holding the index — out of the market over S, in otherwise (the
**dodge rule**) — worth running?

Why this and not EQ1's turn of the month (TOM, [T, T+3]): on the pre-2016 screen TOM is the weakest part of the
month-end pattern since 1990, because the high days moved before the month end, which is what the settlement mechanism
predicts once US settlement went to T+3 in 1995 (§5).

## 2. The unit

A **month turn**: T is the last trading day of a month in the input's date column. Events are the turns with T from
2016-01 to 2026-07, so that every window lies inside the file's 2026-08-31 end: **127 events** (first T 2016-01-29, last
T 2026-07-31). Trading days are the rows of the input; "T−k" is k rows before T, "T+j" the j-th row after it.

## 3. The two hypotheses, the measure and the family

For each event, from CRSP's value-weighted market excess return (`Mkt-RF` of Ken French's
`F-F_Research_Data_Factors_daily`):

**D = mean daily excess return over PB − mean daily excess return over S**, in basis points a day. Per-day means, so no
drift term enters the null.

* **H1, settlement-adjusted** (the paper's mechanism): s = 3 for turns with T before 2017-09-05, s = 2 from 2017-09-05
  (T+2) and s = 1 from 2024-05-28 (T+1). PB = [T−s, T+3], S = [T−(s+5), T−(s+1)]. The regime is assigned by T's date;
  for all 127 turns it equals the cycle in force on the selling deadline T−(s+1). Counts, from the calendar only: 20
  turns at T+3, 80 at T+2, 27 at T+1. The switch months:

  | Month | Cycle | S | PB |
  |---|---|---|---|
  | 2017-08 | T+3 | 08-21 … 08-25 | 08-28 … 09-06 |
  | 2017-09 | T+2 | 09-20 … 09-26 | 09-27 … 10-04 |
  | 2024-04 | T+2 | 04-19 … 04-25 | 04-26 … 05-03 |
  | 2024-05 | T+1 | 05-22 … 05-29 | 05-30 … 06-05 |

* **H2, fixed** (the paper's windows as published): PB = [T−3, T+3], S = [T−8, T−4].

The null for each: the mean of D over the 127 events is at most 0.

**p**: one-sided, from 10,000 bootstrap resamples of the 127 events with replacement. Each hypothesis starts a fresh
`random.Random(20261001)`; a resample is 127 draws of `rnd.randrange(127)` over the events in T order; p is the count of
resampled means at or below 0, plus one, over 10,001, decided unrounded. The t-statistic is reported beside it. The
windows of one turn do not overlap the next turn's; on pre-2016 data D's lag-1 autocorrelation is −0.11, −0.01 and
+0.11 (1926–1989, 1990–2015, 2003–2015), so the claim of near-independence stands for the mean, but |D| clusters
(lag-1 autocorrelation 0.15, 0.30, 0.36), so the halves and best-month conditions are lumpier than independent draws
suggest.

**The family.** DFC is frozen alone: Holm across H1 and H2 only. The smaller p clears at 0.025, the other then at 0.05.
Equal p's are treated alike: both clear at 0.025 or below, neither above it. A hypothesis of this round frozen later
(IS49, TAC) is a family of its own and cannot borrow this one's α.

## 4. The bar

A hypothesis passes only if every condition holds for it. Every condition is decided by the scorer from unrounded
values; the write-up reports its booleans and does not re-decide them. A condition that cannot be computed fails.

1. **The test**: it clears its Holm step.
2. **Each half**: mean D > 0 over events 1–63 (T to 2021-03-31) and over events 64–127.
3. **The dodge rule makes money**: out of the index from the close of the day before S to the close of S's last day, in
   otherwise; per event, its return against buy and hold is −(sum of the daily excess over S) − the round trip, with
   the cash earning the T-bill rate (`RF`) while out. At **8 bps a round trip**: total > 0 over the window and > 0 in
   each half. The same with cash earning nothing is reported (§8).
4. **Double cost**: at 16 bps, total > 0 over the window (implied by condition 6 at +1.0 % a year; it would bind only if
   condition 6's level were below +0.96 %).
5. **Not one month**: at 8 bps, the total without its best month (the event with the largest net return at 8 bps,
   named by T's month, in which S lies; the earlier on a tie) is > 0, and that month is at most 40 % of the total.
6. **Worth money**: at 8 bps, the dodge rule's active return is at least **+1.0 % a year** (twelve times the mean per
   event). At £10k that is £100 a year.

If H1 and H2 both pass, the rule that runs is H1's (it follows the settlement cycle in force, T+1 since 2024-05-28). A
test pass without the money conditions means the pattern lives and the dodge rule does not pay: nothing runs.

## 5. Power and what was screened (pre-2016 data only)

D on CRSP VW, per event (`D_SPREAD` in EQ2's `power_calendar.json`: the test's D on H2's windows):

| Screen period | Mean D | SD | Expected held-out t (127) | Power, one-sided 5 % | Holm first step (2.5 %) | At half the effect (5 %; at 2.5 %: 0.23, 0.20, 0.24) |
|---|---:|---:|---:|---:|---:|---:|
| 1990–2015 | 15.46 bp/day | 71.4 | 2.44 | 0.79 | 0.68 | 0.34 |
| 2003–2015 | 15.86 | 79.4 | 2.25 | 0.73 | 0.61 | 0.30 |
| 1926–1989 | 13.46 | 61.0 | 2.49 | 0.80 | 0.70 | 0.34 |

The whole bar, checked by resampling: every condition holds about 0.3–0.4 of the time at the screen's effect (0.38,
0.29 and 0.29 from the 1990–2015, 2003–2015 and 1926–1989 screens) and 0.06–0.09 at half of it. Of the 947 runs of 127
consecutive turns 1926-07 → 2015-11, 34 % pass (condition 1 judged by the normal p at 2.5 %); none of the 35 that end 2013-01 → 2015-11 does, each failing condition 5
(27 also fail condition 3). The smallest D seen with 80 % power at 2.5 % is 17.8 bp/day (1990–2015 SD) and 19.8
(2003–2015), above the screen's 15.5 and 15.9. Expect a fail; a pass at these odds is still informative because every
condition is fixed here.

**Where the money came from** (EQ2's `screen_dfc_robust.py`, H2 windows, CRSP VW, dodge rule net of 8 bps): the pattern
is steady (D 14.44 bp/day in 1990–1999, 13.48 in 2000–2007, 11.90 in 2010–2015; 13.49, t 3.62, without 2008–2009), but
the dodge rule's money is not: +1.39 % a year in 1990–1999, +2.99 % in 2000–2007, +12.66 % in 2008–2009, **−0.02 % in
2010–2015**; +2.43 % over 1990–2015 and +1.58 % without 2008–2009. Its best month (2008-10) is 23.8 % of the 1990–2015
total. So condition 6 leans on turbulent months; in a calm decade it fails.

**Does the pattern move with settlement?** (EQ2's `screen_settlement.py`, pre-2016) In the T+3 era (1995-07 → 2015-11,
245 turns) the T+3 windows give D 13.58 bp/day (t 2.75), windows one day later (T+2) 10.94 (t 2.50), two days later
(T+1) 9.00 (t 1.98), and the T+5 windows 3.15 (t 0.78). In the T+5 era (1975-01 → 1995-05, 245 turns) the mechanism's
T+5 windows give 9.71 (t 2.90) but the T+3 windows 12.48 (t 3.85): the low days moved from T−9/T−8 to T−6/T−5 and the
high days from T … T+3 to T−3 … T−1 and T+1 when settlement shortened, the direction the mechanism predicts, but the T+5
era did not sit on the mechanism's exact windows. Hence two hypotheses under Holm rather than one. A window one day off
keeps about 81 % of D, two days off about 66 %.

## 6. Data and how it is run

* **The input**: Ken French's daily factor file built from CRSP, as EQ1 committed it,
  `docs/agents/backtests/equity/inputs/F-F_Research_Data_Factors_daily.csv.gz` (sha256
  `ac244ddd12706212aaf6a0d6c958df9972addbb9c390ad149b8456160ae9288c`, CRSP vintage 202608). The test reads only this file
  and the scorer refuses any other. No later vintage is used; if the file cannot be restored from git, the test is not
  run and that is reported. CRSP is survivorship-free.
* **The scripts**, committed with this file: `docs/agents/backtests/equity2/scripts/heldout_dfc_pull.py` (step 1: the
  input's sha256 and the calendar from the date column only; no network, no return) and `heldout_dfc_score.py` (step 2,
  the only code that reads a held-out return). The scorer refuses to run unless this file, both scripts and the input exist
  in the freeze commit (the one commit that added this file, whose parent the clone must hold) and are unchanged since
  it, committed or not, and the input's sha256 is the one above; it checks the dates and the turn counts before it parses any
  return; its output, `docs/agents/backtests/equity2/results/heldout_dfc.json`, records the freeze commit, HEAD at the run, the
  sha256 of this file, both scripts and the input, and the Python and numpy versions.
* **The order**: the freeze commit; step 1; step 2 run twice, the two outputs byte-identical; the output, a write-up
  (`docs/agents/reviews/2026-10-01-dfc-study.md`), the reference and the ledger committed.
* **Costs**: 8 bps a round trip (an LSE GBP line, CSP1; EQ1's unverified assumption, kept as the conservative case) and
  16 bps for condition 4; 3 and 4 bps are reported (§8). One third-party CSPX quote snapshot read 828.73/828.83, about
  1.2 bps (see §7). Real costs are the paper test's to measure.
* **Where it would run** (Davies' choice, not this test's): the **ISA** (GBP) through CSP1, no FX fee, no CGT, but at
  London hours (each switch about 4.5 hours ahead of the US close the test uses) and with GBP/USD noise; or the **USD
  Invest account** through a basket of the largest S&P 500 stocks traded a minute before the US close (aligned with the
  test), or CSPX at London hours; CGT applies there, and each sale is matched with the re-purchase seven calendar days
  later under the 30-day rule.

## 7. What was seen before the freeze (disclosed)

* **EQ1** (research round of 2026-10-01, §4; `docs/agents/backtests/equity/`): its screen of TOM, the 10-month trend,
  industry momentum and big-cap reversal on French files cut at 2015-12-31, and its power checks. EQ1's parser read
  and parsed every row of its files to numbers and dropped those after 2015-12-31 before computing anything; nothing was computed
  or printed from them (EQ2's parser drops them as it reads).
* **EQ2's screens, all cut at 2015-12-31** (`docs/agents/backtests/equity2/`, every script and output listed in its
  `MANIFEST.json`): the windows TOM [0,+3], S [−8,−4], P [−3,−1], PB [−3,+3] and N [+4,+8] on CRSP VW, the CRSP top size
  decile and five Fama-French international regions (1990-07 → 2015-12) with their correlations; volatility-scaled
  versions (rejected: in 2003–2015 scaling lowered every t, e.g. PB's from 3.44 to 2.78); the money lines; the
  settlement-era and sub-period checks of §5; the per-day mean excess T−12 … T+8 in both settlement eras; Friday
  month-ends (T+5 era 19.1 against 2.6 bp/day, T+3 era 12.4 against 14.5: the paper's Friday amplification is absent
  after 1995 on this statistic); the replication of the paper on its own sample (1995-06 → 2013-12: S −0.395 % abnormal
  against the paper's −37 bp, PB +0.456 % against +48 bp, P +0.234 % against +25 bp); Yahoo's daily closes of CSPX.L and
  CSP1.L to 2015-12-31 (over the 62 turns 2010-10 → 2015-11 the London lines' D correlates 0.88 and 0.79 with the US
  windows', beta 0.87 and 0.82). The round's other screens: `screen_xs.py` (industry seasonality, daily reversal, low
  volatility), `screen_auctions*.py` (the Treasury auction cycle), `power_events.py`, `power_forward.py`, and
  `sp500_survivorship.py`, which read the S&P 500 change list to 2026 (dates and tickers only).
* **The raw Yahoo responses** carried current-price fields in `meta` (CSPX.L and CSP1.L, and the S&P 500 member files of
  `sp500_survivorship.py`). `strip_meta` removed them unread and unprinted; the stored files end 2015-12-31 (verified by
  the review).
* **The paper's text** (the working-paper version, read in full for its definitions), including its footnote that US
  settlement moves to T+2 in September 2017. H1's regime dates (2017-09-05, 2024-05-28) are public calendar facts.
* **Harvey, Mazzoleni & Melone**, "The Unintended Consequences of Rebalancing" (NBER w33554, revised 2026-01; sample
  1997-09-10 → 2023-03-17). The full text was downloaded to EQ2's research folder (`inputs/hmm_rebalancing.txt`, not
  committed); the drafter states that only its abstract and its signal definitions were read, and its results and
  figures were not. Its abstract reports that month-end rebalancing predicts a 17 bp lower equity return the next day
  when stocks are overweight. Its sample covers most of this test's window, so a related month-end finding about the
  held-out years is published; this test's own statistic for those years is not.
* **One price after 2015**: a CSPX bid/ask snapshot (828.73/828.83) read in 2026 for the spread in §6. It implies the
  index's cumulative path, already under general knowledge, and nothing about month-ends.
* **General knowledge**: the S&P 500's broad path 2016–2026 (strong overall; the 2020 crash; the 2022 bear market); that
  practitioner write-ups of turn-of-the-month returns exist through the 2020s (no number from them is recalled); the
  policy-rate path, which sets `RF` and so the dodge's cash return. The money conditions turn on where single sell-offs
  fell relative to S (pre-2016, 2008-10 alone was 45 % to 353 % of the dodge's total in each of the 35 127-turn windows
  ending 2013-01 → 2015-11, above 100 % where the other months together lost, and 24 % over the 311 turns of 1990–2015). The windows were fixed by the paper (H2) and the settlement calendar (H1); no recollection of where any
  2016–2026 sell-off fell relative to a month-end was used.
* **The review** (2026-10-01) read dates only after 2015-12-31. It dry-ran the draft scorer on seven pre-2016 spans and,
  in its second pass, the final scorer end to end on eight (window, regimes and counts changed, guard bypassed, reading
  stopped at 2015-12-31): every number with a screen counterpart reproduced it, and the rest, including a 127-turn span
  with invented switch dates in the held-out 20 / 80 / 27 shape, matched the review's own implementation. It resampled
  the bar on pre-2016 data (§5).
* **Not read**: any return or statistic dated after 2015-12-31, and any price after that date except the one snapshot
  above. No month-end statistic for 2016–2026 is known to the drafter, the reviewer or the coordinator.

## 8. Descriptive, not part of the bar

Each hypothesis's D, t, p and halves. On CRSP VW over 2016-01-04 → 2026-08-31: the dodge rule at 3, 4, 8 and 16 bps
(cash earning `RF`) and at 8 bps with cash earning nothing; PB-only (each hypothesis's own PB) and TOM-only [T, T+3]
(in over the window, cash otherwise) at each of the four costs, against buy and hold (252 × the mean daily excess over
2016-01-04 → 2026-08-31), a year, with their volatilities (the SD of the per-event window sums × √12); buy and hold's own
excess and volatility. These are
`descriptive()` in the scorer; nothing else is computed on held-out data.

## 9. What it cannot show

* **A small effect.** At half the screen's size the test passes about one time in four or five at Holm's 2.5 %, and
  every condition about one time in twelve to sixteen. A fail rules out an effect of the screen's size, not a smaller one.
* **The dodge rule's own money.** A pass does not show that the dodge rule beats buy and hold. At the screen's effect
  its own t over 127 events is 0.65–0.90, so conditions 3–6 are point conditions protected only by the test of D, which
  also counts PB, a leg the rule does not trade.
* **The fill.** CRSP's close is not a Trading 212 fill; an LSE line trades 4.5 hours earlier. The paper test measures it.
* **The T+1 regime alone.** Only 27 turns are under T+1, the regime a live rule would trade in; the test is mostly T+2.
* **Why.** A pass does not prove that institutional cash needs are the cause.

## 10. Stops and deviations

Step 1 stops, and nothing is scored, if the input's sha256 differs, the held-out rows do not run 2016-01-04 →
2026-08-31, or the turns are not 127 (20 / 80 / 27). The scorer stops before reading any return if a frozen file differs
from the freeze commit (committed or not), if that commit cannot be identified (a shallow clone without its parent:
deepen it), or if the input's sha256 differs; and it stops, printing no value, if `Mkt-RF` or `RF` holds a missing code
(−99.99, −999) or a non-number. Any change after the freeze, a bug fix found after the run included, is a deviation: the frozen
script's output is reported beside the fixed one, and the deviation is recorded in the study, the reference and the
ledger.

## 11. What follows

* **A pass** (one hypothesis passes every condition): Davies decides whether US equities run at all, and in which
  account. If yes: a once-a-day paper row of the dodge rule in this repository on the account and instrument he
  chooses, under a paper spec frozen before it runs; then a Trading 212 demo-account test of the order path; then live
  with a trading key under the guardrails of the research round's §8 (an instrument allowlist disjoint from his holdings, a loop-owned
  quantity it never sells beyond, a pending row before every order, reconciliation, a kill switch, caps), only on his
  word, the first order confirmed in the same conversation.
* **A fail**: month-end calendar rules are closed for this account at this size, recorded with the power statement
  above. EQ1's TOM on CSP1 is not run separately: its window is H2's PB less three days, and it had 21–38 % power.
