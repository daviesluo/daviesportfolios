# RW's paper test, the result: RW, RW-E and RW-X1–X3 pass; RW-X4/X5's Test 1 is void; RW-NEXT's candidate is RW-E

Read on 2026-10-09 between 00:42 and 00:50 UTC. Each bar was run once, as its frozen document words it, from the rows
as they stood after `pm_rw_days` closed 2026-10-08 (at 00:01 UTC). The scripts and their outputs are in
`docs/agents/backtests/rwverdict/` (`MANIFEST.json`). **Not blind:** there has been no no-peek rule since 2026-10-04,
and this ledger and its sessions read running figures before today (below, "Against the early look"). SQL was
read-only. Nothing was deployed or armed. No frozen file was edited.

| Arm | Document | Days | Checks | Verdict |
|---|---|---|---|---|
| RW | `2026-09-24-polymarket-rw-paper-spec.md` | 09-25 → 10-08 (14) | b: `stepRw` reproduces every fill; c: no print missed | **PASS, 6 of 6** |
| RW-E | `2026-09-26-polymarket-rw-end-prereg.md` | 09-27 → 10-08 (12) | its replay's `rw` = `pm_rw_days` (gap $0) | **PASS, 7 of 7** |
| RW-X1 (no weather) | `2026-09-27-polymarket-rw-variants-prereg.md` | 09-28 → 10-08 (11) | `rw` = `pm_rw_days`, `e` = `pm_rw_e_days` (gap $0) | **PASS, 7 of 7** |
| RW-X2 (pause on jumps) | same | same | same | **PASS, 7 of 7** |
| RW-X3 (both) | same | same | same | **PASS, 7 of 7** |
| RW-X4 ("wide"), Test 1 | `2026-10-02-polymarket-rw-rest-prereg.md` with its Addendum 1 | 10-03 → 10-08 (6) | **the copy check cannot be read: no 10-01 rows** | **VOID** |
| RW-X5 ("lean"), Test 1 | same | same | same | **VOID** |

**RW-NEXT Part 1:**

- RW-E passes all seven of its conditions, so it is the candidate (1.2).
- No variant replaces it (1.3). The paired stress bootstrap against RW-E (`random.Random(20261010)`, index 33) is below
  zero for each variant: x1 −54.10, x2 −58.03, x3 −51.15.
- **The candidate is RW-E.** It goes to RW-C (10-09 → 10-23) before any live design. RW-C's replay of RW-E
  (`pmrwc-e`) runs it there.

## RW

**Step b: the engine ran the rule** (`scripts/replay.ts`, `results/replay_record.json`).

- `stepRw` was replayed over the 19,800 stored minutes with the stored prints.
- It reproduces `pm_rw_fills` fill for fill: 4,116 of 4,116 the same, none only in the record, none only in the
  replay.
- It reproduces each day's running total, stress, rewards, fills and daily rewards to $1.6 × 10⁻¹².
- Beside it, decided by nothing: `rw_test.py`'s `run_market` (`scripts/rwtest_beside.py`) equals the record's fills in
  132 of 204 markets and its rewards in 116.
  - It quotes a market under its first selection's programme and tick across all its days.
  - The record reprices each day and each row.
  - Those two differences are the likely cause. Each difference is listed in `results/rwtest_beside.txt`, with that
    cause not separately verified.

**Step c: no print was missed** (`scripts/pull_prints.ts`, `results/prints_check.json`).

- Every one of the 204 quoted markets' prints was pulled again from `/v2/trades` by the engine's own reader. Each
  market's read carried a cache-busting parameter no earlier read had carried, back to its first quoted minute.
- In its quoted minutes, (t, t + 60 s], the pull holds 13,634 prints, and `pm_rw_prints` holds the same 13,634.
- None was missed, none is extra, and every market's read was complete.
- So no recomputation is owed, and RW is judged once.

**The bar** (`scripts/verdict.py`, `results/verdict.txt`). The fourteen day totals, 09-25 against zero, the warm-up row
counting nowhere: 148.09, 71.63, −27.81, 259.86, −50.50, 310.35, 283.19, 165.76, 146.76, 186.95, 221.35, 78.07, 202.21,
−14.20.

1. Total +$1,981.72.
2. Stress total +$94.79.
3. 4,116 fills.
4. The best market is +$91.37, 4.6 % of the total. Without it the total is +$1,890.34.
5. The bootstrap's index 100 is +$1,272.08 (seed 20261009, fourteen days).
6. On the run's capital, $2,609.68, × 365 / 14 = 1,979.8 % a year.

