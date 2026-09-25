"""Fetch the pre-match prints a frozen baseball rule names.

The print window is the hour before first pitch. A buy of outcome 1 is stored
as a buy of outcome 0, and a sell is not turned into that buy. Keyless.

usage: mlb_pick.py --self-check
       mlb_pick.py <rule module> <mlb_inputs.json.gz> <out.json.gz>
"""
import gzip
import importlib
import json
import os
import sys

import pmnet
import post_inputs
import post_test


def cache_path(cond, t0, t1):
    d = os.path.join(pmnet.DATA, "mlb", "prints")
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


def shape_prints(prints, outcome):
    """Keep a buy of this outcome and store it as outcome 0. A sell is dropped."""
    if prints == "incomplete" or outcome in (None, 0):
        return prints
    out = []
    for row in prints or []:
        ts, side, oi, price, size = row
        if side == "BUY" and int(oi) == int(outcome):
            out.append([ts, "BUY", 0, price, size])
    return out


def self_check():
    raw = [
        [1, "BUY", 1, 0.4, 10],
        [2, "SELL", 0, 0.6, 10],
        [3, "SELL", 1, 0.4, 10],
        [4, "BUY", 0, 0.6, 10],
    ]
    got = shape_prints(raw, 1)
    if got != [[1, "BUY", 0, 0.4, 10]]:
        raise SystemExit("remap %s" % got)
    if shape_prints(raw, 0) != raw or shape_prints(raw, None) != raw:
        raise SystemExit("outcome 0 was rewritten")
    if shape_prints("incomplete", 1) != "incomplete":
        raise SystemExit("incomplete was rewritten")
    print("self-check ok")


def main():
    name, src, outp = sys.argv[1], sys.argv[2], sys.argv[3]
    mod = importlib.import_module(name)
    post_inputs._share_pace()
    with gzip.open(src, "rt") as f:
        data = json.load(f)
    book = data["scores"]
    picked = 0
    incomplete = 0
    for ev in data["events"]:
        chosen = mod.choose(ev, book)
        if chosen is None:
            ev["picked"] = None
            continue
        side, _fair = chosen
        market = ev["markets"][side]
        kick = float(ev["kick"]) if ev.get("kick") is not None else float(ev["end"])
        td = kick - post_test.OPEN_LAG
        prints = shape_prints(prints_or_cache(market["condition"], td, kick), market.get("outcome"))
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
    if len(sys.argv) >= 2 and sys.argv[1] == "--self-check":
        self_check()
    else:
        main()
