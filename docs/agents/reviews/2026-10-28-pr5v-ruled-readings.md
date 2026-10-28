# PR5V's and rule D's readings, and the hidden twins' readouts (2026-10-28)

Read on 2026-10-28 from 19:08 UTC, after the earliest instant both pre-registrations allow (10-28 01:00) and before their
latest (11-04). Every input was read from production with SELECT statements through the Supabase connector. Each script
was run exactly as `docs/agents/scripts/pr5v/reading_manifest.json` says: the statements of `reading_pull.sql` and
`reading_pull_ruled.sql`, each reply cut by `reading_grab.py` (md5 and line count checked), then the committed script with
its own window, bar and seeds. Neither script was changed. `src/pr5v_reading_prereg.test.js` pins their sha256, and each
result records the hashes it ran with.

**Not blind.** This repeats the disclosure of 2026-09-30. The ledger read PR5V's and variant-2's daily results for
2026-09-28 → 09-30 on 2026-09-30 (its history, 22:14 UTC), before either reading script was written. No-peek rules were
cancelled on 2026-10-04 (Davies: "所有不偷看条款全部取消"). The stablecoin quote reviews of 10-09, 10-14, 10-18, 10-21 and
10-26 read both engines' records and every twin's. Both scripts were written strictly from the pre-registrations and their
recorded deviations (`reviews/2026-10-24-pr5v-ruled-reading-scripts.md`), and each result file repeats this disclosure.

| reading | pre-registration | script | result |
|---|---|---|---|
| PR5V, arm `main` | `reviews/2026-09-28-pr5-variant-prereg.md` | `scripts/pr5v/reading_pr5v.py` | `backtests/pr5v/forward/reading.json` (inputs in `forward/data/`, the folder its §4 names) |
| Rule D, arm `d` | `reviews/2026-09-28-pr5-rule-d-prereg.md` | `scripts/pr5v/reading_ruled.py` | `backtests/pr5v/ruled/reading.json` (inputs in `ruled/data/`) |

**The window.** Both readings use the same 28 UTC days, 2026-09-29 → 10-26, with trips counted by their entry day.
E = 2026-10-28 00:30 UTC. PR5's engine had decided every minute up to 19:09 that day, so §3's end rule did not apply.
`stepMinute` is unchanged since the freeze commit `157ad527` (sha256 `3ea26c7b…` at both commits). The exports are
complete, and every count matches the engines' own:

