"""okx_usdg_basis_replay.ts's three arms as the re-test's tables: by window (by a trip's entry minute), trips, fills by side,
P&L in euros (the quote currency), bps a trip, stops, the gain against par as a share of par's P&L, and the paired day-block
bootstrap of the daily difference (2,000 draws, seed 20261029; days with no trip in either arm count 0): its mean, 5th and 95th
percentile, and P(≤ 0), the share of draws whose mean difference is at most zero. Windows: the study's split (in sample
2026-02-23 → 07-01, out of sample 07-01 → 10-29 05:30), the halves by date (→ 06-11 12:00, after), and the whole span.
usage: python3 -I okx_usdg_basis_summary.py RUNS.json OUT.json
"""
import collections, json, os, random, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fpc as C  # noqa: E402


def boot(a, b, days, seed=20261029, n=2000):
    v = [a.get(d, 0.0) - b.get(d, 0.0) for d in days]
    rng = random.Random(seed)
    s = sorted(sum(rng.choice(v) for _ in range(len(v))) / len(v) for _ in range(n))
    return {"mean_day": round(sum(v) / len(v), 5), "p05": round(s[int(0.05 * n)], 5), "p95": round(s[int(0.95 * n) - 1], 5),
            "p_le_0": round(sum(1 for x in s if x <= 0) / n, 4)}


def main(runs_path, out_path):
    r = json.load(open(runs_path))
    t0, t1 = r["t0"], r["t1"]
    mid = t0 + (t1 - t0) // 2
    W = {"IS 02-23 → 07-01": (t0, C.iso_ms("2026-07-01T00:00:00Z")), "OOS 07-01 → 10-29": (C.iso_ms("2026-07-01T00:00:00Z"), t1),
         "first half by date": (t0, mid), "second half by date": (mid, t1), "all": (t0, t1)}
    res = {"basis_quantiles": r["basis"], "prints": r["prints"], "windows": {}, "arms_meta": {a: {k: v for k, v in x.items() if k != "trips"} for a, x in r["arms"].items()}}
    lossdays = {}
    for name, (a, z) in W.items():
        days = C.days_between(a, z)
        daily, tab = {}, {}
        for arm, x in r["arms"].items():
            sel = [t for t in x["trips"] if a <= t[0] < z]
            pnl = sum(t[8] for t in sel); notional = sum(t[4] * t[5] for t in sel)
            dd = collections.Counter()
            for t in sel:
                dd[C.day_of(t[0])] += t[8]
            daily[arm] = dd
            tab[arm] = {"trips": len(sel), "bids": sum(1 for t in sel if t[2] == "bid"), "asks": sum(1 for t in sel if t[2] == "ask"),
                        "pnl_eur": round(pnl, 4), "eur_per_day": round(pnl / len(days), 4), "bps_per_trip": round(1e4 * pnl / notional, 2) if notional else None,
                        "stops": sum(1 for t in sel if t[7] == "taker"), "stop_pnl_eur": round(sum(t[8] for t in sel if t[7] == "taker"), 4),
                        "worst_day_eur": round(min([dd.get(dd_, 0.0) for dd_ in days] or [0]), 4)}
        for arm in ("basis", "basis_carry"):
            base = tab["par"]["pnl_eur"]
            tab[arm]["vs_par"] = boot(daily[arm], daily["par"], days) | {"gain_pct_of_par": round(100 * (tab[arm]["pnl_eur"] - base) / base, 1) if base else None}
        res["windows"][name] = {"days": len(days), "arms": tab}
    # days whose closed trips lost 1 % of the $600 book (about €5.4): the loss stop the replay leaves out
    for arm, x in r["arms"].items():
        dd = collections.Counter()
        for t in x["trips"]:
            dd[C.day_of(t[1])] += t[8]
        lossdays[arm] = sorted(d for d, v in dd.items() if v <= -5.4)
    res["loss_stop_days"] = lossdays
    json.dump(res, open(out_path, "w"), indent=1, sort_keys=True)
    for name, w in res["windows"].items():
        print(name, w["days"], "days")
        for arm, t in w["arms"].items():
            print("   ", arm, {k: t[k] for k in ("trips", "bids", "asks", "pnl_eur", "eur_per_day", "bps_per_trip", "stops", "worst_day_eur")}, t.get("vs_par", ""))
    print("loss-stop days", lossdays)


if __name__ == "__main__":
    main(*sys.argv[1:3])
