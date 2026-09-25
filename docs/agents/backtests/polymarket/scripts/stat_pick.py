"""Fetch the pre-match prints a frozen stat rule names.

The print window is the hour before kickoff. Prints are cached by condition,
because several rules can name the same moneyline. Keyless.

usage: stat_pick.py <rule module> <stat_inputs.json.gz> <out.json.gz>
"""
import gzip
import importlib
import json
import os
import sys

import epl_score as score
import pmnet
import post_inputs


def cache_path(cond, t0, t1):
    d = os.path.join(pmnet.DATA, "stat", "prints")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "%s_%d_%d.json" % (cond, int(t0), int(t1)))


def prints_or_cache(cond, t0, t1):
    path = cache_path(cond, t0, t1)
    if os.path.exists(path):
        got = pmnet.load(path)
        if got.get("condition") == cond:
            return got.get("prints")
    got = post_inputs.prints_of(cond, t0, t1)
    pmnet.dump(path, {"condition": cond, "prints": got})
    return got


def main():
    name, src, outp = sys.argv[1], sys.argv[2], sys.argv[3]
    mod = importlib.import_module(name)
    post_inputs._share_pace()
    with gzip.open(src, "rt") as f:
        data = json.load(f)
    scores = data["scores"]
    picked = 0
    incomplete = 0
    for ev in data["events"]:
        chosen = mod.choose(ev, scores)
        if chosen is None:
            ev["picked"] = None
            continue
        side, _fair = chosen
        market = ev["markets"][side]
        end = float(ev["end"])
        td = end - score.LEAD
        prints = prints_or_cache(market["condition"], td, end)
        ev["picked"] = {"side": side, "condition": market["condition"], "prints": prints}
        picked += 1
        if prints == "incomplete":
            incomplete += 1
        if picked % 25 == 0:
            print("picked", name, picked, flush=True)
    os.makedirs(os.path.dirname(os.path.abspath(outp)) or ".", exist_ok=True)
    with gzip.open(outp, "wt") as f:
        json.dump(data, f, sort_keys=True, separators=(",", ":"))
    print("wrote", outp, "rule", name, "events", len(data["events"]), "picked", picked, "incomplete", incomplete, flush=True)


if __name__ == "__main__":
    main()
