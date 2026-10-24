# QUEUE's scorer and checks 1–3 (2026-10-24)

Written and committed on 2026-10-24, before the deadline QUEUE's pre-registration sets for them (2026-11-02 00:00 UTC)
and before the export, the tape and Kraken's main pull (from 2026-11-02 00:05 UTC). This note records what was committed,
each file's sha256 (pinned by `src/queue_scorer_prereg.test.js`, so the scorer cannot change silently after today), and
every gap in the pre-registration that the scorer had to read narrowly. It changes no frozen file:
`reviews/2026-09-28-queue-prereg.md` is untouched, and check 1 shows it is still its frozen text (commit `988eff83`) with
only deviation 1 appended.

**Written strictly from the pre-registration, with no discretionary choice.** Every rule, arm, metric, bar, window,
exclusion and tie-break is the pre-registration's as written. Where its text is silent, the narrowest reading it supports
is taken and named below, and repeated in the scorer's output (`gaps`). The reading is not blind, as its deviation 1
says: `agent_book_levels`, window rows included, has been read by other checks since 2026-10-03.

**Tested on synthetic data only.** Nothing was run on the window. The export statements were checked only with
`EXPLAIN`, which runs nothing, against the table definitions read from `information_schema`.

- **Check 2** runs on the committed inputs, as the pre-registration asks. With the layer off, the scorer reproduces
  PR6's 8,341 and PR5's 8,192 primary round trips, every stored field equal at the stored precision, both skipping quiet
  minutes and turning every minute. PR5's own `test_sim_logic.py` passes.
- **Check 3** (`scripts/checks.py`, output `check3.txt`) pins the queue layer's rules on made-up books and prints, each
  worked out by hand in the comment beside it: the 16 cases the pre-registration lists, plus the ports of PR5's
  `fxBarAt`, `fairHours`, `median` and `bookLevels`. Each pin also fails on a deliberately broken copy of the scorer, its
  own source with one named patch.
- **The end-to-end test** (`scripts/test_score.py`, output `test_score.txt`) writes a synthetic record in the reading's
  own layout and scores it, checks 1–3 first. Its answers are worked out by hand in the file's docstring: Q1 and Q2
  make 28 queue fills of $0.005; stress makes 9 stopped trips of −$0.090010; the bar is FAIL on conditions 3, 4 and 6;
  the hourly shift's p95 is $0.14, its lowest −$0.04749525; Q3's one trip matches PR5's engine trip field for field;
  check 4 fails on a P&L $0.001 off and allows it once the fill minute's print count differs. Check 5 holds: two runs
  of the scorer write byte-identical JSON.

## The files

| file | sha256 |
| --- | --- |
| `docs/agents/backtests/queue/scripts/qsim.py` | `552540b991a00dc345e3d3183dad8f5f6b596b61409319a1172a7053f585207c` |
| `docs/agents/backtests/queue/scripts/inputs.py` | `f7a764f2df63bd7e7373d1bdcca80cc5073e7f85cd612d90c7df63d89ff46a77` |
| `docs/agents/backtests/queue/scripts/bar.py` | `01218b613aa483850b17cb9a3001759523e79311cb40ba31409167085f131af2` |
| `docs/agents/backtests/queue/scripts/checks.py` | `d9fdc6aa46fb515dd149016767ae1cf6fee015c606cfe2f43a645bb0cf0f94cf` |
| `docs/agents/backtests/queue/scripts/score.py` | `9f8f805de3f83cc0472f2c3d8c5b5bd2c89f4cad796c1d5e798c37c11947990b` |
| `docs/agents/backtests/queue/scripts/test_score.py` | `b20180000ca5e458100803741cc40fe8f0bbc1c393b2286082b0db7d26719bb9` |
| `docs/agents/backtests/queue/scripts/decode_pages.py` | `23083633fdd0b623e2aed2ca3c829f30b2b9eb0bb5fc14585069cb55786bb8ad` |
| `docs/agents/backtests/queue/scripts/grab.py` | `d2feca7334dd22cf489a8e852b854603f06032b3abd184a5fdd2182c57017f54` |
| `docs/agents/backtests/queue/scripts/pull_tape.py` | `2795545026a2678a768832b4cce5882af316c1c1f68d4dcc5c29db713f480102` |
| `docs/agents/backtests/queue/scripts/pull_kraken.py` | `3fc9c70cdee4702ffe605ecc813ea47cb60ff7f8fd9563b5215c345242e656ee` |
| `docs/agents/backtests/queue/sql/book_pages.sql` | `290058dee8270f88f0f1db59eae1edf26dca26d24afd2eb9d20e1f56c4e45ff5` |
| `docs/agents/backtests/queue/sql/pr5_records.sql` | `9ce94bebba7d02684f54a3a2d0be4427fbd812b18ff99f262ab9b7ee2651ed81` |
| `docs/agents/backtests/queue/check3.txt` | `23591291b46dd4206682f42a4407939d9072be511eb57f623824401fceb27f2a` |
| `docs/agents/backtests/queue/test_score.txt` | `693eebd02b74be634af863637d0fe1dcea4795188b21d37ebc61adb702c128e8` |

