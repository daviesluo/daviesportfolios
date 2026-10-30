# MMCOMP: write MANIFEST.json, every committed file of the folder with its sha256, and the inputs it reads from other studies.
# python3 -I docs/agents/backtests/mmcomp/scripts/manifest.py
import hashlib, json, os

HERE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
out = {
    "study": "MMCOMP, docs/agents/reviews/2026-10-30-revx-mm-competition.md",
    "written": "2026-10-30 UTC",
    "inputs_from_other_studies": [
        "docs/agents/backtests/inputs/pr5_2026-09-23/ (trades, fx, candles)",
        "docs/agents/backtests/fair_price/data/ (prints, minutes, hours, fx, book_*, cb_*)",
        "docs/agents/backtests/pr5_opt/scripts/sim.py and fair_price/scripts/fp_data.py (imported unchanged by inner_rung.py)",
    ],
    "database": "sql/*.sql, SELECT only through the Supabase connector, 2026-10-30 00:45-01:10 UTC; their answers are in the review",
    "network": "scripts/bot_elsewhere.py and scripts/venues_hist.py read public venue endpoints (GET only)",
    "files": {},
}
for root, _, files in os.walk(HERE):
    for f in sorted(files):
        p = os.path.join(root, f)
        rel = os.path.relpath(p, HERE)
        if rel == "MANIFEST.json" or "__pycache__" in rel:
            continue
        out["files"][rel] = hashlib.sha256(open(p, "rb").read()).hexdigest()
out["files"] = dict(sorted(out["files"].items()))
json.dump(out, open(os.path.join(HERE, "MANIFEST.json"), "w"), indent=1)
print(len(out["files"]), "files")
