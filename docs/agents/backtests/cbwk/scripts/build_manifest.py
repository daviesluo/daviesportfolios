"""Write MANIFEST.json: every file in this folder (but the manifest) with its size and sha256, the files the pre-registration
freezes (`frozen`: this arm's, the base test's that stay as they were, and the release blackout's, which Deviation 3 / 2 name), what the scripts import read-only, and
how to re-run. `src/cb_hold_prereg.test.js` holds `frozen` to the files."""
import hashlib, json, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
sha = lambda p: hashlib.sha256(open(os.path.join(ROOT, p), "rb").read()).hexdigest()
FROZEN = {
    "this arm's": [
        "supabase/functions/agents/cb_hold.ts", "supabase/functions/agents/cb_hold.test.ts", "supabase/migrations/0118_cb_hold.sql",
        "docs/agents/backtests/cbwk/scripts/replay_wk.py", "docs/agents/backtests/cbwk/scripts/closure_world.ts",
        "docs/agents/backtests/cbwk/inputs/closure_world_export.json.gz", "docs/agents/backtests/cbwk/results/closure_world_reading.json",
    ],
    "the base test's, unchanged by 0118 and by the release blackout": [
        "supabase/functions/agents/cb_rec.ts", "supabase/functions/agents/cb_view.ts",
        "supabase/functions/agents/quotes.ts", "supabase/migrations/0112_cb_recorder_paper.sql", "docs/agents/backtests/cbpaper/scripts/replay.py",
    ],
    # Deviation 3 of the base test's pre-registration and Deviation 2 of this arm's (2026-10-15): the bytes they name.
    "the release blackout's, changed or added 2026-10-15": [
        "supabase/functions/agents/cb_quotes.ts", "supabase/functions/agents/cb_quotes.test.ts", "supabase/functions/agents/cb_releases.ts",
        "supabase/functions/agents/cb_releases.test.ts", "supabase/functions/agents/cb_blackout_world.ts",
        "docs/agents/backtests/cbreview/inputs/release_calendar.json",
    ],
}
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
    "study": "The reading of 'Stablecoin quotes with Euros - 2' (the Coinbase paper test with the interbank rates held through a closure, 0118): the reading script, bars 1 to 6, and the worked world that proves it",
    "write_up": ["docs/agents/reviews/2026-10-13-coinbase-weekend-prereg.md", "docs/agents/reviews/2026-10-15-coinbase-blackout.md"],
    "frozen": {group: {p: sha(p) for p in paths} for group, paths in FROZEN.items()},
    "imports_read_only": {
        "docs/agents/backtests/cbpaper/scripts/replay.py": "the base test's replay (and through it docs/agents/scripts/pr5/pr5_sim.py, the frozen simulator)",
    },
    "run": [
        "npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env docs/agents/backtests/cbwk/scripts/closure_world.ts   # -> inputs/closure_world_export.json.gz",
        "cd scripts; python3 -I replay_wk.py ../inputs/closure_world_export.json.gz > ../results/closure_world_reading.json",
        "at the reading: replay_wk.py on the pre-registration's export (§3)",
        "cd scripts; python3 -I build_manifest.py",
    ],
    "files": files,
}
json.dump(man, open(os.path.join(HERE, "MANIFEST.json"), "w"), indent=1, sort_keys=True)
print(len(files), "files")
