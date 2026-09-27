"""SPEED step 2b: the post tracker's own clock — how often xtracker.polymarket.com imports posts.

From the tracker's post lists PMLATE pulled (copied by `copy_counts.py`): every distinct `importedAt` instant per
account is one import batch; the gaps between batches and where in a five-minute cycle each batch falls say how
often the resolution source's counter can move, which bounds any reaction to it however fast the loop.

usage: tracker_cadence.py <SPEED data folder> <out json>
"""
import gzip
import json
import os
import sys
from collections import Counter, defaultdict


def q(xs, p):
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


def main():
    d = os.path.join(sys.argv[1], "count", "xt")
    by = defaultdict(set)
    lags = []
    for n in sorted(os.listdir(d)):
        h = n.split("_")[1]
        with gzip.open(os.path.join(d, n), "rt") as f:
            for c, i, _ in json.load(f):
                if i:
                    by[h].add(round(i))
                    if c:
                        lags.append(i - c)
    out, allg, phase = {"accounts": {}}, [], Counter()
    for h, s in sorted(by.items()):
        s = sorted(s)
        gaps = sorted(b - a for a, b in zip(s, s[1:]) if b - a < 3600)
        allg += gaps
        for t in s:
            phase[int(t) % 300 // 30] += 1
        out["accounts"][h] = {"batches": len(s), "gap_s": {"p10": q(gaps, .1), "p50": q(gaps, .5), "p90": q(gaps, .9)}}
    allg.sort()
    lags.sort()
    n = sum(phase.values())
    out["all_gaps_s"] = {"n": len(allg), "min": allg[0] if allg else None, "p10": q(allg, .1), "p50": q(allg, .5)}
    out["batch_second_in_5min_cycle_share"] = {f"{k * 30}-{k * 30 + 30}s": round(phase[k] / n, 4) for k in range(10)}
    out["capture_after_post_s"] = {"n": len(lags), "p10": round(q(lags, .1), 1), "p50": round(q(lags, .5), 1),
                                   "p90": round(q(lags, .9), 1)}
    with open(sys.argv[2], "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps({k: v for k, v in out.items() if k != "accounts"}, indent=1))


if __name__ == "__main__":
    main()
