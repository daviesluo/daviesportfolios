# PR5V's and rule D's reading scripts (2026-10-24)

Written and committed on 2026-10-24, before the deadline both pre-registrations set for their reading scripts
(2026-10-27 00:00 UTC) and before either reading (on or after 2026-10-28 01:00 UTC, at the latest 2026-11-04). This note
records what was committed, the files' sha256 (pinned by `src/pr5v_reading_prereg.test.js`, so a script cannot change
silently after today), and every gap in the pre-registrations that the scripts had to read narrowly. It changes no
frozen file: `reviews/2026-09-28-pr5-variant-prereg.md` and `reviews/2026-09-28-pr5-rule-d-prereg.md` are untouched.

**Written strictly from the pre-registrations, with no discretionary choice.** The session that set this work up read
PR5V's and variant-2's daily results for 2026-09-28 → 09-30 on 2026-09-30 (the ledger's history, 22:14 UTC, discloses
it), and no-peek rules were cancelled on 2026-10-04. Every metric, bar, window, exclusion and tie-break in the scripts is
the pre-registrations' as written, with their recorded deviations (reference §4 items 45 and 47): the governor 900 / 950
(PR5V's deviation 2, rule D's deviation 3), arm d on PR5's stored X (rule D's deviation 2), and the 0.03 % rung left only
rule D's twin (its deviation 4). Each output repeats that disclosure and says the reading was not blind.

**Tested on synthetic data only.** `reading_fixture.py` builds a record on the pre-registrations' own dates whose answers
are worked out by hand in its docstring: two fills a day on USDC-GBP at 7997 and 7996 ticks, making 100 × 3 / 7997 and
100 × 4 / 7996 dollars a trip; a null whose every twin makes 100 / 7999; and a +0.04 % fair move on USDT-GBP that
re-prices nine rungs a side under PR5V's rule and four under rule D's. `test_reading.py` runs both readings on it and on
broken copies of it (33 checks, `backtests/pr5v/test_reading.txt`):

- PR5V reads PASS.
- Rule D reads FAIL on condition 3, because arm d equals variant-1 every day, so p ≤ 0 is 1. It reads PASS when
  variant-1 is made $0.001 a trip worse.
- Dropped trips, a forged governor count, a drifted arm v1, an incomplete export and a missing minute each fail or stop
  what they guard.

Both scripts first show, on the study's committed markets, that the replay's markets reproduce the study's runs trip for
trip and POST for POST (PR5V 563 trips / $29.5129 and 40 / $2.5438; rule D 593 / $30.3004 and 60 / $3.7420): they do.
Nothing was run on the real window. The export statements were checked only with `EXPLAIN`, which runs nothing, against
the table definitions read from `information_schema`.

## The files

| file | sha256 |
| --- | --- |
| `docs/agents/scripts/pr5v/reading_common.py` | `1b89c9d736bca5037df4fbc641e65684af8e98f2ef19bf0ed2513061d9073393` |
| `docs/agents/scripts/pr5v/reading_pr5v.py` | `3e60421d8a1968bf61e8c0a2abe7b24e741de4596ee0a2a3021c708955ed52da` |
| `docs/agents/scripts/pr5v/reading_ruled.py` | `2aff5328b41caf4e2fd810d17763d9dadf967f79ce3d7c154a2dc7ec8380c1d9` |
| `docs/agents/scripts/pr5v/reading_grab.py` | `50188c51477e1f5ed45c7c3da5dadb61713ca7284339b194b8e1313cccf358b6` |
| `docs/agents/scripts/pr5v/reading_pull.sql` | `1432aecca76a60fbce81434483fc342f55fd1cb682cc3314c245cd4decedb44a` |
| `docs/agents/scripts/pr5v/reading_pull_ruled.sql` | `eff969d00c796e22a8d9c8f68d778894b40c9f5717703f7f869b7e55688963a5` |
| `docs/agents/scripts/pr5v/reading_fixture.py` | `10e74846f0fc4cdf714660e0eb8711ad04e85bbd920b3842a3f0db3df730e4da` |
| `docs/agents/scripts/pr5v/test_reading.py` | `d882a5ab3463a441eaa4d8b93e0818e2b8037df830a16d49a1c498df85df2908` |
| `docs/agents/backtests/pr5v/test_reading.txt` | `1c9586d22d21b470c24cc9f42728874ae37b8c2566fad57b2162f9881a3664a4` |

## What each computes, and its bar

**`reading_pr5v.py`** (PR5V, arm main). It checks the frozen files' hashes and runs the reproduction check. Then the
preconditions: the engine decided every minute before E = 2026-10-28 00:30, the export is complete, stepMinute is
unchanged since the freeze, and §3's end rule applies if PR5's record stopped. It replays main and its stress arm
(`pr5v_sim.simulate`, the nine rungs, re-price 0.03 %, shared 10 % cap, four keys, governor 900 / 950), flat from
2026-09-28 00:00 to E, and reads the five conditions:

