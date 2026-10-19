# Deviation 1 to `SPEC-for-verification.md`: a usable S1b weekend by quote coverage

**Recorded 2026-10-19 03:20 UTC, before any S1b weekend is scored** (the first weekend, 10-18/19, is still inside
its window until Monday 22:05 UK). The spec itself is left byte for byte as frozen (its sha256 in `MANIFEST.json` is
unchanged); this file is the deviation, and the S1b write-up applies it and cites it.

**On whose word.** Davies, 2026-10-19, relayed by the coordinating session: "都按你推荐的来" ("go with what you
recommend"), choosing this deviation over storing the IG session in a database table (option A, not built into
production) and over accepting the shortfall.

## What changes

G4's acceptance defines a usable weekend by "at least 95% connection uptime over its scheduled window". The recorder
that was built polls IG's REST API once a minute (`ig?action=quotes`, migration `0122`) instead of holding one
Lightstreamer connection, so connection uptime has no meaning for it. On 2026-10-18 about one run in four failed with
IG refusing a fresh login's tokens (ledger, item 14, history 2026-10-18 04:12-21:43 UTC); six fixes moved the failure
but did not remove it. Failed runs never came two in a row (224 of 224 runs after a failure succeeded), so the quote
the recorder holds is never older than about two minutes.

**The replacement, for the S1b epic over the FX window (Sunday 20:50 to Monday 22:05 UK):** a minute is covered when
the recorder holds a quote for the epic no older than 2 minutes at the minute's end (an `ig_quotes` row with
`ts <= end` and `seen_until >= end - 2 min`). **A weekend is usable when all of these hold:**

1. at least 95% of the window's minutes are covered (replaces "95% connection uptime");
2. the first `TRADEABLE` quote at or after Sunday's documented open is captured (unchanged);
3. none of the ten minutes from the open is uncovered (added: the decision quote and its +1/+5/+10-minute readings
   stay exact);
4. no run of uncovered minutes is longer than 5 (replaces "no unexplained disconnect over five minutes").

**Unchanged:** every other G4 and S1b condition and bar; the target of 12 consecutive weekends with skipped or failed
weekends in the denominator; "a minute with no tick is not a failed minute if the last quote is present"; clock offset
logged (each run's `clock_offset_ms`); source timestamps never replaced by receive timestamps.

**Reported beside it, always:** the run-level success rate over the same window (runs `ok` of runs started), so the
recorder's own failure rate is never hidden by the coverage figure.

## The reading's statement

`sql/s1b_coverage.sql`, read-only, with the weekend's window, open, account and epic set in its `params`. It returns
the minutes, the covered minutes and their share, the longest run of uncovered minutes, the uncovered minutes in the
first ten after the open, the first `TRADEABLE` quote and the runs ok.

The first weekend, read 2026-10-19 03:17 UTC, window not yet ended: 448 of 448 minutes covered (100.00%), longest
uncovered run 0, none uncovered in the first ten, first `TRADEABLE` quote 2026-10-18 20:00:05 UTC (21:00:05 UK), runs
ok 338 of 448 (75.4%). The weekend's final figure is read once its window has ended, after 2026-10-19 21:05 UTC.
