# PR5's paper test, the four-week review (2026-09-23 15:09 → 2026-10-21 15:09 UTC)

The six conditions of `2026-09-23-pr5-paper-test-spec.md` ("What decides, after four weeks"), read as it words them,
and beside them PR5-R's five readings, run as `2026-09-28-pr5-readings-prereg.md` specifies. Everything is computed from
the record by committed scripts (`backtests/pr5_review/`: `sql/pull.sql`, `scripts/conditions.py`,
`scripts/readings.py`, `results/`), SELECT only, pulled 2026-10-21 after 19:00 UTC. The frozen simulator,
`scripts/pr5/pr5_sim.py`, is run byte for byte (sha256 `results/*.json` → `frozen_pr5_sim_sha256`).

**Not blind.** The record was read before this review: by appendix B (to 09-27 21:38, disclosed in PR5-R), the
stablecoin quotes reviews of 10-09, 10-14 and 10-18, and this session's own reads; Davies lifted every no-peek rule on
2026-10-04. The scripts, bars and dates are the spec's and the pre-registration's.

## Answer first

**The test does not pass as the spec words it: condition 5 misses.** The paper engine placed **714 orders on 2026-10-01**
(690 re-prices, 21 re-placements, 3 placements), over the 700 a day the spec allows on every day; the spec calls a breach
"a finding to fix (for example a wider re-price step), not a pass". Every other condition holds, by a wide margin, and
PR5-R's readings change none of that.

| | Condition | Bar | Read | |
|---|---|---|---|---|
| 1 | Faithful | the frozen `pr5_sim.py` on the stored prints, candles and FX: fills within 5 %, P&L within 10 % | fills 253 v 247 (+2.43 %); P&L $17.757 v $17.139 (+3.61 %) | **pass** |
| 2 | P&L after costs | > 0 and > the random-time null's p95 (2,000 draws, seed 20260923) | +$17.139; null p95 $2.282 (mean $0.531, max $3.694; no draw at or above) | **pass** |
| 3 | Worth more than cash | ≥ $0.26 a day (8 %/yr on $1,200) | $0.612 a day (18.6 %/yr on $1,200) | **pass** |
| 4 | Fills the book allowed | ≥ 90 % of paper fills accepted by the go-live snapshot | 480 of 489 fills (98.2 %); 3 with no snapshot | **pass** |
| 5 | Order budget | ≤ 700 orders on every day | max 714 (2026-10-01); every other day ≤ 645 | **miss** |
| 6 | The regime, weekly | recorded | median buy-minus-sell gap 5.3, 5.3, 4.0, 6.7, 9.3 bps (W39–W43) | recorded |

The record: 245 round trips over the 28 days, 230 won, 3 taker stops, +$17.139 (all closed before the end); 247 entry
fills (two positions were open at 15:09: a USDC-GBP 0.1 % bid from 10-20 22:57 and a USDT-GBP 0.1 % ask from 10-21
15:06); 242 maker exits.

## The conditions

**1. Faithful: pass.** The frozen file runs on a folder written from the record in its own layout (`common.stored_folder`):
the stored prints as `trades/`, the engine's hourly USD-book closes as `candles/` (its F3 fair), the stored GBP/USD
minutes as `fx/`. It made 253 fills (247 recorded, +2.43 %) and, over the 251 round trips that closed before its last
minute, +$17.757 (the record's 245, +$17.139: +3.61 %). Trip by trip, 230 match on (book, side, k, entry minute); 15 are
the record's alone and 23 the simulator's (`results/conditions.json`). The difference is the fair: the frozen file takes
every hourly close wholly inside the last 24 h, while the engine fetches each close an hour late (PR5-R (d)); on the
engine's own inputs the same file is the engine event for event (below).

**2. P&L after costs, against the null: pass.** +$17.139 after costs (a maker exit pays nothing; the three stops paid
0.09 % and half the spread). The null replaces each of the 245 round trips with a twin entered at the last print of a
random traded minute of its book and exited by the rule's own exit (`exit_only` of the frozen file), as PR5's null was
built: 2,000 draws, seed 20260923, p95 $2.282. No draw reached the record.

**3. Worth more than cash: pass.** $0.612 a day against $0.26; 18.6 %/yr on the $1,200 the quotes lock. Under PR5-R (a)'s
strict fills it is still $0.545 a day, so the pass does not depend on credits (a) removes.

**4. Fills the book allowed: pass.** Each fill (247 entries, 242 maker exits) is checked against the order-book snapshot
the engine took in the minute its order's current price went live (the minute after its latest `order` event). 480 of
the 489 would have been accepted post-only (98.2 %; 98.8 % of the 486 with a snapshot): entries 99.6 %, exits 97.9 %. Our
price was at or better than the best on its side in 56.0 % (entries 34.1 %, exits 78.3 %), strictly better in 44.7 %.

**5. Order budget: miss.** Orders a day are the engine's `order` events (each placement, re-price and re-placement, the
spec's count), the same as its `agent_quote_days` row on every whole day. 2026-10-01 had 714; the next highest were
10-15 (645), 10-14 (611) and 10-08 (591). The live account's own orders are governed separately (entries withdrawn at 900
POSTs, stops only from 950): its busiest day, 10-07, wrote 950 order rows.