## RW-E

**Its check:** the replay's `rw` arm equals `pm_rw_days` on every day 09-25 → 10-08 (largest gap $0.00).

**Its twelve days**, from the 09-26 row: 15.96, 161.17, 19.80, 236.06, 198.15, 40.59, 62.16, 132.29, 48.71, 63.68, 115.11,
73.36.

1. Total +$1,167.04.
2. Stress total +$289.96.
3. 1,502 fills.
4. The best market is +$72.35, 6.2 %. Without it the total is +$1,094.68.
5. The bootstrap's index 100 is +$780.15.
6. On capital $1,931.32, × 365 / 12 = 1,838.0 % a year.
7. Its stress total, +$289.96, is above RW's over the same twelve days, +$123.31.

## RW-X1 to X3

**Their checks:** the replay's `rw` arm equals `pm_rw_days`, and its `e` arm equals `pm_rw_e_days` arm `e`, every day
09-25 → 10-08 (gap $0.00).

**Their eleven days, from the 09-27 rows:**

| | total | stress | fills | best market | bootstrap index 100 | capital, a year | stress vs RW-E's +$365.72 |
|---|---|---|---|---|---|---|---|
| x1 | +$1,097.83 | +$405.61 | 1,109 | +$72.35 (6.6 %) | +$686.95 | $1,739.14, 2,094.6 % | above |
| x2 | +$1,170.90 | +$397.90 | 1,285 | +$78.29 (6.7 %) | +$837.28 | $1,858.73, 2,090.3 % | above |
| x3 | +$1,124.91 | +$438.96 | 1,005 | +$78.29 (7.0 %) | +$755.27 | $1,666.56, 2,239.7 % | above |

**RW-NEXT 1.3's paired stress against RW-E** (09-28 → 10-08):

- x1: differences sum to +$39.90, one of eleven zero; index 33 is −$54.10.
- x2: +$32.19; −$58.03.
- x3: +$73.25; −$51.15.

Each variant's stress beat RW-E's in total, but none beat it at the corrected level. RW-E stays the candidate.

## RW-X4 and X5, Test 1: void

The rest pre-registration's Addendum 1 moved the copy check to the 10-01 rows: "x4's and x5's 10-01 rows in
`pm_rw_x_days` equal x1's in `total`, `stress_total`, `reward`, `fills`, `capital` and `markets`". **There are no such
rows.**

- The two arms joined the running replay on 2026-10-02 at 18:23 UTC (`3fa527f4`; ledger archive, 2026-10-02). That was
  after 10-01's rows had closed, so each arm's first day row is 10-02's.
- The document says that if a check fails the test is void, "reported with the difference". The difference is that
  both rows are absent.

**The slip rule itself holds:**

- the Addendum 1 code deployed at 19:11:35 UTC with the replay at 19:09, before 20:00;
- both arms were in `pm_rw_x_state` then, and they are now, with no `start`;
- the records of 18:23 and 19:11 compared their accounts with x1's (as booleans) and found them equal.

That is the substance of a copy check, but it is not the check the document names. It is reported here as a defect in
Addendum 1's wording, not used to rescue the test.

**Test 2 is unaffected.** It runs on RW-C's days, from RW-C's first minute, read after 10-23. Under the document's
"What follows", an arm that passes both tests goes to Davies and one that fails either is closed. A void Test 1 is not
a pass, so neither arm can be a candidate by this document. Test 2 is still read and reported.

**Beside the void test, descriptive only.** Test 1's arithmetic on the rows there are (from the 10-02 rows):

| | total | stress | fills | bootstrap index 100 | x1 over the same days |
|---|---|---|---|---|---|
| x4 | +$386.44 | +$106.00 | 324 | +$267.01 | total +$415.46, stress +$128.51, 391 fills |
| x5 | +$368.46 | +$103.26 | 345 | +$286.05 | |

Both would fail condition 7, their stress below x1's: by $22.51 for x4 and $25.25 for x5. Both would pass the other
six.

## Deviations and checks

