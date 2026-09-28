# Pre-registration RW-NEXT: how the 2026-10-09 verdicts are read together, and a fourteen-day confirmation (RW-C)

Drafted 2026-09-27 and revised 2026-09-28 (UTC) after an independent review of the draft, and again after that
review's second pass. It was written before any minute of RW-C existed (its warm-up begins 2026-10-08 00:00 UTC), and
before anyone who wrote or reviewed it read a market-level figure of 2026-09-28 or later. It is frozen by the commit
that adds this file, at that commit's time. Any change after that is a deviation and is reported as one.

**What it amends.** It amends the "What follows" section of three frozen documents, and nothing else in them. Their
rules, checks and bars stand as frozen:

- **RW's spec** (`2026-09-24-polymarket-rw-paper-spec.md`) says: "If it passes, the next step is a live test of the
  same rule". Under this file, RW if it passes is the candidate only when RW-E does not pass (1.2). The candidate goes
  to RW-C (Part 2) before any live test. "If it fails, RW stops" stands.
- **RW-E's pre-registration** (`2026-09-26-polymarket-rw-end-prereg.md`) says: "If RW-E passes, it is the rule any live
  design under the Polymarket item uses in RW's place". Under this file, RW-E if it passes is the candidate, which a
  variant may replace under 1.3. It goes to RW-C before any live design. What it says of a fail stands.
- **RW-X's pre-registration** (`2026-09-27-polymarket-rw-variants-prereg.md`) says: "A variant that passes is a
  candidate rule for any live design, behind RW's and RW-E's own verdicts and the Ireland rule". Under this file, a
  variant that passes outranks the candidate only under 1.3. It goes to RW-C as a hypothesis under 1.4, and it reaches
  a live design only through RW-C. Its last clause, "one that fails is closed", stands.

The three files are not edited. The commit that freezes this one records the amendment where they are tracked:
reference §4 item 36 and the ledger's RW item. This file changes nothing that runs. RW-C, which Part 2 judges, is a
build of its own; Part 2 says what code it runs, how that is pinned, and what it adds to the one-minute job. That
build's change to `pmrw_x.ts` is a separate matter, recorded as a deviation of RW-X's text (Part 2).

**On whose word.** On 2026-09-27 Davies chose among the measurements the TESTING review ranked
(`2026-09-27-testing-portfolio-review.md` §4; appendix B §4.3–§4.4, where this was drafted). He picked the option
"RW-NEXT + 建 RW-C", which read "10-09 前冻结选择规则；RW-C 要新建第二个引擎，10-09 到 10-23 做 14 天前向复核". In
English: freeze the rule that chooses before 10-09; RW-C needs a second engine, for a fourteen-day forward confirmation
on 10-09 → 10-23. The amendment rests on that choice.

## Why

Five arms will be judged on overlapping days on or after 2026-10-09:

- RW, on 09-25 → 10-08;
- RW-E, on 09-27 → 10-08;
- the three variants x1–x3, on 09-28 → 10-08.

The variants were picked from 24 configurations on two days, and RW-E's split was found on less than two days.
Choosing the best of five on the days that judge them would be selection. This file fixes the choice before any
figure of those days is read, beyond what is disclosed below. It also adds a confirmation on fourteen days that do not
exist yet, before any live design.

## Seen before the freeze (disclosed)

- Everything RW-E's pre-registration discloses. That is RW's run from its warm-up (2026-09-24 19:31 UTC) to
  2026-09-26 16:16 UTC on its page and in its tables, the split by scheduled end, and fp5's Polymarket search.
