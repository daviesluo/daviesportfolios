# PMSTATARB verification — parameters

The study parameters are the ones in `SPEC-for-verification.md` (commit `985a89a4`).
This file records what that spec left to the run. The values below were not
chosen after seeing a result.

## Deviation from SPEC rule 5

SPEC rule 5 says these parameters are frozen in the first commit, before the
pull that can answer them. This file was first added in the same commit as
the first TOUCH-CAL verdict. The commit history is not rewritten to move the
file earlier. The re-run after the May title-date fix and the taker-side
fill fix used these same hours, thresholds, stakes, seed and bar. That
re-run does not cure the late freeze. The late freeze is the deviation.

- **TOUCH-CAL and BUCKET-DIST.** Entry hours, deviation thresholds, stakes, the
  bootstrap seed `20261014`, the universe window 2025-01-01 → 2026-09-30, and
  the five bar conditions are the spec's. They are not retuned.
- **SPORTS-XCHECK day: 2026-10-18.** The NFL Sunday after this run started
  (2026-10-14). Named here before any game book, moneyline, spread or total is
  read. One snapshot of that day's games; no second day.
- **Kalshi** is a reference price only. No account is opened and nothing is traded.
- **Fees** are whatever G4 reads at source on the day it runs. This file does not
  copy a rate in.