- **The minutes RW stored.** 19,800 of the 20,160 due over the fourteen days (`results/checks_out.txt`):

  | | 09-25 | 09-26 | 09-27 | 09-28 | 09-29 | 09-30 | 10-01 | 10-02 | 10-03 | 10-04 | 10-05 | 10-06 | 10-07 | 10-08 |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
  | stored of 1,440 | 1,440 | 1,439 | 1,438 | 1,436 | 1,434 | 1,440 | 1,438 | 1,319 | 1,436 | 1,436 | 1,439 | 1,436 | 1,240 | 1,429 |

  - **The deviation the ledger named in advance:** 10-08 lost the seven `:X0` minutes 00:00, 00:10, 00:30, 00:40,
    00:50, 01:00 and 01:10 (fixed by `0097`). It also lost 02:37, 05:52, 20:00 and 20:52.
  - 10-07 (1,240) and 10-02 (1,319) lost the most. Their causes are not read here: the ledger records an Edge stall on
    10-07 from about 20:15 and the one-minute job's late `:X0` minutes from 20:50.
  - A minute RW missed quotes nothing, as its spec says, and the bar is unchanged.
- **Step e was done ahead** by `0103` (`retire_after_rw()`, ledger history 2026-10-08 23:52 UTC).
  - Read at about 00:48: `pmrw`, `pmrw-select`, `pmrw-e` and `pmrw-x` are disabled, and RW-C's four `pmrwc*` rows are
    enabled.
  - `cron.job` still holds `edge-calls-every-minute` (`* * * * *`, active). The retire job has unscheduled itself.
  - The tick's call beat 60 times in the last 60 minutes.
  - No second migration was written.
- **RW-C's second check:** `pm_rwc_days` holds 2026-10-08 with `detail->>'phase'` = `warm-up`, closed at 00:02:00.8 UTC.
  Of RW-C, nothing else was read.

## Against the early look

The figures read for Davies on 10-08 at 22:44–23:12 UTC were not the verdict.

- **RW, then:** total +$1,980.54 and stress +$88.04, before the day's last 48 minutes. My own bootstrap draw over a
  partial last day gave +$1,267. Now: +$1,981.72, +$94.79 and +$1,272.08. The pass is the same.
- **x4 and x5, then:** against x1 over 10-03 → now, totals −$26.98 and −$48.24, stress −$22.07 and −$23.74. Now
  (descriptive): −$29.02 and −$47.00, stress −$22.51 and −$25.25.
- **The early look did not run Addendum 1's copy check.** That check is what voids Test 1.

## What follows

- **RW-NEXT's candidate, RW-E, goes to RW-C.** Its days are 2026-10-09 → 10-22. Part 3's bar is read on or after
  2026-10-23 00:05 UTC, and no live design of RW-E is made before it.
- **x1–x3 passed their own bars.** They are reported. Under Part 1 they replace nothing, and they are descriptive on
  RW-C.
- **x4 and x5:** Test 1 is void and Test 2 runs.
- **For mid-pool:** neither x4 nor x5 points to a change of its quoting rule before a funded go-live. Test 1 is void,
  and its arithmetic, read descriptively, puts both arms' stress below x1's. Mid-pool's rule stays as frozen.
  Changing it would need a passed Test 2 and a pass on both tests, which a void Test 1 rules out under this document.
  So it would need a new pre-registration on Davies' word and a dry-run before any go date.
- **For Davies.** RW and RW-E passed. A live test of RW's family is designed only on his word, and RW-NEXT sends the
  candidate to RW-C first. "Reward quotes live-prep" is already the candidate to go live under its own
  pre-registration. It already carries RW-E's same-day rule, x1's no-weather rule, x2's pause and, since 2026-10-08,
  TB1's skip. Its go waits only on its own P2–P5. The question for him:

  > RW 和 RW-E 都通过了。按 RW-NEXT，RW-E 先在 RW-C（10-09 → 10-22）上复核，10-23 出结论，之前不为 RW-E 单独设计实盘。live-prep 已经是上线候选（包含
  > RW-E 的同日规则、x1 的去天气、x2 的暂停和 TB1）。你希望 live-prep 按它自己的 P2–P5（充值、授权读取、你说 go）现在就准备上线，还是等 10-23 RW-C
  > 的结论再定？

  In English: RW and RW-E both passed. Under RW-NEXT, RW-E is confirmed on RW-C first, with a verdict on 10-23, and no
  live design is made for RW-E alone before then. Live-prep is already the candidate to go live, and it carries RW-E's
  same-day rule, x1's no-weather rule, x2's pause and TB1. Should live-prep prepare to go live now under its own
  P2–P5 (funding, the allowance read, his "go"), or should it wait for RW-C's verdict on 10-23?

- **What no paper test shows:** what Polymarket actually pays. Only an account that quotes can show that.