- Everything RW-X's pre-registration discloses:
  - RW's per-market accounts at the 09-26 close, split by category and by horizon;
  - its research table (every arm's running totals at 09-27 00:00);
  - RW's and RW-E's aggregate accounts during 09-27: totals at 17:28 and 17:39 UTC, and RW-E's split of the day into
    the markets it quoted and those it carried, totals only;
  - RW's selections of 09-24 → 09-27;
  - the public prints of three of RW's 09-25 markets.
- The aggregate columns of `pm_rw_days`, `pm_rw_e_days` and `pm_rw_x_days` for 2026-09-24 → 09-26, as appendix B
  §4.1 of the TESTING review quotes them:
  - 09-25: total +$148.09, stress +$28.05, rewards $203.62, 147 fills, capital $485.17, 15 markets;
  - 09-26, running: +$219.72, stress −$28.53, rewards $375.70, 402 fills, capital $804.81, 20 markets.
- The ledger's aggregate notes of 2026-09-27, including RW's running stress of −$136.07 at 17:28 UTC.
- The replays' check fields, $0.00 each time they were read. The last such read the ledger records before this
  revision was at 2026-09-28 00:03 UTC; it read x1–x3's `base` for its presence only, not its contents.
- For RW-C's build, production's catalog only: the `pm_rw_*` tables' columns, constraints, indexes, grants and row
  level security, and the command of `edge-calls-every-minute`. No row of any `pm_rw_*` table was read.
- The review of this draft read the `pm_rw_*` tables' column names only. Its second pass read no `pm_rw_*` or
  `pm_rwc_*` content and no RW page. The revision after it read the repository only.
- Nothing else. No market-level figure of 2026-09-28 or later was read, and no fill, minute or print of those days.
- The Agents page shows these runs' figures to whoever opens it, market by market on RW's page. What Davies has seen
  there is his, and it is not recorded here. The choice below is mechanical, so it cannot bend to it.

## Part 1 — the choice, applied mechanically once the three verdicts are in (on or after 2026-10-09 00:05 UTC)

1. **Each arm is judged by its own document's bar, after its own checks.**
   - **RW.** Its spec has no check section. Its checks are the ledger's verdict steps b and c, each of which tests a
     clause of the spec:
     - (b) tests "The rule". Replay the stored `pm_rw_minutes` with the stored `pm_rw_prints` through the frozen rule,
       `stepRw` in `agents/pmrw.ts`. It must reproduce `pm_rw_fills` fill for fill, and each day's rewards to within
       $0.01. If it does not, RW is void, reported with the difference. `stepRw` alone decides whether RW is void.
       `rw_test.py`'s `run_market`, a separate implementation, is run beside it on the same minutes and prints, and
       its fills and rewards are reported against the record, market by market. They decide nothing.
     - (c) tests "Timing": a minute is decided only once its prints are public. Pull every quoted market's prints for
       the run again from `/v2/trades`, each read carrying a parameter no earlier read carried, and compare them with
       `pm_rw_prints`. If the engine missed any print, RW is judged twice: on its record, and recomputed with the full
       prints (the rule replayed on the stored minutes with every print). Both verdicts are reported. For this Part,
       RW passes only if it passes both ways.
   - **RW-E.** Its "Check before anything is read": its replay's `rw` arm reproduces `pm_rw_days`. That means the
     running total, stress total, rewards and fills at each day's close, 09-25 → 10-08, to within $0.01. If it does
     not, RW-E is void.
   - **The variants.** RW-X's "Check before anything is read": the replay's `rw` arm reproduces `pm_rw_days`, and its
     `e` arm reproduces `pm_rw_e_days` arm `e`, every day 09-25 → 10-08, to within $0.01. If either does not, all
     three variants are void.
   - **Missed prints.** If (c) found prints the engine did not see, RW-E and the variants are recomputed with them as
     well. Their replays are run again on the stored minutes with the full prints, and, where a replay reads
     `pm_rw_fills`, with RW's recomputed fills in its place. For this Part, each passes only if it passes both ways.
     Each arm's own verdict is still reported as its document defines it.
   - A void arm neither passes nor fails. This Part reads it as not passing. Below, "passes" means that all of an
     arm's own conditions hold, after its checks and, where (c) found missed prints, both ways.
2. **The candidate** is RW-E if it passes all seven of its conditions; otherwise RW if it passes all six of its own;
   otherwise there is none.
3. **A variant (x1, x2 or x3) replaces the candidate** only if both of these hold:
   - it passes all seven of its own conditions;
   - its daily stress beats the candidate's in the paired bootstrap below, at a level corrected for three variants.

   **The paired bootstrap, exactly.**
   - **A day's stress** is the change of `stress_total` over that UTC day: the day's row less the row of the day
     before, in the same table and arm.
   - **The series.** RW's is `pm_rw_days`. RW-E's is `pm_rw_e_days` arm `e`. Variant xN's is `pm_rw_x_days` arm
     `xN`.
   - **The pairing.** The days 2026-09-28 … 2026-10-08, eleven of them, paired by UTC day. For 09-28, the day before
     is the 09-27 row of the same series.
   - **The differences.** For each day, the variant's stress less the candidate's, listed in day order, 09-28 first.
   - **The draws.** A fresh `random.Random(20261010)` for each variant, and 2,000 draws. Each draw is the sum of
     eleven `rng.choice(differences)`. The sums are sorted ascending.
   - **The level.** Three variants are tested, so the one-sided 5 % is divided by three (Bonferroni). The sum at
     index 33 (`int(0.05 / 3 * 2000)`) must be above 0.
   - **In Python**, with `d` the eleven differences:
     `rng = random.Random(20261010); sums = sorted(sum(rng.choice(d) for _ in d) for _ in range(2000)); sums[33] > 0`.
   - **Missed prints.** Where (c) found missed prints, the bootstrap is run on the record and on the recomputation,
     and it must pass on both.

   **Disclosed.** Many differences may be exactly zero, because a variant differs from RW-E only on days with weather
   markets (x1) or 15 ¢ jumps (x2). Say k of the eleven differences are zero and the rest are positive. Then a
   resampled sum is zero with probability (k/11)^11:
   - at k = 8 that is 3.0 %, about 60 of the 2,000 sums, so eight quiet days and three good ones fail;
   - at k = 7 it is 0.7 %, about 14 sums, which passes.

   Days are not independent, because inventory carries from one day to the next. The bootstrap treats them as
   independent, so its level is nominal.

   **When several variants qualify,** the one with the largest stress total over the eleven days replaces the
   candidate: its 10-08 `stress_total` less its 09-27 `stress_total`. On a tie to the cent, the larger total over the
   same days wins. After that, the lower number: x1 before x2, x2 before x3.

   **The cost of a wrong replacement, accepted.** If a variant that replaced the candidate fails RW-C, the line closes,
   even if the candidate it replaced would have passed RW-C. The other arms are descriptive there. Reading them as a
   second chance would be the selection this file exists to prevent.
4. **If there is no candidate but a variant passes its own seven conditions,** that variant goes to Part 2 as a
   hypothesis, never to a live design directly. If several pass, the one with the largest stress total over the eleven
   days goes, with the same tie-break as 1.3.
5. **If nothing passes,** the reward-quote line closes. No rule is tried again on 2026-09-25 → 10-08, and a new idea
   needs a new mechanism and its own pre-registration.

## Part 2 — RW-C, the confirmation

- **The rule.** RW's rule exactly, as its spec words it and `agents/pmrw.ts` runs it. That means its selection ($300 of
  whole markets each UTC day, by first-round reward per dollar), timing, fills, settlement and accounts.
