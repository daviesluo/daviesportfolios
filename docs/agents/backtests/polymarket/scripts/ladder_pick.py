"""Fetch the prints a frozen ladder rule names. The rule module does the choosing.

Prints counts only. Keyless. Resumes from $PM_DATA/<rule>.

usage: ladder_pick.py <rule module> <post_inputs.json.gz> <out.json.gz>
"""
import gzip
import importlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import ladder_hold  # noqa: E402
import pmnet  # noqa: E402
import post_inputs  # noqa: E402
import post_test  # noqa: E402


def cache_dir(rule):
    d = os.path.join(pmnet.DATA, rule)
    os.makedirs(d, exist_ok=True)
    return d


def prints_or_cache(rule, ev, cond, t0):
    path = os.path.join(cache_dir(rule), ev["slug"] + ".json")
    if os.path.exists(path):
        got = pmnet.load(path)
        if got.get("condition") == cond:
            return got.get("prints")
    got = post_inputs.prints_of(cond, t0, t0 + 3600)
    pmnet.dump(path, {"condition": cond, "prints": got})
    return got


def main():
    name, src, outp = sys.argv[1], sys.argv[2], sys.argv[3]
    mod = importlib.import_module(name)
    post_inputs._share_pace()
    with gzip.open(src, "rt") as f:
        rows = json.load(f)["events"]
    picked = 0
    incomplete = 0
    for row in rows:
        priors = ladder_hold.mids_before(row, rows)
        chosen = None
        if row.get("start") is not None and row.get("days") is not None:
            chosen = mod.choose(row, priors)
        if chosen is None:
            row["picked"] = None
            continue
        market, _fair = chosen
        td = post_test.decision_time(row)
        prints = prints_or_cache(name, row, market["condition"], td)
        row["picked"] = {"condition": market["condition"], "prints": prints}
        picked += 1
        if prints == "incomplete":
            incomplete += 1
    os.makedirs(os.path.dirname(os.path.abspath(outp)) or ".", exist_ok=True)
    with gzip.open(outp, "wt") as f:
        json.dump({"events": rows}, f, sort_keys=True, separators=(",", ":"))
    print("wrote", outp, "rule", name, "events", len(rows), "picked", picked, "incomplete", incomplete, flush=True)


if __name__ == "__main__":
    main()
