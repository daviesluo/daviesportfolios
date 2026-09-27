"""SPEED: copy PMLATE's September exploration inputs into this study's own data folder (read-only on PMLATE's).

PMLATE's pulls live in its scratch folder, which another study reads and writes while this one runs. This copies what
step 1 needs and nothing else: the September event list (target dates 2026-09-01 → 09-26; Gamma tag 103040), the
print file of each of its CLOSED events, and each station's reports restricted to 2026-08-31 → 09-28 (the station files
there also hold other months' METARs now; only September's are kept). No print of any other month is opened.

usage: copy_september.py <PMLATE data folder> <SPEED data folder>
"""
import gzip
import json
import os
import shutil
import sys
from datetime import datetime, timezone

T0 = datetime(2026, 8, 31, tzinfo=timezone.utc).timestamp()
T1 = datetime(2026, 9, 28, tzinfo=timezone.utc).timestamp()


def load(p):
    with gzip.open(p, "rt") as f:
        return json.load(f)


def dump(p, obj):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with gzip.open(p + ".tmp", "wt") as f:
        json.dump(obj, f, sort_keys=True, separators=(",", ":"))
    os.replace(p + ".tmp", p)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    evf = os.path.join(src, "univ", "events_2026-09-01_2026-09-27.json.gz")
    ev = load(evf)
    os.makedirs(os.path.join(dst, "univ"), exist_ok=True)
    shutil.copyfile(evf, os.path.join(dst, "univ", "events_2026-09-01_2026-09-27.json.gz"))
    events = ev["events"]
    stations, n_pr, miss = set(), 0, 0
    os.makedirs(os.path.join(dst, "prints"), exist_ok=True)
    for e in events.values():
        if not ("2026-09-01" <= e["date"] <= "2026-09-26") or not e.get("closed"):
            continue
        if e.get("station") and e["station"] != "HKO":
            stations.add(e["station"])
        p = os.path.join(src, "prints", f"ev_{e['event']}.json.gz")
        if os.path.exists(p):
            shutil.copyfile(p, os.path.join(dst, "prints", f"ev_{e['event']}.json.gz"))
            n_pr += 1
        else:
            miss += 1
    n_obs = {}
    for st in sorted(stations):
        p = os.path.join(src, "obs", st + ".json.gz")
        if not os.path.exists(p):
            continue
        o = load(p)
        keep = {"iem": [r for r in o.get("iem", []) if T0 <= r["ts"] < T1],
                "awc": [r for r in o.get("awc", []) if r.get("obs_ts") and T0 <= r["obs_ts"] < T1]}
        dump(os.path.join(dst, "obs", st + ".json.gz"), keep)
        n_obs[st] = [len(keep["iem"]), len(keep["awc"])]
    print("events", len(events), "print files", n_pr, "missing", miss, "stations", len(n_obs))
    print(json.dumps(n_obs))


if __name__ == "__main__":
    main()