- **The engine.** RW-C runs the same code path as RW. `runPmrw` and `runPmrwSelect` in `agents/pmrw.ts` take an
  instance (`RwInstance`): its seven tables, its two leases, its days and a quiet time.
  - RW's calls are unchanged and run with the default, `RW_INSTANCE`, which holds exactly the tables, leases and
    dates the file had before.
  - RW-C's calls pass `RWC_INSTANCE`. They are `agents?action=pmrwc`, every minute, and `agents?action=pmrwc-select`,
    every five minutes.
  - RW-C's tables are `pm_rwc_state`, `pm_rwc_selection`, `pm_rwc_minutes`, `pm_rwc_prints`, `pm_rwc_fills`,
    `pm_rwc_days` and `pm_rwc_settlements`, and its leases are `pmrwc` and `pmrwc-select`.
  - It warms up from 2026-10-08 00:00 UTC (`RWC_WARM_UP`). Its fourteen UTC days run 2026-10-09 00:00 → 2026-10-23
    00:00 UTC (`RWC_RUN_START`, `RWC_RUN_END`).
  - Before the warm-up, both calls return at once and read nothing.
  - The warm-up is closed at its marks as the fourteen days begin. So they start flat, with no inventory, rewards or
    capital, and the warm-up counts nowhere.
  - After 2026-10-23 00:00 nothing is read, decided or selected.
