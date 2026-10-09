"""Write MANIFEST.json: every file in this folder (but the manifest) with its size and sha256, the STATARB-2 inputs the
backtest reads (they stay in ../statarb_search2/inputs/football/, not copied), and how to re-run."""
import hashlib, json, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOOT = os.path.join(os.path.dirname(HERE), "statarb_search2", "inputs", "football")


def h(p):
    b = open(p, "rb").read()
    return {"bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()}


files = {}
for root, _, names in os.walk(HERE):
    for n in sorted(names):
        p = os.path.join(root, n)
        rel = os.path.relpath(p, HERE)
        if rel == "MANIFEST.json" or "__pycache__" in rel:
            continue
        files[rel] = h(p)
ext = {f"../statarb_search2/inputs/football/{n}": h(os.path.join(FOOT, n)) for n in sorted(os.listdir(FOOT))}
man = {
    "study": "VB-K design: value bets at UK bookmakers against a sharp price, out-of-sample, staking, limits, delay, "
             "Polymarket and Smarkets live legs, matched-betting arithmetic (2026-10-09)",
    "write_up": "docs/agents/reviews/2026-10-09-vbk-design.md",
    "run": [
        "cd scripts; python3 -I vbk_backtest.py      # football-data (STATARB-2's files) -> results/vbk_backtest.json + bet lists; byte-identical on re-run",
        "cd scripts; python3 -I vbk_bankroll.py      # bet lists -> results/vbk_bankroll.json (seeded); byte-identical on re-run",
        "cd scripts; python3 -I vbk_live_snapshot.py # keyless Smarkets x Polymarket now -> inputs/live/, results/live_snapshot_<stamp>.json (a re-run reads a later book)",
        "cd scripts; python3 -I vbk_pm_drift.py      # keyless Polymarket minute history -> inputs/pm_drift/, results/pm_drift_<stamp>.json",
        "cd scripts; python3 -I vbk_matched.py       # newest live snapshot -> results/vbk_matched.json",
        "cd scripts; python3 -I build_manifest.py",
    ],
    "keyless_sources": ["football-data.co.uk season CSVs (via STATARB-2)", "api.smarkets.com/v3 events, markets, contracts, quotes, volumes",
                         "gamma-api.polymarket.com events", "clob.polymarket.com book and prices-history"],
    "external_inputs": ext,
    "files": files,
}
json.dump(man, open(os.path.join(HERE, "MANIFEST.json"), "w"), indent=1, sort_keys=True)
print(len(files), "files,", len(ext), "external inputs")
