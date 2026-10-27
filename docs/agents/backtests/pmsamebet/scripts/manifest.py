"""PMSAMEBET: write MANIFEST.json — the committed files' sha256 and the scratch inputs' sha256, size and lines.

The raw pulls (open_events.json is ~1 GB, the minute record and the trade tapes are large) stay in the scratch folder;
their hashes let a re-run be checked against the same bytes. relations.json.gz and the snapshot are committed under
data/ (small enough), so every number in results/ can be recomputed from the committed data and scripts.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/manifest.py
"""
import glob
import hashlib
import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.environ.get("PM_DATA", "")


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def lines(p):
    with open(p, "rb") as f:
        return sum(1 for _ in f)


files = {}
for sub in ("scripts", "results", "data"):
    folder = os.path.join(HERE, sub)
    if not os.path.isdir(folder):
        continue
    for f in sorted(os.listdir(folder)):
        if f.endswith((".py", ".txt", ".gz", ".json", ".md")):
            files[f"{sub}/{f}"] = sha(os.path.join(folder, f))
scratch = {}
for name in ["open_events.json", "universe.jsonl", "candidates.jsonl", "rel_events.json", "relations.json",
             "record.jsonl", "kalshi_lead.json", "history_14d.json"] + \
        [os.path.basename(p) for p in sorted(glob.glob(os.path.join(D, "snapshot_*.json")))] + \
        [os.path.basename(p) for p in sorted(glob.glob(os.path.join(D, "kalshi_*_*.json")))]:
    p = os.path.join(D, name)
    if os.path.exists(p):
        scratch[name] = {"sha256": sha(p), "bytes": os.path.getsize(p), "lines": lines(p)}
tapes = sorted(glob.glob(os.path.join(D, "trades", "*.json.gz")))
if tapes:
    h = hashlib.sha256()
    for p in tapes:
        h.update(os.path.basename(p).encode())
        h.update(sha(p).encode())
    scratch["trades/*.json.gz"] = {"files": len(tapes), "sha256_of_names_and_hashes": h.hexdigest(),
                                   "bytes": sum(os.path.getsize(p) for p in tapes)}
m = {
    "study": "PMSAMEBET: Polymarket stat-arb between markets that are (nearly) the same bet in different events, "
             "and Kalshi as a minute-scale clock (2026-10-27)",
    "review": "docs/agents/reviews/2026-10-27-pm-same-bet-statarb.md",
    "reads": "keyless public GETs only: Gamma /events/keyset (closed=false) and /events, /public-search; CLOB POST /books; "
             "data API /trades; Kalshi /trade-api/v2 markets, events and 1-minute candlesticks; one public rules PDF on "
             "polymarket-upload.s3. 2026-10-27 03:29-04:47 UTC. No SQL, no key, nothing placed.",
    "run_order": [
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/pull_open.py",
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/compact.py",
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/candidates.py docs/agents/backtests/pmsamebet/results",
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/relations.py",
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/snapshot.py docs/agents/backtests/pmsamebet/results (live books: differs on every run)",
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/allocate.py <snapshot json> docs/agents/backtests/pmsamebet/results",
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/record.py <snapshot json> 240 (live books, a read a minute; stopped by hand after 59 minutes)",
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/record_summary.py docs/agents/backtests/pmsamebet/results",
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/history.py <snapshot json> 14 docs/agents/backtests/pmsamebet/results",
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/kalshi_lead.py docs/agents/backtests/pmsamebet/results",
        "PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/manifest.py",
    ],
    "sha256": files,
    "scratch_inputs": scratch,
}
with open(os.path.join(HERE, "MANIFEST.json"), "w") as f:
    json.dump(m, f, indent=1, sort_keys=True)
    f.write("\n")
print(len(files), "committed files,", len(scratch), "scratch inputs")
