"""FX-SPEED-LONG's statistics: cb_long.py's runs → results/cb_long.json.

Every candidate is paired with today's X by UTC day of each trip's exit (a day with no trip counts 0), in pounds:
  * the history: against `a` (Yahoo's timing and level, reconstructed), in sample 2024-10-01 → 2025-11-20, out of sample
    2025-11-21 → 2026-10-08 (the CB/OKX study's history window, which no choice here reads), and by calendar month;
  * the production record: against `yahoo` (the bars the engines stored) and against `a` (which also says how far the
    reconstruction is from Yahoo itself), 2026-10-10 (10-13 for the held arms) → 10-28.
Bootstrap: 3-day circular blocks of the daily differences, 10,000 draws, seed 20261029 (FX-SPEED §7.3's), the 5th and 95th
percentiles of the mean and the share of draws at or below zero. A candidate's own record: pounds, trips, stops (24-hour taker
exits), worst day, bps a trip (dollar P&L over dollar notional).

THE VERDICT, stated before any run was read: an arm switches only if (b) = L3 (the `fx_ticks` read received by t + 58 s,
1 s of source age, at Yahoo's level) beats `a` out of sample with P(≤ 0) < 0.10, its mean is above zero in sample too, and at
least two thirds of the history's calendar months are positive (the 19-day result was front-loaded). The same test is reported
for L3_raw (the level `fx_ticks` brings as it is) and L5 (3 s of age); which level the build would take is read on the
in-sample half alone (L3 against L3_raw).
usage: python3 -I cb_long_stats.py RUNS.json.gz OUT.json
"""
import collections, datetime, gzip, json, sys

import numpy as np

SEED, NB, BLOCK = 20261029, 10_000, 3
DAY = 86_400_000
day = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")


