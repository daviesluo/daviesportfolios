"""PMOPPS: write MANIFEST.json (the committed files' sha256, and the scratch inputs' sha256 so a re-run can be checked).

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/manifest.py <daytable_api.csv.gz>
"""
import glob
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.environ.get("PM_DATA", "")


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


files = {}
for sub in ("scripts", "results"):
    for f in sorted(os.listdir(os.path.join(HERE, sub))):
        if f.endswith(".py") or f.endswith(".txt"):
            files[f"{sub}/{f}"] = sha(os.path.join(HERE, sub, f))
scratch = {}
for p in sorted(glob.glob(os.path.join(D, "closed", "*.json"))) + [os.path.join(D, f) for f in (
        "events.json", "sets_scan.json", "disputes_raw.json", "disputes.json", "theta_raw.json", "theta.json", "created.json", "sponsored.json")] \
        + sorted(glob.glob(os.path.join(D, "dno_*.json"))):
    if os.path.exists(p):
        scratch[os.path.relpath(p, D)] = sha(p)
scratch["lpbest daytable_api.csv.gz (LP-BEST's scripts/daytable.py output)"] = sha(sys.argv[1])
m = {
    "study": "PMOPPS: what else on Polymarket is worth a new paper test (2026-10-13); DEADLINE-NO, its one lead, tested on 2024 and closed",
    "review": ["docs/agents/reviews/2026-10-13-polymarket-opportunities.md", "docs/agents/reviews/2026-10-13-deadline-no-2024-prereg.md", "docs/agents/reviews/2026-10-13-deadline-no-2024-result.md"],
    "reads": "keyless public GETs only (Gamma /markets/keyset, /events, /markets; data API /v2/resolutions; CLOB /prices-history, "
             "/rewards/markets/current), 2026-10-13 02:30-04:30 UTC; pm-rec's archive (books and markets dumps, 2026-10-04 19:00 -> "
             "10-12 23:59 UTC, every object's sha256 checked against pm_rec_archive) downloaded by an earlier study into the scratch folder; "
             "one read-only SQL select (pm_lp_reward_days' paid, sponsored and rebates)",
    "run_order": [
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/pull_closed.py 2025-01 2026-10",
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/pull_events.py <pmrec dir>",
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/sets_scan.py <pmrec dir> <scratch>/events.json",
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/sets_summary.py <scratch>/events.json > results/sets.txt",
        "PM_DATA=<scratch> python3 -I -u docs/agents/backtests/pmopps/scripts/disputes.py > results/disputes.txt",
        "PM_DATA=<scratch> python3 -I -u docs/agents/backtests/pmopps/scripts/theta.py > results/theta.txt",
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/pool_age.py <lpbest daytable_api.csv.gz> > results/pool_age.txt",
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/sponsored.py > results/sponsored.txt (a live snapshot: it differs on every run)",
        "DEADLINE-NO (frozen at 74a6833b, 2026-10-13 13:45:25 UTC): pull_closed.py 2024-01 2024-12, then deadline_no.py 2024 > results/deadline_no_2024.txt",
        "deadline_no.py 2025 / 2026 (every market, prices cache seeded from theta_raw.json) > results/deadline_no_2025_full.txt / _2026_full.txt",
        "deadline_robust.py > results/deadline_robust.txt (after the verdict; description only)",
    ],
    "seeds": {"bootstrap": 20261013},
    "sha256": files,
    "scratch_inputs_sha256": scratch,
}
json.dump(m, open(os.path.join(HERE, "MANIFEST.json"), "w"), indent=2)
print(len(files), "files,", len(scratch), "scratch inputs")