**6. The regime: recorded.** The median gap between adjacent BUY and SELL prints within 60 s, both books:

| ISO week | pairs | median gap | USDC-GBP | USDT-GBP | P&L entered that week |
|---|---|---|---|---|---|
| W39 (09-23 15:09 →) | 41 | 5.3 bps | 6.6 | 4.0 | $1.083 |
| W40 | 53 | 5.3 | 6.6 | 5.3 | $6.952 |
| W41 | 838 | 4.0 | 6.0 | 4.0 | $2.983 |
| W42 | 1,694 | 6.7 | 15.9 | 6.7 | $2.343 |
| W43 (→ 10-21 15:09) | 541 | 9.3 | 12.0 | 9.3 | $3.778 |

The gap the post-change backtest earned in was 3–5 bps; the last two weeks are wider, and the prints far more numerous.

## PR5-R's five readings

None passes or fails the test (`results/readings.json`).

**(d) The replay on the engine's own inputs.** The frozen simulator with only its inputs replaced (each minute's X and
fairU from `agent_quote_minutes`; before 2026-09-25 00:05, 1,976 minutes a book, the stored inputs with the engine's
one-candle lag) reproduces **all 9,820 of the engine's events, minute, rung, kind and ticks**, over the whole four weeks.
The only differences are two stops at 15:08 on 10-21 that the simulator adds where its data ends, closing the two
positions the engine still holds. Every minute after 09-25 00:05 has its record, and every minute's stored prints number
its `prints_n`. So condition 1's gap is the inputs' timing, not the engine.

**(a) Strict fills**, on (d)'s inputs. Entries capped at the taking-side volume through them, exits filled in parts:
216 round trips and +$15.251, against (d)'s 247 and +$16.933: **90.1 % of the P&L kept**. 10 entries were capped and 70
exits filled in parts; trip by trip 206 match (−$1.411 between them), 41 are the baseline's alone and 10 the strict
run's, since a slower exit keeps its rung in position.

**(b) The size ladder.** Under the frozen fill, the record re-sized from each fill's own minute volume: $25 a rung
+$4.923 ($0.176 a day), $100 +$17.139, $300 +$43.861 ($1.566), $1,000 +$108.926 ($3.890). Under (a), (a) re-run at each
size against (d) at the same size: $25 +$4.407 v +$4.848; $100 +$15.251 v +$16.933; $300 +$34.750 v +$43.655 ($1.241 a
day v $1.559); $1,000 +$79.020 v +$108.720 ($2.822 v $3.883). The larger the rung, the more (a) takes: at $300 it keeps
80 %, at $1,000 73 %.

**(c) The live path as configured on 2026-09-28** (bids only, £50 ÷ 12 = £4.17 a rung): +$0.760 under the frozen fill
(141 trips, $0.027 a day); under (a) +$0.703 (138 trips) against (d)'s +$0.750 at that size. It leaves out the loss stop,
the guards, the governor, the bounded stop and the placement lag. (The live account has quoted both sides at £10 a rung
since 2026-10-01; this reading is the pre-registered configuration.)

