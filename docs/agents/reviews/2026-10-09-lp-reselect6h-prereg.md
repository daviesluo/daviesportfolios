# Pre-registration LPRESEL6: live-prep's rule choosing its markets again every six hours, on the whole universe's books

Written 2026-10-09 between 01:30 and 02:00 UTC, before anyone has read the pm-rec recorder's data of 2026-10-09 00:00
or later for design. It is frozen by the commit that adds this file and `docs/agents/backtests/lpresel6/`. Nothing below
may change after that commit, and any change is reported as a deviation. It is judged once, out of sample, on the pm-rec
recorder's whole-universe record of 2026-10-09 00:00 → 2026-10-23 00:00 UTC. It is read on or after 2026-10-23 00:05 UTC,
beside RWC-OPT (`2026-10-09-rwc-optimised-arms-prereg.md`) and RW-C's verdict.

**What it changes:** nothing that runs. There is no new Edge call, no dry-run instance and no change to live-prep or
to any frozen pre-registration. It is an offline replay of recorded books, read from the database and its archive
read-only once the window has closed.

## On whose word

Davies, 2026-10-09, on re-selecting every six hours (the third forward-test candidate of live-prep's Addendum 3):

> 这个你觉得有必要加吗？有必要的话就加上

In English: "Do you think this is worth adding? If it is, add it." The coordinating session answered that it is worth
adding as an offline, pre-registered forward test on the pm-rec record, and nothing more.

## The arms

Both arms run on one simulator, LPSELF's `sim2.ts` (`docs/agents/backtests/lpself/`), copied unchanged into this folder.
It is live-prep's Phase A simulator with TB1's option, plus re-selection inside the day. Both run on one record, built
by `scripts/build.ts`. The arms are word for word `scripts/arms.ts`.

**L1 (the base): live-prep's rule as deployed** (its pre-registration with Addenda 2–4).

- **Selection, each UTC day at 00:00.** From that slot's candidates: rate ≥ $10, N ≤ 20, accepting, not closed, no
  `weather_fees` market, not ending that UTC day, no game within 48 hours, a first-round formula of at least $2.50 a
  day, scored by RW's `firstScore` on that minute's book. Ten markets at most, within $200 of first-quote capital, by
  first-round reward per dollar.
- **Caps:** $320 in all and $100 a market, on holdings at cost plus resting buys, with a sell of what is held before a
  buy.
- **Quoting:** 5N; x2's pause (15 ¢, 60 minutes); TB1's skip of a raw touch of one tick.
- **Stop:** −$75 on the fills plus 0.40 of the rewards of the days before. No day stop.
- **Exits:** carried markets are worked off by the rule's own close-only quotes (`exitCarried`), as the path runs.

**RESEL6:** L1, which also chooses its markets again at 06:00, 12:00 and 18:00 UTC from that slot's candidates, by the
same rule (`reselectEveryH: 6`). A market it drops is carried, and is worked off by close-only quotes like any carried
market.

**Reported only:** both arms with Phase A's passive exit model in place of the close-only quotes.

## Data

**The record is pm-rec's archive for the window.**

- Every books, universe and prints object of the 336 hours 2026-10-09 00:00 → 10-22 23:00, and the daily markets
  dumps. They are downloaded by `scripts/fetch.py` from the signed URLs `sql/archive_urls.sql` reads, each checked
  against `pm_rec_archive.sha256`.
- Settlements and live-prep's own selection and paper days come from `sql/aux.sql`. It reads no table of RW-C.
- `scripts/build.ts` builds the record. It is LPSELF's builder with the window as arguments and the programmes seeded
  from the window's first day's dump.
  - Every two hours, it scores every candidate on that minute's book and keeps the best 60.
  - From then on it writes every book minute of a kept market as RW's row, with its prints, and counts each day's
    recorded minutes.

```
deno run --v8-flags=--max-old-space-size=12000 --allow-read --allow-write --no-check scripts/build.ts data/pmrec data/aux.json data/pr_record.json 2026-10-09T00:00:00Z 2026-10-23T00:00:00Z
deno run --v8-flags=--max-old-space-size=8000 --allow-read --allow-write --no-check scripts/run.ts data/pr_record.json results/rwc_window_arms.json
python3 -I scripts/bar.py results/rwc_window_arms.json data/pr_record.json data/pmrec data/aux.json
```

The scripts run in a worktree at the freezing commit, so the simulator's imports are the frozen ones.

## Fill models, exits and R

- **Fill models:** both.
  - **strict:** a print strictly through the quote fills it.
  - **at-price:** a print at the quote fills it too.
- **Exits:** close-only quotes are primary, as the rule runs live. The passive model is reported.
- **R** is the share of the formula's reward that Polymarket pays. R = 0.40 is primary: a day's figure is its total
  less 0.6 of its rewards. R = 1 and R = 0.2 are reported.

## The bar

RESEL6 against L1, at R = 0.40. Each condition is read under strict fills and under at-price fills:

1. **The paired day bootstrap.** With D_i = RESEL6's day figure less L1's on the same day, over the fourteen days: a
   fresh `random.Random(20261023)`, 2,000 draws of fourteen `choice`s of the D_i, the sums sorted, the one at index 100
   > 0. This is RWC-OPT's seed and draws.
2. **Not one market-day.** Over every market of either arm and every day, with d_{c,i} = RESEL6's market-day change
   less L1's: the sum of all d_{c,i} less the largest one > 0.
3. **The worst day no worse.** RESEL6's worst day figure ≥ L1's worst day figure.

**RESEL6 passes when all six hold:** three conditions under each of two fill models. One arm is tested, so there is
no correction.

## Checks before the bar (`scripts/bar.py`)

- **Coverage.**
  - Every day 2026-10-09 → 10-22 has a books minute recorded in at least 1,296 of 1,440 minutes (90 %), with at most
    two days under 1,368 (95 %).
  - Every books, universe and prints object of the window's 336 hours is in the archive's index, and its file matches
    the index's sha256.
  - If either fails, the test is **void** and reported with what is there.
- **Reproduction: reported, not a void condition, and why.**
  - What is reported: each day, L1's markets against live-prep's own selection (`pm_lp_markets`), and L1's formula
    rewards against live-prep's paper days.
  - Why it cannot reproduce the path:
    - the record is a reconstruction: ten-cent ladders read at the recorder's second, slots every two hours, the
      listing as the recorder last read it;
    - the path reads its own listing and books at its own second.
  - On 2026-10-05 → 10-08 this pipeline chose 2, 2, 9 and 7 of the path's ten markets. Its rewards were 72.90 against
    the paper's 82.92, 151.93 against 157.37, and 45.27 against 76.64 (in-sample run below). A larger disagreement is
    reported beside the bar and does not void it.
- **Live-prep's own orders.** From live-prep's first live minute, its orders rest in the books the recorder reads.
  - The record keeps no order ids, so the replay cannot take them out.
  - Both arms read the same books, so the comparison is paired.
  - The report names the minutes live-prep was live.

## What is read when

- **Until 2026-10-23 00:05 UTC:** nothing of pm-rec's data of 2026-10-09 or later is read for this test's design. The
  recorder's health readings are read as before.
- **On or after that time:** the pull, the build, the run and the bar, once, as above. The output is committed beside
  the scripts, and the report says it was not blind to the in-sample result.

## Seen before the freeze (not blind)

**LPSELF's study of 2026-10-08** (live-prep's Addendum 3; `docs/agents/backtests/lpself/`) on the same kind of record,
2026-10-05 00:00 → 10-08 22:59 UTC, four days. Re-selecting every six hours was:

