"""Write MANIFEST.json: every file in this folder (but the manifest) with its size and sha256, what it imports read-only,
and how to re-run."""
import hashlib, json, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIM = os.path.normpath(os.path.join(HERE, "..", "..", "scripts", "pr5", "pr5_sim.py"))
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
    "study": "Revolut X against Coinbase for PR5's frozen rule, the budget split between them, and the Coinbase paper test's faithfulness check (2026-10-10)",
    "write_up": ["docs/agents/reviews/2026-10-10-coinbase-vs-revolutx.md", "docs/agents/reviews/2026-10-10-coinbase-paper-prereg.md"],
    "imports_read_only": {"docs/agents/scripts/pr5/pr5_sim.py": hashlib.sha256(open(SIM, "rb").read()).hexdigest(),
                          "docs/agents/backtests/cj5/": "paired.py's Revolut X book, GBP/USD, the USD hourly series",
                          "docs/agents/backtests/scq_venues/": "sv_sim.py's Coinbase books on its minute bars"},
    "run": ["cd scripts; python3 -I compare.py   # -> results/compare.json (about 15 minutes, four processes)",
            "cd scripts; python3 -I allocate.py  # -> results/allocation.json",
            "cd scripts; python3 -I replay.py EXPORT.json   # the pre-registration's bar 1, at the reading",
            "cd scripts; python3 -I build_manifest.py"],
    "files": files,
}
json.dump(man, open(os.path.join(HERE, "MANIFEST.json"), "w"), indent=1, sort_keys=True)
print(len(files), "files")