**(e) The live executor's timing.** (e1): 6 of the 247 entry fills came less than 34 s into the minute their current
price went live (11.9–27.3 s); without their trips the record is +$16.523 (−$0.616). Over the six bid rungs alone, 2
fills and −$0.314 (+$11.260 left). 5 exit fills fell in the same window and are counted, not re-simulated. (e2): of 7,566
entry re-prices, 20 had a taking-side print through the old price within 90 s of the turn's minute start, worth +$1.184
at the new fair; of 520 exit re-prices, 7, worth −$0.125 (bid rungs alone: 10 entries +$0.515, 4 exits −$0.125). Both are
lower bounds: live, a replacement also waits for its cancel to be read back.

## Deviations (recorded here, in the reference and in the ledger)

1. **Condition 1's inputs.** The frozen file reads a folder; its `config.json` names the FX series. The folder is written
   from the record with `fx: "STORED"` (the GBP/USD minutes the engine stored, its own source) in place of `"EXN"`
   (Exness, PR5's backtest source), and `fair_proxy: "F3"` as frozen. The file itself is unchanged.
2. **Condition 1's P&L** compares round trips closed before the end: the simulator closes what is open at its last
   minute (two positions here) as a taker stop, the engine holds them. Fills count them.
3. **Condition 2's null** is PR5's (`main()`'s loop and `exit_only`, seed and draws as frozen) applied to the four weeks:
   the record's 245 round trips, each book's traded minutes with an X, on the stored inputs.
4. **Condition 4's fills** are the entry fills and the maker exits, both post-only orders; the snapshot is the go-live of
   the order's current price.
5. **PR5-R (a)'s copy** of `pr5_sim.py` is made at run time from the committed file by text patches each asserted to apply
   once (`scripts/common.py`: `STRICT`, `SIZEFN`, and `EVENTS`, which only records), not committed as a second file.
6. **PR5-R (e2)** sizes an entry with the re-price's own X; an exit's whole position is the trip whose exit order it was.

## For Davies

**1. LIVE: continue, or scale?** PR5's live executor has run on the `_2` sub-account since 2026-10-01 16:29:53 UTC at £10
a rung, on his word that day; this test is the paper rule's, so its verdict does not switch anything. Its result: the
rule earns well above cash on paper (condition 3), its fills are real post-only fills (condition 4, 98 %), and the paper
engine is faithful to the frozen rule (condition 1, and (d) exactly), but on one volatile day it re-priced more often
than the budget it was given (condition 5). The options:
- **(A, the recommendation) Continue at £10 a rung, no scale-up on this test.** The miss is the paper engine's order
  count; the live account's own POSTs are capped by its governor (900/950), and a scale-up was to follow a pass. The
  finding to fix comes first: a re-price step wider than 0.05 % on volatile days, replayed on this record (`replay.py` of
  the 10-18 review, or this folder's (d)) before anything changes, and pre-registered as a variant if it changes the rule.
- **(B) Scale to £50 a rung (£600)**, as the 10-14 review proposed for this date, on his call despite the miss. (b) says
  what size buys under strict fills: about $0.55 a day at $100 a rung, $1.24 at $300, with diminishing returns as the
  rung grows (the 10 % volume cap and slower exits).
- **(e)** proposes a timing change to the executor (placement at the paper's `live_at`, t+1:00): its cost today is 6
  entry fills and $0.62 over four weeks, and the re-price window adds back about $1.06. Only on his word.

**2. Do PR5's paper engine and minute record keep running?** **Yes, unchanged.** The live executor carries out the paper
engine's decisions minute by minute, so LIVE stops if the engine stops. PR5V reads the engine's record to 2026-10-28
00:30, QUEUE to 11-02, PR5-W to 11-25 (12-23 at the latest), and variant-3's weekend replica steps on it. Stopping it
would also end those windows early (PR5-R's prereg and the ledger note this). Nothing in this review changes the engine.

## Files

- `backtests/pr5_review/sql/pull.sql`: the seven pulls; `scripts/grab_text.py` checks each against the database's md5.
- `backtests/pr5_review/data/`: minutes, prints, inputs, events, trips, go-live books, days (gzip -n -9).
- `backtests/pr5_review/scripts/common.py`, `conditions.py`, `readings.py`; `results/conditions.json`, `results/readings.json`.
- `backtests/pr5_review/MANIFEST.json`: the runs and every file's md5.