- +$57.06 at R = 0.40 with at-price fills, and +$56.30 with strict fills;
- −$48.74 at R = 1;
- worst at-price day −$18.57 against L1's −$72.46.

It was the only change ahead on that record under both fill models with a better worst day. Across that study's 35
changes on RW's record, the reality check of the best change gave p = 0.99 at-price and 0.89 strict.

**RW's record cannot test it.** RW's engine recorded books only for its own day's selection, so no other candidate has
a book at 06:00, 12:00 or 18:00.

**This folder's pipeline, run in sample on 10-05 → 10-08** (the builder's seeding differs from LPSELF's, so the figures
differ slightly):

| R = 0.40 | L1 | RESEL6 | difference | bootstrap index 100 |
|---|---|---|---|---|
| strict | $108.48 | $169.35 | +$60.87 | −77.41 |
| at-price | $64.71 | $126.35 | +$61.63 | −103.89 |

- The bootstrap fails both ways on four days.
- At R = 1 the difference is −$37.32 strict and −$56.11 at-price.
- Worst days: 3.66 against −24.25 (strict), −18.57 against −72.46 (at-price).

Nothing of 2026-10-09 or later was read.

## Retention, checked at the freeze

- **The archive is never deleted.**
  - Nothing in `agents/pm_book_rec.ts` or migration `0092` deletes a `pm_rec_archive` row or an object of the private
    `pm-rec` bucket.
  - Its signed URLs last 365 days (`PM_REC_URL_DAYS`) and are signed again 30 days before they expire
    (`PM_REC_RESIGN_DAYS`).