| export | rows |
|---|---|
| PR5V book-minutes | 86,460 |
| PR5V events | 102,037 |
| PR5V trips | 2,866 |
| PR5's paper trips from 09-28 | 322 |
| Rule D book-minutes | 86,460 |
| Rule D events | 108,152 |
| Rule D trips | 3,503 |
| PR5V `main` trips (rule D's comparator) | 1,699 |
| UK prints, both readings | 15,198 |

No minute's print count differs from the engine's, and no minute was rebuilt. Both reproduction checks pass trip for trip
and POST for POST before any export is opened:
- PR5V: 563 trips for $29.5129, and 40 for $2.5438.
- Rule D: 593 trips for $30.3004, and 60 for $3.7420.

## 1. PR5V: PASS

PR5's rule with nine rungs a side and four keys, on paper at $3,600. All five conditions hold:

| # | condition | bar | read |
|---|---|---|---|
| 1 | faithful | ≥ 95 % of trips matched both ways; P&L within 10 % | 1,424 of 1,424 matched both ways; P&L $35.4604 in both, a difference of $0 |
| 2 | above its null | window P&L > p95 of `null_twins` (2,000 draws, seed 20260923) | $35.4604 against a p95 of $4.6002 (null mean $0.8249, max $7.7317) |
| 3 | better than PR5, day by day | share of 7-day block resampled means ≤ 0 under 0.05 (10,000, seed 20261027) | 0.0000; mean +$0.7431 a day, 95 % interval +$0.3897 to +$1.0543; better on 19 of 28 days |
| 4 | stress arm above zero | > 0 | +$25.6772 over 1,038 trips |
| 5 | the governor held (900 / 950, deviation 2) | no entry POST at 900 or more, no other at 950 or more | none; at most 916 POSTs a key in a day; the engine's own counts agree with the recount on every POST |

**Described only, never judged:**
- **Returns.** Main made $1.2664 a day, 12.84 %/yr on $3,600: 1,424 trips, 86.1 % won, 10 taker exits. Over the same
  days PR5 made $0.5233 a day, 15.92 %/yr on its $1,200, from 254 trips. The study expected main to make $1.054 a day.
- **The extra capital.** The gain over PR5 is $0.743 a day, which is 11.30 %/yr on the extra $2,400. The 8 %/yr line on
  that $2,400 is $0.526 a day. As §5 says, four weeks cannot show that the extra capital beats that line.
- **Arm `top5`.** $28.4986 from 977 trips, 18.58 %/yr on its $2,000. Its conditions would all have held (paired p 0.0000,
  stress +$21.07), but they are reported only.
- **The governor.** It withdrew entries on 19 key-days, spread over six weekdays: 10-01, 10-02, 10-08, 10-14, 10-15 and
  10-16. The most POSTs one key sent at one turn was 9, against the venue's 10 a second.
- **PR5's first live order** (2026-10-01 16:30:29). From that day on, main made $32.7392 against PR5's $13.4396 over 26
  days. Before it, main made $2.7212 against $1.2138 over 2 days.

**What the pass allows** (§6). The variant made more dollars than PR5 on the same days, as the study said it would.
A pass does not say the extra $2,400 is worth locking, and it moves no money. Live money would need four funded
sub-accounts, a four-key live executor and Davies' word.

## 2. Rule D: FAIL (condition 3)

PR5V's rule with rule D (`{"frac": 1/3, "away": null}`), arm `d` against arm `v1`.

**The deviation check passes, so the test is judged.** Arm `v1` equals PR5V's `main` trip for trip:
- 1,424 of 1,424 trips match;
- the P&L is $35.4604 in both;
- the largest daily difference over the window is $0.00, and the engine's stored `checkMaxUsd` is 0 over 26 days.

| # | condition | bar | read |
|---|---|---|---|
| 1 | faithful | as PR5V's | 1,524 of 1,524 matched both ways; P&L $36.9973 in both |
| 2 | above its null | > p95 | $36.9973 against a p95 of $4.9760 |
| 3 | **better than variant-1, day by day** | share ≤ 0 under 0.05 (seed 20261028) | **0.1825: FAIL.** Mean +$0.0549 a day, 95 % interval −$0.0545 to +$0.1827; better on 8 days, worse on 11, equal on 9 |
| 4 | stress arm above zero | > 0 | +$27.0623 over 1,097 trips |
| 5 | the governor held | as PR5V's | none; at most 780 POSTs a key in a day; no key-day withdrew |

**Verdict: FAIL.** Rule D made more than variant-1 ($36.9973 against $35.4604 over the window), but the paired daily gain
is not distinguishable from zero at the bar. The pre-registration noted that this bar would have missed on the study's
own window too (0.0513), and it was not loosened. The study expected +$0.0281 a day, and the reading found +$0.0549.

**Described only:**
- **Returns.** Arm `d` made $1.3213 a day, 13.40 %/yr on $3,600: 1,524 trips, 86.1 % won, 10 taker exits.
- **POSTs.** Arm `d` sent 36,776 over the window and `v1` 55,626, 33.9 % fewer. The study expected 38.7 % fewer.
- **The GBP/USD source.** All 80,640 of the window's book-minutes read Yahoo. No row read TrueFX, so the TrueFX paired gain
  is empty and the Yahoo paired gain is the whole +$1.5369.
- **Without the 0.03 % rungs.** §9 proposed a line on arm `d` without its 0.03 % rungs; the script does not compute it, and
  the figures here come from the result's own table by rung. Without that rung, `d` made $34.2334 from 867 trips and `v1`
  made $33.0293 from 806. The 0.03 % rungs alone made $2.7639 from 657 trips in `d`, about 4 bps on $100, and $2.4311 from
  618 in `v1`. This is described only: it is not paired, and it is not a condition.

**What follows** (§6). A fail moves nothing. Rule D does not go to a live executor through this test.

## 3. The hidden twins' readouts (10-28)

These are the three realistic twins that ran off the page (`hidden`, 0141) until these readouts. Their pre-registrations
set no pass bar, so each readout is descriptive. Every figure is the page's own (`liveRungs`, `liveRungTrips` in
`agents/index.ts`), computed from the orders read at 19:15 UTC and cut at 2026-10-28 00:00 UTC. The script is
`backtests/pr5v/ruled/twins/scripts/readout.ts` and the result is `results/readout.json`.

**Two checks first.**
- The backfill reproduces both pre-registrations figure for figure: PR5's twin has 47 trips, 44 won, +£6.0476 to
  10-02 21:05, and the size twin has 57 trips, 53 won, +£3.9040.
- Health at the read: no `last_error` on any of the three. The replica check shows 46 mismatches for `pr5` and for `p50`
  (all before 2026-09-24 18:13, as recorded) and 0 for `d`.

**Reading the tables.** "Won" counts trips with a P&L above 0. The twins fill only on a print through their price, which
is stricter than LIVE's fill rule since 10-21. Realised figures leave the coins they still hold unmarked.

| twin | capital | orders written (sent) to the cut | whole record: trips · won · stops · realised · bps | window, closed 10-04 00:00 → 10-28 00:00 | window realised / capital |
|---|---|---|---|---|---|
| "Stablecoin quotes" (`pr5`) | £1,200, £100 a rung | 10,087 (9,950) | 219 · 159 · 6 · +£17.5464 · 11.2 | 171 · 114 · 6 · +£11.4327 · 10.2 bps | 0.95 % (about 14.5 %/yr) |
| size twin (`p50`) | £600, £50 a rung | 10,441 (10,284) | 259 · 182 · 5 · +£10.3536 · 10.7 | 201 · 128 · 5 · +£6.4166 · 9.2 bps | 1.07 % (about 16.3 %/yr) |
| rule-D twin (`d`) | £1,800, £50 a rung | 35,205 (33,432) | 1,064 · 632 · 30 · +£22.1485 · 5.8 | 856 · 467 · 30 · +£13.5425 · 4.8 bps | 0.75 % (about 11.4 %/yr) |

