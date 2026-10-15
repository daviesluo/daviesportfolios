# PMSTATARB verification — parameters frozen before the pulls that can answer them

The study parameters are the ones in `SPEC-for-verification.md` (commit `985a89a4`).
This file adds only what that spec left to the first commit of the run. Nothing
here was chosen after seeing a result.

- **TOUCH-CAL and BUCKET-DIST.** Entry hours, deviation thresholds, stakes, the
  bootstrap seed `20261014`, the universe window 2025-01-01 → 2026-09-30, and
  the five bar conditions are the spec's. They are not retuned.
- **SPORTS-XCHECK day: 2026-10-18.** The NFL Sunday after this run started
  (2026-10-14). Named here before any game book, moneyline, spread or total is
  read. One snapshot of that day's games; no second day.
- **Kalshi** is a reference price only. No account is opened and nothing is traded.
- **Fees** are whatever G4 reads at source on the day it runs. This file does not
  copy a rate in.
