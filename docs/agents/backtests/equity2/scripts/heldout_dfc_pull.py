"""DFC held-out test, step 1 of 2 (`docs/agents/reviews/2026-10-01-dfc-prereg.md`): check the input and the calendar
from the DATE column only. No network, no return parsed. It checks that the input is the frozen CRSP 202608 file
committed with EQ1, that its held-out rows run 2016-01-04 → 2026-08-31, and that the month turns with T in
2016-01 … 2026-07 number 127: 20 under T+3, 80 under T+2, 27 under T+1, the regime by T's date. Safe to run at any
time; step 2 (heldout_dfc_score.py) repeats these checks before it reads a return.
Run from anywhere inside the repository: python3 docs/agents/backtests/equity2/scripts/heldout_dfc_pull.py
"""
import gzip, hashlib, os, subprocess, sys

FF_REL = "docs/agents/backtests/equity/inputs/F-F_Research_Data_Factors_daily.csv.gz"
FF_SHA = "ac244ddd12706212aaf6a0d6c958df9972addbb9c390ad149b8456160ae9288c"
FIRST, LAST, LAST_T = 20160104, 20260831, 20260731
EXPECTED = {3: 20, 2: 80, 1: 27}


def regime(t):
    return 1 if t >= 20240528 else (2 if t >= 20170905 else 3)


repo = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True,
                      cwd=os.path.dirname(os.path.abspath(__file__))).stdout.strip()
ff = os.path.join(repo, FF_REL)
if hashlib.sha256(open(ff, "rb").read()).hexdigest() != FF_SHA:
    sys.exit("stop: the input is not the frozen CRSP 202608 file")
dates = []
with gzip.open(ff, "rt", encoding="latin-1") as f:
    started = False
    for line in f:
        s = line.strip()
        if not started:
            started = s.startswith(",") and "Mkt-RF" in s
            continue
        if not s or not s[0].isdigit():
            break
        dates.append(int(s.split(",", 1)[0]))                    # the date column only
held = [d for d in dates if 20160101 <= d <= LAST]
if held[0] != FIRST or held[-1] != LAST:
    sys.exit(f"stop: held-out rows run {held[0]} .. {held[-1]}")
T = [dates[i] for i in range(len(dates) - 1) if dates[i] // 100 != dates[i + 1] // 100 and 20160101 <= dates[i] <= LAST_T]
counts = {s: sum(1 for t in T if regime(t) == s) for s in EXPECTED}
if len(T) != 127 or counts != EXPECTED:
    sys.exit(f"stop: {len(T)} turns, by regime {counts}")
print(f"ok: input sha256 {FF_SHA}; held-out rows {held[0]} .. {held[-1]} ({len(held)} days); 127 turns, "
      f"T+3 {counts[3]}, T+2 {counts[2]}, T+1 {counts[1]}; first T {T[0]}, last T {T[-1]}; halves split after {T[62]}")
