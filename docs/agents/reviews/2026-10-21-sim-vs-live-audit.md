# The simulation against LIVE: an audit, and what was fixed (2026-10-21)

Davies, 2026-10-21, answering PR5's four-week review (`2026-10-21-pr5-paper-test-review.md`), verbatim: **"A，引擎也继续运行，但要确保
模拟的真实性和实盘策略完全一致，不一致的地方就直接改"** (option A: LIVE stays at £10 a rung; the paper engine keeps running too; make
sure the simulation is realistic and matches the live strategy exactly, and fix what is inconsistent directly).

Everything here is computed from LIVE's own record, 2026-10-01 16:29:53 (go-live) → 2026-10-21 15:09 UTC, by committed scripts
(`backtests/livesim/`), SELECT only. Not blind.

## Answer first

- **The simulation that stands for LIVE is the twins' code at LIVE's size**: PR5's rule, the live executor's own code
  (`quotes_live.ts`), and the simulated Revolut X account (`revx_sim.ts`), driven as the twins' pre-registration §7 replayed
  LIVE's first day.
- **The executor is shared, so every rule-layer guard and order rule is the same code on both sides.** That covers the
  governor, the loss stop, the 24-hour stop, the de-peg and stale guards, the dead-man watch, the post-only check, the venue's
  minimums, F1's buy-back, the refused-exit re-send, top-ups, parking and the shadow switches. They can only differ through
  the venue they meet and the time they run.
- **The one large difference was the fill rule.** The twins fill a resting order only on a print strictly through its price.
  LIVE was filled on prints AT its price in 317 of its 502 filled maker orders, and only 169 had a print through.
- **The simulation now carries LIVE's fill rule, and the replay carries LIVE's own operations.** As a twin rule, `fill`, the fill
  model goes from 20 % of LIVE's fills to 51 %, and from £0.245 of LIVE's £0.880 realised to £0.972.
- **The order budget (condition 5)** is a change to PR5's rule itself, not to the simulation. It is drafted and replayed in
  `2026-10-21-pr5-reprice-budget-draft.md`, not deployed.

## The match, before and after

The replay (`scripts/replay.ts`):
- the twins' driver (`runQuotesTwins`) on PR5's stored record at LIVE's £120;
- its replica from PR5's first minute;
- its first turn at LIVE's go-live, LIVE's £120.33, LIVE's two go-live conversions at their own instants, and the dead-man from
  2026-10-02 19:06.

It is compared with LIVE's orders (`scripts/compare.py`, `results/compare_*.json`) and, by the page's own functions, with LIVE's
round trips (`scripts/trips.ts`, `results/trips_*.json`).

| arm | fill rule | LIVE's operations | orders matched (of LIVE's 6,324 / of the sim's) | LIVE's fills reproduced (of 507) | of the sim's fills | orders both placed: filled alike | round trips (LIVE 218) | realised (LIVE £0.8796) |
|---|---|---|---|---|---|---|---|---|
| base (before) | through only | no | 76.4 % / 85.4 % | 103 (20.3 %) | 35.8 % | 67.8 % | 130 | £0.2454 |
| base_ops | through only | yes | 82.0 % / 84.6 % | 102 (20.1 %) | 36.7 % | 67.3 % | 128 | £0.3166 |
| at | LIVE's (`fill`) | no | 78.6 % / 87.0 % | 251 (49.5 %) | 56.4 % | 90.1 % | 204 | £0.9294 |
| **at_ops (after)** | LIVE's (`fill`) | yes | **84.7 % / 86.2 %** | **259 (51.1 %)** | **58.1 %** | **92.1 %** | **204** | **£0.9719** |

**The stated tolerance.** The fixed simulation reproduces:
- LIVE's realised pounds to within 10.5 % (£0.972 against £0.880; before, −72 %);
- its round trips to within 6.4 % (204 against 218; before, −40 %);
- 84.7 % of its orders (before, 76.4 %);
- on the orders both placed, whether each filled: 99.6 % (92.1 % of the filled ones; before, 67.8 %).

**Fill for fill it reproduces 51 %.** The rest is path dependence: one fill that differs changes a rung's holding, and every later
order on that rung differs. Of the fills it misses:
- 224 had no simulated order at all;
- 21 filled differently;
- 3 simulated orders did not fill.

The replay still counts 21 fills LIVE did not have on the same orders (the rule has no queue: below), and 157 of its 204 trips won
against LIVE's 191 of 218.

## Every difference, and its effect on 10-01 → 10-21

### Rules: the same code, different inputs

