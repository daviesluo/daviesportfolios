"""PMSAMEBET step 2: the tradable slice of the open universe, one market a line.

Keeps a market when it is active, not closed, accepting orders, ends after the pull, and has $1,000 or more of book
liquidity or $500 or more of volume in the last 24 hours (Gamma's own `liquidityNum`, `volume24hr`). Writes
$PM_DATA/universe.jsonl with the event's id, slug, title, negRisk flag and tags beside each market.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/compact.py
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402

MIN_LIQ, MIN_VOL24 = 1000.0, 500.0


def main():
    src = os.path.join(pmnet.DATA, "open_events.json")
    now = datetime.fromtimestamp(os.path.getmtime(src), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    kept = seen = 0
    with open(os.path.join(pmnet.DATA, "universe.jsonl"), "w") as f:
        for e in pmnet.iter_array(src):
            for m in e["markets"]:
                seen += 1
                if not (m.get("active") and not m.get("closed") and m.get("acceptingOrders")):
                    continue
                if not m.get("endDate") or m["endDate"] <= now:
                    continue
                if (m.get("liquidityNum") or 0) < MIN_LIQ and (m.get("volume24hr") or 0) < MIN_VOL24:
                    continue
                r = dict(m)
                r.update({"eid": e["id"], "eslug": e["slug"], "etitle": e["title"], "enegRisk": e.get("negRisk"),
                          "tags": e.get("tags") or [], "edesc": (e.get("description") or "")[:2000]})
                f.write(json.dumps(r, sort_keys=True) + "\n")
                kept += 1
    print("pull_mtime", now, "markets_seen", seen, "kept", kept)


if __name__ == "__main__":
    main()