def days(a, b):
    return [day(t) for t in range(a // DAY * DAY, b, DAY)]


def boot(v):
    v = np.asarray(v, dtype=float)
    n = len(v)
    rng = np.random.default_rng(SEED)
    nb = -(-n // BLOCK)
    starts = rng.integers(0, n, size=(NB, nb))
    idx = (starts[:, :, None] + np.arange(BLOCK)[None, None, :]).reshape(NB, -1)[:, :n] % n
    means = np.sort(v[idx].mean(axis=1))
    return [round(float(means[int(0.05 * NB)]), 4), round(float(means[int(0.95 * NB)]), 4), round(float((means <= 0).mean()), 4)]


def daily(trips, books=None):
    d = collections.defaultdict(float)
    for x in trips:
        d[day(x[1])] += x[7]
    return d


def record(trips, dd):
    sel = [x for x in trips if day(x[1]) in dd]
    per = collections.defaultdict(float)
    for x in sel:
        per[day(x[1])] += x[7]
    usd, notional = sum(x[2] for x in sel), sum(x[3] for x in sel)
    return {"gbp": round(sum(x[7] for x in sel), 2), "trips": len(sel), "stops": sum(1 for x in sel if x[4] == "t"),
            "worst_day_gbp": round(min([per.get(d, 0.0) for d in dd]), 2), "bps_trip": round(1e4 * usd / notional, 3) if notional else None}


def pair(c_trips, b_trips, dd):
    a, b = daily(c_trips), daily(b_trips)
    v = [a.get(d, 0.0) - b.get(d, 0.0) for d in dd]
    m = float(np.mean(v))
    return {"gbp_day": round(m, 4), "gbp_year": round(365 * m, 1), "boot90_pLe0": boot(v), "days": len(v),
            "days_ahead": sum(1 for x in v if x > 1e-9), "days_behind": sum(1 for x in v if x < -1e-9)}


def monthly(c_trips, b_trips, dd):
    a, b = daily(c_trips), daily(b_trips)
    out = collections.defaultdict(float)
    for d in dd:
        out[d[:7]] += a.get(d, 0.0) - b.get(d, 0.0)
    return {k: round(v, 2) for k, v in sorted(out.items())}


def main(path, out):
    R = json.load(gzip.open(path, "rt"))
    W = R["windows"]
    cands = R["cands"]
    arms = R["arms"]
    IS, OOS = days(W["T0H"], W["TSPLIT"]), days(W["TSPLIT"], W["T1H"])
    ALL = IS + OOS
    res = {"windows": {"is": [IS[0], IS[-1], len(IS)], "oos": [OOS[0], OOS[-1], len(OOS)]}, "anchor": R["anchor"],
           "hist_meta": R["hist_meta"], "prod_meta": R["prod_meta"], "hist": {}, "prod": {}, "verdict": {}}
    H, Pd = R["hist"], R["prod"]

    def trips_of(src, arm, books, c):
        return [x for b in books for x in src.get(f"{arm}|{b}|{c}", [])]

    for arm, (books, size, hold) in arms.items():
        if arm == "nudge":
            continue
        scopes = [("all", books)] + [(b, [b]) for b in books]
        for sc, bs in scopes:
            base = trips_of(H, arm, bs, "a")
            r = {"a": {w: record(base, dd) for w, dd in (("is", IS), ("oos", OOS))}}
            for c in cands:
                if c == "a":
                    continue
                ct = trips_of(H, arm, bs, c)
                r[c] = {"is": pair(ct, base, IS), "oos": pair(ct, base, OOS), "all": pair(ct, base, ALL),
                        "record": {w: record(ct, dd) for w, dd in (("is", IS), ("oos", OOS))}}
                if sc == "all" or c in ("L3", "L3_raw"):
                    mo = monthly(ct, base, ALL)
                    r[c]["months"] = mo
                    r[c]["months_positive"] = [sum(1 for v in mo.values() if v > 0), len(mo)]
            res["hist"][f"{arm}|{sc}"] = r
    # where USDC-GBP's difference falls: trips entered inside FX closures (where "- 3" differs from "- 2") and outside
    import cb_long as CL  # noqa: E402  (its closure test)
    for arm in ("usdc", "wk"):
        for c in ("L3", "L3_raw"):
            ct, bt = H.get(f"{arm}|USDC-GBP|{c}", []), H.get(f"{arm}|USDC-GBP|a", [])
            split = {}
            for name, sel in (("closure", True), ("open", False)):
                f = lambda tr: [x for x in tr if CL.in_quote_closure(x[0]) == sel]
                split[name] = {"is": pair(f(ct), f(bt), IS)["gbp_year"], "oos": pair(f(ct), f(bt), OOS)["gbp_year"]}
            res["hist"][f"{arm}|USDC-GBP|{c}|by_entry"] = split
    for arm, (books, size, hold) in arms.items():
        rec = "hold" if hold else "base"
        PD = days(W["TP0"][rec], W["TP1"])
        scopes = [("all", books)] + ([(b, [b]) for b in books] if len(books) > 1 else [])
        for sc, bs in scopes:
            y = trips_of(Pd, arm, bs, "yahoo")
            a = trips_of(Pd, arm, bs, "a")
            r = {"yahoo": record(y, PD), "a_vs_yahoo": pair(a, y, PD)}
            for c in cands:
                ct = trips_of(Pd, arm, bs, c)
                r[c] = {"vs_yahoo": pair(ct, y, PD), "vs_a": pair(ct, a, PD), "record": record(ct, PD)}
            res["prod"][f"{arm}|{sc}"] = r
    for arm in arms:
        if arm == "nudge":
            continue
        v = {}
        for c in ("L3", "L3_raw", "L5", "L2", "L0"):
            h = res["hist"][f"{arm}|all"][c]
            mp = h.get("months_positive")
            ok = h["oos"]["gbp_day"] > 0 and h["oos"]["boot90_pLe0"][2] < 0.10 and h["is"]["gbp_day"] > 0 and (mp is None or mp[0] * 3 >= mp[1] * 2)
            v[c] = {"passes": ok, "oos_gbp_year": h["oos"]["gbp_year"], "oos_p": h["oos"]["boot90_pLe0"], "is_gbp_year": h["is"]["gbp_year"],
                    "months_positive": mp}
        res["verdict"][arm] = v
    res["level_on_is"] = {arm: {"L3": res["hist"][f"{arm}|all"]["L3"]["is"]["gbp_year"], "L3_raw": res["hist"][f"{arm}|all"]["L3_raw"]["is"]["gbp_year"]}
                          for arm in arms if arm != "nudge"}
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)
    for arm, v in res["verdict"].items():
        print(arm, {c: (x["passes"], x["is_gbp_year"], x["oos_gbp_year"], x["oos_p"], x["months_positive"]) for c, x in v.items()})


if __name__ == "__main__":
    import os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main(sys.argv[1], sys.argv[2])
