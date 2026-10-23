# LPRESEL6 withdrawn, 2026-10-23

**Withdrawn, not run.** The frozen pre-registration (`2026-10-09-lp-reselect6h-prereg.md`) is not edited; this note is its
withdrawal, and `reference.md` and the ledger point here.

## What it was

LPRESEL6 was an offline replay of one question: should live-prep re-choose its Polymarket markets every six hours instead of
once a day? It ran live-prep's rule against the same rule choosing again every 6 h, on pm-rec's whole-universe record of
2026-10-09 00:00 → 10-23 00:00 UTC. It was frozen on 2026-10-09 at commit `242596a1`, before any of that record was read for
its design. Its code is `docs/agents/backtests/lpresel6/`, pinned by `src/lp_resel6_prereg.test.js`.

## Why it is withdrawn

- Reward quotes are closed: the paper tests stopped (`0120`, 10-13) and live-prep has been disarmed since `0125` (10-16).
- The pm recorders were retired by `0137` (10-23), so the record that fed it grows no more.
- The reading can change no decision. A selection cadence matters only for a path that quotes, and none does.
- Running it costs a lot for that: the build needs the whole archive downloaded (about 6.5 GB) and a 12 GB heap, and the
  10-23 attempt was stopped there (`2026-10-23-lp-reads.md`).

## On whose word

Davies, 2026-10-23, asked whether to download the archive and run it or to withdraw it: "选择你来决定吧" (you decide). The
coordinating session decided to withdraw.

## What is kept

The archive and every recorded row (the `pm_rec_*` tables and the archive objects) are kept; `0137` dropped nothing. So the
reading could still be run later, as frozen, from a tree at `242596a1` (`git archive 242596a1
docs/agents/backtests/lpresel6 docs/agents/backtests/rwc_opt/scripts supabase/functions` gives the frozen bytes, as
`2026-10-23-lp-reads.md` checked). The archive's signed URLs last a year from their last signing.

## What was read for it

Nothing beyond the archive index coverage check noted in `2026-10-23-lp-reads.md` (336 hours of each kind for 10-09 → 10-22;
1,436–1,440 book frames a day). No object was downloaded and no result was computed. That check was descriptive and was not
the bar's own coverage test.
