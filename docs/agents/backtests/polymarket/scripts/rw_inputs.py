"""RW data step: the compact, committed input of the test (fp4).

From the recorded books ($PM_DATA/rw/books/<minute>.json), the prints and the
status after the window (rw_after.py), keep per market and per minute of the
eight-hour window exactly what the frozen rule reads: the touch (best bid, best
ask), the size-cutoff-adjusted best bid and ask (the best levels holding at least
the minimum qualifying size) and the others' scores Q1 (bids) and Q2 (asks) of
levels of at least that size within `v` cents of the adjusted midpoint. Writes
`inputs/rw_inputs.json.gz`.

usage: rw_inputs.py <out .json.gz>
"""
import glob
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

WINDOW_S = 8 * 3600


def summary(book, v, ms):
    if not book:
        return None
    bids, asks = book["b"], book["a"]
    if not bids or not asks:
        return None
    bb, ba = bids[0][0], asks[0][0]
    ab = next((p for p, s in bids if s >= ms), None)
    aa = next((p for p, s in asks if s >= ms), None)
    if ab is None or aa is None:
        return [bb, ba, None, None, 0.0, 0.0]
    m = (ab + aa) / 2
    q1 = q2 = 0.0
    for p, s in bids:
        d = (m - p) * 100
        if s >= ms and 0 <= d < v:
            q1 += ((v - d) / v) ** 2 * s
    for p, s in asks:
        d = (p - m) * 100
        if s >= ms and 0 <= d < v:
            q2 += ((v - d) / v) ** 2 * s
    return [bb, ba, ab, aa, round(q1, 4), round(q2, 4)]


def main():
    outp = sys.argv[1]
    base = os.path.join(pmnet.DATA, "rw")
    uni = pmnet.load(os.path.join(base, "universe.json"))
    mk = uni["markets"]
    files = sorted(glob.glob(os.path.join(base, "books", "*.json")), key=lambda p: int(os.path.basename(p)[:-5]))
    first = int(os.path.basename(files[0])[:-5])
    t0 = pmnet.load(files[0])["t0"]
    series = {c: [] for c in mk}
    n_rounds = 0
    for p in files:
        minute = int(os.path.basename(p)[:-5])
        if minute >= first + WINDOW_S:
            break
        rec = pmnet.load(p)
        n_rounds += 1
        for c, m in mk.items():
            b = rec["books"].get(c)
            series[c].append([minute, summary(b, m["v"], m["min_size"])])
    status = pmnet.load(os.path.join(base, "status.json"))
    prints = {}
    incomplete = []
    for c in mk:
        pp = os.path.join(base, "prints", c + ".json")
        if not pmnet.exists(pp):
            incomplete.append(c)
            continue
        d = pmnet.load(pp)
        if not d.get("complete"):
            incomplete.append(c)
        prints[c] = [r for r in d["rows"] if first <= r[0] < first + WINDOW_S + 60]
    out = {"T0": t0, "first_minute": first, "window_s": WINDOW_S, "rounds": n_rounds, "universe_t": uni["t"],
           "markets": {c: {"rate": m["rate"], "v": m["v"], "min_size": m["min_size"], "tick": m["tick"], "end": m["end"],
                           "cat": m.get("cat"), "q": m.get("q"), "event": m.get("event"), "series": series[c],
                           "prints": prints.get(c, []), "status": status.get(c)} for c, m in sorted(mk.items())},
           "prints_incomplete": sorted(incomplete)}
    blob = json.dumps(out, sort_keys=True, separators=(",", ":")).encode()
    with gzip.GzipFile(outp, "wb", mtime=0) as f:
        f.write(blob)
    print("rounds", n_rounds, "markets", len(mk), "bytes", len(blob), "prints incomplete", len(incomplete))


if __name__ == "__main__":
    main()
