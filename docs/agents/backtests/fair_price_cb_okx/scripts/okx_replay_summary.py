"""okx_replay.ts's runs as a table: per book and candidate, the round trips entered after the first (warm-up) day, their P&L in
the book's quote currency and in bps of notional, stops, sides, and what was still held at the end. Paired by UTC entry day
against par with the day bootstrap (fpc.bootstrap_paired), though nine and two days cannot separate anything.
usage: python3 -I okx_replay_summary.py RUNS.json PREP.json OUT.json
"""
import collections, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fpc as C  # noqa: E402


def main(runs_path, prep_path, out_path):
    runs = json.load(open(runs_path))
    prep = json.load(open(prep_path))
    res = {}
    for key, r in runs.items():
        b, name = key.split("|")
        t0 = prep[b]["t0"] + C.DAY                    # the first day only warms up the trailing medians
        t1 = prep[b]["minutes"][-1] + C.M
        tr = [x for x in r["trips"] if x[0] >= t0]
        pnl = sum(x[8] for x in tr)
        nt = sum(x[4] * x[5] for x in tr)
        d = collections.Counter()
        for x in tr:
            d[C.day_of(x[0])] += x[8]
        res[key] = {"from": C.day_of(t0), "days": round((t1 - t0) / C.DAY, 2), "trips": len(tr), "pnl_quote": round(pnl, 4),
                    "bps_per_trip": round(1e4 * pnl / nt, 2) if nt else None, "stops": sum(1 for x in tr if x[7] == "taker"),
                    "bids": sum(1 for x in tr if x[2] == "bid"), "asks": sum(1 for x in tr if x[2] == "ask"),
                    "held_at_end": len(r["open"]), "refused": r["refused"], "orders": r["orders"], "guards": r["guards"], "daily": dict(d)}
    for key, v in res.items():
        b = key.split("|")[0]
        base = res[f"{b}|par"]
        days = C.days_between(prep[b]["t0"] + C.DAY, prep[b]["minutes"][-1] + C.M)
        v["vs_par_per_day"] = {k: round(x, 4) for k, x in C.bootstrap_paired(v["daily"], base["daily"], days).items()}
    for v in res.values():
        v.pop("daily")
    json.dump(res, open(out_path, "w"), indent=1, sort_keys=True)
    for k, v in res.items():
        print(k, {kk: v[kk] for kk in ("trips", "pnl_quote", "bps_per_trip", "stops", "bids", "asks", "held_at_end", "vs_par_per_day")})


if __name__ == "__main__":
    main(*sys.argv[1:4])
