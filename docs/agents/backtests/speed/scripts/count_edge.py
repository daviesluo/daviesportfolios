"""SPEED step 1b (exploration only): the post-count markets — how much of the stale side's edge is left L seconds after
the post that decided a bucket, and L seconds after Polymarket's tracker (the resolution source) captured it.

The post-count family as PMLATE's `count_measure.py` defines it, re-read from its own inputs (copied by
`copy_counts.py`; PMLATE's phase 1 measured all of it, and it registers nothing): every closed weekly/daily post-count
event whose rules give a window and whose tracker posts and prints were pulled. The k-th post of the window (by post
time) kills the bucket whose top is k - 1, or locks "k or more"; the k-th capture (the tracker's `importedAt`) is when
the resolution source's counter reached k. "Informative": the last print in the hour before the post still gave the
bucket a chance (YES >= 0.05 dead, <= 0.95 locked); a trap: the market resolved against the count.

Measures, per family (Elon's series, sampled; the seven smaller series, every event) and class: the net edge ($, whole
stale-side prints, floored at 0) at or after post + L and capture + L, its share of the post-post total, and USLATE's
fill model at those instants (half of each print with g >= 1 ¢, $100 a bucket, the market's own fee; a trap loses
1 - g + fee a share). Print times are the data API's settlement times (whole seconds).

usage: count_edge.py <SPEED data folder> <out json>
"""
import bisect
import os
import sys
from collections import defaultdict

DATA = sys.argv[1] if len(sys.argv) > 1 else "."
os.environ["PMLATE_DATA"] = DATA
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "pmlate", "scripts"))
import json  # noqa: E402
from datetime import datetime  # noqa: E402

import common as C  # noqa: E402
import count_common as K  # noqa: E402
from count_measure import HANDLE, window, yes_of  # noqa: E402
from explore import fee  # noqa: E402

L_POST = [0, 5, 10, 20, 30, 45, 60, 90, 120, 150, 180, 240, 300, 600, 900, 1800, 3600]
L_CAP = [-300, -120, -60, -30, -10, 0, 1, 2, 5, 10, 20, 30, 60, 120, 300]
CAP = 100.0