- **The tables.** Migration `0069_pm_rwc.sql` creates `pm_rwc_*` as copies of RW's eleven tables: the same columns,
  keys, checks and indexes, row level security on and no prune. That includes `pm_rwc_selection.end_date` and `cat`,
  which RW-E's rule and x1's read.
- **How the build is pinned.** The build changed `pmrw.ts`, `pmrw_e.ts` and `pmrw_x.ts` to take their tables, leases
  and dates as parameters. It changed no rule, and that is pinned three ways:
  1. `pmrwc.test.ts` pins RW's instance and both of RW's replay configurations to exactly the names and dates the code
     had before, and RW-C's to theirs. It also pins that RW-C's calls touch only `pm_rwc_*` and RW's only `pm_rw_*`.
  2. The test files of RW, RW-E, RW-X and RW's page (`pmrw.test.ts`, `pmrw_e.test.ts`, `pmrw_x.test.ts`,
     `pmrw_view.test.ts`) pass unchanged.
  3. Once, before the build landed, RW's engine and both replays were run before and after the change. They were
     driven through one fake Polymarket over three windows: the warm-up into day 1, a midnight inside the run, and the
     run's end. Both versions made byte-identical database calls, requests and tables (ledger history, 2026-09-28
     00:38 UTC).

  The build landed on `main` in two commits: `3682b557` (the engine as an instance, RW-C's instance and migration
  `0069`) and `17728e3c` (RW-C's row on the Agents page). `5a8423a9` then kept that row off the page until the
  warm-up (below) and changed nothing of the engine. The commit that freezes this file cites all three, and any later
  commit before the freeze that changes RW-C's engine or page.

  RW-X allows a later change to `pmrw_x.ts` only as bookkeeping for the page, and the ledger forbids changing
  `pmrw.ts`'s rule. This change is not page bookkeeping, and it changes no rule. It is recorded as a deviation of
  RW-X's text where that is tracked (reference §4 item 36, the ledger's RW item), with the accounts unchanged.
