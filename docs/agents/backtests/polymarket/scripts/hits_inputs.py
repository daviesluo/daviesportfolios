"""Fetch HITS prints. Shown prices are the POST input. The rule is hits_test.py.

Prints counts only. Keyless. Resumes from $PM_DATA/hits.

usage: hits_inputs.py <post_inputs.json.gz> <out.json.gz>
"""
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import hits_test  # noqa: E402
import pmnet  # noqa: E402
import post_inputs  # noqa: E402
import post_test  # noqa: E402

DATA = "https://data-api.polymarket.com"


def cache_dir():
    d = os.path.join(pmnet.DATA, "hits")
    os.makedirs(d, exist_ok=True)
    return d


def prints_or_cache(ev, cond, t0):
    path = os.path.join(cache_dir(), ev["slug"] + ".json")
    if os.path.exists(path):
        return pmnet.load(path)
    got = post_inputs.prints_of(cond, t0, t0 + 3600)
    pmnet.dump(path, got)
    return got


def main():
    src, outp = sys.argv[1], sys.argv[2]
    post_inputs._share_pace()
    with gzip.open(src, "rt") as f:
        rows = json.load(f)["events"]
    picked = 0
    incomplete = 0
    for row in rows:
        priors = hits_test._priors_for(row, rows)
        chosen = hits_test.choose(row, priors) if row.get("start") is not None and row.get("days") is not None else None
        if chosen is None:
            row["picked"] = None
            continue
        market, _fair = chosen
        td = post_test.decision_time(row)
        prints = prints_or_cache(row, market["condition"], td)
        row["picked"] = {"condition": market["condition"], "prints": prints}
        picked += 1
        if prints == "incomplete":
            incomplete += 1
    os.makedirs(os.path.dirname(os.path.abspath(outp)) or ".", exist_ok=True)
    with gzip.open(outp, "wt") as f:
        json.dump({"events": rows}, f, sort_keys=True, separators=(",", ":"))
    print("wrote", outp, "events", len(rows), "picked", picked, "incomplete", incomplete, flush=True)


if __name__ == "__main__":
    main()
