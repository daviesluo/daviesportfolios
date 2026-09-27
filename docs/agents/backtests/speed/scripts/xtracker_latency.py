"""SPEED step 2b: the tracker's latency, from `poll_xtracker.py`'s record.

For every post the tracker showed after its first poll: the capture after the post (`importedAt - createdAt`, the
tracker's own clock), and when the post became visible through the keyless API (the middle of (prev, seen], never
before the capture) after the capture and after the post.

usage: xtracker_latency.py <poll dir> <out json>
"""
import json
import sys
from collections import Counter


def lines(path):
    """A JSON-lines file, plain or gzipped (the committed copies are `<name>.gz`)."""
    import gzip
    import os
    f = gzip.open(path + ".gz", "rt") if not os.path.exists(path) and os.path.exists(path + ".gz") else open(path)
    with f:
        return [json.loads(x) for x in f if x.strip()]


def q(xs, p):
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(p * len(xs)))], 1) if xs else None


def stats(xs):
    return {"n": len(xs), "p10": q(xs, .1), "p50": q(xs, .5), "p90": q(xs, .9), "min": q(xs, 0), "max": q(xs, 1)} if xs else {"n": 0}


def main():
    d = sys.argv[1]
    posts = lines(d + "/xt_posts.jsonl")
    polls = lines(d + "/xt_polls.jsonl")
    new = [p for p in posts if not p["initial"] and p["created"] and p["imported"]]
    for p in new:
        lo = max(p["prev"] or p["seen"], p["imported"])
        p["est"] = (lo + p["seen"]) / 2 if p["seen"] >= lo else p["seen"]
    span = (max(x["t1"] for x in polls) - min(x["t0"] for x in polls)) / 60.0
    out = {"minutes": round(span, 1), "requests": len(polls),
           "failed": sum(1 for x in polls if x["status"] != 200),
           "new_posts": len(new), "by_handle": dict(Counter(p["h"] for p in new)),
           "capture_after_post_s": stats([p["imported"] - p["created"] for p in new]),
           "api_visible_after_capture_s": stats([p["est"] - p["imported"] for p in new]),
           "api_visible_after_post_s": stats([p["est"] - p["created"] for p in new]),
           "seen_after_capture_upper_s": stats([p["seen"] - p["imported"] for p in new]),
           "capture_batches": len({round(p["imported"], 0) for p in new}),
           "samples_api_visible_after_capture_s": sorted(round(p["est"] - p["imported"], 3) for p in new)}
    with open(sys.argv[2], "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