| difference | LIVE | the simulation | effect | fixed? |
|---|---|---|---|---|
| **The executor's code** | `quotes_live.ts`, LIVE's instance | the same file, the twin's instance | none in the rules | no difference |
| Turn timing | places a median 32.3 s into the minute (p10 29.5, p90 36.4) | 25 s | small | in the replay (`replay.turnOffsetMs` 30 s); the twins keep 25 s (§3 of their pre-registration) |
| Turns in every call | turns every minute pg_cron calls, also when PR5's engine decided nothing (430 stale-input cancels) | turned only in minutes PR5 recorded (130 such cancels) | entries withdrawn more often live | in the replay (a turn every minute, 678 such cancels; the 248 too many are minutes no call ran) |
| The dead-man storm of 10-07 | 48 cancels-all by the monitor (state unreadable), 950 orders that day | none of its own | orders and fills that day | in the replay (`replay.deadmen`): 933 orders that day |
| Venue outage 10-20 | reads 500 06:03–08:37, pairs 502 08:00–11:36, cancels 503 08:37–15:02 | none | 8 entries resting at 06:02 prices for 9 h, none filled | in the replay (`replay.outages`) |
| Governor 900/950 | reached 950 on 10-07 | 605–624 a day without the storm, 933 with it | follows the storm | same code |
| Loss stop, 24-hour stop | no loss stop; 3 stops | no loss stop; 1–3 stops | a stop follows its position | same code |
| Post-only check | the venue's own book at its turn | PR5's go-live snapshot that minute, else the last print's touch | 43 refusals not sent live, 87 in the replay | not fixable from the record (LIVE's book reads are not stored) |
| Top-ups and conversions | 2 go-live takers, then 22 automatic makers (10 refused "Not enough funds" on 10-02, a bug fixed that day; 8 lapsed after 30 min) | the 2 go-live takers replayed exactly, then 3–4 makers | £0.03 of fees, coin timing | same code; LIVE's 10-02 bug is history |
| Code versions | ran each fix from its day (top-ups 10-02, dead-man watch 10-08, F1 10-09, parking 10-20) | today's code throughout | first days only | not reproduced (by design: the simulation is today's rule) |
| Parked pending orders | 2 (7229, 7230; POST 500 at 06:02 10-20, settled rejected by a person) | none (the replay's outage has no lost POST) | 2 orders, no fill | the parking code is shared |
| take_mode, weekend_mode | 'shadow' since 10-18 05:17: events only, no order | none | none | none needed |
| Order budget (condition 5) | the paper engine's 714 orders on 10-01 | the same decisions | — | a rule change, drafted (`2026-10-21-pr5-reprice-budget-draft.md`) |

### The fill model

`scripts/fill_model.py`, `results/fill_model.json` compares three rules on every maker order LIVE sent (6,302, from placement to
its fill or cancel):

| rule | LIVE's filled orders predicted (of 502) | false fills | coins predicted (LIVE 3,114) | error on coins |
|---|---|---|---|---|
| through only (the twins' rule 1) | 169 | 5 | 1,915 | 42.8 % |
| **at the price too** (`fill`) | **486** | 37 | **2,927** | **27.6 %** |
| queue (at the price behind the go-live snapshot's size; 5,071 orders with a snapshot) | 257 of 297 | 3 | 1,763 of 2,073 | 17.8 % |

**The fill rule (`fill`, model `at`):** a print AT a resting order's price, its aggressor on the other side, fills it by its
quantity, after the orders it goes through.
- **Why it is the rule chosen:** it predicts LIVE's filled orders best (486 of 502) and its coins closest in total (−6 %).
- **What it does not model:** queue position. A queue behind the snapshot under-predicts, since LIVE was often filled with size
  shown ahead of it, so the snapshot is not the queue LIVE met. It is QUEUE's question, and QUEUE (frozen to its 11-02 export)
  will answer it.
- **Partial fills:** LIVE 197 of 507, the fixed replay 166 of 446.

### Accounting

**Fees, GBP rounding and the venue's pennies are the same code on both sides** (`revxHundredths`, `revxTakerFee`, the live
client's `toOrderView`):
- on the matched fills, the fees are equal to the penny (£0.054 each in at_ops);
- the average fill prices differ by at most £0.0016 a coin.

**Inventory valuation and round trips** are the page's own `liveRungs` / `liveRungTrips` for both.

## What changed in code

- **`revx_sim.ts`:**
  - `atPriceFrom`, the account option that fills on prints at the price;
  - `SimOutage` and its handling in `fetch` and `publicFetch`.
- **`quotes_twin.ts`:**
  - `TWIN_RULES.fill` (`{ "model": "at", "from": "<UTC>" }` → `QuoteLiveInstance.simFill`), passed to the account;
  - the validation's `replay` gains `turnOffsetMs`, `deadmen` and `outages` (`applyPrintsTo` lands LIVE's dead-man cancels).
- **`quotes_live.ts`:** the type of `simFill`. The executor never reads it.
- **No twin has the rule or a replay.** Every twin runs the code path it ran, and `pr5.json.gz` built again is the same bytes.
- **Pins, each failing on the old code:**
  - `revx_sim.test.ts`: the at-price rule and its instant; the outages.
  - `quotes_twin.test.ts`: a twin with the rule fills at its bid's price where its control does not, and a bad rule is refused;
    LIVE's dead-man cancels land between turns; the replay's turn offset.
- **Deviations:** the twins' pre-registration's 7 (§19), the size twin's 6 (§13) and the weekend test's 1 (§7), each naming the new
  hashes.

## Waiting on a decision

1. **Done: the row that carries LIVE's fill rule.** The main session chose (a) on Davies' word, 2026-10-21. `0136` adds `live`,
   "Stablecoin quotes LIVE twin": PR5's twin at LIVE's £120 with `rules.fill`. Its backfill is LIVE's life replayed with LIVE's
   operations (the `at_ops` arm, order for order), and its pre-registration is `2026-10-21-live-twin-prereg.md`: the mirror is
   scored against LIVE's realised, 10-22 → 11-22. TAKE (variant-2), the weekend test (variant-3) and the size twin keep the
   through-only rule they froze; each of their pre-registrations now says its reading undercounts LIVE's fills (TAKE's Addendum 3,
   the weekend test's §7, the size twin's §13).
2. **The re-price budget** (condition 5), drafted in `2026-10-21-pr5-reprice-budget-draft.md`: it changes LIVE's trading rule, and
   every reading of PR5's engine would need a deviation.
3. **The executor's timing** (PR5-R (e)): placement at the paper's `live_at`. Only on Davies' word.
