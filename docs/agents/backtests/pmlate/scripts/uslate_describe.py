"""USLATE, after the verdict: where the primary arm's P&L came from (descriptive; it changes no condition).

From the committed input, the primary arm's fills are made again by `uslate_test.run` (the test's own function and
parameters). Reported: P&L by month and by half; the ten best and five worst target dates; every bucket of the best
date with its fills (report and fill instants, prices, shares, P&L); the buckets whose reports' verdict failed; by
resolution source and by station; the fills' gross edge and the delay from the report's observation to each fill;
and for the primary and each descriptive arm of `uslate_test.py`, its best date's share of its total.

usage: uslate_describe.py <input json.gz> <out json>
"""
import gzip
import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import uslate_test as T  # noqa: E402


def q(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


def main():
    inp, outp = sys.argv[1], sys.argv[2]
    with gzip.open(inp, "rt") as g:
        data = json.load(g)
    events = data["events"]
    by_id = {e["event"]: e for e in events}
    fills = T.run(events)
    total = sum(T.pnl(f) for f in fills)
    by = {k: defaultdict(float) for k in ("month", "date", "source", "station", "state")}
    nb = {k: defaultdict(set) for k in by}
    per_bucket = defaultdict(lambda: {"fills": 0, "pnl": 0.0, "cost": 0.0, "shares": 0.0})
    delays, edges = [], []
    for f in fills:
        e = by_id[f[1]]
        b = e["buckets"][f[2]]
        keys = {"month": f[0][:7], "date": f[0], "source": str(e.get("source")), "station": e["station"],
                "state": b["state"]}
        for k, v in keys.items():
            by[k][v] += T.pnl(f)
            nb[k][v].add((f[1], f[2]))
        pb = per_bucket[(f[1], f[2])]
        pb["fills"] += 1
        pb["pnl"] += T.pnl(f)
        pb["cost"] += f[4] * f[5]
        pb["shares"] += f[4]
        delays.append(f[3] - b["obs"])
        edges.append(1.0 - f[5])
    dates = sorted(by["date"].items(), key=lambda kv: -kv[1])
    best = dates[0][0] if dates else None

    def bucket_rows(sel):
        rows = []
        for (eid, i), v in sorted(per_bucket.items()):
            e = by_id[eid]
            b = e["buckets"][i]
            if not sel(e, b):
                continue
            fs = [f for f in fills if f[1] == eid and f[2] == i]
            rows.append({"event": eid, "date": e["date"], "city": e["city"], "hl": e["hl"], "station": e["station"],
                         "source": e.get("source"), "bucket": b["bucket"], "state": b["state"],
                         "reports_final": e["final"], "payout_yes": b["payout_yes"],
                         "report_obs": C.iso(b["obs"]), "lag_p90_s": e["lag_p90"],
                         "first_fill": C.iso(min(f[3] for f in fs)), "last_fill": C.iso(max(f[3] for f in fs)),
                         "fills": v["fills"], "shares": round(v["shares"], 4), "cost": round(v["cost"], 4),
                         "avg_price": round(v["cost"] / v["shares"], 6) if v["shares"] else None,
                         "pnl": round(v["pnl"], 6)})
        return sorted(rows, key=lambda r: -r["pnl"])

    top_buckets = sorted(per_bucket.items(), key=lambda kv: -kv[1]["pnl"])
    arms = {"primary": {}, "lag_p50_plus_60s": {"lag": "p50", "extra": 60}, "lag_p90_plus_300s": {"extra": 300},
            "lag_p90_plus_600s": {"extra": 600}, "g_min_0.005": {"g_min": 0.005}, "g_min_0.02": {"g_min": 0.02},
            "g_min_0.05": {"g_min": 0.05}, "uncapped": {"cap": float("inf")}, "share_100pct": {"share": 1.0}}
    conc = {}
    for name, kw in arms.items():
        bd = defaultdict(float)
        for f in T.run(events, **kw):
            bd[f[0]] += T.pnl(f)
        tot = sum(bd.values())
        d, v = max(bd.items(), key=lambda kv: kv[1]) if bd else (None, 0.0)
        conc[name] = {"total": round(tot, 6), "best_date": d, "best_date_pnl": round(v, 6),
                      "best_date_share": round(v / tot, 4) if tot > 0 else None,
                      "total_without_best_date": round(tot - v, 6)}
    inp_stats = {"events": len(events),
                 "events_by_source": dict(sorted(Counter(str(e.get("source")) for e in events).items())),
                 "events_by_month": dict(sorted(Counter(e["date"][:7] for e in events).items())),
                 "events_by_station": dict(sorted(Counter(e["station"] for e in events).items())),
                 "decided_buckets_by_state": dict(sorted(Counter(b["state"] for e in events for b in e["buckets"]).items())),
                 "decided_buckets_with_a_stale_print_after_their_report": sum(
                     1 for e in events for b in e["buckets"] if any(p[1] == 1 for p in b["prints"])),
                 "walks_complete": sum(1 for e in events if e.get("complete")),
                 "stations_without_a_september_lag": sorted({e["station"] for e in events if e.get("lag_p50") is None})}
    out = {
        "input_stats": inp_stats,
        "arms_concentration": conc,
        "total": round(total, 6), "fills": len(fills), "bucket_deaths": len(per_bucket),
        "by_month": {k: {"pnl": round(v, 6), "bucket_deaths": len(nb["month"][k])} for k, v in sorted(by["month"].items())},
        "best_dates": [{"date": d, "pnl": round(v, 6), "share_of_total": round(v / total, 4) if total else None,
                        "bucket_deaths": len(nb["date"][d])} for d, v in dates[:10]],
        "worst_dates": [{"date": d, "pnl": round(v, 6), "bucket_deaths": len(nb["date"][d])} for d, v in dates[-5:]],
        "total_without_best_date": round(total - (dates[0][1] if dates else 0.0), 6),
        "total_without_best_two_dates": round(total - sum(v for _, v in dates[:2]), 6),
        "dates_positive": sum(1 for _, v in dates if v > 0), "dates_negative": sum(1 for _, v in dates if v < 0),
        "best_date_buckets": bucket_rows(lambda e, b: e["date"] == best),
        "verdict_failed_buckets": bucket_rows(lambda e, b: (b["state"] == "dead" and b["payout_yes"] == 1.0)
                                              or (b["state"] == "locked" and b["payout_yes"] != 1.0)),
        "top_ten_buckets_share_of_total": round(sum(v["pnl"] for _, v in top_buckets[:10]) / total, 4) if total else None,
        "by_source": {k: {"pnl": round(v, 6), "bucket_deaths": len(nb["source"][k])} for k, v in sorted(by["source"].items())},
        "by_station": {k: {"pnl": round(v, 6), "bucket_deaths": len(nb["station"][k])} for k, v in sorted(by["station"].items())},
        "by_state": {k: {"pnl": round(v, 6), "bucket_deaths": len(nb["state"][k])} for k, v in sorted(by["state"].items())},
        "fill_delay_after_observation_s": {p: q(delays, v) for p, v in (("p10", .1), ("p50", .5), ("p90", .9))},
        "fill_gross_edge": {p: round(q(edges, v), 4) for p, v in (("p10", .1), ("p50", .5), ("p90", .9))},
    }
    with open(outp, "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=True)
        fh.write("\n")
    print(json.dumps({k: out[k] for k in ("input_stats", "total", "arms_concentration", "by_month", "best_dates", "worst_dates",
                                          "total_without_best_date",
                                          "total_without_best_two_dates", "dates_positive", "dates_negative",
                                          "top_ten_buckets_share_of_total", "by_source", "by_state",
                                          "fill_delay_after_observation_s", "fill_gross_edge")}, indent=1))
    for r in out["best_date_buckets"]:
        print("best date:", json.dumps(r))
    for r in out["verdict_failed_buckets"]:
        print("verdict failed:", json.dumps(r))


if __name__ == "__main__":
    main()