- **What is deleted, and why it does not matter:**
  - The hourly `pm-rec-prune` job deletes the database's frames after seven days, but only once they are in the
    archive. Frames the archive has not taken within six hours are marked `lost`.
  - It deletes `pm_rec_markets` rows seven days after the listing dropped them. Each day's dump of that table is
    archived.
- So the window's data stays until well past 2026-10-30.
- **The test needs the recorder to keep running to 2026-10-23 00:00:** `agents?action=pmrec` and `pmrec-meta`, kept on by
  `0103`. Stopping either before then shortens the window, and the coverage check reports it.

## What it cannot show

- What the queue does.
- How other makers answer quotes that were not in the books.
- Live-prep's own orders, which are in the books from its first live minute.
- R, which only live quoting measures.
- That fourteen days of one record is enough. They are few, and the two arms share every minute until the first
  re-selection.

## What follows

**A pass** makes re-selecting every six hours a candidate for live-prep's rules, nothing more. Adopting it needs
Davies' word and an addendum of live-prep's pre-registration, with its code pinned, before any change to the path. It
also needs a measurement of the selection's CPU at four runs a day.

**A fail closes it.** A void test is reported, and is read as not passing.

## Frozen files

The commit that adds this file adds every file below; their sha256 are those at that commit.
`docs/agents/backtests/lpresel6/MANIFEST.json` lists them too. `src/lp_resel6_prereg.test.js` fails if any differs from
the hash named here.

| file | sha256 |
|---|---|
| `scripts/sim2.ts` | `2a3482c972faa4f5d0e52fd65ddeb5c5464b5361edf7d2e64877d39f8c087662` |
| `scripts/rec.ts` | `050559756aa7065a3b3349efaaf070e46fccf870c8ea3babe1649a0571d3fd02` |
| `scripts/build.ts` | `a40f5b41d391e506a892a817aaa3bb3dbccd645bac65166412ab54af76ff4515` |
| `scripts/arms.ts` | `e48688100ebcbedbe132132c35136b4276aa18b31a581a8f6d0aec3163722535` |
| `scripts/run.ts` | `4cb80b02b4dfd13da6fbe042b3206edadea75bf5502d013b57adc4229c690f71` |
| `scripts/bar.py` | `4d2234ff8f5673cf1573d55ac202031eec60777111281e8a700c5981616799a7` |
| `scripts/fetch.py` | `705c3860f9581fa51b5fbfcccff82ba4ba02cfa1c1fb2e0d4f74a80e21bc71d9` |
| `sql/archive_urls.sql` | `67843c0beeb33941daea2e5573cafe5143f4e24aeec78b3f92a32f4b870005ce` |
| `sql/aux.sql` | `c63688432fb8a3b6276920c35f34b0312f21f2d1c9eb90fade5ad0a2feb19351` |