- **The one-minute job.** RW-C's four calls are rows of `edge-calls-every-minute`. That job's batch lasts as long as
  its slowest call, and the live tick shares it.
  - Before 2026-10-08 00:00 (`pmrwc`, `pmrwc-select`) and before 2026-10-09 00:02 (`pmrwc-e`, `pmrwc-x`), each call
    returns at once, with no database read and no request (pinned).
  - On 2026-10-08, RW's last judged day, RW's engine and RW-C's warm-up both run, and Polymarket is read about twice
    as much.
  - Two health readings are reported beside RW's verdict. The first is RW's minutes stored on 10-08 against 10-07:
    the count of distinct `minute` in `pm_rw_minutes` for each UTC day. The second is the tick's start lateness on
    each day: the share of its runs that begin more than 5 s into their minute. It is read from `agent_basis`, not
    from the Edge logs as reference §4 item 39 measured it, because those may not reach back to 10-07 by the
    verdict. The tick writes `agent_basis` every fifth minute, and each row's `ts` is the instant that tick started
    (`runTick`'s clock), so the share is over the ticks of those minutes; a fifth minute with no row is counted apart.
    The table keeps 30 days: its daily prune, at 10:15 UTC, begins to remove 10-07's rows on 2026-11-06.
  - A shortfall on 10-08 is recorded as a deviation of RW's last day. RW's bar is unchanged.
- **The slip rule.**
  - A minute RW-C misses quotes nothing, as RW's spec says: "Minutes the engine missed quote nothing; a decided minute
    is never decided again." The run is neither moved nor extended for it; Part 3.5 reports minutes stored against
    minutes due.
  - RW-C is warm by 10-08 00:00 when two things hold. Its four calls must be rows of `edge-calls-every-minute`, with
    the Edge Function that answers them deployed, before 2026-10-08 00:00 UTC. And `pm_rwc_selection` must hold rows
    for 2026-10-08 by 00:10 UTC.
  - **Who checks it.** The check at 2026-10-08 00:10 UTC has an owner: an item in the ledger's list of what remains,
    written by the freeze commit, and, if Davies grants it the database connector, a scheduled check (a one-shot
    Routine) that runs it at 00:10. Without that Routine, the first session on or after 00:10 runs it before anything
    else. It reads only what the no-peek list below allows: whether `pm_rwc_selection` holds rows for 2026-10-08
    by 00:10 (`select exists (select 1 from public.pm_rwc_selection where day = date '2026-10-08' and selected_at <=
    timestamptz '2026-10-08 00:10:00+00')`), the command of `edge-calls-every-minute`, and which version of the Edge
    Function was deployed then. It writes its answer into the ledger. If RW-C is not warm, the move below is made that
    day. The rule below turns on what was stored by 00:10, not on when it was read, so a later check reaches the same
    answer.
  - If it is not warm by then, its fourteen days are the first fourteen full UTC days after its first full warm-up
    day. A full warm-up day is a UTC day that begins with the calls and the function in place, and whose selection is
    stored by 00:10.
  - `RWC_RUN_START` and `RWC_RUN_END` then move by the same whole number of days, in a commit that records the move.
    That commit is deployed before 2026-10-09 00:00 UTC, or with the build itself if the build deploys later. Every
    date in this Part moves with them, and nothing else changes.
  - If the move is not deployed in time, RW-C runs on its dates, and the short warm-up is reported as a deviation.
- **The replays.** RW-E and x1–x3 are replayed from RW-C's stored minutes by the frozen rules in `pmrw_e.ts`
  (`replayMinutes`) and `pmrw_x.ts` (`replayArms`, `armQuotes`). Every "from" is RW-C's first minute, 2026-10-09 00:00
  UTC.
  - `agents?action=pmrwc-e` (`RWCE_REPLAY`) replays arms `rw` and `e` into `pm_rwc_e_state` and `pm_rwc_e_days`.
  - `agents?action=pmrwc-x` (`RWCX_REPLAY`) replays arms `rw`, `e` and `x1`–`x3` into `pm_rwc_x_state` and
    `pm_rwc_x_days`. It uses RW-X's specs with `noSameDayFrom` and `from` at 10-09 00:00.
  - Both run every minute from 10-09 00:02, and they start flat with RW-C.
  - x2's previous mid is tracked from RW-C's first minute, so a market's first recorded minute of the run cannot start
    a pause.
- **The Agents page** (Davies, 2026-09-28). Neither decision below changes an engine, a replay or a row of
  `edge-calls-every-minute`.
  - RW-C's row, "Reward quotes confirmation", is kept off the Agents page until its warm-up begins at 2026-10-08
    00:00 UTC, and appears by itself from then.
  - The variant "Reward quotes variant-4" (`x3`) is off the Agents page. Both replays still compute it, unchanged:
    `pmrw-x` on RW's minutes and `pmrwc-x` on RW-C's. So every figure the verdicts need for `x3` is still in
    `pm_rw_x_days` and `pm_rwc_x_days`, and Parts 1 and 2 judge it as before.
  - What a session may read is unchanged: the no-peek list below covers RW-C's row and page from the moment they
    appear.
- **The checks before anything is read.**
  - RW's two checks (1.1's b and c) are run on RW-C's tables, with the same outcomes. If (b) fails, RW-C is void. If
    (c) finds missed prints, every arm is judged both ways and passes only if it passes both.
  - The replays' check covers every day 2026-10-09 → 10-22. The `rw` arm of each replay (`pm_rwc_e_days` and
    `pm_rwc_x_days`, arm `rw`) must equal `pm_rwc_days`: `total`, `stress_total` and `reward` within $0.01, and
    `fills` equal. The x replay's `e` arm must equal `pm_rwc_e_days` arm `e` in the same way.
  - A day missing from either side fails the check.
  - The replays compute the same comparison as they run: `checkMaxUsd`, and `checkEMaxUsd` over `checkEDays` days, in
    their states. The verdict recomputes it from the day rows.
  - If either check fails, the result is void, reported with the difference.
  - A void RW-C decides nothing. Nothing goes to Part 4; the void and its cause go to Davies, and a re-run needs a
    pre-registration of its own.
