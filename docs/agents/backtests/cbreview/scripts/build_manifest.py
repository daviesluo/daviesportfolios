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
    "study": "The Coinbase recorders and paper test's first days (2026-10-12): the read-only health and interim queries, the minute-record defect (the replay of bar 1 on the first lit day, as stored and with the lost extremes put back), the proposed repair, and CBK, PR5's frozen rule on Coinbase's history with one change at a time (rungs, a basis skew, weekends held); and, from 2026-10-15, CBFAST: what a fast-move / scheduled-release guard would have done (the release calendar, the FX-lag measurement, 164 guard variants on two 12-month spans, the 2026-10-14 day replayed on the engine's record)",
    "write_up": ["docs/agents/reviews/2026-10-12-coinbase-first-days.md", "docs/agents/reviews/2026-10-15-coinbase-fast-move.md", "docs/agents/reviews/2026-10-15-coinbase-blackout.md"],
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
        "sql/export_lit_lines_1012_1014.sql (two chunks) -> scripts/pack_lines_1014.py -> inputs/lit_lines_1012_1014.json.gz; sql/export_trips_to_1014.sql -> inputs/trips_to_1014.json (2026-10-15 00:20 UTC)",
        "cd scripts; python3 -I pull_cb_candles.py  # keyless public Coinbase candles -> inputs/cb_implied_eurusd.json.gz (about 2 min)",
        "cd scripts; python3 -I calendar_events.py  # the first draft of the calendar (superseded by release_calendar.py)",
        "cd scripts; python3 -I release_calendar.py # -> inputs/release_calendar.json and inputs/events.json: the Fed's, ECB's and BoE's own dates, the BLS dates as recalled (bls.gov refused) and checked, every URL tried; reads inputs/yahoo_calendar.json when a pull of Yahoo's calendar is saved there",
        "cd scripts; python3 -I fxlag.py            # -> results/fxlag.json",
        "cd scripts; python3 -I cbfast.py stage1    # -> results/cbfast_grid.json (about 25 min on four cores)",
        "cd scripts; python3 -I cbfast_events.py    # -> results/cbfast_events.json (about 3 min)",
        "cd scripts; python3 -I cbfast_lit.py base 'g3d_cal all a1 b5' ...   # -> results/cbfast_lit.json (the 2026-10-14 day on the engine's record)",
        "sql/export_revx_paper_record.sql (3 selects) -> scripts/pack_revx_record.py -> inputs/revx_paper_record.json.gz (PR5's paper engine's own prints and minutes, 2026-09-25 .. 10-15)",
        "cd scripts; python3 -I cbfast_revx.py     # -> results/cbfast_revx.json (about 6 min): the blackout on PR5's rule over Revolut X, a proposal",
        "cd scripts; python3 -I build_manifest.py",
    ],
    "files": files,
}
json.dump(man, open(os.path.join(HERE, "MANIFEST.json"), "w"), indent=1, sort_keys=True)
print(len(files), "files")