def q(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


def capture(stale, L, trap):
    cost = pnl = 0.0
    filled = False
    for dt, size, g, net, f in stale:
        if dt < L or g < 0.01:
            continue
        sh = size / 2.0
        c = 1.0 - g
        if c <= 0:
            continue
        if cost + sh * c > CAP:
            sh = (CAP - cost) / c
        if sh <= 0:
            break
        filled = True
        cost += sh * c
        pnl += sh * ((-(1.0 - g) - f) if trap else (g - f))
        if cost >= CAP - 1e-9:
            break
    return pnl, cost, filled


def deaths():
    uni = C.load_json(os.path.join(DATA, "count", "universe_2025-09-26_2026-09-27.json"))["events"]
    out, skipped = [], defaultdict(int)
    for e in sorted(uni.values(), key=lambda x: x["event"]):
        if e["family"] != "posts" or e["series"] not in HANDLE:
            continue
        pth = os.path.join(DATA, "count", "prints", f"ev_{e['event']}.json")
        dpath = os.path.join(DATA, "count", "desc", f"ev_{e['event']}.json")
        if not C.pmnet.exists(pth) or not C.pmnet.exists(dpath):
            skipped["no_prints_or_rules"] += 1
            continue
        w = window(C.load_json(dpath)["d"], e["end"])
        if not w:
            skipped["no_window"] += 1
            continue
        t0, t1 = w
        iso0 = datetime.utcfromtimestamp(t0).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        iso1 = datetime.utcfromtimestamp(t1 - 1).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        handle = HANDLE[e["series"]]
        xdir = os.path.join(DATA, "count", "xt")
        if not C.pmnet.exists(os.path.join(xdir, f"xt_{handle}_{iso0[:13]}_{iso1[:13]}.json")):
            skipped["no_tracker_cache"] += 1      # never fetched here: only what PMLATE read
            continue
        posts = K.xt_posts(handle, iso0, iso1, xdir)
        if not posts:
            skipped["no_tracker_posts"] += 1
            continue
        cre = sorted(p[0] for p in posts if p[0])
        imp = sorted(p[1] for p in posts if p[1])
        rows = C.load_json(pth)["rows"]
        by_c = defaultdict(list)
        for r in rows:
            by_c[r[1]].append(r)
        fam = "elon" if e["series"].startswith("elon") else "smaller"
        for i, m in enumerate(e["markets"]):
            b = m["bucket"]
            if not b:
                continue
            lo, hi = b
            k = (hi + 1) if hi is not None else lo
            state = "dead" if hi is not None else "locked"
            if not k or k > len(cre):
                continue
            t_post, t_cap = cre[k - 1], (imp[k - 1] if k <= len(imp) else None)
            if t_post >= t1:
                continue
            prs = sorted(by_c.get(i, []))
            pre = [r for r in prs if t_post - 3600 <= r[0] < t_post]
            pre_y = yes_of(pre[-1][2], pre[-1][3], pre[-1][4])[1] if pre else None
            won = m["payout_yes"] == 1.0
            wrong = (state == "dead" and won) or (state == "locked" and not won)
            informative = pre_y is not None and ((state == "dead" and pre_y >= 0.05) or (state == "locked" and pre_y <= 0.95))
            rate = m["fee_rate"] or 0.0
            stale = []
            for r in prs[bisect.bisect_left([x[0] for x in prs], t_post):]:
                d, y = yes_of(r[2], r[3], r[4])
                if d is None or not ((state == "dead" and d == "SELL") or (state == "locked" and d == "BUY")):
                    continue
                g = y if state == "dead" else 1 - y
                stale.append((r[0] - t_post, r[5], g, g - fee(rate, y), fee(rate, y)))
            out.append({"event": e["event"], "series": e["series"], "fam": fam, "t0": t0, "t1": t1, "post": t_post,
                        "cap": t_cap, "informative": informative, "wrong": wrong, "stale": stale})
    return out, dict(skipped)


def main():
    outp = sys.argv[2]
    D, skipped = deaths()
    res = {"sample": "PMLATE's post-count exploration (phase1_counts.json): Elon's series sampled, seven smaller series whole",
           "skipped_events": skipped, "groups": {}}
    groups = defaultdict(list)
    for d in D:
        cls = "trap" if d["wrong"] else ("informative_held" if d["informative"] else "other_held")
        groups[(d["fam"], cls)].append(d)
        groups[("all", cls)].append(d)
    for (fam, cls), ds in sorted(groups.items()):
        span_days = max(1.0, (max(d["t1"] for d in ds) - min(d["t0"] for d in ds)) / 86400.0)
        tot = sum(sz * max(net, 0.0) for d in ds for dt, sz, g, net, f in d["stale"])
        tab = {}
        for L in L_POST:
            e = sum(sz * max(net, 0.0) for d in ds for dt, sz, g, net, f in d["stale"] if dt >= L)
            cap = [capture(d["stale"], L, cls == "trap") for d in ds]
            tab[str(L)] = {"net_edge_usd": round(e, 2), "share": round(e / tot, 4) if tot else None,
                           "uslate_fill_pnl_usd": round(sum(c[0] for c in cap), 2),
                           "uslate_buckets_filled": sum(1 for c in cap if c[2])}
        withc = [d for d in ds if d["cap"]]
        tot_c = sum(sz * max(net, 0.0) for d in withc for dt, sz, g, net, f in d["stale"])
        ctab = {}
        for L in L_CAP:
            rel = [[(d["post"] + dt - d["cap"], sz, g, net, f) for dt, sz, g, net, f in d["stale"]] for d in withc]
            e = sum(sz * max(net, 0.0) for st in rel for x, sz, g, net, f in st if x >= L)
            cap = [capture(st, L, cls == "trap") for st in rel]
            ctab[str(L)] = {"net_edge_usd": round(e, 2), "share": round(e / tot_c, 4) if tot_c else None,
                            "uslate_fill_pnl_usd": round(sum(c[0] for c in cap), 2),
                            "uslate_buckets_filled": sum(1 for c in cap if c[2])}
        lags = [d["cap"] - d["post"] for d in withc]
        first = [next((dt for dt, sz, g, net, f in d["stale"] if g >= 0.01), None) for d in ds]
        f_post = [x for x in first if x is not None]
        res["groups"][f"{fam}:{cls}"] = {
            "bucket_deaths": len(ds), "events": len({d["event"] for d in ds}), "span_days": round(span_days, 1),
            "post_post_net_edge_usd": round(tot, 2),
            "capture_after_post_s": {"p10": q(lags, .1), "p50": q(lags, .5), "p90": q(lags, .9)} if lags else None,
            "first_stale_print_after_post_s": {"n": len(f_post), "p25": q(f_post, .25), "p50": q(f_post, .5),
                                               "p75": q(f_post, .75)},
            "after_post": tab, "after_capture": ctab}
    with open(outp, "w") as f:
        json.dump(res, f, indent=1, sort_keys=True)
        f.write("\n")
    print("skipped", skipped)
    for k, v in res["groups"].items():
        print(k, v["bucket_deaths"], "events", v["events"], "days", v["span_days"], "post-post $", v["post_post_net_edge_usd"],
              "capture lag", v["capture_after_post_s"], "first stale", v["first_stale_print_after_post_s"])
        print("   share after post:", {L: v["after_post"][str(L)]["share"] for L in (0, 5, 10, 20, 30, 60, 120, 300)})
        print("   uslate after post:", {L: v["after_post"][str(L)]["uslate_fill_pnl_usd"] for L in (0, 5, 10, 30, 60, 120, 300)})
        print("   share after capture:", {L: v["after_capture"][str(L)]["share"] for L in (-60, 0, 2, 10, 60, 300)})
        print("   uslate after capture:", {L: v["after_capture"][str(L)]["uslate_fill_pnl_usd"] for L in (-60, 0, 2, 10, 60, 300)})


if __name__ == "__main__":
    main()