- **No peeking.** Until RW-C's verdict is computed, no earlier than 2026-10-23 00:05 UTC, nobody reads anything of
  `pm_rwc_*` except these health readings:
  - `pm_rwc_state`'s `last_minute`, `updated_at` and `last_error`, never its `state`;
  - the replays' `last_minute`, `updated_at` and `last_error`, and from their `state` only `checkMaxUsd`,
    `checkEMaxUsd`, `checkEDays` and `version`;
  - the number of distinct minutes `pm_rwc_minutes` holds for each UTC day;
  - whether `pm_rwc_selection` holds rows for a day;
  - which days `pm_rwc_days` holds, with each row's `detail->>'phase'` alone.

  Nothing else is read:
  - not a day row's `total`, `stress_total`, `reward`, `fills`, `capital`, `markets` or the rest of its `detail`;
  - not the replays' `diverged` lists or accounts;
  - not any row of selections, minutes, prints, fills or settlements;
  - not RW-C's row or page on the Agents page, and not the dashboard's `rwc` summary. No session opens them during
    the run. A check of how the page draws RW-C uses fixtures only (the browser sweep's).

  This includes the warm-up day, whose selection is probably RW's of the same day, before RW's verdict. Anything read
  beyond this is disclosed in the verdict as a deviation.
- **The primary** is the arm Part 1 names: the candidate, a variant that replaced it, or a variant sent here by 1.4.
  The other arms are descriptive. The primary's day rows come from `pm_rwc_days` for RW, `pm_rwc_e_days` arm `e` for
  RW-E, and `pm_rwc_x_days` arm `xN` for a variant.
- **The bar, all of, for the primary over its fourteen days:** RW's six conditions, as its spec words them, but seeded
  20261023. The spec's "Days and totals" apply to the primary's rows:
  - a day's total is the change of the running total over that UTC day, and 10-09's is counted against zero because
    the run starts flat;
  - the capital is RW's definition applied to the arm: the largest, over the fourteen days, of the sum of the capital
    of the markets quoting or holding that day;
  - per-market figures come from the last row's `detail.perMarket`.

  1. Total > 0.
  2. Stress total > 0.
  3. At least 100 fills.
  4. No single market holds more than 50 % of the total, and the total without the best market is > 0.
  5. The fourteen day totals resampled with replacement (2,000 draws, seed 20261023, drawn as rw_test.py draws them:
     Python's `random.Random(seed)`, fourteen `choice`s a draw, the sums sorted and the one at index
     `int(0.05 × 2000)` read): the 5th percentile of the sum is > 0. The day totals are listed in day order, 10-09
     first, as the ledger's verdict procedure lists RW's.
  6. Worth money: the total on the run's capital, annualised (× 365 / 14), exceeds 4 % a year.
- **When.** The verdict is computed on or after 2026-10-23 00:05 UTC, once `pm_rwc_days` has the row for 10-22 and both
  replays have closed 10-22. After it, a migration takes the four `pmrwc*` rows out of `edge-calls-every-minute`; the
  tables stay.
- **If Part 1 names nothing,** RW-C runs anyway, because it starts before the verdict can be known. Its result is then
  descriptive, and the line stays closed.
- **Power, disclosed.** Two closed days of RW gave daily stress of +$28.05 and −$56.58. At a daily stress SD near $60,
  a fourteen-day stress total has an SD near $225. So condition 2 is a point estimate, not a significance test. It
  holds roughly 90–95 % of the time if the true mean is +$25 a day, and 50 % of the time if it is zero. Twenty-eight
  days would narrow it by √2.
- **Pass:** the live-design question goes to Davies under Part 4. **Fail:** the line closes as in 1.5.

## Part 3 — reported beside every bar, never part of it

1. **Live capital:** the peak, over minutes, of the collateral of the quotes resting that minute (N × b for a bid,
   N × (1 − a) for an ask), summed over markets, plus the cost of the inventory held.
2. **Fills at our price:** the arm's total when prints AT our quote, on the side that takes it, also fill, up to the
   remaining N, after the strictly-through prints. Whether a print at our price would have reached us depends on the
   queue, which paper cannot see. The bar counts none of these prints and this reading counts all of them, so the
   two bracket that case. Its sign is not assumed.
3. **Maker rebates** on the arm's fills, by each market's published fee schedule and rebate share.
4. **Rewards, fills P&L and stress** by category and by horizon.
5. **Minutes stored against minutes due,** and what the missing minutes' markets paid on the days around them.
6. **On RW-C's days, every arm's result,** and the comparisons made by the arms' own seventh conditions: RW-E's stress
   against RW's, and each variant's against RW-E's.

## Part 4 — what any live step needs (not a test)

- Davies' word.
- The order path runs only in `eu-west-1`, and refuses unless `SB_REGION` is `eu-west-1`.
- Positions are opened only while his Ireland attestation is current: an expiring timestamp, set in the conversation
  where he says so. Otherwise it may only reduce or close.
  - For a two-sided maker, that means cancelling every quote that would open a position or enlarge one, on either
    side: every quote that would increase |inventory|. It also means no buy at all, since close-only allows only
    sells.
  - An ask is a bid for NO; its collateral is N × (1 − a), as in Part 3.1. So an ask placed while flat opens a
    position, and one placed while holding NO enlarges it. Placed while holding YES it is still a buy, of NO.
  - While he is not in Ireland, a market may rest only a sell of tokens it holds, for at most what it holds: YES sold
    at our ask, NO sold at 1 − our bid. Never a buy of the other token. A flat market rests nothing.
  - RW's score is the smaller side's, so one side earns nothing. It earns only while he is in Ireland.
- Never a VPN, a proxy or anyone else's account.
- `_shared/polymarket.ts` stays GET-only until the design is agreed.
- The Terms of Use bar (fp4 §0) is stated in the design as his accepted risk, with close-only mode as its named
  consequence.
- The wallet is kept small, because its key was exposed to another tool.
- A dry-run first, caps, a kill switch, and reconciliation by order id.
- The account's actual reward payouts are read against the formula for the same market-days. That is the one thing no
  paper test can show.

## What it cannot show

- What Polymarket actually pays.
- How other makers answer our quotes.
- Anything beyond fourteen more days.
- Days are not independent (inventory carries), so both bootstraps' levels are nominal.
- RW-C runs RW's code, so a fault its checks cannot see would be in both runs. The run of `rw_test.py`'s
  `run_market` beside check (b), a separate implementation, is the reading that could show one.

Deviations are recorded in the verdicts' write-ups, the reference (§4 item 36) and the ledger.