1. Faithful: at least 95 % of the engine's window trips matched by the replay's (book, side, k, t_entry, entry ticks), at
   least 95 % the other way, and the P&L within 10 % of the engine's absolute P&L. Minutes whose exported print count
   differs are listed.
2. Above its null: the window's P&L above the p95 of `study.null_twins` (2,000 draws, seed 20260923), each twin run to
   min(E, m + 2 days).
3. Better than PR5: the daily difference main − PR5 by entry day, 10,000 resamples of circular 7-day blocks, seed
   20261027; the share of means at or below 0 under 0.05.
4. Stress: the P&L of the stress arm's window trips above 0.
5. The governor held: every entry POST had fewer than 900 POSTs of its key before it that UTC day, every other POST but
   a stop fewer than 950.

Then what §5 describes: %/yr on $3,600; the gain over PR5 against 8 %/yr on $2,400 ($0.526 a day); arm top5's numbers,
never judged; trips, wins, taker exits and P&L by book, side and rung; POSTs a key a day; the most POSTs a key sent at
one turn, against the venue's 10 a second; the governor's withdrawals; the rebuilt minutes; and the days from PR5's
first live order, apart.

**`reading_ruled.py`** (rule D, arm d). The same, with `fastx_sim.simulate` and rule D (`{"frac": 1/3, "away": null}`),
and the X arm d recorded as the replay's X. First comes the deviation check: arm v1 against PR5V's main by condition 1's
rule, and the largest daily difference over the window's days under $0.01. If it fails, rule D is not judged.
Condition 3 is arm d − PR5V's main, seed 20261028. It also describes arm v1, the TrueFX and Yahoo minute counts with the
paired gain on each, and checks every TrueFX row's `x_d_read` is before its minute.

**The exports.** `reading_pull.sql` and `reading_pull_ruled.sql` are SELECT only, in weekly pages, with a meta statement
whose counts the pages must add up to. `reading_grab.py` cuts each saved reply into `data/<table>.txt`, checking its md5
and line count.

## The gaps, read narrowly

- **match_multiset.** Condition 1's 'has a trip in the other with the same book, side, k, t_entry and entry ticks' is read one to one: each trip matches at most one trip of the other set (a multiset intersection).
- **match_empty.** A share over an empty set (no engine trip, or no replay trip, in the window) is not 'at least 95 %': the condition fails.
- **pnl_tolerance_zero.** With the engine's window P&L exactly 0, the 10 % tolerance is 0: the two sets' P&L must be equal.
- **null_p95_rounded.** Condition 2 compares the window's P&L, unrounded, with the p95 as the frozen null_twins returns it (rounded to 4 decimals by study.py).
- **governor_order.** The engine's events carry no sequence column. Condition 5 counts a key's POSTs before each POST in the order the engine decides: by minute, the turn's POSTs before the minute's stops, each in k order (a key is one book and side; bids before asks is then the order of the keys, not within one). The count each POST event carries (detail.n, the key's count after it) is checked against that recount; the condition passes only if it holds on both.
- **posts_one_turn.** 'The most POSTs a key sent at one turn, stops included' is counted per key and decided minute: the turn's POSTs plus the stops of that minute.
- **first_live_split.** 'The days from its first live order' are the window's UTC entry days from the day of PR5's first order of mode live, that day included; the days before it are reported beside them.
- **stopped_record.** If PR5's engine's last decided minute is before E - 1 min, the window ends on the last UTC day D whose D + 2 days 00:30 the variant's record covers without a gap, and E moves to that instant (PR5V §3). Its record is read only from the minute rows the variant engine wrote, which it writes only once PR5's engine has decided the minute (or rebuilt it, which is not its record stopping).
- **last_step_close.** 'None may close at a run's last step': a scored replay trip closed at the replay's last step means the replay is not the one §5 describes; the reading is then reported, not judged, and says so.
- **stepminute_changed.** Whether stepMinute changed before E is read from the repository: the function's text in supabase/functions/agents/quotes.ts at the freeze commit 157ad527 and as checked out. A difference stops the reading with that finding: when it deployed is not in the repository, and §3's end rule then needs that date, which this script does not guess.
- **check_window_days.** 'checkMaxUsd over the window's days is under $0.01' is computed from the exports over the window's days (the largest absolute difference of daily P&L, by UTC day of entry, between arm v1 and PR5V's arm main); the engine's stored checkMaxUsd covers every day either has a trip and is reported beside it.
- **paired_gain_by_source.** 'The paired gain on each set' of minutes (TrueFX, Yahoo) is the sum, over the window's trips entered in a minute of that set, of arm d's P&L less PR5V's arm main's.

## For Davies

Nothing needs a decision before the reading. Two things to know:

- Rule D's §9 proposes, beside its reading, a descriptive line on arm d without its 0.03 % rungs. It was proposed, not
  adopted, so the script does not compute it. If he wants it, the reading session adds it as a described line, never a
  condition.
- PR5V's §3 end rule needs the instant stepMinute changed, if it ever did. The script compares the function's text at
  the freeze and at the reading, and stops on a difference rather than guess a deploy date. Today it is unchanged.
