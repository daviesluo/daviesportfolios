"""Write MANIFEST.json: every file in this folder (but the manifest) with its size and sha256, what it imports read-only, and how
to re-run."""
import hashlib, json, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BT = os.path.normpath(os.path.join(HERE, ".."))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
files = {}
for root, _, names in os.walk(HERE):
    for n in sorted(names):
        p = os.path.join(root, n)
        rel = os.path.relpath(p, HERE)
        if rel == "MANIFEST.json" or "__pycache__" in rel:
            continue
        b = open(p, "rb").read()
        files[rel] = {"bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()}
man = {
    "study": "The Coinbase recorders and paper test's first days (2026-10-12): the read-only health and interim queries, the minute-record defect (the replay of bar 1 on the first lit day, as stored and with the lost extremes put back), the proposed repair, and CBK, PR5's frozen rule on Coinbase's history with one change at a time (rungs, a basis skew, weekends held)",
    "write_up": ["docs/agents/reviews/2026-10-12-coinbase-first-days.md"],
    "imports_read_only": {
        "docs/agents/backtests/cbpaper/scripts/replay.py": sha(os.path.join(BT, "cbpaper", "scripts", "replay.py")),
        "docs/agents/scripts/pr5/pr5_sim.py": sha(os.path.join(BT, "..", "scripts", "pr5", "pr5_sim.py")),
        "docs/agents/backtests/scq_venues/": "sv_sim.py and its committed inputs (Coinbase's minute bars, GBP/USD and EUR/USD, the hourly dollar books); CBK's base arm reproduces cbpaper/results/compare.json",
    },
    "run": [
        "sql/health.sql, sql/interim.sql: read-only, against production, as run 2026-10-12 ~23:00-23:20 UTC (their output is quoted in the write-up)",
        "sql/export_lit_window.sql -> inputs/lit_window_lines.json.gz (rows as {book: lines}, gzipped with sorted keys); inputs/trips_lit_window.json is cb_quote_trips for the same window",
        "cd scripts; python3 -I replay_check.py   # -> results/replay_check.json (the stored record 3 of 8 trips; the restored one 8 of 8)",
        "cd scripts; python3 -I cbk.py            # -> results/cbk.json (about 80 s on four cores)",
        "sql/repair_minute_bars.sql: PROPOSED and not run (an update); see the write-up, section 2",
        "cd scripts; python3 -I build_manifest.py",
    ],
    "files": files,
}
json.dump(man, open(os.path.join(HERE, "MANIFEST.json"), "w"), indent=1, sort_keys=True)
print(len(files), "files")