**`pr5` beside PR5's paper.** PR5's paper trips closed before the cut number 324, with 308 won and +$23.2124 at $100 a
rung. In the window they number 263, with 249 won and +$15.1776. The twin made 219 trips, with 159 won and +£17.5464. It
makes fewer trips than the paper, and its 0.1 % bids win less often:

| rung | twin trips · won | paper trips · won |
|---|---|---|
| USDT bid 0.1 % | 40 · 21 | 68 · 63 |
| USDC bid 0.1 % | 28 · 23 | 50 · 43 |

The twin holds 66.60 USDT on its USDT ask 0.1 % rung at the cut and nothing elsewhere. The table by rung is in
`results/readout.json` (`pr5.byRung`).

**`d` beside arm `d`** (the twins' §9, read with §15's proposal).
- **The two spans, by entry day.**

  | span | twin: trips · realised · bps | arm `d` paper: trips · $ |
  |---|---|---|
  | nine rungs, to 10-09 | 396 · +£12.9811 · 7.7 | 419 · +$19.6768 |
  | eight rungs, from 10-10 | 668 · +£9.1674 · 4.3 | 1,353 · +$30.6677 |

- **The eight common rungs over the whole span.** The twin made 939 trips for +£21.9599 (6.5 bps), and the paper 1,030 for
  +$46.5918.
- **The 0.03 % rungs before 10-10.** The twin made 125 trips for +£0.1887 (0.4 bps), and the paper 178 for +$0.8473.
- **Holdings open at 10-10 00:00.** One 0.03 % holding was open: USDC ask, entered 10-09 20:39, which closed by its exit at
  10-10 03:00 for +£0.0066. The twin made no 0.03 % entry after 10-10.
- **Where the twin trails the paper.** The paper made $50.3446 from 1,772 trips. At £50 a rung the twin's inner rungs,
  0.03–0.075 %, made almost nothing. On USDT 0.05 % they made −£0.2202 on the bid and −£0.5371 on the ask, while the paper
  arm won 132 of 149 and 161 of 181 trips on those rungs. Through-only fills and the penny on £50 tickets take what the
  paper books.

**`d` and `p50` over the window** (the size twin's §3), both at £50 a rung:

| | trips | realised | bps |
|---|---|---|---|
| `d`, its 0.1 / 0.2 / 0.3 % rungs | 150 | +£5.3625 | 9.1 |
| `p50` | 201 | +£6.4166 | 9.2 |

On the rungs they share, the two make about the same per pound traded; `p50` traded more there. Per pound of capital the
window gave `p50` 1.07 %, `pr5` 0.95 % and `d` 0.75 %. The direction the size twin's pre-registration expected (more trips,
and more realised per pound, at £50 than at £100) holds forward:

| | trips | realised / capital |
|---|---|---|
| `p50` | 201 | 1.07 % |
| `pr5` | 171 | 0.95 % |

The table by rung for the 12 shared rungs is `d_vs_p50_window.byRung`.

**F1** (buy-backs at the venue's minimum, each £0.10–£0.11 of pounds moved), before and after its deploy at 2026-10-09
17:41:36 UTC (the end of the edge-functions run of `d0c6f823`, which carries `6ca18c9a`):

| twin | before F1 | after F1 |
|---|---|---|
| `pr5` | 5 (£0.55) | 28 (£3.07) |
| `p50` | 6 (£0.66) | 27 (£2.96) |
| `d` | 28 (£3.08) | 126 (£13.86) |

After F1 each buys the whole penny's coin. The penny's value beyond the holding is the account's coin, so it is not lost.
This review does not separate that hair from the trip.

**They stop now.** `0151` sets `enabled = false` for `pr5`, `p50` and `d`, as the 10-26 review's §3.3 proposed once
their last readings were written. Their spec rows, tables and records stay.

## 4. Not done here, for Davies

- **PR5V's and rule D's paper engines are still running.** Both pre-registrations say "both arms stop at the reading,
  pass or fail, unless Davies says otherwise". The 10-26 review proposed switching their calls (`quotesv`, `quotesd`) off
  in a migration shaped like 0103/0120 (calls off, rows kept) on his word. This session did not switch them off. Rule D's
  twin read rule D's engine, and it is off with 0151.
- **PR5V passed, and that moves no money.** A four-key live executor and four funded sub-accounts would need a
  pre-registration of their own and his word.
- **The showcase** is not updated (Davies, 2026-10-23: no longer maintained).
