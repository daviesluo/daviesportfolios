"""CBFAST, stage 2: the calendar blackout looked at event by event, and on top of the weekend hold (docs/agents/reviews/2026-10-15-coinbase-fast-move.md, §5).

The blackout is `g3d_cal all a1 b5`: from 1 minute before to 5 minutes after each scheduled release in ../inputs/events.json the fair is
withheld (entry rungs withdrawn, exit orders neither placed nor re-priced: what frozen `stepMinute` does with a null fair; the stop still runs). The grid (cbfast.py) found it the only guard positive in both 12-month spans;
here, for the base rule and for the weekend hold (cbk's "wkend" books, the live "- 2" arm's rule):
  * the arm's P&L with and without the blackout in each span, with the paired day-bootstrap, and the trips kept;
  * per event: the P&L of the trips the blackout removes (the base arm's trips entered in the window), their number, the sign, by kind;
  * a placebo: the same removed-trips figure at the same clock minute on the ten weekdays either side of every event, to show the
    events and not the clock are what the blackout avoids;
  * the worst days with and without it.
usage: python3 -I cbfast_events.py  -> ../results/cbfast_events.json
"""
import collections, datetime, json, multiprocessing as mp, os, statistics as st, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import cbfast as C  # noqa: E402

S, P, M, DAY, KEYS = C.S, C.P, C.M, C.DAY, C.KEYS
SPEC = {"fam": "g3_cal", "kind": "all", "a": 1, "b": 5, "dark": True}
ARMS = {"base": False, "hold": True}


def task(args):
    key, weekend = args
    touch = json.load(open(os.path.join(S.ROOT, "inputs", "touch.json")))[key]["half_spread"]
    B = C.cbk.build(key, weekend=weekend)
    S.META[key] = B.meta
    sig = C.signals(B, B.meta["tick"])
    ev = C.load_events()
    rungs = C.cbk.GRIDS["base"]
    base = C.patched(key, B, rungs, touch, lambda: C.gsim(B))
    pb, pa, mult, stop, dark = C.pauses(sig, SPEC, B, ev)
    guard = C.patched(key, B, rungs, touch, lambda: C.gsim(B, pb=pb, pa=pa, mult=mult, stop_min=stop, dark=dark))
    return key, weekend, C.pack(base), C.pack(guard), B.meta["t0"]


def window_sum(trips, a, z):
    sel = [x for x in trips if a <= x[0] <= z]
    return len(sel), sum(x[2] for x in sel)


def main():
    work = [(k, w) for w in ARMS.values() for k in KEYS]
    with mp.Pool(4) as pool:
        res = pool.map(task, work, chunksize=1)
    by = {name: {"base": [], "guard": []} for name in ARMS}
    for key, weekend, base, guard, t0 in res:
        name = "hold" if weekend else "base"
        by[name]["base"].append(base)
        by[name]["guard"].append(guard)
    events = [e for e in C.load_events() if C.SPANS["span_1_2024-10-09_to_2025-10-09"][0] <= e["t"] < C.END]
    out = {"blackout": SPEC, "arms": {}}
    for name, d in by.items():
        arm = {"spans": {}, "events": {}}
        for sp, w in C.SPANS.items():
            b_st, b_ser = C.span_stats(d["base"], w)
            g_st, g_ser = C.span_stats(d["guard"], w)
            arm["spans"][sp] = {"base": b_st, "blackout": g_st, "delta_gbp_per_year": g_st["gbp_per_year"] - b_st["gbp_per_year"],
                                "trips_kept": g_st["trips"] / b_st["trips"], "delta_boot": C.boot(b_ser, g_ser), "base_boot": C.boot(b_ser),
                                "worst_days_base": sorted(float(v) for v in b_ser)[:5], "worst_days_blackout": sorted(float(v) for v in g_ser)[:5]}
        trips = [x for p in d["base"] for x in p]
        rows, plc = [], collections.defaultdict(list)
        for e in events:
            n, v = window_sum(trips, e["t"] - SPEC["a"] * M, e["t"] + SPEC["b"] * M)
            rows.append({"kind": e["kind"], "day": e["day"], "removed_trips": n, "removed_pnl_gbp": round(v, 4)})
            for off in list(range(-14, -3)) + list(range(4, 15)):
                t = e["t"] + off * DAY
                if datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).weekday() < 5:
                    plc[e["kind"]].append(window_sum(trips, t - SPEC["a"] * M, t + SPEC["b"] * M)[1])
        arm["events"]["rows"] = rows
        kinds = {}
        for k in sorted({r["kind"] for r in rows}):
            v = [r["removed_pnl_gbp"] for r in rows if r["kind"] == k]
            p = plc[k]
            kinds[k] = {"events": len(v), "removed_pnl_gbp": round(sum(v), 3), "events_where_removed_trips_lost": sum(1 for x in v if x < 0), "events_where_removed_trips_won": sum(1 for x in v if x > 0),
                        "events_with_no_trip": sum(1 for r in rows if r["kind"] == k and r["removed_trips"] == 0), "mean_per_event_gbp": round(sum(v) / len(v), 4),
                        "placebo_mean_per_window_gbp": round(sum(p) / len(p), 4), "placebo_windows": len(p)}
        allv = [r["removed_pnl_gbp"] for r in rows]
        allp = [x for k in plc for x in plc[k]]
        kinds["all"] = {"events": len(allv), "removed_pnl_gbp": round(sum(allv), 3), "events_where_removed_trips_lost": sum(1 for x in allv if x < 0), "events_where_removed_trips_won": sum(1 for x in allv if x > 0),
                        "events_with_no_trip": sum(1 for r in rows if r["removed_trips"] == 0), "mean_per_event_gbp": round(sum(allv) / len(allv), 4),
                        "placebo_mean_per_window_gbp": round(sum(allp) / len(allp), 4), "placebo_windows": len(allp)}
        arm["events"]["by_kind"] = kinds
        # events by span, for the sign count
        for sp, (a, z) in C.SPANS.items():
            v = [r["removed_pnl_gbp"] for r, e in zip(rows, events) if a <= e["t"] < z]
            arm["events"][sp] = {"events": len(v), "removed_pnl_gbp": round(sum(v), 3), "removed_lost": sum(1 for x in v if x < 0), "removed_won": sum(1 for x in v if x > 0)}
        out["arms"][name] = arm
    json.dump(out, open(os.path.join(ROOT, "results", "cbfast_events.json"), "w"), indent=1, sort_keys=True)
    for name, arm in out["arms"].items():
        print(name)
        for sp, v in arm["spans"].items():
            print("  %s base %.2f  blackout %.2f  delta %+.2f  kept %.3f  boot[p5 %+.1f p95 %+.1f]  worst base %.2f -> %.2f" % (
                sp[:6], v["base"]["gbp_per_year"], v["blackout"]["gbp_per_year"], v["delta_gbp_per_year"], v["trips_kept"], v["delta_boot"]["p5"], v["delta_boot"]["p95"],
                v["worst_days_base"][0], v["worst_days_blackout"][0]))
        for k, v in arm["events"]["by_kind"].items():
            print("  %-5s events %2d  removed %+8.3f  lost %2d won %2d none %2d  mean %+.4f  placebo %+.4f" % (
                k, v["events"], v["removed_pnl_gbp"], v["events_where_removed_trips_lost"], v["events_where_removed_trips_won"], v["events_with_no_trip"], v["mean_per_event_gbp"], v["placebo_mean_per_window_gbp"]))
        for sp in C.SPANS:
            print("  ", sp[:6], arm["events"][sp])


if __name__ == "__main__":
    main()