## What the scorer computes, and its bar

**`scripts/qsim.py`** is PR5's turn re-implemented, with the queue layer on top: rules 1–8, the faulty rows, and the
stress version. Its arms are 3a (the layer off: the frozen fills), 3b (the optimistic queue), 3c (the last-print test
alone), 3d (the live lag), 3h (the middle queue), and the markouts and join statistics of 3e and 3f. The rules run on
the minute grid of the frozen simulators, and skipping a minute in which nothing can happen leaves a run identical
(check 2 runs both ways).

- **Q1:** par, rungs 9,999 / 9,998 / 9,997 and 10,001 / 10,002 / 10,003, the de-peg guard.
- **Q2:** Kraken's latest closed hourly VWAP with a trade, as an exact decimal rounded half up, dark after 180 minutes;
  re-priced whenever the fair differs.
- **Q3:** PR5's rule on the GBP books, on X and fairU as PR5's engine recorded them (rebuilt where missing), with the
  account's own fills taken out of the tape from PR5's first live order.

**`scripts/score.py`** runs checks 1–3 and opens nothing until they pass. Then it reads:

- the coverage: void minutes, faulty rows and short reads per book;
- Q1 and Q2: the primary, stress and every descriptive arm, and the bar. The six conditions, for each:
  1. P&L > 0 overall and in each half.
  2. The day bootstrap: `random.Random(20261004)`, 10,000 resamples of the 28 days, under Holm over Q1 and Q2 (0.025,
     then 0.05).
  3. Stress P&L > 0.
  4. At least 60 round trips from $1 of entry, and no UTC day over 1,000 orders.
  5. No day over 40 % of the P&L.
  6. P&L ≥ $1,200 × 0.08 × 28 / 365 = $7.3644, compared at full precision.

  Neither is judged if more than 10 % of either USD book's 40,320 window minutes are void. Beside the bar comes the hourly
  shift (3i: 671 shifts, p95 at index 636).
- Q3: every arm, reported apart from PR5's first live order, its orders against 700 a day, and check 4 against PR5's
  engine, which gates Q3 only;
- check 6, the recorder against PR5's snapshots, which gates nothing.

`score.py --twice` runs it twice in fresh processes for check 5.

**The data steps** are in `MANIFEST.json`'s `run`, with their dates:

- `sql/book_pages.sql`: the pre-registration's page statement, word for word, with its first-page and count
  statements; `scripts/decode_pages.py` decodes and checks the pages.
- `scripts/pull_tape.py`: PR6's own fetcher, unchanged.
- `scripts/pull_kraken.py`: the main OHLC pull and, only if an hour is missing, the trades.
- `sql/pr5_records.sql` with `scripts/grab.py`: PR5's records.

## The gaps, read narrowly (17)

