"""PMOPPS: the full market list of every event that pm-rec recorded two or more markets of (keyless Gamma reads).

Needed to know whether the markets pm-rec holds of a negative-risk event (or a date ladder) are the WHOLE set: a sum
over part of a set is not an arbitrage. Reads the event slugs from pm-rec's daily market dumps (the archive's `markets` objects,
pm_rec_markets); writes $PM_DATA/events.json: slug -> {negRisk, augmented,
markets: [{conditionId, question, groupItemTitle, active, closed, endDate, negRiskOther}]}.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/pull_events.py <pmrec dir>
"""
import glob
import gzip
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402

GAMMA = "https://gamma-api.polymarket.com"
ev = defaultdict(set)
for p in sorted(glob.glob(os.path.join(sys.argv[1], "markets_*.gz"))):
    with gzip.open(p, "rt") as f:
        for line in f:
            x = json.loads(line)
            if x.get("event_slug"):
                ev[x["event_slug"]].add(x["id"])
slugs = sorted(s for s, v in ev.items() if len(v) >= 2)
path = os.path.join(pmnet.DATA, "events.json")
out = json.load(open(path)) if os.path.exists(path) else {}
for n, s in enumerate(slugs):
    if s in out:
        continue
    try:
        d = pmnet.get(GAMMA + "/events", {"slug": s})
    except RuntimeError as e:
        out[s] = {"error": str(e)[:200]}
        continue
    e = d[0] if isinstance(d, list) and d else {}
    out[s] = {"negRisk": e.get("negRisk") or e.get("enableNegRisk"), "augmented": e.get("negRiskAugmented"),
              "markets": [{k: m.get(k) for k in ("conditionId", "question", "groupItemTitle", "active", "closed", "endDate", "negRiskOther")}
                          for m in (e.get("markets") or [])]}
    if n % 200 == 0:
        pmnet.dump(path, out)
        print(n, len(slugs), flush=True)
pmnet.dump(path, out)
print("events", len(out))