- **x_of_piece.** An exit piece is converted at 'X of its own minute': the frozen convention, the latest X at or before that minute (PR5's lastX), since a dark minute has no X of its own.
- **entry_notional.** A round trip's entry notional (condition 4's $1) is its coins x entry price x the X at the fill; the trip's notional_usd stays the frozen nq x X at its close (equal for Q1 and Q2, X = 1).
- **optimistic_beyond_depth.** Arm 3b joins at L behind the level in the book at L only where that book holds the price within its depth; otherwise, as with no book, it joins as the primary.
- **inclusive_join.** In arms 3b and 3h, whose join is at L itself, prints count from L: a print stamped at L or later moves the order. In the primary a print stamped at or before the join's instant does not.
- **covers.** A row covers T when ts <= T <= seen_until; 'the first valid row after L' is the first with ts > L.
- **lag_pending.** Arm 3d: an order the turn removes keeps the life it would have had at its old price (its delayed go-live and its tests, if it had not gone live yet) until 30 s after the start of the next minute; any fill of it withdraws the rung's new order at that instant, and an exit piece leaves the rest to the next turn's exit.
- **orders_every_day.** Condition 4's 'no UTC day over 1,000 orders' reads every UTC day of the run (10-04 -> 11-01), both books together.
- **q3_start_both_books.** Q3's start, if moved, is the first later minute at which X is dark on both GBP books' records and no engine trip of either is open (one run decides both books).
- **check4_follows.** A check-4 difference 'follows from' an input-differing minute when the unmatched or differing trip's life [t_entry, t_exit] meets the waived span of its book: from that minute to the first minute at the end of whose step every rung of that book is idle in both runs.
- **check4_engine_idle.** The engine's rungs of a book are all idle at the end of minute m when no engine trip of that book is open at its end and either m is dark (no x or no fair_u in the record) or every rung held a position at its turn (read from the trips; the event log says the same of quotes).
- **check6_kinds.** Check 6 compares the snapshot's levels, through bookLevels, with the covering valid row's stored levels: equal; a different number of levels or any price different ('a price differs'); else a quantity or order count different.
- **account_resting.** Q3's 'minutes in which an order of the account rested in a book' are the minute starts from each live order's ts to its updated_at (the last settlement read), within the window, counted once a book.
- **bootstrap_pin.** Check 3's 'the day bootstrap on a made-up series of 28 days returns the p computed by hand' is pinned exactly on series whose p is exact by hand (every day positive: 0; every day 0: 1), and, on 27 days of +1 and one of -1,000 (p = 1 - (27/28)^28 by hand), within three standard errors of 10,000 draws.
- **arms_for_every_rule.** The descriptive arms 3a, 3b, 3c, 3d and 3h run for Q1, Q2 and Q3 alike; 3i (the hourly shift) for Q1 and Q2, as condition 2's sanity check; stress is the primary's arm with its three changes.
- **q2_hours_missing.** If a needed Kraken hour is missing and no trades file is there, Q2 is not run and the output says to rebuild every hour from the public trades (Data item 3); no bar is read for either until then, since Holm over Q1 and Q2 needs both p.
- **check5.** Check 5 is `score.py --twice`: the reading's JSON counts only when its .check5.json says the two runs were byte-identical.
- **shift_wrap.** Arm 3i: a twin's start wraps within [10-04 00:00, 11-01 00:00), and its search for a minute with a print and a fair runs forward and wraps at 11-01 00:00 to 10-04 00:00.

## For Davies

Nothing needs a decision before the export. Three things to know:

- **The data folder.** The pre-registration names none. `MANIFEST.json` proposes `docs/agents/backtests/queue/reading/`,
  which is a filing choice, not a rule.
- **The export's deadline.** The book export must be taken between 2026-11-02 00:10 and 2026-11-06 10:25 UTC. If
  check 4 has not passed by 2026-11-04 00:00 UTC, a longer retention of `agent_book_levels` goes to Davies, as the
  pre-registration says. The wake of 11-02 00:40 (`trig_01Q3DV4MArsf3tQ1Po8yCh1X`) is the one that takes it.
- **The pull's duration.** PR6's fetcher pulls the four books' 30 days at 1.1 s a request, which may take an hour or
  more. Kraken's main pull must land on 2026-11-02 between 00:05 and 19:59 UTC.
